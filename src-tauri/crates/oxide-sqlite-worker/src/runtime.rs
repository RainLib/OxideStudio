use crate::protocol::{
    MetadataRequest, WorkerColumn, WorkerErrorCode, WorkerOperation, WorkerParameter,
    WorkerRequest, WorkerResponse, WorkerResponseBody, DEFAULT_QUERY_ROW_LIMIT,
    MAX_QUERY_ROW_LIMIT, MAX_REQUEST_JSON_BYTES, MAX_RESPONSE_JSON_BYTES,
    SQLITE_WORKER_PROTOCOL_VERSION,
};
use rusqlite::backup::{Backup, StepResult};
use rusqlite::types::{ToSqlOutput, Value as SqlValue, ValueRef};
use rusqlite::{Connection, DatabaseName, InterruptHandle, OpenFlags, ToSql};
use serde_json::json;
use std::io::{BufRead, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

const MAX_BLOB_BYTES: usize = 512 * 1024;
const MAX_ERROR_CHARS: usize = 2_048;

#[derive(Default)]
struct ActiveRequest {
    id: Option<u64>,
    interrupt: Option<InterruptHandle>,
    cancelled: Option<Arc<AtomicBool>>,
}

pub fn run_stdio() -> Result<(), String> {
    run(std::io::stdin().lock(), std::io::stdout())
}

pub fn run<R: BufRead, W: Write + Send + 'static>(mut input: R, output: W) -> Result<(), String> {
    let (request_tx, request_rx) = mpsc::channel::<WorkerRequest>();
    let (response_tx, response_rx) = mpsc::channel::<WorkerResponse>();
    let active = Arc::new(Mutex::new(ActiveRequest::default()));

    let writer = std::thread::spawn(move || write_responses(output, response_rx));
    let worker_active = Arc::clone(&active);
    let worker_responses = response_tx.clone();
    let worker =
        std::thread::spawn(move || process_requests(request_rx, worker_responses, worker_active));

    let mut encoded = Vec::new();
    loop {
        encoded.clear();
        let bytes = input
            .read_until(b'\n', &mut encoded)
            .map_err(|error| error.to_string())?;
        if bytes == 0 {
            break;
        }
        if encoded.len() > MAX_REQUEST_JSON_BYTES {
            let _ = response_tx.send(WorkerResponse::error(
                0,
                WorkerErrorCode::InvalidRequest,
                "SQLite worker request exceeded 4 MiB",
            ));
            continue;
        }
        if encoded.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let request: WorkerRequest = match serde_json::from_slice(&encoded) {
            Ok(request) => request,
            Err(error) => {
                let _ = response_tx.send(WorkerResponse::error(
                    0,
                    WorkerErrorCode::InvalidRequest,
                    bounded_error(format!("Invalid SQLite worker request: {error}")),
                ));
                continue;
            }
        };
        if request.protocol_version != SQLITE_WORKER_PROTOCOL_VERSION {
            let _ = response_tx.send(WorkerResponse::error(
                request.id,
                WorkerErrorCode::ProtocolMismatch,
                format!(
                    "SQLite worker protocol {} is required; received {}",
                    SQLITE_WORKER_PROTOCOL_VERSION, request.protocol_version
                ),
            ));
            continue;
        }
        if let WorkerOperation::Interrupt { request_id } = request.operation {
            let accepted = interrupt_active(&active, request_id);
            let _ = response_tx.send(WorkerResponse::with_body(
                request.id,
                WorkerResponseBody::Interrupt {
                    request_id,
                    accepted,
                },
            ));
            continue;
        }
        if request_tx.send(request).is_err() {
            break;
        }
    }

    drop(request_tx);
    worker
        .join()
        .map_err(|_| "SQLite worker thread panicked".to_string())?;
    drop(response_tx);
    writer
        .join()
        .map_err(|_| "SQLite worker writer thread panicked".to_string())?
}

fn write_responses<W: Write>(
    mut output: W,
    responses: mpsc::Receiver<WorkerResponse>,
) -> Result<(), String> {
    for response in responses {
        let mut bytes =
            serde_json::to_vec(&bounded_response(response)).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        output
            .write_all(&bytes)
            .map_err(|error| error.to_string())?;
        output.flush().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn bounded_response(response: WorkerResponse) -> WorkerResponse {
    match serde_json::to_vec(&response) {
        Ok(encoded) if encoded.len() <= MAX_RESPONSE_JSON_BYTES => response,
        _ => WorkerResponse::error(
            response.id,
            WorkerErrorCode::ResponseTooLarge,
            "SQLite worker response exceeded 16 MiB",
        ),
    }
}

fn process_requests(
    requests: mpsc::Receiver<WorkerRequest>,
    responses: mpsc::Sender<WorkerResponse>,
    active: Arc<Mutex<ActiveRequest>>,
) {
    let mut connection: Option<Connection> = None;
    for request in requests {
        let id = request.id;
        let body = handle_request(&mut connection, request, &active);
        clear_active(&active, id);
        if responses.send(WorkerResponse::with_body(id, body)).is_err() {
            break;
        }
    }
}

fn handle_request(
    connection: &mut Option<Connection>,
    request: WorkerRequest,
    active: &Arc<Mutex<ActiveRequest>>,
) -> WorkerResponseBody {
    match request.operation {
        WorkerOperation::Handshake => WorkerResponseBody::Handshake {
            worker_version: env!("CARGO_PKG_VERSION").to_string(),
            sqlite_version: rusqlite::version().to_string(),
            capabilities: vec![
                "parameterized-query".into(),
                "parameterized-execute".into(),
                "metadata".into(),
                "online-backup".into(),
                "restore".into(),
                "interrupt".into(),
            ],
        },
        WorkerOperation::Open { path, read_only } => match open_database(&path, read_only) {
            Ok(opened) => {
                *connection = Some(opened);
                WorkerResponseBody::Ok
            }
            Err((code, error)) => error_body(code, error),
        },
        WorkerOperation::Query {
            sql,
            parameters,
            max_rows,
        } => with_connection(connection, |connection| {
            let cancelled = set_active(active, request.id, connection.get_interrupt_handle());
            with_cancel_handler(connection, cancelled, || {
                query(connection, &sql, &parameters, max_rows)
            })
        }),
        WorkerOperation::Execute { sql, parameters } => with_connection(connection, |connection| {
            let cancelled = set_active(active, request.id, connection.get_interrupt_handle());
            with_cancel_handler(connection, cancelled, || {
                execute(connection, &sql, &parameters)
            })
        }),
        WorkerOperation::Metadata { request: metadata } => {
            with_connection(connection, |connection| {
                let cancelled = set_active(active, request.id, connection.get_interrupt_handle());
                with_cancel_handler(connection, cancelled, || {
                    metadata_result(connection, metadata)
                })
            })
        }
        WorkerOperation::Backup { destination } => with_connection(connection, |connection| {
            let cancelled = set_active(active, request.id, connection.get_interrupt_handle());
            backup(connection, &destination, cancelled.as_ref())
        }),
        WorkerOperation::Restore { source } => with_connection_mut(connection, |connection| {
            let cancelled = set_active(active, request.id, connection.get_interrupt_handle());
            restore(connection, &source, cancelled.as_ref())
        }),
        WorkerOperation::Ping => with_connection(connection, |connection| {
            match connection.query_row("SELECT 1", [], |row| row.get::<_, i64>(0)) {
                Ok(1) => WorkerResponseBody::Ok,
                Ok(_) => error_body(
                    WorkerErrorCode::Internal,
                    "SQLite ping returned an invalid value",
                ),
                Err(error) => sqlite_error_body(error),
            }
        }),
        WorkerOperation::Close => {
            *connection = None;
            WorkerResponseBody::Ok
        }
        WorkerOperation::Interrupt { .. } => error_body(
            WorkerErrorCode::Internal,
            "Interrupt requests must be handled by the protocol reader",
        ),
    }
}

fn with_cancel_handler(
    connection: &Connection,
    cancelled: Arc<AtomicBool>,
    operation: impl FnOnce() -> WorkerResponseBody,
) -> WorkerResponseBody {
    connection.progress_handler(1_000, Some(move || cancelled.load(Ordering::Acquire)));
    let response = operation();
    connection.progress_handler(0, None::<fn() -> bool>);
    response
}

fn with_connection(
    connection: &Option<Connection>,
    operation: impl FnOnce(&Connection) -> WorkerResponseBody,
) -> WorkerResponseBody {
    connection.as_ref().map(operation).unwrap_or_else(|| {
        error_body(
            WorkerErrorCode::NotOpen,
            "SQLite worker has no open database",
        )
    })
}

fn with_connection_mut(
    connection: &mut Option<Connection>,
    operation: impl FnOnce(&mut Connection) -> WorkerResponseBody,
) -> WorkerResponseBody {
    connection.as_mut().map(operation).unwrap_or_else(|| {
        error_body(
            WorkerErrorCode::NotOpen,
            "SQLite worker has no open database",
        )
    })
}

fn set_active(
    active: &Arc<Mutex<ActiveRequest>>,
    id: u64,
    interrupt: InterruptHandle,
) -> Arc<AtomicBool> {
    let cancelled = Arc::new(AtomicBool::new(false));
    if let Ok(mut current) = active.lock() {
        current.id = Some(id);
        current.interrupt = Some(interrupt);
        current.cancelled = Some(Arc::clone(&cancelled));
    }
    cancelled
}

fn clear_active(active: &Arc<Mutex<ActiveRequest>>, id: u64) {
    if let Ok(mut current) = active.lock() {
        if current.id == Some(id) {
            *current = ActiveRequest::default();
        }
    }
}

fn interrupt_active(active: &Arc<Mutex<ActiveRequest>>, request_id: u64) -> bool {
    let Ok(current) = active.lock() else {
        return false;
    };
    if current.id != Some(request_id) {
        return false;
    }
    if let Some(cancelled) = &current.cancelled {
        cancelled.store(true, Ordering::Release);
    }
    if let Some(interrupt) = &current.interrupt {
        interrupt.interrupt();
        true
    } else {
        false
    }
}

fn open_database(path: &str, read_only: bool) -> Result<Connection, (WorkerErrorCode, String)> {
    validate_absolute_file_path(path).map_err(|error| (WorkerErrorCode::FileInvalid, error))?;
    if !Path::new(path).is_file() {
        return Err((
            WorkerErrorCode::FileInvalid,
            format!("SQLite file does not exist: {path}"),
        ));
    }
    let mut flags = OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    flags |= if read_only {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    } else {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    };
    let connection = Connection::open_with_flags(path, flags).map_err(|error| {
        (
            WorkerErrorCode::FileInvalid,
            format!("Failed to open SQLite file: {error}"),
        )
    })?;
    connection
        .busy_timeout(Duration::from_secs(10))
        .map_err(|error| (WorkerErrorCode::Internal, error.to_string()))?;
    connection
        .set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)
        .map_err(|error| (WorkerErrorCode::Internal, error.to_string()))?;
    Ok(connection)
}

fn validate_absolute_file_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("SQLite path is empty".into());
    }
    if path.contains('\0') || path.contains('\n') || path.contains('\r') {
        return Err("SQLite path contains prohibited control characters".into());
    }
    if !Path::new(path).is_absolute() {
        return Err("SQLite worker paths must be absolute".into());
    }
    Ok(())
}

fn query(
    connection: &Connection,
    sql: &str,
    parameters: &[WorkerParameter],
    max_rows: Option<usize>,
) -> WorkerResponseBody {
    let sql = match validate_single_statement(sql) {
        Ok(sql) => sql,
        Err(error) => return error_body(WorkerErrorCode::InvalidRequest, error),
    };
    let limit = max_rows
        .unwrap_or(DEFAULT_QUERY_ROW_LIMIT)
        .clamp(1, MAX_QUERY_ROW_LIMIT);
    let values = match parameter_values(parameters) {
        Ok(values) => values,
        Err(error) => return error_body(WorkerErrorCode::InvalidRequest, error),
    };
    let refs = values
        .iter()
        .map(|value| value as &dyn ToSql)
        .collect::<Vec<_>>();
    let mut statement = match connection.prepare(sql) {
        Ok(statement) => statement,
        Err(error) => return sqlite_error_body(error),
    };
    if statement.column_count() == 0 {
        return error_body(
            WorkerErrorCode::InvalidRequest,
            "Query operation requires a row-producing statement",
        );
    }
    let columns = statement
        .columns()
        .iter()
        .map(|column| WorkerColumn {
            name: column.name().to_string(),
            data_type: column.decl_type().unwrap_or_default().to_string(),
        })
        .collect::<Vec<_>>();
    let mut cursor = match statement.query(refs.as_slice()) {
        Ok(cursor) => cursor,
        Err(error) => return sqlite_error_body(error),
    };
    let mut rows = Vec::new();
    let mut truncated = false;
    let mut encoded_bytes = 0usize;
    loop {
        let row = match cursor.next() {
            Ok(Some(row)) => row,
            Ok(None) => break,
            Err(error) => return sqlite_error_body(error),
        };
        if rows.len() >= limit {
            truncated = true;
            break;
        }
        let mut values = Vec::with_capacity(columns.len());
        for (index, column) in columns.iter().enumerate() {
            let value = match row.get_ref(index) {
                Ok(value) => value_to_json(value, column.data_type.as_str()),
                Err(error) => return sqlite_error_body(error),
            };
            values.push(value);
        }
        let row_bytes = serde_json::to_vec(&values).map_or(0, |encoded| encoded.len());
        if !rows.is_empty() && encoded_bytes.saturating_add(row_bytes) > MAX_RESPONSE_JSON_BYTES / 2
        {
            truncated = true;
            break;
        }
        encoded_bytes = encoded_bytes.saturating_add(row_bytes);
        rows.push(values);
    }
    WorkerResponseBody::Result {
        columns,
        rows,
        rows_affected: 0,
        truncated,
    }
}

fn execute(
    connection: &Connection,
    sql: &str,
    parameters: &[WorkerParameter],
) -> WorkerResponseBody {
    let sql = match validate_single_statement(sql) {
        Ok(sql) => sql,
        Err(error) => return error_body(WorkerErrorCode::InvalidRequest, error),
    };
    let values = match parameter_values(parameters) {
        Ok(values) => values,
        Err(error) => return error_body(WorkerErrorCode::InvalidRequest, error),
    };
    let refs = values
        .iter()
        .map(|value| value as &dyn ToSql)
        .collect::<Vec<_>>();
    let mut statement = match connection.prepare(sql) {
        Ok(statement) => statement,
        Err(error) => return sqlite_error_body(error),
    };
    if statement.column_count() != 0 {
        return error_body(
            WorkerErrorCode::InvalidRequest,
            "Execute operation does not accept row-producing statements",
        );
    }
    match statement.execute(refs.as_slice()) {
        Ok(rows_affected) => WorkerResponseBody::Result {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: rows_affected as u64,
            truncated: false,
        },
        Err(error) => sqlite_error_body(error),
    }
}

fn metadata_result(connection: &Connection, request: MetadataRequest) -> WorkerResponseBody {
    match request {
        MetadataRequest::Schemas => query(connection, "PRAGMA database_list", &[], Some(256)),
        MetadataRequest::Tables { schema } => {
            let schema = match quoted_identifier(&schema) {
                Ok(schema) => schema,
                Err(error) => return error_body(WorkerErrorCode::InvalidRequest, error),
            };
            query(
                connection,
                &format!(
                    "SELECT name, type FROM {schema}.sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
                ),
                &[],
                Some(MAX_QUERY_ROW_LIMIT),
            )
        }
        MetadataRequest::Columns { schema, table } => {
            pragma_metadata(connection, &schema, "table_xinfo", &table)
        }
        MetadataRequest::Indexes { schema, table } => {
            pragma_metadata(connection, &schema, "index_list", &table)
        }
        MetadataRequest::ForeignKeys { schema, table } => {
            pragma_metadata(connection, &schema, "foreign_key_list", &table)
        }
    }
}

fn pragma_metadata(
    connection: &Connection,
    schema: &str,
    pragma: &str,
    table: &str,
) -> WorkerResponseBody {
    let schema = match quoted_identifier(schema) {
        Ok(schema) => schema,
        Err(error) => return error_body(WorkerErrorCode::InvalidRequest, error),
    };
    let table = match quoted_identifier(table) {
        Ok(table) => table,
        Err(error) => return error_body(WorkerErrorCode::InvalidRequest, error),
    };
    query(
        connection,
        &format!("PRAGMA {schema}.{pragma}({table})"),
        &[],
        Some(MAX_QUERY_ROW_LIMIT),
    )
}

fn quoted_identifier(value: &str) -> Result<String, String> {
    if value.trim().is_empty()
        || value.contains('\0')
        || value.contains('\n')
        || value.contains('\r')
    {
        return Err("SQLite metadata identifier is invalid".into());
    }
    Ok(format!("\"{}\"", value.replace('"', "\"\"")))
}

fn validate_single_statement(sql: &str) -> Result<&str, String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("SQL is empty".into());
    }
    if trimmed.contains('\0') {
        return Err("SQL contains NUL".into());
    }
    // rusqlite prepare rejects trailing statements. Keep the explicit check so
    // a future runtime change cannot silently widen the worker contract.
    // CREATE TRIGGER bodies legitimately contain semicolons. rusqlite remains
    // the authoritative parser and rejects a trailing top-level statement;
    // the desktop host additionally validates the compound body before it can
    // enter a guarded rebuild request.
    let single_statement = if is_create_trigger(trimmed) {
        trigger_tail_is_only_semicolons_and_comments(trimmed)
    } else {
        tail_is_only_semicolons_and_comments(trimmed)
    };
    if !single_statement {
        return Err("SQLite worker accepts exactly one statement per request".into());
    }
    validate_remote_sql_features(trimmed)?;
    Ok(trimmed)
}

fn is_create_trigger(sql: &str) -> bool {
    let tokens = sqlite_identifier_tokens(sql, 3);
    matches!(
        tokens.as_slice(),
        [create, trigger, ..] if create == "create" && trigger == "trigger"
    ) || matches!(
        tokens.as_slice(),
        [create, temporary, trigger, ..]
            if create == "create"
                && matches!(temporary.as_str(), "temp" | "temporary")
                && trigger == "trigger"
    )
}

fn trigger_tail_is_only_semicolons_and_comments(sql: &str) -> bool {
    let mut chars = sql.char_indices().peekable();
    let mut body_started = false;
    let mut case_depth = 0usize;
    while let Some((start, character)) = chars.next() {
        match character {
            '-' if chars.peek().is_some_and(|(_, next)| *next == '-') => {
                chars.next();
                for (_, next) in chars.by_ref() {
                    if next == '\n' {
                        break;
                    }
                }
            }
            '/' if chars.peek().is_some_and(|(_, next)| *next == '*') => {
                chars.next();
                let mut previous = '\0';
                for (_, next) in chars.by_ref() {
                    if previous == '*' && next == '/' {
                        break;
                    }
                    previous = next;
                }
            }
            '\'' | '"' | '`' => {
                let delimiter = character;
                while let Some((_, next)) = chars.next() {
                    if next == delimiter {
                        if chars
                            .peek()
                            .is_some_and(|(_, escaped)| *escaped == delimiter)
                        {
                            chars.next();
                        } else {
                            break;
                        }
                    }
                }
            }
            '[' => {
                for (_, next) in chars.by_ref() {
                    if next == ']' {
                        break;
                    }
                }
            }
            character if character.is_ascii_alphabetic() || character == '_' => {
                let mut end = start + character.len_utf8();
                while let Some((index, next)) = chars.peek().copied() {
                    if next.is_ascii_alphanumeric() || next == '_' {
                        chars.next();
                        end = index + next.len_utf8();
                    } else {
                        break;
                    }
                }
                let token = sql[start..end].to_ascii_lowercase();
                if !body_started {
                    body_started = token == "begin";
                } else if token == "case" {
                    case_depth = case_depth.saturating_add(1);
                } else if token == "end" {
                    if case_depth > 0 {
                        case_depth -= 1;
                    } else {
                        return strip_sqlite_trivia_and_semicolons(&sql[end..]).is_empty();
                    }
                }
            }
            _ => {}
        }
    }
    false
}

fn validate_remote_sql_features(sql: &str) -> Result<(), String> {
    let tokens = sqlite_identifier_tokens(sql, 32);
    if tokens
        .first()
        .is_some_and(|token| matches!(token.as_str(), "attach" | "detach"))
    {
        return Err("Remote SQLite does not support attached databases".into());
    }
    if tokens.iter().any(|token| token == "load_extension") {
        return Err("Remote SQLite does not support loadable extensions".into());
    }
    if tokens.first().is_some_and(|token| token == "pragma")
        && tokens
            .iter()
            .skip(1)
            .any(|token| matches!(token.as_str(), "key" | "rekey") || token.starts_with("cipher_"))
    {
        return Err("Remote SQLite does not support SQLCipher settings".into());
    }
    Ok(())
}

fn sqlite_identifier_tokens(sql: &str, limit: usize) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = sql.char_indices().peekable();
    while let Some((start, character)) = chars.next() {
        match character {
            '-' if chars.peek().is_some_and(|(_, next)| *next == '-') => {
                chars.next();
                for (_, next) in chars.by_ref() {
                    if next == '\n' {
                        break;
                    }
                }
            }
            '/' if chars.peek().is_some_and(|(_, next)| *next == '*') => {
                chars.next();
                let mut previous = '\0';
                for (_, next) in chars.by_ref() {
                    if previous == '*' && next == '/' {
                        break;
                    }
                    previous = next;
                }
            }
            '\'' | '"' | '`' => {
                let delimiter = character;
                while let Some((_, next)) = chars.next() {
                    if next == delimiter {
                        if chars
                            .peek()
                            .is_some_and(|(_, escaped)| *escaped == delimiter)
                        {
                            chars.next();
                        } else {
                            break;
                        }
                    }
                }
            }
            '[' => {
                while let Some((_, next)) = chars.next() {
                    if next == ']' {
                        if chars.peek().is_some_and(|(_, escaped)| *escaped == ']') {
                            chars.next();
                        } else {
                            break;
                        }
                    }
                }
            }
            character if character.is_ascii_alphabetic() || character == '_' => {
                let mut end = start + character.len_utf8();
                while let Some((index, next)) = chars.peek().copied() {
                    if next.is_ascii_alphanumeric() || next == '_' {
                        chars.next();
                        end = index + next.len_utf8();
                    } else {
                        break;
                    }
                }
                tokens.push(sql[start..end].to_ascii_lowercase());
                if tokens.len() >= limit {
                    break;
                }
            }
            _ => {}
        }
    }
    tokens
}

fn tail_is_only_semicolons_and_comments(sql: &str) -> bool {
    // SQLite itself remains the parser authority. This conservative scanner
    // only catches an obvious second top-level statement without inspecting
    // semicolons inside strings or quoted identifiers.
    let mut quote = None;
    let mut chars = sql.char_indices().peekable();
    let mut first_terminator = None;
    while let Some((index, ch)) = chars.next() {
        if let Some(delimiter) = quote {
            if ch == delimiter {
                if chars.peek().is_some_and(|(_, next)| *next == delimiter) {
                    chars.next();
                } else {
                    quote = None;
                }
            }
            continue;
        }
        match ch {
            '\'' | '"' | '`' => quote = Some(ch),
            '[' => quote = Some(']'),
            ';' => {
                first_terminator = Some(index + ch.len_utf8());
                break;
            }
            _ => {}
        }
    }
    let Some(index) = first_terminator else {
        return true;
    };
    strip_sqlite_trivia_and_semicolons(&sql[index..]).is_empty()
}

fn strip_sqlite_trivia_and_semicolons(mut value: &str) -> &str {
    loop {
        value = value.trim_start();
        if let Some(rest) = value.strip_prefix(';') {
            value = rest;
            continue;
        }
        if let Some(rest) = value.strip_prefix("--") {
            value = rest.split_once('\n').map_or("", |(_, tail)| tail);
            continue;
        }
        if let Some(rest) = value.strip_prefix("/*") {
            let Some((_, tail)) = rest.split_once("*/") else {
                return value;
            };
            value = tail;
            continue;
        }
        return value;
    }
}

fn parameter_values(parameters: &[WorkerParameter]) -> Result<Vec<BoundValue>, String> {
    parameters.iter().map(BoundValue::try_from).collect()
}

enum BoundValue {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl TryFrom<&WorkerParameter> for BoundValue {
    type Error = String;

    fn try_from(parameter: &WorkerParameter) -> Result<Self, Self::Error> {
        let data_type = parameter
            .data_type
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if parameter.value.is_null() {
            return Ok(Self::Null);
        }
        if matches!(data_type.as_str(), "blob" | "binary" | "bytes") {
            let text = parameter
                .value
                .as_str()
                .ok_or("SQLite BLOB parameter must be a hex string")?;
            return decode_hex(text.strip_prefix("0x").unwrap_or(text)).map(Self::Blob);
        }
        match &parameter.value {
            serde_json::Value::Bool(value) => Ok(Self::Integer(i64::from(*value))),
            serde_json::Value::Number(value) => value
                .as_i64()
                .map(Self::Integer)
                .or_else(|| {
                    value
                        .as_u64()
                        .and_then(|value| i64::try_from(value).ok())
                        .map(Self::Integer)
                })
                .or_else(|| {
                    value
                        .as_f64()
                        .filter(|value| value.is_finite())
                        .map(Self::Real)
                })
                .ok_or_else(|| "SQLite numeric parameter is outside the supported range".into()),
            serde_json::Value::String(value) => Ok(Self::Text(value.clone())),
            _ => Ok(Self::Text(parameter.value.to_string())),
        }
    }
}

impl ToSql for BoundValue {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            Self::Null => ToSqlOutput::Owned(SqlValue::Null),
            Self::Integer(value) => ToSqlOutput::Owned(SqlValue::Integer(*value)),
            Self::Real(value) => ToSqlOutput::Owned(SqlValue::Real(*value)),
            Self::Text(value) => ToSqlOutput::Borrowed(ValueRef::Text(value.as_bytes())),
            Self::Blob(value) => ToSqlOutput::Borrowed(ValueRef::Blob(value)),
        })
    }
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    if !value.len().is_multiple_of(2) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(
            "SQLite BLOB parameter must contain an even number of hexadecimal digits".into(),
        );
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair =
                std::str::from_utf8(pair).map_err(|_| "Invalid BLOB parameter".to_string())?;
            u8::from_str_radix(pair, 16).map_err(|_| "Invalid BLOB parameter".to_string())
        })
        .collect()
}

fn backup(
    connection: &Connection,
    destination: &str,
    cancelled: &AtomicBool,
) -> WorkerResponseBody {
    if let Err(error) = validate_absolute_file_path(destination) {
        return error_body(WorkerErrorCode::FileInvalid, error);
    }
    if let Some(parent) = Path::new(destination).parent() {
        if !parent.is_dir() {
            return error_body(
                WorkerErrorCode::FileInvalid,
                "Backup parent directory does not exist",
            );
        }
    }
    let temporary = format!("{destination}.oxide-part");
    let _ = std::fs::remove_file(&temporary);
    // A reviewed schema rebuild holds BEGIN IMMEDIATE on the worker's primary
    // connection before requesting its pre-change backup. SQLite's online
    // backup API cannot read from that same write-transaction connection. A
    // separate read-only connection observes the last committed snapshot while
    // the primary connection prevents another writer from racing the backup.
    let result = backup_source_connection(connection)
        .and_then(|source| backup_to_path(&source, &temporary, cancelled));
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temporary);
        let code = if cancelled.load(Ordering::Acquire) {
            WorkerErrorCode::Interrupted
        } else {
            WorkerErrorCode::BackupFailed
        };
        return error_body(code, format!("SQLite backup failed: {error}"));
    }
    let integrity = match integrity_check_path(&temporary) {
        Ok(value) => value,
        Err(error) => {
            let _ = std::fs::remove_file(&temporary);
            return error_body(WorkerErrorCode::BackupFailed, error);
        }
    };
    if let Err(error) = std::fs::rename(&temporary, destination) {
        let _ = std::fs::remove_file(&temporary);
        return error_body(
            WorkerErrorCode::BackupFailed,
            format!("Failed to publish SQLite backup: {error}"),
        );
    }
    let byte_len = std::fs::metadata(destination).map_or(0, |metadata| metadata.len());
    WorkerResponseBody::File {
        byte_len,
        integrity_check: integrity,
    }
}

fn backup_source_connection(connection: &Connection) -> Result<Connection, String> {
    let source_path: String = connection
        .query_row(
            "SELECT file FROM pragma_database_list WHERE name = 'main'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to resolve the SQLite source file: {error}"))?;
    validate_absolute_file_path(&source_path)?;
    let source = Connection::open_with_flags(
        source_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("Failed to open the SQLite backup source: {error}"))?;
    source
        .busy_timeout(Duration::from_secs(10))
        .map_err(|error| format!("Failed to configure the SQLite backup source: {error}"))?;
    Ok(source)
}

fn restore(
    connection: &mut Connection,
    source: &str,
    cancelled: &AtomicBool,
) -> WorkerResponseBody {
    if let Err(error) = validate_absolute_file_path(source) {
        return error_body(WorkerErrorCode::FileInvalid, error);
    }
    let integrity = match integrity_check_path(source) {
        Ok(value) => value,
        Err(error) => return error_body(WorkerErrorCode::RestoreFailed, error),
    };
    if let Err(error) = restore_from_path(connection, source, cancelled) {
        let code = if cancelled.load(Ordering::Acquire) {
            WorkerErrorCode::Interrupted
        } else {
            WorkerErrorCode::RestoreFailed
        };
        return error_body(code, format!("SQLite restore failed: {error}"));
    }
    let byte_len = std::fs::metadata(source).map_or(0, |metadata| metadata.len());
    WorkerResponseBody::File {
        byte_len,
        integrity_check: integrity,
    }
}

fn backup_to_path(
    source: &Connection,
    destination: &str,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let mut destination = Connection::open(destination).map_err(|error| error.to_string())?;
    let backup = Backup::new(source, &mut destination).map_err(|error| error.to_string())?;
    run_backup_steps(&backup, cancelled)
}

fn restore_from_path(
    destination: &mut Connection,
    source: &str,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let source = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let backup =
        Backup::new_with_names(&source, DatabaseName::Main, destination, DatabaseName::Main)
            .map_err(|error| error.to_string())?;
    run_backup_steps(&backup, cancelled)
}

fn run_backup_steps(backup: &Backup<'_, '_>, cancelled: &AtomicBool) -> Result<(), String> {
    let mut busy_retries = 0usize;
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err("cancelled".into());
        }
        match backup.step(256).map_err(|error| error.to_string())? {
            StepResult::Done => return Ok(()),
            StepResult::More => busy_retries = 0,
            StepResult::Busy | StepResult::Locked if busy_retries < 200 => {
                busy_retries += 1;
                std::thread::sleep(Duration::from_millis(10));
            }
            StepResult::Busy => return Err("SQLite backup remained busy".into()),
            StepResult::Locked => return Err("SQLite backup remained locked".into()),
            _ => return Err("SQLite backup returned an unsupported step state".into()),
        }
    }
}

fn integrity_check_path(path: &str) -> Result<String, String> {
    let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Failed to inspect SQLite file: {error}"))?;
    let result: String = source
        .query_row("PRAGMA main.integrity_check", [], |row| row.get(0))
        .map_err(|error| format!("SQLite integrity check failed: {error}"))?;
    if result.eq_ignore_ascii_case("ok") {
        Ok(result)
    } else {
        Err("SQLite file failed its integrity check".into())
    }
}

fn value_to_json(value: ValueRef<'_>, declared_type: &str) -> serde_json::Value {
    match value {
        ValueRef::Null => json!(null),
        ValueRef::Integer(value) => json!(value),
        ValueRef::Real(value) if value.is_finite() => json!(value),
        ValueRef::Real(value) => json!(value.to_string()),
        ValueRef::Text(value) => json!(String::from_utf8_lossy(value)),
        ValueRef::Blob(value) if has_text_affinity(declared_type) => {
            std::str::from_utf8(value).map_or_else(|_| json!(hex_blob(value)), |text| json!(text))
        }
        ValueRef::Blob(value) => json!(hex_blob(value)),
    }
}

fn has_text_affinity(declared_type: &str) -> bool {
    let upper = declared_type.to_ascii_uppercase();
    upper.contains("CHAR") || upper.contains("CLOB") || upper.contains("TEXT")
}

fn hex_blob(value: &[u8]) -> String {
    let bounded = &value[..value.len().min(MAX_BLOB_BYTES)];
    let mut result = String::with_capacity(2 + bounded.len() * 2);
    result.push_str("0x");
    for byte in bounded {
        use std::fmt::Write as _;
        let _ = write!(result, "{byte:02x}");
    }
    result
}

fn sqlite_error_body(error: rusqlite::Error) -> WorkerResponseBody {
    let code = match &error {
        rusqlite::Error::SqliteFailure(inner, _)
            if inner.code == rusqlite::ErrorCode::OperationInterrupted =>
        {
            WorkerErrorCode::Interrupted
        }
        rusqlite::Error::SqliteFailure(inner, _) if inner.code == rusqlite::ErrorCode::ReadOnly => {
            WorkerErrorCode::ReadOnly
        }
        _ => WorkerErrorCode::QueryFailed,
    };
    error_body(code, error.to_string())
}

fn error_body(code: WorkerErrorCode, message: impl Into<String>) -> WorkerResponseBody {
    WorkerResponseBody::Error {
        code,
        message: bounded_error(message.into()),
    }
}

fn bounded_error(message: String) -> String {
    let mut result = message.chars().take(MAX_ERROR_CHARS).collect::<String>();
    if message.chars().count() > MAX_ERROR_CHARS {
        result.push('…');
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufReader, Cursor};
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct SharedWriter(Arc<Mutex<Vec<u8>>>);

    impl Write for SharedWriter {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn request(id: u64, operation: WorkerOperation) -> String {
        format!(
            "{}\n",
            serde_json::to_string(&WorkerRequest::new(id, operation)).unwrap()
        )
    }

    fn run_requests(input: String) -> Vec<WorkerResponse> {
        let output = SharedWriter::default();
        run(BufReader::new(Cursor::new(input)), output.clone()).unwrap();
        let bytes = output.0.lock().unwrap().clone();
        String::from_utf8(bytes)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn temporary_database() -> (std::path::PathBuf, std::path::PathBuf) {
        let directory = std::env::temp_dir().join(format!(
            "oxide-sqlite-worker-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let database = directory.join("app.db");
        let connection = Connection::open(&database).unwrap();
        connection
            .execute_batch("CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT, payload BLOB);")
            .unwrap();
        (directory, database)
    }

    #[test]
    fn handshake_open_parameterized_execute_query_metadata_and_backup() {
        let (directory, database) = temporary_database();
        let backup = directory.join("backup.db");
        let input = [
            request(1, WorkerOperation::Handshake),
            request(
                2,
                WorkerOperation::Open {
                    path: database.to_string_lossy().into(),
                    read_only: false,
                },
            ),
            request(
                3,
                WorkerOperation::Execute {
                    sql: "INSERT INTO items(name, payload) VALUES (?1, ?2)".into(),
                    parameters: vec![
                        WorkerParameter {
                            value: json!("alpha"),
                            data_type: Some("text".into()),
                        },
                        WorkerParameter {
                            value: json!("0x00ff"),
                            data_type: Some("blob".into()),
                        },
                    ],
                },
            ),
            request(
                4,
                WorkerOperation::Query {
                    sql: "SELECT id, name, payload FROM items WHERE name = ?1".into(),
                    parameters: vec![WorkerParameter {
                        value: json!("alpha"),
                        data_type: Some("text".into()),
                    }],
                    max_rows: Some(10),
                },
            ),
            request(
                5,
                WorkerOperation::Metadata {
                    request: MetadataRequest::Tables {
                        schema: "main".into(),
                    },
                },
            ),
            request(
                6,
                WorkerOperation::Backup {
                    destination: backup.to_string_lossy().into(),
                },
            ),
            request(7, WorkerOperation::Close),
        ]
        .concat();
        let responses = run_requests(input);
        assert_eq!(responses.len(), 7);
        assert!(matches!(
            responses[0].body,
            WorkerResponseBody::Handshake { .. }
        ));
        assert!(matches!(responses[1].body, WorkerResponseBody::Ok));
        assert!(matches!(
            responses[2].body,
            WorkerResponseBody::Result {
                rows_affected: 1,
                ..
            }
        ));
        match &responses[3].body {
            WorkerResponseBody::Result {
                rows, truncated, ..
            } => {
                assert_eq!(rows, &vec![vec![json!(1), json!("alpha"), json!("0x00ff")]]);
                assert!(!truncated);
            }
            other => panic!("unexpected query response: {other:?}"),
        }
        match &responses[4].body {
            WorkerResponseBody::Result { rows, .. } => {
                assert!(rows.iter().any(|row| row[0] == json!("items")))
            }
            other => panic!("unexpected metadata response: {other:?}"),
        }
        assert!(matches!(responses[5].body, WorkerResponseBody::File { .. }));
        assert!(backup.is_file());
        assert_eq!(
            Connection::open(&backup)
                .unwrap()
                .query_row("SELECT count(*) FROM items", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn backup_uses_the_committed_snapshot_during_an_immediate_transaction() {
        let (directory, database) = temporary_database();
        let backup = directory.join("pre-rebuild.db");
        let responses = run_requests(
            [
                request(
                    1,
                    WorkerOperation::Open {
                        path: database.to_string_lossy().into(),
                        read_only: false,
                    },
                ),
                request(
                    2,
                    WorkerOperation::Execute {
                        sql: "INSERT INTO items(name) VALUES ('committed')".into(),
                        parameters: vec![],
                    },
                ),
                request(
                    3,
                    WorkerOperation::Execute {
                        sql: "BEGIN IMMEDIATE".into(),
                        parameters: vec![],
                    },
                ),
                request(
                    4,
                    WorkerOperation::Backup {
                        destination: backup.to_string_lossy().into(),
                    },
                ),
                request(
                    5,
                    WorkerOperation::Execute {
                        sql: "INSERT INTO items(name) VALUES ('uncommitted')".into(),
                        parameters: vec![],
                    },
                ),
                request(
                    6,
                    WorkerOperation::Execute {
                        sql: "ROLLBACK".into(),
                        parameters: vec![],
                    },
                ),
                request(7, WorkerOperation::Close),
            ]
            .concat(),
        );

        assert!(matches!(responses[3].body, WorkerResponseBody::File { .. }));
        let backup_connection = Connection::open(&backup).unwrap();
        assert_eq!(
            backup_connection
                .query_row("SELECT count(*) FROM items", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            backup_connection
                .query_row("SELECT name FROM items", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "committed"
        );
        drop(backup_connection);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn execute_operation_accepts_foreign_key_pragma_assignments() {
        let (directory, database) = temporary_database();
        let responses = run_requests(
            [
                request(
                    1,
                    WorkerOperation::Open {
                        path: database.to_string_lossy().into(),
                        read_only: false,
                    },
                ),
                request(
                    2,
                    WorkerOperation::Execute {
                        sql: "PRAGMA foreign_keys = ON".into(),
                        parameters: vec![],
                    },
                ),
                request(
                    3,
                    WorkerOperation::Query {
                        sql: "PRAGMA foreign_keys".into(),
                        parameters: vec![],
                        max_rows: Some(1),
                    },
                ),
                request(4, WorkerOperation::Close),
            ]
            .concat(),
        );

        assert!(matches!(
            responses[1].body,
            WorkerResponseBody::Result { .. }
        ));
        match &responses[2].body {
            WorkerResponseBody::Result { rows, .. } => {
                assert_eq!(rows, &vec![vec![json!(1)]]);
            }
            other => panic!("unexpected foreign key pragma response: {other:?}"),
        }
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn read_only_open_rejects_writes_at_the_engine_boundary() {
        let (directory, database) = temporary_database();
        let responses = run_requests(
            [
                request(
                    1,
                    WorkerOperation::Open {
                        path: database.to_string_lossy().into(),
                        read_only: true,
                    },
                ),
                request(
                    2,
                    WorkerOperation::Execute {
                        sql: "INSERT INTO items(name) VALUES ('blocked')".into(),
                        parameters: vec![],
                    },
                ),
            ]
            .concat(),
        );
        assert!(matches!(
            responses[1].body,
            WorkerResponseBody::Error {
                code: WorkerErrorCode::ReadOnly,
                ..
            }
        ));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_relative_paths_protocol_mismatch_and_multiple_statements() {
        let bad_protocol = WorkerRequest {
            protocol_version: SQLITE_WORKER_PROTOCOL_VERSION + 1,
            id: 1,
            operation: WorkerOperation::Handshake,
        };
        let responses = run_requests(format!(
            "{}\n{}{}",
            serde_json::to_string(&bad_protocol).unwrap(),
            request(
                2,
                WorkerOperation::Open {
                    path: "relative.db".into(),
                    read_only: false
                }
            ),
            request(
                3,
                WorkerOperation::Query {
                    sql: "SELECT 1; SELECT 2".into(),
                    parameters: vec![],
                    max_rows: None
                }
            ),
        ));
        assert!(matches!(
            responses[0].body,
            WorkerResponseBody::Error {
                code: WorkerErrorCode::ProtocolMismatch,
                ..
            }
        ));
        assert!(matches!(
            responses[1].body,
            WorkerResponseBody::Error {
                code: WorkerErrorCode::FileInvalid,
                ..
            }
        ));
        assert!(matches!(
            responses[2].body,
            WorkerResponseBody::Error {
                code: WorkerErrorCode::NotOpen,
                ..
            }
        ));
    }

    #[test]
    fn quoted_semicolons_do_not_look_like_multiple_statements() {
        assert!(validate_single_statement("SELECT ';' AS value;").is_ok());
        assert!(validate_single_statement("SELECT 1; -- done").is_ok());
        assert!(validate_single_statement("SELECT 1; /* done */").is_ok());
        assert!(validate_single_statement("SELECT 1; SELECT 2").is_err());
    }

    #[test]
    fn trigger_bodies_are_accepted_but_trailing_statements_are_rejected_by_sqlite() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE TABLE users (id INTEGER); CREATE TABLE audit (id INTEGER);")
            .unwrap();
        let trigger = "CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN INSERT INTO audit(id) VALUES (NEW.id); UPDATE audit SET id = id WHERE id = NEW.id; END;";
        assert!(validate_single_statement(trigger).is_ok());
        assert!(matches!(
            execute(&connection, trigger, &[]),
            WorkerResponseBody::Result { .. }
        ));
        assert!(matches!(
            execute(
                &connection,
                "CREATE TRIGGER malicious AFTER INSERT ON users BEGIN SELECT NEW.id; END; DROP TABLE users;",
                &[],
            ),
            WorkerResponseBody::Error { .. }
        ));
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'users'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn rejects_remote_attach_extensions_and_sqlcipher_without_false_string_matches() {
        for sql in [
            "ATTACH DATABASE '/tmp/other.db' AS other",
            "DETACH DATABASE other",
            "SELECT load_extension('/tmp/example.so')",
            "PRAGMA key = 'secret'",
            "PRAGMA main.cipher_page_size = 4096",
        ] {
            assert!(validate_single_statement(sql).is_err(), "accepted {sql}");
        }
        assert!(
            validate_single_statement("SELECT 'attach load_extension pragma key' AS harmless")
                .is_ok()
        );
        assert!(validate_single_statement("/* attach */ SELECT 1 AS load_extension_name").is_ok());
    }

    #[test]
    fn interrupt_only_accepts_the_active_request_identity() {
        let active = Arc::new(Mutex::new(ActiveRequest::default()));
        assert!(!interrupt_active(&active, 4));
        let connection = Connection::open_in_memory().unwrap();
        let _cancelled = set_active(&active, 5, connection.get_interrupt_handle());
        assert!(!interrupt_active(&active, 4));
        assert!(interrupt_active(&active, 5));
        clear_active(&active, 5);
        assert!(!interrupt_active(&active, 5));
    }

    #[test]
    fn interrupt_stops_a_running_sqlite_statement() {
        let active = Arc::new(Mutex::new(ActiveRequest::default()));
        let worker_active = Arc::clone(&active);
        let worker = std::thread::spawn(move || {
            let mut connection = Some(Connection::open_in_memory().unwrap());
            handle_request(
                &mut connection,
                WorkerRequest::new(
                    41,
                    WorkerOperation::Query {
                        sql: "WITH RECURSIVE counter(value) AS (VALUES(1) UNION ALL SELECT value + 1 FROM counter WHERE value < 1000000000) SELECT sum(value) FROM counter".into(),
                        parameters: vec![],
                        max_rows: Some(1),
                    },
                ),
                &worker_active,
            )
        });

        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while active.lock().unwrap().id != Some(41) {
            assert!(
                std::time::Instant::now() < deadline,
                "query never became interruptible"
            );
            std::thread::yield_now();
        }
        assert!(interrupt_active(&active, 41));
        assert!(matches!(
            worker.join().unwrap(),
            WorkerResponseBody::Error {
                code: WorkerErrorCode::Interrupted,
                ..
            }
        ));
    }
}
