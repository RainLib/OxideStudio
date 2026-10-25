use super::{catalog, table, wire};
use crate::core::transfer_jobs::{models::*, store::JobStore};
use anyhow::{ensure, Context, Result};
use sqlx::{PgConnection, Row};

const FIELDS:&str="CASE WHEN octet_length(body)<=16384 THEN body END AS body,CASE WHEN octet_length(mac)=64 THEN mac END AS mac";

pub(in crate::core::transfer_jobs) async fn read_header(
    connection: &mut PgConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Option<Header>> {
    let Some(oid) =
        catalog::relation_oid(connection, &job.request.target.schema, &job.receipt_table).await?
    else {
        return Ok(None);
    };
    let row = sqlx::query(&format!(
        "SELECT {FIELDS} FROM {} WHERE seq=0",
        table(job, &job.receipt_table)
    ))
    .fetch_one(&mut *connection)
    .await?;
    let header: Header = store.decode(
        "pg-header",
        row.try_get::<Option<&str>, _>("body")?
            .context("invalid PostgreSQL receipt body")?,
        row.try_get::<Option<&str>, _>("mac")?
            .context("invalid PostgreSQL receipt signature")?,
    )?;
    ensure!(
        header.version == 2
            && header.job_id == job.summary.id
            && header.plan_digest == job.plan_digest
            && header.snapshot_digest == job.snapshot_digest
            && header.receipt_schema_digest == catalog::schema_digest(connection, oid).await?,
        "PostgreSQL receipt ownership changed"
    );
    if header.published {
        ensure!(
            header.rows == job.summary.source_rows,
            "published PostgreSQL receipt count is invalid"
        );
    }
    Ok(Some(header))
}
pub(super) async fn write_header(
    connection: &mut PgConnection,
    store: &JobStore,
    job: &StoredJob,
    header: &Header,
) -> Result<()> {
    let (body, mac) = store.encode("pg-header", header)?;
    sqlx::query(&format!("INSERT INTO {}(seq,body,mac) VALUES(0,$1,$2) ON CONFLICT(seq) DO UPDATE SET body=excluded.body,mac=excluded.mac",table(job,&job.receipt_table)))
        .bind(body).bind(mac).execute(connection).await?;
    Ok(())
}
pub(super) async fn write_batch(
    connection: &mut PgConnection,
    store: &JobStore,
    job: &StoredJob,
    receipt: &BatchReceipt,
) -> Result<()> {
    let (body, mac) = store.encode("pg-batch", receipt)?;
    sqlx::query(&format!(
        "INSERT INTO {}(seq,body,mac) VALUES($1,$2,$3)",
        table(job, &job.receipt_table)
    ))
    .bind(i64::try_from(receipt.sequence)?)
    .bind(body)
    .bind(mac)
    .execute(connection)
    .await?;
    Ok(())
}
pub(super) async fn validate_stage(
    connection: &mut PgConnection,
    job: &StoredJob,
    header: &Header,
) -> Result<()> {
    let oid = catalog::relation_oid(connection, &job.request.target.schema, &job.stage_table)
        .await?
        .context("PostgreSQL staging table is missing")?;
    ensure!(
        catalog::schema_digest(connection, oid).await? == header.stage_schema_digest,
        "PostgreSQL staging ownership changed"
    );
    Ok(())
}
pub(super) async fn validate_all(
    connection: &mut PgConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Option<BatchReceipt>> {
    let header = read_header(connection, store, job)
        .await?
        .context("PostgreSQL receipt is missing")?;
    ensure!(
        !header.published,
        "PostgreSQL migration is already published"
    );
    validate_stage(connection, job, &header).await?;
    let mut last: Option<BatchReceipt> = None;
    loop {
        let after = last.as_ref().map_or(0, |r| r.sequence);
        let rows = sqlx::query(&format!(
            "SELECT seq,{FIELDS} FROM {} WHERE seq>$1 ORDER BY seq LIMIT 32",
            table(job, &job.receipt_table)
        ))
        .bind(i64::try_from(after)?)
        .fetch_all(&mut *connection)
        .await?;
        if rows.is_empty() {
            break;
        }
        for row in rows {
            let receipt: BatchReceipt = store.decode(
                "pg-batch",
                row.try_get::<Option<&str>, _>("body")?
                    .context("invalid PostgreSQL batch receipt")?,
                row.try_get::<Option<&str>, _>("mac")?
                    .context("invalid PostgreSQL batch signature")?,
            )?;
            let before = last.as_ref().map_or(0, |r| r.rows_after);
            let sequence = last.as_ref().map_or(1, |r| r.sequence + 1);
            ensure!(
                receipt.job_id == job.summary.id
                    && receipt.plan_digest == job.plan_digest
                    && receipt.sequence == sequence
                    && row.try_get::<i64, _>("seq")? == i64::try_from(sequence)?
                    && receipt.rows_before == before
                    && receipt.rows_after > before
                    && receipt.rows_after <= job.summary.source_rows
                    && receipt.rows_after - before <= u64::from(job.request.batch_rows),
                "PostgreSQL batch receipt continuity changed"
            );
            ensure!(
                matches!(receipt.cursor.as_slice(),[Cell::Integer(v)] if *v==i64::try_from(receipt.rows_after)?),
                "PostgreSQL checkpoint cursor is invalid"
            );
            ensure!(
                wire::stage_digest(connection, job, before, receipt.rows_after).await?
                    == receipt.data_digest,
                "PostgreSQL staged data changed"
            );
            last = Some(receipt);
        }
    }
    let counts: (i64, i64, i64) = sqlx::query_as(&format!(
        "SELECT COUNT(*),COALESCE(MIN({0}),0),COALESCE(MAX({0}),0) FROM {1}",
        super::quote(&job.sequence_column),
        table(job, &job.stage_table)
    ))
    .fetch_one(connection)
    .await?;
    let expected = i64::try_from(last.as_ref().map_or(0, |r| r.rows_after))?;
    ensure!(
        counts == (expected, if expected == 0 { 0 } else { 1 }, expected),
        "PostgreSQL staging row sequence changed"
    );
    Ok(last)
}
