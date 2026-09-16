use crate::core::{manager::ConnectionManager, protocol::Response};
use chrono::Utc;
use tauri::State;

use super::calendar::{schedule_is_due, schedule_next_run};
use super::files::{delete_safe_run_file, safe_run_error};
use super::models::{
    RunSqliteBackupScheduleRequest, SaveSqliteBackupScheduleRequest, SqliteBackupIdentityRequest,
    SqliteBackupRun, SqliteBackupRunStatus, SqliteBackupRunTrigger, SqliteBackupSchedule,
    MAX_DUE_RUNS_PER_TICK, MAX_SCHEDULES,
};
use super::runner::run_schedule;
use super::state::SqliteBackupScheduleState;
use super::validation::{
    canonical_destination, confirm_bundled_sqlite, require_destination_identity, validate_identity,
    validate_schedule_name, validate_time_of_day,
};

pub(super) fn operation_error<T>(code: &str, error: &str) -> Response<T> {
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
        let destination_identity = require_destination_identity(&destination)?;
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
            destination_identity: Some(destination_identity),
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
        delete_safe_run_file(&run)?;
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
