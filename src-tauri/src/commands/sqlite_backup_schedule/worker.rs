use super::artifacts::ArtifactLedger;
use super::autostart::refresh_autostart;
use super::calendar::advance_schedule;
use super::files::{compressed_backup_file_path, safe_run_file};
use super::installation::maintain_preparation;
use super::leadership::{enter_worker, register_desktop, status, still_selected};
use super::models::SqliteBackupCompression;
use super::models::{SqliteBackupRunStatus, SqliteBackupWorkerStatus};
use super::process::ensure_worker;
use super::queue::enqueue_due;
use super::runner::{finish_run, run_schedule};
use super::state::SqliteBackupScheduleState;
use crate::core::driver::LocalDatabaseBackupControl;
use chrono::Utc;
use std::path::PathBuf;
use std::time::Duration;

pub(super) async fn worker_status(
    state: &SqliteBackupScheduleState,
) -> Result<SqliteBackupWorkerStatus, String> {
    status(state).await
}

impl SqliteBackupScheduleState {
    pub fn start_supervisor(&self) {
        let state = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = register_desktop(&state).await {
                tracing::warn!(%error, "backup worker registration needs attention");
            }
            if let Err(error) = refresh_autostart(&state).await {
                tracing::warn!(%error, "backup startup registration needs attention");
            }
            loop {
                match maintain_preparation(&state).await {
                    Ok(true) => {
                        if let Err(error) = register_desktop(&state).await {
                            tracing::warn!(%error, "backup update recovery needs attention");
                        } else if let Err(error) = refresh_autostart(&state).await {
                            tracing::warn!(%error, "backup startup recovery needs attention");
                        }
                    }
                    Ok(false) => {}
                    Err(error) => {
                        tracing::warn!(%error, "backup update preparation needs attention")
                    }
                }
                let needs_worker = match state.lock_data().await {
                    Ok(data) => {
                        data.background_enabled
                            || data.schedules.iter().any(|schedule| schedule.enabled)
                            || data.runs.iter().any(|run| run.status.is_active())
                    }
                    Err(error) => {
                        tracing::warn!(%error, "backup scheduler cannot read its store");
                        false
                    }
                };
                if needs_worker {
                    if let Err(error) = ensure_worker(&state).await {
                        tracing::warn!(%error, "backup worker unavailable");
                    }
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });
    }
}

async fn recover_abandoned_runs(state: &SqliteBackupScheduleState) -> Result<(), String> {
    let mut data = state.lock_data().await?;
    let mut ledger = ArtifactLedger::open(state, &data).await?;
    let now = Utc::now().to_rfc3339();
    let mut changed = false;
    let mut interrupted = Vec::new();
    let mut recovered = Vec::new();
    for run in &mut data.runs {
        if run.status == SqliteBackupRunStatus::Running {
            if let Some(completed) = ledger.terminal_receipt(run).await? {
                recovered.push((
                    completed.schedule_id.clone(),
                    completed.completed_at.clone(),
                    completed.status,
                    completed.started_at.clone(),
                ));
                *run = completed;
                changed = true;
                continue;
            }
            run.status = SqliteBackupRunStatus::Interrupted;
            run.completed_at = Some(now.clone());
            run.error = Some("The backup worker stopped before recording completion. Review any published file before using it; this occurrence will not run again automatically".to_string());
            if let Some(path) = safe_run_file(run) {
                let compressed = compressed_backup_file_path(&path);
                if run.compression == SqliteBackupCompression::Gzip && compressed.is_file() {
                    run.file_path = Some(compressed.to_string_lossy().into_owned());
                } else if std::fs::symlink_metadata(&path)
                    .err()
                    .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound)
                {
                    run.file_path = None;
                }
            }
            interrupted.push((run.schedule_id.clone(), run.started_at.clone()));
            changed = true;
        }
    }
    for schedule in &mut data.schedules {
        if let Some((_, completed, status, started)) =
            recovered.iter().find(|(id, _, _, _)| id == &schedule.id)
        {
            schedule.last_run_status = Some(*status);
            schedule.last_run_at = completed.clone();
            if *status == SqliteBackupRunStatus::Success {
                if let Some(completed) = completed
                    .as_deref()
                    .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                {
                    advance_schedule(schedule, completed.with_timezone(&Utc));
                }
            } else if let Ok(started) = chrono::DateTime::parse_from_rfc3339(started) {
                let started = started.with_timezone(&Utc);
                if chrono::DateTime::parse_from_rfc3339(&schedule.next_run_at)
                    .is_ok_and(|next| next.with_timezone(&Utc) <= started)
                {
                    advance_schedule(schedule, started);
                }
            }
        }
        if let Some((_, started)) = interrupted.iter().find(|(id, _)| id == &schedule.id) {
            schedule.last_run_status = Some(SqliteBackupRunStatus::Interrupted);
            if let Ok(started) = chrono::DateTime::parse_from_rfc3339(started) {
                let started = started.with_timezone(&Utc);
                if chrono::DateTime::parse_from_rfc3339(&schedule.next_run_at)
                    .is_ok_and(|next| next.with_timezone(&Utc) <= started)
                {
                    advance_schedule(schedule, started);
                }
            }
        }
    }
    if changed {
        ledger.archive_history(&data.runs).await?;
        state.persist(&data)?;
    }
    ledger.close().await?;
    Ok(())
}

async fn execute_job(state: &SqliteBackupScheduleState, run_id: String) -> Result<(), String> {
    let control = LocalDatabaseBackupControl::default();
    let task_state = state.clone();
    let task_id = run_id.clone();
    let task_control = control.clone();
    let mut task =
        tokio::spawn(async move { run_schedule(&task_state, &task_id, &task_control).await });
    let mut timer = tokio::time::interval(Duration::from_millis(500));
    loop {
        tokio::select! {
            result = &mut task => {
                match result {
                    Ok(Ok(_)) => return Ok(()),
                    Ok(Err(_)) | Err(_) => {
                        finish_run(state, &run_id, SqliteBackupRunStatus::Failed, None, None,
                            Some("The queued backup could not be executed; review its saved source and destination".to_string())).await?;
                        return Ok(());
                    }
                }
            }
            _ = timer.tick() => {
                let inspection = async { Ok::<_, String>((state.desktop_is_open()?, state.lock_data().await?)) }.await;
                let (desktop_open, mut data) = match inspection {
                    Ok(inspection) => inspection,
                    Err(error) => {
                        control.cancel();
                        let _ = task.await;
                        return Err(error);
                    }
                };
                if !data.background_enabled && !desktop_open { control.cancel(); }
                if let Some(run) = data.runs.iter_mut().find(|run| run.id == run_id) {
                    if run.cancel_requested { control.cancel(); }
                    if run.record_running_progress(control.progress_percent()) {
                        if let Err(error) = state.persist(&data) {
                            drop(data);
                            control.cancel();
                            let _ = task.await;
                            return Err(error);
                        }
                    }
                }
            }
        }
    }
}

pub(super) async fn run_worker(
    state: &SqliteBackupScheduleState,
    once: bool,
) -> Result<(), String> {
    run_worker_with_activation(state, once, false).await
}

async fn run_worker_with_activation(
    state: &SqliteBackupScheduleState,
    once: bool,
    activate: bool,
) -> Result<(), String> {
    let Some(_leader) = enter_worker(state, once, activate).await? else {
        return Ok(());
    };
    // Only the exclusive leader may repair Running records. Opening another
    // desktop window cannot interrupt a backup being executed by this process.
    recover_abandoned_runs(state).await?;
    loop {
        if !still_selected(state).await? {
            return Ok(());
        }
        let desktop_open = state.desktop_is_open()?;
        let background_enabled = state.lock_data().await?.background_enabled;
        if !background_enabled && !desktop_open {
            return Ok(());
        }
        enqueue_due(state).await?;
        let pending = state
            .lock_data()
            .await?
            .runs
            .iter()
            .rev()
            .find(|run| run.status == SqliteBackupRunStatus::Queued)
            .map(|run| run.id.clone());
        match pending {
            Some(run_id) => execute_job(state, run_id).await?,
            None if once => return Ok(()),
            None => tokio::time::sleep(Duration::from_secs(1)).await,
        }
    }
}

/// Entry point is dispatched before Tauri/WebView initialization. The worker
/// has no HTTP server or public command interface and accepts no SQL/paths to
/// back up directly; jobs must already exist in the desktop's reviewed store.
pub fn run_backup_worker_from_args(args: Vec<std::ffi::OsString>) -> Result<(), String> {
    let mut args = args.into_iter();
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--backup-worker")) {
        return Err("Invalid backup worker invocation".to_string());
    }
    let (mut data_dir, mut config_dir, mut once, mut activate) = (None, None, false, false);
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--data-dir") if data_dir.is_none() => data_dir = args.next().map(PathBuf::from),
            Some("--config-dir") if config_dir.is_none() => {
                config_dir = args.next().map(PathBuf::from)
            }
            Some("--once") if !once => once = true,
            Some("--activate") if !activate => activate = true,
            _ => return Err("Unknown or repeated backup worker option".to_string()),
        }
    }
    let data_dir = data_dir
        .filter(|path| path.is_absolute() && path.is_dir())
        .ok_or("Backup worker requires an existing absolute data directory")?;
    let config_dir = config_dir
        .filter(|path| path.is_absolute() && path.is_dir())
        .ok_or("Backup worker requires an existing absolute config directory")?;
    let state = SqliteBackupScheduleState::load_at(&data_dir, &config_dir, false)?;
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|_| "Cannot initialize the backup worker runtime".to_string())?
        .block_on(async {
            if activate {
                run_worker_with_activation(&state, once, true).await
            } else {
                run_worker(&state, once).await
            }
        })
}
