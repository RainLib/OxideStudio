use anyhow::{anyhow, Result};
use oxide_studio_lib::core::{
    driver_package::DatabaseDriverPackageRegistry,
    store::{MetaStore, Project, SavedConnection},
    transfer_jobs::{
        LargeTransferEndpoint, LargeTransferJobs, LargeTransferMode, LargeTransferPhase as Phase,
        LargeTransferRequest, LargeTransferSummary,
    },
};
use serde_json::json;
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection};
use std::{
    path::Path,
    time::{Duration, Instant},
};

#[path = "large_transfer_jobs/file_handoff.rs"]
mod file_handoff;
#[path = "large_transfer_jobs/file_import.rs"]
mod file_import;
#[path = "large_transfer_jobs/keys.rs"]
mod keys;
#[path = "large_transfer_jobs/mysql.rs"]
mod mysql;
#[path = "large_transfer_jobs/postgres.rs"]
mod postgres;
#[path = "large_transfer_jobs/process.rs"]
mod process;
#[path = "large_transfer_jobs/recovery.rs"]
mod recovery;

struct Fixture {
    root: tempfile::TempDir,
    meta: MetaStore,
    jobs: LargeTransferJobs,
}
impl Fixture {
    async fn new(rows: u32) -> Result<Self> {
        let root = tempfile::tempdir()?;
        for name in ["source", "target"] {
            let mut connection = SqliteConnection::connect_with(
                &SqliteConnectOptions::new()
                    .filename(root.path().join(format!("{name}.sqlite")))
                    .create_if_missing(true),
            )
            .await?;
            sqlx::query("CREATE TABLE items(id INTEGER PRIMARY KEY, text_value TEXT, large_integer INTEGER, bytes BLOB)").execute(&mut connection).await?;
            if name == "source" && rows > 0 {
                sqlx::query("WITH RECURSIVE n(id) AS (VALUES(1) UNION ALL SELECT id+1 FROM n WHERE id<?) INSERT INTO items SELECT id,'文本-'||id,9007199254740993+id,zeroblob(64) FROM n").bind(i64::from(rows)).execute(&mut connection).await?;
            }
            connection.close().await?;
        }
        let meta = MetaStore::open(&root.path().join("profile")).await?;
        meta.save_project(&Project {
            id: "p".into(),
            name: "fixture".into(),
            root_path: None,
            created_at: 1,
            updated_at: 1,
        })
        .await?;
        for name in ["source", "target"] {
            save_connection(&meta, root.path(), name).await?;
        }
        let jobs = open_jobs(root.path(), meta.clone()).await?;
        Ok(Self { root, meta, jobs })
    }
    fn request(&self, mode: LargeTransferMode) -> LargeTransferRequest {
        let endpoint = |name: &str| LargeTransferEndpoint {
            connection_id: name.into(),
            driver: "sqlite".into(),
            schema: "main".into(),
            table: "items".into(),
            database: Some("main".into()),
        };
        LargeTransferRequest {
            project_id: "p".into(),
            source: endpoint("source"),
            target: endpoint("target"),
            mode,
            batch_rows: 100,
        }
    }
    async fn target(&self) -> Result<SqliteConnection> {
        Ok(SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(self.root.path().join("target.sqlite")),
        )
        .await?)
    }
    async fn wait(&self, id: &str, phase: Phase) -> Result<LargeTransferSummary> {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let summary = self.jobs.get("p", id).await?;
            if summary.phase == phase {
                return Ok(summary);
            }
            if summary.phase == Phase::Failed
                || summary.phase == Phase::Cancelled
                || Instant::now() > deadline
            {
                return Err(anyhow!(
                    "unexpected migration state: {:?} ({:?}), {} rows",
                    summary.phase,
                    summary.issue,
                    summary.rows_staged
                ));
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}
async fn save_connection(meta: &MetaStore, root: &Path, name: &str) -> Result<()> {
    meta.save_connection(&SavedConnection{id:name.into(),project_id:"p".into(),name:name.into(),driver:"sqlite".into(),created_at:1,updated_at:1,config:json!({"id":name,"projectId":"p","name":name,"driver":"sqlite","url":root.join(format!("{name}.sqlite"))})}).await?;
    Ok(())
}
async fn open_jobs(root: &Path, meta: MetaStore) -> Result<LargeTransferJobs> {
    LargeTransferJobs::open(
        &root.join("profile/large-transfers"),
        meta,
        DatabaseDriverPackageRegistry::new(root.join("packages")),
    )
    .await
}
fn receipt_table(id: &str) -> String {
    format!("_oxide_transfer_receipt_{}", id.replace('-', ""))
}

#[tokio::test]
async fn large_snapshot_copies_all_rows_with_native_types_and_rejects_wrong_review() -> Result<()> {
    let fixture = Fixture::new(12_001).await?;
    let preview = fixture
        .jobs
        .prepare(fixture.request(LargeTransferMode::Append))
        .await?;
    assert_eq!(preview.job.source_rows, 12_001);
    assert!(fixture
        .jobs
        .start("p", &preview.job.id, "wrong token")
        .await
        .is_err());
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        0
    );
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    let result = fixture.wait(&preview.job.id, Phase::Completed).await?;
    assert_eq!(result.rows_staged, 12_001);
    let row = sqlx::query(
        "SELECT COUNT(*) n,MIN(large_integer) large,SUM(length(bytes)) bytes FROM items",
    )
    .fetch_one(&mut target)
    .await?;
    assert_eq!(row.try_get::<i64, _>("n")?, 12_001);
    assert_eq!(row.try_get::<i64, _>("large")?, 9_007_199_254_740_994);
    assert_eq!(row.try_get::<i64, _>("bytes")?, 12_001 * 64);
    assert!(!fixture
        .root
        .path()
        .join(format!(
            "profile/large-transfers/{}.snapshot.sqlite",
            preview.job.id
        ))
        .exists());
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        12_001
    );
    Ok(())
}

#[tokio::test]
async fn target_commit_survives_a_failed_host_checkpoint_without_duplicate_rows() -> Result<()> {
    let fixture = Fixture::new(1103).await?;
    let preview = fixture
        .jobs
        .prepare(fixture.request(LargeTransferMode::Append))
        .await?;
    let mut local = SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(
            fixture
                .root
                .path()
                .join("profile/large-transfers/jobs.sqlite"),
        ),
    )
    .await?;
    sqlx::query("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON jobs WHEN json_extract(NEW.body,'$.summary.rowsStaged')>0 BEGIN SELECT RAISE(FAIL,'fixture checkpoint failure'); END").execute(&mut local).await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    fixture.wait(&preview.job.id, Phase::Paused).await?;
    let mut target = fixture.target().await?;
    let table = receipt_table(&preview.job.id);
    let committed: String =
        sqlx::query_scalar(&format!("SELECT body FROM \"{table}\" WHERE seq=1"))
            .fetch_one(&mut target)
            .await?;
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&committed)?["rows_after"],
        100
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        0
    );
    assert_eq!(fixture.jobs.get("p", &preview.job.id).await?.rows_staged, 0);
    sqlx::query("DROP TRIGGER fail_checkpoint")
        .execute(&mut local)
        .await?;
    let successor = open_jobs(fixture.root.path(), fixture.meta.clone()).await?;
    successor
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    fixture.wait(&preview.job.id, Phase::Completed).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        1103
    );
    Ok(())
}

#[tokio::test]
async fn changed_target_is_rejected_and_cancellation_preserves_existing_rows() -> Result<()> {
    let fixture = Fixture::new(300).await?;
    let mut target = fixture.target().await?;
    sqlx::query("INSERT INTO items VALUES(-1,'existing',7,x'0102')")
        .execute(&mut target)
        .await?;
    let preview = fixture
        .jobs
        .prepare(fixture.request(LargeTransferMode::Overwrite))
        .await?;
    let new_file = fixture.root.path().join("other.sqlite");
    let mut other = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(&new_file)
            .create_if_missing(true),
    )
    .await?;
    sqlx::query("CREATE TABLE items(id INTEGER PRIMARY KEY)")
        .execute(&mut other)
        .await?;
    let changed = SavedConnection {
        id: "target".into(),
        project_id: "p".into(),
        name: "changed".into(),
        driver: "sqlite".into(),
        created_at: 1,
        updated_at: 2,
        config: json!({"id":"target","projectId":"p","name":"changed","driver":"sqlite","url":new_file}),
    };
    fixture.meta.save_connection(&changed).await?;
    assert!(fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await
        .is_err());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        1
    );
    fixture.jobs.cancel("p", &preview.job.id).await?;
    assert_eq!(
        fixture.jobs.get("p", &preview.job.id).await?.phase,
        Phase::Cancelled
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut other)
            .await?,
        0
    );
    Ok(())
}
