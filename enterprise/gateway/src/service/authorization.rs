use super::policy::canonical_native_provider;
use crate::proto::{RequestScope, ResourceItem, ResourceRequest};
use oxide_enterprise_contracts::{AccessAction, AuthorizationRequest};
use sqlparser::{
    ast::{ObjectName, Visit, Visitor},
    dialect::{MsSqlDialect, MySqlDialect, PostgreSqlDialect},
    parser::Parser,
};
use std::ops::ControlFlow;
use tonic::Status;
use uuid::Uuid;
pub(super) fn authorize_native_resource(
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

pub(super) fn require_metadata_scope_for_source(
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

pub(super) fn metadata_parent_path_for_source(
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

pub(super) fn metadata_error(error: anyhow::Error) -> Status {
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

pub(super) fn resource_item(
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
pub(super) fn authorize_sql_relations(
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

pub(super) fn path_is_within(resource: &[String], scope: &[String]) -> bool {
    scope.len() <= resource.len()
        && scope
            .iter()
            .zip(resource)
            .all(|(expected, actual)| expected.eq_ignore_ascii_case(actual))
}

pub(super) fn authorization_request(
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
