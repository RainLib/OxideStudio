//! Desktop-only update barrier. The renderer keeps a short preparation lease;
//! only native code can commit it and run the signature-checked installer.
use super::autostart::{set_autostart, suspend_autostart_for_update};
use super::control::{
    lock_is_held, read_control, receipt_is_live, write_control, InstanceWitness, WorkerControl,
    WorkerImage, LEGACY_WORKER_MESSAGE,
};
use super::installation_control::{
    InstallationBarrier, InstallationPhase, UPDATE_PAUSED, UPDATE_RECOVERY,
};
use super::installation_state::InstallationSession;
use super::state::{open_lease, try_exclusive, SqliteBackupScheduleState};
use super::worker_exit::WorkerExit;
use serde::Serialize;
use std::time::{Duration, Instant};

const PREPARATION_LEASE: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreparation {
    pub token: String,
    pub ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallationStatus {
    pub installation_id: Option<String>,
    pub phase: &'static str,
    pub recovery_required: bool,
    pub message: Option<String>,
}

fn check_session(
    session: &InstallationSession,
    token: &str,
    owner: &str,
    download: &str,
) -> Result<(), String> {
    if session.witness.id != token || session.owner != owner || session.download != download {
        return Err("This update preparation belongs to another window or download".to_string());
    }
    Ok(())
}

async fn advance(
    state: &SqliteBackupScheduleState,
    session: &mut InstallationSession,
) -> Result<UpdatePreparation, String> {
    if session.committed {
        return Err("The update installer has already started".to_string());
    }
    if session.heartbeat.elapsed() >= PREPARATION_LEASE {
        return Err("Update preparation expired; try installing again".to_string());
    }
    let _data = state.lock_data().await?;
    let control = read_control(state.root())?.ok_or("Update preparation is no longer available")?;
    if control.installation.as_ref().is_none_or(|barrier| {
        barrier.id != session.witness.id || barrier.phase != InstallationPhase::Preparing
    }) {
        return Err("Update preparation changed; check its status before continuing".to_string());
    }
    if session
        .workers
        .iter()
        .map(WorkerExit::has_exited)
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .all(|exited| exited)
    {
        session.workers.clear();
        if session.starter.is_none() {
            let file = open_lease(&state.root().join("worker-start.lock"))?;
            if try_exclusive(&file)? {
                session.starter = Some(file);
            }
        }
        if session.starter.is_some() && session.leader.is_none() {
            let file = open_lease(&state.root().join("worker.lock"))?;
            if try_exclusive(&file)? {
                session.leader = Some(file);
            }
        }
        if session.starter.is_some() && session.leader.is_some() {
            let processes = WorkerExit::capture_images(&session.images)?;
            session.ready = processes.is_empty();
            session.workers.extend(processes);
        }
    }
    session.heartbeat = Instant::now();
    Ok(UpdatePreparation {
        token: session.witness.id.clone(),
        ready: session.ready,
    })
}

impl SqliteBackupScheduleState {
    /// `download` is a native resource nonce, not a renderer-supplied version.
    /// IPC resolves the signature-checked update before calling this method.
    pub async fn prepare_update(
        &self,
        target_version: &str,
        owner: &str,
        download: &str,
    ) -> Result<UpdatePreparation, String> {
        if owner.is_empty() || owner.len() > 256 || uuid::Uuid::parse_str(download).is_err() {
            return Err("Invalid update preparation owner".to_string());
        }
        let mut sessions = self.installation.lock().await;
        if let Some(session) = sessions.as_mut() {
            check_session(session, &session.witness.id, owner, download)?;
            return advance(self, session).await;
        }
        let startup = self.lock_startup().await?;
        let data = self.lock_data().await?;
        let previous = read_control(self.root())?;
        if self.worker_is_running()?
            && previous
                .as_ref()
                .and_then(|control| control.active.as_ref())
                .is_none_or(|receipt| !receipt_is_live(self.root(), receipt).unwrap_or(false))
        {
            return Err(LEGACY_WORKER_MESSAGE.to_string());
        }
        let image = WorkerImage::current()?;
        let mut control =
            previous.unwrap_or_else(|| WorkerControl::new(image.clone(), self.config_dir.clone()));
        let observed = *self
            .worker_generation
            .lock()
            .map_err(|_| "Cannot inspect backup worker generation")?;
        control.select(&image, &self.config_dir, observed)?;
        let mut workers = Vec::new();
        let mut images = vec![image.executable.clone()];
        for receipt in [&control.active, &control.pending].into_iter().flatten() {
            if receipt.config_dir != self.config_dir {
                return Err(
                    "Backup worker configuration changed; close it before installing".to_string(),
                );
            }
            if let Some(worker) = WorkerExit::capture(self.root(), receipt)? {
                workers.push(worker);
            }
            if !images.contains(&receipt.image.executable) {
                images.push(receipt.image.executable.clone());
            }
        }
        let witness = InstanceWitness::new(self.root())?;
        control.begin_installation(InstallationBarrier {
            id: witness.id.clone(),
            target_version: target_version.to_string(),
            requested_at: witness.started_at.clone(),
            phase: InstallationPhase::Preparing,
            previous_protocol: image.protocol,
        })?;
        write_control(self.root(), &control)?;
        *sessions = Some(InstallationSession {
            witness,
            owner: owner.to_string(),
            download: download.to_string(),
            heartbeat: Instant::now(),
            workers,
            images,
            ready: false,
            committed: false,
            installed: false,
            _startup: startup,
            starter: None,
            leader: None,
        });
        drop(data);
        let result = advance(self, sessions.as_mut().expect("new update session")).await;
        if result.is_err() {
            let id = sessions
                .as_ref()
                .expect("new update session")
                .witness
                .id
                .clone();
            clear_barrier(self, &id, true).await?;
            sessions.take();
        }
        result
    }

    pub async fn poll_update_preparation(
        &self,
        token: &str,
        owner: &str,
        download: &str,
    ) -> Result<UpdatePreparation, String> {
        let mut sessions = self.installation.lock().await;
        let session = sessions
            .as_mut()
            .ok_or("Update preparation expired; try installing again")?;
        check_session(session, token, owner, download)?;
        advance(self, session).await
    }

    pub async fn cancel_update_preparation(
        &self,
        token: &str,
        owner: &str,
        download: &str,
    ) -> Result<(), String> {
        let mut sessions = self.installation.lock().await;
        let session = sessions
            .as_ref()
            .ok_or("Update preparation is no longer active")?;
        check_session(session, token, owner, download)?;
        if session.committed {
            return Err(
                "The installer has started; finish or close it before resuming backups".to_string(),
            );
        }
        clear_barrier(self, token, true).await?;
        sessions.take();
        Ok(())
    }

    pub async fn update_installation_status(&self) -> Result<UpdateInstallationStatus, String> {
        let _data = self.lock_data().await?;
        let control = read_control(self.root())?;
        let Some(barrier) = control
            .as_ref()
            .and_then(|control| control.installation.as_ref())
        else {
            return Ok(UpdateInstallationStatus {
                installation_id: None,
                phase: "idle",
                recovery_required: false,
                message: None,
            });
        };
        let live = lock_is_held(
            &self
                .root()
                .join(format!("worker-instance-{}.lock", barrier.id)),
        )?;
        let recovery_required = !live && barrier.phase != InstallationPhase::Preparing;
        let installed = self.installation.try_lock().ok().is_some_and(|session| {
            session
                .as_ref()
                .is_some_and(|session| session.installed && session.witness.id == barrier.id)
        });
        Ok(UpdateInstallationStatus {
            installation_id: Some(barrier.id.clone()),
            phase: if installed {
                "restartRequired"
            } else {
                match barrier.phase {
                    InstallationPhase::Preparing => "preparing",
                    InstallationPhase::Committed => "installing",
                    InstallationPhase::Installed => "restartRequired",
                }
            },
            recovery_required,
            message: Some(
                if recovery_required {
                    UPDATE_RECOVERY
                } else {
                    UPDATE_PAUSED
                }
                .to_string(),
            ),
        })
    }

    /// Explicit recovery is offered only after the native installer owner has
    /// exited. It never races an in-flight installation or a different barrier.
    pub async fn recover_update_backups(&self, installation_id: &str) -> Result<(), String> {
        {
            let _data = self.lock_data().await?;
            if let Some(barrier) =
                read_control(self.root())?.and_then(|control| control.installation)
            {
                if barrier.id != installation_id {
                    return Err("The update changed; refresh before resuming backups".to_string());
                }
                if lock_is_held(
                    &self
                        .root()
                        .join(format!("worker-instance-{}.lock", barrier.id)),
                )? {
                    return Err(
                        "The update is still being prepared or installed in another window"
                            .to_string(),
                    );
                }
            }
        }
        let _startup = self.lock_startup().await?;
        let data = self.lock_data().await?;
        let control = read_control(self.root())?.ok_or("No update needs backup recovery")?;
        let barrier = control
            .installation
            .as_ref()
            .ok_or("No update needs backup recovery")?;
        if barrier.id != installation_id {
            return Err("The update changed; refresh before resuming backups".to_string());
        }
        if lock_is_held(
            &self
                .root()
                .join(format!("worker-instance-{}.lock", barrier.id)),
        )? {
            return Err(
                "The update is still being prepared or installed in another window".to_string(),
            );
        }
        let image = WorkerImage::current()?;
        if control.target.image.version != image.version
            || control.target.image.build_id != image.build_id
            || barrier.previous_protocol != image.protocol
            || control.target.config_dir != self.config_dir
        {
            return Err("Reopen the OxideStudio version that prepared this update, or finish installing the new version".to_string());
        }
        let enabled = data.background_enabled;
        drop(data);
        if enabled {
            set_autostart(self, true).await?;
        }
        clear_barrier(self, installation_id, false).await
    }
}

async fn clear_barrier(
    state: &SqliteBackupScheduleState,
    id: &str,
    preparing_only: bool,
) -> Result<(), String> {
    let _data = state.lock_data().await?;
    let mut control = read_control(state.root())?.ok_or("Update barrier is missing")?;
    let barrier = control
        .installation
        .as_ref()
        .ok_or("Update barrier is missing")?;
    if barrier.id != id || (preparing_only && barrier.phase != InstallationPhase::Preparing) {
        return Err("Update preparation changed; backups remain paused".to_string());
    }
    control.clear_installation()?;
    write_control(state.root(), &control)
}

pub(super) async fn maintain_preparation(
    state: &SqliteBackupScheduleState,
) -> Result<bool, String> {
    if let Ok(mut sessions) = state.installation.try_lock() {
        if let Some(session) = sessions.as_ref() {
            if !session.committed && session.heartbeat.elapsed() >= PREPARATION_LEASE {
                clear_barrier(state, &session.witness.id, true).await?;
                sessions.take();
            }
        }
    }
    let _data = state.lock_data().await?;
    let Some(control) = read_control(state.root())? else {
        return Ok(false);
    };
    let Some(barrier) = control.installation else {
        return Ok(false);
    };
    if lock_is_held(
        &state
            .root()
            .join(format!("worker-instance-{}.lock", barrier.id)),
    )? {
        return Ok(false);
    }
    let current = semver::Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|_| "Invalid application version")?;
    let target =
        semver::Version::parse(&barrier.target_version).map_err(|_| "Invalid update version")?;
    Ok(barrier.phase == InstallationPhase::Preparing || current >= target)
}

/// Privileged native entry point. The installer closure is supplied by Rust;
/// renderer IPC accepts only a signature-checked DownloadedUpdate resource.
pub async fn install_prepared<F>(
    state: &SqliteBackupScheduleState,
    token: &str,
    owner: &str,
    download: &str,
    installer: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
{
    install_with_startup(
        state,
        token,
        owner,
        download,
        installer,
        |enabled| async move {
            if enabled {
                set_autostart(state, true).await
            } else {
                suspend_autostart_for_update(state).await
            }
        },
    )
    .await
}

pub(super) async fn install_with_startup<F, A, Fut>(
    state: &SqliteBackupScheduleState,
    token: &str,
    owner: &str,
    download: &str,
    installer: F,
    startup: A,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
    A: Fn(bool) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let mut sessions = state.installation.lock().await;
    let session = sessions.as_mut().ok_or("Update preparation expired")?;
    check_session(session, token, owner, download)?;
    if session.committed {
        return Err(
            "The update installer has already started; restart the application when it finishes"
                .to_string(),
        );
    }
    match advance(state, session).await {
        Ok(prepared) if prepared.ready => {}
        result => {
            let error = match result { Ok(_) => "Wait for the current backup or other application instance to finish, then try installing again".to_string(), Err(error) => error };
            let cleared = clear_barrier(state, token, true).await;
            sessions.take();
            return Err(match cleared {
                Ok(()) => format!("{error}. Backup scheduling has resumed"),
                Err(recovery) => format!("{error}. Backups remain paused: {recovery}"),
            });
        }
    }
    let enabled = {
        let data = state.lock_data().await?;
        let mut control = read_control(state.root())?.ok_or("Update preparation is missing")?;
        let barrier = control
            .installation
            .as_mut()
            .ok_or("Update preparation is missing")?;
        if barrier.id != token || barrier.phase != InstallationPhase::Preparing {
            return Err(UPDATE_PAUSED.to_string());
        }
        barrier.phase = InstallationPhase::Committed;
        write_control(state.root(), &control)?;
        session.committed = true;
        data.background_enabled
    };
    let install_result = async {
        if enabled {
            startup(false).await?;
        }
        tokio::task::spawn_blocking(installer)
            .await
            .map_err(|_| "The native update installer stopped unexpectedly".to_string())?
    }
    .await;
    if let Err(error) = install_result {
        let restored = if enabled { startup(true).await } else { Ok(()) };
        let recovery = match restored {
            Ok(()) => clear_barrier(state, token, false).await,
            Err(error) => Err(error),
        };
        sessions.take();
        return Err(match recovery {
            Ok(()) => format!("{error}. Backup scheduling has resumed"),
            Err(recovery) => format!("{error}. Backups remain paused: {recovery}. Close the installer, then use Resume backups"),
        });
    }
    // Keep the durable barrier and both worker leases until the process exits.
    // A failed relaunch must never resume the old binary after a successful install.
    session.installed = true;
    let recorded: Result<(), String> = async {
        let _data = state.lock_data().await?;
        let mut control = read_control(state.root())?
            .ok_or("Installed update barrier is missing; restart the app")?;
        if let Some(barrier) = control
            .installation
            .as_mut()
            .filter(|barrier| barrier.id == token)
        {
            barrier.phase = InstallationPhase::Installed;
            write_control(state.root(), &control)?;
        }
        Ok(())
    }
    .await;
    if let Err(error) = recorded {
        tracing::warn!(%error, "Update installed; restart to resume backups");
    }
    Ok(())
}
