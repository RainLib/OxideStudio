use super::{catalog, connect_config, relation, wire};
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
    let mut source = connect_config(config, &job.request.source, true).await?;
    let mut source_tx = source
        .begin_with("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .await?;
    sqlx::query(&format!(
        "LOCK TABLE {} IN ACCESS SHARE MODE",
        relation(&job.request.source.schema, &job.request.source.table)
    ))
    .execute(&mut *source_tx)
    .await?;
    let source_table = catalog::inspect(
        &mut source_tx,
        &job.request.source.schema,
        &job.request.source.table,
    )
    .await?;
    let mut target = super::connect_original_unprepared(store, job).await?;
    let target_table = catalog::inspect(
        &mut target,
        &job.request.target.schema,
        &job.request.target.table,
    )
    .await?;
    ensure!(
        source_table.server != target_table.server
            || source_table.database_oid != target_table.database_oid
            || source_table.oid != target_table.oid,
        "source and target refer to the same PostgreSQL relation"
    );
    let expressions = catalog::map_columns(job, &source_table, &target_table)?;
    job.request.source.database = Some(source_table.database_name.clone());
    job.request.target.database = Some(target_table.database_name.clone());
    job.summary.source.database = job.request.source.database.clone();
    job.summary.target.database = job.request.target.database.clone();
    let sequences = catalog::sequences(&mut target, job).await?;
    job.postgres
        .as_mut()
        .context("missing PostgreSQL plan")?
        .sequences = sequences;
    job.target_schema_digest = catalog::schema_digest(&mut target, target_table.oid).await?;
    store.encode("job", job)?;
    let snapshot = store.snapshot(&job.summary.id)?;
    ensure!(
        create_private_file(&snapshot, b"")?,
        "private migration snapshot already exists"
    );
    let mut spool = sqlite::connect(&snapshot, false).await?;
    sqlx::query("CREATE TABLE snapshot_rows(seq INTEGER PRIMARY KEY,wire BLOB NOT NULL)")
        .execute(&mut spool)
        .await?;
    restrict_sqlite_database_permissions(&snapshot);
    let mut spool_tx = spool.begin().await?;
    // Native output functions keep bpchar padding, array dimensions and exact
    // scalar values. SQL's guard bounds COPY frames before values reach SQLx.
    let aliases = (0..expressions.len())
        .map(|i| format!("\"_oxide_values\".\"v{i}\""))
        .collect::<Vec<_>>();
    let encoded = expressions
        .iter()
        .enumerate()
        .map(|(i, e)| format!("{e} AS \"v{i}\""))
        .collect::<Vec<_>>()
        .join(",");
    let size = aliases
        .iter()
        .map(|e| format!("COALESCE(pg_catalog.octet_length({e}),0)::bigint*2+4"))
        .collect::<Vec<_>>()
        .join("+");
    let budget = MAX_ROW_BYTES - 128;
    let fields = aliases
        .iter()
        .map(|e| format!("CASE WHEN \"_oxide_budget\".bytes<={budget} THEN {e} ELSE NULL END"))
        .collect::<Vec<_>>()
        .join(",");
    // Lateral optimization fences evaluate native output and the budget once
    // per row, while retaining a streaming plan and linear SQL/host memory.
    let sql=format!("COPY (SELECT {fields},CASE WHEN \"_oxide_budget\".bytes<={budget} THEN '0' ELSE '1' END FROM {} AS \"_oxide_source\" CROSS JOIN LATERAL (SELECT {encoded} OFFSET 0) AS \"_oxide_values\" CROSS JOIN LATERAL (SELECT ({size}) AS bytes OFFSET 0) AS \"_oxide_budget\") TO STDOUT WITH (FORMAT text,ENCODING 'UTF8')",relation(&job.request.source.schema,&job.request.source.table));
    super::session::native_path(&mut source_tx).await?;
    let mut stream = source_tx.copy_out_raw(&sql).await?;
    let mut lines = wire::Lines::default();
    let mut count = 0_i64;
    let mut batch_bytes = 0_u64;
    let mut pending = Vec::new();
    while let Some(chunk) = stream.try_next().await? {
        ensure!(!control.is_cancelled(), "PostgreSQL snapshot cancelled");
        for mut row in lines.push(&chunk)? {
            ensure!(
                row.ends_with(b"\t0\n"),
                "PostgreSQL source row exceeds the transfer budget"
            );
            row.truncate(row.len() - 3);
            row.push(b'\n');
            count = count
                .checked_add(1)
                .context("PostgreSQL snapshot row count overflow")?;
            if !pending.is_empty() && batch_bytes + row.len() as u64 + 32 > BATCH_BYTES {
                flush(&mut spool_tx, &pending).await?;
                pending.clear();
                spool_tx.commit().await?;
                spool_tx = spool.begin().await?;
                batch_bytes = 0;
            }
            batch_bytes += row.len() as u64 + 32;
            pending.push((count, row));
            if pending.len() >= 500 {
                flush(&mut spool_tx, &pending).await?;
                pending.clear();
                spool_tx.commit().await?;
                spool_tx = spool.begin().await?;
                batch_bytes = 0;
            }
        }
    }
    lines.finish()?;
    drop(stream);
    flush(&mut spool_tx, &pending).await?;
    spool_tx.commit().await?;
    source_tx.commit().await?;
    source.close().await?;
    sqlx::query("PRAGMA journal_mode=DELETE")
        .execute(&mut spool)
        .await?;
    spool.close().await?;
    let mut target_tx = target
        .begin_with("BEGIN ISOLATION LEVEL REPEATABLE READ")
        .await?;
    sqlx::query(&format!(
        "LOCK TABLE {} IN SHARE MODE",
        relation(&job.request.target.schema, &job.request.target.table)
    ))
    .execute(&mut *target_tx)
    .await?;
    catalog::validate_target(&mut target_tx, job).await?;
    let (rows, digest) = wire::data_digest(&mut target_tx, target_table.oid).await?;
    job.target_rows_before = rows;
    job.target_data_digest = digest;
    target_tx.commit().await?;
    target.close().await?;
    ensure!(!control.is_cancelled(), "PostgreSQL snapshot cancelled");
    let path = snapshot.clone();
    let copied_control = control.clone();
    job.snapshot_digest =
        tokio::task::spawn_blocking(move || files::digest_controlled(&path, &copied_control))
            .await??;
    job.summary.source_rows = count.try_into()?;
    job.summary.snapshot_bytes = std::fs::metadata(snapshot)?.len();
    Ok(())
}
async fn flush(connection: &mut sqlx::SqliteConnection, rows: &[(i64, Vec<u8>)]) -> Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let mut query = QueryBuilder::<Sqlite>::new("INSERT INTO snapshot_rows(seq,wire) ");
    query.push_values(rows, |mut row, (seq, wire)| {
        row.push_bind(*seq).push_bind(wire.as_slice());
    });
    query.build().persistent(false).execute(connection).await?;
    Ok(())
}
