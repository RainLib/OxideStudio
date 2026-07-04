use crate::core::store::{MetaStore, Resource, SavedConnection};
use anyhow::Result;
use tauri::State;

#[tauri::command]
pub async fn save_connection(
    meta_store: State<'_, MetaStore>,
    connection: SavedConnection,
) -> Result<(), String> {
    meta_store
        .save_connection(&connection)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connections(
    meta_store: State<'_, MetaStore>,
) -> Result<Vec<SavedConnection>, String> {
    meta_store
        .get_connections()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_connection(meta_store: State<'_, MetaStore>, id: String) -> Result<(), String> {
    meta_store
        .delete_connection(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_resources(
    meta_store: State<'_, MetaStore>,
    resources: Vec<Resource>,
) -> Result<(), String> {
    meta_store
        .save_resources(&resources)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn replace_resources(
    meta_store: State<'_, MetaStore>,
    connection_id: String,
    parent_id: Option<String>,
    kind: String,
    resources: Vec<Resource>,
) -> Result<(), String> {
    meta_store
        .replace_resources(&connection_id, parent_id.as_deref(), &kind, &resources)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_resources(
    meta_store: State<'_, MetaStore>,
    connection_id: String,
    parent_id: Option<String>,
) -> Result<Vec<Resource>, String> {
    meta_store
        .get_children(parent_id.as_deref(), &connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_resources(
    meta_store: State<'_, MetaStore>,
    connection_id: String,
    query: String,
    kind: Option<String>,
    parent_id: Option<String>,
    limit: Option<i32>,
) -> Result<Vec<Resource>, String> {
    meta_store
        .search_resources(
            &connection_id,
            &query,
            kind.as_deref(),
            parent_id.as_deref(),
            limit.unwrap_or(20),
        )
        .await
        .map_err(|e| e.to_string())
}
