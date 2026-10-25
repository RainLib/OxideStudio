//! Standalone DuckDB implementation of OxideStudio's versioned driver protocol.
//!
//! This crate intentionally stays outside the Tauri workspace dependency graph:
//! it is packaged, signed and updated as an external driver sidecar.

use duckdb::{
    params_from_iter,
    types::{Value as DuckdbValue, ValueRef},
    AccessMode, Config, Connection,
};
use oxide_driver_protocol::{
    DriverColumn, DriverProtocolError, DriverQueryResult, DriverRequest, DriverRequestEnvelope,
    DriverResponse, DriverResponseEnvelope, DriverResult, DriverRuntimeCapabilities,
    HandshakeResponse, MetadataRequest,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{self, BufRead, Write},
};

mod file_query;
mod file_query_sql;
mod managed_io;
mod query_types;

struct SessionConnection {
    connection: Connection,
    // Dropped after the connection, including on Disconnect, Shutdown and EOF.
    file_workspace: Option<tempfile::TempDir>,
}

impl std::ops::Deref for SessionConnection {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        &self.connection
    }
}

const PACKAGE_ID: &str = "oxide.duckdb";
const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
const DRIVER_ID: &str = "duckdb";

fn main() {
    if let Some(workspace) = std::env::var_os("OXIDE_FILE_QUERY_WORKSPACE") {
        if let Err(error) = managed_io::run(std::path::Path::new(&workspace)) {
            eprintln!("Managed file-query runtime stopped: {error}");
            std::process::exit(1);
        }
        return;
    }
    let stdin = io::stdin();
    run_requests(stdin.lock().lines());
}

fn run_requests(lines: impl Iterator<Item = io::Result<String>>) {
    let mut connections = HashMap::new();
    for line in lines {
        let response = match line {
            Ok(line) => handle_line(&line, &mut connections),
            Err(error) => DriverResponseEnvelope {
                id: 0,
                response: DriverResponse::Error(protocol_error(
                    "INPUT_READ_FAILED",
                    error.to_string(),
                )),
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
    connections: &mut HashMap<String, SessionConnection>,
) -> DriverResponseEnvelope {
    let request: DriverRequestEnvelope = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(error) => {
            return DriverResponseEnvelope {
                id: 0,
                response: DriverResponse::Error(protocol_error(
                    "INVALID_REQUEST",
                    error.to_string(),
                )),
            }
        }
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
    connections: &mut HashMap<String, SessionConnection>,
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
                transactions: true,
                // DuckDB catalogs can be attached to one physical connection.
                // The host uses this capability for the selected catalog in a
                // table/query tab; `query_in_database_context` restores the
                // previous catalog afterwards so the session does not leak it.
                database_scoped_queries: true,
                // A DuckDB file/attached catalog is selected by opening or
                // attaching a path; it is not a server namespace that this
                // command can create safely from the current connection.
                database_creation: false,
                referencing_foreign_keys: true,
                // Agent connections set `context.read_only`; this sidecar
                // validates it before handing the statement to DuckDB.
                read_only_enforcement: true,
                read_only_connections: true,
                file_queries: true,
                host_managed_file_queries: true,
                semantic_schema_migration: false,
                ..DriverRuntimeCapabilities::default()
            },
        })),
        DriverRequest::Connect {
            connection_id,
            config,
        } => {
            if let Some(format) = config.options.get("fileQueryFormat") {
                if config.options.get("readOnly").map(String::as_str) != Some("true") {
                    return Err(protocol_error(
                        "CONNECT_FAILED",
                        "File queries require readOnly=true",
                    ));
                }
                let session = file_query::open_with_header(
                    &config.url,
                    format,
                    config
                        .options
                        .get("fileQueryCsvHeader")
                        .map(String::as_str)
                        .unwrap_or("present"),
                )?;
                connections.insert(connection_id, session);
                return Ok(DriverResult::Empty);
            }
            let path = duckdb_path(&config.url)?;
            let connection = if config
                .options
                .get("readOnly")
                .is_some_and(|value| value == "true")
            {
                let flags = Config::default()
                    .access_mode(AccessMode::ReadOnly)
                    .and_then(|flags| flags.enable_external_access(false))
                    .and_then(|flags| flags.enable_autoload_extension(false))
                    .map_err(|error| protocol_error("CONNECT_FAILED", error.to_string()))?;
                Connection::open_with_flags(path, flags)
            } else {
                if config
                    .options
                    .get("readOnly")
                    .is_some_and(|value| value != "false")
                {
                    return Err(protocol_error(
                        "CONNECT_FAILED",
                        "Invalid readOnly connection option",
                    ));
                }
                Connection::open(path)
            }
            .map_err(|error| protocol_error("CONNECT_FAILED", error.to_string()))?;
            connections.insert(
                connection_id,
                SessionConnection {
                    connection,
                    file_workspace: None,
                },
            );
            Ok(DriverResult::Empty)
        }
        DriverRequest::Disconnect { connection_id } => {
            connections.remove(&connection_id);
            Ok(DriverResult::Empty)
        }
        DriverRequest::Ping { connection_id } => {
            connection(connections, &connection_id)?
                .execute_batch("SELECT 1")
                .map_err(|error| protocol_error("PING_FAILED", error.to_string()))?;
            Ok(DriverResult::Boolean(true))
        }
        DriverRequest::ServerVersion { connection_id } => {
            let version: String = connection(connections, &connection_id)?
                .query_row("SELECT version()", [], |row| row.get(0))
                .map_err(|error| protocol_error("VERSION_FAILED", error.to_string()))?;
            Ok(DriverResult::ServerVersion(Some(version)))
        }
        DriverRequest::CreateDatabase { .. } => Err(protocol_error(
            "DATABASE_CREATION_UNSUPPORTED",
            "DuckDB does not create catalogs through the connected session",
        )),
        DriverRequest::PlanSchemaMigration { .. }
        | DriverRequest::PreflightSchemaMigration { .. }
        | DriverRequest::ApplySchemaMigration { .. }
        | DriverRequest::VerifySchemaMigration { .. } => Err(protocol_error(
            "SCHEMA_MIGRATION_UNSUPPORTED",
            "DuckDB semantic schema migration is not enabled by this package",
        )),
        DriverRequest::Query {
            connection_id,
            statement,
            parameters,
            context,
            ..
        } => {
            let file_query = connections
                .get(&connection_id)
                .is_some_and(|session| session.file_workspace.is_some());
            if file_query {
                return file_query::query(
                    connection(connections, &connection_id)?,
                    &statement,
                    &parameters,
                )
                .map(DriverResult::Query);
            }
            if context.read_only && !is_read_only_statement(&statement) {
                return Err(protocol_error(
                    "READ_ONLY_REJECTED",
                    "Read-only query required",
                ));
            }
            query_in_database_context(
                connection(connections, &connection_id)?,
                context.database.as_deref(),
                context.schema.as_deref(),
                &statement,
                &parameters,
            )
            .map(DriverResult::Query)
        }
        DriverRequest::Metadata {
            connection_id,
            request,
        } => {
            metadata(connection(connections, &connection_id)?, request).map(DriverResult::Metadata)
        }
        DriverRequest::BeginTransaction { connection_id, .. } => {
            execute(connection(connections, &connection_id)?, "BEGIN")
        }
        DriverRequest::CommitTransaction { connection_id, .. } => {
            execute(connection(connections, &connection_id)?, "COMMIT")
        }
        DriverRequest::RollbackTransaction { connection_id, .. } => {
            execute(connection(connections, &connection_id)?, "ROLLBACK")
        }
        DriverRequest::Cancel { .. } => Ok(DriverResult::Boolean(false)),
        DriverRequest::QueryPage { .. }
        | DriverRequest::FetchQueryPage { .. }
        | DriverRequest::CloseQuerySession { .. } => Err(protocol_error(
            "QUERY_PAGING_UNSUPPORTED",
            "DuckDB native query cursors are unavailable",
        )),
        DriverRequest::Shutdown => {
            connections.clear();
            Ok(DriverResult::Empty)
        }
    }
}

fn connection<'a>(
    connections: &'a mut HashMap<String, SessionConnection>,
    connection_id: &str,
) -> Result<&'a mut Connection, DriverProtocolError> {
    connections
        .get_mut(connection_id)
        .map(|session| &mut session.connection)
        .ok_or_else(|| protocol_error("CONNECTION_NOT_FOUND", "Connection is not open"))
}

/// Execute in an explicitly selected attached catalog without changing the
/// caller's ordinary console context. Requests are served serially by this
/// sidecar, so switching and restoring around the statement is isolated from
/// other requests sharing the same connection.
fn query_in_database_context(
    connection: &mut Connection,
    database: Option<&str>,
    schema: Option<&str>,
    statement: &str,
    parameters: &[oxide_driver_protocol::DriverQueryParameter],
) -> Result<Vec<DriverQueryResult>, DriverProtocolError> {
    let database = database.map(str::trim).filter(|value| !value.is_empty());
    let schema = schema.map(str::trim).filter(|value| !value.is_empty());
    if database.is_none() && schema.is_none() {
        return query(connection, statement, parameters);
    }

    let previous: (String, String) = connection
        .query_row("SELECT current_database(), current_schema()", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|error| protocol_error("DATABASE_SCOPE_FAILED", error.to_string()))?;
    let database = database.unwrap_or(&previous.0);
    let schema = schema.unwrap_or_else(|| {
        if database.eq_ignore_ascii_case(&previous.0) {
            &previous.1
        } else {
            "main"
        }
    });
    if previous.0.eq_ignore_ascii_case(database) && previous.1.eq_ignore_ascii_case(schema) {
        return query(connection, statement, parameters);
    }

    use_namespace(connection, database, schema)?;
    let result = query(connection, statement, parameters);
    let restore = use_namespace(connection, &previous.0, &previous.1);
    match (result, restore) {
        (Ok(result), Ok(())) => Ok(result),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(error),
        (Err(error), Err(_)) => Err(error),
    }
}

fn use_namespace(
    connection: &Connection,
    database: &str,
    schema: &str,
) -> Result<(), DriverProtocolError> {
    let identifier = format!(
        "{}.{}",
        quote_identifier(database),
        quote_identifier(schema)
    );
    connection
        .execute_batch(&format!("USE {identifier}"))
        .map_err(|error| protocol_error("DATABASE_SCOPE_FAILED", error.to_string()))
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('\"', "\"\""))
}

fn duckdb_path(url: &str) -> Result<String, DriverProtocolError> {
    let value = url.trim();
    if value == ":memory:" || value.eq_ignore_ascii_case("duckdb::memory:") {
        return Ok(":memory:".to_string());
    }
    let path = value
        .strip_prefix("duckdb://")
        .or_else(|| value.strip_prefix("duckdb:"))
        .unwrap_or(value)
        .trim();
    if path.is_empty() {
        return Err(protocol_error(
            "INVALID_URL",
            "DuckDB file path is required",
        ));
    }
    Ok(path.to_string())
}

fn execute(connection: &Connection, sql: &str) -> Result<DriverResult, DriverProtocolError> {
    connection
        .execute_batch(sql)
        .map_err(|error| protocol_error("QUERY_FAILED", error.to_string()))?;
    Ok(DriverResult::Empty)
}

fn query(
    connection: &Connection,
    sql: &str,
    parameters: &[oxide_driver_protocol::DriverQueryParameter],
) -> Result<Vec<DriverQueryResult>, DriverProtocolError> {
    query_bounded(connection, sql, parameters, None)
}

fn query_bounded(
    connection: &Connection,
    sql: &str,
    parameters: &[oxide_driver_protocol::DriverQueryParameter],
    limits: Option<(usize, usize)>,
) -> Result<Vec<DriverQueryResult>, DriverProtocolError> {
    let parameters = duckdb_parameters(parameters)?;
    let statement_type = statement_type(sql);
    if !is_row_returning_statement(&statement_type) {
        let affected = connection
            .execute(sql, params_from_iter(parameters.iter()))
            .map_err(|error| protocol_error("QUERY_FAILED", error.to_string()))?;
        return Ok(vec![DriverQueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            truncated: false,
            row_limit: None,
            rows_affected: Some(affected as u64),
            statement_type: Some(statement_type),
            message: None,
        }]);
    }
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| protocol_error("QUERY_PREPARE_FAILED", error.to_string()))?;
    // DuckDB only exposes result-set metadata after the statement has begun
    // execution. Keep the Rows handle alive and borrow its statement metadata,
    // rather than asking the prepared statement before `query` has run.
    let mut rows = statement
        .query(params_from_iter(parameters.iter()))
        .map_err(|error| protocol_error("QUERY_FAILED", error.to_string()))?;
    let columns = rows
        .as_ref()
        .ok_or_else(|| protocol_error("QUERY_FAILED", "Query statement was released unexpectedly"))?
        .column_names()
        .into_iter()
        .enumerate()
        .map(|(index, name)| DriverColumn {
            name: name.to_string(),
            data_type: query_types::column_type(&rows.as_ref().unwrap().column_type(index)),
        })
        .collect::<Vec<_>>();
    if limits.is_some() && columns.len() > 256 {
        return Err(protocol_error(
            "FILE_QUERY_RESULT_LIMIT",
            "File-query results are limited to 256 columns",
        ));
    }
    let mut values = Vec::new();
    let mut encoded_bytes = serde_json::to_vec(&columns)
        .map_err(|error| protocol_error("QUERY_ENCODE_FAILED", error.to_string()))?
        .len();
    if limits.is_some_and(|(_, max_bytes)| encoded_bytes > max_bytes) {
        return Err(protocol_error(
            "FILE_QUERY_RESULT_LIMIT",
            "File-query columns exceed the result byte budget",
        ));
    }
    let mut truncated = false;
    while let Some(row) = rows
        .next()
        .map_err(|error| protocol_error("QUERY_FAILED", error.to_string()))?
    {
        if limits.is_some_and(|(rows, _)| values.len() >= rows) {
            truncated = true;
            break;
        }
        let mut item = Vec::with_capacity(columns.len());
        for (index, column) in columns.iter().enumerate() {
            let value = row
                .get_ref(index)
                .map_err(|error| protocol_error("QUERY_DECODE_FAILED", error.to_string()))?;
            if let Some((_, max_bytes)) = limits {
                let oversized = match value {
                    ValueRef::Text(bytes) => bytes.len() > max_bytes,
                    ValueRef::Blob(bytes) | ValueRef::Geometry(bytes) => {
                        bytes.len() > max_bytes / 2
                    }
                    _ => false,
                };
                if oversized {
                    return Err(protocol_error(
                        "FILE_QUERY_RESULT_LIMIT",
                        "File-query cell exceeds the result byte budget",
                    ));
                }
            }
            let mut value = value_to_json(value);
            if column.data_type == "TIMESTAMP WITH TIME ZONE" {
                if let Value::String(text) = &mut value {
                    if text.contains(' ') {
                        text.push_str("+00:00");
                    }
                }
            }
            item.push(value);
        }
        if let Some((_, max_bytes)) = limits {
            encoded_bytes = encoded_bytes.saturating_add(
                serde_json::to_vec(&item)
                    .map_err(|error| protocol_error("QUERY_ENCODE_FAILED", error.to_string()))?
                    .len(),
            );
            if encoded_bytes > max_bytes {
                return Err(protocol_error(
                    "FILE_QUERY_RESULT_LIMIT",
                    "File-query result exceeds its byte budget",
                ));
            }
        }
        values.push(item);
    }
    Ok(vec![DriverQueryResult {
        columns,
        rows: values,
        truncated,
        row_limit: limits.map(|(rows, _)| rows as u64),
        rows_affected: None,
        statement_type: Some(statement_type),
        message: None,
    }])
}

/// Converts the protocol's JSON values into owned DuckDB values. The driver
/// always binds them through DuckDB's parameter API; it never substitutes a
/// value into SQL text, including for JSON arrays/objects or quote-containing
/// strings.
fn duckdb_parameters(
    parameters: &[oxide_driver_protocol::DriverQueryParameter],
) -> Result<Vec<DuckdbValue>, DriverProtocolError> {
    parameters
        .iter()
        .map(|parameter| json_to_duckdb_value(&parameter.value))
        .collect()
}

fn json_to_duckdb_value(value: &Value) -> Result<DuckdbValue, DriverProtocolError> {
    match value {
        Value::Null => Ok(DuckdbValue::Null),
        Value::Bool(value) => Ok(DuckdbValue::Boolean(*value)),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                Ok(DuckdbValue::BigInt(value))
            } else if let Some(value) = value.as_u64() {
                Ok(DuckdbValue::UBigInt(value))
            } else if let Some(value) = value.as_f64() {
                Ok(DuckdbValue::Double(value))
            } else {
                Err(protocol_error(
                    "PARAMETER_UNSUPPORTED",
                    "DuckDB cannot represent the supplied numeric parameter",
                ))
            }
        }
        Value::String(value) => Ok(DuckdbValue::Text(value.clone())),
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value)
            .map(DuckdbValue::Text)
            .map_err(|error| protocol_error("PARAMETER_UNSUPPORTED", error.to_string())),
    }
}

fn metadata(
    connection: &Connection,
    request: MetadataRequest,
) -> Result<Value, DriverProtocolError> {
    match request {
        MetadataRequest::SqlLookupContext { .. } => Ok(Value::Null),
        MetadataRequest::Databases => query_string_column(
            connection,
            "SELECT database_name FROM duckdb_databases() ORDER BY database_name",
        ),
        MetadataRequest::Schemas { database } => duckdb_schemas(connection, database.as_deref()),
        MetadataRequest::Relations {
            database,
            namespace,
        } => duckdb_relations(connection, database.as_deref(), &namespace),
        MetadataRequest::Columns {
            database,
            namespace,
            relation,
            ..
        } => duckdb_columns(connection, database.as_deref(), &namespace, &relation),
        MetadataRequest::Indexes {
            database,
            namespace,
            relation,
            ..
        } => duckdb_indexes(connection, database.as_deref(), &namespace, &relation),
        MetadataRequest::Constraints {
            database,
            namespace,
            relation,
            ..
        } => duckdb_constraints(connection, database.as_deref(), &namespace, &relation),
        MetadataRequest::ReferencingForeignKeys {
            database,
            namespace,
            relation,
        } => {
            duckdb_referencing_foreign_keys(connection, database.as_deref(), &namespace, &relation)
        }
        MetadataRequest::Routines { .. }
        | MetadataRequest::SchemaObjects { .. }
        | MetadataRequest::SchemaObjectMembers { .. } => Ok(Value::Array(Vec::new())),
        MetadataRequest::ObjectSource { .. } => Err(protocol_error(
            "UNSUPPORTED",
            "DuckDB object source is unavailable",
        )),
        MetadataRequest::Collections { .. } => Ok(Value::Array(Vec::new())),
    }
}

fn duckdb_schemas(
    connection: &Connection,
    database: Option<&str>,
) -> Result<Value, DriverProtocolError> {
    let catalog = database
        .map(quote_string)
        .unwrap_or_else(|| "current_database()".to_string());
    query_string_column(
        connection,
        &format!(
            "SELECT schema_name FROM information_schema.schemata \
             WHERE catalog_name = {catalog} \
             AND schema_name NOT IN ('information_schema', 'pg_catalog') \
             ORDER BY schema_name"
        ),
    )
}

fn duckdb_relations(
    connection: &Connection,
    database: Option<&str>,
    namespace: &str,
) -> Result<Value, DriverProtocolError> {
    let sql = format!(
        "SELECT table_name, table_type FROM information_schema.tables \
         WHERE table_catalog = {} AND table_schema = {} ORDER BY table_name",
        duckdb_catalog(database),
        quote_string(namespace),
    );
    let mut statement = connection.prepare(&sql).map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({
                "name": row.get::<_, String>(0)?,
                "schema": namespace,
                "type": row.get::<_, String>(1)?,
                "comment": Value::Null,
            }))
        })
        .map_err(sql_error)?;
    let values = rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)?;
    Ok(Value::Array(values))
}

fn duckdb_columns(
    connection: &Connection,
    database: Option<&str>,
    namespace: &str,
    relation: &str,
) -> Result<Value, DriverProtocolError> {
    let sql = format!(
        "SELECT column_name, data_type, is_nullable, column_default \
         FROM information_schema.columns WHERE table_catalog = {} \
         AND table_schema = {} AND table_name = {} ORDER BY ordinal_position",
        duckdb_catalog(database),
        quote_string(namespace),
        quote_string(relation),
    );
    let mut statement = connection.prepare(&sql).map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({
                "name": row.get::<_, String>(0)?,
                "data_type": row.get::<_, String>(1)?,
                "is_nullable": row.get::<_, String>(2)? == "YES",
                "is_primary_key": false,
                "is_unique": false,
                "is_indexed": false,
                "is_auto_increment": false,
                "default_value": row.get::<_, Option<String>>(3)?,
                "comment": Value::Null,
            }))
        })
        .map_err(sql_error)?;
    let values = rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)?;
    Ok(Value::Array(values))
}

fn duckdb_catalog(database: Option<&str>) -> String {
    database
        .map(quote_string)
        .unwrap_or_else(|| "current_database()".to_string())
}

fn duckdb_indexes(
    connection: &Connection,
    database: Option<&str>,
    namespace: &str,
    relation: &str,
) -> Result<Value, DriverProtocolError> {
    let sql = format!(
        "SELECT index_name, is_unique, is_primary, to_json(expressions), sql \
         FROM duckdb_indexes() WHERE database_name = {} AND schema_name = {} \
         AND table_name = {} ORDER BY index_name",
        duckdb_catalog(database),
        quote_string(namespace),
        quote_string(relation),
    );
    let mut statement = connection.prepare(&sql).map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            let expression_json = row.get::<_, Option<String>>(3)?.unwrap_or_default();
            Ok(json!({
                "name": row.get::<_, String>(0)?,
                "columns": json_string_array(&expression_json),
                "is_unique": row.get::<_, bool>(1)?,
                "is_primary": row.get::<_, bool>(2)?,
                "index_type": "ART",
                "definition": row.get::<_, Option<String>>(4)?,
            }))
        })
        .map_err(sql_error)?;
    let values = rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)?;
    Ok(Value::Array(values))
}

fn duckdb_constraints(
    connection: &Connection,
    database: Option<&str>,
    namespace: &str,
    relation: &str,
) -> Result<Value, DriverProtocolError> {
    let sql = format!(
        "SELECT constraint_name, constraint_type, to_json(constraint_column_names), \
         referenced_table, to_json(referenced_column_names), constraint_text \
         FROM duckdb_constraints() WHERE database_name = {} AND schema_name = {} \
         AND table_name = {} \
         ORDER BY constraint_index",
        duckdb_catalog(database),
        quote_string(namespace),
        quote_string(relation),
    );
    let mut statement = connection.prepare(&sql).map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            let columns = row.get::<_, Option<String>>(2)?.unwrap_or_default();
            let referenced_columns = row.get::<_, Option<String>>(4)?.unwrap_or_default();
            let constraint_type = row.get::<_, String>(1)?;
            Ok(json!({
                "name": row.get::<_, Option<String>>(0)?.unwrap_or_else(|| constraint_type.clone()),
                "constraint_type": constraint_type,
                "columns": json_string_array(&columns),
                "referenced_schema": Value::Null,
                "referenced_table": row.get::<_, Option<String>>(3)?,
                "referenced_columns": json_string_array(&referenced_columns),
                "definition": row.get::<_, Option<String>>(5)?,
            }))
        })
        .map_err(sql_error)?;
    let values = rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)?;
    Ok(Value::Array(values))
}

fn duckdb_referencing_foreign_keys(
    connection: &Connection,
    database: Option<&str>,
    namespace: &str,
    relation: &str,
) -> Result<Value, DriverProtocolError> {
    // DuckDB's catalog exposes a referenced relation name but no distinct
    // referenced-schema field. Preserve the selected namespace instead of
    // guessing a cross-schema identity.
    let sql = format!(
        "SELECT constraint_name, schema_name, table_name, \
         to_json(constraint_column_names), to_json(referenced_column_names) \
         FROM duckdb_constraints() WHERE database_name = {} AND schema_name = {} \
         AND constraint_type = 'FOREIGN KEY' AND referenced_table = {} \
         ORDER BY table_name, constraint_index",
        duckdb_catalog(database),
        quote_string(namespace),
        quote_string(relation),
    );
    let mut statement = connection.prepare(&sql).map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            let columns = row.get::<_, Option<String>>(3)?.unwrap_or_default();
            let referenced_columns = row.get::<_, Option<String>>(4)?.unwrap_or_default();
            Ok(json!({
                "name": row.get::<_, Option<String>>(0)?.unwrap_or_else(|| "foreign_key".to_string()),
                "schema": row.get::<_, String>(1)?,
                "table": row.get::<_, String>(2)?,
                "columns": json_string_array(&columns),
                "referenced_schema": namespace,
                "referenced_table": relation,
                "referenced_columns": json_string_array(&referenced_columns),
            }))
        })
        .map_err(sql_error)?;
    let values = rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)?;
    Ok(Value::Array(values))
}

fn json_string_array(value: &str) -> Vec<String> {
    serde_json::from_str(value).unwrap_or_default()
}

fn query_string_column(connection: &Connection, sql: &str) -> Result<Value, DriverProtocolError> {
    let mut statement = connection.prepare(sql).map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(sql_error)?;
    let values = rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)?;
    Ok(json!(values))
}

fn value_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Boolean(value) => json!(value),
        ValueRef::TinyInt(value) => json!(value),
        ValueRef::SmallInt(value) => json!(value),
        ValueRef::Int(value) => json!(value),
        ValueRef::BigInt(value)
            if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&value) =>
        {
            Value::String(value.to_string())
        }
        ValueRef::BigInt(value) => json!(value),
        ValueRef::UTinyInt(value) => json!(value),
        ValueRef::USmallInt(value) => json!(value),
        ValueRef::UInt(value) => json!(value),
        ValueRef::UBigInt(value) if value > 9_007_199_254_740_991 => {
            Value::String(value.to_string())
        }
        ValueRef::UBigInt(value) => json!(value),
        ValueRef::Float(value) if !value.is_finite() => Value::String(value.to_string()),
        ValueRef::Float(value) => json!(value),
        ValueRef::Double(value) if !value.is_finite() => Value::String(value.to_string()),
        ValueRef::Double(value) => json!(value),
        ValueRef::HugeInt(value) => Value::String(value.to_string()),
        ValueRef::UHugeInt(value) => Value::String(value.to_string()),
        ValueRef::Decimal(value) => Value::String(format!("{value:?}")),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => Value::String(format!(
            "0x{}",
            value
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        )),
        ValueRef::Geometry(value) => Value::String(format!(
            "0x{}",
            value
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        )),
        ValueRef::Timestamp(unit, value) => Value::String(query_types::timestamp(unit, value)),
        ValueRef::Date32(value) => Value::String(query_types::date(value)),
        ValueRef::Time64(unit, value) => Value::String(query_types::time(unit, value)),
        ValueRef::Interval {
            months,
            days,
            nanos,
        } => json!({
            "months": months,
            "days": days,
            "nanos": nanos,
        }),
        other => Value::String(format!("{other:?}")),
    }
}

fn statement_type(sql: &str) -> String {
    read_only_sql_tokens(sql)
        .first()
        .map_or_else(|| "UNKNOWN".into(), |token| token.to_ascii_uppercase())
}

fn is_row_returning_statement(statement_type: &str) -> bool {
    matches!(
        statement_type,
        "SELECT" | "WITH" | "EXPLAIN" | "DESCRIBE" | "SHOW" | "PRAGMA"
    )
}

fn is_read_only_statement(sql: &str) -> bool {
    let tokens = read_only_sql_tokens(sql);
    let Some(first) = tokens.first().map(String::as_str) else {
        return false;
    };
    if !matches!(first, "select" | "with" | "explain" | "describe" | "show") {
        return false;
    }
    let semicolons = tokens.iter().filter(|token| token.as_str() == ";").count();
    if semicolons > 1 || (semicolons == 1 && tokens.last().is_some_and(|token| token != ";")) {
        return false;
    }
    !tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "insert"
                | "update"
                | "delete"
                | "merge"
                | "replace"
                | "create"
                | "alter"
                | "drop"
                | "truncate"
                | "attach"
                | "detach"
                | "copy"
                | "call"
                | "export"
                | "import"
                | "install"
                | "load"
                | "set"
                | "use"
                | "begin"
                | "commit"
                | "rollback"
                | "vacuum"
        )
    })
}

/// A deliberately conservative token pass for the sidecar's execution-side
/// read-only gate. Host validation remains richer, but this parser must stand
/// on its own: it ignores strings/comments, rejects every mutating keyword,
/// and permits at most one terminal semicolon.
fn read_only_sql_tokens(sql: &str) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut index = 0;
    let mut tokens = Vec::new();
    while index < bytes.len() {
        match bytes[index] {
            b'\'' => {
                index += 1;
                while index < bytes.len() {
                    if bytes[index] == b'\'' {
                        index += 1;
                        if index < bytes.len() && bytes[index] == b'\'' {
                            index += 1;
                            continue;
                        }
                        break;
                    }
                    index += 1;
                }
            }
            b'"' | b'`' => {
                let quote = bytes[index];
                index += 1;
                while index < bytes.len() {
                    if bytes[index] == quote {
                        index += 1;
                        if index < bytes.len() && bytes[index] == quote {
                            index += 1;
                            continue;
                        }
                        break;
                    }
                    index += 1;
                }
            }
            b'-' if bytes.get(index + 1) == Some(&b'-') => {
                index += 2;
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index += 2;
                while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/')
                {
                    index += 1;
                }
                index = (index + 2).min(bytes.len());
            }
            b';' => {
                tokens.push(";".to_string());
                index += 1;
            }
            value if value.is_ascii_alphabetic() || value == b'_' => {
                let start = index;
                index += 1;
                while index < bytes.len()
                    && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
                {
                    index += 1;
                }
                tokens.push(sql[start..index].to_ascii_lowercase());
            }
            _ => index += 1,
        }
    }
    tokens
}

fn quote_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn sql_error(error: duckdb::Error) -> DriverProtocolError {
    protocol_error("METADATA_FAILED", error.to_string())
}

fn protocol_error(code: impl Into<String>, message: impl Into<String>) -> DriverProtocolError {
    DriverProtocolError {
        code: code.into(),
        message: message.into(),
        retryable: false,
        details: Default::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoped_query_honors_schema_and_restores_it_after_errors() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE SCHEMA analytics; CREATE TABLE analytics.items(id INTEGER); INSERT INTO analytics.items VALUES(42)").unwrap();
        assert_eq!(
            query_in_database_context(
                &mut connection,
                None,
                Some("analytics"),
                "SELECT id FROM items",
                &[]
            )
            .unwrap()[0]
                .rows,
            vec![vec![json!(42)]]
        );
        assert!(query_in_database_context(
            &mut connection,
            None,
            Some("analytics"),
            "SELECT id FROM missing",
            &[]
        )
        .is_err());
        assert_eq!(
            query(&connection, "SELECT current_schema()", &[]).unwrap()[0].rows,
            vec![vec![json!("main")]]
        );
    }

    #[test]
    fn read_only_connections_preserve_the_file_and_reject_engine_writes_and_missing_sources() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.duckdb");
        {
            let writer = Connection::open(&source).unwrap();
            writer
                .execute_batch("CREATE TABLE sample(id INTEGER); INSERT INTO sample VALUES(42)")
                .unwrap();
        }
        let before = std::fs::read(&source).unwrap();
        let mut connections = HashMap::new();
        let read_only = |path: &std::path::Path| DriverRequest::Connect {
            connection_id: "read-only".to_string(),
            config: oxide_driver_protocol::SecretConnectionConfig {
                url: path.to_string_lossy().into_owned(),
                options: [("readOnly".into(), "true".into())].into_iter().collect(),
            },
        };
        handle_request(read_only(&source), &mut connections).unwrap();
        let reader = connections.get("read-only").unwrap();
        assert!(
            reader
                .execute_batch("INSERT INTO sample VALUES(99)")
                .is_err(),
            "the engine must reject writes even without the SQL guard"
        );
        assert_eq!(
            query(reader, "SELECT id FROM sample", &[]).unwrap()[0].rows,
            vec![vec![json!(42)]]
        );
        drop(connections);
        assert_eq!(std::fs::read(&source).unwrap(), before);
        let missing = directory.path().join("missing.duckdb");
        assert!(handle_request(read_only(&missing), &mut HashMap::new()).is_err());
        assert!(
            !missing.exists(),
            "read-only connect must not create a database"
        );
    }

    #[test]
    fn normalizes_memory_and_file_urls_without_exposing_connection_text() {
        assert_eq!(duckdb_path(":memory:").unwrap(), ":memory:");
        assert_eq!(
            duckdb_path("duckdb:/tmp/demo.duckdb").unwrap(),
            "/tmp/demo.duckdb"
        );
        assert!(duckdb_path("duckdb:").is_err());
    }

    #[test]
    fn readonly_gate_rejects_mutation_statement_kinds() {
        assert!(is_read_only_statement("SELECT * FROM metrics"));
        assert!(!is_read_only_statement("DELETE FROM metrics"));
        assert!(!is_read_only_statement(
            "WITH removed AS (DELETE FROM metrics RETURNING id) SELECT * FROM removed"
        ));
        assert!(!is_read_only_statement("SELECT 1; DELETE FROM metrics"));
        assert!(is_read_only_statement(
            "SELECT 'DELETE FROM metrics' AS note;"
        ));
    }

    #[test]
    fn query_and_catalog_metadata_round_trip_through_the_protocol_shape() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE metric_owner(id INTEGER PRIMARY KEY); \
                 INSERT INTO metric_owner VALUES (1); \
                 CREATE TABLE metrics( \
                   id INTEGER PRIMARY KEY, \
                   owner_id INTEGER REFERENCES metric_owner(id), \
                   name VARCHAR CHECK(length(name) > 0) \
                 ); \
                 CREATE INDEX metrics_name_idx ON metrics(name); \
                 INSERT INTO metrics VALUES (1, 1, 'ready');",
            )
            .unwrap();

        let result = query(&connection, "SELECT id, name FROM metrics", &[]).unwrap();
        assert_eq!(result[0].columns[0].name, "id");
        assert_eq!(result[0].rows, vec![vec![json!(1), json!("ready")]]);

        let databases = metadata(&connection, MetadataRequest::Databases).unwrap();
        let database = databases
            .as_array()
            .unwrap()
            .first()
            .and_then(Value::as_str)
            .unwrap();
        assert!(!database.is_empty());
        let schemas = metadata(
            &connection,
            MetadataRequest::Schemas {
                database: Some(database.to_string()),
            },
        )
        .unwrap();
        assert!(schemas
            .as_array()
            .unwrap()
            .iter()
            .any(|schema| schema == "main"));

        let tables = metadata(
            &connection,
            MetadataRequest::Relations {
                database: None,
                namespace: "main".to_string(),
            },
        )
        .unwrap();
        assert!(tables
            .as_array()
            .unwrap()
            .iter()
            .any(|table| table["name"] == "metrics"));

        let columns = metadata(
            &connection,
            MetadataRequest::Columns {
                database: None,
                namespace: "main".to_string(),
                relation: "metrics".to_string(),
            },
        )
        .unwrap();
        assert!(columns
            .as_array()
            .unwrap()
            .iter()
            .any(|column| column["name"] == "name"));

        let indexes = metadata(
            &connection,
            MetadataRequest::Indexes {
                database: None,
                namespace: "main".to_string(),
                relation: "metrics".to_string(),
            },
        )
        .unwrap();
        assert!(indexes
            .as_array()
            .unwrap()
            .iter()
            .any(|index| index["name"] == "metrics_name_idx"));

        let constraints = metadata(
            &connection,
            MetadataRequest::Constraints {
                database: None,
                namespace: "main".to_string(),
                relation: "metrics".to_string(),
            },
        )
        .unwrap();
        assert!(constraints
            .as_array()
            .unwrap()
            .iter()
            .any(|constraint| constraint["constraint_type"] == "PRIMARY KEY"));
        assert!(constraints
            .as_array()
            .unwrap()
            .iter()
            .any(|constraint| constraint["constraint_type"] == "FOREIGN KEY"));
        assert!(constraints
            .as_array()
            .unwrap()
            .iter()
            .any(|constraint| constraint["constraint_type"] == "CHECK"));

        let references = metadata(
            &connection,
            MetadataRequest::ReferencingForeignKeys {
                database: None,
                namespace: "main".to_string(),
                relation: "metric_owner".to_string(),
            },
        )
        .unwrap();
        assert!(references.as_array().unwrap().iter().any(|reference| {
            reference["table"] == "metrics" && reference["referenced_table"] == "metric_owner"
        }));

        connection
            .execute_batch(
                "ATTACH ':memory:' AS analytics; \
                 CREATE TABLE analytics.report(id INTEGER, title VARCHAR);",
            )
            .unwrap();
        let attached_relations = metadata(
            &connection,
            MetadataRequest::Relations {
                database: Some("analytics".to_string()),
                namespace: "main".to_string(),
            },
        )
        .unwrap();
        assert!(attached_relations
            .as_array()
            .unwrap()
            .iter()
            .any(|relation| relation["name"] == "report"));
        let attached_columns = metadata(
            &connection,
            MetadataRequest::Columns {
                database: Some("analytics".to_string()),
                namespace: "main".to_string(),
                relation: "report".to_string(),
            },
        )
        .unwrap();
        assert!(attached_columns
            .as_array()
            .unwrap()
            .iter()
            .any(|column| column["name"] == "title"));
    }

    #[test]
    fn protocol_envelope_connects_queries_and_returns_the_matching_request_id() {
        let mut connections = HashMap::new();
        let connect = DriverRequestEnvelope {
            id: 7,
            request: DriverRequest::Connect {
                connection_id: "duckdb-test".to_string(),
                config: oxide_driver_protocol::SecretConnectionConfig {
                    url: ":memory:".to_string(),
                    options: Default::default(),
                },
            },
        };
        let connect = serde_json::to_string(&connect).unwrap();
        let connected = handle_line(&connect, &mut connections);
        assert_eq!(connected.id, 7);
        assert!(matches!(
            connected.response,
            DriverResponse::Ok(DriverResult::Empty)
        ));

        let create = DriverRequestEnvelope {
            id: 8,
            request: DriverRequest::Query {
                connection_id: "duckdb-test".to_string(),
                statement: "CREATE TABLE protocol_metrics(id INTEGER); INSERT INTO protocol_metrics VALUES (42)".to_string(),
                parameters: Vec::new(),
                context: Default::default(),
                query_id: None,
            },
        };
        let created = handle_line(&serde_json::to_string(&create).unwrap(), &mut connections);
        assert_eq!(created.id, 8);

        let query_request = DriverRequestEnvelope {
            id: 9,
            request: DriverRequest::Query {
                connection_id: "duckdb-test".to_string(),
                statement: "SELECT id FROM protocol_metrics".to_string(),
                parameters: Vec::new(),
                context: Default::default(),
                query_id: Some("query-9".to_string()),
            },
        };
        let response = handle_line(
            &serde_json::to_string(&query_request).unwrap(),
            &mut connections,
        );
        assert_eq!(response.id, 9);
        let DriverResponse::Ok(DriverResult::Query(results)) = response.response else {
            panic!("expected a query response");
        };
        assert_eq!(results[0].rows, vec![vec![json!(42)]]);
    }

    #[test]
    fn protocol_envelope_preserves_request_id_for_driver_errors() {
        let mut connections = HashMap::new();
        let request = DriverRequestEnvelope {
            id: 21,
            request: DriverRequest::Query {
                connection_id: "missing".to_string(),
                statement: "SELECT 1".to_string(),
                parameters: Vec::new(),
                context: Default::default(),
                query_id: None,
            },
        };
        let response = handle_line(&serde_json::to_string(&request).unwrap(), &mut connections);
        assert_eq!(response.id, 21);
        assert!(
            matches!(response.response, DriverResponse::Error(error) if error.code == "CONNECTION_NOT_FOUND")
        );
    }

    #[test]
    fn handshake_advertises_agent_read_only_enforcement() {
        let mut connections = HashMap::new();
        let result = handle_request(
            DriverRequest::Handshake(oxide_driver_protocol::HandshakeRequest {
                protocol_version: oxide_driver_protocol::DRIVER_PROTOCOL_VERSION.to_string(),
                host_version: "test".to_string(),
                package_id: PACKAGE_ID.to_string(),
                driver_id: DRIVER_ID.to_string(),
            }),
            &mut connections,
        )
        .unwrap();
        let DriverResult::Handshake(handshake) = result else {
            panic!("expected handshake response");
        };
        assert!(handshake.capabilities.read_only_enforcement);
        assert!(handshake.capabilities.file_queries);
    }

    #[test]
    fn protocol_contract_covers_connection_lifecycle_and_transaction_rollback() {
        let mut connections = HashMap::new();
        let connection_id = "duckdb-contract".to_string();
        let connection = || DriverRequest::Connect {
            connection_id: connection_id.clone(),
            config: oxide_driver_protocol::SecretConnectionConfig {
                url: ":memory:".to_string(),
                options: Default::default(),
            },
        };
        assert!(matches!(
            handle_request(connection(), &mut connections).unwrap(),
            DriverResult::Empty
        ));
        assert!(matches!(
            handle_request(
                DriverRequest::Ping {
                    connection_id: connection_id.clone(),
                },
                &mut connections,
            )
            .unwrap(),
            DriverResult::Boolean(true)
        ));
        let DriverResult::ServerVersion(Some(version)) = handle_request(
            DriverRequest::ServerVersion {
                connection_id: connection_id.clone(),
            },
            &mut connections,
        )
        .unwrap() else {
            panic!("expected a DuckDB server version");
        };
        assert!(!version.trim().is_empty());

        handle_request(
            DriverRequest::Query {
                connection_id: connection_id.clone(),
                statement: "CREATE TABLE contract_rows(value INTEGER)".to_string(),
                parameters: Vec::new(),
                context: Default::default(),
                query_id: None,
            },
            &mut connections,
        )
        .unwrap();
        handle_request(
            DriverRequest::BeginTransaction {
                connection_id: connection_id.clone(),
                transaction_id: "contract-tx".to_string(),
                context: Default::default(),
            },
            &mut connections,
        )
        .unwrap();
        handle_request(
            DriverRequest::Query {
                connection_id: connection_id.clone(),
                statement: "INSERT INTO contract_rows VALUES (7)".to_string(),
                parameters: Vec::new(),
                context: oxide_driver_protocol::DriverQueryContext {
                    transaction_id: Some("contract-tx".to_string()),
                    ..Default::default()
                },
                query_id: None,
            },
            &mut connections,
        )
        .unwrap();
        handle_request(
            DriverRequest::RollbackTransaction {
                connection_id: connection_id.clone(),
                transaction_id: "contract-tx".to_string(),
            },
            &mut connections,
        )
        .unwrap();

        let DriverResult::Query(results) = handle_request(
            DriverRequest::Query {
                connection_id,
                statement: "SELECT COUNT(*) AS count FROM contract_rows".to_string(),
                parameters: Vec::new(),
                context: Default::default(),
                query_id: None,
            },
            &mut connections,
        )
        .unwrap() else {
            panic!("expected a query result after rollback");
        };
        assert_eq!(results[0].rows, vec![vec![json!(0)]]);
    }

    #[test]
    fn protocol_rejects_writes_when_the_agent_read_only_context_is_set() {
        let mut connections = HashMap::new();
        let connection_id = "duckdb-read-only".to_string();
        handle_request(
            DriverRequest::Connect {
                connection_id: connection_id.clone(),
                config: oxide_driver_protocol::SecretConnectionConfig {
                    url: ":memory:".to_string(),
                    options: Default::default(),
                },
            },
            &mut connections,
        )
        .unwrap();

        let error = handle_request(
            DriverRequest::Query {
                connection_id: connection_id.clone(),
                statement: "CREATE TABLE forbidden_write(id INTEGER)".to_string(),
                parameters: Vec::new(),
                context: oxide_driver_protocol::DriverQueryContext {
                    read_only: true,
                    ..Default::default()
                },
                query_id: None,
            },
            &mut connections,
        )
        .unwrap_err();
        assert_eq!(error.code, "READ_ONLY_REJECTED");

        assert!(matches!(
            handle_request(
                DriverRequest::Query {
                    connection_id,
                    statement: "SELECT 1".to_string(),
                    parameters: Vec::new(),
                    context: oxide_driver_protocol::DriverQueryContext {
                        read_only: true,
                        ..Default::default()
                    },
                    query_id: None,
                },
                &mut connections,
            )
            .unwrap(),
            DriverResult::Query(_)
        ));
    }

    #[test]
    fn protocol_binds_query_values_without_interpolating_them_into_sql() {
        let mut connections = HashMap::new();
        handle_request(
            DriverRequest::Connect {
                connection_id: "duckdb-parameters".to_string(),
                config: oxide_driver_protocol::SecretConnectionConfig {
                    url: ":memory:".to_string(),
                    options: Default::default(),
                },
            },
            &mut connections,
        )
        .unwrap();

        let result = handle_request(
            DriverRequest::Query {
                connection_id: "duckdb-parameters".to_string(),
                statement: "SELECT ?::VARCHAR AS text_value, ?::BIGINT AS number_value".to_string(),
                parameters: vec![
                    oxide_driver_protocol::DriverQueryParameter {
                        value: json!("Robert'); DROP TABLE metrics; --"),
                        data_type: Some("VARCHAR".to_string()),
                    },
                    oxide_driver_protocol::DriverQueryParameter {
                        value: json!(7),
                        data_type: Some("BIGINT".to_string()),
                    },
                ],
                context: Default::default(),
                query_id: None,
            },
            &mut connections,
        )
        .unwrap();
        let DriverResult::Query(results) = result else {
            panic!("expected a query response");
        };
        assert_eq!(
            results[0].rows,
            vec![vec![json!("Robert'); DROP TABLE metrics; --"), json!(7)]]
        );
    }

    #[test]
    fn scoped_query_uses_an_attached_catalog_and_restores_the_default_catalog() {
        let mut connections = HashMap::new();
        handle_request(
            DriverRequest::Connect {
                connection_id: "duckdb-catalog".to_string(),
                config: oxide_driver_protocol::SecretConnectionConfig {
                    url: ":memory:".to_string(),
                    options: Default::default(),
                },
            },
            &mut connections,
        )
        .unwrap();
        handle_request(
            DriverRequest::Query {
                connection_id: "duckdb-catalog".to_string(),
                statement: "ATTACH ':memory:' AS analytics; CREATE TABLE analytics.report(id INTEGER); INSERT INTO analytics.report VALUES (7)".to_string(),
                parameters: Vec::new(),
                context: Default::default(),
                query_id: None,
            },
            &mut connections,
        )
        .unwrap();

        let result = handle_request(
            DriverRequest::Query {
                connection_id: "duckdb-catalog".to_string(),
                statement: "SELECT id FROM report".to_string(),
                parameters: Vec::new(),
                context: oxide_driver_protocol::DriverQueryContext {
                    database: Some("analytics".to_string()),
                    ..Default::default()
                },
                query_id: None,
            },
            &mut connections,
        )
        .unwrap();
        let DriverResult::Query(results) = result else {
            panic!("expected catalog query results");
        };
        assert_eq!(results[0].rows, vec![vec![json!(7)]]);

        let default_catalog = query(
            connections.get("duckdb-catalog").unwrap(),
            "SELECT current_database()",
            &[],
        )
        .unwrap();
        assert_ne!(default_catalog[0].rows[0][0], json!("analytics"));
    }
}
