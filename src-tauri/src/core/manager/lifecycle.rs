use super::models::{
    runtime_timestamp_millis, ConnectionManager, ExternalDriverRuntimeReconnectResult,
    ExternalDriverRuntimeSummary, LiveConnectionCapabilitySnapshot, ManagedConnection,
    EXTERNAL_RUNTIME_RECONNECT_BATCH_LIMIT, EXTERNAL_RUNTIME_RECONNECT_MAX_ATTEMPTS,
    EXTERNAL_RUNTIME_RECONNECT_WINDOW_MS,
};
use crate::core::{
    driver::{DatabaseDriver, LocalDatabaseBackupControl, LocalDatabaseFileReceipt},
    ssh::SshTunnel,
    store::{DriverRuntimeEventKind, DriverRuntimeTelemetryRecord, MetaStore},
};
use anyhow::{anyhow, Result};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::Path,
    sync::Arc,
};
use tokio::sync::Mutex;

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

    pub(super) async fn get_driver(&self, id: &str) -> Result<Arc<dyn DatabaseDriver>> {
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
        if !crate::core::driver_package::is_safe_driver_package_token(driver)
            || !crate::core::driver_package::is_safe_driver_package_token(package_version)
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
}
