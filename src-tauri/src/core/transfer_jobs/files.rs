use super::models::FileIdentity;
use crate::core::driver::LocalDatabaseBackupControl;
use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

pub(super) fn identity(path: &Path) -> Result<FileIdentity> {
    let path = path
        .canonicalize()
        .context("migration database file is unavailable")?;
    let file = File::open(&path)?;
    if !file.metadata()?.is_file() {
        bail!("migration requires a regular database file");
    }
    #[cfg(unix)]
    let (volume, index) = {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata()?;
        (metadata.dev(), metadata.ino())
    };
    #[cfg(windows)]
    let (volume, index) = {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        (
            u64::from(info.dwVolumeSerialNumber),
            (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
        )
    };
    Ok(FileIdentity {
        path,
        volume,
        index,
    })
}

pub(super) fn require_identity(expected: &FileIdentity) -> Result<()> {
    if identity(&expected.path)? != *expected {
        bail!("migration database file identity changed; preview again");
    }
    Ok(())
}

pub(super) fn digest(path: &Path) -> Result<String> {
    digest_controlled(path, &LocalDatabaseBackupControl::default())
}

pub(super) fn digest_controlled(
    path: &Path,
    control: &LocalDatabaseBackupControl,
) -> Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        if control.is_cancelled() {
            bail!("migration snapshot verification was cancelled");
        }
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

/// Only called while holding this job's lease. Interrupted online backups may
/// leave a generated partial, but no other job's files may be removed.
pub(super) fn cleanup_snapshot(root: &Path, id: &str) -> Result<()> {
    let name = format!("{id}.snapshot.sqlite");
    let partial = format!(".{name}.oxide-partial-");
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let filename = entry.file_name();
        let Some(filename) = filename.to_str() else {
            continue;
        };
        let owned = filename == name
            || ["-wal", "-shm", "-journal"]
                .iter()
                .any(|suffix| filename == format!("{name}{suffix}"))
            || filename
                .strip_prefix(&partial)
                .is_some_and(|suffix| suffix.len() == 36 && uuid::Uuid::parse_str(suffix).is_ok());
        if owned {
            let path = entry.path();
            if path.parent() != Some(root) || !entry.file_type()?.is_file() {
                bail!("migration snapshot cleanup requires an owned regular file");
            }
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}
