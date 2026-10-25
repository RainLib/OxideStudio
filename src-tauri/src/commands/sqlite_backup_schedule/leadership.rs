use super::control::{
    claim_allowed, lock_is_held, read_control, receipt_is_live, write_control, InstanceWitness,
    WorkerControl, WorkerImage, WorkerReceipt, HANDOFF_MESSAGE, LEGACY_WORKER_MESSAGE,
};
use super::installation_control::{InstallationPhase, UPDATE_PAUSED, UPDATE_RECOVERY};
use super::models::SqliteBackupWorkerStatus;
use super::state::{open_lease, try_exclusive, SqliteBackupScheduleState};
use std::fs::File;
use std::time::Duration;

pub(super) async fn register_desktop(state: &SqliteBackupScheduleState) -> Result<(), String> {
    let _startup = state.lock_startup().await?;
    let image = WorkerImage::current()?;
    let observed = *state
        .worker_generation
        .lock()
        .map_err(|_| "Cannot inspect desktop worker generation")?;
    let _data = state.lock_data().await?;
    let previous = read_control(state.root())?;
    if state.worker_is_running()?
        && previous
            .as_ref()
            .and_then(|control| control.active.as_ref())
            .is_none_or(|receipt| !receipt_is_live(state.root(), receipt).unwrap_or(false))
    {
        return Err(LEGACY_WORKER_MESSAGE.to_string());
    }
    let mut control = previous
        .clone()
        .unwrap_or_else(|| WorkerControl::new(image.clone(), state.config_dir.clone()));
    control.recover_installation_on_open(state.root(), &image)?;
    let generation = control.select(&image, &state.config_dir, observed)?;
    if previous.as_ref() != Some(&control) {
        write_control(state.root(), &control)?;
    }
    *state
        .worker_generation
        .lock()
        .map_err(|_| "Cannot save desktop worker generation")? = Some(generation);
    Ok(())
}

pub(super) struct LeaderSession {
    state: SqliteBackupScheduleState,
    witness: InstanceWitness,
    _leader: File,
}

impl Drop for LeaderSession {
    fn drop(&mut self) {
        if let Ok(mut instance) = self.state.worker_instance.lock() {
            if instance.as_deref() == Some(&self.witness.id) {
                *instance = None;
            }
        }
    }
}

pub(super) async fn enter_worker(
    state: &SqliteBackupScheduleState,
    once: bool,
    activate: bool,
) -> Result<Option<LeaderSession>, String> {
    let paused = {
        let _data = state.lock_data().await?;
        read_control(state.root())?.is_some_and(|control| control.installation.is_some())
    };
    if paused {
        if !activate {
            return Ok(None);
        }
        register_desktop(state).await?;
    }
    let starter = open_lease(&state.root().join("worker-start.lock"))?;
    if !try_exclusive(&starter)? {
        return Ok(None);
    }
    let image = WorkerImage::current()?;
    let leader = open_lease(&state.root().join("worker.lock"))?;
    let mut witness = None;
    loop {
        let startup = if activate {
            Some(state.lock_startup().await?)
        } else {
            None
        };
        let data = state.lock_data().await?;
        if !data.background_enabled && !state.desktop_is_open()? {
            return Ok(None);
        }
        let previous = read_control(state.root())?;
        let running = state.worker_is_running()?;
        let active = previous
            .as_ref()
            .and_then(|control| control.active.as_ref());
        if running
            && active.is_none_or(|receipt| !receipt_is_live(state.root(), receipt).unwrap_or(false))
        {
            return if once && !activate {
                Ok(None)
            } else {
                Err(LEGACY_WORKER_MESSAGE.to_string())
            };
        }
        let mut control = previous
            .clone()
            .unwrap_or_else(|| WorkerControl::new(image.clone(), state.config_dir.clone()));
        if control.installation.is_some() {
            return Ok(None);
        }
        if activate {
            // A worker may explicitly activate its OWN executable, never a
            // path supplied by the control file. This is also the logon path.
            let observed = *state
                .worker_generation
                .lock()
                .map_err(|_| "Cannot inspect worker generation")?;
            if observed.is_some() && !control.selected(&image, &state.config_dir) {
                return Ok(None);
            }
            let generation = control.select(&image, &state.config_dir, observed)?;
            *state
                .worker_generation
                .lock()
                .map_err(|_| "Cannot save worker generation")? = Some(generation);
        } else if !control.selected(&image, &state.config_dir) {
            return Ok(None);
        }
        if running
            && control.active.as_ref().is_some_and(|receipt| {
                receipt.image.same_code(&image) && receipt.config_dir == state.config_dir
            })
        {
            if previous.as_ref() != Some(&control) {
                write_control(state.root(), &control)?;
            }
            return Ok(None);
        }
        let current = match witness.take() {
            Some(witness) => witness,
            None => InstanceWitness::new(state.root())?,
        };
        let receipt = WorkerReceipt {
            instance_id: current.id.clone(),
            generation: control.target.generation,
            image: image.clone(),
            config_dir: state.config_dir.clone(),
            started_at: current.started_at.clone(),
            pid: std::process::id(),
        };
        if try_exclusive(&leader)? {
            control.active = Some(receipt);
            control.pending = None;
            write_control(state.root(), &control)?;
            *state
                .worker_instance
                .lock()
                .map_err(|_| "Cannot hold worker ownership")? = Some(current.id.clone());
            return Ok(Some(LeaderSession {
                state: state.clone(),
                witness: current,
                _leader: leader,
            }));
        }
        if once && !activate {
            return Ok(None);
        }
        control.pending = Some(receipt);
        if previous.as_ref() != Some(&control) {
            write_control(state.root(), &control)?;
        }
        witness = Some(current);
        drop(data);
        drop(startup);
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

pub(super) async fn still_selected(state: &SqliteBackupScheduleState) -> Result<bool, String> {
    let _data = state.lock_data().await?;
    let instance = state
        .worker_instance
        .lock()
        .map_err(|_| "Cannot inspect worker ownership")?;
    claim_allowed(state.root(), &state.config_dir, instance.as_deref())
}

pub(super) async fn status(
    state: &SqliteBackupScheduleState,
) -> Result<SqliteBackupWorkerStatus, String> {
    let data = state.lock_data().await?;
    let running = state.worker_is_running()?;
    let mut status = SqliteBackupWorkerStatus {
        background_enabled: data.background_enabled,
        running,
        upgrading: false,
        message: None,
    };
    let control = match read_control(state.root()) {
        Ok(control) => control,
        Err(error) => {
            status.message = Some(error);
            return Ok(status);
        }
    };
    let active = control.as_ref().and_then(|control| control.active.as_ref());
    if let Some(barrier) = control
        .as_ref()
        .and_then(|control| control.installation.as_ref())
    {
        let live = lock_is_held(
            &state
                .root()
                .join(format!("worker-instance-{}.lock", barrier.id)),
        )?;
        status.running =
            active.is_some_and(|receipt| receipt_is_live(state.root(), receipt).unwrap_or(false));
        status.upgrading = true;
        status.message = Some(
            if !live && barrier.phase != InstallationPhase::Preparing {
                UPDATE_RECOVERY
            } else {
                UPDATE_PAUSED
            }
            .to_string(),
        );
        return Ok(status);
    }
    if running
        && active.is_none_or(|receipt| !receipt_is_live(state.root(), receipt).unwrap_or(false))
    {
        status.message = Some(LEGACY_WORKER_MESSAGE.to_string());
        return Ok(status);
    }
    if let Some(control) = control {
        let current = WorkerImage::current()?;
        if !control.selected(&current, &state.config_dir) {
            status.message = Some("Another OxideStudio build owns background backups. Reopen the selected version to change schedules".to_string());
        } else if running
            && control
                .active
                .as_ref()
                .is_some_and(|receipt| !receipt.image.same_code(&current))
        {
            status.upgrading = true;
            status.message = Some(HANDOFF_MESSAGE.to_string());
        } else if !running
            && control
                .pending
                .as_ref()
                .is_some_and(|receipt| receipt_is_live(state.root(), receipt).unwrap_or(false))
        {
            status.upgrading = true;
            status.message =
                Some("Starting the updated backup worker. Queued backups are kept".to_string());
        }
    }
    Ok(status)
}

pub(super) async fn ready_or_pending(state: &SqliteBackupScheduleState) -> Result<bool, String> {
    let _data = state.lock_data().await?;
    let Some(control) = read_control(state.root())? else {
        return Ok(false);
    };
    let image = WorkerImage::current()?;
    if !control.selected(&image, &state.config_dir) {
        return Ok(false);
    }
    for receipt in [&control.active, &control.pending].into_iter().flatten() {
        if receipt.image.same_code(&image)
            && receipt.config_dir == state.config_dir
            && receipt.generation == control.target.generation
            && receipt_is_live(state.root(), receipt)?
        {
            if control
                .active
                .as_ref()
                .is_some_and(|active| active.instance_id == receipt.instance_id)
            {
                if lock_is_held(&state.root().join("worker.lock"))? {
                    return Ok(true);
                }
            } else {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
