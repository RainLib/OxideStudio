use super::identity_helpers::bounded_text;
use super::process_helpers::find_oxide_agent_cli_binary;
use super::session_state::{AgentHostInner, Lifecycle, LifecycleState};
use super::tool_manifest::installed_host_tool_names;
use super::turn_state::TurnKey;
use crate::agent::model::ModelGateway;
use crate::agent::protocol::AgentActionAccepted;
use crate::agent::protocol::AgentAnswerClarificationRequest;
use crate::agent::protocol::AgentApproveActionRequest;
use crate::agent::protocol::AgentArtifactExportRequest;
use crate::agent::protocol::AgentArtifactExportResult;
use crate::agent::protocol::AgentArtifactReadRequest;
use crate::agent::protocol::AgentArtifactReadResult;
use crate::agent::protocol::AgentArtifactSearchRequest;
use crate::agent::protocol::AgentArtifactSearchResult;
use crate::agent::protocol::AgentCancelTurnRequest;
use crate::agent::protocol::AgentContextMetrics;
use crate::agent::protocol::AgentConversationSnapshot;
use crate::agent::protocol::AgentConversationSnapshotSaveRequest;
use crate::agent::protocol::AgentConversationSummary;
use crate::agent::protocol::AgentHostStatus;
use crate::agent::protocol::AgentProjectStateCleared;
use crate::agent::protocol::AgentProviderKind;
use crate::agent::protocol::AgentToolManifestEntry;
use crate::agent::protocol::AgentTurnAccepted;
use crate::agent::protocol::AgentTurnJournal;
use crate::agent::protocol::AgentTurnRequest;
use crate::agent::protocol::RequestMetadata;
use crate::agent::protocol::AGENT_HOST_PROTOCOL_VERSION;
use crate::agent::store::AgentStore;
use crate::core::manager::ConnectionManager;
use anyhow::anyhow;
use anyhow::Context;
use anyhow::Result;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AgentHostManager {
    pub(super) inner: Arc<AgentHostInner>,
}

impl AgentHostManager {
    /// Construction is intentionally side-effect free: no process, filesystem, or DB I/O.
    pub fn new(app: &AppHandle) -> Self {
        Self {
            inner: Arc::new(AgentHostInner {
                app: app.clone(),
                store: AgentStore::new(app),
                model: ModelGateway::new().map_err(|error| bounded_text(&error.to_string(), 2_000)),
                lifecycle: RwLock::new(Lifecycle {
                    state: LifecycleState::Stopped,
                    capabilities: Vec::new(),
                    binary_path: None,
                    last_error: None,
                }),
                process: RwLock::new(None),
                start_lock: Mutex::new(()),
                turn_transition_lock: Mutex::new(()),
                pending: Mutex::new(HashMap::new()),
                inbound_cancellations: Mutex::new(HashMap::new()),
                providers: RwLock::new(HashMap::new()),
                turns: RwLock::new(HashMap::new()),
                cli_turns: Mutex::new(HashMap::new()),
                event_sequences: RwLock::new(HashMap::new()),
                event_delta_batches: Mutex::new(HashMap::new()),
                turn_journals: RwLock::new(HashMap::new()),
                clarifications: RwLock::new(HashMap::new()),
                approvals: RwLock::new(HashMap::new()),
                approval_waiters: Mutex::new(HashMap::new()),
                leases: RwLock::new(HashMap::new()),
                command_preflights: RwLock::new(HashMap::new()),
                agent_connections: ConnectionManager::new(),
                connected_targets: RwLock::new(HashMap::new()),
                mutation_connections: ConnectionManager::new(),
                connected_mutation_targets: RwLock::new(HashMap::new()),
                mutation_turn_states: RwLock::new(HashMap::new()),
                connection_lock: Mutex::new(()),
                mutation_connection_lock: Mutex::new(()),
                context_metrics_lock: Mutex::new(()),
                cleanup_started: AtomicBool::new(false),
                next_request_id: AtomicU64::new(1),
                next_generation: AtomicU64::new(1),
            }),
        }
    }

    pub async fn start_turn(&self, request: AgentTurnRequest) -> Result<AgentTurnAccepted> {
        self.inner.start_or_resume(request, false).await
    }

    pub async fn resume_turn(&self, request: AgentTurnRequest) -> Result<AgentTurnAccepted> {
        self.inner.start_or_resume(request, true).await
    }

    pub async fn cancel_turn(
        &self,
        request: AgentCancelTurnRequest,
    ) -> Result<AgentActionAccepted> {
        self.inner.cancel_turn(request).await
    }

    pub async fn turn_runtime_status(
        &self,
        request: AgentCancelTurnRequest,
    ) -> Result<crate::agent::protocol::AgentTurnRuntimeStatus> {
        request.metadata.validate().map_err(anyhow::Error::msg)?;
        let key = TurnKey::from_metadata(&request.metadata);
        Ok(crate::agent::protocol::AgentTurnRuntimeStatus {
            active: self.inner.turns.read().await.contains_key(&key),
        })
    }

    pub async fn turn_journal(
        &self,
        project_id: &str,
        thread_id: &str,
        turn_id: &str,
    ) -> Result<Option<AgentTurnJournal>> {
        let Some(value) = self
            .inner
            .store
            .load_turn_journal(project_id, turn_id)
            .await?
        else {
            return Ok(None);
        };
        let journal: AgentTurnJournal =
            serde_json::from_value(value).context("stored agent turn journal is invalid")?;
        if journal.project_id != project_id
            || journal.thread_id != thread_id
            || journal.turn_id != turn_id
        {
            return Err(anyhow!(
                "stored agent turn journal scope does not match the request"
            ));
        }
        Ok(Some(journal))
    }

    pub async fn answer_clarification(
        &self,
        request: AgentAnswerClarificationRequest,
    ) -> Result<AgentActionAccepted> {
        self.inner.answer_clarification(request).await
    }

    pub async fn approve_action(
        &self,
        request: AgentApproveActionRequest,
    ) -> Result<AgentActionAccepted> {
        self.inner.approve_action(request).await
    }

    pub(crate) async fn private_bridge_tools(
        &self,
        metadata: &RequestMetadata,
    ) -> Result<Vec<AgentToolManifestEntry>> {
        self.inner.private_bridge_tools(metadata).await
    }

    pub(crate) async fn invoke_private_bridge_tool(
        &self,
        metadata: &RequestMetadata,
        call_id: String,
        tool_name: String,
        input: Value,
    ) -> Result<Value> {
        self.inner
            .invoke_private_bridge_tool(metadata, call_id, tool_name, input)
            .await
            .map_err(|error| anyhow!(error.message))
    }

    pub async fn start_private_bridge(
        &self,
        metadata: RequestMetadata,
    ) -> Result<crate::agent::bridge::PrivateBridgeSession> {
        self.inner.validate_active(&metadata).await?;
        crate::agent::bridge::PrivateBridgeSession::start(self.clone(), metadata).await
    }

    pub async fn clear_project_state(&self, project_id: &str) -> Result<AgentProjectStateCleared> {
        self.inner.clear_project_state(project_id).await
    }

    pub async fn context_metrics(&self, project_id: &str) -> Result<AgentContextMetrics> {
        self.inner.load_context_metrics(project_id).await
    }

    pub async fn save_conversation_snapshot(
        &self,
        request: AgentConversationSnapshotSaveRequest,
    ) -> Result<AgentConversationSnapshot> {
        self.inner.save_conversation_snapshot(request).await
    }

    pub async fn load_conversation_snapshot(
        &self,
        project_id: &str,
        conversation_id: Option<&str>,
    ) -> Result<Option<AgentConversationSnapshot>> {
        self.inner
            .load_conversation_snapshot(project_id, conversation_id)
            .await
    }

    pub async fn list_conversation_snapshots(
        &self,
        project_id: &str,
        conversation_scope: &str,
    ) -> Result<Vec<AgentConversationSummary>> {
        self.inner
            .list_conversation_snapshots(project_id, conversation_scope)
            .await
    }

    pub async fn read_artifact(
        &self,
        request: AgentArtifactReadRequest,
    ) -> Result<AgentArtifactReadResult> {
        self.inner.read_artifact(request).await
    }

    pub async fn search_artifact(
        &self,
        request: AgentArtifactSearchRequest,
    ) -> Result<AgentArtifactSearchResult> {
        self.inner.search_artifact(request).await
    }

    pub async fn export_artifact(
        &self,
        request: AgentArtifactExportRequest,
    ) -> Result<AgentArtifactExportResult> {
        self.inner.export_artifact(request).await
    }

    pub async fn status(
        &self,
        provider_configured: bool,
        provider_kind: Option<AgentProviderKind>,
    ) -> AgentHostStatus {
        if !provider_configured {
            return AgentHostStatus {
                state: "skipped".to_string(),
                available: false,
                protocol_version: AGENT_HOST_PROTOCOL_VERSION,
                capabilities: Vec::new(),
                installed_tools: installed_host_tool_names(),
                binary_path: None,
                storage_mode: "not-initialized".to_string(),
                last_error: None,
            };
        }
        if matches!(
            provider_kind,
            Some(AgentProviderKind::CodexCli | AgentProviderKind::CodebuddyCli)
        ) {
            let binary = find_oxide_agent_cli_binary(&self.inner.app);
            let available = binary.is_some();
            return AgentHostStatus {
                state: if available { "ready" } else { "unavailable" }.to_string(),
                available,
                protocol_version: AGENT_HOST_PROTOCOL_VERSION,
                capabilities: vec![
                    "chat".to_string(),
                    "plan".to_string(),
                    "agent".to_string(),
                    "cli-provider".to_string(),
                    "tool-proxy".to_string(),
                    "approval".to_string(),
                    "interrupt-safe".to_string(),
                ],
                installed_tools: installed_host_tool_names(),
                binary_path: binary.map(|path| path.to_string_lossy().into_owned()),
                storage_mode: "encrypted-desktop".to_string(),
                last_error: (!available).then(|| {
                    "The bundled oxide-agent private bridge executable is unavailable".to_string()
                }),
            };
        }
        self.inner.prewarm().await;
        self.inner.status().await
    }
}
