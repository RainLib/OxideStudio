use crate::core::{
    config::ConfigManager,
    driver_package::{
        DatabaseDriverPackageRegistry, DriverPackageCachePruneResult,
        ManagedJavaRuntimeInstallation,
    },
    manager::ConnectionManager,
    protocol::Response,
    store::MetaStore,
};
use std::collections::BTreeSet;
use std::path::PathBuf;
use tauri::State;

pub use super::models::{
    DatabaseDriverRuntimeReconnectResult, DatabaseDriverRuntimeSummary, DatabaseDriverStoreInfo,
};

#[tauri::command]
pub async fn list_external_database_driver_runtimes(
    manager: State<'_, ConnectionManager>,
) -> Result<Response<Vec<DatabaseDriverRuntimeSummary>>, String> {
    Ok(Response::ok(
        manager
            .external_driver_runtime_summaries()
            .await
            .into_iter()
            .map(DatabaseDriverRuntimeSummary::from)
            .collect(),
    ))
}

/// Reconnect only sidecars already observed exited. The manager serializes
/// recovery and applies a per-connection crash-loop budget before invoking the
/// driver hook; raw sidecar errors never cross this command boundary.
#[tauri::command]
pub async fn reconnect_external_database_driver_runtimes(
    manager: State<'_, ConnectionManager>,
    driver: String,
    package_version: String,
) -> Result<Response<DatabaseDriverRuntimeReconnectResult>, String> {
    manager
        .reconnect_external_driver_runtimes(&driver, &package_version)
        .await
        .map(DatabaseDriverRuntimeReconnectResult::from)
        .map(Response::ok)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_database_driver_store_info(
    registry: State<'_, DatabaseDriverPackageRegistry>,
) -> Result<Response<DatabaseDriverStoreInfo>, String> {
    Ok(Response::ok(DatabaseDriverStoreInfo {
        active_path: registry.root().to_string_lossy().into_owned(),
        restart_required: false,
    }))
}

/// Remove only disposable signed-catalog archives. Activation and rollback
/// state are retained by the registry itself; connection pins and live
/// sidecars are added here without exposing credentials or connection ids.
#[tauri::command]
pub async fn prune_database_driver_cache(
    manager: State<'_, ConnectionManager>,
    registry: State<'_, DatabaseDriverPackageRegistry>,
    meta_store: State<'_, MetaStore>,
) -> Result<Response<DriverPackageCachePruneResult>, String> {
    let result: Result<DriverPackageCachePruneResult, String> = async {
        let mut retained: BTreeSet<(String, String)> =
            manager.active_external_driver_package_identities().await;
        retained.extend(
            meta_store
                .pinned_driver_packages()
                .await
                .map_err(|error| format!("Cannot inspect pinned driver packages: {error}"))?,
        );
        registry.prune_catalog_cache(&retained).await
    }
    .await;

    Ok(match result {
        Ok(summary) => Response::ok(summary),
        Err(error) => Response::err("DRIVER_CACHE_CLEANUP_ERROR", &error),
    })
}

/// Stage a complete external-driver store at a new location and persist the
/// location for the next launch. The current process intentionally keeps using
/// the old registry; deleting it is a separate explicit recovery operation.
#[tauri::command]
pub async fn migrate_database_driver_store(
    manager: State<'_, ConnectionManager>,
    registry: State<'_, DatabaseDriverPackageRegistry>,
    config: State<'_, ConfigManager>,
    destination_path: String,
) -> Result<Response<DatabaseDriverStoreInfo>, String> {
    let result: Result<DatabaseDriverStoreInfo, String> = async {
        let destination = PathBuf::from(destination_path.trim());
        if destination_path.trim().is_empty() || !destination.is_absolute() {
            return Err("Choose an absolute destination directory for the driver store".to_string());
        }
        let active_external_connections = manager.active_external_connection_count().await;
        if active_external_connections > 0 {
            return Err(format!(
                "Disconnect {active_external_connections} external driver connection(s) before migrating the driver store"
            ));
        }
        registry.stage_store_migration(&destination)?;
        config.set_driver_package_store_path(&destination)?;
        Ok(DatabaseDriverStoreInfo {
            active_path: destination.to_string_lossy().into_owned(),
            restart_required: true,
        })
    }
    .await;

    match result {
        Ok(info) => Ok(Response::ok(info)),
        Err(error) => Ok(Response::err("DRIVER_STORE_MIGRATION_ERROR", &error)),
    }
}

/// Lists separately managed JVM installations used by JDBC sidecars. Java
/// runtimes are intentionally not represented as database drivers: they have
/// their own signature, digest, and activation lifecycle.
#[tauri::command]
pub async fn list_managed_java_runtimes(
    registry: State<'_, DatabaseDriverPackageRegistry>,
) -> Result<Response<Vec<ManagedJavaRuntimeInstallation>>, String> {
    Ok(Response::ok(registry.managed_java_runtime_installations()))
}

#[tauri::command]
pub async fn install_managed_java_runtime(
    registry: State<'_, DatabaseDriverPackageRegistry>,
    runtime_directory: String,
    activate: bool,
) -> Result<Response<ManagedJavaRuntimeInstallation>, String> {
    let runtime = registry.install_managed_java_runtime_from_directory(
        std::path::Path::new(runtime_directory.trim()),
        activate,
    )?;
    Ok(Response::ok(runtime))
}
