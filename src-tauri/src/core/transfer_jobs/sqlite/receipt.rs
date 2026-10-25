use super::quote;
use crate::core::transfer_jobs::{
    models::{BatchReceipt, Header, StoredJob, MAX_ROW_BYTES},
    store::JobStore,
};
use anyhow::{bail, Result};
use futures::TryStreamExt;
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqliteRow, Row, SqliteConnection, TypeInfo, ValueRef};

const RECORD_FIELDS: &str = "CASE WHEN octet_length(body)<=524288 THEN body END,CASE WHEN octet_length(mac)=64 THEN mac END";

fn decode_record<T: DeserializeOwned + Serialize>(
    store: &JobStore,
    purpose: &str,
    record: (Option<String>, Option<String>),
) -> Result<T> {
    let (Some(body), Some(mac)) = record else {
        bail!("migration receipt exceeds its record budget");
    };
    store.decode(purpose, &body, &mac)
}

fn hash_row(digest: &mut Sha256, row: &SqliteRow) -> Result<()> {
    // Frame the row and each value to distinguish NULL, empty values and types.
    digest.update((row.len() as u64).to_le_bytes());
    for i in 0..row.len() {
        let raw = row.try_get_raw(i)?;
        if raw.is_null() {
            digest.update([0]);
            continue;
        }
        match raw.type_info().name().to_ascii_uppercase().as_str() {
            "INTEGER" | "BOOLEAN" => {
                digest.update([1]);
                digest.update(row.try_get_unchecked::<i64, _>(i)?.to_le_bytes());
            }
            "REAL" | "FLOAT" | "DOUBLE" => {
                digest.update([2]);
                digest.update(row.try_get_unchecked::<f64, _>(i)?.to_bits().to_le_bytes());
            }
            "BLOB" => {
                let value = row.try_get_unchecked::<&[u8], _>(i)?;
                digest.update([3]);
                digest.update((value.len() as u64).to_le_bytes());
                digest.update(value);
            }
            _ => {
                let value = row.try_get_unchecked::<&str, _>(i)?;
                digest.update([4]);
                digest.update((value.len() as u64).to_le_bytes());
                digest.update(value.as_bytes());
            }
        }
    }
    Ok(())
}

/// Caller holds a read/write transaction, so the size check and streamed hash
/// observe one snapshot. NOT INDEXED scans the table's stable storage order.
pub(super) async fn table_digest(
    connection: &mut SqliteConnection,
    table: &str,
    columns: &[String],
) -> Result<String> {
    let size = columns
        .iter()
        .map(|c| format!("COALESCE(octet_length({}),0)+32", quote(c)))
        .collect::<Vec<_>>()
        .join("+");
    let too_large = sqlx::query(&format!(
        "SELECT 1 FROM {} NOT INDEXED WHERE ({size})>{MAX_ROW_BYTES} LIMIT 1",
        quote(table)
    ))
    .fetch_optional(&mut *connection)
    .await?
    .is_some();
    if too_large {
        bail!("target row exceeds the large-transfer row byte budget");
    }
    let fields = columns
        .iter()
        .map(|c| quote(c))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT {fields} FROM {} NOT INDEXED", quote(table));
    let mut rows = sqlx::query(&sql).fetch(connection);
    let mut digest = Sha256::new();
    while let Some(row) = rows.try_next().await? {
        hash_row(&mut digest, &row)?;
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub(in crate::core::transfer_jobs) async fn read_header(
    connection: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Option<Header>> {
    let exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?")
            .bind(&job.receipt_table)
            .fetch_one(&mut *connection)
            .await?;
    if exists == 0 {
        return Ok(None);
    }
    let actual_schema = super::catalog::schema_digest(connection, &job.receipt_table).await?;
    let record = sqlx::query_as(&format!(
        "SELECT {RECORD_FIELDS} FROM {} WHERE seq=0",
        quote(&job.receipt_table)
    ))
    .fetch_one(&mut *connection)
    .await?;
    let header: Header = decode_record(store, "header", record)?;
    if header.version != 1
        || header.job_id != job.summary.id
        || header.plan_digest != job.plan_digest
        || header.snapshot_digest != job.snapshot_digest
    {
        bail!("target migration receipt belongs to another review or snapshot");
    }
    if actual_schema != header.receipt_schema_digest {
        bail!("migration receipt schema changed");
    }
    Ok(Some(header))
}

pub(super) async fn write_header(
    connection: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
    header: &Header,
) -> Result<()> {
    let (body, mac) = store.encode("header", header)?;
    sqlx::query(&format!("INSERT INTO {}(seq,body,mac) VALUES(0,?,?) ON CONFLICT(seq) DO UPDATE SET body=excluded.body,mac=excluded.mac",quote(&job.receipt_table))).bind(body).bind(mac).execute(connection).await?;
    Ok(())
}

pub(super) async fn latest(
    connection: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Option<BatchReceipt>> {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(&format!(
        "SELECT {RECORD_FIELDS} FROM {} WHERE seq>0 ORDER BY seq DESC LIMIT 1",
        quote(&job.receipt_table)
    ))
    .fetch_optional(connection)
    .await?;
    row.map(|record| decode_record(store, "batch", record))
        .transpose()
}

pub(super) async fn write_batch(
    connection: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
    receipt: &BatchReceipt,
) -> Result<()> {
    let (body, mac) = store.encode("batch", receipt)?;
    sqlx::query(&format!(
        "INSERT INTO {}(seq,body,mac) VALUES(?,?,?)",
        quote(&job.receipt_table)
    ))
    .bind(receipt.sequence as i64)
    .bind(body)
    .bind(mac)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn data_digest(
    connection: &mut SqliteConnection,
    job: &StoredJob,
    before: u64,
    after: u64,
) -> Result<String> {
    let row_bytes = job
        .columns
        .iter()
        .map(|c| format!("COALESCE(octet_length({}),0)+32", quote(&c.target)))
        .collect::<Vec<_>>()
        .join("+");
    if sqlx::query(&format!(
        "SELECT 1 FROM {} WHERE {}>? AND {}<=? AND ({row_bytes})>{MAX_ROW_BYTES} LIMIT 1",
        quote(&job.stage_table),
        quote(&job.sequence_column),
        quote(&job.sequence_column)
    ))
    .bind(before as i64)
    .bind(after as i64)
    .fetch_optional(&mut *connection)
    .await?
    .is_some()
    {
        bail!("staged row exceeds the large-transfer row byte budget");
    }
    let fields = std::iter::once(quote(&job.sequence_column))
        .chain(job.columns.iter().map(|c| quote(&c.target)))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT {fields} FROM {} WHERE {}>? AND {}<=? ORDER BY {}",
        quote(&job.stage_table),
        quote(&job.sequence_column),
        quote(&job.sequence_column),
        quote(&job.sequence_column)
    );
    let mut rows = sqlx::query(&sql)
        .bind(before as i64)
        .bind(after as i64)
        .fetch(connection);
    let mut digest = Sha256::new();
    let mut count = 0;
    while let Some(row) = rows.try_next().await? {
        count += 1;
        hash_row(&mut digest, &row)?;
    }
    if count != after - before {
        bail!("staged migration row range changed");
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub(super) async fn validate_all(
    connection: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Option<BatchReceipt>> {
    let last = latest(connection, store, job).await?;
    let Some(last) = last else {
        if super::catalog::count(connection, &job.stage_table).await? != 0 {
            bail!("staging data has no committed receipt");
        }
        return Ok(None);
    };
    let mut before = 0;
    for sequence in 1..=last.sequence {
        let record = sqlx::query_as(&format!(
            "SELECT {RECORD_FIELDS} FROM {} WHERE seq=?",
            quote(&job.receipt_table)
        ))
        .bind(sequence as i64)
        .fetch_one(&mut *connection)
        .await?;
        let batch: BatchReceipt = decode_record(store, "batch", record)?;
        if batch.job_id != job.summary.id
            || batch.plan_digest != job.plan_digest
            || batch.sequence != sequence
            || batch.rows_before != before
            || batch.rows_after <= before
            || batch.rows_after > job.summary.source_rows
            || batch.cursor.len() != job.keys.len()
        {
            bail!("migration batch receipt chain is invalid");
        }
        if data_digest(connection, job, before, batch.rows_after).await? != batch.data_digest {
            bail!("staged migration data changed; publication is blocked");
        }
        before = batch.rows_after;
    }
    if super::catalog::count(connection, &job.stage_table).await? != before {
        bail!("staged migration row count changed");
    }
    Ok(Some(last))
}
