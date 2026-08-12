use crate::{
    ai_cli::{
        codebuddy, codex, setup, CliAuthenticationLaunchResult, CliCommandInfo,
        CliConnectionTestResult, CliDetectionResult, CliEnvironmentRequest, CliInstallResult,
        CliModelInfo, CliProfileRequest, CliProviderConfig, CliProviderKind,
    },
    core::{
        cli_provider_secret::{load_cli_environment, save_cli_environment},
        protocol::Response,
        provider_secret::{
            has_provider_secret, load_provider_secret, normalize_provider_secret,
            save_provider_secret,
        },
    },
};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::sync::{watch, Mutex};

const MAX_EARLY_CANCELLATIONS: usize = 256;

#[derive(Default)]
struct AiCancellationInner {
    active: HashMap<String, watch::Sender<bool>>,
    cancelled_before_start: HashSet<String>,
}

#[derive(Default)]
pub struct AiCancellationState {
    inner: Mutex<AiCancellationInner>,
}

impl AiCancellationState {
    async fn register(&self, request_id: &str) -> Result<watch::Receiver<bool>, String> {
        let mut inner = self.inner.lock().await;
        if inner.cancelled_before_start.remove(request_id) {
            return Err("AI request cancelled".to_string());
        }
        if inner.active.contains_key(request_id) {
            return Err(format!("AI request id is already active: {request_id}"));
        }

        let (sender, receiver) = watch::channel(false);
        inner.active.insert(request_id.to_string(), sender);
        Ok(receiver)
    }

    async fn finish(&self, request_id: &str) {
        self.inner.lock().await.active.remove(request_id);
    }

    async fn cancel(&self, request_id: &str) -> bool {
        let mut inner = self.inner.lock().await;
        if let Some(sender) = inner.active.remove(request_id) {
            let _ = sender.send(true);
            return true;
        }

        if inner.cancelled_before_start.len() >= MAX_EARLY_CANCELLATIONS {
            inner.cancelled_before_start.clear();
        }
        inner.cancelled_before_start.insert(request_id.to_string());
        true
    }
}

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
    pub request_id: Option<String>,
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

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InlineCompletionProtocol {
    ChatCompletions,
    TextCompletionsFim,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnippet {
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInlineCompletionRequest {
    pub request_id: String,
    pub protocol: InlineCompletionProtocol,
    pub config: AiProviderConfig,
    pub prefix: String,
    pub suffix: String,
    pub language_id: String,
    pub dialect: String,
    pub file_path: Option<String>,
    #[serde(default)]
    pub lsp_context: Value,
    #[serde(default)]
    pub related_snippets: Vec<ProjectSnippet>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiInlineCompletionResult {
    pub text: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderTestResult {
    pub message: String,
    pub model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderSecretRequest {
    pub base_url: String,
    pub api_key: Option<String>,
}

#[tauri::command]
pub async fn ai_set_provider_secret(
    app: AppHandle,
    request: AiProviderSecretRequest,
) -> Result<Response<bool>, String> {
    match save_provider_secret(&app, &request.base_url, request.api_key).await {
        Ok(saved) => Ok(Response::ok(saved)),
        Err(error) => Ok(Response::err(
            "AI_PROVIDER_SECRET_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_has_provider_secret(
    app: AppHandle,
    base_url: String,
) -> Result<Response<bool>, String> {
    match has_provider_secret(&app, &base_url).await {
        Ok(available) => Ok(Response::ok(available)),
        Err(error) => Ok(Response::err(
            "AI_PROVIDER_SECRET_ERROR",
            &error.to_string(),
        )),
    }
}

async fn cli_environment(
    app: &AppHandle,
    provider: CliProviderKind,
    profile_id: &str,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    load_cli_environment(app, provider.as_str(), profile_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn ai_cli_set_environment(
    app: AppHandle,
    request: CliEnvironmentRequest,
) -> Result<Response<Vec<String>>, String> {
    match save_cli_environment(
        &app,
        request.provider.as_str(),
        &request.profile_id,
        request.environment,
    )
    .await
    {
        Ok(keys) => Ok(Response::ok(keys)),
        Err(error) => Ok(Response::err(
            "AI_CLI_ENVIRONMENT_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_cli_get_environment(
    app: AppHandle,
    request: CliProfileRequest,
) -> Result<Response<std::collections::BTreeMap<String, String>>, String> {
    match cli_environment(&app, request.provider, &request.profile_id).await {
        Ok(environment) => Ok(Response::ok(environment)),
        Err(error) => Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn ai_cli_detect(
    app: AppHandle,
    config: CliProviderConfig,
) -> Result<Response<CliDetectionResult>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let result = match config.kind {
        CliProviderKind::CodexCli => {
            codex::detect(config.executable_path.as_deref(), &environment).await
        }
        CliProviderKind::CodebuddyCli => {
            codebuddy::detect(config.executable_path.as_deref(), &environment).await
        }
    };
    Ok(Response::ok(result))
}

#[tauri::command]
pub async fn ai_cli_list_models(
    app: AppHandle,
    config: CliProviderConfig,
) -> Result<Response<Vec<CliModelInfo>>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let result = match config.kind {
        CliProviderKind::CodexCli => codex::list_models(&config, &environment).await,
        CliProviderKind::CodebuddyCli => codebuddy::list_models(&config, &environment).await,
    };
    match result {
        Ok(models) => Ok(Response::ok(models)),
        Err(error) => Ok(Response::err(
            "AI_CLI_MODEL_DISCOVERY_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_cli_list_efforts(
    app: AppHandle,
    config: CliProviderConfig,
) -> Result<Response<Vec<String>>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let result = match config.kind {
        CliProviderKind::CodexCli => {
            codex::list_models(&config, &environment)
                .await
                .map(|models| {
                    models
                        .into_iter()
                        .find(|model| model.id == config.model || model.id == "default")
                        .map(|model| model.reasoning_efforts)
                        .unwrap_or_default()
                })
        }
        CliProviderKind::CodebuddyCli => codebuddy::list_efforts(&config, &environment).await,
    };
    match result {
        Ok(efforts) => Ok(Response::ok(efforts)),
        Err(error) => Ok(Response::err(
            "AI_CLI_EFFORT_DISCOVERY_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_cli_list_commands(
    app: AppHandle,
    config: CliProviderConfig,
) -> Result<Response<Vec<CliCommandInfo>>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let result = match config.kind {
        CliProviderKind::CodexCli => Ok(codex::common_commands()),
        CliProviderKind::CodebuddyCli => codebuddy::list_commands(&config, &environment).await,
    };
    match result {
        Ok(commands) => Ok(Response::ok(commands)),
        Err(error) => Ok(Response::err(
            "AI_CLI_COMMAND_DISCOVERY_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_cli_test_provider(
    app: AppHandle,
    config: CliProviderConfig,
) -> Result<Response<CliConnectionTestResult>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let result = match config.kind {
        CliProviderKind::CodexCli => codex::test_connection(&config, &environment).await,
        CliProviderKind::CodebuddyCli => codebuddy::test_connection(&config, &environment).await,
    };
    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("AI_CLI_TEST_ERROR", &error.to_string())),
    }
}

#[tauri::command]
pub async fn ai_cli_install_provider(
    app: AppHandle,
    provider: CliProviderKind,
) -> Result<Response<CliInstallResult>, String> {
    match setup::install_provider(&app, provider).await {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("AI_CLI_INSTALL_ERROR", &error.to_string())),
    }
}

#[tauri::command]
pub async fn ai_cli_begin_authentication(
    app: AppHandle,
    config: CliProviderConfig,
    method_id: Option<String>,
) -> Result<Response<CliAuthenticationLaunchResult>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    match setup::begin_authentication(&app, &config, &environment, method_id.as_deref()).await {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err(
            "AI_CLI_AUTH_LAUNCH_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_cli_list_authentication_methods(
    app: AppHandle,
    config: CliProviderConfig,
) -> Result<Response<Vec<crate::ai_cli::CliAuthenticationMethod>>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    match setup::authentication_methods(&config, &environment).await {
        Ok(methods) => Ok(Response::ok(methods)),
        Err(error) => Ok(Response::err(
            "AI_CLI_AUTH_METHODS_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_cli_authentication_status(
    session_id: String,
) -> Result<Response<crate::ai_cli::CliAuthenticationStatus>, String> {
    match setup::authentication_status(&session_id).await {
        Ok(status) => Ok(Response::ok(status)),
        Err(error) => Ok(Response::err(
            "AI_CLI_AUTH_STATUS_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_cli_cancel_authentication(
    session_id: String,
) -> Result<Response<crate::ai_cli::CliAuthenticationStatus>, String> {
    match setup::cancel_authentication(&session_id).await {
        Ok(status) => Ok(Response::ok(status)),
        Err(error) => Ok(Response::err(
            "AI_CLI_AUTH_CANCEL_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_chat_completion(
    app: AppHandle,
    request: AiChatCompletionRequest,
    cancellation: State<'_, AiCancellationState>,
) -> Result<Response<AiChatCompletionResult>, String> {
    let request_id = request
        .request_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let mut cancel_rx = if let Some(request_id) = request_id.as_deref() {
        match cancellation.register(request_id).await {
            Ok(receiver) => Some(receiver),
            Err(error) => return Ok(Response::err("AI_REQUEST_CANCELLED", &error)),
        }
    } else {
        None
    };

    let result = if let Some(cancel_rx) = cancel_rx.as_mut() {
        tokio::select! {
            result = send_chat_completion(&app, request) => result,
            _ = cancel_rx.changed() => Err("AI request cancelled".to_string()),
        }
    } else {
        send_chat_completion(&app, request).await
    };

    if let Some(request_id) = request_id.as_deref() {
        cancellation.finish(request_id).await;
    }

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) if error == "AI request cancelled" => {
            Ok(Response::err("AI_REQUEST_CANCELLED", &error))
        }
        Err(error) => Ok(Response::err("AI_CHAT_COMPLETION_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn cancel_ai_request(
    request_id: String,
    cancellation: State<'_, AiCancellationState>,
) -> Result<Response<bool>, String> {
    let request_id = request_id.trim();
    if request_id.is_empty() {
        return Ok(Response::err(
            "AI_CANCEL_INVALID_REQUEST",
            "AI request id is required",
        ));
    }
    Ok(Response::ok(cancellation.cancel(request_id).await))
}

#[tauri::command]
pub async fn ai_inline_completion(
    app: AppHandle,
    request: AiInlineCompletionRequest,
    cancellation: State<'_, AiCancellationState>,
) -> Result<Response<AiInlineCompletionResult>, String> {
    let request_id = request.request_id.trim().to_string();
    if request_id.is_empty() {
        return Ok(Response::err(
            "AI_INLINE_COMPLETION_INVALID_REQUEST",
            "Inline completion request id is required",
        ));
    }
    let mut cancel_rx = match cancellation.register(&request_id).await {
        Ok(receiver) => receiver,
        Err(error) => return Ok(Response::err("AI_REQUEST_CANCELLED", &error)),
    };

    let result = tokio::select! {
        result = send_inline_completion(&app, request) => result,
        _ = cancel_rx.changed() => Err("AI request cancelled".to_string()),
    };
    cancellation.finish(&request_id).await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) if error == "AI request cancelled" => {
            Ok(Response::err("AI_REQUEST_CANCELLED", &error))
        }
        Err(error) => Ok(Response::err("AI_INLINE_COMPLETION_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn ai_test_provider(
    app: AppHandle,
    config: AiProviderConfig,
) -> Result<Response<AiProviderTestResult>, String> {
    let model = config.model.trim().to_string();
    let request = AiChatCompletionRequest {
        request_id: None,
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

    match send_chat_completion(&app, request).await {
        Ok(_) => Ok(Response::ok(AiProviderTestResult {
            message: "AI provider connection is available".to_string(),
            model,
        })),
        Err(error) => Ok(Response::err("AI_PROVIDER_TEST_ERROR", &error)),
    }
}

async fn send_chat_completion(
    app: &AppHandle,
    mut request: AiChatCompletionRequest,
) -> Result<AiChatCompletionResult, String> {
    hydrate_provider_secret(app, &mut request.config).await?;
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

async fn send_inline_completion(
    app: &AppHandle,
    mut request: AiInlineCompletionRequest,
) -> Result<AiInlineCompletionResult, String> {
    hydrate_provider_secret(app, &mut request.config).await?;
    validate_config(&request.config)?;
    let timeout = Duration::from_millis(
        request
            .config
            .timeout_ms
            .unwrap_or(4_000)
            .clamp(1_000, 4_000),
    );
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())?;
    let prefix = truncate_utf8_tail(&request.prefix, 8_192);
    let suffix = truncate_utf8_head(&request.suffix, 4_096);
    let related_snippets = request
        .related_snippets
        .into_iter()
        .take(3)
        .map(|mut snippet| {
            snippet.content = truncate_utf8_head(&snippet.content, 8_192);
            snippet
        })
        .collect::<Vec<_>>();
    let context = json!({
        "languageId": request.language_id,
        "dialect": request.dialect,
        "filePath": request.file_path,
        "lsp": request.lsp_context,
        "relatedSnippets": related_snippets,
    });
    let (url, payload) = match request.protocol {
        InlineCompletionProtocol::ChatCompletions => {
            let user_payload = json!({
                "context": context,
                "prefix": prefix,
                "suffix": suffix,
            });
            (
                provider_endpoint_url(&request.config.base_url, "chat/completions")?,
                json!({
                    "model": request.config.model.trim(),
                    "messages": [
                        {
                            "role": "system",
                            "content": "Complete the database-language text at the cursor. Return only the exact text to insert, with no Markdown fence or explanation. Respect the supplied dialect, schema/LSP context, suffix, and project snippets. Do not repeat the prefix or suffix. For Elasticsearch Console, preserve the exact METHOD /relative/path followed by a JSON or NDJSON body, never quote an index in the request path, stay inside the active request, and only use mapping fields supplied for the active index. Prefer a short syntactically complete continuation; do not invent an index, field, endpoint, or unsupported clause."
                        },
                        { "role": "user", "content": user_payload.to_string() }
                    ],
                    "temperature": 0.0,
                    "max_tokens": 192,
                    "stream": false
                }),
            )
        }
        InlineCompletionProtocol::TextCompletionsFim => (
            provider_endpoint_url(&request.config.base_url, "completions")?,
            json!({
                "model": request.config.model.trim(),
                "prompt": format!("<oxide_context>{context}</oxide_context>\n{prefix}"),
                "suffix": suffix,
                "temperature": 0.0,
                "max_tokens": 192,
                "stream": false
            }),
        ),
    };

    let mut builder = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .json(&payload);
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
    let response = builder.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|error| format!("AI provider returned invalid JSON: {error}"))?;
    if !status.is_success() {
        return Err(provider_error_message(status.as_u16(), &value));
    }

    let text = match request.protocol {
        InlineCompletionProtocol::ChatCompletions => value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str),
        InlineCompletionProtocol::TextCompletionsFim => {
            value.pointer("/choices/0/text").and_then(Value::as_str)
        }
    }
    .ok_or_else(|| "AI provider response did not include completion text".to_string())?;
    let model = value
        .get("model")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    Ok(AiInlineCompletionResult {
        text: clean_inline_completion(text),
        model,
    })
}

fn clean_inline_completion(value: &str) -> String {
    let trimmed = value.trim_matches(['\r', '\n']);
    let without_fence = if let Some(fenced) = trimmed.strip_prefix("```") {
        let body = fenced.split_once('\n').map_or(fenced, |(_, body)| body);
        body.rsplit_once("```").map_or(body, |(body, _)| body)
    } else {
        trimmed
    };
    without_fence
        .trim_matches(['\r', '\n'])
        .lines()
        .take(12)
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(2_048)
        .collect()
}

fn truncate_utf8_head(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

fn truncate_utf8_tail(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut start = value.len() - max_bytes;
    while start < value.len() && !value.is_char_boundary(start) {
        start += 1;
    }
    value[start..].to_string()
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

async fn hydrate_provider_secret(
    app: &AppHandle,
    config: &mut AiProviderConfig,
) -> Result<(), String> {
    if config
        .api_key
        .as_deref()
        .is_some_and(|secret| !secret.trim().is_empty())
    {
        return Ok(());
    }
    config.api_key = load_provider_secret(app, &config.base_url)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn chat_completions_url(base_url: &str) -> Result<String, String> {
    provider_endpoint_url(base_url, "chat/completions")
}

fn provider_endpoint_url(base_url: &str, endpoint: &str) -> Result<String, String> {
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

    #[test]
    fn provider_endpoint_switches_between_chat_and_fim() {
        assert_eq!(
            provider_endpoint_url("http://localhost:11434/v1/chat/completions", "completions")
                .unwrap(),
            "http://localhost:11434/v1/completions"
        );
        assert_eq!(
            provider_endpoint_url("http://localhost:11434/v1/completions", "chat/completions")
                .unwrap(),
            "http://localhost:11434/v1/chat/completions"
        );
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
}
