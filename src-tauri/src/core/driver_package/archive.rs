use super::store_copy::PackageCopyBudget;
use super::types::{MAX_DRIVER_PACKAGE_BYTES, MAX_DRIVER_PACKAGE_DEPTH, MAX_DRIVER_PACKAGE_FILES};
use flate2::read::GzDecoder;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tar::Archive;

pub(super) fn unpack_driver_package_archive(
    archive_path: &Path,
    destination: &Path,
) -> Result<(), String> {
    fs::create_dir(destination)
        .map_err(|error| format!("Cannot create package extraction directory: {error}"))?;
    let archive = fs::File::open(archive_path)
        .map_err(|error| format!("Cannot open driver package archive: {error}"))?;
    let mut archive = Archive::new(GzDecoder::new(archive));
    let mut budget = PackageCopyBudget::default();
    let mut paths = std::collections::HashSet::new();
    for entry in archive
        .entries()
        .map_err(|error| format!("Cannot read driver package archive: {error}"))?
    {
        let mut entry =
            entry.map_err(|error| format!("Cannot read driver package archive entry: {error}"))?;
        let relative = entry
            .path()
            .map_err(|error| format!("Driver package archive path is invalid: {error}"))?;
        let relative = safe_archive_relative_path(&relative)?;
        if !paths.insert(relative.clone()) {
            return Err("Driver package archive contains duplicate paths".to_string());
        }
        if relative.components().count() > MAX_DRIVER_PACKAGE_DEPTH {
            return Err("Driver package archive nesting exceeds the limit".to_string());
        }
        let destination_path = destination.join(&relative);
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&destination_path)
                .map_err(|error| format!("Cannot create package archive directory: {error}"))?;
            continue;
        }
        if !entry.header().entry_type().is_file() {
            return Err(
                "Driver package archive may contain only regular files and directories".to_string(),
            );
        }
        budget.files = budget
            .files
            .checked_add(1)
            .ok_or_else(|| "Driver package archive file count overflow".to_string())?;
        if budget.files > MAX_DRIVER_PACKAGE_FILES {
            return Err("Driver package archive contains too many files".to_string());
        }
        let declared_size = entry
            .header()
            .size()
            .map_err(|error| format!("Driver package archive file size is invalid: {error}"))?;
        budget.bytes = budget
            .bytes
            .checked_add(declared_size)
            .ok_or_else(|| "Driver package archive size overflow".to_string())?;
        if budget.bytes > MAX_DRIVER_PACKAGE_BYTES {
            return Err("Driver package archive expands beyond the 512 MiB limit".to_string());
        }
        let parent = destination_path
            .parent()
            .ok_or_else(|| "Driver package archive file has no parent".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create package archive parent directory: {error}"))?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination_path)
            .map_err(|error| format!("Cannot create extracted package file: {error}"))?;
        let copied = std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Cannot extract driver package file: {error}"))?;
        if copied != declared_size {
            return Err("Driver package archive file size changed during extraction".to_string());
        }
        output
            .sync_all()
            .map_err(|error| format!("Cannot finalize extracted package file: {error}"))?;
    }
    Ok(())
}

pub(super) fn safe_archive_relative_path(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err("Driver package archive contains an invalid path".to_string());
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            _ => return Err("Driver package archive path escapes its package root".to_string()),
        }
    }
    Ok(normalized)
}
