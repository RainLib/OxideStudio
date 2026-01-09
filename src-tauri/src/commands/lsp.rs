use crate::lsp::LspServerManager;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// LSP server state managed by Tauri
pub struct LspState(pub Arc<Mutex<Option<LspServerManager>>>);

/// Initialize LSP request
#[derive(Debug, Serialize, Deserialize)]
pub struct InitializeLspRequest {
    pub binary_path: String,
}

/// Completion request
#[derive(Debug, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub uri: String,
    pub line: u32,
    pub character: u32,
}

/// Completion response
#[derive(Debug, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub items: Vec<CompletionItem>,
}

/// Completion item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionItem {
    pub label: String,
    pub kind: Option<u32>,
    pub detail: Option<String>,
    pub documentation: Option<String>,
}

/// Initialize the LSP server
#[tauri::command]
pub async fn lsp_initialize(
    request: InitializeLspRequest,
    state: State<'_, LspState>,
) -> Result<String, String> {
    tracing::info!("🚀 LSP initialize command called");
    tracing::debug!("Binary path: {}", request.binary_path);
    let mut lsp_lock = state.0.lock().await;

    // Create new LSP manager
    let mut manager = LspServerManager::new(request.binary_path);

    // Start the LSP server
    manager
        .start()
        .await
        .map_err(|e| format!("Failed to start LSP server: {}", e))?;

    *lsp_lock = Some(manager);

    tracing::info!("✓ LSP server initialized successfully");
    Ok("LSP server initialized successfully".to_string())
}

/// Stop the LSP server
#[tauri::command]
pub async fn lsp_shutdown(state: State<'_, LspState>) -> Result<String, String> {
    let mut lsp_lock = state.0.lock().await;

    if let Some(manager) = lsp_lock.take() {
        manager
            .stop()
            .await
            .map_err(|e| format!("Failed to stop LSP server: {}", e))?;

        Ok("LSP server stopped successfully".to_string())
    } else {
        Err("LSP server is not running".to_string())
    }
}

/// Check if LSP server is running
#[tauri::command]
pub async fn lsp_is_running(state: State<'_, LspState>) -> Result<bool, String> {
    let lsp_lock = state.0.lock().await;

    if let Some(manager) = lsp_lock.as_ref() {
        Ok(manager.is_running().await)
    } else {
        Ok(false)
    }
}

/// Get SQL completions at cursor position
#[tauri::command]
pub async fn lsp_get_completions(
    request: CompletionRequest,
    state: State<'_, LspState>,
) -> Result<CompletionResponse, String> {
    tracing::info!(
        "💡 LSP completion request: uri={}, pos={}:{}",
        request.uri,
        request.line,
        request.character
    );
    let lsp_lock = state.0.lock().await;

    if let Some(manager) = lsp_lock.as_ref() {
        tracing::debug!(
            "Completion request for {}:{}:{}",
            request.uri,
            request.line,
            request.character
        );

        // Build LSP textDocument/completion params
        let params = serde_json::json!({
            "textDocument": {
                "uri": request.uri
            },
            "position": {
                "line": request.line,
                "character": request.character
            }
        });

        // Send LSP request
        match manager
            .send_request("textDocument/completion".to_string(), params)
            .await
        {
            Ok(result) => {
                println!(
                    "💡 [BACKEND] LSP returned: {}",
                    serde_json::to_string_pretty(&result).unwrap_or_default()
                );

                // LSP spec allows two response formats:
                // 1. CompletionList: {"items": [...], "isIncomplete": false}
                // 2. CompletionItem[]: [{...}, {...}] (direct array)

                let items_array =
                    if let Some(items) = result.get("items").and_then(|v| v.as_array()) {
                        println!(
                            "💡 [BACKEND] Found CompletionList with {} items",
                            items.len()
                        );
                        items.clone()
                    } else if let Some(items) = result.as_array() {
                        println!("💡 [BACKEND] Found direct array with {} items", items.len());
                        items.clone()
                    } else {
                        println!("⚠️  [BACKEND] Unexpected LSP response format");
                        vec![]
                    };

                let items: Vec<CompletionItem> = items_array
                    .iter()
                    .filter_map(|item| {
                        Some(CompletionItem {
                            label: item.get("label")?.as_str()?.to_string(),
                            kind: item.get("kind").and_then(|v| v.as_i64()).map(|v| v as u32),
                            detail: item
                                .get("detail")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            documentation: item
                                .get("documentation")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        })
                    })
                    .collect();

                println!(
                    "💡 [BACKEND] Parsed {} items, returning to frontend",
                    items.len()
                );
                if !items.is_empty() {
                    println!("💡 [BACKEND] First item: {:?}", items[0]);
                }
                Ok(CompletionResponse { items })
            }
            Err(e) => {
                tracing::error!("LSP completion request failed: {}", e);
                Err(format!("LSP error: {}", e))
            }
        }
    } else {
        tracing::error!("LSP server is not running");
        Err("LSP server is not running".to_string())
    }
}

/// LSP configuration (sqls settings)
#[derive(Debug, Serialize, Deserialize)]
pub struct LspSqlsConfig {
    pub connections: Vec<LspConnectionConfig>,
}

/// LSP connection config
#[derive(Debug, Serialize, Deserialize)]
pub struct LspConnectionConfig {
    pub driver: String,
    #[serde(rename = "dataSourceName")]
    pub data_source_name: String,
    pub alias: Option<String>,
}

/// Send workspace/didChangeConfiguration notification
#[tauri::command]
pub async fn lsp_did_change_configuration(
    settings: Value,
    state: State<'_, LspState>,
) -> Result<String, String> {
    let lsp_lock = state.0.lock().await;

    if let Some(manager) = lsp_lock.as_ref() {
        tracing::debug!("Sending workspace/didChangeConfiguration");

        let params = serde_json::json!({
            "settings": settings
        });

        manager
            .send_notification("workspace/didChangeConfiguration".to_string(), params)
            .await
            .map_err(|e| format!("Failed to send notification: {}", e))?;

        Ok("Configuration updated".to_string())
    } else {
        Err("LSP server is not running".to_string())
    }
}

/// Send textDocument/didOpen notification
#[tauri::command]
pub async fn lsp_did_open(
    uri: String,
    language_id: String,
    version: i32,
    text: String,
    state: State<'_, LspState>,
) -> Result<(), String> {
    tracing::info!(
        "📄 LSP didOpen command called: uri={}, version={}",
        uri,
        version
    );
    tracing::debug!(
        "Text length: {} bytes, language: {}",
        text.len(),
        language_id
    );
    let lsp_lock = state.0.lock().await;

    if let Some(manager) = lsp_lock.as_ref() {
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
                "languageId": language_id,
                "version": version,
                "text": text
            }
        });

        manager
            .send_notification("textDocument/didOpen".to_string(), params)
            .await
            .map_err(|e| format!("Failed to send didOpen: {}", e))?;

        tracing::debug!("✓ didOpen notification sent to LSP");
        Ok(())
    } else {
        // Silent failure if LSP not ready (common during startup)
        tracing::warn!("LSP not running, skipping didOpen");
        Ok(())
    }
}

/// Send textDocument/didChange notification
#[tauri::command]
pub async fn lsp_did_change(
    uri: String,
    version: i32,
    text: String,
    state: State<'_, LspState>,
) -> Result<(), String> {
    let lsp_lock = state.0.lock().await;

    if let Some(manager) = lsp_lock.as_ref() {
        // sending full text sync for simplicity
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
                "version": version
            },
            "contentChanges": [
                {
                    "text": text
                }
            ]
        });

        manager
            .send_notification("textDocument/didChange".to_string(), params)
            .await
            .map_err(|e| format!("Failed to send didChange: {}", e))?;

        Ok(())
    } else {
        Ok(())
    }
}

/// Send textDocument/didClose notification
#[tauri::command]
pub async fn lsp_did_close(uri: String, state: State<'_, LspState>) -> Result<(), String> {
    let lsp_lock = state.0.lock().await;

    if let Some(manager) = lsp_lock.as_ref() {
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri
            }
        });

        manager
            .send_notification("textDocument/didClose".to_string(), params)
            .await
            .map_err(|e| format!("Failed to send didClose: {}", e))?;

        Ok(())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_completion_request_serialization() {
        let req = CompletionRequest {
            uri: "file:///test.sql".to_string(),
            line: 10,
            character: 15,
        };

        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("file:///test.sql"));
    }
}
