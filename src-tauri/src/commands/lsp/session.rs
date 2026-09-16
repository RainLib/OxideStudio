use super::wire_types::InitializeLspRequest;
use crate::lsp::LspServerManager;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::State;
use tokio::sync::Mutex;

/// LSP server state managed by Tauri
pub struct LspState(pub Arc<Mutex<HashMap<String, Arc<LspServerManager>>>>);

pub(super) const DEFAULT_LSP_SESSION_KEY: &str = "default";
pub(super) const MAX_LSP_REQUEST_TOKEN_BYTES: usize = 128;

pub(super) fn validate_lsp_request_token(
    request_token: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(token) = request_token else {
        return Ok(None);
    };
    if token.is_empty()
        || token.len() > MAX_LSP_REQUEST_TOKEN_BYTES
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Invalid LSP request token".to_string());
    }
    Ok(Some(token.to_string()))
}

pub(super) fn normalize_session_key(session_key: Option<&str>) -> String {
    let trimmed = session_key.unwrap_or(DEFAULT_LSP_SESSION_KEY).trim();
    if trimmed.is_empty() {
        DEFAULT_LSP_SESSION_KEY.to_string()
    } else {
        trimmed.to_string()
    }
}

pub(super) async fn current_manager(
    state: &State<'_, LspState>,
    session_key: Option<&str>,
) -> Result<Arc<LspServerManager>, String> {
    let key = normalize_session_key(session_key);
    let lsp_lock = state.0.lock().await;
    lsp_lock
        .get(&key)
        .cloned()
        .ok_or_else(|| format!("LSP session is not running: {}", key))
}

/// Initialize the LSP server
#[tauri::command]
pub async fn lsp_initialize(
    request: InitializeLspRequest,
    app: AppHandle,
    state: State<'_, LspState>,
) -> Result<String, String> {
    tracing::info!("🚀 LSP initialize command called");
    tracing::debug!("Binary path: {}", request.binary_path);
    let session_key = normalize_session_key(request.session_key.as_deref());
    let existing_manager = {
        let mut lsp_lock = state.0.lock().await;

        if let Some(manager) = lsp_lock.get(&session_key) {
            if manager.is_running().await && manager.binary_path() == request.binary_path {
                tracing::info!("LSP server already running for requested session");
                return Ok(format!("LSP session already running: {}", session_key));
            }
        }

        lsp_lock.remove(&session_key)
    };

    if let Some(manager) = existing_manager {
        tracing::info!(
            "Stopping existing LSP server before reinitialization: {}",
            session_key
        );
        manager
            .stop()
            .await
            .map_err(|e| format!("Failed to stop existing LSP server: {}", e))?;
    }

    // Create new LSP manager
    let mut manager = LspServerManager::new(request.binary_path, app, session_key.clone());

    // Start the LSP server
    manager
        .start()
        .await
        .map_err(|e| format!("Failed to start LSP server: {}", e))?;

    let mut lsp_lock = state.0.lock().await;
    lsp_lock.insert(session_key.clone(), Arc::new(manager));

    tracing::info!("✓ LSP session initialized successfully: {}", session_key);
    Ok(format!(
        "LSP session initialized successfully: {}",
        session_key
    ))
}

/// Stop the LSP server
#[tauri::command]
pub async fn lsp_shutdown(
    session_key: Option<String>,
    state: State<'_, LspState>,
) -> Result<String, String> {
    let key = normalize_session_key(session_key.as_deref());
    let manager = {
        let mut lsp_lock = state.0.lock().await;
        lsp_lock.remove(&key)
    };

    if let Some(manager) = manager {
        manager
            .stop()
            .await
            .map_err(|e| format!("Failed to stop LSP server: {}", e))?;

        Ok(format!("LSP session stopped successfully: {}", key))
    } else {
        Err(format!("LSP session is not running: {}", key))
    }
}

/// Check if LSP server is running
#[tauri::command]
pub async fn lsp_is_running(
    session_key: Option<String>,
    state: State<'_, LspState>,
) -> Result<bool, String> {
    let key = normalize_session_key(session_key.as_deref());
    let manager = {
        let lsp_lock = state.0.lock().await;
        lsp_lock.get(&key).cloned()
    };

    if let Some(manager) = manager {
        Ok(manager.is_running().await)
    } else {
        Ok(false)
    }
}

/// Cancel a completion or completion-resolve request that is no longer useful
/// to Monaco. Unknown/already-completed tokens are intentionally idempotent.
#[tauri::command]
pub async fn lsp_cancel_request(
    session_key: Option<String>,
    request_token: String,
    state: State<'_, LspState>,
) -> Result<bool, String> {
    let request_token = validate_lsp_request_token(Some(&request_token))?
        .expect("a supplied request token is always present");
    let manager = current_manager(&state, session_key.as_deref()).await?;
    manager
        .cancel_request_token(&request_token)
        .await
        .map_err(|error| format!("Failed to cancel LSP request: {error}"))
}
