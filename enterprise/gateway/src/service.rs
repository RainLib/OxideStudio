use crate::{
    config::{allows_insecure_transport, validate_connection_transport, DataSourceConfig},
    proto::{
        data_plane_server::DataPlane, CapabilitiesRequest, CapabilitiesResponse,
        NativeQueryRequest, QueryChunk, QueryRequest, RequestScope, ResourceItem, ResourceRequest,
        ResourceResponse,
    },
    revocation::RevocationState,
    secret::SecretProvider,
};
use ed25519_dalek::VerifyingKey;
use oxide_enterprise_contracts::{
    certificate_fingerprint, verify_ticket, AccessAction, AccessSessionTicket,
    AuthorizationRequest, ENTERPRISE_CONTRACT_VERSION,
};
use oxide_studio_lib::{
    core::{driver::DatabaseDriver, protocol::QueryResult, statement::validate_read_only_sql},
    drivers::connect_driver,
};
use serde_json::Value;
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
    revocations: Arc<RevocationState>,
    allow_insecure_database_transport: bool,
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
        revocations: Arc<RevocationState>,
        allow_insecure_database_transport: bool,
    ) -> Self {
        Self {
            gateway_id,
            verifying_key,
            sources,
            secrets,
            revocations,
            allow_insecure_database_transport,
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
        self.revocations
            .authorize_device_certificate(&claims.device_certificate_fingerprint)?;
        self.revocations.authorize_ticket_nonce(claims.nonce)?;
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
        validate_connection_transport(
            &source.driver,
            secret.connection_url(),
            allows_insecure_transport(source, self.allow_insecure_database_transport),
        )
        .map_err(|error| {
            tracing::warn!(
                data_source_id = %source_id,
                driver = %source.driver,
                error = %error,
                "gateway rejected a database connection without verified transport"
            );
            Status::failed_precondition(
                "managed data source requires a verified database TLS connection",
            )
        })?;
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
        let source = self.require_source(authorization.data_source_id)?;
        require_metadata_scope_for_source(&request, &authorization.resource_path, &source.driver)?;
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
                let object_name = request
                    .object_name
                    .as_deref()
                    .ok_or_else(|| Status::invalid_argument("object_name is required"))?;
                let columns =
                    if canonical_native_provider(&source.driver).ok() == Some("elasticsearch") {
                        driver.get_columns("", object_name).await
                    } else if let Some(database) = request.database.as_deref() {
                        let schema = request
                            .schema
                            .as_deref()
                            .ok_or_else(|| Status::invalid_argument("schema is required"))?;
                        driver
                            .get_database_columns(database, schema, object_name)
                            .await
                    } else {
                        let schema = request
                            .schema
                            .as_deref()
                            .ok_or_else(|| Status::invalid_argument("schema is required"))?;
                        driver.get_columns(schema, object_name).await
                    }
                    .map_err(metadata_error)?;
                columns
                    .into_iter()
                    .map(|column| resource_item("column", column.name.clone(), &column))
                    .collect::<Result<Vec<_>, _>>()?
            }
            "collection" => {
                let namespace = request
                    .database
                    .as_deref()
                    .or(request.schema.as_deref())
                    .unwrap_or("");
                driver
                    .get_collections(namespace)
                    .await
                    .map_err(metadata_error)?
                    .into_iter()
                    .map(|collection| {
                        resource_item("collection", collection.name.clone(), &collection)
                    })
                    .collect::<Result<Vec<_>, _>>()?
            }
            _ => {
                return Err(Status::invalid_argument(
                    "kind must be database, schema, table, column, or collection",
                ));
            }
        };
        let parent_path = metadata_parent_path_for_source(&request, &source.driver)?;
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
    type ExecuteNativeReadOnlyStream =
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

        let (payload, returned_rows, truncated) = encode_bounded_results(&mut results, &claims)?;
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

    async fn execute_native_read_only(
        &self,
        request: Request<NativeQueryRequest>,
    ) -> Result<Response<Self::ExecuteReadOnlyStream>, Status> {
        let peer_certificate_fingerprint = Self::peer_certificate_fingerprint(&request)?;
        let request = request.into_inner();
        if request.payload.len() > 200_000 || request.payload.trim().is_empty() {
            return Err(Status::invalid_argument(
                "native query must contain between 1 and 200000 bytes",
            ));
        }
        let (claims, authorization) = self.authorize(
            &request.access_ticket,
            request.scope.as_ref(),
            AccessAction::QueryRead,
            &peer_certificate_fingerprint,
        )?;
        let source = self.require_source(authorization.data_source_id)?;
        let provider = canonical_native_provider(&request.provider)?;
        if canonical_native_provider(&source.driver)? != provider {
            return Err(Status::failed_precondition(
                "native query provider does not match the managed data source",
            ));
        }
        let target =
            validate_native_read_only(provider, &request.payload, request.context.as_deref())?;
        authorize_native_resource(
            &authorization.resource_path,
            &target.resource_path,
            &claims.allowed_resource_paths,
            &claims.forbidden_resource_paths,
        )?;
        let driver = self.driver(authorization.data_source_id).await?;
        let mut results = driver
            .query_with_context(&request.payload, &target.context)
            .await
            .map_err(|error| {
                tracing::warn!(
                    data_source_id = %authorization.data_source_id,
                    provider,
                    error = %oxide_studio_lib::core::redaction::redact_connection_url(&error.to_string()),
                    "managed native read-only query failed"
                );
                Status::internal("managed native query failed")
            })?;
        let (payload, returned_rows, truncated) = encode_bounded_results(&mut results, &claims)?;
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

struct NativeReadTarget {
    context: String,
    resource_path: Vec<String>,
}

fn encode_bounded_results(
    results: &mut [QueryResult],
    claims: &oxide_enterprise_contracts::AccessSessionClaims,
) -> Result<(Vec<u8>, u64, bool), Status> {
    let mut remaining = claims.max_rows as usize;
    let mut returned_rows = 0_u64;
    let mut truncated = false;
    for result in &mut *results {
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
    let payload = serde_json::to_vec(results)
        .map_err(|_| Status::internal("failed to encode managed query result"))?;
    if payload.len() as u64 > claims.max_result_bytes {
        return Err(Status::resource_exhausted(
            "managed query result exceeds the assigned response-size limit",
        ));
    }
    Ok((payload, returned_rows, truncated))
}

fn canonical_native_provider(value: &str) -> Result<&'static str, Status> {
    match value.trim().to_ascii_lowercase().as_str() {
        "mongodb" | "mongo" => Ok("mongodb"),
        "elasticsearch" | "elastic" => Ok("elasticsearch"),
        _ => Err(Status::failed_precondition(
            "managed data source does not support native read-only queries",
        )),
    }
}

fn validate_native_read_only(
    provider: &str,
    payload: &str,
    context: Option<&str>,
) -> Result<NativeReadTarget, Status> {
    match provider {
        "mongodb" => validate_mongodb_native_read_only(payload, context),
        "elasticsearch" => validate_elasticsearch_native_read_only(payload, context),
        _ => Err(Status::failed_precondition(
            "managed data source does not support native read-only queries",
        )),
    }
}

fn validate_mongodb_native_read_only(
    payload: &str,
    context: Option<&str>,
) -> Result<NativeReadTarget, Status> {
    let value: Value = serde_json::from_str(payload)
        .map_err(|_| Status::invalid_argument("MongoDB native query must be one JSON object"))?;
    let object = value
        .as_object()
        .ok_or_else(|| Status::invalid_argument("MongoDB native query must be one JSON object"))?;
    let allowed_fields = [
        "database",
        "collection",
        "find",
        "aggregate",
        "count",
        "countDocuments",
        "filter",
        "pipeline",
        "query",
        "cursor",
        "limit",
        "skip",
        "sort",
        "projection",
    ];
    if object
        .keys()
        .any(|key| !allowed_fields.contains(&key.as_str()))
    {
        return Err(Status::permission_denied(
            "MongoDB managed queries only allow find, aggregate, and countDocuments",
        ));
    }
    reject_forbidden_mongodb_operators(&value)?;

    let payload_database = match object.get("database") {
        Some(Value::String(database)) => Some(validate_mongodb_name(database)?),
        Some(_) => {
            return Err(Status::invalid_argument(
                "MongoDB database must be a string",
            ))
        }
        None => None,
    };
    let request_database = context
        .map(validate_mongodb_name)
        .transpose()?
        .or(payload_database.clone())
        .ok_or_else(|| Status::invalid_argument("MongoDB database context is required"))?;
    if let Some(database) = payload_database {
        if !database.eq_ignore_ascii_case(&request_database) {
            return Err(Status::permission_denied(
                "MongoDB query database does not match the selected database context",
            ));
        }
    }

    let operation_keys = ["find", "aggregate", "count", "countDocuments"];
    let operations = operation_keys
        .iter()
        .filter(|&&key| object.contains_key(key))
        .copied()
        .collect::<Vec<_>>();
    if operations.len() != 1 {
        return Err(Status::permission_denied(
            "MongoDB managed query must contain exactly one read-only operation",
        ));
    }
    let operation = operations[0];
    let collection_from_field = object.get("collection").and_then(Value::as_str);
    let collection_from_command = match operation {
        "find" | "aggregate" | "count" => object.get(operation).and_then(Value::as_str),
        "countDocuments" => None,
        _ => None,
    };
    let collection = match (collection_from_field, collection_from_command) {
        (Some(field), Some(command)) if !field.eq_ignore_ascii_case(command) => {
            return Err(Status::permission_denied(
                "MongoDB query collection conflicts with the native command target",
            ));
        }
        (Some(field), _) | (_, Some(field)) => validate_mongodb_name(field)?,
        (None, None) => {
            return Err(Status::invalid_argument(
                "MongoDB collection is required for managed native queries",
            ));
        }
    };
    if object.contains_key("collection") && collection_from_field.is_none() {
        return Err(Status::invalid_argument(
            "MongoDB collection must be a string",
        ));
    }
    validate_mongodb_operation_shape(object, operation)?;
    Ok(NativeReadTarget {
        context: request_database.clone(),
        resource_path: vec![request_database, collection],
    })
}

fn validate_mongodb_operation_shape(
    object: &serde_json::Map<String, Value>,
    operation: &str,
) -> Result<(), Status> {
    let is_object = |name: &str| object.get(name).is_none_or(Value::is_object);
    match operation {
        "find" => {
            if let Some(value) = object.get("find") {
                if !value.is_object() && !value.is_string() {
                    return Err(Status::invalid_argument(
                        "MongoDB find must be an object or collection name",
                    ));
                }
            }
            if !is_object("filter") || !is_object("sort") || !is_object("projection") {
                return Err(Status::invalid_argument(
                    "MongoDB find options must be JSON objects",
                ));
            }
            if object
                .get("limit")
                .is_some_and(|value| !value.is_i64() && !value.is_u64())
                || object
                    .get("skip")
                    .is_some_and(|value| !value.is_i64() && !value.is_u64())
            {
                return Err(Status::invalid_argument(
                    "MongoDB find limit and skip must be integers",
                ));
            }
        }
        "aggregate" => {
            let pipeline = if object.get("aggregate").is_some_and(Value::is_string) {
                object.get("pipeline")
            } else {
                object.get("aggregate")
            };
            if !pipeline.is_some_and(Value::is_array) {
                return Err(Status::invalid_argument(
                    "MongoDB aggregate pipeline must be a JSON array",
                ));
            }
            if object.get("cursor").is_some_and(|value| !value.is_object()) {
                return Err(Status::invalid_argument(
                    "MongoDB aggregate cursor must be a JSON object",
                ));
            }
        }
        "count" | "countDocuments" => {
            let filter = if operation == "count" {
                object.get("query")
            } else {
                object.get("countDocuments")
            };
            if filter.is_some_and(|value| !value.is_object()) {
                return Err(Status::invalid_argument(
                    "MongoDB count filter must be a JSON object",
                ));
            }
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn reject_forbidden_mongodb_operators(value: &Value) -> Result<(), Status> {
    const FORBIDDEN: &[&str] = &[
        "$accumulator",
        "$changeStream",
        "$function",
        "$graphLookup",
        "$lookup",
        "$merge",
        "$out",
        "$unionWith",
        "$where",
    ];
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if FORBIDDEN
                    .iter()
                    .any(|forbidden| key.eq_ignore_ascii_case(forbidden))
                {
                    return Err(Status::permission_denied(
                        "MongoDB managed query contains a disallowed server-side or cross-collection operator",
                    ));
                }
                reject_forbidden_mongodb_operators(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                reject_forbidden_mongodb_operators(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_mongodb_name(value: &str) -> Result<String, Status> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 255
        || value.chars().any(|character| {
            matches!(character, '/' | '\\' | '.' | '"' | '$' | '\0') || character.is_control()
        })
    {
        return Err(Status::invalid_argument(
            "MongoDB database or collection name is invalid",
        ));
    }
    Ok(value.to_string())
}

fn validate_elasticsearch_native_read_only(
    payload: &str,
    context: Option<&str>,
) -> Result<NativeReadTarget, Status> {
    let context = context.map(validate_elasticsearch_index).transpose()?;
    let trimmed = payload.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        let body: Value = serde_json::from_str(trimmed)
            .map_err(|_| Status::invalid_argument("Elasticsearch search body must be JSON"))?;
        reject_expensive_elasticsearch_constructs(&body)?;
        let index = context.ok_or_else(|| {
            Status::invalid_argument("Elasticsearch JSON search requires an index context")
        })?;
        return Ok(NativeReadTarget {
            context: index.clone(),
            resource_path: vec![index],
        });
    }

    let mut lines = trimmed.lines().filter(|line| !line.trim().is_empty());
    let first = lines
        .next()
        .ok_or_else(|| Status::invalid_argument("Elasticsearch search request is required"))?
        .trim();
    let mut parts = first.splitn(3, char::is_whitespace);
    let method = parts.next().unwrap_or("").to_ascii_uppercase();
    let path = parts
        .next()
        .ok_or_else(|| Status::invalid_argument("Elasticsearch search request path is required"))?;
    let inline_body = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if !matches!(method.as_str(), "GET" | "POST") {
        return Err(Status::permission_denied(
            "managed Elasticsearch queries only allow GET or POST search requests",
        ));
    }
    if path.contains('?') || path.contains('%') || !path.starts_with('/') {
        return Err(Status::permission_denied(
            "managed Elasticsearch search paths must be a plain index/_search path",
        ));
    }
    let segments = path.trim_start_matches('/').split('/').collect::<Vec<_>>();
    let [index, endpoint] = segments.as_slice() else {
        return Err(Status::permission_denied(
            "managed Elasticsearch queries only allow one concrete index _search endpoint",
        ));
    };
    if *endpoint != "_search" {
        return Err(Status::permission_denied(
            "managed Elasticsearch queries only allow the _search endpoint",
        ));
    }
    let index = validate_elasticsearch_index(index)?;
    if let Some(context) = context {
        if !context.eq_ignore_ascii_case(&index) {
            return Err(Status::permission_denied(
                "Elasticsearch search index does not match the selected index context",
            ));
        }
    }
    let body = std::iter::once(inline_body)
        .flatten()
        .chain(lines.map(str::trim))
        .collect::<Vec<_>>()
        .join("\n");
    if !body.trim().is_empty() {
        let body: Value = serde_json::from_str(&body)
            .map_err(|_| Status::invalid_argument("Elasticsearch search body must be JSON"))?;
        reject_expensive_elasticsearch_constructs(&body)?;
    }
    Ok(NativeReadTarget {
        context: index.clone(),
        resource_path: vec![index],
    })
}

fn validate_elasticsearch_index(value: &str) -> Result<String, Status> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 255
        || value.starts_with('_')
        || value.contains(',')
        || value.contains('*')
        || value
            .chars()
            .any(|character| matches!(character, '/' | '\\' | '\0') || character.is_control())
    {
        return Err(Status::invalid_argument(
            "Elasticsearch index must be one concrete index name",
        ));
    }
    Ok(value.to_string())
}

fn reject_expensive_elasticsearch_constructs(value: &Value) -> Result<(), Status> {
    const FORBIDDEN: &[&str] = &["script", "runtime_mappings"];
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if FORBIDDEN
                    .iter()
                    .any(|forbidden| key.eq_ignore_ascii_case(forbidden))
                {
                    return Err(Status::permission_denied(
                        "managed Elasticsearch search does not allow scripts or runtime mappings",
                    ));
                }
                reject_expensive_elasticsearch_constructs(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                reject_expensive_elasticsearch_constructs(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn authorize_native_resource(
    requested_path: &[String],
    actual_path: &[String],
    allowed_scopes: &[Vec<String>],
    forbidden_scopes: &[Vec<String>],
) -> Result<(), Status> {
    if requested_path.len() != actual_path.len()
        || !requested_path
            .iter()
            .zip(actual_path)
            .all(|(requested, actual)| requested.eq_ignore_ascii_case(actual))
    {
        return Err(Status::permission_denied(
            "native query target does not match the ticket resource scope",
        ));
    }
    if !allowed_scopes
        .iter()
        .any(|allowed| path_is_within(actual_path, allowed))
    {
        return Err(Status::permission_denied(
            "native query references an object outside the effective enterprise grants",
        ));
    }
    if forbidden_scopes
        .iter()
        .any(|forbidden| path_is_within(actual_path, forbidden))
    {
        return Err(Status::permission_denied(
            "native query references an explicitly excluded enterprise object",
        ));
    }
    Ok(())
}

fn require_metadata_scope_for_source(
    request: &ResourceRequest,
    authorized_path: &[String],
    driver: &str,
) -> Result<(), Status> {
    let expected = metadata_parent_path_for_source(request, driver)?;
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

fn metadata_parent_path_for_source(
    request: &ResourceRequest,
    driver: &str,
) -> Result<Vec<String>, Status> {
    let native = canonical_native_provider(driver).ok();
    if request.kind == "collection" {
        return match native {
            Some("mongodb") => request
                .database
                .clone()
                .map(|value| vec![value])
                .ok_or_else(|| Status::invalid_argument("database is required")),
            Some("elasticsearch") => Ok(Vec::new()),
            _ => metadata_parent_path(request),
        };
    }
    if native == Some("elasticsearch") && request.kind == "column" {
        return request
            .object_name
            .clone()
            .map(|value| vec![value])
            .ok_or_else(|| Status::invalid_argument("object_name is required"));
    }
    metadata_parent_path(request)
}

fn metadata_error(error: anyhow::Error) -> Status {
    tracing::warn!(
        error = %oxide_studio_lib::core::redaction::redact_connection_url(&error.to_string()),
        "managed metadata request failed"
    );
    Status::internal("managed metadata request failed")
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

    #[test]
    fn native_mongodb_read_only_targets_one_collection_and_rejects_writes() {
        let target = validate_mongodb_native_read_only(
            r#"{"database":"app","find":"orders","filter":{"state":"open"},"limit":25}"#,
            Some("app"),
        )
        .unwrap();
        assert_eq!(target.context, "app");
        assert_eq!(target.resource_path, ["app", "orders"]);
        assert!(validate_mongodb_native_read_only(
            r#"{"database":"app","collection":"orders","deleteMany":{}}"#,
            Some("app"),
        )
        .is_err());
        assert!(validate_mongodb_native_read_only(
            r#"{"database":"app","aggregate":"orders","pipeline":[{"$lookup":{"from":"users"}}]}"#,
            Some("app"),
        )
        .is_err());
    }

    #[test]
    fn native_elasticsearch_requires_one_concrete_index_search() {
        let target = validate_elasticsearch_native_read_only(
            "POST /logs-2026/_search\n{\"query\":{\"match_all\":{}}}",
            Some("logs-2026"),
        )
        .unwrap();
        assert_eq!(target.resource_path, ["logs-2026"]);
        assert!(
            validate_elasticsearch_native_read_only("POST /logs-*/_search\n{}", None,).is_err()
        );
        assert!(validate_elasticsearch_native_read_only(
            "POST /logs-2026/_delete_by_query\n{}",
            None,
        )
        .is_err());
        assert!(validate_elasticsearch_native_read_only(
            r#"{"script":{"source":"return true"}}"#,
            Some("logs-2026"),
        )
        .is_err());
    }

    #[test]
    fn native_scope_must_bind_exact_target_and_honor_exclusions() {
        let actual = vec!["app".to_string(), "orders".to_string()];
        assert!(authorize_native_resource(
            &["app".into(), "orders".into()],
            &actual,
            &[vec!["app".into()]],
            &[],
        )
        .is_ok());
        assert!(
            authorize_native_resource(&["app".into()], &actual, &[vec!["app".into()]], &[],)
                .is_err()
        );
        assert!(authorize_native_resource(
            &["app".into(), "orders".into()],
            &actual,
            &[vec!["app".into()]],
            &[vec!["app".into(), "orders".into()]],
        )
        .is_err());
    }

    #[test]
    fn native_metadata_scope_preserves_collection_and_index_boundaries() {
        let mongo = ResourceRequest {
            access_ticket: String::new(),
            scope: None,
            kind: "collection".into(),
            database: Some("app".into()),
            schema: None,
            object_name: None,
        };
        assert_eq!(
            metadata_parent_path_for_source(&mongo, "mongodb").unwrap(),
            ["app"]
        );
        let elastic = ResourceRequest {
            access_ticket: String::new(),
            scope: None,
            kind: "column".into(),
            database: None,
            schema: None,
            object_name: Some("logs-2026".into()),
        };
        assert_eq!(
            metadata_parent_path_for_source(&elastic, "elasticsearch").unwrap(),
            ["logs-2026"]
        );
    }
}
