use super::super::*;

#[tokio::test]
async fn stores_filters_and_removes_project_query_history() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();

    let project = Project {
        id: "history-project".to_string(),
        name: "History".to_string(),
        root_path: None,
        created_at: 1,
        updated_at: 1,
    };
    store.save_project(&project).await.unwrap();

    let entry = |id: &str, status: &str, started_at: i64| QueryHistoryItem {
        id: id.to_string(),
        project_id: project.id.clone(),
        connection_id: Some("postgres-1".to_string()),
        connection_name: Some("Local PostgreSQL".to_string()),
        driver: Some("postgres".to_string()),
        database_name: Some("app".to_string()),
        schema_name: Some("public".to_string()),
        sql: format!("SELECT '{id}'"),
        status: status.to_string(),
        duration_ms: 12,
        row_count: Some(1),
        error_message: None,
        execution_mode: "console".to_string(),
        started_at,
        finished_at: started_at + 12,
    };

    store
        .save_query_history(&[entry("older", "success", 10), entry("newer", "error", 20)])
        .await
        .unwrap();

    let history = store.get_query_history(&project.id, 500).await.unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].id, "newer");
    assert_eq!(history[1].id, "older");

    store
        .delete_query_history_item(&project.id, "newer")
        .await
        .unwrap();
    assert_eq!(
        store
            .get_query_history(&project.id, 500)
            .await
            .unwrap()
            .len(),
        1
    );

    store.clear_query_history(&project.id).await.unwrap();
    assert!(store
        .get_query_history(&project.id, 500)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn bounds_query_history_to_five_hundred_entries_per_project() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();

    let entries = (0..505)
        .map(|index| QueryHistoryItem {
            id: format!("entry-{index:03}"),
            project_id: "sqls".to_string(),
            connection_id: None,
            connection_name: None,
            driver: None,
            database_name: None,
            schema_name: None,
            sql: format!("SELECT {index}"),
            status: "success".to_string(),
            duration_ms: 1,
            row_count: Some(1),
            error_message: None,
            execution_mode: "console".to_string(),
            started_at: index,
            finished_at: index + 1,
        })
        .collect::<Vec<_>>();

    store.save_query_history(&entries).await.unwrap();

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM query_history WHERE project_id = 'sqls'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert_eq!(count, 500);
    let retained = store.get_query_history("sqls", 500).await.unwrap();
    assert_eq!(retained.first().unwrap().id, "entry-504");
    assert_eq!(retained.last().unwrap().id, "entry-005");
}
