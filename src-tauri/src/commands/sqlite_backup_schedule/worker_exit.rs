//! Wait for a verified worker to leave the process, not just release worker.lock.
//! No process is terminated. Windows keeps a kernel handle, so PID reuse cannot
//! turn an exited worker into a different process during installation.
use super::control::{receipt_is_live, WorkerReceipt};
use std::path::Path;

pub(super) struct WorkerExit {
    #[cfg(windows)]
    handle: std::os::windows::io::OwnedHandle,
    #[cfg(unix)]
    receipt: WorkerReceipt,
}

impl WorkerExit {
    /// Scan after holding both worker launch/leader leases. This also catches
    /// a just-spawned worker before it publishes its receipt, and other app
    /// instances that would keep the installation's executable mapped.
    pub(super) fn capture_images(images: &[std::path::PathBuf]) -> Result<Vec<Self>, String> {
        let mut processes = Vec::new();
        #[cfg(windows)]
        {
            use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
            use windows_sys::Win32::{
                Foundation::INVALID_HANDLE_VALUE,
                System::{
                    Diagnostics::ToolHelp::{
                        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                        TH32CS_SNAPPROCESS,
                    },
                    Threading::{
                        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
                        PROCESS_SYNCHRONIZE,
                    },
                },
            };
            let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
            if raw == INVALID_HANDLE_VALUE {
                return Err("Cannot inspect application processes before installing".to_string());
            }
            let snapshot = unsafe { OwnedHandle::from_raw_handle(raw) };
            let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut found = unsafe { Process32FirstW(snapshot.as_raw_handle(), &mut entry) };
            while found != 0 {
                let name_len = entry
                    .szExeFile
                    .iter()
                    .position(|c| *c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]);
                if entry.th32ProcessID != std::process::id()
                    && images.iter().any(|path| {
                        path.file_name()
                            .is_some_and(|file| file.to_string_lossy().eq_ignore_ascii_case(&name))
                    })
                {
                    let raw = unsafe {
                        OpenProcess(
                            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                            0,
                            entry.th32ProcessID,
                        )
                    };
                    if raw.is_null() {
                        if std::io::Error::last_os_error().raw_os_error() != Some(87) {
                            return Err("Cannot inspect another application instance; close it before installing".to_string());
                        }
                    } else {
                        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
                        let mut path = vec![0_u16; 32768];
                        let mut len = path.len() as u32;
                        if unsafe {
                            QueryFullProcessImageNameW(
                                handle.as_raw_handle(),
                                0,
                                path.as_mut_ptr(),
                                &mut len,
                            )
                        } != 0
                        {
                            let path = std::path::PathBuf::from(String::from_utf16_lossy(
                                &path[..len as usize],
                            ));
                            let path = std::fs::canonicalize(&path).unwrap_or(path);
                            if images.contains(&path) {
                                let process = Self { handle };
                                if !process.has_exited()? {
                                    processes.push(process);
                                }
                            }
                        } else if unsafe {
                            windows_sys::Win32::System::Threading::WaitForSingleObject(
                                handle.as_raw_handle(),
                                0,
                            )
                        } != windows_sys::Win32::Foundation::WAIT_OBJECT_0
                        {
                            return Err(
                                "Cannot verify another application instance before installing"
                                    .to_string(),
                            );
                        }
                    }
                }
                found = unsafe { Process32NextW(snapshot.as_raw_handle(), &mut entry) };
            }
        }
        #[cfg(target_os = "linux")]
        {
            for entry in
                std::fs::read_dir("/proc").map_err(|_| "Cannot inspect application processes")?
            {
                let entry = entry.map_err(|_| "Cannot inspect application processes")?;
                let Some(pid) = entry
                    .file_name()
                    .to_str()
                    .and_then(|value| value.parse::<u32>().ok())
                else {
                    continue;
                };
                if pid == std::process::id() {
                    continue;
                }
                if let Ok(path) = std::fs::read_link(entry.path().join("exe")) {
                    if images.contains(&path) {
                        let process = Self {
                            receipt: scan_receipt(pid, path)?,
                        };
                        if !process.has_exited()? {
                            processes.push(process);
                        }
                    }
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            let output = std::process::Command::new("/bin/ps")
                .args(["-ax", "-o", "pid=", "-o", "comm="])
                .env("LC_ALL", "C")
                .output()
                .map_err(|_| "Cannot inspect application processes")?;
            if !output.status.success() {
                return Err("Cannot inspect application processes".to_string());
            }
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let Some((pid, path)) = line.trim().split_once(char::is_whitespace) else {
                    continue;
                };
                let Ok(pid) = pid.parse::<u32>() else {
                    continue;
                };
                let path = std::path::PathBuf::from(path.trim());
                if pid != std::process::id() && images.contains(&path) {
                    let process = Self {
                        receipt: scan_receipt(pid, path)?,
                    };
                    if !process.has_exited()? {
                        processes.push(process);
                    }
                }
            }
        }
        if processes.len() > 256 {
            return Err(
                "Close other OxideStudio instances before installing the update".to_string(),
            );
        }
        Ok(processes)
    }

    pub(super) fn capture(root: &Path, receipt: &WorkerReceipt) -> Result<Option<Self>, String> {
        let live = receipt_is_live(root, receipt)?;
        if receipt.pid == 0 {
            return Err("Invalid backup worker process receipt".to_string());
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
            use windows_sys::Win32::{
                Foundation::{ERROR_INVALID_PARAMETER, FILETIME},
                System::Threading::{
                    GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
                    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
                },
            };
            let raw = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                    0,
                    receipt.pid,
                )
            };
            if raw.is_null() {
                let error = std::io::Error::last_os_error();
                return if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32) {
                    Ok(None)
                } else {
                    Err("Cannot verify that the backup worker has exited".to_string())
                };
            }
            let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
            let mut created: FILETIME = unsafe { std::mem::zeroed() };
            let mut exited = created;
            let mut kernel = created;
            let mut user = created;
            let mut path = vec![0_u16; 32768];
            let mut len = path.len() as u32;
            if unsafe {
                GetProcessTimes(
                    handle.as_raw_handle(),
                    &mut created,
                    &mut exited,
                    &mut kernel,
                    &mut user,
                )
            } == 0
                || unsafe {
                    QueryFullProcessImageNameW(
                        handle.as_raw_handle(),
                        0,
                        path.as_mut_ptr(),
                        &mut len,
                    )
                } == 0
            {
                return Err("Cannot verify the backup worker process identity".to_string());
            }
            let created_ticks =
                (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
            let requested = chrono::DateTime::parse_from_rfc3339(&receipt.started_at)
                .map_err(|_| "Invalid backup worker start time")?;
            let started_ticks =
                i128::from(requested.timestamp_micros()) * 10 + 116_444_736_000_000_000_i128;
            let process_path = std::path::PathBuf::from(
                String::from_utf16(&path[..len as usize])
                    .map_err(|_| "Cannot read backup worker executable path")?,
            );
            let same_path = std::fs::canonicalize(&process_path).unwrap_or(process_path)
                == receipt.image.executable;
            if i128::from(created_ticks) > started_ticks || !same_path {
                return if live {
                    Err(
                        "The backup worker process identity changed; retry after it exits"
                            .to_string(),
                    )
                } else {
                    Ok(None)
                };
            }
            if receipt.pid == std::process::id() {
                return Err(
                    "Cannot install from inside the active backup worker process".to_string(),
                );
            }
            Ok(Some(Self { handle }))
        }
        #[cfg(unix)]
        {
            if !unix_matches(receipt)? {
                return if live {
                    Err("Cannot verify the backup worker process identity".to_string())
                } else {
                    Ok(None)
                };
            }
            if receipt.pid == std::process::id() {
                return Err(
                    "Cannot install from inside the active backup worker process".to_string(),
                );
            }
            Ok(Some(Self {
                receipt: receipt.clone(),
            }))
        }
        #[cfg(not(any(windows, unix)))]
        {
            let _ = live;
            Err("Waiting for backup workers is unsupported on this platform".to_string())
        }
    }

    pub(super) fn has_exited(&self) -> Result<bool, String> {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::{
                Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT},
                System::Threading::WaitForSingleObject,
            };
            match unsafe { WaitForSingleObject(self.handle.as_raw_handle(), 0) } {
                WAIT_OBJECT_0 => Ok(true),
                WAIT_TIMEOUT => Ok(false),
                _ => Err("Cannot wait for the backup worker process to exit".to_string()),
            }
        }
        #[cfg(unix)]
        {
            Ok(!unix_matches(&self.receipt)?)
        }
        #[cfg(not(any(windows, unix)))]
        Err("Waiting for backup workers is unsupported on this platform".to_string())
    }
}

#[cfg(unix)]
fn scan_receipt(pid: u32, executable: std::path::PathBuf) -> Result<WorkerReceipt, String> {
    let mut image = super::control::WorkerImage::current()?;
    image.executable = executable;
    Ok(WorkerReceipt {
        instance_id: uuid::Uuid::new_v4().to_string(),
        generation: 1,
        image,
        config_dir: std::env::temp_dir(),
        started_at: chrono::Utc::now().to_rfc3339(),
        pid,
    })
}

#[cfg(target_os = "linux")]
fn unix_matches(receipt: &WorkerReceipt) -> Result<bool, String> {
    let stat = match std::fs::read_to_string(format!("/proc/{}/stat", receipt.pid)) {
        Ok(stat) => stat,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("Cannot inspect the backup worker process".to_string()),
    };
    let fields: Vec<_> = stat
        .rsplit_once(')')
        .ok_or("Invalid worker process status")?
        .1
        .split_whitespace()
        .collect();
    if fields
        .first()
        .is_some_and(|state| matches!(*state, "Z" | "X"))
    {
        return Ok(false);
    }
    let ticks: u64 = fields
        .get(19)
        .ok_or("Missing worker start time")?
        .parse()
        .map_err(|_| "Invalid worker start time")?;
    let system =
        std::fs::read_to_string("/proc/stat").map_err(|_| "Cannot inspect system boot time")?;
    let boot: u64 = system
        .lines()
        .find_map(|line| line.strip_prefix("btime "))
        .ok_or("Missing system boot time")?
        .parse()
        .map_err(|_| "Invalid system boot time")?;
    let frequency = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if frequency <= 0 {
        return Err("Cannot inspect system clock frequency".to_string());
    }
    let created = boot.saturating_add(ticks / frequency as u64);
    let requested = chrono::DateTime::parse_from_rfc3339(&receipt.started_at)
        .map_err(|_| "Invalid worker start time")?
        .timestamp();
    let executable = match std::fs::read_link(format!("/proc/{}/exe", receipt.pid)) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("Cannot inspect worker executable".to_string()),
    };
    Ok(i128::from(created) <= i128::from(requested) && executable == receipt.image.executable)
}

#[cfg(target_os = "macos")]
fn unix_matches(receipt: &WorkerReceipt) -> Result<bool, String> {
    use chrono::TimeZone;
    let output = std::process::Command::new("/bin/ps")
        .args([
            "-p",
            &receipt.pid.to_string(),
            "-o",
            "lstart=",
            "-o",
            "stat=",
            "-o",
            "comm=",
        ])
        .env("LC_ALL", "C")
        .output()
        .map_err(|_| "Cannot inspect backup worker process")?;
    if !output.status.success() {
        return Ok(false);
    }
    let text = String::from_utf8(output.stdout).map_err(|_| "Invalid worker process status")?;
    let text = text.trim();
    let date = chrono::NaiveDateTime::parse_from_str(
        text.get(..24).ok_or("Missing worker start time")?,
        "%a %b %e %T %Y",
    )
    .map_err(|_| "Invalid worker start time")?;
    let created = chrono::Local
        .from_local_datetime(&date)
        .earliest()
        .ok_or("Ambiguous worker start time")?;
    let remainder = text
        .get(24..)
        .ok_or("Missing worker process identity")?
        .trim();
    let (status, executable) = remainder
        .split_once(char::is_whitespace)
        .ok_or("Missing worker executable")?;
    if status.starts_with('Z') {
        return Ok(false);
    }
    let requested = chrono::DateTime::parse_from_rfc3339(&receipt.started_at)
        .map_err(|_| "Invalid worker start time")?;
    Ok(created <= requested && Path::new(executable.trim()) == receipt.image.executable)
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn unix_matches(_receipt: &WorkerReceipt) -> Result<bool, String> {
    Err("Verifying backup worker exit is unsupported on this platform".to_string())
}
