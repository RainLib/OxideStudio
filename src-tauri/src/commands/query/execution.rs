/// 查询执行相关 commands
use crate::core::{
    manager::ConnectionManager,
    protocol::{NativeQueryPage, QueryResult, Response},
};
use tauri::State;

use super::models::{MAX_NATIVE_QUERY_CURSOR_CHARS, MAX_NATIVE_QUERY_PAGE_SIZE};
use super::read_only::execute_query_with_cancellation;
use super::state::{
    sql_statement_at_cursor, validate_sql_syntax_text, QueryCancellationState,
    SqlStatementSelection, SqlSyntaxValidation,
};

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

/// Start a bounded external-driver result cursor. The cursor is opaque to the
/// WebView: only the backend may pass it back to the connection that issued
/// it, and it is released by an explicit close, disconnect, cancellation, or
/// sidecar restart.
#[tauri::command]
pub async fn execute_native_query_page(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    sql: String,
    page_size: u32,
    max_rows: Option<u32>,
    query_id: Option<String>,
) -> Result<Response<NativeQueryPage>, String> {
    if let Err(error) = validate_native_query_page_size(page_size, max_rows) {
        return Ok(Response::err("NATIVE_QUERY_PAGE_INVALID", &error));
    }
    let context = serde_json::json!({
        "connectionId": connection_id,
        "pageSize": page_size,
        "maxRows": max_rows,
        "queryId": query_id,
    });
    match manager
        .query_native_page(
            &connection_id,
            query_id.as_deref(),
            &sql,
            page_size,
            max_rows,
        )
        .await
    {
        Ok(page) => Ok(Response::ok(page)),
        Err(error) => Ok(Response::err_with_details(
            "NATIVE_QUERY_PAGE_ERROR",
            &error.to_string(),
            true,
            Some(context),
        )),
    }
}

#[tauri::command]
pub async fn fetch_native_query_page(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    cursor: String,
    page_size: u32,
    query_id: Option<String>,
) -> Result<Response<NativeQueryPage>, String> {
    if let Err(error) = validate_native_query_page_size(page_size, None)
        .and_then(|_| validate_native_query_cursor(&cursor))
    {
        return Ok(Response::err("NATIVE_QUERY_PAGE_INVALID", &error));
    }
    let context = serde_json::json!({
        "connectionId": connection_id,
        "pageSize": page_size,
        "queryId": query_id,
    });
    match manager
        .fetch_native_query_page(&connection_id, query_id.as_deref(), &cursor, page_size)
        .await
    {
        Ok(page) => Ok(Response::ok(page)),
        Err(error) => Ok(Response::err_with_details(
            "NATIVE_QUERY_PAGE_ERROR",
            &error.to_string(),
            true,
            Some(context),
        )),
    }
}

#[tauri::command]
pub async fn close_native_query_page(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    cursor: String,
) -> Result<Response<()>, String> {
    if let Err(error) = validate_native_query_cursor(&cursor) {
        return Ok(Response::err("NATIVE_QUERY_PAGE_INVALID", &error));
    }
    match manager
        .close_native_query_page(&connection_id, &cursor)
        .await
    {
        Ok(()) => Ok(Response::ok(())),
        Err(error) => Ok(Response::err_with_details(
            "NATIVE_QUERY_PAGE_CLOSE_ERROR",
            &error.to_string(),
            true,
            Some(serde_json::json!({ "connectionId": connection_id })),
        )),
    }
}

pub(super) fn validate_native_query_page_size(
    page_size: u32,
    max_rows: Option<u32>,
) -> Result<(), String> {
    if page_size == 0 || page_size > MAX_NATIVE_QUERY_PAGE_SIZE {
        return Err(format!(
            "page_size must be between 1 and {MAX_NATIVE_QUERY_PAGE_SIZE}"
        ));
    }
    if let Some(max_rows) = max_rows {
        if max_rows == 0 || max_rows > MAX_NATIVE_QUERY_PAGE_SIZE {
            return Err(format!(
                "max_rows must be between 1 and {MAX_NATIVE_QUERY_PAGE_SIZE}"
            ));
        }
    }
    Ok(())
}

pub(super) fn validate_native_query_cursor(cursor: &str) -> Result<(), String> {
    let cursor = cursor.trim();
    if cursor.is_empty()
        || cursor.len() > MAX_NATIVE_QUERY_CURSOR_CHARS
        || !cursor
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Native query cursor is invalid".to_string());
    }
    Ok(())
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
    lsp_language_id: Option<String>,
    lsp_server_dialect: Option<String>,
) -> Result<Response<SqlSyntaxValidation>, String> {
    match validate_sql_syntax_text(
        &driver,
        &sql,
        lsp_language_id.as_deref(),
        lsp_server_dialect.as_deref(),
    ) {
        Ok(validation) => Ok(Response::ok(validation)),
        Err(error) => Ok(Response::err("SQL_SYNTAX_VALIDATION_UNAVAILABLE", &error)),
    }
}
