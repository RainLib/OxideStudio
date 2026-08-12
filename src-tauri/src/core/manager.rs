use super::protocol::{
    ColumnInfo, ConstraintInfo, DatabaseCreateRequest, ForeignKeyReferenceInfo, FunctionInfo,
    IndexInfo, ParameterizedStatement, QueryParameter,
};
use super::ssh::SshTunnel;
use super::{dialect::DatabaseCapabilities, driver::DatabaseDriver};
use anyhow::{anyhow, Result};
use oxide_driver_protocol::{
    SchemaMigrationApplyRequest, SchemaMigrationApplyResult, SchemaMigrationMode,
    SchemaMigrationPlanRequest, SchemaMigrationPlanResult, SchemaMigrationPreflightRequest,
    SchemaMigrationPreflightResult, SchemaMigrationVerifyRequest, SchemaMigrationVerifyResult,
};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

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
}

#[derive(Default)]
struct ExternalDriverRuntimeTelemetry {
    launch_count: u64,
    observed_exit_count: u64,
    last_started_at_millis: Option<u64>,
    last_exit_observed_at_millis: Option<u64>,
    observed_exited_connection_ids: HashSet<String>,
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
        }
        let Some(package_identity) = package_identity else {
            return;
        };
        let entry = telemetry.entry(package_identity).or_default();
        entry.launch_count = entry.launch_count.saturating_add(1);
        entry.last_started_at_millis = Some(runtime_timestamp_millis());
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

        let telemetry = {
            let mut telemetry = self.external_runtime_telemetry.lock().await;
            for (package_identity, connection_id, is_healthy) in health_observations {
                let entry = telemetry.entry(package_identity).or_default();
                if matches!(is_healthy, Some(false)) {
                    if entry.observed_exited_connection_ids.insert(connection_id) {
                        entry.observed_exit_count = entry.observed_exit_count.saturating_add(1);
                        entry.last_exit_observed_at_millis = Some(runtime_timestamp_millis());
                    }
                } else {
                    entry.observed_exited_connection_ids.remove(&connection_id);
                }
            }
            grouped
                .keys()
                .map(|identity| {
                    let entry = telemetry
                        .get(identity)
                        .expect("runtime telemetry entry exists");
                    (
                        identity.clone(),
                        (
                            entry.launch_count,
                            entry.observed_exit_count,
                            entry.last_started_at_millis,
                            entry.last_exit_observed_at_millis,
                        ),
                    )
                })
                .collect::<BTreeMap<_, _>>()
        };

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
                    let (
                        launch_count,
                        observed_exit_count,
                        last_started_at_millis,
                        last_exit_observed_at_millis,
                    ) = telemetry
                        .get(&(driver.clone(), package_version.clone()))
                        .copied()
                        .unwrap_or((0, 0, None, None));
                    ExternalDriverRuntimeSummary {
                        driver,
                        package_version,
                        connection_count,
                        process_ids,
                        unavailable_process_count,
                        unhealthy_connection_count,
                        launch_count,
                        observed_exit_count,
                        last_started_at_millis,
                        last_exit_observed_at_millis,
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
    use std::sync::atomic::{AtomicUsize, Ordering};
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
                index_type: None,
                definition: None,
                comment: None,
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
