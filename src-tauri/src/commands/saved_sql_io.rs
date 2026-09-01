use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
};

const MAX_SQL_FILES: usize = 5_000;
const MAX_SQL_FILE_BYTES: usize = 16 * 1024 * 1024;
const MAX_SQL_IMPORT_BYTES: usize = 64 * 1024 * 1024;
const MAX_DIRECTORY_DEPTH: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedSqlDirectoryEntry {
    pub relative_path: String,
    pub sql: String,
}

#[tauri::command]
pub async fn import_saved_sql_directory(
    source_dir: String,
) -> Result<Vec<SavedSqlDirectoryEntry>, String> {
    tokio::task::spawn_blocking(move || import_directory(Path::new(&source_dir)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn export_saved_sql_directory(
    target_dir: String,
    entries: Vec<SavedSqlDirectoryEntry>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || export_directory(Path::new(&target_dir), &entries))
        .await
        .map_err(|error| error.to_string())?
}

fn import_directory(source_dir: &Path) -> Result<Vec<SavedSqlDirectoryEntry>, String> {
    let root = source_dir
        .canonicalize()
        .map_err(|error| format!("SQL Library import directory is unavailable: {error}"))?;
    if !root.is_dir() {
        return Err("SQL Library import source must be a directory".to_string());
    }
    let mut paths = Vec::new();
    collect_sql_paths(&root, &root, 0, &mut paths)?;
    paths.sort_by(|left, right| left.0.cmp(&right.0));
    let mut total_bytes = 0usize;
    let mut entries = Vec::with_capacity(paths.len());
    for (relative_path, path) in paths {
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.file_type().is_file() || metadata.len() as usize > MAX_SQL_FILE_BYTES {
            return Err(format!(
                "SQL Library import file exceeds the 16 MiB limit: {relative_path}"
            ));
        }
        total_bytes = total_bytes
            .checked_add(metadata.len() as usize)
            .ok_or_else(|| "SQL Library import size overflow".to_string())?;
        if total_bytes > MAX_SQL_IMPORT_BYTES {
            return Err("SQL Library import exceeds the 64 MiB total limit".to_string());
        }
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        let sql = String::from_utf8(bytes)
            .map_err(|_| format!("SQL Library import requires UTF-8 text: {relative_path}"))?;
        entries.push(SavedSqlDirectoryEntry { relative_path, sql });
    }
    Ok(entries)
}

fn collect_sql_paths(
    root: &Path,
    directory: &Path,
    depth: usize,
    output: &mut Vec<(String, PathBuf)>,
) -> Result<(), String> {
    if depth > MAX_DIRECTORY_DEPTH {
        return Err("SQL Library import directory nesting exceeds 32 levels".to_string());
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let metadata = entry.file_type().map_err(|error| error.to_string())?;
        if metadata.is_symlink() {
            continue;
        }
        let path = entry.path();
        if metadata.is_dir() {
            collect_sql_paths(root, &path, depth + 1, output)?;
            continue;
        }
        if !metadata.is_file()
            || path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
                != Some("sql".to_string())
        {
            continue;
        }
        if output.len() >= MAX_SQL_FILES {
            return Err("SQL Library import exceeds the 5,000 file limit".to_string());
        }
        let canonical = path.canonicalize().map_err(|error| error.to_string())?;
        if !canonical.starts_with(root) {
            return Err("SQL Library import path escaped the selected directory".to_string());
        }
        let relative = canonical
            .strip_prefix(root)
            .map_err(|_| "SQL Library import path is invalid".to_string())?;
        let relative_path = portable_relative_path(relative)?;
        output.push((relative_path, canonical));
    }
    Ok(())
}

fn export_directory(
    target_dir: &Path,
    entries: &[SavedSqlDirectoryEntry],
) -> Result<String, String> {
    if entries.len() > MAX_SQL_FILES {
        return Err("SQL Library export exceeds the 5,000 file limit".to_string());
    }
    let target = target_dir
        .canonicalize()
        .map_err(|error| format!("SQL Library export directory is unavailable: {error}"))?;
    if !target.is_dir() {
        return Err("SQL Library export target must be a directory".to_string());
    }
    let mut seen = HashSet::new();
    let mut total_bytes = 0usize;
    let mut validated = Vec::with_capacity(entries.len());
    for entry in entries {
        let relative = validated_relative_path(&entry.relative_path)?;
        if relative
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            != Some("sql".to_string())
        {
            return Err(format!(
                "SQL Library export path must end in .sql: {}",
                entry.relative_path
            ));
        }
        let identity = entry.relative_path.replace('\\', "/").to_ascii_lowercase();
        if !seen.insert(identity) {
            return Err(format!(
                "Duplicate SQL Library export path: {}",
                entry.relative_path
            ));
        }
        if entry.sql.len() > MAX_SQL_FILE_BYTES {
            return Err(format!(
                "SQL Library export file exceeds 16 MiB: {}",
                entry.relative_path
            ));
        }
        total_bytes = total_bytes
            .checked_add(entry.sql.len())
            .ok_or_else(|| "SQL Library export size overflow".to_string())?;
        if total_bytes > MAX_SQL_IMPORT_BYTES {
            return Err("SQL Library export exceeds the 64 MiB total limit".to_string());
        }
        validated.push((relative, entry.sql.as_bytes()));
    }

    let export_name = unique_export_name(&target);
    let final_path = target.join(&export_name);
    let staging = target.join(format!(".{export_name}.{}.tmp", uuid::Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|error| error.to_string())?;
    let result = (|| {
        for (relative, bytes) in validated {
            let path = staging.join(relative);
            let parent = path
                .parent()
                .ok_or_else(|| "SQL Library export path has no parent".to_string())?;
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|error| error.to_string())?;
            file.write_all(bytes).map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
        }
        fs::rename(&staging, &final_path).map_err(|error| error.to_string())?;
        Ok::<_, String>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(final_path.to_string_lossy().to_string())
}

fn validated_relative_path(value: &str) -> Result<PathBuf, String> {
    if value.trim().is_empty() || value.contains('\0') {
        return Err("SQL Library relative path is empty or invalid".to_string());
    }
    let normalized = value.replace('\\', "/");
    let mut path = PathBuf::new();
    for segment in normalized.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(format!("Invalid SQL Library relative path: {value}"));
        }
        path.push(segment);
    }
    if path
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
    {
        Ok(path)
    } else {
        Err(format!("Invalid SQL Library relative path: {value}"))
    }
}

fn portable_relative_path(path: &Path) -> Result<String, String> {
    let value = path
        .components()
        .map(|component| match component {
            Component::Normal(segment) => segment
                .to_str()
                .map(str::to_string)
                .ok_or_else(|| "SQL Library path is not valid Unicode".to_string()),
            _ => Err("SQL Library path is not relative".to_string()),
        })
        .collect::<Result<Vec<_>, _>>()?
        .join("/");
    if value.is_empty() {
        Err("SQL Library path is empty".to_string())
    } else {
        Ok(value)
    }
}

fn unique_export_name(target: &Path) -> String {
    let base = "Oxide SQL Library";
    if !target.join(base).exists() {
        return base.to_string();
    }
    for suffix in 2..10_000 {
        let candidate = format!("{base} ({suffix})");
        if !target.join(&candidate).exists() {
            return candidate;
        }
    }
    format!("{base} {}", uuid::Uuid::new_v4())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_utf8_sql_without_following_symlinks() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("reports")).unwrap();
        fs::write(root.path().join("reports/orders.sql"), "SELECT 1;").unwrap();
        fs::write(root.path().join("ignore.txt"), "not SQL").unwrap();
        let entries = import_directory(root.path()).unwrap();
        assert_eq!(
            entries,
            vec![SavedSqlDirectoryEntry {
                relative_path: "reports/orders.sql".into(),
                sql: "SELECT 1;".into(),
            }]
        );
    }

    #[test]
    fn exports_to_a_new_directory_and_rejects_escape_paths() {
        let root = tempfile::tempdir().unwrap();
        let path = export_directory(
            root.path(),
            &[SavedSqlDirectoryEntry {
                relative_path: "reports/orders.sql".into(),
                sql: "SELECT 1;".into(),
            }],
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(Path::new(&path).join("reports/orders.sql")).unwrap(),
            "SELECT 1;"
        );
        assert!(export_directory(
            root.path(),
            &[SavedSqlDirectoryEntry {
                relative_path: "../escape.sql".into(),
                sql: "SELECT 2;".into(),
            }]
        )
        .is_err());
    }
}
