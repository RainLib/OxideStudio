use super::super::*;
use super::support::*;

#[test]
fn rejects_manifest_identity_that_does_not_match_installation_path() {
    let directory = tempfile::tempdir().unwrap();
    write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
    let manifest_path = directory
        .path()
        .join("clickhouse")
        .join("1.2.3")
        .join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["driverId"] = serde_json::Value::String("postgres".to_string());
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let packages =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
            .list_installed();
    assert_eq!(packages[0].status, DriverPackageStatus::Invalid);
    assert!(packages[0]
        .status_message
        .as_deref()
        .unwrap_or_default()
        .contains("installation directory"));
}

#[test]
fn rejects_capability_contract_for_another_driver() {
    let directory = tempfile::tempdir().unwrap();
    write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
    let manifest_path = directory
        .path()
        .join("clickhouse")
        .join("1.2.3")
        .join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["capabilities"] = serde_json::json!({
        "driver": "postgres",
        "displayName": "Incorrect",
        "dataModel": "relational",
        "lspLanguageId": "sql",
        "namespaceLabel": "schema",
        "identifierQuote": "\"",
        "defaultPort": 5432,
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
        "supportsMaterializedViews": false,
        "supportsTableIndexes": false,
        "supportsTableConstraints": false,
        "supportsForeignKeys": false,
        "supportsCheckConstraints": false,
        "supportsFunctions": false,
        "supportsTransactions": false,
        "supportsQueryCancellation": false,
        "supportsExplainPlan": false,
        "autoIncrementKeyword": null,
        "defaultPrimaryKeyType": "INTEGER",
        "commonDataTypes": []
    });
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let packages =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
            .list_installed();
    assert_eq!(packages[0].status, DriverPackageStatus::Invalid);
    assert!(packages[0]
        .status_message
        .as_deref()
        .unwrap_or_default()
        .contains("capability contract"));
}

#[test]
fn accepts_the_common_os_and_architecture_alias() {
    let directory = tempfile::tempdir().unwrap();
    write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
    let manifest_path = directory
        .path()
        .join("clickhouse")
        .join("1.2.3")
        .join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest["supportedTargets"] =
        serde_json::json!([current_target_aliases().last().cloned().unwrap()]);
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let packages =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
            .list_installed();
    assert_eq!(packages[0].status, DriverPackageStatus::Ready);
}

#[cfg(unix)]
#[test]
fn rejects_entrypoint_symlink_that_escapes_the_package() {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir().unwrap();
    write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
    let package_root = directory.path().join("clickhouse").join("1.2.3");
    let outside = directory.path().join("outside-driver");
    fs::write(&outside, b"driver-sidecar").unwrap();
    fs::remove_file(package_root.join("driver")).unwrap();
    symlink(&outside, package_root.join("driver")).unwrap();

    let packages =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
            .list_installed();
    assert_eq!(packages[0].status, DriverPackageStatus::Invalid);
    assert!(packages[0]
        .status_message
        .as_deref()
        .unwrap_or_default()
        .contains("outside its package"));
}

#[test]
fn managed_java_runtime_is_activated_and_revalidated_before_launch() {
    let directory = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let source_bin = source.path().join("bin");
    fs::create_dir_all(&source_bin).unwrap();
    let java = source_bin.join(if cfg!(windows) { "java.exe" } else { "java" });
    fs::write(&java, b"managed-java-fixture").unwrap();
    let runtime_manifest = ManagedJavaRuntimeManifest {
        schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
        runtime_kind: MANAGED_JAVA_RUNTIME_KIND.to_string(),
        java_major: 21,
        runtime_version: "21.0.3-fixture".to_string(),
        entrypoint: format!("bin/{}", java.file_name().unwrap().to_string_lossy()),
        sha256: format!("{:x}", Sha256::digest(b"managed-java-fixture")),
        supported_targets: vec![current_target()],
    };
    fs::write(
        source.path().join(MANAGED_JAVA_RUNTIME_MANIFEST),
        serde_json::to_vec_pretty(&runtime_manifest).unwrap(),
    )
    .unwrap();

    let package_root = directory.path().join("jdbc-test").join("1.0.0");
    fs::create_dir_all(&package_root).unwrap();
    fs::write(package_root.join("agent.jar"), b"agent").unwrap();
    let package = InstalledDriverPackage {
        manifest: DriverPackageManifest {
            schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
            package_id: "oxide.jdbc-test".to_string(),
            package_version: "1.0.0".to_string(),
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            driver_id: "jdbc-test".to_string(),
            display_name: "JDBC test".to_string(),
            client_library: "fixture".to_string(),
            client_version: "1".to_string(),
            entrypoint: "agent.jar".to_string(),
            sha256: format!("{:x}", Sha256::digest(b"agent")),
            runtime: DriverPackageRuntime::Java(DriverPackageJavaRuntime {
                java_major: 21,
                main_class: "studio.oxide.jdbc.DriverMain".to_string(),
                classpath: Vec::new(),
            }),
            supported_targets: vec![current_target()],
            server_version_range: None,
            connection_url_template: None,
            capabilities: None,
            schema_migration: None,
        },
        entrypoint: package_root.join("agent.jar"),
        package_root,
        active: true,
        status: DriverPackageStatus::Ready,
        status_message: None,
        catalog_entry: None,
    };
    let registry =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf());
    let installation = registry
        .install_managed_java_runtime_from_directory(source.path(), true)
        .unwrap();
    assert!(installation.active);
    let resolved = registry
        .resolve_managed_java_runtime_binary(&package, 21)
        .unwrap();
    assert_eq!(fs::read(&resolved).unwrap(), b"managed-java-fixture");

    fs::write(&resolved, b"modified").unwrap();
    assert!(registry
        .resolve_managed_java_runtime_binary(&package, 21)
        .unwrap_err()
        .contains("digest does not match"));
}

#[test]
fn store_migration_copies_without_replacing_the_running_registry() {
    let source = tempfile::tempdir().unwrap();
    let target_parent = tempfile::tempdir().unwrap();
    write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
    let registry =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(source.path().to_path_buf());
    let target = target_parent.path().join("migrated-driver-store");

    registry.stage_store_migration(&target).unwrap();

    assert_eq!(registry.root(), source.path());
    assert!(target
        .join("clickhouse")
        .join("1.2.3")
        .join("manifest.json")
        .exists());
    assert_eq!(
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(target)
            .list_installed()
            .len(),
        1,
    );
}
