use super::{RequestMetadata, AGENT_HOST_MAX_FRAME_BYTES};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
    pub project_id: String,
    pub checkpoint_version: u64,
    pub checkpoint: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphTypedBlob {
    #[serde(rename = "type")]
    pub blob_type: String,
    pub data: String,
}

impl GraphTypedBlob {
    pub fn validate(&self) -> Result<(), String> {
        if self.blob_type.trim().is_empty() || self.blob_type.chars().count() > 120 {
            return Err("graph typed blob type must contain 1 to 120 characters".to_string());
        }
        if self.data.len() > AGENT_HOST_MAX_FRAME_BYTES {
            return Err("graph typed blob exceeds the maximum frame size".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCheckpointScopeRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
    pub project_id: String,
    pub checkpoint_thread_id: String,
    #[serde(default)]
    pub checkpoint_ns: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCheckpointGetRequest {
    #[serde(flatten)]
    pub scope: GraphCheckpointScopeRequest,
    pub checkpoint_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCheckpointListRequest {
    #[serde(flatten)]
    pub scope: GraphCheckpointScopeRequest,
    pub checkpoint_id: Option<String>,
    pub before_checkpoint_id: Option<String>,
    pub limit: usize,
    pub filter: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCheckpointPutRequest {
    #[serde(flatten)]
    pub scope: GraphCheckpointScopeRequest,
    pub checkpoint_id: String,
    pub parent_checkpoint_id: Option<String>,
    pub checkpoint: GraphTypedBlob,
    pub metadata: GraphTypedBlob,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPendingWrite {
    pub task_id: String,
    pub index: i64,
    pub channel: String,
    pub value: GraphTypedBlob,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCheckpointPutWritesRequest {
    #[serde(flatten)]
    pub scope: GraphCheckpointScopeRequest,
    pub checkpoint_id: String,
    pub writes: Vec<GraphPendingWrite>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCheckpointDeleteThreadRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
    pub project_id: String,
    pub checkpoint_thread_id: String,
}
