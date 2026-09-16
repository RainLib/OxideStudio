use super::catalog_binding::validate_catalog_receipt_entry;
use super::manifest_io::{
    read_activation_state, read_active_version, read_manifest, write_activation_state,
};
use super::package_identity::is_safe_token;
use super::package_validation::{inspect_package, validate_manifest};
use super::store_copy::{copy_package_tree, PackageCopyBudget};
use super::types::{
    DatabaseDriverPackageRegistry, DriverActivationState, DriverPackageCatalogEntry,
    DriverPackageCatalogReceipt, DriverPackageStatus, InstalledDriverPackage,
    DRIVER_PACKAGE_CATALOG_RECEIPT, DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION,
    MAX_DRIVER_CATALOG_BYTES,
};
use std::fs;
use std::path::Path;
use uuid::Uuid;

impl DatabaseDriverPackageRegistry {
    pub fn install_from_directory(
        &self,
        source: &Path,
        activate: bool,
    ) -> Result<InstalledDriverPackage, String> {
        self.install_from_directory_with_catalog_entry(source, activate, None)
    }

    pub(super) fn install_from_directory_with_catalog_entry(
        &self,
        source: &Path,
        activate: bool,
        catalog_entry: Option<&DriverPackageCatalogEntry>,
    ) -> Result<InstalledDriverPackage, String> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| "Database driver package registry is unavailable".to_string())?;
        let source = fs::canonicalize(source)
            .map_err(|error| format!("Cannot resolve driver package directory: {error}"))?;
        if !source.is_dir() {
            return Err("The selected driver package must be a directory".to_string());
        }
        let source_manifest_path = source.join("manifest.json");
        let source_manifest = read_manifest(&source_manifest_path)?;
        validate_manifest(&source_manifest, &source)?;
        if let Some(entry) = catalog_entry {
            validate_catalog_receipt_entry(entry, &source_manifest)?;
        }

        fs::create_dir_all(&self.root)
            .map_err(|error| format!("Cannot create driver package registry: {error}"))?;
        let staging_root = self.root.join(format!(".install-{}", Uuid::new_v4()));
        let install_result = (|| {
            copy_package_tree(&source, &staging_root, 0, &mut PackageCopyBudget::default())?;
            let receipt_path = staging_root.join(DRIVER_PACKAGE_CATALOG_RECEIPT);
            if receipt_path.exists() {
                return Err(format!(
                    "Driver package contains reserved Host metadata: {DRIVER_PACKAGE_CATALOG_RECEIPT}"
                ));
            }
            let staged_manifest_path = staging_root.join("manifest.json");
            let package = inspect_package(
                &self.root,
                &staging_root,
                &staged_manifest_path,
                &source_manifest.driver_id,
                &source_manifest.package_version,
                None,
                &self.trust,
            )
            .ok_or_else(|| "Driver package manifest cannot be read after staging".to_string())?;
            if package.status != DriverPackageStatus::Ready {
                return Err(package
                    .status_message
                    .unwrap_or_else(|| "Driver package failed verification".to_string()));
            }

            if let Some(entry) = catalog_entry {
                let receipt = DriverPackageCatalogReceipt {
                    schema_version: DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION,
                    entry: entry.clone(),
                };
                let encoded = serde_json::to_vec_pretty(&receipt)
                    .map_err(|error| format!("Cannot encode driver catalog receipt: {error}"))?;
                if encoded.len() as u64 > MAX_DRIVER_CATALOG_BYTES {
                    return Err("Driver catalog receipt exceeds the size limit".to_string());
                }
                fs::write(&receipt_path, encoded)
                    .map_err(|error| format!("Cannot write driver catalog receipt: {error}"))?;
            }

            let driver_root = self.root.join(&source_manifest.driver_id);
            fs::create_dir_all(&driver_root)
                .map_err(|error| format!("Cannot create driver package directory: {error}"))?;
            let destination = driver_root.join(&source_manifest.package_version);
            if destination.exists() {
                return Err(format!(
                    "Driver package {} {} is already installed",
                    source_manifest.driver_id, source_manifest.package_version
                ));
            }
            fs::rename(&staging_root, &destination)
                .map_err(|error| format!("Cannot commit driver package installation: {error}"))?;

            if activate {
                self.activate_package_locked(
                    &source_manifest.driver_id,
                    &source_manifest.package_version,
                )?;
            }
            self.list_installed()
                .into_iter()
                .find(|installed| {
                    installed.manifest.driver_id == source_manifest.driver_id
                        && installed.manifest.package_version == source_manifest.package_version
                })
                .ok_or_else(|| "Installed driver package cannot be resolved".to_string())
        })();

        if staging_root.exists() {
            let _ = fs::remove_dir_all(&staging_root);
        }
        install_result
    }

    pub fn activate_package(
        &self,
        driver_id: &str,
        package_version: &str,
    ) -> Result<DriverActivationState, String> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| "Database driver package registry is unavailable".to_string())?;
        self.activate_package_locked(driver_id, package_version)
    }

    pub fn rollback_package(&self, driver_id: &str) -> Result<DriverActivationState, String> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| "Database driver package registry is unavailable".to_string())?;
        if !is_safe_token(driver_id) {
            return Err("Invalid driver identifier".to_string());
        }
        let driver_root = self.root.join(driver_id);
        let state = read_activation_state(&driver_root)
            .ok_or_else(|| format!("No rollback state exists for {driver_id}"))?;
        let previous = state
            .previous
            .as_deref()
            .ok_or_else(|| format!("No previous package exists for {driver_id}"))?;
        let next = self.ensure_ready_package(driver_id, previous)?;
        let rolled_back = DriverActivationState {
            current: next.manifest.package_version,
            previous: Some(state.current),
        };
        write_activation_state(&driver_root, &rolled_back)?;
        Ok(rolled_back)
    }

    pub(super) fn activate_package_locked(
        &self,
        driver_id: &str,
        package_version: &str,
    ) -> Result<DriverActivationState, String> {
        let package = self.ensure_ready_package(driver_id, package_version)?;
        let driver_root = self.root.join(driver_id);
        let old_current = read_active_version(&driver_root);
        let state = DriverActivationState {
            current: package.manifest.package_version,
            previous: old_current.filter(|version| version != package_version),
        };
        write_activation_state(&driver_root, &state)?;
        Ok(state)
    }

    pub(super) fn ensure_ready_package(
        &self,
        driver_id: &str,
        package_version: &str,
    ) -> Result<InstalledDriverPackage, String> {
        if !is_safe_token(driver_id) || !is_safe_token(package_version) {
            return Err("Invalid driver package identity".to_string());
        }
        let package = self
            .list_installed()
            .into_iter()
            .find(|package| {
                package.manifest.driver_id == driver_id
                    && package.manifest.package_version == package_version
            })
            .ok_or_else(|| {
                format!("Driver package {driver_id} {package_version} is not installed")
            })?;
        if package.status != DriverPackageStatus::Ready {
            return Err(package.status_message.clone().unwrap_or_else(|| {
                format!("Driver package {driver_id} {package_version} is not ready")
            }));
        }
        Ok(package)
    }
}
