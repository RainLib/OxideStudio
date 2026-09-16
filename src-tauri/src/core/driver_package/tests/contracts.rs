use super::super::*;

#[test]
fn connection_url_templates_are_bounded_and_allow_only_declared_placeholders() {
    assert!(
        validate_connection_url_template(Some("jdbc:oracle:thin:@{host}:{port}/{database}",))
            .is_ok()
    );
    assert!(validate_connection_url_template(Some("jdbc:test://{unknown}")).is_err());
    assert!(validate_connection_url_template(Some("jdbc:test://{host")).is_err());
    assert!(validate_connection_url_template(Some("\u{0000}jdbc:test")).is_err());
}

#[test]
fn catalog_release_contract_must_match_the_downloaded_manifest() {
    let capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
        .expect("PostgreSQL capabilities");
    let entry = DriverPackageCatalogEntry {
        driver_id: "warehouse".to_string(),
        display_name: "Warehouse".to_string(),
        package_version: "1.0.0".to_string(),
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        download_url: "https://drivers.example.com/warehouse-1.0.0.tar.gz".to_string(),
        archive_sha256: Some("a".repeat(64)),
        supported_targets: vec!["darwin-arm64".to_string(), "linux-x86_64".to_string()],
        server_version_range: Some(">= 1 < 3".to_string()),
        release_notes_url: None,
        connection_url_template: Some("jdbc:warehouse://{host}:{port}/{database}".to_string()),
        capabilities: Some(capabilities.clone()),
        schema_migration: None,
        conformance: Some(DriverPackageConformance {
            evidence: vec![DriverPackageConformanceEvidence {
                schema_version: 1,
                runner_version: "1.0.0".to_string(),
                driver_id: "warehouse".to_string(),
                package_version: "1.0.0".to_string(),
                entrypoint_sha256: "a".repeat(64),
                target: "darwin-arm64".to_string(),
                server_version: "1.0".to_string(),
                fixture_id: "warehouse-core-v1".to_string(),
                fixture_sha256: "b".repeat(64),
                report_url: "https://drivers.example.com/evidence/warehouse-1.0.json".to_string(),
                report_sha256: "c".repeat(64),
                operations: vec!["connect".to_string()],
            }],
            ..DriverPackageConformance::default()
        }),
        dependencies: Vec::new(),
    };
    let manifest = DriverPackageManifest {
        schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
        package_id: "oxide.warehouse".to_string(),
        package_version: "1.0.0".to_string(),
        protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
        driver_id: "warehouse".to_string(),
        display_name: "Warehouse".to_string(),
        client_library: "warehouse-jdbc".to_string(),
        client_version: "1.0".to_string(),
        entrypoint: "driver".to_string(),
        sha256: "a".repeat(64),
        runtime: DriverPackageRuntime::Native,
        supported_targets: vec!["linux-x86_64".to_string(), "darwin-arm64".to_string()],
        server_version_range: Some(">= 1 < 3".to_string()),
        connection_url_template: Some("jdbc:warehouse://{host}:{port}/{database}".to_string()),
        capabilities: Some(capabilities),
        schema_migration: None,
    };
    assert!(validate_catalog_manifest_binding(&entry, &manifest).is_ok());

    let mut protocol_mismatch = manifest.clone();
    protocol_mismatch.protocol_version = "0.9".to_string();
    assert!(
        validate_catalog_manifest_binding(&entry, &protocol_mismatch)
            .unwrap_err()
            .contains("protocol")
    );

    let mut evidence_mismatch = manifest.clone();
    evidence_mismatch.sha256 = "d".repeat(64);
    assert!(
        validate_catalog_manifest_binding(&entry, &evidence_mismatch)
            .unwrap_err()
            .contains("conformance evidence")
    );

    let mut capability_mismatch = manifest;
    capability_mismatch
        .capabilities
        .as_mut()
        .expect("capabilities")
        .supports_sql_query = false;
    assert!(
        validate_catalog_manifest_binding(&entry, &capability_mismatch)
            .unwrap_err()
            .contains("capabilities")
    );
}

#[test]
fn server_version_ranges_are_explicit_and_enforced_after_connect() {
    assert!(validate_server_version_range(Some(">= 6 < 9")).is_ok());
    assert!(validate_server_version_range(Some("6 - 9")).is_err());
    assert!(validate_server_version_compatibility(
        Some(">= 6 < 9"),
        Some("Elasticsearch 8.15.2 (default distribution)")
    )
    .is_ok());
    assert!(
        validate_server_version_compatibility(Some(">= 6 < 9"), Some("9.0.0"))
            .unwrap_err()
            .contains("outside")
    );
    assert!(
        validate_server_version_compatibility(Some(">= 6 < 9"), Some("unknown"))
            .unwrap_err()
            .contains("could not determine")
    );
}

#[test]
fn catalog_signature_location_tracks_the_catalog_document() {
    let catalog = validated_catalog_url(
        "https://drivers.example.com/releases/catalog.json",
        "Driver catalog URL",
    )
    .unwrap();
    assert_eq!(
        catalog_signature_url(&catalog).unwrap().as_str(),
        "https://drivers.example.com/releases/catalog.json.minisig"
    );
    assert!(validated_catalog_url(
        "https://user:password@drivers.example.com/catalog.json",
        "Driver catalog URL",
    )
    .is_err());
}
