use super::*;
use std::path::PathBuf;
use tempfile::tempdir;

#[test]
fn local_agent_key_is_stable_and_private() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("credentials/agent-key.secret");
    let first = resolve_persistent_key(&path).unwrap();
    let second = resolve_persistent_key(&path).unwrap();
    assert_eq!(first, second);
    assert_eq!(std::fs::read(&path).unwrap().len(), AGENT_STORE_KEY_BYTES);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[tokio::test]
async fn session_store_round_trips_authenticated_ciphertext() {
    let store = AgentStore::session_for_test(PathBuf::from("unused"), [7u8; 32]);
    let value = serde_json::json!({"secret":"not-on-disk"});
    store
        .save_thread("project", "thread", &value)
        .await
        .unwrap();
    assert_eq!(
        store.load_thread("project", "thread").await.unwrap(),
        Some(value)
    );

    let backend = store.backend().await.unwrap();
    let Backend::Session(session) = backend.as_ref() else {
        panic!("expected a session backend");
    };
    let mut records = session.records.write().await;
    records
        .get_mut(&RecordKey::thread("project", "thread"))
        .unwrap()
        .ciphertext[0] ^= 1;
    drop(records);
    assert!(store.load_thread("project", "thread").await.is_err());
}

#[tokio::test]
async fn session_store_lists_only_matching_thread_prefixes() {
    let store = AgentStore::session_for_test(PathBuf::from("unused"), [7u8; 32]);
    store
        .save_thread(
            "project",
            "conversation:provider-a:chat:new",
            &serde_json::json!({"updatedAt": 200, "id": "new"}),
        )
        .await
        .unwrap();
    store
        .save_thread(
            "project",
            "conversation:provider-a:chat:old",
            &serde_json::json!({"updatedAt": 100, "id": "old"}),
        )
        .await
        .unwrap();
    store
        .save_thread(
            "project",
            "conversation:provider-b:chat:other",
            &serde_json::json!({"updatedAt": 300, "id": "other"}),
        )
        .await
        .unwrap();

    let values = store
        .list_threads_with_prefix("project", "conversation:provider-a", 20)
        .await
        .unwrap();
    assert_eq!(values.len(), 2);
    assert_eq!(values[0]["id"], "new");
    assert_eq!(values[1]["id"], "old");
}

#[tokio::test]
async fn persistent_store_never_writes_json_plaintext() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("agent.db");
    let store = AgentStore::persistent_for_test(path.clone(), [9u8; 32])
        .await
        .unwrap();
    let marker = "plaintext-marker-that-must-not-appear";
    store
        .save_artifact("project", "artifact", &serde_json::json!({"value": marker}))
        .await
        .unwrap();
    drop(store);

    let bytes = std::fs::read(path).unwrap();
    assert!(!bytes
        .windows(marker.len())
        .any(|window| window == marker.as_bytes()));
}

#[tokio::test]
async fn persistent_store_lists_matching_thread_prefixes() {
    let directory = tempdir().unwrap();
    let store = AgentStore::persistent_for_test(directory.path().join("agent.db"), [9u8; 32])
        .await
        .unwrap();
    store
        .save_thread(
            "project",
            "conversation:provider-a:chat:one",
            &serde_json::json!({"updatedAt": 100, "id": "one"}),
        )
        .await
        .unwrap();
    store
        .save_thread(
            "project",
            "conversation:provider-b:chat:two",
            &serde_json::json!({"updatedAt": 200, "id": "two"}),
        )
        .await
        .unwrap();

    let values = store
        .list_threads_with_prefix("project", "conversation:provider-a", 20)
        .await
        .unwrap();
    assert_eq!(
        values,
        vec![serde_json::json!({"updatedAt": 100, "id": "one"})]
    );
}

#[tokio::test]
async fn wrong_key_cannot_decrypt_persistent_state() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("agent.db");
    let writer = AgentStore::persistent_for_test(path.clone(), [1u8; 32])
        .await
        .unwrap();
    writer
        .save_checkpoint("project", "thread", 1, &serde_json::json!({"ok":true}))
        .await
        .unwrap();
    drop(writer);

    let reader = AgentStore::persistent_for_test(path, [2u8; 32])
        .await
        .unwrap();
    assert!(reader
        .load_checkpoint("project", "thread", 1)
        .await
        .is_err());
}

#[tokio::test]
async fn project_clear_is_scoped_and_reports_removed_records() {
    let store = AgentStore::session_for_test(PathBuf::from("unused"), [7u8; 32]);
    store
        .save_thread("project-a", "thread", &serde_json::json!({"a":1}))
        .await
        .unwrap();
    store
        .save_artifact("project-a", "artifact", &serde_json::json!({"a":2}))
        .await
        .unwrap();
    store
        .save_thread("project-b", "thread", &serde_json::json!({"b":1}))
        .await
        .unwrap();

    assert_eq!(store.clear_project("project-a").await.unwrap(), 2);
    assert_eq!(
        store.load_thread("project-a", "thread").await.unwrap(),
        None
    );
    assert!(store
        .load_thread("project-b", "thread")
        .await
        .unwrap()
        .is_some());
}

#[tokio::test]
async fn graph_checkpoint_round_trips_pending_writes_and_deletes_by_thread() {
    let store = AgentStore::session_for_test(PathBuf::from("unused"), [7u8; 32]);
    let checkpoint = serde_json::json!({"type":"json","data":"Y2hlY2twb2ludA=="});
    let metadata = serde_json::json!({"type":"json","data":"bWV0YWRhdGE="});
    store
        .save_graph_checkpoint(
            "project",
            "graph-thread",
            "",
            "checkpoint-1",
            None,
            &checkpoint,
            &metadata,
        )
        .await
        .unwrap();
    store
        .save_graph_writes(
            "project",
            "graph-thread",
            "",
            "checkpoint-1",
            &[StoredGraphWrite {
                task_id: "task-1".to_string(),
                index: 0,
                channel: "messages".to_string(),
                value: serde_json::json!({"type":"json","data":"dmFsdWU="}),
            }],
        )
        .await
        .unwrap();

    let loaded = store
        .load_graph_checkpoint("project", "graph-thread", "", None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(loaded.checkpoint, checkpoint);
    assert_eq!(loaded.metadata, metadata);
    assert_eq!(loaded.pending_writes.len(), 1);
    assert_eq!(loaded.pending_writes[0].channel, "messages");
    assert_eq!(
        store
            .list_graph_checkpoints("project", "graph-thread", "", None, None, 10)
            .await
            .unwrap()
            .len(),
        1
    );

    assert_eq!(
        store
            .delete_graph_thread("project", "graph-thread")
            .await
            .unwrap(),
        2
    );
    assert!(store
        .load_graph_checkpoint("project", "graph-thread", "", None)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn persistent_graph_checkpoint_payload_is_encrypted() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("agent.db");
    let store = AgentStore::persistent_for_test(path.clone(), [9u8; 32])
        .await
        .unwrap();
    let marker = "graph-plaintext-marker-that-must-not-appear";
    store
        .save_graph_checkpoint(
            "project",
            "graph-thread",
            "namespace",
            "checkpoint",
            None,
            &serde_json::json!({"type":"json","data":marker}),
            &serde_json::json!({"type":"json","data":"metadata"}),
        )
        .await
        .unwrap();
    drop(store);

    let bytes = std::fs::read(path).unwrap();
    assert!(!bytes
        .windows(marker.len())
        .any(|window| window == marker.as_bytes()));
}
