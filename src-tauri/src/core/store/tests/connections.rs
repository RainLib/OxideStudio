use super::super::*;

#[tokio::test]
async fn read_only_credentials_reuse_desktop_crypto_without_creating_a_key_or_migrating_rows() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    let original = serde_json::json!({
        "id":"readonly", "url":"postgres://fixture:fixture-password@example.test/db",
        "password":"fixture-password", "sshTunnel":{
            "host":"bastion.example.test", "password":"ssh-fixture",
            "jumpHosts":[{"host":"hop.example.test","privateKeyPassphrase":"hop-fixture"}]
        }
    });
    let (safe, protected) = store
        .protect_connection_config("project-a", "readonly", &original)
        .unwrap();
    let protected = protected.unwrap();
    let directory = tempfile::tempdir().unwrap();
    let key_path = directory.path().join(CONNECTION_CREDENTIAL_KEY_FILE);
    let mut restored = safe.clone();
    assert!(restore_read_only_connection_credentials(
        directory.path(),
        "project-a",
        "readonly",
        &mut restored,
        &protected.ciphertext,
        &protected.nonce
    )
    .is_err());
    assert!(
        !key_path.exists(),
        "read-only clients must never create a credential key"
    );
    std::fs::write(&key_path, [7_u8; CONNECTION_CREDENTIAL_KEY_BYTES]).unwrap();
    restore_read_only_connection_credentials(
        directory.path(),
        "project-a",
        "readonly",
        &mut restored,
        &protected.ciphertext,
        &protected.nonce,
    )
    .unwrap();
    assert_eq!(restored, original);
    for (project, connection) in [
        ("other-project", "readonly"),
        ("project-a", "other-connection"),
    ] {
        assert!(restore_read_only_connection_credentials(
            directory.path(),
            project,
            connection,
            &mut safe.clone(),
            &protected.ciphertext,
            &protected.nonce
        )
        .is_err());
    }
    assert!(restore_read_only_connection_credentials(
        directory.path(),
        "project-a",
        "readonly",
        &mut safe.clone(),
        &protected.ciphertext,
        &[1, 2]
    )
    .is_err());
    assert_eq!(
        std::fs::read(&key_path).unwrap(),
        vec![7_u8; CONNECTION_CREDENTIAL_KEY_BYTES]
    );
}

#[tokio::test]
async fn connection_credentials_are_encrypted_outside_metadata_json() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();
    let connection = SavedConnection {
        id: "secure".into(),
        project_id: "sqls".into(),
        name: "Secure".into(),
        driver: "postgres".into(),
        config: serde_json::json!({
            "id": "secure",
            "projectId": "sqls",
            "name": "Secure",
            "driver": "postgres",
            "url": "postgres://app:top-secret@example.test/db",
            "password": "top-secret",
            "sshTunnel": {
                "password": "ssh-secret",
                "privateKeyPassphrase": "key-secret",
                "jumpHosts": [{
                    "host": "bastion-2.example.test",
                    "password": "jump-secret",
                    "privateKeyPassphrase": "jump-key-secret"
                }]
            }
        }),
        created_at: 1,
        updated_at: 1,
    };
    store.save_connection(&connection).await.unwrap();

    let raw: String =
        sqlx::query_scalar("SELECT CAST(config AS TEXT) FROM connections WHERE id = 'secure'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert!(!raw.contains("top-secret"));
    assert!(!raw.contains("ssh-secret"));
    assert!(!raw.contains("jump-secret"));
    assert!(!raw.contains("jump-key-secret"));
    assert!(!raw.contains("postgres://"));
    let ciphertext: Vec<u8> = sqlx::query_scalar(
        "SELECT ciphertext FROM connection_credentials
             WHERE project_id = 'sqls' AND connection_id = 'secure'",
    )
    .fetch_one(&store.pool)
    .await
    .unwrap();
    assert!(!String::from_utf8_lossy(&ciphertext).contains("top-secret"));

    let restored = store.get_connections("sqls").await.unwrap();
    assert_eq!(restored, vec![connection]);
}

#[tokio::test]
async fn migrates_legacy_projects_with_nullable_root_path() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::query(
        r#"
            CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO projects (id, name, created_at, updated_at) VALUES ('legacy', 'Legacy', 1, 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();

    let legacy = store.get_project("legacy").await.unwrap().unwrap();
    assert_eq!(legacy.root_path, None);
    let updated = store
        .set_project_root("legacy", Some("C:/workspace"))
        .await
        .unwrap();
    assert_eq!(updated.root_path.as_deref(), Some("C:/workspace"));

    let columns = sqlx::query("PRAGMA table_info(projects)")
        .fetch_all(&store.pool)
        .await
        .unwrap();
    assert!(columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "root_path"));
}

#[tokio::test]
async fn deletes_project_connections_and_cached_resources_without_touching_default() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();

    let project = Project {
        id: "workspace".to_string(),
        name: "Workspace".to_string(),
        root_path: Some("/tmp/workspace".to_string()),
        created_at: 1,
        updated_at: 1,
    };
    store.save_project(&project).await.unwrap();
    store
        .save_connection(&SavedConnection {
            id: "connection".to_string(),
            project_id: project.id.clone(),
            name: "Database".to_string(),
            driver: "postgres".to_string(),
            config: serde_json::json!({}),
            created_at: 1,
            updated_at: 1,
        })
        .await
        .unwrap();
    store
        .save_resources(
            &project.id,
            &[Resource {
                id: "schema".to_string(),
                project_id: project.id.clone(),
                connection_id: "connection".to_string(),
                parent_id: None,
                kind: "SCHEMA".to_string(),
                name: "public".to_string(),
                metadata: serde_json::json!({}),
                last_updated: 1,
            }],
        )
        .await
        .unwrap();

    store.delete_project(&project.id).await.unwrap();

    assert!(store.get_project(&project.id).await.unwrap().is_none());
    assert!(store.get_connections(&project.id).await.unwrap().is_empty());
    let resource_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM resources WHERE project_id = ?")
            .bind(&project.id)
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert_eq!(resource_count, 0);

    assert!(store.delete_project("sqls").await.is_err());
    assert!(store.get_project("sqls").await.unwrap().is_some());
}
