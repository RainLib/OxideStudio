use super::{
    chat_completions_url, hydrate_provider_headers, hydrate_provider_secret, json,
    normalize_provider_secret, provider_error_message, provider_header_map, validate_config,
    AiChatCompletionRequest, AiChatCompletionResult, AppHandle, Duration, Value, AUTHORIZATION,
    CONTENT_TYPE,
};

pub(super) async fn send_chat_completion(
    app: &AppHandle,
    mut request: AiChatCompletionRequest,
) -> Result<AiChatCompletionResult, String> {
    hydrate_provider_secret(app, "assistant", &mut request.config).await?;
    hydrate_provider_headers(app, "assistant", &mut request.config).await?;
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

    if let Some(api_key) = request
        .config
        .api_key
        .as_deref()
        .map(normalize_provider_secret)
    {
        if !api_key.is_empty() {
            builder = builder.header(AUTHORIZATION, format!("Bearer {api_key}"));
        }
    }
    builder = builder.headers(
        provider_header_map(&request.config.custom_headers).map_err(|error| error.to_string())?,
    );

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
