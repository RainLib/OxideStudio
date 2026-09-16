use super::types::{MAX_DRIVER_PACKAGE_BYTES, MAX_DRIVER_PACKAGE_DEPTH, MAX_DRIVER_PACKAGE_FILES};
use std::fs;
use std::path::Path;

#[derive(Default)]
pub(super) struct PackageCopyBudget {
    pub(super) files: usize,
    pub(super) bytes: u64,
}

#[derive(Default)]
pub(super) struct DriverStoreCopyBudget {
    files: usize,
    bytes: u64,
}

pub(super) const MAX_DRIVER_STORE_FILES: usize = 65_536;
pub(super) const MAX_DRIVER_STORE_BYTES: u64 = 4 * 1024 * 1024 * 1024;

pub(super) fn copy_driver_store_tree(
    source: &Path,
    destination: &Path,
    depth: usize,
    budget: &mut DriverStoreCopyBudget,
) -> Result<(), String> {
    if depth > MAX_DRIVER_PACKAGE_DEPTH {
        return Err("Driver store directory nesting exceeds the limit".to_string());
    }
    fs::create_dir(destination)
        .map_err(|error| format!("Cannot create driver store staging directory: {error}"))?;
    let entries = fs::read_dir(source)
        .map_err(|error| format!("Cannot read current driver store: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Cannot inspect driver store entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("Cannot inspect driver store entry: {error}"))?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            return Err(format!(
                "Driver store cannot contain symbolic links: {}",
                source_path.display()
            ));
        }
        if file_type.is_dir() {
            copy_driver_store_tree(&source_path, &destination_path, depth + 1, budget)?;
            continue;
        }
        if !file_type.is_file() {
            return Err(format!(
                "Driver store cannot contain special files: {}",
                source_path.display()
            ));
        }
        budget.files = budget
            .files
            .checked_add(1)
            .ok_or_else(|| "Driver store file count overflow".to_string())?;
        budget.bytes = budget
            .bytes
            .checked_add(metadata.len())
            .ok_or_else(|| "Driver store size overflow".to_string())?;
        if budget.files > MAX_DRIVER_STORE_FILES {
            return Err(format!(
                "Driver store contains more than {MAX_DRIVER_STORE_FILES} files"
            ));
        }
        if budget.bytes > MAX_DRIVER_STORE_BYTES {
            return Err("Driver store exceeds the 4 GiB migration limit".to_string());
        }
        fs::copy(&source_path, &destination_path)
            .map_err(|error| format!("Cannot stage driver store file: {error}"))?;
    }
    Ok(())
}

pub(super) fn copy_package_tree(
    source: &Path,
    destination: &Path,
    depth: usize,
    budget: &mut PackageCopyBudget,
) -> Result<(), String> {
    if depth > MAX_DRIVER_PACKAGE_DEPTH {
        return Err("Driver package directory nesting exceeds the limit".to_string());
    }
    fs::create_dir(destination)
        .map_err(|error| format!("Cannot create driver package staging directory: {error}"))?;
    let entries = fs::read_dir(source)
        .map_err(|error| format!("Cannot read driver package directory: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Cannot inspect driver package: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("Cannot inspect driver package entry: {error}"))?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            return Err(format!(
                "Driver packages cannot contain symbolic links: {}",
                source_path.display()
            ));
        }
        if file_type.is_dir() {
            copy_package_tree(&source_path, &destination_path, depth + 1, budget)?;
            continue;
        }
        if !file_type.is_file() {
            return Err(format!(
                "Driver packages cannot contain special files: {}",
                source_path.display()
            ));
        }
        budget.files = budget
            .files
            .checked_add(1)
            .ok_or_else(|| "Driver package file count overflow".to_string())?;
        budget.bytes = budget
            .bytes
            .checked_add(metadata.len())
            .ok_or_else(|| "Driver package size overflow".to_string())?;
        if budget.files > MAX_DRIVER_PACKAGE_FILES {
            return Err(format!(
                "Driver package contains more than {MAX_DRIVER_PACKAGE_FILES} files"
            ));
        }
        if budget.bytes > MAX_DRIVER_PACKAGE_BYTES {
            return Err("Driver package exceeds the 512 MiB size limit".to_string());
        }
        fs::copy(&source_path, &destination_path)
            .map_err(|error| format!("Cannot stage driver package file: {error}"))?;
    }
    Ok(())
}
