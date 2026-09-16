use crate::core::{
    driver_package::validate_server_version_compatibility,
    driver_sidecar::DatabaseDriverSidecar,
    protocol::{NativeQueryPage, QueryResult},
};
use anyhow::{anyhow, Result};
use oxide_driver_protocol::{
    DriverQueryContext, DriverQueryParameter, DriverRequest, DriverResult, MetadataRequest,
    SchemaMigrationMode, SecretConnectionConfig,
};
use serde::de::DeserializeOwned;
use std::sync::Arc;
use std::time::Duration;

use super::conversions::{
    native_query_page_from_sidecar, query_result_from_sidecar, redact_driver_error,
};
use super::models::{ExternalDriver, CONNECTION_TIMEOUT, METADATA_TIMEOUT, QUERY_TIMEOUT};

impl ExternalDriver {
    pub(super) async fn request(
        &self,
        request: DriverRequest,
        timeout: Duration,
    ) -> Result<DriverResult> {
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

    pub(super) async fn start_connected_sidecar(&self) -> Result<Arc<DatabaseDriverSidecar>> {
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
        Ok(sidecar)
    }

    pub(super) async fn require_semantic_schema_migration(&self) -> Result<SchemaMigrationMode> {
        if self.agent_read_only {
            return Err(anyhow!(
                "Agent read-only connections cannot perform semantic schema migration"
            ));
        }
        let contract = self
            .package
            .manifest
            .schema_migration
            .as_ref()
            .ok_or_else(|| {
                anyhow!("External driver package does not provide semantic schema migration")
            })?;
        if contract.snapshot_version != 1 {
            return Err(anyhow!(
                "External driver package uses an unsupported semantic snapshot version"
            ));
        }
        if !self.capabilities.lock().await.semantic_schema_migration {
            return Err(anyhow!(
                "External driver runtime does not provide semantic schema migration"
            ));
        }
        Ok(contract.mode)
    }

    pub(super) async fn query_with_context(
        &self,
        query_id: Option<&str>,
        statement: &str,
        context: DriverQueryContext,
    ) -> Result<Vec<QueryResult>> {
        self.query_with_context_and_parameters(query_id, statement, Vec::new(), context)
            .await
    }

    pub(super) async fn query_with_context_and_parameters(
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

    pub(super) async fn query_native_page_with_context(
        &self,
        query_id: Option<&str>,
        statement: &str,
        context: DriverQueryContext,
        page_size: u32,
        max_rows: Option<u32>,
    ) -> Result<NativeQueryPage> {
        let context = DriverQueryContext {
            read_only: self.agent_read_only || context.read_only,
            ..context
        };
        if !self.capabilities.lock().await.query_paging {
            return Err(anyhow!(
                "External driver runtime does not provide native query pagination"
            ));
        }
        let result = self
            .request(
                DriverRequest::QueryPage {
                    connection_id: self.connection_id.clone(),
                    statement: statement.to_string(),
                    parameters: Vec::new(),
                    context,
                    page_size,
                    max_rows,
                    query_id: query_id.map(str::to_string),
                },
                QUERY_TIMEOUT,
            )
            .await?;
        let DriverResult::QueryPage(page) = result else {
            return Err(anyhow!(
                "External driver returned an invalid native query page response"
            ));
        };
        native_query_page_from_sidecar(page)
    }

    pub(super) async fn fetch_native_query_page_with_context(
        &self,
        query_id: Option<&str>,
        cursor: &str,
        page_size: u32,
    ) -> Result<NativeQueryPage> {
        if !self.capabilities.lock().await.query_paging {
            return Err(anyhow!(
                "External driver runtime does not provide native query pagination"
            ));
        }
        let result = self
            .request(
                DriverRequest::FetchQueryPage {
                    connection_id: self.connection_id.clone(),
                    session_id: cursor.to_string(),
                    page_size,
                    query_id: query_id.map(str::to_string),
                },
                QUERY_TIMEOUT,
            )
            .await?;
        let DriverResult::QueryPage(page) = result else {
            return Err(anyhow!(
                "External driver returned an invalid native query page response"
            ));
        };
        native_query_page_from_sidecar(page)
    }

    pub(super) async fn close_native_query_page_with_context(&self, cursor: &str) -> Result<()> {
        if !self.capabilities.lock().await.query_paging {
            return Err(anyhow!(
                "External driver runtime does not provide native query pagination"
            ));
        }
        let result = self
            .request(
                DriverRequest::CloseQuerySession {
                    connection_id: self.connection_id.clone(),
                    session_id: cursor.to_string(),
                },
                QUERY_TIMEOUT,
            )
            .await?;
        if matches!(result, DriverResult::Empty) {
            Ok(())
        } else {
            Err(anyhow!(
                "External driver returned an invalid native query close response"
            ))
        }
    }

    pub(super) async fn metadata<T: DeserializeOwned>(
        &self,
        request: MetadataRequest,
    ) -> Result<T> {
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

    pub(super) async fn begin_sidecar_transaction(
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

    pub(super) async fn begin_sidecar_database_transaction(
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
