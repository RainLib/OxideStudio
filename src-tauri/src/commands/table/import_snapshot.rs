//! Immutable source copy and bounded normalization before resumable review.
use super::{
    import_preview::import_file_digest,
    import_snapshot_checkpoint::Checkpoint,
    import_snapshot_copy::copy_reviewed_source,
    import_snapshot_stream::{quote, snapshot_batches, source_name, SnapshotInput},
    import_types::{TableCsvImportOptions, TableImportFormat},
    limits::TABLE_IMPORT_CANCELLED,
};
use crate::core::{
    private_file::{create_private_file, restrict_sqlite_database_permissions},
    protocol::ColumnInfo,
    transfer_jobs::{
        FileImportFormat, FileImportPlan, FileImportPreparation,
        FileImportPreparationPhase as Phase,
    },
};
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode},
    ConnectOptions, Connection, SqliteConnection,
};
use std::{collections::BTreeMap, path::PathBuf};
use tokio::sync::watch;

pub(super) struct ImportSnapshot {
    pub path: PathBuf,
    pub plan: FileImportPlan,
    // Keep source and database private until the transfer engine has copied
    // them. Drop only after all SQLite/producer handles are closed.
    pub directory: FileImportPreparation,
}

pub(super) fn bind_value<'q>(
    query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    value: Option<&Value>,
) -> Result<sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>, String> {
    Ok(match value.unwrap_or(&Value::Null) {
        Value::Null => query.bind(Option::<String>::None),
        Value::Bool(value) => query.bind(*value),
        Value::Number(value) if value.is_i64() => {
            query.bind(value.as_i64().ok_or("Invalid integer")?)
        }
        Value::Number(value) if value.is_u64() => query.bind(
            i64::try_from(value.as_u64().ok_or("Invalid unsigned integer")?)
                .map_err(|_| "Unsigned integer exceeds native SQLite's exact integer range")?,
        ),
        Value::Number(value) => query.bind(value.as_f64().ok_or("Invalid number")?),
        Value::String(value) => query.bind(value.clone()),
        value => query.bind(serde_json::to_string(value).map_err(|e| e.to_string())?),
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn normalize_import_snapshot(
    path: PathBuf,
    expected_digest: String,
    format: TableImportFormat,
    first_row_header: Option<bool>,
    csv_options: Option<TableCsvImportOptions>,
    columns: Vec<ColumnInfo>,
    cancel: watch::Receiver<bool>,
    directory: FileImportPreparation,
) -> Result<ImportSnapshot, String> {
    directory
        .require_source_digest(&expected_digest)
        .map_err(|e| e.to_string())?;
    let file_name = source_name(&path)?;
    let copy_cancel = cancel.clone();
    let source_digest = expected_digest.clone();
    let (directory, source) = tokio::task::spawn_blocking(move || {
        copy_reviewed_source(&path, &expected_digest, format, &copy_cancel, directory)
    })
    .await
    .map_err(|e| e.to_string())??;
    let ordered_columns = columns.iter().map(|c| c.name.clone()).collect();
    let columns = columns
        .into_iter()
        .map(|c| (c.name.clone(), c))
        .collect::<BTreeMap<_, _>>();
    let input = SnapshotInput {
        path: source,
        format,
        first_row_header,
        csv_options: csv_options.clone(),
        columns,
        ordered_columns,
        source_columns: Vec::new(),
        targets: Vec::new(),
        presence_column: None,
    };
    let inspect_cancel = cancel.clone();
    let inspect_directory = directory.clone();
    let mut input = tokio::task::spawn_blocking(move || {
        let _workspace = inspect_directory;
        let mut input = input;
        input.discover(&inspect_cancel)?;
        Ok::<_, String>(input)
    })
    .await
    .map_err(|e| e.to_string())??;
    let mapping = input.mapping();
    let source_bytes = directory.source_bytes().map_err(|e| e.to_string())?;
    if directory.progress().map_err(|e| e.to_string())?.phase < Phase::Normalizing {
        directory
            .checkpoint(Phase::Normalizing, source_bytes, 0)
            .map_err(|e| e.to_string())?;
    }
    let targets = mapping.iter().map(|c| c.target.clone()).collect::<Vec<_>>();
    let database = directory.path().join("normalized.sqlite");
    create_private_file(&database, b"").map_err(|e| e.to_string())?;
    let options = SqliteConnectOptions::new()
        .filename(&database)
        .create_if_missing(false)
        .journal_mode(SqliteJournalMode::Delete)
        .pragma("page_size", "4096")
        .pragma("max_page_count", "524288")
        .pragma("cache_size", "-4096")
        .pragma("mmap_size", "0")
        .pragma("temp_store", "FILE")
        .disable_statement_logging();
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| e.to_string())?;
    restrict_sqlite_database_permissions(&database);
    {
        let mut handle = connection.lock_handle().await.map_err(|e| e.to_string())?;
        // SAFETY: the SQLx guard exclusively owns this live SQLite handle.
        unsafe {
            libsqlite3_sys::sqlite3_limit(
                handle.as_raw_handle().as_ptr(),
                libsqlite3_sys::SQLITE_LIMIT_LENGTH,
                4 * 1024 * 1024,
            );
        }
    }
    let mut checkpoint =
        Checkpoint::open(&mut connection, &mut input, &directory, &source_digest).await?;
    let presence_column = checkpoint.presence.clone();
    let committed_before = checkpoint.rows;
    let mut normalized_rows = 0_u64;
    let result = async {
        let sql = format!(
            "INSERT INTO data ({},{}) VALUES (?,{})",
            quote(&checkpoint.ordinal),
            targets
                .iter()
                .chain(presence_column.iter())
                .map(|name| quote(name))
                .collect::<Vec<_>>()
                .join(","),
            vec!["?"; targets.len() + usize::from(presence_column.is_some())].join(",")
        );
        let (mut receiver, worker) = snapshot_batches(input, cancel.clone(), directory.clone());
        let write_result = async {
            while let Some(batch) = receiver.recv().await {
                if *cancel.borrow() {
                    return Err(TABLE_IMPORT_CANCELLED.to_string());
                }
                let mut transaction = connection.begin().await.map_err(|e| e.to_string())?;
                let batch_rows = batch.len() as u64;
                let mut appended = false;
                for row in batch {
                    normalized_rows += 1;
                    if normalized_rows <= committed_before {
                        checkpoint
                            .verify_row(&mut transaction, &row, normalized_rows)
                            .await?;
                        continue;
                    }
                    appended = true;
                    let mut query = sqlx::query(&sql)
                        .bind(i64::try_from(normalized_rows).map_err(|e| e.to_string())?);
                    for target in &targets {
                        query = bind_value(query, row.get(target))?;
                    }
                    if presence_column.is_some() {
                        query = query.bind(checkpoint.mask(&row));
                    }
                    query
                        .execute(&mut *transaction)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                if appended {
                    checkpoint.rows = normalized_rows;
                    checkpoint.save(&mut transaction, &directory).await?;
                }
                transaction.commit().await.map_err(|e| e.to_string())?;
                if appended && normalized_rows % 5000 < batch_rows {
                    directory
                        .checkpoint(Phase::Normalizing, source_bytes, normalized_rows)
                        .map_err(|e| e.to_string())?;
                }
            }
            Ok::<_, String>(())
        }
        .await;
        drop(receiver);
        let parsed = worker.await.map_err(|e| e.to_string())?;
        write_result?;
        parsed?;
        if normalized_rows < committed_before {
            return Err("Captured source ended before its committed cursor".into());
        }
        if *cancel.borrow() {
            return Err(TABLE_IMPORT_CANCELLED.into());
        }
        Ok::<_, String>(())
    }
    .await;
    let closed = connection.close().await.map_err(|e| e.to_string());
    result?;
    closed?;
    let digest_path = database.clone();
    let digest_directory = directory.clone();
    let normalized_digest = tokio::task::spawn_blocking(move || {
        let _workspace = digest_directory;
        import_file_digest(&digest_path)
    })
    .await
    .map_err(|e| e.to_string())??;
    directory
        .checkpoint(Phase::Ready, source_bytes, normalized_rows)
        .map_err(|e| e.to_string())?;
    Ok(ImportSnapshot {
        path: database,
        plan: FileImportPlan {
            file_name,
            format: match format {
                TableImportFormat::Csv => FileImportFormat::Csv,
                TableImportFormat::Json => FileImportFormat::Json,
                TableImportFormat::Xlsx => FileImportFormat::Xlsx,
            },
            source_digest,
            normalized_digest,
            columns: mapping,
            presence_column,
            options: serde_json::json!({"firstRowHeader": first_row_header, "csvOptions": csv_options}),
        },
        directory,
    })
}
