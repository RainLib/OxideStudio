//! Import preview for table operations.

use super::import_json_stream::is_json_lines_path;
use super::import_types::{
    TableCsvImportPreview, TableImportFormat, TableJsonImportPreview, TableXlsxImportPreview,
};
use super::limits::{
    MAX_CSV_IMPORT_FILE_BYTES, MAX_CSV_IMPORT_PREVIEW_BYTES, MAX_JSON_IMPORT_FILE_BYTES,
    MAX_JSON_IMPORT_PREVIEW_ARRAY_ITEMS, MAX_JSON_IMPORT_PREVIEW_COLUMNS,
    MAX_JSON_IMPORT_PREVIEW_OBJECT_FIELDS, MAX_JSON_IMPORT_PREVIEW_ROWS,
    MAX_JSON_IMPORT_PREVIEW_STRING_CHARS, MAX_JSON_LINES_IMPORT_FILE_BYTES,
    MAX_XLSX_IMPORT_FILE_BYTES,
};
use crate::core::protocol::Response;
use serde_json::Value;
use sha2::Digest;
use sha2::Sha256;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::fs::metadata;
use std::fs::File;
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
        Value::Number(number)
            if number.as_i64().is_some_and(|value| {
                !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&value)
            }) || number
                .as_u64()
                .is_some_and(|value| value > 9_007_199_254_740_991) =>
        {
            Value::String(number.to_string())
        }
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

pub(super) use super::import_json_stream::stream_json_document_rows;

/// Bound the whole review payload as well as each nested display value.
fn append_json_preview_row(
    row: BTreeMap<String, Value>,
    columns: &mut BTreeSet<String>,
    samples: &mut Vec<BTreeMap<String, Value>>,
    sample_bytes: &mut usize,
) -> Result<bool, String> {
    columns.extend(row.keys().cloned());
    if columns.len() > MAX_JSON_IMPORT_PREVIEW_COLUMNS {
        return Err("JSON source exceeds 256 distinct fields".into());
    }
    let sample = row
        .into_iter()
        .map(|(key, value)| (key, bounded_json_import_preview_value(&value)))
        .collect::<BTreeMap<_, _>>();
    let bytes = serde_json::to_vec(&sample)
        .map_err(|e| e.to_string())?
        .len();
    if *sample_bytes + bytes > 2 * 1024 * 1024 {
        return Ok(false);
    }
    *sample_bytes += bytes;
    samples.push(sample);
    Ok(true)
}

pub(super) fn read_json_lines_import_preview(
    path: &Path,
) -> Result<TableJsonImportPreview, String> {
    let mut source_columns = BTreeSet::new();
    let mut sample_rows = Vec::new();
    let mut sample_bytes = 0;
    let mut seen_rows = 0_u64;
    let mut has_more_rows = false;
    const SAMPLE_DONE: &str = "JSON_PREVIEW_SAMPLE_COMPLETE";
    let result = super::import_json_stream::stream_json_rows(path, &|| false, &mut |_, row| {
        seen_rows += 1;
        if sample_rows.len() >= MAX_JSON_IMPORT_PREVIEW_ROWS {
            has_more_rows = true;
            return Err(SAMPLE_DONE.into());
        }
        if !append_json_preview_row(
            row,
            &mut source_columns,
            &mut sample_rows,
            &mut sample_bytes,
        )? {
            has_more_rows = true;
            return Err(SAMPLE_DONE.into());
        }
        Ok(())
    });
    if let Err(error) = result {
        if error != SAMPLE_DONE {
            return Err(error);
        }
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
    let mut sample_bytes = 0;
    let mut total_rows = 0_u64;
    let mut sample_full = false;
    let mut collect_row = |_row_number: u64, row: BTreeMap<String, Value>| {
        total_rows += 1;
        if !sample_full && sample_rows.len() < MAX_JSON_IMPORT_PREVIEW_ROWS {
            sample_full = !append_json_preview_row(
                row,
                &mut source_columns,
                &mut sample_rows,
                &mut sample_bytes,
            )?;
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
        truncated: total_rows > sample_rows.len() as u64,
        sample_rows,
        total_rows: Some(total_rows),
    })
}

#[cfg(test)]
pub(super) use super::import_xlsx_values::{validate_xlsx_headers, xlsx_cell_value};

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

pub(super) fn read_xlsx_import_preview(path: &Path) -> Result<TableXlsxImportPreview, String> {
    validate_import_file(path, TableImportFormat::Xlsx)?;
    let mut sample_rows = Vec::new();
    let mut bytes = 0;
    let mut sample_full = false;
    let info = super::import_xlsx_stream::stream_xlsx_rows(path, &|| false, &mut |_, row| {
        if !sample_full && sample_rows.len() < MAX_JSON_IMPORT_PREVIEW_ROWS {
            let row = row
                .into_iter()
                .map(|(key, value)| (key, bounded_json_import_preview_value(&value)))
                .collect::<BTreeMap<_, _>>();
            let size = serde_json::to_vec(&row).map_err(|e| e.to_string())?.len();
            if bytes + size > 1024 * 1024 {
                sample_full = true;
            } else {
                bytes += size;
                sample_rows.push(row);
            }
        }
        Ok(())
    })?;
    Ok(TableXlsxImportPreview {
        file_name: import_file_name(path, "XLSX data"),
        total_bytes: metadata(path).map_err(|e| e.to_string())?.len(),
        content_digest: import_file_digest(path)?,
        sheet_name: info.sheet_name,
        source_columns: info.source_columns,
        truncated: info.total_rows > sample_rows.len() as u64,
        sample_rows,
        total_rows: info.total_rows,
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
