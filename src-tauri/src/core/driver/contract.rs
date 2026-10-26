use super::super::statement::StatementScanDialect;
use super::super::{
    dialect::DatabaseCapabilities,
    protocol::{
        CollectionInfo, ColumnInfo, ConstraintInfo, DatabaseCreateRequest, DatabaseInfo,
        ForeignKeyReferenceInfo, FunctionInfo, IndexInfo, NacosConfigPublishReceipt,
        NacosConfigPublishRequest, NacosConfigSnapshot, NativeQueryPage, ParameterizedStatement,
        QueryParameter, QueryResult, SchemaObjectInfo, TableInfo,
    },
};
use super::models::*;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use oxide_driver_protocol::{
    SchemaMigrationApplyRequest, SchemaMigrationApplyResult, SchemaMigrationMode,
    SchemaMigrationPlanRequest, SchemaMigrationPlanResult, SchemaMigrationPreflightRequest,
    SchemaMigrationPreflightResult, SchemaMigrationVerifyRequest, SchemaMigrationVerifyResult,
};
use std::path::Path;

fn unsupported_driver_feature(feature: &str) -> anyhow::Error {
    anyhow!("{feature} is not implemented for this driver")
}

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    /// Resolve the effective session default in a selected database. A missing
    /// contract remains unknown; never infer this from a selected namespace.
    async fn sql_lookup_context(
        &self,
        _database: Option<&str>,
    ) -> Result<Option<oxide_driver_protocol::SqlLookupContext>> {
        Ok(None)
    }

    /// Execute a typed find operation, without accepting commands or pipelines.
    async fn read_documents_read_only(
        &self,
        _request: crate::core::document_read::DocumentReadRequest<'_>,
    ) -> Result<crate::core::document_read::DocumentReadPage> {
        Err(unsupported_driver_feature("Read-only document queries"))
    }

    /// Managed enterprise drivers use a remote policy-enforcing data plane.
    /// Consumers must not classify them as bundled/local merely because the
    /// underlying database dialect is PostgreSQL or MySQL.
    fn is_managed_data_source(&self) -> bool {
        false
    }

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

    /// Explicitly recreate an exited connection-owned sidecar while retaining
    /// the already validated in-memory connection configuration. The manager
    /// applies the reconnect budget before calling this hook. `Ok(false)` means
    /// the runtime is healthy or this driver does not own a reconnectable
    /// external process.
    async fn reconnect_external_runtime(&self) -> Result<bool> {
        Ok(false)
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

    /// Create a consistent native backup of a local file database. Drivers
    /// must override this explicitly; a renderer-selected product id never
    /// enables the capability by itself.
    async fn backup_local_database(&self, _destination: &Path) -> Result<LocalDatabaseFileReceipt> {
        Err(unsupported_driver_feature("Local database backup"))
    }

    async fn backup_local_database_controlled(
        &self,
        destination: &Path,
        control: &LocalDatabaseBackupControl,
    ) -> Result<LocalDatabaseFileReceipt> {
        if control.is_cancelled() {
            return Err(anyhow!("Local database backup was cancelled"));
        }
        let receipt = self.backup_local_database(destination).await?;
        control.set_progress_percent(100);
        Ok(receipt)
    }

    /// Restore a local file database through the live driver's native backup
    /// boundary. Implementations must not copy over an open database file.
    async fn restore_local_database(&self, _source: &Path) -> Result<LocalDatabaseFileReceipt> {
        Err(unsupported_driver_feature("Local database restore"))
    }

    /// Execute a query and return generic result set
    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>>;

    /// Start a bounded, driver-owned native cursor. SQL drivers which only
    /// support materialized result sets retain the default unsupported result;
    /// callers must not emulate this with generated LIMIT/OFFSET SQL.
    async fn query_native_page(
        &self,
        _query_id: Option<&str>,
        _sql: &str,
        _page_size: u32,
        _max_rows: Option<u32>,
    ) -> Result<NativeQueryPage> {
        Err(unsupported_driver_feature("Native query pagination"))
    }

    /// Continue a page from the same native driver cursor.
    async fn fetch_native_query_page(
        &self,
        _query_id: Option<&str>,
        _cursor: &str,
        _page_size: u32,
    ) -> Result<NativeQueryPage> {
        Err(unsupported_driver_feature("Native query pagination"))
    }

    /// Release a native query cursor. This operation is idempotent at the
    /// driver boundary so tab disposal and reconnect cleanup can race safely.
    async fn close_native_query_page(&self, _cursor: &str) -> Result<()> {
        Err(unsupported_driver_feature("Native query pagination"))
    }

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

    /// Execute an approved SQLite rebuild against one physical connection.
    /// Implementations must publish a verified backup before the first schema
    /// mutation, run every statement in one transaction, reject any
    /// `foreign_key_check` row, and restore the connection's original
    /// `foreign_keys` setting before returning.
    async fn execute_sqlite_rebuild_batch(
        &self,
        _statements: &[ParameterizedStatement],
        _backup_destination: &Path,
    ) -> Result<SqliteRebuildReceipt> {
        Err(unsupported_driver_feature("SQLite atomic schema rebuild"))
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

    /// Get optional database catalog metadata. The default is deliberately
    /// generic so every signed external driver remains compatible.
    async fn get_database_metadata(&self) -> Result<Vec<DatabaseInfo>> {
        Ok(self
            .get_databases()
            .await?
            .into_iter()
            .map(|name| DatabaseInfo {
                name,
                ..DatabaseInfo::default()
            })
            .collect())
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

    /// Lazily list child descriptors of an explicitly expandable schema
    /// object. This is metadata only; returning children never grants table,
    /// grid, source or mutation capabilities to the parent object.
    async fn get_schema_object_members(
        &self,
        _schema: &str,
        _object_name: &str,
        _object_type: &str,
    ) -> Result<Vec<SchemaObjectInfo>> {
        Ok(Vec::new())
    }

    /// Database-scoped counterpart of `get_schema_object_members`.
    async fn get_database_schema_object_members(
        &self,
        _database: &str,
        schema: &str,
        object_name: &str,
        object_type: &str,
    ) -> Result<Vec<SchemaObjectInfo>> {
        self.get_schema_object_members(schema, object_name, object_type)
            .await
    }

    /// Return a driver-owned, read-only source definition. External packages
    /// must opt in explicitly rather than receiving Host catalog SQL.
    async fn get_object_source(
        &self,
        _schema: &str,
        _object_name: &str,
        _object_type: &str,
        _relation_name: Option<&str>,
    ) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    /// Read a complete relation definition through a driver-owned metadata
    /// boundary, preserving the explicitly selected database identity.
    async fn get_table_definition(
        &self,
        _database: Option<&str>,
        _schema: &str,
        _table: &str,
    ) -> Result<String> {
        Err(unsupported_driver_feature("Relation definition metadata"))
    }

    /// Fresh, concrete-table enterprise permissions. Local drivers return None.
    async fn managed_table_permissions(
        &self,
        _database: Option<&str>,
        _schema: &str,
        _table: &str,
    ) -> Result<Option<ManagedTablePermissions>> {
        Ok(None)
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

    /// Read one bounded page of documents from a native document/search
    /// object. This is deliberately separate from relational table paging and
    /// arbitrary query execution so a product can own its cursor semantics.
    async fn get_document_page(
        &self,
        _request: DocumentPageRequest<'_>,
    ) -> Result<crate::core::protocol::DocumentPage> {
        Err(anyhow::anyhow!(
            "Native document pagination is not supported by this driver"
        ))
    }

    /// Read a bounded batch for a cross-connection document collection
    /// transfer. The transfer protocol is intentionally opt-in: a driver that
    /// cannot preserve its native values must remain read-only here.
    async fn read_document_transfer_batch(
        &self,
        _request: DocumentTransferReadRequest<'_>,
    ) -> Result<DocumentTransferBatch> {
        Err(unsupported_driver_feature(
            "Native document collection transfer",
        ))
    }

    /// Insert a bounded batch previously read through the native collection
    /// transfer protocol. This is not exposed as arbitrary desktop JSON
    /// mutation and is only reachable after a reviewed transfer plan.
    async fn write_document_transfer_batch(
        &self,
        _request: DocumentTransferWriteRequest<'_>,
    ) -> Result<DocumentTransferWriteReceipt> {
        Err(unsupported_driver_feature(
            "Native document collection transfer",
        ))
    }

    /// Clear a target collection as the destructive first step of an
    /// explicitly confirmed overwrite transfer. Drivers must not emulate this
    /// through arbitrary text execution.
    async fn clear_document_transfer_collection(
        &self,
        _request: DocumentTransferClearRequest<'_>,
    ) -> Result<DocumentTransferClearReceipt> {
        Err(unsupported_driver_feature(
            "Native document collection transfer",
        ))
    }

    /// Prepare a native document clone while preserving values which were not
    /// edited in the desktop. Drivers must override this explicitly; generic
    /// JSON or relational mutation paths are not an acceptable fallback.
    async fn prepare_document_clone(
        &self,
        _request: DocumentCloneRequest<'_>,
    ) -> Result<PreparedDocumentClone> {
        Err(unsupported_driver_feature("Native document cloning"))
    }

    /// Insert the prepared clone after re-reading the source document. The
    /// source digest binds execution to the exact document reviewed by the
    /// user and prevents a stale preview from silently cloning newer data.
    async fn execute_document_clone(
        &self,
        _request: DocumentCloneRequest<'_>,
        _expected_source_digest: &str,
    ) -> Result<DocumentCloneReceipt> {
        Err(unsupported_driver_feature("Native document cloning"))
    }

    /// Build an exact replacement preview from the source's native value
    /// model. Generic JSON mutation is intentionally not a fallback.
    async fn prepare_document_edit(
        &self,
        _request: DocumentEditRequest<'_>,
    ) -> Result<PreparedDocumentEdit> {
        Err(unsupported_driver_feature("Native document editing"))
    }

    /// Replace the exact source reviewed by the user. Implementations must
    /// fail if the source changes before the atomic database mutation.
    async fn execute_document_edit(
        &self,
        _request: DocumentEditRequest<'_>,
        _expected_source_digest: &str,
    ) -> Result<DocumentEditReceipt> {
        Err(unsupported_driver_feature("Native document editing"))
    }

    async fn prepare_document_delete(
        &self,
        _request: DocumentDeleteRequest<'_>,
    ) -> Result<PreparedDocumentDelete> {
        Err(unsupported_driver_feature("Native document deletion"))
    }

    /// Delete only the exact source reviewed by the user. A lookup followed
    /// by an `_id`-only delete is not sufficient because it leaves a race.
    async fn execute_document_delete(
        &self,
        _request: DocumentDeleteRequest<'_>,
        _expected_source_digest: &str,
    ) -> Result<DocumentDeleteReceipt> {
        Err(unsupported_driver_feature("Native document deletion"))
    }

    /// Release resources held by a native document cursor. Stateless cursor
    /// implementations may keep the default no-op behavior.
    async fn close_document_cursor(&self, _cursor: &str) -> Result<()> {
        Ok(())
    }

    /// Read one closed, driver-owned metadata endpoint for a search index.
    /// Generic query execution is intentionally not used as a fallback.
    async fn get_search_index_metadata(
        &self,
        _index: &str,
        _kind: crate::core::protocol::SearchIndexMetadataKind,
    ) -> Result<serde_json::Value> {
        Err(unsupported_driver_feature("Search index metadata"))
    }

    /// Delete documents while retaining the index, mapping, settings, and
    /// aliases. Drivers must explicitly own this mutation contract.
    async fn clear_search_index_documents(
        &self,
        _index: &str,
    ) -> Result<crate::core::protocol::SearchIndexClearResult> {
        Err(unsupported_driver_feature("Search index clear"))
    }

    /// Read the full native configuration for a reviewed Nacos migration.
    /// This is deliberately not implemented through the generic query path,
    /// whose explorer response can be truncated.
    async fn get_nacos_config_snapshot(
        &self,
        _data_id: &str,
        _group: &str,
        _tenant: &str,
    ) -> Result<Option<NacosConfigSnapshot>> {
        Err(unsupported_driver_feature("Nacos configuration migration"))
    }

    /// Publish one reviewed Nacos configuration. Only the dedicated migration
    /// command may invoke this native operation; generic query text remains
    /// read-only.
    async fn publish_nacos_config(
        &self,
        _request: NacosConfigPublishRequest<'_>,
    ) -> Result<NacosConfigPublishReceipt> {
        Err(unsupported_driver_feature("Nacos configuration migration"))
    }

    /// Get columns for a specific table
    async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
        Ok(Vec::new())
    }

    /// Column names whose values are computed by the database and therefore
    /// must not be written back by a replayable SQL INSERT export. Drivers
    /// return an empty list unless they can determine this from an exact
    /// catalog contract; the host never guesses from type or default text.
    async fn get_generated_columns(&self, _schema: &str, _table: &str) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    /// Get generated columns for a table in an explicitly selected server database.
    /// Drivers without database-scoped metadata can safely fall back to their
    /// connection-scoped catalog implementation.
    async fn get_database_generated_columns(
        &self,
        _database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<String>> {
        self.get_generated_columns(schema, table).await
    }

    /// Whether replaying explicit values requires a dialect-owned identity
    /// override clause. The default remains false so external and unrelated
    /// drivers never inherit PostgreSQL syntax from a broad family mapping.
    async fn sql_export_requires_identity_override(
        &self,
        _schema: &str,
        _table: &str,
    ) -> Result<bool> {
        Ok(false)
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
