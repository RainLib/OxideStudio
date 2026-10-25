//! Ephemeral, project/window-owned file sessions. No saved connections or
//! public Agent tools are created by this service.
mod runtime;
mod storage;
#[cfg(test)]
mod tests;

use crate::core::{
    driver_package::DatabaseDriverPackageRegistry, driver_sidecar::DatabaseDriverSidecar,
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

const MAX_SESSIONS: usize = 4;
const MAX_SOURCE_BYTES: u64 = 1024 * 1024 * 1024;
const OPEN_TIMEOUT: Duration = Duration::from_secs(60);
const QUERY_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CsvHeader {
    #[default]
    Auto,
    Present,
    Absent,
}
impl CsvHeader {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Present => "present",
            Self::Absent => "absent",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FileQueryOwner {
    pub project_id: String,
    pub window: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileQuerySession {
    pub id: String,
    pub project_id: String,
    pub file_name: String,
    pub format: String,
    pub source_bytes: u64,
    pub driver_id: String,
    pub package_version: String,
    pub initial_sql: String,
    pub language_id: String,
    pub capabilities: crate::core::dialect::DatabaseCapabilities,
    pub csv_header: CsvHeader,
}

pub(crate) struct AuthorizedFile {
    path: PathBuf,
    format: String,
    bytes: u64,
    project_root: Option<PathBuf>,
    csv_header: CsvHeader,
}

impl AuthorizedFile {
    /// Call only after native picker selection or project-root resolution.
    pub(crate) fn new(path: &Path) -> Result<Self> {
        let path = path
            .canonicalize()
            .context("selected file is unavailable")?;
        let metadata = path.metadata()?;
        if !metadata.is_file() || metadata.len() > MAX_SOURCE_BYTES {
            bail!("file queries require a regular file of at most 1 GiB");
        }
        let format = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(format.as_str(), "csv" | "json" | "jsonl" | "parquet") {
            bail!("select a CSV, JSON, JSONL or Parquet file");
        }
        path.to_str().context("file-query paths must be UTF-8")?;
        Ok(Self {
            path,
            format,
            bytes: metadata.len(),
            project_root: None,
            csv_header: CsvHeader::Auto,
        })
    }

    pub(crate) fn for_project(path: &Path, root: &Path) -> Result<Self> {
        let mut file = Self::new(path)?;
        let root = root.canonicalize()?;
        if !file.path.starts_with(&root) {
            bail!("file query is outside this project root");
        }
        file.project_root = Some(root);
        Ok(file)
    }

    pub(crate) fn with_csv_header(mut self, header: CsvHeader) -> Self {
        self.csv_header = header;
        self
    }
}

struct Entry {
    owner: FileQueryOwner,
    descriptor: FileQuerySession,
    workspace: PathBuf,
    process: Mutex<Option<Arc<DatabaseDriverSidecar>>>,
    operation: AsyncMutex<()>,
    closed: AtomicBool,
    cancelled: Arc<AtomicBool>,
    touched_at: AtomicU64,
    project_root: Option<PathBuf>,
}

struct Shared {
    entries: Mutex<HashMap<String, Arc<Entry>>>,
    epochs: Mutex<HashMap<FileQueryOwner, Arc<AtomicU64>>>,
    pending: Mutex<HashMap<(FileQueryOwner, String), PendingOpen>>,
    registry: DatabaseDriverPackageRegistry,
    storage: storage::Storage,
}

#[derive(Clone)]
pub struct FileQuerySessions(Arc<Shared>);

pub(crate) struct OpenTicket {
    owner: FileQueryOwner,
    epoch: Arc<AtomicU64>,
    generation: u64,
    id: String,
    cancelled: Arc<AtomicBool>,
    service: std::sync::Weak<Shared>,
}

struct PendingOpen {
    cancelled: Arc<AtomicBool>,
    created_at: u64,
}
impl Drop for OpenTicket {
    fn drop(&mut self) {
        if let Some(service) = self.service.upgrade() {
            if let Ok(mut pending) = service.pending.lock() {
                pending.remove(&(self.owner.clone(), self.id.clone()));
            }
        }
    }
}

impl FileQuerySessions {
    pub fn new(root: &Path, registry: DatabaseDriverPackageRegistry) -> Result<Self> {
        let service = Self(Arc::new(Shared {
            entries: Mutex::new(HashMap::new()),
            epochs: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            registry,
            storage: storage::Storage::open(root)?,
        }));
        let weak = Arc::downgrade(&service.0);
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    let Some(shared) = weak.upgrade() else {
                        break;
                    };
                    let service = FileQuerySessions(shared);
                    if let Ok(mut pending) = service.0.pending.lock() {
                        pending.retain(|_, item| {
                            Arc::strong_count(&item.cancelled) > 1
                                || now().saturating_sub(item.created_at) < 120
                        });
                    }
                    let candidates = service
                        .0
                        .entries
                        .lock()
                        .map(|entries| {
                            entries
                                .iter()
                                .filter(|(_, entry)| {
                                    entry.closed.load(Ordering::Acquire)
                                        || entry.cancelled.load(Ordering::Acquire)
                                        || now().saturating_sub(
                                            entry.touched_at.load(Ordering::Acquire),
                                        ) > 15 * 60
                                })
                                .map(|(id, entry)| (entry.owner.clone(), id.clone()))
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    for (owner, id) in candidates {
                        let _ = service.close(&owner, &id).await;
                    }
                }
            });
        }
        Ok(service)
    }

    pub(crate) async fn open(
        &self,
        ticket: OpenTicket,
        file: AuthorizedFile,
        driver_id: &str,
        version: Option<&str>,
    ) -> Result<FileQuerySession> {
        let owner = ticket.owner.clone();
        if owner.project_id.is_empty() || owner.window.is_empty() {
            bail!("file-query owner is required");
        }
        // Revalidate signature/digest/version before reserving disk or sending
        // source paths. An inactive package is usable only with an explicit pin.
        let package = match version {
            Some(version) => self.0.registry.resolve_version(driver_id, version),
            None => self.0.registry.resolve_active(driver_id),
        }
        .map_err(anyhow::Error::msg)?;
        if !package
            .manifest
            .capabilities
            .as_ref()
            .is_some_and(|caps| caps.file_query_formats.contains(&file.format))
        {
            bail!("selected signed driver package does not authorize this file format");
        }
        let id = ticket.id.clone();
        let descriptor = FileQuerySession {
            id: id.clone(),
            project_id: owner.project_id.clone(),
            file_name: file
                .path
                .file_name()
                .and_then(|name| name.to_str())
                .context("invalid file name")?
                .into(),
            format: file.format.clone(),
            source_bytes: file.bytes,
            driver_id: package.manifest.driver_id.clone(),
            package_version: package.manifest.package_version.clone(),
            initial_sql: "SELECT * FROM data LIMIT 1000;".into(),
            language_id: package
                .manifest
                .capabilities
                .as_ref()
                .context("missing file-query capabilities")?
                .lsp_language_id
                .clone(),
            csv_header: file.csv_header,
            capabilities: package
                .manifest
                .capabilities
                .clone()
                .context("missing file-query capabilities")?,
        };
        let entry = {
            let mut entries = self
                .0
                .entries
                .lock()
                .map_err(|_| anyhow::anyhow!("file-query service is unavailable"))?;
            if ticket.epoch.load(Ordering::Acquire) != ticket.generation
                || ticket.cancelled.load(Ordering::Acquire)
            {
                bail!("file-query open was cancelled when its project/window closed");
            }
            // Reserve the full 1 GiB allowance, including pending opens and
            // failed cleanup. Four slots bound this Host's snapshots to 4 GiB.
            if entries.len() >= MAX_SESSIONS {
                bail!("close a file-query tab before opening another (4-session / 4 GiB budget)");
            }
            let workspace = self.0.storage.reserve(&id)?;
            let entry = Arc::new(Entry {
                owner: owner.clone(),
                descriptor: descriptor.clone(),
                workspace,
                process: Mutex::new(None),
                operation: AsyncMutex::new(()),
                closed: AtomicBool::new(false),
                cancelled: ticket.cancelled.clone(),
                touched_at: AtomicU64::new(now()),
                project_root: file.project_root.clone(),
            });
            entries.insert(id.clone(), entry.clone());
            entry
        };
        let mut abandoned = AbandonedOperation::new(self.clone(), owner.clone(), id.clone());
        let operation = entry.operation.lock().await;
        let result = tokio::time::timeout(OPEN_TIMEOUT, self.connect(&entry, &file, &package))
            .await
            .map_err(|_| {
                anyhow::anyhow!("file-query preparation timed out; its session was closed")
            })
            .and_then(|result| result);
        drop(operation);
        if result.is_err() {
            self.close(&owner, &id).await?;
        }
        abandoned.armed = false;
        result?;
        Ok(descriptor)
    }

    pub async fn close(&self, owner: &FileQueryOwner, id: &str) -> Result<()> {
        let Some(entry) = self.find(owner, id)? else {
            return Ok(());
        };
        entry.closed.store(true, Ordering::Release);
        let process = entry
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("file-query process state is unavailable"))?
            .clone();
        if let Some(process) = process {
            process.terminate().await;
        }
        let _operation = entry.operation.lock().await;
        // Opening may have been between spawn and process publication when
        // close began. The operation has now stopped touching the workspace.
        let process = entry
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("file-query process state is unavailable"))?
            .take();
        if let Some(process) = process {
            process.terminate().await;
        }
        self.0.storage.remove(&entry.workspace)?;
        self.0
            .entries
            .lock()
            .map_err(|_| anyhow::anyhow!("file-query service is unavailable"))?
            .remove(id);
        Ok(())
    }

    pub async fn close_owner(&self, owner: &FileQueryOwner) -> Result<()> {
        self.epoch(owner)?.fetch_add(1, Ordering::AcqRel);
        let ids = self
            .0
            .entries
            .lock()
            .map_err(|_| anyhow::anyhow!("file-query service is unavailable"))?
            .iter()
            .filter(|(_, entry)| &entry.owner == owner)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in ids {
            self.close(owner, &id).await?;
        }
        Ok(())
    }

    pub async fn close_window(&self, window: &str) -> Result<()> {
        let owners = self
            .0
            .epochs
            .lock()
            .map_err(|_| anyhow::anyhow!("file-query service is unavailable"))?
            .keys()
            .filter(|owner| owner.window == window)
            .cloned()
            .collect::<Vec<_>>();
        for owner in owners {
            self.close_owner(&owner).await?;
        }
        Ok(())
    }

    pub(crate) fn begin_open(&self, owner: FileQueryOwner) -> Result<OpenTicket> {
        self.begin_open_request(owner, &Uuid::new_v4().to_string())
    }

    pub(crate) fn begin_open_request(&self, owner: FileQueryOwner, id: &str) -> Result<OpenTicket> {
        Uuid::parse_str(id)?;
        let epoch = self.epoch(&owner)?;
        let generation = epoch.load(Ordering::Acquire);
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut pending = self
                .0
                .pending
                .lock()
                .map_err(|_| anyhow::anyhow!("file-query service is unavailable"))?;
            if pending.contains_key(&(owner.clone(), id.into())) {
                bail!("file-query opening was cancelled or its request id is already in use");
            }
            pending.insert(
                (owner.clone(), id.into()),
                PendingOpen {
                    cancelled: cancelled.clone(),
                    created_at: now(),
                },
            );
        }
        Ok(OpenTicket {
            owner,
            epoch,
            generation,
            id: id.into(),
            cancelled,
            service: Arc::downgrade(&self.0),
        })
    }

    pub async fn cancel_open(&self, owner: &FileQueryOwner, id: &str) -> Result<()> {
        Uuid::parse_str(id)?;
        {
            let mut pending = self
                .0
                .pending
                .lock()
                .map_err(|_| anyhow::anyhow!("file-query service is unavailable"))?;
            pending
                .entry((owner.clone(), id.into()))
                .or_insert_with(|| PendingOpen {
                    cancelled: Arc::new(AtomicBool::new(false)),
                    created_at: now(),
                })
                .cancelled
                .store(true, Ordering::Release);
        }
        self.close(owner, id).await
    }

    fn epoch(&self, owner: &FileQueryOwner) -> Result<Arc<AtomicU64>> {
        Ok(self
            .0
            .epochs
            .lock()
            .map_err(|_| anyhow::anyhow!("file-query service is unavailable"))?
            .entry(owner.clone())
            .or_insert_with(|| Arc::new(AtomicU64::new(0)))
            .clone())
    }

    pub(crate) fn project_root(&self, owner: &FileQueryOwner, id: &str) -> Result<Option<PathBuf>> {
        Ok(self
            .find(owner, id)?
            .context("file-query session has ended")?
            .project_root
            .clone())
    }

    pub fn list(&self, owner: &FileQueryOwner) -> Result<Vec<FileQuerySession>> {
        Ok(self
            .0
            .entries
            .lock()
            .map_err(|_| anyhow::anyhow!("file-query service is unavailable"))?
            .values()
            .filter(|entry| &entry.owner == owner && !entry.closed.load(Ordering::Acquire))
            .map(|entry| entry.descriptor.clone())
            .collect())
    }

    fn find(&self, owner: &FileQueryOwner, id: &str) -> Result<Option<Arc<Entry>>> {
        let entry = self
            .0
            .entries
            .lock()
            .map_err(|_| anyhow::anyhow!("file-query service is unavailable"))?
            .get(id)
            .cloned();
        if entry.as_ref().is_some_and(|entry| &entry.owner != owner) {
            bail!("file-query session is outside this project/window");
        }
        Ok(entry)
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Dropping a Tauri request must not abandon an executing native query. The
/// cleanup task owns the service until termination and cleanup are attempted.
struct AbandonedOperation {
    service: FileQuerySessions,
    owner: FileQueryOwner,
    id: String,
    armed: bool,
}
impl AbandonedOperation {
    fn new(service: FileQuerySessions, owner: FileQueryOwner, id: String) -> Self {
        Self {
            service,
            owner,
            id,
            armed: true,
        }
    }
}
impl Drop for AbandonedOperation {
    fn drop(&mut self) {
        if self.armed {
            let (service, owner, id) = (self.service.clone(), self.owner.clone(), self.id.clone());
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move {
                    let _ = service.close(&owner, &id).await;
                });
            }
        }
    }
}
