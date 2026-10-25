use super::*;
use oxide_studio_lib::core::transfer_jobs::{
    FileImportColumn, FileImportFormat, FileImportPlan, FileImportRequest, LargeTransferListQuery,
};
use sha2::{Digest, Sha256};

pub(super) async fn request(
    fixture: &Fixture,
    rows: u32,
    mode: LargeTransferMode,
) -> Result<(FileImportRequest, std::path::PathBuf)> {
    let path = fixture.root.path().join("normalized.sqlite");
    let mut source = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true),
    )
    .await?;
    sqlx::query("CREATE TABLE data(_ordinal INTEGER PRIMARY KEY,id BLOB,text_value BLOB)")
        .execute(&mut source)
        .await?;
    if rows > 0 {
        sqlx::query("WITH RECURSIVE n(id) AS (VALUES(1) UNION ALL SELECT id+1 FROM n WHERE id<?) INSERT INTO data(id,text_value) SELECT id,'行-'||id FROM n").bind(i64::from(rows)).execute(&mut source).await?;
    }
    source.close().await?;
    let request = FileImportRequest {
        project_id: "p".into(),
        target: fixture.request(mode).target,
        mode,
        batch_rows: 500,
        source: FileImportPlan {
            file_name: "orders.json".into(),
            presence_column: None,
            format: FileImportFormat::Json,
            source_digest: "a".repeat(64),
            normalized_digest: format!("{:x}", Sha256::digest(std::fs::read(&path)?)),
            columns: ["id", "text_value"]
                .into_iter()
                .map(|name| FileImportColumn {
                    source: name.into(),
                    target: name.into(),
                })
                .collect(),
            options: json!({"firstRowHeader": true,"csvOptions": null}),
        },
    };
    Ok((request, path))
}

#[tokio::test]
async fn reviewed_file_import_preserves_mapping_and_resumes_without_source_or_duplicates(
) -> Result<()> {
    let fixture = Fixture::new(0).await?;
    let (request, source) = request(&fixture, 10_001, LargeTransferMode::Append).await?;
    let preview = fixture.jobs.prepare_file_import(request, &source).await?;
    assert_eq!(preview.job.source.driver, "file");
    assert!(preview.confirmation_token.starts_with("IMPORT "));
    assert_eq!(
        preview.file_import.as_ref().unwrap().columns[1].target,
        "text_value"
    );
    let query = || LargeTransferListQuery {
        project_id: "p".into(),
        cursor: None,
    };
    assert!(fixture.jobs.list(query()).await?.jobs.is_empty());
    assert_eq!(fixture.jobs.list_file_imports(query()).await?.jobs.len(), 1);
    assert!(fixture
        .jobs
        .get("other-project", &preview.job.id)
        .await
        .is_err());
    assert!(fixture
        .jobs
        .start("p", &preview.job.id, "wrong token")
        .await
        .is_err());
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let job = fixture.jobs.get("p", &preview.job.id).await?;
        assert_ne!(
            job.phase,
            Phase::Completed,
            "must observe actual incomplete staging"
        );
        if job.rows_staged >= 500 {
            break;
        }
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    fixture.jobs.request_pause("p", &preview.job.id).await?;
    let paused = fixture.wait(&preview.job.id, Phase::Paused).await?;
    assert!(paused.rows_staged > 0 && paused.rows_staged < 10_001);
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        0
    );
    target.close().await?;
    std::fs::remove_file(source)?;
    let restarted = open_jobs(fixture.root.path(), fixture.meta.clone()).await?;
    let recovered = restarted.get_preview("p", &preview.job.id).await?;
    assert_eq!(recovered.file_import.unwrap().file_name, "orders.json");
    // The prior worker publishes its paused checkpoint before closing. Wait
    // for its OS lease rather than assuming that the phase releases the handle.
    loop {
        if restarted
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await
            .is_ok()
        {
            break;
        }
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let completed = fixture.wait(&preview.job.id, Phase::Completed).await?;
    assert_eq!(completed.rows_staged, 10_001);
    let mut target = fixture.target().await?;
    let counts: (i64, i64, i64) =
        sqlx::query_as("SELECT COUNT(*),COUNT(DISTINCT id),SUM(id) FROM items")
            .fetch_one(&mut target)
            .await?;
    assert_eq!(counts, (10_001, 10_001, 50_015_001));
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT text_value FROM items WHERE id=10001")
            .fetch_one(&mut target)
            .await?,
        "行-10001"
    );
    target.close().await?;
    assert!(!fixture
        .root
        .path()
        .join(format!(
            "profile/large-transfers/{}.snapshot.sqlite",
            preview.job.id
        ))
        .exists());
    Ok(())
}

#[tokio::test]
async fn file_import_overwrite_and_conflict_keep_atomic_publication() -> Result<()> {
    for mode in [LargeTransferMode::Append, LargeTransferMode::Overwrite] {
        let fixture = Fixture::new(0).await?;
        let mut target = fixture.target().await?;
        sqlx::query("INSERT INTO items(id,text_value) VALUES(1,'original')")
            .execute(&mut target)
            .await?;
        target.close().await?;
        let (request, source) = request(&fixture, 1001, mode).await?;
        let preview = fixture.jobs.prepare_file_import(request, &source).await?;
        std::fs::remove_file(source)?;
        fixture
            .jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?;
        fixture
            .wait(
                &preview.job.id,
                if mode == LargeTransferMode::Append {
                    Phase::Paused
                } else {
                    Phase::Completed
                },
            )
            .await?;
        let mut target = fixture.target().await?;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
                .fetch_one(&mut target)
                .await?,
            if mode == LargeTransferMode::Append {
                1
            } else {
                1001
            }
        );
        let text: String = sqlx::query_scalar("SELECT text_value FROM items WHERE id=1")
            .fetch_one(&mut target)
            .await?;
        assert_eq!(
            text,
            if mode == LargeTransferMode::Append {
                "original"
            } else {
                "行-1"
            }
        );
        target.close().await?;
        if mode == LargeTransferMode::Append {
            fixture.jobs.cancel("p", &preview.job.id).await?;
            fixture.wait(&preview.job.id, Phase::Cancelled).await?;
        }
    }
    Ok(())
}

#[tokio::test]
async fn file_import_rejects_unreviewed_snapshot_mappings_and_target_changes() -> Result<()> {
    let fixture = Fixture::new(0).await?;
    let (mut request, source) = request(&fixture, 2, LargeTransferMode::Append).await?;
    let original = request.source.normalized_digest.clone();
    request.source.normalized_digest = "b".repeat(64);
    assert!(fixture
        .jobs
        .prepare_file_import(request.clone(), &source)
        .await
        .is_err());
    request.source.normalized_digest = original;
    request.source.columns[0].target = "bytes".into();
    assert!(fixture
        .jobs
        .prepare_file_import(request.clone(), &source)
        .await
        .is_err());
    request.source.columns[0].target = "id".into();
    let preview = fixture.jobs.prepare_file_import(request, &source).await?;
    let mut saved = fixture
        .meta
        .get_connections("p")
        .await?
        .into_iter()
        .find(|c| c.id == "target")
        .unwrap();
    saved.config["name"] = json!("edited configuration");
    fixture.meta.save_connection(&saved).await?;
    assert!(fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await
        .is_err());
    let mut forbidden = fixture.request(LargeTransferMode::Append);
    forbidden.source.driver = "file".into();
    assert!(fixture.jobs.prepare(forbidden).await.is_err());
    Ok(())
}

#[tokio::test]
async fn file_import_mapping_is_authenticated_in_the_persistent_ledger() -> Result<()> {
    let fixture = Fixture::new(0).await?;
    let (request, source) = request(&fixture, 2, LargeTransferMode::Append).await?;
    let preview = fixture.jobs.prepare_file_import(request, &source).await?;
    let mut ledger = SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(
            fixture
                .root
                .path()
                .join("profile/large-transfers/jobs.sqlite"),
        ),
    )
    .await?;
    sqlx::query(
        "UPDATE jobs SET body=json_set(body,'$.file_import.columns[0].target','bytes') WHERE id=?",
    )
    .bind(&preview.job.id)
    .execute(&mut ledger)
    .await?;
    ledger.close().await?;
    assert!(fixture
        .jobs
        .get_preview("p", &preview.job.id)
        .await
        .is_err());
    Ok(())
}

async fn with_presence(
    fixture: &Fixture,
    rows: u32,
    mode: LargeTransferMode,
) -> Result<(FileImportRequest, std::path::PathBuf)> {
    let (mut request, path) = request(fixture, rows, mode).await?;
    let mut source =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&path)).await?;
    sqlx::query("ALTER TABLE data ADD COLUMN _presence BLOB")
        .execute(&mut source)
        .await?;
    sqlx::query("UPDATE data SET text_value=CASE WHEN id%3=0 THEN text_value ELSE NULL END,_presence=CASE WHEN id%3=1 THEN X'01' ELSE X'03' END").execute(&mut source).await?;
    source.close().await?;
    request.source.presence_column = Some("_presence".into());
    request.source.normalized_digest = format!("{:x}", Sha256::digest(std::fs::read(&path)?));
    Ok((request, path))
}

async fn defaults_target(fixture: &Fixture) -> Result<()> {
    let mut target = fixture.target().await?;
    sqlx::query(
        "CREATE TABLE defaults_target(id INTEGER PRIMARY KEY,text_value TEXT DEFAULT 'factory')",
    )
    .execute(&mut target)
    .await?;
    target.close().await?;
    Ok(())
}

#[tokio::test]
async fn presence_masks_survive_pause_reopen_and_input_removal_without_default_loss() -> Result<()>
{
    let fixture = Fixture::new(0).await?;
    defaults_target(&fixture).await?;
    let (mut request, source) = with_presence(&fixture, 10_001, LargeTransferMode::Append).await?;
    // Native SQLite target names remain ASCII-case-insensitive in the row publisher.
    request.source.columns[0].target = "ID".into();
    request.target.table = "defaults_target".into();
    let preview = fixture.jobs.prepare_file_import(request, &source).await?;
    assert_eq!(preview.mapped_columns.len(), 2);
    assert!(!preview
        .mapped_columns
        .iter()
        .any(|c| c.target == "_presence"));
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let job = fixture.jobs.get("p", &preview.job.id).await?;
        assert_ne!(job.phase, Phase::Completed);
        if job.rows_staged >= 500 {
            break;
        }
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    fixture.jobs.request_pause("p", &preview.job.id).await?;
    fixture.wait(&preview.job.id, Phase::Paused).await?;
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM defaults_target")
            .fetch_one(&mut target)
            .await?,
        0
    );
    target.close().await?;
    std::fs::remove_file(source)?;
    let reopened = open_jobs(fixture.root.path(), fixture.meta.clone()).await?;
    assert_eq!(
        reopened
            .get_preview("p", &preview.job.id)
            .await?
            .file_import
            .unwrap()
            .presence_column
            .as_deref(),
        Some("_presence")
    );
    loop {
        if reopened
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await
            .is_ok()
        {
            break;
        }
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    fixture.wait(&preview.job.id, Phase::Completed).await?;
    let mut target = fixture.target().await?;
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT COUNT(*),SUM(CASE WHEN id%3=1 THEN text_value='factory' WHEN id%3=2 THEN text_value IS NULL ELSE text_value='行-'||id END),COUNT(DISTINCT id) FROM defaults_target").fetch_one(&mut target).await?;
    assert_eq!(counts, (10_001, 10_001, 10_001));
    target.close().await?;
    Ok(())
}

#[tokio::test]
async fn changing_only_a_staged_presence_bitmap_breaks_its_authenticated_receipt() -> Result<()> {
    let fixture = Fixture::new(0).await?;
    defaults_target(&fixture).await?;
    let (mut request, source) = with_presence(&fixture, 10_001, LargeTransferMode::Append).await?;
    request.target.table = "defaults_target".into();
    let preview = fixture.jobs.prepare_file_import(request, &source).await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let job = fixture.jobs.get("p", &preview.job.id).await?;
        assert_ne!(job.phase, Phase::Completed);
        if job.rows_staged >= 500 {
            break;
        }
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    fixture.jobs.request_pause("p", &preview.job.id).await?;
    fixture.wait(&preview.job.id, Phase::Paused).await?;
    let mut target = fixture.target().await?;
    sqlx::query(&format!(
        "UPDATE \"_oxide_transfer_stage_{}\" SET _presence=X'03' WHERE id=1",
        preview.job.id.replace('-', "")
    ))
    .execute(&mut target)
    .await?;
    target.close().await?;
    loop {
        if fixture
            .jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await
            .is_ok()
        {
            break;
        }
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let job = fixture.wait(&preview.job.id, Phase::Paused).await?;
    assert!(job.issue.is_some());
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM defaults_target")
            .fetch_one(&mut target)
            .await?,
        0
    );
    target.close().await?;
    fixture.jobs.cancel("p", &preview.job.id).await?;
    Ok(())
}

#[tokio::test]
async fn invalid_authenticated_mask_shapes_and_hidden_values_roll_back_publication() -> Result<()> {
    for invalid in ["X'83'", "X'0300'", "'text'", "NULL", "X'00'"] {
        let fixture = Fixture::new(0).await?;
        let mut target = fixture.target().await?;
        sqlx::query("INSERT INTO items(id,text_value) VALUES(-1,'original')")
            .execute(&mut target)
            .await?;
        target.close().await?;
        let (mut request, source) =
            with_presence(&fixture, 2, LargeTransferMode::Overwrite).await?;
        let mut input =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&source)).await?;
        sqlx::query("UPDATE data SET text_value='supplied',_presence=X'03' WHERE id=1")
            .execute(&mut input)
            .await?;
        sqlx::query(&format!(
            "UPDATE data SET text_value='must not disappear',_presence={invalid} WHERE id=2"
        ))
        .execute(&mut input)
        .await?;
        input.close().await?;
        request.source.normalized_digest = format!("{:x}", Sha256::digest(std::fs::read(&source)?));
        let preview = fixture.jobs.prepare_file_import(request, &source).await?;
        fixture
            .jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?;
        fixture.wait(&preview.job.id, Phase::Paused).await?;
        let mut target = fixture.target().await?;
        let rows: Vec<(i64, String)> = sqlx::query_as("SELECT id,text_value FROM items")
            .fetch_all(&mut target)
            .await?;
        assert_eq!(rows, vec![(-1, "original".into())], "{invalid}");
        target.close().await?;
        fixture.jobs.cancel("p", &preview.job.id).await?;
    }
    Ok(())
}

#[test]
fn legacy_fixed_shape_file_plan_keeps_its_exact_pre_bitmap_encoding() -> Result<()> {
    let old = format!(
        r#"{{"fileName":"orders.json","format":"json","sourceDigest":"{}","normalizedDigest":"{}","columns":[{{"source":"id","target":"id"}}],"options":{{}}}}"#,
        "a".repeat(64),
        "b".repeat(64)
    );
    let restored: FileImportPlan = serde_json::from_str(&old)?;
    assert!(restored.presence_column.is_none());
    assert_eq!(serde_json::to_string(&restored)?, old);
    Ok(())
}
