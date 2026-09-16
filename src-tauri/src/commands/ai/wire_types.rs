use super::{default_provider_scope, BTreeMap, Deserialize, Serialize, Value};

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfig {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_deserializing)]
    pub(super) custom_headers: BTreeMap<String, String>,
}

impl std::fmt::Debug for AiProviderConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AiProviderConfig")
            .field("base_url", &self.base_url)
            .field("api_key", &self.api_key.as_ref().map(|_| "<redacted>"))
            .field("model", &self.model)
            .field("timeout_ms", &self.timeout_ms)
            .field(
                "custom_header_names",
                &self.custom_headers.keys().collect::<Vec<_>>(),
            )
            .finish()
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionRequest {
    pub request_id: Option<String>,
    pub config: AiProviderConfig,
    pub messages: Vec<AiChatMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionResult {
    pub content: String,
    pub model: Option<String>,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InlineCompletionProtocol {
    ChatCompletions,
    TextCompletionsFim,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnippet {
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInlineCompletionRequest {
    pub request_id: String,
    pub protocol: InlineCompletionProtocol,
    pub config: AiProviderConfig,
    pub prefix: String,
    pub suffix: String,
    pub language_id: String,
    pub dialect: String,
    pub file_path: Option<String>,
    #[serde(default)]
    pub lsp_context: Value,
    #[serde(default)]
    pub related_snippets: Vec<ProjectSnippet>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiInlineCompletionResult {
    pub text: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderTestResult {
    pub message: String,
    pub model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderSecretRequest {
    pub base_url: String,
    pub api_key: Option<String>,
    #[serde(default = "default_provider_scope")]
    pub scope: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderHeadersRequest {
    pub base_url: String,
    pub scope: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}
