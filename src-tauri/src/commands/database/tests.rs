use super::*;
use crate::core::{
    dialect::{all_database_capabilities, DatabaseKind},
    manager::LiveConnectionCapabilitySnapshot,
};
use oxide_driver_protocol::SchemaMigrationMode;

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
        create_database_sql(DatabaseKind::Mysql, "app", Some("utf8mb4;DROP"), None, None).is_err()
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
            managed: false,
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
            managed: false,
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
            managed: false,
            external_driver_id: None,
            package_version: None,
            package_capabilities: None,
            server_version: Some("11.4".to_string()),
            semantic_schema_migration_mode: None,
            has_exact_semantic_schema_migration_evidence: false,
        },
    )
    .unwrap();
    let sqlite = connection_database_capability_context(
        "sqlite-1".to_string(),
        LiveConnectionCapabilitySnapshot {
            driver_id: Some("sqlite".to_string()),
            managed: false,
            external_driver_id: None,
            package_version: None,
            package_capabilities: None,
            server_version: Some("3.50.4".to_string()),
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
    assert_eq!(
        sqlite.schema_migration_mode,
        SchemaMigrationCapabilityMode::Transactional
    );
}

#[test]
fn managed_capability_context_is_not_classified_as_a_local_bundle() {
    let mut capabilities = DatabaseKind::Postgres.capabilities();
    capabilities.supports_table_row_mutation = false;
    capabilities.supports_table_ddl = false;
    capabilities.table_export_formats.clear();
    let context = connection_database_capability_context(
        "managed-postgres".to_string(),
        LiveConnectionCapabilitySnapshot {
            driver_id: Some("postgres".to_string()),
            managed: true,
            external_driver_id: None,
            package_version: None,
            package_capabilities: Some(capabilities),
            server_version: None,
            semantic_schema_migration_mode: None,
            has_exact_semantic_schema_migration_evidence: false,
        },
    )
    .unwrap();

    assert_eq!(context.distribution, "managed");
    assert_eq!(
        context.schema_migration_mode,
        SchemaMigrationCapabilityMode::ReviewOnly
    );
    assert!(!context.capabilities.supports_table_row_mutation);
    assert!(!context.capabilities.supports_table_ddl);
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
