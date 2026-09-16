use super::catalog_validation::validate_driver_catalog;
use super::types::{
    DriverPackageCatalog, DriverPackageCatalogEntry, DriverPackageCatalogReceipt,
    DriverPackageManifest, DriverPackageRuntime, DRIVER_PACKAGE_CATALOG_RECEIPT,
    DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION, MAX_DRIVER_CATALOG_BYTES,
};
use std::fs;
use std::path::Path;

/// A catalog is both a release index and the UI's version/conformance source.
/// Bind its user-visible contract to the downloaded, independently signed
/// manifest before the archive enters the local store. Comparing only the
/// package id/version would allow a release to present a different protocol,
/// target, or capability surface from the one the user reviewed in Driver
/// Manager.
pub(super) fn validate_catalog_manifest_binding(
    entry: &DriverPackageCatalogEntry,
    manifest: &DriverPackageManifest,
) -> Result<(), String> {
    if manifest.driver_id != entry.driver_id || manifest.package_version != entry.package_version {
        return Err(
            "Downloaded driver package identity does not match the signed catalog entry"
                .to_string(),
        );
    }
    if manifest.protocol_version != entry.protocol_version {
        return Err(
            "Downloaded driver package protocol does not match the signed catalog entry"
                .to_string(),
        );
    }
    if manifest.display_name != entry.display_name {
        return Err(
            "Downloaded driver package display name does not match the signed catalog entry"
                .to_string(),
        );
    }
    if manifest.server_version_range != entry.server_version_range {
        return Err(
            "Downloaded driver package server-version range does not match the signed catalog entry"
                .to_string(),
        );
    }
    if manifest.connection_url_template != entry.connection_url_template {
        return Err(
            "Downloaded driver package connection template does not match the signed catalog entry"
                .to_string(),
        );
    }
    if manifest.schema_migration != entry.schema_migration {
        return Err(
            "Downloaded driver package schema-migration contract does not match the signed catalog entry"
                .to_string(),
        );
    }

    let mut catalog_targets = entry.supported_targets.clone();
    let mut manifest_targets = manifest.supported_targets.clone();
    catalog_targets.sort_unstable();
    manifest_targets.sort_unstable();
    if catalog_targets != manifest_targets {
        return Err(
            "Downloaded driver package targets do not match the signed catalog entry".to_string(),
        );
    }

    if let Some(catalog_capabilities) = entry.capabilities.as_ref() {
        if manifest.capabilities.as_ref() != Some(catalog_capabilities) {
            return Err(
                "Downloaded driver package capabilities do not match the signed catalog entry"
                    .to_string(),
            );
        }
    }
    if let Some(conformance) = entry.conformance.as_ref() {
        if conformance.evidence.iter().any(|evidence| {
            !evidence
                .entrypoint_sha256
                .eq_ignore_ascii_case(&manifest.sha256)
        }) {
            return Err(
                "Downloaded driver package entrypoint digest does not match signed conformance evidence"
                    .to_string(),
            );
        }
    }
    if !entry.dependencies.is_empty() {
        let DriverPackageRuntime::Java(java) = &manifest.runtime else {
            return Err("Only Java driver packages may declare catalog dependencies".to_string());
        };
        for dependency in &entry.dependencies {
            let classpath = java
                .classpath
                .iter()
                .find(|classpath| classpath.path == dependency.path)
                .ok_or_else(|| {
                    format!(
                        "Catalog dependency {} is not signed into the Java classpath",
                        dependency.coordinate
                    )
                })?;
            if !classpath.sha256.eq_ignore_ascii_case(&dependency.sha256) {
                return Err(format!(
                    "Catalog dependency {} digest does not match the signed Java classpath",
                    dependency.coordinate
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_catalog_receipt_entry(
    entry: &DriverPackageCatalogEntry,
    manifest: &DriverPackageManifest,
) -> Result<(), String> {
    validate_driver_catalog(&DriverPackageCatalog {
        schema_version: DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION,
        generated_at: None,
        packages: vec![entry.clone()],
    })?;
    validate_catalog_manifest_binding(entry, manifest)
}

pub(super) fn read_catalog_receipt(
    package_root: &Path,
    manifest: &DriverPackageManifest,
) -> Result<DriverPackageCatalogEntry, String> {
    let path = package_root.join(DRIVER_PACKAGE_CATALOG_RECEIPT);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| "Driver package has no signed-catalog receipt".to_string())?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_DRIVER_CATALOG_BYTES {
        return Err("Driver catalog receipt is not a bounded regular file".to_string());
    }
    let encoded =
        fs::read(&path).map_err(|error| format!("Cannot read driver catalog receipt: {error}"))?;
    let receipt: DriverPackageCatalogReceipt = serde_json::from_slice(&encoded)
        .map_err(|error| format!("Driver catalog receipt is not valid JSON: {error}"))?;
    if receipt.schema_version != DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION {
        return Err("Driver catalog receipt has an unsupported schema version".to_string());
    }
    validate_catalog_receipt_entry(&receipt.entry, manifest)?;
    Ok(receipt.entry)
}
