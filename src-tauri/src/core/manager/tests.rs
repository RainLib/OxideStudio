use super::*;
use crate::core::protocol::{
    ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, QueryResult, TableInfo,
};
use crate::core::{
    dialect::DatabaseCapabilities, driver::DatabaseDriver, protocol::QueryParameter,
    store::MetaStore,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Notify;
use tokio::time::{timeout, Duration};

#[path = "semantic_dispatch_tests.rs"]
mod semantic_dispatch_tests;

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

    async fn get_database_tables(&self, database: &str, schema: &str) -> Result<Vec<TableInfo>> {
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
            character_set: None,
            collation: None,
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

    async fn query_transaction(&self, _session_id: &str, sql: &str) -> Result<Vec<QueryResult>> {
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

    async fn get_constraints(&self, _schema: &str, _table: &str) -> Result<Vec<ConstraintInfo>> {
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

    async fn query_transaction(&self, _session_id: &str, _sql: &str) -> Result<Vec<QueryResult>> {
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

    async fn get_constraints(&self, _schema: &str, _table: &str) -> Result<Vec<ConstraintInfo>> {
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
