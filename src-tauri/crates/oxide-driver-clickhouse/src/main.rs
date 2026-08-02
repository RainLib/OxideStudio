//! Standalone ClickHouse HTTP implementation of OxideStudio's driver protocol.
//!
//! This package intentionally exposes the verifiable OLAP baseline only:
//! HTTP health/version/query and catalog metadata. ClickHouse's non-transactional
//! mutation model is not presented as interactive grid editing or transactions.

use oxide_driver_protocol::{
    DriverColumn, DriverProtocolError, DriverQueryContext, DriverQueryParameter, DriverQueryResult,
    DriverRequest, DriverRequestEnvelope, DriverResponse, DriverResponseEnvelope, DriverResult,
    DriverRuntimeCapabilities, HandshakeResponse, MetadataRequest, SecretConnectionConfig,
};
use reqwest::{blocking::Client, Url};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    io::{self, BufRead, Write},
    time::Duration,
};

const PACKAGE_ID: &str = "oxide.clickhouse";
const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
const DRIVER_ID: &str = "clickhouse";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_IDENTIFIER_LENGTH: usize = 255;

#[derive(Clone)]
struct ClickHouseConnection {
    base_url: Url,
    client: Client,
    username: Option<String>,
    password: Option<String>,
    default_database: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ClickHouseBoundParameter {
    name: String,
    data_type: &'static str,
    value: String,
}

fn main() {
    let stdin = io::stdin();
    let mut connections = HashMap::new();
    for line in stdin.lock().lines() {
        let response = match line {
            Ok(line) => handle_line(&line, &mut connections),
            Err(error) => DriverResponseEnvelope {
                id: 0,
                response: DriverResponse::Error(protocol_error("INPUT_READ_FAILED", error.to_string())),
            },
        };
        let serialized = serde_json::to_string(&response);
        match serialized {
            Ok(line) => {
                let mut stdout = io::stdout().lock();
                if writeln!(stdout, "{line}").is_err() || stdout.flush().is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

fn handle_line(
    line: &str,
    connections: &mut HashMap<String, ClickHouseConnection>,
) -> DriverResponseEnvelope {
    let request: DriverRequestEnvelope = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(error) => return DriverResponseEnvelope {
            id: 0,
            response: DriverResponse::Error(protocol_error("INVALID_REQUEST", error.to_string())),
        },
    };
    let id = request.id;
    let response = match handle_request(request.request, connections) {
        Ok(response) => DriverResponse::Ok(response),
        Err(error) => DriverResponse::Error(error),
    };
    DriverResponseEnvelope { id, response }
}

fn handle_request(
    request: DriverRequest,
    connections: &mut HashMap<String, ClickHouseConnection>,
) -> Result<DriverResult, DriverProtocolError> {
    match request {
        DriverRequest::Handshake(request) => Ok(DriverResult::Handshake(HandshakeResponse {
            protocol_version: request.protocol_version,
            package_id: PACKAGE_ID.to_string(),
            package_version: PACKAGE_VERSION.to_string(),
            driver_id: DRIVER_ID.to_string(),
            capabilities: DriverRuntimeCapabilities {
                metadata: true,
                query: true,
                cancellation: false,
                // HTTP sessions are not a substitute for an interactive transaction API.
                transactions: false,
                database_scoped_queries: true,
                database_creation: false,
                referencing_foreign_keys: false,
                // Read-only calls use a GET request; ClickHouse documents GET HTTP
                // query requests as read-only, independently of host SQL parsing.
                read_only_enforcement: true,
            },
        })),
        DriverRequest::Connect {
            connection_id,
            config,
        } => {
            connections.insert(connection_id, clickhouse_connection(config)?);
            Ok(DriverResult::Empty)
        }
        DriverRequest::Disconnect { connection_id } => {
            connections.remove(&connection_id);
            Ok(DriverResult::Empty)
        }
        DriverRequest::Ping { connection_id } => {
            let connection = connection(connections, &connection_id)?;
            let response = authenticated(connection, connection.client.get(root_url(connection)?))
                .send()
                .map_err(http_error("PING_FAILED"))?;
            if !response.status().is_success() {
                return Err(status_error("PING_FAILED", response));
            }
            Ok(DriverResult::Boolean(true))
        }
        DriverRequest::ServerVersion { connection_id } => {
            let result = query(
                connection(connections, &connection_id)?,
                "SELECT version() AS version",
                &[],
                &DriverQueryContext {
                    read_only: true,
                    ..DriverQueryContext::default()
                },
                None,
            )?;
            Ok(DriverResult::ServerVersion(
                result
                    .rows
                    .first()
                    .and_then(|row| row.first())
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
            ))
        }
        DriverRequest::CreateDatabase { .. } => Err(protocol_error(
            "DATABASE_CREATION_UNSUPPORTED",
            "ClickHouse database creation is not enabled by this read-focused driver package",
        )),
        DriverRequest::Query {
            connection_id,
            statement,
            parameters,
            context,
            query_id,
        } => query(
            connection(connections, &connection_id)?,
            &statement,
            &parameters,
            &context,
            query_id.as_deref(),
        )
        .map(|item| DriverResult::Query(vec![item])),
        DriverRequest::Metadata {
            connection_id,
            request,
        } => {
            metadata(connection(connections, &connection_id)?, request).map(DriverResult::Metadata)
        }
        DriverRequest::Cancel { .. } => Ok(DriverResult::Boolean(false)),
        DriverRequest::BeginTransaction { .. }
        | DriverRequest::CommitTransaction { .. }
        | DriverRequest::RollbackTransaction { .. } => Err(protocol_error(
            "TRANSACTIONS_UNSUPPORTED",
            "ClickHouse HTTP sessions are not interactive transactions",
        )),
        DriverRequest::Shutdown => {
            connections.clear();
            Ok(DriverResult::Empty)
        }
    }
}

fn clickhouse_connection(
    config: SecretConnectionConfig,
) -> Result<ClickHouseConnection, DriverProtocolError> {
    let raw_url = config.url.trim();
    if raw_url.is_empty() {
        return Err(protocol_error(
            "INVALID_URL",
            "ClickHouse HTTP URL is required",
        ));
    }
    let is_clickhouse_alias = raw_url
        .get(.."clickhouse:".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("clickhouse:"));
    let normalized = if is_clickhouse_alias {
        format!("http:{}", &raw_url["clickhouse:".len()..])
    } else {
        raw_url.to_string()
    };
    let mut base_url = Url::parse(&normalized)
        .map_err(|error| protocol_error("INVALID_URL", error.to_string()))?;
    if !matches!(base_url.scheme(), "http" | "https") {
        return Err(protocol_error(
            "INVALID_URL",
            "ClickHouse URL must use http or https",
        ));
    }
    let require_tls = base_url.query_pairs().any(|(key, value)| {
        (key.eq_ignore_ascii_case("sslmode") || key.eq_ignore_ascii_case("ssl"))
            && !matches!(
                value.to_ascii_lowercase().as_str(),
                "" | "disable" | "false" | "0"
            )
    });
    if require_tls && base_url.scheme().eq_ignore_ascii_case("http") {
        base_url
            .set_scheme("https")
            .map_err(|_| protocol_error("INVALID_URL", "ClickHouse TLS URL is invalid"))?;
    }
    let username = config
        .options
        .get("username")
        .cloned()
        .or_else(|| (!base_url.username().is_empty()).then(|| base_url.username().to_string()));
    let password = config
        .options
        .get("password")
        .cloned()
        .or_else(|| base_url.password().map(ToString::to_string));
    if !base_url.username().is_empty() {
        base_url
            .set_username("")
            .map_err(|_| protocol_error("INVALID_URL", "ClickHouse URL username is invalid"))?;
    }
    if base_url.password().is_some() {
        base_url
            .set_password(None)
            .map_err(|_| protocol_error("INVALID_URL", "ClickHouse URL password is invalid"))?;
    }
    let query_database = base_url.query_pairs().find_map(|(key, value)| {
        key.eq_ignore_ascii_case("database")
            .then(|| value.to_string())
    });
    let default_database = if is_clickhouse_alias {
        base_url
            .path()
            .trim_matches('/')
            .split('/')
            .next()
            .filter(|value| !value.is_empty())
            .map(validate_identifier)
            .transpose()?
    } else {
        query_database
            .as_deref()
            .map(validate_identifier)
            .transpose()?
    };
    if is_clickhouse_alias {
        base_url.set_path("/");
    }
    base_url.set_query(None);
    base_url.set_fragment(None);
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| protocol_error("HTTP_CLIENT_FAILED", error.to_string()))?;
    Ok(ClickHouseConnection {
        base_url,
        client,
        username,
        password,
        default_database,
    })
}

fn connection<'a>(
    connections: &'a HashMap<String, ClickHouseConnection>,
    id: &str,
) -> Result<&'a ClickHouseConnection, DriverProtocolError> {
    connections
        .get(id)
        .ok_or_else(|| protocol_error("CONNECTION_NOT_FOUND", "Connection is not open"))
}
fn root_url(connection: &ClickHouseConnection) -> Result<Url, DriverProtocolError> {
    let mut url = connection.base_url.clone();
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    Ok(url)
}
fn authenticated(
    connection: &ClickHouseConnection,
    request: reqwest::blocking::RequestBuilder,
) -> reqwest::blocking::RequestBuilder {
    match connection.username.as_deref() {
        Some(username) => request.basic_auth(username, connection.password.as_deref()),
        None => request,
    }
}

fn query(
    connection: &ClickHouseConnection,
    statement: &str,
    parameters: &[DriverQueryParameter],
    context: &DriverQueryContext,
    query_id: Option<&str>,
) -> Result<DriverQueryResult, DriverProtocolError> {
    if statement.trim().is_empty() {
        return Err(protocol_error("QUERY_EMPTY", "SQL statement is required"));
    }
    let (statement, parameters) = bind_clickhouse_parameters(statement, parameters)?;
    let url = query_url(connection, &statement, context, query_id, &parameters)?;
    let response = if context.read_only {
        authenticated(connection, connection.client.get(url)).send()
    } else {
        authenticated(
            connection,
            connection.client.post(url).body(statement.to_string()),
        )
        .send()
    }
    .map_err(http_error("QUERY_FAILED"))?;
    parse_query_response(response, &statement)
}

fn query_url(
    connection: &ClickHouseConnection,
    statement: &str,
    context: &DriverQueryContext,
    query_id: Option<&str>,
    parameters: &[ClickHouseBoundParameter],
) -> Result<Url, DriverProtocolError> {
    let mut url = root_url(connection)?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("default_format", "JSON");
        pairs.append_pair("wait_end_of_query", "1");
        if let Some(database) = context
            .database
            .as_deref()
            .or(context.schema.as_deref())
            .or(connection.default_database.as_deref())
        {
            pairs.append_pair("database", &validate_identifier(database)?);
        }
        if let Some(query_id) = query_id.filter(|value| !value.trim().is_empty()) {
            pairs.append_pair("query_id", query_id);
        }
        for parameter in parameters {
            pairs.append_pair(&format!("param_{}", parameter.name), &parameter.value);
        }
        if context.read_only {
            // The ClickHouse HTTP API treats GET query requests as read-only.
            // Do not silently fall back to POST for agent-owned reads.
            if statement.len() > 1_000_000 || has_format_clause(statement) {
                return Err(protocol_error("READ_ONLY_QUERY_UNSUPPORTED", "Read-only ClickHouse queries must fit the HTTP query parameter and cannot specify FORMAT"));
            }
            pairs.append_pair("query", statement);
        }
    }
    Ok(url)
}

/// Converts protocol positional markers into ClickHouse's typed HTTP
/// parameters. Values remain URL-encoded query parameters; they are never
/// interpolated into SQL text. `?` is assigned left-to-right and `$1` style
/// markers may be repeated. Markers inside quoted identifiers, strings and
/// comments are deliberately left untouched.
fn bind_clickhouse_parameters(
    statement: &str,
    parameters: &[DriverQueryParameter],
) -> Result<(String, Vec<ClickHouseBoundParameter>), DriverProtocolError> {
    if parameters.is_empty() {
        return Ok((statement.to_string(), Vec::new()));
    }
    let typed = parameters
        .iter()
        .enumerate()
        .map(|(index, parameter)| clickhouse_bound_parameter(index + 1, parameter))
        .collect::<Result<Vec<_>, _>>()?;
    let chars = statement.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(statement.len() + parameters.len() * 16);
    let mut used = vec![false; parameters.len()];
    let mut next_question_mark = 0usize;
    let mut index = 0usize;
    let mut state = ParameterScanState::Code;
    while index < chars.len() {
        let current = chars[index];
        let next = chars.get(index + 1).copied();
        match state {
            ParameterScanState::Code => {
                if current == '\'' {
                    state = ParameterScanState::SingleQuote;
                    output.push(current);
                    index += 1;
                } else if current == '"' {
                    state = ParameterScanState::DoubleQuote;
                    output.push(current);
                    index += 1;
                } else if current == '`' {
                    state = ParameterScanState::Backtick;
                    output.push(current);
                    index += 1;
                } else if current == '-' && next == Some('-') {
                    state = ParameterScanState::LineComment;
                    output.push_str("--");
                    index += 2;
                } else if current == '/' && next == Some('*') {
                    state = ParameterScanState::BlockComment;
                    output.push_str("/*");
                    index += 2;
                } else if current == '?' {
                    if next_question_mark >= typed.len() {
                        return Err(protocol_error("PARAMETER_COUNT_MISMATCH", "SQL contains more positional parameters than the request"));
                    }
                    output.push_str(&clickhouse_parameter_placeholder(&typed[next_question_mark]));
                    used[next_question_mark] = true;
                    next_question_mark += 1;
                    index += 1;
                } else if current == '$' && next.is_some_and(|value| value.is_ascii_digit()) {
                    let start = index + 1;
                    let mut end = start;
                    while chars.get(end).is_some_and(|value| value.is_ascii_digit()) {
                        end += 1;
                    }
                    let ordinal = chars[start..end]
                        .iter()
                        .collect::<String>()
                        .parse::<usize>()
                        .map_err(|_| protocol_error("PARAMETER_COUNT_MISMATCH", "SQL parameter marker is invalid"))?;
                    if ordinal == 0 || ordinal > typed.len() {
                        return Err(protocol_error("PARAMETER_COUNT_MISMATCH", "SQL parameter marker is outside the request parameter range"));
                    }
                    output.push_str(&clickhouse_parameter_placeholder(&typed[ordinal - 1]));
                    used[ordinal - 1] = true;
                    index = end;
                } else {
                    output.push(current);
                    index += 1;
                }
            }
            ParameterScanState::SingleQuote => {
                output.push(current);
                index += 1;
                if current == '\'' {
                    if chars.get(index) == Some(&'\'') {
                        output.push('\'');
                        index += 1;
                    } else {
                        state = ParameterScanState::Code;
                    }
                }
            }
            ParameterScanState::DoubleQuote => {
                output.push(current);
                index += 1;
                if current == '"' {
                    if chars.get(index) == Some(&'"') {
                        output.push('"');
                        index += 1;
                    } else {
                        state = ParameterScanState::Code;
                    }
                }
            }
            ParameterScanState::Backtick => {
                output.push(current);
                index += 1;
                if current == '`' {
                    if chars.get(index) == Some(&'`') {
                        output.push('`');
                        index += 1;
                    } else {
                        state = ParameterScanState::Code;
                    }
                }
            }
            ParameterScanState::LineComment => {
                output.push(current);
                index += 1;
                if current == '\n' {
                    state = ParameterScanState::Code;
                }
            }
            ParameterScanState::BlockComment => {
                output.push(current);
                index += 1;
                if current == '*' && chars.get(index) == Some(&'/') {
                    output.push('/');
                    index += 1;
                    state = ParameterScanState::Code;
                }
            }
        }
    }
    if used.iter().any(|value| !value) {
        return Err(protocol_error("PARAMETER_COUNT_MISMATCH", "Every request parameter must have a SQL marker"));
    }
    Ok((output, typed))
}

#[derive(Clone, Copy)]
enum ParameterScanState {
    Code,
    SingleQuote,
    DoubleQuote,
    Backtick,
    LineComment,
    BlockComment,
}

fn clickhouse_bound_parameter(
    ordinal: usize,
    parameter: &DriverQueryParameter,
) -> Result<ClickHouseBoundParameter, DriverProtocolError> {
    let (data_type, value) = match &parameter.value {
        Value::Null => {
            return Err(protocol_error(
                "PARAMETER_UNSUPPORTED",
                "ClickHouse HTTP parameter binding does not support NULL without an explicit nullable type contract",
            ));
        }
        Value::Bool(value) => ("UInt8", if *value { "1".to_string() } else { "0".to_string() }),
        Value::Number(value) if value.is_i64() => ("Int64", value.to_string()),
        Value::Number(value) if value.is_u64() => ("UInt64", value.to_string()),
        Value::Number(value) if value.is_f64() => ("Float64", value.to_string()),
        Value::String(value) => ("String", value.clone()),
        Value::Array(_) | Value::Object(_) => (
            "String",
            serde_json::to_string(&parameter.value)
                .map_err(|error| protocol_error("PARAMETER_UNSUPPORTED", error.to_string()))?,
        ),
        Value::Number(_) => {
            return Err(protocol_error(
                "PARAMETER_UNSUPPORTED",
                "ClickHouse cannot represent the supplied numeric parameter",
            ));
        }
    };
    Ok(ClickHouseBoundParameter {
        name: format!("oxide_p{ordinal}"),
        data_type,
        value,
    })
}

fn clickhouse_parameter_placeholder(parameter: &ClickHouseBoundParameter) -> String {
    format!("{{{}:{}}}", parameter.name, parameter.data_type)
}

fn parse_query_response(
    response: reqwest::blocking::Response,
    statement: &str,
) -> Result<DriverQueryResult, DriverProtocolError> {
    if !response.status().is_success() {
        return Err(status_error("QUERY_FAILED", response));
    }
    let body = response.text().map_err(http_error("QUERY_FAILED"))?;
    parse_clickhouse_json(&body, statement)
}

fn parse_clickhouse_json(
    body: &str,
    statement: &str,
) -> Result<DriverQueryResult, DriverProtocolError> {
    let value: Value = serde_json::from_str(body)
        .map_err(|_| protocol_error("QUERY_FAILED", clickhouse_error_message(body)))?;
    let columns = value
        .get("meta")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|column| DriverColumn {
            name: column
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            data_type: column
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("UNKNOWN")
                .to_string(),
        })
        .collect();
    let names = value
        .get("meta")
        .and_then(Value::as_array)
        .map(|columns| {
            columns
                .iter()
                .filter_map(|column| column.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let rows = value
        .get("data")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_object)
                .map(|row| {
                    names
                        .iter()
                        .map(|name| row.get(*name).cloned().unwrap_or(Value::Null))
                        .collect()
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(DriverQueryResult {
        columns,
        rows,
        truncated: false,
        row_limit: None,
        rows_affected: None,
        statement_type: Some(statement_type(statement)),
        message: value
            .get("statistics")
            .and_then(Value::as_object)
            .and_then(|stats| stats.get("elapsed"))
            .map(|elapsed| format!("elapsed={elapsed}")),
    })
}

fn metadata(
    connection: &ClickHouseConnection,
    request: MetadataRequest,
) -> Result<Value, DriverProtocolError> {
    match request {
        MetadataRequest::Databases => rows_json(connection, "SELECT name FROM system.databases WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') ORDER BY name", None).map(|rows| json!(rows.iter().map(|row| row_string(row, 0)).collect::<Vec<_>>())),
        MetadataRequest::Schemas { database } => Ok(json!([database.or_else(|| connection.default_database.clone()).unwrap_or_else(|| "default".to_string())])),
        MetadataRequest::Relations { database, namespace } => {
            let database = required_database(database.as_deref().unwrap_or(&namespace))?;
            let rows = metadata_rows(connection, "SELECT name, engine FROM system.tables WHERE database = {database:String} ORDER BY name", &database)?;
            Ok(Value::Array(rows.iter().map(|row| json!({
                "name": row_string(row, 0),
                "schema": database,
                "type": clickhouse_relation_type(&row_string(row, 1)),
                // `system.tables` has no engine-independent comment in every
                // supported ClickHouse version, so the engine is not mislabelled.
                "comment": Value::Null,
            })).collect()))
        }
        MetadataRequest::Columns { database, namespace, relation } => {
            let database = required_database(database.as_deref().unwrap_or(&namespace))?;
            let relation = validate_identifier(&relation)?;
            let rows = metadata_rows(connection, "SELECT name, type, default_kind, default_expression, comment FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position", &format!("{database}\u{1f}{relation}"))?;
            Ok(Value::Array(rows.iter().map(|row| json!({ "name": row_string(row, 0), "data_type": row_string(row, 1), "is_nullable": row_string(row, 1).starts_with("Nullable("), "is_primary_key": false, "is_unique": false, "is_indexed": false, "is_auto_increment": false, "default_value": nullable_string(row, 3), "comment": nullable_string(row, 4) })).collect()))
        }
        MetadataRequest::Indexes { database, namespace, relation } => {
            let database = required_database(database.as_deref().unwrap_or(&namespace))?;
            let relation = validate_identifier(&relation)?;
            let rows = metadata_rows(connection, "SELECT name, expr, type FROM system.data_skipping_indices WHERE database = {database:String} AND table = {table:String} ORDER BY name", &format!("{database}\u{1f}{relation}"))?;
            Ok(Value::Array(rows.iter().map(|row| json!({ "name": row_string(row, 0), "columns": [], "is_unique": false, "is_primary": false, "index_type": row_string(row, 2), "definition": nullable_string(row, 1) })).collect()))
        }
        MetadataRequest::Constraints { .. } | MetadataRequest::ReferencingForeignKeys { .. } | MetadataRequest::Collections { .. } | MetadataRequest::Routines { .. } => Ok(Value::Array(Vec::new())),
    }
}

fn rows_json(
    connection: &ClickHouseConnection,
    statement: &str,
    database: Option<&str>,
) -> Result<Vec<Vec<Value>>, DriverProtocolError> {
    metadata_rows(connection, statement, database.unwrap_or_default())
}
fn metadata_rows(
    connection: &ClickHouseConnection,
    statement: &str,
    encoded_parameters: &str,
) -> Result<Vec<Vec<Value>>, DriverProtocolError> {
    // Metadata statements use documented ClickHouse named HTTP parameters.
    let mut url = root_url(connection)?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("default_format", "JSON");
        pairs.append_pair("wait_end_of_query", "1");
        pairs.append_pair("query", statement);
        if !encoded_parameters.is_empty() {
            let mut parts = encoded_parameters.split('\u{1f}');
            pairs.append_pair("param_database", parts.next().unwrap_or_default());
            if let Some(table) = parts.next() {
                pairs.append_pair("param_table", table);
            }
        }
    }
    let response = authenticated(connection, connection.client.get(url))
        .send()
        .map_err(http_error("METADATA_FAILED"))?;
    Ok(parse_query_response(response, statement)?.rows)
}

fn required_database(value: &str) -> Result<String, DriverProtocolError> {
    validate_identifier(value)
}
fn validate_identifier(value: &str) -> Result<String, DriverProtocolError> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_IDENTIFIER_LENGTH || value.contains('\0') {
        return Err(protocol_error(
            "INVALID_IDENTIFIER",
            "Invalid ClickHouse identifier",
        ));
    }
    Ok(value.to_string())
}
fn row_string(row: &[Value], index: usize) -> String {
    match row.get(index) {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Null) | None => String::new(),
        Some(value) => value.to_string(),
    }
}
fn nullable_string(row: &[Value], index: usize) -> Value {
    row.get(index)
        .filter(|value| !value.is_null() && value.as_str().is_some_and(|text| !text.is_empty()))
        .cloned()
        .unwrap_or(Value::Null)
}
fn statement_type(sql: &str) -> String {
    sql.trim_start()
        .split_whitespace()
        .next()
        .unwrap_or("UNKNOWN")
        .to_ascii_uppercase()
}
fn clickhouse_relation_type(engine: &str) -> &'static str {
    if engine.to_ascii_lowercase().contains("view") {
        "view"
    } else {
        "table"
    }
}
fn has_format_clause(statement: &str) -> bool {
    statement
        .split_whitespace()
        .any(|token| token.eq_ignore_ascii_case("format"))
}
fn clickhouse_error_message(body: &str) -> String {
    let body = body.trim();
    if body.is_empty() {
        "ClickHouse returned an empty non-JSON response".to_string()
    } else {
        body.chars().take(1024).collect()
    }
}
fn status_error(code: &str, response: reqwest::blocking::Response) -> DriverProtocolError {
    let status = response.status();
    let detail = response
        .text()
        .unwrap_or_default()
        .chars()
        .take(512)
        .collect::<String>();
    protocol_error(
        code,
        format!(
            "ClickHouse HTTP {status}{}",
            (!detail.trim().is_empty())
                .then(|| format!(": {detail}"))
                .unwrap_or_default()
        ),
    )
}
fn http_error(code: &str) -> impl FnOnce(reqwest::Error) -> DriverProtocolError + '_ {
    move |error| protocol_error(code, error.to_string())
}
fn protocol_error(code: impl Into<String>, message: impl Into<String>) -> DriverProtocolError {
    DriverProtocolError {
        code: code.into(),
        message: message.into(),
        retryable: false,
        details: BTreeMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_clickhouse_form_and_extracts_database() {
        let connection = clickhouse_connection(SecretConnectionConfig {
            url: "clickhouse://user:secret@localhost:8123/analytics?sslmode=disable".to_string(),
            options: BTreeMap::new(),
        })
        .unwrap();
        assert_eq!(connection.base_url.as_str(), "http://localhost:8123/");
        assert_eq!(connection.default_database.as_deref(), Some("analytics"));
        assert_eq!(connection.username.as_deref(), Some("user"));
    }
    #[test]
    fn read_only_format_requests_are_rejected_before_transport() {
        let connection = clickhouse_connection(SecretConnectionConfig {
            url: "clickhouse://localhost/default".to_string(),
            options: BTreeMap::new(),
        })
        .unwrap();
        let error = query(
            &connection,
            "SELECT 1 FORMAT JSONEachRow",
            &[],
            &DriverQueryContext {
                read_only: true,
                ..DriverQueryContext::default()
            },
            None,
        )
        .unwrap_err();
        assert_eq!(error.code, "READ_ONLY_QUERY_UNSUPPORTED");
    }
    #[test]
    fn read_only_transport_uses_get_query_parameters_and_the_selected_database() {
        let connection = clickhouse_connection(SecretConnectionConfig {
            url: "clickhouse://localhost/analytics".to_string(),
            options: BTreeMap::new(),
        })
        .unwrap();
        let url = query_url(
            &connection,
            "SELECT count() FROM events",
            &DriverQueryContext {
                read_only: true,
                ..DriverQueryContext::default()
            },
            Some("turn-7"),
            &[],
        )
        .unwrap();
        let parameters = url.query_pairs().collect::<BTreeMap<_, _>>();
        assert_eq!(
            parameters.get("query").map(|value| value.as_ref()),
            Some("SELECT count() FROM events")
        );
        assert_eq!(
            parameters.get("database").map(|value| value.as_ref()),
            Some("analytics")
        );
        assert_eq!(
            parameters.get("default_format").map(|value| value.as_ref()),
            Some("JSON")
        );
        assert_eq!(
            parameters.get("query_id").map(|value| value.as_ref()),
            Some("turn-7")
        );
    }
    #[test]
    fn positional_parameters_become_typed_http_parameters_without_touching_literals() {
        let (sql, parameters) = bind_clickhouse_parameters(
            "SELECT ? AS first, $2 AS second, '$1 ?' AS literal -- ?\n",
            &[
                DriverQueryParameter {
                    value: json!(7),
                    data_type: None,
                },
                DriverQueryParameter {
                    value: json!("oxide"),
                    data_type: None,
                },
            ],
        )
        .unwrap();
        assert_eq!(
            sql,
            "SELECT {oxide_p1:Int64} AS first, {oxide_p2:String} AS second, '$1 ?' AS literal -- ?\n"
        );
        assert_eq!(
            parameters,
            vec![
                ClickHouseBoundParameter {
                    name: "oxide_p1".to_string(),
                    data_type: "Int64",
                    value: "7".to_string(),
                },
                ClickHouseBoundParameter {
                    name: "oxide_p2".to_string(),
                    data_type: "String",
                    value: "oxide".to_string(),
                },
            ]
        );
    }
    #[test]
    fn parameter_binding_refuses_unmapped_or_null_values() {
        assert_eq!(
            bind_clickhouse_parameters(
                "SELECT ?",
                &[
                    DriverQueryParameter {
                        value: json!(1),
                        data_type: None,
                    },
                    DriverQueryParameter {
                        value: json!(2),
                        data_type: None,
                    },
                ],
            )
            .unwrap_err()
            .code,
            "PARAMETER_COUNT_MISMATCH"
        );
        assert_eq!(
            bind_clickhouse_parameters(
                "SELECT ?",
                &[DriverQueryParameter {
                    value: Value::Null,
                    data_type: None,
                }],
            )
            .unwrap_err()
            .code,
            "PARAMETER_UNSUPPORTED"
        );
    }
    #[test]
    fn parses_json_result_in_metadata_order() {
        let result = parse_clickhouse_json(r#"{ "meta": [{ "name": "name", "type": "String" }, { "name": "count", "type": "UInt64" }], "data": [{ "count": 2, "name": "events" }], "statistics": { "elapsed": 0.01 } }"#, "SELECT name, count FROM tables").unwrap();
        assert_eq!(result.columns[0].name, "name");
        assert_eq!(result.rows, vec![vec![json!("events"), json!(2)]]);
        assert_eq!(result.message.as_deref(), Some("elapsed=0.01"));
    }
    #[test]
    fn identifier_validation_refuses_control_and_empty_values() {
        assert!(validate_identifier("analytics").is_ok());
        assert!(validate_identifier(" ").is_err());
        assert!(validate_identifier("bad\0name").is_err());
    }
    #[test]
    fn relation_engines_keep_views_distinct_from_tables() {
        assert_eq!(clickhouse_relation_type("MergeTree"), "table");
        assert_eq!(clickhouse_relation_type("View"), "view");
        assert_eq!(clickhouse_relation_type("MaterializedView"), "view");
    }
}
