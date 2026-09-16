use super::session::{current_manager, LspState};
use super::wire_types::{InlineCompletionValidationRequest, TextDocumentPositionRequest};
use serde_json::Value;
use tauri::State;

pub(super) async fn send_position_request(
    method: &str,
    request: TextDocumentPositionRequest,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    let manager = current_manager(&state, request.session_key.as_deref()).await?;

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
    let manager = current_manager(&state, request.session_key.as_deref()).await?;

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
pub async fn lsp_inline_completion_context(
    request: TextDocumentPositionRequest,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    send_position_request("oxide/inlineCompletionContext", request, state).await
}

#[tauri::command]
pub async fn lsp_validate_inline_completion(
    request: InlineCompletionValidationRequest,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    let manager = current_manager(&state, request.session_key.as_deref()).await?;
    manager
        .send_request(
            "oxide/validateInlineCompletion".to_string(),
            serde_json::json!({
                "textDocument": { "uri": request.uri },
                "text": request.text,
            }),
        )
        .await
        .map_err(|error| format!("LSP error: {error}"))
}
