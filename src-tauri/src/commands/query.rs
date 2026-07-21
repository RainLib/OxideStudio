/// 查询执行相关 commands
use crate::core::{
    dialect::DatabaseKind,
    explain::{build_explain_statement, parse_explain_results},
    manager::ConnectionManager,
    parser::{CompletionContext, SqlParser},
    protocol::{ExplainPlan, ExplainPlanMode, QueryResult, Response},
    statement::{split_sql_statements, validate_read_only_sql, StatementScanDialect},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::{oneshot, watch, Mutex as AsyncMutex};

const MAX_SQL_IMPORT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_CONSOLE_FILE_BYTES: u64 = 16 * 1024 * 1024;

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
            let message = error.to_string();
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
                    Some(query_context),
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
}
