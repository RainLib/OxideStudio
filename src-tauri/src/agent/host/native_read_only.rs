use super::identity_helpers::bounded_text;
use serde_json::Value;

pub(super) fn contains_native_transaction_control(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            let normalized = key
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect::<String>();
            matches!(
                normalized.as_str(),
                "starttransaction"
                    | "committransaction"
                    | "aborttransaction"
                    | "transaction"
                    | "session"
                    | "lsid"
                    | "autocommit"
            ) || contains_native_transaction_control(value)
        }),
        Value::Array(values) => values.iter().any(contains_native_transaction_control),
        _ => false,
    }
}

pub(super) fn validate_native_read_only_query(
    driver: &str,
    query: &str,
) -> std::result::Result<(), String> {
    let driver = driver.trim().to_ascii_lowercase();
    match driver.as_str() {
        "elasticsearch" | "elastic" | "es" => validate_elasticsearch_read_only_query(query),
        "mongodb" | "mongo" => validate_mongodb_read_only_query(query),
        "redis" => validate_redis_read_only_query(query),
        "etcd" | "consul" => validate_native_key_value_read_only_query(driver.as_str(), query),
        "nacos" => validate_nacos_read_only_query(query),
        _ => Err(format!(
            "query.runReadOnly is unsupported for driver {}",
            bounded_text(&driver, 80)
        )),
    }
}

/// The bundled Consul and etcd integrations deliberately expose only a
/// concrete key preview. Keep the Agent boundary exactly as narrow: no
/// prefixes, multiple commands, or driver-specific REST syntax can cross it.
pub(super) fn validate_native_key_value_read_only_query(
    driver: &str,
    query: &str,
) -> std::result::Result<(), String> {
    let value = parse_native_get_json(driver, query)?;
    let key = value
        .as_str()
        .ok_or_else(|| format!("{driver} GET requires one JSON-quoted key"))?;
    validate_native_key_component(driver, "key", key, true)
}

/// Nacos configuration identity is a three-part object. Requiring all three
/// fields prevents an Agent from turning a preview into an implicit group or
/// namespace-wide request as the provider evolves.
pub(super) fn validate_nacos_read_only_query(query: &str) -> std::result::Result<(), String> {
    let value = parse_native_get_json("Nacos", query)?;
    let object = value.as_object().ok_or_else(|| {
        "Nacos GET requires a JSON config key with dataId, group and tenant".to_string()
    })?;
    for field in ["dataId", "group", "tenant"] {
        let value = object
            .get(field)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Nacos GET requires a string {field}"))?;
        validate_native_key_component("Nacos", field, value, field != "tenant")?;
    }
    Ok(())
}

pub(super) fn parse_native_get_json(
    driver: &str,
    query: &str,
) -> std::result::Result<Value, String> {
    let query = query.trim();
    let Some(payload) = query
        .strip_prefix("GET ")
        .or_else(|| query.strip_prefix("get "))
    else {
        return Err(format!(
            "{driver} read-only queries only support GET <JSON-key>"
        ));
    };
    serde_json::from_str(payload.trim())
        .map_err(|_| format!("{driver} GET requires one complete JSON key"))
}

pub(super) fn validate_native_key_component(
    driver: &str,
    field: &str,
    value: &str,
    required: bool,
) -> std::result::Result<(), String> {
    if (required && value.trim().is_empty()) || value.len() > 1_024 || value.contains('\0') {
        return Err(format!("{driver} {field} is invalid"));
    }
    Ok(())
}

pub(super) fn validate_elasticsearch_read_only_query(
    query: &str,
) -> std::result::Result<(), String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Elasticsearch read request is empty".to_string());
    }
    if query.starts_with('{') || query.starts_with('[') {
        let value: Value = serde_json::from_str(query)
            .map_err(|_| "Elasticsearch search body must be valid JSON".to_string())?;
        if value.is_object() || value.is_array() {
            return Ok(());
        }
        return Err("Elasticsearch search body must be a JSON object or array".to_string());
    }

    let mut request_count = 0usize;
    for line in uncommented_elasticsearch_lines(query) {
        let mut parts = line.split_whitespace();
        let method = parts.next().unwrap_or_default().to_ascii_uppercase();
        if !matches!(
            method.as_str(),
            "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE"
        ) {
            if request_count == 0 {
                return Err(
                    "Elasticsearch read request must start with a Kibana-style request line"
                        .to_string(),
                );
            }
            continue;
        }
        let path = parts
            .next()
            .ok_or_else(|| "Elasticsearch request path is required".to_string())?;
        if path.contains("://") {
            return Err("Elasticsearch request path must be relative".to_string());
        }
        request_count += 1;
        if request_count > 20 {
            return Err("Elasticsearch read request exceeds 20 operations".to_string());
        }
        match method.as_str() {
            "GET" | "HEAD" | "OPTIONS" => {}
            "POST" if is_elasticsearch_read_only_post_path(path) => {}
            _ => {
                return Err(format!(
                    "Elasticsearch {method} {path} is not allowed by query.runReadOnly"
                ));
            }
        }
    }
    if request_count == 0 {
        return Err("Elasticsearch read request contains no operations".to_string());
    }
    Ok(())
}

pub(super) fn is_elasticsearch_read_only_post_path(path: &str) -> bool {
    let path = path
        .split(['?', '#'])
        .next()
        .unwrap_or(path)
        .trim_start_matches('/')
        .to_ascii_lowercase();
    let segments = path.split('/').collect::<Vec<_>>();
    segments.iter().any(|segment| {
        matches!(
            *segment,
            "_search"
                | "_msearch"
                | "_count"
                | "_sql"
                | "_field_caps"
                | "_terms_enum"
                | "_validate"
                | "_explain"
                | "_rank_eval"
                | "_search_shards"
        )
    }) || path.contains("/_eql/search")
        || path.contains("/_async_search")
        || path.contains("/_search/scroll")
}

pub(super) fn uncommented_elasticsearch_lines(source: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut in_block_comment = false;
    for raw_line in source.lines() {
        let mut offset = 0usize;
        while offset < raw_line.len() {
            if in_block_comment {
                let Some(close) = raw_line[offset..].find("*/") else {
                    break;
                };
                in_block_comment = false;
                offset += close + 2;
                continue;
            }
            let rest = raw_line[offset..].trim_start();
            offset = raw_line.len() - rest.len();
            if rest.is_empty() {
                break;
            }
            if rest.starts_with("/*") {
                in_block_comment = true;
                offset += 2;
                continue;
            }
            if rest.starts_with('#') || rest.starts_with("//") {
                break;
            }
            lines.push(rest.to_string());
            break;
        }
    }
    lines
}

pub(super) fn validate_mongodb_read_only_query(query: &str) -> std::result::Result<(), String> {
    let value: Value = serde_json::from_str(query.trim())
        .map_err(|_| "MongoDB read request must be valid JSON".to_string())?;
    let commands = value
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_else(|| std::slice::from_ref(&value));
    if commands.is_empty() || commands.len() > 20 {
        return Err("MongoDB read request must contain 1 to 20 commands".to_string());
    }
    if commands.iter().all(is_mongodb_read_only_command) {
        Ok(())
    } else {
        Err("MongoDB request is not a supported read-only command".to_string())
    }
}

pub(super) fn is_mongodb_read_only_command(value: &Value) -> bool {
    let Some(command) = value.as_object() else {
        return false;
    };
    let operations = command
        .keys()
        .filter(|key| {
            matches!(
                key.to_ascii_lowercase().as_str(),
                "find"
                    | "aggregate"
                    | "count"
                    | "countdocuments"
                    | "insertone"
                    | "insertmany"
                    | "updateone"
                    | "updatemany"
                    | "deleteone"
                    | "deletemany"
                    | "command"
            )
        })
        .collect::<Vec<_>>();
    if operations.len() > 1 {
        return false;
    }
    match operations
        .first()
        .map(|operation| operation.to_ascii_lowercase())
        .as_deref()
    {
        Some("find") => {
            let find = command.get("find");
            let has_collection = command
                .get("collection")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty());
            let has_native_collection = find
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty());
            let filter_is_valid = command.get("filter").is_none_or(Value::is_object);
            (find.is_some_and(Value::is_object) && has_collection || has_native_collection)
                && filter_is_valid
        }
        Some("count") => {
            command
                .get("count")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
                && command.get("query").is_none_or(Value::is_object)
        }
        Some("countdocuments") => {
            command
                .get("collection")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
                && command.get("countDocuments").is_some_and(Value::is_object)
        }
        Some("aggregate") => {
            let aggregate = command.get("aggregate");
            let shorthand = aggregate.is_some_and(Value::is_array)
                && command
                    .get("collection")
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty());
            let native = aggregate
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
                && command.get("pipeline").is_some_and(Value::is_array);
            (shorthand || native)
                && !mongodb_pipeline_has_write_stage(if native {
                    command.get("pipeline")
                } else {
                    aggregate
                })
        }
        Some("command") => command
            .get("command")
            .and_then(Value::as_object)
            .and_then(|body| {
                body.keys()
                    .next()
                    .map(|name| (name.to_ascii_lowercase(), body))
            })
            .is_some_and(|(name, body)| {
                if name == "aggregate" {
                    return !mongodb_pipeline_has_write_stage(body.get("pipeline"));
                }
                matches!(
                    name.as_str(),
                    "buildinfo"
                        | "collstats"
                        | "count"
                        | "dbstats"
                        | "distinct"
                        | "explain"
                        | "find"
                        | "hello"
                        | "ismaster"
                        | "listcollections"
                        | "listdatabases"
                        | "listindexes"
                        | "ping"
                        | "serverstatus"
                )
            }),
        Some(_) => false,
        None => {
            command.get("collection").and_then(Value::as_str).is_some()
                && command.keys().all(|key| {
                    matches!(
                        key.to_ascii_lowercase().as_str(),
                        "collection" | "database" | "limit" | "skip" | "sort" | "projection"
                    )
                })
        }
    }
}

pub(super) fn mongodb_pipeline_has_write_stage(value: Option<&Value>) -> bool {
    value.and_then(Value::as_array).is_none_or(|pipeline| {
        pipeline.iter().any(|stage| {
            stage.as_object().is_some_and(|stage| {
                stage
                    .keys()
                    .any(|key| matches!(key.to_ascii_lowercase().as_str(), "$out" | "$merge"))
            })
        })
    })
}

pub(super) fn validate_redis_read_only_query(query: &str) -> std::result::Result<(), String> {
    let commands = query
        .split(['\n', '\r', ';'])
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect::<Vec<_>>();
    if commands.is_empty() || commands.len() > 50 {
        return Err("Redis read request must contain 1 to 50 commands".to_string());
    }
    if commands.iter().all(|command| {
        let mut tokens = command.split_whitespace();
        let name = tokens.next().unwrap_or_default().to_ascii_uppercase();
        let subcommand = tokens.next().unwrap_or_default().to_ascii_uppercase();
        matches!(
            name.as_str(),
            "COMMAND"
                | "DBSIZE"
                | "EXISTS"
                | "FT.INFO"
                | "FT.SEARCH"
                | "GET"
                | "GETRANGE"
                | "HGET"
                | "HGETALL"
                | "HEXISTS"
                | "HKEYS"
                | "HLEN"
                | "HMGET"
                | "HSCAN"
                | "HSTRLEN"
                | "HVALS"
                | "INFO"
                | "JSON.GET"
                | "JSON.MGET"
                | "LINDEX"
                | "LLEN"
                | "LRANGE"
                | "MGET"
                | "PING"
                | "PTTL"
                | "SCAN"
                | "SCARD"
                | "SISMEMBER"
                | "SMEMBERS"
                | "SRANDMEMBER"
                | "SSCAN"
                | "STRLEN"
                | "TTL"
                | "TYPE"
                | "XINFO"
                | "XLEN"
                | "XRANGE"
                | "XREAD"
                | "XREVRANGE"
                | "ZCARD"
                | "ZCOUNT"
                | "ZLEXCOUNT"
                | "ZRANGE"
                | "ZRANGEBYLEX"
                | "ZRANGEBYSCORE"
                | "ZRANK"
                | "ZREVRANGE"
                | "ZREVRANGEBYLEX"
                | "ZREVRANGEBYSCORE"
                | "ZREVRANK"
                | "ZSCAN"
                | "ZSCORE"
        ) || matches!(
            (name.as_str(), subcommand.as_str()),
            ("ACL", "CAT" | "GETUSER" | "LIST")
                | ("CLIENT", "ID" | "INFO" | "LIST")
                | ("CONFIG", "GET" | "HELP")
                | ("FUNCTION", "LIST" | "STATS")
                | ("MEMORY", "STATS" | "USAGE")
                | ("SCRIPT", "EXISTS" | "HELP")
                | ("SLOWLOG", "GET" | "LEN")
        )
    }) {
        Ok(())
    } else {
        Err("Redis request contains a command that is not read-only".to_string())
    }
}
