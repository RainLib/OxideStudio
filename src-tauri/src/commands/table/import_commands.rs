//! Import commands for table operations.

use super::access::{ensure_target_relation_operation_allowed, get_target_columns};
use super::import_preview::{validate_import_file, verify_import_file_digest};
use super::import_transaction::{import_csv_in_transaction, import_streamed_rows_in_transaction};
use super::import_types::{
    default_table_import_mode, TableCsvImportOptions, TableImportCancellationState,
    TableImportExecutionContext, TableImportFormat, TableImportMode, TableImportReport,
    TableImportReportStatus, TableImportResult,
};
use super::limits::{
    TABLE_IMPORT_CANCELLED, TABLE_IMPORT_REPORT_KIND, TABLE_IMPORT_REPORT_PARENT_ID,
};
use super::policy::{table_data_dialect_for_connection, RelationOperation};
use super::reports::{
    current_table_timestamp_millis, normalized_table_export_project_id,
    persist_table_import_report, table_import_mapping_digest, table_import_report_id,
    validate_table_import_id,
};
use super::row_sql::column_lookup;
use crate::core::dialect::canonical_driver_name;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::Response;
use crate::core::store::MetaStore;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::State;

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn import_table_data(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    meta_store: State<'_, MetaStore>,
    cancellation: State<'_, TableImportCancellationState>,
    connection_id: String,
    import_id: String,
    project_id: Option<String>,
    driver: String,
    schema: String,
    table: String,
    database: Option<String>,
    file_path: String,
    format: TableImportFormat,
    mode: Option<TableImportMode>,
    first_row_header: Option<bool>,
    csv_options: Option<TableCsvImportOptions>,
    expected_file_digest: Option<String>,
) -> Result<Response<TableImportResult>, String> {
    let import_id = validate_table_import_id(&import_id)?;
    let mode = mode.unwrap_or_else(default_table_import_mode);
    let mapping_digest =
        table_import_mapping_digest(format, mode, first_row_header, csv_options.as_ref())?;
    let cancel_rx = cancellation.register(&import_id).await?;
    let context = TableImportExecutionContext {
        app,
        import_id: import_id.clone(),
        cancel_rx,
        total_rows: None,
    };
    context.emit(
        0,
        0,
        false,
        "preparing",
        Some("Import source is being revalidated before the transaction".to_string()),
    );
    let started_at = current_table_timestamp_millis();
    let result: Result<TableImportResult, String> = async {
        // Import uses the same bounded parameterized row-mutation path as
        // grid edits and exports. SQLite/DuckDB are deliberately supported by
        // the narrow ANSI/PostgreSQL-compatible adapter in
        // `table_data_dialect`; resolving DatabaseKind directly here made
        // those drivers inconsistently reject CSV/JSON imports.
        let kind =
            table_data_dialect_for_connection(&manager, &connection_id, &driver, true).await?;
        let path = PathBuf::from(file_path.trim());
        validate_import_file(&path, format)?;
        let digest_path = path.clone();
        tokio::task::spawn_blocking(move || {
            verify_import_file_digest(&digest_path, expected_file_digest.as_deref())
        })
        .await
        .map_err(|error| format!("Import digest worker failed: {error}"))??;
        let database = database.as_deref();
        ensure_target_relation_operation_allowed(
            &manager,
            &connection_id,
            database,
            &schema,
            &table,
            RelationOperation::DataMutation,
        )
        .await?;
        let table_columns = get_target_columns(&manager, &connection_id, database, &schema, &table)
            .await
            .map_err(|error| error.to_string())?;
        let ordered_columns = table_columns
            .iter()
            .map(|column| column.name.clone())
            .collect::<Vec<_>>();
        let column_lookup = column_lookup(table_columns);

        // CSV imports use a dedicated transaction session across many small
        // bound batches. When a server database is selected, the driver must
        // explicitly bind that session to the selected database; a default
        // connection transaction is never substituted.
        if matches!(format, TableImportFormat::Csv) {
            let (rows_imported, batches) = import_csv_in_transaction(
                &manager,
                &connection_id,
                kind,
                &schema,
                &table,
                &column_lookup,
                &path,
                database,
                first_row_header,
                ordered_columns,
                csv_options.as_ref(),
                mode,
                &context,
            )
            .await?;
            return Ok(TableImportResult {
                import_id: import_id.clone(),
                file_path: path.display().to_string(),
                rows_imported,
                batches,
                report_id: None,
            });
        }
        let (rows_imported, batches) = import_streamed_rows_in_transaction(
            &manager,
            &connection_id,
            kind,
            &schema,
            &table,
            &column_lookup,
            &path,
            format,
            database,
            mode,
            &context.cancel_rx,
            &|rows, batches| context.emit_running(rows, batches),
        )
        .await?;
        Ok(TableImportResult {
            import_id: import_id.clone(),
            file_path: path.display().to_string(),
            rows_imported,
            batches,
            report_id: None,
        })
    }
    .await;

    cancellation.take(&import_id).await;
    let cancelled = result
        .as_ref()
        .err()
        .is_some_and(|error| error.contains(TABLE_IMPORT_CANCELLED));
    match &result {
        Ok(imported) => context.with_total_rows(Some(imported.rows_imported)).emit(
            imported.rows_imported,
            imported.batches,
            true,
            "done",
            Some("Import transaction committed".to_string()),
        ),
        Err(_) if cancelled => context.emit(
            0,
            0,
            true,
            "cancelled",
            Some("Import cancelled; the transaction was rolled back".to_string()),
        ),
        Err(_) => context.emit(
            0,
            0,
            true,
            "error",
            Some("Import failed; the transaction was rolled back when supported".to_string()),
        ),
    }

    let mut result = result;
    if let Some(project_id) = normalized_table_export_project_id(project_id.as_deref()) {
        let (status, rows_imported, batches, error) = match &result {
            Ok(imported) => (
                TableImportReportStatus::Done,
                imported.rows_imported,
                imported.batches,
                None,
            ),
            Err(_) => (
                if cancelled {
                    TableImportReportStatus::Cancelled
                } else {
                    TableImportReportStatus::Error
                },
                0,
                0,
                Some(if cancelled {
                    "Import cancelled and the transaction was rolled back.".to_string()
                } else {
                    "Import failed and the transaction was rolled back when supported.".to_string()
                }),
            ),
        };
        let report_id = table_import_report_id(&import_id);
        let report = TableImportReport {
            id: report_id.clone(),
            project_id,
            import_id: import_id.clone(),
            connection_id: connection_id.clone(),
            driver: canonical_driver_name(&driver)
                .unwrap_or_else(|| driver.trim())
                .to_ascii_lowercase(),
            schema: schema.clone(),
            table: table.clone(),
            format,
            mode,
            mapping_digest,
            rows_imported,
            batches,
            status,
            started_at,
            finished_at: current_table_timestamp_millis(),
            error,
        };
        match persist_table_import_report(meta_store.inner(), &report).await {
            Ok(()) => {
                if let Ok(imported) = result.as_mut() {
                    imported.report_id = Some(report_id);
                }
            }
            Err(error) => tracing::warn!(error = %error, "table import report was not persisted"),
        }
    }

    match result {
        Ok(imported) => Ok(Response::ok(imported)),
        Err(_) if cancelled => Ok(Response::err(
            TABLE_IMPORT_CANCELLED,
            "Table import was cancelled and its transaction was rolled back.",
        )),
        Err(error) => Ok(Response::err("IMPORT_TABLE_DATA_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn cancel_table_import(
    cancellation: State<'_, TableImportCancellationState>,
    import_id: String,
) -> Result<Response<String>, String> {
    let import_id = validate_table_import_id(&import_id)?;
    let Some(handle) = cancellation.cancellation_handle(&import_id).await else {
        return Ok(Response::err(
            "TABLE_IMPORT_NOT_FOUND",
            &format!("Table import is not active: {import_id}"),
        ));
    };
    let _ = handle.sender.send(true);
    Ok(Response::ok("Import cancellation requested".to_string()))
}

#[tauri::command]
pub async fn list_table_import_reports(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    connection_id: String,
    limit: Option<usize>,
) -> Result<Response<Vec<TableImportReport>>, String> {
    let project_id = normalized_table_export_project_id(Some(&project_id)).ok_or_else(|| {
        "A valid project id is required to read table import reports.".to_string()
    })?;
    let mut reports = meta_store
        .get_children(
            &project_id,
            Some(TABLE_IMPORT_REPORT_PARENT_ID),
            &connection_id,
        )
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|resource| resource.kind == TABLE_IMPORT_REPORT_KIND)
        .filter_map(|resource| serde_json::from_value::<TableImportReport>(resource.metadata).ok())
        .collect::<Vec<_>>();
    reports.sort_by_key(|report| std::cmp::Reverse(report.started_at));
    reports.truncate(limit.unwrap_or(20).clamp(1, 100));
    Ok(Response::ok(reports))
}
