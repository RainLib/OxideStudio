use super::manifest_io::{
    read_activation_state, read_managed_java_runtime_manifest,
    validate_managed_java_runtime_manifest, write_activation_state,
};
use super::package_identity::{
    current_target, is_safe_token, supports_current_target_names, verify_file_digest,
};
use super::signature::verify_package_signature;
use super::store_copy::{copy_package_tree, PackageCopyBudget};
use super::types::{
    DatabaseDriverPackageRegistry, DriverActivationState, DriverPackageStatus,
    InstalledDriverPackage, ManagedJavaRuntimeInstallation, MANAGED_JAVA_RUNTIME_MANIFEST,
};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

impl DatabaseDriverPackageRegistry {
    pub fn managed_java_runtime_installations(&self) -> Vec<ManagedJavaRuntimeInstallation> {
        let root = self.root.join("_runtimes");
        let Ok(majors) = fs::read_dir(&root) else {
            return Vec::new();
        };
        let target = current_target();
        let mut installations = Vec::new();
        for major_entry in majors.flatten() {
            let name = major_entry.file_name().to_string_lossy().to_string();
            let Some(java_major) = name
                .strip_prefix("java-")
                .and_then(|value| value.parse::<u8>().ok())
            else {
                continue;
            };
            let target_root = major_entry.path().join(&target);
            let active = read_activation_state(&target_root).map(|state| state.current);
            let Ok(versions) = fs::read_dir(&target_root) else {
                continue;
            };
            for version in versions.flatten() {
                let version_name = version.file_name().to_string_lossy().to_string();
                if !is_safe_token(&version_name) {
                    continue;
                }
                let manifest_path = version.path().join(MANAGED_JAVA_RUNTIME_MANIFEST);
                let Ok(manifest) = read_managed_java_runtime_manifest(&manifest_path) else {
                    continue;
                };
                let verification =
                    validate_managed_java_runtime_manifest(&manifest, &version.path())
                        .and_then(|_| {
                            verify_file_digest(
                                &version.path().join(&manifest.entrypoint),
                                &manifest.sha256,
                                "Managed Java runtime entrypoint",
                            )
                        })
                        .and_then(|_| verify_package_signature(&manifest_path, &self.trust));
                let (status, status_message) = match verification {
                    Ok(()) if supports_current_target_names(&manifest.supported_targets) => {
                        (DriverPackageStatus::Ready, None)
                    }
                    Ok(()) => (
                        DriverPackageStatus::Incompatible,
                        Some(format!("Runtime does not support {target}")),
                    ),
                    Err(error) => (DriverPackageStatus::Invalid, Some(error)),
                };
                installations.push(ManagedJavaRuntimeInstallation {
                    java_major,
                    runtime_version: manifest.runtime_version,
                    target: target.clone(),
                    active: active.as_deref() == Some(&version_name),
                    status,
                    status_message,
                });
            }
        }
        installations.sort_by(|left, right| {
            left.java_major
                .cmp(&right.java_major)
                .then(left.runtime_version.cmp(&right.runtime_version))
        });
        installations
    }

    /// Resolves the active Java runtime for a verified JDBC package. The
    /// runtime is checked again immediately before launch so neither a stale
    /// activation record nor a post-install binary replacement can become a
    /// process-execution path.
    pub fn resolve_managed_java_runtime_binary(
        &self,
        package: &InstalledDriverPackage,
        java_major: u8,
    ) -> Result<PathBuf, String> {
        if java_major != 21 {
            return Err("Only managed Java 21 runtimes are supported".to_string());
        }
        let package_root = fs::canonicalize(&package.package_root)
            .map_err(|error| format!("Cannot resolve driver package root: {error}"))?;
        let registry_root = fs::canonicalize(&self.root)
            .map_err(|error| format!("Cannot resolve driver package registry: {error}"))?;
        if !package_root.starts_with(&registry_root) {
            return Err("Driver package is outside the managed registry".to_string());
        }
        let target_root = registry_root
            .join("_runtimes")
            .join(format!("java-{java_major}"))
            .join(current_target());
        let active = read_activation_state(&target_root).ok_or_else(|| {
            format!(
                "No managed Java {java_major} runtime is active for {}",
                current_target()
            )
        })?;
        let runtime_root = target_root.join(&active.current);
        let manifest_path = runtime_root.join(MANAGED_JAVA_RUNTIME_MANIFEST);
        let manifest = read_managed_java_runtime_manifest(&manifest_path)?;
        if manifest.java_major != java_major || manifest.runtime_version != active.current {
            return Err("Managed Java runtime activation does not match its manifest".to_string());
        }
        validate_managed_java_runtime_manifest(&manifest, &runtime_root)?;
        if !supports_current_target_names(&manifest.supported_targets) {
            return Err(format!(
                "Managed Java runtime does not support {}",
                current_target()
            ));
        }
        verify_file_digest(
            &runtime_root.join(&manifest.entrypoint),
            &manifest.sha256,
            "Managed Java runtime entrypoint",
        )?;
        verify_package_signature(&manifest_path, &self.trust)?;
        let binary = fs::canonicalize(runtime_root.join(&manifest.entrypoint))
            .map_err(|error| format!("Cannot resolve managed Java runtime entrypoint: {error}"))?;
        let runtime_root = fs::canonicalize(&runtime_root)
            .map_err(|error| format!("Cannot resolve managed Java runtime directory: {error}"))?;
        if !binary.starts_with(&runtime_root) || !binary.is_file() {
            return Err("Managed Java runtime entrypoint is invalid".to_string());
        }
        Ok(binary)
    }

    pub fn install_managed_java_runtime_from_directory(
        &self,
        source: &Path,
        activate: bool,
    ) -> Result<ManagedJavaRuntimeInstallation, String> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| "Database driver package registry is unavailable".to_string())?;
        let source = fs::canonicalize(source)
            .map_err(|error| format!("Cannot resolve managed Java runtime directory: {error}"))?;
        if !source.is_dir() {
            return Err("The selected managed Java runtime must be a directory".to_string());
        }
        let manifest_path = source.join(MANAGED_JAVA_RUNTIME_MANIFEST);
        let manifest = read_managed_java_runtime_manifest(&manifest_path)?;
        validate_managed_java_runtime_manifest(&manifest, &source)?;
        if !supports_current_target_names(&manifest.supported_targets) {
            return Err(format!(
                "Managed Java runtime does not support {}",
                current_target()
            ));
        }
        fs::create_dir_all(&self.root)
            .map_err(|error| format!("Cannot create driver package registry: {error}"))?;
        let staging = self
            .root
            .join(format!(".runtime-install-{}", Uuid::new_v4()));
        let result = (|| {
            copy_package_tree(&source, &staging, 0, &mut PackageCopyBudget::default())?;
            let staged_manifest_path = staging.join(MANAGED_JAVA_RUNTIME_MANIFEST);
            let staged_manifest = read_managed_java_runtime_manifest(&staged_manifest_path)?;
            validate_managed_java_runtime_manifest(&staged_manifest, &staging)?;
            verify_file_digest(
                &staging.join(&staged_manifest.entrypoint),
                &staged_manifest.sha256,
                "Managed Java runtime entrypoint",
            )?;
            verify_package_signature(&staged_manifest_path, &self.trust)?;
            let target_root = self
                .root
                .join("_runtimes")
                .join(format!("java-{}", staged_manifest.java_major))
                .join(current_target());
            fs::create_dir_all(&target_root)
                .map_err(|error| format!("Cannot create managed Java runtime registry: {error}"))?;
            let destination = target_root.join(&staged_manifest.runtime_version);
            if destination.exists() {
                return Err(format!(
                    "Managed Java runtime {} is already installed",
                    staged_manifest.runtime_version
                ));
            }
            fs::rename(&staging, &destination).map_err(|error| {
                format!("Cannot commit managed Java runtime installation: {error}")
            })?;
            if activate {
                write_activation_state(
                    &target_root,
                    &DriverActivationState {
                        current: staged_manifest.runtime_version.clone(),
                        previous: read_activation_state(&target_root).map(|state| state.current),
                    },
                )?;
            }
            Ok(())
        })();
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging);
        }
        result?;
        self.managed_java_runtime_installations()
            .into_iter()
            .find(|item| {
                item.java_major == manifest.java_major
                    && item.runtime_version == manifest.runtime_version
            })
            .ok_or_else(|| "Installed managed Java runtime cannot be resolved".to_string())
    }
}
