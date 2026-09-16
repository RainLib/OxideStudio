//! Import preview for table operations.
use serde::Deserialize;

use super::import_json::is_json_lines_path;
use super::import_types::{
    TableCsvImportPreview, TableImportFormat, TableJsonImportPreview, TableXlsxImportPreview,
};
use super::limits::{
    MAX_CSV_IMPORT_FILE_BYTES, MAX_CSV_IMPORT_PREVIEW_BYTES, MAX_IMPORT_ROWS,
    MAX_JSON_IMPORT_FILE_BYTES, MAX_JSON_IMPORT_PREVIEW_ARRAY_ITEMS,
    MAX_JSON_IMPORT_PREVIEW_COLUMNS, MAX_JSON_IMPORT_PREVIEW_OBJECT_FIELDS,
    MAX_JSON_IMPORT_PREVIEW_ROWS, MAX_JSON_IMPORT_PREVIEW_STRING_CHARS,
    MAX_JSON_LINES_IMPORT_FILE_BYTES, MAX_XLSX_IMPORT_FILE_BYTES, TABLE_IMPORT_CANCELLED,
};
use crate::core::protocol::Response;
use calamine::open_workbook_auto;
use calamine::Data;
use calamine::Reader;
use serde::de::value::MapAccessDeserializer;
use serde::de::Error as DeError;
use serde::de::MapAccess;
use serde::de::SeqAccess;
use serde::de::Visitor;
use serde_json::Value;
use sha2::Digest;
use sha2::Sha256;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::collections::HashSet;
use std::fs::metadata;
use std::fs::File;
use std::io::BufRead;
use std::io::BufReader;
use std::io::Read;
use std::path::Path;
use std::path::PathBuf;

pub(super) fn validate_import_file(path: &Path, format: TableImportFormat) -> Result<(), String> {
    let file_metadata = metadata(path).map_err(|error| error.to_string())?;
    if !file_metadata.is_file() {
        return Err("The selected import path is not a file".to_string());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let byte_limit = match format {
        TableImportFormat::Csv => MAX_CSV_IMPORT_FILE_BYTES,
        TableImportFormat::Json if matches!(extension.as_str(), "jsonl" | "ndjson") => {
            MAX_JSON_LINES_IMPORT_FILE_BYTES
        }
        TableImportFormat::Json => MAX_JSON_IMPORT_FILE_BYTES,
        TableImportFormat::Xlsx => MAX_XLSX_IMPORT_FILE_BYTES,
    };
    if file_metadata.len() > byte_limit {
        return Err(format!(
            "Import files are limited to {} MB",
            byte_limit / 1024 / 1024
        ));
    }

    let accepted = match format {
        TableImportFormat::Csv => matches!(extension.as_str(), "csv" | "tsv" | "txt"),
        TableImportFormat::Json => matches!(extension.as_str(), "json" | "jsonl" | "ndjson"),
        TableImportFormat::Xlsx => extension == "xlsx",
    };
    if accepted {
        Ok(())
    } else {
        Err(format!(
            "The selected file does not match the {format:?} format"
        ))
    }
}

/// Loads a safe, bounded CSV prefix for the review dialog selected through
/// Tauri's native file picker.  The caller retains the original path only for
/// the subsequent `import_table_data` invocation; no write occurs here.
pub(super) fn read_csv_import_preview(path: &Path) -> Result<TableCsvImportPreview, String> {
    validate_import_file(path, TableImportFormat::Csv)?;
    let total_bytes = metadata(path).map_err(|error| error.to_string())?.len();
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = vec![0_u8; total_bytes.min(MAX_CSV_IMPORT_PREVIEW_BYTES as u64) as usize];
    file.read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("CSV file")
        .to_string();
    Ok(TableCsvImportPreview {
        file_name,
        bytes,
        total_bytes,
        truncated: total_bytes > MAX_CSV_IMPORT_PREVIEW_BYTES as u64,
        content_digest: import_file_digest(path)?,
    })
}

#[tauri::command]
pub async fn preview_table_csv_import(
    file_path: String,
) -> Result<Response<TableCsvImportPreview>, String> {
    // A preview may read 32 MiB. Keep filesystem work off the async command
    // runtime so opening the import review cannot delay a live query, LSP
    // request, or cancellation message.
    let path = PathBuf::from(file_path.trim());
    let result = tauri::async_runtime::spawn_blocking(move || read_csv_import_preview(&path))
        .await
        .map_err(|error| format!("CSV preview worker failed: {error}"))?;

    match result {
        Ok(preview) => Ok(Response::ok(preview)),
        Err(error) => Ok(Response::err("PREVIEW_TABLE_CSV_IMPORT_ERROR", &error)),
    }
}

pub(super) fn import_file_name(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

pub(super) fn bounded_json_import_preview_value(value: &Value) -> Value {
    match value {
        Value::String(value) => {
            let mut bounded = value
                .chars()
                .take(MAX_JSON_IMPORT_PREVIEW_STRING_CHARS)
                .collect::<String>();
            if value
                .chars()
                .nth(MAX_JSON_IMPORT_PREVIEW_STRING_CHARS)
                .is_some()
            {
                bounded.push('…');
            }
            Value::String(bounded)
        }
        Value::Array(values) => Value::Array(
            values
                .iter()
                .take(MAX_JSON_IMPORT_PREVIEW_ARRAY_ITEMS)
                .map(bounded_json_import_preview_value)
                .collect(),
        ),
        Value::Object(values) => Value::Object(
            values
                .iter()
                .take(MAX_JSON_IMPORT_PREVIEW_OBJECT_FIELDS)
                .map(|(key, value)| (key.clone(), bounded_json_import_preview_value(value)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

/// Streams top-level JSON objects or array elements without first copying the
/// complete document into a `String`/`Value`. The callback owns the only row
/// retention policy, so preview and import can keep their existing bounded
/// memory contracts. JSON lines intentionally keeps its separate line reader.
pub(super) struct JsonImportRowVisitor<'a> {
    pub(super) is_cancelled: &'a dyn Fn() -> bool,
    pub(super) on_row: &'a mut dyn FnMut(u64, BTreeMap<String, Value>) -> Result<(), String>,
    pub(super) next_row_number: u64,
}

impl<'de> Visitor<'de> for JsonImportRowVisitor<'_> {
    type Value = ();

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a JSON object or an array of JSON objects")
    }

    fn visit_seq<A>(mut self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        while let Some(row) = sequence.next_element::<BTreeMap<String, Value>>()? {
            self.next_row_number += 1;
            if (self.is_cancelled)() {
                return Err(A::Error::custom(TABLE_IMPORT_CANCELLED));
            }
            (self.on_row)(self.next_row_number, row).map_err(A::Error::custom)?;
        }
        Ok(())
    }

    fn visit_map<A>(self, map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        if (self.is_cancelled)() {
            return Err(A::Error::custom(TABLE_IMPORT_CANCELLED));
        }
        let row = BTreeMap::<String, Value>::deserialize(MapAccessDeserializer::new(map))?;
        (self.on_row)(1, row).map_err(A::Error::custom)
    }
}

pub(super) fn stream_json_document_rows(
    path: &Path,
    is_cancelled: &dyn Fn() -> bool,
    on_row: &mut dyn FnMut(u64, BTreeMap<String, Value>) -> Result<(), String>,
) -> Result<(), String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut deserializer = serde_json::Deserializer::from_reader(BufReader::new(file));
    serde::de::Deserializer::deserialize_any(
        &mut deserializer,
        JsonImportRowVisitor {
            is_cancelled,
            on_row,
            next_row_number: 0,
        },
    )
    .map_err(|error| error.to_string())?;
    if is_cancelled() {
        return Err(TABLE_IMPORT_CANCELLED.to_string());
    }
    Ok(())
}

pub(super) fn read_json_lines_import_preview(
    path: &Path,
) -> Result<TableJsonImportPreview, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let reader = BufReader::new(file);
    let mut source_columns = BTreeSet::new();
    let mut sample_rows = Vec::new();
    let mut seen_rows = 0_u64;
    let mut has_more_rows = false;

    for (line_index, line) in reader.lines().enumerate() {
        let line = line.map_err(|error| error.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let value = serde_json::from_str::<Value>(&line)
            .map_err(|error| format!("Invalid JSON object on line {}: {error}", line_index + 1))?;
        let Value::Object(values) = value else {
            return Err(format!("JSON row {} is not an object", line_index + 1));
        };
        seen_rows += 1;
        if sample_rows.len() >= MAX_JSON_IMPORT_PREVIEW_ROWS {
            has_more_rows = true;
            break;
        }
        for column in values.keys().take(MAX_JSON_IMPORT_PREVIEW_COLUMNS) {
            source_columns.insert(column.clone());
        }
        sample_rows.push(
            values
                .into_iter()
                .map(|(key, value)| (key, bounded_json_import_preview_value(&value)))
                .collect(),
        );
    }

    if seen_rows == 0 {
        return Err("The JSON-lines file does not contain any object rows".to_string());
    }
    Ok(TableJsonImportPreview {
        file_name: import_file_name(path, "JSON data"),
        total_bytes: metadata(path).map_err(|error| error.to_string())?.len(),
        content_digest: import_file_digest(path)?,
        source_columns: source_columns.into_iter().collect(),
        sample_rows,
        total_rows: if has_more_rows { None } else { Some(seen_rows) },
        truncated: has_more_rows,
    })
}

pub(super) fn read_json_import_preview(path: &Path) -> Result<TableJsonImportPreview, String> {
    validate_import_file(path, TableImportFormat::Json)?;
    if is_json_lines_path(path) {
        return read_json_lines_import_preview(path);
    }
    let mut source_columns = BTreeSet::new();
    let mut sample_rows = Vec::new();
    let mut total_rows = 0_u64;
    let mut collect_row = |_row_number: u64, row: BTreeMap<String, Value>| {
        total_rows += 1;
        if sample_rows.len() < MAX_JSON_IMPORT_PREVIEW_ROWS {
            source_columns.extend(row.keys().take(MAX_JSON_IMPORT_PREVIEW_COLUMNS).cloned());
            sample_rows.push(
                row.into_iter()
                    .map(|(key, value)| (key, bounded_json_import_preview_value(&value)))
                    .collect(),
            );
        }
        Ok(())
    };
    stream_json_document_rows(path, &|| false, &mut collect_row)?;
    if total_rows == 0 {
        return Err("The JSON file does not contain any object rows".to_string());
    }
    Ok(TableJsonImportPreview {
        file_name: import_file_name(path, "JSON data"),
        total_bytes: metadata(path).map_err(|error| error.to_string())?.len(),
        content_digest: import_file_digest(path)?,
        source_columns: source_columns.into_iter().collect(),
        sample_rows,
        total_rows: Some(total_rows),
        truncated: total_rows > MAX_JSON_IMPORT_PREVIEW_ROWS as u64,
    })
}

pub(super) fn xlsx_cell_value(cell: &Data) -> Value {
    match cell {
        Data::Empty => Value::Null,
        Data::Int(value) => Value::Number((*value).into()),
        Data::Float(value) => serde_json::Number::from_f64(*value)
            .map(Value::Number)
            .unwrap_or_else(|| Value::String(value.to_string())),
        Data::String(value) | Data::DateTimeIso(value) | Data::DurationIso(value) => {
            Value::String(value.clone())
        }
        Data::Bool(value) => Value::Bool(*value),
        // Calamine retains Excel's native serial/date metadata. Rendering it
        // as text avoids quietly applying a timezone or epoch conversion in
        // the import layer; the target driver can still coerce it explicitly.
        Data::DateTime(value) => Value::String(value.to_string()),
        Data::Error(value) => Value::String(format!("Excel cell error: {value}")),
    }
}

pub(super) fn xlsx_header_value(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(value) => value.trim().to_string(),
        _ => cell.to_string().trim().to_string(),
    }
}

pub(super) fn validate_xlsx_headers(headers: &[String]) -> Result<(), String> {
    if headers.is_empty() {
        return Err("The XLSX worksheet does not contain any columns".to_string());
    }
    let mut normalized_headers = HashSet::new();
    for header in headers {
        let normalized = header.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return Err("XLSX column names cannot be empty".to_string());
        }
        if !normalized_headers.insert(normalized) {
            return Err("XLSX column names must be unique".to_string());
        }
    }
    Ok(())
}

/// Hash the complete source incrementally so the UI can bind an approved
/// preview to the exact file it later imports without placing a large file in
/// renderer memory. This digest is an integrity token only; it contains no
/// source row values and is never persisted.
pub(super) fn import_file_digest(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub(super) fn verify_import_file_digest(path: &Path, expected: Option<&str>) -> Result<(), String> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let expected = expected.trim().to_ascii_lowercase();
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid import preview digest".to_string());
    }
    let actual = import_file_digest(path)?;
    if actual != expected {
        return Err(
            "The import file changed after preview. Review the file again before importing."
                .to_string(),
        );
    }
    Ok(())
}

pub(super) type XlsxImportRows = (String, Vec<String>, Vec<BTreeMap<String, Value>>);

pub(super) fn xlsx_import_rows_with_cancel(
    path: &Path,
    is_cancelled: &dyn Fn() -> bool,
) -> Result<XlsxImportRows, String> {
    if is_cancelled() {
        return Err(TABLE_IMPORT_CANCELLED.to_string());
    }
    let mut workbook = open_workbook_auto(path)
        .map_err(|error| format!("Unable to read XLSX workbook: {error}"))?;
    if is_cancelled() {
        return Err(TABLE_IMPORT_CANCELLED.to_string());
    }
    let sheet_name = workbook
        .sheet_names()
        .into_iter()
        .next()
        .ok_or_else(|| "The XLSX workbook does not contain a worksheet".to_string())?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|error| format!("Unable to read worksheet '{sheet_name}': {error}"))?;
    if is_cancelled() {
        return Err(TABLE_IMPORT_CANCELLED.to_string());
    }
    let mut rows = range.rows();
    let headers = rows
        .find(|row| row.iter().any(|cell| !matches!(cell, Data::Empty)))
        .map(|row| row.iter().map(xlsx_header_value).collect::<Vec<_>>())
        .ok_or_else(|| "The XLSX worksheet does not contain a header row".to_string())?;
    validate_xlsx_headers(&headers)?;

    let mut values = Vec::new();
    for row in rows.filter(|row| row.iter().any(|cell| !matches!(cell, Data::Empty))) {
        if is_cancelled() {
            return Err(TABLE_IMPORT_CANCELLED.to_string());
        }
        if row
            .get(headers.len()..)
            .is_some_and(|extra| extra.iter().any(|cell| !matches!(cell, Data::Empty)))
        {
            return Err("An XLSX row contains values beyond the header columns".to_string());
        }
        values.push(
            headers
                .iter()
                .enumerate()
                .map(|(index, header)| {
                    (
                        header.clone(),
                        row.get(index).map(xlsx_cell_value).unwrap_or(Value::Null),
                    )
                })
                .collect::<BTreeMap<_, _>>(),
        );
    }
    Ok((sheet_name, headers, values))
}

pub(super) fn xlsx_import_rows(path: &Path) -> Result<XlsxImportRows, String> {
    xlsx_import_rows_with_cancel(path, &|| false)
}

pub(super) fn read_xlsx_import_preview(path: &Path) -> Result<TableXlsxImportPreview, String> {
    validate_import_file(path, TableImportFormat::Xlsx)?;
    let (sheet_name, source_columns, rows) = xlsx_import_rows(path)?;
    if rows.len() > MAX_IMPORT_ROWS {
        return Err(format!(
            "Imports are limited to {MAX_IMPORT_ROWS} rows per transaction"
        ));
    }
    let total_rows = rows.len() as u64;
    let truncated = rows.len() > MAX_JSON_IMPORT_PREVIEW_ROWS;
    let sample_rows = rows
        .into_iter()
        .take(MAX_JSON_IMPORT_PREVIEW_ROWS)
        .map(|row| {
            row.into_iter()
                .map(|(key, value)| (key, bounded_json_import_preview_value(&value)))
                .collect()
        })
        .collect();
    Ok(TableXlsxImportPreview {
        file_name: import_file_name(path, "XLSX data"),
        total_bytes: metadata(path).map_err(|error| error.to_string())?.len(),
        content_digest: import_file_digest(path)?,
        sheet_name,
        source_columns,
        sample_rows,
        total_rows,
        truncated,
    })
}

#[tauri::command]
pub async fn preview_table_json_import(
    file_path: String,
) -> Result<Response<TableJsonImportPreview>, String> {
    let path = PathBuf::from(file_path.trim());
    let result = tauri::async_runtime::spawn_blocking(move || read_json_import_preview(&path))
        .await
        .map_err(|error| format!("JSON preview worker failed: {error}"))?;
    match result {
        Ok(preview) => Ok(Response::ok(preview)),
        Err(error) => Ok(Response::err("PREVIEW_TABLE_JSON_IMPORT_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn preview_table_xlsx_import(
    file_path: String,
) -> Result<Response<TableXlsxImportPreview>, String> {
    let path = PathBuf::from(file_path.trim());
    let result = tauri::async_runtime::spawn_blocking(move || read_xlsx_import_preview(&path))
        .await
        .map_err(|error| format!("XLSX preview worker failed: {error}"))?;
    match result {
        Ok(preview) => Ok(Response::ok(preview)),
        Err(error) => Ok(Response::err("PREVIEW_TABLE_XLSX_IMPORT_ERROR", &error)),
    }
}
