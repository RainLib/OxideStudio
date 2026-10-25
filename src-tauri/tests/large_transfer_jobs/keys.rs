use super::*;

#[tokio::test]
async fn composite_collated_keys_keep_binary_null_defaults_and_generated_columns() -> Result<()> {
    let fixture = Fixture::new(0).await?;
    for name in ["source", "target"] {
        let mut db = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(fixture.root.path().join(format!("{name}.sqlite"))),
        )
        .await?;
        sqlx::query("DROP TABLE items").execute(&mut db).await?;
        sqlx::query("CREATE TABLE items(a INTEGER NOT NULL,b TEXT COLLATE NOCASE NOT NULL,payload BLOB,PRIMARY KEY(b DESC,a)) WITHOUT ROWID").execute(&mut db).await?;
        if name == "source" {
            sqlx::query(
                "INSERT INTO items VALUES(1,'B',x'0001'),(2,'b',NULL),(3,'A',x'ffff'),(4,'z',x'')",
            )
            .execute(&mut db)
            .await?;
        } else {
            sqlx::query("ALTER TABLE items ADD COLUMN extra TEXT NOT NULL DEFAULT 'default'")
                .execute(&mut db)
                .await?;
            sqlx::query("ALTER TABLE items ADD COLUMN derived TEXT AS (b||a)")
                .execute(&mut db)
                .await?;
            sqlx::query("INSERT INTO items(a,b,payload) VALUES(1,'b',x'9999'),(-1,'keep',x'1111')")
                .execute(&mut db)
                .await?;
        }
        db.close().await?;
    }
    let mut request = fixture.request(LargeTransferMode::Upsert);
    request.source.table = "ITEMS".into();
    request.batch_rows = 1;
    let preview = fixture.jobs.prepare(request).await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    fixture.wait(&preview.job.id, Phase::Completed).await?;
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        5
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT hex(payload)||extra||derived FROM items WHERE a=1")
            .fetch_one(&mut target)
            .await?,
        "0001defaultb1"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT payload IS NULL FROM items WHERE a=2")
            .fetch_one(&mut target)
            .await?,
        1
    );
    Ok(())
}

#[tokio::test]
async fn source_without_primary_key_uses_unshadowed_rowid_without_deduplication() -> Result<()> {
    let fixture = Fixture::new(0).await?;
    for name in ["source", "target"] {
        let mut db = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(fixture.root.path().join(format!("{name}.sqlite"))),
        )
        .await?;
        sqlx::query("DROP TABLE items").execute(&mut db).await?;
        sqlx::query("CREATE TABLE items(rowid TEXT,payload BLOB)")
            .execute(&mut db)
            .await?;
        if name == "source" {
            sqlx::query(
                "INSERT INTO items VALUES(NULL,x'00'),('same',x'01'),('same',x'01'),('z',NULL)",
            )
            .execute(&mut db)
            .await?;
        }
        db.close().await?;
    }
    let mut request = fixture.request(LargeTransferMode::Append);
    request.batch_rows = 1;
    let preview = fixture.jobs.prepare(request).await?;
    fixture
        .jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    fixture.wait(&preview.job.id, Phase::Completed).await?;
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        4
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items WHERE rowid='same'")
            .fetch_one(&mut target)
            .await?,
        2
    );
    Ok(())
}
