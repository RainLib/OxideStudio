use crate::core::{
    dialect::DatabaseKind,
    driver::DatabaseDriver,
    driver_package::{
        validate_server_version_compatibility, DatabaseDriverPackageRegistry,
        InstalledDriverPackage,
    },
    driver_sidecar::DatabaseDriverSidecar,
    protocol::{
        CollectionInfo, CollectionPage, ColumnDef, ColumnInfo, ConstraintInfo,
        DatabaseCreateRequest, ForeignKeyReferenceInfo, FunctionInfo, IndexInfo,
        ParameterizedStatement, QueryParameter, QueryResult, TableInfo,
    },
    statement::StatementScanDialect,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use oxide_driver_protocol::{
    DatabaseCreateRequest as SidecarDatabaseCreateRequest, DriverQueryContext,
    DriverQueryParameter, DriverQueryResult, DriverRequest, DriverResult, MetadataRequest,
    SecretConnectionConfig,
};
use serde::de::DeserializeOwned;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

const CONNECTION_TIMEOUT: Duration = Duration::from_secs(10);
const QUERY_TIMEOUT: Duration = Duration::from_secs(60);
const METADATA_TIMEOUT: Duration = Duration::from_secs(15);

/// A single connection-scoped sidecar. The sidecar is intentionally not shared
/// between saved connections, so a driver only receives the one selected secret.
pub struct ExternalDriver {
    package: InstalledDriverPackage,
    registry: DatabaseDriverPackageRegistry,
    connection_id: String,
    url: String,
    process: Mutex<Option<Arc<DatabaseDriverSidecar>>>,
    server_version: Mutex<Option<String>>,
    capabilities: Mutex<oxide_driver_protocol::DriverRuntimeCapabilities>,
    agent_read_only: bool,
}

impl ExternalDriver {
    pub fn new(
        package: InstalledDriverPackage,
        registry: DatabaseDriverPackageRegistry,
        connection_id: String,
        url: String,
    ) -> Self {
        Self {
            package,
            registry,
            connection_id,
            url,
            process: Mutex::new(None),
            server_version: Mutex::new(None),
            capabilities: Mutex::new(Default::default()),
            agent_read_only: false,
        }
    }

    /// Creates an Agent-only sidecar connection. Every query carries the
    /// protocol read-only flag and startup rejects packages that do not
    /// enforce that flag inside their own execution boundary.
    pub fn new_agent_read_only(
        package: InstalledDriverPackage,
        registry: DatabaseDriverPackageRegistry,
        connection_id: String,
        url: String,
    ) -> Self {
        Self {
            agent_read_only: true,
            ..Self::new(package, registry, connection_id, url)
        }
    }

    pub fn package_identity(&self) -> (&str, &str) {
        (
            &self.package.manifest.driver_id,
            &self.package.manifest.package_version,
        )
    }

    async fn request(&self, request: DriverRequest, timeout: Duration) -> Result<DriverResult> {
        let sidecar = self
            .process
            .lock()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| anyhow!("External driver sidecar is not connected"))?;
        sidecar
            .request(request, timeout)
            .await
            .map_err(|error| anyhow!(redact_driver_error(&error, &self.url)))
    }

    async fn query_with_context(
        &self,
        query_id: Option<&str>,
        statement: &str,
        context: DriverQueryContext,
    ) -> Result<Vec<QueryResult>> {
        self.query_with_context_and_parameters(query_id, statement, Vec::new(), context)
            .await
    }

    async fn query_with_context_and_parameters(
        &self,
        query_id: Option<&str>,
        statement: &str,
        parameters: Vec<DriverQueryParameter>,
        context: DriverQueryContext,
    ) -> Result<Vec<QueryResult>> {
        let context = DriverQueryContext {
            read_only: self.agent_read_only || context.read_only,
            ..context
        };
        let result = self
            .request(
                DriverRequest::Query {
                    connection_id: self.connection_id.clone(),
                    statement: statement.to_string(),
                    parameters,
                    context,
                    query_id: query_id.map(str::to_string),
                },
                QUERY_TIMEOUT,
            )
            .await?;
        let DriverResult::Query(results) = result else {
            return Err(anyhow!(
                "External driver returned an invalid query response"
            ));
        };
        results.into_iter().map(query_result_from_sidecar).collect()
    }

    async fn metadata<T: DeserializeOwned>(&self, request: MetadataRequest) -> Result<T> {
        if !self.capabilities.lock().await.metadata {
            return Err(anyhow!("External driver package does not provide metadata"));
        }
        let result = self
            .request(
                DriverRequest::Metadata {
                    connection_id: self.connection_id.clone(),
                    request,
                },
                METADATA_TIMEOUT,
            )
            .await?;
        let DriverResult::Metadata(value) = result else {
            return Err(anyhow!(
                "External driver returned an invalid metadata response"
            ));
        };
        serde_json::from_value(value)
            .map_err(|error| anyhow!("External driver returned invalid metadata: {error}"))
    }

    async fn begin_sidecar_transaction(
        &self,
        transaction_id: &str,
        schema: Option<&str>,
    ) -> Result<()> {
        if !self.capabilities.lock().await.transactions {
            return Err(anyhow!(
                "External driver package does not provide transactions"
            ));
        }
        match self
            .request(
                DriverRequest::BeginTransaction {
                    connection_id: self.connection_id.clone(),
                    transaction_id: transaction_id.to_string(),
                    context: DriverQueryContext {
                        schema: schema.map(str::to_string),
                        ..DriverQueryContext::default()
                    },
                },
                CONNECTION_TIMEOUT,
            )
            .await?
        {
            DriverResult::Empty | DriverResult::Boolean(true) => Ok(()),
            DriverResult::Boolean(false) => Err(anyhow!("External driver refused transaction")),
            _ => Err(anyhow!(
                "External driver returned an invalid transaction response"
            )),
        }
    }

    async fn begin_sidecar_database_transaction(
        &self,
        transaction_id: &str,
        database: &str,
        schema: Option<&str>,
    ) -> Result<()> {
        let capabilities = self.capabilities.lock().await.clone();
        let signed_database_scope = self
            .package
            .manifest
            .capabilities
            .as_ref()
            .is_some_and(|declared| declared.supports_database_catalogs);
        if !signed_database_scope
            || !capabilities.transactions
            || !capabilities.database_scoped_queries
        {
            return Err(anyhow!(
                "External driver package does not provide database-scoped transactions"
            ));
        }
        match self
            .request(
                DriverRequest::BeginTransaction {
                    connection_id: self.connection_id.clone(),
                    transaction_id: transaction_id.to_string(),
                    context: DriverQueryContext {
                        database: Some(database.to_string()),
                        schema: schema.map(str::to_string),
                        ..DriverQueryContext::default()
                    },
                },
                CONNECTION_TIMEOUT,
            )
            .await?
        {
            DriverResult::Empty | DriverResult::Boolean(true) => Ok(()),
            DriverResult::Boolean(false) => Err(anyhow!("External driver refused transaction")),
            _ => Err(anyhow!(
                "External driver returned an invalid transaction response"
            )),
        }
    }
}

fn redact_driver_error(error: &str, connection_url: &str) -> String {
    let mut redacted = error.replace(connection_url, "<redacted connection URL>");
    if let Some((prefix, _)) = connection_url.split_once('@') {
        redacted = redacted.replace(prefix, "<redacted credentials>");
    }
    redacted
}

fn sidecar_parameters(parameters: &[QueryParameter]) -> Vec<DriverQueryParameter> {
    parameters
        .iter()
        .map(|parameter| DriverQueryParameter {
            value: parameter.value.clone(),
            data_type: parameter.data_type.clone(),
        })
        .collect()
}

fn query_result_from_sidecar(result: DriverQueryResult) -> Result<QueryResult> {
    let row_limit = result
        .row_limit
        .map(|value| usize::try_from(value).map_err(|_| anyhow!("Driver row limit is too large")))
        .transpose()?;
    Ok(QueryResult {
        columns: result
            .columns
            .into_iter()
            .map(|column| ColumnDef {
                name: column.name,
                data_type: column.data_type,
            })
            .collect(),
        rows: result.rows,
        truncated: result.truncated,
        row_limit,
        rows_affected: result.rows_affected,
        statement_type: result.statement_type,
        message: result.message,
        response_meta: None,
    })
}

/// External packages can introduce a SQL family that is not part of the
/// bundled `DatabaseKind` enum. The signed capability contract is therefore
/// the first source of truth for statement scanning. `sqlite` deliberately
/// uses the standard/PostgreSQL scanner: its quote/comment rules cover the
/// compatible SQL subset while preserving the package's own execution engine
/// as the authority for vendor-specific syntax.
fn external_statement_scan_dialect(
    driver_id: &str,
    lsp_language_id: Option<&str>,
) -> Option<StatementScanDialect> {
    // SQL Server packages intentionally keep the neutral `sql` editor
    // language until they earn a vendor parser. Their statement boundaries
    // are nevertheless T-SQL boundaries: bracket identifiers can contain a
    // semicolon and must never be split by the PostgreSQL-compatible scanner.
    if matches!(
        driver_id.trim().to_ascii_lowercase().as_str(),
        "sqlserver" | "mssql" | "sql-server" | "azure-sql"
    ) {
        return Some(StatementScanDialect::SqlServer);
    }
    match lsp_language_id
        .map(str::trim)
        .filter(|language| !language.is_empty())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        // ClickHouse accepts backtick-delimited identifiers and uses the same
        // non-nested comment/quote boundaries needed by the MySQL scanner.
        // This only selects the bounded statement-at-cursor scanner; the
        // ClickHouse sidecar remains authoritative for query syntax and
        // execution, so it does not claim MySQL SQL validation.
        Some("mysql") | Some("clickhouse") => Some(StatementScanDialect::Mysql),
        Some("postgres") | Some("sqlite") | Some("duckdb") | Some("sql") => {
            Some(StatementScanDialect::Postgres)
        }
        Some(_) => None,
        None => DatabaseKind::from_str(driver_id)
            .ok()
            .map(|kind| match kind {
                DatabaseKind::Postgres => StatementScanDialect::Postgres,
                DatabaseKind::Mysql => StatementScanDialect::Mysql,
            }),
    }
}

/// Creation is deliberately a two-party contract: the signed package says it
/// is part of the public feature surface, while the running sidecar says this
/// particular installed version has implemented it. Either missing signal
/// keeps the operation outside the process boundary.
fn allows_database_creation(
    signed_capabilities: Option<&crate::core::dialect::DatabaseCapabilities>,
    runtime_capabilities: &oxide_driver_protocol::DriverRuntimeCapabilities,
) -> bool {
    signed_capabilities.is_some_and(|capabilities| capabilities.supports_create_database)
        && runtime_capabilities.database_creation
}

#[async_trait]
impl DatabaseDriver for ExternalDriver {
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

    fn package_capabilities(&self) -> Option<crate::core::dialect::DatabaseCapabilities> {
        self.package.manifest.capabilities.clone()
    }

    async fn server_version(&self) -> Option<String> {
        self.server_version.lock().await.clone()
    }

    async fn connect(&mut self) -> Result<()> {
        let mut process = self.process.lock().await;
        if process.is_some() {
            return Ok(());
        }
        let sidecar = Arc::new(
            DatabaseDriverSidecar::spawn(&self.package, &self.registry, env!("CARGO_PKG_VERSION"))
                .await
                .map_err(|error| anyhow!(error))?,
        );
        if self.agent_read_only && !sidecar.capabilities().read_only_enforcement {
            sidecar.terminate().await;
            return Err(anyhow!(
                "External driver package does not enforce Agent read-only queries"
            ));
        }
        let connect = sidecar
            .request(
                DriverRequest::Connect {
                    connection_id: self.connection_id.clone(),
                    config: SecretConnectionConfig {
                        url: self.url.clone(),
                        options: Default::default(),
                    },
                },
                CONNECTION_TIMEOUT,
            )
            .await;
        match connect {
            Ok(DriverResult::Empty) | Ok(DriverResult::Boolean(true)) => {}
            Ok(_) => {
                sidecar.terminate().await;
                return Err(anyhow!(
                    "External driver returned an invalid connect response"
                ));
            }
            Err(error) => {
                sidecar.terminate().await;
                return Err(anyhow!(redact_driver_error(&error, &self.url)));
            }
        }
        let version = sidecar
            .request(
                DriverRequest::ServerVersion {
                    connection_id: self.connection_id.clone(),
                },
                CONNECTION_TIMEOUT,
            )
            .await;
        match version {
            Ok(DriverResult::ServerVersion(version)) => {
                if let Err(error) = validate_server_version_compatibility(
                    self.package.manifest.server_version_range.as_deref(),
                    version.as_deref(),
                ) {
                    sidecar.terminate().await;
                    return Err(anyhow!(error));
                }
                *self.server_version.lock().await = version;
            }
            Ok(_) => {
                sidecar.terminate().await;
                return Err(anyhow!(
                    "External driver returned an invalid server version response"
                ));
            }
            Err(error) => {
                sidecar.terminate().await;
                return Err(anyhow!(redact_driver_error(&error, &self.url)));
            }
        }
        *self.capabilities.lock().await = sidecar.capabilities().clone();
        *process = Some(sidecar);
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
        if !self.capabilities.lock().await.database_scoped_queries {
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
        if !self.capabilities.lock().await.database_scoped_queries {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_sql_packages_use_their_declared_lsp_dialect_for_statement_scanning() {
        assert_eq!(
            external_statement_scan_dialect("duckdb", Some("duckdb")),
            Some(StatementScanDialect::Postgres)
        );
        assert_eq!(
            external_statement_scan_dialect("warehouse", Some("sql")),
            Some(StatementScanDialect::Postgres)
        );
        assert_eq!(
            external_statement_scan_dialect("mysql", Some("mysql")),
            Some(StatementScanDialect::Mysql)
        );
        assert_eq!(
            external_statement_scan_dialect("clickhouse", Some("clickhouse")),
            Some(StatementScanDialect::Mysql)
        );
        assert_eq!(
            external_statement_scan_dialect("sqlserver", Some("sql")),
            Some(StatementScanDialect::SqlServer)
        );
        assert_eq!(
            external_statement_scan_dialect("mongodb", Some("mongodb")),
            None
        );
    }

    #[test]
    fn clickhouse_statement_scanner_keeps_backtick_sql_blocks_separate() {
        let sql = "SELECT `first` FROM `events`;\n\nSELECT `second` FROM `events`";
        let dialect = external_statement_scan_dialect("clickhouse", Some("clickhouse"))
            .expect("ClickHouse must expose a statement scanner");
        let selected =
            crate::core::statement::split_sql_statement_spans_with_soft_boundaries(sql, dialect);

        assert_eq!(selected.len(), 2);
        assert_eq!(selected[1].text.trim(), "SELECT `second` FROM `events`");
    }

    #[test]
    fn database_creation_requires_both_signed_and_runtime_declarations() {
        let mut runtime = oxide_driver_protocol::DriverRuntimeCapabilities {
            database_creation: true,
            ..Default::default()
        };
        assert!(!allows_database_creation(None, &runtime));

        let mut capabilities = DatabaseKind::Postgres.capabilities();
        assert!(allows_database_creation(Some(&capabilities), &runtime));

        runtime.database_creation = false;
        assert!(!allows_database_creation(Some(&capabilities), &runtime));

        capabilities.supports_create_database = false;
        runtime.database_creation = true;
        assert!(!allows_database_creation(Some(&capabilities), &runtime));
    }
}
