//! Small control-plane records. Callers hold store.lock while reading/writing
//! this file; it never supplies an executable to spawn or a PID to terminate.
use super::installation_control::{
    InstallationBarrier, InstallationPhase, UPDATE_PAUSED, UPDATE_RECOVERY,
};
use crate::core::private_file::replace_private_file;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};

pub(super) const WORKER_PROTOCOL: u16 = 1;
pub(super) const LEGACY_WORKER_MESSAGE: &str = "An existing backup worker cannot be upgraded automatically. Close it from the previous OxideStudio version, then reopen this version. Queued backups are kept";
pub(super) const HANDOFF_MESSAGE: &str = "Finishing the current backup before upgrading the worker. Queued backups will resume automatically";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkerImage {
    pub(super) version: String,
    pub(super) build_id: String,
    pub(super) protocol: u16,
    pub(super) executable: PathBuf,
}

impl WorkerImage {
    pub(super) fn current() -> Result<Self, String> {
        Ok(Self {
            version: env!("CARGO_PKG_VERSION").to_string(),
            build_id: env!("OXIDE_BACKUP_WORKER_BUILD_ID").to_string(),
            protocol: WORKER_PROTOCOL,
            executable: std::env::current_exe()
                .and_then(std::fs::canonicalize)
                .map_err(|_| "Cannot locate the current desktop backup worker".to_string())?,
        })
    }

    pub(super) fn same_code(&self, other: &Self) -> bool {
        self.version == other.version
            && self.build_id == other.build_id
            && self.protocol == other.protocol
    }

    fn validate(&self) -> Result<(), String> {
        if self.version.len() > 80
            || semver::Version::parse(&self.version).is_err()
            || !valid_build(&self.build_id)
            || self.protocol == 0
            || !self.executable.is_absolute()
            || self.executable.to_string_lossy().len() > 8192
        {
            return Err("Invalid backup worker identity".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkerTarget {
    pub(super) generation: u64,
    pub(super) image: WorkerImage,
    pub(super) config_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkerReceipt {
    pub(super) instance_id: String,
    pub(super) generation: u64,
    pub(super) image: WorkerImage,
    pub(super) config_dir: PathBuf,
    pub(super) started_at: String,
    pub(super) pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkerControl {
    schema_version: u16,
    pub(super) target: WorkerTarget,
    #[serde(default)]
    retired_builds: Vec<String>,
    pub(super) active: Option<WorkerReceipt>,
    pub(super) pending: Option<WorkerReceipt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) installation: Option<InstallationBarrier>,
}

fn valid_build(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(super) fn read_control(root: &Path) -> Result<Option<WorkerControl>, String> {
    let file = match File::open(root.join("worker-control.json")) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot read backup worker control state".to_string()),
    };
    if file
        .metadata()
        .map_err(|_| "Cannot inspect worker control state")?
        .len()
        > 128 * 1024
    {
        return Err("Backup worker control state exceeds its size limit".to_string());
    }
    let control: WorkerControl =
        serde_json::from_reader(std::io::BufReader::new(file)).map_err(|_| {
            "Invalid backup worker control state; restore it from a trusted copy".to_string()
        })?;
    control.validate()?;
    Ok(Some(control))
}

pub(super) fn write_control(root: &Path, control: &WorkerControl) -> Result<(), String> {
    control.validate()?;
    let bytes =
        serde_json::to_vec_pretty(control).map_err(|_| "Cannot encode worker control state")?;
    if bytes.len() > 128 * 1024 {
        return Err("Backup worker control state exceeds its size limit".to_string());
    }
    replace_private_file(
        &root.join("worker-control.json"),
        &bytes,
        "backup-worker-control",
    )
    .map_err(|_| "Cannot save backup worker control state".to_string())
}

impl WorkerControl {
    pub(super) fn new(image: WorkerImage, config_dir: PathBuf) -> Self {
        Self {
            schema_version: 1,
            target: WorkerTarget {
                generation: 1,
                image,
                config_dir,
            },
            retired_builds: Vec::new(),
            active: None,
            pending: None,
            installation: None,
        }
    }

    fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(
                "Unsupported backup worker control version; reopen the latest OxideStudio version"
                    .to_string(),
            );
        }
        self.target.image.validate()?;
        if let Some(installation) = &self.installation {
            installation.validate(&self.target.image.version)?;
            if self.target.image.protocol != installation.previous_protocol + 1 {
                return Err("Invalid application update protocol fence".to_string());
            }
        }
        if self.target.generation == 0
            || !self.target.config_dir.is_absolute()
            || self.target.config_dir.to_string_lossy().len() > 8192
            || self.retired_builds.len() > 128
            || self.retired_builds.iter().any(|id| !valid_build(id))
        {
            return Err("Invalid backup worker target".to_string());
        }
        for receipt in [&self.active, &self.pending].into_iter().flatten() {
            receipt.image.validate()?;
            if uuid::Uuid::parse_str(&receipt.instance_id).is_err()
                || receipt.generation == 0
                || receipt.generation > self.target.generation
                || !receipt.config_dir.is_absolute()
                || receipt.config_dir.to_string_lossy().len() > 8192
                || chrono::DateTime::parse_from_rfc3339(&receipt.started_at).is_err()
            {
                return Err("Invalid backup worker process receipt".to_string());
            }
        }
        Ok(())
    }

    pub(super) fn select(
        &mut self,
        image: &WorkerImage,
        config_dir: &Path,
        observed_generation: Option<u64>,
    ) -> Result<u64, String> {
        if self.installation.is_some() {
            return Err(UPDATE_PAUSED.to_string());
        }
        if self.target.config_dir != config_dir {
            return Err("The backup profile configuration directory changed; reopen with its original configuration before upgrading the worker".to_string());
        }
        if image.protocol < self.target.image.protocol {
            return Err("This backup profile requires a newer worker protocol; reopen the latest OxideStudio version".to_string());
        }
        if self.target.image.same_code(image) && self.target.config_dir == config_dir {
            // A relocated copy of identical code can update the next launch
            // location without restarting a healthy worker.
            if observed_generation.is_none() {
                self.target.image.executable = image.executable.clone();
            }
            return Ok(self.target.generation);
        }
        if observed_generation.is_some() {
            return Err("Another OxideStudio version now owns background backups; use that version to change schedules".to_string());
        }
        let current =
            semver::Version::parse(&image.version).map_err(|_| "Invalid desktop version")?;
        let selected = semver::Version::parse(&self.target.image.version)
            .map_err(|_| "Invalid selected worker version")?;
        if current < selected
            || (current == selected && self.retired_builds.contains(&image.build_id))
        {
            return Err(
                "A newer OxideStudio build owns background backups; reopen the latest version"
                    .to_string(),
            );
        }
        if current == selected && self.target.image.build_id != image.build_id {
            if self.retired_builds.len() >= 128 {
                return Err("Too many builds of the same version; update the application version before upgrading the worker".to_string());
            }
            self.retired_builds.push(self.target.image.build_id.clone());
        } else if current > selected {
            self.retired_builds.clear();
        }
        self.target = WorkerTarget {
            generation: self
                .target
                .generation
                .checked_add(1)
                .ok_or("Backup worker generation limit reached")?,
            image: image.clone(),
            config_dir: config_dir.to_path_buf(),
        };
        Ok(self.target.generation)
    }

    pub(super) fn selected(&self, image: &WorkerImage, config_dir: &Path) -> bool {
        self.installation.is_none()
            && self.target.image.same_code(image)
            && self.target.config_dir == config_dir
    }

    pub(super) fn begin_installation(
        &mut self,
        barrier: InstallationBarrier,
    ) -> Result<(), String> {
        if self.installation.is_some() {
            return Err(UPDATE_PAUSED.to_string());
        }
        barrier.validate(&self.target.image.version)?;
        if barrier.previous_protocol != self.target.image.protocol {
            return Err(
                "The backup worker protocol changed before preparing the update".to_string(),
            );
        }
        self.target.generation = self
            .target
            .generation
            .checked_add(1)
            .ok_or("Backup worker generation limit reached")?;
        self.target.image.protocol = barrier.previous_protocol + 1;
        self.installation = Some(barrier);
        Ok(())
    }

    pub(super) fn clear_installation(&mut self) -> Result<(), String> {
        self.target.generation = self
            .target
            .generation
            .checked_add(1)
            .ok_or("Backup worker generation limit reached")?;
        if let Some(barrier) = self.installation.as_ref() {
            self.target.image.protocol = barrier.previous_protocol;
        }
        self.installation = None;
        Ok(())
    }

    pub(super) fn recover_installation_on_open(
        &mut self,
        root: &Path,
        image: &WorkerImage,
    ) -> Result<(), String> {
        let Some(barrier) = self.installation.as_ref() else {
            return Ok(());
        };
        if lock_is_held(&root.join(format!("worker-instance-{}.lock", barrier.id)))? {
            return Err(UPDATE_PAUSED.to_string());
        }
        let current =
            semver::Version::parse(&image.version).map_err(|_| "Invalid application version")?;
        let target = semver::Version::parse(&barrier.target_version)
            .map_err(|_| "Invalid update version")?;
        if barrier.phase != InstallationPhase::Preparing && current < target {
            return Err(UPDATE_RECOVERY.to_string());
        }
        self.clear_installation()
    }
}

pub(super) fn lock_is_held(path: &Path) -> Result<bool, String> {
    let file = match OpenOptions::new().read(true).write(true).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("Cannot inspect the backup worker lease".to_string()),
    };
    match file.try_lock() {
        Ok(()) => Ok(false),
        Err(TryLockError::WouldBlock) => Ok(true),
        Err(_) => Err("Cannot inspect the backup worker lease".to_string()),
    }
}

pub(super) fn receipt_is_live(root: &Path, receipt: &WorkerReceipt) -> Result<bool, String> {
    if uuid::Uuid::parse_str(&receipt.instance_id).is_err() {
        return Err("Invalid backup worker instance".to_string());
    }
    lock_is_held(&root.join(format!("worker-instance-{}.lock", receipt.instance_id)))
}

pub(super) struct InstanceWitness {
    pub(super) id: String,
    pub(super) started_at: String,
    file: Option<File>,
    path: PathBuf,
}

impl InstanceWitness {
    pub(super) fn new(root: &Path) -> Result<Self, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let path = root.join(format!("worker-instance-{id}.lock"));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(&path)
            .map_err(|_| "Cannot create the worker instance lease")?;
        file.try_lock()
            .map_err(|_| "Cannot hold the worker instance lease")?;
        Ok(Self {
            id,
            started_at: chrono::Utc::now().to_rfc3339(),
            file: Some(file),
            path,
        })
    }
}

impl Drop for InstanceWitness {
    fn drop(&mut self) {
        drop(self.file.take());
        let _ = std::fs::remove_file(&self.path);
    }
}

pub(super) fn writer_allowed(
    root: &Path,
    config_dir: &Path,
    worker_instance: Option<&str>,
) -> Result<(), String> {
    // Only a leader creates this private in-memory marker. It must be able
    // to finish its current job even after the successor has been selected.
    if worker_instance.is_some() {
        return Ok(());
    }
    let running = lock_is_held(&root.join("worker.lock"))?;
    let control = read_control(root)?;
    if control
        .as_ref()
        .is_some_and(|control| control.installation.is_some())
    {
        return Err(UPDATE_PAUSED.to_string());
    }
    let image = if control.is_some() {
        Some(WorkerImage::current()?)
    } else {
        None
    };
    if control.as_ref().is_some_and(|control| {
        !control.selected(image.as_ref().expect("control image"), config_dir)
    }) {
        return Err("Background backups are switching to another OxideStudio build; use the selected version to change schedules".to_string());
    }
    if running {
        let active = control
            .as_ref()
            .and_then(|control| control.active.as_ref())
            .filter(|receipt| receipt_is_live(root, receipt).unwrap_or(false));
        let Some(active) = active else {
            return Err(LEGACY_WORKER_MESSAGE.to_string());
        };
        if active.image.protocol != WORKER_PROTOCOL || active.config_dir != config_dir {
            return Err(HANDOFF_MESSAGE.to_string());
        }
    }
    Ok(())
}

pub(super) fn claim_allowed(
    root: &Path,
    config_dir: &Path,
    worker_instance: Option<&str>,
) -> Result<bool, String> {
    let Some(instance) = worker_instance else {
        writer_allowed(root, config_dir, None)?;
        return Ok(true);
    };
    let Some(control) = read_control(root)? else {
        return Ok(false);
    };
    Ok(control.selected(&WorkerImage::current()?, config_dir)
        && control.active.as_ref().is_some_and(|receipt| {
            receipt.instance_id == instance && receipt.generation == control.target.generation
        }))
}
