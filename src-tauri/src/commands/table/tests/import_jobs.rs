use super::super::{
    import_snapshot::{normalize_import_snapshot, ImportSnapshot},
    import_types::{TableCsvColumnMapping, TableCsvImportOptions, TableImportFormat},
};
use crate::{
    core::{
        driver::DatabaseDriver,
        driver_package::DatabaseDriverPackageRegistry,
        protocol::ColumnInfo,
        store::{MetaStore, Project, SavedConnection},
        transfer_jobs::{
            FileImportRequest, LargeTransferEndpoint, LargeTransferJobs, LargeTransferMode,
            LargeTransferPhase,
        },
    },
    drivers::sqlite::SqliteDriver,
};
use serde_json::json;
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

pub(super) struct Fixture {
    pub(super) directory: tempfile::TempDir,
    pub(super) columns: Vec<ColumnInfo>,
    pub(super) jobs: LargeTransferJobs,
}
impl Fixture {
    pub(super) async fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target.sqlite");
        let mut driver = SqliteDriver::new(target.to_str().unwrap());
        driver.connect().await.unwrap();
        driver.query("CREATE TABLE target(id INTEGER PRIMARY KEY,payload TEXT,optional TEXT DEFAULT 'factory')").await.unwrap();
        let columns = driver.get_columns("main", "target").await.unwrap();
        driver.disconnect().await.unwrap();
        let meta = MetaStore::open(&directory.path().join("profile"))
            .await
            .unwrap();
        meta.save_project(&Project {
            id: "p".into(),
            name: "fixture".into(),
            root_path: None,
            created_at: 1,
            updated_at: 1,
        })
        .await
        .unwrap();
        meta.save_connection(&SavedConnection{id:"target".into(),project_id:"p".into(),name:"target".into(),driver:"sqlite".into(),config:json!({"id":"target","projectId":"p","name":"target","driver":"sqlite","url":target}),created_at:1,updated_at:1}).await.unwrap();
        let jobs = LargeTransferJobs::open(
            &directory.path().join("jobs"),
            meta,
            DatabaseDriverPackageRegistry::new(directory.path().join("packages")),
        )
        .await
        .unwrap();
        Self {
            directory,
            columns,
            jobs,
        }
    }
    pub(super) async fn normalize(
        &self,
        path: PathBuf,
        format: TableImportFormat,
        options: Option<TableCsvImportOptions>,
    ) -> Result<ImportSnapshot, String> {
        let digest = super::super::import_preview::import_file_digest(&path).unwrap();
        let (_send, cancel) = tokio::sync::watch::channel(false);
        normalize_import_snapshot(
            path,
            digest.clone(),
            format,
            Some(true),
            options,
            self.columns.clone(),
            cancel,
            self.jobs
                .begin_file_import_preparation("p", "fixture", &digest)
                .await
                .map_err(|e| e.to_string())?,
        )
        .await
    }
    pub(super) async fn publish(&self, snapshot: ImportSnapshot) {
        let request = FileImportRequest {
            project_id: "p".into(),
            target: LargeTransferEndpoint {
                connection_id: "target".into(),
                driver: "sqlite".into(),
                schema: "main".into(),
                table: "target".into(),
                database: Some("main".into()),
            },
            mode: LargeTransferMode::Append,
            batch_rows: 500,
            source: snapshot.plan.clone(),
        };
        let preview = self
            .jobs
            .prepare_file_import(request, &snapshot.path)
            .await
            .unwrap();
        snapshot.directory.close().unwrap();
        self.jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let job = self.jobs.get("p", &preview.job.id).await.unwrap();
            if job.phase == LargeTransferPhase::Completed {
                break;
            }
            assert!(
                matches!(
                    job.phase,
                    LargeTransferPhase::Copying | LargeTransferPhase::Publishing
                ),
                "{:?} {:?}",
                job.phase,
                job.issue
            );
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
    pub(super) async fn target(&self) -> SqliteConnection {
        SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(self.directory.path().join("target.sqlite")),
        )
        .await
        .unwrap()
    }
}

#[tokio::test]
async fn json_snapshot_preserves_exact_values_nullable_omissions_and_unmapped_defaults() {
    let fixture = Fixture::new().await;
    let source = fixture.directory.path().join("data.json");
    std::fs::write(
        &source,
        r#"[{"id":9007199254740993,"payload":{"雪":[1,true]}},{"id":2}]"#,
    )
    .unwrap();
    let snapshot = fixture
        .normalize(source.clone(), TableImportFormat::Json, None)
        .await
        .unwrap();
    assert_eq!(snapshot.plan.columns.len(), 2);
    std::fs::remove_file(source).unwrap();
    fixture.publish(snapshot).await;
    let mut target = fixture.target().await;
    let rows: Vec<(i64, Option<String>, String)> =
        sqlx::query_as("SELECT id,payload,optional FROM target ORDER BY id")
            .fetch_all(&mut target)
            .await
            .unwrap();
    assert_eq!(
        rows,
        vec![
            (2, None, "factory".into()),
            (
                9007199254740993,
                Some(r#"{"雪":[1,true]}"#.into()),
                "factory".into()
            )
        ]
    );
    target.close().await.unwrap();
}

#[tokio::test]
async fn csv_snapshot_preserves_positional_mapping_range_and_text_options() {
    let fixture = Fixture::new().await;
    let source = fixture.directory.path().join("data.csv");
    std::fs::write(
        &source,
        "preamble\nexternal_id,label,ignored\n3,skip,x\n1, 雪 ,x\n2,,x\n4,skip,x\n",
    )
    .unwrap();
    let options = TableCsvImportOptions {
        title_row: Some(2),
        data_start_row: Some(4),
        last_data_row: Some(5),
        trim_values: Some(true),
        empty_fields_as_null: Some(true),
        column_mapping: vec![
            TableCsvColumnMapping {
                source_index: 0,
                target_column: Some("id".into()),
            },
            TableCsvColumnMapping {
                source_index: 1,
                target_column: Some("payload".into()),
            },
            TableCsvColumnMapping {
                source_index: 2,
                target_column: None,
            },
        ],
        ..Default::default()
    };
    let snapshot = fixture
        .normalize(source, TableImportFormat::Csv, Some(options))
        .await
        .unwrap();
    assert_eq!(snapshot.plan.columns[0].source, "external_id");
    assert_eq!(snapshot.plan.columns[0].target, "id");
    assert_eq!(snapshot.plan.options["csvOptions"]["titleRow"], 2);
    fixture.publish(snapshot).await;
    let mut target = fixture.target().await;
    let rows: Vec<(i64, Option<String>, String)> =
        sqlx::query_as("SELECT id,payload,optional FROM target ORDER BY id")
            .fetch_all(&mut target)
            .await
            .unwrap();
    assert_eq!(
        rows,
        vec![
            (1, Some("雪".into()), "factory".into()),
            (2, None, "factory".into())
        ]
    );
    target.close().await.unwrap();
}

#[tokio::test]
async fn xlsx_snapshot_uses_the_streaming_parser_and_survives_original_workbook_removal() {
    let fixture = Fixture::new().await;
    let sheet = r#"<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>id</t></is></c><c r="B1" t="inlineStr"><is><t>payload</t></is></c></row><row r="2"><c r="A2"><v>9007199254740993</v></c><c r="B2" t="s"><v>0</v></c></row></sheetData></worksheet>"#;
    let (source_directory, source) = super::import_xlsx_stream::package(
        sheet,
        Some("<sst><si><t>雪 café</t></si></sst>"),
        None,
        "worksheets/custom.xml",
    );
    let snapshot = fixture
        .normalize(source, TableImportFormat::Xlsx, None)
        .await
        .unwrap();
    source_directory.close().unwrap();
    fixture.publish(snapshot).await;
    let mut target = fixture.target().await;
    let row: (i64, String, String) = sqlx::query_as("SELECT id,payload,optional FROM target")
        .fetch_one(&mut target)
        .await
        .unwrap();
    assert_eq!(row, (9007199254740993, "雪 café".into(), "factory".into()));
    target.close().await.unwrap();
}

#[tokio::test]
async fn snapshot_rejects_bad_digest_corruption_and_unsigned_wrap() {
    let fixture = Fixture::new().await;
    for source in [r#"[{"id":18446744073709551615}]"#, r#"[{"id":1}] {"id":2}"#] {
        let path = fixture.directory.path().join("data.json");
        std::fs::write(&path, source).unwrap();
        assert!(
            fixture
                .normalize(path, TableImportFormat::Json, None)
                .await
                .is_err(),
            "{source}"
        );
    }
    let path = fixture.directory.path().join("data.json");
    std::fs::write(&path, r#"[{"id":1}]"#).unwrap();
    let (_send, cancel) = tokio::sync::watch::channel(false);
    assert!(normalize_import_snapshot(
        path,
        "a".repeat(64),
        TableImportFormat::Json,
        Some(true),
        None,
        fixture.columns.clone(),
        cancel,
        fixture
            .jobs
            .begin_file_import_preparation("p", "bad-digest", &"a".repeat(64))
            .await
            .unwrap(),
    )
    .await
    .is_err());
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

#[tokio::test]
async fn snapshot_csv_rejects_oversized_record_and_cancellation_before_copy() {
    let fixture = Fixture::new().await;
    let source = fixture.directory.path().join("data.csv");
    std::fs::write(
        &source,
        format!("id,payload\n1,{}\n", "x".repeat(1024 * 1024 + 16384)),
    )
    .unwrap();
    let error = fixture
        .normalize(source.clone(), TableImportFormat::Csv, None)
        .await
        .err()
        .unwrap();
    assert!(error.contains("budget"), "{error}");
    let (_send, cancel) = tokio::sync::watch::channel(true);
    assert!(normalize_import_snapshot(
        source,
        "a".repeat(64),
        TableImportFormat::Csv,
        Some(true),
        None,
        fixture.columns.clone(),
        cancel,
        fixture
            .jobs
            .begin_file_import_preparation("p", "cancelled", &"a".repeat(64))
            .await
            .unwrap(),
    )
    .await
    .err()
    .unwrap()
    .contains("TABLE_IMPORT_CANCELLED"));
}

#[tokio::test]
async fn json_presence_preserves_defaults_explicit_nulls_and_values() {
    let fixture = Fixture::new().await;
    let source = fixture.directory.path().join("defaults.json");
    std::fs::write(&source,r#"[{"id":1,"optional":"chosen"},{"id":2},{"id":3,"optional":null},{"id":4,"optional":"","payload":""}]"#).unwrap();
    let snapshot = fixture
        .normalize(source.clone(), TableImportFormat::Json, None)
        .await
        .unwrap();
    let mask = snapshot.plan.presence_column.as_ref().unwrap();
    let mut normalized =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&snapshot.path))
            .await
            .unwrap();
    let absent: (Option<String>, Vec<u8>) =
        sqlx::query_as(&format!("SELECT optional,\"{mask}\" FROM data WHERE id=2"))
            .fetch_one(&mut normalized)
            .await
            .unwrap();
    assert!(absent.0.is_none());
    let index = snapshot
        .plan
        .columns
        .iter()
        .position(|c| c.target == "optional")
        .unwrap();
    assert_eq!(absent.1[index / 8] & (1 << (index % 8)), 0);
    normalized.close().await.unwrap();
    std::fs::remove_file(source).unwrap();
    fixture.publish(snapshot).await;
    let mut target = fixture.target().await;
    let rows: Vec<(i64, Option<String>, Option<String>)> =
        sqlx::query_as("SELECT id,payload,optional FROM target ORDER BY id")
            .fetch_all(&mut target)
            .await
            .unwrap();
    assert_eq!(
        rows,
        vec![
            (1, None, Some("chosen".into())),
            (2, None, Some("factory".into())),
            (3, None, None),
            (4, Some("".into()), Some("".into()))
        ]
    );
    target.close().await.unwrap();
}

#[tokio::test]
async fn json_key_aliases_across_rows_preserve_canonical_presence_and_defaults() {
    let fixture = Fixture::new().await;
    let source = fixture.directory.path().join("aliases.json");
    std::fs::write(
        &source,
        r#"[{"ID":1,"OPTIONAL":"chosen"},{" id ":2},{"id":3,"optional":null}]"#,
    )
    .unwrap();
    let snapshot = fixture
        .normalize(source, TableImportFormat::Json, None)
        .await
        .unwrap();
    assert_eq!(snapshot.plan.columns.len(), 2);
    assert!(snapshot.plan.presence_column.is_some());
    fixture.publish(snapshot).await;
    let mut target = fixture.target().await;
    let rows: Vec<(i64, Option<String>)> =
        sqlx::query_as("SELECT id,optional FROM target ORDER BY id")
            .fetch_all(&mut target)
            .await
            .unwrap();
    assert_eq!(
        rows,
        vec![
            (1, Some("chosen".into())),
            (2, Some("factory".into())),
            (3, None)
        ]
    );
    target.close().await.unwrap();
    let source = fixture.directory.path().join("duplicated-aliases.json");
    std::fs::write(&source, r#"[{"id":4,"ID":5}]"#).unwrap();
    assert!(fixture
        .normalize(source, TableImportFormat::Json, None)
        .await
        .is_err());
}

async fn recreate_target(fixture: &mut Fixture, sql: &str) {
    let mut driver = SqliteDriver::new(
        fixture
            .directory
            .path()
            .join("target.sqlite")
            .to_str()
            .unwrap(),
    );
    driver.connect().await.unwrap();
    driver.query(sql).await.unwrap();
    fixture.columns = driver.get_columns("main", "target").await.unwrap();
    driver.disconnect().await.unwrap();
}

#[tokio::test]
async fn defaults_only_json_rows_evaluate_volatile_defaults_only_at_publication() {
    let mut fixture = Fixture::new().await;
    recreate_target(&mut fixture,"DROP TABLE target; CREATE TABLE target(payload TEXT DEFAULT 'factory',optional TEXT DEFAULT (hex(randomblob(16))));").await;
    let source = fixture.directory.path().join("defaults.json");
    std::fs::write(&source, "[{},{},{}]").unwrap();
    let snapshot = fixture
        .normalize(source.clone(), TableImportFormat::Json, None)
        .await
        .unwrap();
    assert!(snapshot.plan.columns.is_empty());
    assert!(snapshot.plan.presence_column.is_some());
    let mut normalized =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&snapshot.path))
            .await
            .unwrap();
    let names: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_xinfo('data')")
        .fetch_all(&mut normalized)
        .await
        .unwrap();
    assert_eq!(names.len(), 2);
    assert!(!names.iter().any(|n| n == "optional" || n == "payload"));
    normalized.close().await.unwrap();
    std::fs::remove_file(source).unwrap();
    fixture.publish(snapshot).await;
    let mut target = fixture.target().await;
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT COUNT(*),COUNT(DISTINCT optional),SUM(payload='factory' AND length(optional)=32) FROM target").fetch_one(&mut target).await.unwrap();
    assert_eq!(counts, (3, 3, 3));
    target.close().await.unwrap();
}

#[tokio::test]
async fn failed_default_publication_rolls_back_overwrite_and_prior_rows() {
    let mut fixture = Fixture::new().await;
    recreate_target(&mut fixture,"DROP TABLE target; CREATE TABLE target(id INTEGER PRIMARY KEY,payload TEXT,optional TEXT DEFAULT 'factory' CHECK(optional!='reject')); INSERT INTO target VALUES(-1,'original','original');").await;
    let source = fixture.directory.path().join("defaults.json");
    std::fs::write(&source, r#"[{"id":1},{"id":2,"optional":"reject"}]"#).unwrap();
    let snapshot = fixture
        .normalize(source, TableImportFormat::Json, None)
        .await
        .unwrap();
    let request = FileImportRequest {
        project_id: "p".into(),
        target: LargeTransferEndpoint {
            connection_id: "target".into(),
            driver: "sqlite".into(),
            schema: "main".into(),
            table: "target".into(),
            database: Some("main".into()),
        },
        mode: LargeTransferMode::Overwrite,
        batch_rows: 500,
        source: snapshot.plan.clone(),
    };
    let preview = fixture
        .jobs
        .prepare_file_import(request, &snapshot.path)
        .await
        .unwrap();
    snapshot.directory.close().unwrap();
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let job = fixture.jobs.get("p", &preview.job.id).await.unwrap();
        if job.phase == LargeTransferPhase::Paused {
            break;
        }
        assert!(matches!(
            job.phase,
            LargeTransferPhase::Copying | LargeTransferPhase::Publishing
        ));
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let mut target = fixture.target().await;
    let rows: Vec<(i64, String, String)> = sqlx::query_as("SELECT id,payload,optional FROM target")
        .fetch_all(&mut target)
        .await
        .unwrap();
    assert_eq!(rows, vec![(-1, "original".into(), "original".into())]);
    target.close().await.unwrap();
    fixture.jobs.cancel("p", &preview.job.id).await.unwrap();
}
