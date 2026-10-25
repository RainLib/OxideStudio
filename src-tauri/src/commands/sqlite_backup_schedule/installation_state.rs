use super::control::InstanceWitness;
use super::worker_exit::WorkerExit;
use std::fs::File;
use std::time::Instant;

pub(super) struct InstallationSession {
    pub(super) witness: InstanceWitness,
    pub(super) owner: String,
    pub(super) download: String,
    pub(super) heartbeat: Instant,
    pub(super) workers: Vec<WorkerExit>,
    pub(super) images: Vec<std::path::PathBuf>,
    pub(super) ready: bool,
    pub(super) committed: bool,
    pub(super) installed: bool,
    pub(super) _startup: File,
    pub(super) starter: Option<File>,
    pub(super) leader: Option<File>,
}
