use crate::core::protocol::Response;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfig {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionRequest {
    pub config: AiProviderConfig,
    pub messages: Vec<AiChatMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionResult {
    pub content: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderTestResult {
    pub message: String,
    pub model: String,
}

#[tauri::command]
pub async fn ai_chat_completion(
    request: AiChatCompletionRequest,
) -> Result<Response<AiChatCompletionResult>, String> {
    match send_chat_completion(request).await {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("AI_CHAT_COMPLETION_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn ai_test_provider(
    config: AiProviderConfig,
) -> Result<Response<AiProviderTestResult>, String> {
    let model = config.model.trim().to_string();
    let request = AiChatCompletionRequest {
        config,
        messages: vec![
            AiChatMessage {
                role: "system".to_string(),
                content: "Reply with a short plain-text readiness confirmation.".to_string(),
            },
            AiChatMessage {
                role: "user".to_string(),
                content: "Connection test".to_string(),
            },
        ],
        temperature: Some(0.0),
        max_tokens: Some(16),
    };

    match send_chat_completion(request).await {
        Ok(_) => Ok(Response::ok(AiProviderTestResult {
            message: "AI provider connection is available".to_string(),
            model,
        })),
        Err(error) => Ok(Response::err("AI_PROVIDER_TEST_ERROR", &error)),
    }
}

async fn send_chat_completion(
    request: AiChatCompletionRequest,
) -> Result<AiChatCompletionResult, String> {
    validate_config(&request.config)?;
    if request.messages.is_empty() {
        return Err("At least one model message is required".to_string());
    }

    let url = chat_completions_url(&request.config.base_url)?;
    let timeout = Duration::from_millis(request.config.timeout_ms.unwrap_or(30_000).max(1_000));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())?;

    let mut builder = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": request.config.model.trim(),
            "messages": request.messages,
            "temperature": request.temperature.unwrap_or(0.0),
            "max_tokens": request.max_tokens.unwrap_or(1024),
            "stream": false
        }));

    if let Some(api_key) = request.config.api_key.as_deref().map(str::trim) {
        if !api_key.is_empty() {
            builder = builder.header(AUTHORIZATION, format!("Bearer {api_key}"));
        }
    }

    let response = builder.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|error| format!("AI provider returned invalid JSON: {error}"))?;

    if !status.is_success() {
        return Err(provider_error_message(status.as_u16(), &value));
    }

    let content = value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/message/content").and_then(Value::as_str))
        .ok_or_else(|| "AI provider response did not include message content".to_string())?
        .to_string();
    let model = value
        .get("model")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    Ok(AiChatCompletionResult { content, model })
}

fn validate_config(config: &AiProviderConfig) -> Result<(), String> {
    if config.base_url.trim().is_empty() {
        return Err("AI provider base URL is required".to_string());
    }
    if config.model.trim().is_empty() {
        return Err("AI model is required".to_string());
    }
    Ok(())
}

fn chat_completions_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("AI provider base URL is required".to_string());
    }
    if trimmed.ends_with("/chat/completions") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}/chat/completions"))
    }
}

fn provider_error_message(status: u16, value: &Value) -> String {
    let message = value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| value.get("message").and_then(Value::as_str))
        .unwrap_or("AI provider request failed");
    format!("AI provider returned HTTP {status}: {message}")
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
