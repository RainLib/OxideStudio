use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

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

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentProviderKind {
    #[default]
    OpenaiCompatible,
    CodexCli,
    CodebuddyCli,
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
    /// Rust-owned gateway credentials. The renderer cannot populate this
    /// field, and it is never serialized to the sidecar or a checkpoint.
    #[serde(default, skip_deserializing)]
    pub(crate) custom_headers: std::collections::BTreeMap<String, String>,
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
            .field(
                "custom_header_names",
                &self.custom_headers.keys().collect::<Vec<_>>(),
            )
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
