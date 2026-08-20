use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Error as IoError, ErrorKind};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const AGENT_HOST_PROTOCOL_VERSION: u32 = 1;
pub const AGENT_HOST_MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;
pub const AGENT_HOST_EVENT_CHANNEL: &str = "agent://event";
const MAX_HEADER_BYTES: usize = 8 * 1024;

pub const HOST_INITIALIZE_METHOD: &str = "host.initialize";
pub const HOST_START_TURN_METHOD: &str = "turn.start";
pub const HOST_RESUME_TURN_METHOD: &str = "turn.resume";
pub const HOST_CANCEL_TURN_METHOD: &str = "turn.cancel";
pub const HOST_ANSWER_CLARIFICATION_METHOD: &str = "turn.answerClarification";
pub const HOST_RESOLVE_APPROVAL_METHOD: &str = "turn.resolveApproval";

pub const SIDECAR_MODEL_COMPLETE_METHOD: &str = "model.complete";
pub const SIDECAR_MODEL_STREAM_METHOD: &str = "model.stream";
pub const HOST_MODEL_CHUNK_METHOD: &str = "model.chunk";
pub const SIDECAR_TOOL_PREFLIGHT_METHOD: &str = "tool.preflight";
pub const SIDECAR_TOOL_INVOKE_METHOD: &str = "tool.invoke";
pub const SIDECAR_CHECKPOINT_LOAD_METHOD: &str = "checkpoint.load";
pub const SIDECAR_CHECKPOINT_SAVE_METHOD: &str = "checkpoint.save";
pub const SIDECAR_GRAPH_CHECKPOINT_GET_METHOD: &str = "graph.checkpoint.get";
pub const SIDECAR_GRAPH_CHECKPOINT_LIST_METHOD: &str = "graph.checkpoint.list";
pub const SIDECAR_GRAPH_CHECKPOINT_PUT_METHOD: &str = "graph.checkpoint.put";
pub const SIDECAR_GRAPH_CHECKPOINT_PUT_WRITES_METHOD: &str = "graph.checkpoint.putWrites";
pub const SIDECAR_GRAPH_CHECKPOINT_DELETE_THREAD_METHOD: &str = "graph.checkpoint.deleteThread";
pub const SIDECAR_ARTIFACT_READ_METHOD: &str = "artifact.read";
pub const SIDECAR_ARTIFACT_SEARCH_METHOD: &str = "artifact.search";
pub const SIDECAR_EVENT_METHOD: &str = "agent.event";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestMetadata {
    pub request_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub context_version: String,
    pub deadline: i64,
}

impl RequestMetadata {
    pub fn validate(&self) -> Result<(), String> {
        for (name, value) in [
            ("requestId", self.request_id.as_str()),
            ("threadId", self.thread_id.as_str()),
            ("turnId", self.turn_id.as_str()),
            ("contextVersion", self.context_version.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(format!("{name} is required"));
            }
            if value.chars().count() > 240 {
                return Err(format!("{name} must not exceed 240 characters"));
            }
        }
        if self.deadline <= 0 {
            return Err("deadline must be a positive Unix timestamp in milliseconds".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentProfile {
    Chat,
    Plan,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub streaming: bool,
    pub tool_calling: bool,
    pub structured_output: bool,
    pub max_input_tokens: Option<u64>,
    pub max_output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentProviderKind {
    OpenaiCompatible,
    CodexCli,
    CodebuddyCli,
}

impl Default for AgentProviderKind {
    fn default() -> Self {
        Self::OpenaiCompatible
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderConfig {
    #[serde(default)]
    pub kind: AgentProviderKind,
    #[serde(default)]
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub timeout_ms: Option<u64>,
    pub capabilities: ProviderCapabilities,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub executable_path: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub service_tier: Option<String>,
    #[serde(default)]
    pub access_mode: Option<String>,
    #[serde(default)]
    pub environment_keys: Vec<String>,
}

impl std::fmt::Debug for AgentProviderConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AgentProviderConfig")
            .field("kind", &self.kind)
            .field("base_url", &self.base_url)
            .field("api_key", &self.api_key.as_ref().map(|_| "<redacted>"))
            .field("model", &self.model)
            .field("profile_id", &self.profile_id)
            .field("executable_path", &self.executable_path)
            .field("reasoning_effort", &self.reasoning_effort)
            .field("service_tier", &self.service_tier)
            .field("access_mode", &self.access_mode)
            .field("environment_keys", &self.environment_keys)
            .field("timeout_ms", &self.timeout_ms)
            .field("capabilities", &self.capabilities)
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolResultLimit {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_rows: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolManifestEntry {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_limit: Option<AgentToolResultLimit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContext {
    pub project_id: String,
    pub connection_id: Option<String>,
    pub database: Option<String>,
    pub namespace: Option<String>,
    pub active_tab_id: Option<String>,
    pub config_revision: Option<String>,
    pub fingerprint: String,
    #[serde(default)]
    pub summary: HashMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnRequest {
    #[serde(flatten)]
    pub metadata: RequestMetadata,
    pub project_id: String,
    pub profile: AgentProfile,
    #[serde(default)]
    pub messages: Vec<AgentMessage>,
    pub prompt: String,
    pub provider: AgentProviderConfig,
    pub workspace: WorkspaceContext,
    #[serde(default)]
    pub tools: Vec<AgentToolManifestEntry>,
    pub resume_checkpoint: Option<Value>,
}

impl AgentTurnRequest {
    pub fn validate(&self) -> Result<(), String> {
        self.metadata.validate()?;
        if self.project_id.trim().is_empty() || self.project_id.chars().count() > 200 {
            return Err("projectId must contain 1 to 200 characters".to_string());
        }
        if self.workspace.project_id != self.project_id {
            return Err("workspace.projectId must match projectId".to_string());
        }
        if self.workspace.fingerprint.trim().is_empty()
            || self.workspace.fingerprint.chars().count() > 240
        {
            return Err("workspace.fingerprint must contain 1 to 240 characters".to_string());
        }
        if let Some(active_tab) = self
            .workspace
            .summary
            .get("activeTab")
            .filter(|value| !value.is_null())
        {
            let active_tab_id = active_tab
                .as_object()
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
                .ok_or_else(|| "workspace.summary.activeTab.id is required".to_string())?;
            if self.workspace.active_tab_id.as_deref() != Some(active_tab_id) {
                return Err(
                    "workspace.summary.activeTab.id must match workspace.activeTabId".to_string(),
                );
            }
        }
        if self.prompt.trim().is_empty() || self.prompt.chars().count() > 200_000 {
            return Err("prompt must contain 1 to 200,000 characters".to_string());
        }
        if self.messages.len() > 512 || self.tools.len() > 256 {
            return Err("turn exceeds the message or tool manifest limit".to_string());
        }
        if self.provider.model.trim().is_empty() {
            return Err("provider model is required".to_string());
        }
        match self.provider.kind {
            AgentProviderKind::OpenaiCompatible if self.provider.base_url.trim().is_empty() => {
                return Err("OpenAI-compatible provider baseUrl is required".to_string());
            }
            AgentProviderKind::CodexCli | AgentProviderKind::CodebuddyCli
                if self
                    .provider
                    .profile_id
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .is_empty() =>
            {
                return Err("CLI provider profileId is required".to_string());
            }
            _ => {}
        }
        if self
            .provider
            .access_mode
            .as_deref()
            .is_some_and(|mode| !matches!(mode, "restricted" | "full"))
        {
            return Err("provider accessMode must be restricted or full".to_string());
        }
        if self.provider.kind != AgentProviderKind::CodexCli
            && self.provider.access_mode.as_deref() == Some("full")
        {
            return Err("Full access is only supported by Codex CLI".to_string());
        }
        if self.provider.access_mode.as_deref() == Some("full")
            && (self.profile != AgentProfile::Agent
                || self
                    .provider
                    .reasoning_effort
                    .as_deref()
                    .is_none_or(|effort| !effort.eq_ignore_ascii_case("ultra")))
        {
            return Err("Full access requires Agent mode with Ultra reasoning".to_string());
        }
        for tool in &self.tools {
            if tool.name.trim().is_empty() || tool.name.chars().count() > 200 {
                return Err("tool names must contain 1 to 200 characters".to_string());
            }
            if tool.permissions.is_empty()
                || tool.permissions.iter().any(|permission| {
                    !matches!(
                        permission.as_str(),
                        "read" | "write" | "destructive" | "external"
                    )
                })
            {
                return Err(format!("tool {} has invalid permissions", tool.name));
            }
        }
        Ok(())
    }

    pub fn sidecar_params(&self) -> Value {
        json!({
            "requestId": self.metadata.request_id,
            "threadId": self.metadata.thread_id,
            "turnId": self.metadata.turn_id,
            "contextVersion": self.metadata.context_version,
            "deadline": self.metadata.deadline,
            "projectId": self.project_id,
            "profile": self.profile,
            "messages": self.messages,
            "prompt": self.prompt,
            "provider": {
                "kind": self.provider.kind,
                "model": self.provider.model,
                "capabilities": self.provider.capabilities,
                "profileId": self.provider.profile_id,
                "executablePath": self.provider.executable_path,
                "reasoningEffort": self.provider.reasoning_effort,
                "serviceTier": self.provider.service_tier,
                "accessMode": self.provider.access_mode,
                "environmentKeys": self.provider.environment_keys,
            },
            "workspace": self.workspace,
            "tools": self.tools,
            "resumeCheckpoint": self.resume_checkpoint,
        })
    }

    pub fn persistable_value(&self) -> Value {
        self.sidecar_params()
    }

    /// Persist enough provider routing information for an app-process restart
    /// without ever serializing the provider credential. Rust reloads the key
    /// from the credential manager when the turn is resumed.
    pub fn resumable_value(&self) -> Value {
        json!({
            "requestId": self.metadata.request_id,
            "threadId": self.metadata.thread_id,
            "turnId": self.metadata.turn_id,
            "contextVersion": self.metadata.context_version,
            "deadline": self.metadata.deadline,
            "projectId": self.project_id,
            "profile": self.profile,
            "messages": self.messages,
            "prompt": self.prompt,
            "provider": {
                "kind": self.provider.kind,
                "baseUrl": self.provider.base_url,
                "model": self.provider.model,
                "timeoutMs": self.provider.timeout_ms,
                "capabilities": self.provider.capabilities,
                "profileId": self.provider.profile_id,
                "executablePath": self.provider.executable_path,
                "reasoningEffort": self.provider.reasoning_effort,
                "serviceTier": self.provider.service_tier,
                "accessMode": self.provider.access_mode,
                "environmentKeys": self.provider.environment_keys,
            },
            "workspace": self.workspace,
            "tools": self.tools,
            "resumeCheckpoint": self.resume_checkpoint,
        })
    }
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcErrorObject {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

pub fn rpc_request(id: u64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

pub fn rpc_notification(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

pub fn rpc_success(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn rpc_error(id: Value, code: i64, message: impl Into<String>, data: Option<Value>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": JsonRpcErrorObject { code, message: message.into(), data },
    })
}

pub fn rpc_id_key(id: &Value) -> Option<String> {
    match id {
        Value::String(value) => Some(format!("s:{value}")),
        Value::Number(value) => Some(format!("n:{value}")),
        _ => None,
    }
}

pub async fn read_json_frame<R>(reader: &mut R) -> Result<Option<Value>, IoError>
where
    R: AsyncBufRead + Unpin,
{
    let mut content_length = None;
    let mut header_bytes = 0usize;

    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).await?;
        if read == 0 {
            return if header_bytes == 0 {
                Ok(None)
            } else {
                Err(IoError::new(
                    ErrorKind::UnexpectedEof,
                    "agent host closed while reading frame headers",
                ))
            };
        }
        header_bytes = header_bytes.saturating_add(read);
        if header_bytes > MAX_HEADER_BYTES {
            return Err(IoError::new(
                ErrorKind::InvalidData,
                "agent host frame headers exceed 8 KiB",
            ));
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("Content-Length") {
                if content_length.is_some() {
                    return Err(IoError::new(
                        ErrorKind::InvalidData,
                        "duplicate Content-Length header",
                    ));
                }
                let parsed = value.trim().parse::<usize>().map_err(|_| {
                    IoError::new(ErrorKind::InvalidData, "invalid Content-Length header")
                })?;
                content_length = Some(parsed);
            }
        }
    }

    let content_length = content_length
        .ok_or_else(|| IoError::new(ErrorKind::InvalidData, "Content-Length header is required"))?;
    if content_length == 0 || content_length > AGENT_HOST_MAX_FRAME_BYTES {
        return Err(IoError::new(
            ErrorKind::InvalidData,
            format!(
                "agent host frame length must be between 1 and {} bytes",
                AGENT_HOST_MAX_FRAME_BYTES
            ),
        ));
    }

    let mut payload = vec![0u8; content_length];
    reader.read_exact(&mut payload).await?;
    serde_json::from_slice(&payload).map(Some).map_err(|error| {
        IoError::new(
            ErrorKind::InvalidData,
            format!("invalid agent host JSON frame: {error}"),
        )
    })
}

pub async fn write_json_frame<W>(writer: &mut W, value: &Value) -> Result<(), IoError>
where
    W: AsyncWrite + Unpin,
{
    let payload = serde_json::to_vec(value).map_err(|error| {
        IoError::new(
            ErrorKind::InvalidData,
            format!("failed to serialize agent host frame: {error}"),
        )
    })?;
    if payload.is_empty() || payload.len() > AGENT_HOST_MAX_FRAME_BYTES {
        return Err(IoError::new(
            ErrorKind::InvalidData,
            format!(
                "agent host frame length must be between 1 and {} bytes",
                AGENT_HOST_MAX_FRAME_BYTES
            ),
        ));
    }
    writer
        .write_all(format!("Content-Length: {}\r\n\r\n", payload.len()).as_bytes())
        .await?;
    writer.write_all(&payload).await?;
    writer.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{duplex, BufReader};

    #[tokio::test]
    async fn content_length_frame_round_trips_json() {
        let (mut client, server) = duplex(4096);
        let mut reader = BufReader::new(server);
        let expected = json!({"jsonrpc":"2.0","id":1,"result":{"ok":true}});

        let write = tokio::spawn(async move {
            write_json_frame(&mut client, &expected).await.unwrap();
            expected
        });
        let actual = read_json_frame(&mut reader).await.unwrap().unwrap();
        assert_eq!(actual, write.await.unwrap());
    }

    #[tokio::test]
    async fn rejects_frames_larger_than_four_mebibytes_before_allocating_payload() {
        let input = format!("Content-Length: {}\r\n\r\n", AGENT_HOST_MAX_FRAME_BYTES + 1);
        let mut reader = BufReader::new(input.as_bytes());
        let error = read_json_frame(&mut reader).await.unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidData);
    }

    #[tokio::test]
    async fn rejects_ambiguous_duplicate_content_length_headers() {
        let input = b"Content-Length: 2\r\nContent-Length: 3\r\n\r\n{}";
        let mut reader = BufReader::new(input.as_slice());
        let error = read_json_frame(&mut reader).await.unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidData);
    }

    #[test]
    fn model_stream_request_flattens_metadata_and_echoes_stream_id() {
        let request: ModelStreamRequest = serde_json::from_value(json!({
            "requestId":"request:model:1",
            "threadId":"thread",
            "turnId":"turn",
            "contextVersion":"ctx",
            "deadline":123,
            "streamId":"stream-1",
            "messages":[{"role":"user","content":"hello"}],
            "tools":[]
        }))
        .unwrap();
        assert_eq!(request.stream_id, "stream-1");
        assert_eq!(request.request.metadata.request_id, "request:model:1");
        assert_eq!(request.request.metadata.context_version, "ctx");
    }

    #[test]
    fn full_access_requires_codex_agent_mode_and_ultra_reasoning() {
        let mut request = codex_full_access_request();
        assert!(request.validate().is_ok());

        request.profile = AgentProfile::Plan;
        assert_eq!(
            request.validate().unwrap_err(),
            "Full access requires Agent mode with Ultra reasoning"
        );

        request.profile = AgentProfile::Agent;
        request.provider.reasoning_effort = Some("high".to_string());
        assert_eq!(
            request.validate().unwrap_err(),
            "Full access requires Agent mode with Ultra reasoning"
        );

        request.provider.reasoning_effort = Some("ultra".to_string());
        request.provider.kind = AgentProviderKind::CodebuddyCli;
        assert_eq!(
            request.validate().unwrap_err(),
            "Full access is only supported by Codex CLI"
        );
    }

    fn codex_full_access_request() -> AgentTurnRequest {
        AgentTurnRequest {
            metadata: RequestMetadata {
                request_id: "request".to_string(),
                thread_id: "thread".to_string(),
                turn_id: "turn".to_string(),
                context_version: "ctx".to_string(),
                deadline: 1,
            },
            project_id: "project".to_string(),
            profile: AgentProfile::Agent,
            messages: Vec::new(),
            prompt: "edit the project".to_string(),
            provider: AgentProviderConfig {
                kind: AgentProviderKind::CodexCli,
                base_url: String::new(),
                api_key: None,
                model: "gpt-test".to_string(),
                timeout_ms: None,
                capabilities: ProviderCapabilities {
                    streaming: true,
                    tool_calling: true,
                    structured_output: true,
                    max_input_tokens: None,
                    max_output_tokens: None,
                },
                profile_id: Some("codex-cli-default".to_string()),
                executable_path: None,
                reasoning_effort: Some("ultra".to_string()),
                service_tier: None,
                access_mode: Some("full".to_string()),
                environment_keys: Vec::new(),
            },
            workspace: WorkspaceContext {
                project_id: "project".to_string(),
                connection_id: None,
                database: None,
                namespace: None,
                active_tab_id: None,
                config_revision: None,
                fingerprint: "fingerprint".to_string(),
                summary: HashMap::new(),
            },
            tools: Vec::new(),
            resume_checkpoint: None,
        }
    }

    #[test]
    fn sidecar_params_do_not_include_provider_secrets() {
        let request = AgentTurnRequest {
            metadata: RequestMetadata {
                request_id: "request".to_string(),
                thread_id: "thread".to_string(),
                turn_id: "turn".to_string(),
                context_version: "ctx".to_string(),
                deadline: 1,
            },
            project_id: "project".to_string(),
            profile: AgentProfile::Agent,
            messages: vec![],
            prompt: "hello".to_string(),
            provider: AgentProviderConfig {
                kind: AgentProviderKind::OpenaiCompatible,
                base_url: "https://example.com/v1".to_string(),
                api_key: Some("super-secret".to_string()),
                model: "model".to_string(),
                timeout_ms: None,
                capabilities: ProviderCapabilities {
                    streaming: false,
                    tool_calling: true,
                    structured_output: true,
                    max_input_tokens: None,
                    max_output_tokens: None,
                },
                profile_id: None,
                executable_path: None,
                reasoning_effort: None,
                service_tier: None,
                access_mode: None,
                environment_keys: Vec::new(),
            },
            workspace: WorkspaceContext {
                project_id: "project".to_string(),
                connection_id: None,
                database: None,
                namespace: None,
                active_tab_id: None,
                config_revision: None,
                fingerprint: "fingerprint".to_string(),
                summary: HashMap::new(),
            },
            tools: vec![AgentToolManifestEntry {
                name: "metadata.listObjects".to_string(),
                description: "List objects".to_string(),
                input_schema: json!({"type":"object"}),
                permissions: vec!["read".to_string()],
                timeout_ms: None,
                result_limit: None,
            }],
            resume_checkpoint: None,
        };
        let params = request.sidecar_params();
        let serialized = params.to_string();
        assert!(!serialized.contains("super-secret"));
        assert!(!serialized.contains("baseUrl"));
        let tool = params["tools"][0].as_object().unwrap();
        assert!(!tool.contains_key("timeoutMs"));
        assert!(!tool.contains_key("resultLimit"));

        let resumable = request.resumable_value();
        let resumable_serialized = resumable.to_string();
        assert_eq!(
            resumable["provider"]["baseUrl"],
            json!("https://example.com/v1")
        );
        assert!(!resumable_serialized.contains("super-secret"));
        assert!(resumable["provider"].get("apiKey").is_none());
    }
}
