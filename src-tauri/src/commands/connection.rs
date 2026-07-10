/// 连接管理相关 commands
use crate::core::{
    config::{ConfigManager, SavedConnection as ConfigSavedConnection},
    dialect::database_capabilities_for_driver,
    driver::DatabaseDriver,
    manager::ConnectionManager,
    protocol::Response,
    redaction::redact_connection_url,
    store::{MetaStore, SavedConnection as StoreSavedConnection},
};
use crate::drivers::connect_driver;
use tauri::State;

async fn ping_driver_or_cleanup(driver: &dyn DatabaseDriver) -> Result<(), String> {
    match driver.ping().await {
        Ok(()) => Ok(()),
        Err(error) => {
            let message = format!("Connection test failed: {}", error);
            if let Err(cleanup_error) = driver.disconnect().await {
                tracing::warn!(
                    "Failed to disconnect database driver after ping failure: {}",
                    cleanup_error
                );
                Err(format!("{message}; cleanup failed: {cleanup_error}"))
            } else {
                Err(message)
            }
        }
    }
}

fn current_timestamp_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn store_connection_from_config(
    project_id: &str,
    connection: &ConfigSavedConnection,
) -> Result<StoreSavedConnection, String> {
    let now = current_timestamp_millis();
    let mut scoped_connection = connection.clone();
    scoped_connection.project_id = project_id.to_string();
    let config = serde_json::to_value(&scoped_connection).map_err(|error| error.to_string())?;

    Ok(StoreSavedConnection {
        id: scoped_connection.id,
        project_id: project_id.to_string(),
        name: scoped_connection.name,
        driver: scoped_connection.driver,
        config,
        created_at: now,
        updated_at: now,
    })
}

fn config_connection_from_store(
    project_id: &str,
    connection: StoreSavedConnection,
) -> ConfigSavedConnection {
    let mut config_connection = serde_json::from_value::<ConfigSavedConnection>(connection.config)
        .unwrap_or_else(|_| ConfigSavedConnection {
            id: connection.id,
            project_id: project_id.to_string(),
            name: connection.name,
            driver: connection.driver,
            url: String::new(),
            host: None,
            port: None,
            user: None,
            password: None,
            database: None,
            connection_url: None,
            ssl_mode: None,
            tags: None,
            icon: None,
            color: None,
        });
    config_connection.project_id = project_id.to_string();
    config_connection
}

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

        let capabilities =
            database_capabilities_for_driver(&driver).map_err(|error| error.to_string())?;

        let db_driver = connect_driver(&driver, &url)
            .await
            .map_err(|error| error.to_string())?;

        ping_driver_or_cleanup(db_driver.as_ref()).await?;

        // Replace existing connection with the same ID and close the old driver.
        manager
            .replace_connection(connection_id.clone(), db_driver)
            .await
            .map_err(|e| format!("Failed to replace connection: {}", e))?;

        Ok(format!(
            "Connected to {} successfully",
            capabilities.display_name
        ))
    }
    .await;

    match result {
        Ok(msg) => Ok(Response::ok(msg)),
        Err(e) => Ok(Response::err("CONNECTION_ERROR", &e)),
    }
}

/// 测试数据库连接，不注册为当前工作区连接
#[tauri::command]
pub async fn test_db_connection(driver: String, url: String) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        tracing::info!(
            "Testing database connection: driver={}, url={}",
            driver,
            redact_connection_url(&url)
        );

        let capabilities =
            database_capabilities_for_driver(&driver).map_err(|error| error.to_string())?;
        let db_driver = connect_driver(&driver, &url)
            .await
            .map_err(|error| error.to_string())?;

        ping_driver_or_cleanup(db_driver.as_ref()).await?;
        db_driver
            .disconnect()
            .await
            .map_err(|e| format!("Connection cleanup failed: {}", e))?;

        Ok(format!(
            "{} connection is available",
            capabilities.display_name
        ))
    }
    .await;

    match result {
        Ok(msg) => Ok(Response::ok(msg)),
        Err(e) => Ok(Response::err("CONNECTION_TEST_ERROR", &e)),
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
pub async fn save_connections(
    meta_store: State<'_, MetaStore>,
    project_id: Option<String>,
    connections: Vec<ConfigSavedConnection>,
) -> Result<Response<String>, String> {
    let project_id = project_id.unwrap_or_else(|| "sqls".to_string());
    let store_connections = connections
        .iter()
        .map(|connection| store_connection_from_config(&project_id, connection))
        .collect::<Result<Vec<_>, _>>()?;
    meta_store
        .replace_connections(&project_id, &store_connections)
        .await
        .map_err(|error| error.to_string())?;
    Ok(Response::ok("Connections saved successfully".to_string()))
}

/// 加载连接配置
#[tauri::command]
pub async fn load_connections(
    meta_store: State<'_, MetaStore>,
    config_manager: State<'_, ConfigManager>,
    project_id: Option<String>,
) -> Result<Response<Vec<ConfigSavedConnection>>, String> {
    let project_id = project_id.unwrap_or_else(|| "sqls".to_string());
    let mut store_connections = meta_store
        .get_connections(&project_id)
        .await
        .map_err(|error| error.to_string())?;

    if store_connections.is_empty() {
        let legacy_connections = config_manager
            .load()
            .connections
            .into_iter()
            .filter(|connection| connection.project_id == project_id)
            .collect::<Vec<_>>();

        if !legacy_connections.is_empty() {
            store_connections = legacy_connections
                .iter()
                .map(|connection| store_connection_from_config(&project_id, connection))
                .collect::<Result<Vec<_>, _>>()?;
            meta_store
                .replace_connections(&project_id, &store_connections)
                .await
                .map_err(|error| error.to_string())?;
        }
    }

    let connections = store_connections
        .into_iter()
        .map(|connection| config_connection_from_store(&project_id, connection))
        .collect();
    Ok(Response::ok(connections))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::protocol::QueryResult;
    use anyhow::{anyhow, Result};
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    struct PingCleanupDriver {
        disconnect_calls: Arc<AtomicUsize>,
        fail_ping: bool,
        fail_disconnect: bool,
    }

    #[async_trait]
    impl DatabaseDriver for PingCleanupDriver {
        async fn connect(&mut self) -> Result<()> {
            Ok(())
        }

        async fn disconnect(&self) -> Result<()> {
            self.disconnect_calls.fetch_add(1, Ordering::SeqCst);
            if self.fail_disconnect {
                Err(anyhow!("cleanup failed"))
            } else {
                Ok(())
            }
        }

        async fn ping(&self) -> Result<()> {
            if self.fail_ping {
                Err(anyhow!("ping failed"))
            } else {
                Ok(())
            }
        }

        async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
            Ok(Vec::new())
        }
    }

    #[tokio::test]
    async fn ping_failure_disconnects_created_driver() {
        let disconnect_calls = Arc::new(AtomicUsize::new(0));
        let driver = PingCleanupDriver {
            disconnect_calls: disconnect_calls.clone(),
            fail_ping: true,
            fail_disconnect: false,
        };

        let result = ping_driver_or_cleanup(&driver).await;

        assert!(result.unwrap_err().contains("ping failed"));
        assert_eq!(disconnect_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn ping_success_leaves_driver_registered_for_caller() {
        let disconnect_calls = Arc::new(AtomicUsize::new(0));
        let driver = PingCleanupDriver {
            disconnect_calls: disconnect_calls.clone(),
            fail_ping: false,
            fail_disconnect: false,
        };

        ping_driver_or_cleanup(&driver)
            .await
            .expect("ping should succeed");

        assert_eq!(disconnect_calls.load(Ordering::SeqCst), 0);
    }
}
