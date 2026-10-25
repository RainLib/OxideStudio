use super::models::ConnectionManager;
use crate::core::{
    dialect::DatabaseCapabilities,
    driver::DocumentPageRequest,
    protocol::{
        ColumnInfo, ConstraintInfo, DatabaseCreateRequest, ForeignKeyReferenceInfo, FunctionInfo,
        IndexInfo, ParameterizedStatement, QueryParameter,
    },
};
use anyhow::{anyhow, Result};
use oxide_driver_protocol::{
    SchemaMigrationApplyRequest, SchemaMigrationApplyResult, SchemaMigrationMode,
    SchemaMigrationPlanRequest, SchemaMigrationPlanResult, SchemaMigrationPreflightRequest,
    SchemaMigrationPreflightResult, SchemaMigrationVerifyRequest, SchemaMigrationVerifyResult,
};

impl ConnectionManager {
    pub async fn statement_scan_dialect(
        &self,
        id: &str,
    ) -> Result<Option<crate::core::statement::StatementScanDialect>> {
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
    ) -> Result<Vec<crate::core::protocol::QueryResult>> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async {
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
            })
            .await
    }

    pub async fn query_native_page(
        &self,
        id: &str,
        query_id: Option<&str>,
        sql: &str,
        page_size: u32,
        max_rows: Option<u32>,
    ) -> Result<crate::core::protocol::NativeQueryPage> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async {
                driver
                    .query_native_page(query_id, sql, page_size, max_rows)
                    .await
            })
            .await
    }

    pub async fn fetch_native_query_page(
        &self,
        id: &str,
        query_id: Option<&str>,
        cursor: &str,
        page_size: u32,
    ) -> Result<crate::core::protocol::NativeQueryPage> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async {
                driver
                    .fetch_native_query_page(query_id, cursor, page_size)
                    .await
            })
            .await
    }

    pub async fn close_native_query_page(&self, id: &str, cursor: &str) -> Result<()> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async { driver.close_native_query_page(cursor).await })
            .await
    }

    pub async fn cancel_query(&self, id: &str, query_id: &str) -> Result<bool> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async { driver.cancel_query(query_id).await })
            .await
    }

    pub async fn execute_parameterized(
        &self,
        id: &str,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<u64> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async { driver.execute_parameterized(sql, params).await })
            .await
    }

    pub async fn create_database(&self, id: &str, request: DatabaseCreateRequest) -> Result<()> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async { driver.create_database(request).await })
            .await
    }

    pub async fn plan_schema_migration(
        &self,
        id: &str,
        request: SchemaMigrationPlanRequest,
    ) -> Result<SchemaMigrationPlanResult> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async { driver.plan_schema_migration(request).await })
            .await
    }

    pub async fn preflight_schema_migration(
        &self,
        id: &str,
        request: SchemaMigrationPreflightRequest,
    ) -> Result<SchemaMigrationPreflightResult> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async { driver.preflight_schema_migration(request).await })
            .await
    }

    pub async fn apply_schema_migration(
        &self,
        id: &str,
        request: SchemaMigrationApplyRequest,
    ) -> Result<SchemaMigrationApplyResult> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async { driver.apply_schema_migration(request).await })
            .await
    }

    pub async fn verify_schema_migration(
        &self,
        id: &str,
        request: SchemaMigrationVerifyRequest,
    ) -> Result<SchemaMigrationVerifyResult> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async { driver.verify_schema_migration(request).await })
            .await
    }

    pub async fn query_parameterized(
        &self,
        id: &str,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<crate::core::protocol::QueryResult>> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async { driver.query_parameterized(sql, params).await })
            .await
    }

    /// Execute a query against one explicitly selected server database. This
    /// bypasses the connection's primary database and active schema context.
    pub async fn query_database(
        &self,
        id: &str,
        database: &str,
        sql: &str,
    ) -> Result<Vec<crate::core::protocol::QueryResult>> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async { driver.query_database(database, sql).await })
            .await
    }

    pub async fn query_database_with_context(
        &self,
        id: &str,
        database: &str,
        sql: &str,
        schema: Option<&str>,
        query_id: Option<&str>,
    ) -> Result<Vec<crate::core::protocol::QueryResult>> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async {
                driver
                    .query_database_with_context_tracked(query_id, database, sql, schema)
                    .await
            })
            .await
    }

    pub async fn query_database_parameterized(
        &self,
        id: &str,
        database: &str,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<crate::core::protocol::QueryResult>> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async {
                driver
                    .query_database_parameterized(database, sql, params)
                    .await
            })
            .await
    }

    pub async fn execute_parameterized_batch(
        &self,
        id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async { driver.execute_parameterized_batch(statements).await })
            .await
    }

    pub async fn execute_sqlite_rebuild_batch(
        &self,
        id: &str,
        statements: &[ParameterizedStatement],
        backup_destination: &std::path::Path,
    ) -> Result<crate::core::driver::SqliteRebuildReceipt> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async {
                driver
                    .execute_sqlite_rebuild_batch(statements, backup_destination)
                    .await
            })
            .await
    }

    pub async fn execute_database_parameterized_batch(
        &self,
        id: &str,
        database: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async {
                driver
                    .execute_database_parameterized_batch(database, statements)
                    .await
            })
            .await
    }

    pub async fn begin_transaction(
        &self,
        id: &str,
        transaction_id: &str,
        schema: Option<String>,
    ) -> Result<()> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run_transaction(transaction_id, true, async {
                driver
                    .begin_transaction(transaction_id, schema.as_deref())
                    .await
            })
            .await
    }

    pub async fn begin_database_transaction(
        &self,
        id: &str,
        transaction_id: &str,
        database: &str,
        schema: Option<String>,
    ) -> Result<()> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run_transaction(transaction_id, true, async {
                driver
                    .begin_database_transaction(transaction_id, database, schema.as_deref())
                    .await
            })
            .await
    }

    pub async fn execute_parameterized_transaction(
        &self,
        id: &str,
        transaction_id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run(async {
                driver
                    .execute_parameterized_transaction(transaction_id, statements)
                    .await
            })
            .await
    }

    pub async fn commit_transaction(&self, id: &str, transaction_id: &str) -> Result<()> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run_transaction(transaction_id, false, async {
                driver.commit_transaction(transaction_id).await
            })
            .await
    }

    pub async fn rollback_transaction(&self, id: &str, transaction_id: &str) -> Result<()> {
        let (driver, operation) = self.get_observed_driver(id).await?;
        operation
            .run_transaction(transaction_id, false, async {
                driver.rollback_transaction(transaction_id).await
            })
            .await
    }

    /// Get databases visible from the connected server.
    pub async fn get_databases(&self, id: &str) -> Result<Vec<String>> {
        let driver = self.get_driver(id).await?;
        driver.get_databases().await
    }

    pub async fn get_database_metadata(
        &self,
        id: &str,
    ) -> Result<Vec<crate::core::protocol::DatabaseInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_database_metadata().await
    }

    /// Get schemas in the currently connected database.
    pub async fn sql_lookup_context(
        &self,
        id: &str,
        database: Option<&str>,
    ) -> Result<Option<oxide_driver_protocol::SqlLookupContext>> {
        self.get_driver(id)
            .await?
            .sql_lookup_context(database)
            .await
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
    ) -> Result<Vec<crate::core::protocol::SchemaObjectInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_database_schema_objects(database, schema).await
    }

    /// Get tables
    pub async fn get_tables(
        &self,
        id: &str,
        schema: &str,
    ) -> Result<Vec<crate::core::protocol::TableInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_tables(schema).await
    }

    pub async fn get_database_tables(
        &self,
        id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<crate::core::protocol::TableInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_database_tables(database, schema).await
    }

    /// Read-only descriptors for schema objects that are not tables/views.
    /// The driver remains the authority for which kinds it can expose.
    pub async fn get_schema_objects(
        &self,
        id: &str,
        schema: &str,
    ) -> Result<Vec<crate::core::protocol::SchemaObjectInfo>> {
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
    ) -> Result<Vec<crate::core::protocol::SchemaObjectInfo>> {
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
    ) -> Result<Vec<crate::core::protocol::SchemaObjectInfo>> {
        let driver = self.get_driver(id).await?;
        driver
            .get_database_schema_object_members(database, schema, object_name, object_type)
            .await
    }

    /// Retrieves a driver-owned source definition without permitting the Host
    /// to substitute a built-in driver's catalog grammar.
    pub async fn get_object_source(
        &self,
        id: &str,
        schema: &str,
        object_name: &str,
        object_type: &str,
        relation_name: Option<&str>,
    ) -> Result<Vec<String>> {
        let driver = self.get_driver(id).await?;
        driver
            .get_object_source(schema, object_name, object_type, relation_name)
            .await
    }

    pub async fn get_collections(
        &self,
        id: &str,
        namespace: &str,
    ) -> Result<Vec<crate::core::protocol::CollectionInfo>> {
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
    ) -> Result<crate::core::protocol::CollectionPage> {
        let driver = self.get_driver(id).await?;
        driver
            .get_collections_page(namespace, cursor, limit, filter)
            .await
    }

    pub async fn get_document_page(
        &self,
        id: &str,
        request: DocumentPageRequest<'_>,
    ) -> Result<crate::core::protocol::DocumentPage> {
        let driver = self.get_driver(id).await?;
        driver.get_document_page(request).await
    }

    pub async fn read_document_transfer_batch(
        &self,
        id: &str,
        request: crate::core::driver::DocumentTransferReadRequest<'_>,
    ) -> Result<crate::core::driver::DocumentTransferBatch> {
        let driver = self.get_driver(id).await?;
        driver.read_document_transfer_batch(request).await
    }

    pub async fn write_document_transfer_batch(
        &self,
        id: &str,
        request: crate::core::driver::DocumentTransferWriteRequest<'_>,
    ) -> Result<crate::core::driver::DocumentTransferWriteReceipt> {
        let driver = self.get_driver(id).await?;
        driver.write_document_transfer_batch(request).await
    }

    pub async fn clear_document_transfer_collection(
        &self,
        id: &str,
        request: crate::core::driver::DocumentTransferClearRequest<'_>,
    ) -> Result<crate::core::driver::DocumentTransferClearReceipt> {
        let driver = self.get_driver(id).await?;
        driver.clear_document_transfer_collection(request).await
    }

    pub async fn prepare_document_clone(
        &self,
        id: &str,
        request: crate::core::driver::DocumentCloneRequest<'_>,
    ) -> Result<crate::core::driver::PreparedDocumentClone> {
        let driver = self.get_driver(id).await?;
        driver.prepare_document_clone(request).await
    }

    pub async fn execute_document_clone(
        &self,
        id: &str,
        request: crate::core::driver::DocumentCloneRequest<'_>,
        expected_source_digest: &str,
    ) -> Result<crate::core::driver::DocumentCloneReceipt> {
        let driver = self.get_driver(id).await?;
        driver
            .execute_document_clone(request, expected_source_digest)
            .await
    }

    pub async fn prepare_document_edit(
        &self,
        connection_id: &str,
        request: crate::core::driver::DocumentEditRequest<'_>,
    ) -> Result<crate::core::driver::PreparedDocumentEdit> {
        let driver = self.get_driver(connection_id).await?;
        driver.prepare_document_edit(request).await
    }

    pub async fn execute_document_edit(
        &self,
        connection_id: &str,
        request: crate::core::driver::DocumentEditRequest<'_>,
        expected_source_digest: &str,
    ) -> Result<crate::core::driver::DocumentEditReceipt> {
        let driver = self.get_driver(connection_id).await?;
        driver
            .execute_document_edit(request, expected_source_digest)
            .await
    }

    pub async fn prepare_document_delete(
        &self,
        connection_id: &str,
        request: crate::core::driver::DocumentDeleteRequest<'_>,
    ) -> Result<crate::core::driver::PreparedDocumentDelete> {
        let driver = self.get_driver(connection_id).await?;
        driver.prepare_document_delete(request).await
    }

    pub async fn execute_document_delete(
        &self,
        connection_id: &str,
        request: crate::core::driver::DocumentDeleteRequest<'_>,
        expected_source_digest: &str,
    ) -> Result<crate::core::driver::DocumentDeleteReceipt> {
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
        kind: crate::core::protocol::SearchIndexMetadataKind,
    ) -> Result<serde_json::Value> {
        let driver = self.get_driver(id).await?;
        driver.get_search_index_metadata(index, kind).await
    }

    pub async fn clear_search_index_documents(
        &self,
        id: &str,
        index: &str,
    ) -> Result<crate::core::protocol::SearchIndexClearResult> {
        let driver = self.get_driver(id).await?;
        driver.clear_search_index_documents(index).await
    }

    pub async fn get_nacos_config_snapshot(
        &self,
        id: &str,
        data_id: &str,
        group: &str,
        tenant: &str,
    ) -> Result<Option<crate::core::protocol::NacosConfigSnapshot>> {
        self.get_driver(id)
            .await?
            .get_nacos_config_snapshot(data_id, group, tenant)
            .await
    }

    pub async fn publish_nacos_config(
        &self,
        id: &str,
        request: crate::core::protocol::NacosConfigPublishRequest<'_>,
    ) -> Result<crate::core::protocol::NacosConfigPublishReceipt> {
        self.get_driver(id)
            .await?
            .publish_nacos_config(request)
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
        let (driver, operation) = self.get_observed_driver(connection_id).await?;
        operation
            .run(async {
                driver.set_current_schema(schema).await?;

                let mut schemas = self.active_schemas.lock().await;
                schemas.insert(connection_id.to_string(), schema.to_string());

                Ok(())
            })
            .await
    }
}
