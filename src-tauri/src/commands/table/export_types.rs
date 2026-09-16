//! Export types for table operations.

use super::export_analytical::AnalyticalTypePolicy;
use super::export_sql::SqlExportDialect;
use super::policy::object_type_is_view;
use crate::core::dialect::DatabaseKind;
use crate::core::protocol::ColumnDef;
use crate::core::protocol::TableInfo;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::watch;
use tokio::sync::Mutex as AsyncMutex;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TableExportFormat {
    Arrow,
    Csv,
    Json,
    Jsonl,
    Markdown,
    Parquet,
    Sql,
    Tsv,
    Xlsx,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SqlInsertConflictPolicy {
    Strict,
    Skip,
    Update,
}

impl TableExportFormat {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Arrow => "arrow",
            Self::Csv => "csv",
            Self::Json => "json",
            Self::Jsonl => "jsonl",
            Self::Markdown => "markdown",
            Self::Parquet => "parquet",
            Self::Sql => "sql",
            Self::Tsv => "tsv",
            Self::Xlsx => "xlsx",
        }
    }
}

/// Output encoding is intentionally narrow until each additional encoding has
/// a complete escaping and conformance contract. UTF-8 BOM is offered for
/// spreadsheet-oriented CSV consumers that otherwise mis-detect UTF-8.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TableExportEncoding {
    Utf8,
    Utf8Bom,
    Binary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableExportResult {
    pub export_id: String,
    pub file_path: String,
    pub rows_exported: u64,
    pub batches: u64,
    /// Requested source-row ceiling. `None` means every matching row was read.
    #[serde(default)]
    pub max_rows: Option<u64>,
    pub report_id: Option<String>,
    /// Analytical formats retain the source type in Arrow field metadata when
    /// no lossless native mapping exists. The UI surfaces these bounded,
    /// schema-only notices; row values are never included.
    #[serde(default)]
    pub type_coercions: Vec<TableExportTypeCoercion>,
}

/// A conservative whole-schema SQL backup.  Unlike the single-table exporter,
/// this intentionally starts with the one host-owned dialect whose relation
/// reconstruction and SQL literal rules are exercised together: PostgreSQL.
/// Other products must provide a signed, product-owned backup contract before
/// they can be advertised here.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSqlExportResult {
    pub export_id: String,
    pub file_path: String,
    pub tables_exported: u64,
    pub rows_exported: u64,
    pub batches: u64,
    /// Kept explicit so a caller never mistakes this initial relation backup
    /// for a complete dump of routines, extensions, grants, or sequences.
    pub omitted_object_kinds: Vec<String>,
}

pub(super) const MAX_DATABASE_SQL_EXPORT_TABLE_SELECTION: usize = 200;

pub(super) fn select_database_sql_export_tables(
    relations: &[TableInfo],
    requested_names: Option<&[String]>,
) -> Result<Vec<TableInfo>, String> {
    let base_tables = relations
        .iter()
        .filter(|table| !object_type_is_view(table.table_type.as_deref()))
        .map(|table| (table.name.as_str(), table))
        .collect::<HashMap<_, _>>();
    let Some(requested_names) = requested_names else {
        return Ok(relations
            .iter()
            .filter(|table| !object_type_is_view(table.table_type.as_deref()))
            .cloned()
            .collect());
    };
    if requested_names.is_empty() {
        return Err("Select at least one base table for SQL export".to_string());
    }
    if requested_names.len() > MAX_DATABASE_SQL_EXPORT_TABLE_SELECTION {
        return Err(format!(
            "SQL export accepts at most {MAX_DATABASE_SQL_EXPORT_TABLE_SELECTION} selected tables"
        ));
    }

    let mut selected = Vec::with_capacity(requested_names.len());
    let mut seen = HashSet::with_capacity(requested_names.len());
    for name in requested_names {
        if name.trim().is_empty() {
            return Err("Selected SQL export table names cannot be empty".to_string());
        }
        if !seen.insert(name.as_str()) {
            return Err(format!("Selected SQL export table is duplicated: {name}"));
        }
        let table = base_tables.get(name.as_str()).ok_or_else(|| {
            if relations.iter().any(|relation| relation.name == *name) {
                format!("Selected SQL export object is not a base table: {name}")
            } else {
                format!("Selected SQL export table no longer exists: {name}")
            }
        })?;
        selected.push((*table).clone());
    }
    Ok(selected)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableExportTypeCoercion {
    pub column: String,
    pub source_type: String,
    pub output_type: String,
    pub reason: String,
}

/// Terminal status persisted for an export audit record. The report never
/// contains a file path, SQL, filter, parameter, row value, URL, or credential.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TableExportReportStatus {
    Done,
    Cancelled,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableExportReport {
    pub id: String,
    pub project_id: String,
    pub export_id: String,
    pub connection_id: String,
    pub driver: String,
    pub schema: String,
    pub table: String,
    pub format: TableExportFormat,
    pub encoding: TableExportEncoding,
    pub rows_exported: u64,
    pub batches: u64,
    /// Privacy-safe execution scope retained for export auditability.
    #[serde(default)]
    pub max_rows: Option<u64>,
    pub status: TableExportReportStatus,
    pub started_at: i64,
    pub finished_at: i64,
    pub error: Option<String>,
}

#[derive(Clone)]
pub(super) struct TableExportCancellationHandle {
    pub(super) connection_id: String,
    pub(super) sender: watch::Sender<bool>,
}

#[derive(Default)]
pub struct TableExportCancellationState(
    pub(super) Arc<AsyncMutex<HashMap<String, TableExportCancellationHandle>>>,
);

impl TableExportCancellationState {
    pub(super) async fn register(
        &self,
        export_id: &str,
        connection_id: &str,
    ) -> Result<watch::Receiver<bool>, String> {
        if export_id.trim().is_empty()
            || export_id.len() > 128
            || !export_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err("Invalid table export id".to_string());
        }
        let (sender, receiver) = watch::channel(false);
        let mut active = self.0.lock().await;
        if active.contains_key(export_id) {
            return Err(format!("Table export is already active: {export_id}"));
        }
        active.insert(
            export_id.to_string(),
            TableExportCancellationHandle {
                connection_id: connection_id.to_string(),
                sender,
            },
        );
        Ok(receiver)
    }

    pub(super) async fn cancellation_handle(
        &self,
        export_id: &str,
    ) -> Option<TableExportCancellationHandle> {
        self.0.lock().await.get(export_id).cloned()
    }

    pub(super) async fn take(&self, export_id: &str) {
        self.0.lock().await.remove(export_id);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableExportProgress {
    pub export_id: String,
    pub rows_exported: u64,
    pub batches: u64,
    pub terminal: bool,
    pub status: String,
    pub message: Option<String>,
}

pub(super) struct TableExportWriterContext {
    pub(super) app: Option<AppHandle>,
    pub(super) export_id: String,
    pub(super) final_path: PathBuf,
    pub(super) kind: DatabaseKind,
    pub(super) sql_dialect: SqlExportDialect,
    pub(super) override_system_value: bool,
    pub(super) sql_insert_batch_rows: usize,
    pub(super) sql_insert_conflict_policy: SqlInsertConflictPolicy,
    pub(super) sql_conflict_key_columns: Vec<String>,
    pub(super) analytical_type_policy: AnalyticalTypePolicy,
    pub(super) schema: String,
    pub(super) table: String,
    pub(super) format: TableExportFormat,
    pub(super) encoding: TableExportEncoding,
    pub(super) xlsx_auto_filter: bool,
    pub(super) progress_rows: Arc<AtomicU64>,
    pub(super) progress_batches: Arc<AtomicU64>,
}

pub(super) enum TableExportWriterMessage {
    Batch {
        columns: Vec<ColumnDef>,
        rows: Vec<Vec<Value>>,
    },
    /// A file is published only after this explicit terminal message. A closed
    /// channel means the producer failed or was cancelled and leaves the
    /// temporary-file guard responsible for cleanup.
    Finish,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct TableExportDialect {
    pub(super) kind: DatabaseKind,
    pub(super) analytical_type_policy: AnalyticalTypePolicy,
    pub(super) sql_dialect: SqlExportDialect,
}
