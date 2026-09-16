use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_token: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_token: Option<String>,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct InlineCompletionValidationRequest {
    #[serde(default)]
    pub session_key: Option<String>,
    pub uri: String,
    pub text: String,
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
