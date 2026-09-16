use super::*;
use sqlx::sqlite::SqlitePoolOptions;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

fn cache_test_config() -> CliProviderConfig {
    CliProviderConfig {
        kind: CliProviderKind::CodexCli,
        profile_id: "work-profile".to_string(),
        executable_path: Some("/private/tools/codex".to_string()),
        model: "default".to_string(),
        reasoning_effort: None,
        service_tier: None,
        access_mode: None,
        timeout_ms: Some(30_000),
        environment_keys: vec!["Z_TOKEN".to_string(), "HTTPS_PROXY".to_string()],
    }
}

async fn cache_test_store() -> MetaStore {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();
    store
}

#[tokio::test]
async fn capability_cache_key_tracks_identity_version_environment_and_effort_model() {
    let store = cache_test_store().await;
    let config = cache_test_config();
    let environment = BTreeMap::from([
        (
            "HTTPS_PROXY".to_string(),
            "https://secret.example.test".to_string(),
        ),
        ("Z_TOKEN".to_string(), "top-secret-token".to_string()),
    ]);
    let base =
        cli_capability_cache_key(&store, &config, &environment, "models", Some("codex 1.2.3"))
            .unwrap();
    let mut reordered = config.clone();
    reordered.environment_keys = vec![
        " HTTPS_PROXY ".to_string(),
        "Z_TOKEN".to_string(),
        "HTTPS_PROXY".to_string(),
    ];
    assert_eq!(
        base,
        cli_capability_cache_key(
            &store,
            &reordered,
            &environment,
            "models",
            Some(" codex 1.2.3 "),
        )
        .unwrap()
    );

    let variants = [
        cli_capability_cache_key(&store, &config, &environment, "models", Some("codex 1.2.4"))
            .unwrap(),
        cli_capability_cache_key(
            &store,
            &CliProviderConfig {
                executable_path: Some("/different/codex".to_string()),
                ..config.clone()
            },
            &environment,
            "models",
            Some("codex 1.2.3"),
        )
        .unwrap(),
        cli_capability_cache_key(
            &store,
            &CliProviderConfig {
                profile_id: "another-profile".to_string(),
                ..config.clone()
            },
            &environment,
            "models",
            Some("codex 1.2.3"),
        )
        .unwrap(),
        cli_capability_cache_key(
            &store,
            &CliProviderConfig {
                kind: CliProviderKind::CodebuddyCli,
                ..config.clone()
            },
            &environment,
            "models",
            Some("codex 1.2.3"),
        )
        .unwrap(),
        cli_capability_cache_key(
            &store,
            &config,
            &BTreeMap::from([
                (
                    "HTTPS_PROXY".to_string(),
                    "https://changed.example.test".to_string(),
                ),
                ("Z_TOKEN".to_string(), "top-secret-token".to_string()),
            ]),
            "models",
            Some("codex 1.2.3"),
        )
        .unwrap(),
        cli_capability_cache_key(
            &store,
            &config,
            &environment,
            "commands",
            Some("codex 1.2.3"),
        )
        .unwrap(),
    ];
    assert!(variants.iter().all(|variant| variant != &base));

    let effort_default = cli_capability_cache_key(
        &store,
        &config,
        &environment,
        "efforts",
        Some("codex 1.2.3"),
    )
    .unwrap();
    let effort_selected = cli_capability_cache_key(
        &store,
        &CliProviderConfig {
            model: "gpt-selected".to_string(),
            ..config.clone()
        },
        &environment,
        "efforts",
        Some("codex 1.2.3"),
    )
    .unwrap();
    assert_ne!(effort_default, effort_selected);
    assert!(!base.contains("work-profile"));
    assert!(!base.contains("private"));
    assert!(!base.contains("secret"));
}

#[tokio::test]
async fn persistent_capability_cache_honors_ttl_force_and_last_known_good() {
    let store = cache_test_store().await;
    let config = cache_test_config();
    let environment = BTreeMap::from([(
        "HTTPS_PROXY".to_string(),
        "https://secret.example.test".to_string(),
    )]);
    let calls = Arc::new(AtomicUsize::new(0));
    let now = cli_capability_cache_now_ms();

    let first_calls = calls.clone();
    let first = load_cached_cli_capability(
        &store,
        &config,
        &environment,
        "models",
        Some("codex 1.2.3"),
        false,
        now,
        move || async move {
            first_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec!["first".to_string()])
        },
    )
    .await
    .unwrap();
    assert_eq!(first, ["first"]);

    let cached_calls = calls.clone();
    let cached = load_cached_cli_capability(
        &store,
        &config,
        &environment,
        "models",
        Some("codex 1.2.3"),
        false,
        now + 1,
        move || async move {
            cached_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec!["should-not-run".to_string()])
        },
    )
    .await
    .unwrap();
    assert_eq!(cached, ["first"]);
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    let force_calls = calls.clone();
    let forced = load_cached_cli_capability(
        &store,
        &config,
        &environment,
        "models",
        Some("codex 1.2.3"),
        true,
        now + 2,
        move || async move {
            force_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec!["refreshed".to_string()])
        },
    )
    .await
    .unwrap();
    assert_eq!(forced, ["refreshed"]);

    let failed_calls = calls.clone();
    let failed: anyhow::Result<Vec<String>> = load_cached_cli_capability(
        &store,
        &config,
        &environment,
        "models",
        Some("codex 1.2.3"),
        true,
        now + 3,
        move || async move {
            failed_calls.fetch_add(1, Ordering::SeqCst);
            Err(anyhow::anyhow!("refresh failed"))
        },
    )
    .await;
    assert!(failed.is_err());

    let retained_calls = calls.clone();
    let retained = load_cached_cli_capability(
        &store,
        &config,
        &environment,
        "models",
        Some("codex 1.2.3"),
        false,
        now + 4,
        move || async move {
            retained_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec!["should-not-run".to_string()])
        },
    )
    .await
    .unwrap();
    assert_eq!(retained, ["refreshed"]);
    assert_eq!(calls.load(Ordering::SeqCst), 3);

    let expired_calls = calls.clone();
    let expired = load_cached_cli_capability(
        &store,
        &config,
        &environment,
        "models",
        Some("codex 1.2.3"),
        false,
        now + CLI_CAPABILITY_CACHE_TTL_MS + 5,
        move || async move {
            expired_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec!["after-ttl".to_string()])
        },
    )
    .await
    .unwrap();
    assert_eq!(expired, ["after-ttl"]);
    assert_eq!(calls.load(Ordering::SeqCst), 4);
}

#[tokio::test]
async fn incompatible_persistent_cache_fails_open_and_is_replaced() {
    let store = cache_test_store().await;
    let config = cache_test_config();
    let environment = BTreeMap::new();
    let now = cli_capability_cache_now_ms();
    let cache_key = cli_capability_cache_key(
        &store,
        &config,
        &environment,
        "commands",
        Some("codex 1.2.3"),
    )
    .unwrap();
    store
        .save_cli_capability_cache(
            &cache_key,
            "commands",
            &json!({ "oldSchema": true }),
            now + CLI_CAPABILITY_CACHE_TTL_MS,
        )
        .await
        .unwrap();

    let calls = Arc::new(AtomicUsize::new(0));
    let live_calls = calls.clone();
    let live: Vec<String> = load_cached_cli_capability(
        &store,
        &config,
        &environment,
        "commands",
        Some("codex 1.2.3"),
        false,
        now,
        move || async move {
            live_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec!["status".to_string()])
        },
    )
    .await
    .unwrap();
    assert_eq!(live, ["status"]);

    let cached_calls = calls.clone();
    let cached: Vec<String> = load_cached_cli_capability(
        &store,
        &config,
        &environment,
        "commands",
        Some("codex 1.2.3"),
        false,
        now + 1,
        move || async move {
            cached_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec!["should-not-run".to_string()])
        },
    )
    .await
    .unwrap();
    assert_eq!(cached, ["status"]);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn chat_completion_url_appends_path_once() {
    assert_eq!(
        chat_completions_url("https://api.openai.com/v1").unwrap(),
        "https://api.openai.com/v1/chat/completions"
    );
    assert_eq!(
        chat_completions_url("http://localhost:11434/v1/chat/completions").unwrap(),
        "http://localhost:11434/v1/chat/completions"
    );
}

#[test]
fn provider_error_prefers_openai_error_message() {
    let value = json!({
        "error": {
            "message": "invalid api key"
        }
    });

    assert_eq!(
        provider_error_message(401, &value),
        "AI provider returned HTTP 401: invalid api key"
    );
}

#[test]
fn provider_endpoint_switches_between_chat_and_fim() {
    assert_eq!(
        provider_endpoint_url("http://localhost:11434/v1/chat/completions", "completions").unwrap(),
        "http://localhost:11434/v1/completions"
    );
    assert_eq!(
        provider_endpoint_url("http://localhost:11434/v1/completions", "chat/completions").unwrap(),
        "http://localhost:11434/v1/chat/completions"
    );
}

#[test]
fn cli_effort_lookup_prefers_the_requested_model_over_synthetic_default() {
    let mut default = CliModelInfo::new("default", "Default", true);
    default.reasoning_efforts = vec!["low".to_string(), "medium".to_string()];
    let mut selected = CliModelInfo::new("gpt-selected", "GPT selected", false);
    selected.reasoning_efforts = vec!["high".to_string(), "xhigh".to_string()];
    let models = vec![default, selected];

    assert_eq!(
        model_efforts_for_selection(&models, "gpt-selected"),
        ["high", "xhigh"]
    );
    assert_eq!(
        model_efforts_for_selection(&models, "missing"),
        ["low", "medium"]
    );
}

#[test]
fn classifies_cli_recovery_errors_without_exposing_provider_wording_to_ui_logic() {
    assert_eq!(
        cli_operation_error_code("AI_CLI_TEST_ERROR", "CodeBuddy Code is not authenticated"),
        "AI_CLI_AUTH_REQUIRED"
    );
    assert_eq!(
        cli_operation_error_code("AI_CLI_MODEL_DISCOVERY_ERROR", "failed to start codex"),
        "AI_CLI_NOT_INSTALLED"
    );
    assert_eq!(
        cli_operation_error_code(
            "AI_CLI_COMMAND_DISCOVERY_ERROR",
            "ACP capability discovery timed out"
        ),
        "AI_CLI_TIMEOUT"
    );
    assert_eq!(
        cli_operation_error_code("AI_CLI_TEST_ERROR", "unexpected provider output"),
        "AI_CLI_TEST_ERROR"
    );
}

#[test]
fn inline_completion_timeout_honors_the_editor_setting() {
    for (configured, expected) in [
        (None, 4_000),
        (Some(500), 1_000),
        (Some(10_000), 10_000),
        (Some(15_000), 15_000),
        (Some(60_000), 15_000),
    ] {
        assert_eq!(
            inline_completion_timeout(configured),
            Duration::from_millis(expected)
        );
    }
}

#[test]
fn inline_completion_cleanup_removes_fences_and_bounds_lines() {
    assert_eq!(
        clean_inline_completion("```sql\nSELECT 1\nFROM dual\n```"),
        "SELECT 1\nFROM dual"
    );
    let many_lines = (0..20)
        .map(|index| index.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(clean_inline_completion(&many_lines).lines().count(), 12);
    let unicode = format!("{}end", "数".repeat(3_000));
    let tail = truncate_utf8_tail(&unicode, 8_192);
    assert!(tail.len() <= 8_192);
    assert!(tail.ends_with("end"));
}

#[tokio::test]
async fn cancellation_reaches_active_and_not_yet_registered_requests() {
    let state = AiCancellationState::default();
    let mut active = state.register("active").await.unwrap();
    assert!(state.cancel("active").await);
    active.changed().await.unwrap();
    assert!(*active.borrow());

    assert!(state.cancel("early").await);
    assert_eq!(
        state.register("early").await.unwrap_err(),
        "AI request cancelled"
    );
}
