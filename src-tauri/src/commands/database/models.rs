use crate::core::{
    dialect::DatabaseCapabilities,
    driver_package::DriverPackageCatalog,
    manager::{ExternalDriverRuntimeReconnectResult, ExternalDriverRuntimeSummary},
};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverInstallation {
    pub driver: String,
    pub display_name: String,
    pub client_library: String,
    pub client_version: String,
    pub distribution: String,
    pub update_policy: String,
    pub independently_updatable: bool,
    pub server_version_policy: String,
    pub implementation: String,
    pub runtime: String,
    pub runtime_ready: Option<bool>,
    pub package_version: Option<String>,
    pub protocol_version: Option<String>,
    pub active: bool,
    pub can_rollback: bool,
    pub status: String,
    pub status_message: Option<String>,
    /// Signed package-owned template for drivers whose connection URL is not
    /// expressible as the generic `scheme://host/database` form.
    pub connection_url_template: Option<String>,
    pub capabilities: Option<DatabaseCapabilities>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverProbeResult {
    pub driver: String,
    pub package_version: String,
    pub protocol_version: String,
    pub supports_metadata: bool,
    pub supports_query: bool,
    pub supports_cancellation: bool,
    pub supports_transactions: bool,
    pub supports_database_scoped_queries: bool,
    pub supports_database_creation: bool,
    /// Effective Data Editor support. This intentionally combines the signed
    /// package contract with the startup-verified transaction runtime.
    pub supports_table_row_mutation: bool,
    /// Effective cross-connection table transfer support. This remains a
    /// separate signal so package verification never conflates Grid editing
    /// with source paging and partial-commit transfer semantics.
    pub supports_table_data_transfer: bool,
    /// Effective Host-owned formats after intersecting the signed declaration
    /// with encoders compiled into this application build.
    pub table_export_formats: Vec<String>,
    /// External Agent connections may receive credentials only when this is
    /// true, because the sidecar independently enforces read-only mode.
    pub supports_agent_read_only_enforcement: bool,
    pub supports_referencing_foreign_keys: bool,
    /// Effective only when the signed package contract and the launched
    /// sidecar handshake both expose the semantic migration protocol.
    pub supports_semantic_schema_migration: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaMigrationCapabilityMode {
    Transactional,
    NonTransactional,
    ReviewOnly,
}

/// Connection-scoped capability contract consumed by editor intelligence,
/// migration review and other feature gates. Unlike the product catalogue,
/// this describes the exact live driver instance and negotiated server.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDatabaseCapabilityContext {
    pub connection_id: String,
    pub driver: String,
    pub distribution: String,
    pub package_version: Option<String>,
    pub server_version: Option<String>,
    pub schema_migration_mode: SchemaMigrationCapabilityMode,
    pub capabilities: DatabaseCapabilities,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverCatalog {
    pub catalog: DriverPackageCatalog,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverStoreInfo {
    pub active_path: String,
    pub restart_required: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverRuntimeSummary {
    pub driver: String,
    pub package_version: String,
    pub connection_count: usize,
    pub process_ids: Vec<u32>,
    pub unavailable_process_count: usize,
    pub unhealthy_connection_count: usize,
    pub launch_count: u64,
    pub observed_exit_count: u64,
    pub last_started_at_millis: Option<u64>,
    pub last_exit_observed_at_millis: Option<u64>,
    pub reconnect_attempt_count: u64,
    pub reconnect_success_count: u64,
    pub reconnect_failure_count: u64,
    pub reconnect_budget_block_count: u64,
    pub reconnect_available: bool,
    pub reconnect_blocked_connection_count: usize,
    pub last_event_code: Option<String>,
    pub last_event_at_millis: Option<u64>,
    pub last_reconnect_at_millis: Option<u64>,
}

impl From<ExternalDriverRuntimeSummary> for DatabaseDriverRuntimeSummary {
    fn from(value: ExternalDriverRuntimeSummary) -> Self {
        Self {
            driver: value.driver,
            package_version: value.package_version,
            connection_count: value.connection_count,
            process_ids: value.process_ids,
            unavailable_process_count: value.unavailable_process_count,
            unhealthy_connection_count: value.unhealthy_connection_count,
            launch_count: value.launch_count,
            observed_exit_count: value.observed_exit_count,
            last_started_at_millis: value.last_started_at_millis,
            last_exit_observed_at_millis: value.last_exit_observed_at_millis,
            reconnect_attempt_count: value.reconnect_attempt_count,
            reconnect_success_count: value.reconnect_success_count,
            reconnect_failure_count: value.reconnect_failure_count,
            reconnect_budget_block_count: value.reconnect_budget_block_count,
            reconnect_available: value.reconnect_available,
            reconnect_blocked_connection_count: value.reconnect_blocked_connection_count,
            last_event_code: value.last_event_code,
            last_event_at_millis: value.last_event_at_millis,
            last_reconnect_at_millis: value.last_reconnect_at_millis,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverRuntimeReconnectResult {
    pub driver: String,
    pub package_version: String,
    pub reason: String,
    pub matched_connection_count: usize,
    pub attempted_count: usize,
    pub reconnected_count: usize,
    pub failed_count: usize,
    pub budget_blocked_count: usize,
}

impl From<ExternalDriverRuntimeReconnectResult> for DatabaseDriverRuntimeReconnectResult {
    fn from(value: ExternalDriverRuntimeReconnectResult) -> Self {
        Self {
            driver: value.driver,
            package_version: value.package_version,
            reason: value.reason,
            matched_connection_count: value.matched_connection_count,
            attempted_count: value.attempted_count,
            reconnected_count: value.reconnected_count,
            failed_count: value.failed_count,
            budget_blocked_count: value.budget_blocked_count,
        }
    }
}
