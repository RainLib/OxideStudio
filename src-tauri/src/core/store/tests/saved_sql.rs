use super::super::*;

#[tokio::test]
async fn saved_sql_library_is_project_scoped_lazy_and_cascade_safe() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();
    let project = Project {
        id: "library-project".into(),
        name: "Library".into(),
        root_path: None,
        created_at: 1,
        updated_at: 1,
    };
    store.save_project(&project).await.unwrap();

    let root = SavedSqlFolder {
        id: "reports".into(),
        project_id: project.id.clone(),
        connection_id: Some("postgres-1".into()),
        parent_folder_id: None,
        name: "Reports".into(),
        order_index: 0,
        created_at: 10,
        updated_at: 10,
    };
    store.save_saved_sql_folder(&root).await.unwrap();
    let child = SavedSqlFolder {
        id: "daily".into(),
        parent_folder_id: Some(root.id.clone()),
        name: "Daily".into(),
        ..root.clone()
    };
    store.save_saved_sql_folder(&child).await.unwrap();

    let file = SavedSqlFile {
        id: "orders".into(),
        project_id: project.id.clone(),
        connection_id: Some("postgres-1".into()),
        folder_id: Some(child.id.clone()),
        name: "orders.sql".into(),
        database_name: Some("app".into()),
        schema_name: Some("public".into()),
        sql: "SELECT * FROM orders;".into(),
        sql_loaded: true,
        order_index: 0,
        open_count: 0,
        opened_at: None,
        created_at: 11,
        updated_at: 11,
    };
    store.save_saved_sql_file(&file).await.unwrap();

    let summary = store.load_saved_sql_library(&project.id).await.unwrap();
    assert_eq!(summary.folders.len(), 2);
    assert_eq!(summary.files.len(), 1);
    assert_eq!(summary.files[0].sql, "");
    assert!(!summary.files[0].sql_loaded);
    let loaded = store
        .load_saved_sql_file(&project.id, &file.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(loaded.sql, file.sql);
    assert!(loaded.sql_loaded);

    store
        .record_saved_sql_file_opened(&project.id, &file.id, 20)
        .await
        .unwrap();
    let opened = store
        .load_saved_sql_file(&project.id, &file.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(opened.open_count, 1);
    assert_eq!(opened.opened_at, Some(20));

    let duplicate = SavedSqlFile {
        id: "other".into(),
        name: "ORDERS.SQL".into(),
        ..file.clone()
    };
    assert!(store.save_saved_sql_file(&duplicate).await.is_err());
    let cyclic = SavedSqlFolder {
        parent_folder_id: Some(child.id.clone()),
        ..root.clone()
    };
    assert!(store.save_saved_sql_folder(&cyclic).await.is_err());

    store
        .delete_saved_sql_folder(&project.id, &root.id)
        .await
        .unwrap();
    let empty = store.load_saved_sql_library(&project.id).await.unwrap();
    assert!(empty.folders.is_empty());
    assert!(empty.files.is_empty());
}

#[tokio::test]
async fn saved_sql_batch_is_atomic_and_loads_contents_in_one_query() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();
    let project = Project {
        id: "batch-project".into(),
        name: "Batch".into(),
        root_path: None,
        created_at: 1,
        updated_at: 1,
    };
    store.save_project(&project).await.unwrap();
    let root = SavedSqlFolder {
        id: "root".into(),
        project_id: project.id.clone(),
        connection_id: None,
        parent_folder_id: None,
        name: "Root".into(),
        order_index: 0,
        created_at: 2,
        updated_at: 2,
    };
    let child = SavedSqlFolder {
        id: "child".into(),
        parent_folder_id: Some(root.id.clone()),
        name: "Child".into(),
        ..root.clone()
    };
    let file = SavedSqlFile {
        id: "query".into(),
        project_id: project.id.clone(),
        connection_id: None,
        folder_id: Some(child.id.clone()),
        name: "query.sql".into(),
        database_name: None,
        schema_name: None,
        sql: "SELECT 1".into(),
        sql_loaded: true,
        order_index: 0,
        open_count: 0,
        opened_at: None,
        created_at: 3,
        updated_at: 3,
    };
    store
        .save_saved_sql_batch(&[root, child], std::slice::from_ref(&file))
        .await
        .unwrap();
    let loaded = store.load_saved_sql_files(&project.id).await.unwrap();
    assert_eq!(loaded, vec![file]);

    let transient_folder = SavedSqlFolder {
        id: "transient".into(),
        project_id: project.id.clone(),
        connection_id: None,
        parent_folder_id: None,
        name: "Transient".into(),
        order_index: 1,
        created_at: 4,
        updated_at: 4,
    };
    let duplicate_a = SavedSqlFile {
        id: "duplicate-a".into(),
        project_id: project.id.clone(),
        folder_id: Some(transient_folder.id.clone()),
        name: "duplicate.sql".into(),
        created_at: 5,
        updated_at: 5,
        ..loaded[0].clone()
    };
    let duplicate_b = SavedSqlFile {
        id: "duplicate-b".into(),
        ..duplicate_a.clone()
    };
    assert!(store
        .save_saved_sql_batch(&[transient_folder], &[duplicate_a, duplicate_b])
        .await
        .is_err());
    let library = store.load_saved_sql_library(&project.id).await.unwrap();
    assert_eq!(library.folders.len(), 2);
    assert_eq!(library.files.len(), 1);
}

#[tokio::test]
async fn saved_sql_root_names_are_scoped_by_connection() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();
    let project = Project {
        id: "scope-project".into(),
        name: "Scope".into(),
        root_path: None,
        created_at: 1,
        updated_at: 1,
    };
    store.save_project(&project).await.unwrap();
    let first = SavedSqlFile {
        id: "first".into(),
        project_id: project.id.clone(),
        connection_id: Some("postgres-1".into()),
        folder_id: None,
        name: "daily.sql".into(),
        database_name: None,
        schema_name: None,
        sql: "SELECT 1".into(),
        sql_loaded: true,
        order_index: 0,
        open_count: 0,
        opened_at: None,
        created_at: 2,
        updated_at: 2,
    };
    let second = SavedSqlFile {
        id: "second".into(),
        connection_id: Some("postgres-2".into()),
        sql: "SELECT 2".into(),
        ..first.clone()
    };

    store.save_saved_sql_file(&first).await.unwrap();
    store.save_saved_sql_file(&second).await.unwrap();
    assert_eq!(
        store
            .load_saved_sql_library(&project.id)
            .await
            .unwrap()
            .files
            .len(),
        2
    );
}
