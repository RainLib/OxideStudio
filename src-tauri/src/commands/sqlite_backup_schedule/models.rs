use serde::{Deserialize, Serialize};

pub(super) const MAX_SCHEDULES: usize = 100;
pub(super) const MAX_RUNS: usize = 500;
pub(super) const MAX_DUE_RUNS_PER_TICK: usize = 10;
pub(super) const BACKUP_FILE_PREFIX: &str = "oxide-sqlite-backup__";

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
    Queued,
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
    /// Missing preserves an existing zone (or legacy system-local behavior).
    /// "system" explicitly opts into following the machine's time zone.
    #[serde(default)]
    pub time_zone: Option<String>,
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
    /// Filesystem identity captured when the user explicitly saves the
    /// destination. The renderer may observe this receipt but cannot supply
    /// or override it because it is absent from the save request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) destination_identity: Option<SqliteBackupDestinationIdentity>,
    pub frequency: SqliteBackupScheduleFrequency,
    pub interval_hours: u16,
    pub time_of_day: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_zone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduling_error: Option<String>,
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

impl SqliteBackupSchedule {
    pub(super) fn is_pause_request(&self, request: &SaveSqliteBackupScheduleRequest) -> bool {
        !request.enabled
            && request.id.as_deref() == Some(self.id.as_str())
            && request.name.trim() == self.name
            && request.project_id.trim() == self.project_id
            && request.connection_id.trim() == self.connection_id
            && request.destination_directory.trim() == self.destination_directory
            && request.frequency == self.frequency
            && request.interval_hours == self.interval_hours
            && request.time_of_day.trim() == self.time_of_day
            && request.time_zone.as_deref().is_none_or(|zone| {
                if zone.trim() == "system" {
                    self.time_zone.is_none()
                } else {
                    self.time_zone.as_deref() == Some(zone.trim())
                }
            })
            && request.weekday == self.weekday
            && request.retention_count == self.retention_count
            && request.compression == self.compression
    }
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
    #[serde(default)]
    pub cancel_requested: bool,
}

impl SqliteBackupRun {
    /// Completion owns 100%; late telemetry can only update a running job.
    pub(super) fn record_running_progress(&mut self, progress: u8) -> bool {
        let progress = progress.min(99);
        if self.status != SqliteBackupRunStatus::Running || self.progress_percent == progress {
            return false;
        }
        self.progress_percent = progress;
        true
    }
}

impl SqliteBackupRunStatus {
    pub(super) fn is_active(self) -> bool {
        matches!(self, Self::Queued | Self::Running)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupWorkerStatus {
    pub background_enabled: bool,
    pub running: bool,
    pub upgrading: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupArtifactQuery {
    pub project_id: Option<String>,
    pub schedule_id: Option<String>,
    #[serde(default)]
    pub search: String,
    pub cursor: Option<String>,
    pub limit: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupArtifactPage {
    pub items: Vec<SqliteBackupRun>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupDeleteRequest {
    pub id: String,
    pub confirmation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupDeletePreview {
    pub id: String,
    pub file_path: Option<String>,
    pub byte_len: Option<u64>,
    pub review_required: bool,
    pub confirmation_token: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SqliteBackupScheduleData {
    #[serde(default)]
    pub(super) background_enabled: bool,
    #[serde(default)]
    pub(super) schedules: Vec<SqliteBackupSchedule>,
    #[serde(default)]
    pub(super) runs: Vec<SqliteBackupRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub(super) enum SqliteBackupDestinationIdentity {
    Device(u64),
    PersistentVolumeUuid([u8; 16]),
}

impl SqliteBackupDestinationIdentity {
    pub(super) fn matches(&self, current: &Self) -> bool {
        self == current
    }
}
