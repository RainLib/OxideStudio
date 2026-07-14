use crate::core::{
    config::ConfigManager,
    protocol::CommandError,
    store::{AssistantTaskRecord, MetaStore, Project, QueryHistoryItem, Resource, SavedConnection},
};
use anyhow::Result;
use tauri::State;

#[tauri::command]
pub async fn save_project(
    meta_store: State<'_, MetaStore>,
    project: Project,
) -> Result<(), String> {
    meta_store
        .save_project(&project)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_projects(meta_store: State<'_, MetaStore>) -> Result<Vec<Project>, String> {
    meta_store.get_projects().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_project(
    meta_store: State<'_, MetaStore>,
    project_id: String,
) -> Result<Option<Project>, String> {
    meta_store
        .get_project(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_project(
    meta_store: State<'_, MetaStore>,
    config_manager: State<'_, ConfigManager>,
    project_id: String,
) -> Result<(), String> {
    meta_store
        .delete_project(&project_id)
        .await
        .map_err(|error| error.to_string())?;

    // Legacy connection records are still a migration source. Remove the
    // deleted project's entries so they cannot be imported again later.
    let mut legacy_config = config_manager.load();
    legacy_config
        .connections
        .retain(|connection| connection.project_id != project_id);
    config_manager.save(&legacy_config);

    Ok(())
}

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
    project_id: Option<String>,
) -> Result<Vec<SavedConnection>, String> {
    let project_id = project_id.unwrap_or_else(|| "sqls".to_string());
    meta_store
        .get_connections(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_connection(
    meta_store: State<'_, MetaStore>,
    config_manager: State<'_, ConfigManager>,
    project_id: Option<String>,
    id: String,
) -> Result<(), CommandError> {
    let project_id = project_id.unwrap_or_else(|| "sqls".to_string());
    let error_context = serde_json::json!({
        "projectId": project_id,
        "connectionId": id,
    });
    meta_store
        .delete_connection(&project_id, &id)
        .await
        .map_err(|error| {
            CommandError::new(
                "CONNECTION_DELETE_FAILED",
                error.to_string(),
                true,
                Some(error_context),
            )
        })?;

    // Keep the legacy migration source in sync so a removed connection cannot
    // be imported again when this was the project's final stored connection.
    let mut legacy_config = config_manager.load();
    legacy_config
        .connections
        .retain(|connection| connection.project_id != project_id || connection.id != id);
    config_manager.save(&legacy_config);

    Ok(())
}

#[tauri::command]
pub async fn save_resources(
    meta_store: State<'_, MetaStore>,
    project_id: Option<String>,
    resources: Vec<Resource>,
) -> Result<(), String> {
    let project_id = project_id.unwrap_or_else(|| "sqls".to_string());
    meta_store
        .save_resources(&project_id, &resources)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn replace_resources(
    meta_store: State<'_, MetaStore>,
    project_id: Option<String>,
    connection_id: String,
    parent_id: Option<String>,
    kind: String,
    resources: Vec<Resource>,
) -> Result<(), String> {
    let project_id = project_id.unwrap_or_else(|| "sqls".to_string());
    meta_store
        .replace_resources(
            &project_id,
            &connection_id,
            parent_id.as_deref(),
            &kind,
            &resources,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_resources(
    meta_store: State<'_, MetaStore>,
    project_id: Option<String>,
    connection_id: String,
    parent_id: Option<String>,
    kind: Option<String>,
) -> Result<(), String> {
    let project_id = project_id.unwrap_or_else(|| "sqls".to_string());
    meta_store
        .delete_resources(
            &project_id,
            &connection_id,
            parent_id.as_deref(),
            kind.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_resources(
    meta_store: State<'_, MetaStore>,
    project_id: Option<String>,
    connection_id: String,
    parent_id: Option<String>,
) -> Result<Vec<Resource>, String> {
    let project_id = project_id.unwrap_or_else(|| "sqls".to_string());
    meta_store
        .get_children(&project_id, parent_id.as_deref(), &connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_resources(
    meta_store: State<'_, MetaStore>,
    project_id: Option<String>,
    connection_id: String,
    query: String,
    kind: Option<String>,
    parent_id: Option<String>,
    limit: Option<i32>,
) -> Result<Vec<Resource>, String> {
    let project_id = project_id.unwrap_or_else(|| "sqls".to_string());
    meta_store
        .search_resources(
            &project_id,
            &connection_id,
            &query,
            kind.as_deref(),
            parent_id.as_deref(),
            limit.unwrap_or(20),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_query_history_entries(
    meta_store: State<'_, MetaStore>,
    entries: Vec<QueryHistoryItem>,
) -> Result<(), String> {
    meta_store
        .save_query_history(&entries)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_query_history(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    limit: Option<i64>,
) -> Result<Vec<QueryHistoryItem>, String> {
    meta_store
        .get_query_history(&project_id, limit.unwrap_or(500))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_query_history_entry(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    id: String,
) -> Result<(), String> {
    meta_store
        .delete_query_history_item(&project_id, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn clear_query_history(
    meta_store: State<'_, MetaStore>,
    project_id: String,
) -> Result<(), String> {
    meta_store
        .clear_query_history(&project_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_assistant_task(
    meta_store: State<'_, MetaStore>,
    task: AssistantTaskRecord,
) -> Result<(), String> {
    meta_store
        .save_assistant_task(&task)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_assistant_tasks(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    session_id: String,
    limit: Option<i64>,
) -> Result<Vec<AssistantTaskRecord>, String> {
    meta_store
        .get_assistant_tasks(&project_id, &session_id, limit.unwrap_or(50))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn clear_finished_assistant_tasks(
    meta_store: State<'_, MetaStore>,
    project_id: String,
) -> Result<(), String> {
    meta_store
        .clear_finished_assistant_tasks(&project_id)
        .await
        .map_err(|error| error.to_string())
}
