use std::path::PathBuf;

use super::models::SqliteBackupDestinationIdentity;

pub(super) fn validate_identity(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(format!("Invalid {label}"));
    }
    Ok(value.to_string())
}

pub(super) fn validate_schedule_name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 80 || value.chars().any(char::is_control) {
        return Err("Enter a backup schedule name up to 80 characters".to_string());
    }
    Ok(value.to_string())
}

pub(super) fn validate_time_of_day(value: &str) -> Result<String, String> {
    let value = value.trim();
    let valid = value.len() == 5
        && value.as_bytes()[2] == b':'
        && value[..2].parse::<u8>().is_ok_and(|hour| hour < 24)
        && value[3..].parse::<u8>().is_ok_and(|minute| minute < 60);
    valid
        .then(|| value.to_string())
        .ok_or_else(|| "Backup time must use 24-hour HH:MM format".to_string())
}

pub(super) fn canonical_destination(value: &str) -> Result<PathBuf, String> {
    let selected = PathBuf::from(value.trim());
    if value.trim().is_empty() || value.contains('\0') || !selected.is_absolute() {
        return Err("Select an absolute backup destination directory".to_string());
    }
    let canonical = std::fs::canonicalize(&selected)
        .map_err(|_| "The backup destination directory does not exist".to_string())?;
    let metadata = std::fs::metadata(&canonical)
        .map_err(|_| "Cannot inspect the backup destination directory".to_string())?;
    if !metadata.is_dir() {
        return Err("The backup destination must be a directory".to_string());
    }
    Ok(canonical)
}

pub(super) fn require_destination_identity(
    path: &std::path::Path,
) -> Result<SqliteBackupDestinationIdentity, String> {
    destination_identity_for_path(path).ok_or_else(|| {
        "Oxide cannot identify the backup destination filesystem; choose another local folder"
            .to_string()
    })
}

pub(super) fn verify_destination_identity(
    expected: Option<&SqliteBackupDestinationIdentity>,
    current: Option<&SqliteBackupDestinationIdentity>,
) -> Result<(), String> {
    let expected = expected.ok_or_else(|| {
        "The backup destination was saved by an older Oxide version; review and save the schedule again"
            .to_string()
    })?;
    if current.is_some_and(|current| expected.matches(current)) {
        Ok(())
    } else {
        Err(
            "The backup destination now resolves to a different filesystem; reconnect the expected volume or review and save the schedule again"
                .to_string(),
        )
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(super) fn destination_identity_for_path(
    path: &std::path::Path,
) -> Option<SqliteBackupDestinationIdentity> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(path)
        .ok()
        .map(|metadata| SqliteBackupDestinationIdentity::Device(metadata.dev()))
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(super) fn destination_identity_for_file(
    file: &std::fs::File,
) -> Option<SqliteBackupDestinationIdentity> {
    use std::os::unix::fs::MetadataExt;
    file.metadata()
        .ok()
        .map(|metadata| SqliteBackupDestinationIdentity::Device(metadata.dev()))
}

#[cfg(target_os = "macos")]
pub(super) fn destination_identity_for_path(
    path: &std::path::Path,
) -> Option<SqliteBackupDestinationIdentity> {
    let directory = std::fs::File::open(path).ok()?;
    destination_identity_for_file(&directory)
}

#[cfg(target_os = "macos")]
pub(super) fn destination_identity_for_file(
    file: &std::fs::File,
) -> Option<SqliteBackupDestinationIdentity> {
    macos_destination_identity::persistent_volume_uuid(file)
        .map(SqliteBackupDestinationIdentity::PersistentVolumeUuid)
        .or_else(|| {
            use std::os::unix::fs::MetadataExt;
            file.metadata()
                .ok()
                .map(|metadata| SqliteBackupDestinationIdentity::Device(metadata.dev()))
        })
}

#[cfg(target_os = "macos")]
mod macos_destination_identity {
    use std::os::fd::AsRawFd;

    #[repr(C)]
    struct VolumeUuidBuffer {
        length: u32,
        uuid: [u8; 16],
    }

    pub(super) fn persistent_volume_uuid(file: &std::fs::File) -> Option<[u8; 16]> {
        let mut attributes = libc::attrlist {
            bitmapcount: libc::ATTR_BIT_MAP_COUNT,
            reserved: 0,
            commonattr: 0,
            volattr: libc::ATTR_VOL_INFO | libc::ATTR_VOL_UUID,
            dirattr: 0,
            fileattr: 0,
            forkattr: 0,
        };
        let mut buffer = VolumeUuidBuffer {
            length: 0,
            uuid: [0; 16],
        };
        let result = unsafe {
            libc::fgetattrlist(
                file.as_raw_fd(),
                std::ptr::from_mut(&mut attributes).cast(),
                std::ptr::from_mut(&mut buffer).cast(),
                std::mem::size_of::<VolumeUuidBuffer>(),
                0,
            )
        };
        (result == 0
            && buffer.length as usize >= std::mem::size_of::<VolumeUuidBuffer>()
            && buffer.uuid != [0; 16])
            .then_some(buffer.uuid)
    }
}

#[cfg(windows)]
pub(super) fn destination_identity_for_path(
    path: &std::path::Path,
) -> Option<SqliteBackupDestinationIdentity> {
    windows_destination_identity::device_id_for_path(path)
        .map(SqliteBackupDestinationIdentity::Device)
}

#[cfg(windows)]
pub(super) fn destination_identity_for_file(
    file: &std::fs::File,
) -> Option<SqliteBackupDestinationIdentity> {
    windows_destination_identity::device_id_for_handle(file)
        .map(SqliteBackupDestinationIdentity::Device)
}

#[cfg(windows)]
mod windows_destination_identity {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    };

    pub(super) fn device_id_for_path(path: &Path) -> Option<u64> {
        let mut wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
        wide.push(0);
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return None;
        }
        let identity = volume_serial_number(handle);
        unsafe {
            CloseHandle(handle);
        }
        identity
    }

    pub(super) fn device_id_for_handle(file: &std::fs::File) -> Option<u64> {
        volume_serial_number(file.as_raw_handle() as HANDLE)
    }

    fn volume_serial_number(handle: HANDLE) -> Option<u64> {
        let mut information = BY_HANDLE_FILE_INFORMATION::default();
        let ok = unsafe { GetFileInformationByHandle(handle, &mut information) };
        (ok != 0).then_some(u64::from(information.dwVolumeSerialNumber))
    }
}

#[cfg(not(any(unix, windows)))]
pub(super) fn destination_identity_for_path(
    _path: &std::path::Path,
) -> Option<SqliteBackupDestinationIdentity> {
    None
}

#[cfg(not(any(unix, windows)))]
pub(super) fn destination_identity_for_file(
    _file: &std::fs::File,
) -> Option<SqliteBackupDestinationIdentity> {
    None
}
