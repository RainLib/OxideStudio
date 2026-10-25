use crate::core::{
    dialect::DatabaseCapabilities, driver::DatabaseDriver, ssh::SshTunnel, store::MetaStore,
};
use oxide_driver_protocol::SchemaMigrationMode;
use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

pub(super) const EXTERNAL_RUNTIME_RECONNECT_WINDOW_MS: u64 = 5 * 60 * 1000;
pub(super) const EXTERNAL_RUNTIME_RECONNECT_MAX_ATTEMPTS: usize = 3;
pub(super) const EXTERNAL_RUNTIME_RECONNECT_BATCH_LIMIT: usize = 32;

#[derive(Clone)]
pub struct ConnectionManager {
    pub(super) semantic_context: crate::core::semantic_context::ConnectionSemanticTracker,
    // thread-safe map of active connections
    pub(super) connections: Arc<Mutex<HashMap<String, ManagedConnection>>>,
    // Store active schema per connection
    pub(super) active_schemas: Arc<Mutex<HashMap<String, String>>>,
    /// Process-lifetime, package-level sidecar telemetry. It intentionally
    /// keeps neither connection configuration nor driver output; connection
    /// ids are only transient deduplication keys for observed exits.
    pub(super) external_runtime_telemetry:
        Arc<Mutex<BTreeMap<(String, String), ExternalDriverRuntimeTelemetry>>>,
    pub(super) external_runtime_store: Arc<Mutex<Option<MetaStore>>>,
    pub(super) external_runtime_reconnect_lock: Arc<Mutex<()>>,
}

pub(super) struct ManagedConnection {
    pub(super) semantic_session: String,
    pub(super) driver: Arc<dyn DatabaseDriver>,
    pub(super) ssh_tunnel: Option<SshTunnel>,
    /// The canonical identity supplied by the trusted connection command.
    /// Keeping it next to the live driver lets destructive table workflows
    /// reject a stale or forged UI endpoint instead of trusting its `driver`
    /// string to select SQL quoting and mutation behaviour.
    pub(super) driver_id: Option<String>,
}

/// Read-only summary of connection-owned external driver processes. The
/// manager returns only trusted package identity and OS PIDs; URLs, account
/// names, sidecar stderr, and query text intentionally remain private.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalDriverRuntimeSummary {
    pub driver: String,
    pub package_version: String,
    pub connection_count: usize,
    pub process_ids: Vec<u32>,
    pub unavailable_process_count: usize,
    /// Connections whose owned sidecar has exited while the connection is
    /// still registered. This is aggregated package health only; no runtime
    /// output or connection identity is retained.
    pub unhealthy_connection_count: usize,
    /// Sidecar launches observed while this desktop process has been running.
    pub launch_count: u64,
    /// Distinct registered sidecars observed exited while still connected.
    /// This is not a database failure count and never includes stderr.
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalDriverRuntimeReconnectResult {
    pub driver: String,
    pub package_version: String,
    pub reason: String,
    pub matched_connection_count: usize,
    pub attempted_count: usize,
    pub reconnected_count: usize,
    pub failed_count: usize,
    pub budget_blocked_count: usize,
}

#[derive(Default, Clone)]
pub(super) struct ExternalDriverRuntimeTelemetry {
    pub(super) launch_count: u64,
    pub(super) observed_exit_count: u64,
    pub(super) last_started_at_millis: Option<u64>,
    pub(super) last_exit_observed_at_millis: Option<u64>,
    pub(super) observed_exited_connection_ids: HashSet<String>,
    pub(super) reconnect_attempt_count: u64,
    pub(super) reconnect_success_count: u64,
    pub(super) reconnect_failure_count: u64,
    pub(super) reconnect_budget_block_count: u64,
    pub(super) reconnect_attempts_by_connection: HashMap<String, VecDeque<u64>>,
    pub(super) last_event_code: Option<String>,
    pub(super) last_event_at_millis: Option<u64>,
    pub(super) last_reconnect_at_millis: Option<u64>,
}

/// Immutable capability inputs captured from one concrete live driver.
///
/// Keeping the driver identity, signed package contract and negotiated server
/// version together prevents consumers such as LSP sync and migration review
/// from combining values that belonged to different connection generations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveConnectionCapabilitySnapshot {
    pub driver_id: Option<String>,
    pub managed: bool,
    pub external_driver_id: Option<String>,
    pub package_version: Option<String>,
    pub package_capabilities: Option<DatabaseCapabilities>,
    pub server_version: Option<String>,
    pub semantic_schema_migration_mode: Option<SchemaMigrationMode>,
    pub has_exact_semantic_schema_migration_evidence: bool,
}

pub(super) fn runtime_timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
