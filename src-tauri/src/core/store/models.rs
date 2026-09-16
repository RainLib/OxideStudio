use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};
use zeroize::Zeroizing;

pub(super) const CONNECTION_CREDENTIAL_KEY_BYTES: usize = 32;
pub(super) const CONNECTION_CREDENTIAL_KEY_FILE: &str = "connection-credentials-v1.secret";
pub(super) const CLI_CAPABILITY_CACHE_KEY_HEX_LENGTH: usize = 64;
pub(super) const CLI_CAPABILITY_CACHE_MAX_PAYLOAD_BYTES: usize = 1024 * 1024;
pub(super) const CLI_CAPABILITY_CACHE_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;
pub(super) const DRIVER_RUNTIME_TELEMETRY_RETENTION_MS: i64 = 180 * 24 * 60 * 60 * 1000;
pub(super) const DRIVER_RUNTIME_TELEMETRY_MAX_ROWS: i64 = 256;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    #[serde(default = "default_project_id")]
    pub project_id: String,
    pub name: String,
    pub driver: String,            // "mysql", "postgres", "mongodb", etc.
    pub config: serde_json::Value, // Generic config (host, port, user, etc.)
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub id: String,
    #[serde(default = "default_project_id")]
    pub project_id: String,
    pub connection_id: String,
    pub parent_id: Option<String>,
    pub kind: String, // "DATABASE", "TABLE", "COLUMN", "INDEX", "VIEW", "COLLECTION"
    pub name: String,
    pub metadata: serde_json::Value,
    pub last_updated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub root_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryItem {
    pub id: String,
    pub project_id: String,
    pub connection_id: Option<String>,
    pub connection_name: Option<String>,
    pub driver: Option<String>,
    pub database_name: Option<String>,
    pub schema_name: Option<String>,
    pub sql: String,
    pub status: String,
    pub duration_ms: i64,
    pub row_count: Option<i64>,
    pub error_message: Option<String>,
    pub execution_mode: String,
    pub started_at: i64,
    pub finished_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSqlFolder {
    pub id: String,
    pub project_id: String,
    pub connection_id: Option<String>,
    pub parent_folder_id: Option<String>,
    pub name: String,
    pub order_index: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSqlFile {
    pub id: String,
    pub project_id: String,
    pub connection_id: Option<String>,
    pub folder_id: Option<String>,
    pub name: String,
    pub database_name: Option<String>,
    pub schema_name: Option<String>,
    pub sql: String,
    #[serde(default = "default_true")]
    pub sql_loaded: bool,
    pub order_index: i64,
    pub open_count: i64,
    pub opened_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSqlLibrary {
    pub folders: Vec<SavedSqlFolder>,
    pub files: Vec<SavedSqlFile>,
}

pub(super) fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskPlanStep {
    pub id: String,
    pub title: String,
    pub tool_name: Option<String>,
    pub requires_approval: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskCompletedStep {
    pub id: String,
    pub tool_name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskExecutionReceipt {
    pub step_id: String,
    pub tool_name: String,
    pub status: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskContextBinding {
    pub version: u32,
    pub context_version: u32,
    pub fingerprint: String,
    pub project_id: String,
    pub active_connection_id: Option<String>,
    pub active_driver: Option<String>,
    pub active_database_name: Option<String>,
    pub active_namespace: Option<String>,
    pub active_tab_id: Option<String>,
    pub document_revision: Option<String>,
    pub selection_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskCheckpoint {
    pub version: u32,
    pub mode: String,
    #[serde(default)]
    pub context: Option<AssistantTaskContextBinding>,
    pub plan: Vec<AssistantTaskPlanStep>,
    pub completed_steps: Vec<AssistantTaskCompletedStep>,
    #[serde(default)]
    pub execution_receipts: Vec<AssistantTaskExecutionReceipt>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskRecord {
    pub id: String,
    pub project_id: String,
    pub request_id: String,
    pub session_id: String,
    pub status: String,
    pub title: String,
    pub detail: Option<String>,
    pub current_step_id: Option<String>,
    pub current_tool_name: Option<String>,
    pub progress: Option<f64>,
    pub checkpoint: AssistantTaskCheckpoint,
    pub created_at: i64,
    pub updated_at: i64,
    pub finished_at: Option<i64>,
}

pub(super) fn default_project_id() -> String {
    "sqls".to_string()
}

pub(super) fn current_timestamp_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) fn validate_saved_sql_identity(project_id: &str, id: &str, name: &str) -> Result<()> {
    if project_id.trim().is_empty() || id.trim().is_empty() {
        anyhow::bail!("saved SQL project and item ids cannot be empty");
    }
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 240 {
        anyhow::bail!("saved SQL name must contain between 1 and 240 characters");
    }
    if name.chars().any(|character| character.is_control()) {
        anyhow::bail!("saved SQL name cannot contain control characters");
    }
    Ok(())
}

#[derive(Clone)]
pub struct MetaStore {
    pub(super) pool: Pool<Sqlite>,
    pub(super) credential_key: Zeroizing<[u8; CONNECTION_CREDENTIAL_KEY_BYTES]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriverRuntimeEventKind {
    Launched,
    Exited,
    ReconnectAttempted,
    ReconnectSucceeded,
    ReconnectFailed,
    ReconnectBudgetBlocked,
}

impl DriverRuntimeEventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Launched => "launched",
            Self::Exited => "exited",
            Self::ReconnectAttempted => "reconnect-attempted",
            Self::ReconnectSucceeded => "reconnect-succeeded",
            Self::ReconnectFailed => "reconnect-failed",
            Self::ReconnectBudgetBlocked => "reconnect-budget-blocked",
        }
    }

    pub(super) fn is_known_code(value: &str) -> bool {
        matches!(
            value,
            "launched"
                | "exited"
                | "reconnect-attempted"
                | "reconnect-succeeded"
                | "reconnect-failed"
                | "reconnect-budget-blocked"
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriverRuntimeTelemetryRecord {
    pub driver: String,
    pub package_version: String,
    pub launch_count: u64,
    pub observed_exit_count: u64,
    pub reconnect_attempt_count: u64,
    pub reconnect_success_count: u64,
    pub reconnect_failure_count: u64,
    pub reconnect_budget_block_count: u64,
    pub last_event_code: String,
    pub last_event_at_millis: u64,
    pub last_started_at_millis: Option<u64>,
    pub last_exit_observed_at_millis: Option<u64>,
    pub last_reconnect_at_millis: Option<u64>,
}
