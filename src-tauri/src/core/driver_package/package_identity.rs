use super::types::{DriverPackageManifest, DriverPackageRuntime, InstalledDriverPackage};
use sha2::Digest;
use sha2::Sha256;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

pub(super) fn validated_package_relative_path(value: &str, label: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.len() > 240 {
        return Err(format!("{label} path is invalid"));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!(
            "{label} path must stay inside its package directory"
        ));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::CurDir))
    {
        return Err(format!("{label} path contains an invalid segment"));
    }
    Ok(path.to_path_buf())
}

pub(super) fn package_relative_file(
    package_root: &Path,
    value: &str,
    label: &str,
) -> Result<PathBuf, String> {
    let path = validated_package_relative_path(value, label)?;
    let candidate = package_root.join(path);
    if !candidate.is_file() {
        return Err(format!("{label} entry does not exist"));
    }
    let canonical_root = fs::canonicalize(package_root)
        .map_err(|error| format!("Cannot resolve driver package directory: {error}"))?;
    let canonical_candidate = fs::canonicalize(&candidate)
        .map_err(|error| format!("Cannot resolve {label} entry: {error}"))?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(format!(
            "{label} path resolves outside its package directory"
        ));
    }
    Ok(candidate)
}

pub(super) fn validate_package_boundary(
    registry_root: &Path,
    package_root: &Path,
) -> Result<(), String> {
    let canonical_registry = fs::canonicalize(registry_root)
        .map_err(|error| format!("Cannot resolve driver registry directory: {error}"))?;
    let canonical_package = fs::canonicalize(package_root)
        .map_err(|error| format!("Cannot resolve driver package directory: {error}"))?;
    if !canonical_package.starts_with(&canonical_registry) {
        return Err("Driver package resolves outside the driver registry".to_string());
    }
    Ok(())
}

pub fn is_safe_driver_package_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

pub(super) fn is_safe_token(value: &str) -> bool {
    is_safe_driver_package_token(value)
}

pub(super) fn protocol_is_compatible(protocol_version: &str) -> bool {
    oxide_driver_protocol::protocol_is_compatible(protocol_version)
}

pub(super) fn current_target() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

pub(super) fn supports_current_target(manifest: &DriverPackageManifest) -> bool {
    supports_current_target_names(&manifest.supported_targets)
}

pub(super) fn supports_current_target_names(targets: &[String]) -> bool {
    let aliases = current_target_aliases();
    targets.is_empty()
        || targets.iter().any(|target| {
            target == "*"
                || aliases
                    .iter()
                    .any(|alias| target.eq_ignore_ascii_case(alias))
        })
}

pub(super) fn current_target_aliases() -> Vec<String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let os_alias = match os {
        "macos" => "darwin",
        "windows" => "win32",
        value => value,
    };
    let arch_alias = match arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        value => value,
    };
    let mut aliases = vec![format!("{os}-{arch}"), format!("{os_alias}-{arch_alias}")];
    aliases.sort();
    aliases.dedup();
    aliases
}

pub(super) fn verify_entrypoint_digest(entrypoint: &Path, expected: &str) -> Result<(), String> {
    verify_file_digest(entrypoint, expected, "Driver entrypoint")
}

pub(super) fn verify_runtime_dependencies(
    package_root: &Path,
    runtime: &DriverPackageRuntime,
) -> Result<(), String> {
    let DriverPackageRuntime::Java(java) = runtime else {
        return Ok(());
    };
    for entry in &java.classpath {
        let path = package_relative_file(package_root, &entry.path, "Java driver classpath")?;
        verify_file_digest(&path, &entry.sha256, "Java driver classpath")?;
    }
    Ok(())
}

pub(super) fn validate_sha256(value: &str, label: &str) -> Result<(), String> {
    if value.len() != 64 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(format!("{label} must be a 64-character hex digest"));
    }
    Ok(())
}

pub(super) fn verify_file_digest(path: &Path, expected: &str, label: &str) -> Result<(), String> {
    validate_sha256(expected, &format!("{label} SHA-256"))?;
    let mut file = fs::File::open(path).map_err(|error| format!("Cannot open {label}: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read {label}: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    let actual = format!("{:x}", digest.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!("{label} digest does not match its manifest"))
    }
}

impl InstalledDriverPackage {
    /// Exact migration evidence is narrower than general package compatibility:
    /// wildcard target records and version-family assumptions never authorize
    /// a live migration.
    pub fn has_exact_migration_evidence(&self, server_version: &str) -> bool {
        let Some(entry) = self.catalog_entry.as_ref() else {
            return false;
        };
        let Some(conformance) = entry.conformance.as_ref() else {
            return false;
        };
        if self.manifest.schema_migration.is_none()
            || !conformance
                .migration
                .iter()
                .any(|version| version.eq_ignore_ascii_case(server_version.trim()))
        {
            return false;
        }
        let targets = current_target_aliases();
        conformance.evidence.iter().any(|evidence| {
            evidence.driver_id == self.manifest.driver_id
                && evidence.package_version == self.manifest.package_version
                && evidence
                    .entrypoint_sha256
                    .eq_ignore_ascii_case(&self.manifest.sha256)
                && evidence
                    .server_version
                    .eq_ignore_ascii_case(server_version.trim())
                && evidence
                    .operations
                    .iter()
                    .any(|operation| operation == "migration")
                && targets
                    .iter()
                    .any(|target| evidence.target.eq_ignore_ascii_case(target))
        })
    }
}
