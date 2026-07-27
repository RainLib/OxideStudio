/// 查询执行相关 commands
use crate::core::{
    dialect::DatabaseKind,
    explain::{build_explain_statement, parse_explain_results},
    manager::ConnectionManager,
    parser::{CompletionContext, SqlParser},
    protocol::{ExplainPlan, ExplainPlanMode, QueryResult, Response},
    statement::{
        split_sql_statement_spans, split_sql_statements, validate_read_only_sql,
        StatementScanDialect,
    },
};
use serde::{Deserialize, Serialize};
use sqlparser::{
    dialect::{MySqlDialect, PostgreSqlDialect},
    parser::Parser,
};
use sqlx::error::{DatabaseError, ErrorKind};
use sqlx::mysql::MySqlDatabaseError;
use sqlx::postgres::{PgDatabaseError, PgErrorPosition};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::{oneshot, watch, Mutex as AsyncMutex};

const MAX_SQL_IMPORT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_CONSOLE_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_DATABASE_ERROR_IDENTIFIER_CHARS: usize = 512;
const MAX_SQL_SYNTAX_VALIDATION_CHARS: usize = 500_000;
const MAX_SQL_SYNTAX_DIAGNOSTIC_CHARS: usize = 1_000;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DatabaseErrorDiagnostic {
    driver: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    sql_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vendor_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    severity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    schema: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    column: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    constraint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
}

struct ExtractedDatabaseError {
    message: String,
    diagnostic: DatabaseErrorDiagnostic,
}

fn bounded_database_identifier(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        return None;
    }
    Some(
        value
            .chars()
            .take(MAX_DATABASE_ERROR_IDENTIFIER_CHARS)
            .collect(),
    )
}

fn database_error_kind(error: &(dyn DatabaseError + 'static)) -> Option<&'static str> {
    match error.kind() {
        ErrorKind::UniqueViolation => Some("uniqueViolation"),
        ErrorKind::ForeignKeyViolation => Some("foreignKeyViolation"),
        ErrorKind::NotNullViolation => Some("notNullViolation"),
        ErrorKind::CheckViolation => Some("checkViolation"),
        ErrorKind::Other => None,
        _ => None,
    }
}

fn extracted_database_error(error: &anyhow::Error) -> Option<ExtractedDatabaseError> {
    let sqlx_error = error.downcast_ref::<sqlx::Error>()?;
    let database_error = sqlx_error.as_database_error()?;
    let kind = database_error_kind(database_error);

    if let Some(postgres) = database_error.try_downcast_ref::<PgDatabaseError>() {
        return Some(ExtractedDatabaseError {
            message: postgres.message().to_string(),
            diagnostic: DatabaseErrorDiagnostic {
                driver: "postgres",
                sql_state: Some(postgres.code().to_string()),
                vendor_code: None,
                severity: Some(format!("{:?}", postgres.severity()).to_ascii_uppercase()),
                position: match postgres.position() {
                    Some(PgErrorPosition::Original(position)) => Some(position),
                    // Never expose the server-generated internal query.
                    Some(PgErrorPosition::Internal { .. }) | None => None,
                },
                schema: bounded_database_identifier(postgres.schema()),
                table: bounded_database_identifier(postgres.table()),
                column: bounded_database_identifier(postgres.column()),
                constraint: bounded_database_identifier(postgres.constraint()),
                data_type: bounded_database_identifier(postgres.data_type()),
                kind,
            },
        });
    }

    if let Some(mysql) = database_error.try_downcast_ref::<MySqlDatabaseError>() {
        return Some(ExtractedDatabaseError {
            message: mysql.message().to_string(),
            diagnostic: DatabaseErrorDiagnostic {
                driver: "mysql",
                sql_state: mysql.code().map(str::to_string),
                vendor_code: Some(mysql.number()),
                severity: None,
                position: None,
                schema: None,
                table: None,
                column: None,
                constraint: None,
                data_type: None,
                kind,
            },
        });
    }

    Some(ExtractedDatabaseError {
        message: database_error.message().to_string(),
        diagnostic: DatabaseErrorDiagnostic {
            driver: "database",
            sql_state: database_error.code().map(|value| value.into_owned()),
            vendor_code: None,
            severity: None,
            position: None,
            schema: None,
            table: bounded_database_identifier(database_error.table()),
            column: None,
            constraint: bounded_database_identifier(database_error.constraint()),
            data_type: None,
            kind,
        },
    })
}

fn query_error_context(
    mut query_context: serde_json::Value,
    diagnostic: Option<&DatabaseErrorDiagnostic>,
) -> serde_json::Value {
    if let (Some(context), Some(diagnostic)) = (query_context.as_object_mut(), diagnostic) {
        context.insert(
            "databaseError".to_string(),
            serde_json::to_value(diagnostic)
                .expect("database error diagnostics should always serialize"),
        );
    }
    query_context
}

/// SQL Parser 状态
pub struct ParserState(pub Mutex<SqlParser>);

pub struct QueryCancellationHandle {
    pub connection_id: String,
    pub sender: watch::Sender<bool>,
}

#[derive(Default)]
pub struct QueryCancellationState(pub Arc<AsyncMutex<HashMap<String, QueryCancellationHandle>>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainQueryRequest {
    pub connection_id: String,
    pub sql: String,
    pub schema: Option<String>,
    pub database: Option<String>,
    pub query_id: String,
    pub mode: ExplainPlanMode,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSqlScriptResult {
    pub file_path: String,
    pub statements_executed: u64,
    pub rows_affected: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleFileImportResult {
    pub file_path: String,
    pub file_name: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleFileExportResult {
    pub exported: bool,
    pub file_path: Option<String>,
    pub byte_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlStatementSelection {
    pub sql: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub statement_index: usize,
    pub statement_count: usize,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SqlSyntaxDiagnostic {
    pub severity: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SqlSyntaxValidation {
    pub valid: bool,
    pub driver: &'static str,
    pub statement_count: usize,
    pub diagnostics: Vec<SqlSyntaxDiagnostic>,
}

fn bounded_syntax_diagnostic(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("sql parser error:")
        .trim()
        .chars()
        .filter(|character| !character.is_control() || character.is_whitespace())
        .take(MAX_SQL_SYNTAX_DIAGNOSTIC_CHARS)
        .collect()
}

fn syntax_diagnostic(error: impl ToString) -> SqlSyntaxDiagnostic {
    let message = bounded_syntax_diagnostic(&error.to_string());
    let marker = " at Line: ";
    let (message, line, column) = message
        .rfind(marker)
        .and_then(|marker_index| {
            let location = &message[marker_index + marker.len()..];
            let (line, column) = location.split_once(", Column: ")?;
            Some((
                message[..marker_index].trim().to_string(),
                line.parse::<u64>().ok(),
                column.parse::<u64>().ok(),
            ))
        })
        .unwrap_or((message, None, None));

    SqlSyntaxDiagnostic {
        severity: "error",
        message,
        line,
        column,
    }
}

fn validate_sql_syntax_text(driver: &str, sql: &str) -> Result<SqlSyntaxValidation, String> {
    let kind = DatabaseKind::from_str(driver).map_err(|error| error.to_string())?;
    if sql.chars().count() > MAX_SQL_SYNTAX_VALIDATION_CHARS {
        return Err(format!(
            "SQL syntax validation is limited to {MAX_SQL_SYNTAX_VALIDATION_CHARS} characters"
        ));
    }
    if sql.trim().is_empty() {
        return Ok(SqlSyntaxValidation {
            valid: false,
            driver: kind.as_str(),
            statement_count: 0,
            diagnostics: vec![SqlSyntaxDiagnostic {
                severity: "error",
                message: "Enter at least one SQL statement.".to_string(),
                line: Some(1),
                column: Some(1),
            }],
        });
    }

    let parsed = match kind {
        DatabaseKind::Postgres => Parser::parse_sql(&PostgreSqlDialect {}, sql),
        DatabaseKind::Mysql => Parser::parse_sql(&MySqlDialect {}, sql),
    };
    match parsed {
        Ok(statements) => Ok(SqlSyntaxValidation {
            valid: true,
            driver: kind.as_str(),
            statement_count: statements.len(),
            diagnostics: Vec::new(),
        }),
        Err(error) => Ok(SqlSyntaxValidation {
            valid: false,
            driver: kind.as_str(),
            statement_count: 0,
            diagnostics: vec![syntax_diagnostic(error)],
        }),
    }
}

fn utf16_offset_to_byte_offset(value: &str, utf16_offset: usize) -> usize {
    let mut consumed_utf16 = 0;
    for (byte_offset, character) in value.char_indices() {
        if consumed_utf16 >= utf16_offset {
            return byte_offset;
        }
        let next_utf16 = consumed_utf16 + character.len_utf16();
        if next_utf16 > utf16_offset {
            return byte_offset;
        }
        consumed_utf16 = next_utf16;
    }
    value.len()
}

fn byte_offset_to_utf16_offset(value: &str, byte_offset: usize) -> usize {
    value[..byte_offset.min(value.len())].encode_utf16().count()
}

fn sql_statement_at_cursor(
    sql: &str,
    dialect: StatementScanDialect,
    cursor_utf16_offset: usize,
) -> Option<SqlStatementSelection> {
    let statements = split_sql_statement_spans(sql, dialect);
    if statements.is_empty() {
        return None;
    }
    let cursor_byte_offset = utf16_offset_to_byte_offset(sql, cursor_utf16_offset);
    let statement_index = statements
        .iter()
        .position(|statement| {
            cursor_byte_offset >= statement.start && cursor_byte_offset <= statement.end
        })
        .or_else(|| {
            statements
                .iter()
                .position(|statement| statement.start > cursor_byte_offset)
        })
        .unwrap_or(statements.len() - 1);
    let statement = statements[statement_index];
    Some(SqlStatementSelection {
        sql: statement.text.to_string(),
        start_offset: byte_offset_to_utf16_offset(sql, statement.start),
        end_offset: byte_offset_to_utf16_offset(sql, statement.end),
        statement_index,
        statement_count: statements.len(),
    })
}

impl QueryCancellationState {
    async fn register(
        &self,
        query_id: &str,
        connection_id: &str,
    ) -> Result<watch::Receiver<bool>, String> {
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let mut handles = self.0.lock().await;
        if handles.contains_key(query_id) {
            return Err(format!("Query already active: {query_id}"));
        }

        handles.insert(
            query_id.to_string(),
            QueryCancellationHandle {
                connection_id: connection_id.to_string(),
                sender: cancel_tx,
            },
        );
        Ok(cancel_rx)
    }

    async fn take(&self, query_id: &str) -> Option<QueryCancellationHandle> {
        self.0.lock().await.remove(query_id)
    }
}

/// 执行 SQL 查询
#[tauri::command]
// The command parameters are the stable frontend IPC contract.
#[allow(clippy::too_many_arguments)]
pub async fn execute_query(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, QueryCancellationState>,
    connection_id: String,
    sql: String,
    schema: Option<String>,
    transaction_id: Option<String>,
    query_id: Option<String>,
    database: Option<String>,
) -> Result<Response<Vec<QueryResult>>, String> {
    println!("Executing query on connection: {}", connection_id);

    execute_query_with_cancellation(
        &manager,
        &cancellation,
        connection_id,
        sql,
        schema,
        transaction_id,
        query_id,
        database,
    )
    .await
}

/// Resolve the SQL statement under the Monaco cursor using the same
/// dialect-aware scanner used by backend script execution. Monaco offsets are
/// UTF-16 code units, so the IPC boundary converts them explicitly instead of
/// treating them as Rust UTF-8 byte offsets.
#[tauri::command]
pub async fn resolve_sql_statement_at_cursor(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    sql: String,
    cursor_offset: usize,
) -> Result<Response<Option<SqlStatementSelection>>, String> {
    let dialect = match manager.statement_scan_dialect(&connection_id).await {
        Ok(Some(dialect)) => dialect,
        Ok(None) => {
            return Ok(Response::err(
                "SQL_STATEMENT_RESOLUTION_UNAVAILABLE",
                "Statement-at-cursor execution is only available for SQL data sources",
            ));
        }
        Err(error) => {
            return Ok(Response::err_with_details(
                "SQL_STATEMENT_RESOLUTION_FAILED",
                &error.to_string(),
                true,
                Some(serde_json::json!({ "connectionId": connection_id })),
            ));
        }
    };

    Ok(Response::ok(sql_statement_at_cursor(
        &sql,
        dialect,
        cursor_offset,
    )))
}

/// Parse SQL with the selected vendor dialect without opening a transaction or
/// sending anything to a database. Patch review uses this command against the
/// virtual post-patch document before the user decides whether to apply it.
#[tauri::command]
pub fn validate_sql_syntax(
    driver: String,
    sql: String,
) -> Result<Response<SqlSyntaxValidation>, String> {
    match validate_sql_syntax_text(&driver, &sql) {
        Ok(validation) => Ok(Response::ok(validation)),
        Err(error) => Ok(Response::err("SQL_SYNTAX_VALIDATION_UNAVAILABLE", &error)),
    }
}

#[tauri::command]
pub async fn import_sql_script(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    file_path: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Response<ImportSqlScriptResult>, String> {
    let result: Result<ImportSqlScriptResult, String> = async {
        let path = PathBuf::from(file_path.trim());
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("sql"))
        {
            return Err("Select a .sql script to import".to_string());
        }
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err("The selected SQL import path is not a file".to_string());
        }
        if metadata.len() > MAX_SQL_IMPORT_BYTES {
            return Err(format!(
                "SQL import files are limited to {} MB",
                MAX_SQL_IMPORT_BYTES / 1024 / 1024
            ));
        }
        let sql = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let dialect = manager
            .statement_scan_dialect(&connection_id)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                "SQL script import is only available for SQL data sources".to_string()
            })?;
        let statements = split_sql_statements(&sql, dialect);
        if statements.is_empty() {
            return Err(
                "The selected SQL script does not contain executable statements".to_string(),
            );
        }

        let results = match database.as_deref().filter(|value| !value.trim().is_empty()) {
            Some(database) => {
                manager
                    .query_database_with_context(
                        &connection_id,
                        database,
                        &sql,
                        schema.as_deref(),
                        None,
                    )
                    .await
            }
            None => {
                manager
                    .query(
                        &connection_id,
                        &sql,
                        schema.filter(|value| !value.trim().is_empty()),
                        None,
                        None,
                    )
                    .await
            }
        }
        .map_err(|error| error.to_string())?;

        Ok(ImportSqlScriptResult {
            file_path: path.display().to_string(),
            statements_executed: statements.len() as u64,
            rows_affected: results
                .iter()
                .filter_map(|result| result.rows_affected)
                .sum(),
        })
    }
    .await;

    match result {
        Ok(imported) => Ok(Response::ok(imported)),
        Err(error) => Ok(Response::err("IMPORT_SQL_SCRIPT_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn import_elasticsearch_console_file(
    app: AppHandle,
) -> Result<Response<Option<ConsoleFileImportResult>>, String> {
    let (sender, receiver) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Elasticsearch Console", &["txt", "es", "esdsl", "json"])
        .set_title("Import Elasticsearch Console requests")
        .pick_file(move |selection| {
            let _ = sender.send(selection);
        });
    let selection = receiver
        .await
        .map_err(|_| "Elasticsearch Console import dialog closed unexpectedly".to_string())?;
    let Some(selection) = selection else {
        return Ok(Response::ok(None));
    };
    let path = selection
        .into_path()
        .map_err(|_| "The selected Console import is not a local file".to_string())?;
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|error| format!("Unable to inspect the selected Console file: {error}"))?;
    if !metadata.is_file() {
        return Ok(Response::err(
            "ELASTICSEARCH_CONSOLE_IMPORT_ERROR",
            "The selected Console import path is not a file",
        ));
    }
    if metadata.len() > MAX_CONSOLE_FILE_BYTES {
        return Ok(Response::err(
            "ELASTICSEARCH_CONSOLE_IMPORT_ERROR",
            &format!(
                "Elasticsearch Console imports are limited to {} MB",
                MAX_CONSOLE_FILE_BYTES / 1024 / 1024
            ),
        ));
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| format!("Unable to read the selected Console file: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Elasticsearch Console")
        .to_string();

    Ok(Response::ok(Some(ConsoleFileImportResult {
        file_path: path.to_string_lossy().into_owned(),
        file_name,
        content,
    })))
}

#[tauri::command]
pub async fn export_elasticsearch_console_file(
    app: AppHandle,
    content: String,
) -> Result<Response<ConsoleFileExportResult>, String> {
    if content.len() as u64 > MAX_CONSOLE_FILE_BYTES {
        return Ok(Response::err(
            "ELASTICSEARCH_CONSOLE_EXPORT_ERROR",
            &format!(
                "Elasticsearch Console exports are limited to {} MB",
                MAX_CONSOLE_FILE_BYTES / 1024 / 1024
            ),
        ));
    }

    let (sender, receiver) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Elasticsearch Console", &["txt"])
        .set_title("Export Elasticsearch Console requests")
        .set_file_name("elasticsearch-console.txt")
        .save_file(move |selection| {
            let _ = sender.send(selection);
        });
    let selection = receiver
        .await
        .map_err(|_| "Elasticsearch Console export dialog closed unexpectedly".to_string())?;
    let Some(selection) = selection else {
        return Ok(Response::ok(ConsoleFileExportResult {
            exported: false,
            file_path: None,
            byte_count: 0,
        }));
    };
    let path = selection
        .into_path()
        .map_err(|_| "The selected Console export destination is not a local file".to_string())?;
    tokio::fs::write(&path, content.as_bytes())
        .await
        .map_err(|error| format!("Unable to export Elasticsearch Console requests: {error}"))?;

    Ok(Response::ok(ConsoleFileExportResult {
        exported: true,
        file_path: Some(path.to_string_lossy().into_owned()),
        byte_count: content.len(),
    }))
}

/// Execute one assistant-approved SQL read behind a backend-enforced read-only
/// transaction. This command intentionally does not accept transaction ids.
#[tauri::command]
pub async fn execute_read_only_query(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, QueryCancellationState>,
    connection_id: String,
    sql: String,
    schema: Option<String>,
    query_id: Option<String>,
) -> Result<Response<Vec<QueryResult>>, String> {
    let query_context = serde_json::json!({
        "connectionId": connection_id,
        "schema": schema,
        "queryId": query_id,
    });
    let dialect = match manager.statement_scan_dialect(&connection_id).await {
        Ok(Some(dialect)) => dialect,
        Ok(None) => {
            return Ok(Response::err_with_details(
                "READ_ONLY_QUERY_UNSUPPORTED",
                "Read-only SQL execution is unsupported for this driver",
                false,
                Some(query_context),
            ));
        }
        Err(error) => {
            return Ok(Response::err_with_details(
                "QUERY_TARGET_RESOLUTION_FAILED",
                &error.to_string(),
                true,
                Some(query_context),
            ));
        }
    };
    let kind = match dialect {
        StatementScanDialect::Postgres => DatabaseKind::Postgres,
        StatementScanDialect::Mysql => DatabaseKind::Mysql,
    };
    if let Err(reason) = validate_read_only_sql(&sql, dialect) {
        return Ok(Response::err_with_details(
            "READ_ONLY_QUERY_REJECTED",
            reason,
            false,
            Some(query_context),
        ));
    }

    let script = read_only_transaction_script(kind, &sql);
    let mut response = execute_query_with_cancellation(
        &manager,
        &cancellation,
        connection_id,
        script,
        schema,
        None,
        query_id,
        None,
    )
    .await?;
    if let Some(results) = response.data.take() {
        response.data = Some(strip_read_only_transaction_results(results));
    }
    Ok(response)
}

/// Build and execute a driver-specific Explain Plan behind the same
/// backend-enforced read-only transaction and cancellation path as AI reads.
/// The source query is validated before the EXPLAIN prefix is generated, so a
/// frontend cannot smuggle transaction control or mutations into the plan.
#[tauri::command]
pub async fn explain_query(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, QueryCancellationState>,
    request: ExplainQueryRequest,
) -> Result<Response<ExplainPlan>, String> {
    let query_id = request.query_id.trim().to_string();
    let database = request.database.filter(|value| !value.trim().is_empty());
    let schema = request.schema.filter(|value| !value.trim().is_empty());
    let context = serde_json::json!({
        "connectionId": request.connection_id,
        "database": database,
        "schema": schema,
        "queryId": query_id,
        "mode": request.mode,
    });
    if query_id.is_empty() {
        return Ok(Response::err_with_details(
            "EXPLAIN_QUERY_ID_REQUIRED",
            "Explain Plan requires a query id for cancellation and stable navigation",
            false,
            Some(context),
        ));
    }

    let dialect = match manager.statement_scan_dialect(&request.connection_id).await {
        Ok(Some(dialect)) => dialect,
        Ok(None) => {
            return Ok(Response::err_with_details(
                "EXPLAIN_UNSUPPORTED",
                "Explain Plan is unsupported for this driver",
                false,
                Some(context),
            ));
        }
        Err(error) => {
            return Ok(Response::err_with_details(
                "EXPLAIN_TARGET_RESOLUTION_FAILED",
                &error.to_string(),
                true,
                Some(context),
            ));
        }
    };
    let kind = match dialect {
        StatementScanDialect::Postgres => DatabaseKind::Postgres,
        StatementScanDialect::Mysql => DatabaseKind::Mysql,
    };
    let (explain_sql, format) = match build_explain_statement(&request.sql, kind, request.mode) {
        Ok(statement) => statement,
        Err(error) => {
            return Ok(Response::err_with_details(
                "EXPLAIN_QUERY_REJECTED",
                &error.to_string(),
                false,
                Some(context),
            ));
        }
    };

    let started_at = Instant::now();
    let script = read_only_transaction_script(kind, &explain_sql);
    let mut response = execute_query_with_cancellation(
        &manager,
        &cancellation,
        request.connection_id,
        script,
        schema,
        None,
        Some(query_id.clone()),
        database,
    )
    .await?;
    if let Some(error) = response.error.take() {
        let code = if error.code == "QUERY_CANCELLED" {
            "QUERY_CANCELLED"
        } else {
            "EXPLAIN_EXECUTION_FAILED"
        };
        return Ok(Response::err_with_details(
            code,
            &error.message,
            error.retryable,
            Some(context),
        ));
    }

    let results = strip_read_only_transaction_results(response.data.take().unwrap_or_default());
    match parse_explain_results(
        query_id,
        kind,
        request.mode,
        format,
        started_at.elapsed().as_secs_f64() * 1_000.0,
        &results,
    ) {
        Ok(plan) => Ok(Response::ok(plan)),
        Err(error) => Ok(Response::err_with_details(
            "EXPLAIN_PLAN_PARSE_FAILED",
            &error.to_string(),
            false,
            Some(context),
        )),
    }
}

fn read_only_transaction_script(kind: DatabaseKind, sql: &str) -> String {
    let begin = match kind {
        DatabaseKind::Postgres => "BEGIN READ ONLY;",
        DatabaseKind::Mysql => "START TRANSACTION READ ONLY;",
    };
    format!("{begin}\n{}\n;\nROLLBACK;", sql.trim())
}

fn strip_read_only_transaction_results(mut results: Vec<QueryResult>) -> Vec<QueryResult> {
    let first = results
        .first()
        .and_then(|result| result.statement_type.as_deref());
    let last = results
        .last()
        .and_then(|result| result.statement_type.as_deref());
    if first.is_some_and(|kind| {
        kind.eq_ignore_ascii_case("BEGIN") || kind.eq_ignore_ascii_case("START")
    }) && last.is_some_and(|kind| kind.eq_ignore_ascii_case("ROLLBACK"))
    {
        results.remove(0);
        results.pop();
    }
    results
}

// Keep the execution inputs aligned with `execute_query` so the read-only
// wrapper can reuse the exact same cancellation and database routing path.
#[allow(clippy::too_many_arguments)]
async fn execute_query_with_cancellation(
    manager: &ConnectionManager,
    cancellation: &QueryCancellationState,
    connection_id: String,
    sql: String,
    schema: Option<String>,
    transaction_id: Option<String>,
    query_id: Option<String>,
    database: Option<String>,
) -> Result<Response<Vec<QueryResult>>, String> {
    let database = database.filter(|value| !value.trim().is_empty());
    let query_context = serde_json::json!({
        "connectionId": connection_id,
        "database": database,
        "schema": schema,
        "queryId": query_id,
    });
    if database.is_some()
        && transaction_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        return Ok(Response::err_with_details(
            "CROSS_DATABASE_TRANSACTION_UNSUPPORTED",
            "Manual transactions are unavailable for a PostgreSQL database selected through the editor.",
            false,
            Some(query_context),
        ));
    }
    let query_id = query_id.filter(|value| !value.trim().is_empty());
    let mut cancel_rx = if let Some(query_id) = query_id.as_ref() {
        match cancellation.register(query_id, &connection_id).await {
            Ok(cancel_rx) => Some(cancel_rx),
            Err(error) => {
                return Ok(Response::err_with_details(
                    "DUPLICATE_QUERY_ID",
                    &error,
                    false,
                    Some(query_context),
                ));
            }
        }
    } else {
        None
    };

    let execute = || async {
        if let Some(database) = database.as_deref() {
            manager
                .query_database_with_context(
                    &connection_id,
                    database,
                    &sql,
                    schema.as_deref(),
                    query_id.as_deref(),
                )
                .await
        } else {
            manager
                .query(
                    &connection_id,
                    &sql,
                    schema.clone(),
                    transaction_id.clone(),
                    query_id.clone(),
                )
                .await
        }
    };

    let result = if let Some(cancel_rx) = cancel_rx.as_mut() {
        tokio::select! {
            result = execute() => {
                result.map(Response::ok)
            }
            _ = cancel_rx.changed() => {
                Ok(Response::err_with_details(
                    "QUERY_CANCELLED",
                    "Query cancelled",
                    false,
                    Some(query_context.clone()),
                ))
            }
        }
    } else {
        execute().await.map(Response::ok)
    };

    if let Some(query_id) = query_id {
        cancellation.take(&query_id).await;
    }

    match result {
        Ok(response) => Ok(response),
        Err(error) => {
            let database_error = extracted_database_error(&error);
            let message = database_error
                .as_ref()
                .map(|error| error.message.clone())
                .unwrap_or_else(|| error.to_string());
            if message.starts_with("Connection not found:") {
                Ok(Response::err_with_details(
                    "CONNECTION_SESSION_NOT_FOUND",
                    "The saved data source is available, but its live connection session is not active.",
                    true,
                    Some(query_context),
                ))
            } else {
                Ok(Response::err_with_details(
                    "QUERY_EXECUTION_FAILED",
                    &message,
                    false,
                    Some(query_error_context(
                        query_context,
                        database_error.as_ref().map(|error| &error.diagnostic),
                    )),
                ))
            }
        }
    }
}

#[tauri::command]
pub async fn cancel_query(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, QueryCancellationState>,
    query_id: String,
) -> Result<Response<String>, String> {
    let handle = cancellation.take(&query_id).await;

    if let Some(handle) = handle {
        let backend_cancelled = match manager.cancel_query(&handle.connection_id, &query_id).await {
            Ok(cancelled) => cancelled,
            Err(error) => {
                tracing::warn!(
                    "Failed to cancel query {} on database backend: {}",
                    query_id,
                    error
                );
                false
            }
        };
        let _ = handle.sender.send(true);
        let message = if backend_cancelled {
            "Query cancellation requested on database backend"
        } else {
            "Query cancellation requested"
        };
        Ok(Response::ok(message.to_string()))
    } else {
        Ok(Response::err_with_details(
            "QUERY_NOT_FOUND",
            &format!("Query not found or already finished: {query_id}"),
            false,
            Some(serde_json::json!({ "queryId": query_id })),
        ))
    }
}

/// 获取 SQL 自动完成建议
#[tauri::command]
pub async fn get_sql_completion(
    parser_state: State<'_, ParserState>,
    sql: String,
    cursor: usize,
) -> Result<Response<CompletionContext>, String> {
    tracing::debug!(
        cursor,
        sql_length = sql.len(),
        "get_sql_completion command called"
    );

    let mut parser = match parser_state.0.lock() {
        Ok(parser) => parser,
        Err(error) => {
            let message = format!("Failed to lock parser: {error}");
            tracing::error!("{message}");
            return Ok(Response::err_with_details(
                "SQL_COMPLETION_UNAVAILABLE",
                &message,
                true,
                Some(serde_json::json!({ "cursor": cursor })),
            ));
        }
    };

    tracing::debug!("SQL parser locked successfully");

    // 使用正确的方法名: parse_and_get_context
    let context = parser.parse_and_get_context(&sql, cursor);

    tracing::debug!(?context, "SQL completion context resolved");

    Ok(Response::ok(context))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::borrow::Cow;
    use std::error::Error as StdError;
    use std::fmt;

    #[derive(Debug)]
    struct MockDatabaseError;

    impl fmt::Display for MockDatabaseError {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("duplicate row")
        }
    }

    impl StdError for MockDatabaseError {}

    impl DatabaseError for MockDatabaseError {
        fn message(&self) -> &str {
            "duplicate row"
        }

        fn code(&self) -> Option<Cow<'_, str>> {
            Some(Cow::Borrowed("23505"))
        }

        fn as_error(&self) -> &(dyn StdError + Send + Sync + 'static) {
            self
        }

        fn as_error_mut(&mut self) -> &mut (dyn StdError + Send + Sync + 'static) {
            self
        }

        fn into_error(self: Box<Self>) -> Box<dyn StdError + Send + Sync + 'static> {
            self
        }

        fn constraint(&self) -> Option<&str> {
            Some("users_email_key")
        }

        fn table(&self) -> Option<&str> {
            Some("users")
        }

        fn kind(&self) -> ErrorKind {
            ErrorKind::UniqueViolation
        }
    }

    #[tokio::test]
    async fn cancellation_state_rejects_duplicate_query_ids() {
        let state = QueryCancellationState::default();

        let _first = state
            .register("query-1", "connection-1")
            .await
            .expect("first query id should register");
        let duplicate = state.register("query-1", "connection-2").await;

        assert!(duplicate.is_err());
        assert!(state.take("query-1").await.is_some());
        assert!(state.register("query-1", "connection-2").await.is_ok());
    }

    #[test]
    fn cursor_offset_conversion_matches_monaco_for_non_bmp_text() {
        let sql = "SELECT '🚀中文'; UPDATE t SET v = 1";
        let update_byte_offset = sql.find("UPDATE").expect("UPDATE should be present");
        let update_utf16_offset = sql[..update_byte_offset].encode_utf16().count();

        assert_eq!(
            utf16_offset_to_byte_offset(sql, update_utf16_offset),
            update_byte_offset
        );
        assert_eq!(
            byte_offset_to_utf16_offset(sql, update_byte_offset),
            update_utf16_offset
        );
    }

    #[test]
    fn statement_at_cursor_uses_utf16_offsets_and_driver_lexing() {
        let sql = "SELECT '🚀;';\n-- next\nSELECT 2;";
        let cursor = sql[..sql.find('2').unwrap()].encode_utf16().count();
        let selected =
            sql_statement_at_cursor(sql, StatementScanDialect::Postgres, cursor).unwrap();

        assert_eq!(selected.sql, "-- next\nSELECT 2");
        assert_eq!(selected.statement_index, 1);
        assert_eq!(selected.statement_count, 2);
        assert_eq!(
            &sql[utf16_offset_to_byte_offset(sql, selected.start_offset)
                ..utf16_offset_to_byte_offset(sql, selected.end_offset)],
            selected.sql
        );
    }

    #[test]
    fn syntax_validation_uses_the_requested_vendor_dialect_without_execution() {
        let postgres = validate_sql_syntax_text(
            "postgresql",
            "SELECT payload->>'name' FROM events; SELECT 2;",
        )
        .expect("PostgreSQL should be supported");
        assert!(postgres.valid);
        assert_eq!(postgres.driver, "postgres");
        assert_eq!(postgres.statement_count, 2);
        assert!(postgres.diagnostics.is_empty());

        let mysql = validate_sql_syntax_text("mariadb", "SELECT `name` FROM `users` LIMIT 1;")
            .expect("MySQL should be supported");
        assert!(mysql.valid);
        assert_eq!(mysql.driver, "mysql");
        assert_eq!(mysql.statement_count, 1);
    }

    #[test]
    fn syntax_validation_returns_bounded_structured_diagnostics() {
        let invalid = validate_sql_syntax_text("postgres", "SELECT ( FROM users")
            .expect("invalid syntax is a validation result");
        assert!(!invalid.valid);
        assert_eq!(invalid.statement_count, 0);
        assert_eq!(invalid.diagnostics.len(), 1);
        assert!(!invalid.diagnostics[0].message.contains("sql parser error"));
        assert_eq!(invalid.diagnostics[0].line, Some(1));
        assert!(invalid.diagnostics[0].column.is_some());

        let empty =
            validate_sql_syntax_text("mysql", " \n").expect("empty SQL is a validation result");
        assert!(!empty.valid);
        assert_eq!(empty.diagnostics[0].line, Some(1));
        assert!(validate_sql_syntax_text("redis", "GET key").is_err());
    }

    #[test]
    fn read_only_script_uses_driver_transaction_and_hides_control_results() {
        assert_eq!(
            read_only_transaction_script(DatabaseKind::Postgres, "SELECT 1"),
            "BEGIN READ ONLY;\nSELECT 1\n;\nROLLBACK;"
        );
        assert_eq!(
            read_only_transaction_script(DatabaseKind::Mysql, "SELECT 1;"),
            "START TRANSACTION READ ONLY;\nSELECT 1;\n;\nROLLBACK;"
        );

        let results = vec![
            QueryResult::execution("BEGIN", 0),
            QueryResult::rows(Vec::new(), vec![vec![serde_json::json!(1)]]),
            QueryResult::execution("ROLLBACK", 0),
        ];
        let stripped = strip_read_only_transaction_results(results);
        assert_eq!(stripped.len(), 1);
        assert_eq!(stripped[0].rows, vec![vec![serde_json::json!(1)]]);
    }

    #[test]
    fn generic_database_errors_preserve_only_safe_diagnostic_fields() {
        let error = anyhow::Error::new(sqlx::Error::database(MockDatabaseError));
        let extracted = extracted_database_error(&error).expect("database error");
        let context = query_error_context(
            serde_json::json!({
                "connectionId": "connection-1",
                "queryId": "query-1"
            }),
            Some(&extracted.diagnostic),
        );

        assert_eq!(extracted.message, "duplicate row");
        assert_eq!(
            context["databaseError"],
            serde_json::json!({
                "driver": "database",
                "sqlState": "23505",
                "table": "users",
                "constraint": "users_email_key",
                "kind": "uniqueViolation"
            })
        );
        assert!(context.get("sql").is_none());
        assert!(context.get("connectionString").is_none());
    }

    #[test]
    fn database_error_identifiers_reject_control_characters_and_are_bounded() {
        assert_eq!(
            bounded_database_identifier(Some(" public ")),
            Some("public".into())
        );
        assert_eq!(bounded_database_identifier(Some("unsafe\nname")), None);
        assert_eq!(
            bounded_database_identifier(Some(&"a".repeat(600)))
                .expect("bounded identifier")
                .chars()
                .count(),
            MAX_DATABASE_ERROR_IDENTIFIER_CHARS
        );
    }
}
