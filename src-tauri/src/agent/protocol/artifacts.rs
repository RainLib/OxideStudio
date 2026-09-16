use super::RequestMetadata;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundedObservation {
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_count: Option<usize>,
    pub byte_count: usize,
    pub truncated: bool,
    pub artifact_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactReadRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
    pub project_id: String,
    pub artifact_id: String,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_artifact_read_bytes")]
    pub max_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSearchRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
    pub project_id: String,
    pub artifact_id: String,
    pub query: String,
    #[serde(default = "default_artifact_search_matches")]
    pub max_matches: usize,
    #[serde(default = "default_artifact_search_context_bytes")]
    pub context_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentArtifactReadRequest {
    pub project_id: String,
    pub artifact_id: String,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_artifact_read_bytes")]
    pub max_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentArtifactReadResult {
    pub artifact_id: String,
    pub found: bool,
    pub offset: usize,
    pub next_offset: usize,
    pub total_bytes: usize,
    pub eof: bool,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentArtifactSearchRequest {
    pub project_id: String,
    pub artifact_id: String,
    pub query: String,
    #[serde(default = "default_artifact_search_matches")]
    pub max_matches: usize,
    #[serde(default = "default_artifact_search_context_bytes")]
    pub context_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentArtifactSearchMatch {
    pub offset: usize,
    pub length: usize,
    pub snippet_offset: usize,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentArtifactSearchResult {
    pub artifact_id: String,
    pub query: String,
    pub found: bool,
    pub total_bytes: usize,
    pub match_count: usize,
    pub truncated: bool,
    pub matches: Vec<AgentArtifactSearchMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentArtifactExportRequest {
    pub project_id: String,
    pub artifact_id: String,
    pub suggested_file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentArtifactExportResult {
    pub artifact_id: String,
    pub exported: bool,
    pub file_path: Option<String>,
    pub byte_count: usize,
}

fn default_artifact_read_bytes() -> usize {
    32 * 1024
}

fn default_artifact_search_matches() -> usize {
    8
}

fn default_artifact_search_context_bytes() -> usize {
    120
}
