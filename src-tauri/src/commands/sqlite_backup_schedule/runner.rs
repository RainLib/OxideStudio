use crate::core::{driver::LocalDatabaseBackupControl, manager::ConnectionManager};
use chrono::Utc;

use super::calendar::{schedule_is_due, schedule_next_run};
use super::files::{
    backup_file_path, compress_backup_file, compressed_backup_file_path, safe_run_error,
    safe_run_file,
};
use super::models::{
    SqliteBackupCompression, SqliteBackupRun, SqliteBackupRunStatus, SqliteBackupRunTrigger,
    MAX_RUNS,
};
use super::state::SqliteBackupScheduleState;
use super::validation::{
    canonical_destination, confirm_bundled_sqlite, destination_identity_for_file,
    require_destination_identity, validate_identity, verify_destination_identity,
};

pub(super) async fn finish_run(
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

pub(super) async fn apply_retention(
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

pub(super) async fn run_schedule(
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
        let current_identity = require_destination_identity(&destination)?;
        verify_destination_identity(
            schedule.destination_identity.as_ref(),
            Some(&current_identity),
        )?;
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
            let opened_identity = std::fs::File::open(&published_path)
                .ok()
                .and_then(|file| destination_identity_for_file(&file));
            match verify_destination_identity(
                schedule.destination_identity.as_ref(),
                opened_identity.as_ref(),
            ) {
                Ok(()) => {
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
                    let _ = std::fs::remove_file(&published_path);
                    finish_run(
                        state,
                        &run_id,
                        SqliteBackupRunStatus::Failed,
                        None,
                        None,
                        Some(safe_run_error(&error, false)),
                    )
                    .await
                }
            }
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
