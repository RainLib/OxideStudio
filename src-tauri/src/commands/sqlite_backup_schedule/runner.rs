use crate::core::driver::LocalDatabaseBackupControl;
use chrono::Utc;

use super::artifacts::ArtifactLedger;
use super::calendar::advance_schedule;
use super::control::claim_allowed;
use super::files::{
    backup_file_path, compress_backup_file, compressed_backup_file_path, safe_run_error,
};
use super::models::{SqliteBackupCompression, SqliteBackupRun, SqliteBackupRunStatus};
use super::source::backup_saved_connection;
use super::state::SqliteBackupScheduleState;
use super::validation::{
    canonical_destination, destination_identity_for_file, require_destination_identity,
    verify_destination_identity,
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
    let mut data = state.lock_data().await?;
    let run_index = data
        .runs
        .iter()
        .position(|run| run.id == run_id)
        .ok_or_else(|| "The backup run no longer exists".to_string())?;
    let schedule_id = data.runs[run_index].schedule_id.clone();
    let mut ledger = ArtifactLedger::open(state, &data).await?;
    let mut finished = data.runs[run_index].clone();
    if let Some(receipt) = ledger.terminal_receipt(&finished).await? {
        finished = receipt;
    } else if !finished.status.is_active() {
        // Queued cancellation may win before the execution task claims it.
        // Its late failure must not replace that already committed outcome.
        ledger.close().await?;
        return Ok(finished);
    } else {
        finished.status = status;
        finished.completed_at = Some(completed.to_rfc3339());
        finished.progress_percent = if status == SqliteBackupRunStatus::Success {
            100
        } else {
            finished.progress_percent.min(99)
        };
        finished.error = error;
        if receipt.is_none()
            && matches!(
                status,
                SqliteBackupRunStatus::Failed | SqliteBackupRunStatus::Cancelled
            )
        {
            finished.file_path = None;
        }
        if let Some(path) = published_path {
            finished.file_path = Some(path.to_string_lossy().into_owned());
        }
        if let Some(receipt) = receipt {
            finished.byte_len = Some(receipt.byte_len);
            finished.integrity_check = Some(receipt.integrity_check);
        }
        if finished.status == SqliteBackupRunStatus::Success {
            finished = ledger.register_completed(&finished).await?;
        }
    }
    data.runs[run_index] = finished.clone();
    if let Some(schedule) = data
        .schedules
        .iter_mut()
        .find(|schedule| schedule.id == schedule_id)
    {
        schedule.last_run_at = Some(completed.to_rfc3339());
        schedule.last_run_status = Some(finished.status);
        advance_schedule(schedule, completed);
    }
    state.persist(&data)?;
    ledger.close().await?;
    Ok(finished)
}

pub(super) async fn apply_retention(
    state: &SqliteBackupScheduleState,
    schedule_id: &str,
) -> Result<(), String> {
    let mut first_error = None;
    let mut after = None;
    let mut unavailable = std::collections::HashSet::new();
    loop {
        let mut data = state.lock_data().await?;
        let Some(schedule) = data
            .schedules
            .iter()
            .find(|schedule| schedule.id == schedule_id)
            .cloned()
        else {
            return Ok(());
        };
        let mut ledger = ArtifactLedger::open(state, &data).await?;
        ledger.archive_history(&data.runs).await?;
        let stale = ledger
            .stale(schedule_id, schedule.retention_count, after.as_ref())
            .await?;
        if stale.is_empty() {
            ledger.close().await?;
            return first_error.map_or(Ok(()), Err);
        }
        let mut removed = Vec::new();
        after = stale.last().map(|artifact| artifact.run.clone());
        let mut ledger_failed = false;
        for artifact in stale {
            if unavailable.contains(&artifact.run.destination_directory) {
                continue;
            }
            match ledger.remove(&artifact).await {
                Ok(()) => removed.push(artifact.run.id),
                Err(error) => {
                    if error.contains("destination is unavailable") {
                        unavailable.insert(artifact.run.destination_directory);
                    }
                    ledger_failed = error == "Cannot access the backup file ledger";
                    first_error.get_or_insert(error);
                    if ledger_failed {
                        break;
                    }
                }
            }
        }
        if !removed.is_empty() {
            data.runs.retain(|run| !removed.contains(&run.id));
            state.persist(&data)?;
            ledger.prune_tombstones(&data.runs).await?;
        }
        ledger.close().await?;
        if ledger_failed {
            return first_error.map_or(Ok(()), Err);
        }
        drop(data);
        tokio::task::yield_now().await;
    }
}

pub(super) async fn run_schedule(
    state: &SqliteBackupScheduleState,
    run_id: &str,
    control: &LocalDatabaseBackupControl,
) -> Result<SqliteBackupRun, String> {
    uuid::Uuid::parse_str(run_id).map_err(|_| "Invalid backup run identity".to_string())?;
    let (run, schedule) = {
        let mut data = state.lock_data().await?;
        let ledger = ArtifactLedger::open(state, &data).await?;
        ledger.close().await?;
        let index = data
            .runs
            .iter()
            .position(|run| run.id == run_id && run.status == SqliteBackupRunStatus::Queued)
            .ok_or_else(|| "The queued SQLite backup no longer exists".to_string())?;
        {
            let instance = state
                .worker_instance
                .lock()
                .map_err(|_| "Cannot inspect worker ownership")?;
            if !claim_allowed(state.root(), &state.config_dir, instance.as_deref())? {
                return Ok(data.runs[index].clone());
            }
        }
        let schedule = data
            .schedules
            .iter()
            .find(|schedule| schedule.id == data.runs[index].schedule_id)
            .cloned()
            .ok_or_else(|| "The SQLite backup schedule no longer exists".to_string())?;
        if schedule.project_id != data.runs[index].project_id
            || schedule.connection_id != data.runs[index].connection_id
        {
            return Err("The queued backup source changed".to_string());
        }
        data.runs[index].status = SqliteBackupRunStatus::Running;
        state.persist(&data)?;
        (data.runs[index].clone(), schedule)
    };
    if run.cancel_requested {
        control.cancel();
    }
    let started = chrono::DateTime::parse_from_rfc3339(&run.started_at)
        .map_err(|_| "Invalid backup run time".to_string())?
        .with_timezone(&Utc);
    let path = backup_file_path(&schedule, run_id, started);
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
        if path.exists() || compressed_backup_file_path(&path).exists() {
            return Err("The backup job destination already exists".to_string());
        }
        backup_saved_connection(state, &schedule, &path, control).await
    }
    .await;

    let created_backup = result.is_ok();
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
                        run_id,
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
                        run_id,
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
            if created_backup {
                let _ = std::fs::remove_file(&path);
            }
            finish_run(
                state,
                run_id,
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
    let mut finished = finished_result?;
    if finished.status == SqliteBackupRunStatus::Success {
        if let Err(error) = apply_retention(state, &schedule.id).await {
            let warning =
                format!("Backup completed, but retention cleanup needs attention: {error}");
            let mut data = state.lock_data().await?;
            if let Some(run) = data.runs.iter_mut().find(|run| run.id == run_id) {
                run.error = Some(warning.clone());
                state.persist(&data)?;
            }
            finished.error = Some(warning);
        }
    }
    Ok(finished)
}
