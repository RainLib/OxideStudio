use super::{Envelope, FileImportPreparation, Record, Workspace};
use crate::core::{
    private_file::{create_private_directory, create_private_file},
    transfer_jobs::store::JobStore,
};
use anyhow::{bail, Context, Result};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const PURPOSE: &str = "file-import-preparation-v1";
pub(super) const RECORD_BUDGET: u64 = 8192;

pub(super) fn reject_link(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    let link = metadata.file_type().is_symlink();
    #[cfg(windows)]
    let link = {
        use std::os::windows::fs::MetadataExt;
        link || metadata.file_attributes() & 0x400 != 0
    };
    if link {
        bail!("file preparation storage must not contain links or reparse points");
    }
    Ok(())
}

pub(super) fn root(store: &JobStore) -> Result<PathBuf> {
    reject_link(&store.root)?;
    let root = store.root.join("import-preparations");
    if root.exists() {
        reject_link(&root)?;
    }
    create_private_directory(&root)?;
    reject_link(&root)?;
    Ok(root)
}

pub(super) fn root_guard(root: &Path) -> Result<File> {
    reject_link(root)?;
    let path = root.join("storage.lock");
    if path.exists() {
        reject_link(&path)?;
    }
    create_private_file(&path, b"")?;
    let file = OpenOptions::new().read(true).write(true).open(path)?;
    file.lock()
        .context("file preparation storage is unavailable")?;
    Ok(file)
}

pub(super) fn write_record(store: &JobStore, path: &Path, record: &Record) -> Result<()> {
    let (body, mac) = store.encode(PURPOSE, record)?;
    let bytes = serde_json::to_vec(&Envelope { body, mac })?;
    if bytes.len() as u64 > RECORD_BUDGET {
        bail!("file preparation record exceeds budget");
    }
    let pending = path.join("owner.pending");
    if pending.exists() {
        reject_link(&pending)?;
    }
    create_private_file(&pending, b"")?;
    let mut output = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&pending)?;
    output.write_all(&bytes)?;
    output.sync_all()?;
    drop(output);
    let owner = path.join("owner.json");
    if owner.exists() {
        reject_link(&owner)?;
    }
    fs::rename(pending, owner)?;
    Ok(())
}

pub(super) fn reserve(store: JobStore, record: Record) -> Result<FileImportPreparation> {
    reserve_with_intent(store, record, None)
}

pub(super) fn reserve_with_intent(
    store: JobStore,
    mut record: Record,
    intent: Option<serde_json::Value>,
) -> Result<FileImportPreparation> {
    let root = root(&store)?;
    let _guard = root_guard(&root)?;
    let staging = tempfile::Builder::new()
        .prefix(".creating-")
        .tempdir_in(&root)?;
    create_private_directory(staging.path())?;
    create_private_file(&staging.path().join("owner.lock"), b"")?;
    if let Some(intent) = intent {
        record.version = 2;
        record.intent_mac = Some(super::resumable::write_intent(
            &store,
            staging.path(),
            &record,
            intent,
        )?);
    }
    write_record(&store, staging.path(), &record)?;
    let path = root.join(format!("prep-{}", record.id));
    fs::rename(staging.path(), &path)?;
    // Windows cannot rename/remove a directory containing our locked file.
    // The root lease protects the publication -> owner-lock handoff.
    let lease = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path.join("owner.lock"))?;
    lease
        .try_lock()
        .context("file preparation workspace is already owned")?;
    Ok(FileImportPreparation(Arc::new(Workspace {
        store,
        path,
        record: Mutex::new(record),
        lease: Mutex::new(Some(lease)),
        discard: std::sync::atomic::AtomicBool::new(false),
    })))
}

fn payload_name(name: &str) -> bool {
    matches!(
        name,
        "owner.lock"
            | "owner.json"
            | "owner.pending"
            | "intent.json"
            | "source.csv"
            | "source.tsv"
            | "source.txt"
            | "source.json"
            | "source.jsonl"
            | "source.ndjson"
            | "source.xlsx"
            | "normalized.sqlite"
            | "normalized.sqlite-journal"
            | "normalized.sqlite-wal"
            | "normalized.sqlite-shm"
    )
}

pub(super) fn read_record(store: &JobStore, root: &Path, path: &Path) -> Result<Record> {
    if path.parent() != Some(root) {
        bail!("file preparation cleanup escaped its root");
    }
    reject_link(path)?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .context("invalid preparation path")?;
    let id = name
        .strip_prefix("prep-")
        .context("invalid preparation name")?;
    if uuid::Uuid::parse_str(id)?.to_string() != id {
        bail!("invalid preparation id");
    }
    let owner = path.join("owner.json");
    reject_link(&owner)?;
    let metadata = fs::metadata(&owner)?;
    if !metadata.is_file() || metadata.len() > RECORD_BUDGET {
        bail!("invalid preparation ownership record");
    }
    let mut bytes = Vec::new();
    File::open(owner)?
        .take(RECORD_BUDGET + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > RECORD_BUDGET {
        bail!("invalid preparation ownership record");
    }
    let envelope: Envelope = serde_json::from_slice(&bytes)?;
    let record: Record = store.decode(PURPOSE, &envelope.body, &envelope.mac)?;
    if !matches!(
        (record.version, record.intent_mac.as_ref()),
        (1, None) | (2, Some(_))
    ) || record.id != id
    {
        bail!("invalid preparation ownership identity");
    }
    Ok(record)
}

pub(super) fn validate_workspace(store: &JobStore, root: &Path, path: &Path) -> Result<Record> {
    let record = read_record(store, root, path)?;
    // Flat, fixed-name allowlist: no recursive traversal/removal, including
    // unknown child directories, even inside an authenticated workspace.
    for entry in fs::read_dir(path)?.take(17) {
        let entry = entry?;
        reject_link(&entry.path())?;
        if !entry.file_type()?.is_file() || !entry.file_name().to_str().is_some_and(payload_name) {
            bail!("unrecognized file in preparation workspace");
        }
    }
    Ok(record)
}

pub(super) fn remove_workspace(root: &Path, path: &Path) -> Result<()> {
    if path.parent() != Some(root) || path.canonicalize()?.parent() != Some(root) {
        bail!("file preparation cleanup escaped its resolved root");
    }
    let mut files = fs::read_dir(path)?
        .take(17)
        .collect::<std::io::Result<Vec<_>>>()?;
    if files.len() > 16 {
        bail!("preparation cleanup entry budget exceeded");
    }
    for entry in &files {
        reject_link(&entry.path())?;
        if !entry.file_type()?.is_file() || !entry.file_name().to_str().is_some_and(payload_name) {
            bail!("unrecognized file in preparation workspace");
        }
    }
    // Keep authenticated ownership until payloads are gone, so an interrupted
    // cleanup remains recoverable. Close the OS lease before Windows deletion.
    files.sort_by_key(|entry| match entry.file_name().to_str() {
        Some("owner.json") => 2,
        Some("owner.lock") => 1,
        _ => 0,
    });
    for entry in files {
        fs::remove_file(entry.path())?;
    }
    fs::remove_dir(path)?;
    Ok(())
}

pub(super) fn recover(store: &JobStore) -> Result<()> {
    let root = root(store)?;
    let _guard = root_guard(&root)?;
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        if !entry
            .file_name()
            .to_str()
            .is_some_and(|s| s.starts_with("prep-"))
        {
            continue;
        }
        let result = (|| -> Result<()> {
            let path = entry.path();
            let record = validate_workspace(store, &root, &path)?;
            if record.version == 2 {
                super::resumable::read_intent(store, &path, &record)?;
                return Ok(()); // Preserve durable inputs for explicit resume/discard.
            }
            let owner = path.join("owner.lock");
            // A previous interrupted cleanup may already have removed the
            // lock after all data was removed. Root serialization still holds.
            let lease = if owner.exists() {
                let file = OpenOptions::new().read(true).write(true).open(owner)?;
                if file.try_lock().is_err() {
                    return Ok(());
                }
                Some(file)
            } else {
                if fs::read_dir(&path)?.any(|e| e.is_ok_and(|e| e.file_name() != "owner.json")) {
                    bail!("preparation lock is missing while payloads remain");
                }
                None
            };
            drop(lease);
            remove_workspace(&root, &path)
        })();
        if let Err(error) = result {
            // Do not delete unknown content, or disable the entire task engine
            // because one workspace needs inspection.
            tracing::warn!(%error, "unrecognized file preparation workspace retained");
        }
    }
    Ok(())
}
