use super::catalog_transport::validated_catalog_url;
use super::package_contracts::{validate_capability_contract, validate_schema_migration_contract};
use super::package_identity::{is_safe_token, validate_sha256, validated_package_relative_path};
use super::types::{
    DriverPackageCatalog, DriverPackageCatalogEntry, DriverPackageConformance,
    DriverPackageConformanceEvidence, DriverPackageSchemaMigrationContract, DriverPackageTrust,
    DRIVER_PACKAGE_CATALOG_RECEIPT, DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION,
    MAVEN_REPOSITORY_HOST_ALLOWLIST, MAX_DRIVER_CATALOG_ENTRIES, MAX_DRIVER_CATALOG_FIELD_LENGTH,
    MAX_DRIVER_DEPENDENCIES, MAX_DRIVER_DEPENDENCIES_BYTES, MAX_DRIVER_DEPENDENCY_BYTES,
};
use super::version_policy::{validate_connection_url_template, validate_server_version_range};
use crate::core::dialect::DatabaseCapabilities;
use minisign_verify::Signature;

pub(super) fn verify_detached_document(
    document: &[u8],
    signature_text: &[u8],
    trust: &DriverPackageTrust,
    label: &str,
) -> Result<(), String> {
    match trust {
        DriverPackageTrust::PublicKey(public_key) => {
            let signature_text = std::str::from_utf8(signature_text)
                .map_err(|error| format!("{label} signature is not UTF-8: {error}"))?;
            let signature = Signature::decode(signature_text)
                .map_err(|error| format!("{label} signature is invalid: {error}"))?;
            public_key
                .verify(document, &signature, false)
                .map_err(|error| format!("{label} signature is not trusted: {error}"))
        }
        DriverPackageTrust::Unavailable => {
            Err("No trusted database driver signing key is configured in this build".to_string())
        }
        DriverPackageTrust::InvalidKey(error) => Err(format!(
            "The database driver signing key configured for this build is invalid: {error}"
        )),
        #[cfg(test)]
        DriverPackageTrust::AllowUnsigned => Ok(()),
    }
}

pub(super) fn validate_driver_catalog(catalog: &DriverPackageCatalog) -> Result<(), String> {
    if catalog.schema_version != DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported driver catalog schema version {}",
            catalog.schema_version
        ));
    }
    if catalog.packages.len() > MAX_DRIVER_CATALOG_ENTRIES {
        return Err(format!(
            "Driver catalog contains more than {MAX_DRIVER_CATALOG_ENTRIES} packages"
        ));
    }
    if catalog
        .generated_at
        .as_deref()
        .is_some_and(|value| value.is_empty() || value.len() > 128)
    {
        return Err("Driver catalog contains an invalid generated-at value".to_string());
    }
    let mut identities = std::collections::HashSet::new();
    for entry in &catalog.packages {
        if !is_safe_token(&entry.driver_id) || !is_safe_token(&entry.package_version) {
            return Err("Driver catalog contains an invalid package identity".to_string());
        }
        if !identities.insert((&entry.driver_id, &entry.package_version)) {
            return Err("Driver catalog contains a duplicate package identity".to_string());
        }
        for value in [
            &entry.display_name,
            &entry.protocol_version,
            &entry.download_url,
        ] {
            if value.trim().is_empty() || value.len() > MAX_DRIVER_CATALOG_FIELD_LENGTH {
                return Err("Driver catalog contains an invalid field length".to_string());
            }
        }
        validated_catalog_url(&entry.download_url, "Driver package download URL")?;
        if let Some(archive_sha256) = entry.archive_sha256.as_deref() {
            validate_sha256(archive_sha256, "Driver package archive SHA-256")?;
        }
        if let Some(url) = entry.release_notes_url.as_deref() {
            if url.len() > MAX_DRIVER_CATALOG_FIELD_LENGTH {
                return Err("Driver catalog contains an invalid release notes URL".to_string());
            }
            validated_catalog_url(url, "Driver release notes URL")?;
        }
        validate_server_version_range(entry.server_version_range.as_deref())?;
        validate_connection_url_template(entry.connection_url_template.as_deref())?;
        if let Some(capabilities) = &entry.capabilities {
            validate_capability_contract(&entry.driver_id, capabilities)?;
        }
        validate_schema_migration_contract(
            entry.capabilities.as_ref(),
            entry.schema_migration.as_ref(),
        )?;
        if let Some(conformance) = &entry.conformance {
            validate_driver_conformance(entry, conformance)?;
            validate_conformance_capability_contract(
                entry.capabilities.as_ref(),
                entry.schema_migration.as_ref(),
                conformance,
            )?;
        }
        validate_catalog_dependencies(entry)?;
        if entry.supported_targets.len() > 16
            || entry
                .supported_targets
                .iter()
                .any(|target| target.len() > 96 || !(target == "*" || is_safe_token(target)))
            || entry
                .supported_targets
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != entry.supported_targets.len()
        {
            return Err("Driver catalog contains invalid supported targets".to_string());
        }
    }
    Ok(())
}

pub(super) fn validate_catalog_dependencies(
    entry: &DriverPackageCatalogEntry,
) -> Result<(), String> {
    if entry.dependencies.len() > MAX_DRIVER_DEPENDENCIES {
        return Err(format!(
            "Driver catalog package contains more than {MAX_DRIVER_DEPENDENCIES} dependencies"
        ));
    }
    let mut coordinates = std::collections::HashSet::new();
    let mut paths = std::collections::HashSet::new();
    let mut total_bytes = 0u64;
    for dependency in &entry.dependencies {
        let expected_maven_path = validate_maven_coordinate(&dependency.coordinate)?;
        let relative =
            validated_package_relative_path(&dependency.path, "Driver catalog dependency")?;
        if relative
            .extension()
            .and_then(|extension| extension.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("jar"))
        {
            return Err("Driver catalog dependency path must identify a JAR".to_string());
        }
        if matches!(
            dependency.path.as_str(),
            "manifest.json" | "manifest.json.minisig" | DRIVER_PACKAGE_CATALOG_RECEIPT
        ) {
            return Err("Driver catalog dependency uses a reserved package path".to_string());
        }
        let url = validated_catalog_url(
            &dependency.download_url,
            "Driver catalog dependency download URL",
        )?;
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        if !MAVEN_REPOSITORY_HOST_ALLOWLIST.contains(&host.as_str()) {
            return Err(format!(
                "Driver catalog dependency repository host is not allowlisted: {host}"
            ));
        }
        if !url.path().to_ascii_lowercase().ends_with(".jar") {
            return Err("Driver catalog dependency download URL must identify a JAR".to_string());
        }
        if url.path() != format!("/maven2/{expected_maven_path}") {
            return Err(
                "Driver catalog dependency URL does not match its Maven coordinate".to_string(),
            );
        }
        validate_sha256(&dependency.sha256, "Driver catalog dependency SHA-256")?;
        if dependency.size_bytes == 0 || dependency.size_bytes > MAX_DRIVER_DEPENDENCY_BYTES {
            return Err(
                "Driver catalog dependency size is outside the supported limit".to_string(),
            );
        }
        total_bytes = total_bytes
            .checked_add(dependency.size_bytes)
            .ok_or_else(|| "Driver catalog dependency size overflow".to_string())?;
        if total_bytes > MAX_DRIVER_DEPENDENCIES_BYTES {
            return Err("Driver catalog dependencies exceed the 256 MiB total limit".to_string());
        }
        validate_spdx_expression(&dependency.license_spdx)?;
        if dependency.license_url.len() > MAX_DRIVER_CATALOG_FIELD_LENGTH {
            return Err("Driver catalog dependency license URL is too long".to_string());
        }
        validated_catalog_url(
            &dependency.license_url,
            "Driver catalog dependency license URL",
        )?;
        if !coordinates.insert(dependency.coordinate.to_ascii_lowercase()) {
            return Err("Driver catalog contains a duplicate dependency coordinate".to_string());
        }
        let path_identity = dependency.path.replace('\\', "/").to_ascii_lowercase();
        if !paths.insert(path_identity) {
            return Err("Driver catalog contains a duplicate dependency path".to_string());
        }
    }
    Ok(())
}

pub(super) fn validate_maven_coordinate(coordinate: &str) -> Result<String, String> {
    if coordinate.len() > 320 {
        return Err("Driver catalog Maven coordinate is too long".to_string());
    }
    let parts = coordinate.split(':').collect::<Vec<_>>();
    if !(3..=5).contains(&parts.len()) || parts.iter().any(|part| !is_safe_token(part)) {
        return Err(
            "Driver catalog Maven coordinate must use an immutable fixed version".to_string(),
        );
    }
    let version = parts.last().copied().unwrap_or_default();
    if matches!(version.to_ascii_lowercase().as_str(), "latest" | "release")
        || version.to_ascii_lowercase().ends_with("-snapshot")
    {
        return Err(
            "Driver catalog Maven coordinate must use an immutable fixed version".to_string(),
        );
    }
    let (packaging, classifier) = match parts.len() {
        3 => ("jar", None),
        4 => (parts[2], None),
        5 => (parts[2], Some(parts[3])),
        _ => unreachable!(),
    };
    if !packaging.eq_ignore_ascii_case("jar") {
        return Err("Driver catalog Maven dependency packaging must be JAR".to_string());
    }
    let group_path = parts[0].replace('.', "/");
    let artifact = parts[1];
    let classifier = classifier
        .map(|classifier| format!("-{classifier}"))
        .unwrap_or_default();
    Ok(format!(
        "{group_path}/{artifact}/{version}/{artifact}-{version}{classifier}.jar"
    ))
}

pub(super) fn validate_spdx_expression(value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 128
        || value.eq_ignore_ascii_case("unknown")
        || value.chars().any(|character| {
            !(character.is_ascii_alphanumeric()
                || matches!(character, ' ' | '.' | '-' | '+' | '(' | ')'))
        })
    {
        return Err("Driver catalog dependency SPDX license expression is invalid".to_string());
    }
    Ok(())
}

pub(super) fn validate_driver_conformance(
    entry: &DriverPackageCatalogEntry,
    conformance: &DriverPackageConformance,
) -> Result<(), String> {
    const MAX_VERSIONS_PER_OPERATION: usize = 32;
    const MAX_EVIDENCE_PER_PACKAGE: usize = 128;
    for (_, versions) in conformance_operation_versions(conformance) {
        if versions.len() > MAX_VERSIONS_PER_OPERATION
            || versions.iter().any(|version| {
                let version = version.trim();
                version.is_empty() || version.len() > 96 || version.contains('\0')
            })
        {
            return Err("Driver catalog contains invalid conformance versions".to_string());
        }
        let distinct = versions
            .iter()
            .map(|version| version.trim().to_ascii_lowercase())
            .collect::<std::collections::HashSet<_>>();
        if distinct.len() != versions.len() {
            return Err("Driver catalog contains duplicate conformance versions".to_string());
        }
    }
    if conformance.evidence.len() > MAX_EVIDENCE_PER_PACKAGE {
        return Err("Driver catalog contains too many conformance evidence records".to_string());
    }
    let mut evidence_keys = std::collections::HashSet::new();
    for evidence in &conformance.evidence {
        validate_driver_conformance_evidence(entry, evidence)?;
        let key = format!(
            "{}:{}:{}:{}:{}",
            evidence.target.to_ascii_lowercase(),
            evidence.server_version.to_ascii_lowercase(),
            evidence.fixture_id.to_ascii_lowercase(),
            evidence.report_sha256.to_ascii_lowercase(),
            evidence.operations.join(",").to_ascii_lowercase(),
        );
        if !evidence_keys.insert(key) {
            return Err("Driver catalog contains duplicate conformance evidence".to_string());
        }
    }
    for (operation, versions) in conformance_operation_versions(conformance) {
        for version in versions {
            let covered = conformance.evidence.iter().any(|evidence| {
                evidence.server_version.eq_ignore_ascii_case(version)
                    && evidence
                        .operations
                        .iter()
                        .any(|candidate| candidate == operation)
            });
            if !covered {
                return Err(format!(
                    "Driver catalog conformance {operation} version {version} has no matching runner evidence"
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn conformance_operation_versions(
    conformance: &DriverPackageConformance,
) -> [(&'static str, &Vec<String>); 7] {
    [
        ("connect", &conformance.connect),
        ("metadata", &conformance.metadata),
        ("query", &conformance.query),
        ("cancellation", &conformance.cancellation),
        ("mutations", &conformance.mutations),
        ("migration", &conformance.migration),
        ("dataTransfer", &conformance.data_transfer),
    ]
}

pub(super) fn validate_driver_conformance_evidence(
    entry: &DriverPackageCatalogEntry,
    evidence: &DriverPackageConformanceEvidence,
) -> Result<(), String> {
    if evidence.schema_version != 1
        || !is_safe_token(&evidence.runner_version)
        || evidence.driver_id != entry.driver_id
        || evidence.package_version != entry.package_version
        || !is_safe_token(&evidence.target)
        || !is_safe_token(&evidence.fixture_id)
        || evidence.server_version.trim().is_empty()
        || evidence.server_version.len() > 96
        || evidence.server_version.contains('\0')
    {
        return Err("Driver catalog contains invalid conformance evidence identity".to_string());
    }
    if !entry.supported_targets.is_empty()
        && !entry
            .supported_targets
            .iter()
            .any(|target| target == "*" || target.eq_ignore_ascii_case(&evidence.target))
    {
        return Err(
            "Driver catalog conformance evidence target is not supported by the package"
                .to_string(),
        );
    }
    validate_sha256(
        &evidence.entrypoint_sha256,
        "Driver conformance entrypoint SHA-256",
    )?;
    validate_sha256(
        &evidence.fixture_sha256,
        "Driver conformance fixture SHA-256",
    )?;
    validate_sha256(&evidence.report_sha256, "Driver conformance report SHA-256")?;
    validated_catalog_url(&evidence.report_url, "Driver conformance report URL")?;
    if evidence.operations.is_empty()
        || evidence.operations.len() > 7
        || evidence
            .operations
            .iter()
            .any(|operation| !conformance_operation_is_valid(operation))
        || evidence
            .operations
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != evidence.operations.len()
        || !evidence
            .operations
            .iter()
            .any(|operation| operation == "connect")
    {
        return Err("Driver catalog contains invalid conformance evidence operations".to_string());
    }
    Ok(())
}

pub(super) fn conformance_operation_is_valid(operation: &str) -> bool {
    matches!(
        operation,
        "connect"
            | "metadata"
            | "query"
            | "cancellation"
            | "mutations"
            | "migration"
            | "dataTransfer"
    )
}

/// Release evidence is advisory rather than executable authority, but it must
/// still be internally honest. A catalog cannot advertise tested query,
/// metadata, Grid writes, migrations, or cancellation for a package that does
/// not declare the corresponding user-facing capability.
pub(super) fn validate_conformance_capability_contract(
    capabilities: Option<&DatabaseCapabilities>,
    schema_migration: Option<&DriverPackageSchemaMigrationContract>,
    conformance: &DriverPackageConformance,
) -> Result<(), String> {
    let needs_declared_capabilities = !conformance.metadata.is_empty()
        || !conformance.query.is_empty()
        || !conformance.cancellation.is_empty()
        || !conformance.mutations.is_empty()
        || !conformance.migration.is_empty()
        || !conformance.data_transfer.is_empty();
    if needs_declared_capabilities && conformance.connect.is_empty() {
        return Err(
            "Driver catalog conformance for advanced operations requires connection conformance"
                .to_string(),
        );
    }
    let Some(capabilities) = capabilities else {
        if needs_declared_capabilities {
            return Err(
                "Driver catalog conformance for advanced operations requires a capability contract"
                    .to_string(),
            );
        }
        return Ok(());
    };
    if !conformance.query.is_empty() && !capabilities.supports_sql_query {
        return Err(
            "Driver catalog declares query conformance without SQL query capability".to_string(),
        );
    }
    if !conformance.metadata.is_empty()
        && !capabilities.supports_table_browsing
        && !capabilities.supports_collection_browsing
        && !capabilities.supports_key_value_browsing
    {
        return Err(
            "Driver catalog declares metadata conformance without metadata browsing capability"
                .to_string(),
        );
    }
    if !conformance.cancellation.is_empty() && !capabilities.supports_query_cancellation {
        return Err(
            "Driver catalog declares cancellation conformance without query cancellation capability"
                .to_string(),
        );
    }
    if !conformance.mutations.is_empty() && !capabilities.supports_table_row_mutation {
        return Err(
            "Driver catalog declares mutation conformance without table row mutation capability"
                .to_string(),
        );
    }
    if !conformance.migration.is_empty()
        && (!capabilities.supports_table_ddl || schema_migration.is_none())
    {
        return Err(
            "Driver catalog declares migration conformance without a semantic schema-migration contract"
                .to_string(),
        );
    }
    if !conformance.data_transfer.is_empty()
        && (!capabilities.supports_table_data_transfer || !capabilities.supports_table_browsing)
    {
        return Err(
            "Driver catalog declares data transfer conformance without a reviewed table data transfer capability"
                .to_string(),
        );
    }
    Ok(())
}
