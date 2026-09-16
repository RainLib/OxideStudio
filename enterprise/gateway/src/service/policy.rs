use crate::config::DataSourceConfig;
use oxide_enterprise_contracts::tokenize_native_redis_command;
use serde_json::Value;
use tonic::Status;

pub(super) struct NativeReadTarget {
    pub(super) context: String,
    pub(super) resource_path: Vec<String>,
}
pub(super) fn canonical_native_provider(value: &str) -> Result<&'static str, Status> {
    match value.trim().to_ascii_lowercase().as_str() {
        "mongodb" | "mongo" => Ok("mongodb"),
        "elasticsearch" | "elastic" => Ok("elasticsearch"),
        "redis" => Ok("redis"),
        _ => Err(Status::failed_precondition(
            "managed data source does not support native read-only queries",
        )),
    }
}

pub(super) fn require_ticket_driver(
    claims: &oxide_enterprise_contracts::AccessSessionClaims,
    source: &DataSourceConfig,
) -> Result<(), Status> {
    if canonical_managed_driver(&claims.driver) != canonical_managed_driver(&source.driver) {
        tracing::warn!(
            data_source_id = %source.id,
            ticket_driver = %claims.driver,
            source_driver = %source.driver,
            "managed Gateway source driver does not match the signed ticket"
        );
        return Err(Status::failed_precondition(
            "managed data source driver configuration does not match the signed access ticket",
        ));
    }
    Ok(())
}

pub(super) fn require_ticket_target_binding(
    claims: &oxide_enterprise_contracts::AccessSessionClaims,
    source: &DataSourceConfig,
) -> Result<(), Status> {
    if claims.target_binding != source.target_binding {
        tracing::warn!(
            data_source_id = %source.id,
            "access ticket target binding does not match the local Gateway source"
        );
        return Err(Status::failed_precondition(
            "access ticket target binding does not match the configured managed source",
        ));
    }
    Ok(())
}

pub(super) fn canonical_managed_driver(value: &str) -> &str {
    match value.trim().to_ascii_lowercase().as_str() {
        "postgres" | "postgresql" => "postgres",
        "mysql" => "mysql",
        "mongodb" | "mongo" => "mongodb",
        "elasticsearch" | "elastic" => "elasticsearch",
        "redis" => "redis",
        _ => "unsupported",
    }
}

pub(super) fn validate_native_read_only(
    provider: &str,
    payload: &str,
    context: Option<&str>,
) -> Result<NativeReadTarget, Status> {
    match provider {
        "mongodb" => validate_mongodb_native_read_only(payload, context),
        "elasticsearch" => validate_elasticsearch_native_read_only(payload, context),
        "redis" => validate_redis_native_read_only(payload, context),
        _ => Err(Status::failed_precondition(
            "managed data source does not support native read-only queries",
        )),
    }
}

pub(super) fn validate_redis_native_read_only(
    payload: &str,
    context: Option<&str>,
) -> Result<NativeReadTarget, Status> {
    let database = context
        .map(validate_redis_database)
        .transpose()?
        .ok_or_else(|| Status::invalid_argument("Redis database context is required"))?;
    let tokens = tokenize_native_redis_command(payload)
        .map_err(|error| Status::invalid_argument(error.to_string()))?;
    let command = tokens
        .first()
        .map(|value| value.to_ascii_uppercase())
        .ok_or_else(|| Status::invalid_argument("Redis command is required"))?;
    const READ_ONLY: &[&str] = &[
        "GET",
        "TYPE",
        "TTL",
        "PTTL",
        "STRLEN",
        "HGET",
        "HGETALL",
        "HLEN",
        "HEXISTS",
        "HKEYS",
        "HVALS",
        "LRANGE",
        "LLEN",
        "SCARD",
        "SMEMBERS",
        "SISMEMBER",
        "ZRANGE",
        "ZRANGEBYSCORE",
        "ZSCORE",
        "ZCARD",
        "XRANGE",
        "XREVRANGE",
        "XLEN",
    ];
    if !READ_ONLY.contains(&command.as_str()) || tokens.len() < 2 {
        return Err(Status::permission_denied(
            "managed Redis accepts one single-key read-only command",
        ));
    }
    let key = validate_redis_key(&tokens[1])?;
    Ok(NativeReadTarget {
        context: database.clone(),
        resource_path: vec![database, key],
    })
}

fn validate_redis_database(value: &str) -> Result<String, Status> {
    let value = value.trim();
    if value.is_empty() || !value.chars().all(|character| character.is_ascii_digit()) {
        return Err(Status::invalid_argument(
            "Redis database index must be numeric",
        ));
    }
    Ok(value.to_string())
}

fn validate_redis_key(value: &str) -> Result<String, Status> {
    let value = value.trim();
    if value.is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
        return Err(Status::invalid_argument("Redis key is invalid"));
    }
    Ok(value.to_string())
}

pub(super) fn validate_mongodb_native_read_only(
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

pub(super) fn validate_elasticsearch_native_read_only(
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
