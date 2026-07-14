/// 查询执行相关 commands
use crate::core::{
    dialect::DatabaseKind,
    manager::ConnectionManager,
    parser::{CompletionContext, SqlParser},
    protocol::{QueryResult, Response},
    statement::{validate_read_only_sql, StatementScanDialect},
};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::State;
use tokio::sync::{watch, Mutex as AsyncMutex};

/// SQL Parser 状态
pub struct ParserState(pub Mutex<SqlParser>);

pub struct QueryCancellationHandle {
    pub connection_id: String,
    pub sender: watch::Sender<bool>,
}

#[derive(Default)]
pub struct QueryCancellationState(pub Arc<AsyncMutex<HashMap<String, QueryCancellationHandle>>>);

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
        Err(error) => Ok(Response::err_with_details(
            "QUERY_EXECUTION_FAILED",
            &error.to_string(),
            false,
            Some(query_context),
        )),
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
