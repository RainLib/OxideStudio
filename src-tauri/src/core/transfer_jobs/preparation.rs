//! Authenticated, leased workspaces for file preparation, before job review.
mod resumable;
mod storage;
pub use resumable::{FileImportPreparationPage, FileImportPreparationSummary};
#[cfg(test)]
mod durable_tests;
#[cfg(test)]
mod tests;

use super::{runtime::LargeTransferJobs, store::JobStore};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileImportPreparationPhase {
    Copying,
    Inspecting,
    Normalizing,
    Ready,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u8,
    id: String,
    project_id: String,
    import_id: String,
    source_digest: String,
    phase: FileImportPreparationPhase,
    source_bytes: u64,
    normalized_rows: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    intent_mac: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    body: String,
    mac: String,
}

struct Workspace {
    store: JobStore,
    path: std::path::PathBuf,
    record: Mutex<Record>,
    lease: Mutex<Option<File>>,
    discard: AtomicBool,
}

/// Clones keep preparation files leased while blocking parsers/copy workers
/// finish after cancellation or an aborted async caller.
#[derive(Clone)]
pub struct FileImportPreparation(Arc<Workspace>);

impl FileImportPreparation {
    pub fn path(&self) -> &Path {
        &self.0.path
    }

    /// Observational checkpoints only. Normalization cannot yet resume here.
    pub fn checkpoint(
        &self,
        phase: FileImportPreparationPhase,
        source_bytes: u64,
        normalized_rows: u64,
    ) -> Result<()> {
        let mut record = self
            .0
            .record
            .lock()
            .map_err(|_| anyhow::anyhow!("preparation state unavailable"))?;
        if phase < record.phase
            || source_bytes < record.source_bytes
            || normalized_rows < record.normalized_rows
            || source_bytes > 512 * 1024 * 1024
        {
            bail!("invalid file preparation progress");
        }
        let mut next = record.clone();
        next.phase = phase;
        next.source_bytes = source_bytes;
        next.normalized_rows = normalized_rows;
        storage::write_record(&self.0.store, &self.0.path, &next)?;
        *record = next;
        Ok(())
    }

    pub fn source_bytes(&self) -> Result<u64> {
        Ok(self
            .0
            .record
            .lock()
            .map_err(|_| anyhow::anyhow!("preparation state unavailable"))?
            .source_bytes)
    }

    pub fn close(self) -> Result<()> {
        self.0.discard.store(true, Ordering::Release);
        let workspace = Arc::try_unwrap(self.0)
            .map_err(|_| anyhow::anyhow!("file preparation worker is still running"))?;
        workspace.cleanup()
    }
}

impl Workspace {
    fn cleanup(&self) -> Result<()> {
        let root = storage::root(&self.store)?;
        let _guard = storage::root_guard(&root)?;
        if !self.path.exists() {
            return Ok(());
        }
        storage::validate_workspace(&self.store, &root, &self.path)?;
        drop(
            self.lease
                .lock()
                .map_err(|_| anyhow::anyhow!("preparation lease unavailable"))?
                .take(),
        );
        storage::remove_workspace(&root, &self.path)
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        if !self.discard.load(Ordering::Acquire)
            && self.record.lock().map(|r| r.version == 2).unwrap_or(true)
        {
            return; // Durable preparations retain their lease-protected input.
        }
        // Failed cleanup retains the authenticated marker for startup recovery.
        if let Err(error) = self.cleanup() {
            tracing::warn!(%error, "file preparation cleanup deferred");
        }
    }
}

impl LargeTransferJobs {
    pub async fn begin_file_import_preparation(
        &self,
        project_id: &str,
        import_id: &str,
        source_digest: &str,
    ) -> Result<FileImportPreparation> {
        let record = fresh_record(project_id, import_id, source_digest)?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || storage::reserve(store, record))
            .await
            .context("file preparation worker failed")?
    }

    pub(super) async fn recover_import_preparations(&self) -> Result<()> {
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || storage::recover(&store)).await??;
        Ok(())
    }
}

fn fresh_record(project_id: &str, import_id: &str, source_digest: &str) -> Result<Record> {
    if [project_id, import_id]
        .iter()
        .any(|s| s.is_empty() || s.len() > 128 || s.chars().any(char::is_control))
        || source_digest.len() != 64
        || !source_digest
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        bail!("invalid file preparation identity");
    }
    Ok(Record {
        version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project_id.into(),
        import_id: import_id.into(),
        source_digest: source_digest.into(),
        phase: FileImportPreparationPhase::Copying,
        source_bytes: 0,
        normalized_rows: 0,
        intent_mac: None,
    })
}
