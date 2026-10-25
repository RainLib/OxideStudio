use crate::core::private_file::create_private_directory;
use anyhow::{bail, Context, Result};
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
};
use uuid::Uuid;

const MARKER: &[u8] = b"oxide-file-query-host-v1\n";

pub(super) struct Storage {
    root: PathBuf,
    instance: PathBuf,
    lease: Option<File>,
}

impl Storage {
    pub fn open(root: &Path) -> Result<Self> {
        create_private_directory(root)?;
        reject_link(root)?;
        let root = root.canonicalize()?;
        let _root_guard = root_guard(&root)?;
        sweep(&root)?;
        let instance = root.join(format!("host-{}", Uuid::new_v4()));
        let staging = tempfile::Builder::new()
            .prefix(".creating-")
            .tempdir_in(&root)?;
        let marker_file = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(staging.path().join("owner.lock"))?;
        fs::write(staging.path().join("format"), MARKER)?;
        // Publish only complete ownership records. Before publication a crash
        // can leave a tiny staging directory, never a source snapshot.
        if instance.parent() != Some(root.as_path()) {
            bail!("invalid Host storage target");
        }
        // Windows cannot rename a directory containing a locked file. The
        // root OS lease serializes publication and sweep until owner.lock is
        // reopened and locked at its final path.
        drop(marker_file);
        fs::rename(staging.path(), &instance)?;
        let lease = OpenOptions::new()
            .read(true)
            .write(true)
            .open(instance.join("owner.lock"))?;
        lease
            .try_lock()
            .context("file-query Host lease is unavailable")?;
        Ok(Self {
            root,
            instance,
            lease: Some(lease),
        })
    }

    pub fn reserve(&self, id: &str) -> Result<PathBuf> {
        let _root_guard = root_guard(&self.root)?;
        if sweep(&self.root)? {
            bail!("previous file-query driver is still releasing its workspace; retry shortly");
        }
        Uuid::parse_str(id)?;
        let workspace = self.instance.join(id);
        fs::create_dir(&workspace)?;
        create_private_directory(&workspace)?;
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(workspace.join("driver.lock"))?;
        Ok(workspace)
    }

    pub fn remove(&self, workspace: &Path) -> Result<()> {
        if workspace.parent() != Some(self.instance.as_path()) {
            bail!("file-query cleanup path is outside this Host");
        }
        let id = workspace
            .file_name()
            .and_then(|name| name.to_str())
            .context("invalid workspace name")?;
        Uuid::parse_str(id)?;
        if !workspace.exists() {
            return Ok(());
        }
        reject_link(&self.instance)?;
        reject_tree(workspace, 0)?;
        let lease = driver_lease(workspace)?;
        drop(lease);
        fs::remove_dir_all(workspace).context("file-query workspace cleanup failed")
    }
}

impl Drop for Storage {
    fn drop(&mut self) {
        if let Ok(_root_guard) = root_guard(&self.root) {
            drop(self.lease.take());
            let _ = clean_instance(&self.root, &self.instance);
        }
    }
}

fn root_guard(root: &Path) -> Result<File> {
    let path = root.join("storage.lock");
    if path.exists() {
        reject_link(&path)?;
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)?;
    file.lock()
        .context("file-query storage lease is unavailable")?;
    Ok(file)
}

fn sweep(root: &Path) -> Result<bool> {
    let mut pending = false;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str().and_then(|name| name.strip_prefix("host-")) else {
            continue;
        };
        if Uuid::parse_str(name).is_err() {
            continue;
        }
        pending |= clean_instance(root, &entry.path())?;
    }
    Ok(pending)
}

fn clean_instance(root: &Path, instance: &Path) -> Result<bool> {
    if instance.parent() != Some(root) {
        bail!("file-query Host cleanup escaped its storage root");
    }
    reject_link(instance)?;
    let owner = instance.join("owner.lock");
    reject_link(&owner)?;
    let lease = OpenOptions::new().read(true).write(true).open(owner)?;
    if lease.try_lock().is_err() {
        return Ok(false);
    } // A different live Host owns it.
    let marker = instance.join("format");
    reject_link(&marker)?;
    if fs::metadata(&marker)?.len() != MARKER.len() as u64 || fs::read(marker)? != MARKER {
        bail!("unrecognized file-query Host storage; no files were removed");
    }
    for entry in fs::read_dir(instance)? {
        let entry = entry?;
        if matches!(entry.file_name().to_str(), Some("owner.lock" | "format")) {
            continue;
        }
        let name = entry.file_name();
        Uuid::parse_str(name.to_str().context("invalid file-query workspace")?)?;
        reject_tree(&entry.path(), 0)?;
        // Never remove a driver's files while its Host-EOF watchdog exits.
        // A later retry rechecks the actual OS lease, not a recorded PID.
        if driver_lease(&entry.path()).is_err() {
            return Ok(true);
        }
    }
    reject_tree(instance, 0)?;
    drop(lease);
    fs::remove_dir_all(instance).context("cannot reclaim previous file-query Host storage")?;
    Ok(false)
}

fn driver_lease(workspace: &Path) -> Result<Option<File>> {
    let path = workspace.join("driver.lock");
    if !path.exists() && fs::read_dir(workspace)?.next().is_none() {
        return Ok(None);
    }
    reject_link(&path)?;
    let lease = OpenOptions::new().read(true).write(true).open(path)?;
    lease
        .try_lock()
        .context("file-query driver is still running")?;
    Ok(Some(lease))
}

fn reject_tree(path: &Path, depth: usize) -> Result<()> {
    if depth > 12 {
        bail!("file-query cleanup directory nesting exceeds its budget");
    }
    reject_link(path)?;
    if fs::metadata(path)?.is_dir() {
        let entries = fs::read_dir(path)?
            .take(129)
            .collect::<std::io::Result<Vec<_>>>()?;
        if entries.len() > 128 {
            bail!("file-query cleanup entry budget exceeded");
        }
        for entry in entries {
            reject_tree(&entry.path(), depth + 1)?;
        }
    }
    Ok(())
}

fn reject_link(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    let link = metadata.file_type().is_symlink();
    #[cfg(windows)]
    let link = {
        use std::os::windows::fs::MetadataExt;
        link || metadata.file_attributes() & 0x400 != 0
    };
    if link {
        bail!("file-query storage must not contain links or reparse points");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_query_storage_preserves_live_hosts_and_reclaims_released_workspaces() {
        let root = tempfile::tempdir().unwrap();
        let first = Storage::open(root.path()).unwrap();
        let workspace = first.reserve(&Uuid::new_v4().to_string()).unwrap();
        fs::write(workspace.join("snapshot.csv"), "id\n1\n").unwrap();
        let second = Storage::open(root.path()).unwrap();
        assert!(workspace.exists());
        first.remove(&workspace).unwrap();
        assert!(!workspace.exists());
        assert!(first.remove(root.path()).is_err());
        drop(first);
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 2);
        drop(second);
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn file_query_storage_requires_driver_exit_before_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Storage::open(root.path()).unwrap();
        let workspace = store.reserve(&Uuid::new_v4().to_string()).unwrap();
        let driver = driver_lease(&workspace).unwrap();
        assert!(store.remove(&workspace).is_err());
        drop(store.lease.take()); // Simulate Host exit; retain the driver lease.
        let waiting = Storage::open(root.path()).unwrap();
        assert!(waiting.reserve(&Uuid::new_v4().to_string()).is_err());
        drop(waiting);
        assert!(workspace.exists());
        drop(driver);
        let recovered = Storage::open(root.path()).unwrap();
        assert!(!workspace.exists());
        drop(recovered);
    }
}
