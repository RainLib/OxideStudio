use super::{AgentToolManifestEntry, RequestMetadata};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCompleteRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
    #[serde(default)]
    pub messages: Vec<Value>,
    #[serde(default)]
    pub tools: Vec<AgentToolManifestEntry>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStreamRequest {
    #[serde(flatten)]
    pub request: ModelCompleteRequest,
    pub stream_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvokeRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
    pub call_id: String,
    pub tool_name: String,
    pub input: Value,
    pub input_digest: String,
    pub approval_lease: Option<String>,
    #[serde(default)]
    pub policy_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPreflightRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
    pub call_id: String,
    pub tool_name: String,
    pub input: Value,
    pub input_digest: String,
}
