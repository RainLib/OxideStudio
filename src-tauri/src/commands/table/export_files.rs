//! Export files for table operations.

use super::export_types::TableExportFormat;
use std::fs::create_dir_all;
use std::fs::remove_file;
use std::fs::rename;
use std::path::Path;
use std::path::PathBuf;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;
use tauri::AppHandle;
use tauri::Manager;

pub(super) fn sanitize_file_part(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let sanitized = sanitized.trim_matches('_');
    if sanitized.is_empty() {
        "table".to_string()
    } else {
        sanitized.to_string()
    }
}

pub(super) fn export_file_path(
    app: &AppHandle,
    schema: &str,
    table: &str,
    format: TableExportFormat,
) -> Result<PathBuf, String> {
    let mut dir = app.path().download_dir().map_err(|e| e.to_string())?;
    create_dir_all(&dir).map_err(|e| e.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let extension = match format {
        TableExportFormat::Arrow => "arrow",
        TableExportFormat::Csv => "csv",
        TableExportFormat::Json => "json",
        TableExportFormat::Jsonl => "jsonl",
        TableExportFormat::Markdown => "md",
        TableExportFormat::Parquet => "parquet",
        TableExportFormat::Sql => "sql",
        TableExportFormat::Tsv => "tsv",
        TableExportFormat::Xlsx => "xlsx",
    };
    let schema = sanitize_file_part(schema);
    let table = sanitize_file_part(table);
    dir.push(format!("{schema}_{table}_{timestamp}.{extension}"));
    Ok(dir)
}

/// A local export is not discoverable until all rows and the format footer are
/// written successfully. The guard deletes only its unique sibling partial
/// file on any error path; it never touches a user-selected final file.
pub(super) struct ExportTemporaryFile {
    pub(super) path: PathBuf,
    pub(super) finalized: bool,
}

impl ExportTemporaryFile {
    pub(super) fn create(final_path: &Path) -> Result<Self, String> {
        let file_name = final_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "Unable to derive export file name".to_string())?;
        let path =
            final_path.with_file_name(format!(".{file_name}.{}.partial", uuid::Uuid::new_v4()));
        Ok(Self {
            path,
            finalized: false,
        })
    }

    pub(super) fn finalize(&mut self, final_path: &Path) -> Result<(), String> {
        rename(&self.path, final_path).map_err(|error| error.to_string())?;
        self.finalized = true;
        Ok(())
    }
}

impl Drop for ExportTemporaryFile {
    fn drop(&mut self) {
        if !self.finalized {
            let _ = remove_file(&self.path);
        }
    }
}
