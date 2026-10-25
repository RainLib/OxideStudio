use super::models::{SqliteBackupDeletePreview, SqliteBackupDeleteRequest};
use crate::core::protocol::Response;
use tauri::State;

use super::autostart::set_background_enabled;
use super::files::safe_run_error;
use super::models::{
    RunSqliteBackupScheduleRequest, SaveSqliteBackupScheduleRequest, SqliteBackupArtifactPage,
    SqliteBackupArtifactQuery, SqliteBackupIdentityRequest, SqliteBackupRun, SqliteBackupSchedule,
    SqliteBackupWorkerStatus,
};
use super::process::ensure_worker;
use super::queue::{cancel_run, enqueue_due, enqueue_schedule};
use super::state::SqliteBackupScheduleState;
use super::validation::validate_identity;
use super::worker::worker_status;

pub(super) fn operation_error<T>(code: &str, error: &str) -> Response<T> {
    Response::err(code, error)
}

#[tauri::command]
pub async fn list_sqlite_backup_schedules(
    state: State<'_, SqliteBackupScheduleState>,
) -> Result<Response<Vec<SqliteBackupSchedule>>, String> {
    Ok(Response::ok(state.lock_data().await?.schedules.clone()))
}

#[tauri::command]
pub async fn list_sqlite_backup_runs(
    state: State<'_, SqliteBackupScheduleState>,
) -> Result<Response<Vec<SqliteBackupRun>>, String> {
    Ok(Response::ok(state.lock_data().await?.runs.clone()))
}

#[tauri::command]
pub async fn list_sqlite_backup_artifacts(
    state: State<'_, SqliteBackupScheduleState>,
    request: SqliteBackupArtifactQuery,
) -> Result<Response<SqliteBackupArtifactPage>, String> {
    Ok(Response::ok(state.list_artifacts(request).await?))
}

#[tauri::command]
pub async fn save_sqlite_backup_schedule(
    state: State<'_, SqliteBackupScheduleState>,
    request: SaveSqliteBackupScheduleRequest,
) -> Result<Response<SqliteBackupSchedule>, String> {
    Ok(match state.save_schedule(request).await {
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
        let mut data = state.lock_data().await?;
        if data
            .runs
            .iter()
            .any(|run| run.schedule_id == id && run.status.is_active())
        {
            return Err("A running or queued backup schedule cannot be deleted".to_string());
        }
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
    state: State<'_, SqliteBackupScheduleState>,
    request: RunSqliteBackupScheduleRequest,
) -> Result<Response<SqliteBackupRun>, String> {
    let result = async {
        ensure_worker(&state).await?;
        enqueue_schedule(&state, &request.schedule_id, request.trigger).await
    }
    .await;
    Ok(match result {
        Ok(run) => Response::ok(run),
        Err(error) => operation_error(
            "SQLITE_BACKUP_SCHEDULE_RUN_ERROR",
            &safe_run_error(&error, false),
        ),
    })
}

#[tauri::command]
pub async fn run_due_sqlite_backup_schedules(
    state: State<'_, SqliteBackupScheduleState>,
) -> Result<Response<Vec<SqliteBackupRun>>, String> {
    ensure_worker(&state).await?;
    Ok(Response::ok(enqueue_due(&state).await?))
}

#[tauri::command]
pub async fn get_sqlite_backup_worker_status(
    state: State<'_, SqliteBackupScheduleState>,
) -> Result<Response<SqliteBackupWorkerStatus>, String> {
    Ok(Response::ok(worker_status(&state).await?))
}

#[tauri::command]
pub async fn set_sqlite_backup_background_enabled(
    state: State<'_, SqliteBackupScheduleState>,
    enabled: bool,
) -> Result<Response<SqliteBackupWorkerStatus>, String> {
    set_background_enabled(&state, enabled).await?;
    if enabled {
        ensure_worker(&state).await?;
    }
    Ok(Response::ok(worker_status(&state).await?))
}

#[tauri::command]
pub async fn cancel_sqlite_backup_run(
    state: State<'_, SqliteBackupScheduleState>,
    request: SqliteBackupIdentityRequest,
) -> Result<Response<bool>, String> {
    Ok(Response::ok(cancel_run(&state, &request.id).await?))
}

#[tauri::command]
pub async fn delete_sqlite_backup_run(
    state: State<'_, SqliteBackupScheduleState>,
    request: SqliteBackupDeleteRequest,
) -> Result<Response<bool>, String> {
    let result = state
        .delete_backup_confirmed(&request.id, request.confirmation_token.as_deref())
        .await;
    Ok(match result {
        Ok(deleted) => Response::ok(deleted),
        Err(error) => operation_error("SQLITE_BACKUP_RUN_DELETE_ERROR", &error),
    })
}

#[tauri::command]
pub async fn preview_sqlite_backup_file_delete(
    state: State<'_, SqliteBackupScheduleState>,
    request: SqliteBackupIdentityRequest,
) -> Result<Response<SqliteBackupDeletePreview>, String> {
    Ok(Response::ok(
        state.preview_delete_backup(&request.id).await?,
    ))
}
