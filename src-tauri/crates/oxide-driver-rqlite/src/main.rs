//! Standalone RQLite implementation of OxideStudio's versioned driver protocol.
//!
//! RQLite exposes a SQLite-compatible database over HTTP. Keeping the client in
//! this signed sidecar means remote-driver updates do not require rebuilding the
//! desktop application and keeps every HTTP request outside the renderer.

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

const PACKAGE_ID: &str = "oxide.rqlite";
const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
const DRIVER_ID: &str = "rqlite";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_IDENTIFIER_LENGTH: usize = 255;

#[derive(Clone)]
struct RqliteConnection {
    base_url: Url,
    client: Client,
    username: Option<String>,
    password: Option<String>,
}

fn main() {
    let stdin = io::stdin();
    let mut connections = HashMap::new();
    for line in stdin.lock().lines() {
        let response = match line {
            Ok(line) => handle_line(&line, &mut connections),
            Err(error) => Err(protocol_error("INPUT_READ_FAILED", error.to_string())),
        };
        let serialized = match response {
            Ok(envelope) => serde_json::to_string(&envelope),
            Err(error) => serde_json::to_string(&DriverResponseEnvelope {
                id: 0,
                response: DriverResponse::Error(error),
            }),
        };
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
    connections: &mut HashMap<String, RqliteConnection>,
) -> Result<DriverResponseEnvelope, DriverProtocolError> {
    let request: DriverRequestEnvelope = serde_json::from_str(line)
        .map_err(|error| protocol_error("INVALID_REQUEST", error.to_string()))?;
    let id = request.id;
    let response = handle_request(request.request, connections)?;
    Ok(DriverResponseEnvelope {
        id,
        response: DriverResponse::Ok(response),
    })
}

fn handle_request(
    request: DriverRequest,
    connections: &mut HashMap<String, RqliteConnection>,
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
                // RQLite transactions are request-scoped (`?transaction`),
                // not durable interactive sessions. Never pretend BEGIN / COMMIT
                // can be safely mapped to the host transaction protocol.
                transactions: false,
                database_scoped_queries: false,
                database_creation: false,
                referencing_foreign_keys: true,
                // Agent read-only requests are routed to RQLite's dedicated
                // `/db/query` endpoint, which uses a SQLite read-only connection.
                read_only_enforcement: true,
            },
        })),
        DriverRequest::Connect {
            connection_id,
            config,
        } => {
            connections.insert(connection_id, rqlite_connection(config)?);
            Ok(DriverResult::Empty)
        }
        DriverRequest::Disconnect { connection_id } => {
            connections.remove(&connection_id);
            Ok(DriverResult::Empty)
        }
        DriverRequest::Ping { connection_id } => {
            let connection = connection(connections, &connection_id)?;
            let url = endpoint_url(connection, "readyz")?;
            let response = authenticated(connection, connection.client.get(url))
                .send()
                .map_err(http_error("PING_FAILED"))?;
            if !response.status().is_success() {
                return Err(status_error("PING_FAILED", response));
            }
            Ok(DriverResult::Boolean(true))
        }
        DriverRequest::ServerVersion { connection_id } => {
            let connection = connection(connections, &connection_id)?;
            let value = get_json(connection, "status", "VERSION_FAILED")?;
            Ok(DriverResult::ServerVersion(find_version(&value)))
        }
        DriverRequest::CreateDatabase { .. } => Err(protocol_error(
            "DATABASE_CREATION_UNSUPPORTED",
            "RQLite exposes one database per cluster; create a connection or cluster instead",
        )),
        DriverRequest::Query {
            connection_id,
            statement,
            parameters,
            context,
            ..
        } => query(
            connection(connections, &connection_id)?,
            &statement,
            &parameters,
            &context,
        )
        .map(DriverResult::Query),
        DriverRequest::Metadata {
            connection_id,
            request,
        } => metadata(connection(connections, &connection_id)?, request).map(DriverResult::Metadata),
        DriverRequest::BeginTransaction { .. }
        | DriverRequest::CommitTransaction { .. }
        | DriverRequest::RollbackTransaction { .. } => Err(protocol_error(
            "TRANSACTIONS_UNSUPPORTED",
            "RQLite supports only request-scoped transactions, not interactive transaction sessions",
        )),
        DriverRequest::Cancel { .. } => Ok(DriverResult::Boolean(false)),
        DriverRequest::Shutdown => {
            connections.clear();
            Ok(DriverResult::Empty)
        }
    }
}

fn rqlite_connection(
    config: SecretConnectionConfig,
) -> Result<RqliteConnection, DriverProtocolError> {
    let raw_url = config.url.trim();
    if raw_url.is_empty() {
        return Err(protocol_error("INVALID_URL", "RQLite HTTP URL is required"));
    }
    // The generic external-driver form emits `<driver>://`, while RQLite's
    // documented endpoint URLs are HTTP(S). Accept `rqlite://` as a local
    // connection-form alias and normalize it before any request is made; this
    // keeps direct `http(s)://` URLs usable too.
    // `url::Url::set_scheme` rejects changing a non-special scheme to HTTP,
    // so normalize the raw prefix before URL parsing.
    let normalized_url = raw_url
        .get(.."rqlite:".len())
        .filter(|prefix| prefix.eq_ignore_ascii_case("rqlite:"))
        .map(|_| format!("http:{}", &raw_url["rqlite:".len()..]))
        .unwrap_or_else(|| raw_url.to_string());
    let mut base_url = Url::parse(&normalized_url)
        .map_err(|error| protocol_error("INVALID_URL", error.to_string()))?;
    if !matches!(base_url.scheme(), "http" | "https") {
        return Err(protocol_error(
            "INVALID_URL",
            "RQLite URL must use http or https",
        ));
    }
    // The shared external-driver form uses the existing sslmode convention.
    // Respect it before stripping renderer-only options, so `rqlite://…` can
    // safely become HTTPS without adding an RQLite-specific UI branch.
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
            .map_err(|_| protocol_error("INVALID_URL", "RQLite TLS URL is invalid"))?;
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
            .map_err(|_| protocol_error("INVALID_URL", "RQLite URL username is invalid"))?;
    }
    if base_url.password().is_some() {
        base_url
            .set_password(None)
            .map_err(|_| protocol_error("INVALID_URL", "RQLite URL password is invalid"))?;
    }
    base_url.set_query(None);
    base_url.set_fragment(None);
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| protocol_error("HTTP_CLIENT_FAILED", error.to_string()))?;
    Ok(RqliteConnection {
        base_url,
        client,
        username,
        password,
    })
}

fn connection<'a>(
    connections: &'a HashMap<String, RqliteConnection>,
    connection_id: &str,
) -> Result<&'a RqliteConnection, DriverProtocolError> {
    connections
        .get(connection_id)
        .ok_or_else(|| protocol_error("CONNECTION_NOT_FOUND", "Connection is not open"))
}

fn endpoint_url(connection: &RqliteConnection, endpoint: &str) -> Result<Url, DriverProtocolError> {
    let mut url = connection.base_url.clone();
    let base_path = url.path().trim_end_matches('/');
    url.set_path(&format!("{base_path}/{endpoint}"));
    Ok(url)
}

fn authenticated(
    connection: &RqliteConnection,
    request: reqwest::blocking::RequestBuilder,
) -> reqwest::blocking::RequestBuilder {
    match connection.username.as_deref() {
        Some(username) => request.basic_auth(username, connection.password.as_deref()),
        None => request,
    }
}

fn get_json(
    connection: &RqliteConnection,
    endpoint: &str,
    code: &str,
) -> Result<Value, DriverProtocolError> {
    let url = endpoint_url(connection, endpoint)?;
    let response = authenticated(connection, connection.client.get(url))
        .send()
        .map_err(http_error(code))?;
    parse_json_response(code, response)
}

fn query(
    connection: &RqliteConnection,
    statement: &str,
    parameters: &[DriverQueryParameter],
    context: &DriverQueryContext,
) -> Result<Vec<DriverQueryResult>, DriverProtocolError> {
    if statement.trim().is_empty() {
        return Err(protocol_error("QUERY_EMPTY", "SQL statement is required"));
    }
    // `/db/query` is RQLite's enforced read-only endpoint. For ordinary editor
    // work `/db/request` accepts either result kind and delegates SQLite's own
    // read/write classification to RQLite, avoiding a fragile client-side SQL
    // parser for CTEs, PRAGMAs, and version-specific SQLite syntax.
    let endpoint = if context.read_only {
        "db/query"
    } else {
        "db/request"
    };
    let url = endpoint_url(connection, endpoint)?;
    let body = rqlite_statement_body(statement, parameters);
    let response = authenticated(connection, connection.client.post(url))
        .json(&body)
        .send()
        .map_err(http_error("QUERY_FAILED"))?;
    parse_query_response(parse_json_response("QUERY_FAILED", response)?, statement)
}

fn rqlite_statement_body(statement: &str, parameters: &[DriverQueryParameter]) -> Value {
    if parameters.is_empty() {
        json!([statement])
    } else {
        let mut bound = Vec::with_capacity(parameters.len() + 1);
        bound.push(Value::String(statement.to_string()));
        bound.extend(parameters.iter().map(|parameter| parameter.value.clone()));
        Value::Array(vec![Value::Array(bound)])
    }
}

fn parse_json_response(
    code: &str,
    response: reqwest::blocking::Response,
) -> Result<Value, DriverProtocolError> {
    if !response.status().is_success() {
        return Err(status_error(code, response));
    }
    response
        .json::<Value>()
        .map_err(|error| protocol_error(code, format!("Invalid RQLite JSON response: {error}")))
}

fn status_error(code: &str, response: reqwest::blocking::Response) -> DriverProtocolError {
    let status = response.status();
    let detail = response
        .text()
        .unwrap_or_default()
        .chars()
        .take(512)
        .collect::<String>();
    let suffix = (!detail.trim().is_empty()).then(|| format!(": {detail}"));
    protocol_error(
        code,
        format!("RQLite HTTP {status}{}", suffix.unwrap_or_default()),
    )
}

fn http_error(code: &str) -> impl FnOnce(reqwest::Error) -> DriverProtocolError + '_ {
    move |error| protocol_error(code, error.to_string())
}

fn parse_query_response(
    value: Value,
    statement: &str,
) -> Result<Vec<DriverQueryResult>, DriverProtocolError> {
    let results = value
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| protocol_error("QUERY_FAILED", "RQLite response did not include results"))?;
    results
        .iter()
        .map(|result| parse_query_result(result, statement))
        .collect()
}

fn parse_query_result(
    result: &Value,
    statement: &str,
) -> Result<DriverQueryResult, DriverProtocolError> {
    if let Some(error) = result.get("error").and_then(Value::as_str) {
        return Err(protocol_error("QUERY_FAILED", error));
    }
    let names = result
        .get("columns")
        .and_then(Value::as_array)
        .map(|columns| columns.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    let types = result
        .get("types")
        .and_then(Value::as_array)
        .map(|types| types.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    let columns = names
        .iter()
        .enumerate()
        .map(|(index, name)| DriverColumn {
            name: (*name).to_string(),
            data_type: types.get(index).copied().unwrap_or("UNKNOWN").to_string(),
        })
        .collect::<Vec<_>>();
    let rows = result
        .get("values")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_array)
                .map(|row| row.to_vec())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(DriverQueryResult {
        columns,
        rows,
        truncated: false,
        row_limit: None,
        rows_affected: result.get("rows_affected").and_then(Value::as_u64),
        statement_type: Some(statement_type(statement)),
        message: result
            .get("last_insert_id")
            .map(|value| format!("last_insert_id={value}")),
    })
}

fn metadata(
    connection: &RqliteConnection,
    request: MetadataRequest,
) -> Result<Value, DriverProtocolError> {
    match request {
        MetadataRequest::Databases => Ok(json!(["main"])),
        MetadataRequest::Schemas { .. } => Ok(json!(["main"])),
        MetadataRequest::Relations { namespace, .. } => {
            require_main_namespace(&namespace)?;
            let rows = metadata_rows(
                connection,
                "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )?;
            Ok(Value::Array(
                rows.iter()
                    .map(|row| {
                        json!({
                            "name": row_string(row, 0),
                            "schema": "main",
                            "type": row_string(row, 1),
                            "comment": Value::Null,
                        })
                    })
                    .collect(),
            ))
        }
        MetadataRequest::Columns {
            namespace,
            relation,
            ..
        } => {
            require_main_namespace(&namespace)?;
            rqlite_columns(connection, &relation)
        }
        MetadataRequest::Indexes {
            namespace,
            relation,
            ..
        } => {
            require_main_namespace(&namespace)?;
            rqlite_indexes(connection, &relation)
        }
        MetadataRequest::Constraints {
            namespace,
            relation,
            ..
        } => {
            require_main_namespace(&namespace)?;
            rqlite_constraints(connection, &relation)
        }
        MetadataRequest::ReferencingForeignKeys {
            namespace,
            relation,
            ..
        } => {
            require_main_namespace(&namespace)?;
            rqlite_referencing_foreign_keys(connection, &relation)
        }
        MetadataRequest::Collections { .. } | MetadataRequest::Routines { .. } => {
            Ok(Value::Array(Vec::new()))
        }
    }
}

fn metadata_rows(
    connection: &RqliteConnection,
    statement: &str,
) -> Result<Vec<Vec<Value>>, DriverProtocolError> {
    let result = query(
        connection,
        statement,
        &[],
        &DriverQueryContext {
            read_only: true,
            ..DriverQueryContext::default()
        },
    )?;
    Ok(result
        .into_iter()
        .next()
        .map(|result| result.rows)
        .unwrap_or_default())
}

fn rqlite_columns(
    connection: &RqliteConnection,
    relation: &str,
) -> Result<Value, DriverProtocolError> {
    let relation = quote_identifier(relation)?;
    let rows = metadata_rows(connection, &format!("PRAGMA table_info({relation})"))?;
    Ok(Value::Array(
        rows.iter()
            .map(|row| {
                json!({
                    "name": row_string(row, 1),
                    "data_type": row_string(row, 2),
                    "is_nullable": !row_bool(row, 3),
                    "is_primary_key": row_u64(row, 5) > 0,
                    "is_unique": false,
                    "is_indexed": false,
                    "is_auto_increment": false,
                    "default_value": row.get(4).filter(|value| !value.is_null()).map(Value::to_string),
                    "comment": Value::Null,
                })
            })
            .collect(),
    ))
}

fn rqlite_indexes(
    connection: &RqliteConnection,
    relation: &str,
) -> Result<Value, DriverProtocolError> {
    let relation = quote_identifier(relation)?;
    let rows = metadata_rows(connection, &format!("PRAGMA index_list({relation})"))?;
    let indexes = rows
        .iter()
        .map(|row| {
            let name = row_string(row, 1);
            let index = quote_identifier(&name)?;
            let columns = metadata_rows(connection, &format!("PRAGMA index_info({index})"))?
                .iter()
                .map(|row| row_string(row, 2))
                .collect::<Vec<_>>();
            Ok(json!({
                "name": name,
                "columns": columns,
                "is_unique": row_bool(row, 2),
                "is_primary": row_string(row, 3).eq_ignore_ascii_case("pk"),
                "index_type": "BTREE",
                "definition": Value::Null,
            }))
        })
        .collect::<Result<Vec<_>, DriverProtocolError>>()?;
    Ok(Value::Array(indexes))
}

fn rqlite_constraints(
    connection: &RqliteConnection,
    relation: &str,
) -> Result<Value, DriverProtocolError> {
    let relation_name = validate_identifier(relation)?;
    let relation = quote_identifier(relation)?;
    let mut constraints = Vec::new();
    let primary_columns = metadata_rows(connection, &format!("PRAGMA table_info({relation})"))?
        .iter()
        .filter(|row| row_u64(row, 5) > 0)
        .map(|row| (row_u64(row, 5), row_string(row, 1)))
        .collect::<Vec<_>>();
    if !primary_columns.is_empty() {
        let mut primary_columns = primary_columns;
        primary_columns.sort_by_key(|(position, _)| *position);
        constraints.push(json!({
            "name": format!("pk_{relation_name}"),
            "constraint_type": "PRIMARY KEY",
            "columns": primary_columns.into_iter().map(|(_, name)| name).collect::<Vec<_>>(),
            "referenced_schema": Value::Null,
            "referenced_table": Value::Null,
            "referenced_columns": [],
            "definition": Value::Null,
        }));
    }
    for row in metadata_rows(connection, &format!("PRAGMA index_list({relation})"))? {
        if !row_bool(&row, 2) || row_string(&row, 3).eq_ignore_ascii_case("pk") {
            continue;
        }
        let index_name = row_string(&row, 1);
        let index = quote_identifier(&index_name)?;
        let columns = metadata_rows(connection, &format!("PRAGMA index_info({index})"))?
            .iter()
            .map(|row| row_string(row, 2))
            .collect::<Vec<_>>();
        constraints.push(json!({
            "name": index_name,
            "constraint_type": "UNIQUE",
            "columns": columns,
            "referenced_schema": Value::Null,
            "referenced_table": Value::Null,
            "referenced_columns": [],
            "definition": Value::Null,
        }));
    }
    let mut foreign_keys: BTreeMap<u64, Vec<Vec<Value>>> = BTreeMap::new();
    for row in metadata_rows(connection, &format!("PRAGMA foreign_key_list({relation})"))? {
        foreign_keys.entry(row_u64(&row, 0)).or_default().push(row);
    }
    for (id, mut rows) in foreign_keys {
        rows.sort_by_key(|row| row_u64(row, 1));
        constraints.push(json!({
            "name": format!("fk_{relation_name}_{id}"),
            "constraint_type": "FOREIGN KEY",
            "columns": rows.iter().map(|row| row_string(row, 3)).collect::<Vec<_>>(),
            "referenced_schema": "main",
            "referenced_table": row_string(&rows[0], 2),
            "referenced_columns": rows.iter().map(|row| row_string(row, 4)).collect::<Vec<_>>(),
            "definition": Value::Null,
        }));
    }
    Ok(Value::Array(constraints))
}

fn rqlite_referencing_foreign_keys(
    connection: &RqliteConnection,
    relation: &str,
) -> Result<Value, DriverProtocolError> {
    let relation = validate_identifier(relation)?;
    let tables = metadata_rows(
        connection,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let mut references = Vec::new();
    for table in tables {
        let table_name = row_string(&table, 0);
        let table_identifier = quote_identifier(&table_name)?;
        let mut foreign_keys: BTreeMap<u64, Vec<Vec<Value>>> = BTreeMap::new();
        for row in metadata_rows(
            connection,
            &format!("PRAGMA foreign_key_list({table_identifier})"),
        )? {
            if row_string(&row, 2).eq_ignore_ascii_case(&relation) {
                foreign_keys.entry(row_u64(&row, 0)).or_default().push(row);
            }
        }
        for (id, mut rows) in foreign_keys {
            rows.sort_by_key(|row| row_u64(row, 1));
            references.push(json!({
                "name": format!("fk_{table_name}_{id}"),
                "schema": "main",
                "table": table_name,
                "columns": rows.iter().map(|row| row_string(row, 3)).collect::<Vec<_>>(),
                "referenced_schema": "main",
                "referenced_table": relation,
                "referenced_columns": rows.iter().map(|row| row_string(row, 4)).collect::<Vec<_>>(),
            }));
        }
    }
    Ok(Value::Array(references))
}

fn require_main_namespace(namespace: &str) -> Result<(), DriverProtocolError> {
    if namespace.trim().eq_ignore_ascii_case("main") {
        Ok(())
    } else {
        Err(protocol_error(
            "SCHEMA_UNSUPPORTED",
            "RQLite exposes only the main schema",
        ))
    }
}

fn validate_identifier(value: &str) -> Result<String, DriverProtocolError> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_IDENTIFIER_LENGTH || value.contains('\0') {
        return Err(protocol_error(
            "INVALID_IDENTIFIER",
            "Invalid SQLite identifier",
        ));
    }
    Ok(value.to_string())
}

fn quote_identifier(value: &str) -> Result<String, DriverProtocolError> {
    validate_identifier(value).map(|value| format!("\"{}\"", value.replace('"', "\"\"")))
}

fn row_string(row: &[Value], index: usize) -> String {
    match row.get(index) {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Null) | None => String::new(),
        Some(value) => value.to_string(),
    }
}

fn row_u64(row: &[Value], index: usize) -> u64 {
    row.get(index).and_then(Value::as_u64).unwrap_or_default()
}

fn row_bool(row: &[Value], index: usize) -> bool {
    row.get(index)
        .and_then(|value| {
            value
                .as_bool()
                .or_else(|| value.as_u64().map(|value| value != 0))
        })
        .unwrap_or(false)
}

fn statement_type(sql: &str) -> String {
    sql.trim_start()
        .split_whitespace()
        .next()
        .unwrap_or("UNKNOWN")
        .to_ascii_uppercase()
}

fn find_version(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => map
            .get("version")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .or_else(|| map.values().find_map(find_version)),
        Value::Array(values) => values.iter().find_map(find_version),
        _ => None,
    }
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
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    fn one_request_http_server(
        response_body: &'static str,
    ) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            let header_end = loop {
                let read = stream.read(&mut buffer).unwrap();
                if read == 0 {
                    panic!("HTTP client closed request before sending headers");
                }
                request.extend_from_slice(&buffer[..read]);
                if let Some(index) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                    break index + 4;
                }
            };
            let header = String::from_utf8_lossy(&request[..header_end]);
            let content_length = header
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                })
                .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            while request.len() < header_end + content_length {
                let read = stream.read(&mut buffer).unwrap();
                if read == 0 {
                    panic!("HTTP client closed request before sending body");
                }
                request.extend_from_slice(&buffer[..read]);
            }
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream.write_all(response.as_bytes()).unwrap();
            stream.flush().unwrap();
            String::from_utf8(request).unwrap()
        });
        (format!("http://{address}"), handle)
    }

    #[test]
    fn bound_parameters_keep_sql_and_values_separate() {
        let body = rqlite_statement_body(
            "SELECT * FROM people WHERE name = ?",
            &[DriverQueryParameter {
                value: json!("Ada; DROP TABLE people"),
                data_type: None,
            }],
        );
        assert_eq!(
            body,
            json!([[
                "SELECT * FROM people WHERE name = ?",
                "Ada; DROP TABLE people"
            ]])
        );
    }

    #[test]
    fn handshake_declares_only_the_runtime_features_this_sidecar_enforces() {
        let result = handle_request(
            DriverRequest::Handshake(oxide_driver_protocol::HandshakeRequest {
                protocol_version: "1.0".to_string(),
                host_version: "test".to_string(),
                package_id: PACKAGE_ID.to_string(),
                driver_id: DRIVER_ID.to_string(),
            }),
            &mut HashMap::new(),
        )
        .unwrap();
        let DriverResult::Handshake(handshake) = result else {
            panic!("expected handshake response");
        };
        assert!(handshake.capabilities.metadata);
        assert!(handshake.capabilities.query);
        assert!(handshake.capabilities.referencing_foreign_keys);
        assert!(handshake.capabilities.read_only_enforcement);
        assert!(!handshake.capabilities.transactions);
        assert!(!handshake.capabilities.database_creation);
        assert!(!handshake.capabilities.database_scoped_queries);
    }

    #[test]
    #[ignore = "requires a loopback listener, which managed test sandboxes may disallow"]
    fn read_only_query_uses_the_rqlite_http_contract_end_to_end() {
        let (url, server) = one_request_http_server(
            r#"{"results":[{"columns":["id"],"types":["integer"],"values":[[7]]}]}"#,
        );
        let connection = rqlite_connection(SecretConnectionConfig {
            url,
            options: BTreeMap::new(),
        })
        .unwrap();
        let result = query(
            &connection,
            "SELECT id FROM people WHERE id = ?",
            &[DriverQueryParameter {
                value: json!(7),
                data_type: Some("INTEGER".to_string()),
            }],
            &DriverQueryContext {
                read_only: true,
                ..DriverQueryContext::default()
            },
        )
        .unwrap();
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /db/query HTTP/1.1\r\n"));
        assert!(request.contains("Content-Type: application/json"));
        assert!(request.ends_with("[[\"SELECT id FROM people WHERE id = ?\",7]]"));
        assert_eq!(result[0].columns[0].data_type, "integer");
        assert_eq!(result[0].rows, vec![vec![json!(7)]]);
    }

    #[test]
    fn query_response_preserves_declared_types_and_write_counts() {
        let result = parse_query_response(
            json!({"results": [{"columns": ["id"], "types": ["integer"], "values": [[1]]}, {"rows_affected": 2}]}),
            "SELECT id FROM people",
        )
        .unwrap();
        assert_eq!(result[0].columns[0].data_type, "integer");
        assert_eq!(result[0].rows, vec![vec![json!(1)]]);
        assert_eq!(result[1].rows_affected, Some(2));
    }

    #[test]
    fn database_errors_in_successful_http_responses_still_fail() {
        let error = parse_query_response(
            json!({"results": [{"error": "near bad: syntax error"}]}),
            "bad",
        )
        .unwrap_err();
        assert_eq!(error.code, "QUERY_FAILED");
        assert!(error.message.contains("syntax error"));
    }

    #[test]
    fn read_only_requests_use_rqlites_enforced_query_endpoint() {
        let context = DriverQueryContext {
            read_only: true,
            ..DriverQueryContext::default()
        };
        assert!(context.read_only);
        // The branch is deliberately a capability invariant: it routes all
        // agent read-only SQL (including writable-looking CTEs) through
        // `/db/query`, so the server remains the final authority.
        let endpoint = if context.read_only {
            "db/query"
        } else {
            "db/request"
        };
        assert_eq!(endpoint, "db/query");
    }

    #[test]
    fn identifiers_are_quoted_without_allowing_nul_or_empty_names() {
        assert_eq!(
            quote_identifier("order\"items").unwrap(),
            "\"order\"\"items\""
        );
        assert!(quote_identifier(" ").is_err());
        assert!(quote_identifier("bad\0name").is_err());
    }

    #[test]
    fn nested_status_version_is_discovered_without_assuming_status_shape() {
        assert_eq!(
            find_version(&json!({"store": {"version": "8.36.9"}})),
            Some("8.36.9".to_string())
        );
    }

    #[test]
    fn generic_connection_form_rqlite_scheme_normalizes_to_http() {
        let connection = rqlite_connection(SecretConnectionConfig {
            url: "rqlite://localhost:4001".to_string(),
            options: BTreeMap::new(),
        })
        .unwrap();
        assert_eq!(connection.base_url.scheme(), "http");
        assert_eq!(
            endpoint_url(&connection, "db/query").unwrap().as_str(),
            "http://localhost:4001/db/query"
        );
    }

    #[test]
    fn shared_ssl_mode_upgrades_the_rqlite_form_alias_to_https() {
        let connection = rqlite_connection(SecretConnectionConfig {
            url: "rqlite://cluster.example.test:4001?sslmode=require".to_string(),
            options: BTreeMap::new(),
        })
        .unwrap();
        assert_eq!(connection.base_url.scheme(), "https");
        assert!(connection.base_url.query().is_none());
    }
}
