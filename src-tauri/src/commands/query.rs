/// 查询执行相关 commands
use crate::core::{
    manager::ConnectionManager,
    parser::{CompletionContext, SqlParser},
    protocol::{QueryResult, Response},
};
use std::sync::Mutex;
use tauri::State;

/// SQL Parser 状态
pub struct ParserState(pub Mutex<SqlParser>);

/// 执行 SQL 查询
#[tauri::command]
pub async fn execute_query(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    sql: String,
    schema: Option<String>,
) -> Result<Response<Vec<QueryResult>>, String> {
    println!("Executing query on connection: {}", connection_id);

    manager
        .query(&connection_id, &sql, schema)
        .await
        .map(|results| Response::ok(results))
        .map_err(|e| e.to_string())
}

/// 获取 SQL 自动完成建议
#[tauri::command]
pub async fn get_sql_completion(
    parser_state: State<'_, ParserState>,
    sql: String,
    cursor: usize,
) -> Result<CompletionContext, String> {
    let mut parser = parser_state.0.lock().map_err(|e| e.to_string())?;

    // 使用正确的方法名: parse_and_get_context
    let context = parser.parse_and_get_context(&sql, cursor);

    Ok(context)
}
