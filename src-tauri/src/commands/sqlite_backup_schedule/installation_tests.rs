use super::artifacts::ArtifactLedger;
use super::control::{
    claim_allowed, read_control, write_control, InstanceWitness, WorkerControl, WorkerImage,
};
use super::installation::{install_with_startup, maintain_preparation};
use super::installation_control::{InstallationBarrier, InstallationPhase};
use super::leadership::{register_desktop, status};
use super::models::{SqliteBackupRunStatus, SqliteBackupRunTrigger};
use super::queue::enqueue_schedule;
use super::state::{open_lease, try_exclusive, SqliteBackupScheduleState};
use super::worker::run_worker;
use super::worker_tests::fixture;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn next_version() -> String {
    let mut version = semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
    version.patch += 1;
    version.to_string()
}

async fn queued() -> (tempfile::TempDir, SqliteBackupScheduleState, String) {
    let (directory, state) = fixture().await;
    let id = state.lock_data().await.unwrap().schedules[0].id.clone();
    let run = enqueue_schedule(&state, &id, SqliteBackupRunTrigger::Manual)
        .await
        .unwrap();
    (directory, state, run.id)
}

#[tokio::test]
async fn preparation_preserves_queue_and_blocks_claims_ledger_and_other_windows() {
    let (_directory, state, _) = queued().await;
    register_desktop(&state).await.unwrap();
    let before = std::fs::read(&state.path).unwrap();
    let download = uuid::Uuid::new_v4().to_string();
    let prepared = state
        .prepare_update(&next_version(), "window-a", &download)
        .await
        .unwrap();
    assert!(prepared.ready);
    assert_eq!(std::fs::read(&state.path).unwrap(), before);
    assert!(!claim_allowed(state.root(), &state.config_dir, Some("old-worker")).unwrap());
    let data = state.lock_data().await.unwrap();
    assert!(state.persist(&data).unwrap_err().contains("paused"));
    assert!(ArtifactLedger::open(&state, &data).await.is_err());
    assert!(!state.root().join("sqlite-artifacts.db").exists());
    drop(data);
    assert!(state
        .poll_update_preparation(&prepared.token, "window-b", &download)
        .await
        .unwrap_err()
        .contains("another window"));
    assert!(state
        .cancel_update_preparation(
            &prepared.token,
            "window-a",
            &uuid::Uuid::new_v4().to_string()
        )
        .await
        .is_err());
    let worker_status = status(&state).await.unwrap();
    assert!(!worker_status.running);
    assert!(worker_status.upgrading);
    state
        .cancel_update_preparation(&prepared.token, "window-a", &download)
        .await
        .unwrap();
    assert_eq!(std::fs::read(&state.path).unwrap(), before);
    assert!(state.lock_data().await.unwrap().background_enabled);
    run_worker(&state, true).await.unwrap();
    assert!(state
        .lock_data()
        .await
        .unwrap()
        .runs
        .iter()
        .all(|run| run.status == SqliteBackupRunStatus::Success));
}

#[tokio::test]
async fn installer_failure_restores_startup_and_queued_work_even_when_its_future_panics() {
    for panic in [false, true] {
        let (_directory, state, run_id) = queued().await;
        let download = uuid::Uuid::new_v4().to_string();
        let prepared = state
            .prepare_update(&next_version(), "window", &download)
            .await
            .unwrap();
        let transitions = Arc::new(Mutex::new(Vec::new()));
        let observed = transitions.clone();
        let error = install_with_startup(
            &state,
            &prepared.token,
            "window",
            &download,
            move || {
                if panic {
                    panic!("fixture installer panic");
                }
                Err("fixture launch denied".to_string())
            },
            move |enabled| {
                observed.lock().unwrap().push(enabled);
                async { Ok(()) }
            },
        )
        .await
        .unwrap_err();
        assert!(error.contains("scheduling has resumed"), "{error}");
        assert_eq!(*transitions.lock().unwrap(), [false, true]);
        assert!(read_control(state.root())
            .unwrap()
            .unwrap()
            .installation
            .is_none());
        assert!(state.lock_data().await.unwrap().background_enabled);
        assert_eq!(
            state.lock_data().await.unwrap().runs[0].status,
            SqliteBackupRunStatus::Queued
        );
        run_worker(&state, true).await.unwrap();
        assert_eq!(
            state
                .lock_data()
                .await
                .unwrap()
                .runs
                .iter()
                .find(|run| run.id == run_id)
                .unwrap()
                .status,
            SqliteBackupRunStatus::Success
        );
    }
}

#[tokio::test]
async fn a_startup_restore_failure_stays_paused_and_requires_explicit_recovery() {
    let (_directory, state, _) = queued().await;
    let download = uuid::Uuid::new_v4().to_string();
    let prepared = state
        .prepare_update(&next_version(), "window", &download)
        .await
        .unwrap();
    let error = install_with_startup(
        &state,
        &prepared.token,
        "window",
        &download,
        || Err("fixture installer failed".to_string()),
        |enabled| async move {
            if enabled {
                Err("fixture startup restore failed".to_string())
            } else {
                Ok(())
            }
        },
    )
    .await
    .unwrap_err();
    assert!(error.contains("remain paused"));
    let status = state.update_installation_status().await.unwrap();
    assert!(status.recovery_required);
    assert_eq!(
        status.installation_id.as_deref(),
        Some(prepared.token.as_str())
    );
    assert!(register_desktop(&state)
        .await
        .unwrap_err()
        .contains("not completed"));
    assert_eq!(
        state.lock_data().await.unwrap().runs[0].status,
        SqliteBackupRunStatus::Queued
    );
}

#[tokio::test]
async fn a_successful_install_keeps_the_barrier_when_relaunch_has_not_happened() {
    let (directory, state, _) = queued().await;
    {
        let mut data = state.lock_data().await.unwrap();
        data.background_enabled = false;
        state.persist(&data).unwrap();
    }
    let before = std::fs::read(&state.path).unwrap();
    let download = uuid::Uuid::new_v4().to_string();
    let prepared = state
        .prepare_update(&next_version(), "window", &download)
        .await
        .unwrap();
    install_with_startup(
        &state,
        &prepared.token,
        "window",
        &download,
        || Ok(()),
        |_| async { panic!("disabled preference must not touch OS startup") },
    )
    .await
    .unwrap();
    assert_eq!(
        state.update_installation_status().await.unwrap().phase,
        "restartRequired"
    );
    state.installation.lock().await.as_mut().unwrap().heartbeat =
        Instant::now() - Duration::from_secs(120);
    assert!(!maintain_preparation(&state).await.unwrap());
    assert!(state
        .cancel_update_preparation(&prepared.token, "window", &download)
        .await
        .is_err());
    assert!(state.recover_update_backups(&prepared.token).await.is_err());
    assert_eq!(std::fs::read(&state.path).unwrap(), before);
    // Simulate native process exit. Reopening the old version must not silently
    // resume while an external Windows installer could still be running.
    state.installation.lock().await.take();
    let reopened = SqliteBackupScheduleState::open_existing_profile(
        directory.path(),
        &directory.path().join("config"),
    )
    .unwrap();
    assert!(
        reopened
            .update_installation_status()
            .await
            .unwrap()
            .recovery_required
    );
    assert!(register_desktop(&reopened)
        .await
        .unwrap_err()
        .contains("not completed"));
    assert!(reopened
        .recover_update_backups(&uuid::Uuid::new_v4().to_string())
        .await
        .is_err());
    reopened
        .recover_update_backups(&prepared.token)
        .await
        .unwrap();
    assert_eq!(std::fs::read(&state.path).unwrap(), before);
}

#[tokio::test]
async fn abandoned_preparation_expires_but_never_runs_the_installer_before_worker_exit() {
    let (_directory, state, _) = queued().await;
    let starter = open_lease(&state.root().join("worker-start.lock")).unwrap();
    assert!(try_exclusive(&starter).unwrap());
    let download = uuid::Uuid::new_v4().to_string();
    let prepared = state
        .prepare_update(&next_version(), "window", &download)
        .await
        .unwrap();
    assert!(!prepared.ready);
    let error = install_with_startup(
        &state,
        &prepared.token,
        "window",
        &download,
        || panic!("installer must wait for worker exit"),
        |_| async { panic!("startup must wait for worker exit") },
    )
    .await
    .unwrap_err();
    assert!(error.contains("Wait"));
    let prepared = state
        .prepare_update(&next_version(), "window", &download)
        .await
        .unwrap();
    assert!(!prepared.ready);
    state.installation.lock().await.as_mut().unwrap().heartbeat =
        Instant::now() - Duration::from_secs(61);
    maintain_preparation(&state).await.unwrap();
    assert!(read_control(state.root())
        .unwrap()
        .unwrap()
        .installation
        .is_none());
    assert!(state.installation.lock().await.is_none());
    drop(starter);
    run_worker(&state, true).await.unwrap();
    assert!(state
        .lock_data()
        .await
        .unwrap()
        .runs
        .iter()
        .all(|run| run.status == SqliteBackupRunStatus::Success));
}

#[tokio::test]
async fn reopening_recovers_only_abandoned_preparation_or_the_actual_target_version() {
    let (_directory, state, _) = queued().await;
    register_desktop(&state).await.unwrap();
    for phase in [
        InstallationPhase::Preparing,
        InstallationPhase::Committed,
        InstallationPhase::Installed,
    ] {
        let witness = InstanceWitness::new(state.root()).unwrap();
        let current = WorkerImage::current().unwrap();
        let mut control = WorkerControl::new(current.clone(), state.config_dir.clone());
        control
            .begin_installation(InstallationBarrier {
                id: witness.id.clone(),
                target_version: next_version(),
                requested_at: witness.started_at.clone(),
                phase,
                previous_protocol: current.protocol,
            })
            .unwrap();
        write_control(state.root(), &control).unwrap();
        assert!(control
            .recover_installation_on_open(state.root(), &current)
            .is_err());
        drop(witness);
        if phase == InstallationPhase::Preparing {
            control
                .recover_installation_on_open(state.root(), &current)
                .unwrap();
        } else {
            assert!(control
                .recover_installation_on_open(state.root(), &current)
                .is_err());
            let mut successor = current.clone();
            successor.version = next_version();
            control
                .recover_installation_on_open(state.root(), &successor)
                .unwrap();
        }
        assert_eq!(control.target.image.protocol, current.protocol);
        assert!(control.installation.is_none());
    }
}

#[tokio::test]
async fn startup_suspension_failure_rolls_back_before_any_installer_can_run() {
    let (_directory, state, _) = queued().await;
    let before = std::fs::read(&state.path).unwrap();
    let download = uuid::Uuid::new_v4().to_string();
    let prepared = state
        .prepare_update(&next_version(), "window", &download)
        .await
        .unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let observed = calls.clone();
    let error = install_with_startup(
        &state,
        &prepared.token,
        "window",
        &download,
        || panic!("failed suspension must never launch an installer"),
        move |enabled| {
            observed.lock().unwrap().push(enabled);
            async move {
                if enabled {
                    Ok(())
                } else {
                    Err("fixture startup suspension failed".to_string())
                }
            }
        },
    )
    .await
    .unwrap_err();
    assert!(error.contains("scheduling has resumed"));
    assert_eq!(*calls.lock().unwrap(), [false, true]);
    assert_eq!(std::fs::read(&state.path).unwrap(), before);
    assert_eq!(
        state.update_installation_status().await.unwrap().phase,
        "idle"
    );
}

#[tokio::test]
async fn legacy_worker_and_invalid_versions_cannot_partially_prepare_an_update() {
    let (_directory, state, _) = queued().await;
    let before = std::fs::read(&state.path).unwrap();
    let download = uuid::Uuid::new_v4().to_string();
    for version in ["invalid", env!("CARGO_PKG_VERSION"), "0.0.1"] {
        assert!(state
            .prepare_update(version, "window", &download)
            .await
            .is_err());
        assert!(read_control(state.root()).unwrap().is_none());
    }
    let leader = open_lease(&state.root().join("worker.lock")).unwrap();
    assert!(try_exclusive(&leader).unwrap());
    assert!(state
        .prepare_update(&next_version(), "window", &download)
        .await
        .unwrap_err()
        .contains("previous OxideStudio"));
    assert_eq!(std::fs::read(&state.path).unwrap(), before);
    assert!(read_control(state.root()).unwrap().is_none());
}
