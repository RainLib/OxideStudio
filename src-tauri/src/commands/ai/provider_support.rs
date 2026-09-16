use super::{
    load_provider_headers, load_scoped_provider_secret, AiProviderConfig, AppHandle, Value,
};

pub(super) fn validate_config(config: &AiProviderConfig) -> Result<(), String> {
    if config.base_url.trim().is_empty() {
        return Err("AI provider base URL is required".to_string());
    }
    if config.model.trim().is_empty() {
        return Err("AI model is required".to_string());
    }
    Ok(())
}

pub(super) async fn hydrate_provider_secret(
    app: &AppHandle,
    scope: &str,
    config: &mut AiProviderConfig,
) -> Result<(), String> {
    if config
        .api_key
        .as_deref()
        .is_some_and(|secret| !secret.trim().is_empty())
    {
        return Ok(());
    }
    config.api_key = load_scoped_provider_secret(app, scope, &config.base_url)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) async fn hydrate_provider_headers(
    app: &AppHandle,
    scope: &str,
    config: &mut AiProviderConfig,
) -> Result<(), String> {
    config.custom_headers = load_provider_headers(app, scope, &config.base_url)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn chat_completions_url(base_url: &str) -> Result<String, String> {
    provider_endpoint_url(base_url, "chat/completions")
}

pub(super) fn provider_endpoint_url(base_url: &str, endpoint: &str) -> Result<String, String> {
    let mut trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("AI provider base URL is required".to_string());
    }
    for suffix in ["/chat/completions", "/completions"] {
        if let Some(base) = trimmed.strip_suffix(suffix) {
            trimmed = base.trim_end_matches('/');
            break;
        }
    }
    Ok(format!("{trimmed}/{endpoint}"))
}

pub(super) fn provider_error_message(status: u16, value: &Value) -> String {
    let message = value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| value.get("message").and_then(Value::as_str))
        .unwrap_or("AI provider request failed");
    format!("AI provider returned HTTP {status}: {message}")
}
