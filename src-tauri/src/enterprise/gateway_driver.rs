use super::{EnterpriseClient, ManagedAccessSessionRequest};
use crate::core::{
    dialect::{database_capabilities_for_driver, DatabaseCapabilities},
    driver::DatabaseDriver,
    protocol::{ColumnInfo, QueryResult, TableInfo},
    statement::StatementScanDialect,
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use oxide_enterprise_contracts::{
    AccessAction, ManagedDataSourceDescriptor, ENTERPRISE_CONTRACT_VERSION,
};
use sqlparser::{
    ast::{ObjectName, Visit, Visitor},
    dialect::{MsSqlDialect, MySqlDialect, PostgreSqlDialect},
    parser::Parser,
};
use std::{fs, ops::ControlFlow};
use tokio::sync::Mutex;
use tonic::transport::{Certificate, Channel, ClientTlsConfig, Endpoint, Identity};
use url::Url;

pub mod proto {
    tonic::include_proto!("oxide.enterprise.gateway.v1");
}

use proto::{
    data_plane_client::DataPlaneClient, CapabilitiesRequest, CapabilitiesResponse, QueryRequest,
    RequestScope, ResourceRequest,
};

const MAX_TLS_FILE_BYTES: u64 = 1024 * 1024;

fn managed_capabilities(descriptor: &ManagedDataSourceDescriptor) -> Option<DatabaseCapabilities> {
    let mut capabilities = database_capabilities_for_driver(&descriptor.driver).ok()?;
    let allows = |action: &str| descriptor.capabilities.contains(action);
    let can_discover = allows(AccessAction::ResourceDiscover.as_str());
    let can_read_metadata = allows(AccessAction::MetadataRead.as_str());
    let can_query = allows(AccessAction::QueryRead.as_str());

    capabilities.display_name = format!("{} (managed)", capabilities.display_name);
    capabilities.supports_sql_query &= can_query;
    capabilities.supports_table_browsing &= can_discover && can_read_metadata;
    capabilities.supports_schemas &= can_discover;
    capabilities.supports_database_catalogs &= can_discover;
    capabilities.supports_connection_database = false;
    capabilities.table_export_formats.clear();
    capabilities.supports_table_row_mutation = false;
    capabilities.supports_table_data_transfer = false;
    capabilities.supports_table_ddl = false;
    capabilities.supports_column_alteration = false;
    capabilities.supports_index_rename = false;
    capabilities.supports_constraint_alteration = false;
    capabilities.supports_create_database = false;
    capabilities.supports_create_database_owner = false;
    capabilities.supports_create_database_charset = false;
    capabilities.supports_create_database_collation = false;
    capabilities.supports_rename_database = false;
    capabilities.supports_views = false;
    capabilities.supports_replace_view = false;
    capabilities.supports_materialized_views = false;
    capabilities.supports_table_indexes = false;
    capabilities.supports_table_constraints = false;
    capabilities.supports_foreign_keys = false;
    capabilities.supports_check_constraints = false;
    capabilities.supports_functions = false;
    capabilities.supports_transactions = false;
    capabilities.supports_query_cancellation = false;
    capabilities.supports_explain_plan = false;
    Some(capabilities)
}

/// Adapter that lets the existing workbench consume an enterprise Gateway
/// without ever materializing a database URL or credential on the client.
pub struct ManagedGatewayDriver {
    enterprise: EnterpriseClient,
    descriptor: ManagedDataSourceDescriptor,
    channel: Mutex<Option<(String, Channel)>>,
}

impl ManagedGatewayDriver {
    pub fn new(
        enterprise: EnterpriseClient,
        descriptor: ManagedDataSourceDescriptor,
    ) -> Result<Self> {
        descriptor.validate_secret_free()?;
        Ok(Self {
            enterprise,
            descriptor,
            channel: Mutex::new(None),
        })
    }

    async fn open_client(
        &self,
        action: AccessAction,
        resource_path: Vec<String>,
    ) -> Result<(
        DataPlaneClient<Channel>,
        super::ManagedAccessSession,
        RequestScope,
    )> {
        let session = self
            .enterprise
            .create_access_session(ManagedAccessSessionRequest {
                organization_id: self.descriptor.organization_id,
                project_id: self.descriptor.project_id,
                data_source_id: self.descriptor.data_source_id,
                action,
                resource_path: resource_path.clone(),
                max_rows: Some(500),
                max_result_bytes: Some(1024 * 1024),
            })
            .await?;
        let endpoint_url =
            Url::parse(&session.gateway_endpoint).context("managed Gateway endpoint is invalid")?;
        if endpoint_url.scheme() != "https"
            || !endpoint_url.username().is_empty()
            || endpoint_url.password().is_some()
        {
            return Err(anyhow!(
                "managed Gateway endpoint must be credential-free HTTPS"
            ));
        }
        let scope = RequestScope {
            principal_id: session.principal_id.to_string(),
            organization_id: self.descriptor.organization_id.to_string(),
            project_id: self.descriptor.project_id.to_string(),
            data_source_id: self.descriptor.data_source_id.to_string(),
            resource_path,
            action: action.as_str().to_string(),
            request_id: uuid::Uuid::new_v4().to_string(),
        };
        if let Some((_, channel)) = self
            .channel
            .lock()
            .await
            .as_ref()
            .filter(|(endpoint, _)| endpoint == &session.gateway_endpoint)
        {
            return Ok((DataPlaneClient::new(channel.clone()), session, scope));
        }
        let domain = endpoint_url
            .host_str()
            .context("managed Gateway endpoint has no host")?
            .to_string();
        let (ca_path, certificate_path, private_key_path) = self.enterprise.gateway_tls_paths()?;
        let ca = read_tls_file(&ca_path)?;
        let certificate = read_tls_file(&certificate_path)?;
        let mut private_key = read_tls_file(&private_key_path)?;
        let tls = ClientTlsConfig::new()
            .domain_name(domain)
            .ca_certificate(Certificate::from_pem(ca))
            .identity(Identity::from_pem(certificate, private_key.clone()));
        zeroize::Zeroize::zeroize(&mut private_key);
        let channel = Endpoint::from_shared(session.gateway_endpoint.clone())?
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(30))
            .tls_config(tls)?
            .connect()
            .await
            .context("could not establish the managed Gateway mTLS session")?;
        *self.channel.lock().await = Some((session.gateway_endpoint.clone(), channel.clone()));
        Ok((DataPlaneClient::new(channel), session, scope))
    }

    async fn list_resources(
        &self,
        kind: &str,
        database: Option<&str>,
        schema: Option<&str>,
        object_name: Option<&str>,
    ) -> Result<Vec<proto::ResourceItem>> {
        let resource_path = metadata_parent_path(kind, database, schema, object_name)?;
        let action = if kind == "column" {
            AccessAction::MetadataRead
        } else {
            AccessAction::ResourceDiscover
        };
        let (mut client, session, scope) = self.open_client(action, resource_path).await?;
        let response = client
            .list_resources(ResourceRequest {
                access_ticket: session.ticket,
                scope: Some(scope),
                kind: kind.to_string(),
                database: database.map(str::to_string),
                schema: schema.map(str::to_string),
                object_name: object_name.map(str::to_string),
            })
            .await
            .context("managed metadata request failed")?
            .into_inner();
        if response.policy_revision != session.policy_revision {
            return Err(anyhow!(
                "enterprise access policy changed while metadata was loading"
            ));
        }
        Ok(response.items)
    }

    async fn negotiate_gateway_contract(&self) -> Result<()> {
        let resource_path = self
            .descriptor
            .allowed_resource_summary
            .first()
            .map(|summary| {
                summary
                    .split('/')
                    .filter(|segment| !segment.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let (mut client, session, scope) = self
            .open_client(AccessAction::ResourceDiscover, resource_path)
            .await?;
        let response = client
            .capabilities(CapabilitiesRequest {
                access_ticket: session.ticket,
                scope: Some(scope),
            })
            .await
            .context("managed Gateway capability negotiation failed")?
            .into_inner();
        validate_gateway_capabilities(&self.descriptor, &session.policy_revision, &response)
    }

    fn query_resource_path(
        &self,
        sql: &str,
        database: Option<&str>,
        schema: Option<&str>,
    ) -> Result<Vec<String>> {
        let relation = first_relation(sql, self.statement_scan_dialect())?;
        let mut contextual = Vec::new();
        if relation.len() == 1 {
            if let Some(database) = database {
                contextual.push(database.to_string());
            }
            if let Some(schema) = schema {
                contextual.push(schema.to_string());
            }
        } else if relation.len() == 2 {
            if let Some(database) = database {
                contextual.push(database.to_string());
            }
        }
        contextual.extend(relation);

        let matching = self
            .descriptor
            .allowed_resource_summary
            .iter()
            .map(|summary| {
                summary
                    .split('/')
                    .filter(|segment| !segment.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .filter(|path| {
                path.len() >= contextual.len()
                    && path[path.len() - contextual.len()..]
                        .iter()
                        .zip(&contextual)
                        .all(|(left, right)| left.eq_ignore_ascii_case(right))
            })
            .collect::<Vec<_>>();
        match matching.as_slice() {
            [only] => Ok(only.clone()),
            [] => Ok(contextual),
            _ => Err(anyhow!(
                "The query target is ambiguous across the assigned enterprise resources. Select a database and schema before running it."
            )),
        }
    }

    async fn execute_query(
        &self,
        sql: &str,
        database: Option<&str>,
        schema: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        let resource_path = self.query_resource_path(sql, database, schema)?;
        let (mut client, session, scope) = self
            .open_client(AccessAction::QueryRead, resource_path)
            .await?;
        let mut stream = client
            .execute_read_only(QueryRequest {
                access_ticket: session.ticket,
                scope: Some(scope),
                sql: sql.to_string(),
                database: database.map(str::to_string),
                schema: schema.map(str::to_string),
            })
            .await
            .context("managed read-only query was rejected")?
            .into_inner();
        let mut results = Vec::new();
        while let Some(chunk) = stream
            .message()
            .await
            .context("managed query stream failed")?
        {
            if chunk.encoding != proto::query_chunk::Encoding::Json as i32 {
                return Err(anyhow!("managed Gateway returned an unsupported encoding"));
            }
            let mut chunk_results: Vec<QueryResult> = serde_json::from_slice(&chunk.payload)
                .context("managed Gateway returned an invalid query result")?;
            results.append(&mut chunk_results);
        }
        Ok(results)
    }
}

#[async_trait]
impl DatabaseDriver for ManagedGatewayDriver {
    fn is_managed_data_source(&self) -> bool {
        true
    }

    fn package_capabilities(&self) -> Option<DatabaseCapabilities> {
        // The stage-one Gateway implements discovery, metadata and bounded
        // read-only queries only. Descriptor permissions for future actions
        // must not make local write/export controls appear before the data
        // plane implements and re-authorizes those exact RPCs.
        managed_capabilities(&self.descriptor)
    }

    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        match self.descriptor.driver.as_str() {
            "mysql" => Some(StatementScanDialect::Mysql),
            "postgres" | "postgresql" => Some(StatementScanDialect::Postgres),
            _ => None,
        }
    }

    async fn connect(&mut self) -> Result<()> {
        self.ping().await
    }

    async fn disconnect(&self) -> Result<()> {
        self.channel.lock().await.take();
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        self.negotiate_gateway_contract().await?;
        self.list_resources("database", None, None, None)
            .await
            .map(|_| ())
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        self.execute_query(sql, None, None).await
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        self.execute_query(sql, None, Some(schema)).await
    }

    async fn query_database(&self, database: &str, sql: &str) -> Result<Vec<QueryResult>> {
        self.execute_query(sql, Some(database), None).await
    }

    async fn query_database_with_context_tracked(
        &self,
        _query_id: Option<&str>,
        database: &str,
        sql: &str,
        schema: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        self.execute_query(sql, Some(database), schema).await
    }

    async fn get_databases(&self) -> Result<Vec<String>> {
        Ok(self
            .list_resources("database", None, None, None)
            .await?
            .into_iter()
            .map(|item| item.name)
            .collect())
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        Ok(self
            .list_resources("schema", None, None, None)
            .await?
            .into_iter()
            .map(|item| item.name)
            .collect())
    }

    async fn get_database_schemas(&self, database: &str) -> Result<Vec<String>> {
        Ok(self
            .list_resources("schema", Some(database), None, None)
            .await?
            .into_iter()
            .map(|item| item.name)
            .collect())
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        decode_items(
            self.list_resources("table", None, Some(schema), None)
                .await?,
        )
    }

    async fn get_database_tables(&self, database: &str, schema: &str) -> Result<Vec<TableInfo>> {
        decode_items(
            self.list_resources("table", Some(database), Some(schema), None)
                .await?,
        )
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        decode_items(
            self.list_resources("column", None, Some(schema), Some(table))
                .await?,
        )
    }

    async fn get_database_columns(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        decode_items(
            self.list_resources("column", Some(database), Some(schema), Some(table))
                .await?,
        )
    }
}

fn validate_gateway_capabilities(
    descriptor: &ManagedDataSourceDescriptor,
    policy_revision: &str,
    response: &CapabilitiesResponse,
) -> Result<()> {
    if response.contract_version != u32::from(ENTERPRISE_CONTRACT_VERSION) {
        return Err(anyhow!(
            "managed Gateway contract version {} is incompatible with desktop version {}",
            response.contract_version,
            ENTERPRISE_CONTRACT_VERSION
        ));
    }
    if response.policy_revision != policy_revision {
        return Err(anyhow!(
            "enterprise access policy changed during Gateway negotiation"
        ));
    }
    let gateway = response
        .capabilities
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    let unavailable = descriptor
        .capabilities
        .iter()
        .filter(|capability| !gateway.contains(capability.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !unavailable.is_empty() {
        return Err(anyhow!(
            "managed Gateway does not implement assigned capabilities: {}",
            unavailable.join(", ")
        ));
    }
    Ok(())
}

fn read_tls_file(path: &std::path::Path) -> Result<Vec<u8>> {
    let metadata = fs::metadata(path).with_context(|| {
        format!(
            "managed Gateway TLS file is unavailable: {}",
            path.display()
        )
    })?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_TLS_FILE_BYTES {
        return Err(anyhow!(
            "managed Gateway TLS file is empty, too large, or not a regular file: {}",
            path.display()
        ));
    }
    fs::read(path).with_context(|| {
        format!(
            "managed Gateway TLS file could not be read: {}",
            path.display()
        )
    })
}

fn metadata_parent_path(
    kind: &str,
    database: Option<&str>,
    schema: Option<&str>,
    object_name: Option<&str>,
) -> Result<Vec<String>> {
    let mut path = database.map(str::to_string).into_iter().collect::<Vec<_>>();
    match kind {
        "database" => path.clear(),
        "schema" => {}
        "table" => path.push(
            schema
                .context("schema is required to list managed tables")?
                .to_string(),
        ),
        "column" => {
            path.push(
                schema
                    .context("schema is required to list managed columns")?
                    .to_string(),
            );
            path.push(
                object_name
                    .context("table is required to list managed columns")?
                    .to_string(),
            );
        }
        _ => return Err(anyhow!("unsupported managed resource kind")),
    }
    Ok(path)
}

fn decode_items<T: serde::de::DeserializeOwned>(items: Vec<proto::ResourceItem>) -> Result<Vec<T>> {
    items
        .into_iter()
        .map(|item| {
            serde_json::from_slice(&item.metadata_json)
                .context("managed Gateway returned invalid metadata")
        })
        .collect()
}

#[derive(Default)]
struct FirstRelation {
    relation: Option<Vec<String>>,
}

impl Visitor for FirstRelation {
    type Break = ();

    fn pre_visit_relation(&mut self, relation: &ObjectName) -> ControlFlow<Self::Break> {
        if self.relation.is_none() {
            self.relation = Some(
                relation
                    .0
                    .iter()
                    .map(ToString::to_string)
                    .map(|segment| segment.trim_matches(['`', '"', '[', ']']).to_string())
                    .collect(),
            );
        }
        ControlFlow::Continue(())
    }
}

fn first_relation(sql: &str, dialect: Option<StatementScanDialect>) -> Result<Vec<String>> {
    let statements = match dialect {
        Some(StatementScanDialect::Mysql) => Parser::parse_sql(&MySqlDialect {}, sql),
        Some(StatementScanDialect::Postgres) => Parser::parse_sql(&PostgreSqlDialect {}, sql),
        Some(StatementScanDialect::SqlServer) => Parser::parse_sql(&MsSqlDialect {}, sql),
        None => return Err(anyhow!("managed driver does not support SQL queries")),
    }
    .context("query could not be parsed for managed object authorization")?;
    let mut collector = FirstRelation::default();
    let _ = statements.visit(&mut collector);
    collector
        .relation
        .context("query does not contain an authorizable table")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_qualified_query_target() {
        assert_eq!(
            first_relation(
                "SELECT id FROM app.public.orders",
                Some(StatementScanDialect::Postgres),
            )
            .unwrap(),
            vec!["app", "public", "orders"]
        );
    }

    #[test]
    fn extracts_bracket_quoted_sqlserver_query_target() {
        assert_eq!(
            first_relation(
                "SELECT id FROM [app].[dbo].[orders]",
                Some(StatementScanDialect::SqlServer),
            )
            .unwrap(),
            vec!["app", "dbo", "orders"]
        );
    }

    #[test]
    fn metadata_scope_matches_the_listed_parent() {
        assert_eq!(
            metadata_parent_path("table", Some("app"), Some("public"), None).unwrap(),
            vec!["app", "public"]
        );
        assert!(metadata_parent_path("column", Some("app"), Some("public"), None).is_err());
    }

    #[test]
    fn managed_capabilities_never_inherit_local_write_or_export_surfaces() {
        let descriptor = ManagedDataSourceDescriptor {
            organization_id: uuid::Uuid::new_v4(),
            project_id: uuid::Uuid::new_v4(),
            data_source_id: uuid::Uuid::new_v4(),
            gateway_id: uuid::Uuid::new_v4(),
            driver: "postgres".into(),
            display_name: "Managed analytics".into(),
            capabilities: [
                AccessAction::ResourceDiscover.as_str().to_string(),
                AccessAction::MetadataRead.as_str().to_string(),
                AccessAction::QueryRead.as_str().to_string(),
                AccessAction::DataWrite.as_str().to_string(),
                AccessAction::SchemaDdl.as_str().to_string(),
                AccessAction::DataExport.as_str().to_string(),
            ]
            .into_iter()
            .collect(),
            allowed_resource_summary: vec!["app/public/orders".into()],
            policy_revision: "policy-8".into(),
        };

        let capabilities = managed_capabilities(&descriptor).unwrap();
        assert!(capabilities.supports_sql_query);
        assert!(capabilities.supports_table_browsing);
        assert!(!capabilities.supports_table_row_mutation);
        assert!(!capabilities.supports_table_ddl);
        assert!(!capabilities.supports_table_data_transfer);
        assert!(capabilities.table_export_formats.is_empty());
    }

    #[test]
    fn rejects_stale_or_under_capable_gateway_contracts() {
        let descriptor = ManagedDataSourceDescriptor {
            organization_id: uuid::Uuid::new_v4(),
            project_id: uuid::Uuid::new_v4(),
            data_source_id: uuid::Uuid::new_v4(),
            gateway_id: uuid::Uuid::new_v4(),
            driver: "postgres".into(),
            display_name: "Managed analytics".into(),
            capabilities: [
                AccessAction::ResourceDiscover.as_str().to_string(),
                AccessAction::QueryRead.as_str().to_string(),
            ]
            .into_iter()
            .collect(),
            allowed_resource_summary: vec!["app/public/orders".into()],
            policy_revision: "policy-8".into(),
        };
        let valid = CapabilitiesResponse {
            contract_version: u32::from(ENTERPRISE_CONTRACT_VERSION),
            capabilities: descriptor.capabilities.iter().cloned().collect(),
            policy_revision: "policy-8".into(),
        };
        assert!(validate_gateway_capabilities(&descriptor, "policy-8", &valid).is_ok());

        let mut stale = valid.clone();
        stale.policy_revision = "policy-9".into();
        assert!(validate_gateway_capabilities(&descriptor, "policy-8", &stale).is_err());

        let mut missing = valid;
        missing.capabilities = vec![AccessAction::ResourceDiscover.as_str().to_string()];
        assert!(validate_gateway_capabilities(&descriptor, "policy-8", &missing).is_err());
    }
}
