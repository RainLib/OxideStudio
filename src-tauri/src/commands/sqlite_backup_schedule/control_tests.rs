use super::artifacts::ArtifactLedger;
use super::control::{
    claim_allowed, read_control, receipt_is_live, write_control, InstanceWitness, WorkerControl,
    WorkerImage, WorkerReceipt,
};
use super::leadership::{ready_or_pending, register_desktop, status};
use super::models::{SaveSqliteBackupScheduleRequest, SqliteBackupRunStatus};
use super::runner::run_schedule;
use super::state::{open_lease, try_exclusive};
use super::worker_tests::fixture;
use crate::core::driver::LocalDatabaseBackupControl;
use std::path::Path;

fn image(version: &str, seed: u64) -> WorkerImage {
    let mut image = WorkerImage::current().unwrap();
    image.version = version.to_string();
    image.build_id = format!("{seed:064x}");
    image
}

fn receipt(
    image: WorkerImage,
    generation: u64,
    witness: &InstanceWitness,
    config: &Path,
) -> WorkerReceipt {
    WorkerReceipt {
        instance_id: witness.id.clone(),
        generation,
        image,
        config_dir: config.to_path_buf(),
        started_at: witness.started_at.clone(),
        pid: std::process::id(),
    }
}

#[test]
fn selection_is_monotonic_across_versions_and_rejects_retired_same_version_builds() {
    let directory = tempfile::tempdir().unwrap();
    let a = image("0.1.18", 1);
    let b = image("0.1.18", 2);
    let c = image("0.1.19", 3);
    let mut control = WorkerControl::new(a.clone(), directory.path().to_path_buf());
    assert_eq!(control.select(&b, directory.path(), None).unwrap(), 2);
    assert!(control.select(&a, directory.path(), Some(1)).is_err());
    assert!(control.select(&a, directory.path(), None).is_err());
    assert_eq!(control.select(&c, directory.path(), None).unwrap(), 3);
    assert!(control.select(&b, directory.path(), None).is_err());
    let mut older_protocol = image("0.1.20", 4);
    control.target.image.protocol = 2;
    older_protocol.protocol = 1;
    assert!(control
        .select(&older_protocol, directory.path(), None)
        .unwrap_err()
        .contains("protocol"));
    assert!(control
        .select(&c, &directory.path().join("other-config"), None)
        .unwrap_err()
        .contains("configuration directory"));
    assert_eq!(control.target.generation, 3);
}

#[test]
fn identical_code_can_relocate_without_restarting_or_letting_old_windows_retarget_it() {
    let directory = tempfile::tempdir().unwrap();
    let a = image("0.1.18", 1);
    let mut moved = a.clone();
    moved.executable = directory.path().join("new-install/oxide-studio.exe");
    let mut control = WorkerControl::new(a.clone(), directory.path().to_path_buf());
    assert_eq!(control.select(&moved, directory.path(), None).unwrap(), 1);
    assert_eq!(control.target.image.executable, moved.executable);
    assert_eq!(control.select(&a, directory.path(), Some(1)).unwrap(), 1);
    assert_eq!(control.target.image.executable, moved.executable);
    let b = image("0.1.18", 2);
    control.select(&b, directory.path(), None).unwrap();
    assert!(control.select(&moved, directory.path(), Some(1)).is_err());
}

#[tokio::test]
async fn an_unknown_live_worker_blocks_store_ledger_and_file_mutations() {
    let (_directory, state) = fixture().await;
    let before = std::fs::read(&state.path).unwrap();
    let leader = open_lease(&state.root().join("worker.lock")).unwrap();
    assert!(try_exclusive(&leader).unwrap());
    let mut paused =
        serde_json::to_value(state.lock_data().await.unwrap().schedules[0].clone()).unwrap();
    paused["enabled"] = false.into();
    let request: SaveSqliteBackupScheduleRequest = serde_json::from_value(paused).unwrap();
    assert!(state
        .save_schedule(request)
        .await
        .unwrap_err()
        .contains("previous OxideStudio"));
    assert!(register_desktop(&state)
        .await
        .unwrap_err()
        .contains("previous OxideStudio"));
    let data = state.lock_data().await.unwrap();
    assert!(ArtifactLedger::open(&state, &data)
        .await
        .err()
        .unwrap()
        .contains("previous OxideStudio"));
    assert!(!state.root().join("sqlite-artifacts.db").exists());
    assert_eq!(before, std::fs::read(&state.path).unwrap());
    drop(data);
    assert!(status(&state)
        .await
        .unwrap()
        .message
        .unwrap()
        .contains("cannot be upgraded"));
    drop(leader);
    register_desktop(&state).await.unwrap();
}

#[tokio::test]
async fn a_stale_pid_or_receipt_is_not_evidence_of_worker_ownership() {
    let (_directory, state) = fixture().await;
    let witness = InstanceWitness::new(state.root()).unwrap();
    let active = receipt(
        WorkerImage::current().unwrap(),
        1,
        &witness,
        &state.config_dir,
    );
    assert!(receipt_is_live(state.root(), &active).unwrap());
    drop(witness);
    assert!(!receipt_is_live(state.root(), &active).unwrap());
    {
        let _data = state.lock_data().await.unwrap();
        let mut control =
            WorkerControl::new(WorkerImage::current().unwrap(), state.config_dir.clone());
        control.active = Some(active);
        write_control(state.root(), &control).unwrap();
    }
    let leader = open_lease(&state.root().join("worker.lock")).unwrap();
    assert!(try_exclusive(&leader).unwrap());
    assert!(status(&state)
        .await
        .unwrap()
        .message
        .unwrap()
        .contains("cannot be upgraded"));
    assert!(!ready_or_pending(&state).await.unwrap());
}

#[tokio::test]
async fn protocol_changes_freeze_foreground_writes_but_allow_the_leader_to_finish() {
    let (_directory, state) = fixture().await;
    let witness = InstanceWitness::new(state.root()).unwrap();
    let current = WorkerImage::current().unwrap();
    let mut old = image("0.1.17", 1);
    old.protocol = 2; // Any different store protocol must fence foreground writes.
    {
        let _data = state.lock_data().await.unwrap();
        let mut control = WorkerControl::new(current, state.config_dir.clone());
        control.active = Some(receipt(old, 1, &witness, &state.config_dir));
        write_control(state.root(), &control).unwrap();
    }
    let leader = open_lease(&state.root().join("worker.lock")).unwrap();
    assert!(try_exclusive(&leader).unwrap());
    let mut data = state.lock_data().await.unwrap();
    data.schedules[0].enabled = false;
    assert!(state.persist(&data).unwrap_err().contains("Finishing"));
    assert!(ArtifactLedger::open(&state, &data).await.is_err());
    *state.worker_instance.lock().unwrap() = Some(witness.id.clone());
    state.persist(&data).unwrap();
    let ledger = ArtifactLedger::open(&state, &data).await.unwrap();
    ledger.close().await.unwrap();
    *state.worker_instance.lock().unwrap() = None;
}

#[tokio::test]
async fn a_handoff_fences_the_claim_inside_the_same_store_lease() {
    let (_directory, state) = fixture().await;
    let schedule_id = state.lock_data().await.unwrap().schedules[0].id.clone();
    let queued = state.queue_backup(&schedule_id).await.unwrap();
    let witness = InstanceWitness::new(state.root()).unwrap();
    {
        let _data = state.lock_data().await.unwrap();
        let old = image("0.1.18", 1);
        let mut control = WorkerControl::new(old.clone(), state.config_dir.clone());
        control.active = Some(receipt(old, 1, &witness, &state.config_dir));
        control
            .select(&WorkerImage::current().unwrap(), &state.config_dir, None)
            .unwrap();
        write_control(state.root(), &control).unwrap();
        assert!(!claim_allowed(state.root(), &state.config_dir, Some(&witness.id)).unwrap());
    }
    *state.worker_instance.lock().unwrap() = Some(witness.id.clone());
    let unclaimed = run_schedule(&state, &queued.id, &LocalDatabaseBackupControl::default())
        .await
        .unwrap();
    assert_eq!(unclaimed.status, SqliteBackupRunStatus::Queued);
    assert_eq!(
        state.lock_data().await.unwrap().runs[0].status,
        SqliteBackupRunStatus::Queued
    );
    assert!(std::fs::read_dir(
        state.lock_data().await.unwrap().schedules[0]
            .destination_directory
            .clone()
    )
    .unwrap()
    .next()
    .is_none());
    *state.worker_instance.lock().unwrap() = None;
}

#[tokio::test]
async fn pending_status_requires_a_live_instance_and_control_is_bounded_and_versioned() {
    let (_directory, state) = fixture().await;
    let pending = InstanceWitness::new(state.root()).unwrap();
    let mut control = WorkerControl::new(WorkerImage::current().unwrap(), state.config_dir.clone());
    control.pending = Some(receipt(
        control.target.image.clone(),
        1,
        &pending,
        &state.config_dir,
    ));
    {
        let _data = state.lock_data().await.unwrap();
        write_control(state.root(), &control).unwrap();
    }
    assert!(ready_or_pending(&state).await.unwrap());
    assert!(status(&state).await.unwrap().upgrading);
    drop(pending);
    assert!(!ready_or_pending(&state).await.unwrap());
    let _data = state.lock_data().await.unwrap();
    let path = state.root().join("worker-control.json");
    let mut newer = serde_json::to_value(control).unwrap();
    newer["schemaVersion"] = 99.into();
    std::fs::write(&path, serde_json::to_vec(&newer).unwrap()).unwrap();
    assert!(read_control(state.root())
        .unwrap_err()
        .contains("Unsupported"));
    std::fs::write(&path, vec![b' '; 128 * 1024 + 1]).unwrap();
    assert!(read_control(state.root())
        .unwrap_err()
        .contains("size limit"));
}
