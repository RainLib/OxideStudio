use super::session::{current_manager, LspState};
use super::wire_types::FormatDocumentRequest;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn lsp_formatting(
    request: FormatDocumentRequest,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    let manager = current_manager(&state, request.session_key.as_deref()).await?;

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
