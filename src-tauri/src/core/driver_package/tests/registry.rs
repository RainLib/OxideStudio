use super::super::*;
use super::support::*;

#[test]
fn discovers_verified_active_package() {
    let directory = tempfile::tempdir().unwrap();
    write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
    let packages =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
            .list_installed();
    assert_eq!(packages.len(), 1);
    assert!(packages[0].active);
    assert_eq!(packages[0].status, DriverPackageStatus::Ready);
}

#[test]
fn legacy_capability_contract_defaults_new_opt_in_flags_to_false() {
    let mut capabilities = serde_json::to_value(
        crate::core::dialect::database_capabilities_for_driver("postgres").unwrap(),
    )
    .unwrap();
    let contract = capabilities
        .as_object_mut()
        .expect("capability contract should be an object");
    contract.remove("supportsTableRowMutation");
    contract.remove("supportsTableDdl");
    contract.remove("supportsCreateDatabaseOwner");
    contract.remove("supportsCreateDatabaseCollation");

    let manifest: DriverPackageManifest = serde_json::from_value(serde_json::json!({
        "schemaVersion": 1,
        "packageId": "oxide.clickhouse",
        "packageVersion": "1.2.3",
        "protocolVersion": DRIVER_PROTOCOL_VERSION,
        "driverId": "clickhouse",
        "displayName": "ClickHouse",
        "clientLibrary": "clickhouse-rs",
        "clientVersion": "0.13.0",
        "entrypoint": "driver",
        "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "capabilities": capabilities,
    }))
    .unwrap();

    let capabilities = manifest.capabilities.expect("capabilities should decode");
    assert!(!capabilities.supports_table_row_mutation);
    assert!(!capabilities.supports_table_ddl);
    assert!(!capabilities.supports_create_database_owner);
    assert!(!capabilities.supports_create_database_collation);
    assert_eq!(
        capabilities.connection_mode,
        crate::core::dialect::DatabaseConnectionMode::Network,
        "legacy external manifests must safely retain the network default"
    );
}

#[test]
fn unsigned_package_is_visible_but_cannot_be_resolved_for_execution() {
    let directory = tempfile::tempdir().unwrap();
    write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
    let registry =
        DatabaseDriverPackageRegistry::require_signature_for_tests(directory.path().into());

    let packages = registry.list_installed();
    assert_eq!(packages.len(), 1);
    assert_eq!(packages[0].status, DriverPackageStatus::Untrusted);
    assert!(packages[0]
        .status_message
        .as_deref()
        .unwrap_or_default()
        .contains("signing key"));
    assert!(registry.resolve_active("clickhouse").is_err());
}

#[test]
fn offline_install_activates_atomically_and_rolls_back_to_previous_version() {
    let source = tempfile::tempdir().unwrap();
    let registry_root = tempfile::tempdir().unwrap();
    write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
    let source_package = source.path().join("clickhouse").join("1.2.3");
    let registry =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(registry_root.path().to_path_buf());

    let installed = registry
        .install_from_directory(&source_package, true)
        .unwrap();
    assert_eq!(installed.manifest.package_version, "1.2.3");
    assert!(installed.active);

    let manifest_path = source_package.join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["packageVersion"] = serde_json::Value::String("1.2.4".to_string());
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    registry
        .install_from_directory(&source_package, true)
        .unwrap();
    assert_eq!(
        registry.activation_state("clickhouse"),
        Some(DriverActivationState {
            current: "1.2.4".to_string(),
            previous: Some("1.2.3".to_string()),
        })
    );

    let state = registry.rollback_package("clickhouse").unwrap();
    assert_eq!(state.current, "1.2.3");
    assert_eq!(state.previous.as_deref(), Some("1.2.4"));
    assert_eq!(
        registry
            .resolve_active("clickhouse")
            .unwrap()
            .manifest
            .package_version,
        "1.2.3"
    );
}

#[test]
fn offline_install_never_overwrites_an_existing_version() {
    let source = tempfile::tempdir().unwrap();
    let registry_root = tempfile::tempdir().unwrap();
    write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
    let source_package = source.path().join("clickhouse").join("1.2.3");
    let registry =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(registry_root.path().to_path_buf());

    registry
        .install_from_directory(&source_package, false)
        .unwrap();
    let error = registry
        .install_from_directory(&source_package, false)
        .unwrap_err();
    assert!(error.contains("already installed"));
}

#[test]
fn catalog_install_path_persists_host_owned_receipt() {
    let source = tempfile::tempdir().unwrap();
    let registry_root = tempfile::tempdir().unwrap();
    write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
    let source_package = source.path().join("clickhouse").join("1.2.3");
    let entry = DriverPackageCatalogEntry {
        driver_id: "clickhouse".to_string(),
        display_name: "ClickHouse".to_string(),
        package_version: "1.2.3".to_string(),
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        download_url: "https://drivers.example.com/clickhouse-1.2.3.tar.gz".to_string(),
        archive_sha256: Some("a".repeat(64)),
        supported_targets: vec![current_target()],
        server_version_range: Some(">=22".to_string()),
        release_notes_url: None,
        connection_url_template: None,
        capabilities: None,
        schema_migration: None,
        conformance: None,
        dependencies: Vec::new(),
    };
    let registry =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(registry_root.path().to_path_buf());

    let installed = registry
        .install_from_directory_with_catalog_entry(&source_package, false, Some(&entry))
        .unwrap();

    assert_eq!(installed.catalog_entry, Some(entry));
    assert!(installed
        .package_root
        .join(DRIVER_PACKAGE_CATALOG_RECEIPT)
        .is_file());
}

#[test]
fn offline_install_rejects_forged_catalog_receipt_from_package() {
    let source = tempfile::tempdir().unwrap();
    let registry_root = tempfile::tempdir().unwrap();
    write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
    let source_package = source.path().join("clickhouse").join("1.2.3");
    fs::write(
        source_package.join(DRIVER_PACKAGE_CATALOG_RECEIPT),
        b"untrusted package-owned receipt",
    )
    .unwrap();
    let registry =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(registry_root.path().to_path_buf());

    let error = registry
        .install_from_directory(&source_package, false)
        .unwrap_err();

    assert!(error.contains("reserved Host metadata"));
    assert!(registry.list_installed().is_empty());
}

#[test]
fn migration_evidence_requires_exact_server_and_platform() {
    let directory = tempfile::tempdir().unwrap();
    write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
    let mut package =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
            .resolve_active("clickhouse")
            .unwrap();
    package.manifest.schema_migration = Some(DriverPackageSchemaMigrationContract {
        snapshot_version: 1,
        mode: SchemaMigrationMode::Transactional,
    });
    let evidence = DriverPackageConformanceEvidence {
        schema_version: 1,
        runner_version: "1.1.0".to_string(),
        driver_id: package.manifest.driver_id.clone(),
        package_version: package.manifest.package_version.clone(),
        entrypoint_sha256: package.manifest.sha256.clone(),
        target: current_target(),
        server_version: "24.3.1".to_string(),
        fixture_id: "clickhouse-migration-v1".to_string(),
        fixture_sha256: "b".repeat(64),
        report_url: "https://drivers.example.com/evidence/clickhouse-24.3.1.json".to_string(),
        report_sha256: "c".repeat(64),
        operations: vec!["connect".to_string(), "migration".to_string()],
    };
    package.catalog_entry = Some(DriverPackageCatalogEntry {
        driver_id: package.manifest.driver_id.clone(),
        display_name: package.manifest.display_name.clone(),
        package_version: package.manifest.package_version.clone(),
        protocol_version: package.manifest.protocol_version.clone(),
        download_url: "https://drivers.example.com/clickhouse.tar.gz".to_string(),
        archive_sha256: Some("a".repeat(64)),
        supported_targets: package.manifest.supported_targets.clone(),
        server_version_range: package.manifest.server_version_range.clone(),
        release_notes_url: None,
        connection_url_template: None,
        capabilities: None,
        schema_migration: package.manifest.schema_migration.clone(),
        conformance: Some(DriverPackageConformance {
            connect: vec!["24.3.1".to_string()],
            migration: vec!["24.3.1".to_string()],
            evidence: vec![evidence],
            ..DriverPackageConformance::default()
        }),
        dependencies: Vec::new(),
    });

    assert!(package.has_exact_migration_evidence("24.3.1"));
    assert!(!package.has_exact_migration_evidence("24.3.2"));
    package
        .catalog_entry
        .as_mut()
        .unwrap()
        .conformance
        .as_mut()
        .unwrap()
        .evidence[0]
        .target = "*".to_string();
    assert!(!package.has_exact_migration_evidence("24.3.1"));
}

#[cfg(unix)]
#[test]
fn offline_install_rejects_symlinks_anywhere_in_the_package() {
    use std::os::unix::fs::symlink;

    let source = tempfile::tempdir().unwrap();
    let registry_root = tempfile::tempdir().unwrap();
    write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
    let source_package = source.path().join("clickhouse").join("1.2.3");
    symlink(
        source_package.join("driver"),
        source_package.join("driver-link"),
    )
    .unwrap();
    let registry =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(registry_root.path().to_path_buf());

    let error = registry
        .install_from_directory(&source_package, false)
        .unwrap_err();
    assert!(error.contains("symbolic links"));
    assert!(registry.list_installed().is_empty());
}

#[test]
fn rejects_digest_mismatch_without_executing_package() {
    let directory = tempfile::tempdir().unwrap();
    write_package(
        directory.path(),
        DRIVER_PROTOCOL_VERSION,
        Some(&"0".repeat(64)),
    );
    let packages =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
            .list_installed();
    assert_eq!(packages[0].status, DriverPackageStatus::Invalid);
    assert!(packages[0]
        .status_message
        .as_deref()
        .unwrap_or_default()
        .contains("digest"));
}

#[test]
fn reports_protocol_major_mismatch_as_incompatible() {
    let directory = tempfile::tempdir().unwrap();
    write_package(directory.path(), "2.0", None);
    let packages =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
            .list_installed();
    assert_eq!(packages[0].status, DriverPackageStatus::Incompatible);
}

#[test]
fn rejects_entrypoint_path_escape() {
    let manifest = DriverPackageManifest {
        schema_version: 1,
        package_id: "oxide.test".to_string(),
        package_version: "1.0.0".to_string(),
        protocol_version: "1.0".to_string(),
        driver_id: "test".to_string(),
        display_name: "Test".to_string(),
        client_library: "test".to_string(),
        client_version: "1".to_string(),
        entrypoint: "../outside".to_string(),
        sha256: "0".repeat(64),
        runtime: DriverPackageRuntime::Native,
        supported_targets: Vec::new(),
        server_version_range: None,
        connection_url_template: None,
        capabilities: None,
        schema_migration: None,
    };
    assert!(validate_manifest(&manifest, Path::new("/tmp/package")).is_err());
}

#[test]
fn java_runtime_requires_a_signed_in_package_classpath() {
    let directory = tempfile::tempdir().unwrap();
    let package = directory.path().join("package");
    fs::create_dir_all(package.join("lib")).unwrap();
    fs::write(package.join("agent.jar"), b"agent").unwrap();
    fs::write(package.join("lib/vendor.jar"), b"vendor-driver").unwrap();
    let runtime = DriverPackageRuntime::Java(DriverPackageJavaRuntime {
        java_major: 21,
        main_class: "studio.oxide.jdbc.DriverMain".to_string(),
        classpath: vec![DriverPackageClasspathEntry {
            path: "lib/vendor.jar".to_string(),
            sha256: format!("{:x}", Sha256::digest(b"vendor-driver")),
        }],
    });
    let manifest = DriverPackageManifest {
        schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
        package_id: "oxide.jdbc-fixture".to_string(),
        package_version: "1.0.0".to_string(),
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        driver_id: "jdbc-fixture".to_string(),
        display_name: "JDBC fixture".to_string(),
        client_library: "vendor-jdbc".to_string(),
        client_version: "1.0".to_string(),
        entrypoint: "agent.jar".to_string(),
        sha256: format!("{:x}", Sha256::digest(b"agent")),
        runtime: runtime.clone(),
        supported_targets: Vec::new(),
        server_version_range: None,
        connection_url_template: None,
        capabilities: None,
        schema_migration: None,
    };
    assert!(validate_manifest(&manifest, &package).is_ok());
    assert!(verify_runtime_dependencies(&package, &runtime).is_ok());

    fs::write(package.join("lib/vendor.jar"), b"tampered").unwrap();
    assert!(verify_runtime_dependencies(&package, &runtime)
        .unwrap_err()
        .contains("digest"));

    let mut unsupported = manifest;
    unsupported.runtime = DriverPackageRuntime::Java(DriverPackageJavaRuntime {
        java_major: 17,
        main_class: "studio.oxide.jdbc.DriverMain".to_string(),
        classpath: Vec::new(),
    });
    assert!(validate_manifest(&unsupported, &package)
        .unwrap_err()
        .contains("Java 21"));
}

#[test]
fn resolves_only_a_ready_active_package() {
    let directory = tempfile::tempdir().unwrap();
    write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
    let registry =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf());
    let package = registry.resolve_active("clickhouse").unwrap();
    assert_eq!(package.manifest.package_version, "1.2.3");

    write_package(
        directory.path(),
        DRIVER_PROTOCOL_VERSION,
        Some(&"0".repeat(64)),
    );
    assert!(registry.resolve_active("clickhouse").is_err());
}
