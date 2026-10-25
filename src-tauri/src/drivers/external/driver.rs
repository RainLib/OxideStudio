use crate::core::{
    driver::DatabaseDriver,
    protocol::{
        CollectionInfo, CollectionPage, ColumnInfo, ConstraintInfo, DatabaseCreateRequest,
        ForeignKeyReferenceInfo, FunctionInfo, IndexInfo, NativeQueryPage, ParameterizedStatement,
        QueryParameter, QueryResult, TableInfo,
    },
    statement::StatementScanDialect,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use oxide_driver_protocol::{
    DatabaseCreateRequest as SidecarDatabaseCreateRequest, DriverQueryContext, DriverRequest,
    DriverResult, MetadataRequest, SchemaMigrationApplyRequest, SchemaMigrationApplyResult,
    SchemaMigrationMode, SchemaMigrationPlanRequest, SchemaMigrationPlanResult,
    SchemaMigrationPreflightRequest, SchemaMigrationPreflightResult, SchemaMigrationVerifyRequest,
    SchemaMigrationVerifyResult,
};
use std::time::Duration;

use super::conversions::{
    allows_database_creation, allows_database_scoped_queries, external_statement_scan_dialect,
    sidecar_parameters,
};
use super::migration::{
    validate_migration_fingerprint, validate_migration_token,
    validate_schema_migration_apply_result, validate_schema_migration_plan_result,
    validate_schema_migration_preflight_result, validate_schema_migration_verify_result,
    validate_semantic_snapshot,
};
use super::models::{
    ExternalDriver, CONNECTION_TIMEOUT, MIGRATION_APPLY_TIMEOUT, MIGRATION_PLAN_TIMEOUT,
    MIGRATION_PREFLIGHT_TIMEOUT, MIGRATION_VERIFY_TIMEOUT, QUERY_TIMEOUT,
};

#[async_trait]
impl DatabaseDriver for ExternalDriver {
    async fn sql_lookup_context(
        &self,
        database: Option<&str>,
    ) -> Result<Option<oxide_driver_protocol::SqlLookupContext>> {
        if !self.capabilities.lock().await.sql_lookup_context {
            return Ok(None);
        }
        let context: Option<oxide_driver_protocol::SqlLookupContext> = self
            .metadata(MetadataRequest::SqlLookupContext {
                database: database.map(str::to_owned),
            })
            .await?;
        super::lookup_context::validate_context(context, database)
    }

    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        external_statement_scan_dialect(
            &self.package.manifest.driver_id,
            self.package
                .manifest
                .capabilities
                .as_ref()
                .map(|capabilities| capabilities.lsp_language_id.as_str()),
        )
    }

    fn external_package_identity(&self) -> Option<(&str, &str)> {
        Some(self.package_identity())
    }

    async fn external_runtime_process_id(&self) -> Option<u32> {
        let sidecar = self.process.lock().await.as_ref().cloned();
        match sidecar {
            Some(sidecar) => sidecar.process_id().await,
            None => None,
        }
    }

    async fn external_runtime_is_healthy(&self) -> Option<bool> {
        let sidecar = self.process.lock().await.as_ref().cloned();
        match sidecar {
            Some(sidecar) => Some(sidecar.is_running().await),
            None => None,
        }
    }

    async fn reconnect_external_runtime(&self) -> Result<bool> {
        let mut process = self.process.lock().await;
        let Some(current) = process.as_ref().cloned() else {
            return Ok(false);
        };
        if current.is_running().await {
            return Ok(false);
        }
        current.terminate().await;
        *process = None;
        *self.server_version.lock().await = None;
        *self.capabilities.lock().await = Default::default();
        match self.start_connected_sidecar().await {
            Ok(replacement) => {
                *process = Some(replacement);
                Ok(true)
            }
            Err(error) => {
                // Retain the terminated handle as an observable unhealthy
                // runtime so a bounded later retry remains possible. No
                // connection config or sidecar output leaves this object.
                *process = Some(current);
                Err(error)
            }
        }
    }

    fn package_capabilities(&self) -> Option<crate::core::dialect::DatabaseCapabilities> {
        self.package.manifest.capabilities.clone()
    }

    fn semantic_schema_migration_mode(&self) -> Option<SchemaMigrationMode> {
        if self.agent_read_only {
            return None;
        }
        self.package
            .manifest
            .schema_migration
            .as_ref()
            .filter(|contract| contract.snapshot_version == 1)
            .map(|contract| contract.mode)
    }

    fn has_exact_semantic_schema_migration_evidence(&self, server_version: Option<&str>) -> bool {
        !self.agent_read_only
            && server_version
                .is_some_and(|version| self.package.has_exact_migration_evidence(version))
    }

    async fn server_version(&self) -> Option<String> {
        self.server_version.lock().await.clone()
    }

    async fn connect(&mut self) -> Result<()> {
        let mut process = self.process.lock().await;
        if process.is_some() {
            return Ok(());
        }
        *process = Some(self.start_connected_sidecar().await?);
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        let mut process = self.process.lock().await;
        let Some(sidecar) = process.take() else {
            return Ok(());
        };
        let result = sidecar
            .request(
                DriverRequest::Disconnect {
                    connection_id: self.connection_id.clone(),
                },
                CONNECTION_TIMEOUT,
            )
            .await;
        let _ = sidecar
            .request(DriverRequest::Shutdown, Duration::from_secs(2))
            .await;
        sidecar.terminate().await;
        *self.server_version.lock().await = None;
        *self.capabilities.lock().await = Default::default();
        result.map(|_| ()).map_err(|error| anyhow!(error))
    }

    async fn ping(&self) -> Result<()> {
        match self
            .request(
                DriverRequest::Ping {
                    connection_id: self.connection_id.clone(),
                },
                CONNECTION_TIMEOUT,
            )
            .await?
        {
            DriverResult::Empty | DriverResult::Boolean(true) => Ok(()),
            DriverResult::Boolean(false) => Err(anyhow!("External driver ping failed")),
            _ => Err(anyhow!("External driver returned an invalid ping response")),
        }
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        self.query_with_context(None, sql, DriverQueryContext::default())
            .await
    }

    async fn query_native_page(
        &self,
        query_id: Option<&str>,
        sql: &str,
        page_size: u32,
        max_rows: Option<u32>,
    ) -> Result<NativeQueryPage> {
        self.query_native_page_with_context(
            query_id,
            sql,
            DriverQueryContext::default(),
            page_size,
            max_rows,
        )
        .await
    }

    async fn fetch_native_query_page(
        &self,
        query_id: Option<&str>,
        cursor: &str,
        page_size: u32,
    ) -> Result<NativeQueryPage> {
        self.fetch_native_query_page_with_context(query_id, cursor, page_size)
            .await
    }

    async fn close_native_query_page(&self, cursor: &str) -> Result<()> {
        self.close_native_query_page_with_context(cursor).await
    }

    async fn query_database(&self, database: &str, sql: &str) -> Result<Vec<QueryResult>> {
        self.query_database_with_context_tracked(None, database, sql, None)
            .await
    }

    async fn query_tracked(&self, query_id: Option<&str>, sql: &str) -> Result<Vec<QueryResult>> {
        self.query_with_context(query_id, sql, DriverQueryContext::default())
            .await
    }

    async fn execute_parameterized(&self, sql: &str, params: &[QueryParameter]) -> Result<u64> {
        let results = self
            .query_with_context_and_parameters(
                None,
                sql,
                sidecar_parameters(params),
                DriverQueryContext::default(),
            )
            .await?;
        Ok(results
            .iter()
            .filter_map(|result| result.rows_affected)
            .sum())
    }

    async fn query_parameterized(
        &self,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        self.query_with_context_and_parameters(
            None,
            sql,
            sidecar_parameters(params),
            DriverQueryContext::default(),
        )
        .await
    }

    async fn query_database_parameterized(
        &self,
        database: &str,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        let runtime_capabilities = self.capabilities.lock().await.clone();
        if !allows_database_scoped_queries(
            self.package.manifest.capabilities.as_ref(),
            &runtime_capabilities,
        ) {
            return Err(anyhow!(
                "External driver package does not provide database-scoped queries"
            ));
        }
        self.query_with_context_and_parameters(
            None,
            sql,
            sidecar_parameters(params),
            DriverQueryContext {
                database: Some(database.to_string()),
                ..DriverQueryContext::default()
            },
        )
        .await
    }

    async fn execute_parameterized_batch(
        &self,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let transaction_id = format!("external-batch-{}", uuid::Uuid::new_v4());
        self.begin_sidecar_transaction(&transaction_id, None)
            .await?;
        let mut affected_rows = Vec::with_capacity(statements.len());
        for statement in statements {
            let result = self
                .query_with_context_and_parameters(
                    None,
                    &statement.sql,
                    sidecar_parameters(&statement.params),
                    DriverQueryContext {
                        transaction_id: Some(transaction_id.clone()),
                        ..DriverQueryContext::default()
                    },
                )
                .await;
            match result {
                Ok(results) => affected_rows.push(
                    results
                        .iter()
                        .filter_map(|result| result.rows_affected)
                        .sum(),
                ),
                Err(error) => {
                    let _ = self.rollback_transaction(&transaction_id).await;
                    return Err(error);
                }
            }
        }
        self.commit_transaction(&transaction_id).await?;
        Ok(affected_rows)
    }

    async fn query_with_context_tracked(
        &self,
        query_id: Option<&str>,
        sql: &str,
        schema: &str,
    ) -> Result<Vec<QueryResult>> {
        self.query_with_context(
            query_id,
            sql,
            DriverQueryContext {
                schema: Some(schema.to_string()),
                ..DriverQueryContext::default()
            },
        )
        .await
    }

    async fn query_database_with_context_tracked(
        &self,
        query_id: Option<&str>,
        database: &str,
        sql: &str,
        schema: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        let runtime_capabilities = self.capabilities.lock().await.clone();
        if !allows_database_scoped_queries(
            self.package.manifest.capabilities.as_ref(),
            &runtime_capabilities,
        ) {
            return Err(anyhow!(
                "External driver package does not provide database-scoped queries"
            ));
        }
        self.query_with_context(
            query_id,
            sql,
            DriverQueryContext {
                database: Some(database.to_string()),
                schema: schema.map(str::to_string),
                ..DriverQueryContext::default()
            },
        )
        .await
    }

    async fn create_database(&self, request: DatabaseCreateRequest) -> Result<()> {
        let runtime_capabilities = self.capabilities.lock().await.clone();
        if !allows_database_creation(
            self.package.manifest.capabilities.as_ref(),
            &runtime_capabilities,
        ) {
            return Err(anyhow!(
                "External driver package does not provide database creation"
            ));
        }
        match self
            .request(
                DriverRequest::CreateDatabase {
                    connection_id: self.connection_id.clone(),
                    request: SidecarDatabaseCreateRequest {
                        name: request.name,
                        charset: request.charset,
                        collation: request.collation,
                        owner: request.owner,
                        namespace_kind: request.namespace_kind,
                    },
                },
                QUERY_TIMEOUT,
            )
            .await?
        {
            DriverResult::Empty | DriverResult::Boolean(true) => Ok(()),
            DriverResult::Boolean(false) => {
                Err(anyhow!("External driver rejected database creation"))
            }
            _ => Err(anyhow!(
                "External driver returned an invalid database creation response"
            )),
        }
    }

    async fn plan_schema_migration(
        &self,
        request: SchemaMigrationPlanRequest,
    ) -> Result<SchemaMigrationPlanResult> {
        let mode = self.require_semantic_schema_migration().await?;
        validate_semantic_snapshot(&request.source, "Source schema")?;
        validate_semantic_snapshot(&request.target, "Target schema")?;
        let result = match self
            .request(
                DriverRequest::PlanSchemaMigration {
                    connection_id: self.connection_id.clone(),
                    request: request.clone(),
                },
                MIGRATION_PLAN_TIMEOUT,
            )
            .await?
        {
            DriverResult::SchemaMigrationPlan(result) => result,
            _ => {
                return Err(anyhow!(
                    "External driver returned an invalid semantic migration plan response"
                ));
            }
        };
        validate_schema_migration_plan_result(&request, mode, &result)?;
        Ok(result)
    }

    async fn preflight_schema_migration(
        &self,
        request: SchemaMigrationPreflightRequest,
    ) -> Result<SchemaMigrationPreflightResult> {
        self.require_semantic_schema_migration().await?;
        validate_migration_token(&request.plan_token, "semantic migration plan token")?;
        validate_migration_fingerprint(
            &request.target_fingerprint,
            "semantic migration target fingerprint",
        )?;
        let result = match self
            .request(
                DriverRequest::PreflightSchemaMigration {
                    connection_id: self.connection_id.clone(),
                    request: request.clone(),
                },
                MIGRATION_PREFLIGHT_TIMEOUT,
            )
            .await?
        {
            DriverResult::SchemaMigrationPreflight(result) => result,
            _ => {
                return Err(anyhow!(
                    "External driver returned an invalid semantic migration preflight response"
                ));
            }
        };
        validate_schema_migration_preflight_result(&request, &result)?;
        Ok(result)
    }

    async fn apply_schema_migration(
        &self,
        request: SchemaMigrationApplyRequest,
    ) -> Result<SchemaMigrationApplyResult> {
        self.require_semantic_schema_migration().await?;
        validate_migration_token(&request.plan_token, "semantic migration plan token")?;
        validate_migration_token(
            &request.preflight_token,
            "semantic migration preflight token",
        )?;
        validate_migration_fingerprint(
            &request.target_fingerprint,
            "semantic migration target fingerprint",
        )?;
        let result = match self
            .request(
                DriverRequest::ApplySchemaMigration {
                    connection_id: self.connection_id.clone(),
                    request,
                },
                MIGRATION_APPLY_TIMEOUT,
            )
            .await?
        {
            DriverResult::SchemaMigrationApply(result) => result,
            _ => {
                return Err(anyhow!(
                    "External driver returned an invalid semantic migration apply response"
                ));
            }
        };
        validate_schema_migration_apply_result(&result)?;
        Ok(result)
    }

    async fn verify_schema_migration(
        &self,
        request: SchemaMigrationVerifyRequest,
    ) -> Result<SchemaMigrationVerifyResult> {
        self.require_semantic_schema_migration().await?;
        validate_migration_token(&request.plan_token, "semantic migration plan token")?;
        validate_migration_token(&request.apply_token, "semantic migration apply token")?;
        validate_migration_fingerprint(
            &request.expected_source_fingerprint,
            "semantic migration expected source fingerprint",
        )?;
        let result = match self
            .request(
                DriverRequest::VerifySchemaMigration {
                    connection_id: self.connection_id.clone(),
                    request,
                },
                MIGRATION_VERIFY_TIMEOUT,
            )
            .await?
        {
            DriverResult::SchemaMigrationVerify(result) => result,
            _ => {
                return Err(anyhow!(
                    "External driver returned an invalid semantic migration verification response"
                ));
            }
        };
        validate_schema_migration_verify_result(&result)?;
        Ok(result)
    }

    async fn cancel_query(&self, query_id: &str) -> Result<bool> {
        if !self.capabilities.lock().await.cancellation {
            return Ok(false);
        }
        match self
            .request(
                DriverRequest::Cancel {
                    connection_id: self.connection_id.clone(),
                    query_id: query_id.to_string(),
                },
                CONNECTION_TIMEOUT,
            )
            .await?
        {
            DriverResult::Boolean(cancelled) => Ok(cancelled),
            DriverResult::Empty => Ok(true),
            _ => Err(anyhow!(
                "External driver returned an invalid cancellation response"
            )),
        }
    }

    async fn begin_transaction(&self, session_id: &str, schema: Option<&str>) -> Result<()> {
        self.begin_sidecar_transaction(session_id, schema).await
    }

    async fn begin_database_transaction(
        &self,
        session_id: &str,
        database: &str,
        schema: Option<&str>,
    ) -> Result<()> {
        self.begin_sidecar_database_transaction(session_id, database, schema)
            .await
    }

    async fn query_transaction(&self, session_id: &str, sql: &str) -> Result<Vec<QueryResult>> {
        self.query_with_context(
            None,
            sql,
            DriverQueryContext {
                transaction_id: Some(session_id.to_string()),
                ..DriverQueryContext::default()
            },
        )
        .await
    }

    async fn query_transaction_tracked(
        &self,
        query_id: Option<&str>,
        session_id: &str,
        sql: &str,
    ) -> Result<Vec<QueryResult>> {
        self.query_with_context(
            query_id,
            sql,
            DriverQueryContext {
                transaction_id: Some(session_id.to_string()),
                ..DriverQueryContext::default()
            },
        )
        .await
    }

    async fn execute_parameterized_transaction(
        &self,
        session_id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let mut affected_rows = Vec::with_capacity(statements.len());
        for statement in statements {
            let results = self
                .query_with_context_and_parameters(
                    None,
                    &statement.sql,
                    sidecar_parameters(&statement.params),
                    DriverQueryContext {
                        transaction_id: Some(session_id.to_string()),
                        ..DriverQueryContext::default()
                    },
                )
                .await?;
            affected_rows.push(
                results
                    .iter()
                    .filter_map(|result| result.rows_affected)
                    .sum(),
            );
        }
        Ok(affected_rows)
    }

    async fn commit_transaction(&self, session_id: &str) -> Result<()> {
        match self
            .request(
                DriverRequest::CommitTransaction {
                    connection_id: self.connection_id.clone(),
                    transaction_id: session_id.to_string(),
                },
                CONNECTION_TIMEOUT,
            )
            .await?
        {
            DriverResult::Empty | DriverResult::Boolean(true) => Ok(()),
            DriverResult::Boolean(false) => {
                Err(anyhow!("External driver refused transaction commit"))
            }
            _ => Err(anyhow!(
                "External driver returned an invalid transaction response"
            )),
        }
    }

    async fn rollback_transaction(&self, session_id: &str) -> Result<()> {
        match self
            .request(
                DriverRequest::RollbackTransaction {
                    connection_id: self.connection_id.clone(),
                    transaction_id: session_id.to_string(),
                },
                CONNECTION_TIMEOUT,
            )
            .await?
        {
            DriverResult::Empty | DriverResult::Boolean(true) => Ok(()),
            DriverResult::Boolean(false) => {
                Err(anyhow!("External driver refused transaction rollback"))
            }
            _ => Err(anyhow!(
                "External driver returned an invalid transaction response"
            )),
        }
    }

    async fn get_databases(&self) -> Result<Vec<String>> {
        self.metadata(MetadataRequest::Databases).await
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        self.metadata(MetadataRequest::Schemas { database: None })
            .await
    }

    async fn get_database_schemas(&self, database: &str) -> Result<Vec<String>> {
        self.metadata(MetadataRequest::Schemas {
            database: Some(database.to_string()),
        })
        .await
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        self.metadata(MetadataRequest::Relations {
            database: None,
            namespace: schema.to_string(),
        })
        .await
    }

    async fn get_database_tables(&self, database: &str, schema: &str) -> Result<Vec<TableInfo>> {
        self.metadata(MetadataRequest::Relations {
            database: Some(database.to_string()),
            namespace: schema.to_string(),
        })
        .await
    }

    async fn get_collections(&self, namespace: &str) -> Result<Vec<CollectionInfo>> {
        self.metadata(MetadataRequest::Collections {
            namespace: namespace.to_string(),
            cursor: None,
            limit: Some(1_000),
            filter: None,
        })
        .await
    }

    async fn get_collections_page(
        &self,
        namespace: &str,
        cursor: Option<&str>,
        limit: usize,
        filter: Option<&str>,
    ) -> Result<CollectionPage> {
        self.metadata(MetadataRequest::Collections {
            namespace: namespace.to_string(),
            cursor: cursor.map(str::to_string),
            limit: Some(u32::try_from(limit.min(u32::MAX as usize)).unwrap_or(u32::MAX)),
            filter: filter.map(str::to_string),
        })
        .await
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        self.metadata(MetadataRequest::Columns {
            database: None,
            namespace: schema.to_string(),
            relation: table.to_string(),
        })
        .await
    }

    async fn get_database_columns(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        self.metadata(MetadataRequest::Columns {
            database: Some(database.to_string()),
            namespace: schema.to_string(),
            relation: table.to_string(),
        })
        .await
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
        self.metadata(MetadataRequest::Indexes {
            database: None,
            namespace: schema.to_string(),
            relation: table.to_string(),
        })
        .await
    }

    async fn get_database_indexes(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>> {
        self.metadata(MetadataRequest::Indexes {
            database: Some(database.to_string()),
            namespace: schema.to_string(),
            relation: table.to_string(),
        })
        .await
    }

    async fn get_constraints(&self, schema: &str, table: &str) -> Result<Vec<ConstraintInfo>> {
        self.metadata(MetadataRequest::Constraints {
            database: None,
            namespace: schema.to_string(),
            relation: table.to_string(),
        })
        .await
    }

    async fn get_database_constraints(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>> {
        self.metadata(MetadataRequest::Constraints {
            database: Some(database.to_string()),
            namespace: schema.to_string(),
            relation: table.to_string(),
        })
        .await
    }

    async fn get_referencing_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        let signed_support = self
            .package
            .manifest
            .capabilities
            .as_ref()
            .is_some_and(|capabilities| capabilities.supports_foreign_keys);
        if !signed_support || !self.capabilities.lock().await.referencing_foreign_keys {
            return Ok(Vec::new());
        }
        self.metadata(MetadataRequest::ReferencingForeignKeys {
            database: None,
            namespace: schema.to_string(),
            relation: table.to_string(),
        })
        .await
    }

    async fn get_database_referencing_foreign_keys(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        let signed_support = self
            .package
            .manifest
            .capabilities
            .as_ref()
            .is_some_and(|capabilities| capabilities.supports_foreign_keys);
        if !signed_support || !self.capabilities.lock().await.referencing_foreign_keys {
            return Ok(Vec::new());
        }
        self.metadata(MetadataRequest::ReferencingForeignKeys {
            database: Some(database.to_string()),
            namespace: schema.to_string(),
            relation: table.to_string(),
        })
        .await
    }

    async fn get_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>> {
        self.metadata(MetadataRequest::Routines {
            database: None,
            namespace: schema.to_string(),
        })
        .await
    }

    async fn get_database_functions(
        &self,
        database: &str,
        schema: &str,
    ) -> Result<Vec<FunctionInfo>> {
        self.metadata(MetadataRequest::Routines {
            database: Some(database.to_string()),
            namespace: schema.to_string(),
        })
        .await
    }

    async fn get_schema_objects(
        &self,
        schema: &str,
    ) -> Result<Vec<crate::core::protocol::SchemaObjectInfo>> {
        if !self.capabilities.lock().await.schema_objects {
            return Ok(Vec::new());
        }
        self.metadata(MetadataRequest::SchemaObjects {
            database: None,
            namespace: schema.to_string(),
        })
        .await
    }

    async fn get_database_schema_objects(
        &self,
        database: &str,
        schema: &str,
    ) -> Result<Vec<crate::core::protocol::SchemaObjectInfo>> {
        if !self.capabilities.lock().await.schema_objects {
            return Ok(Vec::new());
        }
        self.metadata(MetadataRequest::SchemaObjects {
            database: Some(database.to_string()),
            namespace: schema.to_string(),
        })
        .await
    }

    async fn get_schema_object_members(
        &self,
        schema: &str,
        object_name: &str,
        object_type: &str,
    ) -> Result<Vec<crate::core::protocol::SchemaObjectInfo>> {
        let capabilities = self.capabilities.lock().await;
        if !capabilities.schema_objects || !capabilities.schema_object_members {
            return Ok(Vec::new());
        }
        drop(capabilities);
        self.metadata(MetadataRequest::SchemaObjectMembers {
            database: None,
            namespace: schema.to_string(),
            object_name: object_name.to_string(),
            object_type: object_type.to_string(),
        })
        .await
    }

    async fn get_database_schema_object_members(
        &self,
        database: &str,
        schema: &str,
        object_name: &str,
        object_type: &str,
    ) -> Result<Vec<crate::core::protocol::SchemaObjectInfo>> {
        let capabilities = self.capabilities.lock().await;
        if !capabilities.schema_objects || !capabilities.schema_object_members {
            return Ok(Vec::new());
        }
        drop(capabilities);
        self.metadata(MetadataRequest::SchemaObjectMembers {
            database: Some(database.to_string()),
            namespace: schema.to_string(),
            object_name: object_name.to_string(),
            object_type: object_type.to_string(),
        })
        .await
    }

    async fn get_object_source(
        &self,
        schema: &str,
        object_name: &str,
        object_type: &str,
        relation_name: Option<&str>,
    ) -> Result<Vec<String>> {
        let capabilities = self.capabilities.lock().await;
        // `schema_objects` was the original opt-in and remains accepted for
        // already-published sidecars. New packages can expose source for
        // ordinary relations without falsely claiming a descriptor tree.
        if !capabilities.object_source && !capabilities.schema_objects {
            return Ok(Vec::new());
        }
        drop(capabilities);
        self.metadata(MetadataRequest::ObjectSource {
            database: None,
            namespace: schema.to_string(),
            object_name: object_name.to_string(),
            object_type: object_type.to_string(),
            relation_name: relation_name.map(str::to_string),
        })
        .await
    }
}
