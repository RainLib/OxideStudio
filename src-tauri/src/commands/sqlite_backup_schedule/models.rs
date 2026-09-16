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
    /// Filesystem identity captured when the user explicitly saves the
    /// destination. The renderer may observe this receipt but cannot supply
    /// or override it because it is absent from the save request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) destination_identity: Option<SqliteBackupDestinationIdentity>,
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
pub(super) struct SqliteBackupScheduleData {
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
