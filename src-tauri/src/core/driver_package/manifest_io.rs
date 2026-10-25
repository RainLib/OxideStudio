use super::package_identity::{is_safe_token, package_relative_file, validate_sha256};
use super::types::{
    DriverActivationState, DriverPackageManifest, ManagedJavaRuntimeManifest,
    DRIVER_PACKAGE_SCHEMA_VERSION, MANAGED_JAVA_RUNTIME_KIND, MAX_DRIVER_MANIFEST_BYTES,
};
use std::fs;
use std::io::Write;
use std::path::Path;
use tempfile::NamedTempFile;

pub(super) fn read_manifest(path: &Path) -> Result<DriverPackageManifest, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("Cannot inspect driver manifest: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_DRIVER_MANIFEST_BYTES {
        return Err("Driver manifest is missing or exceeds 256 KiB".to_string());
    }
    let content =
        fs::read(path).map_err(|error| format!("Cannot read driver manifest: {error}"))?;
    serde_json::from_slice(&content)
        .map_err(|error| format!("Driver manifest is invalid JSON: {error}"))
}

pub(super) fn read_managed_java_runtime_manifest(
    path: &Path,
) -> Result<ManagedJavaRuntimeManifest, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Cannot inspect managed Java runtime manifest: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_DRIVER_MANIFEST_BYTES {
        return Err("Managed Java runtime manifest is missing or exceeds 256 KiB".to_string());
    }
    serde_json::from_slice(
        &fs::read(path)
            .map_err(|error| format!("Cannot read managed Java runtime manifest: {error}"))?,
    )
    .map_err(|error| format!("Managed Java runtime manifest is invalid JSON: {error}"))
}

pub(super) fn validate_managed_java_runtime_manifest(
    manifest: &ManagedJavaRuntimeManifest,
    root: &Path,
) -> Result<(), String> {
    if manifest.schema_version != DRIVER_PACKAGE_SCHEMA_VERSION
        || manifest.runtime_kind != MANAGED_JAVA_RUNTIME_KIND
        || manifest.java_major != 21
        || !is_safe_token(&manifest.runtime_version)
    {
        return Err("Managed Java runtime manifest is invalid".to_string());
    }
    let entrypoint = package_relative_file(root, &manifest.entrypoint, "Managed Java runtime")?;
    if entrypoint
        .file_name()
        .and_then(|value| value.to_str())
        .is_none_or(|value| value.is_empty())
    {
        return Err("Managed Java runtime entrypoint is invalid".to_string());
    }
    validate_sha256(&manifest.sha256, "Managed Java runtime SHA-256")?;
    if manifest.supported_targets.len() > 16
        || manifest
            .supported_targets
            .iter()
            .any(|target| target.len() > 96 || target.trim().is_empty())
    {
        return Err("Managed Java runtime targets are invalid".to_string());
    }
    Ok(())
}

pub(super) fn read_active_version(driver_root: &Path) -> Option<String> {
    read_activation_state(driver_root)
        .map(|state| state.current)
        .or_else(|| {
            fs::read_to_string(driver_root.join("current"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| is_safe_token(value))
        })
}

/// Unlike discovery, execution must distinguish no selection from an invalid
/// selection. An unreadable/corrupt marker must never enable bundled fallback.
pub(super) fn read_active_version_strict(driver_root: &Path) -> Result<Option<String>, String> {
    use std::io::Read;
    for (name, json) in [("activation.json", true), ("current", false)] {
        let file = match fs::File::open(driver_root.join(name)) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match fs::symlink_metadata(driver_root.join(name)) {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    _ => return Err("Driver activation exists but cannot be read".into()),
                }
            }
            Err(error) => return Err(format!("Cannot read driver activation: {error}")),
        };
        let mut bytes = Vec::new();
        file.take(16 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Cannot read driver activation: {error}"))?;
        if bytes.len() > 16 * 1024 {
            return Err("Driver activation exceeds 16 KiB".into());
        }
        let version = if json {
            let state: DriverActivationState = serde_json::from_slice(&bytes)
                .map_err(|_| "Driver activation is invalid JSON".to_string())?;
            if state
                .previous
                .as_deref()
                .is_some_and(|value| !is_safe_token(value))
            {
                return Err("Driver activation previous version is invalid".into());
            }
            state.current
        } else {
            String::from_utf8(bytes)
                .map_err(|_| "Driver activation is not UTF-8".to_string())?
                .trim()
                .to_string()
        };
        if !is_safe_token(&version) {
            return Err("Driver activation selected version is invalid".into());
        }
        return Ok(Some(version));
    }
    Ok(None)
}

pub(super) fn read_activation_state(driver_root: &Path) -> Option<DriverActivationState> {
    let path = driver_root.join("activation.json");
    let metadata = fs::metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > 16 * 1024 {
        return None;
    }
    let state: DriverActivationState = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if !is_safe_token(&state.current)
        || state
            .previous
            .as_deref()
            .is_some_and(|value| !is_safe_token(value))
    {
        return None;
    }
    Some(state)
}

pub(super) fn write_activation_state(
    driver_root: &Path,
    state: &DriverActivationState,
) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Cannot encode driver activation state: {error}"))?;
    let destination = driver_root.join("activation.json");
    let mut temporary = NamedTempFile::new_in(driver_root)
        .map_err(|error| format!("Cannot stage driver activation state: {error}"))?;
    temporary
        .write_all(&payload)
        .map_err(|error| format!("Cannot write driver activation state: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("Cannot sync driver activation state: {error}"))?;
    temporary
        .persist(&destination)
        .map_err(|error| format!("Cannot activate driver package: {}", error.error))?;
    Ok(())
}
