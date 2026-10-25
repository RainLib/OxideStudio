use crate::core::private_file::{create_private_directory, replace_private_file};
use std::fs::{File, OpenOptions, TryLockError};
use std::ops::{Deref, DerefMut};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use super::artifact_files::BackupFileDeleteLease;
use super::control::writer_allowed;
use super::installation_state::InstallationSession;
use super::models::{SqliteBackupScheduleData, MAX_RUNS, MAX_SCHEDULES};

#[derive(Clone)]
pub struct SqliteBackupScheduleState {
    pub(super) path: PathBuf,
    pub(super) config_dir: PathBuf,
    _desktop_lease: Option<Arc<File>>,
    pub(super) delete_leases:
        Arc<tokio::sync::Mutex<std::collections::HashMap<String, BackupFileDeleteLease>>>,
    pub(super) worker_instance: Arc<std::sync::Mutex<Option<String>>>,
    pub(super) worker_generation: Arc<std::sync::Mutex<Option<u64>>>,
    pub(super) installation: Arc<tokio::sync::Mutex<Option<InstallationSession>>>,
}

pub(super) struct LockedScheduleData {
    data: SqliteBackupScheduleData,
    _lock: File,
}

impl Deref for LockedScheduleData {
    type Target = SqliteBackupScheduleData;
    fn deref(&self) -> &Self::Target {
        &self.data
    }
}

impl DerefMut for LockedScheduleData {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.data
    }
}

pub(super) fn open_lease(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|_| "Cannot open the backup process lease".to_string())
}

pub(super) fn try_exclusive(file: &File) -> Result<bool, String> {
    match file.try_lock() {
        Ok(()) => Ok(true),
        Err(TryLockError::WouldBlock) => Ok(false),
        Err(_) => Err("Cannot lock the backup schedule store".to_string()),
    }
}

fn read_data(path: &Path) -> Result<SqliteBackupScheduleData, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SqliteBackupScheduleData::default())
        }
        Err(_) => return Err("Cannot read SQLite backup schedules".to_string()),
    };
    if file
        .metadata()
        .map_err(|_| "Cannot inspect backup schedules")?
        .len()
        > 4 * 1024 * 1024
    {
        return Err("SQLite backup schedule store exceeds its size limit".to_string());
    }
    let data: SqliteBackupScheduleData = serde_json::from_reader(std::io::BufReader::new(file))
        .map_err(|_| {
            "SQLite backup schedules are invalid; restore the schedule store from a trusted copy"
                .to_string()
        })?;
    if data.schedules.len() > MAX_SCHEDULES || data.runs.len() > MAX_RUNS {
        return Err("SQLite backup schedule store exceeds its entry limit".to_string());
    }
    Ok(data)
}

impl SqliteBackupScheduleState {
    /// Open a previously initialized desktop profile without acquiring a UI
    /// lifetime lease or starting any process. Used by the native worker.
    pub fn open_existing_profile(data_dir: &Path, config_dir: &Path) -> Result<Self, String> {
        if !data_dir.is_absolute()
            || !data_dir.is_dir()
            || !config_dir.is_absolute()
            || !config_dir.is_dir()
        {
            return Err(
                "Backup worker requires existing absolute data and config directories".to_string(),
            );
        }
        Self::load_at(data_dir, config_dir, false)
    }

    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "Oxide application data directory is unavailable")?;
        let config_dir = app
            .path()
            .app_config_dir()
            .map_err(|_| "Oxide application config directory is unavailable")?;
        Self::load_at(&data_dir, &config_dir, true)
    }

    pub(super) fn load_at(
        data_dir: &Path,
        config_dir: &Path,
        desktop: bool,
    ) -> Result<Self, String> {
        let root = data_dir.join("database-backups");
        create_private_directory(&root)
            .map_err(|_| "Cannot initialize the backup schedule directory")?;
        let desktop_lease = if desktop {
            let file = open_lease(&root.join("desktop.lock"))?;
            file.lock_shared()
                .map_err(|_| "Cannot hold the desktop backup lease")?;
            Some(Arc::new(file))
        } else {
            None
        };
        Ok(Self {
            path: root.join("sqlite-schedules.json"),
            config_dir: config_dir.to_path_buf(),
            _desktop_lease: desktop_lease,
            delete_leases: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            worker_instance: Arc::new(std::sync::Mutex::new(None)),
            worker_generation: Arc::new(std::sync::Mutex::new(None)),
            installation: Arc::new(tokio::sync::Mutex::new(None)),
        })
    }

    pub(super) fn root(&self) -> &Path {
        self.path.parent().expect("backup store parent")
    }

    /// Reload only after taking the cross-process lock. A desktop refresh can
    /// never overwrite a newer worker receipt with a process-local cache.
    pub(super) async fn lock_data(&self) -> Result<LockedScheduleData, String> {
        let path = self.path.clone();
        let lock_path = self.root().join("store.lock");
        tokio::task::spawn_blocking(move || {
            let lock = open_lease(&lock_path)?;
            let deadline = Instant::now() + Duration::from_secs(5);
            while !try_exclusive(&lock)? {
                if Instant::now() >= deadline {
                    return Err("Backup schedule store is busy; try again".to_string());
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Ok(LockedScheduleData {
                data: read_data(&path)?,
                _lock: lock,
            })
        })
        .await
        .map_err(|_| "Cannot open the backup schedule store".to_string())?
    }

    pub(super) async fn lock_startup(&self) -> Result<File, String> {
        let path = self.root().join("startup.lock");
        tokio::task::spawn_blocking(move || {
            let lease = open_lease(&path)?;
            let deadline = Instant::now() + Duration::from_secs(10);
            while !try_exclusive(&lease)? {
                if Instant::now() >= deadline {
                    return Err(
                        "Another window is changing backup startup; retry shortly".to_string()
                    );
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(lease)
        })
        .await
        .map_err(|_| "Cannot lock backup startup settings".to_string())?
    }

    pub(super) fn persist(&self, data: &LockedScheduleData) -> Result<(), String> {
        let instance = self
            .worker_instance
            .lock()
            .map_err(|_| "Cannot inspect worker ownership")?;
        writer_allowed(self.root(), &self.config_dir, instance.as_deref())?;
        drop(instance);
        let bytes = serde_json::to_vec_pretty(&**data)
            .map_err(|_| "Cannot encode SQLite backup schedules")?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("SQLite backup schedule store exceeds its size limit".to_string());
        }
        replace_private_file(&self.path, &bytes, "sqlite-backup-schedules")
            .map_err(|_| "Cannot save SQLite backup schedules".to_string())
    }

    pub(super) fn desktop_is_open(&self) -> Result<bool, String> {
        let file = open_lease(&self.root().join("desktop.lock"))?;
        Ok(!try_exclusive(&file)?)
    }

    pub(super) fn worker_is_running(&self) -> Result<bool, String> {
        let file = open_lease(&self.root().join("worker.lock"))?;
        Ok(!try_exclusive(&file)?)
    }
}
