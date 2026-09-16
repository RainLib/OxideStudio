use super::super::*;
use super::support::*;
use oxide_driver_protocol::DriverRuntimeCapabilities;

#[test]
fn handshake_must_match_the_verified_manifest() {
    let directory = tempfile::tempdir().unwrap();
    write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
    let package =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
            .resolve_active("clickhouse")
            .unwrap();
    let mut response = HandshakeResponse {
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        package_id: package.manifest.package_id.clone(),
        package_version: package.manifest.package_version.clone(),
        driver_id: package.manifest.driver_id.clone(),
        capabilities: DriverRuntimeCapabilities {
            query: true,
            ..DriverRuntimeCapabilities::default()
        },
    };
    assert!(validate_handshake(&package.manifest, &response).is_ok());

    response.package_version = "9.9.9".to_string();
    assert!(validate_handshake(&package.manifest, &response).is_err());
}

#[test]
fn handshake_cannot_downgrade_signed_runtime_capabilities() {
    let directory = tempfile::tempdir().unwrap();
    write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
    let mut package =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
            .resolve_active("clickhouse")
            .unwrap();
    package.manifest.capabilities = Some(
        serde_json::from_value(serde_json::json!({
            "driver": "clickhouse",
            "displayName": "ClickHouse",
            "dataModel": "relational",
            "lspLanguageId": "sql",
            "namespaceLabel": "database",
            "identifierQuote": "`",
            "defaultPort": 8123,
            "supportsSqlQuery": true,
            "supportsTableBrowsing": true,
            "supportsCollectionBrowsing": false,
            "supportsKeyValueBrowsing": false,
            "supportsSchemas": true,
            "supportsCreateDatabase": false,
            "supportsCreateDatabaseCharset": false,
            "supportsColumnComments": false,
            "supportsInlineColumnComments": false,
            "supportsRenameDatabase": false,
            "supportsViews": true,
            "supportsReplaceView": false,
            "supportsMaterializedViews": true,
            "supportsTableIndexes": false,
            "supportsTableConstraints": false,
            "supportsForeignKeys": false,
            "supportsCheckConstraints": false,
            "supportsFunctions": false,
            "supportsTransactions": true,
            "supportsQueryCancellation": true,
            "supportsExplainPlan": true,
            "autoIncrementKeyword": null,
            "defaultPrimaryKeyType": "UInt64",
            "commonDataTypes": ["UInt64", "String"]
        }))
        .unwrap(),
    );
    let mut response = HandshakeResponse {
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        package_id: package.manifest.package_id.clone(),
        package_version: package.manifest.package_version.clone(),
        driver_id: package.manifest.driver_id.clone(),
        capabilities: DriverRuntimeCapabilities {
            query: true,
            ..DriverRuntimeCapabilities::default()
        },
    };
    assert!(validate_handshake(&package.manifest, &response)
        .unwrap_err()
        .contains("Explorer metadata"));

    {
        let capabilities = package.manifest.capabilities.as_mut().unwrap();
        capabilities.supports_table_browsing = false;
        capabilities.supports_schemas = false;
        capabilities.supports_transactions = false;
        capabilities.supports_query_cancellation = false;
        capabilities.supports_foreign_keys = true;
    }
    assert!(validate_handshake(&package.manifest, &response)
        .unwrap_err()
        .contains("foreign-key navigation"));

    response.capabilities.referencing_foreign_keys = true;
    package
        .manifest
        .capabilities
        .as_mut()
        .unwrap()
        .supports_create_database = true;
    assert!(validate_handshake(&package.manifest, &response)
        .unwrap_err()
        .contains("database creation"));

    package
        .manifest
        .capabilities
        .as_mut()
        .unwrap()
        .supports_create_database = false;
    package
        .manifest
        .capabilities
        .as_mut()
        .unwrap()
        .supports_database_catalogs = true;
    assert!(validate_handshake(&package.manifest, &response)
        .unwrap_err()
        .contains("database catalogs"));

    response.capabilities.database_scoped_queries = true;
    assert!(validate_handshake(&package.manifest, &response).is_ok());
}

#[test]
fn table_row_mutation_requires_transactions_in_both_contracts() {
    let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
        .expect("postgres capability fixture should exist");
    capabilities.driver = "clickhouse".to_string();
    capabilities.supports_transactions = false;

    assert!(validate_capability_contract("clickhouse", &capabilities)
        .unwrap_err()
        .contains("Table row mutation requires"));

    capabilities.supports_transactions = true;
    let manifest = DriverPackageManifest {
        schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
        package_id: "oxide.clickhouse".to_string(),
        package_version: "1.2.3".to_string(),
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        driver_id: "clickhouse".to_string(),
        display_name: "ClickHouse".to_string(),
        client_library: "clickhouse-rs".to_string(),
        client_version: "0.13.0".to_string(),
        entrypoint: "driver".to_string(),
        sha256: "a".repeat(64),
        runtime: DriverPackageRuntime::Native,
        supported_targets: Vec::new(),
        server_version_range: None,
        connection_url_template: None,
        capabilities: Some(capabilities),
        schema_migration: None,
    };
    let response = HandshakeResponse {
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        package_id: manifest.package_id.clone(),
        package_version: manifest.package_version.clone(),
        driver_id: manifest.driver_id.clone(),
        capabilities: DriverRuntimeCapabilities {
            query: true,
            metadata: true,
            ..DriverRuntimeCapabilities::default()
        },
    };
    assert!(validate_handshake(&manifest, &response)
        .unwrap_err()
        .contains("table row mutation"));
}

#[test]
fn semantic_migration_requires_signed_runtime_and_evidence_contracts() {
    let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
        .expect("postgres capability fixture should exist");
    capabilities.driver = "warehouse".to_string();
    let contract = DriverPackageSchemaMigrationContract {
        snapshot_version: 1,
        mode: SchemaMigrationMode::Transactional,
    };
    assert!(validate_schema_migration_contract(Some(&capabilities), Some(&contract)).is_ok());

    let conformance = DriverPackageConformance {
        connect: vec!["1.0".to_string()],
        migration: vec!["1.0".to_string()],
        ..DriverPackageConformance::default()
    };
    assert!(
        validate_conformance_capability_contract(Some(&capabilities), None, &conformance,)
            .unwrap_err()
            .contains("semantic schema-migration contract")
    );
    assert!(validate_conformance_capability_contract(
        Some(&capabilities),
        Some(&contract),
        &conformance,
    )
    .is_ok());

    let manifest = DriverPackageManifest {
        schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
        package_id: "oxide.warehouse".to_string(),
        package_version: "1.0.0".to_string(),
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        driver_id: "warehouse".to_string(),
        display_name: "Warehouse".to_string(),
        client_library: "warehouse-client".to_string(),
        client_version: "1.0".to_string(),
        entrypoint: "driver".to_string(),
        sha256: "a".repeat(64),
        runtime: DriverPackageRuntime::Native,
        supported_targets: Vec::new(),
        server_version_range: None,
        connection_url_template: None,
        capabilities: Some(capabilities),
        schema_migration: Some(contract),
    };
    let mut response = HandshakeResponse {
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        package_id: manifest.package_id.clone(),
        package_version: manifest.package_version.clone(),
        driver_id: manifest.driver_id.clone(),
        capabilities: DriverRuntimeCapabilities {
            query: true,
            metadata: true,
            cancellation: true,
            transactions: true,
            database_scoped_queries: true,
            database_creation: true,
            referencing_foreign_keys: true,
            ..DriverRuntimeCapabilities::default()
        },
    };
    assert!(validate_handshake(&manifest, &response)
        .unwrap_err()
        .contains("semantic schema migration"));
    response.capabilities.semantic_schema_migration = true;
    assert!(validate_handshake(&manifest, &response).is_ok());
}

#[test]
fn table_data_transfer_requires_an_explicit_reviewed_contract() {
    let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
        .expect("postgres capability fixture should exist");
    capabilities.driver = "warehouse".to_string();
    capabilities.supports_table_data_transfer = true;
    capabilities.table_export_formats.clear();
    capabilities.supports_table_browsing = false;
    assert!(validate_capability_contract("warehouse", &capabilities)
        .unwrap_err()
        .contains("Table data transfer requires table browsing and transactions"));

    capabilities.supports_table_browsing = true;
    capabilities.supports_transactions = true;
    capabilities.lsp_language_id = "sql".to_string();
    capabilities.table_export_formats.clear();
    assert!(validate_capability_contract("warehouse", &capabilities)
        .unwrap_err()
        .contains("reviewed postgres, mysql, sqlite, or duckdb dialect"));

    capabilities.lsp_language_id = "postgres".to_string();
    assert!(validate_capability_contract("warehouse", &capabilities).is_ok());
}

#[test]
fn generic_sql_capabilities_may_select_only_a_reviewed_lsp_server_dialect() {
    let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
        .expect("postgres capability fixture should exist");
    capabilities.driver = "doris".to_string();
    capabilities.lsp_language_id = "sql".to_string();
    capabilities.lsp_server_dialect = Some("mysql".to_string());
    // This test exercises LSP routing only. Cross-connection transfer is
    // intentionally stricter and requires a dedicated document dialect.
    capabilities.supports_table_data_transfer = false;
    capabilities.table_export_formats.clear();
    assert!(validate_capability_contract("doris", &capabilities).is_ok());

    capabilities.lsp_server_dialect = Some("doris".to_string());
    assert!(validate_capability_contract("doris", &capabilities).is_ok());

    capabilities.driver = "argo".to_string();
    capabilities.lsp_server_dialect = Some("argo".to_string());
    assert!(validate_capability_contract("argo", &capabilities).is_ok());

    capabilities.lsp_server_dialect = Some("vendor-private".to_string());
    assert!(validate_capability_contract("argo", &capabilities)
        .unwrap_err()
        .contains("not supported"));

    capabilities.lsp_server_dialect = Some("  ".to_string());
    assert!(validate_capability_contract("argo", &capabilities)
        .unwrap_err()
        .contains("must not be empty"));

    capabilities.lsp_server_dialect = Some("mysql".to_string());
    capabilities.lsp_language_id = "postgres".to_string();
    assert!(validate_capability_contract("argo", &capabilities)
        .unwrap_err()
        .contains("must match its document language"));
}

#[test]
fn capability_identifier_quote_is_limited_to_host_supported_delimiters() {
    let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
        .expect("postgres capability fixture should exist");
    capabilities.driver = "sqlserver".to_string();
    capabilities.identifier_quote = "[".to_string();
    assert!(validate_capability_contract("sqlserver", &capabilities).is_ok());

    capabilities.identifier_quote = "] ; DROP TABLE users; --".to_string();
    assert!(validate_capability_contract("sqlserver", &capabilities)
        .unwrap_err()
        .contains("identifier quote is not supported"));
}

#[test]
fn non_relational_packages_cannot_claim_the_relational_table_editor() {
    let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
        .expect("postgres capability fixture should exist");
    capabilities.driver = "neo4j".to_string();
    capabilities.data_model = crate::core::dialect::DatabaseDataModel::Graph;
    capabilities.table_export_formats.clear();

    assert!(validate_capability_contract("neo4j", &capabilities)
        .unwrap_err()
        .contains("relational Table Editor"));

    capabilities.supports_table_browsing = false;
    capabilities.supports_table_row_mutation = false;
    capabilities.supports_table_data_transfer = false;
    capabilities.supports_table_ddl = false;
    capabilities.supports_column_alteration = false;
    capabilities.supports_index_rename = false;
    capabilities.supports_constraint_alteration = false;
    capabilities.table_export_formats.clear();
    assert!(validate_capability_contract("neo4j", &capabilities).is_ok());
}

#[test]
fn table_export_formats_require_a_reviewed_unique_contract() {
    let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
        .expect("postgres capability fixture should exist");
    capabilities.driver = "warehouse".to_string();
    capabilities.table_export_formats = vec!["parquet".to_string(), "arrow".to_string()];
    assert!(validate_capability_contract("warehouse", &capabilities).is_ok());

    capabilities.table_export_formats = vec!["csv".to_string(), "csv".to_string()];
    assert!(validate_capability_contract("warehouse", &capabilities)
        .unwrap_err()
        .contains("duplicate"));

    capabilities.table_export_formats = vec!["vendor-binary".to_string()];
    assert!(validate_capability_contract("warehouse", &capabilities)
        .unwrap_err()
        .contains("unsupported"));

    capabilities.table_export_formats = vec!["csv".to_string()];
    capabilities.lsp_language_id = "sql".to_string();
    assert!(validate_capability_contract("warehouse", &capabilities)
        .unwrap_err()
        .contains("reviewed postgres, mysql, sqlite, or duckdb paging dialect"));
}
