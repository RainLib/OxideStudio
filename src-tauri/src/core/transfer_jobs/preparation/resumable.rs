use super::{
    storage, Envelope, FileImportPreparation, FileImportPreparationPhase, Record, Workspace,
};
use crate::core::{
    private_file::create_private_file,
    transfer_jobs::{runtime::LargeTransferJobs, store::JobStore},
};
use anyhow::{bail, Context, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Read,
    path::Path,
    sync::{atomic::AtomicBool, Arc, Mutex},
};

const PURPOSE: &str = "file-import-preparation-intent-v1";
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Intent {
    id: String,
    project_id: String,
    value: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileImportPreparationSummary {
    pub id: String,
    pub import_id: String,
    pub phase: FileImportPreparationPhase,
    pub source_bytes: u64,
    pub normalized_rows: u64,
    pub active: bool,
    pub display: Option<FileImportPreparationDisplay>,
}
/// Projected only from the authenticated intent. Never includes a source path.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileImportPreparationDisplay {
    file_name: String,
    format: String,
    connection_id: String,
    schema: String,
    table: String,
    mode: String,
}
fn display_intent(intent: &Value) -> Option<FileImportPreparationDisplay> {
    let request = intent.get("request")?;
    let string = |key| request.get(key)?.as_str().map(str::to_string);
    let format = string("format")?;
    let mode = string("mode")?;
    if !["csv", "json", "xlsx"].contains(&format.as_str())
        || !["append", "truncate"].contains(&mode.as_str())
    {
        return None;
    }
    Some(FileImportPreparationDisplay {
        file_name: string("filePath")?.rsplit(['/', '\\']).next()?.to_string(),
        format,
        connection_id: string("connectionId")?,
        schema: string("schema")?,
        table: string("table")?,
        mode,
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileImportPreparationPage {
    pub preparations: Vec<FileImportPreparationSummary>,
    pub next_cursor: Option<String>,
}

pub(super) fn write_intent(
    store: &JobStore,
    path: &Path,
    record: &Record,
    value: Value,
) -> Result<String> {
    let (body, mac) = store.encode(
        PURPOSE,
        &Intent {
            id: record.id.clone(),
            project_id: record.project_id.clone(),
            value,
        },
    )?;
    let bytes = serde_json::to_vec(&Envelope {
        body,
        mac: mac.clone(),
    })?;
    if bytes.len() > 1024 * 1024 {
        bail!("preparation intent exceeds budget");
    }
    create_private_file(&path.join("intent.json"), &bytes)?;
    Ok(mac)
}
pub(super) fn read_intent(store: &JobStore, path: &Path, record: &Record) -> Result<Value> {
    let intent = path.join("intent.json");
    storage::reject_link(&intent)?;
    if !fs::metadata(&intent)?.is_file() {
        bail!("invalid preparation intent");
    }
    let mut bytes = Vec::new();
    File::open(intent)?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 1024 * 1024 {
        bail!("preparation intent exceeds budget");
    }
    let envelope: Envelope = serde_json::from_slice(&bytes)?;
    let intent: Intent = store.decode(PURPOSE, &envelope.body, &envelope.mac)?;
    if record.intent_mac.as_ref() != Some(&envelope.mac)
        || intent.id != record.id
        || intent.project_id != record.project_id
    {
        bail!("preparation intent identity changed");
    }
    Ok(intent.value)
}

impl FileImportPreparation {
    pub(in crate::core::transfer_jobs) fn handoff_link(
        &self,
        store: &JobStore,
    ) -> Result<crate::core::transfer_jobs::models::FilePreparationLink> {
        if self.0.store.root != store.root {
            bail!("preparation belongs to another task store");
        }
        let record = self
            .0
            .record
            .lock()
            .map_err(|_| anyhow::anyhow!("preparation state unavailable"))?;
        if record.version != 2 {
            bail!("preparation is not durable");
        }
        Ok(crate::core::transfer_jobs::models::FilePreparationLink {
            id: record.id.clone(),
            intent_mac: record
                .intent_mac
                .clone()
                .context("preparation definition is missing")?,
        })
    }

    pub(in crate::core::transfer_jobs) fn require_project(&self, project: &str) -> Result<()> {
        if self
            .0
            .record
            .lock()
            .map_err(|_| anyhow::anyhow!("preparation state unavailable"))?
            .project_id
            != project
        {
            bail!("preparation is outside this project");
        }
        Ok(())
    }
    pub fn require_source_digest(&self, expected: &str) -> Result<()> {
        if self
            .0
            .record
            .lock()
            .map_err(|_| anyhow::anyhow!("preparation state unavailable"))?
            .source_digest
            != expected
        {
            bail!("preparation source identity changed");
        }
        Ok(())
    }
    pub fn progress(&self) -> Result<FileImportPreparationSummary> {
        let record = self
            .0
            .record
            .lock()
            .map_err(|_| anyhow::anyhow!("preparation state unavailable"))?;
        Ok(FileImportPreparationSummary {
            id: record.id.clone(),
            import_id: record.import_id.clone(),
            phase: record.phase,
            source_bytes: record.source_bytes,
            normalized_rows: record.normalized_rows,
            active: true,
            display: None,
        })
    }
    pub fn intent(&self) -> Result<Option<Value>> {
        let record = self
            .0
            .record
            .lock()
            .map_err(|_| anyhow::anyhow!("preparation state unavailable"))?;
        if record.version == 1 {
            return Ok(None);
        }
        Ok(Some(read_intent(&self.0.store, &self.0.path, &record)?))
    }
    pub fn seal_checkpoint<T: Serialize>(&self, value: &T) -> Result<(String, String)> {
        let id = self.progress()?.id;
        self.0.store.encode(
            &format!("file-import-preparation-checkpoint-v1:{id}"),
            value,
        )
    }
    pub fn open_checkpoint<T: Serialize + DeserializeOwned>(
        &self,
        body: &str,
        mac: &str,
    ) -> Result<T> {
        let id = self.progress()?.id;
        self.0.store.decode(
            &format!("file-import-preparation-checkpoint-v1:{id}"),
            body,
            mac,
        )
    }
}

impl LargeTransferJobs {
    pub(in crate::core::transfer_jobs) async fn retire_file_preparation(
        &self,
        project: &str,
        link: &crate::core::transfer_jobs::models::FilePreparationLink,
    ) -> Result<()> {
        let store = self.store.clone();
        let project = project.to_string();
        let link = link.clone();
        tokio::task::spawn_blocking(move || {
            let root = storage::root(&store)?;
            let _guard = storage::root_guard(&root)?;
            let path = root.join(format!("prep-{}", link.id));
            if !path.exists() {
                return Ok(());
            }
            let record = storage::validate_workspace(&store, &root, &path)?;
            if record.version != 2
                || record.id != link.id
                || record.project_id != project
                || record.intent_mac.as_ref() != Some(&link.intent_mac)
            {
                bail!("retired preparation ownership changed");
            }
            let owner = path.join("owner.lock");
            let lease = if owner.exists() {
                let file = OpenOptions::new().read(true).write(true).open(owner)?;
                if file.try_lock().is_err() {
                    return Ok(());
                }
                Some(file)
            } else {
                if fs::read_dir(&path)?.any(|e| e.is_ok_and(|e| e.file_name() != "owner.json")) {
                    bail!("retired preparation lease is missing while data remains");
                }
                None
            };
            drop(lease);
            storage::remove_workspace(&root, &path)
        })
        .await?
    }
    pub async fn begin_resumable_file_import_preparation(
        &self,
        project: &str,
        import: &str,
        digest: &str,
        intent: Value,
    ) -> Result<FileImportPreparation> {
        let record = super::fresh_record(project, import, digest)?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            storage::reserve_with_intent(store, record, Some(intent))
        })
        .await?
    }

    pub async fn resume_file_import_preparation(
        &self,
        project: &str,
        id: &str,
    ) -> Result<FileImportPreparation> {
        if uuid::Uuid::parse_str(id)?.to_string() != id {
            bail!("invalid preparation id");
        }
        let project = project.to_string();
        let id = id.to_string();
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let root = storage::root(&store)?;
            let _guard = storage::root_guard(&root)?;
            let path = root.join(format!("prep-{id}"));
            let record = storage::validate_workspace(&store, &root, &path)?;
            if record.version != 2 || record.project_id != project {
                bail!("preparation is outside this project or not resumable");
            }
            read_intent(&store, &path, &record)?;
            let lease = OpenOptions::new()
                .read(true)
                .write(true)
                .open(path.join("owner.lock"))?;
            lease.try_lock().context("preparation is already active")?;
            Ok(FileImportPreparation(Arc::new(Workspace {
                store,
                path,
                record: Mutex::new(record),
                lease: Mutex::new(Some(lease)),
                discard: AtomicBool::new(false),
            })))
        })
        .await?
    }

    pub async fn list_file_import_preparations(
        &self,
        project: &str,
        cursor: Option<&str>,
    ) -> Result<FileImportPreparationPage> {
        if project.is_empty() || project.len() > 128 {
            bail!("invalid preparation project");
        }
        if let Some(cursor) = cursor {
            if uuid::Uuid::parse_str(cursor)?.to_string() != cursor {
                bail!("invalid preparation cursor");
            }
        }
        let store = self.store.clone();
        let project = project.to_string();
        let cursor = cursor.map(str::to_string);
        tokio::task::spawn_blocking(move || {
            let root = storage::root(&store)?;
            let _guard = storage::root_guard(&root)?;
            let mut records = BTreeMap::new();
            for entry in fs::read_dir(&root)? {
                let entry = entry?;
                let Ok(record) = storage::read_record(&store, &root, &entry.path()) else {
                    continue;
                };
                if record.version != 2
                    || record.project_id != project
                    || cursor.as_ref().is_some_and(|c| &record.id <= c)
                {
                    continue;
                }
                let intent = match read_intent(&store, &entry.path(), &record) {
                    Ok(intent) => intent,
                    Err(error) => {
                        tracing::warn!(%error, "unrecognized preparation definition retained");
                        continue;
                    }
                };
                storage::reject_link(&entry.path().join("owner.lock"))?;
                let owner = OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(entry.path().join("owner.lock"))?;
                let active = owner.try_lock().is_err();
                if !active && storage::validate_workspace(&store, &root, &entry.path()).is_err() {
                    continue;
                }
                records.insert(
                    record.id.clone(),
                    FileImportPreparationSummary {
                        id: record.id,
                        import_id: record.import_id,
                        phase: record.phase,
                        source_bytes: record.source_bytes,
                        normalized_rows: record.normalized_rows,
                        active,
                        display: display_intent(&intent),
                    },
                );
                if records.len() > 101 {
                    records.pop_last();
                }
            }
            let next_cursor = if records.len() > 100 {
                records.pop_last();
                records.last_key_value().map(|(id, _)| id.clone())
            } else {
                None
            };
            Ok(FileImportPreparationPage {
                preparations: records.into_values().collect(),
                next_cursor,
            })
        })
        .await?
    }
}
