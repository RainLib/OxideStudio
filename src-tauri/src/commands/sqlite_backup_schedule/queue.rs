use super::artifacts::ArtifactLedger;
use super::calendar::{schedule_is_due, schedule_next_run};
use super::files::backup_file_path;
use super::models::{
    SqliteBackupRun, SqliteBackupRunStatus, SqliteBackupRunTrigger, MAX_DUE_RUNS_PER_TICK, MAX_RUNS,
};
use super::state::{LockedScheduleData, SqliteBackupScheduleState};
use super::validation::validate_identity;
use chrono::Utc;

impl SqliteBackupScheduleState {
    pub async fn queue_backup(&self, schedule_id: &str) -> Result<SqliteBackupRun, String> {
        enqueue_schedule(self, schedule_id, SqliteBackupRunTrigger::Manual).await
    }
}

async fn enqueue(
    state: &SqliteBackupScheduleState,
    data: &mut LockedScheduleData,
    schedule_id: &str,
    trigger: SqliteBackupRunTrigger,
) -> Result<SqliteBackupRun, String> {
    let schedule_id = validate_identity(schedule_id, "backup schedule identity")?;
    if data
        .runs
        .iter()
        .any(|run| run.schedule_id == schedule_id && run.status.is_active())
    {
        return Err("This backup schedule is already running or queued".to_string());
    }
    let now = Utc::now();
    let schedule = data
        .schedules
        .iter()
        .find(|schedule| schedule.id == schedule_id)
        .ok_or_else(|| "The SQLite backup schedule no longer exists".to_string())?;
    if trigger == SqliteBackupRunTrigger::Scheduled && !schedule_is_due(schedule, now) {
        return Err("The SQLite backup schedule is not due".to_string());
    }
    let schedule = schedule.clone();
    let next_run = schedule_next_run(&schedule, now)?.to_rfc3339();
    let victim = if data.runs.len() >= MAX_RUNS {
        Some(
            data.runs
                .iter()
                .rposition(|run| !run.status.is_active())
                .ok_or("SQLite backup queue is full")?,
        )
    } else {
        None
    };
    if let Some(index) = victim {
        let mut ledger = ArtifactLedger::open(state, data).await?;
        ledger
            .archive_history(std::slice::from_ref(&data.runs[index]))
            .await?;
        ledger.close().await?;
    }
    let id = uuid::Uuid::new_v4().to_string();
    let path = backup_file_path(&schedule, &id, now);
    let run = SqliteBackupRun {
        id,
        schedule_id: schedule.id.clone(),
        schedule_name: schedule.name.clone(),
        project_id: schedule.project_id.clone(),
        connection_id: schedule.connection_id.clone(),
        destination_directory: schedule.destination_directory.clone(),
        compression: schedule.compression,
        trigger,
        status: SqliteBackupRunStatus::Queued,
        started_at: now.to_rfc3339(),
        completed_at: None,
        file_path: Some(path.to_string_lossy().into_owned()),
        byte_len: None,
        integrity_check: None,
        progress_percent: 0,
        error: None,
        cancel_requested: false,
    };
    // Consume this occurrence in the SAME transaction as the durable job. A
    // crash between claim and completion cannot enqueue it for a second time.
    let schedule = data
        .schedules
        .iter_mut()
        .find(|schedule| schedule.id == schedule_id)
        .expect("validated schedule");
    schedule.next_run_at = next_run;
    schedule.scheduling_error = None;
    schedule.last_run_at = Some(now.to_rfc3339());
    schedule.last_run_status = Some(SqliteBackupRunStatus::Queued);
    data.runs.insert(0, run.clone());
    if let Some(index) = victim {
        data.runs.remove(index + 1);
    }
    Ok(run)
}

pub(super) async fn enqueue_schedule(
    state: &SqliteBackupScheduleState,
    schedule_id: &str,
    trigger: SqliteBackupRunTrigger,
) -> Result<SqliteBackupRun, String> {
    let mut data = state.lock_data().await?;
    let run = enqueue(state, &mut data, schedule_id, trigger).await?;
    state.persist(&data)?;
    Ok(run)
}

pub(super) async fn enqueue_due(
    state: &SqliteBackupScheduleState,
) -> Result<Vec<SqliteBackupRun>, String> {
    let mut data = state.lock_data().await?;
    let now = Utc::now();
    let mut due = data
        .schedules
        .iter()
        .filter(|schedule| {
            schedule_is_due(schedule, now)
                && !data
                    .runs
                    .iter()
                    .any(|run| run.schedule_id == schedule.id && run.status.is_active())
        })
        .map(|schedule| (schedule.next_run_at.clone(), schedule.id.clone()))
        .collect::<Vec<_>>();
    due.sort();
    let mut queued = Vec::new();
    let mut changed = false;
    for (_, id) in due.into_iter().take(MAX_DUE_RUNS_PER_TICK) {
        let schedule = data
            .schedules
            .iter_mut()
            .find(|schedule| schedule.id == id)
            .expect("due schedule exists under the store lease");
        if let Err(error) = schedule_next_run(schedule, now) {
            schedule.enabled = false;
            schedule.scheduling_error = Some(error);
            changed = true;
            continue;
        }
        match enqueue(state, &mut data, &id, SqliteBackupRunTrigger::Scheduled).await {
            Ok(run) => queued.push(run),
            Err(error) => {
                if changed || !queued.is_empty() {
                    state.persist(&data)?;
                }
                return Err(error);
            }
        }
    }
    if changed || !queued.is_empty() {
        state.persist(&data)?;
    }
    Ok(queued)
}

pub(super) async fn cancel_run(
    state: &SqliteBackupScheduleState,
    run_id: &str,
) -> Result<bool, String> {
    let run_id = validate_identity(run_id, "backup run identity")?;
    let mut data = state.lock_data().await?;
    let Some(run) = data
        .runs
        .iter_mut()
        .find(|run| run.id == run_id && run.status.is_active())
    else {
        return Ok(false);
    };
    run.cancel_requested = true;
    let queued = run.status == SqliteBackupRunStatus::Queued;
    let schedule_id = run.schedule_id.clone();
    if queued {
        run.status = SqliteBackupRunStatus::Cancelled;
        run.file_path = None;
        run.completed_at = Some(Utc::now().to_rfc3339());
        run.error = Some("Backup cancelled before it started".to_string());
        if let Some(schedule) = data
            .schedules
            .iter_mut()
            .find(|schedule| schedule.id == schedule_id)
        {
            schedule.last_run_status = Some(SqliteBackupRunStatus::Cancelled);
        }
    }
    state.persist(&data)?;
    Ok(true)
}
