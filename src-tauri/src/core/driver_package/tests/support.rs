use super::super::*;

pub(super) fn signed_jdbc_dependency(payload: &[u8]) -> DriverPackageCatalogDependency {
    DriverPackageCatalogDependency {
            coordinate: "org.postgresql:postgresql:42.7.7".to_string(),
            path: "lib/postgresql-42.7.7.jar".to_string(),
            download_url: "https://repo.maven.apache.org/maven2/org/postgresql/postgresql/42.7.7/postgresql-42.7.7.jar".to_string(),
            sha256: format!("{:x}", Sha256::digest(payload)),
            size_bytes: u64::try_from(payload.len()).unwrap(),
            license_spdx: "BSD-2-Clause".to_string(),
            license_url: "https://jdbc.postgresql.org/about/license.html".to_string(),
        }
}

pub(super) fn dependency_catalog_entry(
    dependency: DriverPackageCatalogDependency,
) -> DriverPackageCatalogEntry {
    DriverPackageCatalogEntry {
        driver_id: "jdbc-fixture".to_string(),
        display_name: "JDBC fixture".to_string(),
        package_version: "1.0.0".to_string(),
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        download_url: "https://drivers.example.com/jdbc-fixture-1.0.0.tar.gz".to_string(),
        archive_sha256: Some("a".repeat(64)),
        supported_targets: Vec::new(),
        server_version_range: None,
        release_notes_url: None,
        connection_url_template: None,
        capabilities: None,
        schema_migration: None,
        conformance: None,
        dependencies: vec![dependency],
    }
}

pub(super) fn dependency_manifest(
    dependency: &DriverPackageCatalogDependency,
) -> DriverPackageManifest {
    DriverPackageManifest {
        schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
        package_id: "oxide.jdbc-fixture".to_string(),
        package_version: "1.0.0".to_string(),
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        driver_id: "jdbc-fixture".to_string(),
        display_name: "JDBC fixture".to_string(),
        client_library: "postgresql-jdbc".to_string(),
        client_version: "42.7.7".to_string(),
        entrypoint: "agent.jar".to_string(),
        sha256: "b".repeat(64),
        runtime: DriverPackageRuntime::Java(DriverPackageJavaRuntime {
            java_major: 21,
            main_class: "studio.oxide.jdbc.DriverMain".to_string(),
            classpath: vec![DriverPackageClasspathEntry {
                path: dependency.path.clone(),
                sha256: dependency.sha256.clone(),
            }],
        }),
        supported_targets: Vec::new(),
        server_version_range: None,
        connection_url_template: None,
        capabilities: None,
        schema_migration: None,
    }
}

pub(super) fn write_package(root: &Path, protocol: &str, digest: Option<&str>) {
    let package_root = root.join("clickhouse").join("1.2.3");
    fs::create_dir_all(&package_root).unwrap();
    fs::write(package_root.join("driver"), b"driver-sidecar").unwrap();
    let actual_digest = format!("{:x}", Sha256::digest(b"driver-sidecar"));
    let manifest = serde_json::json!({
        "schemaVersion": 1,
        "packageId": "oxide.clickhouse",
        "packageVersion": "1.2.3",
        "protocolVersion": protocol,
        "driverId": "clickhouse",
        "displayName": "ClickHouse",
        "clientLibrary": "clickhouse-rs",
        "clientVersion": "0.13.0",
        "entrypoint": "driver",
        "sha256": digest.unwrap_or(&actual_digest),
        "supportedTargets": [current_target()],
        "serverVersionRange": ">=22"
    });
    fs::write(
        package_root.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    fs::write(root.join("clickhouse").join("current"), "1.2.3\n").unwrap();
}
