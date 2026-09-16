//! Host-owned SQLite backup schedule facade; persistent state, destination validation, calendar policy, files, execution, and IPC stay separate.

mod calendar;
pub mod commands;
mod files;
mod models;
mod runner;
mod state;
mod validation;

pub use commands::{
    cancel_sqlite_backup_run, delete_sqlite_backup_run, delete_sqlite_backup_schedule,
    list_sqlite_backup_runs, list_sqlite_backup_schedules, run_due_sqlite_backup_schedules,
    run_sqlite_backup_schedule, save_sqlite_backup_schedule,
};
pub use models::{
    RunSqliteBackupScheduleRequest, SaveSqliteBackupScheduleRequest, SqliteBackupCompression,
    SqliteBackupIdentityRequest, SqliteBackupRun, SqliteBackupRunStatus, SqliteBackupRunTrigger,
    SqliteBackupSchedule, SqliteBackupScheduleFrequency,
};
pub use state::SqliteBackupScheduleState;

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
mod tests;
