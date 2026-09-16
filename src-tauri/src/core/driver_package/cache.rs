use super::manifest_io::read_activation_state;
use super::package_identity::{is_safe_token, validate_sha256};
use super::types::{
    DriverPackageCachePruneResult, DRIVER_PACKAGE_CACHE_DIRECTORY, MAX_DRIVER_PACKAGE_ARCHIVE_BYTES,
};
use sha2::Digest;
use sha2::Sha256;
use std::collections::BTreeSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
#[cfg(test)]
use tempfile::NamedTempFile;

pub(super) fn catalog_cache_partial_path(cache_path: &Path) -> Result<PathBuf, String> {
    let file_name = cache_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Driver package cache path has no valid file name".to_string())?;
    Ok(cache_path.with_file_name(format!(".{file_name}.partial")))
}

pub(super) fn ensure_catalog_cache_parent(cache_path: &Path) -> Result<(), String> {
    let version_directory = cache_path
        .parent()
        .ok_or_else(|| "Driver package cache path has no parent directory".to_string())?;
    let driver_directory = version_directory
        .parent()
        .ok_or_else(|| "Driver package cache path has no driver directory".to_string())?;
    let cache_directory = driver_directory
        .parent()
        .ok_or_else(|| "Driver package cache path has no cache directory".to_string())?;

    fs::create_dir_all(cache_directory)
        .map_err(|error| format!("Cannot create driver package cache directory: {error}"))?;
    for directory in [cache_directory, driver_directory, version_directory] {
        if !directory.exists() {
            fs::create_dir(directory).map_err(|error| {
                format!("Cannot create driver package cache directory: {error}")
            })?;
        }
        let metadata = fs::symlink_metadata(directory)
            .map_err(|error| format!("Cannot inspect driver package cache directory: {error}"))?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            return Err("Driver package cache directory is invalid".to_string());
        }
    }
    Ok(())
}

pub(super) fn activation_retained_driver_packages(root: &Path) -> BTreeSet<(String, String)> {
    let mut retained = BTreeSet::new();
    let Ok(drivers) = fs::read_dir(root) else {
        return retained;
    };
    for driver in drivers.flatten() {
        let Ok(file_type) = driver.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let Some(driver_id) = driver.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !is_safe_token(&driver_id) {
            continue;
        }
        let Some(state) = read_activation_state(&driver.path()) else {
            continue;
        };
        retained.insert((driver_id.clone(), state.current));
        if let Some(previous) = state.previous {
            retained.insert((driver_id, previous));
        }
    }
    retained
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CatalogCacheFileKind {
    Complete,
    Partial,
}

pub(super) fn catalog_cache_file_kind(file_name: &str) -> Option<CatalogCacheFileKind> {
    let (digest, kind) = if let Some(digest) = file_name
        .strip_prefix('.')
        .and_then(|value| value.strip_suffix(".tar.gz.partial"))
    {
        (digest, CatalogCacheFileKind::Partial)
    } else if let Some(digest) = file_name.strip_suffix(".tar.gz") {
        (digest, CatalogCacheFileKind::Complete)
    } else {
        return None;
    };
    (digest.len() == 64 && digest.bytes().all(|value| value.is_ascii_hexdigit())).then_some(kind)
}

pub(super) fn prune_catalog_cache_files(
    cache_root: &Path,
    retained: &BTreeSet<(String, String)>,
) -> Result<DriverPackageCachePruneResult, String> {
    let cache_metadata = match fs::symlink_metadata(cache_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DriverPackageCachePruneResult::default())
        }
        Err(error) => return Err(format!("Cannot inspect driver package cache: {error}")),
    };
    if !cache_metadata.file_type().is_dir() || cache_metadata.file_type().is_symlink() {
        return Err("Driver package cache root is invalid".to_string());
    }

    let mut result = DriverPackageCachePruneResult::default();
    let drivers = fs::read_dir(cache_root)
        .map_err(|error| format!("Cannot read driver package cache: {error}"))?;
    for driver in drivers {
        let driver =
            driver.map_err(|error| format!("Cannot read driver package cache: {error}"))?;
        let file_type = driver
            .file_type()
            .map_err(|error| format!("Cannot inspect driver package cache entry: {error}"))?;
        let Some(driver_id) = driver.file_name().to_str().map(str::to_string) else {
            result.skipped_entries = result.skipped_entries.saturating_add(1);
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() || !is_safe_token(&driver_id) {
            result.skipped_entries = result.skipped_entries.saturating_add(1);
            continue;
        }

        let versions = fs::read_dir(driver.path())
            .map_err(|error| format!("Cannot read driver package cache directory: {error}"))?;
        for version in versions {
            let version = version
                .map_err(|error| format!("Cannot read driver package cache directory: {error}"))?;
            let file_type = version.file_type().map_err(|error| {
                format!("Cannot inspect driver package cache directory: {error}")
            })?;
            let Some(package_version) = version.file_name().to_str().map(str::to_string) else {
                result.skipped_entries = result.skipped_entries.saturating_add(1);
                continue;
            };
            if !file_type.is_dir() || file_type.is_symlink() || !is_safe_token(&package_version) {
                result.skipped_entries = result.skipped_entries.saturating_add(1);
                continue;
            }
            if retained.contains(&(driver_id.clone(), package_version)) {
                result.retained_versions = result.retained_versions.saturating_add(1);
                continue;
            }

            let files = fs::read_dir(version.path()).map_err(|error| {
                format!("Cannot read driver package cache version directory: {error}")
            })?;
            for file in files {
                let file = file.map_err(|error| {
                    format!("Cannot read driver package cache version directory: {error}")
                })?;
                let file_type = file.file_type().map_err(|error| {
                    format!("Cannot inspect driver package cache file: {error}")
                })?;
                let Some(file_name) = file.file_name().to_str().map(str::to_string) else {
                    result.skipped_entries = result.skipped_entries.saturating_add(1);
                    continue;
                };
                let Some(kind) = catalog_cache_file_kind(&file_name) else {
                    result.skipped_entries = result.skipped_entries.saturating_add(1);
                    continue;
                };
                if !file_type.is_file() || file_type.is_symlink() {
                    result.skipped_entries = result.skipped_entries.saturating_add(1);
                    continue;
                }
                let bytes = file
                    .metadata()
                    .map_err(|error| format!("Cannot inspect driver package cache file: {error}"))?
                    .len();
                fs::remove_file(file.path())
                    .map_err(|error| format!("Cannot remove driver package cache file: {error}"))?;
                result.files_removed = result.files_removed.saturating_add(1);
                result.bytes_removed = result.bytes_removed.saturating_add(bytes);
                if kind == CatalogCacheFileKind::Partial {
                    result.partial_files_removed = result.partial_files_removed.saturating_add(1);
                }
            }

            if fs::read_dir(version.path())
                .map_err(|error| {
                    format!("Cannot inspect driver package cache version directory: {error}")
                })?
                .next()
                .is_none()
            {
                fs::remove_dir(version.path()).map_err(|error| {
                    format!("Cannot remove empty driver package cache directory: {error}")
                })?;
                result.versions_removed = result.versions_removed.saturating_add(1);
            }
        }

        if fs::read_dir(driver.path())
            .map_err(|error| format!("Cannot inspect driver package cache directory: {error}"))?
            .next()
            .is_none()
        {
            fs::remove_dir(driver.path()).map_err(|error| {
                format!("Cannot remove empty driver package cache directory: {error}")
            })?;
        }
    }
    Ok(result)
}

pub(super) fn prune_dependency_cache_files(
    cache_root: &Path,
) -> Result<DriverPackageCachePruneResult, String> {
    let metadata = match fs::symlink_metadata(cache_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DriverPackageCachePruneResult::default())
        }
        Err(error) => return Err(format!("Cannot inspect driver dependency cache: {error}")),
    };
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err("Driver dependency cache root is invalid".to_string());
    }
    let mut result = DriverPackageCachePruneResult::default();
    for entry in fs::read_dir(cache_root)
        .map_err(|error| format!("Cannot read driver dependency cache: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Cannot read driver dependency cache entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Cannot inspect driver dependency cache entry: {error}"))?;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            result.skipped_entries = result.skipped_entries.saturating_add(1);
            continue;
        };
        let complete_digest = name.strip_suffix(".jar");
        let partial_digest = name
            .strip_prefix('.')
            .and_then(|value| value.strip_suffix(".jar.partial"));
        let (digest, partial) = if let Some(digest) = complete_digest {
            (digest, false)
        } else if let Some(digest) = partial_digest {
            (digest, true)
        } else {
            result.skipped_entries = result.skipped_entries.saturating_add(1);
            continue;
        };
        if digest.len() != 64
            || !digest.bytes().all(|value| value.is_ascii_hexdigit())
            || !file_type.is_file()
            || file_type.is_symlink()
        {
            result.skipped_entries = result.skipped_entries.saturating_add(1);
            continue;
        }
        let bytes = entry
            .metadata()
            .map_err(|error| format!("Cannot inspect driver dependency cache file: {error}"))?
            .len();
        fs::remove_file(entry.path())
            .map_err(|error| format!("Cannot remove driver dependency cache file: {error}"))?;
        result.files_removed = result.files_removed.saturating_add(1);
        result.bytes_removed = result.bytes_removed.saturating_add(bytes);
        if partial {
            result.partial_files_removed = result.partial_files_removed.saturating_add(1);
        }
    }
    Ok(result)
}

pub(super) fn resumable_partial_length(path: &Path) -> Result<u64, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(format!(
                "Cannot inspect incomplete driver package download: {error}"
            ))
        }
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES
    {
        fs::remove_file(path).map_err(|error| {
            format!("Cannot remove invalid incomplete driver package download: {error}")
        })?;
        return Ok(0);
    }
    Ok(metadata.len())
}

pub(super) fn validate_content_range(
    value: Option<&reqwest::header::HeaderValue>,
    expected_start: u64,
) -> Result<(), String> {
    let value = value
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Driver package resume response has no valid Content-Range".to_string())?;
    let value = value
        .strip_prefix("bytes ")
        .ok_or_else(|| "Driver package resume response has an invalid Content-Range".to_string())?;
    let (range, total) = value
        .split_once('/')
        .ok_or_else(|| "Driver package resume response has an invalid Content-Range".to_string())?;
    let (start, end) = range
        .split_once('-')
        .ok_or_else(|| "Driver package resume response has an invalid Content-Range".to_string())?;
    let start = start
        .parse::<u64>()
        .map_err(|_| "Driver package resume response has an invalid Content-Range".to_string())?;
    let end = end
        .parse::<u64>()
        .map_err(|_| "Driver package resume response has an invalid Content-Range".to_string())?;
    let total = total
        .parse::<u64>()
        .map_err(|_| "Driver package resume response has an invalid Content-Range".to_string())?;
    if start != expected_start
        || end < start
        || end >= total
        || total > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES
    {
        return Err("Driver package resume response has an unsafe Content-Range".to_string());
    }
    Ok(())
}

pub(super) fn update_digest_from_file(path: &Path, digest: &mut Sha256) -> Result<(), String> {
    let mut input = fs::File::open(path)
        .map_err(|error| format!("Cannot read incomplete driver package download: {error}"))?;
    let mut read_total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read incomplete driver package download: {error}"))?;
        if read == 0 {
            break;
        }
        read_total = read_total
            .checked_add(u64::try_from(read).unwrap_or(u64::MAX))
            .ok_or_else(|| "Driver package archive size overflow".to_string())?;
        if read_total > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES {
            return Err("Driver package archive exceeds the 512 MiB limit".to_string());
        }
        digest.update(&buffer[..read]);
    }
    Ok(())
}

pub(super) fn publish_resumed_driver_archive(
    partial_path: &Path,
    destination: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    if destination.exists() {
        if archive_file_matches_digest(destination, expected_sha256)? {
            fs::remove_file(partial_path).map_err(|error| {
                format!("Cannot remove redundant driver package download: {error}")
            })?;
            return Ok(());
        }
        return Err("Driver package cache destination already exists and is invalid".to_string());
    }
    fs::rename(partial_path, destination)
        .map_err(|error| format!("Cannot publish verified driver package archive: {error}"))
}

/// Return the only permitted cache location for a catalog archive. The digest
/// is part of the filename, so a republished version cannot replace a cached
/// archive with different bytes.
pub(super) fn catalog_cache_archive_path(
    root: &Path,
    driver_id: &str,
    package_version: &str,
    archive_sha256: &str,
) -> Result<PathBuf, String> {
    if !is_safe_token(driver_id) || !is_safe_token(package_version) {
        return Err("Invalid driver package identity for archive cache".to_string());
    }
    validate_sha256(archive_sha256, "Driver package archive SHA-256")?;
    Ok(root
        .join(DRIVER_PACKAGE_CACHE_DIRECTORY)
        .join(driver_id)
        .join(package_version)
        .join(format!("{archive_sha256}.tar.gz")))
}

/// Copy a verified cached archive into an invocation-local staging directory.
/// A corrupt or non-regular cache entry is discarded and treated as a miss;
/// callers then download the exact archive bound by the signed catalog.
pub(super) fn copy_cached_driver_package_archive(
    cache_path: &Path,
    destination: &Path,
    expected_sha256: &str,
) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(cache_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("Cannot inspect cached driver package: {error}")),
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES
        || !archive_file_matches_digest(cache_path, expected_sha256)?
    {
        // The path was constructed from validated tokens and a digest. Do not
        // retain a malformed cache file forever, but never recurse or touch
        // anything outside that one entry.
        fs::remove_file(cache_path)
            .map_err(|error| format!("Cannot remove invalid cached driver package: {error}"))?;
        return Ok(false);
    }
    copy_archive_file(cache_path, destination, expected_sha256)?;
    Ok(true)
}

/// Persist a second verified copy only after the temporary download has passed
/// the catalog digest check. This is intentionally best-effort; cache storage
/// is never an authority for package execution.
#[cfg(test)]
pub(super) fn cache_driver_package_archive(
    source: &Path,
    cache_path: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    let parent = cache_path
        .parent()
        .ok_or_else(|| "Driver package cache path has no parent directory".to_string())?;
    ensure_catalog_cache_parent(cache_path)?;
    if cache_path.exists() {
        return Ok(());
    }
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("Cannot create driver package cache staging file: {error}"))?;
    write_archive_copy(source, temporary.as_file_mut(), expected_sha256)?;
    temporary.persist_noclobber(cache_path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            "Driver package archive was cached concurrently".to_string()
        } else {
            format!(
                "Cannot publish cached driver package archive: {}",
                error.error
            )
        }
    })?;
    Ok(())
}

pub(super) fn copy_archive_file(
    source: &Path,
    destination: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| format!("Cannot create driver package archive copy: {error}"))?;
    write_archive_copy(source, &mut output, expected_sha256)
}

pub(super) fn write_archive_copy(
    source: &Path,
    output: &mut fs::File,
    expected_sha256: &str,
) -> Result<(), String> {
    let source_metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("Cannot inspect driver package archive: {error}"))?;
    if !source_metadata.file_type().is_file()
        || source_metadata.file_type().is_symlink()
        || source_metadata.len() > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES
    {
        return Err("Driver package archive is invalid".to_string());
    }
    let mut input = fs::File::open(source)
        .map_err(|error| format!("Cannot read driver package archive: {error}"))?;
    let mut digest = Sha256::new();
    let mut copied = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read driver package archive: {error}"))?;
        if read == 0 {
            break;
        }
        copied = copied
            .checked_add(u64::try_from(read).unwrap_or(u64::MAX))
            .ok_or_else(|| "Driver package archive size overflow".to_string())?;
        if copied > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES {
            return Err("Driver package archive exceeds the 512 MiB limit".to_string());
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| format!("Cannot write driver package archive copy: {error}"))?;
        digest.update(&buffer[..read]);
    }
    output
        .sync_all()
        .map_err(|error| format!("Cannot finalize driver package archive copy: {error}"))?;
    let actual = format!("{:x}", digest.finalize());
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        return Err("Driver package archive digest does not match the signed catalog".to_string());
    }
    Ok(())
}

pub(super) fn archive_file_matches_digest(
    path: &Path,
    expected_sha256: &str,
) -> Result<bool, String> {
    let mut input = fs::File::open(path)
        .map_err(|error| format!("Cannot read cached driver package: {error}"))?;
    let mut digest = Sha256::new();
    let mut read_total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read cached driver package: {error}"))?;
        if read == 0 {
            break;
        }
        read_total = read_total
            .checked_add(u64::try_from(read).unwrap_or(u64::MAX))
            .ok_or_else(|| "Cached driver package size overflow".to_string())?;
        if read_total > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES {
            return Ok(false);
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()).eq_ignore_ascii_case(expected_sha256))
}
