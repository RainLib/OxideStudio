use super::*;
use crate::core::{driver_package::DatabaseDriverPackageRegistry, store::MetaStore};

async fn fixture() -> (tempfile::TempDir, LargeTransferJobs) {
    let root = tempfile::tempdir().unwrap();
    let metadata = MetaStore::open(&root.path().join("profile")).await.unwrap();
    let jobs = LargeTransferJobs::open(
        &root.path().join("jobs"),
        metadata,
        DatabaseDriverPackageRegistry::new(root.path().join("packages")),
    )
    .await
    .unwrap();
    (root, jobs)
}
#[tokio::test]
async fn durable_preparations_survive_drop_and_reopen_with_scoped_exclusive_resume() {
    let (root, jobs) = fixture().await;
    let workspace = jobs
        .begin_resumable_file_import_preparation(
            "p",
            "import",
            &"a".repeat(64),
            serde_json::json!({"mapping":["id"],"format":"json"}),
        )
        .await
        .unwrap();
    let id = workspace.progress().unwrap().id;
    let path = workspace.path().to_path_buf();
    assert!(jobs.resume_file_import_preparation("p", &id).await.is_err());
    assert!(jobs
        .resume_file_import_preparation("other", &id)
        .await
        .is_err());
    assert!(jobs
        .list_file_import_preparations("other", None)
        .await
        .unwrap()
        .preparations
        .is_empty());
    assert!(
        jobs.list_file_import_preparations("p", None)
            .await
            .unwrap()
            .preparations[0]
            .active
    );
    let (body, mac) = workspace
        .seal_checkpoint(&serde_json::json!({"rows":500}))
        .unwrap();
    drop(workspace);
    let reopened = LargeTransferJobs::open(
        &root.path().join("jobs"),
        MetaStore::open(&root.path().join("profile")).await.unwrap(),
        DatabaseDriverPackageRegistry::new(root.path().join("packages")),
    )
    .await
    .unwrap();
    assert!(path.exists());
    assert!(
        !reopened
            .list_file_import_preparations("p", None)
            .await
            .unwrap()
            .preparations[0]
            .active
    );
    let workspace = reopened
        .resume_file_import_preparation("p", &id)
        .await
        .unwrap();
    assert_eq!(workspace.intent().unwrap().unwrap()["format"], "json");
    assert_eq!(
        workspace
            .open_checkpoint::<serde_json::Value>(&body, &mac)
            .unwrap()["rows"],
        500
    );
    let other = jobs
        .begin_resumable_file_import_preparation(
            "p",
            "other",
            &"a".repeat(64),
            serde_json::json!({}),
        )
        .await
        .unwrap();
    assert!(other
        .open_checkpoint::<serde_json::Value>(&body, &mac)
        .is_err());
    other.close().unwrap();
    workspace.close().unwrap();
    assert!(!path.exists());
}

#[tokio::test]
async fn durable_intent_tampering_is_retained_and_cannot_be_resumed() {
    let (_root, jobs) = fixture().await;
    let workspace = jobs
        .begin_resumable_file_import_preparation(
            "p",
            "import",
            &"a".repeat(64),
            serde_json::json!({"format":"json"}),
        )
        .await
        .unwrap();
    let path = workspace.path().to_path_buf();
    let id = workspace.progress().unwrap().id;
    let original = std::fs::read(path.join("intent.json")).unwrap();
    std::fs::write(path.join("intent.json"), "{}").unwrap();
    drop(workspace);
    assert!(jobs.resume_file_import_preparation("p", &id).await.is_err());
    jobs.recover_import_preparations().await.unwrap();
    assert!(path.exists());
    std::fs::write(path.join("intent.json"), original).unwrap();
    jobs.resume_file_import_preparation("p", &id)
        .await
        .unwrap()
        .close()
        .unwrap();
}

#[tokio::test]
async fn preparation_list_projects_authenticated_display_without_source_paths() {
    let (_root, jobs) = fixture().await;
    let workspace = jobs
        .begin_resumable_file_import_preparation(
            "p",
            "import",
            &"a".repeat(64),
            serde_json::json!({"request": {
                "filePath": "C:\\private\\source.json", "format": "json",
                "connectionId": "target", "schema": "main", "table": "items", "mode": "truncate"
            }}),
        )
        .await
        .unwrap();
    let page =
        serde_json::to_value(jobs.list_file_import_preparations("p", None).await.unwrap()).unwrap();
    assert_eq!(
        page["preparations"][0]["display"]["fileName"],
        "source.json"
    );
    assert_eq!(page["preparations"][0]["display"]["mode"], "truncate");
    assert!(!page.to_string().contains("private"));
    std::fs::write(workspace.path().join("intent.json"), "{}").unwrap();
    assert!(jobs
        .list_file_import_preparations("p", None)
        .await
        .unwrap()
        .preparations
        .is_empty());
    workspace.close().unwrap();
}
