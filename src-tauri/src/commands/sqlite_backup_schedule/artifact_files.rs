use super::files::safe_run_file;
use super::models::{SqliteBackupDestinationIdentity, SqliteBackupRun};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::time::UNIX_EPOCH;

pub(super) struct BackupFileDeleteLease {
    pub(super) run_id: String,
    pub(super) file_path: String,
    pub(super) identity: ArtifactFileIdentity,
    pub(super) expires: std::time::Instant,
}

/// A pathname alone is insufficient after a volume remount or file replacement.
/// Read this receipt from an opened handle, and compare it before unlinking.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct ArtifactFileIdentity {
    device: SqliteBackupDestinationIdentity,
    file_id: u64,
    byte_len: u64,
    modified_nanos: String,
    created_nanos: Option<String>,
}

impl ArtifactFileIdentity {
    pub(super) fn byte_len(&self) -> u64 {
        self.byte_len
    }
    pub(super) fn capture(file: &File) -> Result<Self, String> {
        let metadata = file
            .metadata()
            .map_err(|_| "Cannot inspect the backup file")?;
        if !metadata.is_file() {
            return Err("Backup history points to an unsafe file type".to_string());
        }
        let (device, file_id) = platform_file_identity(file)?;
        let modified_nanos = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .ok_or("Cannot identify the backup file modification time")?
            .as_nanos()
            .to_string();
        let created_nanos = metadata
            .created()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|time| time.as_nanos().to_string());
        Ok(Self {
            device,
            file_id,
            byte_len: metadata.len(),
            modified_nanos,
            created_nanos,
        })
    }
}

pub(super) fn inspect_file(run: &SqliteBackupRun) -> Result<Option<ArtifactFileIdentity>, String> {
    if run.file_path.is_none() {
        return Ok(None);
    }
    let path = safe_run_file(run)
        .ok_or("The backup destination is unavailable or no longer matches its receipt")?;
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err("Backup history points to an unsafe file type".to_string())
        }
        Err(_) => return Err("Cannot inspect the backup file".to_string()),
        Ok(_) => {}
    }
    let file = File::open(&path).map_err(|_| "Cannot inspect the backup file")?;
    ArtifactFileIdentity::capture(&file).map(Some)
}

#[cfg(unix)]
fn platform_file_identity(file: &File) -> Result<(SqliteBackupDestinationIdentity, u64), String> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file
        .metadata()
        .map_err(|_| "Cannot inspect the backup file identity")?;
    let device = super::validation::destination_identity_for_file(file)
        .ok_or("Cannot identify the backup filesystem")?;
    Ok((device, metadata.ino()))
}

#[cfg(windows)]
fn platform_file_identity(file: &File) -> Result<(SqliteBackupDestinationIdentity, u64), String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let mut information = std::mem::MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
    // SAFETY: the live file owns the handle and the output has the API's type.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), information.as_mut_ptr()) } == 0 {
        return Err("Cannot identify the backup file on its filesystem".to_string());
    }
    let information = unsafe { information.assume_init() };
    Ok((
        SqliteBackupDestinationIdentity::Device(u64::from(information.dwVolumeSerialNumber)),
        (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow),
    ))
}

#[cfg(not(any(unix, windows)))]
fn platform_file_identity(_: &File) -> Result<(SqliteBackupDestinationIdentity, u64), String> {
    Err("Backup file identity is unavailable on this platform".to_string())
}

pub(super) fn recorded_identity(run: &SqliteBackupRun) -> Option<ArtifactFileIdentity> {
    let path = safe_run_file(run)?;
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return None;
    }
    let file = File::open(path).ok()?;
    let identity = ArtifactFileIdentity::capture(&file).ok()?;
    (Some(identity.byte_len) == run.byte_len).then_some(identity)
}

/// Old JSON receipts have no file ID. Only adopt an unchanged file whose size
/// and write time match the original run; unavailable/changed files stay tracked.
fn legacy_identity(run: &SqliteBackupRun, file: &File) -> Result<ArtifactFileIdentity, String> {
    let identity = ArtifactFileIdentity::capture(file)?;
    let started = chrono::DateTime::parse_from_rfc3339(&run.started_at)
        .map_err(|_| "Cannot verify the older backup timestamp")?;
    let completed = run
        .completed_at
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .ok_or("Cannot verify the older backup completion time")?;
    let modified: u128 = identity
        .modified_nanos
        .parse()
        .map_err(|_| "Cannot verify the backup modification time")?;
    let modified = i128::try_from(modified / 1_000_000)
        .map_err(|_| "Cannot verify the backup modification time")?;
    if Some(identity.byte_len) != run.byte_len
        || modified < i128::from(started.timestamp_millis()) - 2_000
        || modified > i128::from(completed.timestamp_millis()) + 2_000
    {
        return Err("The older backup file no longer matches its receipt; review it before removing its history".to_string());
    }
    Ok(identity)
}

pub(super) fn delete_recorded_file(
    run: &SqliteBackupRun,
    identity: Option<&ArtifactFileIdentity>,
) -> Result<(), String> {
    let path = safe_run_file(run)
        .ok_or("The backup destination is unavailable or no longer matches its receipt")?;
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err("Backup history points to an unsafe file type".to_string())
        }
        Err(_) => return Err("Cannot inspect the backup file".to_string()),
        Ok(_) => {}
    }
    let file = File::open(&path).map_err(|_| "Cannot open the backup file for verification")?;
    let current = ArtifactFileIdentity::capture(&file)?;
    let expected = match identity {
        Some(identity) => identity.clone(),
        None => legacy_identity(run, &file)?,
    };
    if current != expected {
        return Err(
            "The backup file changed since it was recorded; review it before removing its history"
                .to_string(),
        );
    }
    drop(file);
    std::fs::remove_file(path).map_err(|_| "Cannot delete the backup file".to_string())
}
