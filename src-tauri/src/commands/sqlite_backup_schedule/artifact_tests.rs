use super::artifacts::ArtifactLedger;
use super::models::{SqliteBackupArtifactQuery, SqliteBackupRun, SqliteBackupRunStatus, MAX_RUNS};
use super::runner::apply_retention;
use super::state::SqliteBackupScheduleState;
use super::worker::run_worker;
use super::worker_tests::fixture;
use chrono::{Duration, Utc};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};

async fn backup(state: &SqliteBackupScheduleState) -> SqliteBackupRun {
    let id = state.lock_data().await.unwrap().schedules[0].id.clone();
    state.queue_backup(&id).await.unwrap();
    run_worker(state, true).await.unwrap();
    let run = state.lock_data().await.unwrap().runs[0].clone();
    assert_eq!(
        run.status,
        SqliteBackupRunStatus::Success,
        "{:?}",
        run.error
    );
    run
}

async fn one_backup() -> (
    tempfile::TempDir,
    SqliteBackupScheduleState,
    SqliteBackupRun,
) {
    let (directory, state) = fixture().await;
    {
        let mut data = state.lock_data().await.unwrap();
        data.schedules.truncate(1);
        data.schedules[0].enabled = false;
        data.schedules[0].retention_count = 100;
        state.persist(&data).unwrap();
    }
    let run = backup(&state).await;
    (directory, state, run)
}

fn failures(run: &SqliteBackupRun) -> Vec<SqliteBackupRun> {
    (0..MAX_RUNS)
        .map(|_| {
            let mut failed = run.clone();
            failed.id = uuid::Uuid::new_v4().to_string();
            failed.status = SqliteBackupRunStatus::Failed;
            failed.file_path = None;
            failed.byte_len = None;
            failed.integrity_check = None;
            failed.error = Some("Fixture failed run".to_string());
            failed
        })
        .collect()
}

async fn ledger_connection(state: &SqliteBackupScheduleState) -> SqliteConnection {
    SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(state.root().join("sqlite-artifacts.db")),
    )
    .await
    .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn truncating_recent_history_archives_a_legacy_receipt_before_retention_needs_it() {
    let (directory, state, older) = one_backup().await;
    let mut connection = ledger_connection(&state).await;
    sqlx::query("DELETE FROM artifacts WHERE run_id=?")
        .bind(&older.id)
        .execute(&mut connection)
        .await
        .unwrap();
    connection.close().await.unwrap();
    {
        let mut data = state.lock_data().await.unwrap();
        data.runs = failures(&older);
        data.runs[MAX_RUNS - 1] = older.clone();
        data.schedules[0].retention_count = 1;
        state.persist(&data).unwrap();
    }
    let newer = backup(&state).await;
    assert_ne!(older.id, newer.id);
    assert!(!std::path::Path::new(older.file_path.as_deref().unwrap()).exists());
    assert!(std::path::Path::new(newer.file_path.as_deref().unwrap()).is_file());
    let page = state
        .list_artifacts(SqliteBackupArtifactQuery::default())
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, newer.id);
    assert_eq!(state.lock_data().await.unwrap().runs.len(), MAX_RUNS);
    assert_eq!(
        std::fs::read_dir(directory.path().join("backups"))
            .unwrap()
            .count(),
        1
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn archived_files_remain_browsable_and_deletable_after_recent_history_is_replaced() {
    let (_directory, state, run) = one_backup().await;
    {
        let mut data = state.lock_data().await.unwrap();
        data.runs = failures(&run);
        state.persist(&data).unwrap();
    }
    let page = state
        .list_artifacts(SqliteBackupArtifactQuery {
            project_id: Some(run.project_id.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.items[0].id, run.id);
    assert!(state.delete_backup(&run.id).await.unwrap());
    assert!(!state.delete_backup(&run.id).await.unwrap());
    assert!(!std::path::Path::new(run.file_path.as_deref().unwrap()).exists());
    assert!(state
        .list_artifacts(Default::default())
        .await
        .unwrap()
        .items
        .is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_durable_success_receipt_repairs_a_running_json_record_without_copying_again() {
    let (directory, state, completed) = one_backup().await;
    let bytes = std::fs::read(completed.file_path.as_deref().unwrap()).unwrap();
    {
        let mut data = state.lock_data().await.unwrap();
        data.runs[0].status = SqliteBackupRunStatus::Running;
        data.runs[0].completed_at = None;
        data.runs[0].progress_percent = 9;
        state.persist(&data).unwrap();
    }
    std::fs::remove_file(directory.path().join("source.sqlite")).unwrap();
    run_worker(&state, true).await.unwrap();
    let data = state.lock_data().await.unwrap();
    assert_eq!(data.runs.len(), 1);
    assert_eq!(data.runs[0], completed);
    assert_eq!(
        std::fs::read(completed.file_path.as_deref().unwrap()).unwrap(),
        bytes
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deletion_witness_prevents_stale_json_from_deleting_a_replacement_file_after_restart() {
    let (_directory, state, run) = one_backup().await;
    {
        let data = state.lock_data().await.unwrap();
        let mut ledger = ArtifactLedger::open(&state, &data).await.unwrap();
        let stored = ledger.lookup(&run.id).await.unwrap().unwrap();
        ledger.remove(&stored).await.unwrap();
        ledger.close().await.unwrap();
        // Simulate termination after the ledger commit, before JSON removal.
    }
    let path = run.file_path.as_deref().unwrap();
    std::fs::write(path, b"replacement belongs to the user").unwrap();
    assert!(state
        .list_artifacts(Default::default())
        .await
        .unwrap()
        .items
        .is_empty());
    assert!(state.delete_backup(&run.id).await.unwrap());
    assert_eq!(
        std::fs::read(path).unwrap(),
        b"replacement belongs to the user"
    );
    assert!(state.lock_data().await.unwrap().runs.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn replaced_files_and_offline_directories_keep_their_receipts() {
    let (directory, state, run) = one_backup().await;
    let path = std::path::Path::new(run.file_path.as_deref().unwrap());
    let original_modified = std::fs::metadata(path).unwrap().modified().unwrap();
    let moved = path.with_extension("original");
    std::fs::rename(path, &moved).unwrap();
    std::fs::copy(&moved, path).unwrap();
    std::fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(original_modified))
        .unwrap();
    assert!(state
        .delete_backup(&run.id)
        .await
        .unwrap_err()
        .contains("changed"));
    assert!(path.is_file());
    assert_eq!(
        state
            .list_artifacts(Default::default())
            .await
            .unwrap()
            .items
            .len(),
        1
    );
    std::fs::remove_file(path).unwrap();
    std::fs::rename(&moved, path).unwrap();
    let destination = directory.path().join("backups");
    let offline = directory.path().join("offline");
    std::fs::rename(&destination, &offline).unwrap();
    assert!(state
        .delete_backup(&run.id)
        .await
        .unwrap_err()
        .contains("unavailable"));
    assert_eq!(
        state
            .list_artifacts(Default::default())
            .await
            .unwrap()
            .items
            .len(),
        1
    );
    std::fs::rename(offline, destination).unwrap();
    assert!(state.delete_backup(&run.id).await.unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ledger_failure_cannot_drop_a_history_entry_or_consume_its_next_occurrence() {
    let (_directory, state, run) = one_backup().await;
    let next = {
        let mut data = state.lock_data().await.unwrap();
        data.runs = failures(&run);
        data.runs[MAX_RUNS - 1] = run.clone();
        let next = data.schedules[0].next_run_at.clone();
        state.persist(&data).unwrap();
        next
    };
    std::fs::write(state.root().join("sqlite-artifacts.db"), b"damaged ledger").unwrap();
    assert!(state.queue_backup(&run.schedule_id).await.is_err());
    let data = state.lock_data().await.unwrap();
    assert_eq!(data.runs.len(), MAX_RUNS);
    assert_eq!(data.runs[MAX_RUNS - 1].id, run.id);
    assert_eq!(data.schedules[0].next_run_at, next);
    assert!(std::path::Path::new(run.file_path.as_deref().unwrap()).is_file());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_large_ledger_pages_by_key_and_enforces_project_search_and_cursor_scopes() {
    let (_directory, state, seed) = one_backup().await;
    let now = Utc::now();
    let mut expected = std::collections::HashSet::new();
    {
        let data = state.lock_data().await.unwrap();
        let mut ledger = ArtifactLedger::open(&state, &data).await.unwrap();
        for batch in 0..3 {
            let mut runs = Vec::new();
            for index in 0..300 {
                let number = batch * 300 + index;
                let mut run = seed.clone();
                run.id = uuid::Uuid::new_v4().to_string();
                run.project_id = format!("project-{}", number % 2 + 1);
                run.started_at = (now + Duration::microseconds(i64::from(number) + 1)).to_rfc3339();
                run.schedule_name = if number == 0 {
                    "Keep %_literal".to_string()
                } else {
                    format!("File {number}")
                };
                run.file_path = Some(format!(
                    "{}.{}.sqlite",
                    seed.file_path.as_deref().unwrap(),
                    number
                ));
                expected.insert(run.id.clone());
                runs.push(run);
            }
            ledger.archive_history(&runs).await.unwrap();
        }
        ledger.close().await.unwrap();
    }
    expected.insert(seed.id.clone());
    let mut cursor = None;
    let mut seen = std::collections::HashSet::new();
    loop {
        let page = state
            .list_artifacts(SqliteBackupArtifactQuery {
                cursor,
                limit: Some(37),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(page.items.len() <= 37);
        for run in page.items {
            assert!(seen.insert(run.id));
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(seen, expected);
    let project = state
        .list_artifacts(SqliteBackupArtifactQuery {
            project_id: Some("project-1".to_string()),
            limit: Some(1),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(project
        .items
        .iter()
        .all(|run| run.project_id == "project-1"));
    assert!(state
        .list_artifacts(SqliteBackupArtifactQuery {
            project_id: Some("project-2".to_string()),
            cursor: project.next_cursor,
            ..Default::default()
        })
        .await
        .is_err());
    let literal = state
        .list_artifacts(SqliteBackupArtifactQuery {
            search: "%_".to_string(),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(literal.items.len(), 1);
    assert_eq!(literal.items[0].schedule_name, "Keep %_literal");
    for limit in [0, 101] {
        assert!(state
            .list_artifacts(SqliteBackupArtifactQuery {
                limit: Some(limit),
                ..Default::default()
            })
            .await
            .is_err());
    }
    assert!(state
        .list_artifacts(SqliteBackupArtifactQuery {
            cursor: Some("x".repeat(2049)),
            ..Default::default()
        })
        .await
        .is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn retention_reports_changed_files_without_downgrading_a_completed_backup() {
    let (_directory, state, oldest) = one_backup().await;
    let older = backup(&state).await;
    let path = std::path::Path::new(older.file_path.as_deref().unwrap());
    let modified =
        std::fs::metadata(path).unwrap().modified().unwrap() + std::time::Duration::from_secs(5);
    std::fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    {
        let mut data = state.lock_data().await.unwrap();
        data.schedules[0].retention_count = 1;
        state.persist(&data).unwrap();
    }
    let newer = backup(&state).await;
    assert!(newer
        .error
        .as_deref()
        .unwrap()
        .contains("retention cleanup"));
    assert!(path.exists());
    assert!(!std::path::Path::new(oldest.file_path.as_deref().unwrap()).exists());
    assert_eq!(
        state
            .list_artifacts(Default::default())
            .await
            .unwrap()
            .items
            .len(),
        2
    );
    assert!(apply_retention(&state, &older.schedule_id).await.is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deleting_a_schedule_keeps_its_archived_files_and_malformed_receipts_fail_closed() {
    let (_directory, state, run) = one_backup().await;
    {
        let mut data = state.lock_data().await.unwrap();
        data.schedules.clear();
        data.runs.clear();
        state.persist(&data).unwrap();
    }
    assert_eq!(
        state
            .list_artifacts(Default::default())
            .await
            .unwrap()
            .items[0]
            .id,
        run.id
    );
    let mut connection = ledger_connection(&state).await;
    let mut payload = serde_json::to_value(&run).unwrap();
    payload["projectId"] = "another-project".into();
    sqlx::query("UPDATE artifacts SET run_json=? WHERE run_id=?")
        .bind(payload.to_string())
        .bind(&run.id)
        .execute(&mut connection)
        .await
        .unwrap();
    connection.close().await.unwrap();
    assert!(state.list_artifacts(Default::default()).await.is_err());
    assert!(state.delete_backup(&run.id).await.is_err());
    assert!(std::path::Path::new(run.file_path.as_deref().unwrap()).is_file());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unverified_published_files_survive_history_truncation_and_require_a_current_file_confirmation(
) {
    let (directory, state, original) = one_backup().await;
    let mut connection = ledger_connection(&state).await;
    sqlx::query("DELETE FROM artifacts WHERE run_id=?")
        .bind(&original.id)
        .execute(&mut connection)
        .await
        .unwrap();
    connection.close().await.unwrap();
    {
        let mut data = state.lock_data().await.unwrap();
        let run = &mut data.runs[0];
        run.status = SqliteBackupRunStatus::Running;
        run.completed_at = None;
        run.byte_len = None;
        run.integrity_check = None;
        state.persist(&data).unwrap();
    }
    std::fs::remove_file(directory.path().join("source.sqlite")).unwrap();
    run_worker(&state, true).await.unwrap();
    let interrupted = state.lock_data().await.unwrap().runs[0].clone();
    assert_eq!(interrupted.status, SqliteBackupRunStatus::Interrupted);
    {
        let mut data = state.lock_data().await.unwrap();
        data.runs = failures(&interrupted);
        state.persist(&data).unwrap();
    }
    apply_retention(&state, &interrupted.schedule_id)
        .await
        .unwrap();
    let page = state.list_artifacts(Default::default()).await.unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].status, SqliteBackupRunStatus::Interrupted);
    assert!(state.delete_backup(&interrupted.id).await.is_err());
    let preview = state.preview_delete_backup(&interrupted.id).await.unwrap();
    assert!(preview.review_required);
    assert_eq!(preview.file_path, interrupted.file_path);
    assert!(state
        .delete_backup_confirmed(&interrupted.id, preview.confirmation_token.as_deref())
        .await
        .unwrap());
    assert!(!std::path::Path::new(interrupted.file_path.as_deref().unwrap()).exists());
    assert!(state
        .list_artifacts(Default::default())
        .await
        .unwrap()
        .items
        .is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn file_delete_confirmations_are_single_use_expiring_and_bound_to_the_exact_file_snapshot() {
    let (_directory, state, first) = one_backup().await;
    let second = backup(&state).await;
    let preview = state.preview_delete_backup(&first.id).await.unwrap();
    assert!(!preview.review_required);
    assert!(state
        .delete_backup_confirmed(&second.id, preview.confirmation_token.as_deref())
        .await
        .is_err());
    assert!(std::path::Path::new(second.file_path.as_deref().unwrap()).exists());
    let preview = state.preview_delete_backup(&first.id).await.unwrap();
    let path = std::path::Path::new(first.file_path.as_deref().unwrap());
    let modified =
        std::fs::metadata(path).unwrap().modified().unwrap() + std::time::Duration::from_secs(5);
    std::fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert!(state
        .delete_backup_confirmed(&first.id, preview.confirmation_token.as_deref())
        .await
        .unwrap_err()
        .contains("changed"));
    assert!(path.exists());
    let preview = state.preview_delete_backup(&first.id).await.unwrap();
    assert!(preview.review_required);
    assert!(state
        .delete_backup_confirmed(&first.id, preview.confirmation_token.as_deref())
        .await
        .unwrap());
    assert!(state
        .delete_backup_confirmed(&second.id, preview.confirmation_token.as_deref())
        .await
        .is_err());
    let expired = state.preview_delete_backup(&second.id).await.unwrap();
    state
        .delete_leases
        .lock()
        .await
        .get_mut(expired.confirmation_token.as_deref().unwrap())
        .unwrap()
        .expires = std::time::Instant::now() - std::time::Duration::from_secs(1);
    assert!(state
        .delete_backup_confirmed(&second.id, expired.confirmation_token.as_deref())
        .await
        .is_err());
    assert!(std::path::Path::new(second.file_path.as_deref().unwrap()).exists());
    let latest = state.preview_delete_backup(&second.id).await.unwrap();
    assert!(state
        .delete_backup_confirmed(&second.id, latest.confirmation_token.as_deref())
        .await
        .unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn upgrading_the_first_ledger_schema_preserves_its_completed_receipts() {
    let (_directory, state, run) = one_backup().await;
    let mut connection = ledger_connection(&state).await;
    sqlx::query("DROP INDEX artifacts_retention; ALTER TABLE artifacts DROP COLUMN verified; CREATE INDEX artifacts_retention ON artifacts(schedule_id,removed,started_us DESC,run_id DESC); PRAGMA user_version=1")
        .execute(&mut connection).await.unwrap();
    connection.close().await.unwrap();
    let page = state.list_artifacts(Default::default()).await.unwrap();
    assert_eq!(page.items[0], run);
    let mut connection = ledger_connection(&state).await;
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&mut connection)
        .await
        .unwrap();
    assert_eq!(version, 2);
    connection.close().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn byte_bounded_pages_keep_all_receipts_reachable_through_their_continuations() {
    let (_directory, state, seed) = one_backup().await;
    let mut expected = std::collections::HashSet::from([seed.id.clone()]);
    {
        let data = state.lock_data().await.unwrap();
        let mut ledger = ArtifactLedger::open(&state, &data).await.unwrap();
        let mut runs = Vec::new();
        for index in 0..20 {
            let mut run = seed.clone();
            run.id = uuid::Uuid::new_v4().to_string();
            run.started_at = (Utc::now() + Duration::microseconds(index)).to_rfc3339();
            run.file_path = Some(format!(
                "{}{}.sqlite",
                seed.file_path.as_deref().unwrap(),
                "x".repeat(220_000)
            ));
            expected.insert(run.id.clone());
            runs.push(run);
        }
        ledger.archive_history(&runs).await.unwrap();
        ledger.close().await.unwrap();
    }
    let mut cursor = None;
    let mut seen = std::collections::HashSet::new();
    loop {
        let page = state
            .list_artifacts(SqliteBackupArtifactQuery {
                limit: Some(100),
                cursor,
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(serde_json::to_vec(&page).unwrap().len() <= 2 * 1024 * 1024);
        assert!(page.items.len() < 100);
        for run in page.items {
            assert!(seen.insert(run.id));
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(seen, expected);
}
