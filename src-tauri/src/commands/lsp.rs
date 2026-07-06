use crate::lsp::LspServerManager;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

/// LSP server state managed by Tauri
pub struct LspState(pub Arc<Mutex<Option<Arc<LspServerManager>>>>);

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<CompletionContext>,
}

pub type TextDocumentPositionRequest = CompletionRequest;

#[derive(Debug, Serialize, Deserialize)]
pub struct CompletionContext {
    #[serde(rename = "triggerKind")]
    pub trigger_kind: u32,
    #[serde(
        default,
        rename = "triggerCharacter",
        skip_serializing_if = "Option::is_none"
    )]
    pub trigger_character: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FormatDocumentRequest {
    pub uri: String,
    pub tab_size: u32,
    pub insert_spaces: bool,
}

/// Completion response
#[derive(Debug, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub items: Vec<CompletionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TextEdit {
    pub range: Range,
    #[serde(rename = "newText")]
    pub new_text: String,
}

/// Completion item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionItem {
    pub label: String,
    pub kind: Option<u32>,
    pub detail: Option<String>,
    pub documentation: Option<String>,
    #[serde(
        default,
        rename = "insertText",
        skip_serializing_if = "Option::is_none"
    )]
    pub insert_text: Option<String>,
    #[serde(
        default,
        rename = "insertTextFormat",
        skip_serializing_if = "Option::is_none"
    )]
    pub insert_text_format: Option<u32>,
    #[serde(default, rename = "sortText", skip_serializing_if = "Option::is_none")]
    pub sort_text: Option<String>,
    #[serde(
        default,
        rename = "filterText",
        skip_serializing_if = "Option::is_none"
    )]
    pub filter_text: Option<String>,
    #[serde(default, rename = "textEdit", skip_serializing_if = "Option::is_none")]
    pub text_edit: Option<TextEdit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preselect: Option<bool>,
}

fn lsp_documentation_to_string(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }

    if let Some(text) = value.get("value").and_then(|value| value.as_str()) {
        return Some(text.to_string());
    }

    if let Some(items) = value.as_array() {
        let docs: Vec<String> = items
            .iter()
            .filter_map(lsp_documentation_to_string)
            .filter(|doc| !doc.trim().is_empty())
            .collect();
        if !docs.is_empty() {
            return Some(docs.join("\n\n"));
        }
    }

    None
}

fn parse_position(value: &Value) -> Option<Position> {
    Some(Position {
        line: value.get("line")?.as_u64()?.try_into().ok()?,
        character: value.get("character")?.as_u64()?.try_into().ok()?,
    })
}

fn parse_range(value: &Value) -> Option<Range> {
    Some(Range {
        start: parse_position(value.get("start")?)?,
        end: parse_position(value.get("end")?)?,
    })
}

fn parse_text_edit(value: &Value) -> Option<TextEdit> {
    Some(TextEdit {
        range: parse_range(value.get("range")?)?,
        new_text: value.get("newText")?.as_str()?.to_string(),
    })
}

fn parse_completion_item(item: &Value) -> Option<CompletionItem> {
    Some(CompletionItem {
        label: item.get("label")?.as_str()?.to_string(),
        kind: item.get("kind").and_then(|v| v.as_i64()).map(|v| v as u32),
        detail: item
            .get("detail")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        documentation: item
            .get("documentation")
            .and_then(lsp_documentation_to_string),
        insert_text: item
            .get("insertText")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        insert_text_format: item
            .get("insertTextFormat")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        sort_text: item
            .get("sortText")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        filter_text: item
            .get("filterText")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        text_edit: item.get("textEdit").and_then(parse_text_edit),
        preselect: item.get("preselect").and_then(|v| v.as_bool()),
    })
}

async fn current_manager(state: &State<'_, LspState>) -> Result<Arc<LspServerManager>, String> {
    let lsp_lock = state.0.lock().await;
    lsp_lock
        .as_ref()
        .cloned()
        .ok_or_else(|| "LSP server is not running".to_string())
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
    let existing_manager = {
        let mut lsp_lock = state.0.lock().await;

        if let Some(manager) = lsp_lock.as_ref() {
            if manager.is_running().await && manager.binary_path() == request.binary_path {
                tracing::info!("LSP server already running for requested binary");
                return Ok("LSP server already running".to_string());
            }
        }

        lsp_lock.take()
    };

    if let Some(manager) = existing_manager {
        tracing::info!("Stopping existing LSP server before reinitialization");
        manager
            .stop()
            .await
            .map_err(|e| format!("Failed to stop existing LSP server: {}", e))?;
    }

    // Create new LSP manager
    let mut manager = LspServerManager::new(request.binary_path, app);

    // Start the LSP server
    manager
        .start()
        .await
        .map_err(|e| format!("Failed to start LSP server: {}", e))?;

    let mut lsp_lock = state.0.lock().await;
    *lsp_lock = Some(Arc::new(manager));

    tracing::info!("✓ LSP server initialized successfully");
    Ok("LSP server initialized successfully".to_string())
}

async fn send_position_request(
    method: &str,
    request: TextDocumentPositionRequest,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    let manager = current_manager(&state).await?;

    let params = serde_json::json!({
        "textDocument": {
            "uri": request.uri
        },
        "position": {
            "line": request.line,
            "character": request.character
        }
    });

    manager
        .send_request(method.to_string(), params)
        .await
        .map_err(|e| format!("LSP error: {}", e))
}

/// Stop the LSP server
#[tauri::command]
pub async fn lsp_shutdown(state: State<'_, LspState>) -> Result<String, String> {
    let manager = {
        let mut lsp_lock = state.0.lock().await;
        lsp_lock.take()
    };

    if let Some(manager) = manager {
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
    let manager = {
        let lsp_lock = state.0.lock().await;
        lsp_lock.as_ref().cloned()
    };

    if let Some(manager) = manager {
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
    tracing::debug!(
        "LSP completion request: uri={}, pos={}:{}",
        request.uri,
        request.line,
        request.character
    );
    let manager = current_manager(&state).await?;
    tracing::debug!(
        "Completion request for {}:{}:{}",
        request.uri,
        request.line,
        request.character
    );

    // Build LSP textDocument/completion params
    let mut params = serde_json::json!({
        "textDocument": {
            "uri": request.uri
        },
        "position": {
            "line": request.line,
            "character": request.character
        }
    });
    if let Some(context) = request.context {
        let context = serde_json::to_value(context).map_err(|e| e.to_string())?;
        if let Some(params) = params.as_object_mut() {
            params.insert("context".to_string(), context);
        }
    }

    // Send LSP request
    match manager
        .send_request("textDocument/completion".to_string(), params)
        .await
    {
        Ok(result) => {
            // LSP spec allows two response formats:
            // 1. CompletionList: {"items": [...], "isIncomplete": false}
            // 2. CompletionItem[]: [{...}, {...}] (direct array)

            let items_array = if let Some(items) = result.get("items").and_then(|v| v.as_array()) {
                tracing::debug!("Found LSP CompletionList with {} items", items.len());
                items.clone()
            } else if let Some(items) = result.as_array() {
                tracing::debug!(
                    "Found direct LSP completion array with {} items",
                    items.len()
                );
                items.clone()
            } else {
                tracing::warn!("Unexpected LSP completion response format");
                vec![]
            };

            let items: Vec<CompletionItem> = items_array
                .iter()
                .filter_map(parse_completion_item)
                .collect();

            tracing::debug!("Parsed {} LSP completion items", items.len());
            Ok(CompletionResponse { items })
        }
        Err(e) => {
            tracing::error!("LSP completion request failed: {}", e);
            Err(format!("LSP error: {}", e))
        }
    }
}

#[tauri::command]
pub async fn lsp_hover(
    request: TextDocumentPositionRequest,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    send_position_request("textDocument/hover", request, state).await
}

#[tauri::command]
pub async fn lsp_goto_definition(
    request: TextDocumentPositionRequest,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    send_position_request("textDocument/definition", request, state).await
}

#[tauri::command]
pub async fn lsp_references(
    request: TextDocumentPositionRequest,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    let manager = current_manager(&state).await?;

    let params = serde_json::json!({
        "textDocument": {
            "uri": request.uri
        },
        "position": {
            "line": request.line,
            "character": request.character
        },
        "context": {
            "includeDeclaration": true
        }
    });

    manager
        .send_request("textDocument/references".to_string(), params)
        .await
        .map_err(|e| format!("LSP error: {}", e))
}

#[tauri::command]
pub async fn lsp_formatting(
    request: FormatDocumentRequest,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    let manager = current_manager(&state).await?;

    let params = serde_json::json!({
        "textDocument": {
            "uri": request.uri
        },
        "options": {
            "tabSize": request.tab_size,
            "insertSpaces": request.insert_spaces
        }
    });

    manager
        .send_request("textDocument/formatting".to_string(), params)
        .await
        .map_err(|e| format!("LSP error: {}", e))
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
    let manager = current_manager(&state).await?;

    tracing::debug!("Sending workspace/didChangeConfiguration");

    let params = serde_json::json!({
        "settings": settings
    });

    manager
        .send_notification("workspace/didChangeConfiguration".to_string(), params)
        .await
        .map_err(|e| format!("Failed to send notification: {}", e))?;

    Ok("Configuration updated".to_string())
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
    if let Ok(manager) = current_manager(&state).await {
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
    if let Ok(manager) = current_manager(&state).await {
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
    if let Ok(manager) = current_manager(&state).await {
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
            context: Some(CompletionContext {
                trigger_kind: 2,
                trigger_character: Some(".".to_string()),
            }),
        };

        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("file:///test.sql"));
        assert!(json.contains("\"triggerKind\":2"));
        assert!(json.contains("\"triggerCharacter\":\".\""));
    }

    #[test]
    fn parses_completion_insert_text() {
        let item = serde_json::json!({
            "label": "calculate_score",
            "kind": 3,
            "detail": "Function",
            "insertText": "calculate_score()",
            "insertTextFormat": 1,
            "sortText": "1:calculate_score",
            "filterText": "calculate_score",
            "textEdit": {
                "range": {
                    "start": { "line": 0, "character": 7 },
                    "end": { "line": 0, "character": 16 }
                },
                "newText": "public.calculate_score()"
            },
            "preselect": true
        });

        let parsed = parse_completion_item(&item).expect("completion should parse");

        assert_eq!(parsed.label, "calculate_score");
        assert_eq!(parsed.insert_text.as_deref(), Some("calculate_score()"));
        assert_eq!(parsed.insert_text_format, Some(1));
        assert_eq!(parsed.sort_text.as_deref(), Some("1:calculate_score"));
        assert_eq!(parsed.filter_text.as_deref(), Some("calculate_score"));
        assert_eq!(
            parsed.text_edit,
            Some(TextEdit {
                range: Range {
                    start: Position {
                        line: 0,
                        character: 7
                    },
                    end: Position {
                        line: 0,
                        character: 16
                    },
                },
                new_text: "public.calculate_score()".to_string(),
            })
        );
        assert_eq!(parsed.preselect, Some(true));
    }
}
