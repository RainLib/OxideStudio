//! Import types for table operations.

use super::ddl_types::CreateTableColumn;
use super::limits::{TABLE_IMPORT_CANCELLED, TABLE_IMPORT_PROGRESS_EVENT};
use super::reports::validate_table_import_id;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::watch;
use tokio::sync::Mutex as AsyncMutex;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TableImportFormat {
    Csv,
    Json,
    Xlsx,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TableImportMode {
    Append,
    Truncate,
}

pub(super) fn default_table_import_mode() -> TableImportMode {
    TableImportMode::Append
}

/// The import plan intentionally contains only source-column indices and
/// target identifiers. It never carries source rows or credentials across the
/// IPC boundary, which keeps large native imports streamable and reviewable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCsvColumnMapping {
    pub source_index: usize,
    pub target_column: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCsvImportOptions {
    pub delimiter: Option<String>,
    pub first_row_header: Option<bool>,
    /// One-based record containing source column names. Zero disables the
    /// title row. This mirrors DBX while preserving `first_row_header` for
    /// older saved import plans.
    pub title_row: Option<u64>,
    /// One-based first source record to import.
    pub data_start_row: Option<u64>,
    /// One-based final source record to import. Zero means unbounded.
    pub last_data_row: Option<u64>,
    #[serde(default)]
    pub column_mapping: Vec<TableCsvColumnMapping>,
    pub empty_fields_as_null: Option<bool>,
    pub trim_values: Option<bool>,
    #[serde(default)]
    pub encoding: Option<TableImportTextEncoding>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CsvImportRowRange {
    pub(super) title_row: Option<u64>,
    pub(super) data_start_row: u64,
    pub(super) last_data_row: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TableImportTextEncoding {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-16le")]
    Utf16Le,
    #[serde(rename = "utf-16be")]
    Utf16Be,
    #[serde(rename = "gb18030")]
    Gb18030,
}

impl TableImportTextEncoding {
    pub(super) fn decoder_encoding(self) -> Option<&'static encoding_rs::Encoding> {
        match self {
            Self::Auto => None,
            Self::Utf8 => Some(encoding_rs::UTF_8),
            Self::Utf16Le => Some(encoding_rs::UTF_16LE),
            Self::Utf16Be => Some(encoding_rs::UTF_16BE),
            Self::Gb18030 => Some(encoding_rs::GBK),
        }
    }

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Auto => "automatic",
            Self::Utf8 => "UTF-8",
            Self::Utf16Le => "UTF-16 LE",
            Self::Utf16Be => "UTF-16 BE",
            Self::Gb18030 => "GB18030 / GBK",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableImportResult {
    pub import_id: String,
    pub file_path: String,
    pub rows_imported: u64,
    pub batches: u64,
    pub report_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableImportProgress {
    pub import_id: String,
    pub rows_imported: u64,
    pub batches: u64,
    pub total_rows: Option<u64>,
    pub terminal: bool,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Clone)]
pub(super) struct TableImportCancellationHandle {
    pub(super) sender: watch::Sender<bool>,
}

#[derive(Default)]
pub struct TableImportCancellationState(
    pub(super) Arc<AsyncMutex<HashMap<String, TableImportCancellationHandle>>>,
);

impl TableImportCancellationState {
    pub(super) async fn register(&self, import_id: &str) -> Result<watch::Receiver<bool>, String> {
        validate_table_import_id(import_id)?;
        let (sender, receiver) = watch::channel(false);
        let mut active = self.0.lock().await;
        if active.contains_key(import_id) {
            return Err(format!("Table import is already active: {import_id}"));
        }
        active.insert(
            import_id.to_string(),
            TableImportCancellationHandle { sender },
        );
        Ok(receiver)
    }

    pub(super) async fn cancellation_handle(
        &self,
        import_id: &str,
    ) -> Option<TableImportCancellationHandle> {
        self.0.lock().await.get(import_id).cloned()
    }

    pub(super) async fn take(&self, import_id: &str) {
        self.0.lock().await.remove(import_id);
    }
}

#[derive(Clone)]
pub(super) struct TableImportExecutionContext {
    pub(super) app: AppHandle,
    pub(super) import_id: String,
    pub(super) cancel_rx: watch::Receiver<bool>,
    pub(super) total_rows: Option<u64>,
}

impl TableImportExecutionContext {
    pub(super) fn with_total_rows(&self, total_rows: Option<u64>) -> Self {
        Self {
            total_rows,
            ..self.clone()
        }
    }

    pub(super) fn ensure_not_cancelled(&self) -> Result<(), String> {
        if *self.cancel_rx.borrow() {
            Err(TABLE_IMPORT_CANCELLED.to_string())
        } else {
            Ok(())
        }
    }

    pub(super) fn emit(
        &self,
        rows_imported: u64,
        batches: u64,
        terminal: bool,
        status: &str,
        message: Option<String>,
    ) {
        let _ = self.app.emit(
            TABLE_IMPORT_PROGRESS_EVENT,
            TableImportProgress {
                import_id: self.import_id.clone(),
                rows_imported,
                batches,
                total_rows: self.total_rows,
                terminal,
                status: status.to_string(),
                message,
            },
        );
    }

    pub(super) fn emit_running(&self, rows_imported: u64, batches: u64) {
        self.emit(
            rows_imported,
            batches,
            false,
            "running",
            Some("Import transaction is writing validated batches".to_string()),
        );
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TableImportReportStatus {
    Done,
    Cancelled,
    Error,
}

/// A terminal import audit record. Source paths, source digests, SQL, row
/// values, credentials, URLs, and raw driver errors are deliberately omitted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableImportReport {
    pub id: String,
    pub project_id: String,
    pub import_id: String,
    pub connection_id: String,
    pub driver: String,
    pub schema: String,
    pub table: String,
    pub format: TableImportFormat,
    #[serde(default = "default_table_import_mode")]
    pub mode: TableImportMode,
    pub mapping_digest: String,
    pub rows_imported: u64,
    pub batches: u64,
    pub status: TableImportReportStatus,
    pub started_at: i64,
    pub finished_at: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableImportRowIssue {
    pub row_number: u64,
    pub code: String,
}

/// A bounded, read-only full-file CSV preflight. Issues intentionally expose
/// row positions and stable categories only, never source values or SQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCsvImportPreflight {
    pub mapping_digest: String,
    pub total_rows: u64,
    pub accepted_rows: u64,
    pub rejected_rows: u64,
    pub issues: Vec<TableImportRowIssue>,
    pub issues_truncated: bool,
}

/// A bounded, read-only full-file JSON/JSONL preflight. It shares the CSV
/// contract so a desktop review can reject unmappable rows before opening a
/// transaction, while never returning row values or generated SQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableJsonImportPreflight {
    pub mapping_digest: String,
    pub total_rows: u64,
    pub accepted_rows: u64,
    pub rejected_rows: u64,
    pub issues: Vec<TableImportRowIssue>,
    pub issues_truncated: bool,
}

/// Bytes returned to the desktop review dialog. This read-only command
/// validates the selected CSV path and limits the renderer payload; it is
/// paired with the existing desktop import command rather than a general file
/// API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCsvImportPreview {
    pub file_name: String,
    pub bytes: Vec<u8>,
    pub total_bytes: u64,
    pub truncated: bool,
    /// SHA-256 of the complete reviewed file, not only the preview prefix.
    /// The desktop sends this back at execution time to reject a changed file.
    pub content_digest: String,
}

/// Structured, read-only JSON preview returned after a user selects a JSON,
/// JSONL, or NDJSON file. It deliberately contains only a bounded leading
/// sample; the original path is still revalidated by `import_table_data`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableJsonImportPreview {
    pub file_name: String,
    pub total_bytes: u64,
    pub content_digest: String,
    pub source_columns: Vec<String>,
    pub sample_rows: Vec<BTreeMap<String, Value>>,
    /// Present for bounded `.json` documents. Large JSON-lines sources only
    /// inspect their leading sample before confirmation, so their full count
    /// remains intentionally unknown until the streaming transaction runs.
    pub total_rows: Option<u64>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableXlsxImportPreview {
    pub file_name: String,
    pub total_bytes: u64,
    pub content_digest: String,
    pub sheet_name: String,
    pub source_columns: Vec<String>,
    pub sample_rows: Vec<BTreeMap<String, Value>>,
    pub total_rows: u64,
    pub truncated: bool,
}

/// A reviewed schema proposal derived from the exact native import source.
/// It carries column metadata only: row values and file paths never leave the
/// Host during type inference.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableImportColumnInference {
    pub columns: Vec<CreateTableColumn>,
    pub total_rows: u64,
    pub content_digest: String,
    /// CSV sources may require an explicit source-index to newly-created
    /// target-column mapping when title labels are normalized by the user.
    pub csv_options: Option<TableCsvImportOptions>,
}
