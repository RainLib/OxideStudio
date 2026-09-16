use crate::core::{driver::LocalDatabaseBackupControl, private_file::replace_private_file};
use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use super::models::{SqliteBackupRunStatus, SqliteBackupScheduleData, MAX_RUNS, MAX_SCHEDULES};

pub struct SqliteBackupScheduleState {
    pub(super) path: PathBuf,
    pub(super) data: Mutex<SqliteBackupScheduleData>,
    pub(super) active: Mutex<HashMap<String, LocalDatabaseBackupControl>>,
}

impl SqliteBackupScheduleState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|_| "Oxide application data directory is unavailable".to_string())?
            .join("database-backups");
        std::fs::create_dir_all(&root)
            .map_err(|_| "Cannot initialize the backup schedule directory".to_string())?;
        let path = root.join("sqlite-schedules.json");
        let mut data = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<SqliteBackupScheduleData>(&bytes) {
                Ok(data) => data,
                Err(_) => {
                    let quarantine = root.join(format!(
                        "sqlite-schedules.corrupt-{}.json",
                        uuid::Uuid::new_v4()
                    ));
                    std::fs::rename(&path, quarantine).map_err(|_| {
                        "SQLite backup schedules are invalid and cannot be quarantined".to_string()
                    })?;
                    SqliteBackupScheduleData::default()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                SqliteBackupScheduleData::default()
            }
            Err(_) => return Err("Cannot read SQLite backup schedules".to_string()),
        };
        data.schedules.truncate(MAX_SCHEDULES);
        data.runs.truncate(MAX_RUNS);
        let now = Utc::now().to_rfc3339();
        let mut repaired_interrupted_run = false;
        for run in &mut data.runs {
            if run.status == SqliteBackupRunStatus::Running {
                run.status = SqliteBackupRunStatus::Interrupted;
                run.completed_at = Some(now.clone());
                run.error = Some("Oxide closed before this backup finished".to_string());
                repaired_interrupted_run = true;
            }
        }
        if repaired_interrupted_run {
            let bytes = serde_json::to_vec_pretty(&data)
                .map_err(|_| "Cannot encode SQLite backup schedules".to_string())?;
            replace_private_file(&path, &bytes, "sqlite-backup-schedules")
                .map_err(|_| "Cannot save SQLite backup schedules".to_string())?;
        }
        Ok(Self {
            path,
            data: Mutex::new(data),
            active: Mutex::new(HashMap::new()),
        })
    }

    pub(super) fn persist(&self, data: &SqliteBackupScheduleData) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(data)
            .map_err(|_| "Cannot encode SQLite backup schedules".to_string())?;
        replace_private_file(&self.path, &bytes, "sqlite-backup-schedules")
            .map_err(|_| "Cannot save SQLite backup schedules".to_string())
    }
}
