use super::catalog_binding::read_catalog_receipt;
use super::manifest_io::read_manifest;
use super::package_contracts::{validate_capability_contract, validate_schema_migration_contract};
use super::package_identity::{
    current_target, is_safe_token, package_relative_file, protocol_is_compatible,
    supports_current_target, validate_package_boundary, validate_sha256, verify_entrypoint_digest,
    verify_runtime_dependencies,
};
use super::signature::verify_package_signature;
use super::types::{
    DriverPackageManifest, DriverPackageRuntime, DriverPackageStatus, DriverPackageTrust,
    InstalledDriverPackage, DRIVER_PACKAGE_SCHEMA_VERSION,
};
use super::version_policy::{validate_connection_url_template, validate_server_version_range};
use oxide_driver_protocol::DRIVER_PROTOCOL_VERSION;
use std::fs;
use std::path::{Component, Path};

pub(super) fn inspect_package(
    registry_root: &Path,
    package_root: &Path,
    manifest_path: &Path,
    directory_driver_id: &str,
    directory_version: &str,
    active_version: Option<&str>,
    trust: &DriverPackageTrust,
) -> Option<InstalledDriverPackage> {
    let manifest = read_manifest(manifest_path).ok()?;
    let catalog_entry = read_catalog_receipt(package_root, &manifest).ok();
    let entrypoint = package_root.join(&manifest.entrypoint);
    let active = active_version == Some(directory_version);
    let directory_identity_error = if manifest.driver_id != directory_driver_id {
        Some("Driver id does not match its installation directory".to_string())
    } else if manifest.package_version != directory_version {
        Some("Package version does not match its installation directory".to_string())
    } else {
        None
    };
    let (status, status_message) = match directory_identity_error
        .map_or_else(
            || validate_package_boundary(registry_root, package_root),
            Err,
        )
        .and_then(|_| validate_manifest(&manifest, package_root))
    {
        Err(error) => (DriverPackageStatus::Invalid, Some(error)),
        Ok(()) if !supports_current_target(&manifest) => (
            DriverPackageStatus::Incompatible,
            Some(format!("Package does not support {}", current_target())),
        ),
        Ok(()) if !protocol_is_compatible(&manifest.protocol_version) => (
            DriverPackageStatus::Incompatible,
            Some(format!(
                "Driver protocol {} is incompatible with host protocol {}",
                manifest.protocol_version, DRIVER_PROTOCOL_VERSION
            )),
        ),
        Ok(()) => match verify_entrypoint_digest(&entrypoint, &manifest.sha256)
            .and_then(|_| verify_runtime_dependencies(package_root, &manifest.runtime))
        {
            Ok(()) => match verify_package_signature(manifest_path, trust) {
                Ok(()) => (DriverPackageStatus::Ready, None),
                Err(error) => (DriverPackageStatus::Untrusted, Some(error)),
            },
            Err(error) => (DriverPackageStatus::Invalid, Some(error)),
        },
    };

    Some(InstalledDriverPackage {
        manifest,
        package_root: package_root.to_path_buf(),
        entrypoint,
        active,
        status,
        status_message,
        catalog_entry,
    })
}

pub(super) fn validate_manifest(
    manifest: &DriverPackageManifest,
    package_root: &Path,
) -> Result<(), String> {
    if manifest.schema_version != DRIVER_PACKAGE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported driver manifest schema version: {}",
            manifest.schema_version
        ));
    }
    for (field, value) in [
        ("packageId", manifest.package_id.as_str()),
        ("packageVersion", manifest.package_version.as_str()),
        ("driverId", manifest.driver_id.as_str()),
    ] {
        if !is_safe_token(value) {
            return Err(format!("Invalid {field}: {value}"));
        }
    }
    if let Some(capabilities) = &manifest.capabilities {
        validate_capability_contract(&manifest.driver_id, capabilities)?;
    }
    validate_schema_migration_contract(
        manifest.capabilities.as_ref(),
        manifest.schema_migration.as_ref(),
    )?;
    validate_connection_url_template(manifest.connection_url_template.as_deref())?;
    validate_server_version_range(manifest.server_version_range.as_deref())?;
    for (field, value) in [
        ("displayName", manifest.display_name.as_str()),
        ("clientLibrary", manifest.client_library.as_str()),
        ("clientVersion", manifest.client_version.as_str()),
        ("protocolVersion", manifest.protocol_version.as_str()),
    ] {
        if value.trim().is_empty() || value.len() > 160 {
            return Err(format!("Invalid {field}"));
        }
    }
    if manifest.sha256.len() != 64
        || !manifest
            .sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Driver entrypoint SHA-256 must be a 64-character hex digest".to_string());
    }
    let relative_entrypoint = Path::new(&manifest.entrypoint);
    if relative_entrypoint.as_os_str().is_empty()
        || relative_entrypoint.is_absolute()
        || relative_entrypoint.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Driver entrypoint must stay inside its package directory".to_string());
    }
    let entrypoint = package_root.join(relative_entrypoint);
    if !entrypoint.is_file() {
        return Err("Driver entrypoint does not exist".to_string());
    }
    let canonical_root = fs::canonicalize(package_root)
        .map_err(|error| format!("Cannot resolve driver package directory: {error}"))?;
    let canonical_entrypoint = fs::canonicalize(&entrypoint)
        .map_err(|error| format!("Cannot resolve driver entrypoint: {error}"))?;
    if !canonical_entrypoint.starts_with(&canonical_root) {
        return Err("Driver entrypoint resolves outside its package directory".to_string());
    }
    validate_runtime(&manifest.runtime, package_root)?;
    Ok(())
}

pub(super) fn validate_runtime(
    runtime: &DriverPackageRuntime,
    package_root: &Path,
) -> Result<(), String> {
    let DriverPackageRuntime::Java(java) = runtime else {
        return Ok(());
    };
    if java.java_major != 21 {
        return Err("Java driver packages require managed Java 21".to_string());
    }
    if java.main_class.is_empty()
        || java.main_class.len() > 240
        || !java.main_class.split('.').all(|segment| {
            !segment.is_empty()
                && segment.chars().all(|character| {
                    character.is_ascii_alphanumeric() || character == '_' || character == '$'
                })
        })
    {
        return Err("Java driver mainClass is invalid".to_string());
    }
    if java.classpath.len() > 128 {
        return Err("Java driver classpath contains too many entries".to_string());
    }
    for entry in &java.classpath {
        let _ = package_relative_file(package_root, &entry.path, "Java driver classpath")?;
        validate_sha256(&entry.sha256, "Java driver classpath SHA-256")?;
    }
    Ok(())
}
