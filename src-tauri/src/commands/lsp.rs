use crate::lsp::LspServerManager;
use serde::{Deserialize, Serialize};
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
    let mut lsp_lock = state.0.lock().await;

    // Create new LSP manager
    let manager = LspServerManager::new(request.binary_path);

    // Start the LSP server
    manager
        .start()
        .await
        .map_err(|e| format!("Failed to start LSP server: {}", e))?;

    *lsp_lock = Some(manager);

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
                // Parse completion items from response
                if let Some(items_array) = result.get("items").and_then(|v| v.as_array()) {
                    let items: Vec<CompletionItem> = items_array
                        .iter()
                        .filter_map(|item| {
                            Some(CompletionItem {
                                label: item.get("label")?.as_str()?.to_string(),
                                kind: item.get("kind")?.as_u64().map(|v| v as u32),
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

                    Ok(CompletionResponse { items })
                } else {
                    // Return empty if no items in response
                    Ok(CompletionResponse { items: vec![] })
                }
            }
            Err(e) => {
                tracing::error!("LSP completion request failed: {}", e);
                Err(format!("LSP error: {}", e))
            }
        }
    } else {
        Err("LSP server is not running".to_string())
    }
}

/// Update database schema in LSP server
#[tauri::command]
pub async fn lsp_update_schema(
    schema_json: String,
    state: State<'_, LspState>,
) -> Result<String, String> {
    let lsp_lock = state.0.lock().await;

    if let Some(manager) = lsp_lock.as_ref() {
        tracing::info!("Updating LSP schema, size: {} bytes", schema_json.len());

        // TODO: Send schema update to LSP server via JSON-RPC
        // This will be implemented in the next iteration

        Ok("Schema update accepted (placeholder)".to_string())
    } else {
        Err("LSP server is not running".to_string())
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
