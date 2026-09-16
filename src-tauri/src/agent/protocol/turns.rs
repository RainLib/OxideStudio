use super::{AgentTurnRequest, RequestMetadata};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCancelTurnRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAnswerClarificationRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
    pub clarification_id: String,
    pub answers: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalDecision {
    Approve,
    Reject,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApproveActionRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
    pub approval_id: String,
    pub decision: ApprovalDecision,
    #[serde(default)]
    pub confirmation_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnAccepted {
    pub request_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActionAccepted {
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnRuntimeStatus {
    pub active: bool,
}

/// Bounded stateful events retained by Host for crash recovery. This is not a
/// provider-session resume mechanism: it only lets the desktop reconstruct a
/// safe UI state from an already persisted turn snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnJournal {
    pub project_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub events: Vec<Value>,
    pub truncated: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProjectStateCleared {
    pub project_id: String,
    pub cleared_records: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversationSnapshotSaveRequest {
    pub project_id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub thread_id: String,
    pub turns: Value,
    #[serde(default)]
    pub resume_requests: Vec<AgentTurnRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversationSnapshot {
    pub project_id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub thread_id: String,
    pub turns: Value,
    #[serde(default)]
    pub resume_requests: Value,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversationSummary {
    pub project_id: String,
    pub conversation_id: String,
    pub thread_id: String,
    pub title: String,
    pub turn_count: usize,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTextAttachment {
    pub file_name: String,
    pub content: String,
    pub byte_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextCompactionMetrics {
    pub count: u64,
    pub last_input_tokens: u64,
    pub last_retained_tokens: u64,
    pub offloaded_artifacts: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelUsageMetrics {
    pub calls: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextMetrics {
    pub project_id: String,
    pub compaction: Option<AgentContextCompactionMetrics>,
    pub model_usage: Option<AgentModelUsageMetrics>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHostStatus {
    pub state: String,
    pub available: bool,
    pub protocol_version: u32,
    pub capabilities: Vec<String>,
    pub installed_tools: Vec<String>,
    pub binary_path: Option<String>,
    pub storage_mode: String,
    pub last_error: Option<String>,
}
