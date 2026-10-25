//! Import transaction for table operations.

use super::import_csv::{
    canonical_import_columns, csv_delimiter, csv_import_reader, csv_import_row_selected,
    csv_import_source_columns, csv_record_values, resolve_csv_import_columns,
    resolve_csv_import_row_range,
};
use super::import_types::{
    TableCsvImportOptions, TableImportExecutionContext, TableImportFormat, TableImportMode,
};
use super::limits::{IMPORT_BATCH_SIZE, TABLE_IMPORT_CANCELLED};
use super::policy::schema_option;
use super::row_sql::build_insert_mutation;
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ColumnInfo;
use crate::core::protocol::ParameterizedStatement;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use tokio::sync::watch;

#[allow(clippy::too_many_arguments)]
pub(super) async fn execute_import_transaction_batch(
    manager: &ConnectionManager,
    connection_id: &str,
    transaction_id: &str,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    rows: &mut Vec<BTreeMap<String, Value>>,
    replace_existing: bool,
) -> Result<u64, String> {
    if rows.is_empty() {
        return Ok(0);
    }
    let row_count = rows.len() as u64;
    let mut statements = Vec::with_capacity(rows.len() + usize::from(replace_existing));
    if replace_existing {
        statements.push(table_import_replace_statement(kind, schema, table));
    }
    statements.extend(
        rows.iter()
            .map(|row| {
                build_insert_mutation(kind, schema, table, columns, row)
                    .map(|(sql, params)| ParameterizedStatement { sql, params })
            })
            .collect::<Result<Vec<_>, _>>()?,
    );
    manager
        .execute_parameterized_transaction(connection_id, transaction_id, &statements)
        .await
        .map_err(|error| error.to_string())?;
    rows.clear();
    Ok(row_count)
}

pub(super) fn table_import_replace_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
) -> ParameterizedStatement {
    ParameterizedStatement {
        sql: format!(
            "DELETE FROM {}",
            kind.qualified_table(schema_option(schema), table)
        ),
        params: Vec::new(),
    }
}

/// JSON and XLSX share one transaction while consuming bounded parsed batches.
#[allow(clippy::too_many_arguments)]
pub(super) async fn import_streamed_rows_in_transaction(
    manager: &ConnectionManager,
    connection_id: &str,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    path: &Path,
    format: TableImportFormat,
    database: Option<&str>,
    mode: TableImportMode,
    cancel: &watch::Receiver<bool>,
    on_progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<(u64, u64), String> {
    let check_cancel = || {
        if *cancel.borrow() {
            Err(TABLE_IMPORT_CANCELLED.to_string())
        } else {
            Ok(())
        }
    };
    check_cancel()?;
    let transaction_id = format!("table-import-{}", uuid::Uuid::new_v4());
    match database {
        Some(database) => {
            manager
                .begin_database_transaction(
                    connection_id,
                    &transaction_id,
                    database,
                    Some(schema.into()),
                )
                .await
        }
        None => {
            manager
                .begin_transaction(connection_id, &transaction_id, Some(schema.into()))
                .await
        }
    }
    .map_err(|e| e.to_string())?;
    let (mut receiver, worker) =
        super::import_row_stream::row_batch_stream(path.to_path_buf(), cancel.clone(), format);
    let mut worker = Some(worker);
    let result = async {
        let mut rows_imported = 0;
        let mut batches = 0;
        let mut replace_pending = mode == TableImportMode::Truncate;
        while let Some(rows) = receiver.recv().await {
            check_cancel()?;
            let mut canonical_rows = Vec::with_capacity(rows.len());
            for row in rows {
                let headers = row.keys().cloned().collect::<Vec<_>>();
                let targets = canonical_import_columns(&headers, columns)?;
                canonical_rows.push(
                    row.into_values()
                        .zip(targets)
                        .map(|(value, target)| (target, value))
                        .collect(),
                );
            }
            rows_imported += execute_import_transaction_batch(
                manager,
                connection_id,
                &transaction_id,
                kind,
                schema,
                table,
                columns,
                &mut canonical_rows,
                replace_pending,
            )
            .await?;
            replace_pending = false;
            batches += 1;
            on_progress(rows_imported, batches);
        }
        // A closed queue alone does not prove a valid document: malformed
        // tails and worker panics must reject the transaction before commit.
        worker
            .take()
            .expect("JSON parser worker")
            .await
            .map_err(|e| format!("JSON parser worker failed: {e}"))??;
        check_cancel()?;
        manager
            .commit_transaction(connection_id, &transaction_id)
            .await
            .map_err(|e| e.to_string())?;
        Ok((rows_imported, batches))
    }
    .await;
    drop(receiver); // unblocks a producer if validation/database execution failed
    if let Some(worker) = worker {
        let _ = worker.await;
    }
    if result.is_err() {
        let _ = manager
            .rollback_transaction(connection_id, &transaction_id)
            .await;
    }
    result
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn import_csv_in_transaction(
    manager: &ConnectionManager,
    connection_id: &str,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    path: &Path,
    database: Option<&str>,
    first_row_header: Option<bool>,
    ordered_columns: Vec<String>,
    csv_options: Option<&TableCsvImportOptions>,
    mode: TableImportMode,
    context: &TableImportExecutionContext,
) -> Result<(u64, u64), String> {
    context.ensure_not_cancelled()?;
    let row_range = resolve_csv_import_row_range(first_row_header, csv_options)?;
    let mut reader = csv_import_reader(
        path,
        false,
        csv_delimiter(path, csv_options)?,
        csv_options.and_then(|options| options.encoding),
    )?;
    let (source_columns, consumed_records) =
        csv_import_source_columns(&mut reader, row_range, ordered_columns)?;
    let headers = resolve_csv_import_columns(&source_columns, columns, csv_options)?;
    let empty_fields_as_null = csv_options
        .and_then(|options| options.empty_fields_as_null)
        .unwrap_or(false);
    let trim_values = csv_options
        .and_then(|options| options.trim_values)
        .unwrap_or(false);
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
        for (index, record) in reader.records().enumerate() {
            context.ensure_not_cancelled()?;
            let row_number = consumed_records + index as u64 + 1;
            if row_number < row_range.data_start_row {
                continue;
            }
            if !csv_import_row_selected(row_range, row_number) {
                break;
            }
            let record = record.map_err(|error| error.to_string())?;
            pending_rows.push(csv_record_values(
                &headers,
                &record,
                empty_fields_as_null,
                trim_values,
            )?);
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
