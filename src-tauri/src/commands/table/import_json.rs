//! Import json for table operations.

use super::import_csv::canonical_import_columns;
use super::import_preview::stream_json_document_rows;
use super::import_transaction::execute_import_transaction_batch;
use super::import_types::{TableImportExecutionContext, TableImportMode};
use super::limits::{IMPORT_BATCH_SIZE, TABLE_IMPORT_CANCELLED};
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ColumnInfo;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::BufRead;
use std::io::BufReader;
use std::path::Path;

pub(super) fn is_json_lines_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("jsonl" | "ndjson")
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn import_json_lines_in_transaction(
    manager: &ConnectionManager,
    connection_id: &str,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    path: &Path,
    database: Option<&str>,
    mode: TableImportMode,
    context: &TableImportExecutionContext,
) -> Result<(u64, u64), String> {
    context.ensure_not_cancelled()?;
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let transaction_id = format!("table-import-{}", uuid::Uuid::new_v4());
    match database {
        Some(database) => {
            manager
                .begin_database_transaction(
                    connection_id,
                    &transaction_id,
                    database,
                    Some(schema.to_string()),
                )
                .await
        }
        None => {
            manager
                .begin_transaction(connection_id, &transaction_id, Some(schema.to_string()))
                .await
        }
    }
    .map_err(|error| error.to_string())?;

    let import_result = async {
        let mut rows_imported = 0_u64;
        let mut batches = 0_u64;
        let mut replace_pending = mode == TableImportMode::Truncate;
        let mut pending_rows = Vec::with_capacity(IMPORT_BATCH_SIZE);
        let mut line = String::new();
        let mut line_number = 0_u64;
        loop {
            context.ensure_not_cancelled()?;
            line.clear();
            if reader
                .read_line(&mut line)
                .map_err(|error| error.to_string())?
                == 0
            {
                break;
            }
            line_number += 1;
            if line.trim().is_empty() {
                continue;
            }
            let object = serde_json::from_str::<Value>(&line)
                .map_err(|error| format!("Invalid JSON object on line {line_number}: {error}"))?;
            let Value::Object(object) = object else {
                return Err(format!("JSON row {line_number} is not an object"));
            };
            let headers = object.keys().cloned().collect::<Vec<_>>();
            let canonical_headers = canonical_import_columns(&headers, columns)?;
            pending_rows.push(
                headers
                    .into_iter()
                    .zip(canonical_headers)
                    .filter_map(|(source, target)| {
                        object.get(&source).cloned().map(|value| (target, value))
                    })
                    .collect(),
            );
            if pending_rows.len() == IMPORT_BATCH_SIZE {
                rows_imported += execute_import_transaction_batch(
                    manager,
                    connection_id,
                    &transaction_id,
                    kind,
                    schema,
                    table,
                    columns,
                    &mut pending_rows,
                    replace_pending,
                )
                .await?;
                replace_pending = false;
                batches += 1;
                context.emit_running(rows_imported, batches);
            }
        }
        if !pending_rows.is_empty() {
            context.ensure_not_cancelled()?;
            rows_imported += execute_import_transaction_batch(
                manager,
                connection_id,
                &transaction_id,
                kind,
                schema,
                table,
                columns,
                &mut pending_rows,
                replace_pending,
            )
            .await?;
            batches += 1;
            context.emit_running(rows_imported, batches);
        }
        context.ensure_not_cancelled()?;
        manager
            .commit_transaction(connection_id, &transaction_id)
            .await
            .map_err(|error| error.to_string())?;
        Ok((rows_imported, batches))
    }
    .await;

    if import_result.is_err() {
        let _ = manager
            .rollback_transaction(connection_id, &transaction_id)
            .await;
    }
    import_result
}

pub(super) fn json_import_rows_with_cancel(
    path: &Path,
    is_cancelled: &dyn Fn() -> bool,
) -> Result<Vec<BTreeMap<String, Value>>, String> {
    let mut rows = Vec::new();
    let mut collect_row = |_row_number: u64, row: BTreeMap<String, Value>| {
        if is_cancelled() {
            return Err(TABLE_IMPORT_CANCELLED.to_string());
        }
        rows.push(row);
        Ok(())
    };
    stream_json_document_rows(path, is_cancelled, &mut collect_row)?;
    Ok(rows)
}

pub(super) fn json_import_rows(path: &Path) -> Result<Vec<BTreeMap<String, Value>>, String> {
    json_import_rows_with_cancel(path, &|| false)
}
