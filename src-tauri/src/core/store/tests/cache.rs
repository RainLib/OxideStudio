use super::super::*;

#[tokio::test]
async fn cli_capability_cache_is_idempotent_private_and_ttl_bound() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();
    // Startup may retry setup; the table and index migration must remain
    // safe when executed more than once.
    store.init().await.unwrap();

    let secret = "https://user:top-secret@proxy.example.test";
    let fields = [
        ("provider", "codex-cli"),
        ("profile", "work-profile"),
        ("path", "/private/tools/codex"),
        ("environmentName", "HTTPS_PROXY"),
        ("environmentValue", secret),
    ];
    let cache_key = store
        .opaque_cache_key("cli-capability-catalog-v1", fields)
        .unwrap();
    let same_key = store
        .opaque_cache_key("cli-capability-catalog-v1", fields)
        .unwrap();
    let changed_key = store
        .opaque_cache_key(
            "cli-capability-catalog-v1",
            [
                ("provider", "codex-cli"),
                ("profile", "work-profile"),
                ("path", "/private/tools/codex"),
                ("environmentName", "HTTPS_PROXY"),
                ("environmentValue", "https://different.example.test"),
            ],
        )
        .unwrap();
    assert_eq!(cache_key, same_key);
    assert_ne!(cache_key, changed_key);
    assert_eq!(cache_key.len(), CLI_CAPABILITY_CACHE_KEY_HEX_LENGTH);
    assert!(!cache_key.contains("codex"));

    let now = current_timestamp_millis();
    let expires_at = now + 60_000;
    let payload = serde_json::json!([{
        "id": "gpt-test",
        "label": "GPT Test",
        "isDefault": false
    }]);
    store
        .save_cli_capability_cache(&cache_key, "models", &payload, expires_at)
        .await
        .unwrap();
    assert_eq!(
        store
            .get_cli_capability_cache(&cache_key, "models", now)
            .await
            .unwrap(),
        Some(payload)
    );
    assert!(store
        .get_cli_capability_cache(&cache_key, "models", expires_at)
        .await
        .unwrap()
        .is_none());

    let raw: String = sqlx::query_scalar(
        "SELECT cache_key || payload FROM cli_capability_cache WHERE cache_key = ?",
    )
    .bind(&cache_key)
    .fetch_one(&store.pool)
    .await
    .unwrap();
    for private_value in [secret, "work-profile", "/private/tools/codex"] {
        assert!(!raw.contains(private_value));
    }
    assert!(store
        .get_cli_capability_cache("not-a-digest", "models", now)
        .await
        .is_err());
    assert!(store
        .save_cli_capability_cache(&cache_key, "unknown", &serde_json::json!([]), expires_at)
        .await
        .is_err());
}

#[tokio::test]
async fn cli_capability_cache_surfaces_corrupt_json_as_a_cache_error() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();
    let cache_key = store
        .opaque_cache_key("cli-capability-catalog-v1", [("provider", "codebuddy-cli")])
        .unwrap();
    sqlx::query(
        r#"
            INSERT INTO cli_capability_cache
                (cache_key, resource_kind, payload, updated_at, expires_at)
            VALUES (?, 'commands', '{broken-json', ?, ?)
            "#,
    )
    .bind(&cache_key)
    .bind(current_timestamp_millis())
    .bind(current_timestamp_millis() + 60_000)
    .execute(&store.pool)
    .await
    .unwrap();

    assert!(store
        .get_cli_capability_cache(&cache_key, "commands", current_timestamp_millis())
        .await
        .is_err());
}
