use super::super::*;

#[tokio::test]
async fn stores_project_scoped_assistant_tasks_and_interrupts_only_old_sessions() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();
    for id in ["project-a", "project-b"] {
        store
            .save_project(&Project {
                id: id.to_string(),
                name: id.to_string(),
                root_path: None,
                created_at: 1,
                updated_at: 1,
            })
            .await
            .unwrap();
    }

    let task = |id: &str, project_id: &str, session_id: &str, status: &str| AssistantTaskRecord {
        id: id.to_string(),
        project_id: project_id.to_string(),
        request_id: format!("request-{id}"),
        session_id: session_id.to_string(),
        status: status.to_string(),
        title: "Assistant task".to_string(),
        detail: None,
        current_step_id: Some("inspect".to_string()),
        current_tool_name: Some("metadata.listObjects".to_string()),
        progress: Some(0.5),
        checkpoint: AssistantTaskCheckpoint {
            version: 1,
            mode: "agent".to_string(),
            context: None,
            plan: vec![AssistantTaskPlanStep {
                id: "inspect".to_string(),
                title: "Inspect metadata".to_string(),
                tool_name: Some("metadata.listObjects".to_string()),
                requires_approval: false,
            }],
            completed_steps: vec![],
            execution_receipts: vec![],
        },
        created_at: 10,
        updated_at: 10,
        finished_at: None,
    };
    store
        .save_assistant_task(&task("running-a", "project-a", "old-session", "running"))
        .await
        .unwrap();
    let mut completed = task("completed-a", "project-a", "old-session", "completed");
    completed.finished_at = Some(12);
    store.save_assistant_task(&completed).await.unwrap();
    store
        .save_assistant_task(&task("running-b", "project-b", "old-session", "running"))
        .await
        .unwrap();

    let project_a = store
        .get_assistant_tasks("project-a", "new-session", 50)
        .await
        .unwrap();
    assert_eq!(project_a.len(), 2);
    assert_eq!(
        project_a
            .iter()
            .find(|candidate| candidate.id == "running-a")
            .unwrap()
            .status,
        "interrupted"
    );
    assert_eq!(
        project_a
            .iter()
            .find(|candidate| candidate.id == "completed-a")
            .unwrap()
            .status,
        "completed"
    );

    let project_b = store
        .get_assistant_tasks("project-b", "old-session", 50)
        .await
        .unwrap();
    assert_eq!(project_b.len(), 1);
    assert_eq!(project_b[0].status, "running");

    store
        .clear_finished_assistant_tasks("project-a")
        .await
        .unwrap();
    assert!(store
        .get_assistant_tasks("project-a", "new-session", 50)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        store
            .get_assistant_tasks("project-b", "old-session", 50)
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn rejects_unbounded_or_invalid_assistant_task_checkpoints() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();
    let mut task = AssistantTaskRecord {
        id: "invalid".to_string(),
        project_id: "sqls".to_string(),
        request_id: "request-invalid".to_string(),
        session_id: "session".to_string(),
        status: "running".to_string(),
        title: "Assistant task".to_string(),
        detail: None,
        current_step_id: None,
        current_tool_name: None,
        progress: Some(2.0),
        checkpoint: AssistantTaskCheckpoint {
            version: 1,
            mode: "agent".to_string(),
            context: None,
            plan: vec![],
            completed_steps: vec![],
            execution_receipts: vec![],
        },
        created_at: 1,
        updated_at: 1,
        finished_at: None,
    };
    assert!(store.save_assistant_task(&task).await.is_err());

    task.progress = Some(0.5);
    task.checkpoint.version = 2;
    task.checkpoint.plan = vec![AssistantTaskPlanStep {
        id: "write".to_string(),
        title: "Update rows".to_string(),
        tool_name: Some("query.runMutation".to_string()),
        requires_approval: true,
    }];
    task.checkpoint.execution_receipts = vec![AssistantTaskExecutionReceipt {
        step_id: "write".to_string(),
        tool_name: "query.runMutation".to_string(),
        status: "started".to_string(),
        started_at: 2,
        finished_at: None,
    }];
    store.save_assistant_task(&task).await.unwrap();

    task.checkpoint.version = 1;
    assert!(store.save_assistant_task(&task).await.is_err());
    task.checkpoint.version = 2;
    task.checkpoint.execution_receipts[0].tool_name = "query.other".to_string();
    assert!(store.save_assistant_task(&task).await.is_err());

    task.checkpoint.execution_receipts[0].tool_name = "query.runMutation".to_string();
    task.checkpoint.version = 3;
    task.checkpoint.context = Some(AssistantTaskContextBinding {
        version: 1,
        context_version: 7,
        fingerprint: "ctx-example".to_string(),
        project_id: "sqls".to_string(),
        active_connection_id: Some("postgres-1".to_string()),
        active_driver: Some("postgres".to_string()),
        active_database_name: Some("app".to_string()),
        active_namespace: Some("public".to_string()),
        active_tab_id: Some("query-1".to_string()),
        document_revision: Some("memory:document".to_string()),
        selection_revision: None,
    });
    store.save_assistant_task(&task).await.unwrap();

    task.checkpoint.context.as_mut().unwrap().project_id = "other".to_string();
    assert!(store.save_assistant_task(&task).await.is_err());
}
