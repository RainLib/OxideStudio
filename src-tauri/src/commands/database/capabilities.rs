use crate::core::{
    dialect::{
        all_database_capabilities, canonical_driver_name, database_capabilities_for_driver,
        retain_host_table_export_formats, DatabaseCapabilities, DatabaseConnectionMode,
        DatabaseDataModel, DatabaseKind,
    },
    driver_package::{DatabaseDriverPackageRegistry, DriverPackageStatus, InstalledDriverPackage},
    manager::{ConnectionManager, LiveConnectionCapabilitySnapshot},
    protocol::Response,
};
use oxide_driver_protocol::SchemaMigrationMode;
use std::str::FromStr;
use tauri::State;

pub use super::models::{
    ConnectionDatabaseCapabilityContext, DatabaseDriverInstallation, SchemaMigrationCapabilityMode,
};

pub(super) fn bundled_database_driver_installations() -> Vec<DatabaseDriverInstallation> {
    let sqlx_version = env!("OXIDE_DRIVER_SQLX_VERSION");
    [
        (
            "postgres",
            "PostgreSQL",
            "sqlx-postgres",
            sqlx_version,
            "native Rust client",
        ),
        (
            "mysql",
            "MySQL",
            "sqlx-mysql",
            sqlx_version,
            "native Rust client",
        ),
        (
            "sqlite",
            "SQLite",
            "sqlx-sqlite",
            sqlx_version,
            "native Rust client",
        ),
        (
            "mongodb",
            "MongoDB",
            "mongodb",
            env!("OXIDE_DRIVER_MONGODB_VERSION"),
            "native Rust client",
        ),
        (
            "redis",
            "Redis",
            "redis",
            env!("OXIDE_DRIVER_REDIS_VERSION"),
            "native Rust client",
        ),
        (
            "elasticsearch",
            "Elasticsearch",
            "reqwest",
            env!("OXIDE_DRIVER_REQWEST_VERSION"),
            "OxideStudio HTTP adapter",
        ),
    ]
    .into_iter()
    .map(
        |(driver, display_name, client_library, client_version, implementation)| {
            DatabaseDriverInstallation {
                driver: driver.to_string(),
                display_name: display_name.to_string(),
                client_library: client_library.to_string(),
                client_version: client_version.to_string(),
                distribution: "bundled".to_string(),
                update_policy: "application-update".to_string(),
                independently_updatable: false,
                server_version_policy: "detected-at-connection".to_string(),
                implementation: implementation.to_string(),
                runtime: "Native Rust".to_string(),
                runtime_ready: None,
                package_version: None,
                protocol_version: None,
                active: true,
                can_rollback: false,
                status: "ready".to_string(),
                status_message: None,
                connection_url_template: None,
                capabilities: database_capabilities_for_driver(driver).ok(),
            }
        },
    )
    .collect()
}

pub(super) fn conservative_external_database_capabilities(
    driver: &str,
    display_name: &str,
) -> DatabaseCapabilities {
    DatabaseCapabilities {
        driver: driver.to_string(),
        display_name: display_name.to_string(),
        data_model: DatabaseDataModel::Relational,
        connection_mode: DatabaseConnectionMode::Network,
        lsp_language_id: "sql".to_string(),
        lsp_server_dialect: None,
        namespace_label: "schema".to_string(),
        identifier_quote: String::new(),
        default_port: 0,
        supports_sql_query: true,
        supports_table_browsing: false,
        table_export_formats: Vec::new(),
        file_query_formats: Vec::new(),
        supports_table_row_mutation: false,
        supports_table_data_transfer: false,
        supports_table_ddl: false,
        supports_column_alteration: false,
        supports_index_rename: false,
        supports_constraint_alteration: false,
        supports_collection_browsing: false,
        supports_key_value_browsing: false,
        supports_schemas: false,
        supports_database_catalogs: false,
        supports_connection_database: true,
        supports_create_database: false,
        supports_create_database_owner: false,
        supports_create_database_charset: false,
        supports_create_database_collation: false,
        supports_column_comments: false,
        supports_inline_column_comments: false,
        supports_rename_database: false,
        supports_views: false,
        supports_replace_view: false,
        supports_materialized_views: false,
        supports_table_indexes: false,
        supports_table_constraints: false,
        supports_foreign_keys: false,
        supports_check_constraints: false,
        supports_functions: false,
        supports_transactions: false,
        supports_query_cancellation: false,
        supports_explain_plan: false,
        auto_increment_keyword: None,
        default_primary_key_type: "INTEGER".to_string(),
        common_data_types: Vec::new(),
    }
}

pub(super) fn fallback_external_database_capabilities(
    package: &InstalledDriverPackage,
) -> DatabaseCapabilities {
    let mut capabilities = package.manifest.capabilities.clone().unwrap_or_else(|| {
        conservative_external_database_capabilities(
            &package.manifest.driver_id,
            &package.manifest.display_name,
        )
    });
    // A package may declare a future Parquet/Arrow mapping, but this build
    // exposes only encoders it can execute locally. The signed declaration is
    // preserved in the manifest; effective editor capabilities are narrowed.
    retain_host_table_export_formats(&mut capabilities);
    capabilities
}

pub(super) fn schema_migration_capability_mode(
    driver: &str,
    external_package: bool,
    signed_mode: Option<SchemaMigrationMode>,
    has_exact_evidence: bool,
) -> SchemaMigrationCapabilityMode {
    if external_package {
        if !has_exact_evidence {
            return SchemaMigrationCapabilityMode::ReviewOnly;
        }
        return match signed_mode {
            Some(SchemaMigrationMode::Transactional) => {
                SchemaMigrationCapabilityMode::Transactional
            }
            Some(SchemaMigrationMode::NonTransactional) => {
                SchemaMigrationCapabilityMode::NonTransactional
            }
            None => SchemaMigrationCapabilityMode::ReviewOnly,
        };
    }
    match canonical_driver_name(driver) {
        Some("postgres") => SchemaMigrationCapabilityMode::Transactional,
        Some("mysql") => SchemaMigrationCapabilityMode::NonTransactional,
        Some("sqlite") => SchemaMigrationCapabilityMode::Transactional,
        _ => SchemaMigrationCapabilityMode::ReviewOnly,
    }
}

pub(super) fn connection_database_capability_context(
    connection_id: String,
    snapshot: LiveConnectionCapabilitySnapshot,
) -> Result<ConnectionDatabaseCapabilityContext, String> {
    let external_package = snapshot.external_driver_id.is_some();
    let driver = snapshot
        .external_driver_id
        .as_deref()
        .or(snapshot.driver_id.as_deref())
        .map(canonical_capability_driver)
        .ok_or_else(|| {
            "The live connection does not expose a trusted driver identity".to_string()
        })?;
    let mut capabilities = match snapshot.package_capabilities {
        Some(capabilities) => capabilities,
        None if external_package => conservative_external_database_capabilities(
            &driver,
            &format!("{} external package", driver),
        ),
        None => DatabaseKind::from_str(&driver)
            .map(DatabaseKind::capabilities)
            .or_else(|_| {
                database_capabilities_for_driver(&driver).map_err(|error| error.to_string())
            })?,
    };
    retain_host_table_export_formats(&mut capabilities);

    Ok(ConnectionDatabaseCapabilityContext {
        connection_id,
        schema_migration_mode: if snapshot.managed {
            SchemaMigrationCapabilityMode::ReviewOnly
        } else {
            schema_migration_capability_mode(
                &driver,
                external_package,
                snapshot.semantic_schema_migration_mode,
                snapshot.has_exact_semantic_schema_migration_evidence,
            )
        },
        driver,
        distribution: if snapshot.managed {
            "managed".to_string()
        } else if external_package {
            "external".to_string()
        } else {
            "bundled".to_string()
        },
        package_version: snapshot.package_version,
        server_version: snapshot.server_version,
        capabilities,
    })
}

/// Capability lookups drive editor, LSP and Data Editor affordances. They
/// must describe the package a connection will actually launch (the active
/// package or its explicitly pinned version), never an arbitrary installed
/// version with the same driver id.
pub(super) fn active_external_database_capabilities(
    registry: &DatabaseDriverPackageRegistry,
    driver: &str,
    package_version: Option<&str>,
) -> Result<DatabaseCapabilities, String> {
    let package = match package_version
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(version) => registry.resolve_version(driver.trim(), version),
        None => registry.resolve_active(driver.trim()),
    }?;
    Ok(fallback_external_database_capabilities(&package))
}

pub(super) fn canonical_capability_driver(driver: &str) -> String {
    let requested = driver.trim();
    canonical_driver_name(requested)
        .unwrap_or(requested)
        .to_ascii_lowercase()
}

pub(super) fn has_active_external_package(
    registry: &DatabaseDriverPackageRegistry,
    driver: &str,
) -> bool {
    registry
        .list_installed()
        .into_iter()
        .any(|package| package.active && package.manifest.driver_id.eq_ignore_ascii_case(driver))
}

pub(super) fn replace_runtime_capabilities(
    capabilities: &mut Vec<DatabaseCapabilities>,
    replacement: DatabaseCapabilities,
) {
    // An activated sidecar is the connection implementation, including when
    // it intentionally shares a bundled id such as `postgres`.  Keeping the
    // bundled record here would advertise operations that the selected
    // package did not declare.
    capabilities.retain(|capability| !capability.driver.eq_ignore_ascii_case(&replacement.driver));
    capabilities.push(replacement);
}

pub(super) fn resolved_database_capabilities(
    registry: &DatabaseDriverPackageRegistry,
    driver: &str,
    package_version: Option<&str>,
) -> Result<DatabaseCapabilities, String> {
    let canonical_driver = canonical_capability_driver(driver);
    let package_version = package_version
        .map(str::trim)
        .filter(|value| !value.is_empty());

    // Match `connect_preferred_driver`: a pinned package always wins, and an
    // activated package replaces the bundled adapter.  Any verification
    // failure is returned to the caller instead of silently falling back to a
    // different client version.
    if package_version.is_some() || has_active_external_package(registry, &canonical_driver) {
        return active_external_database_capabilities(registry, &canonical_driver, package_version);
    }

    DatabaseKind::from_str(&canonical_driver)
        .map(DatabaseKind::capabilities)
        .or_else(|_| {
            database_capabilities_for_driver(&canonical_driver).map_err(|error| error.to_string())
        })
}

#[tauri::command]
pub async fn get_database_capabilities(
    driver: String,
    package_version: Option<String>,
    registry: State<'_, DatabaseDriverPackageRegistry>,
) -> Result<Response<DatabaseCapabilities>, String> {
    let result = resolved_database_capabilities(&registry, &driver, package_version.as_deref());

    match result {
        Ok(capabilities) => Ok(Response::ok(capabilities)),
        Err(error) => Ok(Response::err("DATABASE_CAPABILITIES_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn get_connection_database_capability_context(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Response<ConnectionDatabaseCapabilityContext>, String> {
    let result = manager
        .capability_snapshot(&connection_id)
        .await
        .map_err(|error| error.to_string())
        .and_then(|snapshot| {
            connection_database_capability_context(connection_id.clone(), snapshot)
        });

    match result {
        Ok(context) => Ok(Response::ok(context)),
        Err(error) => Ok(Response::err_with_details(
            "CONNECTION_DATABASE_CAPABILITY_CONTEXT_ERROR",
            &error,
            true,
            Some(serde_json::json!({ "connectionId": connection_id })),
        )),
    }
}

#[tauri::command]
pub async fn list_database_capabilities(
    registry: State<'_, DatabaseDriverPackageRegistry>,
) -> Result<Response<Vec<DatabaseCapabilities>>, String> {
    let mut capabilities = all_database_capabilities();
    for package in registry.list_installed() {
        if package.status != DriverPackageStatus::Ready || !package.active {
            continue;
        }
        replace_runtime_capabilities(
            &mut capabilities,
            fallback_external_database_capabilities(&package),
        );
    }
    capabilities.sort_by(|left, right| left.display_name.cmp(&right.display_name));
    Ok(Response::ok(capabilities))
}
