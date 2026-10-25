//! Exercise the actual command preparation service without a GUI in CI.
use super::{execute_preparation, PrepareTableImportJob};
use crate::{
    commands::table::{TableImportCancellationState, TableImportFormat, TableImportMode},
    core::{
        driver::DatabaseDriver,
        driver_package::DatabaseDriverPackageRegistry,
        manager::ConnectionManager,
        store::{MetaStore, Project, SavedConnection},
        transfer_jobs::{LargeTransferJobs, LargeTransferPhase},
    },
    drivers::sqlite::SqliteDriver,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};

#[tokio::test]
async fn sqlite_preparation_reads_connected_columns_and_fences_database_selector() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("target.sqlite");
    let mut driver = SqliteDriver::new(target.to_str().unwrap());
    driver.connect().await.unwrap();
    driver
        .query("CREATE TABLE target(id INTEGER PRIMARY KEY,payload TEXT)")
        .await
        .unwrap();
    let metadata = MetaStore::open(&directory.path().join("profile"))
        .await
        .unwrap();
    metadata
        .save_project(&Project {
            id: "p".into(),
            name: "fixture".into(),
            root_path: None,
            created_at: 1,
            updated_at: 1,
        })
        .await
        .unwrap();
    metadata.save_connection(&SavedConnection{id:"target".into(),project_id:"p".into(),name:"target".into(),driver:"sqlite".into(),config:json!({"id":"target","projectId":"p","name":"target","driver":"sqlite","url":target}),created_at:1,updated_at:1}).await.unwrap();
    let jobs = LargeTransferJobs::open(
        &directory.path().join("jobs"),
        metadata,
        DatabaseDriverPackageRegistry::new(directory.path().join("packages")),
    )
    .await
    .unwrap();
    let manager = ConnectionManager::new();
    manager
        .replace_connection_with_tunnel_and_driver_id(
            "target".into(),
            Box::new(driver),
            None,
            Some("sqlite".into()),
        )
        .await
        .unwrap();
    let cancellation = TableImportCancellationState::default();
    let source = br#"[{"id":1,"payload":"one"},{"id":2,"payload":null}]"#;
    let path = directory.path().join("source.json");
    std::fs::write(&path, source).unwrap();
    let request = PrepareTableImportJob {
        project_id: "p".into(),
        import_id: "selector-0".into(),
        connection_id: "target".into(),
        driver: "sqlite".into(),
        schema: "main".into(),
        table: "target".into(),
        database: Some("different.sqlite".into()),
        file_path: path.to_str().unwrap().into(),
        format: TableImportFormat::Json,
        mode: TableImportMode::Append,
        first_row_header: Some(true),
        csv_options: None,
        expected_file_digest: format!("{:x}", Sha256::digest(source)),
    };
    let error = execute_preparation(&jobs, &manager, &cancellation, request.clone(), None)
        .await
        .unwrap_err();
    assert!(
        error.contains("selected SQLite database does not match"),
        "{error}"
    );
    assert!(jobs
        .list_file_import_preparations("p", None)
        .await
        .unwrap()
        .preparations
        .is_empty());
    for (index, selector) in [
        None,
        Some("main".to_owned()),
        Some(target.to_str().unwrap().to_owned()),
    ]
    .into_iter()
    .enumerate()
    {
        let mut request = request.clone();
        request.import_id = format!("selector-{index}");
        request.database = selector.clone();
        let preview = execute_preparation(&jobs, &manager, &cancellation, request, None)
            .await
            .unwrap();
        assert_eq!(preview.job.phase, LargeTransferPhase::AwaitingReview);
        assert_eq!(preview.job.source_rows, 2);
        assert_eq!(
            preview.job.target.database, selector,
            "selector stays bound in review"
        );
        jobs.cancel("p", &preview.job.id).await.unwrap();
    }
    let mut db = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(&target)
            .read_only(true),
    )
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM target")
            .fetch_one(&mut db)
            .await
            .unwrap(),
        0,
        "preparation and cancellation never publish"
    );
    db.close().await.unwrap();
    manager.disconnect_connection("target").await.unwrap();
}
