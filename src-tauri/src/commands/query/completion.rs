/// 查询执行相关 commands
use crate::core::{manager::ConnectionManager, parser::CompletionContext, protocol::Response};
use tauri::State;

use super::state::{ParserState, QueryCancellationState};

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
