use super::session::{current_manager, LspState};
use super::wire_types::GenericLspRequest;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn lsp_request(
    request: GenericLspRequest,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    if !is_allowed_generic_lsp_method(&request.method) {
        return Err(format!(
            "Unsupported LSP request method: {}",
            request.method
        ));
    }
    let manager = current_manager(&state, request.session_key.as_deref()).await?;
    manager
        .send_request(request.method, request.params)
        .await
        .map_err(|error| format!("LSP error: {error}"))
}

pub(super) fn is_allowed_generic_lsp_method(method: &str) -> bool {
    matches!(
        method,
        "textDocument/signatureHelp"
            | "textDocument/prepareRename"
            | "textDocument/rename"
            | "textDocument/codeAction"
            | "textDocument/rangeFormatting"
            | "textDocument/documentSymbol"
            | "textDocument/foldingRange"
            | "textDocument/selectionRange"
            | "textDocument/semanticTokens/full"
            | "textDocument/inlayHint"
            | "workspace/symbol"
    )
}
