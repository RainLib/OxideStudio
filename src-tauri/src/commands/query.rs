/// 查询执行相关 commands
use crate::core::{
    manager::ConnectionManager,
    parser::{CompletionContext, SqlParser},
    protocol::{QueryResult, Response},
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
pub async fn execute_query(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, QueryCancellationState>,
    connection_id: String,
    sql: String,
    schema: Option<String>,
    transaction_id: Option<String>,
    query_id: Option<String>,
) -> Result<Response<Vec<QueryResult>>, String> {
    println!("Executing query on connection: {}", connection_id);

    let query_id = query_id.filter(|value| !value.trim().is_empty());
    let mut cancel_rx = if let Some(query_id) = query_id.as_ref() {
        match cancellation.register(query_id, &connection_id).await {
            Ok(cancel_rx) => Some(cancel_rx),
            Err(error) => {
                return Ok(Response::err("DUPLICATE_QUERY_ID", &error));
            }
        }
    } else {
        None
    };

    let result = if let Some(cancel_rx) = cancel_rx.as_mut() {
        tokio::select! {
            result = manager.query(&connection_id, &sql, schema, transaction_id, query_id.clone()) => {
                result.map(Response::ok)
            }
            _ = cancel_rx.changed() => {
                Ok(Response::err("QUERY_CANCELLED", "Query cancelled"))
            }
        }
    } else {
        manager
            .query(&connection_id, &sql, schema, transaction_id, None)
            .await
            .map(Response::ok)
    };

    if let Some(query_id) = query_id {
        cancellation.take(&query_id).await;
    }

    result.map_err(|e| e.to_string())
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
        Ok(Response::err(
            "QUERY_NOT_FOUND",
            &format!("Query not found or already finished: {query_id}"),
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

    let mut parser = parser_state.0.lock().map_err(|e| {
        let err_msg = format!("Failed to lock parser: {}", e);
        tracing::error!("{}", err_msg);
        err_msg
    })?;

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
}
