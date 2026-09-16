use super::cache::{
    archive_file_matches_digest, catalog_cache_partial_path, ensure_catalog_cache_parent,
    publish_resumed_driver_archive, resumable_partial_length, update_digest_from_file,
    validate_content_range,
};
use super::package_identity::validate_sha256;
use super::types::{
    DriverPackageCatalogDependency, DRIVER_DEPENDENCY_CACHE_DIRECTORY, MAX_DRIVER_DEPENDENCY_BYTES,
    MAX_DRIVER_PACKAGE_ARCHIVE_BYTES,
};
use futures::StreamExt;
use reqwest::header::{CONTENT_RANGE, RANGE};
use reqwest::StatusCode;
use sha2::Digest;
use sha2::Sha256;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub(super) fn dependency_cache_path(
    registry_root: &Path,
    dependency: &DriverPackageCatalogDependency,
) -> Result<PathBuf, String> {
    validate_sha256(&dependency.sha256, "Driver catalog dependency SHA-256")?;
    Ok(registry_root
        .join(DRIVER_DEPENDENCY_CACHE_DIRECTORY)
        .join(format!("{}.jar", dependency.sha256.to_ascii_lowercase())))
}

pub(super) fn dependency_file_matches(
    path: &Path,
    dependency: &DriverPackageCatalogDependency,
) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("Cannot inspect cached driver dependency: {error}")),
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() != dependency.size_bytes
        || metadata.len() > MAX_DRIVER_DEPENDENCY_BYTES
    {
        return Ok(false);
    }
    let mut input = fs::File::open(path)
        .map_err(|error| format!("Cannot read cached driver dependency: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read cached driver dependency: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()).eq_ignore_ascii_case(&dependency.sha256))
}

pub(super) fn ensure_dependency_cache_parent(cache_path: &Path) -> Result<(), String> {
    let cache_root = cache_path
        .parent()
        .ok_or_else(|| "Driver dependency cache path has no parent".to_string())?;
    fs::create_dir_all(cache_root)
        .map_err(|error| format!("Cannot create driver dependency cache: {error}"))?;
    let metadata = fs::symlink_metadata(cache_root)
        .map_err(|error| format!("Cannot inspect driver dependency cache: {error}"))?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err("Driver dependency cache directory is invalid".to_string());
    }
    Ok(())
}

pub(super) fn copy_cached_dependency(
    cache_path: &Path,
    destination: &Path,
    dependency: &DriverPackageCatalogDependency,
) -> Result<bool, String> {
    if !dependency_file_matches(cache_path, dependency)? {
        if cache_path.exists() {
            fs::remove_file(cache_path)
                .map_err(|error| format!("Cannot remove invalid dependency cache file: {error}"))?;
        }
        return Ok(false);
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Driver dependency destination has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create driver dependency directory: {error}"))?;
    let mut input = fs::File::open(cache_path)
        .map_err(|error| format!("Cannot open cached driver dependency: {error}"))?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| format!("Cannot stage driver dependency: {error}"))?;
    std::io::copy(&mut input, &mut output)
        .map_err(|error| format!("Cannot copy cached driver dependency: {error}"))?;
    output
        .sync_all()
        .map_err(|error| format!("Cannot finalize driver dependency: {error}"))?;
    if !dependency_file_matches(destination, dependency)? {
        let _ = fs::remove_file(destination);
        return Err("Copied driver dependency failed digest verification".to_string());
    }
    Ok(true)
}

pub(super) async fn download_catalog_dependency(
    client: &reqwest::Client,
    dependency: &DriverPackageCatalogDependency,
    destination: &Path,
) -> Result<(), String> {
    ensure_dependency_cache_parent(destination)?;
    if dependency_file_matches(destination, dependency)? {
        return Ok(());
    }
    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|error| format!("Cannot reset invalid dependency cache file: {error}"))?;
    }
    let partial = destination.with_file_name(format!(
        ".{}.jar.partial",
        dependency.sha256.to_ascii_lowercase()
    ));
    let mut retry_without_range = false;

    for _ in 0..2 {
        if retry_without_range && partial.exists() {
            fs::remove_file(&partial)
                .map_err(|error| format!("Cannot reset driver dependency download: {error}"))?;
        }
        let existing = dependency_partial_length(&partial, dependency.size_bytes)?;
        let mut request = client.get(&dependency.download_url);
        if existing > 0 {
            request = request.header(RANGE, format!("bytes={existing}-"));
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("Cannot download driver dependency: {error}"))?;
        if existing > 0 && response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
            if dependency_file_matches(&partial, dependency)? {
                fs::rename(&partial, destination).map_err(|error| {
                    format!("Cannot publish verified driver dependency: {error}")
                })?;
                return Ok(());
            }
            retry_without_range = true;
            continue;
        }

        let append = if existing > 0 && response.status() == StatusCode::PARTIAL_CONTENT {
            validate_dependency_content_range(
                response.headers().get(CONTENT_RANGE),
                existing,
                dependency.size_bytes,
            )?;
            true
        } else if response.status() == StatusCode::OK {
            false
        } else {
            return Err(format!(
                "Cannot download driver dependency: server returned {}",
                response.status()
            ));
        };
        let retained = if append { existing } else { 0 };
        if response.content_length().is_some_and(|length| {
            retained
                .checked_add(length)
                .is_none_or(|total| total != dependency.size_bytes)
        }) {
            return Err(
                "Driver dependency response size does not match the signed catalog".to_string(),
            );
        }

        let mut digest = Sha256::new();
        if append {
            update_dependency_digest_from_file(&partial, dependency.size_bytes, &mut digest)?;
        }
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .append(append)
            .truncate(!append)
            .open(&partial)
            .map_err(|error| format!("Cannot stage driver dependency download: {error}"))?;
        let mut downloaded = retained;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    let _ = output.sync_data();
                    return Err(format!("Cannot read driver dependency download: {error}"));
                }
            };
            downloaded = downloaded
                .checked_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX))
                .ok_or_else(|| "Driver dependency size overflow".to_string())?;
            if downloaded > dependency.size_bytes {
                let _ = output.sync_data();
                return Err("Driver dependency exceeds its signed size".to_string());
            }
            output
                .write_all(&chunk)
                .map_err(|error| format!("Cannot write driver dependency download: {error}"))?;
            digest.update(&chunk);
        }
        output
            .sync_all()
            .map_err(|error| format!("Cannot finalize driver dependency download: {error}"))?;
        drop(output);
        if downloaded != dependency.size_bytes {
            return Err("Driver dependency download ended before its signed size".to_string());
        }
        let actual = format!("{:x}", digest.finalize());
        if !actual.eq_ignore_ascii_case(&dependency.sha256) {
            fs::remove_file(&partial)
                .map_err(|error| format!("Cannot remove invalid driver dependency: {error}"))?;
            return Err("Driver dependency digest does not match the signed catalog".to_string());
        }
        fs::rename(&partial, destination)
            .map_err(|error| format!("Cannot publish verified driver dependency: {error}"))?;
        return Ok(());
    }
    Err("Driver dependency server rejected the cached resume offset".to_string())
}

pub(super) fn dependency_partial_length(path: &Path, expected_size: u64) -> Result<u64, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(format!(
                "Cannot inspect driver dependency download: {error}"
            ))
        }
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > expected_size
    {
        return Err("Incomplete driver dependency cache entry is invalid".to_string());
    }
    Ok(metadata.len())
}

pub(super) fn update_dependency_digest_from_file(
    path: &Path,
    expected_size: u64,
    digest: &mut Sha256,
) -> Result<(), String> {
    let mut input = fs::File::open(path)
        .map_err(|error| format!("Cannot read incomplete driver dependency: {error}"))?;
    let mut read_total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read incomplete driver dependency: {error}"))?;
        if read == 0 {
            break;
        }
        read_total = read_total
            .checked_add(u64::try_from(read).unwrap_or(u64::MAX))
            .ok_or_else(|| "Driver dependency size overflow".to_string())?;
        if read_total > expected_size {
            return Err("Incomplete driver dependency exceeds its signed size".to_string());
        }
        digest.update(&buffer[..read]);
    }
    Ok(())
}

pub(super) fn validate_dependency_content_range(
    value: Option<&reqwest::header::HeaderValue>,
    expected_start: u64,
    expected_total: u64,
) -> Result<(), String> {
    let value = value.and_then(|value| value.to_str().ok()).ok_or_else(|| {
        "Driver dependency resume response has no valid Content-Range".to_string()
    })?;
    let value = value.strip_prefix("bytes ").ok_or_else(|| {
        "Driver dependency resume response has an invalid Content-Range".to_string()
    })?;
    let (range, total) = value.split_once('/').ok_or_else(|| {
        "Driver dependency resume response has an invalid Content-Range".to_string()
    })?;
    let (start, end) = range.split_once('-').ok_or_else(|| {
        "Driver dependency resume response has an invalid Content-Range".to_string()
    })?;
    let start = start.parse::<u64>().map_err(|_| {
        "Driver dependency resume response has an invalid Content-Range".to_string()
    })?;
    let end = end.parse::<u64>().map_err(|_| {
        "Driver dependency resume response has an invalid Content-Range".to_string()
    })?;
    let total = total.parse::<u64>().map_err(|_| {
        "Driver dependency resume response has an invalid Content-Range".to_string()
    })?;
    if start != expected_start || end < start || end >= total || total != expected_total {
        return Err("Driver dependency resume response has an unsafe Content-Range".to_string());
    }
    Ok(())
}

pub(super) async fn download_driver_package_archive(
    client: &reqwest::Client,
    url: &str,
    destination: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    validate_sha256(expected_sha256, "Driver package archive SHA-256")?;
    ensure_catalog_cache_parent(destination)?;
    let partial_path = catalog_cache_partial_path(destination)?;
    let mut retry_without_range = false;

    for attempt in 0..2 {
        if retry_without_range && partial_path.exists() {
            fs::remove_file(&partial_path).map_err(|error| {
                format!("Cannot reset incomplete driver package download: {error}")
            })?;
        }
        let existing = resumable_partial_length(&partial_path)?;
        let mut request = client.get(url);
        if existing > 0 {
            request = request.header(RANGE, format!("bytes={existing}-"));
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("Cannot download driver package: {error}"))?;

        if existing > 0 && response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
            if archive_file_matches_digest(&partial_path, expected_sha256)? {
                publish_resumed_driver_archive(&partial_path, destination, expected_sha256)?;
                return Ok(());
            }
            retry_without_range = true;
            continue;
        }

        let append = if existing > 0 && response.status() == StatusCode::PARTIAL_CONTENT {
            if let Err(error) =
                validate_content_range(response.headers().get(CONTENT_RANGE), existing)
            {
                fs::remove_file(&partial_path).map_err(|remove_error| {
                    format!("Cannot reset unsafe driver package resume: {remove_error}")
                })?;
                if attempt == 0 {
                    retry_without_range = true;
                    continue;
                }
                return Err(error);
            }
            true
        } else if response.status() == StatusCode::OK {
            false
        } else {
            return Err(format!(
                "Cannot download driver package: server returned {}",
                response.status()
            ));
        };
        let retained = if append { existing } else { 0 };
        if response.content_length().is_some_and(|length| {
            retained
                .checked_add(length)
                .is_none_or(|total| total > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES)
        }) {
            return Err("Driver package archive exceeds the 512 MiB limit".to_string());
        }

        let mut digest = Sha256::new();
        if append {
            update_digest_from_file(&partial_path, &mut digest)?;
        }
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .append(append)
            .truncate(!append)
            .open(&partial_path)
            .map_err(|error| format!("Cannot open incomplete driver package download: {error}"))?;
        let mut downloaded = retained;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    let _ = output.sync_data();
                    return Err(format!("Cannot read driver package download: {error}"));
                }
            };
            downloaded = downloaded
                .checked_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX))
                .ok_or_else(|| "Driver package archive size overflow".to_string())?;
            if downloaded > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES {
                let _ = output.sync_data();
                return Err("Driver package archive exceeds the 512 MiB limit".to_string());
            }
            output
                .write_all(&chunk)
                .map_err(|error| format!("Cannot stage driver package archive: {error}"))?;
            digest.update(&chunk);
        }
        output
            .sync_all()
            .map_err(|error| format!("Cannot finalize driver package archive: {error}"))?;
        drop(output);
        let actual = format!("{:x}", digest.finalize());
        if !actual.eq_ignore_ascii_case(expected_sha256) {
            fs::remove_file(&partial_path).map_err(|error| {
                format!("Cannot remove invalid driver package download: {error}")
            })?;
            return Err(
                "Driver package archive digest does not match the signed catalog".to_string(),
            );
        }
        publish_resumed_driver_archive(&partial_path, destination, expected_sha256)?;
        return Ok(());
    }

    Err("Driver package server rejected the cached resume offset".to_string())
}
