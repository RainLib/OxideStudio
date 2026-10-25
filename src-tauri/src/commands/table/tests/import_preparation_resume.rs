use super::super::{import_snapshot::normalize_import_snapshot, import_types::TableImportFormat};
use super::import_jobs::Fixture;
use crate::core::transfer_jobs::FileImportPreparationPhase;
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::{path::PathBuf, time::Duration};

async fn interrupted() -> (Fixture, PathBuf, String, String) {
    let fixture = Fixture::new().await;
    let source = fixture.directory.path().join("source.json");
    let rows = (0..12001)
        .map(|id| {
            let mut row = serde_json::json!({"id":id,"payload":"雪 café"});
            match id % 3 {
                0 => row["optional"] = "provided".into(),
                1 => row["optional"] = serde_json::Value::Null,
                _ => (),
            }
            row
        })
        .collect::<Vec<_>>();
    std::fs::write(&source, serde_json::to_vec(&rows).unwrap()).unwrap();
    let digest = super::super::import_preview::import_file_digest(&source).unwrap();
    let directory = fixture
        .jobs
        .begin_resumable_file_import_preparation(
            "p",
            "test",
            &digest,
            serde_json::json!({"format":"json"}),
        )
        .await
        .unwrap();
    let id = directory.progress().unwrap().id;
    let (send, cancel) = tokio::sync::watch::channel(false);
    let task = tokio::spawn(normalize_import_snapshot(
        source.clone(),
        digest.clone(),
        TableImportFormat::Json,
        Some(true),
        None,
        fixture.columns.clone(),
        cancel,
        directory.clone(),
    ));
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let progress = directory.progress().unwrap();
            assert_ne!(
                progress.phase,
                FileImportPreparationPhase::Ready,
                "fixture must interrupt a live normalization"
            );
            if progress.normalized_rows >= 5000 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
    send.send(true).unwrap();
    assert!(task
        .await
        .unwrap()
        .err()
        .unwrap()
        .contains("TABLE_IMPORT_CANCELLED"));
    drop(directory);
    (fixture, source, digest, id)
}

#[tokio::test]
async fn committed_preparation_cursor_resumes_offline_without_duplicates_or_default_loss() {
    let (fixture, source, digest, id) = interrupted().await;
    std::fs::rename(&source, source.with_extension("offline.json")).unwrap();
    let directory = fixture
        .jobs
        .resume_file_import_preparation("p", &id)
        .await
        .unwrap();
    let snapshot = normalize_import_snapshot(
        source,
        digest,
        TableImportFormat::Json,
        Some(true),
        None,
        fixture.columns.clone(),
        tokio::sync::watch::channel(false).1,
        directory,
    )
    .await
    .unwrap();
    fixture.publish(snapshot).await;
    let mut target = fixture.target().await;
    let totals: (i64,i64,i64,i64,i64) = sqlx::query_as("SELECT COUNT(*),COUNT(DISTINCT id),SUM(optional='provided'),SUM(optional IS NULL),SUM(optional='factory') FROM target").fetch_one(&mut target).await.unwrap();
    assert_eq!(totals, (12001, 12001, 4001, 4000, 4000));
    assert!(fixture
        .jobs
        .list_file_import_preparations("p", None)
        .await
        .unwrap()
        .preparations
        .is_empty());
    target.close().await.unwrap();
}

#[tokio::test]
async fn tampered_cursor_prefix_schema_and_oversized_values_fail_before_append() {
    for (sql, expected) in [
        ("UPDATE data SET payload='changed' WHERE id=1", "differs"),
        (
            "UPDATE _oxide_preparation_checkpoint SET mac=printf('%064d',0)",
            "authentication",
        ),
        (
            "CREATE TRIGGER malicious AFTER INSERT ON data BEGIN DELETE FROM data; END",
            "schema",
        ),
        (
            "UPDATE data SET payload=zeroblob(5242880) WHERE id=1",
            "differs",
        ),
        (
            "UPDATE data SET payload=CAST(zeroblob(5242880) AS TEXT) WHERE id=1",
            "too big",
        ),
    ] {
        let (fixture, source, digest, id) = interrupted().await;
        let directory = fixture
            .jobs
            .resume_file_import_preparation("p", &id)
            .await
            .unwrap();
        let database = directory.path().join("normalized.sqlite");
        let mut connection =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&database))
                .await
                .unwrap();
        let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM data")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        sqlx::query(sql).execute(&mut connection).await.unwrap();
        connection.close().await.unwrap();
        let result = normalize_import_snapshot(
            source,
            digest,
            TableImportFormat::Json,
            Some(true),
            None,
            fixture.columns.clone(),
            tokio::sync::watch::channel(false).1,
            directory.clone(),
        )
        .await;
        let error = result.err().unwrap();
        assert!(error.contains(expected), "{sql}: {error}");
        let mut connection =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&database))
                .await
                .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM data")
                .fetch_one(&mut connection)
                .await
                .unwrap(),
            before
        );
        connection.close().await.unwrap();
        directory.close().unwrap();
        let mut target = fixture.target().await;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM target")
                .fetch_one(&mut target)
                .await
                .unwrap(),
            0
        );
        target.close().await.unwrap();
    }
}

#[tokio::test]
async fn source_capture_reuses_synced_prefix_and_discards_uncommitted_tail() {
    let fixture = Fixture::new().await;
    let source = fixture.directory.path().join("source.csv");
    let bytes = vec![b'x'; 8 * 1024 * 1024 + 123];
    std::fs::write(&source, &bytes).unwrap();
    let digest = super::super::import_preview::import_file_digest(&source).unwrap();
    let directory = fixture
        .jobs
        .begin_resumable_file_import_preparation("p", "capture", &digest, serde_json::json!({}))
        .await
        .unwrap();
    let id = directory.progress().unwrap().id;
    std::fs::write(
        directory.path().join("source.csv"),
        &bytes[..4 * 1024 * 1024 + 17],
    )
    .unwrap();
    directory
        .checkpoint(FileImportPreparationPhase::Copying, 4 * 1024 * 1024, 0)
        .unwrap();
    drop(directory);
    let directory = fixture
        .jobs
        .resume_file_import_preparation("p", &id)
        .await
        .unwrap();
    let (_send, cancel) = tokio::sync::watch::channel(false);
    let (directory, captured) = super::super::import_snapshot_copy::copy_reviewed_source(
        &source,
        &digest,
        TableImportFormat::Csv,
        &cancel,
        directory,
    )
    .unwrap();
    assert_eq!(
        super::super::import_preview::import_file_digest(&captured).unwrap(),
        digest
    );
    assert_eq!(
        directory.progress().unwrap().phase,
        FileImportPreparationPhase::Inspecting
    );
    assert_eq!(directory.source_bytes().unwrap(), bytes.len() as u64);
    directory.close().unwrap();
}

#[tokio::test]
async fn ready_csv_and_xlsx_preparations_can_replay_after_original_removal() {
    for format in [TableImportFormat::Csv, TableImportFormat::Xlsx] {
        let fixture = Fixture::new().await;
        let workbook;
        let source = match format {
            TableImportFormat::Csv => {
                let path = fixture.directory.path().join("source.csv");
                std::fs::write(&path, "id,payload\n1,雪\n").unwrap();
                path
            }
            _ => {
                workbook = super::import_xlsx_stream::package(
                    r#"<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>id</t></is></c><c r="B1" t="inlineStr"><is><t>payload</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" t="inlineStr"><is><t>雪</t></is></c></row></sheetData></worksheet>"#,
                    None,
                    None,
                    "worksheets/custom.xml",
                );
                workbook.1.clone()
            }
        };
        let digest = super::super::import_preview::import_file_digest(&source).unwrap();
        let directory = fixture
            .jobs
            .begin_resumable_file_import_preparation("p", "ready", &digest, serde_json::json!({}))
            .await
            .unwrap();
        let id = directory.progress().unwrap().id;
        let snapshot = normalize_import_snapshot(
            source.clone(),
            digest.clone(),
            format,
            Some(true),
            None,
            fixture.columns.clone(),
            tokio::sync::watch::channel(false).1,
            directory,
        )
        .await
        .unwrap();
        drop(snapshot);
        std::fs::remove_file(&source).unwrap();
        let directory = fixture
            .jobs
            .resume_file_import_preparation("p", &id)
            .await
            .unwrap();
        let snapshot = normalize_import_snapshot(
            source,
            digest,
            format,
            Some(true),
            None,
            fixture.columns.clone(),
            tokio::sync::watch::channel(false).1,
            directory,
        )
        .await
        .unwrap();
        fixture.publish(snapshot).await;
        let mut target = fixture.target().await;
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT payload FROM target WHERE id=1")
                .fetch_one(&mut target)
                .await
                .unwrap(),
            "雪"
        );
        target.close().await.unwrap();
    }
}
