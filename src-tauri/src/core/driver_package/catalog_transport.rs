use super::downloads::{
    copy_cached_dependency, dependency_cache_path, dependency_file_matches,
    download_catalog_dependency,
};
use super::package_identity::validated_package_relative_path;
use super::types::DriverPackageCatalogEntry;
use futures::StreamExt;
use std::path::Path;
use url::Url;

pub(super) fn validated_catalog_url(value: &str, label: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|error| format!("{label} is invalid: {error}"))?;
    if url.scheme() != "https" {
        return Err(format!("{label} must use HTTPS"));
    }
    if url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err(format!(
            "{label} must include a host and cannot include credentials"
        ));
    }
    if url.fragment().is_some() || url.query().is_some() {
        return Err(format!("{label} cannot include a query or fragment"));
    }
    Ok(url)
}

pub(super) fn catalog_signature_url(catalog_url: &Url) -> Result<Url, String> {
    let mut signature_url = catalog_url.clone();
    let path = signature_url.path();
    if path.is_empty() || path.ends_with('/') {
        return Err("Driver catalog URL must identify a catalog document".to_string());
    }
    signature_url.set_path(&format!("{path}.minisig"));
    Ok(signature_url)
}

pub(super) async fn fetch_limited_bytes(
    client: &reqwest::Client,
    url: &str,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Cannot fetch signed driver catalog: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Cannot fetch signed driver catalog: server returned {}",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err(format!(
            "Signed driver catalog exceeds {} KiB",
            limit / 1024
        ));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("Cannot read signed driver catalog: {error}"))?;
        let next_len = bytes.len().saturating_add(chunk.len());
        if next_len > limit as usize {
            return Err(format!(
                "Signed driver catalog exceeds {} KiB",
                limit / 1024
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(super) async fn hydrate_catalog_dependencies(
    client: &reqwest::Client,
    registry_root: &Path,
    entry: &DriverPackageCatalogEntry,
    package_root: &Path,
) -> Result<(), String> {
    for dependency in &entry.dependencies {
        let relative =
            validated_package_relative_path(&dependency.path, "Driver catalog dependency")?;
        let destination = package_root.join(relative);
        if destination.exists() {
            if dependency_file_matches(&destination, dependency)? {
                continue;
            }
            return Err(format!(
                "Bundled dependency {} does not match the signed catalog",
                dependency.coordinate
            ));
        }

        let cache_path = dependency_cache_path(registry_root, dependency)?;
        if !copy_cached_dependency(&cache_path, &destination, dependency)? {
            download_catalog_dependency(client, dependency, &cache_path).await?;
            if !copy_cached_dependency(&cache_path, &destination, dependency)? {
                return Err(format!(
                    "Dependency {} was not published to its verified cache",
                    dependency.coordinate
                ));
            }
        }
    }
    Ok(())
}
