use super::quote;
use crate::core::{
    driver::LocalDatabaseBackupControl,
    transfer_jobs::{
        files,
        models::{LargeTransferColumn, LargeTransferMode, SourceKey, StoredJob},
        store::JobStore,
    },
};
use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions, Connection, Row, SqliteConnection};
use std::{collections::HashSet, path::Path, time::Duration};

pub(in crate::core::transfer_jobs) async fn connect(
    path: &Path,
    read_only: bool,
) -> Result<SqliteConnection> {
    Ok(SqliteConnectOptions::new()
        .filename(path)
        .read_only(read_only)
        .create_if_missing(false)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5))
        .pragma("cache_size", "-4096")
        .pragma("mmap_size", "0")
        .pragma("temp_store", "FILE")
        .disable_statement_logging()
        .connect()
        .await?)
}

pub(in crate::core::transfer_jobs) async fn schema_digest(
    connection: &mut SqliteConnection,
    table: &str,
) -> Result<String> {
    let (count, bytes): (i64, i64) = sqlx::query_as("SELECT COUNT(*),COALESCE(SUM(octet_length(type)+octet_length(name)+COALESCE(octet_length(sql),0)),0) FROM sqlite_master WHERE tbl_name=? COLLATE NOCASE")
        .bind(table).fetch_one(&mut *connection).await?;
    if count > 256 || bytes > 512 * 1024 {
        bail!("migration schema exceeds its metadata budget");
    }
    let entries: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT type,name,sql FROM sqlite_master WHERE tbl_name=? COLLATE NOCASE ORDER BY type,name LIMIT 257",
    )
    .bind(table)
    .fetch_all(connection)
    .await?;
    if !entries.iter().any(|(kind, _, sql)| {
        kind == "table"
            && sql
                .as_ref()
                .is_some_and(|sql| !sql.to_ascii_uppercase().starts_with("CREATE VIRTUAL"))
    }) {
        bail!("large transfers require an ordinary persistent table");
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&entries)?)
    ))
}

#[derive(Clone)]
struct Column {
    name: String,
    data_type: String,
    required: bool,
    default: bool,
    key: i64,
    hidden: i64,
}
async fn columns(connection: &mut SqliteConnection, table: &str) -> Result<Vec<Column>> {
    columns_bounded(connection, table, 512).await
}
async fn columns_bounded(
    connection: &mut SqliteConnection,
    table: &str,
    limit: usize,
) -> Result<Vec<Column>> {
    let rows = sqlx::query(
        "SELECT name,type,\"notnull\",dflt_value IS NOT NULL AS has_default,pk,hidden FROM pragma_table_xinfo(?) ORDER BY cid LIMIT ?",
    )
    .bind(table)
    .bind((limit + 1) as i64)
    .fetch_all(connection)
    .await?;
    if rows.is_empty() || rows.len() > limit {
        bail!("large transfer table column count is unsupported");
    }
    rows.into_iter()
        .map(|r| {
            Ok(Column {
                name: r.try_get("name")?,
                data_type: r.try_get("type")?,
                required: r.try_get::<i64, _>("notnull")? != 0,
                default: r.try_get::<i64, _>("has_default")? != 0,
                key: r.try_get("pk")?,
                hidden: r.try_get("hidden")?,
            })
        })
        .collect()
}

pub(super) fn affinity(data_type: &str) -> &'static str {
    let value = data_type.to_ascii_uppercase();
    if value.contains("INT") {
        "INTEGER"
    } else if ["CHAR", "CLOB", "TEXT"].iter().any(|v| value.contains(v)) {
        "TEXT"
    } else if value.is_empty() || value.contains("BLOB") {
        "BLOB"
    } else if ["REAL", "FLOA", "DOUB"].iter().any(|v| value.contains(v)) {
        "REAL"
    } else {
        "NUMERIC"
    }
}

pub(in crate::core::transfer_jobs) async fn prepare_snapshot(
    store: &JobStore,
    job: &mut StoredJob,
    control: &LocalDatabaseBackupControl,
) -> Result<()> {
    files::require_identity(job.source_file()?)?;
    files::require_identity(job.target_file()?)?;
    let snapshot = store.snapshot(&job.summary.id)?;
    if snapshot.exists() {
        std::fs::remove_file(&snapshot)?;
    }
    crate::drivers::sqlite::backup_existing_file(&job.source_file()?.path, &snapshot, control)
        .await?;
    files::require_identity(job.source_file()?)?;
    let mut source = connect(&snapshot, false).await?;
    sqlx::query("PRAGMA journal_mode=DELETE")
        .execute(&mut source)
        .await?;
    schema_digest(&mut source, &job.request.source.table).await?;
    // A file snapshot adds a host ordinal and an optional presence bitmap
    // to the existing 512 mapped-column budget. Ordinary tables keep the old cap.
    let source_columns = columns_bounded(
        &mut source,
        &job.request.source.table,
        512 + usize::from(job.file_import.is_some())
            + usize::from(
                job.file_import
                    .as_ref()
                    .is_some_and(|p| p.presence_column.is_some()),
            ),
    )
    .await?;
    let mut target = connect(&job.target_file()?.path, true).await?;
    let mut target_tx = target.begin().await?;
    job.target_schema_digest = schema_digest(&mut target_tx, &job.request.target.table).await?;
    let target_columns = columns(&mut target_tx, &job.request.target.table).await?;
    if let Some(mask) = job
        .file_import
        .as_ref()
        .and_then(|p| p.presence_column.as_deref())
    {
        if target_columns
            .iter()
            .any(|c| c.name.eq_ignore_ascii_case(mask))
        {
            bail!("file presence metadata collides with a target column");
        }
    }
    job.columns.clear();
    job.skipped_columns.clear();
    for column in &target_columns {
        let matched = source_columns
            .iter()
            .find(|src| src.name.eq_ignore_ascii_case(&column.name));
        if column.hidden != 0 {
            if matched.is_some() {
                job.skipped_columns.push(column.name.clone());
            }
            continue;
        }
        if let Some(src) = matched {
            job.columns.push(LargeTransferColumn {
                source: src.name.clone(),
                target: column.name.clone(),
                source_type: src.data_type.clone(),
                target_type: column.data_type.clone(),
            });
        } else if column.required && !column.default {
            bail!(
                "required target column {} has no source mapping or default",
                column.name
            );
        }
    }
    if let Some(mask) = job
        .file_import
        .as_ref()
        .and_then(|p| p.presence_column.as_deref())
    {
        let column = source_columns
            .iter()
            .find(|c| {
                c.name == mask
                    && c.hidden == 0
                    && c.key == 0
                    && c.data_type.eq_ignore_ascii_case("BLOB")
            })
            .context("file import presence column is missing or invalid")?;
        job.columns.push(LargeTransferColumn {
            source: column.name.clone(),
            target: column.name.clone(),
            source_type: "BLOB".into(),
            target_type: "BLOB".into(),
        });
    }
    if job.columns.is_empty() {
        bail!("large transfer has no writable mapped columns");
    }
    job.target_keys = target_columns
        .iter()
        .filter(|c| c.key > 0)
        .map(|c| c.name.clone())
        .collect();
    if job.request.mode == LargeTransferMode::Upsert
        && (job.target_keys.is_empty()
            || job
                .target_keys
                .iter()
                .any(|key| !job.columns.iter().any(|c| &c.target == key)))
    {
        bail!("large upsert requires every target primary-key column in the mapping");
    }
    job.target_rows_before = count(&mut target_tx, &job.request.target.table).await?;
    job.target_data_digest = super::receipt::table_digest(
        &mut target_tx,
        &job.request.target.table,
        &target_columns
            .iter()
            .map(|c| c.name.clone())
            .collect::<Vec<_>>(),
    )
    .await?;
    target_tx.commit().await?;
    job.summary.source_rows = count(&mut source, &job.request.source.table).await?;
    let mut primary = source_columns
        .iter()
        .filter(|c| c.key > 0)
        .collect::<Vec<_>>();
    primary.sort_by_key(|c| c.key);
    job.keys = primary
        .iter()
        .map(|c| SourceKey {
            column: c.name.clone(),
            collation: "BINARY".into(),
            rowid: false,
        })
        .collect();
    if job.keys.is_empty() {
        let names = source_columns
            .iter()
            .map(|c| c.name.to_ascii_lowercase())
            .collect::<HashSet<_>>();
        let rowid = ["rowid", "_rowid_", "oid"]
            .into_iter()
            .find(|name| !names.contains(*name))
            .context("table has no addressable stable key")?;
        job.keys.push(SourceKey {
            column: rowid.into(),
            collation: "BINARY".into(),
            rowid: true,
        });
    } else {
        let indexes = sqlx::query("SELECT name FROM pragma_index_list(?) WHERE origin='pk'")
            .bind(&job.request.source.table)
            .fetch_all(&mut source)
            .await?;
        if let Some(index) = indexes.first() {
            let name: String = index.try_get("name")?;
            for row in sqlx::query("SELECT name,coll FROM pragma_index_xinfo(?) WHERE key=1")
                .bind(name)
                .fetch_all(&mut source)
                .await?
            {
                let name: String = row.try_get("name")?;
                let collation: String = row.try_get("coll")?;
                if !matches!(
                    collation.to_ascii_uppercase().as_str(),
                    "BINARY" | "NOCASE" | "RTRIM"
                ) {
                    bail!("custom source key collation is unsupported");
                }
                if let Some(key) = job.keys.iter_mut().find(|k| k.column == name) {
                    key.collation = collation;
                }
            }
        }
        let fields = job
            .keys
            .iter()
            .map(key_expression)
            .collect::<Vec<_>>()
            .join(",");
        let invalid = job
            .keys
            .iter()
            .map(|key| format!("{} IS NULL", quote(&key.column)))
            .collect::<Vec<_>>()
            .join(" OR ");
        if sqlx::query(&format!(
            "SELECT 1 FROM {} WHERE {invalid} LIMIT 1",
            quote(&job.request.source.table)
        ))
        .fetch_optional(&mut source)
        .await?
        .is_some()
        {
            bail!("snapshot keys cannot contain NULL");
        }
        sqlx::query(&format!(
            "CREATE UNIQUE INDEX {} ON {} ({fields})",
            quote(&format!(
                "_oxide_snapshot_{}",
                job.summary.id.replace('-', "")
            )),
            quote(&job.request.source.table)
        ))
        .execute(&mut source)
        .await?;
    }
    if job.keys.len() > 16 {
        bail!("large transfer key exceeds sixteen columns");
    }
    source.close().await?;
    target.close().await?;
    job.summary.snapshot_bytes = std::fs::metadata(&snapshot)?.len();
    let path = snapshot.clone();
    let control = control.clone();
    job.snapshot_digest =
        tokio::task::spawn_blocking(move || files::digest_controlled(&path, &control)).await??;
    Ok(())
}

pub(super) fn key_expression(key: &SourceKey) -> String {
    format!("{} COLLATE {}", quote(&key.column), quote(&key.collation))
}

pub(super) async fn count(connection: &mut SqliteConnection, table: &str) -> Result<u64> {
    let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {}", quote(table)))
        .fetch_one(connection)
        .await?;
    Ok(count.try_into()?)
}

pub(in crate::core::transfer_jobs) async fn validate_target(
    connection: &mut SqliteConnection,
    job: &StoredJob,
) -> Result<()> {
    files::require_identity(job.target_file()?)?;
    if schema_digest(connection, &job.request.target.table).await? != job.target_schema_digest {
        bail!("target schema changed; preview a new migration");
    }
    Ok(())
}

pub(super) async fn validate_target_data(
    connection: &mut SqliteConnection,
    job: &StoredJob,
) -> Result<()> {
    let names = columns(connection, &job.request.target.table)
        .await?
        .into_iter()
        .map(|c| c.name)
        .collect::<Vec<_>>();
    if count(connection, &job.request.target.table).await? != job.target_rows_before
        || super::receipt::table_digest(connection, &job.request.target.table, &names).await?
            != job.target_data_digest
    {
        bail!("target row content changed; preview a new migration");
    }
    Ok(())
}
