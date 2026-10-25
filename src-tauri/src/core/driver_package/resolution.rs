use super::catalog_binding::read_catalog_receipt;
use super::manifest_io::{read_active_version, read_active_version_strict};
use super::package_identity::{
    is_safe_token, protocol_is_compatible, supports_current_target, validate_package_boundary,
    verify_entrypoint_digest, verify_runtime_dependencies,
};
use super::package_validation::{inspect_package, validate_manifest};
use super::signature::verify_package_signature;
use super::types::{DatabaseDriverPackageRegistry, DriverPackageStatus, InstalledDriverPackage};
use std::fs;

impl DatabaseDriverPackageRegistry {
    /// Freeze an explicit pin or the selected version before connecting. Only
    /// the absence of both selection records permits bundled fallback.
    pub fn resolve_preferred(
        &self,
        driver_id: &str,
        package_version: Option<&str>,
    ) -> Result<Option<InstalledDriverPackage>, String> {
        if !is_safe_token(driver_id) {
            return Err("Invalid driver identifier".into());
        }
        let version = match package_version {
            Some(version) => Some(version.to_string()),
            None => read_active_version_strict(&self.root.join(driver_id))?,
        };
        version
            .map(|version| self.resolve_version(driver_id, &version))
            .transpose()
    }

    pub fn list_installed(&self) -> Vec<InstalledDriverPackage> {
        let Ok(driver_directories) = fs::read_dir(&self.root) else {
            return Vec::new();
        };
        let mut packages = Vec::new();

        for driver_directory in driver_directories.flatten() {
            let driver_root = driver_directory.path();
            if !driver_root.is_dir() {
                continue;
            }
            let Some(directory_driver_id) =
                driver_root.file_name().and_then(|value| value.to_str())
            else {
                continue;
            };
            let active_version = read_active_version(&driver_root);
            let Ok(version_directories) = fs::read_dir(&driver_root) else {
                continue;
            };

            for version_directory in version_directories.flatten() {
                let package_root = version_directory.path();
                if !package_root.is_dir() {
                    continue;
                }
                let Some(directory_version) =
                    package_root.file_name().and_then(|value| value.to_str())
                else {
                    continue;
                };
                let manifest_path = package_root.join("manifest.json");
                if !manifest_path.is_file() {
                    continue;
                }
                if let Some(package) = inspect_package(
                    &self.root,
                    &package_root,
                    &manifest_path,
                    directory_driver_id,
                    directory_version,
                    active_version.as_deref(),
                    &self.trust,
                ) {
                    packages.push(package);
                }
            }
        }

        packages.sort_by(|left, right| {
            left.manifest
                .display_name
                .cmp(&right.manifest.display_name)
                .then_with(|| right.active.cmp(&left.active))
                .then_with(|| {
                    right
                        .manifest
                        .package_version
                        .cmp(&left.manifest.package_version)
                })
        });
        packages
    }

    /// Resolve the only package that may be launched for a driver. Invalid,
    /// incompatible, inactive, or ambiguous installations never reach the
    /// process-spawn boundary.
    pub fn resolve_active(&self, driver_id: &str) -> Result<InstalledDriverPackage, String> {
        if !is_safe_token(driver_id) {
            return Err("Invalid driver identifier".to_string());
        }

        let mut candidates = self
            .list_installed()
            .into_iter()
            .filter(|package| package.manifest.driver_id == driver_id && package.active);
        let Some(package) = candidates.next() else {
            return Err(format!("No active external driver package for {driver_id}"));
        };
        if candidates.next().is_some() {
            return Err(format!(
                "Multiple active external driver packages were found for {driver_id}"
            ));
        }
        if package.status != DriverPackageStatus::Ready {
            return Err(package
                .status_message
                .clone()
                .unwrap_or_else(|| format!("External driver package {driver_id} is not ready")));
        }
        self.revalidate_launchable_package(package, driver_id)
    }

    /// Resolve a verified installed version for a connection pinned to a package.
    /// Pinned connections remain valid when another version becomes active, but
    /// still re-check every launch boundary before a process is spawned.
    pub fn resolve_version(
        &self,
        driver_id: &str,
        package_version: &str,
    ) -> Result<InstalledDriverPackage, String> {
        let package = self.ensure_ready_package(driver_id, package_version)?;
        self.revalidate_launchable_package(package, driver_id)
    }

    pub(super) fn revalidate_launchable_package(
        &self,
        mut package: InstalledDriverPackage,
        driver_id: &str,
    ) -> Result<InstalledDriverPackage, String> {
        validate_package_boundary(&self.root, &package.package_root)?;
        validate_manifest(&package.manifest, &package.package_root)?;
        verify_entrypoint_digest(&package.entrypoint, &package.manifest.sha256)?;
        verify_runtime_dependencies(&package.package_root, &package.manifest.runtime)?;
        if !supports_current_target(&package.manifest)
            || !protocol_is_compatible(&package.manifest.protocol_version)
        {
            return Err(format!(
                "External driver package {driver_id} is no longer compatible"
            ));
        }
        verify_entrypoint_digest(&package.entrypoint, &package.manifest.sha256)?;
        verify_package_signature(&package.package_root.join("manifest.json"), &self.trust)?;
        package.catalog_entry = read_catalog_receipt(&package.package_root, &package.manifest).ok();
        package.entrypoint = fs::canonicalize(&package.entrypoint)
            .map_err(|error| format!("Cannot resolve driver entrypoint: {error}"))?;
        Ok(package)
    }
}
