use crate::lsp::LspServerManager;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

/// LSP server state managed by Tauri
pub struct LspState(pub Arc<Mutex<HashMap<String, Arc<LspServerManager>>>>);

const DEFAULT_LSP_SESSION_KEY: &str = "default";
const MAX_LSP_DOCUMENT_BYTES: usize = 4 * 1024 * 1024;
const MAX_LSP_COMPLETION_ITEM_BYTES: usize = 256 * 1024;

fn normalize_session_key(session_key: Option<&str>) -> String {
    let trimmed = session_key.unwrap_or(DEFAULT_LSP_SESSION_KEY).trim();
    if trimmed.is_empty() {
        DEFAULT_LSP_SESSION_KEY.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Initialize LSP request
#[derive(Debug, Serialize, Deserialize)]
pub struct InitializeLspRequest {
    pub binary_path: String,
    #[serde(default)]
    pub session_key: Option<String>,
}

/// Completion request
#[derive(Debug, Serialize, Deserialize)]
pub struct CompletionRequest {
    #[serde(default)]
    pub session_key: Option<String>,
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
    #[serde(default)]
    pub session_key: Option<String>,
    pub uri: String,
    pub tab_size: u32,
    pub insert_spaces: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenericLspRequest {
    #[serde(default)]
    pub session_key: Option<String>,
    pub method: String,
    pub params: Value,
}

/// Completion response
#[derive(Debug, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub items: Vec<CompletionItem>,
    #[serde(rename = "isIncomplete")]
    pub is_incomplete: bool,
    #[serde(rename = "resolveProvider")]
    pub resolve_provider: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CompletionResolveRequest {
    #[serde(default)]
    pub session_key: Option<String>,
    pub item: CompletionItem,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InsertReplaceEdit {
    pub new_text: String,
    pub insert: Range,
    pub replace: Range,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum CompletionTextEdit {
    Edit(TextEdit),
    InsertAndReplace(InsertReplaceEdit),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItemLabelDetails {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionMarkupContent {
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum CompletionDocumentation {
    Text(String),
    Markup(CompletionMarkupContent),
}

/// Completion item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionItem {
    pub label: String,
    #[serde(
        default,
        rename = "labelDetails",
        skip_serializing_if = "Option::is_none"
    )]
    pub label_details: Option<CompletionItemLabelDetails>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub documentation: Option<CompletionDocumentation>,
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
    #[serde(
        default,
        rename = "insertTextMode",
        skip_serializing_if = "Option::is_none"
    )]
    pub insert_text_mode: Option<u32>,
    #[serde(default, rename = "sortText", skip_serializing_if = "Option::is_none")]
    pub sort_text: Option<String>,
    #[serde(
        default,
        rename = "filterText",
        skip_serializing_if = "Option::is_none"
    )]
    pub filter_text: Option<String>,
    #[serde(default, rename = "textEdit", skip_serializing_if = "Option::is_none")]
    pub text_edit: Option<CompletionTextEdit>,
    #[serde(
        default,
        rename = "additionalTextEdits",
        skip_serializing_if = "Option::is_none"
    )]
    pub additional_text_edits: Option<Vec<TextEdit>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preselect: Option<bool>,
    #[serde(
        default,
        rename = "commitCharacters",
        skip_serializing_if = "Option::is_none"
    )]
    pub commit_characters: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

fn parse_completion_documentation(value: &Value) -> Option<CompletionDocumentation> {
    if let Some(text) = value.as_str() {
        return Some(CompletionDocumentation::Text(text.to_string()));
    }

    if let Some(text) = value.get("value").and_then(|value| value.as_str()) {
        return Some(CompletionDocumentation::Markup(CompletionMarkupContent {
            kind: value
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("plaintext")
                .to_string(),
            value: text.to_string(),
        }));
    }

    if let Some(items) = value.as_array() {
        let docs: Vec<String> = items
            .iter()
            .filter_map(parse_completion_documentation)
            .map(|documentation| match documentation {
                CompletionDocumentation::Text(text) => text,
                CompletionDocumentation::Markup(markup) => markup.value,
            })
            .filter(|doc| !doc.trim().is_empty())
            .collect();
        if !docs.is_empty() {
            return Some(CompletionDocumentation::Text(docs.join("\n\n")));
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

fn parse_completion_text_edit(value: &Value) -> Option<CompletionTextEdit> {
    if let Some(edit) = parse_text_edit(value) {
        return Some(CompletionTextEdit::Edit(edit));
    }
    Some(CompletionTextEdit::InsertAndReplace(InsertReplaceEdit {
        new_text: value.get("newText")?.as_str()?.to_string(),
        insert: parse_range(value.get("insert")?)?,
        replace: parse_range(value.get("replace")?)?,
    }))
}

fn parse_default_completion_text_edit(
    item: &Value,
    edit_range: &Value,
) -> Option<CompletionTextEdit> {
    let new_text = item
        .get("textEditText")
        .or_else(|| item.get("insertText"))
        .or_else(|| item.get("label"))?
        .as_str()?
        .to_string();
    if let Some(range) = parse_range(edit_range) {
        return Some(CompletionTextEdit::Edit(TextEdit { range, new_text }));
    }
    Some(CompletionTextEdit::InsertAndReplace(InsertReplaceEdit {
        new_text,
        insert: parse_range(edit_range.get("insert")?)?,
        replace: parse_range(edit_range.get("replace")?)?,
    }))
}

fn completion_value<'a>(
    item: &'a Value,
    defaults: Option<&'a Value>,
    key: &str,
) -> Option<&'a Value> {
    item.get(key)
        .or_else(|| defaults.and_then(|value| value.get(key)))
}

fn parse_completion_item(item: &Value, defaults: Option<&Value>) -> Option<CompletionItem> {
    Some(CompletionItem {
        label: item.get("label")?.as_str()?.to_string(),
        label_details: item.get("labelDetails").and_then(|value| {
            let details = CompletionItemLabelDetails {
                detail: value
                    .get("detail")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                description: value
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            };
            (details.detail.is_some() || details.description.is_some()).then_some(details)
        }),
        kind: item.get("kind").and_then(|v| v.as_i64()).map(|v| v as u32),
        detail: item
            .get("detail")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        documentation: item
            .get("documentation")
            .and_then(parse_completion_documentation),
        insert_text: item
            .get("insertText")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        insert_text_format: completion_value(item, defaults, "insertTextFormat")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        insert_text_mode: completion_value(item, defaults, "insertTextMode")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok()),
        sort_text: item
            .get("sortText")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        filter_text: item
            .get("filterText")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        text_edit: item
            .get("textEdit")
            .and_then(parse_completion_text_edit)
            .or_else(|| {
                defaults
                    .and_then(|value| value.get("editRange"))
                    .and_then(|range| parse_default_completion_text_edit(item, range))
            }),
        additional_text_edits: item.get("additionalTextEdits").and_then(|value| {
            let edits = value
                .as_array()?
                .iter()
                .filter_map(parse_text_edit)
                .collect::<Vec<_>>();
            Some(edits)
        }),
        preselect: item.get("preselect").and_then(|v| v.as_bool()),
        commit_characters: completion_value(item, defaults, "commitCharacters").and_then(|value| {
            Some(
                value
                    .as_array()?
                    .iter()
                    .filter_map(|character| character.as_str().map(str::to_string))
                    .collect(),
            )
        }),
        deprecated: item
            .get("deprecated")
            .and_then(|value| value.as_bool())
            .or_else(|| {
                item.get("tags")
                    .and_then(|value| value.as_array())
                    .map(|tags| tags.iter().any(|tag| tag.as_u64() == Some(1)))
            }),
        data: completion_value(item, defaults, "data").cloned(),
    })
}

fn merge_completion_item_values(original: Value, resolved: Value) -> Value {
    match (original, resolved) {
        (Value::Object(mut original), Value::Object(resolved)) => {
            original.extend(resolved);
            Value::Object(original)
        }
        (_, resolved) => resolved,
    }
}

async fn current_manager(
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

async fn send_position_request(
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
        .send_request("textDocument/completion".to_string(), params)
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
                .filter_map(|item| parse_completion_item(item, defaults))
                .collect();

            tracing::debug!("Parsed {} LSP completion items", items.len());
            Ok(CompletionResponse {
                items,
                is_incomplete,
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
        .send_request("completionItem/resolve".to_string(), original.clone())
        .await
        .map_err(|error| format!("LSP completion resolve failed: {error}"))?;
    let merged = merge_completion_item_values(original, resolved);
    parse_completion_item(&merged, None)
        .ok_or_else(|| "LSP returned an invalid resolved completion item".to_string())
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

#[derive(Debug, Serialize, Deserialize)]
pub struct InlineCompletionValidationRequest {
    #[serde(default)]
    pub session_key: Option<String>,
    pub uri: String,
    pub text: String,
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

fn is_allowed_generic_lsp_method(method: &str) -> bool {
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
    session_key: Option<String>,
    state: State<'_, LspState>,
) -> Result<String, String> {
    let manager = current_manager(&state, session_key.as_deref()).await?;

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
    session_key: Option<String>,
    state: State<'_, LspState>,
) -> Result<(), String> {
    validate_lsp_document_size(&text)?;
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
    if let Ok(manager) = current_manager(&state, session_key.as_deref()).await {
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
    session_key: Option<String>,
    state: State<'_, LspState>,
) -> Result<(), String> {
    validate_lsp_document_size(&text)?;
    if let Ok(manager) = current_manager(&state, session_key.as_deref()).await {
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

fn validate_lsp_document_size(text: &str) -> Result<(), String> {
    if text.len() > MAX_LSP_DOCUMENT_BYTES {
        return Err(format!(
            "LSP document exceeds the {} byte synchronization limit",
            MAX_LSP_DOCUMENT_BYTES
        ));
    }
    Ok(())
}

#[cfg(test)]
mod document_size_tests {
    use super::{validate_lsp_document_size, MAX_LSP_DOCUMENT_BYTES};

    #[test]
    fn accepts_bounded_lsp_documents() {
        assert!(validate_lsp_document_size("SELECT 1").is_ok());
    }

    #[test]
    fn rejects_oversized_lsp_documents() {
        let text = "x".repeat(MAX_LSP_DOCUMENT_BYTES + 1);
        assert!(validate_lsp_document_size(&text)
            .unwrap_err()
            .contains("synchronization limit"));
    }
}

/// Send textDocument/didClose notification
#[tauri::command]
pub async fn lsp_did_close(
    uri: String,
    session_key: Option<String>,
    state: State<'_, LspState>,
) -> Result<(), String> {
    if let Ok(manager) = current_manager(&state, session_key.as_deref()).await {
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
            session_key: None,
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
            "labelDetails": {
                "detail": "(value numeric)",
                "description": "public"
            },
            "kind": 3,
            "detail": "Function",
            "documentation": {
                "kind": "markdown",
                "value": "Calculates **score**."
            },
            "insertText": "calculate_score()",
            "insertTextFormat": 1,
            "insertTextMode": 2,
            "sortText": "1:calculate_score",
            "filterText": "calculate_score",
            "textEdit": {
                "insert": {
                    "start": { "line": 0, "character": 7 },
                    "end": { "line": 0, "character": 12 }
                },
                "replace": {
                    "start": { "line": 0, "character": 7 },
                    "end": { "line": 0, "character": 16 }
                },
                "newText": "public.calculate_score()"
            },
            "additionalTextEdits": [{
                "range": {
                    "start": { "line": 0, "character": 0 },
                    "end": { "line": 0, "character": 0 }
                },
                "newText": "-- generated\n"
            }],
            "commitCharacters": ["(", "."],
            "tags": [1],
            "preselect": true
        });

        let parsed = parse_completion_item(&item, None).expect("completion should parse");

        assert_eq!(parsed.label, "calculate_score");
        assert_eq!(
            parsed.label_details,
            Some(CompletionItemLabelDetails {
                detail: Some("(value numeric)".to_string()),
                description: Some("public".to_string()),
            })
        );
        assert_eq!(parsed.insert_text.as_deref(), Some("calculate_score()"));
        assert_eq!(
            parsed.documentation,
            Some(CompletionDocumentation::Markup(CompletionMarkupContent {
                kind: "markdown".to_string(),
                value: "Calculates **score**.".to_string(),
            }))
        );
        assert_eq!(parsed.insert_text_format, Some(1));
        assert_eq!(parsed.insert_text_mode, Some(2));
        assert_eq!(parsed.sort_text.as_deref(), Some("1:calculate_score"));
        assert_eq!(parsed.filter_text.as_deref(), Some("calculate_score"));
        assert_eq!(
            parsed.text_edit,
            Some(CompletionTextEdit::InsertAndReplace(InsertReplaceEdit {
                insert: Range {
                    start: Position {
                        line: 0,
                        character: 7
                    },
                    end: Position {
                        line: 0,
                        character: 12
                    },
                },
                replace: Range {
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
            }))
        );
        assert_eq!(
            parsed.additional_text_edits,
            Some(vec![TextEdit {
                range: Range {
                    start: Position {
                        line: 0,
                        character: 0
                    },
                    end: Position {
                        line: 0,
                        character: 0
                    },
                },
                new_text: "-- generated\n".to_string(),
            }])
        );
        assert_eq!(
            parsed.commit_characters,
            Some(vec!["(".to_string(), ".".to_string()])
        );
        assert_eq!(parsed.deprecated, Some(true));
        assert_eq!(parsed.preselect, Some(true));
    }

    #[test]
    fn applies_supported_completion_list_item_defaults() {
        let item = serde_json::json!({
            "label": "customer_id",
            "textEditText": "customer_id"
        });
        let defaults = serde_json::json!({
            "commitCharacters": ["."],
            "editRange": {
                "insert": {
                    "start": { "line": 2, "character": 4 },
                    "end": { "line": 2, "character": 7 }
                },
                "replace": {
                    "start": { "line": 2, "character": 4 },
                    "end": { "line": 2, "character": 11 }
                }
            },
            "insertTextFormat": 2,
            "insertTextMode": 1,
            "data": {
                "document": "file:///query.sql",
                "completionListRevision": 7
            }
        });

        let parsed = parse_completion_item(&item, Some(&defaults)).unwrap();

        assert_eq!(parsed.commit_characters, Some(vec![".".to_string()]));
        assert_eq!(parsed.insert_text_format, Some(2));
        assert_eq!(parsed.insert_text_mode, Some(1));
        assert_eq!(
            parsed.data,
            Some(serde_json::json!({
                "document": "file:///query.sql",
                "completionListRevision": 7
            }))
        );
        assert_eq!(
            parsed.text_edit,
            Some(CompletionTextEdit::InsertAndReplace(InsertReplaceEdit {
                new_text: "customer_id".to_string(),
                insert: Range {
                    start: Position {
                        line: 2,
                        character: 4,
                    },
                    end: Position {
                        line: 2,
                        character: 7,
                    },
                },
                replace: Range {
                    start: Position {
                        line: 2,
                        character: 4,
                    },
                    end: Position {
                        line: 2,
                        character: 11,
                    },
                },
            }))
        );
    }

    #[test]
    fn resolved_completion_fields_preserve_original_identity_and_data() {
        let original = serde_json::json!({
            "label": "customer_id",
            "kind": 5,
            "sortText": "1:customer_id",
            "data": { "document": "file:///query.sql", "symbol": 42 }
        });
        let resolved = serde_json::json!({
            "label": "customer_id",
            "detail": "customers.customer_id bigint",
            "documentation": {
                "kind": "markdown",
                "value": "Primary key"
            },
            "additionalTextEdits": [{
                "range": {
                    "start": { "line": 0, "character": 0 },
                    "end": { "line": 0, "character": 0 }
                },
                "newText": "-- resolved\n"
            }]
        });

        let merged = merge_completion_item_values(original, resolved);
        let parsed = parse_completion_item(&merged, None).expect("resolved item should parse");

        assert_eq!(parsed.sort_text.as_deref(), Some("1:customer_id"));
        assert_eq!(
            parsed.data,
            Some(serde_json::json!({
                "document": "file:///query.sql",
                "symbol": 42
            }))
        );
        assert_eq!(
            parsed.documentation,
            Some(CompletionDocumentation::Markup(CompletionMarkupContent {
                kind: "markdown".to_string(),
                value: "Primary key".to_string(),
            }))
        );
        assert_eq!(parsed.additional_text_edits.as_ref().map(Vec::len), Some(1));
    }

    #[test]
    fn generic_lsp_requests_are_strictly_allowlisted() {
        assert!(is_allowed_generic_lsp_method("textDocument/signatureHelp"));
        assert!(is_allowed_generic_lsp_method("textDocument/rename"));
        assert!(is_allowed_generic_lsp_method(
            "textDocument/semanticTokens/full"
        ));
        assert!(is_allowed_generic_lsp_method("textDocument/inlayHint"));
        assert!(is_allowed_generic_lsp_method("workspace/symbol"));
        assert!(!is_allowed_generic_lsp_method("shutdown"));
        assert!(!is_allowed_generic_lsp_method("workspace/executeCommand"));
    }
}
