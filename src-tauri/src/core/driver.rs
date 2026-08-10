use super::statement::StatementScanDialect;
use super::{
    dialect::DatabaseCapabilities,
    protocol::{
        CollectionInfo, ColumnInfo, ConstraintInfo, DatabaseCreateRequest, ForeignKeyReferenceInfo,
        FunctionInfo, IndexInfo, ParameterizedStatement, QueryParameter, QueryResult,
        SchemaObjectInfo, TableInfo,
    },
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use oxide_driver_protocol::{
    SchemaMigrationApplyRequest, SchemaMigrationApplyResult, SchemaMigrationMode,
    SchemaMigrationPlanRequest, SchemaMigrationPlanResult, SchemaMigrationPreflightRequest,
    SchemaMigrationPreflightResult, SchemaMigrationVerifyRequest, SchemaMigrationVerifyResult,
};

fn unsupported_driver_feature(feature: &str) -> anyhow::Error {
    anyhow!("{feature} is not implemented for this driver")
}

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    /// When set, this connection is backed by the named independently updated
    /// sidecar package. Connection management uses it to prevent replacing a
    /// package that still owns live sessions.
    fn external_package_identity(&self) -> Option<(&str, &str)> {
        None
    }

    /// Process id of the connection-owned external sidecar, when it exposes
    /// one. This is observability metadata only; callers must never use it to
    /// control or signal a process outside the trusted driver lifecycle.
    async fn external_runtime_process_id(&self) -> Option<u32> {
        None
    }

    /// Liveness of a connection-owned external sidecar, when the driver can
    /// report it without probing the database. `None` means this is not an
    /// external runtime; `Some(false)` means the registered connection still
    /// points at a process that has exited and should be reconnected.
    async fn external_runtime_is_healthy(&self) -> Option<bool> {
        None
    }

    /// Signed capabilities supplied by an independently updateable driver
    /// package. Native drivers use the bundled dialect registry instead.
    /// Exposing this through the live connection keeps snapshot/export policy
    /// tied to the exact package that was actually launched.
    fn package_capabilities(&self) -> Option<DatabaseCapabilities> {
        None
    }

    /// Signed execution mode for target-owned semantic schema migration.
    /// Native drivers and packages without the contract return `None`.
    fn semantic_schema_migration_mode(&self) -> Option<SchemaMigrationMode> {
        None
    }

    /// Whether this exact package, entrypoint, platform and negotiated server
    /// version has signed runner evidence for semantic migration.
    fn has_exact_semantic_schema_migration_evidence(&self, _server_version: Option<&str>) -> bool {
        false
    }

    /// SQL lexer dialect for backend-enforced read-only execution.
    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        None
    }

    /// Human-readable server version discovered during connection setup.
    /// Drivers that do not negotiate a version can keep the default.
    async fn server_version(&self) -> Option<String> {
        None
    }

    /// Establish connection to the database
    async fn connect(&mut self) -> Result<()>;

    /// Close the connection
    async fn disconnect(&self) -> Result<()>;

    /// Check if connection is alive (simple ping)
    async fn ping(&self) -> Result<()>;

    /// Execute a query and return generic result set
    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>>;

    /// Execute a query against an explicitly selected server database.
    ///
    /// This must not silently fall back to the driver's primary database:
    /// callers use it specifically to preserve PostgreSQL's database scope.
    async fn query_database(&self, _database: &str, _sql: &str) -> Result<Vec<QueryResult>> {
        Err(unsupported_driver_feature("Database-scoped queries"))
    }

    /// Execute a tracked query against an explicitly selected database and
    /// optional schema. Unsupported drivers must fail instead of falling back
    /// to their primary database.
    async fn query_database_with_context_tracked(
        &self,
        _query_id: Option<&str>,
        _database: &str,
        _sql: &str,
        _schema: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        Err(unsupported_driver_feature(
            "Tracked database-scoped queries",
        ))
    }

    /// Create a top-level database/schema/namespace using the driver's own
    /// dialect implementation. Native drivers can retain bounded SQL handling;
    /// external sidecars must explicitly advertise and implement it.
    async fn create_database(&self, _request: DatabaseCreateRequest) -> Result<()> {
        Err(unsupported_driver_feature("Database creation"))
    }

    /// Ask the target driver to plan a migration from bounded semantic
    /// snapshots. Host-generated SQL is deliberately absent from this API.
    async fn plan_schema_migration(
        &self,
        _request: SchemaMigrationPlanRequest,
    ) -> Result<SchemaMigrationPlanResult> {
        Err(unsupported_driver_feature(
            "Semantic schema migration planning",
        ))
    }

    async fn preflight_schema_migration(
        &self,
        _request: SchemaMigrationPreflightRequest,
    ) -> Result<SchemaMigrationPreflightResult> {
        Err(unsupported_driver_feature(
            "Semantic schema migration preflight",
        ))
    }

    async fn apply_schema_migration(
        &self,
        _request: SchemaMigrationApplyRequest,
    ) -> Result<SchemaMigrationApplyResult> {
        Err(unsupported_driver_feature(
            "Semantic schema migration apply",
        ))
    }

    async fn verify_schema_migration(
        &self,
        _request: SchemaMigrationVerifyRequest,
    ) -> Result<SchemaMigrationVerifyResult> {
        Err(unsupported_driver_feature(
            "Semantic schema migration verification",
        ))
    }

    /// Execute a parameterized mutation and return rows affected.
    async fn execute_parameterized(&self, _sql: &str, _params: &[QueryParameter]) -> Result<u64> {
        Err(anyhow!(
            "Parameterized execution is not implemented for this driver"
        ))
    }

    /// Execute a parameterized query and return result sets.
    async fn query_parameterized(
        &self,
        _sql: &str,
        _params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        Err(anyhow!(
            "Parameterized query execution is not implemented for this driver"
        ))
    }

    /// Execute a parameterized query against an explicitly selected server
    /// database. Unsupported drivers fail instead of querying their primary
    /// database by accident.
    async fn query_database_parameterized(
        &self,
        _database: &str,
        _sql: &str,
        _params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        Err(unsupported_driver_feature(
            "Database-scoped parameterized queries",
        ))
    }

    /// Execute a batch of parameterized mutations atomically.
    async fn execute_parameterized_batch(
        &self,
        _statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        Err(anyhow!(
            "Parameterized batch execution is not implemented for this driver"
        ))
    }

    /// Execute a batch of parameterized mutations atomically against an
    /// explicitly selected server database.
    async fn execute_database_parameterized_batch(
        &self,
        _database: &str,
        _statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        Err(unsupported_driver_feature(
            "Database-scoped parameterized batch execution",
        ))
    }

    /// Execute a query with an optional query id used for backend cancellation.
    async fn query_tracked(&self, _query_id: Option<&str>, sql: &str) -> Result<Vec<QueryResult>> {
        self.query(sql).await
    }

    /// Execute a query within a specific schema context
    async fn query_with_context(&self, sql: &str, _schema: &str) -> Result<Vec<QueryResult>> {
        self.query(sql).await
    }

    /// Execute a query within a schema context with an optional query id.
    async fn query_with_context_tracked(
        &self,
        _query_id: Option<&str>,
        sql: &str,
        schema: &str,
    ) -> Result<Vec<QueryResult>> {
        self.query_with_context(sql, schema).await
    }

    /// Start a named transaction session on a dedicated connection.
    async fn begin_transaction(&self, _session_id: &str, _schema: Option<&str>) -> Result<()> {
        Err(unsupported_driver_feature("Transactions"))
    }

    /// Start a named transaction against an explicitly selected server
    /// database. Drivers must override this instead of silently opening the
    /// connection's primary database when the caller has selected another one.
    async fn begin_database_transaction(
        &self,
        _session_id: &str,
        _database: &str,
        _schema: Option<&str>,
    ) -> Result<()> {
        Err(unsupported_driver_feature("Database-scoped transactions"))
    }

    /// Execute a query in an existing named transaction session.
    async fn query_transaction(&self, _session_id: &str, _sql: &str) -> Result<Vec<QueryResult>> {
        Err(unsupported_driver_feature("Transactions"))
    }

    /// Execute a transaction query with an optional query id.
    async fn query_transaction_tracked(
        &self,
        _query_id: Option<&str>,
        session_id: &str,
        sql: &str,
    ) -> Result<Vec<QueryResult>> {
        self.query_transaction(session_id, sql).await
    }

    /// Execute bound mutations inside an already-open named transaction.
    ///
    /// This is intentionally separate from `execute_parameterized_batch`: the
    /// latter owns a short transaction, while import/transfer pipelines need
    /// several bounded batches to share one explicit all-or-nothing boundary.
    async fn execute_parameterized_transaction(
        &self,
        _session_id: &str,
        _statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        Err(unsupported_driver_feature(
            "Transaction-scoped parameterized batch execution",
        ))
    }

    /// Request backend cancellation for a tracked query. Returns true when a
    /// backend cancellation command was sent.
    async fn cancel_query(&self, _query_id: &str) -> Result<bool> {
        Ok(false)
    }

    /// Commit and release a named transaction session.
    async fn commit_transaction(&self, _session_id: &str) -> Result<()> {
        Err(unsupported_driver_feature("Transactions"))
    }

    /// Roll back and release a named transaction session.
    async fn rollback_transaction(&self, _session_id: &str) -> Result<()> {
        Err(unsupported_driver_feature("Transactions"))
    }

    /// Get databases visible from the current server connection.
    ///
    /// For drivers where a database and a schema are the same namespace, the
    /// default implementation reuses `get_schemas`. PostgreSQL overrides this
    /// because its schemas belong to one database in a larger server cluster.
    async fn get_databases(&self) -> Result<Vec<String>> {
        self.get_schemas().await
    }

    /// Get list of schemas/namespaces in the currently connected database.
    async fn get_schemas(&self) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    /// Get schemas in an explicitly selected server database.
    ///
    /// Drivers without a separate database/schema hierarchy keep their
    /// existing behavior by delegating to `get_schemas`.
    async fn get_database_schemas(&self, _database: &str) -> Result<Vec<String>> {
        self.get_schemas().await
    }

    /// Read-only descriptors for non-relation objects in an explicitly selected
    /// database. Drivers with no separate database hierarchy keep the active
    /// connection behavior by default.
    async fn get_database_schema_objects(
        &self,
        _database: &str,
        schema: &str,
    ) -> Result<Vec<SchemaObjectInfo>> {
        self.get_schema_objects(schema).await
    }

    /// Get tables in a specific schema
    async fn get_tables(&self, _schema: &str) -> Result<Vec<TableInfo>> {
        Ok(Vec::new())
    }

    /// Get tables from a schema in an explicitly selected server database.
    /// Drivers without database-scoped connections delegate to `get_tables`.
    async fn get_database_tables(&self, _database: &str, schema: &str) -> Result<Vec<TableInfo>> {
        self.get_tables(schema).await
    }

    /// Lists descriptor-only schema objects that are not relations. Drivers
    /// return an empty list unless they can identify the object kind without
    /// guessing a DDL or mutation contract.
    async fn get_schema_objects(&self, _schema: &str) -> Result<Vec<SchemaObjectInfo>> {
        Ok(Vec::new())
    }

    /// Get collections, indexes, or analogous document/search objects in a namespace.
    async fn get_collections(&self, _namespace: &str) -> Result<Vec<CollectionInfo>> {
        Ok(Vec::new())
    }

    /// Get one bounded page of collection-like objects. Drivers with native
    /// cursors should override this so large namespaces are not materialized.
    async fn get_collections_page(
        &self,
        namespace: &str,
        cursor: Option<&str>,
        limit: usize,
        filter: Option<&str>,
    ) -> Result<crate::core::protocol::CollectionPage> {
        let mut items = self.get_collections(namespace).await?;
        if let Some(filter) = filter.map(str::trim).filter(|value| !value.is_empty()) {
            items.retain(|item| item.name.contains(filter));
        }
        let offset = cursor.and_then(|value| value.parse().ok()).unwrap_or(0);
        let start = offset.min(items.len());
        let end = start.saturating_add(limit.max(1)).min(items.len());
        let total = items.len() as u64;
        Ok(crate::core::protocol::CollectionPage {
            items: items[start..end].to_vec(),
            next_cursor: (end < items.len()).then(|| end.to_string()),
            total: Some(total),
        })
    }

    /// Get columns for a specific table
    async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
        Ok(Vec::new())
    }

    /// Get columns for a table in an explicitly selected server database.
    async fn get_database_columns(
        &self,
        _database: &str,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        Err(unsupported_driver_feature("Database-scoped columns"))
    }

    /// Get indexes for a specific table
    async fn get_indexes(&self, _schema: &str, _table: &str) -> Result<Vec<IndexInfo>> {
        Ok(Vec::new())
    }

    /// Get indexes for a table in an explicitly selected server database.
    async fn get_database_indexes(
        &self,
        _database: &str,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<IndexInfo>> {
        Err(unsupported_driver_feature("Database-scoped indexes"))
    }

    /// Get constraints and foreign-key relationships for a specific table
    async fn get_constraints(&self, _schema: &str, _table: &str) -> Result<Vec<ConstraintInfo>> {
        Ok(Vec::new())
    }

    /// Get constraints for a table in an explicitly selected server database.
    async fn get_database_constraints(
        &self,
        _database: &str,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ConstraintInfo>> {
        Err(unsupported_driver_feature("Database-scoped constraints"))
    }

    /// Find foreign keys owned by other relations that reference this table.
    /// Implementations should query the database catalog instead of scanning
    /// every table from the client.
    async fn get_referencing_foreign_keys(
        &self,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        Ok(Vec::new())
    }

    /// Reverse foreign-key lookup in an explicitly selected server database.
    async fn get_database_referencing_foreign_keys(
        &self,
        _database: &str,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        Err(unsupported_driver_feature(
            "Database-scoped referencing foreign keys",
        ))
    }

    /// Get functions/procedures in a specific schema/database.
    async fn get_functions(&self, _schema: &str) -> Result<Vec<FunctionInfo>> {
        Ok(Vec::new())
    }

    /// Get routines from a schema in an explicitly selected server database.
    /// This mirrors the database-scoped table API because relational explorer
    /// schema nodes load both object groups.
    async fn get_database_functions(
        &self,
        _database: &str,
        schema: &str,
    ) -> Result<Vec<FunctionInfo>> {
        self.get_functions(schema).await
    }

    /// Set the current schema/database context
    async fn set_current_schema(&self, _schema: &str) -> Result<()> {
        Ok(())
    }

    /// Invalidate cached driver resources tied to a schema/database.
    async fn invalidate_schema(&self, _schema: &str) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MinimalDriver;

    struct CollectionsDriver;

    #[async_trait]
    impl DatabaseDriver for MinimalDriver {
        async fn connect(&mut self) -> Result<()> {
            Ok(())
        }

        async fn disconnect(&self) -> Result<()> {
            Ok(())
        }

        async fn ping(&self) -> Result<()> {
            Ok(())
        }

        async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(sql, 0)])
        }
    }

    #[async_trait]
    impl DatabaseDriver for CollectionsDriver {
        async fn connect(&mut self) -> Result<()> {
            Ok(())
        }

        async fn disconnect(&self) -> Result<()> {
            Ok(())
        }

        async fn ping(&self) -> Result<()> {
            Ok(())
        }

        async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(sql, 0)])
        }

        async fn get_collections(&self, namespace: &str) -> Result<Vec<CollectionInfo>> {
            Ok(["session:1", "user:1", "user:2"]
                .into_iter()
                .map(|name| CollectionInfo {
                    name: name.to_string(),
                    namespace: Some(namespace.to_string()),
                    collection_type: None,
                    document_count: None,
                })
                .collect())
        }
    }

    #[tokio::test]
    async fn minimal_driver_can_rely_on_non_relational_defaults() {
        let driver = MinimalDriver;

        assert_eq!(driver.get_databases().await.unwrap(), Vec::<String>::new());
        assert_eq!(driver.get_schemas().await.unwrap(), Vec::<String>::new());
        assert_eq!(
            driver.get_database_schemas("app").await.unwrap(),
            Vec::<String>::new()
        );
        assert!(driver.get_tables("default").await.unwrap().is_empty());
        assert!(driver
            .get_database_tables("app", "default")
            .await
            .unwrap()
            .is_empty());
        assert!(driver.get_collections("default").await.unwrap().is_empty());
        assert!(driver
            .get_columns("default", "items")
            .await
            .unwrap()
            .is_empty());
        assert!(driver
            .get_indexes("default", "items")
            .await
            .unwrap()
            .is_empty());
        assert!(driver
            .get_constraints("default", "items")
            .await
            .unwrap()
            .is_empty());
        assert!(driver.get_functions("default").await.unwrap().is_empty());
        assert!(driver
            .get_database_functions("app", "default")
            .await
            .unwrap()
            .is_empty());
        assert!(driver.query_database("app", "SELECT 1").await.is_err());
        assert!(driver
            .query_database_with_context_tracked(Some("query-1"), "app", "SELECT 1", Some("public"))
            .await
            .is_err());
        assert!(driver
            .query_database_parameterized("app", "SELECT $1", &[])
            .await
            .is_err());
        assert!(driver
            .get_database_columns("app", "default", "items")
            .await
            .is_err());
        assert!(driver
            .get_database_indexes("app", "default", "items")
            .await
            .is_err());
        assert!(driver
            .get_database_constraints("app", "default", "items")
            .await
            .is_err());
        assert!(driver.set_current_schema("default").await.is_ok());
        assert!(!driver.cancel_query("query-1").await.unwrap());

        let result = driver
            .query_with_context("PING", "default")
            .await
            .expect("context query should delegate to query");
        assert_eq!(result[0].statement_type.as_deref(), Some("PING"));

        assert!(driver.begin_transaction("tx", None).await.is_err());
        assert!(driver
            .begin_database_transaction("tx", "other", None)
            .await
            .is_err());
        assert!(driver.query_transaction("tx", "PING").await.is_err());
        assert!(driver
            .execute_parameterized_transaction("tx", &[])
            .await
            .is_err());
        assert!(driver.commit_transaction("tx").await.is_err());
        assert!(driver.rollback_transaction("tx").await.is_err());
    }

    #[tokio::test]
    async fn default_collection_pages_filter_before_paginating() {
        let driver = CollectionsDriver;

        let first = driver
            .get_collections_page("default", None, 1, Some("user:"))
            .await
            .unwrap();
        assert_eq!(first.total, Some(2));
        assert_eq!(first.next_cursor.as_deref(), Some("1"));
        assert_eq!(first.items[0].name, "user:1");

        let second = driver
            .get_collections_page("default", first.next_cursor.as_deref(), 1, Some("user:"))
            .await
            .unwrap();
        assert_eq!(second.next_cursor, None);
        assert_eq!(second.items[0].name, "user:2");
    }
}
