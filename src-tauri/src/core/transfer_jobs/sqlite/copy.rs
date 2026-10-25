use super::{
    catalog::{
        affinity, count, key_expression, schema_digest, validate_target, validate_target_data,
    },
    quote, receipt,
};
use crate::core::transfer_jobs::{
    models::{
        BatchReceipt, Cell, Header, LargeTransferMode, StoredJob, BATCH_BYTES, MAX_KEY_BYTES,
        MAX_ROW_BYTES,
    },
    store::JobStore,
};
use anyhow::{bail, Context, Result};
use sqlx::{
    sqlite::{SqliteArguments, SqliteRow},
    Arguments, Connection, Row, SqliteConnection, TypeInfo, ValueRef,
};
use std::path::Path;

pub(in crate::core::transfer_jobs) async fn initialize(
    connection: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
    snapshot: &Path,
) -> Result<Header> {
    validate_target(connection, job).await?;
    attach(connection, snapshot).await?;
    if let Some(header) = receipt::read_header(connection, store, job).await? {
        if !header.published
            && schema_digest(connection, &job.stage_table).await? != header.stage_schema_digest
        {
            bail!("migration staging schema changed");
        }
        return Ok(header);
    }
    if job.summary.rows_staged != 0 || job.summary.batches != 0 {
        bail!("committed migration receipt is missing; reinitialization is blocked");
    }
    let mut tx = connection.begin_with("BEGIN IMMEDIATE").await?;
    validate_target(&mut tx, job).await?;
    validate_target_data(&mut tx, job).await?;
    let fields = std::iter::once(format!(
        "{} INTEGER PRIMARY KEY",
        quote(&job.sequence_column)
    ))
    .chain(
        job.columns
            .iter()
            .map(|c| format!("{} {}", quote(&c.target), affinity(&c.target_type))),
    )
    .collect::<Vec<_>>()
    .join(",");
    sqlx::query(&format!(
        "CREATE TABLE {} ({fields})",
        quote(&job.stage_table)
    ))
    .execute(&mut *tx)
    .await?;
    sqlx::query(&format!(
        "CREATE TABLE {}(seq INTEGER PRIMARY KEY,body TEXT NOT NULL,mac TEXT NOT NULL)",
        quote(&job.receipt_table)
    ))
    .execute(&mut *tx)
    .await?;
    let header = Header {
        version: 1,
        job_id: job.summary.id.clone(),
        plan_digest: job.plan_digest.clone(),
        snapshot_digest: job.snapshot_digest.clone(),
        stage_schema_digest: schema_digest(&mut tx, &job.stage_table).await?,
        receipt_schema_digest: schema_digest(&mut tx, &job.receipt_table).await?,
        published: false,
        rows: 0,
        batches: 0,
    };
    receipt::write_header(&mut tx, store, job, &header).await?;
    tx.commit().await?;
    Ok(header)
}

pub(in crate::core::transfer_jobs) async fn reconcile(
    connection: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Option<BatchReceipt>> {
    let mut tx = connection.begin().await?;
    let last = receipt::validate_all(&mut tx, store, job).await?;
    tx.commit().await?;
    Ok(last)
}

fn add_cells<'q>(arguments: &mut SqliteArguments<'q>, cells: &[Cell]) -> Result<()> {
    for cell in cells {
        match cell {
            Cell::Integer(v) => arguments.add(*v),
            Cell::Real(v) => arguments.add(*v),
            Cell::Text(v) => arguments.add(v.clone()),
            Cell::Blob(v) => arguments.add(v.clone()),
        }
        .map_err(|_| anyhow::anyhow!("invalid migration key binding"))?;
    }
    Ok(())
}
fn cell(row: &SqliteRow, index: usize) -> Result<Cell> {
    let raw = row.try_get_raw(index)?;
    if raw.is_null() {
        bail!("source key is NULL or exceeds the key byte budget");
    }
    Ok(match raw.type_info().name().to_ascii_uppercase().as_str() {
        "INTEGER" | "BOOLEAN" => Cell::Integer(row.try_get_unchecked(index)?),
        "REAL" | "FLOAT" | "DOUBLE" => {
            let v: f64 = row.try_get_unchecked(index)?;
            if !v.is_finite() {
                bail!("non-finite migration key is unsupported");
            }
            Cell::Real(v)
        }
        "BLOB" => Cell::Blob(row.try_get_unchecked(index)?),
        _ => Cell::Text(row.try_get_unchecked(index)?),
    })
}
fn keys(job: &StoredJob) -> String {
    job.keys
        .iter()
        .map(key_expression)
        .collect::<Vec<_>>()
        .join(",")
}
fn comparison(job: &StoredJob, operator: &str) -> String {
    format!(
        "({}) {operator} ({})",
        keys(job),
        vec!["?"; job.keys.len()].join(",")
    )
}

pub(super) async fn attach(connection: &mut SqliteConnection, snapshot: &Path) -> Result<()> {
    let mut uri = url::Url::from_file_path(snapshot)
        .map_err(|_| anyhow::anyhow!("invalid snapshot location"))?;
    uri.query_pairs_mut()
        .append_pair("mode", "ro")
        .append_pair("immutable", "1");
    sqlx::query("ATTACH DATABASE ? AS oxide_snapshot")
        .bind(uri.as_str())
        .execute(connection)
        .await?;
    Ok(())
}

pub(in crate::core::transfer_jobs) async fn copy_batch(
    connection: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
    previous: Option<&BatchReceipt>,
) -> Result<Option<BatchReceipt>> {
    let before = previous.map_or(0, |r| r.rows_after);
    if before == job.summary.source_rows {
        return Ok(None);
    }
    let mut tx = connection.begin_with("BEGIN IMMEDIATE").await?;
    validate_target(&mut tx, job).await?;
    let header = receipt::read_header(&mut tx, store, job)
        .await?
        .context("migration receipt is missing")?;
    if header.published
        || schema_digest(&mut tx, &job.stage_table).await? != header.stage_schema_digest
    {
        bail!("migration staging ownership changed");
    }
    let key_bytes = job
        .keys
        .iter()
        .map(|k| format!("COALESCE(octet_length({}),0)", quote(&k.column)))
        .collect::<Vec<_>>()
        .join("+");
    let key_fields = job
        .keys
        .iter()
        .map(|k| {
            format!(
                "CASE WHEN ({key_bytes})<={MAX_KEY_BYTES} THEN {} ELSE NULL END",
                quote(&k.column)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let row_bytes = job
        .columns
        .iter()
        .map(|c| format!("COALESCE(octet_length({}),0)+32", quote(&c.source)))
        .collect::<Vec<_>>()
        .join("+");
    let source_table = format!("oxide_snapshot.{}", quote(&job.request.source.table));
    let predicate = previous
        .map(|_| comparison(job, ">"))
        .unwrap_or_else(|| "1=1".into());
    let sql=format!("SELECT {key_fields},({row_bytes}) FROM {source_table} WHERE {predicate} ORDER BY {} LIMIT {}",keys(job),job.request.batch_rows);
    let mut args = SqliteArguments::default();
    if let Some(previous) = previous {
        add_cells(&mut args, &previous.cursor)?;
    }
    let rows = sqlx::query_with(&sql, args).fetch_all(&mut *tx).await?;
    let mut selected = 0_u64;
    let mut bytes = 0_u64;
    let mut cursor = Vec::new();
    for row in &rows {
        let size: i64 = row.try_get(job.keys.len())?;
        let size: u64 = size.try_into()?;
        if size > MAX_ROW_BYTES {
            bail!("source row exceeds the large-transfer row byte budget");
        }
        if selected > 0 && bytes + size > BATCH_BYTES {
            break;
        }
        cursor = (0..job.keys.len())
            .map(|i| cell(row, i))
            .collect::<Result<Vec<_>>>()?;
        if serde_json::to_vec(&cursor)?.len() > MAX_KEY_BYTES * 5 {
            bail!("migration checkpoint key is too large");
        }
        selected += 1;
        bytes += size;
    }
    drop(rows);
    if selected == 0 {
        bail!("snapshot cursor ended before the reviewed source row count");
    }
    let target_fields = job
        .columns
        .iter()
        .map(|c| quote(&c.target))
        .collect::<Vec<_>>()
        .join(",");
    let source_fields = job
        .columns
        .iter()
        .map(|c| quote(&c.source))
        .collect::<Vec<_>>()
        .join(",");
    let sql=format!("INSERT INTO {} ({target_fields}) SELECT {source_fields} FROM {source_table} WHERE {predicate} AND {} ORDER BY {}",quote(&job.stage_table),comparison(job,"<="),keys(job));
    let mut args = SqliteArguments::default();
    if let Some(previous) = previous {
        add_cells(&mut args, &previous.cursor)?;
    }
    add_cells(&mut args, &cursor)?;
    let inserted = sqlx::query_with(&sql, args)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if inserted != selected {
        bail!("snapshot batch size changed");
    }
    let receipt = BatchReceipt {
        job_id: job.summary.id.clone(),
        plan_digest: job.plan_digest.clone(),
        sequence: previous.map_or(1, |r| r.sequence + 1),
        rows_before: before,
        rows_after: before + selected,
        cursor,
        data_digest: receipt::data_digest(&mut tx, job, before, before + selected).await?,
    };
    receipt::write_batch(&mut tx, store, job, &receipt).await?;
    tx.commit().await?;
    Ok(Some(receipt))
}

pub(in crate::core::transfer_jobs) async fn publish(
    connection: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Header> {
    let mut tx = connection.begin_with("BEGIN IMMEDIATE").await?;
    validate_target(&mut tx, job).await?;
    let mut header = receipt::read_header(&mut tx, store, job)
        .await?
        .context("migration receipt is missing")?;
    if header.published {
        return Ok(header);
    }
    if schema_digest(&mut tx, &job.stage_table).await? != header.stage_schema_digest {
        bail!("migration staging schema changed");
    }
    let last = receipt::validate_all(&mut tx, store, job).await?;
    let rows = last.as_ref().map_or(0, |r| r.rows_after);
    if rows != job.summary.source_rows {
        bail!("migration has not staged every source row");
    }
    validate_target_data(&mut tx, job).await?;
    if job.request.mode == LargeTransferMode::Overwrite {
        sqlx::query(&format!("DELETE FROM {}", quote(&job.request.target.table)))
            .execute(&mut *tx)
            .await?;
    }
    let fields = job
        .columns
        .iter()
        .map(|c| quote(&c.target))
        .collect::<Vec<_>>()
        .join(",");
    let conflict = if job.request.mode == LargeTransferMode::Upsert {
        let updates = job
            .columns
            .iter()
            .filter(|c| !job.target_keys.contains(&c.target))
            .map(|c| format!("{}=excluded.{}", quote(&c.target), quote(&c.target)))
            .collect::<Vec<_>>();
        format!(
            " ON CONFLICT ({}) {}",
            job.target_keys
                .iter()
                .map(|k| quote(k))
                .collect::<Vec<_>>()
                .join(","),
            if updates.is_empty() {
                "DO NOTHING".into()
            } else {
                format!("DO UPDATE SET {}", updates.join(","))
            }
        )
    } else {
        String::new()
    };
    if job
        .file_import
        .as_ref()
        .is_some_and(|plan| plan.presence_column.is_some())
    {
        super::file_publish::publish_rows(&mut tx, job).await?;
    } else {
        sqlx::query(&format!(
            "INSERT INTO {} ({fields}) SELECT {fields} FROM {} WHERE 1=1 ORDER BY {}{conflict}",
            quote(&job.request.target.table),
            quote(&job.stage_table),
            quote(&job.sequence_column)
        ))
        .execute(&mut *tx)
        .await?;
    }
    if job.request.mode != LargeTransferMode::Upsert {
        let expected = if job.request.mode == LargeTransferMode::Append {
            job.target_rows_before + rows
        } else {
            rows
        };
        if count(&mut tx, &job.request.target.table).await? != expected {
            bail!("published target row count is inconsistent");
        }
    }
    require_no_incoming_references(&mut tx, &job.stage_table).await?;
    require_no_incoming_references(&mut tx, &job.receipt_table).await?;
    header.published = true;
    header.rows = rows;
    header.batches = last.map_or(0, |r| r.sequence);
    receipt::write_header(&mut tx, store, job, &header).await?;
    sqlx::query(&format!(
        "DELETE FROM {} WHERE seq>0",
        quote(&job.receipt_table)
    ))
    .execute(&mut *tx)
    .await?;
    sqlx::query(&format!("DROP TABLE {}", quote(&job.stage_table)))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(header)
}

pub(in crate::core::transfer_jobs) async fn remove_staging(
    connection: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<()> {
    let mut tx = connection.begin_with("BEGIN IMMEDIATE").await?;
    let header = receipt::read_header(&mut tx, store, job).await?;
    if let Some(header) = header {
        if header.published {
            bail!("a published transfer cannot be cancelled");
        }
        if schema_digest(&mut tx, &job.stage_table).await? != header.stage_schema_digest {
            bail!("staging ownership changed; automatic cleanup is blocked");
        }
        require_no_incoming_references(&mut tx, &job.stage_table).await?;
        require_no_incoming_references(&mut tx, &job.receipt_table).await?;
        sqlx::query(&format!("DROP TABLE {}", quote(&job.stage_table)))
            .execute(&mut *tx)
            .await?;
        sqlx::query(&format!("DROP TABLE {}", quote(&job.receipt_table)))
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn require_no_incoming_references(
    connection: &mut SqliteConnection,
    table: &str,
) -> Result<()> {
    let found=sqlx::query("SELECT 1 FROM sqlite_master m,pragma_foreign_key_list(m.name) f WHERE m.type='table' AND f.\"table\"=? LIMIT 1").bind(table).fetch_optional(connection).await?;
    if found.is_some() {
        bail!("another table references migration staging; automatic cleanup is blocked");
    }
    Ok(())
}
