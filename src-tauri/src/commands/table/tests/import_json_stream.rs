use super::super::import_json_stream::{stream_json_rows, JSON_ROW_BYTES};
use super::super::import_row_stream::row_batch_stream as json_batch_stream;
use super::super::import_transaction::import_streamed_rows_in_transaction as import_json_in_transaction;
use super::super::limits::{
    STRUCTURED_IMPORT_BATCH_BYTES as JSON_BATCH_BYTES,
    STRUCTURED_IMPORT_QUEUE_BATCHES as JSON_QUEUE_BATCHES,
};
use super::*;
use std::io::Write;
use std::sync::atomic::Ordering;

fn source(contents: &[u8], extension: &str) -> (tempfile::TempDir, std::path::PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join(format!("source.{extension}"));
    fs::write(&path, contents).unwrap();
    (directory, path)
}

#[test]
fn json_stream_rejects_trailing_documents_duplicate_fields_and_large_records() {
    for text in [
        r#"[{"id":1}] {"id":2}"#,
        r#"{"id":1,"id":2}"#,
        "[1]",
        "[{\"id\":1},]",
    ] {
        let (_dir, path) = source(text.as_bytes(), "json");
        assert!(
            stream_json_rows(&path, &|| false, &mut |_, _| Ok(())).is_err(),
            "{text}"
        );
    }
    let large = format!("{{\"payload\":\"{}\"}}", "x".repeat(JSON_ROW_BYTES));
    for extension in ["json", "jsonl"] {
        let (_dir, path) = source(large.as_bytes(), extension);
        let error = stream_json_rows(&path, &|| false, &mut |_, _| Ok(())).unwrap_err();
        assert!(error.contains("1 MiB"), "{error}");
    }
    let many_columns = serde_json::to_vec(
        &(0..257)
            .map(|index| (format!("c{index}"), json!(index)))
            .collect::<BTreeMap<_, _>>(),
    )
    .unwrap();
    let (_dir, path) = source(&many_columns, "json");
    assert!(stream_json_rows(&path, &|| false, &mut |_, _| Ok(()))
        .unwrap_err()
        .contains("256 fields"));
}

#[tokio::test]
async fn json_batch_queue_bounds_bytes_and_stops_when_consumer_disappears() {
    let rows = (0..100)
        .map(|i| json!({ "id":i, "payload":"x".repeat(100_000) }))
        .collect::<Vec<_>>();
    let (_dir, path) = source(&serde_json::to_vec(&rows).unwrap(), "json");
    let (_cancel, receive_cancel) = tokio::sync::watch::channel(false);
    let (mut receiver, worker) = json_batch_stream(path, receive_cancel, TableImportFormat::Json);
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while receiver.len() < JSON_QUEUE_BATCHES {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(
        !worker.is_finished(),
        "producer must wait for the bounded queue"
    );
    let batch = receiver.recv().await.unwrap();
    assert!(
        batch.len() < 500,
        "byte budget must flush before row budget"
    );
    assert!(
        batch
            .iter()
            .map(|row| serde_json::to_vec(row).unwrap().len())
            .sum::<usize>()
            <= JSON_BATCH_BYTES
    );
    drop(receiver);
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(5), worker)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
}

async fn import_fixture() -> (ConnectionManager, BTreeMap<String, ColumnInfo>) {
    let manager = ConnectionManager::new();
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver.query("CREATE TABLE target(id INTEGER PRIMARY KEY, payload TEXT NOT NULL); INSERT INTO target VALUES(-1,'original')").await.unwrap();
    let columns = column_lookup(driver.get_columns("main", "target").await.unwrap());
    manager
        .add_connection("json-import".into(), Box::new(driver))
        .await;
    (manager, columns)
}

async fn total(manager: &ConnectionManager) -> Value {
    manager
        .query(
            "json-import",
            "SELECT count(*), min(id), max(id) FROM target",
            None,
            None,
            None,
        )
        .await
        .unwrap()[0]
        .rows[0]
        .clone()
        .into()
}

#[tokio::test]
async fn json_stream_sqlite_preserves_types_and_commits_all_batches_once() {
    for extension in ["json", "jsonl"] {
        let (manager, columns) = import_fixture().await;
        let rows = (0..1201)
            .map(|id| json!({"id":id, "payload":"雪'; DROP TABLE target; --"}))
            .collect::<Vec<_>>();
        let bytes = if extension == "json" {
            serde_json::to_vec(&rows).unwrap()
        } else {
            rows.iter()
                .map(|r| format!("{r}\n"))
                .collect::<String>()
                .into_bytes()
        };
        let (_dir, path) = source(&bytes, extension);
        let (_cancel, receive_cancel) = tokio::sync::watch::channel(false);
        let result = import_json_in_transaction(
            &manager,
            "json-import",
            DatabaseKind::Postgres,
            "main",
            "target",
            &columns,
            &path,
            TableImportFormat::Json,
            None,
            TableImportMode::Truncate,
            &receive_cancel,
            &|_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(result, (1201, 3));
        assert_eq!(total(&manager).await, json!([1201, 0, 1200]));
        let value = manager
            .query(
                "json-import",
                "SELECT payload FROM target WHERE id=1200",
                None,
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(value[0].rows[0][0], json!("雪'; DROP TABLE target; --"));
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    let (manager, columns) = import_fixture().await;
    let (_dir, path) = source(br#"{"id":9007199254740993,"payload":"exact"}"#, "json");
    let (_cancel, receive_cancel) = tokio::sync::watch::channel(false);
    import_json_in_transaction(
        &manager,
        "json-import",
        DatabaseKind::Postgres,
        "main",
        "target",
        &columns,
        &path,
        TableImportFormat::Json,
        None,
        TableImportMode::Append,
        &receive_cancel,
        &|_, _| {},
    )
    .await
    .unwrap();
    assert_eq!(total(&manager).await, json!([2, -1, 9007199254740993_i64]));
}

#[tokio::test]
async fn json_stream_sqlite_rolls_back_late_parser_database_and_cancel_failures() {
    for mode in [TableImportMode::Append, TableImportMode::Truncate] {
        for failure in ["syntax", "duplicate", "cancel", "trailing"] {
            let (manager, columns) = import_fixture().await;
            let mut text = String::from("[");
            for id in 0..1001 {
                if id != 0 {
                    text.push(',');
                }
                let key = if failure == "duplicate" && id == 1000 {
                    0
                } else {
                    id
                };
                text.push_str(&format!("{{\"id\":{key},\"payload\":\"雪\"}}"));
            }
            if failure == "syntax" {
                text.push_str(", broken]");
            } else {
                text.push(']');
            }
            if failure == "trailing" {
                text.push_str(" true");
            }
            let (_dir, path) = source(text.as_bytes(), "json");
            let (cancel, receive_cancel) = tokio::sync::watch::channel(false);
            let observed = AtomicU64::new(0);
            let result = import_json_in_transaction(
                &manager,
                "json-import",
                DatabaseKind::Postgres,
                "main",
                "target",
                &columns,
                &path,
                TableImportFormat::Json,
                None,
                mode,
                &receive_cancel,
                &|rows, _| {
                    observed.store(rows, Ordering::Relaxed);
                    if failure == "cancel" {
                        cancel.send_replace(true);
                    }
                },
            )
            .await;
            assert!(result.is_err(), "{failure}");
            assert!(
                observed.load(Ordering::Relaxed) >= 500,
                "must fail after real database writes: {failure}"
            );
            assert_eq!(total(&manager).await, json!([1, -1, -1]), "{failure}");
            // A new import on the same connection must not inherit a leaked transaction.
            manager
                .query(
                    "json-import",
                    "INSERT INTO target VALUES(-2,'healthy')",
                    None,
                    None,
                    None,
                )
                .await
                .unwrap();
        }
    }
}

#[tokio::test]
#[ignore = "native million-row import and process memory evidence; run scripts/test-json-import.mjs"]
async fn json_stream_million_row_sqlite_acceptance() {
    let directory = std::path::PathBuf::from(
        std::env::var("OXIDE_JSON_IMPORT_EVIDENCE_DIR").expect("dedicated fixture directory"),
    );
    let workflow_started = std::time::Instant::now();
    let path = directory.join("million.json");
    let database = directory.join("target.db");
    let mut file = std::io::BufWriter::new(fs::File::create(&path).unwrap());
    file.write_all(b"[").unwrap();
    for id in 0..1_000_001_u64 {
        if id != 0 {
            file.write_all(b",").unwrap();
        }
        write!(file, "{{\"id\":{id},\"payload\":\"{}\"}}", "x".repeat(96)).unwrap();
    }
    file.write_all(b"]").unwrap();
    file.flush().unwrap();
    drop(file);
    let bytes = fs::metadata(&path).unwrap().len();
    assert!(bytes > 32 * 1024 * 1024);
    let original = super::super::import_preview::import_file_digest(&path).unwrap();
    let preview = read_json_import_preview(&path).unwrap();
    assert_eq!(preview.total_rows, Some(1_000_001));
    assert_eq!(preview.sample_rows.len(), 50);
    let (inferred, rows) = infer_json_lines_import_columns(&path, "sqlite").unwrap();
    assert_eq!(rows, 1_000_001);
    assert_eq!(inferred.len(), 2);
    let manager = ConnectionManager::new();
    let mut driver = SqliteDriver::new(&database.to_string_lossy());
    driver.connect().await.unwrap();
    driver
        .query("CREATE TABLE target(id INTEGER PRIMARY KEY,payload TEXT NOT NULL)")
        .await
        .unwrap();
    let columns = column_lookup(driver.get_columns("main", "target").await.unwrap());
    let preflight = super::super::import_preflight::scan_json_import_preflight(
        &path,
        DatabaseKind::Postgres,
        "main",
        "target",
        &columns,
        TableImportMode::Append,
    )
    .unwrap();
    assert_eq!(preflight.total_rows, 1_000_001);
    assert_eq!(preflight.accepted_rows, 1_000_001);
    assert_eq!(preflight.rejected_rows, 0);
    manager
        .add_connection("json-import".into(), Box::new(driver))
        .await;
    let (_cancel, receive_cancel) = tokio::sync::watch::channel(false);
    let start = std::time::Instant::now();
    let result = import_json_in_transaction(
        &manager,
        "json-import",
        DatabaseKind::Postgres,
        "main",
        "target",
        &columns,
        &path,
        TableImportFormat::Json,
        None,
        TableImportMode::Append,
        &receive_cancel,
        &|_, _| {},
    )
    .await
    .unwrap();
    assert_eq!(result, (1_000_001, 2001));
    let output = manager
        .query(
            "json-import",
            "SELECT count(*),sum(id),min(id),max(id),sum(length(payload)) FROM target",
            None,
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        output[0].rows[0],
        vec![
            json!(1_000_001),
            json!(500000500000_i64),
            json!(0),
            json!(1_000_000),
            json!(96_000_096)
        ]
    );
    assert_eq!(
        super::super::import_preview::import_file_digest(&path).unwrap(),
        original
    );
    fs::write(directory.join("native-evidence.json"),serde_json::to_vec_pretty(&json!({"rows":result.0,"batches":result.1,"sourceBytes":bytes,"sourceSha256":original,"sourceUnchanged":true,"previewRows":50,"inferenceRows":rows,"preflightRows":preflight.accepted_rows,"importMilliseconds":start.elapsed().as_millis(),"workflowMilliseconds":workflow_started.elapsed().as_millis(),"engine":"SQLite","scope":"native-library-import-transaction","desktopIpcTested":false,"resumeTested":false})).unwrap()).unwrap();
    // Runner samples the still-live test process before this fixture exits.
    fs::write(directory.join("measure-ready"), b"ready").unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while !directory.join("measure-done").exists() {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap();
    manager.disconnect_connection("json-import").await.unwrap();
    fs::remove_file(path).unwrap();
    fs::remove_file(database).unwrap();
}

#[test]
fn json_preview_total_bytes_are_bounded_for_many_wide_rows() {
    let row = (0..256)
        .map(|index| (format!("c{index}"), json!("x".repeat(1024))))
        .collect::<BTreeMap<_, _>>();
    let rows = vec![row; 50];
    for extension in ["json", "jsonl"] {
        let bytes = if extension == "json" {
            serde_json::to_vec(&rows).unwrap()
        } else {
            rows.iter()
                .map(|row| format!("{}\n", serde_json::to_string(row).unwrap()))
                .collect::<String>()
                .into_bytes()
        };
        let (_directory, path) = source(&bytes, extension);
        let preview = read_json_import_preview(&path).unwrap();
        assert!(preview.truncated);
        assert!(!preview.sample_rows.is_empty() && preview.sample_rows.len() < 50);
        assert!(serde_json::to_vec(&preview).unwrap().len() < 4 * 1024 * 1024);
    }
}

#[tokio::test]
async fn json_preflight_counts_all_invalid_rows_without_writing_source_values() {
    let (manager, columns) = import_fixture().await;
    let rows = (0..1001)
        .map(|id| {
            if id < 150 {
                json!({"id":id,"unknown":"sensitive"})
            } else {
                json!({"id":id,"payload":"valid"})
            }
        })
        .collect::<Vec<_>>();
    let (_directory, path) = source(&serde_json::to_vec(&rows).unwrap(), "json");
    let report = super::super::import_preflight::scan_json_import_preflight(
        &path,
        DatabaseKind::Postgres,
        "main",
        "target",
        &columns,
        TableImportMode::Append,
    )
    .unwrap();
    assert_eq!(
        (
            report.total_rows,
            report.accepted_rows,
            report.rejected_rows
        ),
        (1001, 851, 150)
    );
    assert_eq!(report.issues.len(), 100);
    assert!(report.issues_truncated);
    assert!(report
        .issues
        .iter()
        .all(|issue| issue.code == "ROW_INVALID"));
    assert!(!serde_json::to_string(&report)
        .unwrap()
        .contains("sensitive"));
    assert_eq!(total(&manager).await, json!([1, -1, -1]));
}
