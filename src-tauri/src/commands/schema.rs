/// Schema 元数据相关 commands
use crate::core::{
    manager::ConnectionManager,
    protocol::{
        CollectionInfo, CollectionPage, ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo,
        Response, TableInfo,
    },
};
use tauri::State;

/// Get databases visible from the connected server.
#[tauri::command]
pub async fn get_databases(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Response<Vec<String>>, String> {
    manager
        .get_databases(&connection_id)
        .await
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

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
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

/// Get schemas from one explicitly selected database without changing the
/// active query connection.
#[tauri::command]
pub async fn get_database_schemas(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
) -> Result<Response<Vec<String>>, String> {
    manager
        .get_database_schemas(&connection_id, &database)
        .await
        .map(Response::ok)
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
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

/// 获取指定 namespace 下的 collections/indexes
#[tauri::command]
pub async fn get_collections(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    namespace: String,
) -> Result<Response<Vec<CollectionInfo>>, String> {
    manager
        .get_collections(&connection_id, &namespace)
        .await
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_collections_page(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    namespace: String,
    cursor: Option<String>,
    limit: usize,
    filter: Option<String>,
) -> Result<Response<CollectionPage>, String> {
    manager
        .get_collections_page(
            &connection_id,
            &namespace,
            cursor.as_deref(),
            limit.clamp(1, 1_000),
            filter.as_deref(),
        )
        .await
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

/// Get tables from a schema in one explicitly selected database.
#[tauri::command]
pub async fn get_database_tables(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
) -> Result<Response<Vec<TableInfo>>, String> {
    manager
        .get_database_tables(&connection_id, &database, &schema)
        .await
        .map(Response::ok)
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
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

/// Get table columns from one explicitly selected database.
#[tauri::command]
pub async fn get_database_columns(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<ColumnInfo>>, String> {
    manager
        .get_database_columns(&connection_id, &database, &schema, &table)
        .await
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

/// 获取表的索引信息
#[tauri::command]
pub async fn get_indexes(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<IndexInfo>>, String> {
    manager
        .get_indexes(&connection_id, &schema, &table)
        .await
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

/// Get table indexes from one explicitly selected database.
#[tauri::command]
pub async fn get_database_indexes(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<IndexInfo>>, String> {
    manager
        .get_database_indexes(&connection_id, &database, &schema, &table)
        .await
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

/// 获取表的约束和外键信息
#[tauri::command]
pub async fn get_constraints(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<ConstraintInfo>>, String> {
    manager
        .get_constraints(&connection_id, &schema, &table)
        .await
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

/// Get table constraints from one explicitly selected database.
#[tauri::command]
pub async fn get_database_constraints(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<ConstraintInfo>>, String> {
    manager
        .get_database_constraints(&connection_id, &database, &schema, &table)
        .await
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

/// 获取 schema 下的函数和存储过程信息
#[tauri::command]
pub async fn get_functions(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<Vec<FunctionInfo>>, String> {
    manager
        .get_functions(&connection_id, &schema)
        .await
        .map(Response::ok)
        .map_err(|e| e.to_string())
}

/// Get routines from a schema in one explicitly selected database.
#[tauri::command]
pub async fn get_database_functions(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
) -> Result<Response<Vec<FunctionInfo>>, String> {
    manager
        .get_database_functions(&connection_id, &database, &schema)
        .await
        .map(Response::ok)
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
