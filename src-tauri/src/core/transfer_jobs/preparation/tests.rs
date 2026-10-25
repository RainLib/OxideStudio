use super::*;
use std::{fs, mem::ManuallyDrop};

async fn fixture() -> (tempfile::TempDir, JobStore) {
    let directory = tempfile::tempdir().unwrap();
    let store = JobStore::open(directory.path()).await.unwrap();
    (directory, store)
}
fn reserve(store: &JobStore) -> FileImportPreparation {
    storage::reserve(
        store.clone(),
        Record {
            version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "p".into(),
            import_id: "import".into(),
            source_digest: "a".repeat(64),
            phase: FileImportPreparationPhase::Copying,
            source_bytes: 0,
            normalized_rows: 0,
            intent_mac: None,
        },
    )
    .unwrap()
}

#[tokio::test]
async fn live_workers_retain_workspace_and_authenticated_progress() {
    let (_directory, store) = fixture().await;
    let workspace = reserve(&store);
    let path = workspace.path().to_path_buf();
    fs::write(path.join("source.json"), "[]").unwrap();
    workspace
        .checkpoint(FileImportPreparationPhase::Inspecting, 2, 0)
        .unwrap();
    workspace
        .checkpoint(FileImportPreparationPhase::Normalizing, 2, 10000)
        .unwrap();
    let root = storage::root(&store).unwrap();
    let record = storage::validate_workspace(&store, &root, &path).unwrap();
    assert_eq!(record.source_bytes, 2);
    assert_eq!(record.normalized_rows, 10000);
    assert_eq!(record.project_id, "p");
    assert_eq!(record.import_id, "import");
    assert!(workspace
        .checkpoint(FileImportPreparationPhase::Copying, 2, 10000)
        .is_err());
    assert!(workspace
        .checkpoint(FileImportPreparationPhase::Ready, 1, 10000)
        .is_err());
    assert!(workspace
        .checkpoint(FileImportPreparationPhase::Ready, 2, 9999)
        .is_err());
    assert!(workspace
        .checkpoint(FileImportPreparationPhase::Ready, 513 * 1024 * 1024, 10000)
        .is_err());
    storage::recover(&store).unwrap();
    assert!(
        path.exists(),
        "active OS lease must win over recorded phase/PID"
    );
    let worker = workspace.clone();
    assert!(workspace.close().is_err());
    assert!(path.exists(), "last blocking worker retains ownership");
    worker.close().unwrap();
    assert!(!path.exists());
}

#[tokio::test]
async fn abandoned_source_and_journal_reclaimed_after_reopen() {
    let (directory, store) = fixture().await;
    let mut workspace = ManuallyDrop::new(reserve(&store));
    let path = workspace.path().to_path_buf();
    for name in [
        "source.json",
        "normalized.sqlite",
        "normalized.sqlite-journal",
        "owner.pending",
    ] {
        fs::write(path.join(name), "interrupted private data").unwrap();
    }
    drop(workspace.0.lease.lock().unwrap().take());
    let reopened = JobStore::open(directory.path()).await.unwrap();
    storage::recover(&reopened).unwrap();
    assert!(!path.exists());
    unsafe {
        ManuallyDrop::drop(&mut workspace);
    }
}

#[tokio::test]
async fn tampered_wrong_identity_and_unknown_payload_are_retained() {
    let (_directory, store) = fixture().await;
    let root = storage::root(&store).unwrap();
    for kind in ["tamper", "identity", "unknown", "nested", "oversized"] {
        let mut workspace = ManuallyDrop::new(reserve(&store));
        let path = workspace.path().to_path_buf();
        let owner = fs::read(path.join("owner.json")).unwrap();
        match kind {
            "tamper" => {
                let mut envelope: Envelope = serde_json::from_slice(&owner).unwrap();
                envelope.body = envelope
                    .body
                    .replace("\"project_id\":\"p\"", "\"project_id\":\"other\"");
                fs::write(
                    path.join("owner.json"),
                    serde_json::to_vec(&envelope).unwrap(),
                )
                .unwrap();
            }
            "identity" => {
                let other = root.join(format!("prep-{}", uuid::Uuid::new_v4()));
                fs::create_dir(&other).unwrap();
                fs::write(other.join("owner.json"), &owner).unwrap();
                fs::write(other.join("sentinel"), "keep").unwrap();
                storage::recover(&store).unwrap();
                assert!(other.join("sentinel").exists());
                fs::remove_file(other.join("sentinel")).unwrap();
                fs::remove_file(other.join("owner.json")).unwrap();
                fs::remove_dir(other).unwrap();
            }
            "unknown" => fs::write(path.join("unrelated.txt"), "keep").unwrap(),
            "nested" => fs::create_dir(path.join("source.json")).unwrap(),
            "oversized" => fs::write(path.join("owner.json"), vec![b' '; 8193]).unwrap(),
            _ => unreachable!(),
        }
        drop(workspace.0.lease.lock().unwrap().take());
        storage::recover(&store).unwrap();
        if kind == "identity" {
            assert!(!path.exists());
        } else {
            assert!(path.exists(), "{kind} must not be removed");
            fs::write(path.join("owner.json"), owner).unwrap();
            if kind == "unknown" {
                fs::remove_file(path.join("unrelated.txt")).unwrap();
            }
            if kind == "nested" {
                fs::remove_dir(path.join("source.json")).unwrap();
            }
        }
        unsafe {
            ManuallyDrop::drop(&mut workspace);
        }
        assert!(!path.exists());
    }
}

#[tokio::test]
async fn links_and_reparse_points_cannot_redirect_cleanup() {
    let (directory, store) = fixture().await;
    let workspace = reserve(&store);
    let outside = directory.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("keep"), "keep").unwrap();
    let link = workspace.path().join("source.json");
    #[cfg(windows)]
    assert!(std::process::Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(&link)
        .arg(&outside)
        .output()
        .unwrap()
        .status
        .success());
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, &link).unwrap();
    assert!(
        storage::validate_workspace(&store, &storage::root(&store).unwrap(), workspace.path())
            .is_err()
    );
    storage::recover(&store).unwrap();
    assert_eq!(fs::read_to_string(outside.join("keep")).unwrap(), "keep");
    #[cfg(windows)]
    fs::remove_dir(link).unwrap();
    #[cfg(unix)]
    fs::remove_file(link).unwrap();
    workspace.close().unwrap();
}
