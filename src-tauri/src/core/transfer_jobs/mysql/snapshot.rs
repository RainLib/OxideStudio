use super::{catalog, projection, publication, session, wire};
use crate::core::{
    driver::LocalDatabaseBackupControl,
    private_file::{create_private_file, restrict_sqlite_database_permissions},
    transfer_jobs::{files, models::*, sqlite, store::JobStore},
};
use anyhow::{ensure, Context, Result};
use futures::TryStreamExt;
use serde_json::Value;
use sqlx::{Connection, QueryBuilder, Sqlite};

pub(in crate::core::transfer_jobs) async fn prepare_snapshot(
    store: &JobStore,
    job: &mut StoredJob,
    config: &Value,
    control: &LocalDatabaseBackupControl,
) -> Result<()> {
    let mut source = super::connect_config(config, &job.request.source, true).await?;
    let source_budget = super::packet_budget(&mut source).await?;
    let mut source_tx = source.begin_with("START TRANSACTION READ ONLY").await?;
    // This first table read holds its metadata lock throughout capture.
    let source_table = catalog::inspect(
        &mut source_tx,
        &job.request.source.schema,
        &job.request.source.table,
    )
    .await?;
    sqlx::query(&format!(
        "SELECT 1 FROM {} LIMIT 0",
        super::relation(&source_table.schema, &source_table.name)
    ))
    .execute(&mut *source_tx)
    .await?;
    let source_table =
        catalog::inspect(&mut source_tx, &source_table.schema, &source_table.name).await?;
    let mut target = super::connect_original(store, job, false).await?;
    let target_table = catalog::inspect(
        &mut target,
        &job.request.target.schema,
        &job.request.target.table,
    )
    .await?;
    ensure!(
        source_table.uuid != target_table.uuid
            || source_table.schema != target_table.schema
            || source_table.name != target_table.name,
        "source and target refer to the same MySQL relation"
    );
    let indices = catalog::map_columns(job, &source_table, &target_table)?;
    job.request.source.schema = source_table.schema.clone();
    job.request.source.table = source_table.name.clone();
    job.request.source.database = Some(source_table.schema.clone());
    job.request.target.schema = target_table.schema.clone();
    job.request.target.table = target_table.name.clone();
    job.request.target.database = Some(target_table.schema.clone());
    job.summary.source = job.request.source.clone();
    job.summary.target = job.request.target.clone();
    let (mode, zone) = session::native_settings(&mut target).await?;
    let plan = job.mysql.as_mut().context("missing MySQL plan")?;
    plan.native_mode = mode;
    plan.native_time_zone = zone;
    job.target_schema_digest = catalog::schema_digest(&mut target, &target_table).await?;
    publication::create_typed(&mut target, job).await?;
    let budget = source_budget
        .min(super::packet_budget(&mut target).await?)
        .min(MAX_ROW_BYTES as usize);
    ensure!(
        budget >= 16 * 1024,
        "MySQL connection packet budget is insufficient"
    );
    store.encode("job", job)?;
    let path = store.snapshot(&job.summary.id)?;
    ensure!(
        create_private_file(&path, b"")?,
        "MySQL private snapshot already exists"
    );
    let mut spool = sqlite::connect(&path, false).await?;
    sqlx::query("CREATE TABLE snapshot_rows(seq INTEGER PRIMARY KEY,wire BLOB NOT NULL)")
        .execute(&mut spool)
        .await?;
    restrict_sqlite_database_permissions(&path);
    let query = projection::source_query(&source_table, &indices, budget);
    let codecs = job
        .mysql()?
        .columns
        .iter()
        .map(|column| column.source_codec)
        .collect::<Vec<_>>();
    let mut stream = sqlx::query(&query).fetch(&mut *source_tx);
    let mut count = 0_i64;
    let mut pending = Vec::new();
    let mut bytes = 0;
    let mut tx = spool.begin().await?;
    while let Some(row) = stream.try_next().await? {
        ensure!(!control.is_cancelled(), "MySQL snapshot cancelled");
        let cells = projection::source_cells(&row, &codecs)?;
        let wire = wire::encode(&cells, budget)?;
        if !pending.is_empty()
            && (pending.len() >= 500 || bytes + wire.len() + 32 > BATCH_BYTES as usize)
        {
            flush(&mut tx, &pending).await?;
            pending.clear();
            tx.commit().await?;
            tx = spool.begin().await?;
            bytes = 0;
        }
        count = count
            .checked_add(1)
            .context("MySQL snapshot count overflow")?;
        bytes += wire.len() + 32;
        pending.push((count, wire));
    }
    drop(stream);
    flush(&mut tx, &pending).await?;
    tx.commit().await?;
    source_tx.commit().await?;
    source.close().await?;
    sqlx::query("PRAGMA journal_mode=DELETE")
        .execute(&mut spool)
        .await?;
    spool.close().await?;
    let mut target_tx = target
        .begin_with("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY")
        .await?;
    catalog::validate_target(&mut target_tx, job).await?;
    let (rows, digest) = projection::data_digest(&mut target_tx, &target_table, false).await?;
    job.target_rows_before = rows;
    job.target_data_digest = digest;
    target_tx.commit().await?;
    target.close().await?;
    ensure!(!control.is_cancelled(), "MySQL snapshot cancelled");
    let copied = path.clone();
    let control = control.clone();
    job.snapshot_digest =
        tokio::task::spawn_blocking(move || files::digest_controlled(&copied, &control)).await??;
    job.summary.source_rows = count.try_into()?;
    job.summary.snapshot_bytes = std::fs::metadata(path)?.len();
    Ok(())
}
async fn flush(c: &mut sqlx::SqliteConnection, rows: &[(i64, Vec<u8>)]) -> Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let mut query = QueryBuilder::<Sqlite>::new("INSERT INTO snapshot_rows(seq,wire) ");
    query.push_values(rows, |mut row, (seq, wire)| {
        row.push_bind(*seq).push_bind(wire.as_slice());
    });
    query.build().persistent(false).execute(c).await?;
    Ok(())
}
