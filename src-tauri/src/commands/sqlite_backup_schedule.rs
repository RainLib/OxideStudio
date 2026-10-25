//! Host-owned SQLite backup schedule facade; persistent state, destination validation, calendar policy, files, execution, and IPC stay separate.

mod artifact_files;
mod artifacts;
mod autostart;
mod calendar;
pub mod commands;
mod control;
mod files;
mod installation;
mod installation_control;
mod installation_state;
mod leadership;
mod models;
mod plans;
mod process;
mod queue;
mod runner;
mod source;
mod state;
mod validation;
mod worker;
mod worker_exit;

pub use commands::preview_sqlite_backup_file_delete;
pub use commands::{
    cancel_sqlite_backup_run, delete_sqlite_backup_run, delete_sqlite_backup_schedule,
    get_sqlite_backup_worker_status, list_sqlite_backup_artifacts, list_sqlite_backup_runs,
    list_sqlite_backup_schedules, run_due_sqlite_backup_schedules, run_sqlite_backup_schedule,
    save_sqlite_backup_schedule, set_sqlite_backup_background_enabled,
};
pub use installation::install_prepared;
pub use installation::{UpdateInstallationStatus, UpdatePreparation};
pub use models::{
    RunSqliteBackupScheduleRequest, SaveSqliteBackupScheduleRequest, SqliteBackupArtifactPage,
    SqliteBackupArtifactQuery, SqliteBackupCompression, SqliteBackupIdentityRequest,
    SqliteBackupRun, SqliteBackupRunStatus, SqliteBackupRunTrigger, SqliteBackupSchedule,
    SqliteBackupScheduleFrequency, SqliteBackupWorkerStatus,
};
pub use models::{SqliteBackupDeletePreview, SqliteBackupDeleteRequest};
pub use state::SqliteBackupScheduleState;
pub use worker::run_backup_worker_from_args;

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use calendar::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use files::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use models::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use validation::*;
#[cfg(test)]
mod artifact_tests;
#[cfg(test)]
mod calendar_tests;
#[cfg(test)]
mod control_tests;
#[cfg(test)]
mod installation_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod worker_tests;
