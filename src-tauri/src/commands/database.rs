use crate::core::{
    config::ConfigManager,
    dialect::{
        all_database_capabilities, canonical_driver_name, database_capabilities_for_driver,
        retain_host_table_export_formats, DatabaseCapabilities, DatabaseConnectionMode,
        DatabaseDataModel, DatabaseKind, HOST_TABLE_EXPORT_FORMATS,
    },
    driver_package::{
        DatabaseDriverPackageRegistry, DriverActivationState, DriverPackageCachePruneResult,
        DriverPackageCatalog, DriverPackageRuntime, DriverPackageStatus, InstalledDriverPackage,
        ManagedJavaRuntimeInstallation,
    },
    driver_sidecar::DatabaseDriverSidecar,
    manager::{ConnectionManager, ExternalDriverRuntimeSummary, LiveConnectionCapabilitySnapshot},
    protocol::{DatabaseCreateRequest, Response},
    store::MetaStore,
};
use oxide_driver_protocol::SchemaMigrationMode;
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::str::FromStr;
use tauri::State;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverInstallation {
    pub driver: String,
    pub display_name: String,
    pub client_library: String,
    pub client_version: String,
    pub distribution: String,
    pub update_policy: String,
    pub independently_updatable: bool,
    pub server_version_policy: String,
    pub implementation: String,
    pub runtime: String,
    pub runtime_ready: Option<bool>,
    pub package_version: Option<String>,
    pub protocol_version: Option<String>,
    pub active: bool,
    pub can_rollback: bool,
    pub status: String,
    pub status_message: Option<String>,
    /// Signed package-owned template for drivers whose connection URL is not
    /// expressible as the generic `scheme://host/database` form.
    pub connection_url_template: Option<String>,
    pub capabilities: Option<DatabaseCapabilities>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverProbeResult {
    pub driver: String,
    pub package_version: String,
    pub protocol_version: String,
    pub supports_metadata: bool,
    pub supports_query: bool,
    pub supports_cancellation: bool,
    pub supports_transactions: bool,
    pub supports_database_scoped_queries: bool,
    pub supports_database_creation: bool,
    /// Effective Data Editor support. This intentionally combines the signed
    /// package contract with the startup-verified transaction runtime.
    pub supports_table_row_mutation: bool,
    /// Effective cross-connection table transfer support. This remains a
    /// separate signal so package verification never conflates Grid editing
    /// with source paging and partial-commit transfer semantics.
    pub supports_table_data_transfer: bool,
    /// Effective Host-owned formats after intersecting the signed declaration
    /// with encoders compiled into this application build.
    pub table_export_formats: Vec<String>,
    /// External Agent connections may receive credentials only when this is
    /// true, because the sidecar independently enforces read-only mode.
    pub supports_agent_read_only_enforcement: bool,
    pub supports_referencing_foreign_keys: bool,
    /// Effective only when the signed package contract and the launched
    /// sidecar handshake both expose the semantic migration protocol.
    pub supports_semantic_schema_migration: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaMigrationCapabilityMode {
    Transactional,
    NonTransactional,
    ReviewOnly,
}

/// Connection-scoped capability contract consumed by editor intelligence,
/// migration review and other feature gates. Unlike the product catalogue,
/// this describes the exact live driver instance and negotiated server.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDatabaseCapabilityContext {
    pub connection_id: String,
    pub driver: String,
    pub distribution: String,
    pub package_version: Option<String>,
    pub server_version: Option<String>,
    pub schema_migration_mode: SchemaMigrationCapabilityMode,
    pub capabilities: DatabaseCapabilities,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverCatalog {
    pub catalog: DriverPackageCatalog,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverStoreInfo {
    pub active_path: String,
    pub restart_required: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverRuntimeSummary {
    pub driver: String,
    pub package_version: String,
    pub connection_count: usize,
    pub process_ids: Vec<u32>,
    pub unavailable_process_count: usize,
    pub unhealthy_connection_count: usize,
    pub launch_count: u64,
    pub observed_exit_count: u64,
    pub last_started_at_millis: Option<u64>,
    pub last_exit_observed_at_millis: Option<u64>,
}

impl From<ExternalDriverRuntimeSummary> for DatabaseDriverRuntimeSummary {
    fn from(value: ExternalDriverRuntimeSummary) -> Self {
        Self {
            driver: value.driver,
            package_version: value.package_version,
            connection_count: value.connection_count,
            process_ids: value.process_ids,
            unavailable_process_count: value.unavailable_process_count,
            unhealthy_connection_count: value.unhealthy_connection_count,
            launch_count: value.launch_count,
            observed_exit_count: value.observed_exit_count,
            last_started_at_millis: value.last_started_at_millis,
            last_exit_observed_at_millis: value.last_exit_observed_at_millis,
        }
    }
}

fn bundled_database_driver_installations() -> Vec<DatabaseDriverInstallation> {
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

fn conservative_external_database_capabilities(
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

fn fallback_external_database_capabilities(
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

fn schema_migration_capability_mode(
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
    match DatabaseKind::from_str(driver) {
        Ok(DatabaseKind::Postgres) => SchemaMigrationCapabilityMode::Transactional,
        Ok(DatabaseKind::Mysql) => SchemaMigrationCapabilityMode::NonTransactional,
        Err(_) => SchemaMigrationCapabilityMode::ReviewOnly,
    }
}

fn connection_database_capability_context(
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
        schema_migration_mode: schema_migration_capability_mode(
            &driver,
            external_package,
            snapshot.semantic_schema_migration_mode,
            snapshot.has_exact_semantic_schema_migration_evidence,
        ),
        driver,
        distribution: if external_package {
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
fn active_external_database_capabilities(
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

fn canonical_capability_driver(driver: &str) -> String {
    let requested = driver.trim();
    canonical_driver_name(requested)
        .unwrap_or(requested)
        .to_ascii_lowercase()
}

fn has_active_external_package(registry: &DatabaseDriverPackageRegistry, driver: &str) -> bool {
    registry
        .list_installed()
        .into_iter()
        .any(|package| package.active && package.manifest.driver_id.eq_ignore_ascii_case(driver))
}

fn replace_runtime_capabilities(
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

fn resolved_database_capabilities(
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

fn validate_token(value: &str, field: &str) -> Result<(), String> {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        Ok(())
    } else {
        Err(format!("Invalid {field}: {value}"))
    }
}

fn validate_namespace_name(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Database name is required".to_string());
    }

    Ok(value)
}

fn validate_external_create_option(
    value: Option<String>,
    field: &str,
) -> Result<Option<String>, String> {
    let Some(value) = value.map(|value| value.trim().to_string()) else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > 256 || value.contains('\0') {
        return Err(format!("Invalid {field}"));
    }
    Ok(Some(value))
}

fn ensure_host_managed_namespace_mutation(
    capabilities: Option<DatabaseCapabilities>,
    operation: &str,
) -> Result<(), String> {
    if let Some(capabilities) = capabilities {
        return Err(format!(
            "{} does not provide a verified semantic namespace {operation} operation",
            capabilities.display_name
        ));
    }
    Ok(())
}

fn is_protected_namespace(kind: DatabaseKind, value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    match kind {
        DatabaseKind::Postgres => {
            normalized == "information_schema"
                || normalized == "pg_catalog"
                || normalized == "pg_toast"
                || normalized.starts_with("pg_temp_")
                || normalized.starts_with("pg_toast_temp_")
        }
        DatabaseKind::Mysql => {
            matches!(
                normalized.as_str(),
                "information_schema" | "mysql" | "performance_schema" | "sys"
            )
        }
    }
}

fn ensure_mutable_namespace(kind: DatabaseKind, value: &str) -> Result<&str, String> {
    let value = validate_namespace_name(value)?;
    if is_protected_namespace(kind, value) {
        return Err(format!(
            "System database/schema cannot be modified: {value}"
        ));
    }

    Ok(value)
}

fn create_database_sql(
    kind: DatabaseKind,
    database: &str,
    charset: Option<&str>,
    collation: Option<&str>,
    owner: Option<&str>,
) -> Result<String, String> {
    let database = ensure_mutable_namespace(kind, database)?;
    let mut sql = match kind {
        DatabaseKind::Postgres => {
            let mut sql = format!("CREATE SCHEMA {}", kind.quote_identifier(database));
            if let Some(owner) = owner.map(str::trim).filter(|value| !value.is_empty()) {
                sql.push_str(" AUTHORIZATION ");
                sql.push_str(&kind.quote_identifier(owner));
            }
            sql
        }
        DatabaseKind::Mysql => format!("CREATE DATABASE {}", kind.quote_identifier(database)),
    };

    if matches!(kind, DatabaseKind::Mysql) {
        if let Some(charset) = charset.map(str::trim).filter(|value| !value.is_empty()) {
            validate_token(charset, "charset")?;
            sql.push_str(" CHARACTER SET ");
            sql.push_str(charset);
        }

        if let Some(collation) = collation.map(str::trim).filter(|value| !value.is_empty()) {
            validate_token(collation, "collation")?;
            sql.push_str(" COLLATE ");
            sql.push_str(collation);
        }
    }

    sql.push(';');
    Ok(sql)
}

fn drop_database_sql(kind: DatabaseKind, database: &str, cascade: bool) -> Result<String, String> {
    let database = ensure_mutable_namespace(kind, database)?;
    match kind {
        DatabaseKind::Postgres => {
            let behavior = if cascade { " CASCADE" } else { " RESTRICT" };
            Ok(format!(
                "DROP SCHEMA {}{};",
                kind.quote_identifier(database),
                behavior
            ))
        }
        DatabaseKind::Mysql => Ok(format!(
            "DROP DATABASE {};",
            kind.quote_identifier(database)
        )),
    }
}

fn rename_database_sql(
    kind: DatabaseKind,
    old_name: &str,
    new_name: &str,
) -> Result<String, String> {
    let old_name = ensure_mutable_namespace(kind, old_name)?;
    let new_name = ensure_mutable_namespace(kind, new_name)?;
    if old_name == new_name {
        return Err("New database name must be different".to_string());
    }

    match kind {
        DatabaseKind::Postgres => Ok(format!(
            "ALTER SCHEMA {} RENAME TO {};",
            kind.quote_identifier(old_name),
            kind.quote_identifier(new_name)
        )),
        DatabaseKind::Mysql => Err(
            "MySQL does not support renaming databases safely; create a new database and move objects explicitly"
                .to_string(),
        ),
    }
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

/// Lists active connection-owned sidecars without exposing their connection
/// URLs, credentials, stderr, or process control surface.
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

/// Discover available external packages from an HTTPS, detached-signature
/// catalog. Discovery remains read-only; a separate explicit install command
/// is available only for entries that bind a package archive SHA-256.
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

fn external_driver_installation(
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

async fn ensure_active_package_can_change(
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

#[tauri::command]
pub async fn create_database(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    database: String,
    charset: Option<String>,
    collation: Option<String>,
    owner: Option<String>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        let external_capabilities = manager
            .package_capabilities(&connection_id)
            .await
            .map_err(|error| error.to_string())?;

        // A live external connection is always routed through its manifest-
        // bound semantic request, even if a renderer supplies a built-in
        // driver name. This prevents an untrusted command payload from
        // coercing a JDBC/sidecar driver into Host-generated PostgreSQL or
        // MySQL DDL.
        if external_capabilities.is_none() {
            let kind = DatabaseKind::from_str(&driver).map_err(|error| error.to_string())?;
            let sql = create_database_sql(
                kind,
                &database,
                charset.as_deref(),
                collation.as_deref(),
                owner.as_deref(),
            )?;
            manager
                .query(&connection_id, &sql, None, None, None)
                .await
                .map_err(|e| e.to_string())?;
            let label = match kind {
                DatabaseKind::Postgres => "Schema",
                DatabaseKind::Mysql => "Database",
            };
            return Ok(format!("{label} {} created", database.trim()));
        }

        // External packages receive a semantic namespace-create request, but
        // the Host still owns the capability gate.  This prevents a sidecar
        // implementation from exposing an undeclared CREATE operation merely
        // because a renderer invoked the command directly.
        let capabilities = external_capabilities.expect("external capability check above");
        if !capabilities.supports_create_database {
            return Err(format!(
                "{} does not support namespace creation",
                capabilities.display_name
            ));
        }
        if charset
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            && !capabilities.supports_create_database_charset
        {
            return Err(format!(
                "{} does not support namespace character sets",
                capabilities.display_name
            ));
        }
        if collation
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            && !capabilities.supports_create_database_collation
        {
            return Err(format!(
                "{} does not support namespace collations",
                capabilities.display_name
            ));
        }
        if owner
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            && !capabilities.supports_create_database_owner
        {
            return Err(format!(
                "{} does not support setting a namespace owner",
                capabilities.display_name
            ));
        }

        let request = DatabaseCreateRequest {
            name: validate_namespace_name(&database)?.to_string(),
            charset: validate_external_create_option(charset, "charset")?,
            collation: validate_external_create_option(collation, "collation")?,
            owner: validate_external_create_option(owner, "owner")?,
            namespace_kind: match capabilities
                .namespace_label
                .trim()
                .to_ascii_lowercase()
                .as_str()
            {
                "database" => Some("database".to_string()),
                "schema" => Some("schema".to_string()),
                _ => None,
            },
        };
        let name = request.name.clone();
        manager
            .create_database(&connection_id, request)
            .await
            .map_err(|error| error.to_string())?;
        Ok(format!("Namespace {name} created"))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("CREATE_DATABASE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_database(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    database: String,
    cascade: Option<bool>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        // Do not turn a renderer-provided `postgres`/`mysql` alias into raw
        // Host DDL for a connected external package. Unlike creation, the
        // current sidecar protocol has no semantic delete operation yet.
        ensure_host_managed_namespace_mutation(
            manager
                .package_capabilities(&connection_id)
                .await
                .map_err(|error| error.to_string())?,
            "deletion",
        )?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let database_name = ensure_mutable_namespace(kind, &database)?.to_string();
        let sql = drop_database_sql(kind, &database_name, cascade.unwrap_or(false))?;
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        manager
            .invalidate_schema(&connection_id, &database_name)
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!("Database/schema {} dropped", database_name))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("DROP_DATABASE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn rename_database(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    old_name: String,
    new_name: String,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        // See `drop_database`: no host-generated rename SQL may be routed
        // through an external runtime until the driver protocol carries a
        // separately declared semantic rename request.
        ensure_host_managed_namespace_mutation(
            manager
                .package_capabilities(&connection_id)
                .await
                .map_err(|error| error.to_string())?,
            "rename",
        )?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let old_name = ensure_mutable_namespace(kind, &old_name)?.to_string();
        let new_name = ensure_mutable_namespace(kind, &new_name)?.to_string();
        let sql = rename_database_sql(kind, &old_name, &new_name)?;
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        manager
            .invalidate_schema(&connection_id, &old_name)
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!(
            "Database/schema {} renamed to {}",
            old_name, new_name
        ))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("RENAME_DATABASE_ERROR", &error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_driver_specific_create_database_sql() {
        assert_eq!(
            create_database_sql(DatabaseKind::Postgres, "app", None, None, None).unwrap(),
            r#"CREATE SCHEMA "app";"#
        );
        assert_eq!(
            create_database_sql(
                DatabaseKind::Mysql,
                "app",
                Some("utf8mb4"),
                Some("utf8mb4_general_ci"),
                None
            )
            .unwrap(),
            "CREATE DATABASE `app` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
        );
    }

    #[test]
    fn rejects_unsafe_charset_tokens() {
        assert!(
            create_database_sql(DatabaseKind::Mysql, "app", Some("utf8mb4;DROP"), None, None)
                .is_err()
        );
    }

    #[test]
    fn bounds_external_creation_options_without_applying_a_native_dialect() {
        assert_eq!(
            validate_external_create_option(Some("  UTF8  ".to_string()), "charset").unwrap(),
            Some("UTF8".to_string())
        );
        assert_eq!(
            validate_external_create_option(Some("   ".to_string()), "owner").unwrap(),
            None
        );
        assert!(validate_external_create_option(Some("x".repeat(257)), "owner").is_err());
    }

    #[test]
    fn builds_postgres_schema_authorization() {
        assert_eq!(
            create_database_sql(
                DatabaseKind::Postgres,
                "app data",
                None,
                None,
                Some("app owner")
            )
            .unwrap(),
            r#"CREATE SCHEMA "app data" AUTHORIZATION "app owner";"#
        );
    }

    #[test]
    fn builds_driver_specific_drop_database_sql() {
        assert_eq!(
            drop_database_sql(DatabaseKind::Postgres, "app", true).unwrap(),
            r#"DROP SCHEMA "app" CASCADE;"#
        );
        assert_eq!(
            drop_database_sql(DatabaseKind::Mysql, "app", true).unwrap(),
            "DROP DATABASE `app`;"
        );
    }

    #[test]
    fn builds_supported_rename_database_sql() {
        assert_eq!(
            rename_database_sql(DatabaseKind::Postgres, "old_app", "new_app").unwrap(),
            r#"ALTER SCHEMA "old_app" RENAME TO "new_app";"#
        );
        assert!(rename_database_sql(DatabaseKind::Mysql, "old_app", "new_app").is_err());
    }

    #[test]
    fn rejects_protected_namespaces() {
        assert!(drop_database_sql(DatabaseKind::Postgres, "pg_catalog", true).is_err());
        assert!(drop_database_sql(DatabaseKind::Mysql, "mysql", true).is_err());
    }

    #[test]
    fn reports_the_real_bundled_driver_update_boundary() {
        let installations = bundled_database_driver_installations();
        assert_eq!(installations.len(), 6);
        assert!(installations.iter().all(|driver| {
            driver.distribution == "bundled"
                && driver.update_policy == "application-update"
                && !driver.independently_updatable
                && !driver.client_version.is_empty()
        }));
        assert_eq!(
            installations
                .iter()
                .find(|driver| driver.driver == "elasticsearch")
                .map(|driver| driver.client_library.as_str()),
            Some("reqwest")
        );
        assert_eq!(
            installations
                .iter()
                .find(|driver| driver.driver == "sqlite")
                .map(|driver| driver.client_library.as_str()),
            Some("sqlx-sqlite")
        );
    }

    #[test]
    fn activated_sidecar_capability_replaces_a_bundled_driver_alias() {
        let mut advertised = all_database_capabilities();
        let mut external = DatabaseKind::Postgres.capabilities();
        external.display_name = "PostgreSQL JDBC package".to_string();
        external.supports_table_row_mutation = false;
        external.supports_create_database = false;

        replace_runtime_capabilities(&mut advertised, external);

        let matching = advertised
            .iter()
            .filter(|capability| capability.driver == "postgres")
            .collect::<Vec<_>>();
        assert_eq!(matching.len(), 1);
        assert_eq!(matching[0].display_name, "PostgreSQL JDBC package");
        assert!(!matching[0].supports_table_row_mutation);
        assert!(!matching[0].supports_create_database);
    }

    #[test]
    fn capability_resolution_uses_the_connection_canonical_driver_id() {
        assert_eq!(canonical_capability_driver(" PostgreSQL "), "postgres");
        assert_eq!(canonical_capability_driver("MariaDB"), "mysql");
        assert_eq!(canonical_capability_driver("Trino"), "trino");
    }

    #[test]
    fn live_capability_context_keeps_package_version_server_and_migration_boundary_together() {
        let mut capabilities = DatabaseKind::Postgres.capabilities();
        capabilities.display_name = "Pinned PostgreSQL package".to_string();
        capabilities.supports_table_data_transfer = false;
        let context = connection_database_capability_context(
            "connection-1".to_string(),
            LiveConnectionCapabilitySnapshot {
                driver_id: Some("postgres".to_string()),
                external_driver_id: Some("postgres".to_string()),
                package_version: Some("16.4.1".to_string()),
                package_capabilities: Some(capabilities.clone()),
                server_version: Some("16.3".to_string()),
                semantic_schema_migration_mode: Some(SchemaMigrationMode::Transactional),
                has_exact_semantic_schema_migration_evidence: false,
            },
        )
        .unwrap();

        assert_eq!(context.connection_id, "connection-1");
        assert_eq!(context.distribution, "external");
        assert_eq!(context.package_version.as_deref(), Some("16.4.1"));
        assert_eq!(context.server_version.as_deref(), Some("16.3"));
        assert_eq!(
            context.schema_migration_mode,
            SchemaMigrationCapabilityMode::ReviewOnly
        );
        assert_eq!(context.capabilities, capabilities);
    }

    #[test]
    fn native_capability_context_advertises_only_verified_host_migration_modes() {
        let postgres = connection_database_capability_context(
            "postgres-1".to_string(),
            LiveConnectionCapabilitySnapshot {
                driver_id: Some("postgresql".to_string()),
                external_driver_id: None,
                package_version: None,
                package_capabilities: None,
                server_version: Some("17.1".to_string()),
                semantic_schema_migration_mode: None,
                has_exact_semantic_schema_migration_evidence: false,
            },
        )
        .unwrap();
        let mysql = connection_database_capability_context(
            "mysql-1".to_string(),
            LiveConnectionCapabilitySnapshot {
                driver_id: Some("mariadb".to_string()),
                external_driver_id: None,
                package_version: None,
                package_capabilities: None,
                server_version: Some("11.4".to_string()),
                semantic_schema_migration_mode: None,
                has_exact_semantic_schema_migration_evidence: false,
            },
        )
        .unwrap();

        assert_eq!(
            postgres.schema_migration_mode,
            SchemaMigrationCapabilityMode::Transactional
        );
        assert_eq!(
            mysql.schema_migration_mode,
            SchemaMigrationCapabilityMode::NonTransactional
        );
    }

    #[test]
    fn external_migration_mode_requires_exact_evidence_and_signed_mode() {
        assert_eq!(
            schema_migration_capability_mode(
                "warehouse",
                true,
                Some(SchemaMigrationMode::Transactional),
                false,
            ),
            SchemaMigrationCapabilityMode::ReviewOnly
        );
        assert_eq!(
            schema_migration_capability_mode(
                "warehouse",
                true,
                Some(SchemaMigrationMode::Transactional),
                true,
            ),
            SchemaMigrationCapabilityMode::Transactional
        );
        assert_eq!(
            schema_migration_capability_mode(
                "warehouse",
                true,
                Some(SchemaMigrationMode::NonTransactional),
                true,
            ),
            SchemaMigrationCapabilityMode::NonTransactional
        );
        assert_eq!(
            schema_migration_capability_mode("warehouse", true, None, true),
            SchemaMigrationCapabilityMode::ReviewOnly
        );
    }

    #[test]
    fn external_packages_cannot_receive_host_generated_namespace_mutations() {
        let mut external = DatabaseKind::Postgres.capabilities();
        external.display_name = "PostgreSQL JDBC package".to_string();

        assert!(ensure_host_managed_namespace_mutation(None, "deletion").is_ok());
        assert_eq!(
            ensure_host_managed_namespace_mutation(Some(external), "rename").unwrap_err(),
            "PostgreSQL JDBC package does not provide a verified semantic namespace rename operation"
        );
    }
}
