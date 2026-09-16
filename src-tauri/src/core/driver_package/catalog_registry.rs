use super::archive::unpack_driver_package_archive;
use super::cache::{catalog_cache_archive_path, copy_cached_driver_package_archive};
use super::catalog_binding::validate_catalog_manifest_binding;
use super::catalog_transport::{
    catalog_signature_url, fetch_limited_bytes, hydrate_catalog_dependencies, validated_catalog_url,
};
use super::catalog_validation::{validate_driver_catalog, verify_detached_document};
use super::downloads::download_driver_package_archive;
use super::manifest_io::read_manifest;
use super::package_identity::{is_safe_token, validate_sha256};
use super::types::{
    DatabaseDriverPackageRegistry, DriverPackageCatalog, InstalledDriverPackage,
    MAX_DRIVER_CATALOG_BYTES, MAX_DRIVER_SIGNATURE_BYTES,
};
use std::time::Duration;
use tempfile::TempDir;

impl DatabaseDriverPackageRegistry {
    /// Fetch a small signed catalog without downloading or executing any
    /// package. The catalog's detached signature uses the same build-time
    /// Minisign trust root as each independently installed driver package.
    pub async fn fetch_signed_catalog(
        &self,
        catalog_url: &str,
    ) -> Result<DriverPackageCatalog, String> {
        let catalog_url = validated_catalog_url(catalog_url, "Driver catalog URL")?;
        let signature_url = catalog_signature_url(&catalog_url)?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .user_agent("OxideStudio driver catalog")
            .build()
            .map_err(|error| format!("Cannot initialize driver catalog client: {error}"))?;
        let catalog =
            fetch_limited_bytes(&client, catalog_url.as_str(), MAX_DRIVER_CATALOG_BYTES).await?;
        let signature =
            fetch_limited_bytes(&client, signature_url.as_str(), MAX_DRIVER_SIGNATURE_BYTES)
                .await?;
        verify_detached_document(&catalog, &signature, &self.trust, "Driver catalog")?;
        let catalog: DriverPackageCatalog = serde_json::from_slice(&catalog)
            .map_err(|error| format!("Driver catalog is not valid JSON: {error}"))?;
        validate_driver_catalog(&catalog)?;
        Ok(catalog)
    }

    /// Download one explicitly selected catalog release into a temporary
    /// directory, verify its signed catalog digest, extract only regular files
    /// and directories, then run the normal local package installation path.
    /// Activation intentionally remains a separate command-layer decision so
    /// live connection ownership can still block a version switch.
    pub async fn install_from_signed_catalog(
        &self,
        catalog_url: &str,
        driver_id: &str,
        package_version: &str,
    ) -> Result<InstalledDriverPackage, String> {
        if !is_safe_token(driver_id) || !is_safe_token(package_version) {
            return Err("Invalid driver package identity".to_string());
        }
        let catalog = self.fetch_signed_catalog(catalog_url).await?;
        let entry = catalog
            .packages
            .iter()
            .find(|entry| entry.driver_id == driver_id && entry.package_version == package_version)
            .ok_or_else(|| {
                format!(
                    "Signed catalog does not contain driver package {driver_id} {package_version}"
                )
            })?;
        let archive_sha256 = entry.archive_sha256.as_deref().ok_or_else(|| {
            "This catalog entry does not publish an archive SHA-256; review and import it manually"
                .to_string()
        })?;
        validate_sha256(archive_sha256, "Driver package archive SHA-256")?;
        let download_url =
            validated_catalog_url(&entry.download_url, "Driver package download URL")?;

        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(90))
            .user_agent("OxideStudio driver package installer")
            .build()
            .map_err(|error| format!("Cannot initialize driver package client: {error}"))?;
        let temporary = TempDir::new()
            .map_err(|error| format!("Cannot create driver package staging directory: {error}"))?;
        let archive_path = temporary.path().join("package.tar.gz");
        let cache_path = catalog_cache_archive_path(
            &self.root,
            &entry.driver_id,
            &entry.package_version,
            archive_sha256,
        )?;
        let _download_guard = self.download_lock.lock().await;
        if !copy_cached_driver_package_archive(&cache_path, &archive_path, archive_sha256)? {
            download_driver_package_archive(
                &client,
                download_url.as_str(),
                &cache_path,
                archive_sha256,
            )
            .await?;
            if !copy_cached_driver_package_archive(&cache_path, &archive_path, archive_sha256)? {
                return Err(
                    "Downloaded driver package was not published to its verified cache".to_string(),
                );
            }
        }
        let unpacked = temporary.path().join("package");
        unpack_driver_package_archive(&archive_path, &unpacked)?;
        let downloaded_manifest = read_manifest(&unpacked.join("manifest.json"))?;
        validate_catalog_manifest_binding(entry, &downloaded_manifest)?;
        hydrate_catalog_dependencies(&client, &self.root, entry, &unpacked).await?;
        let installed =
            self.install_from_directory_with_catalog_entry(&unpacked, false, Some(entry))?;
        Ok(installed)
    }
}
