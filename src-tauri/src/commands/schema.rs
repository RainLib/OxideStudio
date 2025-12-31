/// Schema 元数据相关 commands
use crate::core::{
    manager::ConnectionManager,
    protocol::{ColumnInfo, Response, TableInfo},
};
use tauri::State;

/// 获取所有 schemas
#[tauri::command]
pub async fn get_schemas(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Response<Vec<String>>, String> {
    println!("Getting schemas for connection: {}", connection_id);

    manager
        .get_schemas(&connection_id)
        .await
        .map(|schemas| Response::ok(schemas))
        .map_err(|e| e.to_string())
}

/// 获取指定 schema 下的所有表
#[tauri::command]
pub async fn get_tables(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<Vec<TableInfo>>, String> {
    println!("Getting tables for schema: {}", schema);

    manager
        .get_tables(&connection_id, &schema)
        .await
        .map(|tables| Response::ok(tables))
        .map_err(|e| e.to_string())
}

/// 获取表的列信息
#[tauri::command]
pub async fn get_columns(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<ColumnInfo>>, String> {
    manager
        .get_columns(&connection_id, &schema, &table)
        .await
        .map(|columns| Response::ok(columns))
        .map_err(|e| e.to_string())
}

/// 设置当前活动 schema
#[tauri::command]
pub async fn set_current_schema(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<String>, String> {
    manager
        .set_current_schema(&connection_id, &schema)
        .await
        .map(|_| Response::ok(format!("Schema set to: {}", schema)))
        .map_err(|e| e.to_string())
}
