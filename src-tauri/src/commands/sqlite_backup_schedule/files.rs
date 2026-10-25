use crate::core::driver::LocalDatabaseBackupControl;
use chrono::{DateTime, Utc};
use flate2::{write::GzEncoder, Compression};
use std::io::{Read, Write};
use std::path::PathBuf;

use super::models::{SqliteBackupRun, SqliteBackupSchedule, BACKUP_FILE_PREFIX};

pub(super) fn safe_file_segment(value: &str) -> String {
    let value = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    let value = value.trim().trim_end_matches(['.', ' ']);
    if value.is_empty() {
        "database".to_string()
    } else {
        value.chars().take(48).collect()
    }
}

pub(super) fn backup_file_path(
    schedule: &SqliteBackupSchedule,
    run_id: &str,
    now: DateTime<Utc>,
) -> PathBuf {
    let stamp = now.format("%Y%m%d-%H%M%S");
    PathBuf::from(&schedule.destination_directory).join(format!(
        "{BACKUP_FILE_PREFIX}{}__{stamp}__{}.sqlite",
        safe_file_segment(&schedule.name),
        run_id
    ))
}

pub(super) fn compressed_backup_file_path(path: &std::path::Path) -> PathBuf {
    path.with_extension("sqlite.gz")
}

pub(super) fn compress_backup_file(
    source: &std::path::Path,
    control: &LocalDatabaseBackupControl,
    source_integrity_check: &str,
) -> Result<crate::core::driver::LocalDatabaseFileReceipt, String> {
    let destination = compressed_backup_file_path(source);
    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The compressed backup path is invalid".to_string())?;
    let temporary =
        destination.with_file_name(format!(".{file_name}.partial-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut input = std::fs::File::open(source)
            .map_err(|error| format!("Cannot open the completed SQLite backup: {error}"))?;
        let source_len = input
            .metadata()
            .map_err(|error| format!("Cannot inspect the completed SQLite backup: {error}"))?
            .len()
            .max(1);
        let output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("Cannot stage the compressed SQLite backup: {error}"))?;
        let mut encoder = GzEncoder::new(output, Compression::default());
        let mut buffer = [0_u8; 1024 * 1024];
        let mut copied = 0_u64;
        loop {
            if control.is_cancelled() {
                return Err("SQLite backup compression was cancelled".to_string());
            }
            let read = input
                .read(&mut buffer)
                .map_err(|error| format!("Cannot read the completed SQLite backup: {error}"))?;
            if read == 0 {
                break;
            }
            encoder
                .write_all(&buffer[..read])
                .map_err(|error| format!("Cannot compress the SQLite backup: {error}"))?;
            copied = copied.saturating_add(read as u64);
            let compression_progress = 90_u64.saturating_add(copied.saturating_mul(9) / source_len);
            control.set_progress_percent(compression_progress.min(99) as u8);
        }
        let output = encoder
            .finish()
            .map_err(|error| format!("Cannot finalize the compressed SQLite backup: {error}"))?;
        output
            .sync_all()
            .map_err(|error| format!("Cannot sync the compressed SQLite backup: {error}"))?;
        std::fs::rename(&temporary, &destination)
            .map_err(|error| format!("Cannot publish the compressed SQLite backup: {error}"))?;
        // The gzip stream is already durably published. Failure to remove the
        // uncompressed recovery point must not make the valid result disappear;
        // retention only tracks the published .sqlite.gz path.
        let _ = std::fs::remove_file(source);
        let byte_len = std::fs::metadata(&destination)
            .map_err(|error| format!("Cannot inspect the compressed SQLite backup: {error}"))?
            .len();
        control.set_progress_percent(100);
        Ok(crate::core::driver::LocalDatabaseFileReceipt {
            byte_len,
            integrity_check: format!(
                "{source_integrity_check}; gzip stream finalized after integrity check"
            ),
        })
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

pub(super) fn safe_run_file(run: &SqliteBackupRun) -> Option<PathBuf> {
    let path = PathBuf::from(run.file_path.as_deref()?);
    if !path.is_absolute() || !std::path::Path::new(&run.destination_directory).is_absolute() {
        return None;
    }
    let file_name = path.file_name()?.to_str()?;
    if !file_name.starts_with(BACKUP_FILE_PREFIX)
        || !(file_name.ends_with(".sqlite") || file_name.ends_with(".sqlite.gz"))
    {
        return None;
    }
    let parent = path.parent()?.canonicalize().ok()?;
    let destination = PathBuf::from(&run.destination_directory)
        .canonicalize()
        .ok()?;
    (parent == destination).then_some(path)
}

pub(super) fn safe_run_error(error: &str, cancelled: bool) -> String {
    let normalized = error.to_ascii_lowercase();
    if cancelled || normalized.contains("cancelled") {
        "Backup cancelled; the incomplete file was removed".to_string()
    } else if normalized.contains("no space") || normalized.contains("disk full") {
        "There is not enough free disk space for this backup".to_string()
    } else if normalized.contains("permission") || normalized.contains("access is denied") {
        "Oxide cannot write to the selected backup directory".to_string()
    } else if normalized.contains("saved sqlite") || normalized.contains("saved connection") {
        "The saved SQLite source is unavailable; review its project, driver, file and local credential key".to_string()
    } else if normalized.contains("active connection")
        || normalized.contains("connect the sqlite")
        || normalized.contains("not found")
    {
        "The scheduled SQLite connection is not active".to_string()
    } else if normalized.contains("transaction") || normalized.contains("busy") {
        "SQLite is busy; finish active transactions before the next backup".to_string()
    } else if normalized.contains("already running") {
        "This SQLite backup schedule is already running".to_string()
    } else if normalized.contains("destination changed")
        || normalized.contains("destination now resolves")
        || normalized.contains("destination was saved by an older oxide")
    {
        "The backup destination changed; review and save the schedule again".to_string()
    } else if normalized.contains("schedule no longer exists") {
        "The SQLite backup schedule no longer exists".to_string()
    } else if normalized.contains("not due") {
        "The SQLite backup schedule is not currently due".to_string()
    } else {
        "SQLite scheduled backup failed without publishing a partial file".to_string()
    }
}
