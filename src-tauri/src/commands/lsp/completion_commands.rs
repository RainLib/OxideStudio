use super::completion_parse::{
    merge_completion_item_values, parse_bounded_completion_items, parse_completion_item,
    MAX_LSP_COMPLETION_ITEM_BYTES,
};
use super::session::{current_manager, validate_lsp_request_token, LspState};
use super::wire_types::{
    CompletionItem, CompletionRequest, CompletionResolveRequest, CompletionResponse,
};
use serde_json::Value;
use tauri::State;

/// Get SQL completions at cursor position
#[tauri::command]
pub async fn lsp_get_completions(
    request: CompletionRequest,
    state: State<'_, LspState>,
) -> Result<CompletionResponse, String> {
    let request_token = validate_lsp_request_token(request.request_token.as_deref())?;
    tracing::debug!(
        "LSP completion request: uri={}, pos={}:{}",
        request.uri,
        request.line,
        request.character
    );
    let manager = current_manager(&state, request.session_key.as_deref()).await?;
    let resolve_provider = manager.supports_completion_resolve().await;
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
        .send_request_with_token("textDocument/completion".to_string(), params, request_token)
        .await
    {
        Ok(result) => {
            // LSP spec allows two response formats:
            // 1. CompletionList: {"items": [...], "isIncomplete": false}
            // 2. CompletionItem[]: [{...}, {...}] (direct array)

            let defaults = result.get("itemDefaults");
            let is_incomplete = result
                .get("isIncomplete")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let items_array = if let Some(items) = result.get("items").and_then(|v| v.as_array()) {
                tracing::debug!("Found LSP CompletionList with {} items", items.len());
                items.as_slice()
            } else if let Some(items) = result.as_array() {
                tracing::debug!(
                    "Found direct LSP completion array with {} items",
                    items.len()
                );
                items.as_slice()
            } else {
                tracing::warn!("Unexpected LSP completion response format");
                &[]
            };

            let (items, bridge_incomplete) = parse_bounded_completion_items(items_array, defaults);

            tracing::debug!("Parsed {} LSP completion items", items.len());
            Ok(CompletionResponse {
                items,
                is_incomplete: is_incomplete || bridge_incomplete,
                resolve_provider,
            })
        }
        Err(e) => {
            tracing::error!("LSP completion request failed: {}", e);
            Err(format!("LSP error: {}", e))
        }
    }
}

/// Resolve lazy completion documentation and edits only when the active server
/// explicitly advertised `completionItem/resolve` during initialization.
#[tauri::command]
pub async fn lsp_resolve_completion(
    request: CompletionResolveRequest,
    state: State<'_, LspState>,
) -> Result<CompletionItem, String> {
    let request_token = validate_lsp_request_token(request.request_token.as_deref())?;
    let manager = current_manager(&state, request.session_key.as_deref()).await?;
    if !manager.supports_completion_resolve().await {
        return Err("LSP server does not advertise completionItem/resolve".to_string());
    }

    let original = serde_json::to_value(&request.item).map_err(|error| error.to_string())?;
    let encoded_size = serde_json::to_vec(&original)
        .map_err(|error| error.to_string())?
        .len();
    if encoded_size > MAX_LSP_COMPLETION_ITEM_BYTES {
        return Err(format!(
            "LSP completion item exceeds {} bytes",
            MAX_LSP_COMPLETION_ITEM_BYTES
        ));
    }

    let resolved = manager
        .send_request_with_token(
            "completionItem/resolve".to_string(),
            original.clone(),
            request_token,
        )
        .await
        .map_err(|error| format!("LSP completion resolve failed: {error}"))?;
    let merged = merge_completion_item_values(original, resolved);
    parse_completion_item(&merged, None)
        .ok_or_else(|| "LSP returned an invalid resolved completion item".to_string())
}
