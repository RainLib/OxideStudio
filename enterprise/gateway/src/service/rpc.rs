use super::{
    authorization::{
        authorize_native_resource, authorize_sql_relations, metadata_error,
        metadata_parent_path_for_source, path_is_within, require_complete_metadata_scope,
        require_metadata_scope_for_source, resource_item,
    },
    models::DataPlaneService,
    policy::{
        canonical_native_provider, require_ticket_driver, require_ticket_target_binding,
        validate_native_read_only,
    },
    protocol::encode_bounded_results,
};
use crate::proto::{
    data_plane_server::DataPlane, CapabilitiesRequest, CapabilitiesResponse, MutationRequest,
    MutationResponse, NativeQueryRequest, QueryChunk, QueryRequest, ResourceRequest,
    ResourceResponse,
};
use oxide_enterprise_contracts::{AccessAction, ENTERPRISE_CONTRACT_VERSION};
use oxide_studio_lib::core::statement::validate_read_only_sql;
use std::pin::Pin;
use tokio_stream::{self as stream, Stream};
use tonic::{Request, Response, Status};
#[tonic::async_trait]
impl DataPlane for DataPlaneService {
    async fn execute_mutation(
        &self,
        request: Request<MutationRequest>,
    ) -> Result<Response<MutationResponse>, Status> {
        self.execute_managed_mutation(request).await
    }
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
        require_ticket_driver(&claims, source)?;
        require_ticket_target_binding(&claims, source)?;
        Ok(Response::new(CapabilitiesResponse {
            contract_version: ENTERPRISE_CONTRACT_VERSION.into(),
            features: if matches!(source.driver.as_str(), "postgres" | "postgresql") {
                vec![
                    "metadata.definition.v1".into(),
                    "sql.mutation.postgres.v1".into(),
                ]
            } else {
                Vec::new()
            },
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
        let action = if matches!(request.kind.as_str(), "column" | "definition") {
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
        require_ticket_driver(&claims, source)?;
        require_ticket_target_binding(&claims, source)?;
        require_metadata_scope_for_source(&request, &authorization.resource_path, &source.driver)?;
        if request.kind == "definition" {
            if metadata_parent_path_for_source(&request, &source.driver)?
                != authorization.resource_path
            {
                return Err(Status::permission_denied(
                    "Definition target must exactly match its ticket scope",
                ));
            }
            require_complete_metadata_scope(
                &authorization.resource_path,
                &claims.allowed_resource_paths,
                &claims.forbidden_resource_paths,
            )?;
        }
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
            "definition" => {
                if !matches!(source.driver.as_str(), "postgres" | "postgresql") {
                    return Err(Status::unimplemented(
                        "This Gateway provider does not implement relation definitions",
                    ));
                }
                let database = request
                    .database
                    .as_deref()
                    .ok_or_else(|| Status::invalid_argument("database is required"))?;
                let schema = request
                    .schema
                    .as_deref()
                    .ok_or_else(|| Status::invalid_argument("schema is required"))?;
                let table = request
                    .object_name
                    .as_deref()
                    .ok_or_else(|| Status::invalid_argument("object_name is required"))?;
                let definition =
                    oxide_studio_lib::core::postgres_ddl::read_postgres_relation_definition(
                        driver.as_ref(),
                        database,
                        schema,
                        table,
                    )
                    .await
                    .map_err(metadata_error)?;
                vec![resource_item("definition", table.to_string(), &definition)?]
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
        let source = self.require_source(authorization.data_source_id)?;
        require_ticket_driver(&claims, source)?;
        require_ticket_target_binding(&claims, source)?;
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
        let mut results = if !request.parameters_json.is_empty() {
            if request.parameters_json.len() > 262_144 { return Err(Status::invalid_argument("Query parameters exceed 256 KiB")); }
            let parameters:Vec<oxide_studio_lib::core::protocol::QueryParameter>=serde_json::from_slice(&request.parameters_json)
                .map_err(|_|Status::invalid_argument("Query parameters must be a typed parameter array"))?;
            if parameters.len()>1000 { return Err(Status::invalid_argument("Too many query parameters")); }
            let database=request.database.as_deref().ok_or_else(||Status::invalid_argument("Parameterized queries require a database"))?;
            driver.query_database_parameterized(database,&request.sql,&parameters).await
        } else if let Some(database) = request.database.as_deref() {
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
        require_ticket_driver(&claims, source)?;
        require_ticket_target_binding(&claims, source)?;
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
