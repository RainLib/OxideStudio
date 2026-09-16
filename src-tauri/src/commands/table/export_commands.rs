//! Export commands for table operations.

use super::export_analytical::AnalyticalTypePolicy;
use super::export_files::export_file_path;
use super::export_sql::{
    ensure_sql_insert_conflict_policy, filter_sql_export_batch, is_postgres_tsvector_export_type,
    sql_export_insert_batch_rows, SqlExportDialect,
};
use super::export_types::{
    SqlInsertConflictPolicy, TableExportCancellationState, TableExportEncoding, TableExportFormat,
    TableExportProgress, TableExportReport, TableExportReportStatus, TableExportResult,
    TableExportWriterContext, TableExportWriterMessage,
};
use super::export_writer::write_table_export_stream;
use super::limits::{
    DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SQL_EXPORT_INSERT_BATCH_ROWS, TABLE_EXPORT_BUFFERED_PAGES,
    TABLE_EXPORT_CANCELLED, TABLE_EXPORT_PROGRESS_EVENT, TABLE_EXPORT_REPORT_KIND,
    TABLE_EXPORT_REPORT_PARENT_ID, TABLE_EXPORT_WRITER_CLOSED,
};
use super::policy::{schema_option, table_export_dialect_for_connection, validated_raw_filter_sql};
use super::reports::{
    current_table_timestamp_millis, normalized_table_export_project_id,
    persist_table_export_report, table_export_report_id,
};
use super::row_sql::{build_structured_filter_where, build_table_order_by, column_lookup};
use super::row_types::{TableFilter, TableSort};
use crate::core::dialect::canonical_driver_name;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ColumnDef;
use crate::core::protocol::QueryResult;
use crate::core::protocol::Response;
use crate::core::store::MetaStore;
use std::collections::HashSet;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::State;
use tokio::sync::mpsc;

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn export_table_data(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, TableExportCancellationState>,
    meta_store: State<'_, MetaStore>,
    connection_id: String,
    export_id: String,
    project_id: Option<String>,
    driver: String,
    schema: String,
    table: String,
    format: TableExportFormat,
    encoding: Option<TableExportEncoding>,
    xlsx_auto_filter: Option<bool>,
    filter_sql: Option<String>,
    filters: Option<Vec<TableFilter>>,
    sort: Option<TableSort>,
    page_size: Option<u32>,
    max_rows: Option<u64>,
    sql_insert_batch_size: Option<usize>,
    sql_insert_conflict_policy: Option<SqlInsertConflictPolicy>,
) -> Result<Response<TableExportResult>, String> {
    let mut cancel_rx = cancellation.register(&export_id, &connection_id).await?;
    let started_at = current_table_timestamp_millis();
    let requested_encoding = encoding.unwrap_or(TableExportEncoding::Utf8);
    if matches!(requested_encoding, TableExportEncoding::Utf8Bom)
        && !matches!(format, TableExportFormat::Csv)
    {
        cancellation.take(&export_id).await;
        return Err("UTF-8 BOM output is supported only for CSV exports".to_string());
    }
    if matches!(requested_encoding, TableExportEncoding::Binary)
        && !matches!(
            format,
            TableExportFormat::Arrow | TableExportFormat::Parquet | TableExportFormat::Xlsx
        )
    {
        cancellation.take(&export_id).await;
        return Err(
            "Binary output encoding is supported only for Arrow, Parquet, and XLSX exports"
                .to_string(),
        );
    }
    if xlsx_auto_filter.is_some() && !matches!(format, TableExportFormat::Xlsx) {
        cancellation.take(&export_id).await;
        return Err("XLSX auto-filter settings are supported only for XLSX exports".to_string());
    }
    let xlsx_auto_filter = xlsx_auto_filter.unwrap_or(true);
    let encoding = if matches!(
        format,
        TableExportFormat::Arrow | TableExportFormat::Parquet | TableExportFormat::Xlsx
    ) {
        TableExportEncoding::Binary
    } else {
        requested_encoding
    };
    let progress_rows = Arc::new(AtomicU64::new(0));
    let progress_batches = Arc::new(AtomicU64::new(0));
    let result: Result<TableExportResult, String> = async {
        let export_dialect =
            table_export_dialect_for_connection(&manager, &connection_id, &driver, format).await?;
        let kind = export_dialect.kind;
        let analytical_type_policy = export_dialect.analytical_type_policy;
        let sql_dialect = export_dialect.sql_dialect;
        let page_size = page_size
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
        let structured_filters = filters
            .as_deref()
            .map(|filters| {
                filters
                    .iter()
                    .filter(|filter| !filter.column.trim().is_empty())
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .filter(|filters| !filters.is_empty());
        let requested_sort = sort.as_ref().filter(|sort| !sort.column.trim().is_empty());
        let analytical_export = matches!(
            format,
            TableExportFormat::Arrow | TableExportFormat::Parquet
        );
        let sql_export = matches!(format, TableExportFormat::Sql);
        let sql_insert_batch_rows = if sql_export {
            sql_export_insert_batch_rows(sql_insert_batch_size)?
        } else {
            SQL_EXPORT_INSERT_BATCH_ROWS
        };
        let sql_insert_conflict_policy = if sql_export {
            sql_insert_conflict_policy.unwrap_or(SqlInsertConflictPolicy::Strict)
        } else {
            SqlInsertConflictPolicy::Strict
        };
        ensure_sql_insert_conflict_policy(sql_dialect, sql_insert_conflict_policy)?;
        if sql_insert_conflict_policy != SqlInsertConflictPolicy::Strict
            && analytical_type_policy == AnalyticalTypePolicy::ExternalText
        {
            return Err(
                "SQL INSERT conflict handling requires a native reviewed dialect"
                    .to_string(),
            );
        }
        let metadata_required = structured_filters.is_some()
            || requested_sort.is_some()
            || analytical_export
            || sql_export;
        let table_columns = match manager.get_columns(&connection_id, &schema, &table).await {
            Ok(columns) => Some(columns),
            Err(error) if metadata_required => return Err(error.to_string()),
            Err(_) => None,
        };
        let mut sql_excluded_columns = if sql_export {
            manager
                .get_generated_columns(&connection_id, &schema, &table)
                .await
                .map_err(|error| error.to_string())?
                .into_iter()
                .collect::<HashSet<_>>()
        } else {
            HashSet::new()
        };
        let override_system_value = if sql_export {
            manager
                .sql_export_requires_identity_override(&connection_id, &schema, &table)
                .await
                .map_err(|error| error.to_string())?
        } else {
            false
        };
        if sql_export && sql_dialect == SqlExportDialect::Postgres {
            if let Some(columns) = table_columns.as_ref() {
                sql_excluded_columns.extend(
                    columns
                        .iter()
                        .filter(|column| is_postgres_tsvector_export_type(&column.data_type))
                        .map(|column| column.name.clone()),
                );
            }
        }
        if sql_export {
            if let Some(columns) = table_columns.as_ref() {
                sql_excluded_columns.extend(
                    columns
                        .iter()
                        .filter(|column| {
                            column.is_generated == Some(true) || column.is_hidden == Some(true)
                        })
                        .map(|column| column.name.clone()),
                );
            }
        }
        let sql_conflict_key_columns = if sql_insert_conflict_policy
            == SqlInsertConflictPolicy::Update
        {
            let columns = table_columns
                .as_ref()
                .ok_or_else(|| "Missing column metadata for SQL conflict updates".to_string())?;
            let primary_keys = columns
                .iter()
                .filter(|column| column.is_primary_key)
                .map(|column| column.name.clone())
                .collect::<Vec<_>>();
            if primary_keys.is_empty() {
                return Err(
                    "Updating conflicting SQL INSERT rows requires a primary key".to_string(),
                );
            }
            if primary_keys
                .iter()
                .any(|column| sql_excluded_columns.contains(column))
            {
                return Err(
                    "A generated primary-key column cannot be used for SQL conflict updates"
                        .to_string(),
                );
            }
            primary_keys
        } else {
            Vec::new()
        };
        let columns_metadata = table_columns.clone().map(column_lookup);
        let analytical_columns = table_columns.map(|columns| {
            columns
                .into_iter()
                .map(|column| ColumnDef {
                    name: column.name,
                    data_type: column.data_type,
                })
                .collect::<Vec<_>>()
        });
        let order_clause = if let Some(columns) = columns_metadata.as_ref() {
            build_table_order_by(kind, columns, requested_sort)?
        } else {
            None
        };
        let order = order_clause.as_deref();
        let (filter_clause, params, use_parameterized_query) = if let Some(filters) =
            structured_filters
        {
            let columns = columns_metadata
                .as_ref()
                .ok_or_else(|| "Missing column metadata".to_string())?;
            let (where_clause, params) = build_structured_filter_where(kind, columns, &filters)?;
            let filter_clause = if where_clause.is_empty() {
                None
            } else {
                Some(where_clause)
            };
            (filter_clause, params, true)
        } else {
            (
                validated_raw_filter_sql(kind, filter_sql.as_deref())?,
                Vec::new(),
                false,
            )
        };
        let filter = filter_clause.as_deref();
        let file_path = export_file_path(&app, &schema, &table, format)?;
        let (batch_tx, batch_rx) = mpsc::channel(TABLE_EXPORT_BUFFERED_PAGES);
        let writer_handle = tokio::task::spawn_blocking({
            let writer_app = app.clone();
            let writer_export_id = export_id.clone();
            let writer_schema = schema.clone();
            let writer_table = table.clone();
            let writer_progress_rows = Arc::clone(&progress_rows);
            let writer_progress_batches = Arc::clone(&progress_batches);
            let writer_cancel_rx = cancel_rx.clone();
            move || {
                write_table_export_stream(
                    TableExportWriterContext {
                        app: Some(writer_app),
                        export_id: writer_export_id,
                        final_path: file_path,
                        kind,
                        sql_dialect,
                        override_system_value,
                        sql_insert_batch_rows,
                        sql_insert_conflict_policy,
                        sql_conflict_key_columns,
                        analytical_type_policy,
                        schema: writer_schema,
                        table: writer_table,
                        format,
                        encoding,
                        xlsx_auto_filter,
                        progress_rows: writer_progress_rows,
                        progress_batches: writer_progress_batches,
                    },
                    batch_rx,
                    writer_cancel_rx,
                )
            }
        });
        let mut offset = 0_u64;
        let producer_result: Result<(), String> = async {
            loop {
                if *cancel_rx.borrow() {
                    return Err(format!(
                        "{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"
                    ));
                }
                let limit = match max_rows {
                    Some(max_rows) => {
                        let remaining = max_rows.saturating_sub(offset);
                        if remaining == 0 {
                            break;
                        }
                        (page_size as u64).min(remaining) as u32
                    }
                    None => page_size,
                };
                let page_sql = kind.paged_table_query_with_order(
                    schema_option(&schema),
                    &table,
                    filter,
                    order,
                    limit,
                    offset,
                );
                let query_result = if use_parameterized_query {
                    tokio::select! {
                        result = manager.query_parameterized(&connection_id, &page_sql, &params) => result,
                        changed = cancel_rx.changed() => {
                            let _ = changed;
                            return Err(format!(
                                "{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"
                            ));
                        }
                    }
                } else {
                    tokio::select! {
                        result = manager.query(
                            &connection_id,
                            &page_sql,
                            None,
                            None,
                            Some(export_id.clone()),
                        ) => result,
                        changed = cancel_rx.changed() => {
                            let _ = changed;
                            return Err(format!(
                                "{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"
                            ));
                        }
                    }
                };
                if *cancel_rx.borrow() {
                    return Err(format!(
                        "{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"
                    ));
                }
                let mut results = query_result.map_err(|error| error.to_string())?;
                let result = results
                    .drain(..)
                    .next()
                    .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));
                let page_rows = result.rows.len() as u64;
                let batch_columns = if let Some(columns) = analytical_columns.as_ref() {
                    if columns
                        .iter()
                        .map(|column| column.name.as_str())
                        .ne(result.columns.iter().map(|column| column.name.as_str()))
                    {
                        return Err(
                            "Analytical export query columns do not match table metadata"
                                .to_string(),
                        );
                    }
                    columns.clone()
                } else {
                    result.columns
                };
                let (batch_columns, batch_rows) = if sql_export {
                    filter_sql_export_batch(
                        batch_columns,
                        result.rows,
                        &sql_excluded_columns,
                    )?
                } else {
                    (batch_columns, result.rows)
                };
                let message = TableExportWriterMessage::Batch {
                    columns: batch_columns,
                    rows: batch_rows,
                };
                tokio::select! {
                    sent = batch_tx.send(message) => {
                        if sent.is_err() {
                            return Err(TABLE_EXPORT_WRITER_CLOSED.to_string());
                        }
                    }
                    changed = cancel_rx.changed() => {
                        let _ = changed;
                        return Err(format!(
                            "{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"
                        ));
                    }
                }
                if page_rows == 0 {
                    break;
                }
                offset += page_rows;
                if page_rows < limit as u64 {
                    break;
                }
            }
            tokio::select! {
                sent = batch_tx.send(TableExportWriterMessage::Finish) => {
                    if sent.is_err() {
                        return Err(TABLE_EXPORT_WRITER_CLOSED.to_string());
                    }
                }
                changed = cancel_rx.changed() => {
                    let _ = changed;
                    return Err(format!(
                        "{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"
                    ));
                }
            }
            Ok(())
        }
        .await;
        drop(batch_tx);
        let writer_result = writer_handle
            .await
            .map_err(|error| format!("Export writer task failed: {error}"))?;
        match (producer_result, writer_result) {
            (Ok(()), writer_result) => writer_result,
            (Err(producer_error), Err(writer_error))
                if producer_error == TABLE_EXPORT_WRITER_CLOSED =>
            {
                Err(writer_error)
            }
            (Err(producer_error), _) => Err(producer_error),
        }
    }
    .await;

    let cancellation_requested = *cancel_rx.borrow();
    cancellation.take(&export_id).await;
    let (rows_exported, batches, status, message) = match &result {
        Ok(export) => (
            export.rows_exported,
            export.batches,
            "done",
            Some("Export completed".to_string()),
        ),
        Err(error) if cancellation_requested || error.contains(TABLE_EXPORT_CANCELLED) => (
            progress_rows.load(Ordering::Relaxed),
            progress_batches.load(Ordering::Relaxed),
            "cancelled",
            Some("Export cancelled; partial file removed".to_string()),
        ),
        Err(_) => (
            progress_rows.load(Ordering::Relaxed),
            progress_batches.load(Ordering::Relaxed),
            "error",
            Some("Export failed; partial file removed".to_string()),
        ),
    };
    let _ = app.emit(
        TABLE_EXPORT_PROGRESS_EVENT,
        TableExportProgress {
            export_id: export_id.clone(),
            rows_exported,
            batches,
            terminal: true,
            status: status.to_string(),
            message,
        },
    );

    let mut result = result;
    if let Ok(export) = result.as_mut() {
        export.max_rows = max_rows;
    }
    if let Some(project_id) = normalized_table_export_project_id(project_id.as_deref()) {
        let (report_status, report_error) = match &result {
            Ok(_) => (TableExportReportStatus::Done, None),
            Err(error) if cancellation_requested || error.contains(TABLE_EXPORT_CANCELLED) => (
                TableExportReportStatus::Cancelled,
                Some("Export cancelled; partial file removed.".to_string()),
            ),
            Err(_) => (
                TableExportReportStatus::Error,
                Some("Export failed; partial file removed.".to_string()),
            ),
        };
        let report_id = table_export_report_id(&export_id);
        let report = TableExportReport {
            id: report_id.clone(),
            project_id,
            export_id: export_id.clone(),
            connection_id: connection_id.clone(),
            driver: canonical_driver_name(&driver)
                .unwrap_or_else(|| driver.trim())
                .to_ascii_lowercase(),
            schema: schema.clone(),
            table: table.clone(),
            format,
            encoding,
            rows_exported,
            batches,
            max_rows,
            status: report_status,
            started_at,
            finished_at: current_table_timestamp_millis(),
            error: report_error,
        };
        match persist_table_export_report(meta_store.inner(), &report).await {
            Ok(()) => {
                if let Ok(export) = result.as_mut() {
                    export.report_id = Some(report_id);
                }
            }
            Err(error) => tracing::warn!(error = %error, "table export report was not persisted"),
        }
    }

    match result {
        Ok(export) => Ok(Response::ok(export)),
        Err(error) if cancellation_requested || error.contains(TABLE_EXPORT_CANCELLED) => {
            Ok(Response::err(
                TABLE_EXPORT_CANCELLED,
                "Export cancelled and the partial file was removed.",
            ))
        }
        Err(error) => Ok(Response::err("EXPORT_TABLE_DATA_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn cancel_table_export(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, TableExportCancellationState>,
    export_id: String,
) -> Result<Response<String>, String> {
    let Some(handle) = cancellation.cancellation_handle(export_id.trim()).await else {
        return Ok(Response::err(
            "TABLE_EXPORT_NOT_FOUND",
            &format!("Table export is not active: {}", export_id.trim()),
        ));
    };
    let _ = handle.sender.send(true);
    let backend_cancelled = manager
        .cancel_query(&handle.connection_id, export_id.trim())
        .await
        .unwrap_or(false);
    Ok(Response::ok(
        if backend_cancelled {
            "Export cancellation requested on the database backend"
        } else {
            "Export cancellation requested"
        }
        .to_string(),
    ))
}

/// Lists privacy-bounded terminal export reports for one project connection.
/// Report metadata deliberately excludes output file paths and query contents.
#[tauri::command]
pub async fn list_table_export_reports(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    connection_id: String,
    limit: Option<usize>,
) -> Result<Response<Vec<TableExportReport>>, String> {
    let project_id = normalized_table_export_project_id(Some(&project_id)).ok_or_else(|| {
        "A valid project id is required to read table export reports.".to_string()
    })?;
    let mut reports = meta_store
        .get_children(
            &project_id,
            Some(TABLE_EXPORT_REPORT_PARENT_ID),
            &connection_id,
        )
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|resource| resource.kind == TABLE_EXPORT_REPORT_KIND)
        .filter_map(|resource| serde_json::from_value::<TableExportReport>(resource.metadata).ok())
        .collect::<Vec<_>>();
    reports.sort_by_key(|report| std::cmp::Reverse(report.started_at));
    reports.truncate(limit.unwrap_or(20).clamp(1, 100));
    Ok(Response::ok(reports))
}
