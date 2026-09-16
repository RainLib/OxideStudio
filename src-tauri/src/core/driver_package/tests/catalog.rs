use super::super::*;
use super::support::*;

#[test]
fn catalog_validation_requires_https_safe_identities_and_unique_versions() {
    let valid = DriverPackageCatalog {
        schema_version: DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION,
        generated_at: Some("2026-07-31T00:00:00Z".to_string()),
        packages: vec![DriverPackageCatalogEntry {
            driver_id: "clickhouse".to_string(),
            display_name: "ClickHouse".to_string(),
            package_version: "1.2.3".to_string(),
            protocol_version: "1.0".to_string(),
            download_url: "https://drivers.example.com/clickhouse-1.2.3".to_string(),
            archive_sha256: None,
            supported_targets: vec!["darwin-arm64".to_string()],
            server_version_range: None,
            release_notes_url: None,
            connection_url_template: None,
            capabilities: Some({
                let mut capabilities =
                    crate::core::dialect::database_capabilities_for_driver("postgres").unwrap();
                capabilities.driver = "clickhouse".to_string();
                capabilities.display_name = "ClickHouse".to_string();
                capabilities
            }),
            schema_migration: None,
            conformance: Some(DriverPackageConformance {
                connect: vec!["24.3".to_string()],
                metadata: vec!["24.3".to_string()],
                query: vec!["24.3".to_string()],
                cancellation: vec!["24.3".to_string()],
                mutations: Vec::new(),
                migration: Vec::new(),
                data_transfer: Vec::new(),
                evidence: vec![DriverPackageConformanceEvidence {
                    schema_version: 1,
                    runner_version: "1.0.0".to_string(),
                    driver_id: "clickhouse".to_string(),
                    package_version: "1.2.3".to_string(),
                    entrypoint_sha256: "a".repeat(64),
                    target: "darwin-arm64".to_string(),
                    server_version: "24.3".to_string(),
                    fixture_id: "clickhouse-core-v1".to_string(),
                    fixture_sha256: "b".repeat(64),
                    report_url: "https://drivers.example.com/evidence/clickhouse-24.3.json"
                        .to_string(),
                    report_sha256: "c".repeat(64),
                    operations: vec![
                        "connect".to_string(),
                        "metadata".to_string(),
                        "query".to_string(),
                        "cancellation".to_string(),
                    ],
                }],
            }),
            dependencies: Vec::new(),
        }],
    };
    assert!(validate_driver_catalog(&valid).is_ok());

    let mut missing_query_capability = valid.clone();
    missing_query_capability.packages[0]
        .capabilities
        .as_mut()
        .expect("test package should declare capabilities")
        .supports_sql_query = false;
    assert!(validate_driver_catalog(&missing_query_capability)
        .unwrap_err()
        .contains("query conformance"));

    let mut missing_metadata_contract = valid.clone();
    missing_metadata_contract.packages[0].capabilities = None;
    assert!(validate_driver_catalog(&missing_metadata_contract)
        .unwrap_err()
        .contains("requires a capability contract"));

    let mut missing_connect_conformance = valid.clone();
    missing_connect_conformance.packages[0]
        .conformance
        .as_mut()
        .expect("fixture has conformance")
        .connect = Vec::new();
    assert!(validate_driver_catalog(&missing_connect_conformance)
        .unwrap_err()
        .contains("requires connection conformance"));

    let mut insecure = valid.clone();
    insecure.packages[0].download_url = "http://drivers.example.com/package".to_string();
    assert!(validate_driver_catalog(&insecure)
        .unwrap_err()
        .contains("must use HTTPS"));

    let mut invalid_archive_digest = valid.clone();
    invalid_archive_digest.packages[0].archive_sha256 = Some("invalid".to_string());
    assert!(validate_driver_catalog(&invalid_archive_digest)
        .unwrap_err()
        .contains("SHA-256"));

    let mut duplicate = valid.clone();
    duplicate.packages.push(valid.packages[0].clone());
    assert!(validate_driver_catalog(&duplicate)
        .unwrap_err()
        .contains("duplicate"));

    let mut mismatched_capabilities = valid.clone();
    mismatched_capabilities.packages[0]
        .capabilities
        .as_mut()
        .unwrap()
        .driver = "postgres".to_string();
    assert!(validate_driver_catalog(&mismatched_capabilities)
        .unwrap_err()
        .contains("driverId"));

    let mut unsupported_version_range = valid.clone();
    unsupported_version_range.packages[0].server_version_range = Some("6 - 9".to_string());
    assert!(validate_driver_catalog(&unsupported_version_range)
        .unwrap_err()
        .contains("version range"));

    let mut duplicate_conformance = valid.clone();
    duplicate_conformance.packages[0]
        .conformance
        .as_mut()
        .unwrap()
        .query = vec!["24.3".to_string(), "24.3".to_string()];
    assert!(validate_driver_catalog(&duplicate_conformance)
        .unwrap_err()
        .contains("duplicate conformance"));

    let mut missing_runner_evidence = valid.clone();
    missing_runner_evidence.packages[0]
        .conformance
        .as_mut()
        .unwrap()
        .evidence
        .clear();
    assert!(validate_driver_catalog(&missing_runner_evidence)
        .unwrap_err()
        .contains("no matching runner evidence"));

    let mut evidence_package_mismatch = valid.clone();
    evidence_package_mismatch.packages[0]
        .conformance
        .as_mut()
        .unwrap()
        .evidence[0]
        .package_version = "9.9.9".to_string();
    assert!(validate_driver_catalog(&evidence_package_mismatch)
        .unwrap_err()
        .contains("invalid conformance evidence identity"));

    let mut unsupported_mutations = valid;
    let capabilities = unsupported_mutations.packages[0]
        .capabilities
        .as_mut()
        .expect("fixture has capabilities");
    capabilities.supports_table_row_mutation = false;
    unsupported_mutations.packages[0]
        .conformance
        .as_mut()
        .expect("fixture has conformance")
        .mutations = vec!["24.3".to_string()];
    unsupported_mutations.packages[0]
        .conformance
        .as_mut()
        .expect("fixture has conformance")
        .evidence[0]
        .operations
        .push("mutations".to_string());
    assert!(validate_driver_catalog(&unsupported_mutations)
        .unwrap_err()
        .contains("mutation conformance"));
}

#[test]
fn signed_jdbc_dependencies_are_immutable_bounded_and_license_declared() {
    let payload = b"signed jdbc dependency";
    let dependency = signed_jdbc_dependency(payload);
    let entry = dependency_catalog_entry(dependency.clone());
    assert!(validate_catalog_dependencies(&entry).is_ok());

    let mut untrusted_repository = entry.clone();
    untrusted_repository.dependencies[0].download_url =
        "https://packages.example.com/postgresql-42.7.7.jar".to_string();
    assert!(validate_catalog_dependencies(&untrusted_repository)
        .unwrap_err()
        .contains("not allowlisted"));

    let mut coordinate_mismatch = entry.clone();
    coordinate_mismatch.dependencies[0].download_url =
            "https://repo.maven.apache.org/maven2/org/postgresql/postgresql/42.7.6/postgresql-42.7.6.jar".to_string();
    assert!(validate_catalog_dependencies(&coordinate_mismatch)
        .unwrap_err()
        .contains("does not match its Maven coordinate"));

    let mut snapshot = entry.clone();
    snapshot.dependencies[0].coordinate = "org.postgresql:postgresql:42.8.0-SNAPSHOT".to_string();
    assert!(validate_catalog_dependencies(&snapshot)
        .unwrap_err()
        .contains("immutable fixed version"));

    let mut classified_snapshot = entry.clone();
    classified_snapshot.dependencies[0].coordinate =
        "org.postgresql:postgresql:jar:tests:42.8.0-SNAPSHOT".to_string();
    assert!(validate_catalog_dependencies(&classified_snapshot)
        .unwrap_err()
        .contains("immutable fixed version"));

    let mut unsupported_packaging = entry.clone();
    unsupported_packaging.dependencies[0].coordinate =
        "org.postgresql:postgresql:zip:42.7.7".to_string();
    assert!(validate_catalog_dependencies(&unsupported_packaging)
        .unwrap_err()
        .contains("packaging must be JAR"));

    let mut missing_license = entry.clone();
    missing_license.dependencies[0].license_spdx.clear();
    assert!(validate_catalog_dependencies(&missing_license)
        .unwrap_err()
        .contains("SPDX"));

    let mut oversized = entry.clone();
    oversized.dependencies[0].size_bytes = MAX_DRIVER_DEPENDENCY_BYTES + 1;
    assert!(validate_catalog_dependencies(&oversized)
        .unwrap_err()
        .contains("supported limit"));

    let mut duplicate_path = entry;
    let mut second = dependency;
    second.coordinate = "org.slf4j:slf4j-api:2.0.17".to_string();
    second.download_url =
        "https://repo.maven.apache.org/maven2/org/slf4j/slf4j-api/2.0.17/slf4j-api-2.0.17.jar"
            .to_string();
    duplicate_path.dependencies.push(second);
    assert!(validate_catalog_dependencies(&duplicate_path)
        .unwrap_err()
        .contains("duplicate dependency path"));
}

#[test]
fn catalog_dependencies_must_match_the_signed_java_classpath() {
    let dependency = signed_jdbc_dependency(b"signed jdbc dependency");
    let entry = dependency_catalog_entry(dependency.clone());
    let manifest = dependency_manifest(&dependency);
    assert!(validate_catalog_manifest_binding(&entry, &manifest).is_ok());

    let mut native = manifest.clone();
    native.runtime = DriverPackageRuntime::Native;
    assert!(validate_catalog_manifest_binding(&entry, &native)
        .unwrap_err()
        .contains("Only Java"));

    let mut missing = manifest.clone();
    let DriverPackageRuntime::Java(java) = &mut missing.runtime else {
        unreachable!();
    };
    java.classpath[0].path = "lib/different.jar".to_string();
    assert!(validate_catalog_manifest_binding(&entry, &missing)
        .unwrap_err()
        .contains("not signed into"));

    let mut wrong_digest = manifest;
    let DriverPackageRuntime::Java(java) = &mut wrong_digest.runtime else {
        unreachable!();
    };
    java.classpath[0].sha256 = "f".repeat(64);
    assert!(validate_catalog_manifest_binding(&entry, &wrong_digest)
        .unwrap_err()
        .contains("digest"));
}
