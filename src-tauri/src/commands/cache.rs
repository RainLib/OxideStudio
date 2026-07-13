/// 缓存管理相关 commands
use crate::core::{
    cache::CacheManager,
    manager::ConnectionManager,
    protocol::{Response, TableInfo},
};
use tauri::State;

/// 获取缓存的 schemas
#[tauri::command]
pub fn get_cached_schemas(
    cache: State<'_, CacheManager>,
    connection_id: String,
) -> Result<Response<Vec<String>>, String> {
    let key = format!("schemas_{}", connection_id);

    match cache.load::<Vec<String>>(&key) {
        Some(schemas) => Ok(Response::ok(schemas)),
        None => Ok(Response::ok(vec![])),
    }
}

/// 刷新并缓存 schemas
#[tauri::command]
pub async fn refresh_schemas(
    manager: State<'_, ConnectionManager>,
    cache: State<'_, CacheManager>,
    connection_id: String,
) -> Result<Response<Vec<String>>, String> {
    println!("Refreshing schemas for: {}", connection_id);

    // 从数据库获取最新数据
    let schemas = manager
        .get_schemas(&connection_id)
        .await
        .map_err(|e| e.to_string())?;

    // 更新缓存
    let key = format!("schemas_{}", connection_id);
    cache.save(&key, &schemas);

    // 同时缓存每个 schema 的表
    Ok(Response::ok(schemas))
}

/// 获取缓存的表列表
#[tauri::command]
pub fn get_cached_tables(
    cache: State<'_, CacheManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<Vec<TableInfo>>, String> {
    let key = format!("tables_{}_{}", connection_id, schema);

    match cache.load::<Vec<TableInfo>>(&key) {
        Some(tables) => Ok(Response::ok(tables)),
        None => Ok(Response::ok(vec![])),
    }
}

/// 刷新并缓存表列表
#[tauri::command]
pub async fn refresh_tables(
    manager: State<'_, ConnectionManager>,
    cache: State<'_, CacheManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<Vec<TableInfo>>, String> {
    println!("Refreshing tables for schema: {}", schema);

    // 从数据库获取最新数据
    let tables = manager
        .get_tables(&connection_id, &schema)
        .await
        .map_err(|e| e.to_string())?;

    // 更新缓存
    let key = format!("tables_{}_{}", connection_id, schema);
    cache.save(&key, &tables);

    Ok(Response::ok(tables))
}
