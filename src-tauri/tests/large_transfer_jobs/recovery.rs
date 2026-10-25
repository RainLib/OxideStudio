use super::*;
use oxide_studio_lib::core::transfer_jobs::LargeTransferListQuery;

#[tokio::test]
async fn oversized_batch_receipt_is_rejected_before_deserializing_its_body() -> Result<()> {
    let fixture = Fixture::new(211).await?;
    let preview = fixture
        .jobs
        .prepare(fixture.request(LargeTransferMode::Append))
        .await?;
    let mut local = checkpoint_fixture(&fixture).await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    fixture.wait(&preview.job.id, Phase::Paused).await?;
    sqlx::query("DROP TRIGGER fail_checkpoint")
        .execute(&mut local)
        .await?;
    let table = receipt_table(&preview.job.id);
    let mut target = fixture.target().await?;
    sqlx::query(&format!(
        "UPDATE \"{table}\" SET body=CAST(zeroblob(8*1024*1024) AS TEXT) WHERE seq=1"
    ))
    .execute(&mut target)
    .await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    let paused = fixture.wait(&preview.job.id, Phase::Paused).await?;
    assert!(serde_json::to_vec(&paused)?.len() < 4096);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        0
    );
    fixture.jobs.cancel("p", &preview.job.id).await?;
    Ok(())
}

#[tokio::test]
async fn saved_history_paginates_beyond_one_hundred_jobs_with_project_isolation() -> Result<()> {
    let fixture = Fixture::new(1).await?;
    for _ in 0..103 {
        let preview = fixture
            .jobs
            .prepare(fixture.request(LargeTransferMode::Append))
            .await?;
        fixture.jobs.cancel("p", &preview.job.id).await?;
    }
    let page = fixture
        .jobs
        .list(LargeTransferListQuery {
            project_id: "p".into(),
            cursor: None,
        })
        .await?;
    assert_eq!(page.jobs.len(), 100);
    let other = fixture
        .jobs
        .list(LargeTransferListQuery {
            project_id: "other".into(),
            cursor: page.next_cursor.clone(),
        })
        .await?;
    assert!(other.jobs.is_empty());
    let second = fixture
        .jobs
        .list(LargeTransferListQuery {
            project_id: "p".into(),
            cursor: page.next_cursor,
        })
        .await?;
    assert_eq!(second.jobs.len(), 3);
    assert!(second.next_cursor.is_none());
    let unique = page
        .jobs
        .into_iter()
        .chain(second.jobs)
        .map(|j| j.id)
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(unique.len(), 103);
    Ok(())
}

#[tokio::test]
async fn reopening_storage_finishes_a_saved_cancel_intent_and_only_removes_owned_cache(
) -> Result<()> {
    let fixture = Fixture::new(203).await?;
    let preview = fixture
        .jobs
        .prepare(fixture.request(LargeTransferMode::Append))
        .await?;
    let mut local = checkpoint_fixture(&fixture).await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    fixture.wait(&preview.job.id, Phase::Paused).await?;
    sqlx::query("DROP TRIGGER fail_checkpoint")
        .execute(&mut local)
        .await?;
    // Emulate the persisted user intent at the exact point the previous Host
    // has exited; no job data or receipt authentication is bypassed.
    sqlx::query("UPDATE jobs SET action='cancel' WHERE id=?")
        .bind(&preview.job.id)
        .execute(&mut local)
        .await?;
    let root = fixture.root.path().join("profile/large-transfers");
    let partial = root.join(format!(
        ".{}.snapshot.sqlite.oxide-partial-{}",
        preview.job.id,
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&partial, b"interrupted owned backup")?;
    let neighbor = root.join("unrelated.sqlite");
    std::fs::write(&neighbor, b"keep")?;
    let successor = open_jobs(fixture.root.path(), fixture.meta.clone()).await?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if successor.get("p", &preview.job.id).await?.phase == Phase::Cancelled {
            break;
        }
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(!partial.exists());
    assert_eq!(std::fs::read(neighbor)?, b"keep");
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        0
    );
    Ok(())
}

async fn checkpoint_fixture(fixture: &Fixture) -> Result<SqliteConnection> {
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
    Ok(local)
}

#[tokio::test]
async fn reviewed_snapshot_survives_source_edits_and_source_file_removal() -> Result<()> {
    let fixture = Fixture::new(127).await?;
    let preview = fixture
        .jobs
        .prepare(fixture.request(LargeTransferMode::Append))
        .await?;
    let source_file = fixture.root.path().join("source.sqlite");
    let mut source =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&source_file)).await?;
    sqlx::query("UPDATE items SET text_value='changed after review'")
        .execute(&mut source)
        .await?;
    sqlx::query("INSERT INTO items VALUES(900,'new after review',1,x'01')")
        .execute(&mut source)
        .await?;
    source.close().await?;
    std::fs::rename(&source_file, fixture.root.path().join("offline.sqlite"))?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    fixture.wait(&preview.job.id, Phase::Completed).await?;
    let mut target = fixture.target().await?;
    let row = sqlx::query(
        "SELECT COUNT(*) n,MAX(id) last,MIN(text_value LIKE '文本-%') original FROM items",
    )
    .fetch_one(&mut target)
    .await?;
    assert_eq!(row.try_get::<i64, _>("n")?, 127);
    assert_eq!(row.try_get::<i64, _>("last")?, 127);
    assert_eq!(row.try_get::<i64, _>("original")?, 1);
    Ok(())
}

#[tokio::test]
async fn target_edits_with_unchanged_row_count_require_new_review() -> Result<()> {
    let fixture = Fixture::new(5).await?;
    let mut target = fixture.target().await?;
    sqlx::query("INSERT INTO items VALUES(-1,'existing',7,x'01')")
        .execute(&mut target)
        .await?;
    let preview = fixture
        .jobs
        .prepare(fixture.request(LargeTransferMode::Overwrite))
        .await?;
    sqlx::query("UPDATE items SET text_value='concurrent edit' WHERE id=-1")
        .execute(&mut target)
        .await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    fixture.wait(&preview.job.id, Phase::Paused).await?;
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT text_value FROM items")
            .fetch_one(&mut target)
            .await?,
        "concurrent edit"
    );
    fixture.jobs.cancel("p", &preview.job.id).await?;
    assert_eq!(
        fixture.jobs.get("p", &preview.job.id).await?.phase,
        Phase::Cancelled
    );
    Ok(())
}

#[tokio::test]
async fn preparation_cancel_races_are_durable_and_project_scoped() -> Result<()> {
    let fixture = Fixture::new(1000).await?;
    for _ in 0..8 {
        let job = fixture
            .jobs
            .begin_prepare(fixture.request(LargeTransferMode::Overwrite))
            .await?;
        assert!(fixture.jobs.cancel("other-project", &job.id).await.is_err());
        fixture.jobs.cancel("p", &job.id).await?;
        fixture.wait(&job.id, Phase::Cancelled).await?;
        assert!(!fixture
            .root
            .path()
            .join(format!(
                "profile/large-transfers/{}.snapshot.sqlite",
                job.id
            ))
            .exists());
    }
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        0
    );
    Ok(())
}

#[tokio::test]
async fn publication_failure_rolls_back_overwrite_and_keeps_existing_rows() -> Result<()> {
    let fixture = Fixture::new(5).await?;
    let mut target = fixture.target().await?;
    sqlx::query("INSERT INTO items VALUES(-1,'existing',7,x'01')")
        .execute(&mut target)
        .await?;
    sqlx::query("CREATE TRIGGER reject_import BEFORE INSERT ON items WHEN NEW.id=3 BEGIN SELECT RAISE(ABORT,'arbitrary sensitive fixture text'); END").execute(&mut target).await?;
    let preview = fixture
        .jobs
        .prepare(fixture.request(LargeTransferMode::Overwrite))
        .await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    let paused = fixture.wait(&preview.job.id, Phase::Paused).await?;
    assert_eq!(paused.rows_staged, 5);
    assert!(!serde_json::to_string(&paused)?.contains("sensitive"));
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT text_value FROM items")
            .fetch_one(&mut target)
            .await?,
        "existing"
    );
    fixture.jobs.cancel("p", &preview.job.id).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        1
    );
    Ok(())
}

#[tokio::test]
async fn corrupt_staging_is_rejected_before_publication_without_loading_large_values() -> Result<()>
{
    let fixture = Fixture::new(211).await?;
    let preview = fixture
        .jobs
        .prepare(fixture.request(LargeTransferMode::Append))
        .await?;
    let mut local = checkpoint_fixture(&fixture).await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    fixture.wait(&preview.job.id, Phase::Paused).await?;
    sqlx::query("DROP TRIGGER fail_checkpoint")
        .execute(&mut local)
        .await?;
    let stage = format!("_oxide_transfer_stage_{}", preview.job.id.replace('-', ""));
    let mut target = fixture.target().await?;
    sqlx::query(&format!(
        "UPDATE \"{stage}\" SET bytes=zeroblob(8*1024*1024) WHERE id=1"
    ))
    .execute(&mut target)
    .await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    fixture.wait(&preview.job.id, Phase::Paused).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        0
    );
    fixture.jobs.cancel("p", &preview.job.id).await?;
    Ok(())
}

#[tokio::test]
async fn completed_publication_recovers_after_checkpoint_failure_and_saved_target_change(
) -> Result<()> {
    let fixture = Fixture::new(219).await?;
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
    sqlx::query("CREATE TRIGGER fail_completed BEFORE UPDATE ON jobs WHEN json_extract(NEW.body,'$.summary.phase')='completed' BEGIN SELECT RAISE(FAIL,'fixture completed checkpoint failure'); END").execute(&mut local).await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let phase: String =
            sqlx::query_scalar("SELECT json_extract(body,'$.summary.phase') FROM jobs WHERE id=?")
                .bind(&preview.job.id)
                .fetch_one(&mut local)
                .await?;
        if phase == "paused" {
            break;
        }
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    sqlx::query("DROP TRIGGER fail_completed")
        .execute(&mut local)
        .await?;
    let mut changed = fixture
        .meta
        .get_connections("p")
        .await?
        .into_iter()
        .find(|c| c.id == "target")
        .unwrap();
    changed.config["url"] = json!(fixture.root.path().join("unavailable-other-target.sqlite"));
    fixture.meta.save_connection(&changed).await?;
    let successor = open_jobs(fixture.root.path(), fixture.meta.clone()).await?;
    let completed = successor.get("p", &preview.job.id).await?;
    assert_eq!(completed.phase, Phase::Completed);
    assert_eq!(completed.rows_staged, 219);
    assert_eq!(
        successor
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?
            .phase,
        Phase::Completed
    );
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        219
    );
    assert!(!fixture
        .root
        .path()
        .join("unavailable-other-target.sqlite")
        .exists());
    Ok(())
}

#[tokio::test]
async fn paused_copy_can_be_cancelled_without_publishing_partial_rows() -> Result<()> {
    let fixture = Fixture::new(10_001).await?;
    let mut request = fixture.request(LargeTransferMode::Overwrite);
    request.batch_rows = 1;
    let preview = fixture.jobs.prepare(request).await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    fixture.jobs.request_pause("p", &preview.job.id).await?;
    let paused = fixture.wait(&preview.job.id, Phase::Paused).await?;
    assert!(paused.rows_staged < 10_001);
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        0
    );
    fixture.jobs.cancel("p", &preview.job.id).await?;
    fixture.wait(&preview.job.id, Phase::Cancelled).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '_oxide_transfer_%'"
        )
        .fetch_one(&mut target)
        .await?,
        0
    );
    Ok(())
}
