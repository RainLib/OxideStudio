use super::*;
use crate::core::config::{RemoteSqliteSshConfig, SqliteWorkerPlacement};
use crate::core::protocol::DEFAULT_QUERY_RESULT_ROW_LIMIT;
use crate::core::sqlite_worker_artifact::ResolvedSqliteWorker;
use oxide_sqlite_worker::{WorkerColumn, WorkerResponseBody};

#[test]
fn remote_paths_and_worker_placement_are_host_owned() {
    assert_eq!(
        remote_sqlite_path("sqlite:///srv/data/app.db").unwrap(),
        "/srv/data/app.db"
    );
    assert_eq!(
        expand_remote_home("~/data/app.db", "/home/oxide").unwrap(),
        "/home/oxide/data/app.db"
    );
    assert!(validate_remote_absolute_path("../../etc/passwd").is_err());
    assert!(remote_sqlite_path("sqlite::memory:").is_err());
    let worker = ResolvedSqliteWorker {
        bytes: vec![1],
        digest: "a".repeat(64),
        version: "1.0.0".into(),
        platform: "linux-x64".into(),
    };
    let config = RemoteSqliteSshConfig {
        placement: SqliteWorkerPlacement::Session,
        worker_path: None,
        allow_worker_upload: true,
        approved_worker_digest: Some(worker.digest.clone()),
    };
    assert!(worker_upload_is_approved(&config, &worker));
    assert!(!worker_upload_is_approved(
        &RemoteSqliteSshConfig {
            approved_worker_digest: Some("b".repeat(64)),
            ..config.clone()
        },
        &worker,
    ));
    assert!(!worker_upload_is_approved(
        &RemoteSqliteSshConfig {
            allow_worker_upload: false,
            ..config.clone()
        },
        &worker,
    ));
    let (path, remove) =
        worker_remote_path("connection/unsafe", &config, &worker, "/home/oxide").unwrap();
    assert!(path.starts_with("/home/oxide/.cache/oxide/sqlite-worker/session-"));
    assert!(!path.contains("connection/unsafe"));
    assert!(remove);
}

#[test]
fn query_results_keep_row_bounds_and_execution_receipts() {
    let rows = (0..=DEFAULT_QUERY_RESULT_ROW_LIMIT)
        .map(|value| vec![serde_json::json!(value)])
        .collect();
    let result = worker_query_result(
        "SELECT id FROM items",
        WorkerResponseBody::Result {
            columns: vec![WorkerColumn {
                name: "id".into(),
                data_type: "INTEGER".into(),
            }],
            rows,
            rows_affected: 0,
            truncated: false,
        },
    )
    .unwrap();
    assert_eq!(result.rows.len(), DEFAULT_QUERY_RESULT_ROW_LIMIT);
    assert!(result.truncated);
    let execution = worker_query_result(
        "UPDATE items SET id = id",
        WorkerResponseBody::Result {
            columns: vec![],
            rows: vec![],
            rows_affected: 4,
            truncated: false,
        },
    )
    .unwrap();
    assert_eq!(execution.rows_affected, Some(4));
}

#[test]
fn composite_foreign_key_rows_can_be_read_without_string_coercion() {
    let row = vec![serde_json::json!(7), serde_json::json!("parent")];
    assert_eq!(integer_at(&row, 0), Some(7));
    assert_eq!(string_at(&row, 1).as_deref(), Some("parent"));
}
