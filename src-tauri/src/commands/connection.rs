/// 连接管理相关 commands
use crate::core::{
    config::{AppConfig, ConfigManager, SavedConnection},
    dialect::DatabaseKind,
    manager::ConnectionManager,
    protocol::Response,
    redaction::redact_connection_url,
};
use crate::drivers::connect_driver;
use std::str::FromStr;
use tauri::State;

/// 连接数据库
#[tauri::command]
pub async fn connect_db(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    url: String,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        tracing::info!(
            "Connecting to database: driver={}, url={}",
            driver,
            redact_connection_url(&url)
        );

        let database_kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;

        let db_driver = connect_driver(database_kind, &url)
            .await
            .map_err(|error| error.to_string())?;

        db_driver
            .ping()
            .await
            .map_err(|e| format!("Connection test failed: {}", e))?;

        // Replace existing connection with the same ID and close the old driver.
        manager
            .replace_connection(connection_id.clone(), db_driver)
            .await
            .map_err(|e| format!("Failed to replace connection: {}", e))?;

        Ok(format!(
            "Connected to {} successfully",
            database_kind.as_str()
        ))
    }
    .await;

    match result {
        Ok(msg) => Ok(Response::ok(msg)),
        Err(e) => Ok(Response::err("CONNECTION_ERROR", &e)),
    }
}

/// 断开数据库连接
#[tauri::command]
pub async fn disconnect_db(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Response<String>, String> {
    match manager.disconnect_connection(&connection_id).await {
        Ok(_) => Ok(Response::ok("Connection disconnected".to_string())),
        Err(e) => Ok(Response::err("DISCONNECT_ERROR", &e.to_string())),
    }
}

/// 保存连接配置
#[tauri::command]
pub fn save_connections(
    config_manager: State<'_, ConfigManager>,
    connections: Vec<SavedConnection>,
) -> Result<Response<String>, String> {
    let config = AppConfig { connections };
    config_manager.save(&config);
    Ok(Response::ok("Connections saved successfully".to_string()))
}

/// 加载连接配置
#[tauri::command]
pub fn load_connections(
    config_manager: State<'_, ConfigManager>,
) -> Result<Response<Vec<SavedConnection>>, String> {
    let config = config_manager.load();
    Ok(Response::ok(config.connections))
}
