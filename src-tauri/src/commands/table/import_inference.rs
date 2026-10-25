//! Import inference for table operations.

use super::ddl_types::CreateTableColumn;
use super::import_csv::{
    csv_delimiter, csv_import_reader, csv_import_row_selected, csv_import_source_columns,
    resolve_csv_import_row_range,
};
use super::import_json_stream::{stream_json_rows, JSON_ROW_COLUMNS};
use super::import_preview::{import_file_digest, validate_import_file, verify_import_file_digest};
use super::import_types::{
    TableCsvColumnMapping, TableCsvImportOptions, TableImportColumnInference, TableImportFormat,
};
use super::sqlite_ddl::is_sqlite_driver;
use crate::core::dialect::DatabaseKind;
use crate::core::protocol::Response;
use chrono::DateTime;
use chrono::NaiveDate;
use chrono::NaiveDateTime;
use serde_json::Value;
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::collections::HashSet;
use std::path::Path;
use std::path::PathBuf;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ImportInferredType {
    Boolean,
    Integer,
    Decimal,
    Date,
    Timestamp,
    Json,
    Text,
}

pub(super) fn merge_import_inferred_type(
    current: Option<ImportInferredType>,
    next: ImportInferredType,
) -> ImportInferredType {
    let Some(current) = current else {
        return next;
    };
    if current == next {
        return current;
    }
    match (current, next) {
        (ImportInferredType::Text, _) | (_, ImportInferredType::Text) => ImportInferredType::Text,
        (ImportInferredType::Integer, ImportInferredType::Decimal)
        | (ImportInferredType::Decimal, ImportInferredType::Integer) => ImportInferredType::Decimal,
        (ImportInferredType::Date, ImportInferredType::Timestamp)
        | (ImportInferredType::Timestamp, ImportInferredType::Date) => {
            ImportInferredType::Timestamp
        }
        _ => ImportInferredType::Text,
    }
}

pub(super) fn import_numeric_without_thousands(value: &str) -> Cow<'_, str> {
    let value = value.trim();
    if !value.contains(',') {
        return Cow::Borrowed(value);
    }
    let unsigned = value.trim_start_matches(['+', '-']);
    let (mantissa, exponent) = match unsigned.find(['e', 'E']) {
        Some(index) => (&unsigned[..index], Some(&unsigned[index + 1..])),
        None => (unsigned, None),
    };
    if exponent.is_some_and(|value| {
        value.is_empty()
            || !value
                .trim_start_matches(['+', '-'])
                .bytes()
                .all(|byte| byte.is_ascii_digit())
    }) {
        return Cow::Borrowed(value);
    }
    let mut mantissa_parts = mantissa.split('.');
    let integer = mantissa_parts.next().unwrap_or_default();
    let fraction = mantissa_parts.next();
    if mantissa_parts.next().is_some()
        || integer.is_empty()
        || fraction.is_some_and(|part| !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Cow::Borrowed(value);
    }
    let mut groups = integer.split(',');
    let Some(first) = groups.next() else {
        return Cow::Borrowed(value);
    };
    if !(1..=3).contains(&first.len()) || !first.bytes().all(|byte| byte.is_ascii_digit()) {
        return Cow::Borrowed(value);
    }
    if !groups
        .clone()
        .all(|group| group.len() == 3 && group.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Cow::Borrowed(value);
    }
    Cow::Owned(value.replace(',', ""))
}

pub(super) fn import_string_inferred_type(value: &str) -> ImportInferredType {
    let value = value.trim();
    if value.is_empty() {
        return ImportInferredType::Text;
    }
    if DateTime::parse_from_rfc3339(value).is_ok()
        || [
            "%Y-%m-%d %H:%M:%S%.f",
            "%Y-%m-%dT%H:%M:%S%.f",
            "%Y/%m/%d %H:%M:%S%.f",
            "%Y/%m/%dT%H:%M:%S%.f",
        ]
        .iter()
        .any(|format| NaiveDateTime::parse_from_str(value, format).is_ok())
    {
        return ImportInferredType::Timestamp;
    }
    if ["%Y-%m-%d", "%Y/%m/%d"]
        .iter()
        .any(|format| NaiveDate::parse_from_str(value, format).is_ok())
    {
        return ImportInferredType::Date;
    }
    let numeric = import_numeric_without_thousands(value);
    let numeric = numeric.as_ref();
    let unsigned = numeric.trim_start_matches(['+', '-']);
    if unsigned.len() > 1 && unsigned.starts_with('0') && unsigned.as_bytes()[1].is_ascii_digit() {
        return ImportInferredType::Text;
    }
    if numeric.parse::<i64>().is_ok() || numeric.parse::<u64>().is_ok() {
        return ImportInferredType::Integer;
    }
    if (numeric.contains('.') || numeric.contains('e') || numeric.contains('E'))
        && numeric.parse::<f64>().is_ok_and(|value| value.is_finite())
    {
        return ImportInferredType::Decimal;
    }
    ImportInferredType::Text
}

pub(super) fn import_value_inferred_type(value: &Value) -> Option<ImportInferredType> {
    match value {
        Value::Null => None,
        Value::Bool(_) => Some(ImportInferredType::Boolean),
        Value::Number(number) if number.is_i64() || number.is_u64() => {
            Some(ImportInferredType::Integer)
        }
        Value::Number(_) => Some(ImportInferredType::Decimal),
        Value::String(value) => Some(import_string_inferred_type(value)),
        Value::Array(_) | Value::Object(_) => Some(ImportInferredType::Json),
    }
}

pub(super) fn inferred_import_data_type(
    inferred: ImportInferredType,
    driver: &str,
) -> Result<String, String> {
    if is_sqlite_driver(driver) {
        return Ok(match inferred {
            ImportInferredType::Boolean | ImportInferredType::Integer => "INTEGER",
            ImportInferredType::Decimal => "REAL",
            ImportInferredType::Date
            | ImportInferredType::Timestamp
            | ImportInferredType::Json
            | ImportInferredType::Text => "TEXT",
        }
        .to_string());
    }
    match DatabaseKind::from_str(driver).map_err(|_| {
        "Create-from-file is available for bundled PostgreSQL, MySQL, and SQLite connections."
            .to_string()
    })? {
        DatabaseKind::Postgres => Ok(match inferred {
            ImportInferredType::Boolean => "BOOLEAN",
            ImportInferredType::Integer => "BIGINT",
            ImportInferredType::Decimal => "DOUBLE PRECISION",
            ImportInferredType::Date => "DATE",
            ImportInferredType::Timestamp => "TIMESTAMP",
            ImportInferredType::Json => "JSONB",
            ImportInferredType::Text => "TEXT",
        }
        .to_string()),
        DatabaseKind::Mysql => Ok(match inferred {
            ImportInferredType::Boolean => "TINYINT(1)",
            ImportInferredType::Integer => "BIGINT",
            ImportInferredType::Decimal => "DOUBLE",
            ImportInferredType::Date => "DATE",
            ImportInferredType::Timestamp => "DATETIME",
            ImportInferredType::Json => "JSON",
            ImportInferredType::Text => "TEXT",
        }
        .to_string()),
    }
}

pub(super) fn validated_import_column_names(
    source_columns: &[String],
) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    source_columns
        .iter()
        .map(|value| value.trim())
        .enumerate()
        .map(|(index, value)| {
            if value.is_empty() {
                return Err(format!("Source column {} has no name", index + 1));
            }
            if value.chars().any(char::is_control) {
                return Err(format!(
                    "Source column {} contains a control character",
                    index + 1
                ));
            }
            if !seen.insert(value.to_ascii_lowercase()) {
                return Err(format!("Source column name is duplicated: {value}"));
            }
            Ok(value.to_string())
        })
        .collect()
}

pub(super) fn create_table_columns_from_inference(
    source_columns: Vec<String>,
    inferred_types: Vec<Option<ImportInferredType>>,
    driver: &str,
) -> Result<Vec<CreateTableColumn>, String> {
    let source_columns = validated_import_column_names(&source_columns)?;
    if source_columns.len() != inferred_types.len() {
        return Err("Import type inference lost source-column alignment".to_string());
    }
    source_columns
        .into_iter()
        .zip(inferred_types)
        .map(|(name, inferred)| {
            Ok(CreateTableColumn {
                name,
                data_type: inferred_import_data_type(
                    inferred.unwrap_or(ImportInferredType::Text),
                    driver,
                )?,
                length: None,
                is_primary_key: false,
                is_not_null: false,
                is_auto_increment: false,
                comment: None,
            })
        })
        .collect()
}

pub(super) fn infer_csv_import_columns(
    path: &Path,
    driver: &str,
    first_row_header: Option<bool>,
    csv_options: Option<&TableCsvImportOptions>,
) -> Result<(Vec<CreateTableColumn>, u64, TableCsvImportOptions), String> {
    let row_range = resolve_csv_import_row_range(first_row_header, csv_options)?;
    let mut reader = csv_import_reader(
        path,
        false,
        csv_delimiter(path, csv_options)?,
        csv_options.and_then(|options| options.encoding),
    )?;
    let (mut source_columns, consumed_records) = if row_range.title_row.is_some() {
        csv_import_source_columns(&mut reader, row_range, Vec::new())?
    } else {
        (Vec::new(), 0)
    };
    let trim_values = csv_options
        .and_then(|options| options.trim_values)
        .unwrap_or(false);
    let mut inferred_types = Vec::<Option<ImportInferredType>>::new();
    let mut total_rows = 0_u64;
    for (index, record) in reader.records().enumerate() {
        let row_number = consumed_records + index as u64 + 1;
        if row_number < row_range.data_start_row {
            continue;
        }
        if !csv_import_row_selected(row_range, row_number) {
            break;
        }
        let record = record.map_err(|error| error.to_string())?;
        if source_columns.is_empty() {
            source_columns = (1..=record.len())
                .map(|index| format!("column_{index}"))
                .collect();
            inferred_types.resize(source_columns.len(), None);
        }
        if record.len() != source_columns.len() {
            return Err(format!(
                "CSV row {row_number} has {} values but {} columns were expected",
                record.len(),
                source_columns.len()
            ));
        }
        if inferred_types.is_empty() {
            inferred_types.resize(source_columns.len(), None);
        }
        for (inferred, value) in inferred_types.iter_mut().zip(record.iter()) {
            let value = if trim_values { value.trim() } else { value };
            *inferred = Some(merge_import_inferred_type(
                *inferred,
                import_string_inferred_type(value),
            ));
        }
        total_rows += 1;
    }
    if total_rows == 0 {
        return Err("The selected CSV range does not contain any data rows".to_string());
    }
    let columns =
        create_table_columns_from_inference(source_columns.clone(), inferred_types, driver)?;
    let mut options = csv_options.cloned().unwrap_or_default();
    options.column_mapping = columns
        .iter()
        .enumerate()
        .map(|(source_index, column)| TableCsvColumnMapping {
            source_index,
            target_column: Some(column.name.clone()),
        })
        .collect();
    Ok((columns, total_rows, options))
}

#[cfg(test)]
pub(super) fn infer_materialized_import_columns(
    rows: Vec<BTreeMap<String, Value>>,
    driver: &str,
) -> Result<(Vec<CreateTableColumn>, u64), String> {
    if rows.is_empty() {
        return Err("The import file does not contain any object rows".to_string());
    }
    let source_columns = rows
        .iter()
        .flat_map(|row| row.keys().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut inferred_types = vec![None; source_columns.len()];
    for row in &rows {
        for (index, column) in source_columns.iter().enumerate() {
            if let Some(value) = row.get(column).and_then(import_value_inferred_type) {
                inferred_types[index] =
                    Some(merge_import_inferred_type(inferred_types[index], value));
            }
        }
    }
    let total_rows = rows.len() as u64;
    Ok((
        create_table_columns_from_inference(source_columns, inferred_types, driver)?,
        total_rows,
    ))
}

/// JSON Lines imports are intentionally streamed during inference.  The
/// same bounded row reader also handles regular JSON documents/arrays; no
/// complete source is materialized merely to propose a target table.
pub(super) fn infer_streamed_import_columns(
    path: &Path,
    driver: &str,
    format: TableImportFormat,
) -> Result<(Vec<CreateTableColumn>, u64), String> {
    let mut source_columns = BTreeSet::new();
    let mut inferred_types = BTreeMap::<String, Option<ImportInferredType>>::new();
    let mut total_rows = 0_u64;
    let mut observe = |_, row: super::import_types::ImportRow| {
        for (column, value) in row {
            source_columns.insert(column.clone());
            let limit = if matches!(format, TableImportFormat::Xlsx) {
                super::limits::XLSX_MAX_COLUMNS
            } else {
                JSON_ROW_COLUMNS
            };
            if source_columns.len() > limit {
                return Err(format!("Import source exceeds {limit} distinct fields"));
            }
            if let Some(next) = import_value_inferred_type(&value) {
                let inferred = inferred_types.entry(column).or_insert(None);
                *inferred = Some(merge_import_inferred_type(*inferred, next));
            }
        }
        total_rows += 1;
        Ok(())
    };
    match format {
        TableImportFormat::Json => stream_json_rows(path, &|| false, &mut observe)?,
        TableImportFormat::Xlsx => {
            super::import_xlsx_stream::stream_xlsx_rows(path, &|| false, &mut observe)?;
        }
        TableImportFormat::Csv => return Err("CSV has its own inference reader".into()),
    }

    if total_rows == 0 {
        return Err("The import file does not contain any object rows".to_string());
    }
    let source_columns = source_columns.into_iter().collect::<Vec<_>>();
    let inferred_types = source_columns
        .iter()
        .map(|column| inferred_types.get(column).copied().flatten())
        .collect();
    Ok((
        create_table_columns_from_inference(source_columns, inferred_types, driver)?,
        total_rows,
    ))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn infer_table_import_columns(
    driver: String,
    file_path: String,
    format: TableImportFormat,
    first_row_header: Option<bool>,
    csv_options: Option<TableCsvImportOptions>,
    expected_file_digest: Option<String>,
) -> Result<Response<TableImportColumnInference>, String> {
    let path = PathBuf::from(file_path.trim());
    let driver_for_worker = driver.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        validate_import_file(&path, format)?;
        verify_import_file_digest(&path, expected_file_digest.as_deref())?;
        let content_digest = import_file_digest(&path)?;
        let (columns, total_rows, csv_options) = match format {
            TableImportFormat::Csv => {
                let (columns, total_rows, csv_options) = infer_csv_import_columns(
                    &path,
                    &driver_for_worker,
                    first_row_header,
                    csv_options.as_ref(),
                )?;
                (columns, total_rows, Some(csv_options))
            }
            TableImportFormat::Json => {
                let (columns, total_rows) = infer_streamed_import_columns(
                    &path,
                    &driver_for_worker,
                    TableImportFormat::Json,
                )?;
                (columns, total_rows, None)
            }
            TableImportFormat::Xlsx => {
                let (columns, total_rows) = infer_streamed_import_columns(
                    &path,
                    &driver_for_worker,
                    TableImportFormat::Xlsx,
                )?;
                (columns, total_rows, None)
            }
        };
        Ok::<_, String>(TableImportColumnInference {
            columns,
            total_rows,
            content_digest,
            csv_options,
        })
    })
    .await
    .map_err(|error| format!("Import inference worker failed: {error}"))?;

    match result {
        Ok(inference) => Ok(Response::ok(inference)),
        Err(error) => Ok(Response::err("INFER_TABLE_IMPORT_COLUMNS_ERROR", &error)),
    }
}

#[cfg(test)]
pub(super) fn infer_json_lines_import_columns(
    path: &Path,
    driver: &str,
) -> Result<(Vec<CreateTableColumn>, u64), String> {
    infer_streamed_import_columns(path, driver, TableImportFormat::Json)
}
