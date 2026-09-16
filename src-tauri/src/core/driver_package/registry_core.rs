use super::cache::{
    activation_retained_driver_packages, prune_catalog_cache_files, prune_dependency_cache_files,
};
use super::manifest_io::read_activation_state;
use super::package_identity::is_safe_token;
use super::store_copy::{copy_driver_store_tree, DriverStoreCopyBudget};
use super::types::{
    DatabaseDriverPackageRegistry, DriverActivationState, DriverPackageCachePruneResult,
    DriverPackageTrust, DRIVER_DEPENDENCY_CACHE_DIRECTORY, DRIVER_PACKAGE_CACHE_DIRECTORY,
};
use minisign_verify::PublicKey;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as AsyncMutex;

impl DatabaseDriverPackageRegistry {
    pub fn new(root: PathBuf) -> Self {
        let trust = match option_env!("OXIDE_DRIVER_SIGNING_PUBLIC_KEY")
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(value) => PublicKey::decode(value)
                .or_else(|_| PublicKey::from_base64(value))
                .map(DriverPackageTrust::PublicKey)
                .unwrap_or_else(|error| DriverPackageTrust::InvalidKey(error.to_string())),
            None => DriverPackageTrust::Unavailable,
        };
        Self {
            root,
            trust,
            mutation_lock: Arc::new(Mutex::new(())),
            download_lock: Arc::new(AsyncMutex::new(())),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Remove disposable catalog archives while retaining every version that
    /// could still be needed by activation, rollback, a pinned connection, or
    /// a currently running sidecar. Cleanup is serialized with downloads and
    /// package mutations so a partial archive cannot disappear mid-write.
    pub async fn prune_catalog_cache(
        &self,
        additional_retained: &BTreeSet<(String, String)>,
    ) -> Result<DriverPackageCachePruneResult, String> {
        let _download_guard = self.download_lock.lock().await;
        let _mutation_guard = self
            .mutation_lock
            .lock()
            .map_err(|_| "Database driver package registry is unavailable".to_string())?;
        let mut retained = activation_retained_driver_packages(&self.root);
        retained.extend(
            additional_retained
                .iter()
                .filter(|(driver, version)| {
                    is_safe_token(driver.as_str()) && is_safe_token(version.as_str())
                })
                .cloned(),
        );
        let mut result =
            prune_catalog_cache_files(&self.root.join(DRIVER_PACKAGE_CACHE_DIRECTORY), &retained)?;
        let dependencies =
            prune_dependency_cache_files(&self.root.join(DRIVER_DEPENDENCY_CACHE_DIRECTORY))?;
        result.files_removed = result
            .files_removed
            .saturating_add(dependencies.files_removed);
        result.partial_files_removed = result
            .partial_files_removed
            .saturating_add(dependencies.partial_files_removed);
        result.bytes_removed = result
            .bytes_removed
            .saturating_add(dependencies.bytes_removed);
        result.skipped_entries = result
            .skipped_entries
            .saturating_add(dependencies.skipped_entries);
        Ok(result)
    }

    /// Copy the complete driver store into a fresh sibling staging directory
    /// and atomically publish it at `target`. The running registry deliberately
    /// remains on its original root; callers persist the target as a
    /// restart-required setting only after this method succeeds.
    pub fn stage_store_migration(&self, target: &Path) -> Result<(), String> {
        if !target.is_absolute() {
            return Err("Driver store destination must be an absolute path".to_string());
        }
        if target.exists() {
            return Err("Driver store destination must not already exist".to_string());
        }
        let source = if self.root.exists() {
            fs::canonicalize(&self.root)
                .map_err(|error| format!("Cannot resolve current driver store: {error}"))?
        } else {
            self.root.clone()
        };
        if source == target {
            return Err("Driver store destination is already active".to_string());
        }
        let parent = target
            .parent()
            .ok_or_else(|| "Driver store destination must have a parent directory".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create driver store parent directory: {error}"))?;

        if !source.exists() {
            fs::create_dir(target)
                .map_err(|error| format!("Cannot create new driver store: {error}"))?;
            return Ok(());
        }

        let staging = tempfile::Builder::new()
            .prefix("oxide-driver-store-")
            .tempdir_in(parent)
            .map_err(|error| format!("Cannot create driver store staging directory: {error}"))?;
        let staged_store = staging.path().join("store");
        let mut budget = DriverStoreCopyBudget::default();
        copy_driver_store_tree(&source, &staged_store, 0, &mut budget)?;

        // Re-read all package manifests in the staged location before it is
        // published. This catches truncation and accidental layout changes;
        // signature status is intentionally preserved and will be rechecked at
        // package launch time as usual.
        let staged_registry = Self::new(staged_store.clone());
        let _ = staged_registry.list_installed();
        fs::rename(&staged_store, target)
            .map_err(|error| format!("Cannot publish migrated driver store: {error}"))?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn allow_unsigned_for_tests(root: PathBuf) -> Self {
        Self {
            root,
            trust: DriverPackageTrust::AllowUnsigned,
            mutation_lock: Arc::new(Mutex::new(())),
            download_lock: Arc::new(AsyncMutex::new(())),
        }
    }

    #[cfg(test)]
    pub(super) fn require_signature_for_tests(root: PathBuf) -> Self {
        Self {
            root,
            trust: DriverPackageTrust::Unavailable,
            mutation_lock: Arc::new(Mutex::new(())),
            download_lock: Arc::new(AsyncMutex::new(())),
        }
    }

    pub fn activation_state(&self, driver_id: &str) -> Option<DriverActivationState> {
        if !is_safe_token(driver_id) {
            return None;
        }
        read_activation_state(&self.root.join(driver_id))
    }
}
