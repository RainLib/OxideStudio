use super::session::{current_manager, validate_lsp_request_token, LspState};
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
    let token = if matches!(
        request.method.as_str(),
        "oxide/documentCompletions" | "oxide/completionSnapshot"
    ) {
        validate_lsp_request_token(request.request_token.as_deref())?
    } else {
        None
    };
    manager
        .send_request_with_token(request.method, request.params, token)
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
            | "oxide/documentDiagnostics"
            | "oxide/documentStructure"
            | "oxide/documentSemantics"
            | "oxide/documentCompletions"
            | "oxide/completionSnapshot"
            | "oxide/analysisConfiguration"
    )
}
