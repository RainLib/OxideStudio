use crate::core::{
    dialect::{retain_host_table_export_formats, HOST_TABLE_EXPORT_FORMATS},
    driver_package::{
        DatabaseDriverPackageRegistry, DriverActivationState, DriverPackageRuntime,
        DriverPackageStatus, InstalledDriverPackage,
    },
    driver_sidecar::DatabaseDriverSidecar,
    manager::ConnectionManager,
    protocol::Response,
};
use tauri::State;

use super::capabilities::bundled_database_driver_installations;
pub use super::models::{
    DatabaseDriverCatalog, DatabaseDriverInstallation, DatabaseDriverProbeResult,
};

#[tauri::command]
pub async fn list_database_driver_installations(
    registry: State<'_, DatabaseDriverPackageRegistry>,
) -> Result<Response<Vec<DatabaseDriverInstallation>>, String> {
    let mut installations = bundled_database_driver_installations();
    installations.extend(
        registry
            .list_installed()
            .into_iter()
            .map(|package| external_driver_installation(&registry, package)),
    );
    Ok(Response::ok(installations))
}

#[tauri::command]
pub async fn get_external_database_driver_catalog(
    registry: State<'_, DatabaseDriverPackageRegistry>,
    catalog_url: String,
) -> Result<Response<DatabaseDriverCatalog>, String> {
    let source_url = catalog_url.trim().to_string();
    let catalog = registry.fetch_signed_catalog(&source_url).await?;
    Ok(Response::ok(DatabaseDriverCatalog {
        catalog,
        source_url,
    }))
}

pub(super) fn external_driver_installation(
    registry: &DatabaseDriverPackageRegistry,
    package: InstalledDriverPackage,
) -> DatabaseDriverInstallation {
    let can_rollback = package.active
        && registry
            .activation_state(&package.manifest.driver_id)
            .and_then(|state| state.previous)
            .is_some();
    let runtime_ready = match &package.manifest.runtime {
        DriverPackageRuntime::Native => None,
        DriverPackageRuntime::Java(java) => Some(
            registry
                .resolve_managed_java_runtime_binary(&package, java.java_major)
                .is_ok(),
        ),
    };
    let manifest = package.manifest;
    DatabaseDriverInstallation {
        driver: manifest.driver_id,
        display_name: manifest.display_name,
        client_library: manifest.client_library,
        client_version: manifest.client_version,
        distribution: "external".to_string(),
        update_policy: "independent".to_string(),
        independently_updatable: true,
        server_version_policy: manifest
            .server_version_range
            .unwrap_or_else(|| "declared-by-package".to_string()),
        implementation: match &manifest.runtime {
            DriverPackageRuntime::Native => "isolated native driver sidecar".to_string(),
            DriverPackageRuntime::Java(_) => "isolated JDBC driver sidecar".to_string(),
        },
        runtime: match &manifest.runtime {
            DriverPackageRuntime::Native => "Native executable".to_string(),
            DriverPackageRuntime::Java(java) => {
                if runtime_ready == Some(true) {
                    format!("Managed Java {} active", java.java_major)
                } else {
                    format!("Managed Java {} unavailable", java.java_major)
                }
            }
        },
        runtime_ready,
        package_version: Some(manifest.package_version),
        protocol_version: Some(manifest.protocol_version),
        active: package.active,
        can_rollback,
        status: match package.status {
            DriverPackageStatus::Ready => "ready",
            DriverPackageStatus::Incompatible => "incompatible",
            DriverPackageStatus::Untrusted => "untrusted",
            DriverPackageStatus::Invalid => "invalid",
        }
        .to_string(),
        status_message: package.status_message,
        connection_url_template: manifest.connection_url_template,
        capabilities: manifest.capabilities.map(|mut capabilities| {
            retain_host_table_export_formats(&mut capabilities);
            capabilities
        }),
    }
}

pub(super) async fn ensure_active_package_can_change(
    manager: &ConnectionManager,
    registry: &DatabaseDriverPackageRegistry,
    driver: &str,
    next_version: Option<&str>,
) -> Result<(), String> {
    let Some(state) = registry.activation_state(driver) else {
        return Ok(());
    };
    if next_version.is_some_and(|version| version == state.current) {
        return Ok(());
    }
    let active_connections = manager
        .active_external_driver_connections(driver, &state.current)
        .await;
    if active_connections > 0 {
        return Err(format!(
            "Cannot switch {driver} driver package while {active_connections} active connection(s) use version {}. Disconnect or reconnect them first.",
            state.current
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn install_external_database_driver(
    manager: State<'_, ConnectionManager>,
    registry: State<'_, DatabaseDriverPackageRegistry>,
    package_directory: String,
    activate: bool,
) -> Result<Response<DatabaseDriverInstallation>, String> {
    let path = std::path::Path::new(package_directory.trim());
    let package = registry.install_from_directory(path, false)?;
    if activate {
        ensure_active_package_can_change(
            &manager,
            &registry,
            &package.manifest.driver_id,
            Some(&package.manifest.package_version),
        )
        .await?;
        registry.activate_package(
            &package.manifest.driver_id,
            &package.manifest.package_version,
        )?;
    }
    let package = registry
        .list_installed()
        .into_iter()
        .find(|installed| {
            installed.manifest.driver_id == package.manifest.driver_id
                && installed.manifest.package_version == package.manifest.package_version
        })
        .ok_or_else(|| "Installed driver package cannot be resolved".to_string())?;
    Ok(Response::ok(external_driver_installation(
        &registry, package,
    )))
}

/// Install an explicitly selected release from a verified driver catalog.
///
/// The registry verifies the catalog signature, the catalog-bound archive
/// digest, the extracted package boundaries, and the package manifest before
/// this command decides whether it can become active for new connections.
#[tauri::command]
pub async fn install_external_database_driver_from_catalog(
    manager: State<'_, ConnectionManager>,
    registry: State<'_, DatabaseDriverPackageRegistry>,
    catalog_url: String,
    driver: String,
    package_version: String,
    activate: bool,
) -> Result<Response<DatabaseDriverInstallation>, String> {
    let package = registry
        .install_from_signed_catalog(catalog_url.trim(), driver.trim(), package_version.trim())
        .await?;
    let driver_id = package.manifest.driver_id.clone();
    let installed_version = package.manifest.package_version.clone();
    if activate {
        ensure_active_package_can_change(&manager, &registry, &driver_id, Some(&installed_version))
            .await?;
        registry.activate_package(&driver_id, &installed_version)?;
    }
    let package = registry
        .list_installed()
        .into_iter()
        .find(|installed| {
            installed.manifest.driver_id == driver_id
                && installed.manifest.package_version == installed_version
        })
        .ok_or_else(|| "Installed driver package cannot be resolved".to_string())?;
    Ok(Response::ok(external_driver_installation(
        &registry, package,
    )))
}

#[tauri::command]
pub async fn activate_external_database_driver(
    manager: State<'_, ConnectionManager>,
    registry: State<'_, DatabaseDriverPackageRegistry>,
    driver: String,
    package_version: String,
) -> Result<Response<DriverActivationState>, String> {
    ensure_active_package_can_change(
        &manager,
        &registry,
        driver.trim(),
        Some(package_version.trim()),
    )
    .await?;
    Ok(Response::ok(
        registry.activate_package(driver.trim(), package_version.trim())?,
    ))
}

#[tauri::command]
pub async fn rollback_external_database_driver(
    manager: State<'_, ConnectionManager>,
    registry: State<'_, DatabaseDriverPackageRegistry>,
    driver: String,
) -> Result<Response<DriverActivationState>, String> {
    ensure_active_package_can_change(&manager, &registry, driver.trim(), None).await?;
    Ok(Response::ok(registry.rollback_package(driver.trim())?))
}

#[tauri::command]
pub async fn probe_external_database_driver(
    registry: State<'_, DatabaseDriverPackageRegistry>,
    driver: String,
) -> Result<Response<DatabaseDriverProbeResult>, String> {
    let package = registry.resolve_active(driver.trim())?;
    let sidecar =
        DatabaseDriverSidecar::spawn(&package, &registry, env!("CARGO_PKG_VERSION")).await?;
    let capabilities = sidecar.capabilities().clone();
    sidecar.terminate().await;
    let table_export_formats = package
        .manifest
        .capabilities
        .as_ref()
        .map(|declared| {
            declared
                .table_export_formats
                .iter()
                .filter(|format| HOST_TABLE_EXPORT_FORMATS.contains(&format.as_str()))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    Ok(Response::ok(DatabaseDriverProbeResult {
        driver: package.manifest.driver_id,
        package_version: package.manifest.package_version,
        protocol_version: package.manifest.protocol_version,
        supports_metadata: capabilities.metadata,
        supports_query: capabilities.query,
        supports_cancellation: capabilities.cancellation,
        supports_transactions: capabilities.transactions,
        supports_database_scoped_queries: capabilities.database_scoped_queries,
        supports_database_creation: capabilities.database_creation,
        supports_table_row_mutation: package
            .manifest
            .capabilities
            .as_ref()
            .is_some_and(|declared| declared.supports_table_row_mutation)
            && capabilities.transactions,
        supports_table_data_transfer: package
            .manifest
            .capabilities
            .as_ref()
            .is_some_and(|declared| declared.supports_table_data_transfer)
            && capabilities.transactions,
        table_export_formats,
        supports_agent_read_only_enforcement: capabilities.read_only_enforcement,
        supports_referencing_foreign_keys: capabilities.referencing_foreign_keys,
        supports_semantic_schema_migration: package.manifest.schema_migration.is_some()
            && capabilities.semantic_schema_migration,
    }))
}
