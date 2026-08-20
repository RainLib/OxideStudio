use crate::{
    config::DataSourceConfig,
    proto::{
        data_plane_server::DataPlane, CapabilitiesRequest, CapabilitiesResponse, QueryChunk,
        QueryRequest, RequestScope, ResourceItem, ResourceRequest, ResourceResponse,
    },
    secret::SecretProvider,
};
use ed25519_dalek::VerifyingKey;
use oxide_enterprise_contracts::{
    certificate_fingerprint, verify_ticket, AccessAction, AccessSessionTicket,
    AuthorizationRequest, ENTERPRISE_CONTRACT_VERSION,
};
use oxide_studio_lib::{
    core::{driver::DatabaseDriver, statement::validate_read_only_sql},
    drivers::connect_driver,
};
use sqlparser::{
    ast::{ObjectName, Visit, Visitor},
    dialect::{MsSqlDialect, MySqlDialect, PostgreSqlDialect},
    parser::Parser,
};
use std::{
    collections::HashMap,
    ops::ControlFlow,
    pin::Pin,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;
use tokio_stream::{self as stream, Stream};
use tonic::{Request, Response, Status};
use uuid::Uuid;

pub struct DataPlaneService {
    gateway_id: Uuid,
    verifying_key: VerifyingKey,
    sources: HashMap<Uuid, DataSourceConfig>,
    secrets: Arc<dyn SecretProvider>,
    drivers: Mutex<HashMap<Uuid, CachedDriver>>,
}

#[derive(Clone)]
struct CachedDriver {
    driver: Arc<dyn DatabaseDriver>,
    expires_at: Option<Instant>,
}

impl DataPlaneService {
    pub fn new(
        gateway_id: Uuid,
        verifying_key: VerifyingKey,
        sources: HashMap<Uuid, DataSourceConfig>,
        secrets: Arc<dyn SecretProvider>,
    ) -> Self {
        Self {
            gateway_id,
            verifying_key,
            sources,
            secrets,
            drivers: Mutex::new(HashMap::new()),
        }
    }

    fn authorize(
        &self,
        ticket: &str,
        scope: Option<&RequestScope>,
        expected_action: AccessAction,
        peer_certificate_fingerprint: &str,
    ) -> Result<
        (
            oxide_enterprise_contracts::AccessSessionClaims,
            AuthorizationRequest,
        ),
        Status,
    > {
        let scope = scope.ok_or_else(|| Status::invalid_argument("request scope is required"))?;
        let request = authorization_request(scope, expected_action)?;
        let claims = verify_ticket(
            &AccessSessionTicket(ticket.to_string()),
            &self.verifying_key,
        )
        .map_err(|error| Status::permission_denied(error.to_string()))?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs() as i64)
            .unwrap_or(0);
        claims
            .authorizes(&request, self.gateway_id, now)
            .map_err(|error| Status::permission_denied(error.to_string()))?;
        claims
            .authorizes_device_certificate(peer_certificate_fingerprint)
            .map_err(|error| Status::permission_denied(error.to_string()))?;
        if scope.action != expected_action.as_str() {
            return Err(Status::invalid_argument(
                "request action does not match the RPC operation",
            ));
        }
        Ok((claims, request))
    }

    fn peer_certificate_fingerprint<T>(request: &Request<T>) -> Result<String, Status> {
        let certificate = request
            .peer_certs()
            .and_then(|certificates| certificates.first().cloned())
            .ok_or_else(|| {
                Status::unauthenticated("a managed Gateway device certificate is required")
            })?;
        Ok(certificate_fingerprint(certificate.as_ref()))
    }

    async fn driver(&self, source_id: Uuid) -> Result<Arc<dyn DatabaseDriver>, Status> {
        let cached = self.drivers.lock().await.get(&source_id).cloned();
        if let Some(cached) = cached {
            if cached
                .expires_at
                .is_none_or(|expires_at| expires_at > Instant::now())
            {
                return Ok(cached.driver);
            }
            self.drivers.lock().await.remove(&source_id);
            if let Err(error) = cached.driver.disconnect().await {
                tracing::warn!(
                    data_source_id = %source_id,
                    error = %error,
                    "expired managed database session could not be closed cleanly"
                );
            }
        }
        let source = self
            .sources
            .get(&source_id)
            .ok_or_else(|| Status::not_found("managed data source is not configured"))?;
        let secret = self
            .secrets
            .resolve(&source.secret_ref, source.connection_template.as_deref())
            .await
            .map_err(|error| {
                tracing::warn!(
                    data_source_id = %source_id,
                    error = %error,
                    "gateway could not resolve data source secret"
                );
                Status::unavailable("managed data source credential is unavailable")
            })?;
        let expires_at = secret.lease_duration().map(|duration| {
            let safety_window = if duration > Duration::from_secs(30) {
                Duration::from_secs(15)
            } else {
                duration / 2
            };
            Instant::now() + duration.saturating_sub(safety_window)
        });
        let driver = connect_driver(&source.driver, secret.connection_url())
            .await
            .map_err(|error| {
                tracing::warn!(
                    data_source_id = %source_id,
                    driver = %source.driver,
                    error = %oxide_studio_lib::core::redaction::redact_connection_url(&error.to_string()),
                    "gateway connection failed"
                );
                Status::unavailable("managed data source connection failed")
            })?;
        let driver: Arc<dyn DatabaseDriver> = Arc::from(driver);
        self.drivers.lock().await.insert(
            source_id,
            CachedDriver {
                driver: driver.clone(),
                expires_at,
            },
        );
        Ok(driver)
    }

    fn require_source(&self, source_id: Uuid) -> Result<&DataSourceConfig, Status> {
        self.sources
            .get(&source_id)
            .ok_or_else(|| Status::not_found("managed data source is not configured"))
    }
}

#[tonic::async_trait]
impl DataPlane for DataPlaneService {
    async fn capabilities(
        &self,
        request: Request<CapabilitiesRequest>,
    ) -> Result<Response<CapabilitiesResponse>, Status> {
        let peer_certificate_fingerprint = Self::peer_certificate_fingerprint(&request)?;
        let request = request.into_inner();
        let (claims, authorization) = self.authorize(
            &request.access_ticket,
            request.scope.as_ref(),
            AccessAction::ResourceDiscover,
            &peer_certificate_fingerprint,
        )?;
        let source = self.require_source(authorization.data_source_id)?;
        Ok(Response::new(CapabilitiesResponse {
            contract_version: ENTERPRISE_CONTRACT_VERSION.into(),
            capabilities: source.capabilities.clone(),
            policy_revision: claims.policy_revision,
        }))
    }

    async fn list_resources(
        &self,
        request: Request<ResourceRequest>,
    ) -> Result<Response<ResourceResponse>, Status> {
        let peer_certificate_fingerprint = Self::peer_certificate_fingerprint(&request)?;
        let request = request.into_inner();
        let action = if request.kind == "column" {
            AccessAction::MetadataRead
        } else {
            AccessAction::ResourceDiscover
        };
        let (claims, authorization) = self.authorize(
            &request.access_ticket,
            request.scope.as_ref(),
            action,
            &peer_certificate_fingerprint,
        )?;
        self.require_source(authorization.data_source_id)?;
        require_metadata_scope(&request, &authorization.resource_path)?;
        let driver = self.driver(authorization.data_source_id).await?;
        let mut items = match request.kind.as_str() {
            "database" => driver
                .get_databases()
                .await
                .map_err(metadata_error)?
                .into_iter()
                .map(|name| resource_item("database", name, &serde_json::Value::Null))
                .collect::<Result<Vec<_>, _>>()?,
            "schema" => {
                let schemas = if let Some(database) = request.database.as_deref() {
                    driver.get_database_schemas(database).await
                } else {
                    driver.get_schemas().await
                }
                .map_err(metadata_error)?;
                schemas
                    .into_iter()
                    .map(|name| resource_item("schema", name, &serde_json::Value::Null))
                    .collect::<Result<Vec<_>, _>>()?
            }
            "table" => {
                let schema = request
                    .schema
                    .as_deref()
                    .ok_or_else(|| Status::invalid_argument("schema is required"))?;
                let tables = if let Some(database) = request.database.as_deref() {
                    driver.get_database_tables(database, schema).await
                } else {
                    driver.get_tables(schema).await
                }
                .map_err(metadata_error)?;
                tables
                    .into_iter()
                    .map(|mut table| {
                        table.comment = None;
                        resource_item("table", table.name.clone(), &table)
                    })
                    .collect::<Result<Vec<_>, _>>()?
            }
            "column" => {
                let schema = request
                    .schema
                    .as_deref()
                    .ok_or_else(|| Status::invalid_argument("schema is required"))?;
                let object_name = request
                    .object_name
                    .as_deref()
                    .ok_or_else(|| Status::invalid_argument("object_name is required"))?;
                let columns = if let Some(database) = request.database.as_deref() {
                    driver
                        .get_database_columns(database, schema, object_name)
                        .await
                } else {
                    driver.get_columns(schema, object_name).await
                }
                .map_err(metadata_error)?;
                columns
                    .into_iter()
                    .map(|column| resource_item("column", column.name.clone(), &column))
                    .collect::<Result<Vec<_>, _>>()?
            }
            _ => {
                return Err(Status::invalid_argument(
                    "kind must be database, schema, table, or column",
                ));
            }
        };
        let parent_path = metadata_parent_path(&request)?;
        items.retain(|item| {
            let mut item_path = parent_path.clone();
            item_path.push(item.name.clone());
            claims
                .allowed_resource_paths
                .iter()
                .any(|scope| path_is_within(&item_path, scope) || path_is_within(scope, &item_path))
                && !claims
                    .forbidden_resource_paths
                    .iter()
                    .any(|scope| path_is_within(&item_path, scope))
        });
        if items.len() > claims.max_rows as usize {
            items.truncate(claims.max_rows as usize);
        }
        let response_bytes = items
            .iter()
            .map(|item| item.name.len() + item.kind.len() + item.metadata_json.len())
            .sum::<usize>();
        if response_bytes as u64 > claims.max_result_bytes {
            return Err(Status::resource_exhausted(
                "managed metadata result exceeds the assigned response-size limit",
            ));
        }
        Ok(Response::new(ResourceResponse {
            items,
            policy_revision: claims.policy_revision,
        }))
    }

    type ExecuteReadOnlyStream =
        Pin<Box<dyn Stream<Item = Result<QueryChunk, Status>> + Send + 'static>>;

    async fn execute_read_only(
        &self,
        request: Request<QueryRequest>,
    ) -> Result<Response<Self::ExecuteReadOnlyStream>, Status> {
        let peer_certificate_fingerprint = Self::peer_certificate_fingerprint(&request)?;
        let request = request.into_inner();
        if request.sql.len() > 200_000 || request.sql.trim().is_empty() {
            return Err(Status::invalid_argument(
                "query must contain between 1 and 200000 bytes",
            ));
        }
        let (claims, authorization) = self.authorize(
            &request.access_ticket,
            request.scope.as_ref(),
            AccessAction::QueryRead,
            &peer_certificate_fingerprint,
        )?;
        self.require_source(authorization.data_source_id)?;
        let driver = self.driver(authorization.data_source_id).await?;
        let dialect = driver
            .statement_scan_dialect()
            .ok_or_else(|| Status::failed_precondition("driver does not support read-only SQL"))?;
        validate_read_only_sql(&request.sql, dialect).map_err(Status::permission_denied)?;
        authorize_sql_relations(
            &request.sql,
            dialect,
            request.database.as_deref(),
            request.schema.as_deref(),
            &claims.allowed_resource_paths,
            &claims.forbidden_resource_paths,
        )?;
        let mut results = if let Some(database) = request.database.as_deref() {
            driver
                .query_database_with_context_tracked(
                    None,
                    database,
                    &request.sql,
                    request.schema.as_deref(),
                )
                .await
        } else if let Some(schema) = request.schema.as_deref() {
            driver.query_with_context(&request.sql, schema).await
        } else {
            driver.query(&request.sql).await
        }
        .map_err(|error| {
            tracing::warn!(
                data_source_id = %authorization.data_source_id,
                error = %oxide_studio_lib::core::redaction::redact_connection_url(&error.to_string()),
                "managed read-only query failed"
            );
            Status::internal("managed query failed")
        })?;

        let mut remaining = claims.max_rows as usize;
        let mut returned_rows = 0_u64;
        let mut truncated = false;
        for result in &mut results {
            if result.rows.len() > remaining {
                result.rows.truncate(remaining);
                truncated = true;
            }
            remaining = remaining.saturating_sub(result.rows.len());
            returned_rows += result.rows.len() as u64;
            if remaining == 0 {
                truncated = true;
            }
        }
        let payload = serde_json::to_vec(&results)
            .map_err(|_| Status::internal("failed to encode managed query result"))?;
        if payload.len() as u64 > claims.max_result_bytes {
            return Err(Status::resource_exhausted(
                "managed query result exceeds the assigned response-size limit",
            ));
        }
        let chunks = vec![Ok(QueryChunk {
            encoding: crate::proto::query_chunk::Encoding::Json as i32,
            payload,
            sequence: 0,
            final_chunk: true,
            returned_rows,
            truncated,
        })];
        Ok(Response::new(
            Box::pin(stream::iter(chunks)) as Self::ExecuteReadOnlyStream
        ))
    }
}

fn metadata_error(error: anyhow::Error) -> Status {
    tracing::warn!(
        error = %oxide_studio_lib::core::redaction::redact_connection_url(&error.to_string()),
        "managed metadata request failed"
    );
    Status::internal("managed metadata request failed")
}

fn require_metadata_scope(
    request: &ResourceRequest,
    authorized_path: &[String],
) -> Result<(), Status> {
    let expected = metadata_parent_path(request)?;
    if expected.len() != authorized_path.len()
        || !expected
            .iter()
            .zip(authorized_path)
            .all(|(expected, actual)| expected.eq_ignore_ascii_case(actual))
    {
        return Err(Status::permission_denied(
            "metadata request scope does not match the listed parent resource",
        ));
    }
    Ok(())
}

fn metadata_parent_path(request: &ResourceRequest) -> Result<Vec<String>, Status> {
    let mut expected = Vec::new();
    if let Some(database) = request.database.as_deref() {
        expected.push(database.to_string());
    }
    match request.kind.as_str() {
        "database" => expected.clear(),
        "schema" => {}
        "table" => expected.push(
            request
                .schema
                .as_deref()
                .ok_or_else(|| Status::invalid_argument("schema is required"))?
                .to_string(),
        ),
        "column" => {
            expected.push(
                request
                    .schema
                    .as_deref()
                    .ok_or_else(|| Status::invalid_argument("schema is required"))?
                    .to_string(),
            );
            expected.push(
                request
                    .object_name
                    .as_deref()
                    .ok_or_else(|| Status::invalid_argument("object_name is required"))?
                    .to_string(),
            );
        }
        _ => {}
    }
    Ok(expected)
}

fn resource_item(
    kind: &str,
    name: String,
    metadata: &impl serde::Serialize,
) -> Result<ResourceItem, Status> {
    Ok(ResourceItem {
        kind: kind.into(),
        name,
        metadata_json: serde_json::to_vec(metadata)
            .map_err(|_| Status::internal("managed metadata encoding failed"))?,
    })
}

#[derive(Default)]
struct RelationCollector {
    relations: Vec<Vec<String>>,
}

impl Visitor for RelationCollector {
    type Break = ();

    fn pre_visit_relation(&mut self, relation: &ObjectName) -> ControlFlow<Self::Break> {
        self.relations.push(
            relation
                .0
                .iter()
                .map(ToString::to_string)
                .map(|segment| segment.trim_matches(['`', '"']).to_ascii_lowercase())
                .collect(),
        );
        ControlFlow::Continue(())
    }
}

fn authorize_sql_relations(
    sql: &str,
    scan_dialect: oxide_studio_lib::core::statement::StatementScanDialect,
    database: Option<&str>,
    schema: Option<&str>,
    allowed_scopes: &[Vec<String>],
    forbidden_scopes: &[Vec<String>],
) -> Result<(), Status> {
    let statements = match scan_dialect {
        oxide_studio_lib::core::statement::StatementScanDialect::Mysql => {
            Parser::parse_sql(&MySqlDialect {}, sql)
        }
        oxide_studio_lib::core::statement::StatementScanDialect::Postgres => {
            Parser::parse_sql(&PostgreSqlDialect {}, sql)
        }
        oxide_studio_lib::core::statement::StatementScanDialect::SqlServer => {
            Parser::parse_sql(&MsSqlDialect {}, sql)
        }
    }
    .map_err(|_| {
        Status::permission_denied(
            "the query could not be parsed for enterprise object authorization",
        )
    })?;
    let mut collector = RelationCollector::default();
    let _ = statements.visit(&mut collector);
    if collector.relations.is_empty() {
        return Err(Status::permission_denied(
            "the query does not contain an authorizable relation",
        ));
    }
    for relation in collector.relations {
        let mut actual = Vec::new();
        if relation.len() == 1 {
            if let Some(database) = database {
                actual.push(database.to_ascii_lowercase());
            }
            if let Some(schema) = schema {
                actual.push(schema.to_ascii_lowercase());
            }
        } else if relation.len() == 2 {
            if let Some(database) = database {
                actual.push(database.to_ascii_lowercase());
            }
        }
        actual.extend(relation);
        if !allowed_scopes
            .iter()
            .any(|allowed| path_is_within(&actual, allowed))
        {
            return Err(Status::permission_denied(
                "the query references an object outside the effective enterprise grants",
            ));
        }
        if forbidden_scopes
            .iter()
            .any(|forbidden| path_is_within(&actual, forbidden))
        {
            return Err(Status::permission_denied(
                "the query references an explicitly excluded enterprise object",
            ));
        }
    }
    Ok(())
}

fn path_is_within(resource: &[String], scope: &[String]) -> bool {
    scope.len() <= resource.len()
        && scope
            .iter()
            .zip(resource)
            .all(|(expected, actual)| expected.eq_ignore_ascii_case(actual))
}

fn authorization_request(
    scope: &RequestScope,
    expected_action: AccessAction,
) -> Result<AuthorizationRequest, Status> {
    let parse = |label: &'static str, value: &str| {
        value
            .parse::<Uuid>()
            .map_err(|_| Status::invalid_argument(format!("{label} must be a UUID")))
    };
    if scope.resource_path.len() > 16
        || scope
            .resource_path
            .iter()
            .any(|segment| segment.is_empty() || segment.len() > 256)
    {
        return Err(Status::invalid_argument("resource path is invalid"));
    }
    Ok(AuthorizationRequest {
        principal_id: parse("principal_id", &scope.principal_id)?,
        organization_id: parse("organization_id", &scope.organization_id)?,
        project_id: parse("project_id", &scope.project_id)?,
        data_source_id: parse("data_source_id", &scope.data_source_id)?,
        resource_path: scope.resource_path.clone(),
        action: expected_action,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxide_studio_lib::core::statement::StatementScanDialect;

    #[test]
    fn sql_authorization_checks_every_joined_relation() {
        let sql = "SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id";
        assert!(authorize_sql_relations(
            sql,
            StatementScanDialect::Postgres,
            Some("app"),
            Some("public"),
            &[vec!["app".into(), "public".into()]],
            &[],
        )
        .is_ok());
        assert!(authorize_sql_relations(
            sql,
            StatementScanDialect::Postgres,
            Some("app"),
            Some("public"),
            &[vec!["app".into(), "public".into(), "orders".into()]],
            &[],
        )
        .is_err());
    }

    #[test]
    fn unparsable_and_relation_free_sql_fails_closed() {
        assert!(authorize_sql_relations(
            "SELECT FROM",
            StatementScanDialect::Postgres,
            Some("app"),
            Some("public"),
            &[vec![]],
            &[],
        )
        .is_err());
        assert!(authorize_sql_relations(
            "SELECT 1",
            StatementScanDialect::Postgres,
            Some("app"),
            Some("public"),
            &[vec![]],
            &[],
        )
        .is_err());
    }

    #[test]
    fn sql_authorization_applies_explicit_exclusions() {
        assert!(authorize_sql_relations(
            "SELECT * FROM private_orders",
            StatementScanDialect::Postgres,
            Some("app"),
            Some("public"),
            &[vec!["app".into(), "public".into()]],
            &[vec!["app".into(), "public".into(), "private_orders".into(),]],
        )
        .is_err());
    }
}
