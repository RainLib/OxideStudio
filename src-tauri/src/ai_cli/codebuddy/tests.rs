use super::acp::{
    has_authenticated_user, parse_acp_model_options, parse_available_commands,
    parse_available_commands_notification, parse_effort_options,
};
use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn requires_a_real_acp_user_payload() {
    assert!(has_authenticated_user(&json!({
        "userInfo": { "userName": "account", "token": "must-not-escape" }
    })));
    assert!(!has_authenticated_user(&json!({ "userInfo": null })));
    assert!(!has_authenticated_user(
        &json!({ "apiKeySource": "www.codebuddy.ai" })
    ));
}

#[test]
fn parses_acp_model_catalog_without_cross_model_effort_pollution() {
    let value = json!({
        "configOptions": [
            {
                "id": "model",
                "currentValue": "hy3",
                "options": [
                    { "value": "default-model", "name": "Provider Default" },
                    { "value": "default", "name": "Duplicate Default" },
                    { "value": "hy3", "name": "Hy3" },
                    { "value": " hy3 ", "name": "Duplicate Hy3" },
                    { "value": "glm-5.2", "name": "GLM-5.2" }
                ]
            },
            {
                "id": "thought_level",
                "currentValue": "enabled",
                "options": [{"value":"minimal"},{"value":"max"},{"value":"enabled"}]
            }
        ]
    });
    let efforts = parse_effort_options(&value);
    let models = parse_acp_model_options(&value);
    assert_eq!(
        models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        ["default", "hy3", "glm-5.2"]
    );
    assert!(models[0].is_default);
    assert_eq!(models.iter().filter(|model| model.is_default).count(), 1);
    assert!(models.iter().skip(1).all(|model| !model.is_default));
    assert!(models
        .iter()
        .all(|model| model.reasoning_efforts.is_empty()));
    assert_eq!(efforts, ["minimal", "max"]);
}

#[test]
fn effort_cache_key_is_model_specific_and_normalized() {
    let command = CliCommandSpec {
        program: "codebuddy".to_string(),
        prefix_args: vec!["--profile".to_string(), "work".to_string()],
        resolved_path: None,
    };
    let environment = BTreeMap::from([("CODEBUDDY_REGION".to_string(), "cn".to_string())]);

    let hy3 = effort_cache_key(&command, &environment, &normalize_model_id(" hy3 "));
    let glm = effort_cache_key(&command, &environment, &normalize_model_id("glm-5.2"));
    let default_model =
        effort_cache_key(&command, &environment, &normalize_model_id("default-model"));
    let default = effort_cache_key(&command, &environment, &normalize_model_id("default"));

    assert_ne!(hy3, glm);
    assert_eq!(default_model, default);
}

#[test]
fn filters_codebuddy_commands_for_the_embedded_surface() {
    let commands = parse_available_commands(&json!({
        "availableCommands": [
            { "name": "goal", "description": "Keep working" },
            { "name": "login", "description": "Open terminal login" },
            { "name": "compact", "description": "Compact context" }
        ]
    }));
    assert_eq!(
        commands
            .iter()
            .map(|command| command.name.as_str())
            .collect::<Vec<_>>(),
        ["goal", "compact"]
    );
    assert!(commands[0].argument_hint.is_some());
}

#[test]
fn parses_available_command_notifications_without_exposing_unknown_commands() {
    let commands = parse_available_commands_notification(&json!({
        "method": "session/update",
        "params": {
            "update": {
                "sessionUpdate": "available_commands_update",
                "availableCommands": [
                    { "name": "review", "description": "Review context" },
                    { "name": "unsafe-internal", "description": "Not embedded" }
                ]
            }
        }
    }))
    .expect("command notification");

    assert_eq!(commands.len(), 1);
    assert_eq!(commands[0].name, "review");
    assert!(parse_available_commands_notification(&json!({
        "method": "session/update",
        "params": { "update": { "sessionUpdate": "other" } }
    }))
    .is_none());
}

#[tokio::test]
async fn concurrent_capability_requests_share_one_discovery() {
    static NEXT_KEY: AtomicUsize = AtomicUsize::new(10_000);
    let key = NEXT_KEY.fetch_add(1, Ordering::Relaxed) as u64;
    let discoveries = Arc::new(AtomicUsize::new(0));
    let discover_one = discoveries.clone();
    let discover_two = discoveries.clone();

    let first = get_or_discover_capabilities_by_key(key, false, move || async move {
        discover_one.fetch_add(1, Ordering::SeqCst);
        tokio::task::yield_now().await;
        Ok(CachedCapabilities {
            loaded_at: Instant::now(),
            models: vec![CliModelInfo::new("default", "Default", true)],
            commands: Some(vec![CliCommandInfo::new("review", "Review context")]),
            current_model: Some("hy3".to_string()),
        })
    });
    let second = get_or_discover_capabilities_by_key(key, false, move || async move {
        discover_two.fetch_add(1, Ordering::SeqCst);
        Ok(CachedCapabilities {
            loaded_at: Instant::now(),
            models: vec![CliModelInfo::new("default", "Default", true)],
            commands: None,
            current_model: None,
        })
    });

    let (first, second) = tokio::join!(first, second);
    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(discoveries.load(Ordering::SeqCst), 1);
    assert_eq!(first.current_model, Some("hy3".to_string()));
    assert_eq!(second.current_model, Some("hy3".to_string()));
    assert_eq!(second.commands.unwrap()[0].name, "review");

    let refreshed = get_or_discover_capabilities_by_key(key, true, || async {
        Ok(CachedCapabilities {
            loaded_at: Instant::now(),
            models: vec![CliModelInfo::new("refreshed", "Refreshed", false)],
            commands: Some(vec![CliCommandInfo::new("status", "Fresh status")]),
            current_model: Some("refreshed".to_string()),
        })
    })
    .await
    .unwrap();
    assert_eq!(refreshed.models[0].id, "refreshed");

    let failed = get_or_discover_capabilities_by_key(key, true, || async {
        Err(anyhow!("forced refresh failed"))
    })
    .await;
    assert!(failed.is_err());
    let retained = get_or_discover_capabilities_by_key(key, false, || async {
        unreachable!("a failed forced refresh must retain the previous capability cache")
    })
    .await
    .unwrap();
    assert_eq!(retained.models[0].id, "refreshed");

    CAPABILITY_CACHE.lock().await.remove(&key);
    CAPABILITY_DISCOVERY_LOCKS.lock().await.remove(&key);
}

#[tokio::test]
async fn concurrent_effort_requests_share_one_model_scoped_discovery() {
    static NEXT_KEY: AtomicUsize = AtomicUsize::new(20_000);
    let key = NEXT_KEY.fetch_add(1, Ordering::Relaxed) as u64;
    let discoveries = Arc::new(AtomicUsize::new(0));
    let discover_one = discoveries.clone();
    let discover_two = discoveries.clone();

    let first = get_or_discover_efforts_by_key(key, false, move || async move {
        discover_one.fetch_add(1, Ordering::SeqCst);
        tokio::task::yield_now().await;
        Ok(vec!["low".to_string(), "high".to_string()])
    });
    let second = get_or_discover_efforts_by_key(key, false, move || async move {
        discover_two.fetch_add(1, Ordering::SeqCst);
        Ok(vec!["incorrect-second-result".to_string()])
    });

    let (first, second) = tokio::join!(first, second);
    assert_eq!(discoveries.load(Ordering::SeqCst), 1);
    let expected = vec!["low".to_string(), "high".to_string()];
    assert_eq!(first.unwrap(), expected);
    assert_eq!(second.unwrap(), expected);

    let refreshed =
        get_or_discover_efforts_by_key(key, true, || async { Ok(vec!["max".to_string()]) })
            .await
            .unwrap();
    assert_eq!(refreshed, ["max"]);
    assert!(get_or_discover_efforts_by_key(key, true, || async {
        Err(anyhow!("forced effort refresh failed"))
    })
    .await
    .is_err());
    let retained = get_or_discover_efforts_by_key(key, false, || async {
        unreachable!("a failed forced refresh must retain the previous effort cache")
    })
    .await
    .unwrap();
    assert_eq!(retained, ["max"]);

    EFFORT_CACHE.lock().await.remove(&key);
    EFFORT_DISCOVERY_LOCKS.lock().await.remove(&key);
}

#[test]
fn parses_dynamic_acp_effort_options() {
    let efforts = parse_effort_options(&json!({
        "configOptions": [{
            "id": "thought_level",
            "options": [{"value":"enabled"},{"value":"medium"},{"value":"xhigh"}]
        }]
    }));
    assert_eq!(efforts, ["medium", "xhigh"]);
}
