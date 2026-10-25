use super::models::{
    SaveSqliteBackupScheduleRequest, SqliteBackupCompression, SqliteBackupRunStatus,
    SqliteBackupRunTrigger,
};
use super::queue::{cancel_run, enqueue_due, enqueue_schedule};
use super::runner::{finish_run, run_schedule};
use super::source::saved_source;
use super::state::{open_lease, try_exclusive, SqliteBackupScheduleState};
use super::tests::schedule;
use super::worker::run_worker;
use crate::core::driver::LocalDatabaseBackupControl;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection, SqliteConnection};
use std::path::Path;

async fn run_worker_once(state: &SqliteBackupScheduleState) -> Result<(), String> {
    run_worker(state, true).await
}

pub(super) async fn fixture() -> (tempfile::TempDir, SqliteBackupScheduleState) {
    let directory = tempfile::tempdir().unwrap();
    let config = directory.path().join("config");
    let destination = directory.path().join("backups");
    std::fs::create_dir(&config).unwrap();
    std::fs::create_dir(&destination).unwrap();
    let source = directory.path().join("source.sqlite");
    let mut db = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(&source)
            .create_if_missing(true)
            .disable_statement_logging(),
    )
    .await
    .unwrap();
    sqlx::query("CREATE TABLE sample (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO sample VALUES (42, 'backup fixture')").execute(&mut db).await.unwrap();
    db.close().await.unwrap();
    let mut db = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(config.join("metadata.db"))
            .create_if_missing(true)
            .disable_statement_logging(),
    )
    .await
    .unwrap();
    sqlx::query("CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('project-1'), ('project-2'); CREATE TABLE connections (id TEXT PRIMARY KEY, project_id TEXT, driver TEXT, config TEXT)").execute(&mut db).await.unwrap();
    for index in 1..=2 {
        sqlx::query("INSERT INTO connections VALUES (?, ?, 'sqlite', ?)")
            .bind(format!("sqlite-{index}"))
            .bind(format!("project-{index}"))
            .bind(serde_json::json!({"database": source.to_string_lossy()}).to_string())
            .execute(&mut db)
            .await
            .unwrap();
    }
    db.close().await.unwrap();
    let state = SqliteBackupScheduleState::load_at(directory.path(), &config, false).unwrap();
    {
        let mut data = state.lock_data().await.unwrap();
        data.background_enabled = true;
        let first = schedule(&destination.canonicalize().unwrap());
        let mut second = first.clone();
        second.id = uuid::Uuid::new_v4().to_string();
        second.name = "Other project".to_string();
        second.project_id = "project-2".to_string();
        second.connection_id = "sqlite-2".to_string();
        data.schedules = vec![first, second];
        state.persist(&data).unwrap();
    }
    (directory, state)
}

#[tokio::test]
async fn named_zone_save_preserves_older_requests_and_offline_pause() {
    let (directory, state) = fixture().await;
    let original = state.lock_data().await.unwrap().schedules[0].clone();
    let mut json = serde_json::to_value(&original).unwrap();
    json["timeZone"] = "Asia/Shanghai".into();
    let saved = state
        .save_schedule(serde_json::from_value(json).unwrap())
        .await
        .unwrap();
    assert_eq!(saved.time_zone.as_deref(), Some("Asia/Shanghai"));
    let reopened = SqliteBackupScheduleState::open_existing_profile(
        directory.path(),
        &directory.path().join("config"),
    )
    .unwrap();
    assert_eq!(
        reopened
            .lock_data()
            .await
            .unwrap()
            .schedules
            .iter()
            .find(|plan| plan.id == saved.id)
            .unwrap()
            .time_zone,
        saved.time_zone
    );

    let mut older = serde_json::to_value(&saved).unwrap();
    older.as_object_mut().unwrap().remove("timeZone");
    older["name"] = "Older renderer edit".into();
    let saved = state
        .save_schedule(serde_json::from_value(older).unwrap())
        .await
        .unwrap();
    assert_eq!(saved.time_zone.as_deref(), Some("Asia/Shanghai"));
    let before_invalid = std::fs::read(&state.path).unwrap();
    let mut invalid = serde_json::to_value(&saved).unwrap();
    invalid["timeZone"] = "Bad/Zone".into();
    assert!(state
        .save_schedule(serde_json::from_value(invalid).unwrap())
        .await
        .unwrap_err()
        .contains("time zone"));
    assert_eq!(std::fs::read(&state.path).unwrap(), before_invalid);

    let mut follow_system = serde_json::to_value(&saved).unwrap();
    follow_system["timeZone"] = "system".into();
    let local = state
        .save_schedule(serde_json::from_value(follow_system).unwrap())
        .await
        .unwrap();
    assert!(local.time_zone.is_none());
    let mut restore = serde_json::to_value(&local).unwrap();
    restore["timeZone"] = "Asia/Shanghai".into();
    let restored = state
        .save_schedule(serde_json::from_value(restore).unwrap())
        .await
        .unwrap();
    std::fs::rename(
        directory.path().join("source.sqlite"),
        directory.path().join("source-offline.sqlite"),
    )
    .unwrap();
    let mut pause = serde_json::to_value(&restored).unwrap();
    pause.as_object_mut().unwrap().remove("timeZone");
    pause["enabled"] = false.into();
    let request: SaveSqliteBackupScheduleRequest = serde_json::from_value(pause).unwrap();
    let paused = state.save_schedule(request).await.unwrap();
    assert!(!paused.enabled);
    assert_eq!(paused.time_zone.as_deref(), Some("Asia/Shanghai"));
}

#[tokio::test]
async fn invalid_zone_pauses_only_that_due_plan_and_preserves_other_projects() {
    let (_directory, state) = fixture().await;
    let invalid_id = {
        let mut data = state.lock_data().await.unwrap();
        data.schedules[0].time_zone = Some("Bad/Zone".to_string());
        data.schedules[1].time_zone = Some("Asia/Kathmandu".to_string());
        state.persist(&data).unwrap();
        data.schedules[0].id.clone()
    };
    assert!(state
        .queue_backup(&invalid_id)
        .await
        .unwrap_err()
        .contains("time zone"));
    assert!(state.lock_data().await.unwrap().runs.is_empty());
    run_worker_once(&state).await.unwrap();
    let data = state.lock_data().await.unwrap();
    assert_eq!(data.runs.len(), 1);
    assert_eq!(data.runs[0].project_id, "project-2");
    assert_eq!(data.runs[0].status, SqliteBackupRunStatus::Success);
    let invalid = data
        .schedules
        .iter()
        .find(|plan| plan.id == invalid_id)
        .unwrap();
    assert!(!invalid.enabled);
    assert!(invalid
        .scheduling_error
        .as_deref()
        .unwrap()
        .contains("time zone"));
}

#[tokio::test]
async fn terminal_receipt_recovery_survives_a_now_unavailable_time_zone() {
    let (directory, state) = fixture().await;
    run_worker_once(&state).await.unwrap();
    let schedule_id = {
        let mut data = state.lock_data().await.unwrap();
        let id = data.runs[0].schedule_id.clone();
        data.runs[0].status = SqliteBackupRunStatus::Running;
        let plan = data
            .schedules
            .iter_mut()
            .find(|plan| plan.id == id)
            .unwrap();
        plan.time_zone = Some("Bad/Zone".to_string());
        state.persist(&data).unwrap();
        id
    };
    std::fs::rename(
        directory.path().join("source.sqlite"),
        directory.path().join("source-offline.sqlite"),
    )
    .unwrap();
    run_worker_once(&state).await.unwrap();
    let data = state.lock_data().await.unwrap();
    assert!(data
        .runs
        .iter()
        .all(|run| run.status == SqliteBackupRunStatus::Success));
    let plan = data
        .schedules
        .iter()
        .find(|plan| plan.id == schedule_id)
        .unwrap();
    assert!(!plan.enabled);
    assert!(plan.scheduling_error.is_some());
}

async fn backup_value(path: &Path) -> i64 {
    let mut db = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .read_only(true)
            .disable_statement_logging(),
    )
    .await
    .unwrap();
    let value = sqlx::query_scalar("SELECT id FROM sample WHERE label='backup fixture'")
        .fetch_one(&mut db)
        .await
        .unwrap();
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut db)
        .await
        .unwrap();
    assert_eq!(integrity, "ok");
    db.close().await.unwrap();
    value
}

#[tokio::test]
async fn terminal_outcomes_resist_late_progress_and_execution_failures() {
    let (_directory, state) = fixture().await;
    run_worker_once(&state).await.unwrap();
    let mut completed = state.lock_data().await.unwrap().runs[0].clone();
    assert_eq!(completed.status, SqliteBackupRunStatus::Success);
    assert_eq!(completed.progress_percent, 100);
    assert!(!completed.record_running_progress(99));
    assert_eq!(completed.progress_percent, 100);

    let queued = state.queue_backup(&completed.schedule_id).await.unwrap();
    let mut telemetry = queued.clone();
    assert!(!telemetry.record_running_progress(10));
    telemetry.status = SqliteBackupRunStatus::Running;
    assert!(telemetry.record_running_progress(100));
    assert_eq!(telemetry.progress_percent, 99);
    assert!(cancel_run(&state, &queued.id).await.unwrap());
    let cancelled = state.lock_data().await.unwrap().runs[0].clone();
    let late = finish_run(
        &state,
        &queued.id,
        SqliteBackupRunStatus::Failed,
        None,
        None,
        Some("late execution failure".to_string()),
    )
    .await
    .unwrap();
    assert_eq!(late, cancelled);
    assert_eq!(state.lock_data().await.unwrap().runs[0], cancelled);
    assert_eq!(cancelled.status, SqliteBackupRunStatus::Cancelled);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_executes_both_projects_without_ui_and_only_once() {
    let (directory, state) = fixture().await;
    let source_before = std::fs::read(directory.path().join("source.sqlite")).unwrap();
    let metadata_before = std::fs::read(state.config_dir.join("metadata.db")).unwrap();
    let (left, right) = tokio::join!(run_worker_once(&state), run_worker_once(&state));
    left.unwrap();
    right.unwrap();
    run_worker_once(&state).await.unwrap();
    let data = state.lock_data().await.unwrap();
    assert_eq!(data.runs.len(), 2);
    for run in &data.runs {
        assert_eq!(
            run.status,
            SqliteBackupRunStatus::Success,
            "{:?}",
            run.error
        );
        assert_eq!(run.integrity_check.as_deref(), Some("ok"));
        assert_eq!(
            backup_value(Path::new(run.file_path.as_deref().unwrap())).await,
            42
        );
    }
    assert!(data.runs.iter().any(|run| run.project_id == "project-2"));
    assert_eq!(
        source_before,
        std::fs::read(directory.path().join("source.sqlite")).unwrap()
    );
    assert_eq!(
        metadata_before,
        std::fs::read(state.config_dir.join("metadata.db")).unwrap()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn durable_queue_claims_are_atomic_and_resume_after_reopen() {
    let (directory, state) = fixture().await;
    let id = {
        let mut data = state.lock_data().await.unwrap();
        for schedule in &mut data.schedules {
            schedule.enabled = false;
        }
        state.persist(&data).unwrap();
        data.schedules[0].id.clone()
    };
    let (first, second) = tokio::join!(
        enqueue_schedule(&state, &id, SqliteBackupRunTrigger::Manual),
        enqueue_schedule(&state, &id, SqliteBackupRunTrigger::Manual)
    );
    assert_ne!(first.is_ok(), second.is_ok());
    drop(state);
    let reopened = SqliteBackupScheduleState::load_at(
        directory.path(),
        &directory.path().join("config"),
        false,
    )
    .unwrap();
    run_worker_once(&reopened).await.unwrap();
    let data = reopened.lock_data().await.unwrap();
    assert_eq!(data.runs.len(), 1);
    assert_eq!(
        data.runs[0].status,
        SqliteBackupRunStatus::Success,
        "{:?}",
        data.runs[0].error
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn desktop_reopen_does_not_interrupt_a_live_worker_and_abandoned_claim_is_not_replayed() {
    let (directory, state) = fixture().await;
    let queued = enqueue_due(&state).await.unwrap();
    {
        let mut data = state.lock_data().await.unwrap();
        for run in &mut data.runs {
            run.status = SqliteBackupRunStatus::Running;
        }
        state.persist(&data).unwrap();
    }
    let leader = open_lease(&state.root().join("worker.lock")).unwrap();
    assert!(try_exclusive(&leader).unwrap());
    let reopened =
        SqliteBackupScheduleState::load_at(directory.path(), &state.config_dir, true).unwrap();
    run_worker_once(&reopened).await.unwrap(); // follower does no repair
    assert!(reopened
        .lock_data()
        .await
        .unwrap()
        .runs
        .iter()
        .all(|run| run.status == SqliteBackupRunStatus::Running));
    drop(leader);
    run_worker_once(&reopened).await.unwrap();
    run_worker_once(&reopened).await.unwrap();
    let data = reopened.lock_data().await.unwrap();
    assert_eq!(data.runs.len(), queued.len());
    assert!(data
        .runs
        .iter()
        .all(|run| run.status == SqliteBackupRunStatus::Interrupted));
    assert_eq!(
        std::fs::read_dir(directory.path().join("backups"))
            .unwrap()
            .count(),
        0
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn default_worker_obeys_desktop_lifetime_and_keeps_due_work_for_reopen() {
    let (directory, state) = fixture().await;
    {
        let mut data = state.lock_data().await.unwrap();
        data.background_enabled = false;
        state.persist(&data).unwrap();
    }
    run_worker_once(&state).await.unwrap();
    assert!(state.lock_data().await.unwrap().runs.is_empty());
    let desktop =
        SqliteBackupScheduleState::load_at(directory.path(), &state.config_dir, true).unwrap();
    assert!(state.desktop_is_open().unwrap());
    run_worker_once(&state).await.unwrap();
    assert_eq!(state.lock_data().await.unwrap().runs.len(), 2);
    drop(desktop);
    assert!(!state.desktop_is_open().unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unavailable_or_mismatched_saved_sources_never_create_empty_databases() {
    let (directory, state) = fixture().await;
    assert!(saved_source(&state, "project-2", "sqlite-1").await.is_err());
    let missing = directory.path().join("missing.sqlite");
    let mut db = SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(state.config_dir.join("metadata.db")),
    )
    .await
    .unwrap();
    for config in [
        serde_json::json!({"database": missing}),
        serde_json::json!({"database": directory.path().join("source.sqlite"), "driverPackageVersion":"1.0.0"}),
        serde_json::json!({"database": directory.path().join("source.sqlite"), "sshTunnel":{"enabled":true}}),
    ] {
        sqlx::query("UPDATE connections SET config=? WHERE id='sqlite-1'")
            .bind(config.to_string())
            .execute(&mut db)
            .await
            .unwrap();
        assert!(saved_source(&state, "project-1", "sqlite-1").await.is_err());
    }
    sqlx::query("UPDATE connections SET config=? WHERE id='sqlite-1'")
        .bind(serde_json::json!({"database": missing}).to_string())
        .execute(&mut db)
        .await
        .unwrap();
    db.close().await.unwrap();
    run_worker_once(&state).await.unwrap();
    let data = state.lock_data().await.unwrap();
    let failed = data
        .runs
        .iter()
        .find(|run| run.connection_id == "sqlite-1")
        .unwrap();
    assert_eq!(failed.status, SqliteBackupRunStatus::Failed);
    assert!(failed.file_path.is_none());
    assert!(!missing.exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_claim_publishes_no_file_and_compressed_retention_keeps_a_verified_backup() {
    let (directory, state) = fixture().await;
    let id = {
        let mut data = state.lock_data().await.unwrap();
        data.schedules.truncate(1);
        data.schedules[0].enabled = false;
        data.schedules[0].compression = SqliteBackupCompression::Gzip;
        data.schedules[0].retention_count = 1;
        state.persist(&data).unwrap();
        data.schedules[0].id.clone()
    };
    let queued = enqueue_schedule(&state, &id, SqliteBackupRunTrigger::Manual)
        .await
        .unwrap();
    let control = LocalDatabaseBackupControl::default();
    control.cancel();
    let run = run_schedule(&state, &queued.id, &control).await.unwrap();
    assert_eq!(run.status, SqliteBackupRunStatus::Cancelled);
    assert!(run.file_path.is_none());
    assert_eq!(
        std::fs::read_dir(directory.path().join("backups"))
            .unwrap()
            .count(),
        0
    );
    for _ in 0..2 {
        enqueue_schedule(&state, &id, SqliteBackupRunTrigger::Manual)
            .await
            .unwrap();
        run_worker_once(&state).await.unwrap();
    }
    let data = state.lock_data().await.unwrap();
    let successful = data
        .runs
        .iter()
        .filter(|run| run.status == SqliteBackupRunStatus::Success)
        .collect::<Vec<_>>();
    assert_eq!(successful.len(), 1);
    let file = std::fs::File::open(successful[0].file_path.as_deref().unwrap()).unwrap();
    let mut decoder = flate2::read::GzDecoder::new(file);
    let restored = directory.path().join("verified.sqlite");
    let mut output = std::fs::File::create(&restored).unwrap();
    std::io::copy(&mut decoder, &mut output).unwrap();
    drop(output);
    assert_eq!(backup_value(&restored).await, 42);
    assert_eq!(
        std::fs::read_dir(directory.path().join("backups"))
            .unwrap()
            .count(),
        1
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_restores_the_saved_encrypted_file_url_without_recreating_a_missing_key() {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::{Aes256Gcm, Nonce};
    let (directory, state) = fixture().await;
    let key = [7_u8; 32];
    let nonce_bytes = [3_u8; 12];
    let nonce = Nonce::from(nonce_bytes);
    let source = directory.path().join("source.sqlite");
    let secrets = serde_json::to_vec(&serde_json::json!({"url": source})).unwrap();
    let ciphertext = Aes256Gcm::new_from_slice(&key)
        .unwrap()
        .encrypt(
            &nonce,
            Payload {
                msg: &secrets,
                aad: b"oxide-connection-credential-v1\0project-1\0sqlite-1",
            },
        )
        .unwrap();
    let key_path = state.config_dir.join("connection-credentials-v1.secret");
    std::fs::write(&key_path, key).unwrap();
    let mut db = SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(state.config_dir.join("metadata.db")),
    )
    .await
    .unwrap();
    sqlx::query("CREATE TABLE connection_credentials (project_id TEXT, connection_id TEXT, ciphertext BLOB, nonce BLOB); UPDATE connections SET config='{\"url\":\"\"}' WHERE id='sqlite-1'")
        .execute(&mut db).await.unwrap();
    sqlx::query("INSERT INTO connection_credentials VALUES ('project-1', 'sqlite-1', ?, ?)")
        .bind(&ciphertext)
        .bind(nonce_bytes.as_slice())
        .execute(&mut db)
        .await
        .unwrap();
    db.close().await.unwrap();
    let metadata_before = std::fs::read(state.config_dir.join("metadata.db")).unwrap();
    assert_eq!(
        saved_source(&state, "project-1", "sqlite-1").await.unwrap(),
        source.canonicalize().unwrap()
    );
    run_worker_once(&state).await.unwrap();
    assert!(state
        .lock_data()
        .await
        .unwrap()
        .runs
        .iter()
        .all(|run| run.status == SqliteBackupRunStatus::Success));
    assert_eq!(
        std::fs::read(state.config_dir.join("metadata.db")).unwrap(),
        metadata_before
    );
    assert_eq!(std::fs::read(&key_path).unwrap(), key);
    std::fs::remove_file(&key_path).unwrap();
    assert!(saved_source(&state, "project-1", "sqlite-1").await.is_err());
    assert!(!key_path.exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn persisted_cancellation_reaches_a_running_worker_and_queued_cancellation_never_executes() {
    use std::time::{Duration, Instant};
    let (directory, state) = fixture().await;
    let id = {
        let mut data = state.lock_data().await.unwrap();
        data.schedules.truncate(1);
        data.schedules[0].enabled = false;
        state.persist(&data).unwrap();
        data.schedules[0].id.clone()
    };
    let queued = enqueue_schedule(&state, &id, SqliteBackupRunTrigger::Manual)
        .await
        .unwrap();
    assert!(cancel_run(&state, &queued.id).await.unwrap());
    run_worker_once(&state).await.unwrap();
    assert_eq!(
        state.lock_data().await.unwrap().runs[0].status,
        SqliteBackupRunStatus::Cancelled
    );
    assert_eq!(
        std::fs::read_dir(directory.path().join("backups"))
            .unwrap()
            .count(),
        0
    );
    let mut source = SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(directory.path().join("source.sqlite")),
    )
    .await
    .unwrap();
    sqlx::query("BEGIN EXCLUSIVE")
        .execute(&mut source)
        .await
        .unwrap();
    let queued = enqueue_schedule(&state, &id, SqliteBackupRunTrigger::Manual)
        .await
        .unwrap();
    let worker_state = state.clone();
    let worker = tokio::spawn(async move { run_worker_once(&worker_state).await });
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if state.lock_data().await.unwrap().runs[0].status == SqliteBackupRunStatus::Running {
            break;
        }
        assert!(Instant::now() < deadline, "worker did not claim the job");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(cancel_run(&state, &queued.id).await.unwrap());
    tokio::time::sleep(Duration::from_millis(800)).await;
    sqlx::query("ROLLBACK").execute(&mut source).await.unwrap();
    source.close().await.unwrap();
    tokio::time::timeout(Duration::from_secs(10), worker)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let data = state.lock_data().await.unwrap();
    assert_eq!(
        data.runs[0].status,
        SqliteBackupRunStatus::Cancelled,
        "{:?}",
        data.runs[0].error
    );
    assert!(data.runs[0].file_path.is_none());
    assert_eq!(
        std::fs::read_dir(directory.path().join("backups"))
            .unwrap()
            .count(),
        0
    );
}

#[tokio::test]
async fn unavailable_source_and_destination_do_not_prevent_pausing_a_reviewed_schedule() {
    let (directory, state) = fixture().await;
    let existing = state.lock_data().await.unwrap().schedules[0].clone();
    std::fs::remove_file(directory.path().join("source.sqlite")).unwrap();
    std::fs::rename(
        directory.path().join("backups"),
        directory.path().join("detached-backups"),
    )
    .unwrap();
    let mut request = serde_json::to_value(&existing).unwrap();
    request["enabled"] = false.into();
    let paused = state
        .save_schedule(serde_json::from_value(request.clone()).unwrap())
        .await
        .unwrap();
    assert!(!paused.enabled);
    assert_eq!(paused.next_run_at, existing.next_run_at);
    request["retentionCount"] = 99.into();
    assert!(state
        .save_schedule(serde_json::from_value(request.clone()).unwrap())
        .await
        .is_err());
    request["retentionCount"] = existing.retention_count.into();
    request["enabled"] = true.into();
    assert!(state
        .save_schedule(serde_json::from_value(request).unwrap())
        .await
        .is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_long_outage_consumes_the_abandoned_occurrence_and_catches_up_once_without_replaying_it()
{
    let (_directory, state) = fixture().await;
    let id = {
        let mut data = state.lock_data().await.unwrap();
        data.schedules.truncate(1);
        state.persist(&data).unwrap();
        data.schedules[0].id.clone()
    };
    let queued = enqueue_schedule(&state, &id, SqliteBackupRunTrigger::Scheduled)
        .await
        .unwrap();
    {
        let mut data = state.lock_data().await.unwrap();
        let started = chrono::Utc::now() - chrono::Duration::days(2);
        data.runs[0].started_at = started.to_rfc3339();
        data.runs[0].status = SqliteBackupRunStatus::Running;
        data.runs[0].file_path = None;
        data.schedules[0].next_run_at = (started + chrono::Duration::hours(6)).to_rfc3339();
        state.persist(&data).unwrap();
    }
    run_worker_once(&state).await.unwrap();
    run_worker_once(&state).await.unwrap();
    let data = state.lock_data().await.unwrap();
    assert_eq!(data.runs.len(), 2);
    assert_eq!(
        data.runs
            .iter()
            .find(|run| run.id == queued.id)
            .unwrap()
            .status,
        SqliteBackupRunStatus::Interrupted
    );
    assert_eq!(
        data.runs
            .iter()
            .filter(|run| run.status == SqliteBackupRunStatus::Success)
            .count(),
        1
    );
}
