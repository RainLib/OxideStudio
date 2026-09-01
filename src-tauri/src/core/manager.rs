use super::protocol::{
    ColumnInfo, ConstraintInfo, DatabaseCreateRequest, ForeignKeyReferenceInfo, FunctionInfo,
    IndexInfo, ParameterizedStatement, QueryParameter,
};
use super::ssh::SshTunnel;
use super::store::{DriverRuntimeEventKind, DriverRuntimeTelemetryRecord, MetaStore};
use super::{
    dialect::DatabaseCapabilities,
    driver::{
        DatabaseDriver, DocumentPageRequest, LocalDatabaseBackupControl, LocalDatabaseFileReceipt,
    },
};
use anyhow::{anyhow, Result};
use oxide_driver_protocol::{
    SchemaMigrationApplyRequest, SchemaMigrationApplyResult, SchemaMigrationMode,
    SchemaMigrationPlanRequest, SchemaMigrationPlanResult, SchemaMigrationPreflightRequest,
    SchemaMigrationPreflightResult, SchemaMigrationVerifyRequest, SchemaMigrationVerifyResult,
};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

const EXTERNAL_RUNTIME_RECONNECT_WINDOW_MS: u64 = 5 * 60 * 1000;
const EXTERNAL_RUNTIME_RECONNECT_MAX_ATTEMPTS: usize = 3;
const EXTERNAL_RUNTIME_RECONNECT_BATCH_LIMIT: usize = 32;

#[derive(Clone)]
pub struct ConnectionManager {
    // thread-safe map of active connections
    connections: Arc<Mutex<HashMap<String, ManagedConnection>>>,
    // Store active schema per connection
    active_schemas: Arc<Mutex<HashMap<String, String>>>,
    /// Process-lifetime, package-level sidecar telemetry. It intentionally
    /// keeps neither connection configuration nor driver output; connection
    /// ids are only transient deduplication keys for observed exits.
    external_runtime_telemetry:
        Arc<Mutex<BTreeMap<(String, String), ExternalDriverRuntimeTelemetry>>>,
    external_runtime_store: Arc<Mutex<Option<MetaStore>>>,
    external_runtime_reconnect_lock: Arc<Mutex<()>>,
}

struct ManagedConnection {
    driver: Arc<dyn DatabaseDriver>,
    ssh_tunnel: Option<SshTunnel>,
    /// The canonical identity supplied by the trusted connection command.
    /// Keeping it next to the live driver lets destructive table workflows
    /// reject a stale or forged UI endpoint instead of trusting its `driver`
    /// string to select SQL quoting and mutation behaviour.
    driver_id: Option<String>,
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
struct ExternalDriverRuntimeTelemetry {
    launch_count: u64,
    observed_exit_count: u64,
    last_started_at_millis: Option<u64>,
    last_exit_observed_at_millis: Option<u64>,
    observed_exited_connection_ids: HashSet<String>,
    reconnect_attempt_count: u64,
    reconnect_success_count: u64,
    reconnect_failure_count: u64,
    reconnect_budget_block_count: u64,
    reconnect_attempts_by_connection: HashMap<String, VecDeque<u64>>,
    last_event_code: Option<String>,
    last_event_at_millis: Option<u64>,
    last_reconnect_at_millis: Option<u64>,
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

fn runtime_timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            active_schemas: Arc::new(Mutex::new(HashMap::new())),
            external_runtime_telemetry: Arc::new(Mutex::new(BTreeMap::new())),
            external_runtime_store: Arc::new(Mutex::new(None)),
            external_runtime_reconnect_lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn set_external_runtime_telemetry_store(&self, store: MetaStore) {
        *self.external_runtime_store.lock().await = Some(store);
    }

    async fn record_persistent_runtime_event(
        &self,
        package_identity: &(String, String),
        event: DriverRuntimeEventKind,
        occurred_at_millis: u64,
    ) {
        let store = self.external_runtime_store.lock().await.clone();
        let Some(store) = store else {
            return;
        };
        if let Err(error) = store
            .record_driver_runtime_event(
                &package_identity.0,
                &package_identity.1,
                event,
                occurred_at_millis,
            )
            .await
        {
            tracing::warn!(
                "Failed to persist sanitized external driver runtime event {}: {}",
                event.as_str(),
                error
            );
        }
    }

    async fn persistent_runtime_telemetry(
        &self,
    ) -> BTreeMap<(String, String), DriverRuntimeTelemetryRecord> {
        let store = self.external_runtime_store.lock().await.clone();
        let Some(store) = store else {
            return BTreeMap::new();
        };
        match store.list_driver_runtime_telemetry().await {
            Ok(records) => records
                .into_iter()
                .map(|record| {
                    (
                        (record.driver.clone(), record.package_version.clone()),
                        record,
                    )
                })
                .collect(),
            Err(error) => {
                tracing::warn!(
                    "Failed to read sanitized external driver runtime telemetry: {}",
                    error
                );
                BTreeMap::new()
            }
        }
    }

    async fn get_driver(&self, id: &str) -> Result<Arc<dyn DatabaseDriver>> {
        let conns = self.connections.lock().await;
        conns
            .get(id)
            .map(|connection| connection.driver.clone())
            .ok_or_else(|| anyhow!("Connection not found: {}", id))
    }

    /// Exact package versions owned by live connections. Cache maintenance
    /// uses this snapshot only as a retention set; it exposes neither
    /// connection ids nor connection configuration.
    pub async fn active_external_driver_package_identities(&self) -> BTreeSet<(String, String)> {
        let connections = self.connections.lock().await;
        connections
            .values()
            .filter_map(|connection| connection.driver.external_package_identity())
            .map(|(driver, version)| (driver.to_string(), version.to_string()))
            .collect()
    }

    async fn record_external_runtime_replacement(
        &self,
        connection_id: &str,
        package_identity: Option<(String, String)>,
    ) {
        let mut telemetry = self.external_runtime_telemetry.lock().await;
        // A reconnect replaces the owned process. Remove the prior transient
        // observation before counting this launch; no connection identity ever
        // leaves this manager-level deduplication set.
        for value in telemetry.values_mut() {
            value.observed_exited_connection_ids.remove(connection_id);
            if package_identity.is_none() {
                value.reconnect_attempts_by_connection.remove(connection_id);
            }
        }
        let Some(package_identity) = package_identity else {
            return;
        };
        let occurred_at = runtime_timestamp_millis();
        let entry = telemetry.entry(package_identity.clone()).or_default();
        entry.launch_count = entry.launch_count.saturating_add(1);
        entry.last_started_at_millis = Some(occurred_at);
        entry.last_event_code = Some(DriverRuntimeEventKind::Launched.as_str().to_string());
        entry.last_event_at_millis = Some(occurred_at);
        drop(telemetry);
        self.record_persistent_runtime_event(
            &package_identity,
            DriverRuntimeEventKind::Launched,
            occurred_at,
        )
        .await;
    }

    async fn claim_external_runtime_reconnect(
        &self,
        package_identity: &(String, String),
        connection_id: &str,
    ) -> bool {
        let occurred_at = runtime_timestamp_millis();
        let event = {
            let mut telemetry = self.external_runtime_telemetry.lock().await;
            let entry = telemetry.entry(package_identity.clone()).or_default();
            let attempts = entry
                .reconnect_attempts_by_connection
                .entry(connection_id.to_string())
                .or_default();
            while attempts.front().is_some_and(|timestamp| {
                occurred_at.saturating_sub(*timestamp) > EXTERNAL_RUNTIME_RECONNECT_WINDOW_MS
            }) {
                attempts.pop_front();
            }
            let event = if attempts.len() >= EXTERNAL_RUNTIME_RECONNECT_MAX_ATTEMPTS {
                entry.reconnect_budget_block_count =
                    entry.reconnect_budget_block_count.saturating_add(1);
                DriverRuntimeEventKind::ReconnectBudgetBlocked
            } else {
                attempts.push_back(occurred_at);
                entry.reconnect_attempt_count = entry.reconnect_attempt_count.saturating_add(1);
                DriverRuntimeEventKind::ReconnectAttempted
            };
            entry.last_event_code = Some(event.as_str().to_string());
            entry.last_event_at_millis = Some(occurred_at);
            entry.last_reconnect_at_millis = Some(occurred_at);
            event
        };
        self.record_persistent_runtime_event(package_identity, event, occurred_at)
            .await;
        event == DriverRuntimeEventKind::ReconnectAttempted
    }

    async fn record_external_runtime_reconnect_outcome(
        &self,
        package_identity: &(String, String),
        succeeded: bool,
    ) {
        let occurred_at = runtime_timestamp_millis();
        let event = if succeeded {
            DriverRuntimeEventKind::ReconnectSucceeded
        } else {
            DriverRuntimeEventKind::ReconnectFailed
        };
        {
            let mut telemetry = self.external_runtime_telemetry.lock().await;
            let entry = telemetry.entry(package_identity.clone()).or_default();
            if succeeded {
                entry.reconnect_success_count = entry.reconnect_success_count.saturating_add(1);
            } else {
                entry.reconnect_failure_count = entry.reconnect_failure_count.saturating_add(1);
            }
            entry.last_event_code = Some(event.as_str().to_string());
            entry.last_event_at_millis = Some(occurred_at);
            entry.last_reconnect_at_millis = Some(occurred_at);
        }
        self.record_persistent_runtime_event(package_identity, event, occurred_at)
            .await;
    }

    pub async fn add_connection(&self, id: String, driver: Box<dyn DatabaseDriver>) {
        if let Err(error) = self.replace_connection(id, driver).await {
            tracing::warn!("Failed to add connection: {}", error);
        }
    }

    async fn remove_connection(&self, id: &str) -> Option<ManagedConnection> {
        let mut conns = self.connections.lock().await;
        let removed = conns.remove(id);
        drop(conns);
        self.clear_schema_context(id).await;
        self.record_external_runtime_replacement(id, None).await;
        removed
    }

    pub async fn replace_connection(
        &self,
        id: String,
        driver: Box<dyn DatabaseDriver>,
    ) -> Result<()> {
        self.replace_connection_with_tunnel(id, driver, None).await
    }

    pub async fn replace_connection_with_tunnel(
        &self,
        id: String,
        driver: Box<dyn DatabaseDriver>,
        ssh_tunnel: Option<SshTunnel>,
    ) -> Result<()> {
        self.replace_connection_with_tunnel_and_driver_id(id, driver, ssh_tunnel, None)
            .await
    }

    pub async fn replace_connection_with_tunnel_and_driver_id(
        &self,
        id: String,
        driver: Box<dyn DatabaseDriver>,
        ssh_tunnel: Option<SshTunnel>,
        driver_id: Option<String>,
    ) -> Result<()> {
        let external_package_identity = driver
            .external_package_identity()
            .map(|(driver, version)| (driver.to_string(), version.to_string()));
        let old_driver = {
            let mut conns = self.connections.lock().await;
            conns.insert(
                id.clone(),
                ManagedConnection {
                    driver: Arc::from(driver),
                    ssh_tunnel,
                    driver_id: driver_id
                        .map(|value| value.trim().to_ascii_lowercase())
                        .filter(|value| !value.is_empty()),
                },
            )
        };

        self.clear_schema_context(&id).await;
        self.record_external_runtime_replacement(&id, external_package_identity)
            .await;

        if let Some(old_driver) = old_driver {
            if let Err(error) = old_driver.driver.disconnect().await {
                tracing::warn!(
                    "Failed to disconnect replaced connection {} after new driver was installed: {}",
                    id,
                    error
                );
            }
            if let Some(tunnel) = old_driver.ssh_tunnel {
                tunnel.shutdown().await;
            }
        }

        Ok(())
    }

    pub async fn disconnect_connection(&self, id: &str) -> Result<()> {
        let mut connection = self
            .remove_connection(id)
            .await
            .ok_or_else(|| anyhow!("Connection not found: {}", id))?;

        let result = connection.driver.disconnect().await;
        if let Some(tunnel) = connection.ssh_tunnel.take() {
            tunnel.shutdown().await;
        }
        result
    }

    pub async fn clear_schema_context(&self, id: &str) {
        let mut schemas = self.active_schemas.lock().await;
        schemas.remove(id);
    }

    pub async fn invalidate_schema(&self, id: &str, schema: &str) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver.invalidate_schema(schema).await?;

        let mut schemas = self.active_schemas.lock().await;
        if schemas.get(id).is_some_and(|active| active == schema) {
            schemas.remove(id);
        }

        Ok(())
    }

    /// Ping a connection to check if it's alive
    pub async fn ping(&self, id: &str) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver.ping().await
    }

    pub async fn backup_local_database(
        &self,
        id: &str,
        destination: &Path,
    ) -> Result<LocalDatabaseFileReceipt> {
        self.get_driver(id)
            .await?
            .backup_local_database(destination)
            .await
    }

    pub async fn backup_local_database_controlled(
        &self,
        id: &str,
        destination: &Path,
        control: &LocalDatabaseBackupControl,
    ) -> Result<LocalDatabaseFileReceipt> {
        self.get_driver(id)
            .await?
            .backup_local_database_controlled(destination, control)
            .await
    }

    pub async fn restore_local_database(
        &self,
        id: &str,
        source: &Path,
    ) -> Result<LocalDatabaseFileReceipt> {
        let receipt = self
            .get_driver(id)
            .await?
            .restore_local_database(source)
            .await?;
        self.clear_schema_context(id).await;
        Ok(receipt)
    }

    pub async fn server_version(&self, id: &str) -> Result<Option<String>> {
        Ok(self.get_driver(id).await?.server_version().await)
    }

    pub async fn external_runtime_process_id(&self, id: &str) -> Result<Option<u32>> {
        Ok(self
            .get_driver(id)
            .await?
            .external_runtime_process_id()
            .await)
    }

    /// Resolve all connection-owned capability inputs from the same live
    /// driver instance. The global connection lock is released before asking
    /// the driver for its negotiated version, so a slow sidecar cannot block
    /// unrelated connections.
    pub async fn capability_snapshot(&self, id: &str) -> Result<LiveConnectionCapabilitySnapshot> {
        let (driver, driver_id) = {
            let connections = self.connections.lock().await;
            let connection = connections
                .get(id)
                .ok_or_else(|| anyhow!("Connection not found: {}", id))?;
            (connection.driver.clone(), connection.driver_id.clone())
        };
        let (external_driver_id, package_version) = driver
            .external_package_identity()
            .map(|(driver, version)| (Some(driver.to_string()), Some(version.to_string())))
            .unwrap_or((None, None));
        let managed = driver.is_managed_data_source();
        let package_capabilities = driver.package_capabilities();
        let server_version = driver.server_version().await;
        let semantic_schema_migration_mode = driver.semantic_schema_migration_mode();
        let has_exact_semantic_schema_migration_evidence =
            driver.has_exact_semantic_schema_migration_evidence(server_version.as_deref());

        Ok(LiveConnectionCapabilitySnapshot {
            driver_id,
            managed,
            external_driver_id,
            package_version,
            package_capabilities,
            server_version,
            semantic_schema_migration_mode,
            has_exact_semantic_schema_migration_evidence,
        })
    }

    pub async fn active_external_driver_connections(
        &self,
        driver_id: &str,
        package_version: &str,
    ) -> usize {
        let connections = self.connections.lock().await;
        connections
            .values()
            .filter(|connection| {
                connection
                    .driver
                    .external_package_identity()
                    .is_some_and(|(driver, version)| {
                        driver == driver_id && version == package_version
                    })
            })
            .count()
    }

    /// A store migration changes where every independently updateable package
    /// is loaded from on the next launch. Do not stage that migration while a
    /// live connection still owns any external sidecar.
    pub async fn active_external_connection_count(&self) -> usize {
        let connections = self.connections.lock().await;
        connections
            .values()
            .filter(|connection| connection.driver.external_package_identity().is_some())
            .count()
    }

    pub async fn reconnect_external_driver_runtimes(
        &self,
        driver: &str,
        package_version: &str,
    ) -> Result<ExternalDriverRuntimeReconnectResult> {
        if !super::driver_package::is_safe_driver_package_token(driver)
            || !super::driver_package::is_safe_driver_package_token(package_version)
        {
            return Err(anyhow!("Invalid external driver package identity"));
        }
        let _reconnect_guard = self.external_runtime_reconnect_lock.lock().await;
        let package_identity = (driver.to_string(), package_version.to_string());
        let candidates = {
            let connections = self.connections.lock().await;
            connections
                .iter()
                .filter_map(|(connection_id, connection)| {
                    connection
                        .driver
                        .external_package_identity()
                        .filter(|identity| identity.0 == driver && identity.1 == package_version)
                        .map(|_| (connection_id.clone(), connection.driver.clone()))
                })
                .collect::<Vec<_>>()
        };
        if candidates.len() > EXTERNAL_RUNTIME_RECONNECT_BATCH_LIMIT {
            return Err(anyhow!(
                "Too many external driver connections require a single reconnect operation"
            ));
        }

        let mut unhealthy = Vec::new();
        for (connection_id, connection) in candidates {
            if matches!(connection.external_runtime_is_healthy().await, Some(false)) {
                unhealthy.push((connection_id, connection));
            }
        }
        let matched_connection_count = unhealthy.len();
        let mut attempted_count = 0usize;
        let mut reconnected_count = 0usize;
        let mut failed_count = 0usize;
        let mut budget_blocked_count = 0usize;
        for (connection_id, connection) in unhealthy {
            if !self
                .claim_external_runtime_reconnect(&package_identity, &connection_id)
                .await
            {
                budget_blocked_count = budget_blocked_count.saturating_add(1);
                continue;
            }
            attempted_count = attempted_count.saturating_add(1);
            let reconnected = matches!(connection.reconnect_external_runtime().await, Ok(true));
            self.record_external_runtime_reconnect_outcome(&package_identity, reconnected)
                .await;
            if reconnected {
                reconnected_count = reconnected_count.saturating_add(1);
                self.record_external_runtime_replacement(
                    &connection_id,
                    Some(package_identity.clone()),
                )
                .await;
            } else {
                failed_count = failed_count.saturating_add(1);
            }
        }
        Ok(ExternalDriverRuntimeReconnectResult {
            driver: driver.to_string(),
            package_version: package_version.to_string(),
            reason: "process-exited".to_string(),
            matched_connection_count,
            attempted_count,
            reconnected_count,
            failed_count,
            budget_blocked_count,
        })
    }

    pub async fn external_driver_runtime_summaries(&self) -> Vec<ExternalDriverRuntimeSummary> {
        let connections = {
            let connections = self.connections.lock().await;
            connections
                .iter()
                .filter_map(|(connection_id, connection)| {
                    let (driver, package_version) =
                        connection.driver.external_package_identity()?;
                    Some((
                        connection_id.clone(),
                        driver.to_string(),
                        package_version.to_string(),
                        connection.driver.clone(),
                    ))
                })
                .collect::<Vec<_>>()
        };

        let mut grouped = BTreeMap::<(String, String), (usize, Vec<u32>, usize, usize)>::new();
        let mut health_observations = Vec::with_capacity(connections.len());
        for (connection_id, driver, package_version, connection) in connections {
            let process_id = connection.external_runtime_process_id().await;
            let is_healthy = connection.external_runtime_is_healthy().await;
            let package_identity = (driver, package_version);
            let entry = grouped
                .entry(package_identity.clone())
                .or_insert((0, Vec::new(), 0, 0));
            entry.0 += 1;
            if let Some(process_id) = process_id {
                if !entry.1.contains(&process_id) {
                    entry.1.push(process_id);
                }
            } else {
                entry.2 += 1;
            }
            if matches!(is_healthy, Some(false)) {
                entry.3 += 1;
            }
            health_observations.push((package_identity, connection_id, is_healthy));
        }

        let mut newly_observed_exits = Vec::new();
        let now = runtime_timestamp_millis();
        let telemetry = {
            let mut telemetry = self.external_runtime_telemetry.lock().await;
            for (package_identity, connection_id, is_healthy) in health_observations {
                let entry = telemetry.entry(package_identity.clone()).or_default();
                if matches!(is_healthy, Some(false)) {
                    if entry.observed_exited_connection_ids.insert(connection_id) {
                        entry.observed_exit_count = entry.observed_exit_count.saturating_add(1);
                        entry.last_exit_observed_at_millis = Some(now);
                        entry.last_event_code =
                            Some(DriverRuntimeEventKind::Exited.as_str().to_string());
                        entry.last_event_at_millis = Some(now);
                        newly_observed_exits.push(package_identity);
                    }
                } else {
                    entry.observed_exited_connection_ids.remove(&connection_id);
                }
            }
            grouped
                .keys()
                .map(|identity| {
                    let entry = telemetry.entry(identity.clone()).or_default();
                    for attempts in entry.reconnect_attempts_by_connection.values_mut() {
                        while attempts.front().is_some_and(|timestamp| {
                            now.saturating_sub(*timestamp) > EXTERNAL_RUNTIME_RECONNECT_WINDOW_MS
                        }) {
                            attempts.pop_front();
                        }
                    }
                    (identity.clone(), entry.clone())
                })
                .collect::<BTreeMap<_, _>>()
        };

        for package_identity in newly_observed_exits {
            self.record_persistent_runtime_event(
                &package_identity,
                DriverRuntimeEventKind::Exited,
                now,
            )
            .await;
        }
        let persistent = self.persistent_runtime_telemetry().await;

        grouped
            .into_iter()
            .map(
                |(
                    (driver, package_version),
                    (
                        connection_count,
                        mut process_ids,
                        unavailable_process_count,
                        unhealthy_connection_count,
                    ),
                )| {
                    process_ids.sort_unstable();
                    let identity = (driver.clone(), package_version.clone());
                    let process = telemetry.get(&identity).cloned().unwrap_or_default();
                    let persisted = persistent.get(&identity);
                    let reconnect_blocked_connection_count = process
                        .observed_exited_connection_ids
                        .iter()
                        .filter(|connection_id| {
                            process
                                .reconnect_attempts_by_connection
                                .get(*connection_id)
                                .is_some_and(|attempts| {
                                    attempts.len() >= EXTERNAL_RUNTIME_RECONNECT_MAX_ATTEMPTS
                                })
                        })
                        .count();
                    ExternalDriverRuntimeSummary {
                        driver,
                        package_version,
                        connection_count,
                        process_ids,
                        unavailable_process_count,
                        unhealthy_connection_count,
                        launch_count: persisted
                            .map(|record| record.launch_count)
                            .unwrap_or(process.launch_count),
                        observed_exit_count: persisted
                            .map(|record| record.observed_exit_count)
                            .unwrap_or(process.observed_exit_count),
                        last_started_at_millis: persisted
                            .and_then(|record| record.last_started_at_millis)
                            .or(process.last_started_at_millis),
                        last_exit_observed_at_millis: persisted
                            .and_then(|record| record.last_exit_observed_at_millis)
                            .or(process.last_exit_observed_at_millis),
                        reconnect_attempt_count: persisted
                            .map(|record| record.reconnect_attempt_count)
                            .unwrap_or(process.reconnect_attempt_count),
                        reconnect_success_count: persisted
                            .map(|record| record.reconnect_success_count)
                            .unwrap_or(process.reconnect_success_count),
                        reconnect_failure_count: persisted
                            .map(|record| record.reconnect_failure_count)
                            .unwrap_or(process.reconnect_failure_count),
                        reconnect_budget_block_count: persisted
                            .map(|record| record.reconnect_budget_block_count)
                            .unwrap_or(process.reconnect_budget_block_count),
                        reconnect_available: unhealthy_connection_count
                            > reconnect_blocked_connection_count,
                        reconnect_blocked_connection_count,
                        last_event_code: persisted
                            .map(|record| record.last_event_code.clone())
                            .or(process.last_event_code),
                        last_event_at_millis: persisted
                            .map(|record| record.last_event_at_millis)
                            .or(process.last_event_at_millis),
                        last_reconnect_at_millis: persisted
                            .and_then(|record| record.last_reconnect_at_millis)
                            .or(process.last_reconnect_at_millis),
                    }
                },
            )
            .collect()
    }

    pub async fn statement_scan_dialect(
        &self,
        id: &str,
    ) -> Result<Option<super::statement::StatementScanDialect>> {
        Ok(self.get_driver(id).await?.statement_scan_dialect())
    }

    /// Returns the verified external-package capability contract for the live
    /// connection. Native drivers intentionally return `None`: their contract
    /// lives in the bundled dialect registry.
    pub async fn package_capabilities(&self, id: &str) -> Result<Option<DatabaseCapabilities>> {
        Ok(self.get_driver(id).await?.package_capabilities())
    }

    pub async fn semantic_schema_migration_mode(
        &self,
        id: &str,
    ) -> Result<Option<SchemaMigrationMode>> {
        Ok(self.get_driver(id).await?.semantic_schema_migration_mode())
    }

    /// Whether the live connection is owned by an independently installed
    /// package. Mutation planners use this boundary when a newer semantic
    /// operation has not yet been added to the signed sidecar protocol.
    pub async fn is_external_driver_connection(&self, id: &str) -> Result<bool> {
        Ok(self
            .get_driver(id)
            .await?
            .external_package_identity()
            .is_some())
    }

    /// Identity captured when the connection was opened through the desktop
    /// command. Test/legacy callers can intentionally omit it and retain the
    /// previous compatibility behaviour.
    pub async fn connection_driver_id(&self, id: &str) -> Result<Option<String>> {
        let connections = self.connections.lock().await;
        connections
            .get(id)
            .map(|connection| connection.driver_id.clone())
            .ok_or_else(|| anyhow!("Connection not found: {}", id))
    }

    /// Execute a query
    pub async fn query(
        &self,
        id: &str,
        sql: &str,
        query_schema: Option<String>,
        transaction_id: Option<String>,
        query_id: Option<String>,
    ) -> Result<Vec<super::protocol::QueryResult>> {
        let driver = self.get_driver(id).await?;
        let query_id = query_id.as_deref();
        if let Some(transaction_id) =
            transaction_id.filter(|transaction_id| !transaction_id.trim().is_empty())
        {
            return driver
                .query_transaction_tracked(query_id, &transaction_id, sql)
                .await;
        }

        // Priority: 1. Explicit schema, 2. Active schema for session, 3. Default
        if let Some(schema) = query_schema {
            driver
                .query_with_context_tracked(query_id, sql, &schema)
                .await
        } else {
            let schema = {
                let schemas = self.active_schemas.lock().await;
                schemas.get(id).cloned()
            };
            if let Some(schema) = schema {
                driver
                    .query_with_context_tracked(query_id, sql, &schema)
                    .await
            } else {
                driver.query_tracked(query_id, sql).await
            }
        }
    }

    pub async fn cancel_query(&self, id: &str, query_id: &str) -> Result<bool> {
        let driver = self.get_driver(id).await?;
        driver.cancel_query(query_id).await
    }

    pub async fn execute_parameterized(
        &self,
        id: &str,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<u64> {
        let driver = self.get_driver(id).await?;
        driver.execute_parameterized(sql, params).await
    }

    pub async fn create_database(&self, id: &str, request: DatabaseCreateRequest) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver.create_database(request).await
    }

    pub async fn plan_schema_migration(
        &self,
        id: &str,
        request: SchemaMigrationPlanRequest,
    ) -> Result<SchemaMigrationPlanResult> {
        self.get_driver(id)
            .await?
            .plan_schema_migration(request)
            .await
    }

    pub async fn preflight_schema_migration(
        &self,
        id: &str,
        request: SchemaMigrationPreflightRequest,
    ) -> Result<SchemaMigrationPreflightResult> {
        self.get_driver(id)
            .await?
            .preflight_schema_migration(request)
            .await
    }

    pub async fn apply_schema_migration(
        &self,
        id: &str,
        request: SchemaMigrationApplyRequest,
    ) -> Result<SchemaMigrationApplyResult> {
        self.get_driver(id)
            .await?
            .apply_schema_migration(request)
            .await
    }

    pub async fn verify_schema_migration(
        &self,
        id: &str,
        request: SchemaMigrationVerifyRequest,
    ) -> Result<SchemaMigrationVerifyResult> {
        self.get_driver(id)
            .await?
            .verify_schema_migration(request)
            .await
    }

    pub async fn query_parameterized(
        &self,
        id: &str,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<super::protocol::QueryResult>> {
        let driver = self.get_driver(id).await?;
        driver.query_parameterized(sql, params).await
    }

    /// Execute a query against one explicitly selected server database. This
    /// bypasses the connection's primary database and active schema context.
    pub async fn query_database(
        &self,
        id: &str,
        database: &str,
        sql: &str,
    ) -> Result<Vec<super::protocol::QueryResult>> {
        let driver = self.get_driver(id).await?;
        driver.query_database(database, sql).await
    }

    pub async fn query_database_with_context(
        &self,
        id: &str,
        database: &str,
        sql: &str,
        schema: Option<&str>,
        query_id: Option<&str>,
    ) -> Result<Vec<super::protocol::QueryResult>> {
        let driver = self.get_driver(id).await?;
        driver
            .query_database_with_context_tracked(query_id, database, sql, schema)
            .await
    }

    pub async fn query_database_parameterized(
        &self,
        id: &str,
        database: &str,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<super::protocol::QueryResult>> {
        let driver = self.get_driver(id).await?;
        driver
            .query_database_parameterized(database, sql, params)
            .await
    }

    pub async fn execute_parameterized_batch(
        &self,
        id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let driver = self.get_driver(id).await?;
        driver.execute_parameterized_batch(statements).await
    }

    pub async fn execute_sqlite_rebuild_batch(
        &self,
        id: &str,
        statements: &[ParameterizedStatement],
        backup_destination: &std::path::Path,
    ) -> Result<super::driver::SqliteRebuildReceipt> {
        let driver = self.get_driver(id).await?;
        driver
            .execute_sqlite_rebuild_batch(statements, backup_destination)
            .await
    }

    pub async fn execute_database_parameterized_batch(
        &self,
        id: &str,
        database: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let driver = self.get_driver(id).await?;
        driver
            .execute_database_parameterized_batch(database, statements)
            .await
    }

    pub async fn begin_transaction(
        &self,
        id: &str,
        transaction_id: &str,
        schema: Option<String>,
    ) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver
            .begin_transaction(transaction_id, schema.as_deref())
            .await
    }

    pub async fn begin_database_transaction(
        &self,
        id: &str,
        transaction_id: &str,
        database: &str,
        schema: Option<String>,
    ) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver
            .begin_database_transaction(transaction_id, database, schema.as_deref())
            .await
    }

    pub async fn execute_parameterized_transaction(
        &self,
        id: &str,
        transaction_id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let driver = self.get_driver(id).await?;
        driver
            .execute_parameterized_transaction(transaction_id, statements)
            .await
    }

    pub async fn commit_transaction(&self, id: &str, transaction_id: &str) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver.commit_transaction(transaction_id).await
    }

    pub async fn rollback_transaction(&self, id: &str, transaction_id: &str) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver.rollback_transaction(transaction_id).await
    }

    /// Get databases visible from the connected server.
    pub async fn get_databases(&self, id: &str) -> Result<Vec<String>> {
        let driver = self.get_driver(id).await?;
        driver.get_databases().await
    }

    pub async fn get_database_metadata(
        &self,
        id: &str,
    ) -> Result<Vec<super::protocol::DatabaseInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_database_metadata().await
    }

    /// Get schemas in the currently connected database.
    pub async fn get_schemas(&self, id: &str) -> Result<Vec<String>> {
        let driver = self.get_driver(id).await?;
        driver.get_schemas().await
    }

    /// Get schemas from an explicitly selected database without changing the
    /// connection's active query/schema context.
    pub async fn get_database_schemas(&self, id: &str, database: &str) -> Result<Vec<String>> {
        let driver = self.get_driver(id).await?;
        driver.get_database_schemas(database).await
    }

    /// Get read-only non-relation object descriptors from an explicitly
    /// selected database without changing the active query database.
    pub async fn get_database_schema_objects(
        &self,
        id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<super::protocol::SchemaObjectInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_database_schema_objects(database, schema).await
    }

    /// Get tables
    pub async fn get_tables(
        &self,
        id: &str,
        schema: &str,
    ) -> Result<Vec<super::protocol::TableInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_tables(schema).await
    }

    pub async fn get_database_tables(
        &self,
        id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<super::protocol::TableInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_database_tables(database, schema).await
    }

    /// Read-only descriptors for schema objects that are not tables/views.
    /// The driver remains the authority for which kinds it can expose.
    pub async fn get_schema_objects(
        &self,
        id: &str,
        schema: &str,
    ) -> Result<Vec<super::protocol::SchemaObjectInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_schema_objects(schema).await
    }

    /// Read-only lazy descriptor members. The driver remains authoritative
    /// for whether an object kind is expandable.
    pub async fn get_schema_object_members(
        &self,
        id: &str,
        schema: &str,
        object_name: &str,
        object_type: &str,
    ) -> Result<Vec<super::protocol::SchemaObjectInfo>> {
        let driver = self.get_driver(id).await?;
        driver
            .get_schema_object_members(schema, object_name, object_type)
            .await
    }

    pub async fn get_database_schema_object_members(
        &self,
        id: &str,
        database: &str,
        schema: &str,
        object_name: &str,
        object_type: &str,
    ) -> Result<Vec<super::protocol::SchemaObjectInfo>> {
        let driver = self.get_driver(id).await?;
        driver
            .get_database_schema_object_members(database, schema, object_name, object_type)
            .await
    }

    pub async fn get_collections(
        &self,
        id: &str,
        namespace: &str,
    ) -> Result<Vec<super::protocol::CollectionInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_collections(namespace).await
    }

    pub async fn get_collections_page(
        &self,
        id: &str,
        namespace: &str,
        cursor: Option<&str>,
        limit: usize,
        filter: Option<&str>,
    ) -> Result<super::protocol::CollectionPage> {
        let driver = self.get_driver(id).await?;
        driver
            .get_collections_page(namespace, cursor, limit, filter)
            .await
    }

    pub async fn get_document_page(
        &self,
        id: &str,
        request: DocumentPageRequest<'_>,
    ) -> Result<super::protocol::DocumentPage> {
        let driver = self.get_driver(id).await?;
        driver.get_document_page(request).await
    }

    pub async fn prepare_document_clone(
        &self,
        id: &str,
        request: super::driver::DocumentCloneRequest<'_>,
    ) -> Result<super::driver::PreparedDocumentClone> {
        let driver = self.get_driver(id).await?;
        driver.prepare_document_clone(request).await
    }

    pub async fn execute_document_clone(
        &self,
        id: &str,
        request: super::driver::DocumentCloneRequest<'_>,
        expected_source_digest: &str,
    ) -> Result<super::driver::DocumentCloneReceipt> {
        let driver = self.get_driver(id).await?;
        driver
            .execute_document_clone(request, expected_source_digest)
            .await
    }

    pub async fn prepare_document_edit(
        &self,
        connection_id: &str,
        request: super::driver::DocumentEditRequest<'_>,
    ) -> Result<super::driver::PreparedDocumentEdit> {
        let driver = self.get_driver(connection_id).await?;
        driver.prepare_document_edit(request).await
    }

    pub async fn execute_document_edit(
        &self,
        connection_id: &str,
        request: super::driver::DocumentEditRequest<'_>,
        expected_source_digest: &str,
    ) -> Result<super::driver::DocumentEditReceipt> {
        let driver = self.get_driver(connection_id).await?;
        driver
            .execute_document_edit(request, expected_source_digest)
            .await
    }

    pub async fn prepare_document_delete(
        &self,
        connection_id: &str,
        request: super::driver::DocumentDeleteRequest<'_>,
    ) -> Result<super::driver::PreparedDocumentDelete> {
        let driver = self.get_driver(connection_id).await?;
        driver.prepare_document_delete(request).await
    }

    pub async fn execute_document_delete(
        &self,
        connection_id: &str,
        request: super::driver::DocumentDeleteRequest<'_>,
        expected_source_digest: &str,
    ) -> Result<super::driver::DocumentDeleteReceipt> {
        let driver = self.get_driver(connection_id).await?;
        driver
            .execute_document_delete(request, expected_source_digest)
            .await
    }

    pub async fn close_document_cursor(&self, id: &str, cursor: &str) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver.close_document_cursor(cursor).await
    }

    pub async fn get_search_index_metadata(
        &self,
        id: &str,
        index: &str,
        kind: super::protocol::SearchIndexMetadataKind,
    ) -> Result<serde_json::Value> {
        let driver = self.get_driver(id).await?;
        driver.get_search_index_metadata(index, kind).await
    }

    pub async fn clear_search_index_documents(
        &self,
        id: &str,
        index: &str,
    ) -> Result<super::protocol::SearchIndexClearResult> {
        let driver = self.get_driver(id).await?;
        driver.clear_search_index_documents(index).await
    }

    /// Get columns
    pub async fn get_columns(
        &self,
        id: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_columns(schema, table).await
    }

    pub async fn get_generated_columns(
        &self,
        id: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<String>> {
        let driver = self.get_driver(id).await?;
        driver.get_generated_columns(schema, table).await
    }

    pub async fn get_database_generated_columns(
        &self,
        id: &str,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<String>> {
        let driver = self.get_driver(id).await?;
        driver
            .get_database_generated_columns(database, schema, table)
            .await
    }

    pub async fn sql_export_requires_identity_override(
        &self,
        id: &str,
        schema: &str,
        table: &str,
    ) -> Result<bool> {
        let driver = self.get_driver(id).await?;
        driver
            .sql_export_requires_identity_override(schema, table)
            .await
    }

    pub async fn get_database_columns(
        &self,
        id: &str,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_database_columns(database, schema, table).await
    }

    pub async fn get_indexes(&self, id: &str, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_indexes(schema, table).await
    }

    pub async fn get_database_indexes(
        &self,
        id: &str,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_database_indexes(database, schema, table).await
    }

    pub async fn get_constraints(
        &self,
        id: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_constraints(schema, table).await
    }

    pub async fn get_database_constraints(
        &self,
        id: &str,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>> {
        let driver = self.get_driver(id).await?;
        driver
            .get_database_constraints(database, schema, table)
            .await
    }

    pub async fn get_referencing_foreign_keys(
        &self,
        id: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_referencing_foreign_keys(schema, table).await
    }

    pub async fn get_database_referencing_foreign_keys(
        &self,
        id: &str,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        let driver = self.get_driver(id).await?;
        driver
            .get_database_referencing_foreign_keys(database, schema, table)
            .await
    }

    pub async fn get_functions(&self, id: &str, schema: &str) -> Result<Vec<FunctionInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_functions(schema).await
    }

    pub async fn get_database_functions(
        &self,
        id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<FunctionInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_database_functions(database, schema).await
    }

    pub async fn set_current_schema(&self, connection_id: &str, schema: &str) -> Result<()> {
        let driver = self.get_driver(connection_id).await?;
        driver.set_current_schema(schema).await?;

        let mut schemas = self.active_schemas.lock().await;
        schemas.insert(connection_id.to_string(), schema.to_string());

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::protocol::{
        ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, QueryResult, TableInfo,
    };
    use anyhow::anyhow;
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Mutex as StdMutex;
    use tokio::sync::Notify;
    use tokio::time::{timeout, Duration};

    #[derive(Clone)]
    struct BlockingDriver {
        entered: Arc<AtomicUsize>,
        both_entered: Arc<Notify>,
        release: Arc<Notify>,
    }

    struct DatabaseDiscoveryDriver;

    struct RuntimeDriver {
        driver: &'static str,
        version: &'static str,
        process_id: Option<u32>,
        healthy: Option<bool>,
    }

    struct ReconnectRuntimeDriver {
        healthy: Arc<AtomicBool>,
        reconnects: Arc<AtomicUsize>,
        succeeds: bool,
    }

    struct CapabilityDriver {
        capabilities: DatabaseCapabilities,
    }

    #[async_trait]
    impl DatabaseDriver for CapabilityDriver {
        fn external_package_identity(&self) -> Option<(&str, &str)> {
            Some(("postgres", "16.4.1"))
        }

        fn package_capabilities(&self) -> Option<DatabaseCapabilities> {
            Some(self.capabilities.clone())
        }

        async fn server_version(&self) -> Option<String> {
            Some("16.3".to_string())
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
            Ok(Vec::new())
        }
    }

    #[async_trait]
    impl DatabaseDriver for RuntimeDriver {
        fn external_package_identity(&self) -> Option<(&str, &str)> {
            Some((self.driver, self.version))
        }

        async fn external_runtime_process_id(&self) -> Option<u32> {
            self.process_id
        }

        async fn external_runtime_is_healthy(&self) -> Option<bool> {
            self.healthy
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
            Ok(Vec::new())
        }
    }

    #[async_trait]
    impl DatabaseDriver for ReconnectRuntimeDriver {
        fn external_package_identity(&self) -> Option<(&str, &str)> {
            Some(("oracle", "23.3.0"))
        }

        async fn external_runtime_process_id(&self) -> Option<u32> {
            Some(8201)
        }

        async fn external_runtime_is_healthy(&self) -> Option<bool> {
            Some(self.healthy.load(Ordering::Acquire))
        }

        async fn reconnect_external_runtime(&self) -> Result<bool> {
            self.reconnects.fetch_add(1, Ordering::AcqRel);
            if self.succeeds {
                self.healthy.store(true, Ordering::Release);
                Ok(true)
            } else {
                Err(anyhow!("private sidecar failure detail"))
            }
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
            Ok(Vec::new())
        }
    }

    #[async_trait]
    impl DatabaseDriver for DatabaseDiscoveryDriver {
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

        async fn query_database(&self, database: &str, sql: &str) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(
                &format!("{database}:{sql}"),
                0,
            )])
        }

        async fn query_database_with_context_tracked(
            &self,
            query_id: Option<&str>,
            database: &str,
            sql: &str,
            schema: Option<&str>,
        ) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(
                &format!(
                    "{database}:{}:{}:{sql}",
                    schema.unwrap_or(""),
                    query_id.unwrap_or("")
                ),
                0,
            )])
        }

        async fn query_database_parameterized(
            &self,
            database: &str,
            sql: &str,
            params: &[QueryParameter],
        ) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(
                &format!("{database}:{sql}"),
                params.len() as u64,
            )])
        }

        async fn get_databases(&self) -> Result<Vec<String>> {
            Ok(vec!["app".to_string(), "analytics".to_string()])
        }

        async fn get_schemas(&self) -> Result<Vec<String>> {
            Ok(vec!["public".to_string()])
        }

        async fn get_database_schemas(&self, database: &str) -> Result<Vec<String>> {
            Ok(vec![format!("{database}_schema")])
        }

        async fn get_database_tables(
            &self,
            database: &str,
            schema: &str,
        ) -> Result<Vec<TableInfo>> {
            Ok(vec![TableInfo {
                name: format!("{database}_{schema}_table"),
                schema: Some(schema.to_string()),
                table_type: Some("BASE TABLE".to_string()),
                comment: None,
            }])
        }

        async fn get_database_functions(
            &self,
            database: &str,
            schema: &str,
        ) -> Result<Vec<FunctionInfo>> {
            Ok(vec![FunctionInfo {
                name: format!("{database}_{schema}_function"),
                routine_type: Some("function".to_string()),
                parameters: Vec::new(),
                return_type: "void".to_string(),
                description: None,
            }])
        }

        async fn get_database_columns(
            &self,
            database: &str,
            schema: &str,
            table: &str,
        ) -> Result<Vec<ColumnInfo>> {
            Ok(vec![ColumnInfo {
                name: format!("{database}_{schema}_{table}_column"),
                data_type: "text".to_string(),
                is_nullable: true,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                is_auto_increment: false,
                identity_generation: None,
                default_value: None,
                comment: None,
                is_generated: Some(false),
                is_hidden: Some(false),
            }])
        }

        async fn get_database_indexes(
            &self,
            database: &str,
            schema: &str,
            table: &str,
        ) -> Result<Vec<IndexInfo>> {
            Ok(vec![IndexInfo {
                name: format!("{database}_{schema}_{table}_index"),
                columns: vec!["id".to_string()],
                is_unique: false,
                is_primary: false,
                filter: None,
                index_type: None,
                included_columns: None,
                definition: None,
                comment: None,
                key_is_expression: Vec::new(),
            }])
        }

        async fn get_database_constraints(
            &self,
            database: &str,
            schema: &str,
            table: &str,
        ) -> Result<Vec<ConstraintInfo>> {
            Ok(vec![ConstraintInfo {
                name: format!("{database}_{schema}_{table}_constraint"),
                constraint_type: "CHECK".to_string(),
                columns: Vec::new(),
                referenced_schema: None,
                referenced_table: None,
                referenced_columns: Vec::new(),
                definition: None,
                on_update: None,
                on_delete: None,
            }])
        }
    }

    impl BlockingDriver {
        fn new(entered: Arc<AtomicUsize>, both_entered: Arc<Notify>, release: Arc<Notify>) -> Self {
            Self {
                entered,
                both_entered,
                release,
            }
        }
    }

    #[async_trait]
    impl DatabaseDriver for BlockingDriver {
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
            if self.entered.fetch_add(1, Ordering::SeqCst) + 1 == 2 {
                self.both_entered.notify_one();
            }
            self.release.notified().await;
            Ok(Vec::new())
        }

        async fn query_with_context(&self, sql: &str, _schema: &str) -> Result<Vec<QueryResult>> {
            self.query(sql).await
        }

        async fn begin_transaction(&self, _session_id: &str, _schema: Option<&str>) -> Result<()> {
            Ok(())
        }

        async fn query_transaction(
            &self,
            _session_id: &str,
            sql: &str,
        ) -> Result<Vec<QueryResult>> {
            self.query(sql).await
        }

        async fn commit_transaction(&self, _session_id: &str) -> Result<()> {
            Ok(())
        }

        async fn rollback_transaction(&self, _session_id: &str) -> Result<()> {
            Ok(())
        }

        async fn get_schemas(&self) -> Result<Vec<String>> {
            Ok(Vec::new())
        }

        async fn get_tables(&self, _schema: &str) -> Result<Vec<TableInfo>> {
            Ok(Vec::new())
        }

        async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
            Ok(Vec::new())
        }

        async fn get_indexes(&self, _schema: &str, _table: &str) -> Result<Vec<IndexInfo>> {
            Ok(Vec::new())
        }

        async fn get_constraints(
            &self,
            _schema: &str,
            _table: &str,
        ) -> Result<Vec<ConstraintInfo>> {
            Ok(Vec::new())
        }

        async fn get_functions(&self, _schema: &str) -> Result<Vec<FunctionInfo>> {
            Ok(Vec::new())
        }

        async fn set_current_schema(&self, _schema: &str) -> Result<()> {
            Ok(())
        }
    }

    #[derive(Clone)]
    struct LifecycleDriver {
        disconnect_calls: Arc<AtomicUsize>,
        invalidated_schemas: Arc<StdMutex<Vec<String>>>,
        fail_disconnect: bool,
    }

    impl LifecycleDriver {
        fn new(disconnect_calls: Arc<AtomicUsize>, fail_disconnect: bool) -> Self {
            Self::with_invalidations(
                disconnect_calls,
                fail_disconnect,
                Arc::new(StdMutex::new(Vec::new())),
            )
        }

        fn with_invalidations(
            disconnect_calls: Arc<AtomicUsize>,
            fail_disconnect: bool,
            invalidated_schemas: Arc<StdMutex<Vec<String>>>,
        ) -> Self {
            Self {
                disconnect_calls,
                invalidated_schemas,
                fail_disconnect,
            }
        }
    }

    #[async_trait]
    impl DatabaseDriver for LifecycleDriver {
        async fn connect(&mut self) -> Result<()> {
            Ok(())
        }

        async fn disconnect(&self) -> Result<()> {
            self.disconnect_calls.fetch_add(1, Ordering::SeqCst);
            if self.fail_disconnect {
                Err(anyhow!("disconnect failed"))
            } else {
                Ok(())
            }
        }

        async fn ping(&self) -> Result<()> {
            Ok(())
        }

        async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
            Ok(Vec::new())
        }

        async fn query_with_context(&self, _sql: &str, _schema: &str) -> Result<Vec<QueryResult>> {
            Ok(Vec::new())
        }

        async fn begin_transaction(&self, _session_id: &str, _schema: Option<&str>) -> Result<()> {
            Ok(())
        }

        async fn query_transaction(
            &self,
            _session_id: &str,
            _sql: &str,
        ) -> Result<Vec<QueryResult>> {
            Ok(Vec::new())
        }

        async fn commit_transaction(&self, _session_id: &str) -> Result<()> {
            Ok(())
        }

        async fn rollback_transaction(&self, _session_id: &str) -> Result<()> {
            Ok(())
        }

        async fn get_schemas(&self) -> Result<Vec<String>> {
            Ok(Vec::new())
        }

        async fn get_tables(&self, _schema: &str) -> Result<Vec<TableInfo>> {
            Ok(Vec::new())
        }

        async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
            Ok(Vec::new())
        }

        async fn get_indexes(&self, _schema: &str, _table: &str) -> Result<Vec<IndexInfo>> {
            Ok(Vec::new())
        }

        async fn get_constraints(
            &self,
            _schema: &str,
            _table: &str,
        ) -> Result<Vec<ConstraintInfo>> {
            Ok(Vec::new())
        }

        async fn get_functions(&self, _schema: &str) -> Result<Vec<FunctionInfo>> {
            Ok(Vec::new())
        }

        async fn set_current_schema(&self, _schema: &str) -> Result<()> {
            Ok(())
        }

        async fn invalidate_schema(&self, schema: &str) -> Result<()> {
            self.invalidated_schemas
                .lock()
                .expect("invalidated schema list mutex poisoned")
                .push(schema.to_string());
            Ok(())
        }
    }

    #[tokio::test]
    async fn queries_on_different_connections_do_not_hold_global_lock() {
        let manager = Arc::new(ConnectionManager::new());
        let entered = Arc::new(AtomicUsize::new(0));
        let both_entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());

        manager
            .add_connection(
                "one".to_string(),
                Box::new(BlockingDriver::new(
                    entered.clone(),
                    both_entered.clone(),
                    release.clone(),
                )),
            )
            .await;
        manager
            .add_connection(
                "two".to_string(),
                Box::new(BlockingDriver::new(
                    entered.clone(),
                    both_entered.clone(),
                    release.clone(),
                )),
            )
            .await;

        let first = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.query("one", "SELECT 1", None, None, None).await })
        };
        let second = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.query("two", "SELECT 1", None, None, None).await })
        };

        timeout(Duration::from_millis(250), both_entered.notified())
            .await
            .expect("second query could not enter while first query was awaiting");
        release.notify_waiters();

        first.await.unwrap().unwrap();
        second.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn external_runtime_summary_groups_packages_without_connection_details() {
        let manager = ConnectionManager::new();
        manager
            .add_connection(
                "private-connection-a".to_string(),
                Box::new(RuntimeDriver {
                    driver: "oracle",
                    version: "23.3.0",
                    process_id: Some(8201),
                    healthy: Some(true),
                }),
            )
            .await;
        manager
            .add_connection(
                "private-connection-b".to_string(),
                Box::new(RuntimeDriver {
                    driver: "oracle",
                    version: "23.3.0",
                    process_id: Some(8202),
                    healthy: Some(false),
                }),
            )
            .await;
        manager
            .add_connection(
                "private-connection-c".to_string(),
                Box::new(RuntimeDriver {
                    driver: "oracle",
                    version: "23.3.0",
                    process_id: None,
                    healthy: None,
                }),
            )
            .await;

        let summaries = manager.external_driver_runtime_summaries().await;
        assert_eq!(summaries.len(), 1);
        let summary = &summaries[0];
        assert_eq!(summary.driver, "oracle");
        assert_eq!(summary.package_version, "23.3.0");
        assert_eq!(summary.connection_count, 3);
        assert_eq!(summary.process_ids, vec![8201, 8202]);
        assert_eq!(summary.unavailable_process_count, 1);
        assert_eq!(summary.unhealthy_connection_count, 1);
        assert_eq!(summary.launch_count, 3);
        assert_eq!(summary.observed_exit_count, 1);
        assert!(summary.last_started_at_millis.is_some());
        assert!(summary.last_exit_observed_at_millis.is_some());
    }

    #[tokio::test]
    async fn exited_runtime_reconnect_is_explicit_and_updates_sanitized_telemetry() {
        let manager = ConnectionManager::new();
        let healthy = Arc::new(AtomicBool::new(false));
        let reconnects = Arc::new(AtomicUsize::new(0));
        manager
            .add_connection(
                "private-connection".to_string(),
                Box::new(ReconnectRuntimeDriver {
                    healthy: healthy.clone(),
                    reconnects: reconnects.clone(),
                    succeeds: true,
                }),
            )
            .await;
        let before = manager.external_driver_runtime_summaries().await;
        assert_eq!(before[0].unhealthy_connection_count, 1);
        assert!(before[0].reconnect_available);

        let result = manager
            .reconnect_external_driver_runtimes("oracle", "23.3.0")
            .await
            .unwrap();
        assert_eq!(result.reason, "process-exited");
        assert_eq!(result.matched_connection_count, 1);
        assert_eq!(result.reconnected_count, 1);
        assert_eq!(reconnects.load(Ordering::Acquire), 1);
        assert!(healthy.load(Ordering::Acquire));

        let after = manager.external_driver_runtime_summaries().await;
        assert_eq!(after[0].unhealthy_connection_count, 0);
        assert_eq!(after[0].launch_count, 2);
        assert_eq!(after[0].reconnect_attempt_count, 1);
        assert_eq!(after[0].reconnect_success_count, 1);
        assert_eq!(after[0].last_event_code.as_deref(), Some("launched"));
    }

    #[tokio::test]
    async fn repeated_runtime_reconnect_failures_are_budget_limited() {
        let manager = ConnectionManager::new();
        let reconnects = Arc::new(AtomicUsize::new(0));
        manager
            .add_connection(
                "private-connection".to_string(),
                Box::new(ReconnectRuntimeDriver {
                    healthy: Arc::new(AtomicBool::new(false)),
                    reconnects: reconnects.clone(),
                    succeeds: false,
                }),
            )
            .await;
        manager.external_driver_runtime_summaries().await;

        for _ in 0..EXTERNAL_RUNTIME_RECONNECT_MAX_ATTEMPTS {
            let result = manager
                .reconnect_external_driver_runtimes("oracle", "23.3.0")
                .await
                .unwrap();
            assert_eq!(result.attempted_count, 1);
            assert_eq!(result.failed_count, 1);
        }
        let blocked = manager
            .reconnect_external_driver_runtimes("oracle", "23.3.0")
            .await
            .unwrap();
        assert_eq!(blocked.attempted_count, 0);
        assert_eq!(blocked.budget_blocked_count, 1);
        assert_eq!(reconnects.load(Ordering::Acquire), 3);

        let summaries = manager.external_driver_runtime_summaries().await;
        let summary = &summaries[0];
        assert_eq!(summary.reconnect_attempt_count, 3);
        assert_eq!(summary.reconnect_failure_count, 3);
        assert_eq!(summary.reconnect_budget_block_count, 1);
        assert_eq!(summary.reconnect_blocked_connection_count, 1);
        assert!(!summary.reconnect_available);
        assert_eq!(
            summary.last_event_code.as_deref(),
            Some("reconnect-budget-blocked")
        );
    }

    #[tokio::test]
    async fn runtime_summary_merges_sanitized_telemetry_across_manager_instances() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let store = MetaStore::for_test(pool);
        store.init().await.unwrap();

        let first = ConnectionManager::new();
        first
            .set_external_runtime_telemetry_store(store.clone())
            .await;
        first
            .add_connection(
                "private-old-connection".to_string(),
                Box::new(RuntimeDriver {
                    driver: "oracle",
                    version: "23.3.0",
                    process_id: Some(8201),
                    healthy: Some(false),
                }),
            )
            .await;
        let observed = first.external_driver_runtime_summaries().await;
        assert_eq!(observed[0].launch_count, 1);
        assert_eq!(observed[0].observed_exit_count, 1);

        let second = ConnectionManager::new();
        second.set_external_runtime_telemetry_store(store).await;
        second
            .add_connection(
                "private-new-connection".to_string(),
                Box::new(RuntimeDriver {
                    driver: "oracle",
                    version: "23.3.0",
                    process_id: Some(8202),
                    healthy: Some(true),
                }),
            )
            .await;
        let restored = second.external_driver_runtime_summaries().await;
        assert_eq!(restored[0].launch_count, 2);
        assert_eq!(restored[0].observed_exit_count, 1);
        assert_eq!(restored[0].last_event_code.as_deref(), Some("launched"));
    }

    #[tokio::test]
    async fn capability_snapshot_stays_bound_to_the_live_package_instance() {
        let manager = ConnectionManager::new();
        let mut capabilities = crate::core::dialect::DatabaseKind::Postgres.capabilities();
        capabilities.display_name = "Pinned PostgreSQL sidecar".to_string();
        capabilities.supports_table_data_transfer = false;
        manager
            .replace_connection_with_tunnel_and_driver_id(
                "conn".to_string(),
                Box::new(CapabilityDriver {
                    capabilities: capabilities.clone(),
                }),
                None,
                Some("postgres".to_string()),
            )
            .await
            .unwrap();

        assert_eq!(
            manager.capability_snapshot("conn").await.unwrap(),
            LiveConnectionCapabilitySnapshot {
                driver_id: Some("postgres".to_string()),
                managed: false,
                external_driver_id: Some("postgres".to_string()),
                package_version: Some("16.4.1".to_string()),
                package_capabilities: Some(capabilities),
                server_version: Some("16.3".to_string()),
                semantic_schema_migration_mode: None,
                has_exact_semantic_schema_migration_evidence: false,
            }
        );
    }

    #[tokio::test]
    async fn database_discovery_is_distinct_from_schema_discovery() {
        let manager = ConnectionManager::new();
        manager
            .add_connection("conn".to_string(), Box::new(DatabaseDiscoveryDriver))
            .await;

        assert_eq!(
            manager.get_databases("conn").await.unwrap(),
            vec!["app".to_string(), "analytics".to_string()]
        );
        assert_eq!(
            manager.get_schemas("conn").await.unwrap(),
            vec!["public".to_string()]
        );
        assert_eq!(
            manager
                .get_database_schemas("conn", "analytics")
                .await
                .unwrap(),
            vec!["analytics_schema".to_string()]
        );

        let tables = manager
            .get_database_tables("conn", "analytics", "reporting")
            .await
            .unwrap();
        assert_eq!(tables[0].name, "analytics_reporting_table");
        assert_eq!(tables[0].schema.as_deref(), Some("reporting"));

        let functions = manager
            .get_database_functions("conn", "analytics", "reporting")
            .await
            .unwrap();
        assert_eq!(functions[0].name, "analytics_reporting_function");

        let query = manager
            .query_database("conn", "analytics", "SELECT 1")
            .await
            .unwrap();
        assert_eq!(
            query[0].statement_type.as_deref(),
            Some("analytics:SELECT 1")
        );

        let contextual_query = manager
            .query_database_with_context(
                "conn",
                "analytics",
                "SELECT * FROM events",
                Some("reporting"),
                Some("query-1"),
            )
            .await
            .unwrap();
        assert_eq!(
            contextual_query[0].statement_type.as_deref(),
            Some("analytics:reporting:query-1:SELECT * FROM events")
        );

        let parameterized = manager
            .query_database_parameterized(
                "conn",
                "analytics",
                "SELECT $1",
                &[QueryParameter {
                    value: serde_json::json!(1),
                    data_type: Some("integer".to_string()),
                }],
            )
            .await
            .unwrap();
        assert_eq!(parameterized[0].rows_affected, Some(1));

        let columns = manager
            .get_database_columns("conn", "analytics", "reporting", "events")
            .await
            .unwrap();
        assert_eq!(columns[0].name, "analytics_reporting_events_column");

        let indexes = manager
            .get_database_indexes("conn", "analytics", "reporting", "events")
            .await
            .unwrap();
        assert_eq!(indexes[0].name, "analytics_reporting_events_index");

        let constraints = manager
            .get_database_constraints("conn", "analytics", "reporting", "events")
            .await
            .unwrap();
        assert_eq!(constraints[0].name, "analytics_reporting_events_constraint");
    }

    #[tokio::test]
    async fn replace_connection_keeps_new_driver_when_old_disconnect_fails() {
        let manager = ConnectionManager::new();
        let disconnect_calls = Arc::new(AtomicUsize::new(0));

        manager
            .add_connection(
                "conn".to_string(),
                Box::new(LifecycleDriver::new(disconnect_calls.clone(), true)),
            )
            .await;

        manager
            .replace_connection(
                "conn".to_string(),
                Box::new(LifecycleDriver::new(disconnect_calls.clone(), false)),
            )
            .await
            .expect("replace should succeed after installing the new driver");

        assert_eq!(disconnect_calls.load(Ordering::SeqCst), 1);
        manager
            .ping("conn")
            .await
            .expect("new driver should remain active");
    }

    #[tokio::test]
    async fn add_connection_disconnects_replaced_driver_and_schema_context() {
        let manager = ConnectionManager::new();
        let disconnect_calls = Arc::new(AtomicUsize::new(0));

        manager
            .add_connection(
                "conn".to_string(),
                Box::new(LifecycleDriver::new(disconnect_calls.clone(), false)),
            )
            .await;
        manager
            .set_current_schema("conn", "public")
            .await
            .expect("schema context should be stored");

        manager
            .add_connection(
                "conn".to_string(),
                Box::new(LifecycleDriver::new(disconnect_calls.clone(), false)),
            )
            .await;

        assert_eq!(disconnect_calls.load(Ordering::SeqCst), 1);
        assert!(!manager.active_schemas.lock().await.contains_key("conn"));
        manager
            .ping("conn")
            .await
            .expect("new driver should remain active");
    }

    #[tokio::test]
    async fn disconnect_connection_removes_driver_and_schema_context() {
        let manager = ConnectionManager::new();
        let disconnect_calls = Arc::new(AtomicUsize::new(0));

        manager
            .add_connection(
                "conn".to_string(),
                Box::new(LifecycleDriver::new(disconnect_calls.clone(), false)),
            )
            .await;
        manager
            .set_current_schema("conn", "public")
            .await
            .expect("schema context should be stored");

        assert_eq!(
            manager
                .active_schemas
                .lock()
                .await
                .get("conn")
                .map(String::as_str),
            Some("public")
        );

        manager
            .disconnect_connection("conn")
            .await
            .expect("disconnect should succeed");

        assert_eq!(disconnect_calls.load(Ordering::SeqCst), 1);
        assert!(!manager.active_schemas.lock().await.contains_key("conn"));
        assert!(manager.ping("conn").await.is_err());
    }

    #[tokio::test]
    async fn invalidate_schema_clears_only_matching_active_context() {
        let manager = ConnectionManager::new();
        let disconnect_calls = Arc::new(AtomicUsize::new(0));
        let invalidated_schemas = Arc::new(StdMutex::new(Vec::new()));

        manager
            .add_connection(
                "conn".to_string(),
                Box::new(LifecycleDriver::with_invalidations(
                    disconnect_calls,
                    false,
                    invalidated_schemas.clone(),
                )),
            )
            .await;
        manager
            .set_current_schema("conn", "public")
            .await
            .expect("schema context should be stored");

        manager
            .invalidate_schema("conn", "archive")
            .await
            .expect("non-active schema invalidation should succeed");
        assert_eq!(
            manager
                .active_schemas
                .lock()
                .await
                .get("conn")
                .map(String::as_str),
            Some("public")
        );

        manager
            .invalidate_schema("conn", "public")
            .await
            .expect("active schema invalidation should succeed");
        assert!(!manager.active_schemas.lock().await.contains_key("conn"));
        assert_eq!(
            invalidated_schemas
                .lock()
                .expect("invalidated schema list mutex poisoned")
                .as_slice(),
            ["archive", "public"]
        );
    }
}
