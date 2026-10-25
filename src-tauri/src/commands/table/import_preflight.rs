//! Import preflight for table operations.

use super::access::get_target_columns;
use super::import_csv::{
    canonical_import_columns, csv_delimiter, csv_import_reader, csv_import_row_selected,
    csv_import_source_columns, csv_record_values, resolve_csv_import_columns,
    resolve_csv_import_row_range,
};
use super::import_json_stream::stream_json_rows;
use super::import_preview::{validate_import_file, verify_import_file_digest};
use super::import_types::{
    default_table_import_mode, TableCsvImportOptions, TableCsvImportPreflight, TableImportFormat,
    TableImportMode, TableImportRowIssue, TableJsonImportPreflight,
};
use super::policy::table_data_dialect_for_connection;
use super::reports::table_import_mapping_digest;
use super::row_sql::{build_insert_mutation, column_lookup};
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ColumnInfo;
use crate::core::protocol::Response;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::State;

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn preflight_table_csv_import(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    database: Option<String>,
    file_path: String,
    first_row_header: Option<bool>,
    mode: Option<TableImportMode>,
    csv_options: Option<TableCsvImportOptions>,
    expected_file_digest: Option<String>,
) -> Result<Response<TableCsvImportPreflight>, String> {
    let kind = table_data_dialect_for_connection(&manager, &connection_id, &driver, true).await?;
    let path = PathBuf::from(file_path.trim());
    validate_import_file(&path, TableImportFormat::Csv)?;
    verify_import_file_digest(&path, expected_file_digest.as_deref())?;
    let database = database.as_deref();
    let target_columns = get_target_columns(&manager, &connection_id, database, &schema, &table)
        .await
        .map_err(|error| error.to_string())?;
    let ordered_columns = target_columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    let columns = column_lookup(target_columns);
    let row_range = resolve_csv_import_row_range(first_row_header, csv_options.as_ref())?;
    let mut reader = csv_import_reader(
        &path,
        false,
        csv_delimiter(&path, csv_options.as_ref())?,
        csv_options.as_ref().and_then(|options| options.encoding),
    )?;
    let (source_columns, consumed_records) =
        csv_import_source_columns(&mut reader, row_range, ordered_columns)?;
    let headers = resolve_csv_import_columns(&source_columns, &columns, csv_options.as_ref())?;
    let empty_fields_as_null = csv_options
        .as_ref()
        .and_then(|options| options.empty_fields_as_null)
        .unwrap_or(false);
    let trim_values = csv_options
        .as_ref()
        .and_then(|options| options.trim_values)
        .unwrap_or(false);
    let mut total_rows = 0_u64;
    let mut accepted_rows = 0_u64;
    let mut rejected_rows = 0_u64;
    let mut issues = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let row_number = consumed_records + index as u64 + 1;
        if row_number < row_range.data_start_row {
            continue;
        }
        if !csv_import_row_selected(row_range, row_number) {
            break;
        }
        total_rows += 1;
        let valid = record
            .map_err(|_| ())
            .and_then(|record| {
                csv_record_values(&headers, &record, empty_fields_as_null, trim_values)
                    .map_err(|_| ())
            })
            .and_then(|row| {
                build_insert_mutation(kind, &schema, &table, &columns, &row)
                    .map(|_| ())
                    .map_err(|_| ())
            })
            .is_ok();
        if valid {
            accepted_rows += 1;
        } else {
            rejected_rows += 1;
            if issues.len() < 100 {
                issues.push(TableImportRowIssue {
                    row_number,
                    code: "ROW_INVALID".to_string(),
                });
            }
        }
    }
    Ok(Response::ok(TableCsvImportPreflight {
        mapping_digest: table_import_mapping_digest(
            TableImportFormat::Csv,
            mode.unwrap_or_else(default_table_import_mode),
            first_row_header,
            csv_options.as_ref(),
        )?,
        total_rows,
        accepted_rows,
        rejected_rows,
        issues_truncated: rejected_rows > issues.len() as u64,
        issues,
    }))
}

pub(super) struct JsonImportPreflightCounters<'a> {
    pub(super) total_rows: &'a mut u64,
    pub(super) accepted_rows: &'a mut u64,
    pub(super) rejected_rows: &'a mut u64,
    pub(super) issues: &'a mut Vec<TableImportRowIssue>,
}

pub(super) fn observe_json_import_preflight_row(
    row_number: u64,
    row: BTreeMap<String, Value>,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    counters: JsonImportPreflightCounters<'_>,
) -> Result<(), String> {
    *counters.total_rows += 1;
    let valid = (|| {
        let headers = row.keys().cloned().collect::<Vec<_>>();
        let canonical_headers = canonical_import_columns(&headers, columns)?;
        let values = headers
            .into_iter()
            .zip(canonical_headers)
            .filter_map(|(source, target)| row.get(&source).cloned().map(|value| (target, value)))
            .collect::<BTreeMap<_, _>>();
        build_insert_mutation(kind, schema, table, columns, &values).map(|_| ())
    })()
    .is_ok();
    if valid {
        *counters.accepted_rows += 1;
    } else {
        *counters.rejected_rows += 1;
        if counters.issues.len() < 100 {
            counters.issues.push(TableImportRowIssue {
                row_number,
                code: "ROW_INVALID".to_string(),
            });
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn preflight_table_json_import(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    database: Option<String>,
    file_path: String,
    mode: Option<TableImportMode>,
    expected_file_digest: Option<String>,
) -> Result<Response<TableJsonImportPreflight>, String> {
    let kind = table_data_dialect_for_connection(&manager, &connection_id, &driver, true).await?;
    let path = PathBuf::from(file_path.trim());
    validate_import_file(&path, TableImportFormat::Json)?;
    let target_columns = get_target_columns(
        &manager,
        &connection_id,
        database.as_deref(),
        &schema,
        &table,
    )
    .await
    .map_err(|error| error.to_string())?;
    let columns = column_lookup(target_columns);
    tokio::task::spawn_blocking(move || {
        verify_import_file_digest(&path, expected_file_digest.as_deref())?;
        scan_json_import_preflight(
            &path,
            kind,
            &schema,
            &table,
            &columns,
            mode.unwrap_or_else(default_table_import_mode),
        )
        .map(Response::ok)
    })
    .await
    .map_err(|error| format!("JSON preflight worker failed: {error}"))?
}

pub(super) fn scan_json_import_preflight(
    path: &std::path::Path,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    mode: TableImportMode,
) -> Result<TableJsonImportPreflight, String> {
    let mut total_rows = 0_u64;
    let mut accepted_rows = 0_u64;
    let mut rejected_rows = 0_u64;
    let mut issues = Vec::new();
    let mut observe_row = |row_number, row| {
        observe_json_import_preflight_row(
            row_number,
            row,
            kind,
            schema,
            table,
            columns,
            JsonImportPreflightCounters {
                total_rows: &mut total_rows,
                accepted_rows: &mut accepted_rows,
                rejected_rows: &mut rejected_rows,
                issues: &mut issues,
            },
        )
    };
    stream_json_rows(path, &|| false, &mut observe_row)?;
    if total_rows == 0 {
        return Err("The JSON file does not contain any object rows".to_string());
    }
    Ok(TableJsonImportPreflight {
        mapping_digest: table_import_mapping_digest(TableImportFormat::Json, mode, None, None)?,
        total_rows,
        accepted_rows,
        rejected_rows,
        issues_truncated: rejected_rows > issues.len() as u64,
        issues,
    })
}
