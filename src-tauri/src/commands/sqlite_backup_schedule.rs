//! Host-owned scheduling for native SQLite online backups.
//!
//! Schedules authorize one canonical destination directory, one active
//! bundled SQLite connection, and a bounded retention count. The renderer may
//! ask the Host to process due work, but cannot choose an output path or prune
//! an arbitrary file.

use crate::core::{
    driver::LocalDatabaseBackupControl, manager::ConnectionManager,
    private_file::replace_private_file, protocol::Response,
};
use chrono::{DateTime, Datelike, Duration, Local, LocalResult, TimeZone, Utc};
use flate2::{write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

const MAX_SCHEDULES: usize = 100;
const MAX_RUNS: usize = 500;
const MAX_DUE_RUNS_PER_TICK: usize = 10;
const BACKUP_FILE_PREFIX: &str = "oxide-sqlite-backup__";

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SqliteBackupScheduleFrequency {
    Hourly,
    Daily,
    Weekly,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SqliteBackupCompression {
    #[default]
    None,
    Gzip,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SqliteBackupRunStatus {
    Running,
    Success,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSqliteBackupScheduleRequest {
    pub id: Option<String>,
    pub name: String,
    pub project_id: String,
    pub connection_id: String,
    pub destination_directory: String,
    pub frequency: SqliteBackupScheduleFrequency,
    pub interval_hours: u16,
    pub time_of_day: String,
    pub weekday: u8,
    pub retention_count: u16,
    #[serde(default)]
    pub compression: SqliteBackupCompression,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSqliteBackupScheduleRequest {
    pub schedule_id: String,
    #[serde(default)]
    pub trigger: SqliteBackupRunTrigger,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SqliteBackupRunTrigger {
    #[default]
    Manual,
    Scheduled,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupIdentityRequest {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupSchedule {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub project_id: String,
    pub connection_id: String,
    pub destination_directory: String,
    pub frequency: SqliteBackupScheduleFrequency,
    pub interval_hours: u16,
    pub time_of_day: String,
    pub weekday: u8,
    pub retention_count: u16,
    #[serde(default)]
    pub compression: SqliteBackupCompression,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub next_run_at: String,
    pub last_run_at: Option<String>,
    pub last_run_status: Option<SqliteBackupRunStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupRun {
    pub id: String,
    pub schedule_id: String,
    pub schedule_name: String,
    #[serde(default)]
    pub project_id: String,
    pub connection_id: String,
    /// Canonical directory captured when the Host created the run. Keeping
    /// this with history allows a user to delete a schedule without making
    /// its Host-owned backup files impossible to prune safely.
    #[serde(default)]
    pub destination_directory: String,
    #[serde(default)]
    pub compression: SqliteBackupCompression,
    pub trigger: SqliteBackupRunTrigger,
    pub status: SqliteBackupRunStatus,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub file_path: Option<String>,
    pub byte_len: Option<u64>,
    pub integrity_check: Option<String>,
    pub progress_percent: u8,
    pub error: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqliteBackupScheduleData {
    #[serde(default)]
    schedules: Vec<SqliteBackupSchedule>,
    #[serde(default)]
    runs: Vec<SqliteBackupRun>,
}

pub struct SqliteBackupScheduleState {
    path: PathBuf,
    data: Mutex<SqliteBackupScheduleData>,
    active: Mutex<HashMap<String, LocalDatabaseBackupControl>>,
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

    fn persist(&self, data: &SqliteBackupScheduleData) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(data)
            .map_err(|_| "Cannot encode SQLite backup schedules".to_string())?;
        replace_private_file(&self.path, &bytes, "sqlite-backup-schedules")
            .map_err(|_| "Cannot save SQLite backup schedules".to_string())
    }
}

fn validate_identity(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(format!("Invalid {label}"));
    }
    Ok(value.to_string())
}

fn validate_schedule_name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 80 || value.chars().any(char::is_control) {
        return Err("Enter a backup schedule name up to 80 characters".to_string());
    }
    Ok(value.to_string())
}

fn validate_time_of_day(value: &str) -> Result<String, String> {
    let value = value.trim();
    let valid = value.len() == 5
        && value.as_bytes()[2] == b':'
        && value[..2].parse::<u8>().is_ok_and(|hour| hour < 24)
        && value[3..].parse::<u8>().is_ok_and(|minute| minute < 60);
    valid
        .then(|| value.to_string())
        .ok_or_else(|| "Backup time must use 24-hour HH:MM format".to_string())
}

fn canonical_destination(value: &str) -> Result<PathBuf, String> {
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

async fn confirm_bundled_sqlite(
    manager: &ConnectionManager,
    connection_id: &str,
) -> Result<(), String> {
    if manager
        .package_capabilities(connection_id)
        .await
        .map_err(|_| "Cannot inspect the active SQLite driver".to_string())?
        .is_some()
    {
        return Err("Scheduled backup requires Oxide's bundled SQLite driver".to_string());
    }
    let driver = manager
        .connection_driver_id(connection_id)
        .await
        .map_err(|_| "Cannot inspect the active SQLite connection".to_string())?
        .ok_or_else(|| "Connect the SQLite database before scheduling backups".to_string())?;
    if !driver.trim().eq_ignore_ascii_case("sqlite") {
        return Err("Scheduled backup is currently available for SQLite".to_string());
    }
    Ok(())
}

fn schedule_next_run(schedule: &SqliteBackupSchedule, after: DateTime<Utc>) -> DateTime<Utc> {
    if schedule.frequency == SqliteBackupScheduleFrequency::Hourly {
        return after + Duration::hours(i64::from(schedule.interval_hours.clamp(1, 168)));
    }
    let (hour, minute) = schedule
        .time_of_day
        .split_once(':')
        .and_then(|(hour, minute)| Some((hour.parse::<u32>().ok()?, minute.parse::<u32>().ok()?)))
        .unwrap_or((2, 0));
    let local_after = after.with_timezone(&Local);
    for offset in 0..=8_i64 {
        let date = local_after.date_naive() + Duration::days(offset);
        if schedule.frequency == SqliteBackupScheduleFrequency::Weekly
            && date.weekday().num_days_from_sunday() != u32::from(schedule.weekday.min(6))
        {
            continue;
        }
        let Some(candidate) = date.and_hms_opt(hour, minute, 0) else {
            continue;
        };
        let local = match Local.from_local_datetime(&candidate) {
            LocalResult::Single(value) => value,
            LocalResult::Ambiguous(first, _) => first,
            LocalResult::None => continue,
        };
        let utc = local.with_timezone(&Utc);
        if utc > after {
            return utc;
        }
    }
    after + Duration::days(1)
}

fn schedule_is_due(schedule: &SqliteBackupSchedule, now: DateTime<Utc>) -> bool {
    schedule.enabled
        && DateTime::parse_from_rfc3339(&schedule.next_run_at)
            .is_ok_and(|next| next.with_timezone(&Utc) <= now)
}

fn safe_file_segment(value: &str) -> String {
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

fn backup_file_path(schedule: &SqliteBackupSchedule, run_id: &str, now: DateTime<Utc>) -> PathBuf {
    let stamp = now.format("%Y%m%d-%H%M%S");
    PathBuf::from(&schedule.destination_directory).join(format!(
        "{BACKUP_FILE_PREFIX}{}__{stamp}__{}.sqlite",
        safe_file_segment(&schedule.name),
        &run_id[..8]
    ))
}

fn compressed_backup_file_path(path: &std::path::Path) -> PathBuf {
    path.with_extension("sqlite.gz")
}

fn compress_backup_file(
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

fn safe_run_file(run: &SqliteBackupRun) -> Option<PathBuf> {
    let path = PathBuf::from(run.file_path.as_deref()?);
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

fn safe_run_error(error: &str, cancelled: bool) -> String {
    let normalized = error.to_ascii_lowercase();
    if cancelled || normalized.contains("cancelled") {
        "Backup cancelled; the incomplete file was removed".to_string()
    } else if normalized.contains("no space") || normalized.contains("disk full") {
        "There is not enough free disk space for this backup".to_string()
    } else if normalized.contains("permission") || normalized.contains("access is denied") {
        "Oxide cannot write to the selected backup directory".to_string()
    } else if normalized.contains("active connection")
        || normalized.contains("connect the sqlite")
        || normalized.contains("not found")
    {
        "The scheduled SQLite connection is not active".to_string()
    } else if normalized.contains("transaction") || normalized.contains("busy") {
        "SQLite is busy; finish active transactions before the next backup".to_string()
    } else if normalized.contains("already running") {
        "This SQLite backup schedule is already running".to_string()
    } else if normalized.contains("destination changed") {
        "The backup destination changed; review and save the schedule again".to_string()
    } else if normalized.contains("schedule no longer exists") {
        "The SQLite backup schedule no longer exists".to_string()
    } else if normalized.contains("not due") {
        "The SQLite backup schedule is not currently due".to_string()
    } else {
        "SQLite scheduled backup failed without publishing a partial file".to_string()
    }
}

async fn finish_run(
    state: &SqliteBackupScheduleState,
    run_id: &str,
    status: SqliteBackupRunStatus,
    receipt: Option<crate::core::driver::LocalDatabaseFileReceipt>,
    published_path: Option<&std::path::Path>,
    error: Option<String>,
) -> Result<SqliteBackupRun, String> {
    let completed = Utc::now();
    let mut data = state.data.lock().await;
    let run_index = data
        .runs
        .iter()
        .position(|run| run.id == run_id)
        .ok_or_else(|| "The backup run no longer exists".to_string())?;
    let schedule_id = data.runs[run_index].schedule_id.clone();
    data.runs[run_index].status = status;
    data.runs[run_index].completed_at = Some(completed.to_rfc3339());
    data.runs[run_index].progress_percent = if status == SqliteBackupRunStatus::Success {
        100
    } else {
        data.runs[run_index].progress_percent.min(99)
    };
    data.runs[run_index].error = error;
    if let Some(path) = published_path {
        data.runs[run_index].file_path = Some(path.to_string_lossy().into_owned());
    }
    if let Some(receipt) = receipt {
        data.runs[run_index].byte_len = Some(receipt.byte_len);
        data.runs[run_index].integrity_check = Some(receipt.integrity_check);
    }
    let finished = data.runs[run_index].clone();
    if let Some(schedule) = data
        .schedules
        .iter_mut()
        .find(|schedule| schedule.id == schedule_id)
    {
        schedule.last_run_at = Some(completed.to_rfc3339());
        schedule.last_run_status = Some(status);
        schedule.next_run_at = schedule_next_run(schedule, completed).to_rfc3339();
    }
    state.persist(&data)?;
    Ok(finished)
}

async fn apply_retention(
    state: &SqliteBackupScheduleState,
    schedule_id: &str,
) -> Result<(), String> {
    let mut data = state.data.lock().await;
    let Some(schedule) = data
        .schedules
        .iter()
        .find(|schedule| schedule.id == schedule_id)
        .cloned()
    else {
        return Ok(());
    };
    let mut successful = data
        .runs
        .iter()
        .filter(|run| {
            run.schedule_id == schedule_id && run.status == SqliteBackupRunStatus::Success
        })
        .cloned()
        .collect::<Vec<_>>();
    successful.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    let stale = successful
        .into_iter()
        .skip(usize::from(schedule.retention_count.clamp(1, 100)))
        .collect::<Vec<_>>();
    if stale.is_empty() {
        return Ok(());
    }
    let mut removed = Vec::new();
    for run in stale {
        let Some(path) = safe_run_file(&run) else {
            continue;
        };
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => continue,
            Ok(_) => {
                if std::fs::remove_file(&path).is_ok() {
                    removed.push(run.id);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => removed.push(run.id),
            Err(_) => {}
        }
    }
    if !removed.is_empty() {
        data.runs.retain(|run| !removed.contains(&run.id));
        state.persist(&data)?;
    }
    Ok(())
}

async fn run_schedule(
    state: &SqliteBackupScheduleState,
    manager: &ConnectionManager,
    schedule_id: &str,
    trigger: SqliteBackupRunTrigger,
) -> Result<SqliteBackupRun, String> {
    let schedule_id = validate_identity(schedule_id, "backup schedule identity")?;
    let run_id = uuid::Uuid::new_v4().to_string();
    let control = LocalDatabaseBackupControl::default();
    {
        let mut active = state.active.lock().await;
        if active.contains_key(&schedule_id) {
            return Err("This backup schedule is already running".to_string());
        }
        active.insert(schedule_id.clone(), control.clone());
    }
    let schedule = {
        let data = state.data.lock().await;
        data.schedules
            .iter()
            .find(|schedule| schedule.id == schedule_id)
            .cloned()
    };
    let Some(schedule) = schedule else {
        state.active.lock().await.remove(&schedule_id);
        return Err("The backup schedule no longer exists".to_string());
    };
    if trigger == SqliteBackupRunTrigger::Scheduled && !schedule_is_due(&schedule, Utc::now()) {
        state.active.lock().await.remove(&schedule_id);
        return Err("The SQLite backup schedule is not due".to_string());
    }
    let started = Utc::now();
    let path = backup_file_path(&schedule, &run_id, started);
    let run = SqliteBackupRun {
        id: run_id.clone(),
        schedule_id: schedule.id.clone(),
        schedule_name: schedule.name.clone(),
        project_id: schedule.project_id.clone(),
        connection_id: schedule.connection_id.clone(),
        destination_directory: schedule.destination_directory.clone(),
        compression: schedule.compression,
        trigger,
        status: SqliteBackupRunStatus::Running,
        started_at: started.to_rfc3339(),
        completed_at: None,
        file_path: Some(path.to_string_lossy().into_owned()),
        byte_len: None,
        integrity_check: None,
        progress_percent: 0,
        error: None,
    };
    {
        let mut data = state.data.lock().await;
        data.runs.insert(0, run);
        data.runs.truncate(MAX_RUNS);
        if let Err(error) = state.persist(&data) {
            data.runs.retain(|run| run.id != run_id);
            state.active.lock().await.remove(&schedule.id);
            return Err(error);
        }
    }

    let result = async {
        let destination = canonical_destination(&schedule.destination_directory)?;
        if destination.to_string_lossy() != schedule.destination_directory {
            return Err("The backup destination changed; review the schedule again".to_string());
        }
        confirm_bundled_sqlite(manager, &schedule.connection_id).await?;
        manager
            .backup_local_database_controlled(&schedule.connection_id, &path, &control)
            .await
            .map_err(|error| error.to_string())
    }
    .await;

    let published = match result {
        Ok(receipt) if schedule.compression == SqliteBackupCompression::Gzip => {
            control.set_progress_percent(90);
            let compression_path = compressed_backup_file_path(&path);
            let compression_control = control.clone();
            let compression_source = path.clone();
            let source_integrity_check = receipt.integrity_check;
            tokio::task::spawn_blocking(move || {
                compress_backup_file(
                    &compression_source,
                    &compression_control,
                    &source_integrity_check,
                )
            })
            .await
            .map_err(|error| format!("SQLite backup compression task failed: {error}"))
            .and_then(|receipt| receipt)
            .map(|receipt| (receipt, compression_path))
        }
        Ok(receipt) => Ok((receipt, path.clone())),
        Err(error) => Err(error),
    };

    let finished_result = match published {
        Ok((receipt, published_path)) => {
            finish_run(
                state,
                &run_id,
                SqliteBackupRunStatus::Success,
                Some(receipt),
                Some(&published_path),
                None,
            )
            .await
        }
        Err(error) => {
            let cancelled =
                control.is_cancelled() || error.to_ascii_lowercase().contains("cancelled");
            let _ = std::fs::remove_file(&path);
            finish_run(
                state,
                &run_id,
                if cancelled {
                    SqliteBackupRunStatus::Cancelled
                } else {
                    SqliteBackupRunStatus::Failed
                },
                None,
                None,
                Some(safe_run_error(&error, cancelled)),
            )
            .await
        }
    };
    state.active.lock().await.remove(&schedule.id);
    let finished = finished_result?;
    if finished.status == SqliteBackupRunStatus::Success {
        apply_retention(state, &schedule.id).await?;
    }
    Ok(finished)
}

fn operation_error<T>(code: &str, error: &str) -> Response<T> {
    Response::err(code, error)
}

#[tauri::command]
pub async fn list_sqlite_backup_schedules(
    state: State<'_, SqliteBackupScheduleState>,
) -> Result<Response<Vec<SqliteBackupSchedule>>, String> {
    Ok(Response::ok(state.data.lock().await.schedules.clone()))
}

#[tauri::command]
pub async fn list_sqlite_backup_runs(
    state: State<'_, SqliteBackupScheduleState>,
) -> Result<Response<Vec<SqliteBackupRun>>, String> {
    let active = state.active.lock().await.clone();
    let mut runs = state.data.lock().await.runs.clone();
    for run in &mut runs {
        if run.status == SqliteBackupRunStatus::Running {
            if let Some(control) = active.get(&run.schedule_id) {
                run.progress_percent = control.progress_percent();
            }
        }
    }
    Ok(Response::ok(runs))
}

#[tauri::command]
pub async fn save_sqlite_backup_schedule(
    manager: State<'_, ConnectionManager>,
    state: State<'_, SqliteBackupScheduleState>,
    request: SaveSqliteBackupScheduleRequest,
) -> Result<Response<SqliteBackupSchedule>, String> {
    let result: Result<SqliteBackupSchedule, String> = async {
        let connection_id = validate_identity(&request.connection_id, "connection identity")?;
        let project_id = validate_identity(&request.project_id, "project identity")?;
        confirm_bundled_sqlite(&manager, &connection_id).await?;
        let name = validate_schedule_name(&request.name)?;
        let destination = canonical_destination(&request.destination_directory)?;
        let time_of_day = validate_time_of_day(&request.time_of_day)?;
        if !(1..=168).contains(&request.interval_hours) {
            return Err("Hourly backup interval must be from 1 to 168 hours".to_string());
        }
        if request.weekday > 6 {
            return Err("Weekly backup day must be from Sunday through Saturday".to_string());
        }
        if !(1..=100).contains(&request.retention_count) {
            return Err("Backup retention must keep from 1 to 100 runs".to_string());
        }
        let active = state.active.lock().await;
        if let Some(id) = request.id.as_deref() {
            let id = validate_identity(id, "backup schedule identity")?;
            if active.contains_key(&id) {
                return Err("A running backup schedule cannot be changed".to_string());
            }
        }
        let now = Utc::now();
        let mut data = state.data.lock().await;
        if let Some(id) = request.id.as_deref() {
            let id = validate_identity(id, "backup schedule identity")?;
            if !data.schedules.iter().any(|schedule| schedule.id == id) {
                return Err("The SQLite backup schedule no longer exists".to_string());
            }
        }
        let existing_index = request
            .id
            .as_deref()
            .and_then(|id| data.schedules.iter().position(|schedule| schedule.id == id));
        if existing_index.is_none() && data.schedules.len() >= MAX_SCHEDULES {
            return Err("SQLite backup schedule limit reached".to_string());
        }
        let id = match request.id {
            Some(id) => validate_identity(&id, "backup schedule identity")?,
            None => uuid::Uuid::new_v4().to_string(),
        };
        let created_at = existing_index
            .map(|index| data.schedules[index].created_at.clone())
            .unwrap_or_else(|| now.to_rfc3339());
        let mut schedule = SqliteBackupSchedule {
            id,
            name,
            project_id,
            connection_id,
            destination_directory: destination.to_string_lossy().into_owned(),
            frequency: request.frequency,
            interval_hours: request.interval_hours,
            time_of_day,
            weekday: request.weekday,
            retention_count: request.retention_count,
            compression: request.compression,
            enabled: request.enabled,
            created_at,
            updated_at: now.to_rfc3339(),
            next_run_at: String::new(),
            last_run_at: existing_index.and_then(|index| data.schedules[index].last_run_at.clone()),
            last_run_status: existing_index.and_then(|index| data.schedules[index].last_run_status),
        };
        schedule.next_run_at = schedule_next_run(&schedule, now).to_rfc3339();
        if let Some(index) = existing_index {
            data.schedules[index] = schedule.clone();
        } else {
            data.schedules.push(schedule.clone());
        }
        data.schedules
            .sort_by(|left, right| left.name.cmp(&right.name));
        state.persist(&data)?;
        Ok(schedule)
    }
    .await;
    Ok(match result {
        Ok(schedule) => Response::ok(schedule),
        Err(error) => operation_error("SQLITE_BACKUP_SCHEDULE_SAVE_ERROR", &error),
    })
}

#[tauri::command]
pub async fn delete_sqlite_backup_schedule(
    state: State<'_, SqliteBackupScheduleState>,
    request: SqliteBackupIdentityRequest,
) -> Result<Response<bool>, String> {
    let result: Result<bool, String> = async {
        let id = validate_identity(&request.id, "backup schedule identity")?;
        let active = state.active.lock().await;
        if active.contains_key(&id) {
            return Err("A running backup schedule cannot be deleted".to_string());
        }
        let mut data = state.data.lock().await;
        let before = data.schedules.len();
        data.schedules.retain(|schedule| schedule.id != id);
        let changed = data.schedules.len() != before;
        if changed {
            state.persist(&data)?;
        }
        Ok(changed)
    }
    .await;
    Ok(match result {
        Ok(changed) => Response::ok(changed),
        Err(error) => operation_error("SQLITE_BACKUP_SCHEDULE_DELETE_ERROR", &error),
    })
}

#[tauri::command]
pub async fn run_sqlite_backup_schedule(
    manager: State<'_, ConnectionManager>,
    state: State<'_, SqliteBackupScheduleState>,
    request: RunSqliteBackupScheduleRequest,
) -> Result<Response<SqliteBackupRun>, String> {
    Ok(
        match run_schedule(&state, &manager, &request.schedule_id, request.trigger).await {
            Ok(run) => Response::ok(run),
            Err(error) => operation_error(
                "SQLITE_BACKUP_SCHEDULE_RUN_ERROR",
                &safe_run_error(&error, false),
            ),
        },
    )
}

#[tauri::command]
pub async fn run_due_sqlite_backup_schedules(
    manager: State<'_, ConnectionManager>,
    state: State<'_, SqliteBackupScheduleState>,
) -> Result<Response<Vec<SqliteBackupRun>>, String> {
    let now = Utc::now();
    let due = state
        .data
        .lock()
        .await
        .schedules
        .iter()
        .filter(|schedule| schedule_is_due(schedule, now))
        .take(MAX_DUE_RUNS_PER_TICK)
        .map(|schedule| schedule.id.clone())
        .collect::<Vec<_>>();
    let mut completed = Vec::new();
    for id in due {
        if let Ok(run) =
            run_schedule(&state, &manager, &id, SqliteBackupRunTrigger::Scheduled).await
        {
            completed.push(run);
        }
    }
    Ok(Response::ok(completed))
}

#[tauri::command]
pub async fn cancel_sqlite_backup_run(
    state: State<'_, SqliteBackupScheduleState>,
    request: SqliteBackupIdentityRequest,
) -> Result<Response<bool>, String> {
    let run_id = validate_identity(&request.id, "backup run identity")?;
    let schedule_id = state
        .data
        .lock()
        .await
        .runs
        .iter()
        .find(|run| run.id == run_id && run.status == SqliteBackupRunStatus::Running)
        .map(|run| run.schedule_id.clone());
    let cancelled = if let Some(schedule_id) = schedule_id {
        if let Some(control) = state.active.lock().await.get(&schedule_id) {
            control.cancel();
            true
        } else {
            false
        }
    } else {
        false
    };
    Ok(Response::ok(cancelled))
}

#[tauri::command]
pub async fn delete_sqlite_backup_run(
    state: State<'_, SqliteBackupScheduleState>,
    request: SqliteBackupIdentityRequest,
) -> Result<Response<bool>, String> {
    let result: Result<bool, String> = async {
        let run_id = validate_identity(&request.id, "backup run identity")?;
        let mut data = state.data.lock().await;
        let Some(run) = data.runs.iter().find(|run| run.id == run_id).cloned() else {
            return Ok(false);
        };
        if run.status == SqliteBackupRunStatus::Running {
            return Err("A running backup cannot be deleted".to_string());
        }
        if let Some(path) = safe_run_file(&run) {
            match std::fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                    return Err("Backup history points to an unsafe file type".to_string());
                }
                Ok(_) => std::fs::remove_file(path)
                    .map_err(|_| "Cannot delete the backup file".to_string())?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("Cannot inspect the backup file".to_string()),
            }
        }
        data.runs.retain(|run| run.id != run_id);
        state.persist(&data)?;
        Ok(true)
    }
    .await;
    Ok(match result {
        Ok(deleted) => Response::ok(deleted),
        Err(error) => operation_error("SQLITE_BACKUP_RUN_DELETE_ERROR", &error),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn schedule(directory: &Path) -> SqliteBackupSchedule {
        SqliteBackupSchedule {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Nightly / app".to_string(),
            project_id: "project-1".to_string(),
            connection_id: "sqlite-1".to_string(),
            destination_directory: directory.to_string_lossy().into_owned(),
            frequency: SqliteBackupScheduleFrequency::Hourly,
            interval_hours: 6,
            time_of_day: "02:00".to_string(),
            weekday: 1,
            retention_count: 2,
            compression: SqliteBackupCompression::None,
            enabled: true,
            created_at: "2026-08-31T00:00:00Z".to_string(),
            updated_at: "2026-08-31T00:00:00Z".to_string(),
            next_run_at: "2026-08-31T06:00:00Z".to_string(),
            last_run_at: None,
            last_run_status: None,
        }
    }

    #[test]
    fn validates_schedule_bounds_and_local_time() {
        assert_eq!(validate_time_of_day("23:59").unwrap(), "23:59");
        assert!(validate_time_of_day("24:00").is_err());
        assert!(validate_time_of_day("2:00").is_err());
        assert!(validate_schedule_name("").is_err());
        assert!(validate_identity("bad\nvalue", "identity").is_err());
    }

    #[test]
    fn legacy_schedule_requests_default_to_uncompressed() {
        let request: SaveSqliteBackupScheduleRequest = serde_json::from_value(serde_json::json!({
            "name": "Legacy",
            "projectId": "project-1",
            "connectionId": "sqlite-1",
            "destinationDirectory": "C:/backups",
            "frequency": "daily",
            "intervalHours": 24,
            "timeOfDay": "02:00",
            "weekday": 1,
            "retentionCount": 7,
            "enabled": true
        }))
        .unwrap();

        assert_eq!(request.compression, SqliteBackupCompression::None);
    }

    #[test]
    fn hourly_next_run_and_filename_are_deterministic_and_bounded() {
        let directory = tempfile::tempdir().unwrap();
        let schedule = schedule(directory.path());
        let now = DateTime::parse_from_rfc3339("2026-08-31T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            schedule_next_run(&schedule, now).to_rfc3339(),
            "2026-08-31T06:00:00+00:00"
        );
        assert!(!schedule_is_due(&schedule, now));
        assert!(schedule_is_due(
            &schedule,
            DateTime::parse_from_rfc3339("2026-08-31T06:00:00Z")
                .unwrap()
                .with_timezone(&Utc)
        ));
        let mut disabled = schedule.clone();
        disabled.enabled = false;
        assert!(!schedule_is_due(
            &disabled,
            DateTime::parse_from_rfc3339("2026-09-01T06:00:00Z")
                .unwrap()
                .with_timezone(&Utc)
        ));
        let path = backup_file_path(&schedule, "12345678-1234-1234-1234-123456789abc", now);
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some("oxide-sqlite-backup__Nightly _ app__20260831-000000__12345678.sqlite")
        );
    }

    #[test]
    fn retention_file_guard_rejects_other_directories_and_symlinks_by_name() {
        let directory = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let schedule = schedule(directory.path());
        let mut run = SqliteBackupRun {
            id: "run-1".to_string(),
            schedule_id: schedule.id.clone(),
            schedule_name: schedule.name.clone(),
            project_id: schedule.project_id.clone(),
            connection_id: schedule.connection_id.clone(),
            destination_directory: schedule.destination_directory.clone(),
            compression: SqliteBackupCompression::None,
            trigger: SqliteBackupRunTrigger::Manual,
            status: SqliteBackupRunStatus::Success,
            started_at: "2026-08-31T00:00:00Z".to_string(),
            completed_at: Some("2026-08-31T00:01:00Z".to_string()),
            file_path: Some(
                directory
                    .path()
                    .join("oxide-sqlite-backup__safe.sqlite")
                    .to_string_lossy()
                    .into_owned(),
            ),
            byte_len: Some(1),
            integrity_check: Some("ok".to_string()),
            progress_percent: 100,
            error: None,
        };
        assert_eq!(
            safe_run_file(&run),
            run.file_path.as_deref().map(PathBuf::from)
        );
        run.file_path = Some(
            other
                .path()
                .join("oxide-sqlite-backup__safe.sqlite")
                .to_string_lossy()
                .into_owned(),
        );
        assert!(safe_run_file(&run).is_none());
        run.file_path = Some(
            directory
                .path()
                .join("personal.sqlite")
                .to_string_lossy()
                .into_owned(),
        );
        assert!(safe_run_file(&run).is_none());
    }

    #[test]
    fn gzip_backup_is_published_with_round_trip_content_and_safe_retention_path() {
        use flate2::read::GzDecoder;

        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("oxide-sqlite-backup__safe.sqlite");
        let payload = b"SQLite format 3\0fixture payload".repeat(4_096);
        std::fs::write(&source, &payload).unwrap();
        let control = LocalDatabaseBackupControl::default();
        let receipt = compress_backup_file(&source, &control, "ok").unwrap();
        let compressed = compressed_backup_file_path(&source);

        assert!(!source.exists());
        assert!(compressed.is_file());
        assert_eq!(
            receipt.byte_len,
            std::fs::metadata(&compressed).unwrap().len()
        );
        assert!(receipt.integrity_check.contains("gzip stream finalized"));
        assert_eq!(control.progress_percent(), 100);

        let mut decoded = Vec::new();
        GzDecoder::new(std::fs::File::open(&compressed).unwrap())
            .read_to_end(&mut decoded)
            .unwrap();
        assert_eq!(decoded, payload);

        let schedule = schedule(directory.path());
        let run = SqliteBackupRun {
            id: "run-gzip".to_string(),
            schedule_id: schedule.id,
            schedule_name: schedule.name,
            project_id: schedule.project_id,
            connection_id: schedule.connection_id,
            destination_directory: schedule.destination_directory,
            compression: SqliteBackupCompression::Gzip,
            trigger: SqliteBackupRunTrigger::Manual,
            status: SqliteBackupRunStatus::Success,
            started_at: "2026-08-31T00:00:00Z".to_string(),
            completed_at: Some("2026-08-31T00:01:00Z".to_string()),
            file_path: Some(compressed.to_string_lossy().into_owned()),
            byte_len: Some(receipt.byte_len),
            integrity_check: Some(receipt.integrity_check),
            progress_percent: 100,
            error: None,
        };
        assert_eq!(safe_run_file(&run), Some(compressed));
    }

    #[test]
    fn control_is_bounded_and_cancellable() {
        let control = LocalDatabaseBackupControl::default();
        control.set_progress_percent(250);
        assert_eq!(control.progress_percent(), 100);
        assert!(!control.is_cancelled());
        control.cancel();
        assert!(control.is_cancelled());
    }
}
