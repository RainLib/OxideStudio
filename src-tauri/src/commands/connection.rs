/// 连接管理相关 commands
use crate::core::{
    config::{ConfigManager, SavedConnection as ConfigSavedConnection, SshTunnelConfig},
    dialect::{canonical_driver_name, database_capabilities_for_driver},
    driver::DatabaseDriver,
    driver_package::DatabaseDriverPackageRegistry,
    manager::ConnectionManager,
    protocol::Response,
    redaction::redact_connection_url,
    sqlite_worker_artifact::SqliteWorkerArtifactRegistry,
    ssh::SshTunnel,
    store::{MetaStore, SavedConnection as StoreSavedConnection},
};
use crate::drivers::connect_preferred_driver;
use crate::drivers::sqlite_ssh::{detect_remote_sqlite_platform, RemoteSqliteDriver};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

const MAX_CONNECTION_IMPORT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSqliteWorkerPreparation {
    pub platform: String,
    pub version: String,
    pub installed: bool,
    pub digest: Option<String>,
}

#[tauri::command]
pub async fn get_remote_sqlite_worker_status(
    registry: State<'_, SqliteWorkerArtifactRegistry>,
    platform: String,
) -> Result<Response<RemoteSqliteWorkerPreparation>, String> {
    let required = oxide_sqlite_worker::SQLITE_WORKER_PACKAGE_VERSION.to_string();
    let worker = registry.resolve(&platform).ok();
    let installed = worker.is_some();
    Ok(Response::ok(RemoteSqliteWorkerPreparation {
        platform,
        version: required,
        installed,
        digest: worker.map(|worker| worker.digest),
    }))
}

#[tauri::command]
pub async fn prepare_remote_sqlite_worker(
    registry: State<'_, SqliteWorkerArtifactRegistry>,
    ssh_tunnel: SshTunnelConfig,
    download_base_url: String,
) -> Result<Response<RemoteSqliteWorkerPreparation>, String> {
    let result: Result<RemoteSqliteWorkerPreparation, String> = async {
        let platform = detect_remote_sqlite_platform(&ssh_tunnel)
            .await
            .map_err(|error| error.to_string())?;
        let version = oxide_sqlite_worker::SQLITE_WORKER_PACKAGE_VERSION.to_string();
        if registry.resolve(&platform).is_err() {
            registry
                .install_release(&download_base_url, &platform, &version)
                .await?;
        }
        let worker = registry.resolve(&platform)?;
        Ok(RemoteSqliteWorkerPreparation {
            platform,
            version,
            installed: true,
            digest: Some(worker.digest),
        })
    }
    .await;
    Ok(match result {
        Ok(preparation) => Response::ok(preparation),
        Err(error) => Response::err_with_details(
            "SQLITE_WORKER_PREPARE_ERROR",
            &safe_remote_sqlite_prepare_error(&error),
            true,
            None,
        ),
    })
}

fn safe_remote_sqlite_prepare_error(error: &str) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("host key")
        || lower.contains("authentication")
        || lower.contains("requires")
        || lower.contains("worker")
        || lower.contains("download")
        || lower.contains("https")
        || lower.contains("platform")
    {
        error.chars().take(360).collect()
    } else {
        "Remote SQLite worker preparation failed. Check the SSH host and signed worker source."
            .to_string()
    }
}

/// Content read only after a native file-picker selection. Parsing remains in
/// the UI so the preview can show every field, but passwords and driver paths
/// are deliberately not interpreted by this Host boundary.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionImportFile {
    pub file_name: String,
    pub content: String,
}

#[tauri::command]
pub async fn import_connection_config_file(
    app: AppHandle,
) -> Result<Response<Option<ConnectionImportFile>>, String> {
    let (sender, receiver) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Connection configuration", &["xml", "json", "ncx"])
        .set_title("Import DataGrip, DBeaver, or Navicat connections")
        .pick_file(move |selection| {
            let _ = sender.send(selection);
        });
    let selection = receiver
        .await
        .map_err(|_| "Connection import dialog closed unexpectedly".to_string())?;
    let Some(selection) = selection else {
        return Ok(Response::ok(None));
    };
    let path = selection
        .into_path()
        .map_err(|_| "The selected connection import is not a local file".to_string())?;
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|error| format!("Unable to inspect the selected connection file: {error}"))?;
    if !metadata.is_file() {
        return Ok(Response::err(
            "CONNECTION_IMPORT_ERROR",
            "The selected connection import path is not a file",
        ));
    }
    if metadata.len() > MAX_CONNECTION_IMPORT_BYTES {
        return Ok(Response::err(
            "CONNECTION_IMPORT_ERROR",
            &format!(
                "Connection import files are limited to {} MB",
                MAX_CONNECTION_IMPORT_BYTES / 1024 / 1024
            ),
        ));
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| format!("Unable to read the selected connection file: {error}"))?;
    if content.len() as u64 > MAX_CONNECTION_IMPORT_BYTES {
        return Ok(Response::err(
            "CONNECTION_IMPORT_ERROR",
            &format!(
                "Connection import files are limited to {} MB",
                MAX_CONNECTION_IMPORT_BYTES / 1024 / 1024
            ),
        ));
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Connection configuration")
        .to_string();
    Ok(Response::ok(Some(ConnectionImportFile {
        file_name,
        content,
    })))
}

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

pub(crate) fn store_connection_from_config(
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

pub(crate) async fn migrate_legacy_connections(
    meta_store: &MetaStore,
    config_manager: &ConfigManager,
) -> Result<usize, String> {
    let legacy = config_manager.load().connections;
    if legacy.is_empty() {
        return Ok(0);
    }
    let mut by_project = std::collections::BTreeMap::<String, Vec<StoreSavedConnection>>::new();
    for connection in &legacy {
        let project_id = if connection.project_id.trim().is_empty() {
            "sqls"
        } else {
            connection.project_id.as_str()
        };
        by_project
            .entry(project_id.to_string())
            .or_default()
            .push(store_connection_from_config(project_id, connection)?);
    }
    for (project_id, connections) in by_project {
        if meta_store
            .get_connections(&project_id)
            .await
            .map_err(|error| error.to_string())?
            .is_empty()
        {
            meta_store
                .replace_connections(&project_id, &connections)
                .await
                .map_err(|error| error.to_string())?;
        }
    }
    config_manager.save(&crate::core::config::AppConfig::default());
    Ok(legacy.len())
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
            driver_package_version: None,
            url: String::new(),
            host: None,
            port: None,
            user: None,
            password: None,
            database: None,
            connection_url: None,
            ssl_mode: None,
            elasticsearch_mode: None,
            elasticsearch_kibana_base_path: None,
            elasticsearch_connectivity_check_path: None,
            elasticsearch_connectivity_check_disabled: false,
            index_grouping_pattern: None,
            ssh_tunnel: None,
            tags: None,
            note: None,
            icon: None,
            color: None,
            environment: Default::default(),
            production_databases: Vec::new(),
        });
    config_connection.project_id = project_id.to_string();
    config_connection
}

/// 连接数据库
#[tauri::command]
// Tauri injects the three Host-owned registries separately; keeping them out
// of renderer input is more important than collapsing this command boundary.
#[allow(clippy::too_many_arguments)]
pub async fn connect_db(
    manager: State<'_, ConnectionManager>,
    registry: State<'_, DatabaseDriverPackageRegistry>,
    worker_registry: State<'_, SqliteWorkerArtifactRegistry>,
    connection_id: String,
    driver: String,
    url: String,
    ssh_tunnel: Option<SshTunnelConfig>,
    package_version: Option<String>,
) -> Result<Response<String>, String> {
    let error_context = serde_json::json!({
        "connectionId": connection_id,
        "driver": driver,
    });
    let result: Result<String, String> = async {
        tracing::info!(
            "Connecting to database: driver={}, url={}",
            driver,
            redact_connection_url(&url)
        );

        // External packages may introduce a driver family that is not linked
        // into this build. Its sidecar remains the authority for execution;
        // the catalog is used here only for a friendly connection label.
        let display_name = database_capabilities_for_driver(&driver)
            .map(|capabilities| capabilities.display_name)
            .unwrap_or_else(|_| driver.trim().to_string());

        let (db_driver, ssh_tunnel) = connect_driver_with_transport(
            &registry,
            &worker_registry,
            &driver,
            &url,
            &connection_id,
            ssh_tunnel.as_ref(),
            package_version.as_deref(),
        )
        .await
        .map_err(|error| error.to_string())?;

        ping_driver_or_cleanup(db_driver.as_ref()).await?;
        let server_version = db_driver.server_version().await;

        // Replace existing connection with the same ID and close the old driver.
        manager
            .replace_connection_with_tunnel_and_driver_id(
                connection_id.clone(),
                db_driver,
                ssh_tunnel,
                Some(
                    canonical_driver_name(&driver)
                        .unwrap_or_else(|| driver.trim())
                        .to_ascii_lowercase(),
                ),
            )
            .await
            .map_err(|e| format!("Failed to replace connection: {}", e))?;

        let server_label = server_version
            .map(|version| format!("{display_name} {version}"))
            .unwrap_or_else(|| display_name.to_string());
        Ok(format!("Connected to {server_label} successfully"))
    }
    .await;

    match result {
        Ok(msg) => Ok(Response::ok(msg)),
        Err(e) => Ok(Response::err_with_details(
            "CONNECTION_ERROR",
            &e,
            true,
            Some(error_context),
        )),
    }
}

/// 测试数据库连接，不注册为当前工作区连接
#[tauri::command]
pub async fn test_db_connection(
    registry: State<'_, DatabaseDriverPackageRegistry>,
    worker_registry: State<'_, SqliteWorkerArtifactRegistry>,
    driver: String,
    url: String,
    ssh_tunnel: Option<SshTunnelConfig>,
    package_version: Option<String>,
) -> Result<Response<String>, String> {
    let error_context = serde_json::json!({ "driver": driver });
    let result: Result<String, String> = async {
        tracing::info!(
            "Testing database connection: driver={}, url={}",
            driver,
            redact_connection_url(&url)
        );

        let display_name = database_capabilities_for_driver(&driver)
            .map(|capabilities| capabilities.display_name)
            .unwrap_or_else(|_| driver.trim().to_string());
        let test_connection_id = format!("test-{}", uuid::Uuid::new_v4());
        let (db_driver, _ssh_tunnel) = connect_driver_with_transport(
            &registry,
            &worker_registry,
            &driver,
            &url,
            &test_connection_id,
            ssh_tunnel.as_ref(),
            package_version.as_deref(),
        )
        .await
        .map_err(|error| error.to_string())?;

        ping_driver_or_cleanup(db_driver.as_ref()).await?;
        let server_version = db_driver.server_version().await;
        db_driver
            .disconnect()
            .await
            .map_err(|e| format!("Connection cleanup failed: {}", e))?;

        let server_label = server_version
            .map(|version| format!("{display_name} {version}"))
            .unwrap_or_else(|| display_name.to_string());
        Ok(format!("{server_label} connection is available"))
    }
    .await;

    match result {
        Ok(msg) => Ok(Response::ok(msg)),
        Err(e) => Ok(Response::err_with_details(
            "CONNECTION_TEST_ERROR",
            &e,
            true,
            Some(error_context),
        )),
    }
}

pub(crate) async fn connect_driver_with_transport(
    registry: &DatabaseDriverPackageRegistry,
    worker_registry: &SqliteWorkerArtifactRegistry,
    driver: &str,
    url: &str,
    connection_id: &str,
    ssh_tunnel: Option<&SshTunnelConfig>,
    package_version: Option<&str>,
) -> anyhow::Result<(Box<dyn DatabaseDriver>, Option<SshTunnel>)> {
    let canonical = canonical_driver_name(driver).unwrap_or_else(|| driver.trim());
    if canonical.eq_ignore_ascii_case("sqlite")
        && ssh_tunnel.is_some_and(|config| config.enabled && config.remote_sqlite.is_some())
    {
        if package_version.is_some() {
            anyhow::bail!("Remote SQLite cannot be combined with an external driver package");
        }
        let config = ssh_tunnel
            .ok_or_else(|| anyhow::anyhow!("Remote SQLite requires an enabled SSH connection"))?;
        let remote =
            RemoteSqliteDriver::open(worker_registry, connection_id, url, config, false).await?;
        return Ok((Box::new(remote), None));
    }

    let (connection_url, tunnel) = SshTunnel::prepare(driver, url, ssh_tunnel).await?;
    let connected = connect_preferred_driver(
        registry,
        driver,
        &connection_url,
        connection_id.to_string(),
        package_version,
    )
    .await?;
    Ok((connected, tunnel))
}

/// 断开数据库连接
#[tauri::command]
pub async fn disconnect_db(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Response<String>, String> {
    match manager.disconnect_connection(&connection_id).await {
        Ok(_) => Ok(Response::ok("Connection disconnected".to_string())),
        Err(e) => Ok(Response::err_with_details(
            "DISCONNECT_ERROR",
            &e.to_string(),
            true,
            Some(serde_json::json!({ "connectionId": connection_id })),
        )),
    }
}

#[tauri::command]
pub async fn get_connection_server_version(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Response<Option<String>>, String> {
    match manager.server_version(&connection_id).await {
        Ok(version) => Ok(Response::ok(version)),
        Err(error) => Ok(Response::err_with_details(
            "CONNECTION_VERSION_ERROR",
            &error.to_string(),
            true,
            Some(serde_json::json!({ "connectionId": connection_id })),
        )),
    }
}

/// 保存连接配置
#[tauri::command]
pub async fn save_connections(
    meta_store: State<'_, MetaStore>,
    config_manager: State<'_, ConfigManager>,
    project_id: Option<String>,
    connections: Vec<ConfigSavedConnection>,
) -> Result<Response<String>, String> {
    let project_id = project_id.unwrap_or_else(|| "sqls".to_string());
    let connection_count = connections.len();
    let result: Result<String, String> = async {
        let store_connections = connections
            .iter()
            .map(|connection| store_connection_from_config(&project_id, connection))
            .collect::<Result<Vec<_>, _>>()?;
        meta_store
            .replace_connections(&project_id, &store_connections)
            .await
            .map_err(|error| error.to_string())?;

        // The legacy JSON file is now migration input only. Never write database
        // credentials back to it after the encrypted SQLite credential store
        // has accepted the current project.
        let mut legacy_config = config_manager.load();
        legacy_config
            .connections
            .retain(|connection| connection.project_id != project_id);
        config_manager.save(&legacy_config);
        Ok("Connections saved successfully".to_string())
    }
    .await;

    Ok(match result {
        Ok(message) => Response::ok(message),
        Err(error) => Response::err_with_details(
            "CONNECTION_SAVE_FAILED",
            &error,
            true,
            Some(serde_json::json!({
                "projectId": project_id,
                "connectionCount": connection_count,
            })),
        ),
    })
}

/// 加载连接配置
#[tauri::command]
pub async fn load_connections(
    meta_store: State<'_, MetaStore>,
    config_manager: State<'_, ConfigManager>,
    project_id: Option<String>,
) -> Result<Response<Vec<ConfigSavedConnection>>, String> {
    let project_id = project_id.unwrap_or_else(|| "sqls".to_string());
    let result: Result<Vec<ConfigSavedConnection>, String> = async {
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
                let mut legacy_config = config_manager.load();
                legacy_config
                    .connections
                    .retain(|connection| connection.project_id != project_id);
                config_manager.save(&legacy_config);
            }
        }

        Ok(store_connections
            .into_iter()
            .map(|connection| config_connection_from_store(&project_id, connection))
            .collect())
    }
    .await;

    Ok(match result {
        Ok(connections) => Response::ok(connections),
        Err(error) => Response::err_with_details(
            "CONNECTION_LOAD_FAILED",
            &error,
            true,
            Some(serde_json::json!({ "projectId": project_id })),
        ),
    })
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
