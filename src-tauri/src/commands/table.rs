use crate::core::{
    dialect::{canonical_driver_name, database_spec_for_driver, DatabaseKind},
    manager::ConnectionManager,
    protocol::{
        ColumnInfo, ConstraintInfo, IndexInfo, ParameterizedStatement, QueryParameter, QueryResult,
        Response,
    },
    statement::{validate_sql_filter_expression, StatementScanDialect},
    store::{MetaStore, Resource},
};
use calamine::{open_workbook_auto, Data, Reader};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs::{create_dir_all, metadata, remove_file, rename, File},
    io::{BufRead, BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{watch, Mutex as AsyncMutex};

const DEFAULT_PAGE_SIZE: u32 = 500;
const MAX_PAGE_SIZE: u32 = 5_000;
const MAX_JSON_IMPORT_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_XLSX_IMPORT_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_JSON_LINES_IMPORT_FILE_BYTES: u64 = 512 * 1024 * 1024;
/// CSV records are parsed incrementally and written through a single explicit
/// transaction, so they can have a larger bounded source budget than JSON,
/// whose array form is still parsed into memory.
const MAX_CSV_IMPORT_FILE_BYTES: u64 = 512 * 1024 * 1024;
/// The desktop CSV review UI intentionally reads only a bounded prefix.  The
/// actual import remains streaming and is allowed to use the larger import
/// budget above.  Keeping this separate prevents a preview from turning a
/// 512 MiB import into a renderer-memory allocation.
const MAX_CSV_IMPORT_PREVIEW_BYTES: usize = 32 * 1024 * 1024;
/// JSON imports use a structured review rather than copying arbitrary file
/// bytes into the renderer. Keep both the number of records and nested values
/// bounded so selecting a valid-but-large JSON document cannot create a UI
/// memory spike before the user confirms the transaction.
const MAX_JSON_IMPORT_PREVIEW_ROWS: usize = 50;
const MAX_JSON_IMPORT_PREVIEW_COLUMNS: usize = 256;
const MAX_JSON_IMPORT_PREVIEW_STRING_CHARS: usize = 1_024;
const MAX_JSON_IMPORT_PREVIEW_ARRAY_ITEMS: usize = 32;
const MAX_JSON_IMPORT_PREVIEW_OBJECT_FIELDS: usize = 32;
const MAX_IMPORT_ROWS: usize = 100_000;
const IMPORT_BATCH_SIZE: usize = 500;
/// A database-to-database copy is intentionally bounded.  It is a reviewed
/// table-data transfer, not an unbounded background replication feature.
const DEFAULT_TRANSFER_ROWS: u32 = 1_000;
const MAX_TRANSFER_ROWS: u32 = 10_000;
const DEFAULT_TRANSFER_BATCH_SIZE: u32 = 250;
const MAX_TRANSFER_BATCH_SIZE: u32 = 500;
const MAX_TRANSFER_OVERWRITE_ROWS: u64 = 100_000;
pub const TABLE_DATA_TRANSFER_PROGRESS_EVENT: &str = "table-data-transfer://progress";
const TABLE_DATA_TRANSFER_CANCELLED: &str = "TABLE_DATA_TRANSFER_CANCELLED";
const TABLE_DATA_TRANSFER_REPORT_PARENT_ID: &str = "table-data-transfer-reports-v1";
const TABLE_DATA_TRANSFER_REPORT_KIND: &str = "TABLE_DATA_TRANSFER_REPORT";
const MAX_POSTGRES_ROUTINE_SOURCE_CHARS: usize = 262_144;
const MAX_POSTGRES_ROUTINE_SOURCE_OVERLOADS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePageResult {
    pub result: QueryResult,
    pub page: u32,
    pub page_size: u32,
    pub total_rows: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TableExportFormat {
    Csv,
    Json,
    Sql,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableExportResult {
    pub file_path: String,
    pub rows_exported: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TableImportFormat {
    Csv,
    Json,
    Xlsx,
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
    #[serde(default)]
    pub column_mapping: Vec<TableCsvColumnMapping>,
    pub empty_fields_as_null: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableImportResult {
    pub file_path: String,
    pub rows_imported: u64,
    pub batches: u64,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferEndpoint {
    pub connection_id: String,
    pub driver: String,
    pub schema: String,
    pub table: String,
    pub database: Option<String>,
}

/// Append keeps existing rows. Overwrite first performs a reviewed, bounded
/// transactional delete and is deliberately not an alias for `TRUNCATE`.
/// Upsert is restricted to bundled drivers and the target table's declared
/// primary key until the external driver protocol gains an explicit semantic
/// conflict-write contract.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TableDataTransferMode {
    Append,
    Overwrite,
    Upsert,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TableDataTransferCompatibility {
    Exact,
    Safe,
    Review,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TableDataTransferConversion {
    None,
    TargetBinding,
    StringifyJson,
    StringifyScalar,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferRequest {
    /// Reports belong to a project, not merely the current window. Older IPC
    /// callers may omit this and still execute safely, but they do not create
    /// a durable report until they opt into a project identity.
    #[serde(default)]
    pub project_id: Option<String>,
    pub transfer_id: String,
    pub source: TableDataTransferEndpoint,
    pub target: TableDataTransferEndpoint,
    #[serde(default = "default_table_data_transfer_mode")]
    pub mode: TableDataTransferMode,
    pub max_rows: Option<u32>,
    pub batch_size: Option<u32>,
    /// Opt-in PostgreSQL serial/identity synchronization. This remains off
    /// unless explicitly reviewed and is bound into the transfer token.
    #[serde(default)]
    pub reseed_identity: bool,
}

/// A bounded, dependency-aware table selection. Unlike the single-table
/// request, this contains no row data and cannot execute a write by itself.
/// The executor will consume a reviewed batch plan in a later command rather
/// than allowing the UI to loop over independent table-transfer writes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferBatchPlanRequest {
    pub source_connection_id: String,
    pub source_driver: String,
    pub source_database: Option<String>,
    pub source_schema: String,
    pub target_connection_id: String,
    pub target_driver: String,
    pub target_database: Option<String>,
    pub target_schema: String,
    pub tables: Vec<String>,
    #[serde(default = "default_table_data_transfer_mode")]
    pub mode: TableDataTransferMode,
    pub max_rows: Option<u32>,
    pub batch_size: Option<u32>,
    #[serde(default)]
    pub reseed_identity: bool,
}

/// Executes a previously reviewed multi-table plan as one target transaction.
/// The confirmation token is intentionally supplied separately so the native
/// command can rebuild and compare the entire dependency and mapping plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferBatchExecuteRequest {
    #[serde(default)]
    pub project_id: Option<String>,
    pub transfer_id: String,
    pub plan: TableDataTransferBatchPlanRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferDependency {
    /// The referenced table that must be copied before `dependent_table`.
    pub prerequisite_table: String,
    pub dependent_table: String,
    pub constraint_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferBatchPlan {
    /// Parent-before-child copy order. It is empty when a selected FK cycle
    /// needs an explicit target-driver defer/disable policy.
    pub ordered_tables: Vec<String>,
    pub dependencies: Vec<TableDataTransferDependency>,
    pub cyclic_tables: Vec<String>,
    /// Per-table mapping preflight. Empty only for an FK cycle, where no
    /// target mapping work is attempted before a reviewed cycle policy exists.
    #[serde(default)]
    pub table_preflights: Vec<TableDataTransferBatchTablePreflight>,
    pub can_execute: bool,
    pub confirmation_token: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferBatchTablePreflight {
    pub table: String,
    pub can_execute: bool,
    pub mapped_columns: u32,
    /// Digest of the per-table confirmation token. This binds the aggregate
    /// batch review to the exact source/target column mapping without
    /// exposing any SQL, values, or credentials.
    pub plan_digest: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferBatchTableResult {
    pub table: String,
    pub rows_transferred: u64,
    pub batches: u64,
    pub limit_reached: bool,
    /// A terminal, privacy-bounded report is persisted for each object when
    /// the request supplies a project id.
    pub report_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferBatchResult {
    pub rows_transferred: u64,
    pub batches: u64,
    pub limit_reached: bool,
    pub tables: Vec<TableDataTransferBatchTableResult>,
}

fn default_table_data_transfer_mode() -> TableDataTransferMode {
    TableDataTransferMode::Append
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferColumnMapping {
    pub source: String,
    pub target: String,
    /// Retained for API compatibility; this is the target binding type.
    pub data_type: String,
    pub source_data_type: String,
    pub target_data_type: String,
    pub compatibility: TableDataTransferCompatibility,
    pub conversion: TableDataTransferConversion,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferPreview {
    pub mode: TableDataTransferMode,
    pub mapped_columns: Vec<TableDataTransferColumnMapping>,
    pub skipped_source_columns: Vec<String>,
    pub preview_rows: u32,
    pub max_rows: u32,
    pub batch_size: u32,
    pub target_rows_to_delete: Option<u64>,
    /// Exact target primary-key columns used as the conflict identity in
    /// upsert mode. Empty for append and overwrite plans.
    pub upsert_key_columns: Vec<String>,
    /// PostgreSQL target columns whose owned serial/identity generator will
    /// be synchronized inside the same transaction after row writes.
    pub identity_reseed_columns: Vec<String>,
    pub can_execute: bool,
    /// The user must type this exact short-lived plan binding to start a
    /// destructive cross-connection write.  Execute recomputes the plan and
    /// rejects stale tokens if either endpoint or the column mapping changed.
    pub confirmation_token: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferTargetPlanRequest {
    pub source: TableDataTransferEndpoint,
    pub target: TableDataTransferEndpoint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferTargetColumn {
    pub name: String,
    pub source_data_type: String,
    pub target_data_type: String,
    pub target_length: Option<String>,
    pub is_primary_key: bool,
    pub is_not_null: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferTargetPlan {
    pub columns: Vec<TableDataTransferTargetColumn>,
    pub statements: Vec<String>,
    pub confirmation_token: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferResult {
    pub rows_transferred: u64,
    pub batches: u64,
    pub limit_reached: bool,
    pub mapped_columns: Vec<TableDataTransferColumnMapping>,
    /// Present only when the caller supplied a project id and the terminal
    /// report was persisted successfully.
    pub report_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TableDataTransferProgressStatus {
    Running,
    Done,
    Cancelled,
    Error,
}

/// A post-commit, read-only observation of the target. It is deliberately a
/// report signal, not a second write transaction: a completed transfer stays
/// completed even when a concurrent writer makes its row count inconclusive.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TableDataTransferVerificationStatus {
    Verified,
    NeedsReview,
    NotAvailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferVerification {
    pub status: TableDataTransferVerificationStatus,
    pub expected_rows: Option<u64>,
    pub observed_rows: Option<u64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferProgress {
    pub transfer_id: String,
    pub rows_transferred: u64,
    pub max_rows: u32,
    pub batches: u64,
    pub status: TableDataTransferProgressStatus,
    pub terminal: bool,
    pub message: Option<String>,
}

/// A privacy-bounded, terminal audit record for a table copy. It deliberately
/// contains identifiers, counts and a plan digest only: no URL, credentials,
/// generated SQL, parameter values or copied rows are persisted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferReport {
    pub id: String,
    pub project_id: String,
    pub transfer_id: String,
    pub source: TableDataTransferEndpoint,
    pub target: TableDataTransferEndpoint,
    pub mode: TableDataTransferMode,
    pub plan_digest: String,
    pub max_rows: u32,
    pub rows_transferred: u64,
    pub batches: u64,
    pub limit_reached: bool,
    pub status: TableDataTransferProgressStatus,
    pub started_at: i64,
    pub finished_at: i64,
    pub error: Option<String>,
    /// Added after the initial report format. Old local reports remain
    /// readable and simply have no post-commit observation.
    #[serde(default)]
    pub verification: Option<TableDataTransferVerification>,
}

#[derive(Clone)]
pub struct TableDataTransferCancellationHandle {
    source_connection_id: String,
    sender: watch::Sender<bool>,
}

#[derive(Default)]
pub struct TableDataTransferCancellationState(
    Arc<AsyncMutex<HashMap<String, TableDataTransferCancellationHandle>>>,
);

impl TableDataTransferCancellationState {
    async fn register(
        &self,
        transfer_id: &str,
        source_connection_id: &str,
    ) -> Result<watch::Receiver<bool>, String> {
        validate_table_data_transfer_id(transfer_id)?;
        let (sender, receiver) = watch::channel(false);
        let mut handles = self.0.lock().await;
        if handles.contains_key(transfer_id) {
            return Err(format!(
                "Table data transfer is already active: {transfer_id}"
            ));
        }
        handles.insert(
            transfer_id.to_string(),
            TableDataTransferCancellationHandle {
                source_connection_id: source_connection_id.to_string(),
                sender,
            },
        );
        Ok(receiver)
    }

    async fn request_cancel(
        &self,
        transfer_id: &str,
    ) -> Option<TableDataTransferCancellationHandle> {
        self.0.lock().await.get(transfer_id).cloned()
    }

    async fn take(&self, transfer_id: &str) {
        self.0.lock().await.remove(transfer_id);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRowUpdate {
    pub key: BTreeMap<String, Value>,
    pub values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRowDelete {
    pub key: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMutationResult {
    pub inserted: u64,
    pub updated: u64,
    pub deleted: u64,
    pub rows_affected: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableFilter {
    pub column: String,
    pub operator: String,
    pub value: String,
    pub logic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSort {
    pub column: String,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTableColumn {
    pub name: String,
    pub data_type: String,
    pub length: Option<String>,
    pub is_primary_key: bool,
    pub is_not_null: bool,
    pub is_auto_increment: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlterColumnValueMode {
    Keep,
    Set,
    Drop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlterTableColumn {
    pub name: String,
    pub data_type: Option<String>,
    pub length: Option<String>,
    pub is_not_null: Option<bool>,
    pub default_mode: Option<AlterColumnValueMode>,
    pub default_value: Option<String>,
    pub comment_mode: Option<AlterColumnValueMode>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTableResult {
    pub table: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateViewResult {
    pub view: String,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMaterializedViewResult {
    pub view: String,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumnChangeResult {
    pub table: String,
    pub column: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIndexChangeResult {
    pub table: String,
    pub index: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableConstraintChangeResult {
    pub table: String,
    pub constraint: String,
    pub statements: Vec<String>,
}

fn schema_option(schema: &str) -> Option<&str> {
    let schema = schema.trim();
    if schema.is_empty() {
        None
    } else {
        Some(schema)
    }
}

/// SQLite and DuckDB accept the ANSI/PostgreSQL-style quoted identifiers,
/// `LIMIT/OFFSET`, and numbered bind markers used by the bounded data-grid
/// path. Keep this adapter deliberately narrow: it enables data preview and
/// row mutations. SQLite relation DDL is routed through its native builders
/// below rather than through this PostgreSQL-compatible data-grid dialect.
fn table_data_dialect(driver: &str) -> Result<DatabaseKind, String> {
    if matches!(
        driver.trim().to_ascii_lowercase().as_str(),
        "sqlite" | "sqlite3" | "duckdb"
    ) {
        return Ok(DatabaseKind::Postgres);
    }
    DatabaseKind::from_str(driver).map_err(|error| error.to_string())
}

fn reviewed_table_data_dialect(
    capabilities: &crate::core::dialect::DatabaseCapabilities,
    requires_mutation: bool,
) -> Result<DatabaseKind, String> {
    if !capabilities.supports_table_browsing {
        return Err(format!(
            "{} does not provide a reviewed table browsing contract",
            capabilities.display_name
        ));
    }
    if requires_mutation && !capabilities.supports_table_row_mutation {
        return Err(format!(
            "{} does not provide a reviewed table row-mutation contract",
            capabilities.display_name
        ));
    }

    match capabilities
        .lsp_language_id
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "postgres" | "sqlite" | "duckdb" => Ok(DatabaseKind::Postgres),
        "mysql" => Ok(DatabaseKind::Mysql),
        _ => Err(format!(
            "{} does not declare a reviewed table SQL dialect",
            capabilities.display_name
        )),
    }
}

async fn table_data_dialect_for_connection(
    manager: &ConnectionManager,
    connection_id: &str,
    driver: &str,
    requires_mutation: bool,
) -> Result<DatabaseKind, String> {
    let capabilities = manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?;
    match capabilities {
        Some(capabilities) => reviewed_table_data_dialect(&capabilities, requires_mutation),
        None => table_data_dialect(driver),
    }
}

/// Resolve the dialect used by the bounded table-to-table transfer path.
///
/// A signed external package is not automatically safe for this operation:
/// generic SQL has no reliable pagination or parameter convention. Packages
/// can opt in only through the reviewed transfer capability and one of the
/// two host implementations whose generated SQL is exercised here.
async fn table_data_transfer_dialect(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
) -> Result<DatabaseKind, String> {
    // Check the live package contract before the built-in driver-name route.
    // A package may intentionally reuse `postgres` or `mysql` while not
    // implementing the reviewed paging/type-mapping/batch-write transfer
    // contract. Its signed explicit false must never be widened by an alias.
    if let Some(capabilities) = manager
        .package_capabilities(&endpoint.connection_id)
        .await
        .map_err(|error| error.to_string())?
    {
        if !capabilities.supports_table_data_transfer {
            return Err(format!(
                "{} does not provide a reviewed bounded table-data transfer path",
                capabilities.display_name
            ));
        }

        return match capabilities.lsp_language_id.trim() {
            "postgres" | "sqlite" | "duckdb" => Ok(DatabaseKind::Postgres),
            "mysql" => Ok(DatabaseKind::Mysql),
            _ => Err(format!(
                "{} does not declare a reviewed transfer dialect",
                capabilities.display_name
            )),
        };
    }

    table_data_dialect(&endpoint.driver).map_err(|_| {
        format!(
            "{} does not provide a reviewed bounded table-data transfer path",
            endpoint.driver.trim()
        )
    })
}

/// Table DDL currently has host-owned, dialect-specific builders only. A
/// sidecar may share a built-in driver id (for example `postgres`) while using
/// different DDL grammar, so never send those generated statements through an
/// external runtime. Packages keep metadata and query support, and can expose
/// semantic DDL later through an explicit protocol capability.
fn ensure_host_table_ddl_capability(
    capabilities: Option<&crate::core::dialect::DatabaseCapabilities>,
    operation: &str,
) -> Result<(), String> {
    if let Some(capabilities) = capabilities {
        return Err(format!(
            "{} does not provide a verified semantic table {operation} operation",
            capabilities.display_name
        ));
    }
    Ok(())
}

async fn ensure_host_table_ddl_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
    operation: &str,
) -> Result<(), String> {
    let capabilities = manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?;
    ensure_host_table_ddl_capability(capabilities.as_ref(), operation)
}

fn validated_raw_filter_sql(
    kind: DatabaseKind,
    filter_sql: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(filter_sql) = filter_sql.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    let dialect = match kind {
        DatabaseKind::Postgres => StatementScanDialect::Postgres,
        DatabaseKind::Mysql => StatementScanDialect::Mysql,
    };
    validate_sql_filter_expression(filter_sql, dialect)?;

    Ok(Some(filter_sql.to_string()))
}

fn object_type_is_view(object_type: Option<&str>) -> bool {
    object_type
        .map(str::trim)
        .map(|value| value.to_ascii_uppercase())
        .is_some_and(|value| value.contains("VIEW"))
}

fn object_type_is_materialized_view(object_type: Option<&str>) -> bool {
    object_type
        .map(str::trim)
        .map(|value| value.to_ascii_uppercase())
        .is_some_and(|value| value.contains("MATERIALIZED") && value.contains("VIEW"))
}

fn object_type_is_foreign_table(object_type: Option<&str>) -> bool {
    object_type
        .map(str::trim)
        .map(|value| value.to_ascii_uppercase())
        .is_some_and(|value| value.contains("FOREIGN TABLE"))
}

fn object_label_from_type(object_type: Option<&str>) -> &'static str {
    if object_type_is_materialized_view(object_type) {
        "Materialized view"
    } else if object_type_is_foreign_table(object_type) {
        "Foreign table"
    } else if object_type_is_view(object_type) {
        "View"
    } else {
        "Table"
    }
}

#[derive(Debug, Clone, Copy)]
enum RelationOperation {
    DataMutation,
    Truncate,
    ColumnChange,
    IndexChange,
    ConstraintChange,
}

impl RelationOperation {
    fn description(self) -> &'static str {
        match self {
            Self::DataMutation => "Changing rows",
            Self::Truncate => "Truncating",
            Self::ColumnChange => "Changing columns",
            Self::IndexChange => "Changing indexes",
            Self::ConstraintChange => "Changing constraints",
        }
    }
}

fn relation_operation_allowed(operation: RelationOperation, object_type: Option<&str>) -> bool {
    match operation {
        RelationOperation::DataMutation
        | RelationOperation::Truncate
        | RelationOperation::ColumnChange
        | RelationOperation::ConstraintChange => {
            !object_type_is_view(object_type) && !object_type_is_foreign_table(object_type)
        }
        RelationOperation::IndexChange => {
            !object_type_is_foreign_table(object_type)
                && (!object_type_is_view(object_type)
                    || object_type_is_materialized_view(object_type))
        }
    }
}

fn ensure_relation_operation_allowed(
    object_name: &str,
    object_type: Option<&str>,
    operation: RelationOperation,
) -> Result<(), String> {
    if relation_operation_allowed(operation, object_type) {
        return Ok(());
    }

    Err(format!(
        "{} is not available for {} {}",
        operation.description(),
        object_label_from_type(object_type).to_ascii_lowercase(),
        object_name.trim()
    ))
}

fn value_to_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        serde_json::Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn value_to_u64(value: &serde_json::Value) -> Option<u64> {
    match value {
        serde_json::Value::Number(value) => {
            value.as_u64().or_else(|| value.as_i64().map(|v| v as u64))
        }
        serde_json::Value::String(value) => value.parse::<u64>().ok(),
        _ => None,
    }
}

fn value_to_export_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn csv_escape(value: &Value) -> String {
    let value = value_to_export_string(value);
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value
    }
}

fn sanitize_file_part(value: &str) -> String {
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

fn export_file_path(
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
        TableExportFormat::Csv => "csv",
        TableExportFormat::Json => "json",
        TableExportFormat::Sql => "sql",
    };
    let schema = sanitize_file_part(schema);
    let table = sanitize_file_part(table);
    dir.push(format!("{schema}_{table}_{timestamp}.{extension}"));
    Ok(dir)
}

/// A local export is not discoverable until all rows and the format footer are
/// written successfully. The guard deletes only its unique sibling partial
/// file on any error path; it never touches a user-selected final file.
struct ExportTemporaryFile {
    path: PathBuf,
    finalized: bool,
}

impl ExportTemporaryFile {
    fn create(final_path: &Path) -> Result<Self, String> {
        let file_name = final_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "Unable to derive export file name".to_string())?;
        let path = final_path.with_file_name(format!(
            ".{file_name}.{}.partial",
            uuid::Uuid::new_v4()
        ));
        Ok(Self {
            path,
            finalized: false,
        })
    }

    fn finalize(&mut self, final_path: &Path) -> Result<(), String> {
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

fn row_to_object(columns: &[String], row: &[Value]) -> Value {
    let mut object = Map::new();
    for (index, column) in columns.iter().enumerate() {
        object.insert(
            column.clone(),
            row.get(index).cloned().unwrap_or(Value::Null),
        );
    }
    Value::Object(object)
}

fn sql_export_literal(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::Bool(value) => {
            if *value {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        Value::Number(value) => value.to_string(),
        Value::String(value) => sql_string_literal(value),
        Value::Array(_) | Value::Object(_) => {
            sql_string_literal(&serde_json::to_string(value).unwrap_or_default())
        }
    }
}

fn sql_insert_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &[String],
    row: &[Value],
) -> String {
    let columns = columns
        .iter()
        .map(|column| kind.quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let values = row
        .iter()
        .map(sql_export_literal)
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "INSERT INTO {} ({columns}) VALUES ({values});",
        kind.qualified_table(schema_option(schema), table),
    )
}

fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn postgres_view_definition_query(kind: DatabaseKind, schema: &str, view: &str) -> String {
    let qualified = kind.qualified_table(schema_option(schema), view);
    format!(
        "SELECT pg_get_viewdef(to_regclass({}), true) AS definition;",
        sql_string_literal(&qualified)
    )
}

fn view_definition_query(kind: DatabaseKind, schema: &str, view: &str) -> String {
    match kind {
        DatabaseKind::Postgres => postgres_view_definition_query(kind, schema, view),
        DatabaseKind::Mysql => format!(
            "SELECT VIEW_DEFINITION AS definition FROM information_schema.VIEWS WHERE TABLE_SCHEMA = {} AND TABLE_NAME = {};",
            sql_string_literal(schema),
            sql_string_literal(view)
        ),
    }
}

fn generate_postgres_view_ddl(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
    definition: &str,
) -> String {
    format!(
        "CREATE OR REPLACE VIEW {} AS\n{};",
        kind.qualified_table(schema_option(schema), view),
        definition.trim().trim_end_matches(';')
    )
}

fn generate_postgres_materialized_view_ddl(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
    definition: &str,
) -> String {
    format!(
        "CREATE MATERIALIZED VIEW {} AS\n{};",
        kind.qualified_table(schema_option(schema), view),
        definition.trim().trim_end_matches(';')
    )
}

fn mysql_comment_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn normalize_data_type(value: &str) -> String {
    value.trim().to_ascii_uppercase()
}

fn validate_column_length(value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(());
    }

    if value
        .chars()
        .all(|ch| ch.is_ascii_digit() || ch == ',' || ch.is_ascii_whitespace())
        && value.split(',').all(|part| !part.trim().is_empty())
    {
        Ok(())
    } else {
        Err(format!("Invalid column length: {value}"))
    }
}

fn render_column_type(column: &CreateTableColumn) -> Result<String, String> {
    let data_type = column.data_type.trim();
    if data_type.is_empty() {
        return Err(format!("Column {} has no data type", column.name));
    }

    let mut rendered = data_type.to_string();
    if let Some(length) = column
        .length
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        validate_column_length(length)?;
        let normalized = normalize_data_type(data_type);
        if matches!(
            normalized.as_str(),
            "VARCHAR" | "CHAR" | "DECIMAL" | "NUMERIC"
        ) {
            rendered.push('(');
            rendered.push_str(length);
            rendered.push(')');
        }
    }

    Ok(rendered)
}

fn render_table_column_definition(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    column: &CreateTableColumn,
    inline_primary_key: bool,
    comment_statements: &mut Vec<String>,
) -> Result<(String, String), String> {
    let column_name = column.name.trim();
    if column_name.is_empty() {
        return Err("All columns must have a name".to_string());
    }

    let data_type = normalize_data_type(&column.data_type);
    if !kind.supports_data_type(&data_type) {
        return Err(format!("Unsupported data type: {}", column.data_type));
    }

    let capabilities = kind.capabilities();
    let mut definition = format!(
        "{} {}",
        kind.quote_identifier(column_name),
        render_column_type(column)?
    );

    if column.is_auto_increment {
        if let Some(clause) = kind
            .auto_increment_clause_for_type(&data_type)
            .map_err(|err| err.to_string())?
        {
            definition.push(' ');
            definition.push_str(clause.trim());
        }
    }

    if column.is_not_null {
        definition.push_str(" NOT NULL");
    }

    if inline_primary_key && column.is_primary_key {
        definition.push_str(" PRIMARY KEY");
    }

    if let Some(comment) = column
        .comment
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if capabilities.supports_inline_column_comments {
            definition.push_str(" COMMENT ");
            definition.push_str(&mysql_comment_literal(comment));
        } else if capabilities.supports_column_comments {
            comment_statements.push(format!(
                "COMMENT ON COLUMN {}.{} IS {};",
                kind.qualified_table(schema_option(schema), table),
                kind.quote_identifier(column_name),
                sql_string_literal(comment)
            ));
        }
    }

    Ok((definition, column_name.to_string()))
}

fn is_sqlite_driver(driver: &str) -> bool {
    database_spec_for_driver(driver).is_some_and(|spec| spec.driver.eq_ignore_ascii_case("sqlite"))
}

fn sqlite_quote_identifier(value: &str) -> String {
    // SQLite shares ANSI double-quoted identifier rules with PostgreSQL.  Keep
    // this local rather than expanding DatabaseKind: its many Postgres/MySQL
    // helpers encode DDL semantics SQLite does not share.
    DatabaseKind::Postgres.quote_identifier(value.trim())
}

fn sqlite_qualified_relation(schema: &str, relation: &str) -> Result<String, String> {
    let relation = relation.trim();
    if relation.is_empty() {
        return Err("Table name is required".to_string());
    }
    let relation = sqlite_quote_identifier(relation);
    match schema.trim() {
        "" => Ok(relation),
        schema => Ok(format!("{}.{}", sqlite_quote_identifier(schema), relation)),
    }
}

fn sqlite_column_definition(
    column: &CreateTableColumn,
    allow_primary_key: bool,
) -> Result<(String, String), String> {
    let name = column.name.trim();
    if name.is_empty() {
        return Err("All columns must have a name".to_string());
    }
    let data_type = normalize_data_type(&column.data_type);
    let sqlite = database_spec_for_driver("sqlite").expect("SQLite dialect is registered");
    if !sqlite
        .common_data_types
        .iter()
        .any(|supported| normalize_data_type(supported) == data_type)
    {
        return Err(format!(
            "Unsupported SQLite data type: {}",
            column.data_type
        ));
    }
    if column
        .comment
        .as_deref()
        .is_some_and(|comment| !comment.trim().is_empty())
    {
        return Err("SQLite does not support column comments".to_string());
    }
    if !allow_primary_key && (column.is_primary_key || column.is_auto_increment) {
        return Err(
            "SQLite cannot add a primary-key or AUTOINCREMENT column to an existing table"
                .to_string(),
        );
    }
    if column.is_auto_increment && (!column.is_primary_key || data_type != "INTEGER") {
        return Err(
            "SQLite AUTOINCREMENT requires a single INTEGER PRIMARY KEY column".to_string(),
        );
    }

    let mut definition = format!(
        "{} {}",
        sqlite_quote_identifier(name),
        render_column_type(column)?
    );
    if column.is_primary_key {
        definition.push_str(" PRIMARY KEY");
    }
    if column.is_auto_increment {
        definition.push_str(" AUTOINCREMENT");
    }
    if column.is_not_null && !column.is_primary_key {
        definition.push_str(" NOT NULL");
    }
    Ok((definition, name.to_string()))
}

fn build_sqlite_create_table_statements(
    schema: &str,
    table: &str,
    columns: &[CreateTableColumn],
) -> Result<Vec<String>, String> {
    if columns.is_empty() {
        return Err("At least one column is required".to_string());
    }
    let table = sqlite_qualified_relation(schema, table)?;
    let primary_key_count = columns
        .iter()
        .filter(|column| column.is_primary_key)
        .count();
    if primary_key_count > 1 && columns.iter().any(|column| column.is_auto_increment) {
        return Err("SQLite AUTOINCREMENT cannot be used with a composite primary key".to_string());
    }
    let mut definitions = Vec::with_capacity(columns.len() + 1);
    let mut primary_keys = Vec::new();
    for column in columns {
        let mut rendered_column = column.clone();
        if primary_key_count > 1 {
            rendered_column.is_primary_key = false;
        }
        let (definition, name) = sqlite_column_definition(&rendered_column, true)?;
        if column.is_primary_key && primary_key_count > 1 {
            primary_keys.push(name);
        }
        definitions.push(definition);
    }
    if primary_keys.len() > 1 {
        let keys = primary_keys
            .iter()
            .map(|name| sqlite_quote_identifier(name))
            .collect::<Vec<_>>()
            .join(", ");
        definitions.push(format!("PRIMARY KEY ({keys})"));
    }
    Ok(vec![format!(
        "CREATE TABLE {table} (\n  {}\n);",
        definitions.join(",\n  ")
    )])
}

fn build_sqlite_add_column_statements(
    schema: &str,
    table: &str,
    column: &CreateTableColumn,
) -> Result<Vec<String>, String> {
    let table = sqlite_qualified_relation(schema, table)?;
    let (definition, _) = sqlite_column_definition(column, false)?;
    Ok(vec![format!(
        "ALTER TABLE {table} ADD COLUMN {definition};"
    )])
}

fn build_sqlite_drop_column_statement(
    schema: &str,
    table: &str,
    column: &str,
) -> Result<String, String> {
    let column = column.trim();
    if column.is_empty() {
        return Err("Column name is required".to_string());
    }
    Ok(format!(
        "ALTER TABLE {} DROP COLUMN {};",
        sqlite_qualified_relation(schema, table)?,
        sqlite_quote_identifier(column),
    ))
}

fn build_sqlite_rename_column_statement(
    schema: &str,
    table: &str,
    old_name: &str,
    new_name: &str,
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<String, String> {
    let old_name = old_name.trim();
    let new_name = new_name.trim();
    if old_name.is_empty() || new_name.is_empty() {
        return Err("Column names are required".to_string());
    }
    if old_name == new_name {
        return Err("New column name must be different".to_string());
    }
    if !existing_columns.contains_key(old_name) {
        return Err(format!("Unknown column: {old_name}"));
    }
    if existing_columns.contains_key(new_name) {
        return Err(format!("Column already exists: {new_name}"));
    }
    Ok(format!(
        "ALTER TABLE {} RENAME COLUMN {} TO {};",
        sqlite_qualified_relation(schema, table)?,
        sqlite_quote_identifier(old_name),
        sqlite_quote_identifier(new_name),
    ))
}

fn validated_sqlite_index_columns(
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut validated = Vec::new();
    for column in columns {
        let column = column.trim();
        if column.is_empty() {
            continue;
        }
        if !existing_columns.contains_key(column) {
            return Err(format!("Unknown column: {column}"));
        }
        if seen.insert(column.to_string()) {
            validated.push(column.to_string());
        }
    }
    if validated.is_empty() {
        Err("At least one index column is required".to_string())
    } else {
        Ok(validated)
    }
}

fn build_sqlite_create_index_statement(
    schema: &str,
    table: &str,
    index: &str,
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
    unique: bool,
) -> Result<String, String> {
    let index = index.trim();
    if index.is_empty() {
        return Err("Index name is required".to_string());
    }
    let columns = validated_sqlite_index_columns(columns, existing_columns)?;
    let schema = schema.trim();
    let index = if schema.is_empty() {
        sqlite_quote_identifier(index)
    } else {
        format!(
            "{}.{}",
            sqlite_quote_identifier(schema),
            sqlite_quote_identifier(index)
        )
    };
    let columns = columns
        .iter()
        .map(|column| sqlite_quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    Ok(format!(
        "CREATE {}INDEX {index} ON {} ({columns});",
        if unique { "UNIQUE " } else { "" },
        sqlite_qualified_relation(schema, table)?,
    ))
}

fn build_sqlite_drop_index_statement(
    schema: &str,
    table: &str,
    index: &str,
) -> Result<String, String> {
    let index = index.trim();
    if index.is_empty() {
        return Err("Index name is required".to_string());
    }
    if index.eq_ignore_ascii_case("PRIMARY") {
        return Err("Primary key indexes must be changed through table definition".to_string());
    }
    // Validate the relation even though SQLite's DROP INDEX syntax does not
    // repeat it; this keeps the command's safety boundary consistent.
    let _ = sqlite_qualified_relation(schema, table)?;
    let index = if schema.trim().is_empty() {
        sqlite_quote_identifier(index)
    } else {
        format!(
            "{}.{}",
            sqlite_quote_identifier(schema),
            sqlite_quote_identifier(index)
        )
    };
    Ok(format!("DROP INDEX {index};"))
}

fn build_create_table_statements(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &[CreateTableColumn],
) -> Result<Vec<String>, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    if columns.is_empty() {
        return Err("At least one column is required".to_string());
    }

    let mut definitions = Vec::new();
    let mut primary_keys = Vec::new();
    let mut comment_statements = Vec::new();

    for column in columns {
        let (definition, column_name) = render_table_column_definition(
            kind,
            schema,
            table,
            column,
            false,
            &mut comment_statements,
        )?;
        if column.is_primary_key {
            primary_keys.push(column_name.to_string());
        }

        definitions.push(definition);
    }

    if !primary_keys.is_empty() {
        let quoted_keys = primary_keys
            .iter()
            .map(|column| kind.quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        definitions.push(format!("PRIMARY KEY ({quoted_keys})"));
    }

    let create_statement = format!(
        "CREATE TABLE {} (\n  {}\n);",
        kind.qualified_table(schema_option(schema), table),
        definitions.join(",\n  ")
    );

    let mut statements = vec![create_statement];
    statements.extend(comment_statements);
    Ok(statements)
}

fn strip_leading_view_query_comments(mut sql: &str) -> Result<&str, String> {
    loop {
        let trimmed = sql.trim_start();
        if let Some(rest) = trimmed.strip_prefix("--") {
            if let Some(index) = rest.find('\n') {
                sql = &rest[index + 1..];
                continue;
            }
            return Ok("");
        }

        if let Some(rest) = trimmed.strip_prefix("/*") {
            if let Some(index) = rest.find("*/") {
                sql = &rest[index + 2..];
                continue;
            }
            return Err("View query has an unterminated block comment".to_string());
        }

        return Ok(trimmed);
    }
}

fn normalize_view_select_sql(sql: &str) -> Result<String, String> {
    let sql = sql.trim();
    if sql.is_empty() {
        return Err("View query is required".to_string());
    }

    let sql = sql.strip_suffix(';').unwrap_or(sql).trim();
    if sql.is_empty() {
        return Err("View query is required".to_string());
    }
    if sql.contains(';') {
        return Err("View query must be a single SELECT statement".to_string());
    }

    let body = strip_leading_view_query_comments(sql)?;
    let keyword: String = body
        .chars()
        .take_while(|ch| ch.is_ascii_alphabetic())
        .collect();
    match keyword.to_ascii_uppercase().as_str() {
        "SELECT" | "WITH" => Ok(sql.to_string()),
        _ => Err("View query must start with SELECT or WITH".to_string()),
    }
}

fn build_create_view_statement(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
    select_sql: &str,
    replace: bool,
) -> Result<String, String> {
    let view = view.trim();
    if view.is_empty() {
        return Err("View name is required".to_string());
    }

    let select_sql = normalize_view_select_sql(select_sql)?;
    Ok(kind.create_view_query(schema_option(schema), view, &select_sql, replace))
}

fn build_sqlite_create_view_statement(
    schema: &str,
    view: &str,
    select_sql: &str,
    replace: bool,
) -> Result<String, String> {
    if replace {
        return Err("SQLite does not support CREATE OR REPLACE VIEW".to_string());
    }
    let select_sql = normalize_view_select_sql(select_sql)?;
    Ok(format!(
        "CREATE VIEW {} AS {};",
        sqlite_qualified_relation(schema, view)?,
        select_sql,
    ))
}

fn build_create_materialized_view_statement(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
    select_sql: &str,
    with_data: bool,
) -> Result<String, String> {
    let view = view.trim();
    if view.is_empty() {
        return Err("Materialized view name is required".to_string());
    }

    let select_sql = normalize_view_select_sql(select_sql)?;
    kind.create_materialized_view_query(schema_option(schema), view, &select_sql, with_data)
        .ok_or_else(|| "Materialized views are not supported by this driver".to_string())
}

fn build_add_table_column_statements(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    column: &CreateTableColumn,
) -> Result<Vec<String>, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let mut comment_statements = Vec::new();
    let (definition, _) =
        render_table_column_definition(kind, schema, table, column, true, &mut comment_statements)?;

    let mut statements = vec![format!(
        "ALTER TABLE {} ADD COLUMN {};",
        kind.qualified_table(schema_option(schema), table),
        definition
    )];
    statements.extend(comment_statements);
    Ok(statements)
}

fn build_drop_table_column_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    column: &str,
    cascade: bool,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let column = column.trim();
    if column.is_empty() {
        return Err("Column name is required".to_string());
    }

    Ok(kind.drop_column_query(schema_option(schema), table, column, cascade))
}

fn build_rename_table_column_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    old_name: &str,
    new_name: &str,
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let old_name = old_name.trim();
    let new_name = new_name.trim();
    if old_name.is_empty() || new_name.is_empty() {
        return Err("Column names are required".to_string());
    }
    if old_name == new_name {
        return Err("New column name must be different".to_string());
    }
    if !existing_columns.contains_key(old_name) {
        return Err(format!("Unknown column: {old_name}"));
    }
    if existing_columns.contains_key(new_name) {
        return Err(format!("Column already exists: {new_name}"));
    }

    Ok(kind.rename_column_query(schema_option(schema), table, old_name, new_name))
}

fn parse_data_type_input(value: &str) -> (String, Option<String>) {
    let value = value.trim();
    if let Some(start) = value.find('(') {
        if value.ends_with(')') && start + 1 < value.len() {
            let base = value[..start].trim().to_string();
            let length = value[start + 1..value.len() - 1].trim().to_string();
            return (base, (!length.is_empty()).then_some(length));
        }
    }

    (value.to_string(), None)
}

fn render_alter_column_type(
    kind: DatabaseKind,
    column_name: &str,
    data_type: Option<&str>,
    length: Option<&str>,
) -> Result<Option<String>, String> {
    let data_type = data_type.map(str::trim).filter(|value| !value.is_empty());
    let length = length.map(str::trim).filter(|value| !value.is_empty());

    let Some(data_type) = data_type else {
        if length.is_some() {
            return Err("Data type is required when length is changed".to_string());
        }
        return Ok(None);
    };

    let (base_type, inline_length) = parse_data_type_input(data_type);
    let base_type = base_type.trim();
    if base_type.is_empty() {
        return Err("Column data type is required".to_string());
    }
    if !kind.supports_data_type(base_type) {
        return Err(format!("Unsupported data type: {base_type}"));
    }

    let column = CreateTableColumn {
        name: column_name.to_string(),
        data_type: base_type.to_string(),
        length: length
            .map(ToString::to_string)
            .or(inline_length)
            .filter(|value| !value.trim().is_empty()),
        is_primary_key: false,
        is_not_null: false,
        is_auto_increment: false,
        comment: None,
    };

    render_column_type(&column).map(Some)
}

fn validate_default_expression(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Default value is required when default mode is set".to_string());
    }
    if value.contains(';') || value.contains("--") || value.contains("/*") || value.contains("*/") {
        return Err("Default value cannot contain statement separators or comments".to_string());
    }
    Ok(value)
}

fn build_alter_table_column_statements(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    changes: &AlterTableColumn,
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<Vec<String>, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let column_name = changes.name.trim();
    if column_name.is_empty() {
        return Err("Column name is required".to_string());
    }

    let existing = column_for(existing_columns, column_name)?;
    if existing.is_primary_key && matches!(changes.is_not_null, Some(false)) {
        return Err("Primary key columns cannot be nullable".to_string());
    }
    if existing.is_auto_increment && changes.default_mode == Some(AlterColumnValueMode::Set) {
        return Err("Auto-increment columns cannot use an explicit default".to_string());
    }

    let requested_type = render_alter_column_type(
        kind,
        column_name,
        changes.data_type.as_deref(),
        changes.length.as_deref(),
    )?;
    let default_mode = changes.default_mode.unwrap_or(AlterColumnValueMode::Keep);
    let comment_mode = changes.comment_mode.unwrap_or(AlterColumnValueMode::Keep);
    let qualified_table = kind.qualified_table(schema_option(schema), table);
    let quoted_column = kind.quote_identifier(column_name);
    let mut statements = Vec::new();

    match kind {
        DatabaseKind::Postgres => {
            if let Some(data_type) = requested_type {
                statements.push(format!(
                    "ALTER TABLE {qualified_table} ALTER COLUMN {quoted_column} TYPE {data_type};"
                ));
            }

            if let Some(is_not_null) = changes.is_not_null {
                if is_not_null == existing.is_nullable {
                    let action = if is_not_null {
                        "SET NOT NULL"
                    } else {
                        "DROP NOT NULL"
                    };
                    statements.push(format!(
                        "ALTER TABLE {qualified_table} ALTER COLUMN {quoted_column} {action};"
                    ));
                }
            }

            match default_mode {
                AlterColumnValueMode::Keep => {}
                AlterColumnValueMode::Set => {
                    let default_value = validate_default_expression(
                        changes.default_value.as_deref().unwrap_or(""),
                    )?;
                    statements.push(format!(
                        "ALTER TABLE {qualified_table} ALTER COLUMN {quoted_column} SET DEFAULT {default_value};"
                    ));
                }
                AlterColumnValueMode::Drop => {
                    statements.push(format!(
                        "ALTER TABLE {qualified_table} ALTER COLUMN {quoted_column} DROP DEFAULT;"
                    ));
                }
            }

            match comment_mode {
                AlterColumnValueMode::Keep => {}
                AlterColumnValueMode::Set => {
                    statements.push(format!(
                        "COMMENT ON COLUMN {qualified_table}.{quoted_column} IS {};",
                        sql_string_literal(changes.comment.as_deref().unwrap_or(""))
                    ));
                }
                AlterColumnValueMode::Drop => {
                    statements.push(format!(
                        "COMMENT ON COLUMN {qualified_table}.{quoted_column} IS NULL;"
                    ));
                }
            }
        }
        DatabaseKind::Mysql => {
            let should_modify = requested_type.is_some()
                || changes.is_not_null.is_some()
                || default_mode != AlterColumnValueMode::Keep
                || comment_mode != AlterColumnValueMode::Keep;

            if should_modify {
                let data_type =
                    requested_type.unwrap_or_else(|| existing.data_type.trim().to_string());
                if data_type.trim().is_empty() {
                    return Err("Column data type is required".to_string());
                }

                let is_not_null = changes.is_not_null.unwrap_or(!existing.is_nullable);
                let mut definition = format!("{quoted_column} {data_type}");
                definition.push_str(if is_not_null { " NOT NULL" } else { " NULL" });

                if existing.is_auto_increment {
                    definition.push_str(" AUTO_INCREMENT");
                }

                let default_sql = match default_mode {
                    AlterColumnValueMode::Keep if !existing.is_auto_increment => existing
                        .default_value
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(|value| kind.metadata_default_sql(&data_type, value)),
                    AlterColumnValueMode::Keep => None,
                    AlterColumnValueMode::Set => Some(
                        validate_default_expression(
                            changes.default_value.as_deref().unwrap_or(""),
                        )?
                        .to_string(),
                    ),
                    AlterColumnValueMode::Drop => None,
                };
                if let Some(default_sql) = default_sql {
                    definition.push_str(" DEFAULT ");
                    definition.push_str(&default_sql);
                }

                let comment = match comment_mode {
                    AlterColumnValueMode::Keep => existing.comment.as_deref(),
                    AlterColumnValueMode::Set => changes.comment.as_deref(),
                    AlterColumnValueMode::Drop => None,
                };
                if let Some(comment) = comment {
                    definition.push_str(" COMMENT ");
                    definition.push_str(&mysql_comment_literal(comment));
                }

                statements.push(format!(
                    "ALTER TABLE {qualified_table} MODIFY COLUMN {definition};"
                ));
            }
        }
    }

    if statements.is_empty() {
        Err("No column changes requested".to_string())
    } else {
        Ok(statements)
    }
}

fn build_create_table_index_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    index: &str,
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
    unique: bool,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let index = index.trim();
    if index.is_empty() {
        return Err("Index name is required".to_string());
    }

    let mut seen = HashSet::new();
    let mut validated_columns = Vec::new();
    for column in columns {
        let column = column.trim();
        if column.is_empty() {
            continue;
        }
        if !existing_columns.contains_key(column) {
            return Err(format!("Unknown column: {column}"));
        }
        if seen.insert(column.to_string()) {
            validated_columns.push(column.to_string());
        }
    }

    if validated_columns.is_empty() {
        return Err("At least one index column is required".to_string());
    }

    Ok(kind.create_index_query(
        schema_option(schema),
        table,
        index,
        &validated_columns,
        unique,
    ))
}

fn build_drop_table_index_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    index: &str,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let index = index.trim();
    if index.is_empty() {
        return Err("Index name is required".to_string());
    }
    if index.eq_ignore_ascii_case("PRIMARY") {
        return Err("Primary key indexes must be changed through constraints".to_string());
    }

    Ok(kind.drop_index_query(schema_option(schema), table, index))
}

fn build_rename_table_index_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    old_name: &str,
    new_name: &str,
    existing_indexes: &[IndexInfo],
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let old_name = old_name.trim();
    let new_name = new_name.trim();
    if old_name.is_empty() || new_name.is_empty() {
        return Err("Index names are required".to_string());
    }
    if old_name == new_name {
        return Err("New index name must be different".to_string());
    }

    let old_index = existing_indexes
        .iter()
        .find(|index| index.name == old_name)
        .ok_or_else(|| format!("Unknown index: {old_name}"))?;
    if old_index.is_primary {
        return Err("Primary indexes are managed through constraints".to_string());
    }
    if existing_indexes.iter().any(|index| index.name == new_name) {
        return Err(format!("Index already exists: {new_name}"));
    }

    Ok(kind.rename_index_query(schema_option(schema), table, old_name, new_name))
}

fn validate_constraint_name(constraint: &str) -> Result<&str, String> {
    let constraint = constraint.trim();
    if constraint.is_empty() {
        Err("Constraint name is required".to_string())
    } else {
        Ok(constraint)
    }
}

fn validate_existing_columns(
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut validated = Vec::new();

    for column in columns {
        let column = column.trim();
        if column.is_empty() {
            continue;
        }
        if !existing_columns.contains_key(column) {
            return Err(format!("Unknown column: {column}"));
        }
        if seen.insert(column.to_string()) {
            validated.push(column.to_string());
        }
    }

    if validated.is_empty() {
        Err("At least one column is required".to_string())
    } else {
        Ok(validated)
    }
}

fn validate_referential_action(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let normalized = value.to_ascii_uppercase().replace('_', " ");
    match normalized.as_str() {
        "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" => Ok(Some(normalized)),
        _ => Err(format!("Unsupported referential action: {value}")),
    }
}

fn build_create_unique_constraint_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &str,
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    let constraint = validate_constraint_name(constraint)?;
    let columns = validate_existing_columns(columns, existing_columns)?;

    Ok(kind.add_unique_constraint_query(schema_option(schema), table, constraint, &columns))
}

fn build_create_primary_key_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &str,
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    let constraint = validate_constraint_name(constraint)?;
    let columns = validate_existing_columns(columns, existing_columns)?;

    for column in &columns {
        let column_info = column_for(existing_columns, column)?;
        if column_info.is_nullable {
            return Err(format!("Primary key column must be NOT NULL: {column}"));
        }
    }

    Ok(kind.add_primary_key_constraint_query(schema_option(schema), table, constraint, &columns))
}

fn validate_check_expression(expression: &str) -> Result<&str, String> {
    let expression = expression.trim();
    if expression.is_empty() {
        return Err("Check expression is required".to_string());
    }
    if expression.contains(';')
        || expression.contains("--")
        || expression.contains("/*")
        || expression.contains("*/")
    {
        return Err("Check expression cannot contain statement separators or comments".to_string());
    }
    Ok(expression)
}

fn build_create_check_constraint_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &str,
    expression: &str,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    let constraint = validate_constraint_name(constraint)?;
    let expression = validate_check_expression(expression)?;

    Ok(kind.add_check_constraint_query(schema_option(schema), table, constraint, expression))
}

#[allow(clippy::too_many_arguments)]
fn build_create_foreign_key_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &str,
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
    referenced_schema: &str,
    referenced_table: &str,
    referenced_columns: &[String],
    existing_referenced_columns: &BTreeMap<String, ColumnInfo>,
    on_delete: Option<&str>,
    on_update: Option<&str>,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    let referenced_table = referenced_table.trim();
    if referenced_table.is_empty() {
        return Err("Referenced table is required".to_string());
    }

    let constraint = validate_constraint_name(constraint)?;
    let columns = validate_existing_columns(columns, existing_columns)?;
    let referenced_columns =
        validate_existing_columns(referenced_columns, existing_referenced_columns)?;
    if columns.len() != referenced_columns.len() {
        return Err("Foreign key column count must match referenced column count".to_string());
    }

    let referenced_schema = referenced_schema.trim();
    let referenced_schema = if referenced_schema.is_empty() {
        schema_option(schema)
    } else {
        Some(referenced_schema)
    };
    let on_delete = validate_referential_action(on_delete)?;
    let on_update = validate_referential_action(on_update)?;

    Ok(kind.add_foreign_key_constraint_query(
        schema_option(schema),
        table,
        constraint,
        &columns,
        referenced_schema,
        referenced_table,
        &referenced_columns,
        on_delete.as_deref(),
        on_update.as_deref(),
    ))
}

fn build_drop_table_constraint_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &ConstraintInfo,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    let constraint_name = validate_constraint_name(&constraint.name)?;

    Ok(kind.drop_constraint_query(
        schema_option(schema),
        table,
        constraint_name,
        &constraint.constraint_type,
    ))
}

fn column_lookup(columns: Vec<ColumnInfo>) -> BTreeMap<String, ColumnInfo> {
    columns
        .into_iter()
        .map(|column| (column.name.clone(), column))
        .collect()
}

fn column_for<'a>(
    columns: &'a BTreeMap<String, ColumnInfo>,
    column: &str,
) -> Result<&'a ColumnInfo, String> {
    columns
        .get(column)
        .ok_or_else(|| format!("Unknown column: {column}"))
}

fn query_parameter(column: &ColumnInfo, value: &Value) -> QueryParameter {
    QueryParameter {
        value: value.clone(),
        data_type: Some(column.data_type.clone()),
    }
}

fn text_query_parameter(value: String) -> QueryParameter {
    QueryParameter {
        value: Value::String(value),
        data_type: Some("text".to_string()),
    }
}

fn escape_like_value(value: &str) -> String {
    let mut escaped = String::new();
    for ch in value.chars() {
        if matches!(ch, '=' | '%' | '_') {
            escaped.push('=');
        }
        escaped.push(ch);
    }
    escaped
}

fn build_structured_filter_where(
    kind: DatabaseKind,
    columns: &BTreeMap<String, ColumnInfo>,
    filters: &[TableFilter],
) -> Result<(String, Vec<QueryParameter>), String> {
    if filters.is_empty() {
        return Ok((String::new(), Vec::new()));
    }

    let mut predicates = Vec::new();
    let mut params = Vec::new();

    for filter in filters {
        let column_name = filter.column.trim();
        if column_name.is_empty() {
            return Err("Filter column is required".to_string());
        }

        let column = column_for(columns, column_name)?;
        let identifier = kind.quote_identifier(column_name);
        let logic = match filter.logic.as_deref() {
            Some(value) if value.eq_ignore_ascii_case("OR") => "OR",
            _ => "AND",
        };
        let prefix = if predicates.is_empty() {
            String::new()
        } else {
            format!("{logic} ")
        };

        let operator = filter.operator.trim();
        let predicate = match operator {
            "equals" => {
                let placeholder = kind.parameter_placeholder(params.len() + 1, &column.data_type);
                params.push(query_parameter(
                    column,
                    &Value::String(filter.value.clone()),
                ));
                format!("{prefix}{identifier} = {placeholder}")
            }
            ">" | "<" | ">=" | "<=" => {
                let placeholder = kind.parameter_placeholder(params.len() + 1, &column.data_type);
                params.push(query_parameter(
                    column,
                    &Value::String(filter.value.clone()),
                ));
                format!("{prefix}{identifier} {operator} {placeholder}")
            }
            "contains" | "startsWith" | "endsWith" => {
                let escaped = escape_like_value(&filter.value);
                let pattern = match operator {
                    "contains" => format!("%{escaped}%"),
                    "startsWith" => format!("{escaped}%"),
                    "endsWith" => format!("%{escaped}"),
                    _ => unreachable!(),
                };
                let placeholder = kind.parameter_placeholder(params.len() + 1, "text");
                params.push(text_query_parameter(pattern));
                format!(
                    "{prefix}{} LIKE {placeholder} ESCAPE '='",
                    kind.text_cast_expression(&identifier)
                )
            }
            _ => return Err(format!("Unsupported filter operator: {operator}")),
        };

        predicates.push(predicate);
    }

    Ok((predicates.join(" "), params))
}

fn build_table_order_by(
    kind: DatabaseKind,
    columns: &BTreeMap<String, ColumnInfo>,
    sort: Option<&TableSort>,
) -> Result<Option<String>, String> {
    let mut order = Vec::new();
    let mut requested_column = None;

    if let Some(sort) = sort {
        let column_name = sort.column.trim();
        if !column_name.is_empty() {
            column_for(columns, column_name)?;
            let direction = match sort.direction.trim().to_ascii_lowercase().as_str() {
                "asc" => Some("ASC"),
                "desc" => Some("DESC"),
                "" => None,
                other => return Err(format!("Unsupported sort direction: {other}")),
            };
            if let Some(direction) = direction {
                order.push(format!(
                    "{} {direction}",
                    kind.quote_identifier(column_name)
                ));
                requested_column = Some(column_name);
            }
        }
    }

    for column in columns.values().filter(|column| column.is_primary_key) {
        if requested_column == Some(column.name.as_str()) {
            continue;
        }
        order.push(format!("{} ASC", kind.quote_identifier(&column.name)));
    }

    Ok((!order.is_empty()).then(|| order.join(", ")))
}

fn build_insert_mutation(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    values: &BTreeMap<String, Value>,
) -> Result<(String, Vec<QueryParameter>), String> {
    validate_insert_values(columns, values)?;

    if values.is_empty() {
        let table = kind.qualified_table(schema_option(schema), table);
        let sql = match kind {
            DatabaseKind::Postgres => format!("INSERT INTO {table} DEFAULT VALUES;"),
            DatabaseKind::Mysql => format!("INSERT INTO {table} () VALUES ();"),
        };
        return Ok((sql, Vec::new()));
    }

    let mut names = Vec::new();
    let mut placeholders = Vec::new();
    let mut params = Vec::new();

    for (column_name, value) in values {
        let column = column_for(columns, column_name)?;
        names.push(kind.quote_identifier(column_name));
        placeholders.push(kind.parameter_placeholder(params.len() + 1, &column.data_type));
        params.push(query_parameter(column, value));
    }

    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({});",
        kind.qualified_table(schema_option(schema), table),
        names.join(", "),
        placeholders.join(", ")
    );
    Ok((sql, params))
}

fn build_upsert_mutation(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    values: &BTreeMap<String, Value>,
    key_columns: &[String],
) -> Result<(String, Vec<QueryParameter>), String> {
    if key_columns.is_empty() {
        return Err("Upsert requires a target primary key".to_string());
    }
    for key in key_columns {
        if !values.keys().any(|column| column.eq_ignore_ascii_case(key)) {
            return Err(format!(
                "Upsert key column {key} is not mapped from the source table"
            ));
        }
    }

    let (insert, params) = build_insert_mutation(kind, schema, table, columns, values)?;
    let insert = insert.trim_end_matches(';');
    let mutable_columns = values
        .keys()
        .filter(|column| {
            !key_columns
                .iter()
                .any(|key| key.eq_ignore_ascii_case(column))
        })
        .collect::<Vec<_>>();

    let sql = match kind {
        DatabaseKind::Postgres => {
            let conflict = key_columns
                .iter()
                .map(|column| kind.quote_identifier(column))
                .collect::<Vec<_>>()
                .join(", ");
            if mutable_columns.is_empty() {
                format!("{insert} ON CONFLICT ({conflict}) DO NOTHING;")
            } else {
                let updates = mutable_columns
                    .iter()
                    .map(|column| {
                        let identifier = kind.quote_identifier(column);
                        format!("{identifier} = EXCLUDED.{identifier}")
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("{insert} ON CONFLICT ({conflict}) DO UPDATE SET {updates};")
            }
        }
        DatabaseKind::Mysql => {
            let updates = if mutable_columns.is_empty() {
                let key = kind.quote_identifier(&key_columns[0]);
                format!("{key} = VALUES({key})")
            } else {
                mutable_columns
                    .iter()
                    .map(|column| {
                        let identifier = kind.quote_identifier(column);
                        format!("{identifier} = VALUES({identifier})")
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            format!("{insert} ON DUPLICATE KEY UPDATE {updates};")
        }
    };

    Ok((sql, params))
}

/// Keep import, grid and Agent-originated inserts on the same target-table
/// contract. Client-side CSV validation improves the preview, but it cannot
/// be authoritative: cached metadata can be stale and native JSON imports do
/// not pass through the CSV mapping dialog.
fn validate_insert_values(
    columns: &BTreeMap<String, ColumnInfo>,
    values: &BTreeMap<String, Value>,
) -> Result<(), String> {
    for (column_name, value) in values {
        let column = column_for(columns, column_name)?;
        if value.is_null() && !column.is_nullable {
            return Err(format!("Required column {column_name} cannot be NULL"));
        }
    }

    for column in columns.values() {
        let has_server_default = column
            .default_value
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
        if !column.is_nullable
            && !column.is_auto_increment
            && !has_server_default
            && !values.contains_key(&column.name)
        {
            return Err(format!(
                "Required column {} is not provided and has no server default",
                column.name
            ));
        }
    }

    Ok(())
}

fn build_update_mutation(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    update: &TableRowUpdate,
) -> Result<(String, Vec<QueryParameter>), String> {
    if update.values.is_empty() {
        return Err("Update row has no values".to_string());
    }
    if update.key.is_empty() {
        return Err("Update row has no key".to_string());
    }

    let mut params = Vec::new();
    let mut assignments = Vec::new();
    for (column_name, value) in &update.values {
        let column = column_for(columns, column_name)?;
        let placeholder = kind.parameter_placeholder(params.len() + 1, &column.data_type);
        assignments.push(format!(
            "{} = {}",
            kind.quote_identifier(column_name),
            placeholder
        ));
        params.push(query_parameter(column, value));
    }

    let where_clause = build_key_predicate(kind, columns, &update.key, &mut params)?;
    let sql = format!(
        "UPDATE {} SET {} WHERE {};",
        kind.qualified_table(schema_option(schema), table),
        assignments.join(", "),
        where_clause
    );
    Ok((sql, params))
}

fn build_delete_mutation(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    delete: &TableRowDelete,
) -> Result<(String, Vec<QueryParameter>), String> {
    if delete.key.is_empty() {
        return Err("Delete row has no key".to_string());
    }

    let mut params = Vec::new();
    let where_clause = build_key_predicate(kind, columns, &delete.key, &mut params)?;
    let sql = format!(
        "DELETE FROM {} WHERE {};",
        kind.qualified_table(schema_option(schema), table),
        where_clause
    );
    Ok((sql, params))
}

fn build_key_predicate(
    kind: DatabaseKind,
    columns: &BTreeMap<String, ColumnInfo>,
    key: &BTreeMap<String, Value>,
    params: &mut Vec<QueryParameter>,
) -> Result<String, String> {
    let mut predicates = Vec::new();

    for (column_name, value) in key {
        let column = column_for(columns, column_name)?;
        let identifier = kind.quote_identifier(column_name);
        if value.is_null() {
            predicates.push(format!("{identifier} IS NULL"));
        } else {
            let placeholder = kind.parameter_placeholder(params.len() + 1, &column.data_type);
            predicates.push(format!("{identifier} = {placeholder}"));
            params.push(query_parameter(column, value));
        }
    }

    if predicates.is_empty() {
        Err("Mutation key produced no predicates".to_string())
    } else {
        Ok(predicates.join(" AND "))
    }
}

fn summarize_mutation_affected(
    affected: &[u64],
    insert_count: usize,
    update_count: usize,
    delete_count: usize,
) -> TableMutationResult {
    let inserted: u64 = affected.iter().take(insert_count).sum();
    let updated: u64 = affected.iter().skip(insert_count).take(update_count).sum();
    let deleted: u64 = affected
        .iter()
        .skip(insert_count + update_count)
        .take(delete_count)
        .sum();

    TableMutationResult {
        inserted,
        updated,
        deleted,
        rows_affected: inserted + updated + deleted,
    }
}

fn postgres_column_definition(kind: DatabaseKind, column: &ColumnInfo) -> String {
    let mut definition = format!(
        "  {} {}",
        kind.quote_identifier(&column.name),
        column.data_type
    );

    if let Some(default_value) = &column.default_value {
        if !default_value.trim().is_empty() {
            definition.push_str(" DEFAULT ");
            definition.push_str(default_value);
        }
    }

    if !column.is_nullable {
        definition.push_str(" NOT NULL");
    }

    definition
}

fn postgres_constraint_definition(
    kind: DatabaseKind,
    constraint: &ConstraintInfo,
) -> Option<String> {
    let definition = constraint.definition.as_deref()?.trim();
    if definition.is_empty() {
        return None;
    }

    Some(format!(
        "  CONSTRAINT {} {}",
        kind.quote_identifier(&constraint.name),
        definition
    ))
}

fn generate_postgres_table_ddl(
    schema: &str,
    table: &str,
    columns: &[ColumnInfo],
    constraints: &[ConstraintInfo],
    indexes: &[IndexInfo],
) -> String {
    let kind = DatabaseKind::Postgres;
    let mut lines: Vec<String> = columns
        .iter()
        .map(|column| postgres_column_definition(kind, column))
        .collect();

    let constraint_names: std::collections::HashSet<&str> = constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect();

    for constraint in constraints {
        if let Some(definition) = postgres_constraint_definition(kind, constraint) {
            lines.push(definition);
        }
    }

    if !constraints
        .iter()
        .any(|constraint| constraint.constraint_type == "PRIMARY KEY")
    {
        let primary_keys: Vec<String> = columns
            .iter()
            .filter(|column| column.is_primary_key)
            .map(|column| kind.quote_identifier(&column.name))
            .collect();

        if !primary_keys.is_empty() {
            lines.push(format!("  PRIMARY KEY ({})", primary_keys.join(", ")));
        }
    }

    let mut ddl = format!(
        "CREATE TABLE {} (\n{}\n);",
        kind.qualified_table(Some(schema), table),
        lines.join(",\n")
    );

    let extra_indexes: Vec<String> = indexes
        .iter()
        .filter(|index| !index.is_primary && !constraint_names.contains(index.name.as_str()))
        .filter_map(|index| index.definition.as_deref())
        .map(str::trim)
        .filter(|definition| !definition.is_empty())
        .map(ToString::to_string)
        .collect();

    if !extra_indexes.is_empty() {
        ddl.push_str("\n\n");
        ddl.push_str(&extra_indexes.join(";\n"));
        ddl.push(';');
    }

    ddl
}

async fn resolve_object_type(
    manager: &ConnectionManager,
    connection_id: &str,
    schema: &str,
    object_name: &str,
    object_type: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(object_type) = object_type
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok(Some(object_type));
    }

    let object_name = object_name.trim();
    if object_name.is_empty() {
        return Ok(None);
    }

    let tables = manager
        .get_tables(connection_id, schema)
        .await
        .map_err(|e| e.to_string())?;

    Ok(tables
        .into_iter()
        .find(|table| table.name == object_name)
        .and_then(|table| table.table_type))
}

async fn ensure_resolved_relation_operation_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
    schema: &str,
    object_name: &str,
    operation: RelationOperation,
) -> Result<Option<String>, String> {
    let object_type =
        resolve_object_type(manager, connection_id, schema, object_name, None).await?;
    ensure_relation_operation_allowed(object_name, object_type.as_deref(), operation)?;
    Ok(object_type)
}

async fn ensure_target_relation_operation_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    schema: &str,
    object_name: &str,
    operation: RelationOperation,
) -> Result<Option<String>, String> {
    if let Some(database) = database {
        let object_type = manager
            .get_database_tables(connection_id, database, schema)
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|table| table.name == object_name)
            .and_then(|table| table.table_type);
        ensure_relation_operation_allowed(object_name, object_type.as_deref(), operation)?;
        return Ok(object_type);
    }

    ensure_resolved_relation_operation_allowed(
        manager,
        connection_id,
        schema,
        object_name,
        operation,
    )
    .await
}

async fn get_target_columns(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, anyhow::Error> {
    match database {
        Some(database) => {
            manager
                .get_database_columns(connection_id, database, schema, table)
                .await
        }
        None => manager.get_columns(connection_id, schema, table).await,
    }
}

async fn query_target(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    sql: &str,
) -> Result<Vec<QueryResult>, anyhow::Error> {
    match database {
        Some(database) => manager.query_database(connection_id, database, sql).await,
        None => manager.query(connection_id, sql, None, None, None).await,
    }
}

async fn query_transfer_source_tracked(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
    transfer_id: &str,
    sql: &str,
) -> Result<Vec<QueryResult>, anyhow::Error> {
    match endpoint.database.as_deref() {
        Some(database) => {
            manager
                .query_database_with_context(
                    &endpoint.connection_id,
                    database,
                    sql,
                    schema_option(&endpoint.schema),
                    Some(transfer_id),
                )
                .await
        }
        None => {
            manager
                .query(
                    &endpoint.connection_id,
                    sql,
                    schema_option(&endpoint.schema).map(str::to_string),
                    None,
                    Some(transfer_id.to_string()),
                )
                .await
        }
    }
}

async fn query_target_parameterized(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    sql: &str,
    params: &[QueryParameter],
) -> Result<Vec<QueryResult>, anyhow::Error> {
    match database {
        Some(database) => {
            manager
                .query_database_parameterized(connection_id, database, sql, params)
                .await
        }
        None => {
            manager
                .query_parameterized(connection_id, sql, params)
                .await
        }
    }
}

async fn execute_target_parameterized_batch(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    statements: &[ParameterizedStatement],
) -> Result<Vec<u64>, anyhow::Error> {
    match database {
        Some(database) => {
            manager
                .execute_database_parameterized_batch(connection_id, database, statements)
                .await
        }
        None => {
            manager
                .execute_parameterized_batch(connection_id, statements)
                .await
        }
    }
}

#[derive(Debug, Clone)]
struct ResolvedTableDataTransferPlan {
    source_kind: DatabaseKind,
    target_kind: DatabaseKind,
    mapped_columns: Vec<TableDataTransferColumnMapping>,
    skipped_source_columns: Vec<String>,
    source_columns: BTreeMap<String, ColumnInfo>,
    target_columns: BTreeMap<String, ColumnInfo>,
    max_rows: u32,
    batch_size: u32,
    target_rows_to_delete: Option<u64>,
    upsert_key_columns: Vec<String>,
    identity_reseed_columns: Vec<String>,
    confirmation_token: String,
    warnings: Vec<String>,
}

fn normalized_transfer_limit(value: Option<u32>) -> u32 {
    value
        .unwrap_or(DEFAULT_TRANSFER_ROWS)
        .clamp(1, MAX_TRANSFER_ROWS)
}

fn validate_table_data_transfer_id(transfer_id: &str) -> Result<(), String> {
    let transfer_id = transfer_id.trim();
    if !(8..=128).contains(&transfer_id.len())
        || !transfer_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(
            "Transfer id must contain 8-128 ASCII letters, digits, hyphens, or underscores."
                .to_string(),
        );
    }
    Ok(())
}

fn validate_table_data_transfer_overwrite_rows(count: u64) -> Result<u64, String> {
    if count > MAX_TRANSFER_OVERWRITE_ROWS {
        return Err(format!(
            "Overwrite is limited to {MAX_TRANSFER_OVERWRITE_ROWS} existing target rows; the target currently contains {count}."
        ));
    }
    Ok(count)
}

fn emit_table_data_transfer_progress(app: &AppHandle, progress: TableDataTransferProgress) {
    if let Err(error) = app.emit(TABLE_DATA_TRANSFER_PROGRESS_EVENT, progress) {
        tracing::warn!("Could not emit table data transfer progress: {error}");
    }
}

fn bounded_table_data_transfer_message(message: &str) -> String {
    const MAX_CHARS: usize = 1_024;
    let mut bounded = message.chars().take(MAX_CHARS).collect::<String>();
    if message.chars().count() > MAX_CHARS {
        bounded.push('…');
    }
    bounded
}

async fn verify_completed_table_data_transfer(
    manager: &ConnectionManager,
    request: &TableDataTransferRequest,
    transfer: &TableDataTransferResult,
) -> TableDataTransferVerification {
    if request.mode != TableDataTransferMode::Overwrite {
        return TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::NotAvailable,
            expected_rows: None,
            observed_rows: None,
            message: if request.mode == TableDataTransferMode::Upsert {
                "Row-count verification is inconclusive for upsert because existing rows may be updated."
                    .to_string()
            } else {
                "Append verification requires a stable baseline count and is not recorded for this transfer."
                    .to_string()
            },
        };
    }

    let target_kind = match table_data_transfer_dialect(manager, &request.target).await {
        Ok(kind) => kind,
        Err(_) => {
            return TableDataTransferVerification {
                status: TableDataTransferVerificationStatus::NeedsReview,
                expected_rows: Some(transfer.rows_transferred),
                observed_rows: None,
                message: "The transfer committed, but the target could not be reopened for post-commit verification."
                    .to_string(),
            }
        }
    };
    let count_sql = target_kind.count_table_query(
        schema_option(&request.target.schema),
        &request.target.table,
        None,
    );
    let observed_rows = query_target(
        manager,
        &request.target.connection_id,
        request.target.database.as_deref(),
        &count_sql,
    )
    .await
    .ok()
    .and_then(|results| {
        results
            .first()
            .and_then(|result| result.rows.first())
            .and_then(|row| row.first())
            .and_then(value_to_u64)
    });
    overwrite_transfer_verification(transfer.rows_transferred, observed_rows)
}

fn overwrite_transfer_verification(
    expected_rows: u64,
    observed_rows: Option<u64>,
) -> TableDataTransferVerification {
    match observed_rows {
        Some(observed_rows) if observed_rows == expected_rows => TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::Verified,
            expected_rows: Some(expected_rows),
            observed_rows: Some(observed_rows),
            message: "Post-commit target row count matches the completed overwrite transfer."
                .to_string(),
        },
        Some(observed_rows) => TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::NeedsReview,
            expected_rows: Some(expected_rows),
            observed_rows: Some(observed_rows),
            message: "The transfer committed, but the post-commit target row count differs; review concurrent writes before retrying."
                .to_string(),
        },
        None => TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::NeedsReview,
            expected_rows: Some(expected_rows),
            observed_rows: None,
            message: "The transfer committed, but the target row count could not be verified after commit."
                .to_string(),
        },
    }
}

fn normalized_table_data_transfer_project_id(project_id: Option<&str>) -> Option<String> {
    let project_id = project_id?.trim();
    if project_id.is_empty()
        || project_id.len() > 128
        || project_id.chars().any(|value| value.is_control())
    {
        return None;
    }
    Some(project_id.to_string())
}

fn table_data_transfer_report_id(transfer_id: &str) -> String {
    format!("table-transfer-report-{transfer_id}")
}

fn table_data_transfer_plan_digest(confirmation_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(confirmation_token.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn current_table_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

async fn persist_table_data_transfer_report(
    meta_store: &MetaStore,
    report: &TableDataTransferReport,
) -> Result<(), String> {
    let metadata = serde_json::to_value(report)
        .map_err(|error| format!("Could not serialize table transfer report: {error}"))?;
    let resource = Resource {
        id: report.id.clone(),
        project_id: report.project_id.clone(),
        // The destination owns the durable outcome. The report includes the
        // source endpoint so a target connection history remains actionable.
        connection_id: report.target.connection_id.clone(),
        parent_id: Some(TABLE_DATA_TRANSFER_REPORT_PARENT_ID.to_string()),
        kind: TABLE_DATA_TRANSFER_REPORT_KIND.to_string(),
        name: format!("{}:{}", report.started_at, endpoint_label(&report.target)),
        metadata,
        last_updated: current_table_timestamp_millis(),
    };
    meta_store
        .save_resources(&report.project_id, &[resource])
        .await
        .map_err(|error| format!("Could not persist table transfer report: {error}"))
}

fn normalized_transfer_batch_size(value: Option<u32>) -> u32 {
    value
        .unwrap_or(DEFAULT_TRANSFER_BATCH_SIZE)
        .clamp(1, MAX_TRANSFER_BATCH_SIZE)
}

fn normalized_transfer_driver_id(driver: &str) -> String {
    canonical_driver_name(driver)
        .unwrap_or_else(|| driver.trim())
        .to_ascii_lowercase()
}

fn resolve_transfer_upsert_key_columns(
    mode: TableDataTransferMode,
    target_is_external: bool,
    target_columns: &[ColumnInfo],
    mapped_columns: &[TableDataTransferColumnMapping],
) -> Result<Vec<String>, String> {
    if mode != TableDataTransferMode::Upsert {
        return Ok(Vec::new());
    }
    if target_is_external {
        return Err(
            "Upsert is not available for external driver packages until the signed protocol declares semantic conflict-write support."
                .to_string(),
        );
    }
    let keys = target_columns
        .iter()
        .filter(|column| column.is_primary_key)
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    if keys.is_empty() {
        return Err("Upsert requires a declared primary key on the target table.".to_string());
    }
    let missing = keys
        .iter()
        .filter(|key| {
            !mapped_columns
                .iter()
                .any(|mapping| mapping.target.eq_ignore_ascii_case(key))
        })
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!(
            "Upsert requires every target primary-key column to be mapped: {}.",
            missing.join(", ")
        ));
    }
    Ok(keys)
}

async fn ensure_transfer_endpoint_driver_matches_connection(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
) -> Result<(), String> {
    let Some(connected_driver) = manager
        .connection_driver_id(&endpoint.connection_id)
        .await
        .map_err(|error| error.to_string())?
    else {
        // Programmatic legacy/test connections may not carry an identity.
        // Their driver remains the execution authority; preserve that path
        // while all desktop-opened connections receive the stronger binding.
        return Ok(());
    };
    let requested_driver = normalized_transfer_driver_id(&endpoint.driver);
    if connected_driver != requested_driver {
        return Err(format!(
            "Transfer endpoint driver '{}' does not match the connected driver '{}'. Refresh the connection and preview again.",
            endpoint.driver.trim(), connected_driver
        ));
    }
    Ok(())
}

fn endpoint_label(endpoint: &TableDataTransferEndpoint) -> String {
    let namespace = endpoint
        .database
        .as_deref()
        .filter(|database| !database.trim().is_empty())
        .map(|database| format!("{database}."))
        .unwrap_or_default();
    let schema = schema_option(&endpoint.schema)
        .map(|schema| format!("{schema}."))
        .unwrap_or_default();
    format!("{}{}{}", namespace, schema, endpoint.table.trim())
}

fn transfer_confirmation_token(
    request: &TableDataTransferRequest,
    mapped_columns: &[TableDataTransferColumnMapping],
    max_rows: u32,
    batch_size: u32,
    target_rows_to_delete: Option<u64>,
    upsert_key_columns: &[String],
) -> Result<String, String> {
    let binding = serde_json::json!({
        "transferId": &request.transfer_id,
        "source": &request.source,
        "target": &request.target,
        "mode": request.mode,
        "mappedColumns": mapped_columns,
        "maxRows": max_rows,
        "batchSize": batch_size,
        "targetRowsToDelete": target_rows_to_delete,
        "upsertKeyColumns": upsert_key_columns,
        "reseedIdentity": request.reseed_identity,
    });
    let encoded = serde_json::to_vec(&binding).map_err(|error| error.to_string())?;
    let digest = format!("{:x}", Sha256::digest(encoded));
    Ok(format!("TRANSFER {}", digest[..8].to_ascii_uppercase()))
}

fn postgres_identity_reseed_columns(
    target_kind: DatabaseKind,
    target_columns: &[ColumnInfo],
    enabled: bool,
) -> Result<Vec<String>, String> {
    if !enabled {
        return Ok(Vec::new());
    }
    if target_kind != DatabaseKind::Postgres {
        return Err("Identity reseed is currently available only for a PostgreSQL target.".to_string());
    }
    Ok(target_columns
        .iter()
        .filter(|column| {
            column.is_auto_increment
                || column.default_value.as_deref().is_some_and(|value| {
                    value.to_ascii_lowercase().contains("nextval(")
                })
        })
        .map(|column| column.name.clone())
        .collect())
}

fn postgres_identity_reseed_statements(
    endpoint: &TableDataTransferEndpoint,
    columns: &[String],
) -> Vec<ParameterizedStatement> {
    let relation = DatabaseKind::Postgres.qualified_table(
        schema_option(&endpoint.schema),
        &endpoint.table,
    );
    columns
        .iter()
        .map(|column| {
            let quoted_column = DatabaseKind::Postgres.quote_identifier(column);
            ParameterizedStatement {
                sql: format!(
                    "SELECT setval(pg_get_serial_sequence({}, {}), GREATEST(COALESCE(MAX({quoted_column}), 0), 1), MAX({quoted_column}) IS NOT NULL) FROM {relation}",
                    sql_string_literal(&relation),
                    sql_string_literal(column),
                ),
                params: Vec::new(),
            }
        })
        .collect()
}

fn build_data_transfer_column_mapping(
    source_columns: &[ColumnInfo],
    target_columns: &[ColumnInfo],
) -> Result<(Vec<TableDataTransferColumnMapping>, Vec<String>), String> {
    let mut target_by_name = BTreeMap::<String, Vec<&ColumnInfo>>::new();
    for target in target_columns {
        target_by_name
            .entry(target.name.to_ascii_lowercase())
            .or_default()
            .push(target);
    }

    let mut mappings = Vec::new();
    let mut skipped = Vec::new();
    for source in source_columns {
        let matches = target_by_name
            .get(&source.name.to_ascii_lowercase())
            .map(Vec::as_slice)
            .unwrap_or_default();
        match matches {
            [target] => {
                let (compatibility, conversion, reason) =
                    transfer_type_mapping_assessment(&source.data_type, &target.data_type);
                mappings.push(TableDataTransferColumnMapping {
                    source: source.name.clone(),
                    target: target.name.clone(),
                    data_type: target.data_type.clone(),
                    source_data_type: source.data_type.clone(),
                    target_data_type: target.data_type.clone(),
                    compatibility,
                    conversion,
                    reason,
                });
            }
            [] => skipped.push(source.name.clone()),
            _ => {
                return Err(format!(
                    "Target table has ambiguous case-insensitive column matches for {}",
                    source.name
                ));
            }
        }
    }

    if mappings.is_empty() {
        return Err("Source and target tables do not have any compatible column names".to_string());
    }

    let mapped_targets = mappings
        .iter()
        .map(|mapping| mapping.target.as_str())
        .collect::<HashSet<_>>();
    let missing_required = target_columns
        .iter()
        .filter(|column| {
            !column.is_nullable
                && !column.is_auto_increment
                && !column
                    .default_value
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                && !mapped_targets.contains(column.name.as_str())
        })
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    if !missing_required.is_empty() {
        return Err(format!(
            "Target requires values for column(s): {}",
            missing_required.join(", ")
        ));
    }

    Ok((mappings, skipped))
}

fn transfer_type_family(data_type: &str) -> &'static str {
    let normalized = data_type.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return "unknown";
    }
    if normalized.contains("json") {
        return "json";
    }
    if normalized.contains("bool") || normalized == "bit" {
        return "boolean";
    }
    if normalized.contains("uuid") || normalized.contains("uniqueidentifier") {
        return "uuid";
    }
    if normalized.contains("blob")
        || normalized.contains("binary")
        || normalized.contains("bytea")
        || normalized.contains("varbinary")
    {
        return "binary";
    }
    if normalized.contains("timestamp")
        || normalized.contains("datetime")
        || normalized == "date"
        || normalized == "time"
    {
        return "temporal";
    }
    if normalized.contains("int") || normalized.contains("serial") {
        return "integer";
    }
    if normalized.contains("numeric")
        || normalized.contains("decimal")
        || normalized.contains("float")
        || normalized.contains("double")
        || normalized.contains("real")
    {
        return "numeric";
    }
    if normalized.contains("char")
        || normalized.contains("text")
        || normalized.contains("string")
        || normalized.contains("clob")
        || normalized.contains("varchar")
    {
        return "text";
    }
    "other"
}

fn normalized_transfer_type(data_type: &str) -> String {
    data_type
        .trim()
        .to_ascii_lowercase()
        .split('(')
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .filter(|part| !matches!(*part, "unsigned" | "zerofill"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn transfer_type_mapping_assessment(
    source_data_type: &str,
    target_data_type: &str,
) -> (
    TableDataTransferCompatibility,
    TableDataTransferConversion,
    String,
) {
    use TableDataTransferCompatibility::{Exact, Review, Safe, Unsupported};
    use TableDataTransferConversion::{None, StringifyJson, StringifyScalar, TargetBinding};

    let source_normalized = normalized_transfer_type(source_data_type);
    let target_normalized = normalized_transfer_type(target_data_type);
    let source_family = transfer_type_family(source_data_type);
    let target_family = transfer_type_family(target_data_type);

    if !source_normalized.is_empty() && source_normalized == target_normalized {
        return (Exact, None, "Source and target types match.".to_string());
    }
    if target_family == "text" {
        let conversion = match source_family {
            "json" => StringifyJson,
            "text" => TargetBinding,
            _ => StringifyScalar,
        };
        return (
            Safe,
            conversion,
            "The source value is serialized through the target text binding.".to_string(),
        );
    }
    if source_family == target_family && source_family != "other" {
        return (
            Safe,
            TargetBinding,
            format!("Both types belong to the {source_family} family."),
        );
    }
    if source_family == "integer" && target_family == "numeric" {
        return (
            Safe,
            TargetBinding,
            "Integer values widen through the target numeric binding.".to_string(),
        );
    }
    if source_family == "numeric" && target_family == "integer" {
        return (
            Review,
            TargetBinding,
            "Numeric-to-integer conversion can lose fractional values or overflow.".to_string(),
        );
    }
    if source_family == "text" {
        return (
            Review,
            TargetBinding,
            format!(
                "Text values must be parsed by the target {target_family} binding; sample rows are validated during preview."
            ),
        );
    }
    if matches!(source_family, "unknown" | "other") || matches!(target_family, "unknown" | "other")
    {
        return (
            Review,
            TargetBinding,
            "The type family is not recognized; the target driver must validate each parameter."
                .to_string(),
        );
    }

    let unsupported = matches!(
        (source_family, target_family),
        (
            "binary",
            "boolean" | "integer" | "numeric" | "temporal" | "uuid" | "json"
        ) | (
            "json",
            "boolean" | "integer" | "numeric" | "temporal" | "uuid" | "binary"
        ) | ("temporal", "boolean" | "binary" | "json")
            | (
                "uuid",
                "boolean" | "integer" | "numeric" | "temporal" | "binary" | "json"
            )
            | ("boolean", "temporal" | "binary" | "json" | "uuid")
            | (
                "integer" | "numeric",
                "temporal" | "binary" | "json" | "uuid"
            )
    );
    if unsupported {
        return (
            Unsupported,
            None,
            format!("No reviewed {source_family}-to-{target_family} conversion is available."),
        );
    }

    (
        Review,
        TargetBinding,
        format!(
            "The target driver must convert {source_family} values to {target_family}; review representative rows."
        ),
    )
}

fn transfer_type_mapping_warnings(mappings: &[TableDataTransferColumnMapping]) -> Vec<String> {
    mappings
        .iter()
        .filter_map(|mapping| match mapping.compatibility {
            TableDataTransferCompatibility::Exact | TableDataTransferCompatibility::Safe => None,
            TableDataTransferCompatibility::Review => Some(format!(
                "Type review: {} ({}) → {} ({}). {}",
                mapping.source,
                mapping.source_data_type,
                mapping.target,
                mapping.target_data_type,
                mapping.reason,
            )),
            TableDataTransferCompatibility::Unsupported => Some(format!(
                "Blocked mapping: {} ({}) → {} ({}). {}",
                mapping.source,
                mapping.source_data_type,
                mapping.target,
                mapping.target_data_type,
                mapping.reason,
            )),
        })
        .collect()
}

fn transfer_plan_can_execute(mappings: &[TableDataTransferColumnMapping]) -> bool {
    mappings
        .iter()
        .all(|mapping| mapping.compatibility != TableDataTransferCompatibility::Unsupported)
}

fn apply_transfer_conversion(
    mapping: &TableDataTransferColumnMapping,
    value: &Value,
) -> Result<Value, String> {
    use TableDataTransferConversion::{None, StringifyJson, StringifyScalar, TargetBinding};

    if mapping.compatibility == TableDataTransferCompatibility::Unsupported {
        return Err(format!(
            "Unsupported transfer mapping {} ({}) → {} ({}): {}",
            mapping.source,
            mapping.source_data_type,
            mapping.target,
            mapping.target_data_type,
            mapping.reason,
        ));
    }
    match mapping.conversion {
        None | TargetBinding => Ok(value.clone()),
        StringifyJson => {
            if value.is_null() {
                Ok(Value::Null)
            } else if let Value::String(value) = value {
                Ok(Value::String(value.clone()))
            } else {
                serde_json::to_string(value)
                    .map(Value::String)
                    .map_err(|error| {
                        format!(
                            "Could not serialize {} as JSON text: {error}",
                            mapping.source
                        )
                    })
            }
        }
        StringifyScalar => match value {
            Value::Null => Ok(Value::Null),
            Value::String(value) => Ok(Value::String(value.clone())),
            Value::Bool(value) => Ok(Value::String(value.to_string())),
            Value::Number(value) => Ok(Value::String(value.to_string())),
            Value::Array(_) | Value::Object(_) => serde_json::to_string(value)
                .map(Value::String)
                .map_err(|error| {
                    format!(
                        "Could not serialize {} as target text: {error}",
                        mapping.source
                    )
                }),
        },
    }
}

fn transfer_target_column_type(
    source_data_type: &str,
    target_driver: &str,
) -> (String, Option<String>, String) {
    let family = transfer_type_family(source_data_type);
    let normalized = normalized_transfer_type(source_data_type);
    let source_lower = source_data_type.trim().to_ascii_lowercase();
    let unsigned_integer = family == "integer" && source_lower.contains("unsigned");
    let floating_numeric = family == "numeric"
        && ["float", "double", "real"]
            .iter()
            .any(|marker| source_lower.contains(marker));
    let target_driver = normalized_transfer_driver_id(target_driver);
    let is_sqlite = matches!(target_driver.as_str(), "sqlite" | "sqlite3");
    let is_mysql = matches!(target_driver.as_str(), "mysql" | "mariadb");

    let (data_type, length) = if is_sqlite {
        match family {
            "integer" if unsigned_integer => ("NUMERIC", None),
            "integer" => ("INTEGER", None),
            "numeric" if floating_numeric => ("REAL", None),
            "numeric" => ("NUMERIC", None),
            "boolean" => ("BOOLEAN", None),
            "temporal" if normalized == "date" => ("DATE", None),
            "temporal" => ("DATETIME", None),
            "binary" => ("BLOB", None),
            "json" => ("JSON", None),
            _ => ("TEXT", None),
        }
    } else if is_mysql {
        match family {
            "integer" if unsigned_integer => ("DECIMAL", Some("20,0".to_string())),
            "integer" => ("BIGINT", None),
            "numeric" if floating_numeric => ("DOUBLE", None),
            "numeric" => ("DECIMAL", Some("65,30".to_string())),
            "boolean" => ("BOOLEAN", None),
            "temporal" if normalized == "date" => ("DATE", None),
            "temporal" => ("DATETIME", None),
            "binary" => ("BLOB", None),
            "json" => ("JSON", None),
            "uuid" => ("VARCHAR", Some("36".to_string())),
            _ => ("TEXT", None),
        }
    } else {
        match family {
            "integer" if unsigned_integer => ("DECIMAL", None),
            "integer" => ("BIGINT", None),
            "numeric" if floating_numeric => ("DOUBLE PRECISION", None),
            "numeric" => ("DECIMAL", None),
            "boolean" => ("BOOLEAN", None),
            "temporal" if normalized == "date" => ("DATE", None),
            "temporal" => ("TIMESTAMP", None),
            "binary" => ("BYTEA", None),
            "json" => ("JSONB", None),
            "uuid" => ("UUID", None),
            _ => ("TEXT", None),
        }
    };

    let reason = if family == "other" || family == "unknown" {
        format!(
            "The source type '{}' is not recognized; the generated target uses TEXT for a reviewable, non-lossy textual fallback.",
            source_data_type.trim()
        )
    } else if data_type.eq_ignore_ascii_case(source_data_type.trim()) && length.is_none() {
        "The source type is directly supported by the target dialect.".to_string()
    } else {
        format!(
            "The source {family} type is mapped to the target dialect's conservative {data_type} representation."
        )
    };

    (data_type.to_string(), length, reason)
}

fn build_transfer_target_columns(
    source_columns: &[ColumnInfo],
    target_driver: &str,
) -> Result<(Vec<TableDataTransferTargetColumn>, Vec<CreateTableColumn>), String> {
    if source_columns.is_empty() {
        return Err("Source table has no column metadata".to_string());
    }

    let mut planned = Vec::with_capacity(source_columns.len());
    let mut create_columns = Vec::with_capacity(source_columns.len());
    for source in source_columns {
        let (target_data_type, target_length, reason) =
            transfer_target_column_type(&source.data_type, target_driver);
        planned.push(TableDataTransferTargetColumn {
            name: source.name.clone(),
            source_data_type: source.data_type.clone(),
            target_data_type: target_data_type.clone(),
            target_length: target_length.clone(),
            is_primary_key: source.is_primary_key,
            is_not_null: !source.is_nullable,
            reason,
        });
        create_columns.push(CreateTableColumn {
            name: source.name.clone(),
            data_type: target_data_type,
            length: target_length,
            is_primary_key: source.is_primary_key,
            is_not_null: !source.is_nullable,
            // Identity/sequence semantics are deliberately not synthesized:
            // transfer inserts the reviewed source values explicitly.
            is_auto_increment: false,
            comment: None,
        });
    }
    Ok((planned, create_columns))
}

async fn ensure_transfer_target_table_absent(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
) -> Result<(), String> {
    let tables = match endpoint.database.as_deref() {
        Some(database) => {
            manager
                .get_database_tables(&endpoint.connection_id, database, &endpoint.schema)
                .await
        }
        None => {
            manager
                .get_tables(&endpoint.connection_id, &endpoint.schema)
                .await
        }
    }
    .map_err(|error| error.to_string())?;
    if tables
        .iter()
        .any(|table| table.name.eq_ignore_ascii_case(endpoint.table.trim()))
    {
        return Err(format!(
            "Target table already exists: {}",
            endpoint_label(endpoint)
        ));
    }
    Ok(())
}

fn transfer_target_confirmation_token(
    request: &TableDataTransferTargetPlanRequest,
    columns: &[TableDataTransferTargetColumn],
    statements: &[String],
) -> Result<String, String> {
    let binding = serde_json::json!({
        "source": &request.source,
        "target": &request.target,
        "columns": columns,
        "statements": statements,
    });
    let encoded = serde_json::to_vec(&binding).map_err(|error| error.to_string())?;
    let digest = format!("{:x}", Sha256::digest(encoded));
    Ok(format!("CREATE {}", digest[..8].to_ascii_uppercase()))
}

async fn resolve_table_data_transfer_target_plan(
    manager: &ConnectionManager,
    request: &TableDataTransferTargetPlanRequest,
) -> Result<TableDataTransferTargetPlan, String> {
    if request.source.table.trim().is_empty() || request.target.table.trim().is_empty() {
        return Err("Source and target table names are required".to_string());
    }
    ensure_transfer_endpoint_driver_matches_connection(manager, &request.source).await?;
    ensure_transfer_endpoint_driver_matches_connection(manager, &request.target).await?;
    table_data_transfer_dialect(manager, &request.source).await?;
    table_data_transfer_dialect(manager, &request.target).await?;
    ensure_host_table_ddl_allowed(manager, &request.target.connection_id, "creation").await?;
    ensure_transfer_target_table_absent(manager, &request.target).await?;

    let target_driver = normalized_transfer_driver_id(&request.target.driver);
    let source_columns = get_target_columns(
        manager,
        &request.source.connection_id,
        request.source.database.as_deref(),
        &request.source.schema,
        &request.source.table,
    )
    .await
    .map_err(|error| error.to_string())?;
    let (columns, create_columns) = build_transfer_target_columns(&source_columns, &target_driver)?;
    let statements = if matches!(target_driver.as_str(), "sqlite" | "sqlite3") {
        build_sqlite_create_table_statements(
            &request.target.schema,
            &request.target.table,
            &create_columns,
        )?
    } else {
        let kind = DatabaseKind::from_str(&target_driver).map_err(|error| error.to_string())?;
        build_create_table_statements(
            kind,
            &request.target.schema,
            &request.target.table,
            &create_columns,
        )?
    };
    let confirmation_token = transfer_target_confirmation_token(request, &columns, &statements)?;
    let mut warnings = vec![format!(
        "This creates only the empty target table {}. Data is copied later through a separate reviewed transfer.",
        endpoint_label(&request.target)
    )];
    warnings.push(
        "Identity, sequence, foreign-key, check, trigger, index, and default expressions are not synthesized. Primary-key and nullability metadata are retained."
            .to_string(),
    );
    warnings.extend(
        columns
            .iter()
            .filter(|column| {
                !normalized_transfer_type(&column.source_data_type)
                    .eq_ignore_ascii_case(&normalized_transfer_type(&column.target_data_type))
            })
            .map(|column| {
                format!(
                    "{}: {} → {}. {}",
                    column.name, column.source_data_type, column.target_data_type, column.reason
                )
            }),
    );

    Ok(TableDataTransferTargetPlan {
        columns,
        statements,
        confirmation_token,
        warnings,
    })
}

#[tauri::command]
pub async fn preview_table_data_transfer_target(
    manager: State<'_, ConnectionManager>,
    request: TableDataTransferTargetPlanRequest,
) -> Result<Response<TableDataTransferTargetPlan>, String> {
    match resolve_table_data_transfer_target_plan(&manager, &request).await {
        Ok(plan) => Ok(Response::ok(plan)),
        Err(error) => Ok(Response::err(
            "PREVIEW_TABLE_DATA_TRANSFER_TARGET_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn create_table_data_transfer_target(
    manager: State<'_, ConnectionManager>,
    request: TableDataTransferTargetPlanRequest,
    confirmation_token: String,
) -> Result<Response<CreateTableResult>, String> {
    let result: Result<CreateTableResult, String> = async {
        let plan = resolve_table_data_transfer_target_plan(&manager, &request).await?;
        if confirmation_token.trim() != plan.confirmation_token {
            return Err(format!(
                "Type the exact confirmation phrase: {}",
                plan.confirmation_token
            ));
        }
        for statement in &plan.statements {
            query_target(
                &manager,
                &request.target.connection_id,
                request.target.database.as_deref(),
                statement,
            )
            .await
            .map_err(|error| error.to_string())?;
        }
        Ok(CreateTableResult {
            table: request.target.table.trim().to_string(),
            statements: plan.statements,
        })
    }
    .await;

    match result {
        Ok(created) => Ok(Response::ok(created)),
        Err(error) => Ok(Response::err(
            "CREATE_TABLE_DATA_TRANSFER_TARGET_ERROR",
            &error,
        )),
    }
}

async fn resolve_table_data_transfer_plan(
    manager: &ConnectionManager,
    request: &TableDataTransferRequest,
) -> Result<ResolvedTableDataTransferPlan, String> {
    validate_table_data_transfer_id(&request.transfer_id)?;
    if request.source.connection_id.trim().is_empty()
        || request.target.connection_id.trim().is_empty()
    {
        return Err("Source and target connections are required".to_string());
    }
    if request.source.table.trim().is_empty() || request.target.table.trim().is_empty() {
        return Err("Source and target tables are required".to_string());
    }
    ensure_transfer_endpoint_driver_matches_connection(manager, &request.source).await?;
    ensure_transfer_endpoint_driver_matches_connection(manager, &request.target).await?;
    let source_kind = table_data_transfer_dialect(manager, &request.source).await?;
    let target_kind = table_data_transfer_dialect(manager, &request.target).await?;
    if request.source.connection_id == request.target.connection_id
        && request.source.database == request.target.database
        && request.source.schema == request.target.schema
        && request.source.table == request.target.table
    {
        return Err("Source and target tables must be different".to_string());
    }

    ensure_target_relation_operation_allowed(
        manager,
        &request.target.connection_id,
        request.target.database.as_deref(),
        &request.target.schema,
        &request.target.table,
        RelationOperation::DataMutation,
    )
    .await?;

    let source_columns = get_target_columns(
        manager,
        &request.source.connection_id,
        request.source.database.as_deref(),
        &request.source.schema,
        &request.source.table,
    )
    .await
    .map_err(|error| error.to_string())?;
    let target_columns = get_target_columns(
        manager,
        &request.target.connection_id,
        request.target.database.as_deref(),
        &request.target.schema,
        &request.target.table,
    )
    .await
    .map_err(|error| error.to_string())?;
    let (mapped_columns, skipped_source_columns) =
        build_data_transfer_column_mapping(&source_columns, &target_columns)?;
    let target_is_external = manager
        .is_external_driver_connection(&request.target.connection_id)
        .await
        .map_err(|error| error.to_string())?;
    let upsert_key_columns = resolve_transfer_upsert_key_columns(
        request.mode,
        target_is_external,
        &target_columns,
        &mapped_columns,
    )?;
    let identity_reseed_columns = postgres_identity_reseed_columns(
        target_kind,
        &target_columns,
        request.reseed_identity,
    )?;
    let max_rows = normalized_transfer_limit(request.max_rows);
    let batch_size = normalized_transfer_batch_size(request.batch_size);
    let target_rows_to_delete = if request.mode == TableDataTransferMode::Overwrite {
        let count_sql = target_kind.count_table_query(
            schema_option(&request.target.schema),
            &request.target.table,
            None,
        );
        let results = query_target(
            manager,
            &request.target.connection_id,
            request.target.database.as_deref(),
            &count_sql,
        )
        .await
        .map_err(|error| error.to_string())?;
        let count = results
            .first()
            .and_then(|result| result.rows.first())
            .and_then(|row| row.first())
            .and_then(value_to_u64)
            .ok_or_else(|| {
                "Target row count could not be verified for overwrite mode".to_string()
            })?;
        Some(validate_table_data_transfer_overwrite_rows(count)?)
    } else {
        None
    };
    let confirmation_token = transfer_confirmation_token(
        request,
        &mapped_columns,
        max_rows,
        batch_size,
        target_rows_to_delete,
        &upsert_key_columns,
    )?;

    let mut warnings = vec![match request.mode {
        TableDataTransferMode::Overwrite => format!(
            "Overwrite mode deletes {count} existing row(s) from {} inside the same target transaction before inserting source rows.",
            endpoint_label(&request.target),
            count = target_rows_to_delete.unwrap_or_default(),
        ),
        TableDataTransferMode::Upsert => format!(
            "Upsert mode inserts new rows and updates conflicts in {} using target primary key ({}).",
            endpoint_label(&request.target),
            upsert_key_columns.join(", ")
        ),
        TableDataTransferMode::Append => format!(
            "Append mode adds rows to {} and does not delete or update existing rows.",
            endpoint_label(&request.target)
        ),
    }];
    if request.mode == TableDataTransferMode::Upsert {
        warnings.push(
            "Explicit identity values are copied, but database sequences/identity generators are not reseeded by this transfer. Review the target generator before later inserts."
                .to_string(),
        );
    }
    if request.reseed_identity {
        if identity_reseed_columns.is_empty() {
            warnings.push("Identity reseed was requested, but the PostgreSQL target exposes no serial/identity column to synchronize.".to_string());
        } else {
            warnings.push(format!(
                "After data writes, the PostgreSQL generator(s) for {} will be synchronized inside the same target transaction.",
                identity_reseed_columns.join(", ")
            ));
        }
    }
    if !skipped_source_columns.is_empty() {
        warnings.push(format!(
            "Source-only columns will be skipped: {}.",
            skipped_source_columns.join(", ")
        ));
    }
    warnings.extend(transfer_type_mapping_warnings(&mapped_columns));
    warnings.push(format!(
        "Each run is bounded to {max_rows} rows, writes batches of at most {batch_size} rows, and commits the target only after every batch succeeds."
    ));

    Ok(ResolvedTableDataTransferPlan {
        source_kind,
        target_kind,
        mapped_columns,
        skipped_source_columns,
        source_columns: column_lookup(source_columns),
        target_columns: column_lookup(target_columns),
        max_rows,
        batch_size,
        target_rows_to_delete,
        upsert_key_columns,
        identity_reseed_columns,
        confirmation_token,
        warnings,
    })
}

fn map_transfer_result_rows(
    result: &QueryResult,
    plan: &ResolvedTableDataTransferPlan,
) -> Result<Vec<BTreeMap<String, Value>>, String> {
    let indices = plan
        .mapped_columns
        .iter()
        .map(|mapping| {
            result
                .columns
                .iter()
                .position(|column| column.name.eq_ignore_ascii_case(&mapping.source))
                .ok_or_else(|| {
                    format!(
                        "Source query did not return the mapped column {}",
                        mapping.source
                    )
                })
                .map(|index| (mapping, index))
        })
        .collect::<Result<Vec<_>, _>>()?;

    result
        .rows
        .iter()
        .map(|row| {
            indices
                .iter()
                .map(|(mapping, index)| {
                    row.get(*index)
                        .ok_or_else(|| "Source row is shorter than its column metadata".to_string())
                        .and_then(|value| apply_transfer_conversion(mapping, value))
                        .map(|value| (mapping.target.clone(), value))
                })
                .collect()
        })
        .collect()
}

const MAX_TABLE_DATA_TRANSFER_BATCH_TABLES: usize = 100;

fn normalized_table_data_transfer_batch_tables(tables: &[String]) -> Result<Vec<String>, String> {
    if tables.is_empty() || tables.len() > MAX_TABLE_DATA_TRANSFER_BATCH_TABLES {
        return Err(format!(
            "Select between 1 and {MAX_TABLE_DATA_TRANSFER_BATCH_TABLES} tables for a batch transfer plan."
        ));
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(tables.len());
    for table in tables {
        let table = table.trim();
        if table.is_empty() || table.len() > 256 || table.chars().any(char::is_control) {
            return Err(
                "Batch transfer table names must be non-empty bounded identifiers.".to_string(),
            );
        }
        let key = table.to_ascii_lowercase();
        if !seen.insert(key) {
            return Err(format!("Batch transfer contains duplicate table {table}."));
        }
        normalized.push(table.to_string());
    }
    Ok(normalized)
}

fn table_data_transfer_batch_preflight_id(
    request: &TableDataTransferBatchPlanRequest,
    table: &str,
) -> Result<String, String> {
    let encoded = serde_json::to_vec(&(request, table))
        .map_err(|error| format!("Could not encode batch table preflight: {error}"))?;
    let digest = Sha256::digest(encoded);
    Ok(format!("batch-plan-{:X}", u64::from_be_bytes(digest[..8].try_into().expect("sha256 prefix"))))
}

fn finalize_table_data_transfer_batch_confirmation(
    request: &TableDataTransferBatchPlanRequest,
    plan: &mut TableDataTransferBatchPlan,
) -> Result<(), String> {
    let binding = serde_json::json!({
        "request": request,
        "orderedTables": &plan.ordered_tables,
        "dependencies": &plan.dependencies,
        "cyclicTables": &plan.cyclic_tables,
        "preflights": &plan.table_preflights,
    });
    let encoded = serde_json::to_vec(&binding)
        .map_err(|error| format!("Could not encode batch transfer confirmation: {error}"))?;
    let digest = Sha256::digest(encoded);
    plan.confirmation_token = format!(
        "BATCH TRANSFER {:X}",
        u64::from_be_bytes(digest[..8].try_into().expect("sha256 prefix"))
    );
    Ok(())
}

fn table_data_transfer_batch_plan(
    request: &TableDataTransferBatchPlanRequest,
    tables: &[String],
    constraints_by_table: &[(String, Vec<ConstraintInfo>)],
) -> Result<TableDataTransferBatchPlan, String> {
    let table_by_key = tables
        .iter()
        .map(|table| (table.to_ascii_lowercase(), table.clone()))
        .collect::<HashMap<_, _>>();
    let mut outgoing = tables
        .iter()
        .map(|table| (table.to_ascii_lowercase(), BTreeSet::new()))
        .collect::<HashMap<_, BTreeSet<String>>>();
    let mut indegree = tables
        .iter()
        .map(|table| (table.to_ascii_lowercase(), 0_usize))
        .collect::<HashMap<_, _>>();
    let mut dependencies = Vec::new();

    for (dependent_table, constraints) in constraints_by_table {
        let dependent_key = dependent_table.to_ascii_lowercase();
        for constraint in constraints {
            if !constraint
                .constraint_type
                .eq_ignore_ascii_case("FOREIGN KEY")
            {
                continue;
            }
            let Some(referenced_table) = constraint.referenced_table.as_deref() else {
                continue;
            };
            let referenced_schema = constraint
                .referenced_schema
                .as_deref()
                .filter(|schema| !schema.trim().is_empty())
                .unwrap_or(&request.source_schema);
            if !referenced_schema.eq_ignore_ascii_case(&request.source_schema) {
                continue;
            }
            let prerequisite_key = referenced_table.trim().to_ascii_lowercase();
            if prerequisite_key == dependent_key || !table_by_key.contains_key(&prerequisite_key) {
                if prerequisite_key == dependent_key {
                    dependencies.push(TableDataTransferDependency {
                        prerequisite_table: table_by_key[&dependent_key].clone(),
                        dependent_table: table_by_key[&dependent_key].clone(),
                        constraint_name: constraint.name.clone(),
                    });
                    *indegree
                        .get_mut(&dependent_key)
                        .expect("selected table exists") += 1;
                }
                continue;
            }
            let successors = outgoing
                .get_mut(&prerequisite_key)
                .expect("selected prerequisite exists");
            if successors.insert(dependent_key.clone()) {
                *indegree
                    .get_mut(&dependent_key)
                    .expect("selected table exists") += 1;
            }
            dependencies.push(TableDataTransferDependency {
                prerequisite_table: table_by_key[&prerequisite_key].clone(),
                dependent_table: table_by_key[&dependent_key].clone(),
                constraint_name: constraint.name.clone(),
            });
        }
    }
    dependencies.sort_by(|left, right| {
        (
            &left.prerequisite_table,
            &left.dependent_table,
            &left.constraint_name,
        )
            .cmp(&(
                &right.prerequisite_table,
                &right.dependent_table,
                &right.constraint_name,
            ))
    });

    let mut ready = indegree
        .iter()
        .filter_map(|(key, degree)| (*degree == 0).then_some(key.clone()))
        .collect::<BTreeSet<_>>();
    let mut ordered_keys = Vec::with_capacity(tables.len());
    while let Some(next) = ready.pop_first() {
        ordered_keys.push(next.clone());
        for dependent in outgoing[&next].clone() {
            let degree = indegree
                .get_mut(&dependent)
                .expect("dependency target exists");
            *degree -= 1;
            if *degree == 0 {
                ready.insert(dependent);
            }
        }
    }
    let cyclic_tables = indegree
        .into_iter()
        .filter_map(|(key, degree)| (degree > 0).then_some(table_by_key[&key].clone()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let ordered_tables = if cyclic_tables.is_empty() {
        ordered_keys
            .iter()
            .map(|key| table_by_key[key].clone())
            .collect()
    } else {
        Vec::new()
    };
    let mut warnings = vec![
        "The reviewed dependency order and each table mapping are bound into one confirmation token. Execution writes all selected tables in one target transaction."
            .to_string(),
    ];
    if !cyclic_tables.is_empty() {
        warnings.push(
            "Selected tables contain a foreign-key cycle. No automatic copy order is safe until the target driver declares a reviewed defer/disable-constraints policy."
                .to_string(),
        );
    }
    if request.mode == TableDataTransferMode::Upsert {
        warnings.push(
            "Each upsert table must independently prove a complete target primary-key mapping before execution."
                .to_string(),
        );
    }
    Ok(TableDataTransferBatchPlan {
        ordered_tables,
        dependencies,
        cyclic_tables: cyclic_tables.clone(),
        table_preflights: Vec::new(),
        can_execute: cyclic_tables.is_empty(),
        confirmation_token: String::new(),
        warnings,
    })
}

async fn resolve_table_data_transfer_batch_plan(
    manager: &ConnectionManager,
    request: TableDataTransferBatchPlanRequest,
) -> Result<TableDataTransferBatchPlan, String> {
        let tables = normalized_table_data_transfer_batch_tables(&request.tables)?;
        if request.source_connection_id.trim().is_empty()
            || request.target_connection_id.trim().is_empty()
            || request.source_schema.trim().is_empty()
            || request.target_schema.trim().is_empty()
        {
            return Err(
                "Source and target connection/schema are required for a batch transfer plan."
                    .to_string(),
            );
        }
        let sample_table = tables.first().expect("validated non-empty tables").clone();
        let source = TableDataTransferEndpoint {
            connection_id: request.source_connection_id.clone(),
            driver: request.source_driver.clone(),
            database: request.source_database.clone(),
            schema: request.source_schema.clone(),
            table: sample_table.clone(),
        };
        let target = TableDataTransferEndpoint {
            connection_id: request.target_connection_id.clone(),
            driver: request.target_driver.clone(),
            database: request.target_database.clone(),
            schema: request.target_schema.clone(),
            table: sample_table,
        };
        ensure_transfer_endpoint_driver_matches_connection(&manager, &source).await?;
        ensure_transfer_endpoint_driver_matches_connection(&manager, &target).await?;
        table_data_transfer_dialect(&manager, &source).await?;
        table_data_transfer_dialect(&manager, &target).await?;

        let mut constraints_by_table = Vec::with_capacity(tables.len());
        for table in &tables {
            let constraints = match source.database.as_deref() {
                Some(database) => {
                    manager
                        .get_database_constraints(
                            &source.connection_id,
                            database,
                            &source.schema,
                            table,
                        )
                        .await
                }
                None => {
                    manager
                        .get_constraints(&source.connection_id, &source.schema, table)
                        .await
                }
            }
            .map_err(|error| {
                format!(
                    "Could not inspect foreign-key dependencies for {}: {error}",
                    table
                )
            })?;
            constraints_by_table.push((table.clone(), constraints));
        }
        let mut plan = table_data_transfer_batch_plan(&request, &tables, &constraints_by_table)?;
        if plan.cyclic_tables.is_empty() {
            for table in &plan.ordered_tables {
                let preflight_request = TableDataTransferRequest {
                    project_id: None,
                    // Deterministic validation-only identity: the aggregate
                    // confirmation token must be stable across preview and
                    // execution while still satisfying transfer-id rules.
                    transfer_id: table_data_transfer_batch_preflight_id(&request, table)?,
                    source: TableDataTransferEndpoint {
                        connection_id: request.source_connection_id.clone(),
                        driver: request.source_driver.clone(),
                        database: request.source_database.clone(),
                        schema: request.source_schema.clone(),
                        table: table.clone(),
                    },
                    target: TableDataTransferEndpoint {
                        connection_id: request.target_connection_id.clone(),
                        driver: request.target_driver.clone(),
                        database: request.target_database.clone(),
                        schema: request.target_schema.clone(),
                        table: table.clone(),
                    },
                    mode: request.mode,
                    max_rows: request.max_rows,
                    batch_size: request.batch_size,
                    reseed_identity: request.reseed_identity,
                };
                match resolve_table_data_transfer_plan(&manager, &preflight_request).await {
                    Ok(table_plan) => {
                        let can_execute = transfer_plan_can_execute(&table_plan.mapped_columns);
                        plan.table_preflights.push(TableDataTransferBatchTablePreflight {
                            table: table.clone(),
                            can_execute,
                            mapped_columns: table_plan.mapped_columns.len() as u32,
                            plan_digest: Some(table_data_transfer_plan_digest(&table_plan.confirmation_token)),
                            warnings: table_plan.warnings,
                        });
                        plan.can_execute &= can_execute;
                    }
                    Err(error) => {
                        plan.table_preflights.push(TableDataTransferBatchTablePreflight {
                            table: table.clone(),
                            can_execute: false,
                            mapped_columns: 0,
                            plan_digest: None,
                            warnings: vec![bounded_table_data_transfer_message(&error)],
                        });
                        plan.can_execute = false;
                    }
                }
            }
            if !plan.can_execute {
                plan.warnings.push(
                    "At least one selected table failed a fresh source/target mapping preflight. Review every table before attempting a batch transfer."
                        .to_string(),
                );
            }
        }
        finalize_table_data_transfer_batch_confirmation(&request, &mut plan)?;
        Ok(plan)
}

#[tauri::command]
pub async fn preview_table_data_transfer_batch_plan(
    manager: State<'_, ConnectionManager>,
    request: TableDataTransferBatchPlanRequest,
) -> Result<Response<TableDataTransferBatchPlan>, String> {
    match resolve_table_data_transfer_batch_plan(&manager, request).await {
        Ok(plan) => Ok(Response::ok(plan)),
        Err(error) => Ok(Response::err(
            "PREVIEW_TABLE_DATA_TRANSFER_BATCH_PLAN_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn preview_table_data_transfer(
    manager: State<'_, ConnectionManager>,
    request: TableDataTransferRequest,
) -> Result<Response<TableDataTransferPreview>, String> {
    let result: Result<TableDataTransferPreview, String> = async {
        let plan = resolve_table_data_transfer_plan(&manager, &request).await?;
        let preview_limit = plan.max_rows.min(100);
        let order = build_table_order_by(plan.source_kind, &plan.source_columns, None)?;
        let sql = plan.source_kind.paged_table_query_with_order(
            schema_option(&request.source.schema),
            &request.source.table,
            None,
            order.as_deref(),
            preview_limit,
            0,
        );
        let mut results = query_target(
            &manager,
            &request.source.connection_id,
            request.source.database.as_deref(),
            &sql,
        )
        .await
        .map_err(|error| error.to_string())?;
        let source_result = results
            .drain(..)
            .next()
            .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));
        let can_execute = transfer_plan_can_execute(&plan.mapped_columns);
        if can_execute {
            // Exercise the same bounded conversion path that execution uses;
            // preview must prove more than a source row count.
            map_transfer_result_rows(&source_result, &plan)?;
        }
        let preview_rows = source_result.rows.len() as u32;

        Ok(TableDataTransferPreview {
            mode: request.mode,
            mapped_columns: plan.mapped_columns,
            skipped_source_columns: plan.skipped_source_columns,
            preview_rows,
            max_rows: plan.max_rows,
            batch_size: plan.batch_size,
            target_rows_to_delete: plan.target_rows_to_delete,
            upsert_key_columns: plan.upsert_key_columns,
            identity_reseed_columns: plan.identity_reseed_columns,
            can_execute,
            confirmation_token: plan.confirmation_token,
            warnings: plan.warnings,
        })
    }
    .await;

    match result {
        Ok(preview) => Ok(Response::ok(preview)),
        Err(error) => Ok(Response::err("PREVIEW_TABLE_DATA_TRANSFER_ERROR", &error)),
    }
}

async fn finish_table_data_transfer_transaction(
    manager: &ConnectionManager,
    connection_id: &str,
    transaction_id: &str,
    transfer_result: Result<(u64, u64, bool), String>,
) -> Result<(u64, u64, bool), String> {
    match transfer_result {
        Ok(summary) => {
            manager
                .commit_transaction(connection_id, transaction_id)
                .await
                .map_err(|error| {
                    format!(
                        "Transfer batches completed but the final target commit failed; verify the target transaction state before retrying: {error}"
                    )
                })?;
            Ok(summary)
        }
        Err(error) => {
            let rollback = manager
                .rollback_transaction(connection_id, transaction_id)
                .await;
            Err(match rollback {
                Ok(()) => {
                    format!("Transfer failed and the target transaction was rolled back: {error}")
                }
                Err(rollback_error) => format!(
                    "Transfer failed and rollback also failed; inspect the target before retrying: {error}; rollback: {rollback_error}"
                ),
            })
        }
    }
}

async fn delete_table_data_transfer_target_for_overwrite(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
    target_kind: DatabaseKind,
    transaction_id: &str,
    expected_rows: u64,
) -> Result<(), String> {
    let statement = ParameterizedStatement {
        sql: format!(
            "DELETE FROM {}",
            target_kind.qualified_table(schema_option(&endpoint.schema), &endpoint.table)
        ),
        params: Vec::new(),
    };
    let affected = manager
        .execute_parameterized_transaction(&endpoint.connection_id, transaction_id, &[statement])
        .await
        .map_err(|error| format!("Could not clear the overwrite target: {error}"))?;
    let actual_rows = affected
        .first()
        .copied()
        .ok_or_else(|| "The target driver did not report overwrite rows affected".to_string())?;
    if actual_rows != expected_rows {
        return Err(format!(
            "The overwrite target changed after preview: expected to delete {expected_rows} row(s), but the target reported {actual_rows}. Preview again."
        ));
    }
    Ok(())
}

async fn execute_resolved_table_data_transfer_in_transaction(
    manager: &ConnectionManager,
    request: &TableDataTransferRequest,
    plan: &ResolvedTableDataTransferPlan,
    transaction_id: &str,
    query_transfer_id: &str,
    cancel_rx: &mut watch::Receiver<bool>,
    on_progress: &mut impl FnMut(u64, u64),
) -> Result<(u64, u64, bool), String> {
    if let Some(expected_rows) = plan.target_rows_to_delete {
        delete_table_data_transfer_target_for_overwrite(
            manager,
            &request.target,
            plan.target_kind,
            transaction_id,
            expected_rows,
        )
        .await?;
    }
    let order = build_table_order_by(plan.source_kind, &plan.source_columns, None)?;
    let mut offset = 0_u64;
    let mut rows_transferred = 0_u64;
    let mut batches = 0_u64;
    let mut limit_reached = false;
    while rows_transferred < u64::from(plan.max_rows) {
        if *cancel_rx.borrow() {
            return Err(format!(
                "{TABLE_DATA_TRANSFER_CANCELLED}: Transfer cancelled by the user"
            ));
        }
        let remaining = u64::from(plan.max_rows) - rows_transferred;
        let page_size = u64::from(plan.batch_size).min(remaining) as u32;
        let sql = plan.source_kind.paged_table_query_with_order(
            schema_option(&request.source.schema),
            &request.source.table,
            None,
            order.as_deref(),
            page_size,
            offset,
        );
        let mut results = tokio::select! {
            result = query_transfer_source_tracked(manager, &request.source, query_transfer_id, &sql) => {
                result.map_err(|error| error.to_string())?
            },
            changed = cancel_rx.changed() => {
                let _ = changed;
                return Err(format!(
                    "{TABLE_DATA_TRANSFER_CANCELLED}: Transfer cancelled by the user"
                ));
            }
        };
        let source_result = results
            .drain(..)
            .next()
            .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));
        let rows = map_transfer_result_rows(&source_result, plan)?;
        if rows.is_empty() {
            break;
        }
        let statements = rows
            .iter()
            .map(|row| {
                let mutation = if request.mode == TableDataTransferMode::Upsert {
                    build_upsert_mutation(
                        plan.target_kind,
                        &request.target.schema,
                        &request.target.table,
                        &plan.target_columns,
                        row,
                        &plan.upsert_key_columns,
                    )
                } else {
                    build_insert_mutation(
                        plan.target_kind,
                        &request.target.schema,
                        &request.target.table,
                        &plan.target_columns,
                        row,
                    )
                };
                mutation.map(|(sql, params)| ParameterizedStatement { sql, params })
            })
            .collect::<Result<Vec<_>, _>>()?;
        manager
            .execute_parameterized_transaction(&request.target.connection_id, transaction_id, &statements)
            .await
            .map_err(|error| error.to_string())?;
        if *cancel_rx.borrow() {
            return Err(format!(
                "{TABLE_DATA_TRANSFER_CANCELLED}: Transfer cancelled by the user"
            ));
        }
        let copied = rows.len() as u64;
        rows_transferred += copied;
        offset += copied;
        batches += 1;
        on_progress(rows_transferred, batches);
        if copied < u64::from(page_size) {
            break;
        }
        if rows_transferred == u64::from(plan.max_rows) {
            limit_reached = true;
        }
    }
    if !plan.identity_reseed_columns.is_empty() {
        let statements = postgres_identity_reseed_statements(
            &request.target,
            &plan.identity_reseed_columns,
        );
        manager
            .execute_parameterized_transaction(&request.target.connection_id, transaction_id, &statements)
            .await
            .map_err(|error| format!("Could not synchronize PostgreSQL identity generators: {error}"))?;
    }
    Ok((rows_transferred, batches, limit_reached))
}

#[tauri::command]
pub async fn execute_table_data_transfer(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    meta_store: State<'_, MetaStore>,
    cancellation: State<'_, TableDataTransferCancellationState>,
    request: TableDataTransferRequest,
    confirmation_token: String,
) -> Result<Response<TableDataTransferResult>, String> {
    let transfer_id = request.transfer_id.trim().to_string();
    let started_at = current_table_timestamp_millis();
    let mut cancel_rx = match cancellation
        .register(&transfer_id, &request.source.connection_id)
        .await
    {
        Ok(receiver) => receiver,
        Err(error) => {
            return Ok(Response::err("REGISTER_TABLE_DATA_TRANSFER_ERROR", &error));
        }
    };
    let mut last_progress_rows = 0_u64;
    let mut last_progress_batches = 0_u64;
    let result: Result<TableDataTransferResult, String> = async {
        let plan = resolve_table_data_transfer_plan(&manager, &request).await?;
        if confirmation_token.trim() != plan.confirmation_token {
            return Err("Transfer plan changed or the confirmation token is invalid. Preview again before copying rows.".to_string());
        }
        if !transfer_plan_can_execute(&plan.mapped_columns) {
            return Err("Transfer contains unsupported column mappings. Preview the plan and change the target schema before copying rows.".to_string());
        }

        let transaction_id = format!("table-transfer-{}", uuid::Uuid::new_v4());
        match request.target.database.as_deref() {
            Some(database) => {
                manager
                    .begin_database_transaction(
                        &request.target.connection_id,
                        &transaction_id,
                        database,
                        schema_option(&request.target.schema).map(str::to_string),
                    )
                    .await
            }
            None => {
                manager
                    .begin_transaction(
                        &request.target.connection_id,
                        &transaction_id,
                        schema_option(&request.target.schema).map(str::to_string),
                    )
                    .await
            }
        }
        .map_err(|error| format!("Could not start the target transfer transaction: {error}"))?;

        emit_table_data_transfer_progress(
            &app,
            TableDataTransferProgress {
                transfer_id: transfer_id.clone(),
                rows_transferred: 0,
                max_rows: plan.max_rows,
                batches: 0,
                status: TableDataTransferProgressStatus::Running,
                terminal: false,
                message: None,
            },
        );

        let transfer_result: Result<(u64, u64, bool), String> = async {
            if let Some(expected_rows) = plan.target_rows_to_delete {
                delete_table_data_transfer_target_for_overwrite(
                    &manager,
                    &request.target,
                    plan.target_kind,
                    &transaction_id,
                    expected_rows,
                )
                .await?;
            }
            let order = build_table_order_by(plan.source_kind, &plan.source_columns, None)?;
            let mut offset = 0_u64;
            let mut rows_transferred = 0_u64;
            let mut batches = 0_u64;
            let mut limit_reached = false;
            while rows_transferred < u64::from(plan.max_rows) {
                if *cancel_rx.borrow() {
                    return Err(format!(
                        "{TABLE_DATA_TRANSFER_CANCELLED}: Transfer cancelled by the user"
                    ));
                }
                let remaining = u64::from(plan.max_rows) - rows_transferred;
                let page_size = u64::from(plan.batch_size).min(remaining) as u32;
                let sql = plan.source_kind.paged_table_query_with_order(
                    schema_option(&request.source.schema),
                    &request.source.table,
                    None,
                    order.as_deref(),
                    page_size,
                    offset,
                );
                let mut results = tokio::select! {
                    result = query_transfer_source_tracked(
                        &manager,
                        &request.source,
                        &transfer_id,
                        &sql,
                    ) => result.map_err(|error| error.to_string())?,
                    changed = cancel_rx.changed() => {
                        let _ = changed;
                        return Err(format!(
                            "{TABLE_DATA_TRANSFER_CANCELLED}: Transfer cancelled by the user"
                        ));
                    }
                };
                let source_result = results
                    .drain(..)
                    .next()
                    .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));
                let rows = map_transfer_result_rows(&source_result, &plan)?;
                if rows.is_empty() {
                    break;
                }
                let statements = rows
                    .iter()
                    .map(|row| {
                        let mutation = if request.mode == TableDataTransferMode::Upsert {
                            build_upsert_mutation(
                                plan.target_kind,
                                &request.target.schema,
                                &request.target.table,
                                &plan.target_columns,
                                row,
                                &plan.upsert_key_columns,
                            )
                        } else {
                            build_insert_mutation(
                                plan.target_kind,
                                &request.target.schema,
                                &request.target.table,
                                &plan.target_columns,
                                row,
                            )
                        };
                        mutation
                        .map(|(sql, params)| ParameterizedStatement { sql, params })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                manager
                    .execute_parameterized_transaction(
                        &request.target.connection_id,
                        &transaction_id,
                        &statements,
                    )
                    .await
                    .map_err(|error| error.to_string())?;
                if *cancel_rx.borrow() {
                    return Err(format!(
                        "{TABLE_DATA_TRANSFER_CANCELLED}: Transfer cancelled by the user"
                    ));
                }
                let copied = rows.len() as u64;
                rows_transferred += copied;
                offset += copied;
                batches += 1;
                last_progress_rows = rows_transferred;
                last_progress_batches = batches;
                emit_table_data_transfer_progress(
                    &app,
                    TableDataTransferProgress {
                        transfer_id: transfer_id.clone(),
                        rows_transferred,
                        max_rows: plan.max_rows,
                        batches,
                        status: TableDataTransferProgressStatus::Running,
                        terminal: false,
                        message: None,
                    },
                );
                if copied < u64::from(page_size) {
                    break;
                }
                if rows_transferred == u64::from(plan.max_rows) {
                    limit_reached = true;
                }
            }
            if !plan.identity_reseed_columns.is_empty() {
                let statements = postgres_identity_reseed_statements(
                    &request.target,
                    &plan.identity_reseed_columns,
                );
                manager
                    .execute_parameterized_transaction(
                        &request.target.connection_id,
                        &transaction_id,
                        &statements,
                    )
                    .await
                    .map_err(|error| format!("Could not synchronize PostgreSQL identity generators: {error}"))?;
            }
            Ok((rows_transferred, batches, limit_reached))
        }
        .await;

        let (rows_transferred, batches, limit_reached) =
            finish_table_data_transfer_transaction(
                &manager,
                &request.target.connection_id,
                &transaction_id,
                transfer_result,
            )
            .await?;

        Ok(TableDataTransferResult {
            rows_transferred,
            batches,
            limit_reached,
            mapped_columns: plan.mapped_columns,
            report_id: None,
        })
    }
    .await;

    cancellation.take(&transfer_id).await;

    match &result {
        Ok(transfer) => emit_table_data_transfer_progress(
            &app,
            TableDataTransferProgress {
                transfer_id: transfer_id.clone(),
                rows_transferred: transfer.rows_transferred,
                max_rows: normalized_transfer_limit(request.max_rows),
                batches: transfer.batches,
                status: TableDataTransferProgressStatus::Done,
                terminal: true,
                message: None,
            },
        ),
        Err(error) => emit_table_data_transfer_progress(
            &app,
            TableDataTransferProgress {
                transfer_id: transfer_id.clone(),
                rows_transferred: last_progress_rows,
                max_rows: normalized_transfer_limit(request.max_rows),
                batches: last_progress_batches,
                status: if error.contains(TABLE_DATA_TRANSFER_CANCELLED) {
                    TableDataTransferProgressStatus::Cancelled
                } else {
                    TableDataTransferProgressStatus::Error
                },
                terminal: true,
                message: Some(bounded_table_data_transfer_message(error)),
            },
        ),
    }

    let mut result = result;
    if let Some(project_id) =
        normalized_table_data_transfer_project_id(request.project_id.as_deref())
    {
        let report_id = table_data_transfer_report_id(&transfer_id);
        let verification = match &result {
            Ok(transfer) => {
                Some(verify_completed_table_data_transfer(&manager, &request, transfer).await)
            }
            Err(_) => None,
        };
        let (status, rows_transferred, batches, limit_reached, error) = match &result {
            Ok(transfer) => (
                TableDataTransferProgressStatus::Done,
                transfer.rows_transferred,
                transfer.batches,
                transfer.limit_reached,
                None,
            ),
            Err(error) if error.contains(TABLE_DATA_TRANSFER_CANCELLED) => (
                TableDataTransferProgressStatus::Cancelled,
                last_progress_rows,
                last_progress_batches,
                false,
                Some("Transfer cancelled and target changes were rolled back.".to_string()),
            ),
            Err(_) => (
                TableDataTransferProgressStatus::Error,
                last_progress_rows,
                last_progress_batches,
                false,
                Some("Transfer failed. The target transaction was rolled back when supported; capture a fresh preview before retrying.".to_string()),
            ),
        };
        let report = TableDataTransferReport {
            id: report_id.clone(),
            project_id,
            transfer_id: transfer_id.clone(),
            source: request.source.clone(),
            target: request.target.clone(),
            mode: request.mode,
            plan_digest: table_data_transfer_plan_digest(&confirmation_token),
            max_rows: normalized_transfer_limit(request.max_rows),
            rows_transferred,
            batches,
            limit_reached,
            status,
            started_at,
            finished_at: current_table_timestamp_millis(),
            error,
            verification,
        };
        match persist_table_data_transfer_report(meta_store.inner(), &report).await {
            Ok(()) => {
                if let Ok(transfer) = result.as_mut() {
                    transfer.report_id = Some(report_id);
                }
            }
            Err(error) => {
                tracing::warn!(error = %error, "table data transfer report was not persisted")
            }
        }
    }

    match result {
        Ok(transfer) => Ok(Response::ok(transfer)),
        Err(error) if error.contains(TABLE_DATA_TRANSFER_CANCELLED) => Ok(Response::err(
            "TABLE_DATA_TRANSFER_CANCELLED",
            "Transfer cancelled and target changes were rolled back.",
        )),
        Err(error) => Ok(Response::err("EXECUTE_TABLE_DATA_TRANSFER_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn execute_table_data_transfer_batch(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    meta_store: State<'_, MetaStore>,
    cancellation: State<'_, TableDataTransferCancellationState>,
    request: TableDataTransferBatchExecuteRequest,
    confirmation_token: String,
) -> Result<Response<TableDataTransferBatchResult>, String> {
    let transfer_id = request.transfer_id.trim().to_string();
    let started_at = current_table_timestamp_millis();
    let mut cancel_rx = match cancellation
        .register(&transfer_id, &request.plan.source_connection_id)
        .await
    {
        Ok(receiver) => receiver,
        Err(error) => return Ok(Response::err("REGISTER_TABLE_DATA_TRANSFER_BATCH_ERROR", &error)),
    };
    let mut last_progress_rows = 0_u64;
    let mut last_progress_batches = 0_u64;
    let mut expected_tables = Vec::<TableDataTransferRequest>::new();
    let result: Result<TableDataTransferBatchResult, String> = async {
        let batch_plan = resolve_table_data_transfer_batch_plan(&manager, request.plan.clone()).await?;
        if confirmation_token.trim() != batch_plan.confirmation_token {
            return Err("Batch transfer plan changed or the confirmation token is invalid. Preview again before copying rows.".to_string());
        }
        if !batch_plan.can_execute || !batch_plan.cyclic_tables.is_empty() {
            return Err("Batch transfer cannot execute because its foreign-key graph or a table mapping requires review.".to_string());
        }

        let mut resolved_tables = Vec::with_capacity(batch_plan.ordered_tables.len());
        for table in &batch_plan.ordered_tables {
            let table_request = TableDataTransferRequest {
                project_id: None,
                transfer_id: table_data_transfer_batch_preflight_id(&request.plan, table)?,
                source: TableDataTransferEndpoint {
                    connection_id: request.plan.source_connection_id.clone(),
                    driver: request.plan.source_driver.clone(),
                    database: request.plan.source_database.clone(),
                    schema: request.plan.source_schema.clone(),
                    table: table.clone(),
                },
                target: TableDataTransferEndpoint {
                    connection_id: request.plan.target_connection_id.clone(),
                    driver: request.plan.target_driver.clone(),
                    database: request.plan.target_database.clone(),
                    schema: request.plan.target_schema.clone(),
                    table: table.clone(),
                },
                mode: request.plan.mode,
                max_rows: request.plan.max_rows,
                batch_size: request.plan.batch_size,
                reseed_identity: request.plan.reseed_identity,
            };
            let table_plan = resolve_table_data_transfer_plan(&manager, &table_request).await?;
            let expected_digest = batch_plan
                .table_preflights
                .iter()
                .find(|preflight| preflight.table.eq_ignore_ascii_case(table))
                .and_then(|preflight| preflight.plan_digest.as_deref())
                .ok_or_else(|| format!("Batch table {table} has no executable reviewed mapping."))?;
            if expected_digest != table_data_transfer_plan_digest(&table_plan.confirmation_token) {
                return Err(format!("The source or target mapping for {table} changed after batch preview. Preview again."));
            }
            if !transfer_plan_can_execute(&table_plan.mapped_columns) {
                return Err(format!("Batch table {table} contains unsupported column mappings."));
            }
            expected_tables.push(table_request.clone());
            resolved_tables.push((table_request, table_plan));
        }

        let transaction_id = format!("table-transfer-batch-{}", uuid::Uuid::new_v4());
        match request.plan.target_database.as_deref() {
            Some(database) => manager.begin_database_transaction(
                &request.plan.target_connection_id,
                &transaction_id,
                database,
                schema_option(&request.plan.target_schema).map(str::to_string),
            ).await,
            None => manager.begin_transaction(
                &request.plan.target_connection_id,
                &transaction_id,
                schema_option(&request.plan.target_schema).map(str::to_string),
            ).await,
        }.map_err(|error| format!("Could not start the target batch transfer transaction: {error}"))?;

        let total_max_rows = resolved_tables.iter().fold(0_u32, |total, (_, plan)| {
            total.saturating_add(plan.max_rows)
        });
        emit_table_data_transfer_progress(&app, TableDataTransferProgress {
            transfer_id: transfer_id.clone(), rows_transferred: 0, max_rows: total_max_rows,
            batches: 0, status: TableDataTransferProgressStatus::Running, terminal: false, message: None,
        });

        let execution: Result<TableDataTransferBatchResult, String> = async {
            let mut rows_transferred = 0_u64;
            let mut batches = 0_u64;
            let mut limit_reached = false;
            let mut tables = Vec::with_capacity(resolved_tables.len());
            for (table_request, table_plan) in &resolved_tables {
                let completed_rows = rows_transferred;
                let completed_batches = batches;
                let (table_rows, table_batches, table_limit_reached) = {
                    let mut on_progress = |table_rows: u64, table_batches: u64| {
                        rows_transferred = completed_rows + table_rows;
                        batches = completed_batches + table_batches;
                        last_progress_rows = rows_transferred;
                        last_progress_batches = batches;
                        emit_table_data_transfer_progress(&app, TableDataTransferProgress {
                            transfer_id: transfer_id.clone(), rows_transferred, max_rows: total_max_rows,
                            batches, status: TableDataTransferProgressStatus::Running, terminal: false, message: None,
                        });
                    };
                    execute_resolved_table_data_transfer_in_transaction(
                        &manager, table_request, table_plan, &transaction_id, &transfer_id, &mut cancel_rx, &mut on_progress,
                    ).await?
                };
                // Empty tables never invoke the progress callback.
                rows_transferred = completed_rows + table_rows;
                batches = completed_batches + table_batches;
                last_progress_rows = rows_transferred;
                last_progress_batches = batches;
                limit_reached |= table_limit_reached;
                tables.push(TableDataTransferBatchTableResult {
                    table: table_request.target.table.clone(), rows_transferred: table_rows,
                    batches: table_batches, limit_reached: table_limit_reached, report_id: None,
                });
            }
            Ok(TableDataTransferBatchResult { rows_transferred, batches, limit_reached, tables })
        }.await;

        match execution {
            Ok(summary) => {
                manager.commit_transaction(&request.plan.target_connection_id, &transaction_id).await.map_err(|error| {
                    format!("Batch transfer writes completed but the final target commit failed; verify the target transaction state before retrying: {error}")
                })?;
                Ok(summary)
            }
            Err(error) => {
                let rollback = manager.rollback_transaction(&request.plan.target_connection_id, &transaction_id).await;
                Err(match rollback {
                    Ok(()) => format!("Batch transfer failed and the target transaction was rolled back: {error}"),
                    Err(rollback_error) => format!("Batch transfer failed and rollback also failed; inspect the target before retrying: {error}; rollback: {rollback_error}"),
                })
            }
        }
    }.await;

    cancellation.take(&transfer_id).await;
    let total_max_rows = normalized_transfer_limit(request.plan.max_rows)
        .saturating_mul(expected_tables.len().max(request.plan.tables.len()) as u32);
    match &result {
        Ok(summary) => emit_table_data_transfer_progress(&app, TableDataTransferProgress {
            transfer_id: transfer_id.clone(), rows_transferred: summary.rows_transferred, max_rows: total_max_rows,
            batches: summary.batches, status: TableDataTransferProgressStatus::Done, terminal: true, message: None,
        }),
        Err(error) => emit_table_data_transfer_progress(&app, TableDataTransferProgress {
            transfer_id: transfer_id.clone(), rows_transferred: last_progress_rows, max_rows: total_max_rows,
            batches: last_progress_batches,
            status: if error.contains(TABLE_DATA_TRANSFER_CANCELLED) { TableDataTransferProgressStatus::Cancelled } else { TableDataTransferProgressStatus::Error },
            terminal: true, message: Some(bounded_table_data_transfer_message(error)),
        }),
    }

    let mut result = result;
    if let Some(project_id) = normalized_table_data_transfer_project_id(request.project_id.as_deref()) {
        let (status, error) = match &result {
            Ok(_) => (TableDataTransferProgressStatus::Done, None),
            Err(error) if error.contains(TABLE_DATA_TRANSFER_CANCELLED) => (TableDataTransferProgressStatus::Cancelled, Some("Batch transfer cancelled and target changes were rolled back.".to_string())),
            Err(_) => (TableDataTransferProgressStatus::Error, Some("Batch transfer failed. The target transaction was rolled back when supported; capture a fresh batch preview before retrying.".to_string())),
        };
        for (index, table_request) in expected_tables.iter().enumerate() {
            let (rows_transferred, batches, limit_reached) = result.as_ref().ok()
                .and_then(|summary| summary.tables.get(index))
                .map(|table| (table.rows_transferred, table.batches, table.limit_reached))
                .unwrap_or((0, 0, false));
            let table_digest = Sha256::digest(table_request.target.table.as_bytes());
            let report_id = format!("table-transfer-report-{}-{:X}", transfer_id, u64::from_be_bytes(table_digest[..8].try_into().expect("sha256 prefix")));
            let report = TableDataTransferReport {
                id: report_id.clone(), project_id: project_id.clone(), transfer_id: format!("{transfer_id}-{index}"),
                source: table_request.source.clone(), target: table_request.target.clone(), mode: table_request.mode,
                plan_digest: table_data_transfer_plan_digest(&confirmation_token), max_rows: normalized_transfer_limit(request.plan.max_rows),
                rows_transferred, batches, limit_reached, status, started_at, finished_at: current_table_timestamp_millis(),
                error: error.clone(), verification: None,
            };
            match persist_table_data_transfer_report(meta_store.inner(), &report).await {
                Ok(()) => if let Ok(summary) = result.as_mut() {
                    if let Some(table) = summary.tables.get_mut(index) { table.report_id = Some(report_id); }
                },
                Err(error) => tracing::warn!(error = %error, "batch table data transfer report was not persisted"),
            }
        }
    }
    match result {
        Ok(summary) => Ok(Response::ok(summary)),
        Err(error) if error.contains(TABLE_DATA_TRANSFER_CANCELLED) => Ok(Response::err("TABLE_DATA_TRANSFER_CANCELLED", "Batch transfer cancelled and target changes were rolled back.")),
        Err(error) => Ok(Response::err("EXECUTE_TABLE_DATA_TRANSFER_BATCH_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn cancel_table_data_transfer(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, TableDataTransferCancellationState>,
    transfer_id: String,
) -> Result<Response<String>, String> {
    validate_table_data_transfer_id(&transfer_id)?;
    let Some(handle) = cancellation.request_cancel(&transfer_id).await else {
        return Ok(Response::err(
            "TABLE_DATA_TRANSFER_NOT_FOUND",
            &format!("Table data transfer is not active: {transfer_id}"),
        ));
    };

    let backend_cancelled = manager
        .cancel_query(&handle.source_connection_id, &transfer_id)
        .await
        .unwrap_or(false);
    let _ = handle.sender.send(true);
    Ok(Response::ok(
        if backend_cancelled {
            "Transfer cancellation requested on the source database backend"
        } else {
            "Transfer cancellation requested"
        }
        .to_string(),
    ))
}

/// Lists privacy-bounded terminal reports for copies that wrote into one
/// target connection. The target is the resource owner because its state is
/// what a retry or verification needs to inspect.
#[tauri::command]
pub async fn list_table_data_transfer_reports(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    connection_id: String,
    limit: Option<usize>,
) -> Result<Response<Vec<TableDataTransferReport>>, String> {
    let project_id =
        normalized_table_data_transfer_project_id(Some(&project_id)).ok_or_else(|| {
            "A valid project id is required to read table transfer reports.".to_string()
        })?;
    let reports = meta_store
        .get_children(
            &project_id,
            Some(TABLE_DATA_TRANSFER_REPORT_PARENT_ID),
            &connection_id,
        )
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|resource| resource.kind == TABLE_DATA_TRANSFER_REPORT_KIND)
        .filter_map(|resource| {
            serde_json::from_value::<TableDataTransferReport>(resource.metadata).ok()
        })
        .collect::<Vec<_>>();
    let mut reports = reports;
    reports.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    reports.truncate(limit.unwrap_or(20).clamp(1, 100));
    Ok(Response::ok(reports))
}

fn preview_metadata_required(
    structured_filters: Option<&[TableFilter]>,
    requested_sort: Option<&TableSort>,
) -> bool {
    structured_filters.is_some() || requested_sort.is_some()
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn preview_table_page(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    database: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
    filter_sql: Option<String>,
    filters: Option<Vec<TableFilter>>,
    sort: Option<TableSort>,
) -> Result<Response<TablePageResult>, String> {
    let error_context = serde_json::json!({
        "connectionId": connection_id,
        "driver": driver,
        "database": database,
        "schema": schema,
        "table": table,
        "page": page,
        "pageSize": page_size,
    });
    let result: Result<TablePageResult, String> = async {
        let kind =
            table_data_dialect_for_connection(&manager, &connection_id, &driver, false).await?;
        let database = database.as_deref();
        let page = page.unwrap_or(0);
        let page_size = page_size
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
        let offset = page as u64 * page_size as u64;
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
        let metadata_required =
            preview_metadata_required(structured_filters.as_deref(), requested_sort);
        let columns = if metadata_required {
            Some(
                get_target_columns(&manager, &connection_id, database, &schema, &table)
                    .await
                    .map(column_lookup)
                    .map_err(|error| error.to_string())?,
            )
        } else {
            None
        };
        let order_clause = if let Some(columns) = columns.as_ref() {
            build_table_order_by(kind, columns, requested_sort)?
        } else {
            None
        };
        let order = order_clause.as_deref();

        let (total_rows, mut results) = if let Some(filters) = structured_filters {
            let columns = columns
                .as_ref()
                .ok_or_else(|| "Missing column metadata".to_string())?;
            let (where_clause, params) = build_structured_filter_where(kind, columns, &filters)?;
            let filter = if where_clause.is_empty() {
                None
            } else {
                Some(where_clause.as_str())
            };

            let count_sql = kind.count_table_query(schema_option(&schema), &table, filter);
            let total_rows =
                query_target_parameterized(&manager, &connection_id, database, &count_sql, &params)
                    .await
                    .ok()
                    .and_then(|results| results.first().cloned())
                    .and_then(|result| result.rows.first().cloned())
                    .and_then(|row| row.first().cloned())
                    .and_then(|value| value_to_u64(&value));

            let page_sql = kind.paged_table_query_with_order(
                schema_option(&schema),
                &table,
                filter,
                order,
                page_size,
                offset,
            );
            let results =
                query_target_parameterized(&manager, &connection_id, database, &page_sql, &params)
                    .await
                    .map_err(|e| e.to_string())?;

            (total_rows, results)
        } else {
            let validated_filter = validated_raw_filter_sql(kind, filter_sql.as_deref())?;
            let filter = validated_filter.as_deref();

            let count_sql = kind.count_table_query(schema_option(&schema), &table, filter);
            let total_rows = query_target(&manager, &connection_id, database, &count_sql)
                .await
                .ok()
                .and_then(|results| results.first().cloned())
                .and_then(|result| result.rows.first().cloned())
                .and_then(|row| row.first().cloned())
                .and_then(|value| value_to_u64(&value));

            let page_sql = kind.paged_table_query_with_order(
                schema_option(&schema),
                &table,
                filter,
                order,
                page_size,
                offset,
            );
            let results = query_target(&manager, &connection_id, database, &page_sql)
                .await
                .map_err(|e| e.to_string())?;

            (total_rows, results)
        };
        let result = results
            .drain(..)
            .next()
            .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));

        Ok(TablePageResult {
            result,
            page,
            page_size,
            total_rows,
        })
    }
    .await;

    match result {
        Ok(page) => Ok(Response::ok(page)),
        Err(error) => Ok(Response::err_with_details(
            "PREVIEW_TABLE_PAGE_ERROR",
            &error,
            true,
            Some(error_context),
        )),
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn export_table_data(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    format: TableExportFormat,
    filter_sql: Option<String>,
    filters: Option<Vec<TableFilter>>,
    sort: Option<TableSort>,
    page_size: Option<u32>,
    max_rows: Option<u64>,
) -> Result<Response<TableExportResult>, String> {
    let result: Result<TableExportResult, String> = async {
        let kind =
            table_data_dialect_for_connection(&manager, &connection_id, &driver, false).await?;
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
        let metadata_required = structured_filters.is_some() || requested_sort.is_some();
        let columns_metadata = match manager.get_columns(&connection_id, &schema, &table).await {
            Ok(columns) => Some(column_lookup(columns)),
            Err(error) if metadata_required => return Err(error.to_string()),
            Err(_) => None,
        };
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
        let mut temporary_file = ExportTemporaryFile::create(&file_path)?;
        let file = File::create(&temporary_file.path).map_err(|e| e.to_string())?;
        let mut writer = BufWriter::new(file);

        let mut offset = 0_u64;
        let mut rows_exported = 0_u64;
        let mut columns: Vec<String> = Vec::new();
        let mut wrote_json_row = false;
        let mut wrote_csv_header = false;

        if matches!(format, TableExportFormat::Json) {
            writer.write_all(b"[").map_err(|e| e.to_string())?;
        } else if matches!(format, TableExportFormat::Sql) {
            writeln!(
                writer,
                "-- OxideStudio data export for {}",
                kind.qualified_table(schema_option(&schema), &table)
            )
            .map_err(|e| e.to_string())?;
        }

        loop {
            let limit = match max_rows {
                Some(max_rows) => {
                    let remaining = max_rows.saturating_sub(rows_exported);
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
            let mut results = if use_parameterized_query {
                manager
                    .query_parameterized(&connection_id, &page_sql, &params)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                manager
                    .query(&connection_id, &page_sql, None, None, None)
                    .await
                    .map_err(|e| e.to_string())?
            };
            let result = results
                .drain(..)
                .next()
                .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));

            if columns.is_empty() {
                columns = result
                    .columns
                    .iter()
                    .map(|column| column.name.clone())
                    .collect();
            }

            if matches!(format, TableExportFormat::Csv) && !wrote_csv_header {
                let header = columns
                    .iter()
                    .map(|column| csv_escape(&Value::String(column.clone())))
                    .collect::<Vec<_>>()
                    .join(",");
                writeln!(writer, "{header}").map_err(|e| e.to_string())?;
                wrote_csv_header = true;
            }

            if result.rows.is_empty() {
                break;
            }

            for row in &result.rows {
                match format {
                    TableExportFormat::Csv => {
                        let line = row.iter().map(csv_escape).collect::<Vec<_>>().join(",");
                        writeln!(writer, "{line}").map_err(|e| e.to_string())?;
                    }
                    TableExportFormat::Json => {
                        if wrote_json_row {
                            writer.write_all(b",").map_err(|e| e.to_string())?;
                        }
                        let object = row_to_object(&columns, row);
                        serde_json::to_writer(&mut writer, &object).map_err(|e| e.to_string())?;
                        wrote_json_row = true;
                    }
                    TableExportFormat::Sql => {
                        writeln!(
                            writer,
                            "{}",
                            sql_insert_statement(kind, &schema, &table, &columns, row)
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }

            let page_rows = result.rows.len() as u64;
            rows_exported += page_rows;
            offset += page_rows;

            if page_rows < limit as u64 {
                break;
            }
        }

        if matches!(format, TableExportFormat::Json) {
            writer.write_all(b"]").map_err(|e| e.to_string())?;
        }
        writer.flush().map_err(|e| e.to_string())?;
        drop(writer);
        temporary_file.finalize(&file_path)?;

        Ok(TableExportResult {
            file_path: file_path.display().to_string(),
            rows_exported,
        })
    }
    .await;

    match result {
        Ok(export) => Ok(Response::ok(export)),
        Err(error) => Ok(Response::err("EXPORT_TABLE_DATA_ERROR", &error)),
    }
}

fn validate_import_file(path: &Path, format: TableImportFormat) -> Result<(), String> {
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
        TableImportFormat::Csv => extension == "csv",
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
fn read_csv_import_preview(path: &Path) -> Result<TableCsvImportPreview, String> {
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

fn import_file_name(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn bounded_json_import_preview_value(value: &Value) -> Value {
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

fn read_json_lines_import_preview(path: &Path) -> Result<TableJsonImportPreview, String> {
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

fn read_json_import_preview(path: &Path) -> Result<TableJsonImportPreview, String> {
    validate_import_file(path, TableImportFormat::Json)?;
    if is_json_lines_path(path) {
        return read_json_lines_import_preview(path);
    }
    let rows = json_import_rows(path)?;
    if rows.is_empty() {
        return Err("The JSON file does not contain any object rows".to_string());
    }
    let source_columns = rows
        .iter()
        .flat_map(|row| row.keys().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(MAX_JSON_IMPORT_PREVIEW_COLUMNS)
        .collect::<Vec<_>>();
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
    Ok(TableJsonImportPreview {
        file_name: import_file_name(path, "JSON data"),
        total_bytes: metadata(path).map_err(|error| error.to_string())?.len(),
        content_digest: import_file_digest(path)?,
        source_columns,
        sample_rows,
        total_rows: Some(total_rows),
        truncated,
    })
}

fn xlsx_cell_value(cell: &Data) -> Value {
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

fn xlsx_header_value(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(value) => value.trim().to_string(),
        _ => cell.to_string().trim().to_string(),
    }
}

fn validate_xlsx_headers(headers: &[String]) -> Result<(), String> {
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
fn import_file_digest(path: &Path) -> Result<String, String> {
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

fn verify_import_file_digest(path: &Path, expected: Option<&str>) -> Result<(), String> {
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

fn xlsx_import_rows(
    path: &Path,
) -> Result<(String, Vec<String>, Vec<BTreeMap<String, Value>>), String> {
    let mut workbook = open_workbook_auto(path)
        .map_err(|error| format!("Unable to read XLSX workbook: {error}"))?;
    let sheet_name = workbook
        .sheet_names()
        .into_iter()
        .next()
        .ok_or_else(|| "The XLSX workbook does not contain a worksheet".to_string())?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|error| format!("Unable to read worksheet '{sheet_name}': {error}"))?;
    let mut rows = range.rows();
    let headers = rows
        .find(|row| row.iter().any(|cell| !matches!(cell, Data::Empty)))
        .map(|row| row.iter().map(xlsx_header_value).collect::<Vec<_>>())
        .ok_or_else(|| "The XLSX worksheet does not contain a header row".to_string())?;
    validate_xlsx_headers(&headers)?;

    let mut values = Vec::new();
    for row in rows.filter(|row| row.iter().any(|cell| !matches!(cell, Data::Empty))) {
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

fn read_xlsx_import_preview(path: &Path) -> Result<TableXlsxImportPreview, String> {
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

fn canonical_import_columns(
    headers: &[String],
    columns: &BTreeMap<String, ColumnInfo>,
) -> Result<Vec<String>, String> {
    if headers.is_empty() {
        return Err("The import file does not contain any columns".to_string());
    }
    let mut seen = HashSet::new();
    let mut canonical = Vec::with_capacity(headers.len());
    for header in headers {
        let header = header.trim();
        if header.is_empty() {
            return Err("Import column names cannot be empty".to_string());
        }
        let column_name = if columns.contains_key(header) {
            header.to_string()
        } else {
            let matches = columns
                .keys()
                .filter(|column| column.eq_ignore_ascii_case(header))
                .collect::<Vec<_>>();
            match matches.as_slice() {
                [column] => (*column).clone(),
                [] => return Err(format!("Import file contains unknown column: {header}")),
                _ => {
                    return Err(format!(
                        "Import column {header} matches more than one table column"
                    ));
                }
            }
        };
        if !seen.insert(column_name.clone()) {
            return Err(format!(
                "Import file contains duplicate column: {column_name}"
            ));
        }
        canonical.push(column_name);
    }
    Ok(canonical)
}

fn csv_delimiter(options: Option<&TableCsvImportOptions>) -> Result<u8, String> {
    let Some(delimiter) = options.and_then(|options| options.delimiter.as_deref()) else {
        return Ok(b',');
    };
    let bytes = delimiter.as_bytes();
    if bytes.len() != 1 || matches!(bytes[0], b'\"' | b'\r' | b'\n') {
        return Err("CSV delimiter must be one non-quote, non-line-break byte".to_string());
    }
    Ok(bytes[0])
}

/// Resolves the exact mapping that was reviewed in the preview. An explicit
/// mapping has one entry per source index and can deliberately ignore source
/// columns; an omitted mapping preserves the legacy header-to-column import.
fn resolve_csv_import_columns(
    source_columns: &[String],
    columns: &BTreeMap<String, ColumnInfo>,
    options: Option<&TableCsvImportOptions>,
) -> Result<Vec<Option<String>>, String> {
    let Some(options) = options.filter(|options| !options.column_mapping.is_empty()) else {
        return canonical_import_columns(source_columns, columns)
            .map(|columns| columns.into_iter().map(Some).collect());
    };

    let mut target_by_source = BTreeMap::new();
    let mut targets = HashSet::new();
    for mapping in &options.column_mapping {
        if mapping.source_index >= source_columns.len() {
            return Err(format!(
                "CSV mapping refers to source column {} but the file has {} columns",
                mapping.source_index + 1,
                source_columns.len()
            ));
        }
        if target_by_source.contains_key(&mapping.source_index) {
            return Err(format!(
                "CSV mapping contains source column {} more than once",
                mapping.source_index + 1
            ));
        }
        let target = mapping
            .target_column
            .as_deref()
            .map(|target| canonical_import_columns(&[target.to_string()], columns))
            .transpose()?
            .and_then(|mut targets| targets.pop());
        if let Some(target) = &target {
            if !targets.insert(target.clone()) {
                return Err(format!(
                    "CSV mapping contains duplicate target column: {target}"
                ));
            }
        }
        target_by_source.insert(mapping.source_index, target);
    }

    let resolved = (0..source_columns.len())
        .map(|index| target_by_source.remove(&index).unwrap_or(None))
        .collect::<Vec<_>>();
    if resolved.iter().all(Option::is_none) {
        return Err("CSV mapping does not include a target column".to_string());
    }
    Ok(resolved)
}

fn csv_record_values(
    headers: &[Option<String>],
    record: &csv::StringRecord,
    empty_fields_as_null: bool,
) -> Result<BTreeMap<String, Value>, String> {
    if record.len() != headers.len() {
        return Err(format!(
            "CSV row has {} values but {} columns were expected",
            record.len(),
            headers.len()
        ));
    }
    Ok(headers
        .iter()
        .zip(record.iter())
        .filter_map(|(column, value)| {
            column.as_ref().map(|column| {
                (
                    column.clone(),
                    if empty_fields_as_null && value.is_empty() {
                        Value::Null
                    } else {
                        Value::String(value.to_string())
                    },
                )
            })
        })
        .collect())
}

#[allow(clippy::too_many_arguments)]
async fn execute_import_transaction_batch(
    manager: &ConnectionManager,
    connection_id: &str,
    transaction_id: &str,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    rows: &mut Vec<BTreeMap<String, Value>>,
) -> Result<u64, String> {
    if rows.is_empty() {
        return Ok(0);
    }
    let statements = rows
        .iter()
        .map(|row| {
            build_insert_mutation(kind, schema, table, columns, row)
                .map(|(sql, params)| ParameterizedStatement { sql, params })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let imported = manager
        .execute_parameterized_transaction(connection_id, transaction_id, &statements)
        .await
        .map_err(|error| error.to_string())?
        .len() as u64;
    rows.clear();
    Ok(imported)
}

/// Writes already-parsed records through a single explicit transaction. This
/// is shared by bounded JSON-array and XLSX imports so a later row failure
/// never leaves an earlier batch committed.
#[allow(clippy::too_many_arguments)]
async fn import_materialized_rows_in_transaction(
    manager: &ConnectionManager,
    connection_id: &str,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    rows: Vec<BTreeMap<String, Value>>,
    database: Option<&str>,
) -> Result<(u64, u64), String> {
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
        let mut pending_rows = Vec::with_capacity(IMPORT_BATCH_SIZE);
        for row in rows {
            pending_rows.push(row);
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
                )
                .await?;
                batches += 1;
            }
        }
        if !pending_rows.is_empty() {
            rows_imported += execute_import_transaction_batch(
                manager,
                connection_id,
                &transaction_id,
                kind,
                schema,
                table,
                columns,
                &mut pending_rows,
            )
            .await?;
            batches += 1;
        }
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

#[allow(clippy::too_many_arguments)]
async fn import_csv_in_transaction(
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
) -> Result<(u64, u64), String> {
    let has_headers = csv_options
        .and_then(|options| options.first_row_header)
        .or(first_row_header)
        .unwrap_or(true);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(has_headers)
        .delimiter(csv_delimiter(csv_options)?)
        .from_path(path)
        .map_err(|error| error.to_string())?;
    let source_columns = if has_headers {
        reader
            .headers()
            .map_err(|error| error.to_string())?
            .iter()
            .map(|value| value.trim().to_string())
            .collect::<Vec<_>>()
    } else {
        ordered_columns
    };
    let headers = resolve_csv_import_columns(&source_columns, columns, csv_options)?;
    let empty_fields_as_null = csv_options
        .and_then(|options| options.empty_fields_as_null)
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
        let mut pending_rows = Vec::with_capacity(IMPORT_BATCH_SIZE);
        for record in reader.records() {
            let record = record.map_err(|error| error.to_string())?;
            pending_rows.push(csv_record_values(&headers, &record, empty_fields_as_null)?);
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
                )
                .await?;
                batches += 1;
            }
        }
        if !pending_rows.is_empty() {
            rows_imported += execute_import_transaction_batch(
                manager,
                connection_id,
                &transaction_id,
                kind,
                schema,
                table,
                columns,
                &mut pending_rows,
            )
            .await?;
            batches += 1;
        }
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

fn is_json_lines_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("jsonl" | "ndjson")
    )
}

#[allow(clippy::too_many_arguments)]
async fn import_json_lines_in_transaction(
    manager: &ConnectionManager,
    connection_id: &str,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    path: &Path,
    database: Option<&str>,
) -> Result<(u64, u64), String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
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
        let mut pending_rows = Vec::with_capacity(IMPORT_BATCH_SIZE);
        let mut line = String::new();
        let mut line_number = 0_u64;
        loop {
            line.clear();
            if reader
                .read_line(&mut line)
                .map_err(|error| error.to_string())?
                == 0
            {
                break;
            }
            line_number += 1;
            if line.trim().is_empty() {
                continue;
            }
            let object = serde_json::from_str::<Value>(&line)
                .map_err(|error| format!("Invalid JSON object on line {line_number}: {error}"))?;
            let Value::Object(object) = object else {
                return Err(format!("JSON row {line_number} is not an object"));
            };
            let headers = object.keys().cloned().collect::<Vec<_>>();
            let canonical_headers = canonical_import_columns(&headers, columns)?;
            pending_rows.push(
                headers
                    .into_iter()
                    .zip(canonical_headers)
                    .filter_map(|(source, target)| {
                        object.get(&source).cloned().map(|value| (target, value))
                    })
                    .collect(),
            );
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
                )
                .await?;
                batches += 1;
            }
        }
        if !pending_rows.is_empty() {
            rows_imported += execute_import_transaction_batch(
                manager,
                connection_id,
                &transaction_id,
                kind,
                schema,
                table,
                columns,
                &mut pending_rows,
            )
            .await?;
            batches += 1;
        }
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

fn json_import_rows(path: &Path) -> Result<Vec<BTreeMap<String, Value>>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let mut source = String::new();
    reader
        .read_to_string(&mut source)
        .map_err(|error| error.to_string())?;

    let values = match serde_json::from_str::<Value>(&source) {
        Ok(Value::Array(values)) => values,
        Ok(Value::Object(object)) => vec![Value::Object(object)],
        Ok(_) => {
            return Err("JSON import expects an object or an array of objects".to_string());
        }
        Err(_) => source
            .lines()
            .enumerate()
            .filter(|(_, line)| !line.trim().is_empty())
            .map(|(index, line)| {
                serde_json::from_str::<Value>(line)
                    .map_err(|error| format!("Invalid JSON object on line {}: {error}", index + 1))
            })
            .collect::<Result<Vec<_>, _>>()?,
    };

    values
        .into_iter()
        .enumerate()
        .map(|(index, value)| match value {
            Value::Object(object) => Ok(object.into_iter().collect()),
            _ => Err(format!("JSON row {} is not an object", index + 1)),
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn import_table_data(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    database: Option<String>,
    file_path: String,
    format: TableImportFormat,
    first_row_header: Option<bool>,
    csv_options: Option<TableCsvImportOptions>,
    expected_file_digest: Option<String>,
) -> Result<Response<TableImportResult>, String> {
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
        verify_import_file_digest(&path, expected_file_digest.as_deref())?;
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
            )
            .await?;
            return Ok(TableImportResult {
                file_path: path.display().to_string(),
                rows_imported,
                batches,
            });
        }
        if matches!(format, TableImportFormat::Json) && is_json_lines_path(&path) {
            let (rows_imported, batches) = import_json_lines_in_transaction(
                &manager,
                &connection_id,
                kind,
                &schema,
                &table,
                &column_lookup,
                &path,
                database,
            )
            .await?;
            return Ok(TableImportResult {
                file_path: path.display().to_string(),
                rows_imported,
                batches,
            });
        }
        let source_rows = match format {
            TableImportFormat::Json => json_import_rows(&path)?,
            TableImportFormat::Xlsx => xlsx_import_rows(&path)?.2,
            // CSV and JSONL return before this branch so the source remains
            // streamable rather than materializing every row in memory.
            TableImportFormat::Csv => unreachable!("CSV import returned above"),
        };
        if source_rows.len() > MAX_IMPORT_ROWS {
            return Err(format!(
                "Imports are limited to {MAX_IMPORT_ROWS} rows per transaction"
            ));
        }
        let pending_rows = source_rows
            .into_iter()
            .map(|row| {
                let headers = row.keys().cloned().collect::<Vec<_>>();
                let canonical_headers = canonical_import_columns(&headers, &column_lookup)?;
                Ok(headers
                    .into_iter()
                    .zip(canonical_headers)
                    .filter_map(|(source, target)| {
                        row.get(&source).cloned().map(|value| (target, value))
                    })
                    .collect::<BTreeMap<_, _>>())
            })
            .collect::<Result<Vec<_>, String>>()?;
        let (rows_imported, batches) = import_materialized_rows_in_transaction(
            &manager,
            &connection_id,
            kind,
            &schema,
            &table,
            &column_lookup,
            pending_rows,
            database,
        )
        .await?;

        Ok(TableImportResult {
            file_path: path.display().to_string(),
            rows_imported,
            batches,
        })
    }
    .await;

    match result {
        Ok(imported) => Ok(Response::ok(imported)),
        Err(error) => Ok(Response::err("IMPORT_TABLE_DATA_ERROR", &error)),
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn mutate_table_rows(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    database: Option<String>,
    inserts: Vec<BTreeMap<String, Value>>,
    updates: Vec<TableRowUpdate>,
    deletes: Vec<TableRowDelete>,
) -> Result<Response<TableMutationResult>, String> {
    let result: Result<TableMutationResult, String> = async {
        let kind =
            table_data_dialect_for_connection(&manager, &connection_id, &driver, true).await?;
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
        let columns = get_target_columns(&manager, &connection_id, database, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;

        if columns.is_empty() {
            return Err("Table has no column metadata".to_string());
        }

        let insert_count = inserts.len();
        let update_count = updates.len();
        let delete_count = deletes.len();
        let mut statements = Vec::with_capacity(insert_count + update_count + delete_count);

        for insert in &inserts {
            let (sql, params) = build_insert_mutation(kind, &schema, &table, &columns, insert)?;
            statements.push(ParameterizedStatement { sql, params });
        }

        for update in &updates {
            let (sql, params) = build_update_mutation(kind, &schema, &table, &columns, update)?;
            statements.push(ParameterizedStatement { sql, params });
        }

        for delete in &deletes {
            let (sql, params) = build_delete_mutation(kind, &schema, &table, &columns, delete)?;
            statements.push(ParameterizedStatement { sql, params });
        }

        let affected =
            execute_target_parameterized_batch(&manager, &connection_id, database, &statements)
                .await
                .map_err(|e| e.to_string())?;

        Ok(summarize_mutation_affected(
            &affected,
            insert_count,
            update_count,
            delete_count,
        ))
    }
    .await;

    match result {
        Ok(mutation) => Ok(Response::ok(mutation)),
        Err(error) => Ok(Response::err("MUTATE_TABLE_ROWS_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    columns: Vec<CreateTableColumn>,
) -> Result<Response<CreateTableResult>, String> {
    let result: Result<CreateTableResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "creation").await?;
        let statements = if is_sqlite_driver(&driver) {
            build_sqlite_create_table_statements(&schema, &table, &columns)?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_create_table_statements(kind, &schema, &table, &columns)?
        };

        for statement in &statements {
            manager
                .query(&connection_id, statement, None, None, None)
                .await
                .map_err(|e| e.to_string())?;
        }

        Ok(CreateTableResult {
            table: table.trim().to_string(),
            statements,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_view(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    select_sql: String,
    replace: Option<bool>,
) -> Result<Response<CreateViewResult>, String> {
    let result: Result<CreateViewResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "view creation").await?;
        let statement = if is_sqlite_driver(&driver) {
            build_sqlite_create_view_statement(
                &schema,
                &view,
                &select_sql,
                replace.unwrap_or(false),
            )?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_create_view_statement(
                kind,
                &schema,
                &view,
                &select_sql,
                replace.unwrap_or(false),
            )?
        };

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(CreateViewResult {
            view: view.trim().to_string(),
            statement,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_VIEW_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_materialized_view(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    select_sql: String,
    with_data: Option<bool>,
) -> Result<Response<CreateMaterializedViewResult>, String> {
    let result: Result<CreateMaterializedViewResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "materialized-view creation")
            .await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let statement = build_create_materialized_view_statement(
            kind,
            &schema,
            &view,
            &select_sql,
            with_data.unwrap_or(true),
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(CreateMaterializedViewResult {
            view: view.trim().to_string(),
            statement,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_MATERIALIZED_VIEW_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn add_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    column: CreateTableColumn,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "column creation").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let statements = if is_sqlite_driver(&driver) {
            build_sqlite_add_column_statements(&schema, &table, &column)?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_add_table_column_statements(kind, &schema, &table, &column)?
        };

        for statement in &statements {
            manager
                .query(&connection_id, statement, None, None, None)
                .await
                .map_err(|e| e.to_string())?;
        }

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: column.name.trim().to_string(),
            statements,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("ADD_TABLE_COLUMN_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    column: String,
    cascade: Option<bool>,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "column deletion").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let cascade = cascade.unwrap_or(false);
        if is_sqlite_driver(&driver) && cascade {
            return Err("SQLite does not support CASCADE when dropping a column".to_string());
        }
        let statement = if is_sqlite_driver(&driver) {
            build_sqlite_drop_column_statement(&schema, &table, &column)?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_drop_table_column_statement(kind, &schema, &table, &column, cascade)?
        };

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: column.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("DROP_TABLE_COLUMN_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn rename_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    old_name: String,
    new_name: String,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "column rename").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = if is_sqlite_driver(&driver) {
            build_sqlite_rename_column_statement(
                &schema,
                &table,
                &old_name,
                &new_name,
                &existing_columns,
            )?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_rename_table_column_statement(
                kind,
                &schema,
                &table,
                &old_name,
                &new_name,
                &existing_columns,
            )?
        };

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: new_name.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("RENAME_TABLE_COLUMN_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn alter_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    changes: AlterTableColumn,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "column alteration").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statements = build_alter_table_column_statements(
            kind,
            &schema,
            &table,
            &changes,
            &existing_columns,
        )?;

        for statement in &statements {
            manager
                .query(&connection_id, statement, None, None, None)
                .await
                .map_err(|e| e.to_string())?;
        }

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: changes.name.trim().to_string(),
            statements,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("ALTER_TABLE_COLUMN_ERROR", &error)),
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_table_index(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    index: String,
    columns: Vec<String>,
    unique: Option<bool>,
) -> Result<Response<TableIndexChangeResult>, String> {
    let result: Result<TableIndexChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "index creation").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::IndexChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = if is_sqlite_driver(&driver) {
            build_sqlite_create_index_statement(
                &schema,
                &table,
                &index,
                &columns,
                &existing_columns,
                unique.unwrap_or(false),
            )?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_create_table_index_statement(
                kind,
                &schema,
                &table,
                &index,
                &columns,
                &existing_columns,
                unique.unwrap_or(false),
            )?
        };

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableIndexChangeResult {
            table: table.trim().to_string(),
            index: index.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_INDEX_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table_index(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    index: String,
) -> Result<Response<TableIndexChangeResult>, String> {
    let result: Result<TableIndexChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "index deletion").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::IndexChange,
        )
        .await?;
        let statement = if is_sqlite_driver(&driver) {
            build_sqlite_drop_index_statement(&schema, &table, &index)?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_drop_table_index_statement(kind, &schema, &table, &index)?
        };

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableIndexChangeResult {
            table: table.trim().to_string(),
            index: index.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("DROP_TABLE_INDEX_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn rename_table_index(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    old_name: String,
    new_name: String,
) -> Result<Response<TableIndexChangeResult>, String> {
    let result: Result<TableIndexChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "index rename").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::IndexChange,
        )
        .await?;
        let indexes = manager
            .get_indexes(&connection_id, &schema, &table)
            .await
            .map_err(|e| e.to_string())?;
        let statement = build_rename_table_index_statement(
            kind, &schema, &table, &old_name, &new_name, &indexes,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableIndexChangeResult {
            table: table.trim().to_string(),
            index: new_name.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("RENAME_TABLE_INDEX_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_table_unique_constraint(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    columns: Vec<String>,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "unique-constraint creation")
            .await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = build_create_unique_constraint_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &columns,
            &existing_columns,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err(
            "CREATE_TABLE_UNIQUE_CONSTRAINT_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn create_table_primary_key(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    columns: Vec<String>,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "primary-key creation").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = build_create_primary_key_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &columns,
            &existing_columns,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_PRIMARY_KEY_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_table_check_constraint(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    expression: String,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "check-constraint creation")
            .await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let statement = build_create_check_constraint_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &expression,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_CHECK_CONSTRAINT_ERROR", &error)),
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_table_foreign_key(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    columns: Vec<String>,
    referenced_schema: Option<String>,
    referenced_table: String,
    referenced_columns: Vec<String>,
    on_delete: Option<String>,
    on_update: Option<String>,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "foreign-key creation").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let referenced_schema = referenced_schema
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(schema.as_str());
        let (existing_columns, existing_referenced_columns) = tokio::try_join!(
            async {
                manager
                    .get_columns(&connection_id, &schema, &table)
                    .await
                    .map(column_lookup)
                    .map_err(|e| e.to_string())
            },
            async {
                manager
                    .get_columns(&connection_id, referenced_schema, &referenced_table)
                    .await
                    .map(column_lookup)
                    .map_err(|e| e.to_string())
            }
        )?;
        let statement = build_create_foreign_key_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &columns,
            &existing_columns,
            referenced_schema,
            &referenced_table,
            &referenced_columns,
            &existing_referenced_columns,
            on_delete.as_deref(),
            on_update.as_deref(),
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_FOREIGN_KEY_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table_constraint(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "constraint deletion").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let constraint_name = constraint.trim();
        if constraint_name.is_empty() {
            return Err("Constraint name is required".to_string());
        }

        let constraints = manager
            .get_constraints(&connection_id, &schema, &table)
            .await
            .map_err(|e| e.to_string())?;
        let constraint_info = constraints
            .iter()
            .find(|item| item.name == constraint_name)
            .ok_or_else(|| format!("Unknown constraint: {constraint_name}"))?;
        let statement =
            build_drop_table_constraint_statement(kind, &schema, &table, constraint_info)?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint_name.to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("DROP_TABLE_CONSTRAINT_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn truncate_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "truncation").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::Truncate,
        )
        .await?;
        let sql = if is_sqlite_driver(&driver) {
            format!(
                "DELETE FROM {};",
                sqlite_qualified_relation(&schema, &table)?
            )
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            kind.truncate_table_query(schema_option(&schema), &table)
        };
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!("Table {} truncated", table))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("TRUNCATE_TABLE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    cascade: Option<bool>,
    object_type: Option<String>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "deletion").await?;
        let table_name = table.trim();
        if table_name.is_empty() {
            return Err("Table name is required".to_string());
        }

        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, table_name, object_type).await?;
        let is_view = object_type_is_view(object_type.as_deref());
        let is_materialized_view = object_type_is_materialized_view(object_type.as_deref());
        let is_foreign_table = object_type_is_foreign_table(object_type.as_deref());
        let sql = if is_sqlite_driver(&driver) {
            if cascade.unwrap_or(false) {
                return Err("SQLite does not support CASCADE when dropping a relation".to_string());
            }
            if is_materialized_view || is_foreign_table {
                return Err("SQLite does not support this relation type".to_string());
            }
            let relation_kind = if is_view { "VIEW" } else { "TABLE" };
            format!(
                "DROP {relation_kind} {};",
                sqlite_qualified_relation(&schema, table_name)?,
            )
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            kind.drop_relation_query_with_kind(
                schema_option(&schema),
                table_name,
                is_view,
                is_materialized_view,
                is_foreign_table,
                cascade.unwrap_or(false),
            )
        };
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        let label = object_label_from_type(object_type.as_deref());
        Ok(format!("{label} {table_name} dropped"))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("DROP_TABLE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn rename_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    old_name: String,
    new_name: String,
    object_type: Option<String>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "rename").await?;
        let old_name = old_name.trim();
        let new_name = new_name.trim();
        if old_name.is_empty() || new_name.is_empty() {
            return Err("Object names are required".to_string());
        }

        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, old_name, object_type).await?;
        let is_view = object_type_is_view(object_type.as_deref());
        let is_materialized_view = object_type_is_materialized_view(object_type.as_deref());
        let is_foreign_table = object_type_is_foreign_table(object_type.as_deref());
        let sql = if is_sqlite_driver(&driver) {
            if is_view || is_materialized_view || is_foreign_table {
                return Err("SQLite only supports renaming tables through this action".to_string());
            }
            format!(
                "ALTER TABLE {} RENAME TO {};",
                sqlite_qualified_relation(&schema, old_name)?,
                sqlite_quote_identifier(new_name),
            )
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            kind.rename_relation_query_with_kind(
                schema_option(&schema),
                old_name,
                new_name,
                is_view,
                is_materialized_view,
                is_foreign_table,
            )
        };
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        let label = object_label_from_type(object_type.as_deref());
        Ok(format!("{label} {old_name} renamed to {new_name}"))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("RENAME_TABLE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn get_view_definition(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    object_type: Option<String>,
) -> Result<Response<String>, String> {
    let error_context = serde_json::json!({
        "connectionId": connection_id,
        "driver": driver,
        "schema": schema,
        "view": view,
    });
    let result: Result<String, String> = async {
        // The native view-definition query is vendor-specific catalog SQL.
        // External packages must expose definition metadata through a future
        // semantic protocol instead of inheriting this route from an alias.
        ensure_host_table_ddl_allowed(&manager, &connection_id, "view definition introspection")
            .await?;
        let view_name = view.trim();
        if view_name.is_empty() {
            return Err("View name is required".to_string());
        }

        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, view_name, object_type).await?;
        if !object_type_is_view(object_type.as_deref()) {
            return Err(format!("{view_name} is not a view"));
        }

        let sql = if is_sqlite_driver(&driver) {
            let catalog = if schema.trim().is_empty() {
                "sqlite_master".to_string()
            } else {
                format!("{}.sqlite_master", sqlite_quote_identifier(&schema))
            };
            format!(
                "SELECT sql AS definition FROM {catalog} WHERE type = 'view' AND name = {};",
                sql_string_literal(view_name),
            )
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            view_definition_query(kind, &schema, view_name)
        };
        let results = manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        let definition = results
            .first()
            .and_then(|result| result.rows.first())
            .and_then(|row| row.first())
            .and_then(value_to_string)
            .unwrap_or_default();

        if definition.trim().is_empty() {
            Err("View definition not found".to_string())
        } else {
            Ok(definition)
        }
    }
    .await;

    match result {
        Ok(definition) => Ok(Response::ok(definition)),
        Err(error) => Ok(Response::err_with_details(
            "GET_VIEW_DEFINITION_ERROR",
            &error,
            true,
            Some(error_context),
        )),
    }
}

/// Reads PostgreSQL routine source through the server's own definition
/// renderer. FunctionInfo does not yet carry an OID/identity-arguments token,
/// so overloads are deliberately returned as a bounded list instead of
/// guessing a single one. External packages are excluded: host catalog SQL is
/// not a substitute for an explicit sidecar source-definition protocol.
#[tauri::command]
pub async fn get_postgres_routine_definitions(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    routine: String,
) -> Result<Response<Vec<String>>, String> {
    let result: Result<Vec<String>, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "routine definition introspection")
            .await?;
        let routine = routine.trim();
        if routine.is_empty() {
            return Err("Routine name is required".to_string());
        }
        let sql = format!(
            "SELECT LEFT(pg_get_functiondef(p.oid), {MAX_POSTGRES_ROUTINE_SOURCE_CHARS}) AS definition \\
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace \\
             WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind IN ('f', 'p') \\
             ORDER BY pg_get_function_identity_arguments(p.oid) LIMIT {MAX_POSTGRES_ROUTINE_SOURCE_OVERLOADS}"
        );
        let results = manager
            .query_parameterized(
                &connection_id,
                &sql,
                &[
                    QueryParameter { value: Value::String(schema.trim().to_string()), data_type: Some("text".to_string()) },
                    QueryParameter { value: Value::String(routine.to_string()), data_type: Some("text".to_string()) },
                ],
            )
            .await
            .map_err(|error| error.to_string())?;
        let definitions = results
            .first()
            .map(|result| result.rows.iter().filter_map(|row| row.first().and_then(value_to_string)).collect())
            .unwrap_or_default();
        if definitions.is_empty() {
            return Err("Routine definition not found or not visible to this role".to_string());
        }
        Ok(definitions)
    }.await;
    match result {
        Ok(definitions) => Ok(Response::ok(definitions)),
        Err(error) => Ok(Response::err("GET_POSTGRES_ROUTINE_DEFINITION_ERROR", &error)),
    }
}

async fn get_elasticsearch_index_mapping(
    manager: &ConnectionManager,
    connection_id: &str,
    index: &str,
) -> Result<String, anyhow::Error> {
    let index = index.trim();
    if index.is_empty() {
        return Err(anyhow::anyhow!("Elasticsearch index name is required"));
    }
    let encoded_index = utf8_percent_encode(index, NON_ALPHANUMERIC).to_string();
    let results = manager
        .query(
            connection_id,
            &format!("GET /{encoded_index}/_mapping"),
            None,
            None,
            None,
        )
        .await?;
    let result = results
        .first()
        .ok_or_else(|| anyhow::anyhow!("Elasticsearch returned no mapping result"))?;
    let mapping_column = result
        .columns
        .iter()
        .position(|column| column.name == "result")
        .ok_or_else(|| anyhow::anyhow!("Elasticsearch mapping result is malformed"))?;
    let mapping = result
        .rows
        .first()
        .and_then(|row| row.get(mapping_column))
        .ok_or_else(|| anyhow::anyhow!("Elasticsearch mapping response is empty"))?;
    serde_json::to_string_pretty(mapping).map_err(Into::into)
}

#[tauri::command]
pub async fn refresh_materialized_view(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    object_type: Option<String>,
    concurrently: Option<bool>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "materialized-view refresh")
            .await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let view_name = view.trim();
        if view_name.is_empty() {
            return Err("View name is required".to_string());
        }

        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, view_name, object_type).await?;
        if !object_type_is_materialized_view(object_type.as_deref()) {
            return Err(format!("{view_name} is not a materialized view"));
        }

        let sql = kind
            .refresh_materialized_view_query(
                schema_option(&schema),
                view_name,
                concurrently.unwrap_or(false),
            )
            .ok_or_else(|| "Materialized views are not supported by this driver".to_string())?;
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!("Materialized view {view_name} refreshed"))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("REFRESH_MATERIALIZED_VIEW_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn get_table_ddl(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    object_type: Option<String>,
    database: Option<String>,
) -> Result<Response<String>, String> {
    let error_context = serde_json::json!({
        "connectionId": connection_id,
        "driver": driver,
        "database": database,
        "schema": schema,
        "table": table,
    });
    let result: Result<String, String> = async {
        if matches!(
            driver.trim().to_ascii_lowercase().as_str(),
            "elasticsearch" | "elastic"
        ) {
            return get_elasticsearch_index_mapping(&manager, &connection_id, &table)
                .await
                .map_err(|error| error.to_string());
        }
        // This command falls back to Host-generated SHOW CREATE and
        // reconstruction queries. An external package can deliberately reuse
        // a built-in driver id while having different catalog or DDL grammar,
        // so do not mistake its metadata capability for a reviewed table
        // definition protocol.
        ensure_host_table_ddl_allowed(&manager, &connection_id, "definition introspection").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let table_name = table.trim();
        if table_name.is_empty() {
            return Err("Object name is required".to_string());
        }
        let database = database.as_deref();
        let object_type = if let Some(explicit_type) = object_type
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            Some(explicit_type)
        } else if let Some(database) = database {
            manager
                .get_database_tables(&connection_id, database, &schema)
                .await
                .map_err(|error| error.to_string())?
                .into_iter()
                .find(|candidate| candidate.name == table_name)
                .and_then(|candidate| candidate.table_type)
        } else {
            resolve_object_type(&manager, &connection_id, &schema, table_name, None).await?
        };
        let is_view = object_type_is_view(object_type.as_deref());
        let is_materialized_view = object_type_is_materialized_view(object_type.as_deref());

        if let Some(sql) =
            kind.show_create_relation_query(schema_option(&schema), table_name, is_view)
        {
            let results = query_target(&manager, &connection_id, database, &sql)
                .await
                .map_err(|e| e.to_string())?;
            let ddl = results
                .first()
                .and_then(|result| result.rows.first())
                .and_then(|row| row.get(1))
                .and_then(value_to_string)
                .unwrap_or_else(|| "-- DDL not found".to_string());
            return Ok(ddl);
        }

        if is_view {
            let sql = view_definition_query(kind, &schema, table_name);
            let results = query_target(&manager, &connection_id, database, &sql)
                .await
                .map_err(|e| e.to_string())?;
            let definition = results
                .first()
                .and_then(|result| result.rows.first())
                .and_then(|row| row.first())
                .and_then(value_to_string)
                .unwrap_or_default();
            if definition.trim().is_empty() {
                return Ok("-- DDL not found: view definition is empty".to_string());
            }

            if is_materialized_view {
                return Ok(generate_postgres_materialized_view_ddl(
                    kind,
                    &schema,
                    table_name,
                    &definition,
                ));
            }

            return Ok(generate_postgres_view_ddl(
                kind,
                &schema,
                table_name,
                &definition,
            ));
        }

        let columns = get_target_columns(&manager, &connection_id, database, &schema, table_name)
            .await
            .map_err(|e| e.to_string())?;
        let constraints = match database {
            Some(database) => {
                manager
                    .get_database_constraints(&connection_id, database, &schema, table_name)
                    .await
            }
            None => {
                manager
                    .get_constraints(&connection_id, &schema, table_name)
                    .await
            }
        }
        .unwrap_or_default();
        let indexes = match database {
            Some(database) => {
                manager
                    .get_database_indexes(&connection_id, database, &schema, table_name)
                    .await
            }
            None => {
                manager
                    .get_indexes(&connection_id, &schema, table_name)
                    .await
            }
        }
        .unwrap_or_default();

        if columns.is_empty() {
            return Ok("-- DDL not found: table has no column metadata".to_string());
        }

        Ok(generate_postgres_table_ddl(
            &schema,
            table_name,
            &columns,
            &constraints,
            &indexes,
        ))
    }
    .await;

    match result {
        Ok(ddl) => Ok(Response::ok(ddl)),
        Err(error) => Ok(Response::err_with_details(
            "GET_TABLE_DDL_ERROR",
            &error,
            true,
            Some(error_context),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_transfer_conversion, bounded_table_data_transfer_message,
        build_add_table_column_statements, build_alter_table_column_statements,
        build_create_check_constraint_statement, build_create_foreign_key_statement,
        build_create_materialized_view_statement, build_create_primary_key_statement,
        build_create_table_index_statement, build_create_table_statements,
        build_create_unique_constraint_statement, build_create_view_statement,
        build_data_transfer_column_mapping, build_drop_table_column_statement,
        build_drop_table_constraint_statement, build_drop_table_index_statement,
        build_insert_mutation, build_rename_table_column_statement,
        build_rename_table_index_statement, build_sqlite_add_column_statements,
        build_sqlite_create_index_statement, build_sqlite_create_table_statements,
        build_sqlite_drop_column_statement, build_sqlite_drop_index_statement,
        build_structured_filter_where, build_table_order_by, build_update_mutation,
        build_upsert_mutation, canonical_import_columns, column_lookup, csv_delimiter, csv_escape,
        csv_record_values, delete_table_data_transfer_target_for_overwrite,
        ensure_host_table_ddl_capability, ensure_transfer_endpoint_driver_matches_connection,
        execute_target_parameterized_batch, finish_table_data_transfer_transaction,
        generate_postgres_materialized_view_ddl, generate_postgres_table_ddl,
        generate_postgres_view_ddl, get_target_columns, is_json_lines_path,
        normalized_table_data_transfer_project_id, object_label_from_type,
        object_type_is_foreign_table, object_type_is_materialized_view, object_type_is_view,
        overwrite_transfer_verification, postgres_view_definition_query, preview_metadata_required,
        query_target, query_target_parameterized, read_csv_import_preview,
        read_json_import_preview, relation_operation_allowed, resolve_csv_import_columns,
        resolve_transfer_upsert_key_columns, reviewed_table_data_dialect, sanitize_file_part,
        sql_insert_statement, summarize_mutation_affected, table_data_dialect,
        table_data_transfer_batch_plan, table_data_transfer_dialect,
        table_data_transfer_plan_digest, table_data_transfer_report_id,
        transfer_confirmation_token, transfer_plan_can_execute, transfer_target_column_type,
        transfer_target_confirmation_token, transfer_type_mapping_assessment,
        transfer_type_mapping_warnings, validate_table_data_transfer_id,
        validate_table_data_transfer_overwrite_rows, validate_xlsx_headers,
        validated_raw_filter_sql, value_to_u64, view_definition_query, xlsx_cell_value,
        AlterColumnValueMode, AlterTableColumn, CreateTableColumn, RelationOperation,
        TableCsvColumnMapping, TableCsvImportOptions, TableDataTransferBatchPlanRequest,
        TableDataTransferCancellationState, TableDataTransferColumnMapping,
        TableDataTransferCompatibility, TableDataTransferConversion, TableDataTransferEndpoint,
        TableDataTransferMode, TableDataTransferRequest, TableDataTransferTargetColumn,
        TableDataTransferTargetPlanRequest, TableDataTransferVerificationStatus, TableFilter,
        TableRowUpdate, TableSort, MAX_JSON_IMPORT_PREVIEW_ROWS, MAX_TRANSFER_OVERWRITE_ROWS,
    };
    use crate::core::{
        dialect::DatabaseKind,
        driver::DatabaseDriver,
        manager::ConnectionManager,
        protocol::{
            ColumnInfo, ConstraintInfo, IndexInfo, ParameterizedStatement, QueryParameter,
            QueryResult,
        },
    };
    use anyhow::Result;
    use async_trait::async_trait;
    use calamine::Data;
    use serde_json::{json, Value};
    use std::{
        collections::BTreeMap,
        fs,
        path::Path,
        sync::{Arc, Mutex},
    };

    struct PreviewTargetDriver;

    struct RestrictedExternalPostgresDriver;

    struct TransferTransactionDriver {
        events: Arc<Mutex<Vec<String>>>,
        delete_rows: u64,
    }

    #[test]
    fn transfer_target_types_use_conservative_target_dialect_representations() {
        assert_eq!(
            transfer_target_column_type("uuid", "postgres"),
            (
                "UUID".to_string(),
                None,
                "The source type is directly supported by the target dialect.".to_string(),
            )
        );
        assert_eq!(transfer_target_column_type("uuid", "mysql").0, "VARCHAR");
        assert_eq!(
            transfer_target_column_type("uuid", "mysql").1.as_deref(),
            Some("36")
        );
        assert_eq!(transfer_target_column_type("bytea", "postgres").0, "BYTEA");
        assert_eq!(
            transfer_target_column_type("decimal(18,2)", "sqlite").0,
            "NUMERIC"
        );
        assert_eq!(
            transfer_target_column_type("bigint unsigned", "mysql")
                .1
                .as_deref(),
            Some("20,0")
        );
        assert_eq!(
            transfer_target_column_type("double precision", "postgres").0,
            "DOUBLE PRECISION"
        );
        assert_eq!(
            transfer_target_column_type("vendor_geography", "mysql").0,
            "TEXT"
        );
    }

    #[test]
    fn transfer_target_confirmation_is_bound_to_the_generated_ddl() {
        let request = TableDataTransferTargetPlanRequest {
            source: TableDataTransferEndpoint {
                connection_id: "source".to_string(),
                driver: "postgres".to_string(),
                schema: "public".to_string(),
                table: "events".to_string(),
                database: None,
            },
            target: TableDataTransferEndpoint {
                connection_id: "target".to_string(),
                driver: "mysql".to_string(),
                schema: "app".to_string(),
                table: "events_copy".to_string(),
                database: None,
            },
        };
        let columns = vec![TableDataTransferTargetColumn {
            name: "id".to_string(),
            source_data_type: "uuid".to_string(),
            target_data_type: "VARCHAR".to_string(),
            target_length: Some("36".to_string()),
            is_primary_key: true,
            is_not_null: true,
            reason: "mapped".to_string(),
        }];
        let first = transfer_target_confirmation_token(
            &request,
            &columns,
            &["CREATE TABLE events_copy (id VARCHAR(36));".to_string()],
        )
        .unwrap();
        let changed = transfer_target_confirmation_token(
            &request,
            &columns,
            &["CREATE TABLE events_copy (id TEXT);".to_string()],
        )
        .unwrap();
        assert!(first.starts_with("CREATE "));
        assert_ne!(first, changed);
    }

    #[async_trait]
    impl DatabaseDriver for TransferTransactionDriver {
        async fn connect(&mut self) -> Result<()> {
            Ok(())
        }

        async fn disconnect(&self) -> Result<()> {
            Ok(())
        }

        async fn ping(&self) -> Result<()> {
            Ok(())
        }

        async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
            Ok(Vec::new())
        }

        async fn execute_parameterized_transaction(
            &self,
            session_id: &str,
            statements: &[ParameterizedStatement],
        ) -> Result<Vec<u64>> {
            self.events.lock().expect("transfer event mutex").extend(
                statements
                    .iter()
                    .map(|statement| format!("execute:{session_id}:{}", statement.sql)),
            );
            Ok(vec![self.delete_rows; statements.len()])
        }

        async fn commit_transaction(&self, session_id: &str) -> Result<()> {
            self.events
                .lock()
                .expect("transfer event mutex")
                .push(format!("commit:{session_id}"));
            Ok(())
        }

        async fn rollback_transaction(&self, session_id: &str) -> Result<()> {
            self.events
                .lock()
                .expect("transfer event mutex")
                .push(format!("rollback:{session_id}"));
            Ok(())
        }
    }

    #[test]
    fn exports_replayable_sql_insert_statements() {
        assert_eq!(
            sql_insert_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                &["id".to_string(), "display name".to_string()],
                &[json!(7), json!("O'Reilly")],
            ),
            r#"INSERT INTO "public"."users" ("id", "display name") VALUES (7, 'O''Reilly');"#
        );
        assert_eq!(
            sql_insert_statement(
                DatabaseKind::Mysql,
                "app",
                "events",
                &["payload".to_string(), "active".to_string()],
                &[json!({"kind": "login"}), json!(true)],
            ),
            r#"INSERT INTO `app`.`events` (`payload`, `active`) VALUES ('{"kind":"login"}', TRUE);"#
        );
    }

    #[test]
    fn import_headers_resolve_to_canonical_table_columns() {
        let columns = column_lookup(vec![target_column("user_id"), target_column("DisplayName")]);
        assert_eq!(
            canonical_import_columns(
                &["USER_ID".to_string(), "displayname".to_string()],
                &columns,
            )
            .unwrap(),
            vec!["user_id".to_string(), "DisplayName".to_string()]
        );
        assert!(canonical_import_columns(&["missing".to_string()], &columns).is_err());
    }

    #[test]
    fn csv_plan_mapping_and_empty_values_match_the_reviewed_contract() {
        let columns = column_lookup(vec![target_column("id"), target_column("display_name")]);
        let source = vec![
            "legacy_id".to_string(),
            "name".to_string(),
            "ignored".to_string(),
        ];
        let options = TableCsvImportOptions {
            delimiter: Some(";".to_string()),
            first_row_header: Some(true),
            column_mapping: vec![
                TableCsvColumnMapping {
                    source_index: 0,
                    target_column: Some("ID".to_string()),
                },
                TableCsvColumnMapping {
                    source_index: 1,
                    target_column: Some("display_name".to_string()),
                },
                TableCsvColumnMapping {
                    source_index: 2,
                    target_column: None,
                },
            ],
            empty_fields_as_null: Some(true),
        };
        let resolved = resolve_csv_import_columns(&source, &columns, Some(&options)).unwrap();
        assert_eq!(
            resolved,
            vec![
                Some("id".to_string()),
                Some("display_name".to_string()),
                None
            ]
        );
        assert_eq!(csv_delimiter(Some(&options)).unwrap(), b';');
        let record = csv::StringRecord::from(vec!["7", "", "discard"]);
        let values = csv_record_values(&resolved, &record, true).unwrap();
        assert_eq!(values.get("id"), Some(&Value::String("7".to_string())));
        assert_eq!(values.get("display_name"), Some(&Value::Null));
        assert!(!values.contains_key("ignored"));
    }

    #[test]
    fn native_csv_preview_is_read_only_and_bounded_to_the_review_payload() {
        let path =
            std::env::temp_dir().join(format!("oxide-csv-preview-{}.csv", uuid::Uuid::new_v4()));
        fs::write(&path, b"email\nreader@example.test\n").unwrap();

        let preview = read_csv_import_preview(&path).unwrap();
        assert_eq!(
            preview.file_name,
            path.file_name().unwrap().to_string_lossy()
        );
        assert_eq!(preview.bytes, b"email\nreader@example.test\n");
        assert_eq!(preview.total_bytes, preview.bytes.len() as u64);
        assert!(!preview.truncated);

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn json_import_preview_is_structured_bounded_and_does_not_write() {
        let path =
            std::env::temp_dir().join(format!("oxide-json-preview-{}.json", uuid::Uuid::new_v4()));
        fs::write(
            &path,
            r#"[{"id":1,"name":"first"},{"id":2,"name":"second","active":true}]"#,
        )
        .unwrap();

        let preview = read_json_import_preview(&path).unwrap();
        assert_eq!(preview.total_rows, Some(2));
        assert_eq!(preview.source_columns, vec!["active", "id", "name"]);
        assert_eq!(preview.sample_rows.len(), 2);
        assert_eq!(preview.sample_rows[0].get("name"), Some(&json!("first")));
        assert!(!preview.truncated);
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            r#"[{"id":1,"name":"first"},{"id":2,"name":"second","active":true}]"#
        );

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn json_lines_preview_only_reads_a_bounded_leading_sample() {
        let path = std::env::temp_dir().join(format!(
            "oxide-json-lines-preview-{}.jsonl",
            uuid::Uuid::new_v4()
        ));
        let source = (0..=MAX_JSON_IMPORT_PREVIEW_ROWS)
            .map(|index| format!(r#"{{"id":{index}}}"#))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&path, source).unwrap();

        let preview = read_json_import_preview(&path).unwrap();
        assert_eq!(preview.total_rows, None);
        assert_eq!(preview.sample_rows.len(), MAX_JSON_IMPORT_PREVIEW_ROWS);
        assert!(preview.truncated);

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn xlsx_cells_keep_scalar_types_before_driver_coercion() {
        assert_eq!(xlsx_cell_value(&Data::Int(7)), json!(7));
        assert_eq!(xlsx_cell_value(&Data::Float(1.5)), json!(1.5));
        assert_eq!(xlsx_cell_value(&Data::Bool(true)), json!(true));
        assert_eq!(
            xlsx_cell_value(&Data::String("reader@example.test".to_string())),
            json!("reader@example.test")
        );
        assert_eq!(xlsx_cell_value(&Data::Empty), Value::Null);
    }

    #[test]
    fn xlsx_headers_reject_empty_and_case_insensitive_duplicates() {
        assert!(validate_xlsx_headers(&["id".to_string(), "email".to_string()]).is_ok());
        assert!(validate_xlsx_headers(&["id".to_string(), " ID ".to_string()]).is_err());
        assert!(validate_xlsx_headers(&["".to_string()]).is_err());
    }

    #[test]
    fn csv_plan_rejects_unsafe_mapping_shapes() {
        let columns = column_lookup(vec![target_column("id")]);
        let source = vec!["source".to_string()];
        let duplicate = TableCsvImportOptions {
            delimiter: None,
            first_row_header: None,
            column_mapping: vec![
                TableCsvColumnMapping {
                    source_index: 0,
                    target_column: Some("id".to_string()),
                },
                TableCsvColumnMapping {
                    source_index: 0,
                    target_column: None,
                },
            ],
            empty_fields_as_null: None,
        };
        assert!(resolve_csv_import_columns(&source, &columns, Some(&duplicate)).is_err());
        assert!(csv_delimiter(Some(&TableCsvImportOptions {
            delimiter: Some("::".to_string()),
            ..Default::default()
        }))
        .is_err());
    }

    #[test]
    fn recognizes_only_line_delimited_json_for_streaming_imports() {
        assert!(is_json_lines_path(Path::new("events.jsonl")));
        assert!(is_json_lines_path(Path::new("events.NDJSON")));
        assert!(!is_json_lines_path(Path::new("events.json")));
        assert!(!is_json_lines_path(Path::new("events.csv")));
    }

    #[test]
    fn data_transfer_mapping_is_case_insensitive_and_rejects_missing_required_columns() {
        let source = vec![
            target_column("id"),
            target_column("display_name"),
            target_column("legacy"),
        ];
        let mut required = target_column("email");
        required.is_nullable = false;
        let target = vec![target_column("ID"), target_column("display_name"), required];

        let error = build_data_transfer_column_mapping(&source, &target).unwrap_err();
        assert!(error.contains("email"));

        let mut source_with_email = source.clone();
        source_with_email.push(target_column("EMAIL"));
        let (mappings, skipped) =
            build_data_transfer_column_mapping(&source_with_email, &target).unwrap();
        assert_eq!(
            mappings
                .iter()
                .map(|mapping| (mapping.source.as_str(), mapping.target.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("id", "ID"),
                ("display_name", "display_name"),
                ("EMAIL", "email")
            ]
        );
        assert_eq!(skipped, vec!["legacy"]);
    }

    #[test]
    fn data_transfer_surfaces_type_conversion_review_before_confirmation() {
        let mapping = |source: &str, target: &str, source_type: &str, target_type: &str| {
            let (compatibility, conversion, reason) =
                transfer_type_mapping_assessment(source_type, target_type);
            TableDataTransferColumnMapping {
                source: source.to_string(),
                target: target.to_string(),
                data_type: target_type.to_string(),
                source_data_type: source_type.to_string(),
                target_data_type: target_type.to_string(),
                compatibility,
                conversion,
                reason,
            }
        };
        let mappings = [
            mapping("id", "id", "bigint", "uuid"),
            mapping("amount", "amount", "integer", "decimal(18,2)"),
            mapping("ratio", "ratio", "numeric", "integer"),
        ];
        let warnings = transfer_type_mapping_warnings(&mappings);
        assert_eq!(warnings.len(), 2);
        assert!(warnings[0].contains("Blocked mapping: id (bigint) → id (uuid)"));
        assert!(warnings[1].contains("Numeric-to-integer conversion"));
        assert!(!transfer_plan_can_execute(&mappings));
    }

    #[test]
    fn data_transfer_type_plan_serializes_json_and_blocks_unreviewed_pairs() {
        let (compatibility, conversion, _) = transfer_type_mapping_assessment("jsonb", "text");
        assert_eq!(compatibility, TableDataTransferCompatibility::Safe);
        assert_eq!(conversion, TableDataTransferConversion::StringifyJson);
        let mapping = TableDataTransferColumnMapping {
            source: "payload".to_string(),
            target: "payload_text".to_string(),
            data_type: "text".to_string(),
            source_data_type: "jsonb".to_string(),
            target_data_type: "text".to_string(),
            compatibility,
            conversion,
            reason: "JSON to text".to_string(),
        };
        assert_eq!(
            apply_transfer_conversion(&mapping, &serde_json::json!({"id": 7})).unwrap(),
            serde_json::Value::String("{\"id\":7}".to_string())
        );

        let (compatibility, conversion, reason) =
            transfer_type_mapping_assessment("bytea", "timestamp");
        assert_eq!(compatibility, TableDataTransferCompatibility::Unsupported);
        let blocked = TableDataTransferColumnMapping {
            source: "id".to_string(),
            target: "id".to_string(),
            data_type: "timestamp".to_string(),
            source_data_type: "bytea".to_string(),
            target_data_type: "timestamp".to_string(),
            compatibility,
            conversion,
            reason,
        };
        assert!(apply_transfer_conversion(&blocked, &serde_json::json!("00FF")).is_err());
    }

    #[test]
    fn data_transfer_confirmation_binds_endpoints_and_column_plan() {
        let request = TableDataTransferRequest {
            project_id: None,
            transfer_id: "transfer-test-0001".to_string(),
            source: TableDataTransferEndpoint {
                connection_id: "source".to_string(),
                driver: "postgres".to_string(),
                schema: "public".to_string(),
                table: "users".to_string(),
                database: None,
            },
            target: TableDataTransferEndpoint {
                connection_id: "target".to_string(),
                driver: "mysql".to_string(),
                schema: "app".to_string(),
                table: "users_copy".to_string(),
                database: None,
            },
            mode: TableDataTransferMode::Append,
            max_rows: Some(500),
            batch_size: Some(100),
            reseed_identity: false,
        };
        let mappings =
            build_data_transfer_column_mapping(&[target_column("id")], &[target_column("id")])
                .unwrap()
                .0;
        let token = transfer_confirmation_token(&request, &mappings, 500, 100, None, &[]).unwrap();
        assert!(token.starts_with("TRANSFER "));

        let mut changed = request.clone();
        changed.target.table = "other_users".to_string();
        assert_ne!(
            token,
            transfer_confirmation_token(&changed, &mappings, 500, 100, None, &[]).unwrap()
        );
        changed = request.clone();
        changed.transfer_id = "transfer-test-0002".to_string();
        assert_ne!(
            token,
            transfer_confirmation_token(&changed, &mappings, 500, 100, None, &[]).unwrap()
        );
        changed = request.clone();
        changed.mode = TableDataTransferMode::Overwrite;
        assert_ne!(
            token,
            transfer_confirmation_token(&changed, &mappings, 500, 100, Some(12), &[]).unwrap()
        );
        changed.mode = TableDataTransferMode::Upsert;
        assert_ne!(
            token,
            transfer_confirmation_token(&changed, &mappings, 500, 100, None, &["id".to_string()],)
                .unwrap()
        );
    }

    #[test]
    fn data_transfer_upsert_uses_explicit_target_primary_key() {
        let mut id = target_column("id");
        id.is_primary_key = true;
        id.is_nullable = false;
        let columns = column_lookup(vec![id, target_column("display_name")]);
        let values = BTreeMap::from([
            ("id".to_string(), serde_json::json!(7)),
            ("display_name".to_string(), serde_json::json!("Ada")),
        ]);
        let keys = vec!["id".to_string()];

        let (postgres, postgres_params) = build_upsert_mutation(
            DatabaseKind::Postgres,
            "public",
            "users",
            &columns,
            &values,
            &keys,
        )
        .unwrap();
        assert!(postgres.contains("ON CONFLICT (\"id\") DO UPDATE SET"));
        assert!(postgres.contains("\"display_name\" = EXCLUDED.\"display_name\""));
        assert_eq!(postgres_params.len(), 2);

        let (mysql, mysql_params) = build_upsert_mutation(
            DatabaseKind::Mysql,
            "app",
            "users",
            &columns,
            &values,
            &keys,
        )
        .unwrap();
        assert!(mysql.contains("ON DUPLICATE KEY UPDATE"));
        assert!(mysql.contains("`display_name` = VALUES(`display_name`)"));
        assert_eq!(mysql_params.len(), 2);
    }

    #[test]
    fn data_transfer_upsert_rejects_an_unmapped_key() {
        let mut id = target_column("id");
        id.is_primary_key = true;
        id.is_nullable = false;
        let columns = column_lookup(vec![id, target_column("display_name")]);
        let values = BTreeMap::from([("display_name".to_string(), serde_json::json!("Ada"))]);

        let error = build_upsert_mutation(
            DatabaseKind::Postgres,
            "public",
            "users",
            &columns,
            &values,
            &["id".to_string()],
        )
        .unwrap_err();
        assert!(error.contains("Upsert key column id is not mapped"));
    }

    #[test]
    fn data_transfer_upsert_plan_requires_bundled_driver_and_complete_primary_key() {
        let mut id = target_column("id");
        id.is_primary_key = true;
        let mappings = build_data_transfer_column_mapping(&[id.clone()], &[id.clone()])
            .unwrap()
            .0;

        assert_eq!(
            resolve_transfer_upsert_key_columns(
                TableDataTransferMode::Upsert,
                false,
                &[id.clone()],
                &mappings,
            )
            .unwrap(),
            vec!["id"]
        );
        assert!(resolve_transfer_upsert_key_columns(
            TableDataTransferMode::Upsert,
            true,
            &[id.clone()],
            &mappings,
        )
        .unwrap_err()
        .contains("external driver packages"));
        assert!(resolve_transfer_upsert_key_columns(
            TableDataTransferMode::Upsert,
            false,
            &[target_column("display_name")],
            &mappings,
        )
        .unwrap_err()
        .contains("declared primary key"));
        assert!(resolve_transfer_upsert_key_columns(
            TableDataTransferMode::Upsert,
            false,
            &[id],
            &[],
        )
        .unwrap_err()
        .contains("primary-key column to be mapped"));
    }

    #[tokio::test]
    async fn data_transfer_cancellation_registry_rejects_replay_until_execution_releases_id() {
        let cancellation = TableDataTransferCancellationState::default();
        let mut receiver = cancellation
            .register("transfer-test-0001", "source")
            .await
            .unwrap();
        assert!(cancellation
            .register("transfer-test-0001", "source")
            .await
            .is_err());

        let handle = cancellation
            .request_cancel("transfer-test-0001")
            .await
            .unwrap();
        handle.sender.send(true).unwrap();
        receiver.changed().await.unwrap();
        assert!(*receiver.borrow());
        assert!(cancellation
            .request_cancel("transfer-test-0001")
            .await
            .is_some());

        cancellation.take("transfer-test-0001").await;
        assert!(cancellation
            .register("transfer-test-0001", "source")
            .await
            .is_ok());
    }

    #[test]
    fn data_transfer_ids_are_bounded_and_safe_for_driver_query_tracking() {
        assert!(validate_table_data_transfer_id("transfer-12345678").is_ok());
        assert!(validate_table_data_transfer_id("short").is_err());
        assert!(validate_table_data_transfer_id("transfer/escape").is_err());
        assert!(validate_table_data_transfer_id(&"x".repeat(129)).is_err());
    }

    #[test]
    fn data_transfer_overwrite_row_count_is_hard_bounded() {
        assert_eq!(
            validate_table_data_transfer_overwrite_rows(MAX_TRANSFER_OVERWRITE_ROWS).unwrap(),
            MAX_TRANSFER_OVERWRITE_ROWS
        );
        assert!(
            validate_table_data_transfer_overwrite_rows(MAX_TRANSFER_OVERWRITE_ROWS + 1)
                .unwrap_err()
                .contains("Overwrite is limited")
        );
    }

    #[test]
    fn data_transfer_progress_errors_are_bounded_before_emission() {
        let message = bounded_table_data_transfer_message(&"值".repeat(2_000));
        assert_eq!(message.chars().count(), 1_025);
        assert!(message.ends_with('…'));
    }

    #[test]
    fn data_transfer_reports_use_a_bounded_project_identity_and_hashed_plan_token() {
        assert_eq!(
            normalized_table_data_transfer_project_id(Some(" project-a ")),
            Some("project-a".to_string())
        );
        assert_eq!(
            normalized_table_data_transfer_project_id(Some("\u{0000}")),
            None
        );
        assert_eq!(
            normalized_table_data_transfer_project_id(Some(&"x".repeat(129))),
            None
        );
        let token = "TRANSFER 0123456789ABCDEF";
        let digest = table_data_transfer_plan_digest(token);
        assert_eq!(digest.len(), 64);
        assert!(!digest.contains(token));
        assert_eq!(
            table_data_transfer_report_id("transfer-test-0001"),
            "table-transfer-report-transfer-test-0001"
        );
    }

    #[test]
    fn batch_transfer_plan_orders_selected_tables_by_foreign_key_and_blocks_cycles() {
        let request = TableDataTransferBatchPlanRequest {
            source_connection_id: "source".to_string(),
            source_driver: "postgres".to_string(),
            source_database: None,
            source_schema: "public".to_string(),
            target_connection_id: "target".to_string(),
            target_driver: "postgres".to_string(),
            target_database: None,
            target_schema: "public".to_string(),
            tables: vec!["orders".to_string(), "users".to_string()],
            mode: TableDataTransferMode::Append,
            max_rows: None,
            batch_size: None,
            reseed_identity: false,
        };
        let users = ConstraintInfo {
            name: "users_pkey".to_string(),
            constraint_type: "PRIMARY KEY".to_string(),
            columns: vec!["id".to_string()],
            referenced_schema: None,
            referenced_table: None,
            referenced_columns: Vec::new(),
            definition: None,
        };
        let order_user_fk = ConstraintInfo {
            name: "orders_user_fk".to_string(),
            constraint_type: "FOREIGN KEY".to_string(),
            columns: vec!["user_id".to_string()],
            referenced_schema: Some("public".to_string()),
            referenced_table: Some("users".to_string()),
            referenced_columns: vec!["id".to_string()],
            definition: None,
        };
        let plan = table_data_transfer_batch_plan(
            &request,
            &request.tables,
            &[
                ("orders".to_string(), vec![order_user_fk.clone()]),
                ("users".to_string(), vec![users]),
            ],
        )
        .unwrap();
        assert_eq!(plan.ordered_tables, vec!["users", "orders"]);
        assert!(plan.cyclic_tables.is_empty());
        assert!(plan.can_execute);
        assert!(plan.table_preflights.is_empty());
        assert_eq!(plan.dependencies[0].constraint_name, "orders_user_fk");

        let cycle = table_data_transfer_batch_plan(
            &request,
            &request.tables,
            &[
                ("orders".to_string(), vec![order_user_fk]),
                (
                    "users".to_string(),
                    vec![ConstraintInfo {
                        name: "users_order_fk".to_string(),
                        constraint_type: "FOREIGN KEY".to_string(),
                        columns: vec!["default_order_id".to_string()],
                        referenced_schema: Some("public".to_string()),
                        referenced_table: Some("orders".to_string()),
                        referenced_columns: vec!["id".to_string()],
                        definition: None,
                    }],
                ),
            ],
        )
        .unwrap();
        assert!(cycle.ordered_tables.is_empty());
        assert_eq!(cycle.cyclic_tables, vec!["orders", "users"]);
        assert!(!cycle.can_execute);
    }

    #[tokio::test]
    async fn data_transfer_overwrite_uses_transactional_delete_and_rechecks_reviewed_count() {
        let manager = ConnectionManager::new();
        let events = Arc::new(Mutex::new(Vec::new()));
        manager
            .add_connection(
                "target".to_string(),
                Box::new(TransferTransactionDriver {
                    events: Arc::clone(&events),
                    delete_rows: 12,
                }),
            )
            .await;
        let endpoint = TableDataTransferEndpoint {
            connection_id: "target".to_string(),
            driver: "mysql".to_string(),
            schema: "app".to_string(),
            table: "users".to_string(),
            database: None,
        };

        delete_table_data_transfer_target_for_overwrite(
            &manager,
            &endpoint,
            DatabaseKind::Mysql,
            "transfer-overwrite",
            12,
        )
        .await
        .unwrap();
        assert_eq!(
            events.lock().expect("transfer event mutex").as_slice(),
            ["execute:transfer-overwrite:DELETE FROM `app`.`users`"]
        );

        let error = delete_table_data_transfer_target_for_overwrite(
            &manager,
            &endpoint,
            DatabaseKind::Mysql,
            "transfer-overwrite",
            11,
        )
        .await
        .unwrap_err();
        assert!(error.contains("changed after preview"));
        assert!(error.contains("expected to delete 11"));
    }

    #[tokio::test]
    async fn data_transfer_commits_only_after_a_successful_complete_plan() {
        let manager = ConnectionManager::new();
        let events = Arc::new(Mutex::new(Vec::new()));
        manager
            .add_connection(
                "target".to_string(),
                Box::new(TransferTransactionDriver {
                    events: Arc::clone(&events),
                    delete_rows: 0,
                }),
            )
            .await;

        let summary = finish_table_data_transfer_transaction(
            &manager,
            "target",
            "transfer-1",
            Ok((42, 3, false)),
        )
        .await
        .unwrap();

        assert_eq!(summary, (42, 3, false));
        assert_eq!(
            events.lock().expect("transfer event mutex").as_slice(),
            ["commit:transfer-1"]
        );
    }

    #[tokio::test]
    async fn data_transfer_rolls_back_without_committing_after_any_batch_failure() {
        let manager = ConnectionManager::new();
        let events = Arc::new(Mutex::new(Vec::new()));
        manager
            .add_connection(
                "target".to_string(),
                Box::new(TransferTransactionDriver {
                    events: Arc::clone(&events),
                    delete_rows: 0,
                }),
            )
            .await;

        let error = finish_table_data_transfer_transaction(
            &manager,
            "target",
            "transfer-2",
            Err("batch 2 rejected a value".to_string()),
        )
        .await
        .unwrap_err();

        assert!(error.contains("rolled back"));
        assert!(error.contains("batch 2 rejected a value"));
        assert_eq!(
            events.lock().expect("transfer event mutex").as_slice(),
            ["rollback:transfer-2"]
        );
    }

    #[tokio::test]
    async fn data_transfer_rejects_an_endpoint_driver_that_does_not_match_the_live_connection() {
        let manager = ConnectionManager::new();
        manager
            .replace_connection_with_tunnel_and_driver_id(
                "source".to_string(),
                Box::new(PreviewTargetDriver),
                None,
                Some("postgres".to_string()),
            )
            .await
            .unwrap();
        let endpoint = TableDataTransferEndpoint {
            connection_id: "source".to_string(),
            driver: "mysql".to_string(),
            schema: "public".to_string(),
            table: "events".to_string(),
            database: None,
        };

        let error = ensure_transfer_endpoint_driver_matches_connection(&manager, &endpoint)
            .await
            .unwrap_err();
        assert!(error.contains("does not match"));
    }

    #[tokio::test]
    async fn data_transfer_does_not_widen_an_external_postgres_package_capability() {
        let manager = ConnectionManager::new();
        manager
            .add_connection(
                "external-postgres".to_string(),
                Box::new(RestrictedExternalPostgresDriver),
            )
            .await;
        let endpoint = TableDataTransferEndpoint {
            connection_id: "external-postgres".to_string(),
            driver: "postgres".to_string(),
            schema: "public".to_string(),
            table: "events".to_string(),
            database: None,
        };

        let error = table_data_transfer_dialect(&manager, &endpoint)
            .await
            .unwrap_err();
        assert!(error.contains("reviewed bounded table-data transfer path"));
    }

    fn target_column(name: &str) -> ColumnInfo {
        ColumnInfo {
            name: name.to_string(),
            data_type: "text".to_string(),
            is_nullable: true,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            is_auto_increment: false,
            default_value: None,
            comment: None,
        }
    }

    #[async_trait]
    impl DatabaseDriver for PreviewTargetDriver {
        async fn connect(&mut self) -> Result<()> {
            Ok(())
        }

        async fn disconnect(&self) -> Result<()> {
            Ok(())
        }

        async fn ping(&self) -> Result<()> {
            Ok(())
        }

        async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution("primary", 0)])
        }

        async fn query_database(&self, database: &str, _sql: &str) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(database, 0)])
        }

        async fn query_parameterized(
            &self,
            _sql: &str,
            params: &[QueryParameter],
        ) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(
                "primary-parameterized",
                params.len() as u64,
            )])
        }

        async fn query_database_parameterized(
            &self,
            database: &str,
            _sql: &str,
            params: &[QueryParameter],
        ) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(
                &format!("{database}-parameterized"),
                params.len() as u64,
            )])
        }

        async fn execute_parameterized_batch(
            &self,
            statements: &[ParameterizedStatement],
        ) -> Result<Vec<u64>> {
            Ok(vec![1; statements.len()])
        }

        async fn execute_database_parameterized_batch(
            &self,
            database: &str,
            statements: &[ParameterizedStatement],
        ) -> Result<Vec<u64>> {
            Ok(vec![database.len() as u64; statements.len()])
        }

        async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
            Ok(vec![target_column("primary")])
        }

        async fn get_database_columns(
            &self,
            database: &str,
            _schema: &str,
            _table: &str,
        ) -> Result<Vec<ColumnInfo>> {
            Ok(vec![target_column(database)])
        }
    }

    #[async_trait]
    impl DatabaseDriver for RestrictedExternalPostgresDriver {
        fn package_capabilities(&self) -> Option<crate::core::dialect::DatabaseCapabilities> {
            let mut capabilities = DatabaseKind::Postgres.capabilities();
            capabilities.display_name = "Restricted PostgreSQL package".to_string();
            capabilities.supports_table_data_transfer = false;
            Some(capabilities)
        }

        async fn connect(&mut self) -> Result<()> {
            Ok(())
        }

        async fn disconnect(&self) -> Result<()> {
            Ok(())
        }

        async fn ping(&self) -> Result<()> {
            Ok(())
        }

        async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution("restricted", 0)])
        }
    }

    #[tokio::test]
    async fn preview_helpers_preserve_explicit_database_scope() {
        let manager = ConnectionManager::new();
        manager
            .add_connection("conn".to_string(), Box::new(PreviewTargetDriver))
            .await;

        let primary_columns = get_target_columns(&manager, "conn", None, "public", "events")
            .await
            .unwrap();
        let scoped_columns =
            get_target_columns(&manager, "conn", Some("analytics"), "public", "events")
                .await
                .unwrap();
        assert_eq!(primary_columns[0].name, "primary");
        assert_eq!(scoped_columns[0].name, "analytics");

        let primary_query = query_target(&manager, "conn", None, "SELECT 1")
            .await
            .unwrap();
        let scoped_query = query_target(&manager, "conn", Some("analytics"), "SELECT 1")
            .await
            .unwrap();
        assert_eq!(primary_query[0].statement_type.as_deref(), Some("primary"));
        assert_eq!(scoped_query[0].statement_type.as_deref(), Some("analytics"));

        let params = [QueryParameter {
            value: json!(1),
            data_type: Some("integer".to_string()),
        }];
        let primary_parameterized =
            query_target_parameterized(&manager, "conn", None, "SELECT $1", &params)
                .await
                .unwrap();
        let scoped_parameterized =
            query_target_parameterized(&manager, "conn", Some("analytics"), "SELECT $1", &params)
                .await
                .unwrap();
        assert_eq!(
            primary_parameterized[0].statement_type.as_deref(),
            Some("primary-parameterized")
        );
        assert_eq!(
            scoped_parameterized[0].statement_type.as_deref(),
            Some("analytics-parameterized")
        );

        let statements = [ParameterizedStatement {
            sql: "UPDATE events SET name = $1".to_string(),
            params: Vec::new(),
        }];
        assert_eq!(
            execute_target_parameterized_batch(&manager, "conn", None, &statements)
                .await
                .unwrap(),
            vec![1]
        );
        assert_eq!(
            execute_target_parameterized_batch(&manager, "conn", Some("analytics"), &statements)
                .await
                .unwrap(),
            vec![9]
        );
    }

    #[test]
    fn preview_skips_column_metadata_without_structured_filters_or_sort() {
        let filters = [TableFilter {
            column: "status".to_string(),
            operator: "eq".to_string(),
            value: "active".to_string(),
            logic: None,
        }];
        let sort = TableSort {
            column: "id".to_string(),
            direction: "asc".to_string(),
        };

        assert!(!preview_metadata_required(None, None));
        assert!(preview_metadata_required(Some(&filters), None));
        assert!(preview_metadata_required(None, Some(&sort)));
    }

    #[test]
    fn validates_raw_table_filters_before_query_composition() {
        assert_eq!(
            validated_raw_filter_sql(
                DatabaseKind::Postgres,
                Some("WHERE status = 'active;pending'")
            )
            .unwrap()
            .as_deref(),
            Some("WHERE status = 'active;pending'")
        );
        assert!(validated_raw_filter_sql(
            DatabaseKind::Postgres,
            Some("id = 1; DELETE FROM users")
        )
        .is_err());
        assert!(validated_raw_filter_sql(
            DatabaseKind::Mysql,
            Some("id = 1 UNION SELECT password FROM users")
        )
        .is_err());
        assert!(validated_raw_filter_sql(
            DatabaseKind::Postgres,
            Some("id IN (SELECT id FROM admins)")
        )
        .is_err());
    }

    #[test]
    fn generates_postgres_table_ddl_from_columns() {
        let ddl = generate_postgres_table_ddl(
            "public",
            "users",
            &[
                ColumnInfo {
                    name: "id".to_string(),
                    data_type: "integer".to_string(),
                    is_nullable: false,
                    is_primary_key: true,
                    is_unique: true,
                    is_indexed: true,
                    default_value: Some("nextval('users_id_seq'::regclass)".to_string()),
                    is_auto_increment: false,
                    comment: None,
                },
                ColumnInfo {
                    name: "email".to_string(),
                    data_type: "text".to_string(),
                    is_nullable: false,
                    is_primary_key: false,
                    is_unique: false,
                    is_indexed: false,
                    default_value: None,
                    is_auto_increment: false,
                    comment: None,
                },
            ],
            &[
                ConstraintInfo {
                    name: "users_pkey".to_string(),
                    constraint_type: "PRIMARY KEY".to_string(),
                    columns: vec!["id".to_string()],
                    referenced_schema: None,
                    referenced_table: None,
                    referenced_columns: vec![],
                    definition: Some("PRIMARY KEY (id)".to_string()),
                },
                ConstraintInfo {
                    name: "users_email_key".to_string(),
                    constraint_type: "UNIQUE".to_string(),
                    columns: vec!["email".to_string()],
                    referenced_schema: None,
                    referenced_table: None,
                    referenced_columns: vec![],
                    definition: Some("UNIQUE (email)".to_string()),
                },
            ],
            &[IndexInfo {
                name: "users_email_idx".to_string(),
                columns: vec!["email".to_string()],
                is_unique: false,
                is_primary: false,
                index_type: Some("btree".to_string()),
                definition: Some(
                    "CREATE INDEX users_email_idx ON public.users USING btree (email)".to_string(),
                ),
            }],
        );

        assert!(ddl.contains(r#"CREATE TABLE "public"."users""#));
        assert!(ddl.contains(r#""id" integer DEFAULT nextval"#));
        assert!(ddl.contains(r#"CONSTRAINT "users_pkey" PRIMARY KEY (id)"#));
        assert!(ddl.contains(r#"CONSTRAINT "users_email_key" UNIQUE (email)"#));
        assert!(ddl.contains("CREATE INDEX users_email_idx"));
    }

    #[test]
    fn generates_postgres_view_ddl() {
        assert!(object_type_is_view(Some("VIEW")));
        assert!(object_type_is_view(Some("SYSTEM VIEW")));
        assert!(object_type_is_view(Some("MATERIALIZED VIEW")));
        assert!(object_type_is_materialized_view(Some("MATERIALIZED VIEW")));
        assert!(!object_type_is_materialized_view(Some("VIEW")));
        assert!(object_type_is_foreign_table(Some("FOREIGN TABLE")));
        assert!(!object_type_is_view(Some("BASE TABLE")));
        assert_eq!(
            object_label_from_type(Some("MATERIALIZED VIEW")),
            "Materialized view"
        );
        assert_eq!(
            object_label_from_type(Some("FOREIGN TABLE")),
            "Foreign table"
        );

        assert_eq!(
            postgres_view_definition_query(DatabaseKind::Postgres, "public", "active_users"),
            r#"SELECT pg_get_viewdef(to_regclass('"public"."active_users"'), true) AS definition;"#
        );
        assert_eq!(
            view_definition_query(DatabaseKind::Postgres, "public", "active_users"),
            r#"SELECT pg_get_viewdef(to_regclass('"public"."active_users"'), true) AS definition;"#
        );
        assert_eq!(
            view_definition_query(DatabaseKind::Mysql, "app", "active_users"),
            "SELECT VIEW_DEFINITION AS definition FROM information_schema.VIEWS WHERE TABLE_SCHEMA = 'app' AND TABLE_NAME = 'active_users';"
        );
        assert_eq!(
            generate_postgres_view_ddl(
                DatabaseKind::Postgres,
                "public",
                "active_users",
                " SELECT id FROM users WHERE active "
            ),
            r#"CREATE OR REPLACE VIEW "public"."active_users" AS
SELECT id FROM users WHERE active;"#
        );
        assert_eq!(
            generate_postgres_materialized_view_ddl(
                DatabaseKind::Postgres,
                "public",
                "active_users_mv",
                " SELECT id FROM users WHERE active "
            ),
            r#"CREATE MATERIALIZED VIEW "public"."active_users_mv" AS
SELECT id FROM users WHERE active;"#
        );
    }

    #[test]
    fn relation_operation_matrix_matches_object_type() {
        assert!(relation_operation_allowed(
            RelationOperation::DataMutation,
            Some("BASE TABLE")
        ));
        assert!(relation_operation_allowed(
            RelationOperation::ColumnChange,
            Some("BASE TABLE")
        ));
        assert!(relation_operation_allowed(
            RelationOperation::ConstraintChange,
            Some("BASE TABLE")
        ));
        assert!(relation_operation_allowed(
            RelationOperation::IndexChange,
            Some("BASE TABLE")
        ));

        assert!(!relation_operation_allowed(
            RelationOperation::DataMutation,
            Some("VIEW")
        ));
        assert!(!relation_operation_allowed(
            RelationOperation::ColumnChange,
            Some("VIEW")
        ));
        assert!(!relation_operation_allowed(
            RelationOperation::IndexChange,
            Some("VIEW")
        ));

        assert!(!relation_operation_allowed(
            RelationOperation::DataMutation,
            Some("MATERIALIZED VIEW")
        ));
        assert!(!relation_operation_allowed(
            RelationOperation::ConstraintChange,
            Some("MATERIALIZED VIEW")
        ));
        assert!(relation_operation_allowed(
            RelationOperation::IndexChange,
            Some("MATERIALIZED VIEW")
        ));

        assert!(!relation_operation_allowed(
            RelationOperation::DataMutation,
            Some("FOREIGN TABLE")
        ));
        assert!(!relation_operation_allowed(
            RelationOperation::IndexChange,
            Some("FOREIGN TABLE")
        ));
    }

    #[test]
    fn parses_count_values() {
        assert_eq!(value_to_u64(&json!(42)), Some(42));
        assert_eq!(value_to_u64(&json!("42")), Some(42));
        assert_eq!(value_to_u64(&json!(null)), None);
    }

    #[test]
    fn overwrite_transfer_post_verify_requires_an_exact_target_count() {
        let verified = overwrite_transfer_verification(4, Some(4));
        assert_eq!(
            verified.status,
            TableDataTransferVerificationStatus::Verified
        );
        assert_eq!(verified.observed_rows, Some(4));

        let concurrent_write = overwrite_transfer_verification(4, Some(5));
        assert_eq!(
            concurrent_write.status,
            TableDataTransferVerificationStatus::NeedsReview
        );

        let unavailable = overwrite_transfer_verification(4, None);
        assert_eq!(
            unavailable.status,
            TableDataTransferVerificationStatus::NeedsReview
        );
        assert_eq!(unavailable.observed_rows, None);
    }

    #[test]
    fn escapes_csv_values() {
        assert_eq!(csv_escape(&json!("plain")), "plain");
        assert_eq!(csv_escape(&json!("a,b")), "\"a,b\"");
        assert_eq!(csv_escape(&json!("a\"b")), "\"a\"\"b\"");
        assert_eq!(csv_escape(&json!(null)), "");
    }

    #[test]
    fn sanitizes_export_file_parts() {
        assert_eq!(sanitize_file_part("public"), "public");
        assert_eq!(sanitize_file_part("sales/orders"), "sales_orders");
        assert_eq!(sanitize_file_part(" "), "table");
    }

    #[test]
    fn builds_mysql_insert_with_parameter_placeholders() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "name".to_string(),
            data_type: "varchar".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);
        let mut values = BTreeMap::new();
        values.insert("name".to_string(), json!("Ada"));

        let (sql, params) =
            build_insert_mutation(DatabaseKind::Mysql, "app", "users", &columns, &values).unwrap();

        assert_eq!(sql, "INSERT INTO `app`.`users` (`name`) VALUES (?);");
        assert_eq!(params.len(), 1);
        assert_eq!(params[0].data_type.as_deref(), Some("varchar"));
    }

    #[test]
    fn insert_builder_rechecks_required_columns_before_any_batch_is_created() {
        let columns = column_lookup(vec![
            ColumnInfo {
                name: "email".to_string(),
                data_type: "text".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: true,
                is_unique: true,
                is_indexed: true,
                default_value: None,
                is_auto_increment: true,
                comment: None,
            },
            ColumnInfo {
                name: "status".to_string(),
                data_type: "text".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: Some("'pending'".to_string()),
                is_auto_increment: false,
                comment: None,
            },
        ]);

        let error = build_insert_mutation(
            DatabaseKind::Postgres,
            "public",
            "users",
            &columns,
            &BTreeMap::new(),
        )
        .unwrap_err();
        assert!(error.contains("Required column email"));

        let null_email = BTreeMap::from([("email".to_string(), Value::Null)]);
        let error = build_insert_mutation(
            DatabaseKind::Postgres,
            "public",
            "users",
            &columns,
            &null_email,
        )
        .unwrap_err();
        assert!(error.contains("email cannot be NULL"));

        let values = BTreeMap::from([("email".to_string(), json!("ada@example.test"))]);
        assert!(build_insert_mutation(
            DatabaseKind::Postgres,
            "public",
            "users",
            &columns,
            &values,
        )
        .is_ok());
    }

    #[test]
    fn builds_default_values_inserts_for_empty_rows() {
        let columns = BTreeMap::new();
        let values = BTreeMap::new();

        let (postgres_sql, postgres_params) = build_insert_mutation(
            DatabaseKind::Postgres,
            "public",
            "events",
            &columns,
            &values,
        )
        .unwrap();
        assert_eq!(
            postgres_sql,
            r#"INSERT INTO "public"."events" DEFAULT VALUES;"#
        );
        assert!(postgres_params.is_empty());

        let (mysql_sql, mysql_params) =
            build_insert_mutation(DatabaseKind::Mysql, "app", "events", &columns, &values).unwrap();
        assert_eq!(mysql_sql, "INSERT INTO `app`.`events` () VALUES ();");
        assert!(mysql_params.is_empty());
    }

    #[test]
    fn builds_postgres_update_with_casted_parameters() {
        let columns = column_lookup(vec![
            ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: true,
                is_unique: true,
                is_indexed: true,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "email".to_string(),
                data_type: "text".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
        ]);
        let mut key = BTreeMap::new();
        key.insert("id".to_string(), json!(7));
        let mut values = BTreeMap::new();
        values.insert("email".to_string(), json!("ada@example.test"));

        let (sql, params) = build_update_mutation(
            DatabaseKind::Postgres,
            "public",
            "users",
            &columns,
            &TableRowUpdate { key, values },
        )
        .unwrap();

        assert_eq!(
            sql,
            r#"UPDATE "public"."users" SET "email" = $1::text WHERE "id" = $2::integer;"#
        );
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn builds_postgres_structured_filter_with_parameters() {
        let columns = column_lookup(vec![
            ColumnInfo {
                name: "name".to_string(),
                data_type: "text".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: true,
                is_unique: true,
                is_indexed: true,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
        ]);

        let (where_clause, params) = build_structured_filter_where(
            DatabaseKind::Postgres,
            &columns,
            &[
                TableFilter {
                    column: "name".to_string(),
                    operator: "contains".to_string(),
                    value: "A%_".to_string(),
                    logic: None,
                },
                TableFilter {
                    column: "id".to_string(),
                    operator: ">=".to_string(),
                    value: "7".to_string(),
                    logic: Some("AND".to_string()),
                },
            ],
        )
        .unwrap();

        assert_eq!(
            where_clause,
            r#"CAST("name" AS text) LIKE $1::text ESCAPE '=' AND "id" >= $2::integer"#
        );
        assert_eq!(params.len(), 2);
        assert_eq!(params[0].value, json!("%A=%=_%"));
        assert_eq!(params[1].data_type.as_deref(), Some("integer"));
    }

    #[test]
    fn builds_mysql_structured_filter_with_parameters() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "email".to_string(),
            data_type: "varchar".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: true,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        let (where_clause, params) = build_structured_filter_where(
            DatabaseKind::Mysql,
            &columns,
            &[TableFilter {
                column: "email".to_string(),
                operator: "startsWith".to_string(),
                value: "ops".to_string(),
                logic: None,
            }],
        )
        .unwrap();

        assert_eq!(where_clause, "CAST(`email` AS CHAR) LIKE ? ESCAPE '='");
        assert_eq!(params.len(), 1);
        assert_eq!(params[0].value, json!("ops%"));
    }

    #[test]
    fn rejects_unknown_structured_filter_parts() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: true,
            is_unique: true,
            is_indexed: true,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert!(build_structured_filter_where(
            DatabaseKind::Postgres,
            &columns,
            &[TableFilter {
                column: "missing".to_string(),
                operator: "equals".to_string(),
                value: "1".to_string(),
                logic: None,
            }],
        )
        .is_err());

        assert!(build_structured_filter_where(
            DatabaseKind::Postgres,
            &columns,
            &[TableFilter {
                column: "id".to_string(),
                operator: "regexp".to_string(),
                value: "1".to_string(),
                logic: None,
            }],
        )
        .is_err());
    }

    #[test]
    fn builds_safe_table_order_by_clause() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "created_at".to_string(),
            data_type: "timestamp".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: true,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        let order = build_table_order_by(
            DatabaseKind::Postgres,
            &columns,
            Some(&TableSort {
                column: "created_at".to_string(),
                direction: "desc".to_string(),
            }),
        )
        .unwrap();

        assert_eq!(order.as_deref(), Some(r#""created_at" DESC"#));
        assert!(build_table_order_by(
            DatabaseKind::Mysql,
            &columns,
            Some(&TableSort {
                column: "missing".to_string(),
                direction: "asc".to_string(),
            }),
        )
        .is_err());
        assert!(build_table_order_by(
            DatabaseKind::Mysql,
            &columns,
            Some(&TableSort {
                column: "created_at".to_string(),
                direction: "sideways".to_string(),
            }),
        )
        .is_err());

        let stable_columns = column_lookup(vec![
            ColumnInfo {
                name: "tenant_id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: true,
                is_unique: false,
                is_indexed: true,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: true,
                is_unique: false,
                is_indexed: true,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "created_at".to_string(),
                data_type: "timestamp".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: true,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
        ]);
        assert_eq!(
            build_table_order_by(DatabaseKind::Postgres, &stable_columns, None)
                .unwrap()
                .as_deref(),
            Some(r#""id" ASC, "tenant_id" ASC"#)
        );
        assert_eq!(
            build_table_order_by(
                DatabaseKind::Postgres,
                &stable_columns,
                Some(&TableSort {
                    column: "created_at".to_string(),
                    direction: "desc".to_string(),
                }),
            )
            .unwrap()
            .as_deref(),
            Some(r#""created_at" DESC, "id" ASC, "tenant_id" ASC"#)
        );
    }

    #[test]
    fn summarizes_mutation_affected_by_statement_group() {
        let summary = summarize_mutation_affected(&[1, 1, 3, 2], 2, 1, 1);

        assert_eq!(summary.inserted, 2);
        assert_eq!(summary.updated, 3);
        assert_eq!(summary.deleted, 2);
        assert_eq!(summary.rows_affected, 7);
    }

    #[test]
    fn builds_mysql_create_table_with_inline_comments() {
        let statements = build_create_table_statements(
            DatabaseKind::Mysql,
            "app",
            "users",
            &[
                CreateTableColumn {
                    name: "id".to_string(),
                    data_type: "INT".to_string(),
                    length: None,
                    is_primary_key: true,
                    is_not_null: true,
                    is_auto_increment: true,
                    comment: None,
                },
                CreateTableColumn {
                    name: "name".to_string(),
                    data_type: "VARCHAR".to_string(),
                    length: Some("255".to_string()),
                    is_primary_key: false,
                    is_not_null: true,
                    is_auto_increment: false,
                    comment: Some("display name".to_string()),
                },
            ],
        )
        .unwrap();

        assert_eq!(statements.len(), 1);
        assert!(statements[0].contains("CREATE TABLE `app`.`users`"));
        assert!(statements[0].contains("`id` INT AUTO_INCREMENT NOT NULL"));
        assert!(statements[0].contains("`name` VARCHAR(255) NOT NULL COMMENT 'display name'"));
        assert!(statements[0].contains("PRIMARY KEY (`id`)"));
    }

    #[test]
    fn builds_create_view_statements_for_supported_drivers() {
        assert_eq!(
            build_create_view_statement(
                DatabaseKind::Postgres,
                "public",
                "active_users",
                "SELECT id, email FROM users WHERE active = true;",
                true,
            )
            .unwrap(),
            r#"CREATE OR REPLACE VIEW "public"."active_users" AS
SELECT id, email FROM users WHERE active = true;"#
        );

        assert_eq!(
            build_create_view_statement(
                DatabaseKind::Mysql,
                "app",
                "active_users",
                "WITH scoped AS (SELECT id FROM users) SELECT id FROM scoped",
                false,
            )
            .unwrap(),
            "CREATE VIEW `app`.`active_users` AS\nWITH scoped AS (SELECT id FROM users) SELECT id FROM scoped;"
        );
    }

    #[test]
    fn builds_create_materialized_view_statement_for_postgres() {
        assert_eq!(
            build_create_materialized_view_statement(
                DatabaseKind::Postgres,
                "public",
                "active_users_mv",
                "SELECT id FROM users WHERE active;",
                true,
            )
            .unwrap(),
            r#"CREATE MATERIALIZED VIEW "public"."active_users_mv" AS
SELECT id FROM users WHERE active
WITH DATA;"#
        );

        assert!(build_create_materialized_view_statement(
            DatabaseKind::Mysql,
            "app",
            "active_users_mv",
            "SELECT id FROM users",
            true,
        )
        .is_err());
    }

    #[test]
    fn rejects_unsafe_create_view_input() {
        assert!(build_create_view_statement(
            DatabaseKind::Postgres,
            "public",
            "bad_view",
            "DROP TABLE users",
            false,
        )
        .is_err());

        assert!(build_create_view_statement(
            DatabaseKind::Mysql,
            "app",
            "bad_view",
            "SELECT * FROM users; DROP TABLE users",
            false,
        )
        .is_err());

        assert!(build_create_view_statement(
            DatabaseKind::Mysql,
            "app",
            "",
            "SELECT * FROM users",
            false,
        )
        .is_err());
    }

    #[test]
    fn builds_postgres_create_table_with_comment_statements() {
        let statements = build_create_table_statements(
            DatabaseKind::Postgres,
            "public",
            "users",
            &[
                CreateTableColumn {
                    name: "id".to_string(),
                    data_type: "SERIAL".to_string(),
                    length: None,
                    is_primary_key: true,
                    is_not_null: true,
                    is_auto_increment: true,
                    comment: None,
                },
                CreateTableColumn {
                    name: "email".to_string(),
                    data_type: "TEXT".to_string(),
                    length: None,
                    is_primary_key: false,
                    is_not_null: true,
                    is_auto_increment: false,
                    comment: Some("login email".to_string()),
                },
            ],
        )
        .unwrap();

        assert_eq!(statements.len(), 2);
        assert!(statements[0].contains(r#"CREATE TABLE "public"."users""#));
        assert!(statements[0].contains(r#""id" SERIAL NOT NULL"#));
        assert!(statements[0].contains(r#"PRIMARY KEY ("id")"#));
        assert_eq!(
            statements[1],
            r#"COMMENT ON COLUMN "public"."users"."email" IS 'login email';"#
        );
    }

    #[test]
    fn builds_postgres_identity_for_integer_auto_increment_columns() {
        let statements = build_create_table_statements(
            DatabaseKind::Postgres,
            "public",
            "events",
            &[CreateTableColumn {
                name: "id".to_string(),
                data_type: "INTEGER".to_string(),
                length: None,
                is_primary_key: true,
                is_not_null: true,
                is_auto_increment: true,
                comment: None,
            }],
        )
        .unwrap();

        assert!(statements[0].contains(r#""id" INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL"#));
        assert!(statements[0].contains(r#"PRIMARY KEY ("id")"#));
    }

    #[test]
    fn rejects_postgres_auto_increment_for_non_integer_columns() {
        assert!(build_create_table_statements(
            DatabaseKind::Postgres,
            "public",
            "events",
            &[CreateTableColumn {
                name: "slug".to_string(),
                data_type: "TEXT".to_string(),
                length: None,
                is_primary_key: false,
                is_not_null: true,
                is_auto_increment: true,
                comment: None,
            }],
        )
        .is_err());
    }

    #[test]
    fn builds_mysql_add_column_with_inline_comment() {
        let statements = build_add_table_column_statements(
            DatabaseKind::Mysql,
            "app",
            "users",
            &CreateTableColumn {
                name: "nickname".to_string(),
                data_type: "VARCHAR".to_string(),
                length: Some("64".to_string()),
                is_primary_key: false,
                is_not_null: false,
                is_auto_increment: false,
                comment: Some("short display name".to_string()),
            },
        )
        .unwrap();

        assert_eq!(statements.len(), 1);
        assert_eq!(
            statements[0],
            "ALTER TABLE `app`.`users` ADD COLUMN `nickname` VARCHAR(64) COMMENT 'short display name';"
        );
    }

    #[test]
    fn builds_postgres_add_column_with_comment_statement() {
        let statements = build_add_table_column_statements(
            DatabaseKind::Postgres,
            "public",
            "users",
            &CreateTableColumn {
                name: "metadata".to_string(),
                data_type: "JSONB".to_string(),
                length: None,
                is_primary_key: false,
                is_not_null: true,
                is_auto_increment: false,
                comment: Some("opaque app metadata".to_string()),
            },
        )
        .unwrap();

        assert_eq!(
            statements,
            vec![
                r#"ALTER TABLE "public"."users" ADD COLUMN "metadata" JSONB NOT NULL;"#.to_string(),
                r#"COMMENT ON COLUMN "public"."users"."metadata" IS 'opaque app metadata';"#
                    .to_string(),
            ]
        );
    }

    #[test]
    fn builds_drop_column_statement_per_driver() {
        assert_eq!(
            build_drop_table_column_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "legacy",
                true
            )
            .unwrap(),
            r#"ALTER TABLE "public"."users" DROP COLUMN "legacy" CASCADE;"#
        );
        assert_eq!(
            build_drop_table_column_statement(DatabaseKind::Mysql, "app", "users", "legacy", true)
                .unwrap(),
            "ALTER TABLE `app`.`users` DROP COLUMN `legacy`;"
        );
    }

    #[test]
    fn builds_rename_column_statement_with_existing_columns() {
        let columns = column_lookup(vec![
            ColumnInfo {
                name: "email".to_string(),
                data_type: "text".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "name".to_string(),
                data_type: "text".to_string(),
                is_nullable: true,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
        ]);

        assert_eq!(
            build_rename_table_column_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "email",
                "login_email",
                &columns,
            )
            .unwrap(),
            r#"ALTER TABLE "public"."users" RENAME COLUMN "email" TO "login_email";"#
        );
        assert!(build_rename_table_column_statement(
            DatabaseKind::Mysql,
            "app",
            "users",
            "email",
            "name",
            &columns,
        )
        .is_err());
    }

    #[test]
    fn builds_postgres_alter_column_statements() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "email".to_string(),
            data_type: "text".to_string(),
            is_nullable: true,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        let statements = build_alter_table_column_statements(
            DatabaseKind::Postgres,
            "public",
            "users",
            &AlterTableColumn {
                name: "email".to_string(),
                data_type: Some("VARCHAR".to_string()),
                length: Some("320".to_string()),
                is_not_null: Some(true),
                default_mode: Some(AlterColumnValueMode::Set),
                default_value: Some("'unknown@example.com'".to_string()),
                comment_mode: Some(AlterColumnValueMode::Set),
                comment: Some("login email".to_string()),
            },
            &columns,
        )
        .unwrap();

        assert_eq!(
            statements,
            vec![
                r#"ALTER TABLE "public"."users" ALTER COLUMN "email" TYPE VARCHAR(320);"#
                    .to_string(),
                r#"ALTER TABLE "public"."users" ALTER COLUMN "email" SET NOT NULL;"#
                    .to_string(),
                r#"ALTER TABLE "public"."users" ALTER COLUMN "email" SET DEFAULT 'unknown@example.com';"#
                    .to_string(),
                r#"COMMENT ON COLUMN "public"."users"."email" IS 'login email';"#.to_string(),
            ]
        );
    }

    #[test]
    fn builds_mysql_alter_column_preserving_definition() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "id".to_string(),
            data_type: "int unsigned".to_string(),
            is_nullable: false,
            is_primary_key: true,
            is_unique: true,
            is_indexed: true,
            default_value: None,
            is_auto_increment: true,
            comment: Some("identifier".to_string()),
        }]);

        let statements = build_alter_table_column_statements(
            DatabaseKind::Mysql,
            "app",
            "users",
            &AlterTableColumn {
                name: "id".to_string(),
                data_type: Some("BIGINT".to_string()),
                length: None,
                is_not_null: Some(true),
                default_mode: Some(AlterColumnValueMode::Keep),
                default_value: None,
                comment_mode: Some(AlterColumnValueMode::Set),
                comment: Some("stable identifier".to_string()),
            },
            &columns,
        )
        .unwrap();

        assert_eq!(
            statements,
            vec![
                "ALTER TABLE `app`.`users` MODIFY COLUMN `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT 'stable identifier';".to_string()
            ]
        );
    }

    #[test]
    fn builds_create_index_statement_with_existing_columns() {
        let columns = column_lookup(vec![
            ColumnInfo {
                name: "email".to_string(),
                data_type: "text".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "tenant_id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
        ]);

        assert_eq!(
            build_create_table_index_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "users_email_idx",
                &["email".to_string()],
                &columns,
                true,
            )
            .unwrap(),
            r#"CREATE UNIQUE INDEX "users_email_idx" ON "public"."users" ("email");"#
        );
        assert_eq!(
            build_create_table_index_statement(
                DatabaseKind::Mysql,
                "app",
                "users",
                "users_tenant_email_idx",
                &["tenant_id".to_string(), "email".to_string()],
                &columns,
                false,
            )
            .unwrap(),
            "CREATE INDEX `users_tenant_email_idx` ON `app`.`users` (`tenant_id`, `email`);"
        );
    }

    #[test]
    fn rejects_create_index_for_unknown_columns() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "email".to_string(),
            data_type: "text".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert!(build_create_table_index_statement(
            DatabaseKind::Postgres,
            "public",
            "users",
            "users_missing_idx",
            &["missing".to_string()],
            &columns,
            false,
        )
        .is_err());
    }

    #[test]
    fn builds_drop_index_statement_per_driver() {
        assert_eq!(
            build_drop_table_index_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "users_email_idx"
            )
            .unwrap(),
            r#"DROP INDEX "public"."users_email_idx";"#
        );
        assert_eq!(
            build_drop_table_index_statement(
                DatabaseKind::Mysql,
                "app",
                "users",
                "users_email_idx"
            )
            .unwrap(),
            "DROP INDEX `users_email_idx` ON `app`.`users`;"
        );
        assert!(
            build_drop_table_index_statement(DatabaseKind::Mysql, "app", "users", "PRIMARY")
                .is_err()
        );
    }

    #[test]
    fn builds_rename_index_statement_per_driver() {
        let indexes = vec![
            IndexInfo {
                name: "users_email_idx".to_string(),
                columns: vec!["email".to_string()],
                is_unique: false,
                is_primary: false,
                index_type: Some("btree".to_string()),
                definition: None,
            },
            IndexInfo {
                name: "users_pkey".to_string(),
                columns: vec!["id".to_string()],
                is_unique: true,
                is_primary: true,
                index_type: Some("btree".to_string()),
                definition: None,
            },
        ];

        assert_eq!(
            build_rename_table_index_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "users_email_idx",
                "users_login_email_idx",
                &indexes,
            )
            .unwrap(),
            r#"ALTER INDEX "public"."users_email_idx" RENAME TO "users_login_email_idx";"#
        );
        assert_eq!(
            build_rename_table_index_statement(
                DatabaseKind::Mysql,
                "app",
                "users",
                "users_email_idx",
                "users_login_email_idx",
                &indexes,
            )
            .unwrap(),
            "ALTER TABLE `app`.`users` RENAME INDEX `users_email_idx` TO `users_login_email_idx`;"
        );
        assert!(build_rename_table_index_statement(
            DatabaseKind::Postgres,
            "public",
            "users",
            "users_pkey",
            "users_id_idx",
            &indexes,
        )
        .is_err());
    }

    #[test]
    fn builds_unique_constraint_statement_with_existing_columns() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "email".to_string(),
            data_type: "text".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert_eq!(
            build_create_unique_constraint_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "users_email_key",
                &["email".to_string()],
                &columns,
            )
            .unwrap(),
            r#"ALTER TABLE "public"."users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");"#
        );
    }

    #[test]
    fn builds_primary_key_constraint_statement_with_existing_columns() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert_eq!(
            build_create_primary_key_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "users_pkey",
                &["id".to_string()],
                &columns,
            )
            .unwrap(),
            r#"ALTER TABLE "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");"#
        );
    }

    #[test]
    fn rejects_primary_key_constraint_on_nullable_columns() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: true,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert!(build_create_primary_key_statement(
            DatabaseKind::Mysql,
            "app",
            "users",
            "users_pkey",
            &["id".to_string()],
            &columns,
        )
        .is_err());
    }

    #[test]
    fn builds_check_constraint_statement() {
        assert_eq!(
            build_create_check_constraint_statement(
                DatabaseKind::Mysql,
                "app",
                "orders",
                "orders_amount_check",
                "amount >= 0",
            )
            .unwrap(),
            "ALTER TABLE `app`.`orders` ADD CONSTRAINT `orders_amount_check` CHECK (amount >= 0);"
        );
        assert!(build_create_check_constraint_statement(
            DatabaseKind::Postgres,
            "public",
            "orders",
            "bad_check",
            "amount >= 0; DROP TABLE orders",
        )
        .is_err());
    }

    #[test]
    fn builds_foreign_key_statement_with_referential_actions() {
        let local_columns = column_lookup(vec![ColumnInfo {
            name: "user_id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);
        let referenced_columns = column_lookup(vec![ColumnInfo {
            name: "id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: true,
            is_unique: true,
            is_indexed: true,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert_eq!(
            build_create_foreign_key_statement(
                DatabaseKind::Mysql,
                "app",
                "orders",
                "orders_user_id_fkey",
                &["user_id".to_string()],
                &local_columns,
                "app",
                "users",
                &["id".to_string()],
                &referenced_columns,
                Some("cascade"),
                Some("restrict"),
            )
            .unwrap(),
            "ALTER TABLE `app`.`orders` ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `app`.`users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT;"
        );
        assert!(build_create_foreign_key_statement(
            DatabaseKind::Postgres,
            "public",
            "orders",
            "orders_bad_fkey",
            &["user_id".to_string()],
            &local_columns,
            "public",
            "users",
            &["id".to_string(), "email".to_string()],
            &referenced_columns,
            None,
            None,
        )
        .is_err());
    }

    #[test]
    fn builds_drop_constraint_statement_per_driver() {
        let foreign_key = ConstraintInfo {
            name: "orders_user_id_fkey".to_string(),
            constraint_type: "FOREIGN KEY".to_string(),
            columns: vec!["user_id".to_string()],
            referenced_schema: Some("public".to_string()),
            referenced_table: Some("users".to_string()),
            referenced_columns: vec!["id".to_string()],
            definition: None,
        };
        let unique = ConstraintInfo {
            name: "users_email_key".to_string(),
            constraint_type: "UNIQUE".to_string(),
            columns: vec!["email".to_string()],
            referenced_schema: None,
            referenced_table: None,
            referenced_columns: vec![],
            definition: None,
        };
        let primary = ConstraintInfo {
            name: "users_pkey".to_string(),
            constraint_type: "PRIMARY KEY".to_string(),
            columns: vec!["id".to_string()],
            referenced_schema: None,
            referenced_table: None,
            referenced_columns: vec![],
            definition: None,
        };

        assert_eq!(
            build_drop_table_constraint_statement(
                DatabaseKind::Postgres,
                "public",
                "orders",
                &foreign_key
            )
            .unwrap(),
            r#"ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_user_id_fkey";"#
        );
        assert_eq!(
            build_drop_table_constraint_statement(
                DatabaseKind::Mysql,
                "app",
                "orders",
                &foreign_key
            )
            .unwrap(),
            "ALTER TABLE `app`.`orders` DROP FOREIGN KEY `orders_user_id_fkey`;"
        );
        assert_eq!(
            build_drop_table_constraint_statement(DatabaseKind::Mysql, "app", "users", &unique)
                .unwrap(),
            "ALTER TABLE `app`.`users` DROP INDEX `users_email_key`;"
        );
        assert_eq!(
            build_drop_table_constraint_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                &primary
            )
            .unwrap(),
            r#"ALTER TABLE "public"."users" DROP CONSTRAINT "users_pkey";"#
        );
        assert_eq!(
            build_drop_table_constraint_statement(DatabaseKind::Mysql, "app", "users", &primary)
                .unwrap(),
            "ALTER TABLE `app`.`users` DROP PRIMARY KEY;"
        );
    }

    #[test]
    fn sqlite_uses_the_bounded_ansi_data_grid_path() {
        assert_eq!(
            table_data_dialect("sqlite").unwrap(),
            DatabaseKind::Postgres
        );
        assert_eq!(
            table_data_dialect("sqlite3").unwrap(),
            DatabaseKind::Postgres
        );
        assert_eq!(
            table_data_dialect("duckdb").unwrap(),
            DatabaseKind::Postgres
        );
        assert!(table_data_dialect("unsupported").is_err());
    }

    #[test]
    fn external_driver_aliases_cannot_receive_host_generated_table_ddl() {
        let capabilities = crate::core::dialect::DatabaseKind::Postgres.capabilities();
        assert!(ensure_host_table_ddl_capability(None, "creation").is_ok());
        assert_eq!(
            ensure_host_table_ddl_capability(Some(&capabilities), "column alteration").unwrap_err(),
            "PostgreSQL does not provide a verified semantic table column alteration operation"
        );
    }

    #[test]
    fn external_table_data_capabilities_do_not_widen_a_driver_alias() {
        let mut capabilities = DatabaseKind::Postgres.capabilities();
        capabilities.display_name = "Restricted PostgreSQL package".to_string();
        capabilities.supports_table_row_mutation = false;

        assert_eq!(
            reviewed_table_data_dialect(&capabilities, false).unwrap(),
            DatabaseKind::Postgres
        );
        assert!(reviewed_table_data_dialect(&capabilities, true)
            .unwrap_err()
            .contains("row-mutation"));
        capabilities.lsp_language_id = "sql".to_string();
        assert!(reviewed_table_data_dialect(&capabilities, false)
            .unwrap_err()
            .contains("reviewed table SQL dialect"));
    }

    #[test]
    fn sqlite_table_ddl_builders_use_native_syntax_and_guard_unsupported_forms() {
        let id = CreateTableColumn {
            name: "id".to_string(),
            data_type: "INTEGER".to_string(),
            length: None,
            is_primary_key: true,
            is_not_null: true,
            is_auto_increment: true,
            comment: None,
        };
        let email = CreateTableColumn {
            name: "email".to_string(),
            data_type: "TEXT".to_string(),
            length: None,
            is_primary_key: false,
            is_not_null: true,
            is_auto_increment: false,
            comment: None,
        };
        assert_eq!(
            build_sqlite_create_table_statements("main", "users", &[id.clone(), email.clone()])
                .unwrap(),
            vec![
                "CREATE TABLE \"main\".\"users\" (\n  \"id\" INTEGER PRIMARY KEY AUTOINCREMENT,\n  \"email\" TEXT NOT NULL\n);"
                    .to_string(),
            ],
        );
        assert_eq!(
            build_sqlite_add_column_statements("main", "users", &email).unwrap(),
            vec!["ALTER TABLE \"main\".\"users\" ADD COLUMN \"email\" TEXT NOT NULL;".to_string()],
        );
        assert_eq!(
            build_sqlite_drop_column_statement("main", "users", "legacy").unwrap(),
            "ALTER TABLE \"main\".\"users\" DROP COLUMN \"legacy\";"
        );
        let columns = column_lookup(vec![ColumnInfo {
            name: "email".to_string(),
            data_type: "TEXT".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);
        assert_eq!(
            build_sqlite_create_index_statement(
                "main",
                "users",
                "users_email_idx",
                &["email".to_string()],
                &columns,
                true,
            )
            .unwrap(),
            "CREATE UNIQUE INDEX \"main\".\"users_email_idx\" ON \"main\".\"users\" (\"email\");"
        );
        assert_eq!(
            build_sqlite_drop_index_statement("main", "users", "users_email_idx").unwrap(),
            "DROP INDEX \"main\".\"users_email_idx\";"
        );

        let invalid_autoincrement = CreateTableColumn {
            data_type: "TEXT".to_string(),
            ..id
        };
        assert!(
            build_sqlite_create_table_statements("main", "bad", &[invalid_autoincrement]).is_err()
        );
    }
}
