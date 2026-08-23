use crate::{
    ai_cli::{
        codebuddy, codex, setup, CliAuthenticationLaunchResult, CliCommandInfo,
        CliConnectionTestResult, CliDetectionResult, CliEnvironmentRequest,
        CliEnvironmentSaveResult, CliInstallationLaunchResult, CliModelInfo, CliProfileRequest,
        CliProviderConfig, CliProviderKind,
    },
    core::{
        cli_provider_secret::{load_cli_environment, save_cli_environment},
        protocol::Response,
        provider_secret::{
            has_provider_secret, load_provider_secret, normalize_provider_secret,
            save_provider_secret,
        },
        store::MetaStore,
    },
};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    future::Future,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, State};
use tokio::sync::{watch, Mutex};

const MAX_EARLY_CANCELLATIONS: usize = 256;
const CLI_CAPABILITY_CACHE_SCHEMA_VERSION: &str = "1";
const CLI_CAPABILITY_CACHE_NAMESPACE: &str = "cli-capability-catalog-v1";
const CLI_CAPABILITY_CACHE_TTL_MS: i64 = 24 * 60 * 60 * 1000;

/// Provider CLIs produce rich but provider-specific diagnostics. Preserve the
/// raw diagnostic as the response message while exposing a small, stable code
/// family to the desktop UI so recovery does not depend on English wording.
fn cli_operation_error_code(fallback: &'static str, diagnostic: &str) -> &'static str {
    let value = diagnostic.to_ascii_lowercase();
    if value.contains("not authenticated")
        || value.contains("not logged in")
        || value.contains("login required")
        || value.contains("sign in")
        || value.contains("unauthorized")
        || value.contains("authentication failed")
    {
        "AI_CLI_AUTH_REQUIRED"
    } else if value.contains("not installed")
        || value.contains("not found")
        || value.contains("no such file")
        || value.contains("failed to start")
    {
        "AI_CLI_NOT_INSTALLED"
    } else if value.contains("timed out") || value.contains("timeout") {
        "AI_CLI_TIMEOUT"
    } else if value.contains("acp")
        || value.contains("app-server")
        || value.contains("protocol")
        || value.contains("stream-json")
    {
        "AI_CLI_PROTOCOL_ERROR"
    } else {
        fallback
    }
}

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

fn cli_capability_cache_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn cli_capability_cache_key(
    meta_store: &MetaStore,
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    resource_kind: &str,
    runtime_version: Option<&str>,
) -> anyhow::Result<String> {
    let mut configured_environment_keys = config
        .environment_keys
        .iter()
        .map(|key| key.trim())
        .filter(|key| !key.is_empty())
        .collect::<Vec<_>>();
    configured_environment_keys.sort_unstable();
    configured_environment_keys.dedup();

    let profile_id = config.profile_id.trim();
    let executable_path = config
        .executable_path
        .as_deref()
        .map(str::trim)
        .unwrap_or_default();
    let runtime_version = runtime_version.map(str::trim).unwrap_or_default();
    let selected_model = if resource_kind == "efforts" {
        config.model.trim()
    } else {
        ""
    };
    let mut components = vec![
        ("schemaVersion", CLI_CAPABILITY_CACHE_SCHEMA_VERSION),
        ("resourceKind", resource_kind),
        ("provider", config.kind.as_str()),
        ("profileId", profile_id),
        ("executablePath", executable_path),
        ("runtimeVersion", runtime_version),
        ("selectedModel", selected_model),
    ];
    for key in configured_environment_keys {
        components.push(("configuredEnvironmentKey", key));
    }
    // BTreeMap iteration is deterministic. Values are authenticated directly
    // into the HMAC and never serialized, persisted or logged.
    for (key, value) in environment {
        components.push(("environmentName", key.as_str()));
        components.push(("environmentValue", value.as_str()));
    }
    meta_store.opaque_cache_key(CLI_CAPABILITY_CACHE_NAMESPACE, components)
}

#[allow(clippy::too_many_arguments)]
async fn load_cached_cli_capability<T, F, Fut>(
    meta_store: &MetaStore,
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    resource_kind: &'static str,
    runtime_version: Option<&str>,
    force_refresh: bool,
    now_ms: i64,
    discover: F,
) -> anyhow::Result<Vec<T>>
where
    T: DeserializeOwned + Serialize,
    F: FnOnce() -> Fut,
    Fut: Future<Output = anyhow::Result<Vec<T>>>,
{
    let cache_key = match cli_capability_cache_key(
        meta_store,
        config,
        environment,
        resource_kind,
        runtime_version,
    ) {
        Ok(cache_key) => Some(cache_key),
        Err(error) => {
            tracing::warn!(
                resource_kind,
                error = %error,
                "CLI capability cache key derivation failed; using live discovery"
            );
            None
        }
    };

    if !force_refresh {
        if let Some(cache_key) = cache_key.as_deref() {
            match meta_store
                .get_cli_capability_cache(cache_key, resource_kind, now_ms)
                .await
            {
                Ok(Some(payload)) => match serde_json::from_value(payload) {
                    Ok(values) => return Ok(values),
                    Err(error) => tracing::warn!(
                        resource_kind,
                        error = %error,
                        "Ignoring incompatible CLI capability cache payload"
                    ),
                },
                Ok(None) => {}
                Err(error) => tracing::warn!(
                    resource_kind,
                    error = %error,
                    "CLI capability cache read failed; using live discovery"
                ),
            }
        }
    }

    let values = discover().await?;
    if let Some(cache_key) = cache_key.as_deref() {
        match serde_json::to_value(&values) {
            Ok(payload) => {
                if let Err(error) = meta_store
                    .save_cli_capability_cache(
                        cache_key,
                        resource_kind,
                        &payload,
                        now_ms.saturating_add(CLI_CAPABILITY_CACHE_TTL_MS),
                    )
                    .await
                {
                    tracing::warn!(
                        resource_kind,
                        error = %error,
                        "CLI capability cache write failed"
                    );
                }
            }
            Err(error) => tracing::warn!(
                resource_kind,
                error = %error,
                "CLI capability result could not be cached"
            ),
        }
    }
    Ok(values)
}

#[tauri::command]
pub async fn ai_cli_set_environment(
    app: AppHandle,
    request: CliEnvironmentRequest,
) -> Result<Response<CliEnvironmentSaveResult>, String> {
    match save_cli_environment(
        &app,
        request.provider.as_str(),
        &request.profile_id,
        request.environment,
    )
    .await
    {
        Ok(keys) => Ok(Response::ok(CliEnvironmentSaveResult {
            keys,
            // Opaque cache invalidation only; never derive this from secrets.
            revision: uuid::Uuid::new_v4().to_string(),
        })),
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
    meta_store: State<'_, MetaStore>,
    config: CliProviderConfig,
    runtime_version: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Response<Vec<CliModelInfo>>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let force_refresh = force_refresh.unwrap_or(false);
    let result = load_cached_cli_capability(
        &meta_store,
        &config,
        &environment,
        "models",
        runtime_version.as_deref(),
        force_refresh,
        cli_capability_cache_now_ms(),
        || async {
            match config.kind {
                CliProviderKind::CodexCli => {
                    codex::list_models_with_refresh(&config, &environment, force_refresh).await
                }
                CliProviderKind::CodebuddyCli => {
                    codebuddy::list_models_with_refresh(&config, &environment, force_refresh).await
                }
            }
        },
    )
    .await;
    match result {
        Ok(models) => Ok(Response::ok(models)),
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_MODEL_DISCOVERY_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
    }
}

#[tauri::command]
pub async fn ai_cli_list_efforts(
    app: AppHandle,
    meta_store: State<'_, MetaStore>,
    config: CliProviderConfig,
    runtime_version: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Response<Vec<String>>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let force_refresh = force_refresh.unwrap_or(false);
    let result = load_cached_cli_capability(
        &meta_store,
        &config,
        &environment,
        "efforts",
        runtime_version.as_deref(),
        force_refresh,
        cli_capability_cache_now_ms(),
        || async {
            match config.kind {
                CliProviderKind::CodexCli => {
                    codex::list_models_with_refresh(&config, &environment, force_refresh)
                        .await
                        .map(|models| model_efforts_for_selection(&models, &config.model))
                }
                CliProviderKind::CodebuddyCli => {
                    codebuddy::list_efforts_with_refresh(&config, &environment, force_refresh).await
                }
            }
        },
    )
    .await;
    match result {
        Ok(efforts) => Ok(Response::ok(efforts)),
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_EFFORT_DISCOVERY_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
    }
}

fn model_efforts_for_selection(models: &[CliModelInfo], requested_model: &str) -> Vec<String> {
    models
        .iter()
        .find(|model| model.id == requested_model)
        .or_else(|| models.iter().find(|model| model.id == "default"))
        .map(|model| model.reasoning_efforts.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn ai_cli_list_commands(
    app: AppHandle,
    meta_store: State<'_, MetaStore>,
    config: CliProviderConfig,
    runtime_version: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Response<Vec<CliCommandInfo>>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let force_refresh = force_refresh.unwrap_or(false);
    let result = load_cached_cli_capability(
        &meta_store,
        &config,
        &environment,
        "commands",
        runtime_version.as_deref(),
        force_refresh,
        cli_capability_cache_now_ms(),
        || async {
            match config.kind {
                CliProviderKind::CodexCli => Ok(codex::common_commands()),
                CliProviderKind::CodebuddyCli => {
                    codebuddy::list_commands_with_refresh(&config, &environment, force_refresh)
                        .await
                }
            }
        },
    )
    .await;
    match result {
        Ok(commands) => Ok(Response::ok(commands)),
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_COMMAND_DISCOVERY_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
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
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_TEST_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
    }
}

#[tauri::command]
pub async fn ai_cli_install_provider(
    app: AppHandle,
    provider: CliProviderKind,
) -> Result<Response<CliInstallationLaunchResult>, String> {
    match setup::begin_installation(&app, provider).await {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_INSTALL_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
    }
}

#[tauri::command]
pub async fn ai_cli_installation_status(
    session_id: String,
) -> Result<Response<crate::ai_cli::CliInstallationStatus>, String> {
    match setup::installation_status(&session_id).await {
        Ok(status) => Ok(Response::ok(status)),
        Err(error) => Ok(Response::err(
            "AI_CLI_INSTALL_STATUS_ERROR",
            &error.to_string(),
        )),
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
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_AUTH_LAUNCH_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
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
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_AUTH_METHODS_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
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
