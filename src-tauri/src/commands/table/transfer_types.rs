//! Transfer types for table operations.

use super::transfer_runtime::validate_table_data_transfer_id;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::watch;
use tokio::sync::Mutex as AsyncMutex;

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
    /// Keep target column identifiers quoted by default. Disabling this is a
    /// narrowly reviewed compatibility path for GaussDB/openGauss packages,
    /// whose unquoted identifiers fold to lowercase. The Host revalidates the
    /// connected package before honoring `false`.
    #[serde(default = "default_true")]
    pub quote_target_column_names: bool,
    /// Explicitly restore catalog-backed secondary indexes and constraints
    /// after the row copy, in the same target transaction. The preview binds
    /// the exact DDL; external and cross-product drivers remain fail-closed.
    #[serde(default)]
    pub restore_source_schema_objects: bool,
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
    /// Optional non-table schema objects selected from the same source
    /// namespace. These are never inferred from the selected tables.
    #[serde(default)]
    pub objects: Vec<TableDataTransferObjectSelection>,
    #[serde(default = "default_table_data_transfer_mode")]
    pub mode: TableDataTransferMode,
    pub max_rows: Option<u32>,
    pub batch_size: Option<u32>,
    #[serde(default)]
    pub reseed_identity: bool,
    #[serde(default = "default_true")]
    pub quote_target_column_names: bool,
    #[serde(default)]
    pub restore_source_schema_objects: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TableDataTransferObjectKind {
    View,
    MaterializedView,
    Function,
    Procedure,
    Trigger,
    Sequence,
    Event,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferObjectSelection {
    pub object_type: TableDataTransferObjectKind,
    pub name: String,
    /// Required when the database permits duplicate object names below
    /// different parent relations (for example PostgreSQL triggers).
    #[serde(default)]
    pub parent_name: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TableDataTransferObjectAction {
    Create,
    SkipExisting,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferObjectPreflight {
    pub object_type: TableDataTransferObjectKind,
    pub name: String,
    pub parent_name: Option<String>,
    pub action: TableDataTransferObjectAction,
    pub can_execute: bool,
    /// Ordered, catalog-built DDL shown for review. It is empty for skipped
    /// and blocked objects and is bound by `plan_digest` when present.
    #[serde(default)]
    pub statements: Vec<String>,
    pub plan_digest: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    pub warnings: Vec<String>,
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
    /// Explicit non-table selection in executable dependency order. Existing
    /// target objects remain visible as skipped entries and are never replaced.
    #[serde(default)]
    pub object_preflights: Vec<TableDataTransferObjectPreflight>,
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
    /// Exact target-owned PostgreSQL generators reviewed for this table.
    /// Numeric state is preview-only and is never copied into the durable
    /// transfer report.
    #[serde(default)]
    pub identity_reseed_plans: Vec<TableDataTransferIdentityReseedPlan>,
    #[serde(default)]
    pub schema_restore_statements: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferBatchTableResult {
    pub table: String,
    pub rows_transferred: u64,
    pub batches: u64,
    pub limit_reached: bool,
    #[serde(default)]
    pub target_rows_before: Option<u64>,
    /// Exact PostgreSQL generators synchronized by the reviewed table plan.
    #[serde(default)]
    pub identity_reseed_columns: Vec<String>,
    #[serde(default)]
    pub restored_schema_objects: u32,
    /// A terminal, privacy-bounded report is persisted for each object when
    /// the request supplies a project id.
    pub report_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TableDataTransferPostCommitStatus {
    Completed,
    NeedsManualReview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferPostCommitReceipt {
    pub status: TableDataTransferPostCommitStatus,
    pub statements_total: u32,
    pub statements_succeeded: u32,
    /// Privacy-bounded terminal guidance. Database errors and reviewed SQL
    /// are deliberately excluded because MySQL DDL may already be committed.
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferBatchResult {
    pub rows_transferred: u64,
    pub batches: u64,
    pub limit_reached: bool,
    pub tables: Vec<TableDataTransferBatchTableResult>,
    #[serde(default)]
    pub objects: Vec<TableDataTransferObjectResult>,
    /// Present for MySQL-family schema restoration, which runs only after row
    /// commit because ALTER TABLE implicitly commits. A review receipt is
    /// returned instead of pretending the entire operation was transactional.
    #[serde(default)]
    pub post_commit_receipt: Option<TableDataTransferPostCommitReceipt>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferObjectResult {
    pub object_type: TableDataTransferObjectKind,
    pub name: String,
    pub parent_name: Option<String>,
    pub action: TableDataTransferObjectAction,
    #[serde(default)]
    pub report_id: Option<String>,
}

/// Privacy-bounded terminal audit for one explicitly selected schema object.
/// Object DDL and database errors are deliberately excluded.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferObjectReport {
    pub id: String,
    pub project_id: String,
    pub transfer_id: String,
    pub source_connection_id: String,
    pub source_database: Option<String>,
    pub source_schema: String,
    pub target_connection_id: String,
    pub target_database: Option<String>,
    pub target_schema: String,
    pub object_type: TableDataTransferObjectKind,
    pub name: String,
    pub parent_name: Option<String>,
    pub action: TableDataTransferObjectAction,
    pub plan_digest: String,
    pub status: TableDataTransferProgressStatus,
    pub started_at: i64,
    pub finished_at: i64,
    pub error: Option<String>,
}

pub(super) fn default_table_data_transfer_mode() -> TableDataTransferMode {
    TableDataTransferMode::Append
}

pub(super) const fn default_true() -> bool {
    true
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

/// Read-only PostgreSQL generator state captured while building a transfer
/// preview. Sequence identity and ownership are bound into the confirmation
/// token; numeric state is deliberately not persisted after execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferIdentityReseedPlan {
    pub column: String,
    pub sequence_schema: String,
    pub sequence_name: String,
    pub owner_schema: String,
    pub owner_table: String,
    pub owner_column: String,
    pub current_value: Option<String>,
    pub target_max_value: Option<String>,
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
    /// Read-only target count captured for append/overwrite verification.
    pub target_rows_before: Option<u64>,
    pub target_rows_to_delete: Option<u64>,
    /// Exact target primary-key columns used as the conflict identity in
    /// upsert mode. Empty for append and overwrite plans.
    pub upsert_key_columns: Vec<String>,
    /// PostgreSQL target columns whose owned serial/identity generator will
    /// be synchronized inside the same transaction after row writes.
    pub identity_reseed_columns: Vec<String>,
    #[serde(default)]
    pub identity_reseed_plans: Vec<TableDataTransferIdentityReseedPlan>,
    /// Ordered catalog-derived DDL that will run only after all row writes and
    /// identity synchronization have succeeded in the target transaction.
    #[serde(default)]
    pub schema_restore_statements: Vec<String>,
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
    #[serde(default)]
    pub source_auto_increment: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_identity_generation: Option<String>,
    #[serde(default)]
    pub identity_retained: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_identity_generation: Option<String>,
    #[serde(default)]
    pub has_source_default: bool,
    #[serde(default)]
    pub default_retained: bool,
    pub compatibility: TableDataTransferCompatibility,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferTargetPlan {
    pub mapping_profile: String,
    pub columns: Vec<TableDataTransferTargetColumn>,
    pub statements: Vec<String>,
    pub can_execute: bool,
    pub confirmation_token: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataTransferResult {
    pub rows_transferred: u64,
    pub batches: u64,
    pub limit_reached: bool,
    #[serde(default)]
    pub target_rows_before: Option<u64>,
    pub mapped_columns: Vec<TableDataTransferColumnMapping>,
    /// Exact PostgreSQL generators synchronized by the reviewed plan.
    #[serde(default)]
    pub identity_reseed_columns: Vec<String>,
    #[serde(default)]
    pub restored_schema_objects: u32,
    #[serde(default)]
    pub post_commit_receipt: Option<TableDataTransferPostCommitReceipt>,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum TableDataTransferRetryPolicy {
    #[default]
    FreshPreview,
    ManualReviewRequired,
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
    /// Stores only column identities and a boolean comparison result;
    /// sequence values and copied row values are intentionally omitted.
    #[serde(default)]
    pub identity_reseed_columns: Vec<String>,
    #[serde(default)]
    pub identity_reseed_verified: Option<bool>,
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
    /// Read-only target count captured during the reviewed append/overwrite
    /// plan. This makes an append verification auditable without retaining
    /// any copied values or SQL.
    #[serde(default)]
    pub target_rows_before: Option<u64>,
    pub status: TableDataTransferProgressStatus,
    pub started_at: i64,
    pub finished_at: i64,
    pub error: Option<String>,
    /// Added after the initial report format. Old local reports remain
    /// readable and simply have no post-commit observation.
    #[serde(default)]
    pub verification: Option<TableDataTransferVerification>,
    /// Old reports default to a fresh reviewed preview. A MySQL post-commit
    /// DDL failure permanently disables the convenience retry action until
    /// the user has inspected the target and starts a new transfer manually.
    #[serde(default)]
    pub retry_policy: TableDataTransferRetryPolicy,
    #[serde(default)]
    pub post_commit_receipt: Option<TableDataTransferPostCommitReceipt>,
}

#[derive(Clone)]
pub struct TableDataTransferCancellationHandle {
    pub(super) source_connection_id: String,
    pub(super) sender: watch::Sender<bool>,
}

#[derive(Default)]
pub struct TableDataTransferCancellationState(
    pub(super) Arc<AsyncMutex<HashMap<String, TableDataTransferCancellationHandle>>>,
);

impl TableDataTransferCancellationState {
    pub(super) async fn register(
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

    pub(super) async fn request_cancel(
        &self,
        transfer_id: &str,
    ) -> Option<TableDataTransferCancellationHandle> {
        self.0.lock().await.get(transfer_id).cloned()
    }

    pub(super) async fn take(&self, transfer_id: &str) {
        self.0.lock().await.remove(transfer_id);
    }
}
