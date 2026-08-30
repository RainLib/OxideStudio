use crate::{
    agent::{
        model::ModelGateway,
        protocol::{
            read_json_frame, rpc_error, rpc_id_key, rpc_notification, rpc_request, rpc_success,
            write_json_frame, AgentActionAccepted, AgentAnswerClarificationRequest,
            AgentApproveActionRequest, AgentArtifactExportRequest, AgentArtifactExportResult,
            AgentArtifactReadRequest, AgentArtifactReadResult, AgentArtifactSearchMatch,
            AgentArtifactSearchRequest, AgentArtifactSearchResult, AgentCancelTurnRequest,
            AgentContextCompactionMetrics, AgentContextMetrics, AgentConversationSnapshot,
            AgentConversationSnapshotSaveRequest, AgentConversationSummary, AgentHostStatus,
            AgentModelUsageMetrics, AgentProfile, AgentProjectStateCleared, AgentProviderConfig,
            AgentProviderKind, AgentToolManifestEntry, AgentTurnAccepted, AgentTurnJournal,
            AgentTurnRequest, ApprovalDecision, ArtifactReadRequest, ArtifactSearchRequest,
            BoundedObservation, CheckpointRequest, GraphCheckpointDeleteThreadRequest,
            GraphCheckpointGetRequest, GraphCheckpointListRequest, GraphCheckpointPutRequest,
            GraphCheckpointPutWritesRequest, GraphTypedBlob, ModelCompleteRequest,
            ModelStreamRequest, RequestMetadata, ToolInvokeRequest, ToolPreflightRequest,
            AGENT_HOST_EVENT_CHANNEL, AGENT_HOST_MAX_FRAME_BYTES, AGENT_HOST_PROTOCOL_VERSION,
            HOST_CANCEL_TURN_METHOD, HOST_INITIALIZE_METHOD, HOST_MODEL_CHUNK_METHOD,
            HOST_RESUME_TURN_METHOD, HOST_START_TURN_METHOD, SIDECAR_ARTIFACT_READ_METHOD,
            SIDECAR_ARTIFACT_SEARCH_METHOD, SIDECAR_CHECKPOINT_LOAD_METHOD,
            SIDECAR_CHECKPOINT_SAVE_METHOD, SIDECAR_EVENT_METHOD,
            SIDECAR_GRAPH_CHECKPOINT_DELETE_THREAD_METHOD, SIDECAR_GRAPH_CHECKPOINT_GET_METHOD,
            SIDECAR_GRAPH_CHECKPOINT_LIST_METHOD, SIDECAR_GRAPH_CHECKPOINT_PUT_METHOD,
            SIDECAR_GRAPH_CHECKPOINT_PUT_WRITES_METHOD, SIDECAR_MODEL_COMPLETE_METHOD,
            SIDECAR_MODEL_STREAM_METHOD, SIDECAR_TOOL_INVOKE_METHOD, SIDECAR_TOOL_PREFLIGHT_METHOD,
        },
        shell::{
            evaluate_shell_command_policy, execute_shell_command, CommandPolicyDecision,
            CommandPreflightResult, ShellSandboxMode, DEFAULT_SHELL_TIMEOUT_MS,
            MAX_SHELL_TIMEOUT_MS,
        },
        store::{AgentStore, StoredGraphCheckpoint, StoredGraphWrite},
    },
    ai_cli::{
        agent::{
            classify_cli_error, prepare_cli_run, CliAgentError, CliAgentEvent, CliAgentEventParser,
        },
        CliProviderKind,
    },
    core::{
        config::{ConfigManager, ConnectionEnvironment, SavedConnection as ConfigSavedConnection},
        dialect::{
            all_database_capabilities, canonical_driver_name, database_capabilities_for_driver,
            DatabaseCapabilities, DatabaseKind,
        },
        driver::DatabaseDriver,
        driver_package::{
            is_safe_driver_package_token, DatabaseDriverPackageRegistry, DriverPackageStatus,
        },
        explain::{build_explain_statement, parse_explain_results},
        manager::ConnectionManager,
        protocol::{ExplainPlanMode, QueryResult},
        provider_secret::load_provider_secret,
        sqlite_worker_artifact::SqliteWorkerArtifactRegistry,
        ssh::SshTunnel,
        statement::{
            execution_statement_kind, split_sql_statements, validate_read_only_sql, StatementKind,
            StatementScanDialect,
        },
        store::{MetaStore, SavedConnection as StoreSavedConnection},
    },
    drivers::{
        connect_agent_read_only_preferred_driver, connect_preferred_driver,
        sqlite_ssh::RemoteSqliteDriver,
    },
};
use anyhow::{anyhow, Context, Result};
use base64::{
    engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD as BASE64_URL},
    Engine,
};
use rand::{rngs::OsRng, RngCore};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Weak,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{mpsc, oneshot, watch, Mutex, RwLock},
};

const HANDSHAKE_TIMEOUT_MILLIS: i64 = 10_000;
const DEFAULT_TOOL_RESULT_BYTES: usize = 256 * 1024;
const MAX_TOOL_RESULT_BYTES: usize = 1024 * 1024;
const MAX_TOOL_RESULT_ROWS: usize = 10_000;
const APPROVAL_LEASE_BYTES: usize = 32;
const MAX_HUMAN_RESUME_MILLIS: i64 = 2 * 60 * 60 * 1_000;
const MAX_ARTIFACT_READ_BYTES: usize = 64 * 1024;
const MAX_ARTIFACT_SEARCH_MATCHES: usize = 20;
const MAX_ARTIFACT_SEARCH_CONTEXT_BYTES: usize = 512;
const CONTEXT_METRICS_THREAD_ID: &str = "__oxide_context_metrics_v1__";
const CONVERSATION_SNAPSHOT_THREAD_ID: &str = "__oxide_ui_conversation_v1__";
const MAX_CONVERSATION_TURNS: usize = 100;
const MAX_CONVERSATION_RESUME_REQUESTS: usize = 8;
const MAX_CONVERSATION_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;

const REQUIRED_CAPABILITIES: &[&str] = &[
    "chat",
    "plan",
    "agent",
    "model-proxy",
    "tool-proxy",
    "checkpoint-proxy",
    "artifact-proxy",
    "clarification",
    "approval",
    "subagents",
    "context-compaction",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RustHostTool {
    ProjectListFiles,
    ProjectReadFile,
    ProjectWriteFile,
    ConnectionList,
    ConnectionCapabilities,
    ProviderList,
    WorkspaceGetActiveTab,
    MetadataListCollections,
    MetadataListObjects,
    MetadataDescribeObject,
    QueryRunReadOnly,
    QueryExplain,
    QueryExecuteApproved,
    ShellExecute,
}

impl RustHostTool {
    const ALL: [Self; 14] = [
        Self::ProjectListFiles,
        Self::ProjectReadFile,
        Self::ProjectWriteFile,
        Self::ConnectionList,
        Self::ConnectionCapabilities,
        Self::ProviderList,
        Self::WorkspaceGetActiveTab,
        Self::MetadataListCollections,
        Self::MetadataListObjects,
        Self::MetadataDescribeObject,
        Self::QueryRunReadOnly,
        Self::QueryExplain,
        Self::QueryExecuteApproved,
        Self::ShellExecute,
    ];

    const fn name(self) -> &'static str {
        match self {
            Self::ProjectListFiles => "project.listFiles",
            Self::ProjectReadFile => "project.readFile",
            Self::ProjectWriteFile => "project.writeFile",
            Self::ConnectionList => "connection.list",
            Self::ConnectionCapabilities => "connection.capabilities",
            Self::ProviderList => "provider.list",
            Self::WorkspaceGetActiveTab => "workspace.getActiveTab",
            Self::MetadataListCollections => "metadata.listCollections",
            Self::MetadataListObjects => "metadata.listObjects",
            Self::MetadataDescribeObject => "metadata.describeObject",
            Self::QueryRunReadOnly => "query.runReadOnly",
            Self::QueryExplain => "query.explain",
            Self::QueryExecuteApproved => "query.executeApproved",
            Self::ShellExecute => "shell.execute",
        }
    }

    const fn permissions(self) -> &'static [&'static str] {
        match self {
            Self::ProjectWriteFile | Self::QueryExecuteApproved => &["write"],
            Self::ShellExecute => &["external"],
            _ => &["read"],
        }
    }

    fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|tool| tool.name() == name)
    }
}

fn installed_host_tool_names() -> Vec<String> {
    RustHostTool::ALL
        .into_iter()
        .map(|tool| tool.name().to_string())
        .collect()
}

fn validate_host_tool_manifest(
    profile: AgentProfile,
    tools: &[AgentToolManifestEntry],
) -> Result<()> {
    for tool in tools {
        let Some(installed) = RustHostTool::from_name(&tool.name) else {
            return Err(anyhow!(
                "tool {} is not installed in the Rust Agent Host",
                bounded_text(&tool.name, 200)
            ));
        };
        if tool.permissions.len() != installed.permissions().len()
            || !installed
                .permissions()
                .iter()
                .all(|permission| tool.permissions.iter().any(|value| value == permission))
        {
            return Err(anyhow!(
                "tool {} permissions do not match the Rust Agent Host policy",
                bounded_text(&tool.name, 200)
            ));
        }
        if profile == AgentProfile::Chat && installed != RustHostTool::WorkspaceGetActiveTab {
            return Err(anyhow!(
                "tool {} is unavailable in Chat mode",
                bounded_text(&tool.name, 200)
            ));
        }
        if profile == AgentProfile::Plan
            && (installed == RustHostTool::ProjectWriteFile
                || tool
                    .permissions
                    .iter()
                    .any(|permission| permission != "read"))
        {
            return Err(anyhow!(
                "tool {} is not read-only and is unavailable in Plan mode",
                bounded_text(&tool.name, 200)
            ));
        }
    }
    Ok(())
}

#[derive(Clone)]
pub struct AgentHostManager {
    inner: Arc<AgentHostInner>,
}

struct AgentHostInner {
    app: AppHandle,
    store: AgentStore,
    model: std::result::Result<ModelGateway, String>,
    lifecycle: RwLock<Lifecycle>,
    process: RwLock<Option<Arc<HostProcess>>>,
    start_lock: Mutex<()>,
    turn_transition_lock: Mutex<()>,
    pending: Mutex<HashMap<String, PendingResponse>>,
    inbound_cancellations: Mutex<HashMap<String, InboundCancellation>>,
    providers: RwLock<HashMap<TurnKey, AgentProviderConfig>>,
    turns: RwLock<HashMap<TurnKey, ActiveTurn>>,
    cli_turns: Mutex<HashMap<TurnKey, CliTurnHandle>>,
    event_sequences: RwLock<HashMap<TurnKey, u64>>,
    turn_journals: RwLock<HashMap<TurnKey, TurnJournalBuffer>>,
    clarifications: RwLock<HashMap<String, PendingClarification>>,
    approvals: RwLock<HashMap<String, PendingApproval>>,
    approval_waiters: Mutex<HashMap<String, oneshot::Sender<BridgeApprovalDecision>>>,
    leases: RwLock<HashMap<String, ApprovalGrant>>,
    command_preflights: RwLock<HashMap<String, PendingCommandPreflight>>,
    agent_connections: ConnectionManager,
    connected_targets: RwLock<HashMap<String, ConnectedAgentTarget>>,
    mutation_connections: ConnectionManager,
    connected_mutation_targets: RwLock<HashMap<String, ConnectedAgentTarget>>,
    mutation_turn_states: RwLock<HashMap<TurnKey, MutationTurnState>>,
    connection_lock: Mutex<()>,
    mutation_connection_lock: Mutex<()>,
    context_metrics_lock: Mutex<()>,
    cleanup_started: AtomicBool,
    next_request_id: AtomicU64,
    next_generation: AtomicU64,
}

struct HostProcess {
    generation: u64,
    writer: Mutex<ChildStdin>,
    // Retaining Child makes kill_on_drop effective when a failed generation is replaced.
    _child: Mutex<Child>,
    binary_path: PathBuf,
}

#[derive(Clone)]
struct CliTurnHandle {
    generation: u64,
    cancellation: watch::Sender<bool>,
}

#[derive(Clone)]
struct AgentLaunch {
    program: PathBuf,
    arguments: Vec<PathBuf>,
    display_path: PathBuf,
}

struct PendingResponse {
    generation: u64,
    sender: oneshot::Sender<std::result::Result<Value, HostCallError>>,
}

struct InboundCancellation {
    generation: u64,
    sender: watch::Sender<bool>,
}

#[derive(Debug, Clone)]
struct Lifecycle {
    state: LifecycleState,
    capabilities: Vec<String>,
    binary_path: Option<PathBuf>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LifecycleState {
    Stopped,
    Starting,
    Ready,
    Unavailable,
    Crashed,
}

impl LifecycleState {
    fn label(self) -> &'static str {
        match self {
            Self::Stopped => "stopped",
            Self::Starting => "starting",
            Self::Ready => "ready",
            Self::Unavailable => "unavailable",
            Self::Crashed => "crashed",
        }
    }
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct TurnKey {
    thread_id: String,
    turn_id: String,
}

const MAX_TURN_JOURNAL_EVENTS: usize = 160;
const MAX_TURN_JOURNAL_EVENT_BYTES: usize = 24 * 1024;

#[derive(Default)]
struct TurnJournalBuffer {
    events: Vec<Value>,
    truncated: bool,
}

#[derive(Clone)]
struct ActiveTurn {
    project_id: String,
    profile: AgentProfile,
    checkpoint_thread_id: String,
    context_version: String,
    prompt: String,
    active_tab: Option<Value>,
    tab_connection_id: Option<String>,
    tab_namespace: Option<String>,
    connection_id: Option<String>,
    database: Option<String>,
    namespace: Option<String>,
    deadline: i64,
    tools: HashMap<String, AgentToolManifestEntry>,
}

struct PendingClarification {
    key: TurnKey,
    expires_at: i64,
}

#[derive(Clone)]
struct PendingApproval {
    key: TurnKey,
    call_id: String,
    input_digest: String,
    tool_name: String,
    policy_digest: Option<String>,
    confirmation_phrase: Option<String>,
    origin: ApprovalOrigin,
    expires_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ApprovalOrigin {
    Sidecar,
    PrivateBridge,
}

enum BridgeApprovalDecision {
    Approved(String),
    Rejected,
}

struct ApprovalGrant {
    key: TurnKey,
    call_id: String,
    input_digest: String,
    tool_name: String,
    policy_digest: Option<String>,
    expires_at: i64,
}

#[derive(Clone)]
struct PendingCommandPreflight {
    key: TurnKey,
    call_id: String,
    input_digest: String,
    tool_name: String,
    result: CommandPreflightResult,
    expires_at: i64,
}

#[derive(Clone)]
struct ConnectedAgentTarget {
    project_id: String,
    config_digest: String,
}

struct ResolvedAgentConnection {
    id: String,
    driver: String,
    capabilities: DatabaseCapabilities,
    sidecar_read_only_enforced: bool,
    config: ConfigSavedConnection,
    config_digest: String,
    database: Option<String>,
    namespace: String,
}

#[derive(Debug, Clone)]
struct ApprovedQueryReview {
    operation_type: String,
    destructive: bool,
    confirmation_phrase: Option<String>,
    summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MutationTurnState {
    Started,
    Completed,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContextMetricsUpdate {
    Compaction {
        input_tokens: u64,
        retained_tokens: u64,
        offloaded_artifacts: u64,
    },
    ModelUsage {
        calls: u64,
        input_tokens: u64,
        output_tokens: u64,
        total_tokens: u64,
    },
}

#[derive(Debug)]
enum HostCallError {
    Transport(String),
    Remote { code: i64, message: String },
}

impl HostCallError {
    fn is_transport(&self) -> bool {
        matches!(self, Self::Transport(_))
    }

    fn safe_message(&self) -> String {
        match self {
            Self::Transport(message) => bounded_text(message, 2_000),
            Self::Remote { message, .. } => bounded_text(message, 2_000),
        }
    }
}

impl std::fmt::Display for HostCallError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport(message) => write!(formatter, "{message}"),
            Self::Remote { code, message, .. } => {
                write!(formatter, "agent host RPC error {code}: {message}")
            }
        }
    }
}

impl std::error::Error for HostCallError {}

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

impl AgentHostInner {
    async fn start_or_resume(
        self: &Arc<Self>,
        request: AgentTurnRequest,
        resume: bool,
    ) -> Result<AgentTurnAccepted> {
        request.validate().map_err(anyhow::Error::msg)?;
        validate_host_tool_manifest(request.profile, &request.tools)?;
        ensure_not_expired(request.metadata.deadline)?;
        self.start_cleanup_task();
        let key = TurnKey::from_metadata(&request.metadata);
        let active = ActiveTurn::from_request(&request);
        let mut provider = request.provider.clone();
        let cli_provider = matches!(
            provider.kind,
            AgentProviderKind::CodexCli | AgentProviderKind::CodebuddyCli
        );
        if cli_provider && resume {
            return Err(anyhow!(
                "CLI turns interrupted by an application restart are never replayed automatically; start a new turn to retry safely"
            ));
        }
        if provider.kind == crate::agent::protocol::AgentProviderKind::OpenaiCompatible
            && provider
                .api_key
                .as_deref()
                .is_none_or(|secret| secret.trim().is_empty())
        {
            // A missing entry is valid for keyless/local providers. Credential
            // manager failures are not: silently turning them into an anonymous
            // HTTP request produces a misleading provider 401.
            match load_provider_secret(&self.app, &provider.base_url).await {
                Ok(Some(secret)) => provider.api_key = Some(secret),
                Ok(None) => {}
                Err(error) => {
                    return Err(error.context("failed to load the AI provider credential"));
                }
            }
        }

        let turn_transition = self.turn_transition_lock.lock().await;
        self.clear_turn(&key).await;

        self.store
            .save_thread(
                &request.project_id,
                &request.metadata.thread_id,
                &request.persistable_value(),
            )
            .await
            .context("failed to persist encrypted agent thread")?;
        self.providers
            .write()
            .await
            .insert(key.clone(), provider.clone());
        self.turns.write().await.insert(key.clone(), active);
        self.turn_journals.write().await.remove(&key);
        self.persist_turn_journal_event(
            &key,
            &request.project_id,
            &json!({
                "type": "turn.status",
                "threadId": request.metadata.thread_id.clone(),
                "turnId": request.metadata.turn_id.clone(),
                "sequence": 0,
                "occurredAt": now_millis(),
                "status": "starting",
                "label": if resume { "Resuming" } else { "Starting" },
            }),
        )
        .await;

        if cli_provider {
            if let Err(error) = self
                .launch_cli_turn(key.clone(), request.clone(), provider)
                .await
            {
                self.clear_turn(&key).await;
                return Err(error);
            }
            drop(turn_transition);
            return Ok(AgentTurnAccepted {
                request_id: request.metadata.request_id,
                thread_id: request.metadata.thread_id,
                turn_id: request.metadata.turn_id,
                accepted: true,
            });
        }

        let method = if resume {
            HOST_RESUME_TURN_METHOD
        } else {
            HOST_START_TURN_METHOD
        };
        drop(turn_transition);
        let result = self
            .invoke_with_restart(method, request.sidecar_params(), request.metadata.deadline)
            .await;
        if let Err(error) = result {
            self.clear_turn(&key).await;
            return Err(anyhow!(error.safe_message()));
        }

        Ok(AgentTurnAccepted {
            request_id: request.metadata.request_id,
            thread_id: request.metadata.thread_id,
            turn_id: request.metadata.turn_id,
            accepted: true,
        })
    }

    async fn launch_cli_turn(
        self: &Arc<Self>,
        key: TurnKey,
        request: AgentTurnRequest,
        provider: AgentProviderConfig,
    ) -> Result<()> {
        let manager = AgentHostManager {
            inner: Arc::clone(self),
        };
        let bridge = manager
            .start_private_bridge(request.metadata.clone())
            .await
            .context("failed to start the private CLI tool bridge")?;
        let prepared = prepare_cli_run(&self.app, &request, &provider, bridge)
            .await
            .context("failed to prepare the CLI provider")?;
        let provider_kind = prepared.provider;
        let (cancellation, cancellation_receiver) = watch::channel(false);
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        self.cli_turns.lock().await.insert(
            key.clone(),
            CliTurnHandle {
                generation,
                cancellation,
            },
        );
        let inner = Arc::clone(self);
        tokio::spawn(async move {
            inner
                .run_cli_turn(
                    key,
                    request.metadata,
                    request.project_id,
                    provider_kind,
                    generation,
                    prepared,
                    cancellation_receiver,
                )
                .await;
        });
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_cli_turn(
        self: Arc<Self>,
        key: TurnKey,
        metadata: RequestMetadata,
        project_id: String,
        provider: CliProviderKind,
        generation: u64,
        prepared: crate::ai_cli::agent::PreparedCliRun,
        cancellation: watch::Receiver<bool>,
    ) {
        self.emit_cli_event(
            &key,
            &metadata,
            "turn.status",
            json!({"status":"starting","label":format!("Starting {}", provider.display_name())}),
        )
        .await;
        self.emit_cli_event(
            &key,
            &metadata,
            "provider.activity",
            json!({
                "provider":provider.as_str(),
                "status":"starting",
                "label":format!("Launching {} in an isolated workspace", provider.display_name()),
            }),
        )
        .await;

        let (events_sender, mut events_receiver) = mpsc::unbounded_channel();
        let runner = tokio::spawn(prepared.run(cancellation.clone(), events_sender));
        let mut parser = CliAgentEventParser::new(provider);
        let mut terminal_error: Option<CliAgentError> = None;
        while let Some(raw_event) = events_receiver.recv().await {
            if !self.cli_generation_is_current(&key, generation).await {
                continue;
            }
            for event in parser.parse(&raw_event) {
                match event {
                    CliAgentEvent::TextDelta(content) => {
                        self.emit_cli_event(
                            &key,
                            &metadata,
                            "answer.delta",
                            json!({"content":content,"reset":false}),
                        )
                        .await;
                    }
                    CliAgentEvent::Activity { status, label } => {
                        self.emit_cli_event(
                            &key,
                            &metadata,
                            "provider.activity",
                            json!({
                                "provider":provider.as_str(),
                                "status":status,
                                "label":label,
                            }),
                        )
                        .await;
                    }
                    CliAgentEvent::ToolStarted { call_id, tool_name } => {
                        self.emit_cli_event(
                            &key,
                            &metadata,
                            "tool.started",
                            json!({
                                "callId":call_id,
                                "toolName":tool_name,
                                "label":format!("Running {tool_name}"),
                            }),
                        )
                        .await;
                    }
                    CliAgentEvent::ToolFinished {
                        call_id,
                        tool_name,
                        success,
                        detail,
                    } => {
                        self.emit_cli_event(
                            &key,
                            &metadata,
                            "tool.finished",
                            json!({
                                "callId":call_id,
                                "toolName":tool_name,
                                "label":format!("Finished {tool_name}"),
                                "success":success,
                                "detail":detail,
                            }),
                        )
                        .await;
                    }
                    CliAgentEvent::Usage {
                        input_tokens,
                        output_tokens,
                    } => {
                        let total_tokens = input_tokens.saturating_add(output_tokens);
                        let occurred_at = now_millis();
                        let project_metrics = self
                            .record_context_metrics(
                                &project_id,
                                ContextMetricsUpdate::ModelUsage {
                                    calls: 1,
                                    input_tokens,
                                    output_tokens,
                                    total_tokens,
                                },
                                occurred_at,
                            )
                            .await
                            .ok();
                        self.emit_cli_event_at(
                            &key,
                            &metadata,
                            "model.usage",
                            json!({
                                "calls":1,
                                "inputTokens":input_tokens,
                                "outputTokens":output_tokens,
                                "totalTokens":total_tokens,
                                "projectMetrics":project_metrics,
                            }),
                            occurred_at,
                        )
                        .await;
                    }
                    CliAgentEvent::Error(error) => terminal_error = Some(error),
                    CliAgentEvent::End => {}
                }
            }
        }

        let result = match runner.await {
            Ok(result) => result,
            Err(error) => Err(anyhow!("CLI runtime task failed: {error}")),
        };
        let cancelled = *cancellation.borrow();
        let turn_transition = self.turn_transition_lock.lock().await;
        if !self.cli_generation_is_current(&key, generation).await {
            return;
        }
        let pending_mutation = parser.has_pending_mutation();
        let host_mutation_state = self.mutation_turn_states.read().await.get(&key).copied();
        let mutation_result_unknown = parser.mutation_result_unknown()
            || host_mutation_state == Some(MutationTurnState::Unknown)
            || (pending_mutation && host_mutation_state == Some(MutationTurnState::Started));
        let terminal_error = terminal_error.or_else(|| match result {
            Ok(ref output) if !output.success => Some(classify_cli_error(provider, &output.stderr)),
            Ok(ref output) if output.parsed_events == 0 => Some(CliAgentError {
                code: "cli_protocol_error",
                message: "CLI exited without any JSONL events".to_string(),
                retryable: true,
            }),
            Ok(_) if !parser.saw_terminal() => Some(CliAgentError {
                code: "cli_protocol_error",
                message: "CLI JSONL stream ended without a terminal event".to_string(),
                retryable: true,
            }),
            Err(ref error) if !cancelled => Some(classify_cli_error(provider, &error.to_string())),
            _ => None,
        });

        if mutation_result_unknown {
            self.emit_cli_failure(
                &key,
                &metadata,
                provider,
                CliAgentError {
                    code: "mutation_result_unknown",
                    message: "The database operation did not return a trusted completion receipt. Verify the target manually; this turn cannot be retried automatically.".to_string(),
                    retryable: false,
                },
            )
            .await;
            self.emit_cli_event(
                &key,
                &metadata,
                "turn.status",
                json!({"status":"failed","label":"Database result requires manual verification"}),
            )
            .await;
        } else if cancelled {
            if pending_mutation {
                self.emit_cli_failure(
                    &key,
                    &metadata,
                    provider,
                    CliAgentError {
                        code: "mutation_result_unknown",
                        message: "The CLI was interrupted while a database change was active. Verify the target manually; this turn cannot be retried automatically.".to_string(),
                        retryable: false,
                    },
                )
                .await;
                self.emit_cli_event(
                    &key,
                    &metadata,
                    "turn.status",
                    json!({"status":"failed","label":"Database result requires manual verification"}),
                )
                .await;
            } else {
                self.emit_cli_event(
                    &key,
                    &metadata,
                    "turn.status",
                    json!({"status":"cancelled","label":format!("{} cancelled", provider.display_name())}),
                )
                .await;
            }
        } else if let Some(error) = terminal_error {
            let error = if pending_mutation {
                CliAgentError {
                    code: "mutation_result_unknown",
                    message: "The CLI ended while a database change was active. Verify the target manually; this turn cannot be retried automatically.".to_string(),
                    retryable: false,
                }
            } else {
                error
            };
            self.emit_cli_failure(&key, &metadata, provider, error)
                .await;
            self.emit_cli_event(
                &key,
                &metadata,
                "turn.status",
                json!({"status":"failed","label":format!("{} stopped", provider.display_name())}),
            )
            .await;
        } else {
            let final_text = parser.final_text().to_string();
            self.emit_cli_event(
                &key,
                &metadata,
                "final.answer",
                json!({"content":final_text,"artifacts":[]}),
            )
            .await;
            self.emit_cli_event(
                &key,
                &metadata,
                "provider.activity",
                json!({
                    "provider":provider.as_str(),
                    "status":"completed",
                    "label":format!("{} completed", provider.display_name()),
                }),
            )
            .await;
            self.emit_cli_event(
                &key,
                &metadata,
                "turn.status",
                json!({"status":"completed","label":"Completed"}),
            )
            .await;
        }
        self.cli_turns.lock().await.remove(&key);
        self.clear_turn(&key).await;
        drop(turn_transition);
    }

    async fn cli_generation_is_current(&self, key: &TurnKey, generation: u64) -> bool {
        self.cli_turns
            .lock()
            .await
            .get(key)
            .is_some_and(|handle| handle.generation == generation)
    }

    async fn emit_cli_failure(
        &self,
        key: &TurnKey,
        metadata: &RequestMetadata,
        provider: CliProviderKind,
        error: CliAgentError,
    ) {
        self.emit_cli_event(
            key,
            metadata,
            "provider.activity",
            json!({
                "provider":provider.as_str(),
                "status":"error",
                "label":format!("{} needs attention", provider.display_name()),
                "detail":error.message.clone(),
            }),
        )
        .await;
        self.emit_cli_event(
            key,
            metadata,
            "failure",
            json!({
                "code":error.code,
                "message":error.message,
                "retryable":error.retryable,
            }),
        )
        .await;
    }

    async fn emit_cli_event(
        &self,
        key: &TurnKey,
        metadata: &RequestMetadata,
        event_type: &str,
        payload: Value,
    ) {
        self.emit_cli_event_at(key, metadata, event_type, payload, now_millis())
            .await;
    }

    async fn emit_cli_event_at(
        &self,
        key: &TurnKey,
        metadata: &RequestMetadata,
        event_type: &str,
        payload: Value,
        occurred_at: i64,
    ) {
        let sequence = {
            let mut sequences = self.event_sequences.write().await;
            let sequence = sequences.entry(key.clone()).or_insert(0);
            *sequence = sequence.saturating_add(1);
            *sequence
        };
        let mut event = payload.as_object().cloned().unwrap_or_default();
        event.insert("type".to_string(), Value::String(event_type.to_string()));
        event.insert(
            "threadId".to_string(),
            Value::String(metadata.thread_id.clone()),
        );
        event.insert(
            "turnId".to_string(),
            Value::String(metadata.turn_id.clone()),
        );
        event.insert("sequence".to_string(), json!(sequence));
        event.insert("occurredAt".to_string(), json!(occurred_at));
        if let Some(active) = self.turns.read().await.get(key).cloned() {
            self.persist_turn_journal_event(key, &active.project_id, &Value::Object(event.clone()))
                .await;
        }
        if let Err(error) = self
            .app
            .emit(AGENT_HOST_EVENT_CHANNEL, Value::Object(event))
        {
            tracing::warn!("failed to emit CLI agent event: {error}");
        }
    }

    async fn cancel_turn(
        self: &Arc<Self>,
        request: AgentCancelTurnRequest,
    ) -> Result<AgentActionAccepted> {
        request.metadata.validate().map_err(anyhow::Error::msg)?;
        let key = TurnKey::from_metadata(&request.metadata);
        self.validate_active(&request.metadata).await?;
        if let Some(handle) = self.cli_turns.lock().await.get(&key).cloned() {
            let _ = handle.cancellation.send(true);
            return Ok(AgentActionAccepted { accepted: true });
        }
        let result = self
            .invoke_with_restart(
                HOST_CANCEL_TURN_METHOD,
                serde_json::to_value(&request)?,
                request.metadata.deadline,
            )
            .await;
        self.clear_turn(&key).await;
        result.map_err(|error| anyhow!(error.safe_message()))?;
        Ok(AgentActionAccepted { accepted: true })
    }

    async fn answer_clarification(
        self: &Arc<Self>,
        request: AgentAnswerClarificationRequest,
    ) -> Result<AgentActionAccepted> {
        request.metadata.validate().map_err(anyhow::Error::msg)?;
        if request.clarification_id.trim().is_empty() || request.answers.is_empty() {
            return Err(anyhow!(
                "clarificationId and at least one answer are required"
            ));
        }
        if request.answers.len() > 3
            || request
                .answers
                .iter()
                .any(|(key, value)| key.len() > 240 || value.chars().count() > 20_000)
        {
            return Err(anyhow!("clarification answers exceed the allowed bounds"));
        }
        let key = TurnKey::from_metadata(&request.metadata);
        if self.cli_turns.lock().await.contains_key(&key) {
            return Err(anyhow!(
                "CLI turns do not support in-place clarification resume; cancel this turn and start a new request with the answer"
            ));
        }
        let pending_matches = self
            .clarifications
            .read()
            .await
            .get(&request.clarification_id)
            .is_some_and(|pending| pending.key == key && pending.expires_at >= now_millis());
        if !pending_matches {
            return Err(anyhow!("clarification is no longer pending for this turn"));
        }
        let active = self.extend_active_deadline(&request.metadata).await?;

        let params = self
            .graph_resume_params(
                &active,
                &request.metadata,
                json!({
                    "kind": "clarification",
                    "clarificationId": request.clarification_id,
                    "answers": request.answers,
                }),
                None,
            )
            .await?;
        let response = self
            .invoke_with_restart(HOST_RESUME_TURN_METHOD, params, request.metadata.deadline)
            .await
            .map_err(|error| anyhow!(error.safe_message()))?;
        if !sidecar_resumed(&response) {
            self.clear_turn(&key).await;
            return Err(anyhow!(
                "the AI runtime could not resume this clarification; restart the turn safely"
            ));
        }
        self.clarifications
            .write()
            .await
            .remove(&request.clarification_id);
        Ok(AgentActionAccepted { accepted: true })
    }

    async fn approve_action(
        self: &Arc<Self>,
        request: AgentApproveActionRequest,
    ) -> Result<AgentActionAccepted> {
        request.metadata.validate().map_err(anyhow::Error::msg)?;
        let key = TurnKey::from_metadata(&request.metadata);
        let pending = {
            let approvals = self.approvals.read().await;
            approvals
                .get(&request.approval_id)
                .filter(|pending| pending.key == key && pending.expires_at >= now_millis())
                .map(|pending| PendingApproval {
                    key: pending.key.clone(),
                    call_id: pending.call_id.clone(),
                    input_digest: pending.input_digest.clone(),
                    tool_name: pending.tool_name.clone(),
                    policy_digest: pending.policy_digest.clone(),
                    confirmation_phrase: pending.confirmation_phrase.clone(),
                    origin: pending.origin,
                    expires_at: pending.expires_at,
                })
        }
        .ok_or_else(|| anyhow!("approval is no longer pending for this turn"))?;
        let active = self.extend_active_deadline(&request.metadata).await?;

        if request.decision == ApprovalDecision::Approve {
            if let Some(expected) = pending.confirmation_phrase.as_deref() {
                let supplied = request.confirmation_text.as_deref();
                if supplied != Some(expected) {
                    return Err(anyhow!(
                        "the high-risk confirmation phrase does not match this command"
                    ));
                }
            }
        }
        let consumed = self
            .approvals
            .write()
            .await
            .remove(&request.approval_id)
            .is_some_and(|value| value.key == pending.key);
        if !consumed {
            return Err(anyhow!("approval is no longer pending for this turn"));
        }

        let lease = match request.decision {
            ApprovalDecision::Reject => None,
            ApprovalDecision::Approve => {
                let lease = random_token(APPROVAL_LEASE_BYTES);
                self.leases.write().await.insert(
                    lease.clone(),
                    ApprovalGrant {
                        key,
                        call_id: pending.call_id,
                        input_digest: pending.input_digest,
                        tool_name: pending.tool_name,
                        policy_digest: pending.policy_digest,
                        expires_at: request.metadata.deadline,
                    },
                );
                Some(lease)
            }
        };

        if pending.origin == ApprovalOrigin::PrivateBridge {
            let waiter = self
                .approval_waiters
                .lock()
                .await
                .remove(&request.approval_id)
                .ok_or_else(|| {
                    anyhow!("the private tool call is no longer waiting for approval")
                })?;
            let decision = match lease.as_ref() {
                Some(lease) => BridgeApprovalDecision::Approved(lease.clone()),
                None => BridgeApprovalDecision::Rejected,
            };
            if waiter.send(decision).is_err() {
                if let Some(lease) = lease.as_ref() {
                    self.leases.write().await.remove(lease);
                }
                return Err(anyhow!(
                    "the private tool call ended before approval was resolved"
                ));
            }
            return Ok(AgentActionAccepted { accepted: true });
        }

        let params = self
            .graph_resume_params(
                &active,
                &request.metadata,
                json!({
                    "kind": "approval",
                    "approvalId": request.approval_id,
                    "decision": request.decision,
                }),
                lease
                    .as_ref()
                    .map(|lease| json!({"approvalId": request.approval_id, "lease": lease})),
            )
            .await?;
        let result = self
            .invoke_with_restart(HOST_RESUME_TURN_METHOD, params, request.metadata.deadline)
            .await;
        let resumed = result.as_ref().is_ok_and(sidecar_resumed);
        if !resumed {
            if let Some(lease) = lease.as_ref() {
                self.leases.write().await.remove(lease);
            }
        }
        if result.is_ok() && !resumed {
            self.clear_turn(&pending.key).await;
            return Err(anyhow!(
                "the AI runtime could not resume this approval; the action was not executed"
            ));
        }
        result.map_err(|error| anyhow!(error.safe_message()))?;
        Ok(AgentActionAccepted { accepted: true })
    }

    async fn status(&self) -> AgentHostStatus {
        let storage_mode = self
            .store
            .initialized_storage_mode()
            .unwrap_or("not-initialized")
            .to_string();
        let lifecycle = self.lifecycle.read().await.clone();
        let discovered = lifecycle
            .binary_path
            .clone()
            .or_else(|| find_agent_launch(&self.app).map(|launch| launch.display_path));
        AgentHostStatus {
            state: lifecycle.state.label().to_string(),
            // A discoverable binary is not an available runtime. Only publish
            // availability after the protocol/capability handshake completes.
            available: lifecycle.state == LifecycleState::Ready,
            protocol_version: AGENT_HOST_PROTOCOL_VERSION,
            capabilities: lifecycle.capabilities,
            installed_tools: installed_host_tool_names(),
            binary_path: discovered.map(|path| path.to_string_lossy().into_owned()),
            storage_mode,
            last_error: lifecycle.last_error,
        }
    }

    async fn prewarm(self: &Arc<Self>) {
        self.start_cleanup_task();
        let should_start = {
            let mut lifecycle = self.lifecycle.write().await;
            if matches!(
                lifecycle.state,
                LifecycleState::Starting | LifecycleState::Ready
            ) {
                false
            } else {
                lifecycle.state = LifecycleState::Starting;
                lifecycle.last_error = None;
                true
            }
        };
        if !should_start {
            return;
        }
        let inner = self.clone();
        tokio::spawn(async move {
            if let Err(error) = inner.ensure_ready().await {
                tracing::warn!(
                    "DeepAgents sidecar prewarm failed: {}",
                    error.safe_message()
                );
            }
        });
    }

    fn start_cleanup_task(self: &Arc<Self>) {
        if self
            .cleanup_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        let inner = Arc::downgrade(self);
        tokio::spawn(async move {
            let period = Duration::from_secs(24 * 60 * 60);
            let mut interval =
                tokio::time::interval_at(tokio::time::Instant::now() + period, period);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                let Some(inner) = inner.upgrade() else {
                    break;
                };
                if let Err(error) = inner.store.cleanup_expired().await {
                    tracing::warn!(
                        "failed to clean expired agent state: {}",
                        bounded_text(&error.to_string(), 512)
                    );
                }
            }
        });
    }

    async fn clear_project_state(&self, project_id: &str) -> Result<AgentProjectStateCleared> {
        validate_project_id(project_id)?;
        if self
            .turns
            .read()
            .await
            .values()
            .any(|turn| turn.project_id == project_id)
        {
            return Err(anyhow!(
                "cannot clear agent state while this project has an active turn"
            ));
        }
        let cleared_records = self.store.clear_project(project_id).await?;
        Ok(AgentProjectStateCleared {
            project_id: project_id.to_string(),
            cleared_records,
        })
    }

    async fn load_context_metrics(&self, project_id: &str) -> Result<AgentContextMetrics> {
        validate_project_id(project_id)?;
        let _guard = self.context_metrics_lock.lock().await;
        self.load_context_metrics_unlocked(project_id).await
    }

    async fn save_conversation_snapshot(
        &self,
        request: AgentConversationSnapshotSaveRequest,
    ) -> Result<AgentConversationSnapshot> {
        validate_project_id(&request.project_id)?;
        validate_conversation_id(request.conversation_id.as_deref())?;
        if request.thread_id.trim().is_empty() || request.thread_id.chars().count() > 240 {
            return Err(anyhow!("threadId must contain 1 to 240 characters"));
        }
        let turns = request
            .turns
            .as_array()
            .ok_or_else(|| anyhow!("turns must be an array"))?;
        if turns.len() > MAX_CONVERSATION_TURNS {
            return Err(anyhow!(
                "conversation snapshots are limited to {MAX_CONVERSATION_TURNS} turns"
            ));
        }
        if request.resume_requests.len() > MAX_CONVERSATION_RESUME_REQUESTS {
            return Err(anyhow!(
                "conversation snapshots are limited to {MAX_CONVERSATION_RESUME_REQUESTS} resumable turns"
            ));
        }
        for resume_request in &request.resume_requests {
            resume_request.validate().map_err(anyhow::Error::msg)?;
            if resume_request.project_id != request.project_id
                || resume_request.metadata.thread_id != request.thread_id
            {
                return Err(anyhow!(
                    "resumable turn scope must match the conversation snapshot"
                ));
            }
        }

        let snapshot = AgentConversationSnapshot {
            project_id: request.project_id,
            conversation_id: request.conversation_id,
            thread_id: request.thread_id,
            turns: request.turns,
            resume_requests: Value::Array(
                request
                    .resume_requests
                    .iter()
                    .map(AgentTurnRequest::resumable_value)
                    .collect(),
            ),
            updated_at: now_millis(),
        };
        let value = serde_json::to_value(&snapshot)?;
        if serde_json::to_vec(&value)?.len() > MAX_CONVERSATION_SNAPSHOT_BYTES {
            return Err(anyhow!(
                "conversation snapshot exceeds the {} byte limit",
                MAX_CONVERSATION_SNAPSHOT_BYTES
            ));
        }
        self.store
            .save_thread(
                &snapshot.project_id,
                &conversation_snapshot_store_key(snapshot.conversation_id.as_deref()),
                &value,
            )
            .await
            .context("failed to persist encrypted AI conversation snapshot")?;
        Ok(snapshot)
    }

    async fn load_conversation_snapshot(
        &self,
        project_id: &str,
        conversation_id: Option<&str>,
    ) -> Result<Option<AgentConversationSnapshot>> {
        validate_project_id(project_id)?;
        validate_conversation_id(conversation_id)?;
        let Some(value) = self
            .store
            .load_thread(
                project_id,
                &conversation_snapshot_store_key(conversation_id),
            )
            .await?
        else {
            return Ok(None);
        };
        let snapshot: AgentConversationSnapshot = serde_json::from_value(value)
            .context("persisted AI conversation snapshot is malformed")?;
        if snapshot.project_id != project_id {
            return Err(anyhow!(
                "persisted AI conversation snapshot does not match the requested project"
            ));
        }
        if snapshot.conversation_id.as_deref() != conversation_id {
            return Err(anyhow!(
                "persisted AI conversation snapshot does not match the requested provider session"
            ));
        }
        Ok(Some(snapshot))
    }

    async fn list_conversation_snapshots(
        &self,
        project_id: &str,
        conversation_scope: &str,
    ) -> Result<Vec<AgentConversationSummary>> {
        validate_project_id(project_id)?;
        validate_conversation_id(Some(conversation_scope))?;
        let store_prefix = conversation_snapshot_store_key(Some(conversation_scope));
        let values = self
            .store
            .list_threads_with_prefix(project_id, &store_prefix, 50)
            .await?;
        let mut summaries = values
            .into_iter()
            .filter_map(|value| {
                let snapshot = serde_json::from_value::<AgentConversationSnapshot>(value).ok()?;
                let conversation_id = snapshot.conversation_id.clone()?;
                if snapshot.project_id != project_id
                    || !conversation_belongs_to_scope(&conversation_id, conversation_scope)
                {
                    return None;
                }
                let turns = snapshot.turns.as_array()?;
                if turns.is_empty() {
                    return None;
                }
                let title = turns
                    .iter()
                    .find_map(|turn| turn.get("userMessage").and_then(Value::as_str))
                    .map(conversation_summary_title)
                    .unwrap_or_default();
                Some(AgentConversationSummary {
                    project_id: snapshot.project_id,
                    conversation_id,
                    thread_id: snapshot.thread_id,
                    title,
                    turn_count: turns.len(),
                    updated_at: snapshot.updated_at,
                })
            })
            .collect::<Vec<_>>();
        summaries.sort_by_key(|summary| std::cmp::Reverse(summary.updated_at));
        Ok(summaries)
    }

    async fn load_context_metrics_unlocked(&self, project_id: &str) -> Result<AgentContextMetrics> {
        let Some(value) = self
            .store
            .load_thread(project_id, CONTEXT_METRICS_THREAD_ID)
            .await?
        else {
            return Ok(AgentContextMetrics {
                project_id: project_id.to_string(),
                ..AgentContextMetrics::default()
            });
        };
        let metrics: AgentContextMetrics = serde_json::from_value(value)
            .context("persisted agent context metrics are malformed")?;
        if metrics.project_id != project_id {
            return Err(anyhow!(
                "persisted agent context metrics do not match the requested project"
            ));
        }
        Ok(metrics)
    }

    async fn record_context_metrics(
        &self,
        project_id: &str,
        update: ContextMetricsUpdate,
        occurred_at: i64,
    ) -> Result<AgentContextMetrics> {
        validate_project_id(project_id)?;
        let _guard = self.context_metrics_lock.lock().await;
        let mut metrics = self.load_context_metrics_unlocked(project_id).await?;
        apply_context_metrics_update(&mut metrics, update, occurred_at);
        self.store
            .save_thread(
                project_id,
                CONTEXT_METRICS_THREAD_ID,
                &serde_json::to_value(&metrics)?,
            )
            .await
            .context("failed to persist encrypted agent context metrics")?;
        Ok(metrics)
    }

    async fn read_artifact(
        &self,
        request: AgentArtifactReadRequest,
    ) -> Result<AgentArtifactReadResult> {
        validate_project_id(&request.project_id)?;
        validate_artifact_id(&request.artifact_id).map_err(|error| anyhow!(error.message))?;
        validate_artifact_read_bytes(request.max_bytes).map_err(|error| anyhow!(error.message))?;
        let Some(content) = self
            .load_artifact_text(&request.project_id, &request.artifact_id, true)
            .await?
        else {
            return Ok(AgentArtifactReadResult {
                artifact_id: request.artifact_id,
                found: false,
                offset: 0,
                next_offset: 0,
                total_bytes: 0,
                eof: true,
                content: String::new(),
            });
        };
        let (offset, next_offset, content_range) =
            artifact_text_range(&content, request.offset, request.max_bytes);
        Ok(AgentArtifactReadResult {
            artifact_id: request.artifact_id,
            found: true,
            offset,
            next_offset,
            total_bytes: content.len(),
            eof: next_offset == content.len(),
            content: content_range.to_string(),
        })
    }

    async fn search_artifact(
        &self,
        request: AgentArtifactSearchRequest,
    ) -> Result<AgentArtifactSearchResult> {
        validate_project_id(&request.project_id)?;
        validate_artifact_id(&request.artifact_id).map_err(|error| anyhow!(error.message))?;
        validate_artifact_search(&request.query, request.max_matches, request.context_bytes)
            .map_err(|error| anyhow!(error.message))?;
        let query = request.query.trim().to_string();
        let Some(content) = self
            .load_artifact_text(&request.project_id, &request.artifact_id, true)
            .await?
        else {
            return Ok(AgentArtifactSearchResult {
                artifact_id: request.artifact_id,
                query,
                found: false,
                total_bytes: 0,
                match_count: 0,
                truncated: false,
                matches: Vec::new(),
            });
        };
        let (matches, truncated) =
            search_artifact_text(&content, &query, request.max_matches, request.context_bytes);
        Ok(AgentArtifactSearchResult {
            artifact_id: request.artifact_id,
            query,
            found: true,
            total_bytes: content.len(),
            match_count: matches.len(),
            truncated,
            matches,
        })
    }

    async fn export_artifact(
        &self,
        request: AgentArtifactExportRequest,
    ) -> Result<AgentArtifactExportResult> {
        validate_project_id(&request.project_id)?;
        validate_artifact_id(&request.artifact_id).map_err(|error| anyhow!(error.message))?;
        let Some(mut content) = self
            .load_artifact_text(&request.project_id, &request.artifact_id, true)
            .await?
        else {
            return Err(anyhow!(
                "This encrypted result is no longer available. Agent artifacts expire after 7 days."
            ));
        };
        content.push('\n');
        let suggested_file_name =
            artifact_export_file_name(request.suggested_file_name.as_deref(), &request.artifact_id);
        let (sender, receiver) = oneshot::channel();
        self.app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .set_title("Export AI tool result")
            .set_file_name(suggested_file_name)
            .save_file(move |selection| {
                let _ = sender.send(selection);
            });
        let Some(selection) = receiver
            .await
            .context("artifact export dialog closed unexpectedly")?
        else {
            return Ok(AgentArtifactExportResult {
                artifact_id: request.artifact_id,
                exported: false,
                file_path: None,
                byte_count: 0,
            });
        };
        let path = selection
            .into_path()
            .map_err(|_| anyhow!("the selected export destination is not a local file"))?;
        tokio::fs::write(&path, content.as_bytes())
            .await
            .with_context(|| format!("failed to export artifact to {}", path.display()))?;
        Ok(AgentArtifactExportResult {
            artifact_id: request.artifact_id,
            exported: true,
            file_path: Some(path.to_string_lossy().into_owned()),
            byte_count: content.len(),
        })
    }

    async fn load_artifact_text(
        &self,
        project_id: &str,
        artifact_id: &str,
        pretty: bool,
    ) -> Result<Option<String>> {
        let Some(artifact) = self.store.load_artifact(project_id, artifact_id).await? else {
            return Ok(None);
        };
        let content = if pretty {
            serde_json::to_string_pretty(&artifact)?
        } else {
            serde_json::to_string(&artifact)?
        };
        Ok(Some(content))
    }

    async fn validate_active(&self, metadata: &RequestMetadata) -> Result<ActiveTurn> {
        ensure_not_expired(metadata.deadline)?;
        let key = TurnKey::from_metadata(metadata);
        let turn = self
            .turns
            .read()
            .await
            .get(&key)
            .cloned()
            .ok_or_else(|| anyhow!("agent turn is not active"))?;
        if turn.context_version != metadata.context_version {
            return Err(anyhow!("agent context version is stale"));
        }
        if metadata.deadline > turn.deadline {
            return Err(anyhow!(
                "nested agent request cannot extend the turn deadline"
            ));
        }
        Ok(turn)
    }

    async fn private_bridge_tools(
        &self,
        metadata: &RequestMetadata,
    ) -> Result<Vec<AgentToolManifestEntry>> {
        let turn = self.validate_active(metadata).await?;
        let mut tools = turn.tools.into_values().collect::<Vec<_>>();
        tools.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(tools)
    }

    async fn invoke_private_bridge_tool(
        self: &Arc<Self>,
        metadata: &RequestMetadata,
        call_id: String,
        tool_name: String,
        input: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        if call_id.trim().is_empty() || call_id.chars().count() > 240 {
            return Err(SidecarRequestError::invalid_params(
                "private bridge callId must contain 1 to 240 characters",
            ));
        }
        if !input.is_object() {
            return Err(SidecarRequestError::invalid_params(
                "private bridge tool input must be a JSON object",
            ));
        }
        if contains_approval_claim(&input) {
            return Err(SidecarRequestError::security(anyhow!(
                "CLI callers cannot provide approval fields or leases"
            )));
        }
        let turn = self
            .validate_active(metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        let tool = turn.tools.get(&tool_name).ok_or_else(|| {
            SidecarRequestError::security(anyhow!(
                "tool is not present in the frozen turn manifest"
            ))
        })?;
        let input_digest_value = input_digest(&input);
        let key = TurnKey::from_metadata(metadata);
        let mut policy_digest = None;
        let mut approval_title = format!("Approve {}", bounded_text(&tool_name, 120));
        let mut approval_summary = format!(
            "Approve one digest-bound invocation of {}.",
            bounded_text(&tool_name, 120)
        );
        let mut approval_risk = tool
            .permissions
            .iter()
            .find(|permission| matches!(permission.as_str(), "destructive" | "external" | "write"))
            .cloned()
            .unwrap_or_else(|| "write".to_string());
        let mut confirmation_phrase = None;
        let mut findings = None;

        if tool_name == RustHostTool::ShellExecute.name() {
            let result = self.shell_policy_for_input(&turn, &input).await?;
            if result.decision == CommandPolicyDecision::Block {
                return Err(SidecarRequestError {
                    code: -32_053,
                    message: "command policy blocked shell execution".to_string(),
                    data: Some(json!({
                        "kind":"command_policy_block",
                        "recoverable":false,
                        "preflight":result,
                    })),
                });
            }
            let cache_key = command_preflight_cache_key(&key, &call_id, &result.policy_digest);
            self.command_preflights.write().await.insert(
                cache_key,
                PendingCommandPreflight {
                    key: key.clone(),
                    call_id: call_id.clone(),
                    input_digest: input_digest_value.clone(),
                    tool_name: tool_name.clone(),
                    result: result.clone(),
                    expires_at: turn.deadline,
                },
            );
            approval_title = "Approve shell command".to_string();
            approval_summary = result.summary.clone();
            confirmation_phrase = result
                .confirmation
                .as_ref()
                .map(|value| value.phrase.clone());
            findings = Some(
                serde_json::to_value(&result.findings).unwrap_or_else(|_| Value::Array(Vec::new())),
            );
            policy_digest = Some(result.policy_digest);
            approval_risk = "external".to_string();
        } else if tool_name == RustHostTool::QueryExecuteApproved.name() {
            if turn.profile != AgentProfile::Agent {
                return Err(SidecarRequestError::security(anyhow!(
                    "database mutations are available only in Agent mode"
                )));
            }
            let query = required_input_text(&input, "query", 200_000)?;
            let target = self.resolve_connection(&turn, &input).await?;
            self.ensure_agent_mutation_target(&turn, &target)?;
            let review = self.review_approved_query(&target, &query)?;
            approval_title = if review.destructive {
                "Approve destructive database operation".to_string()
            } else {
                "Approve database write".to_string()
            };
            approval_summary = review.summary;
            approval_risk = if review.destructive {
                "destructive".to_string()
            } else {
                "write".to_string()
            };
            confirmation_phrase = review.confirmation_phrase;
            policy_digest = Some(mutation_policy_digest(
                &target,
                &input_digest_value,
                &review.operation_type,
            ));
        }

        let mut approval_lease = None;
        if tool_requires_approval(&tool_name, &tool.permissions) {
            let approval_id = format!("bridge-{}", random_token(18));
            let (sender, receiver) = oneshot::channel();
            self.approval_waiters
                .lock()
                .await
                .insert(approval_id.clone(), sender);
            self.approvals.write().await.insert(
                approval_id.clone(),
                PendingApproval {
                    key: key.clone(),
                    call_id: call_id.clone(),
                    input_digest: input_digest_value.clone(),
                    tool_name: tool_name.clone(),
                    policy_digest: policy_digest.clone(),
                    confirmation_phrase: confirmation_phrase.clone(),
                    origin: ApprovalOrigin::PrivateBridge,
                    expires_at: turn.deadline,
                },
            );
            self.emit_private_bridge_approval(
                metadata,
                &approval_id,
                &call_id,
                &tool_name,
                &input_digest_value,
                &approval_title,
                &approval_risk,
                &approval_summary,
                policy_digest.as_deref(),
                findings,
                confirmation_phrase.as_deref(),
            )
            .await;
            let remaining = turn.deadline.saturating_sub(now_millis()).max(1) as u64;
            let decision = tokio::time::timeout(Duration::from_millis(remaining), receiver).await;
            match decision {
                Ok(Ok(BridgeApprovalDecision::Approved(lease))) => approval_lease = Some(lease),
                Ok(Ok(BridgeApprovalDecision::Rejected)) => {
                    return Err(SidecarRequestError {
                        code: -32_050,
                        message: "The user rejected this tool call".to_string(),
                        data: Some(json!({"kind":"approval_rejected","recoverable":false})),
                    });
                }
                Ok(Err(_)) | Err(_) => {
                    self.approvals.write().await.remove(&approval_id);
                    self.approval_waiters.lock().await.remove(&approval_id);
                    return Err(SidecarRequestError {
                        code: -32_050,
                        message: "The tool approval expired or the turn was cancelled".to_string(),
                        data: Some(json!({"kind":"approval_expired","recoverable":false})),
                    });
                }
            }
        }

        self.handle_tool_invoke(
            serde_json::to_value(ToolInvokeRequest {
                metadata: metadata.clone(),
                call_id,
                tool_name,
                input,
                input_digest: input_digest_value,
                approval_lease,
                policy_digest,
            })
            .map_err(SidecarRequestError::from_json)?,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn emit_private_bridge_approval(
        &self,
        metadata: &RequestMetadata,
        approval_id: &str,
        call_id: &str,
        tool_name: &str,
        input_digest_value: &str,
        title: &str,
        risk: &str,
        summary: &str,
        policy_digest: Option<&str>,
        findings: Option<Value>,
        confirmation_phrase: Option<&str>,
    ) {
        let key = TurnKey::from_metadata(metadata);
        let sequence = {
            let mut sequences = self.event_sequences.write().await;
            let sequence = sequences.entry(key.clone()).or_insert(0);
            *sequence = sequence.saturating_add(1);
            *sequence
        };
        let mut event = json!({
            "type":"approval",
            "requestId":metadata.request_id,
            "threadId":metadata.thread_id,
            "turnId":metadata.turn_id,
            "contextVersion":metadata.context_version,
            "deadline":metadata.deadline,
            "sequence":sequence,
            "occurredAt":now_millis(),
            "approvalId":approval_id,
            "callId":call_id,
            "inputDigest":input_digest_value,
            "toolName":tool_name,
            "title":bounded_text(title, 240),
            "risk":risk,
            "summary":bounded_text(summary, 2_000),
        });
        if let Some(object) = event.as_object_mut() {
            if let Some(policy_digest) = policy_digest {
                object.insert(
                    "policyDigest".to_string(),
                    Value::String(policy_digest.to_string()),
                );
            }
            if let Some(findings) = findings {
                object.insert("findings".to_string(), findings);
            }
            if let Some(phrase) = confirmation_phrase {
                object.insert(
                    "confirmation".to_string(),
                    json!({
                        "kind":"phrase",
                        "phrase":phrase,
                        "prompt":format!("Type {phrase} to confirm this high-risk operation."),
                    }),
                );
            }
        }
        if let Some(active) = self.turns.read().await.get(&key).cloned() {
            self.persist_turn_journal_event(&key, &active.project_id, &event)
                .await;
        }
        if let Err(error) = self.app.emit(AGENT_HOST_EVENT_CHANNEL, event) {
            tracing::warn!("failed to emit private bridge approval: {error}");
        }
    }

    async fn extend_active_deadline(&self, metadata: &RequestMetadata) -> Result<ActiveTurn> {
        ensure_not_expired(metadata.deadline)?;
        if metadata.deadline > now_millis().saturating_add(MAX_HUMAN_RESUME_MILLIS) {
            return Err(anyhow!("agent resume deadline exceeds the two-hour bound"));
        }
        let key = TurnKey::from_metadata(metadata);
        let mut turns = self.turns.write().await;
        let turn = turns
            .get_mut(&key)
            .ok_or_else(|| anyhow!("agent turn is not active"))?;
        if turn.context_version != metadata.context_version {
            return Err(anyhow!("agent context version is stale"));
        }
        turn.deadline = metadata.deadline;
        Ok(turn.clone())
    }

    async fn graph_resume_params(
        &self,
        active: &ActiveTurn,
        metadata: &RequestMetadata,
        resume: Value,
        transient_approval_lease: Option<Value>,
    ) -> Result<Value> {
        let mut params = self
            .store
            .load_thread(&active.project_id, &metadata.thread_id)
            .await?
            .ok_or_else(|| anyhow!("encrypted agent turn state is unavailable for resume"))?;
        let object = params
            .as_object_mut()
            .ok_or_else(|| anyhow!("persisted agent turn state is malformed"))?;
        object.insert("requestId".to_string(), json!(metadata.request_id));
        object.insert("threadId".to_string(), json!(metadata.thread_id));
        object.insert("turnId".to_string(), json!(metadata.turn_id));
        object.insert(
            "contextVersion".to_string(),
            json!(metadata.context_version),
        );
        object.insert("deadline".to_string(), json!(metadata.deadline));
        object.insert("resume".to_string(), resume);
        object.insert(
            "transientApprovalLease".to_string(),
            transient_approval_lease.unwrap_or(Value::Null),
        );
        Ok(params)
    }

    async fn invoke_with_restart(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        deadline: i64,
    ) -> std::result::Result<Value, HostCallError> {
        let mut restarted = false;
        loop {
            let process = match self.ensure_ready().await {
                Ok(process) => process,
                Err(error) if error.is_transport() && !restarted => {
                    restarted = true;
                    self.reset_failed_generation(None, &error.safe_message())
                        .await;
                    continue;
                }
                Err(error) => return Err(error),
            };
            match self
                .send_request_on(&process, method, params.clone(), deadline)
                .await
            {
                Err(error) if error.is_transport() && !restarted => {
                    restarted = true;
                    self.reset_failed_generation(Some(process.generation), &error.safe_message())
                        .await;
                }
                result => return result,
            }
        }
    }

    async fn ensure_ready(
        self: &Arc<Self>,
    ) -> std::result::Result<Arc<HostProcess>, HostCallError> {
        if let Some(process) = self.ready_process().await {
            return Ok(process);
        }
        let _start_guard = self.start_lock.lock().await;
        if let Some(process) = self.ready_process().await {
            return Ok(process);
        }

        self.set_lifecycle(LifecycleState::Starting, None, None, Vec::new())
            .await;
        let launch = find_agent_launch(&self.app).ok_or_else(|| {
            HostCallError::Transport(
                "DeepAgents sidecar is not installed; AI agent features are unavailable"
                    .to_string(),
            )
        });
        let launch = match launch {
            Ok(launch) => launch,
            Err(error) => {
                self.set_lifecycle(
                    LifecycleState::Unavailable,
                    None,
                    Some(error.safe_message()),
                    Vec::new(),
                )
                .await;
                return Err(error);
            }
        };
        let display_path = launch.display_path.clone();
        let process = match self.spawn_process(launch).await {
            Ok(process) => process,
            Err(error) => {
                self.set_lifecycle(
                    LifecycleState::Unavailable,
                    Some(display_path),
                    Some(error.safe_message()),
                    Vec::new(),
                )
                .await;
                return Err(error);
            }
        };
        *self.process.write().await = Some(process.clone());

        let deadline = now_millis().saturating_add(HANDSHAKE_TIMEOUT_MILLIS);
        let params = json!({
            "protocolVersion": AGENT_HOST_PROTOCOL_VERSION,
            "appVersion": self.app.package_info().version.to_string(),
            "maxFrameBytes": AGENT_HOST_MAX_FRAME_BYTES,
            "requiredCapabilities": REQUIRED_CAPABILITIES,
        });
        let handshake = self
            .send_request_on(&process, HOST_INITIALIZE_METHOD, params, deadline)
            .await
            .and_then(validate_handshake);
        let capabilities = match handshake {
            Ok(capabilities) => capabilities,
            Err(error) => {
                self.reset_failed_generation(Some(process.generation), &error.safe_message())
                    .await;
                return Err(error);
            }
        };
        self.set_lifecycle(
            LifecycleState::Ready,
            Some(process.binary_path.clone()),
            None,
            capabilities,
        )
        .await;
        Ok(process)
    }

    async fn ready_process(&self) -> Option<Arc<HostProcess>> {
        if self.lifecycle.read().await.state != LifecycleState::Ready {
            return None;
        }
        self.process.read().await.clone()
    }

    async fn spawn_process(
        self: &Arc<Self>,
        launch: AgentLaunch,
    ) -> std::result::Result<Arc<HostProcess>, HostCallError> {
        let mut command = Command::new(&launch.program);
        command
            .args(&launch.arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| {
            HostCallError::Transport(format!("failed to start DeepAgents sidecar: {error}"))
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            HostCallError::Transport("DeepAgents sidecar stdin is unavailable".to_string())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            HostCallError::Transport("DeepAgents sidecar stdout is unavailable".to_string())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            HostCallError::Transport("DeepAgents sidecar stderr is unavailable".to_string())
        })?;
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let process = Arc::new(HostProcess {
            generation,
            writer: Mutex::new(stdin),
            _child: Mutex::new(child),
            binary_path: launch.display_path,
        });

        let weak = Arc::downgrade(self);
        tokio::spawn(read_sidecar_stdout(weak, generation, stdout));
        tokio::spawn(read_sidecar_stderr(stderr));
        Ok(process)
    }

    async fn send_request_on(
        &self,
        process: &Arc<HostProcess>,
        method: &str,
        params: Value,
        deadline: i64,
    ) -> std::result::Result<Value, HostCallError> {
        let timeout = deadline_duration(deadline)?;
        let id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let id_value = Value::Number(id.into());
        let id_key = rpc_id_key(&id_value).expect("numeric request ids always have a key");
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(
            id_key.clone(),
            PendingResponse {
                generation: process.generation,
                sender,
            },
        );

        let write = {
            let mut writer = process.writer.lock().await;
            write_json_frame(&mut *writer, &rpc_request(id, method, params)).await
        };
        if let Err(error) = write {
            self.pending.lock().await.remove(&id_key);
            return Err(HostCallError::Transport(format!(
                "failed to write to DeepAgents sidecar: {error}"
            )));
        }

        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(HostCallError::Transport(
                "DeepAgents sidecar response channel closed".to_string(),
            )),
            Err(_) => {
                self.pending.lock().await.remove(&id_key);
                let cancellation = rpc_notification("$/cancelRequest", json!({"id": id_value}));
                let mut writer = process.writer.lock().await;
                let _ = write_json_frame(&mut *writer, &cancellation).await;
                Err(HostCallError::Transport(format!(
                    "DeepAgents sidecar request timed out: {method}"
                )))
            }
        }
    }

    async fn handle_protocol_message(self: &Arc<Self>, generation: u64, message: Value) {
        if let Some(method) = message.get("method").and_then(Value::as_str) {
            let params = message.get("params").cloned().unwrap_or(Value::Null);
            if let Some(id) = message.get("id").cloned() {
                let Some(id_key) = rpc_id_key(&id) else {
                    return;
                };
                let id_key = format!("{generation}:{id_key}");
                let (cancellation_sender, cancellation) = watch::channel(false);
                self.inbound_cancellations.lock().await.insert(
                    id_key.clone(),
                    InboundCancellation {
                        generation,
                        sender: cancellation_sender,
                    },
                );
                let inner = self.clone();
                let method = method.to_string();
                tokio::spawn(async move {
                    let response = inner
                        .handle_sidecar_request(generation, &method, params, cancellation)
                        .await;
                    inner.inbound_cancellations.lock().await.remove(&id_key);
                    let frame = match response {
                        Ok(value) => rpc_success(id, value),
                        Err(error) => rpc_error(id, error.code, error.message, error.data),
                    };
                    inner.write_response(generation, frame).await;
                });
            } else if method == SIDECAR_EVENT_METHOD {
                self.handle_agent_event(params).await;
            } else if method == "$/cancelRequest" {
                if let Some(id_key) = params.get("id").and_then(rpc_id_key) {
                    let id_key = format!("{generation}:{id_key}");
                    if let Some(cancellation) = self.inbound_cancellations.lock().await.get(&id_key)
                    {
                        let _ = cancellation.sender.send(true);
                    }
                }
            }
            return;
        }

        let Some(id) = message.get("id").and_then(rpc_id_key) else {
            return;
        };
        let pending = self.pending.lock().await.remove(&id);
        let Some(pending) = pending.filter(|pending| pending.generation == generation) else {
            return;
        };
        let result = if let Some(error) = message.get("error") {
            Err(HostCallError::Remote {
                code: error.get("code").and_then(Value::as_i64).unwrap_or(-32_000),
                message: error
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|value| bounded_text(value, 2_000))
                    .unwrap_or_else(|| "DeepAgents sidecar returned an RPC error".to_string()),
            })
        } else if let Some(result) = message.get("result") {
            Ok(result.clone())
        } else {
            Err(HostCallError::Transport(
                "DeepAgents sidecar returned a malformed response".to_string(),
            ))
        };
        let _ = pending.sender.send(result);
    }

    async fn write_response(&self, generation: u64, frame: Value) {
        let process = self.process.read().await.clone();
        let Some(process) = process.filter(|process| process.generation == generation) else {
            return;
        };
        let result = {
            let mut writer = process.writer.lock().await;
            write_json_frame(&mut *writer, &frame).await
        };
        if let Err(error) = result {
            self.reset_failed_generation(Some(generation), &error.to_string())
                .await;
        }
    }

    async fn handle_sidecar_request(
        &self,
        generation: u64,
        method: &str,
        params: Value,
        cancellation: watch::Receiver<bool>,
    ) -> std::result::Result<Value, SidecarRequestError> {
        match method {
            SIDECAR_MODEL_COMPLETE_METHOD => self.handle_model_complete(params).await,
            SIDECAR_MODEL_STREAM_METHOD => {
                self.handle_model_stream(generation, params, cancellation)
                    .await
            }
            SIDECAR_TOOL_PREFLIGHT_METHOD => self.handle_tool_preflight(params).await,
            SIDECAR_TOOL_INVOKE_METHOD => self.handle_tool_invoke(params).await,
            SIDECAR_CHECKPOINT_LOAD_METHOD => self.handle_checkpoint_load(params).await,
            SIDECAR_CHECKPOINT_SAVE_METHOD => self.handle_checkpoint_save(params).await,
            SIDECAR_GRAPH_CHECKPOINT_GET_METHOD => self.handle_graph_checkpoint_get(params).await,
            SIDECAR_GRAPH_CHECKPOINT_LIST_METHOD => self.handle_graph_checkpoint_list(params).await,
            SIDECAR_GRAPH_CHECKPOINT_PUT_METHOD => self.handle_graph_checkpoint_put(params).await,
            SIDECAR_GRAPH_CHECKPOINT_PUT_WRITES_METHOD => {
                self.handle_graph_checkpoint_put_writes(params).await
            }
            SIDECAR_GRAPH_CHECKPOINT_DELETE_THREAD_METHOD => {
                self.handle_graph_checkpoint_delete_thread(params).await
            }
            SIDECAR_ARTIFACT_READ_METHOD => self.handle_artifact_read(params).await,
            SIDECAR_ARTIFACT_SEARCH_METHOD => self.handle_artifact_search(params).await,
            _ => Err(SidecarRequestError::method_not_found(method)),
        }
    }

    async fn handle_model_complete(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: ModelCompleteRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        self.validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        let key = TurnKey::from_metadata(&request.metadata);
        let provider = self
            .providers
            .read()
            .await
            .get(&key)
            .cloned()
            .ok_or_else(|| {
                SidecarRequestError::security(anyhow!("model provider is unavailable"))
            })?;
        let model = self.model.as_ref().map_err(|error| SidecarRequestError {
            code: -32_040,
            message: error.clone(),
            data: Some(json!({"kind":"model_proxy_unavailable","recoverable":true})),
        })?;
        model
            .complete(&provider, &request)
            .await
            .map_err(|error| SidecarRequestError {
                code: -32_041,
                message: bounded_text(&error.to_string(), 2_000),
                data: Some(json!({"kind":"model_request_failed","recoverable":true})),
            })
    }

    async fn handle_model_stream(
        &self,
        generation: u64,
        params: Value,
        cancellation: watch::Receiver<bool>,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let stream_request: ModelStreamRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        if stream_request.stream_id.trim().is_empty()
            || stream_request.stream_id.chars().count() > 240
        {
            return Err(SidecarRequestError::invalid_params(
                "streamId must contain 1 to 240 characters".to_string(),
            ));
        }
        let request = stream_request.request;
        self.validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        let key = TurnKey::from_metadata(&request.metadata);
        let provider = self
            .providers
            .read()
            .await
            .get(&key)
            .cloned()
            .ok_or_else(|| {
                SidecarRequestError::security(anyhow!("model provider is unavailable"))
            })?;
        let model = self.model.as_ref().map_err(|error| SidecarRequestError {
            code: -32_040,
            message: error.clone(),
            data: Some(json!({"kind":"model_proxy_unavailable","recoverable":true})),
        })?;
        let stream_id = stream_request.stream_id;
        let (chunk_sender, mut chunk_receiver) = mpsc::channel(32);
        let stream = model.stream(&provider, &request, chunk_sender, cancellation);
        tokio::pin!(stream);
        let mut sequence = 0u64;
        let mut chunk_channel_open = true;

        let final_response = loop {
            tokio::select! {
                biased;
                chunk = chunk_receiver.recv(), if chunk_channel_open => {
                    match chunk {
                        Some(chunk) => {
                            self.emit_model_chunk(
                                generation,
                                &request.metadata,
                                &stream_id,
                                sequence,
                                chunk,
                                false,
                            ).await;
                            sequence = sequence.saturating_add(1);
                        }
                        None => chunk_channel_open = false,
                    }
                }
                result = &mut stream => break result,
            }
        }
        .map_err(|error| SidecarRequestError {
            code: if error.to_string().contains("cancelled") {
                -32_008
            } else {
                -32_042
            },
            message: bounded_text(&error.to_string(), 2_000),
            data: Some(json!({
                "kind":if error.to_string().contains("cancelled") {
                    "model_stream_cancelled"
                } else {
                    "model_stream_failed"
                },
                "recoverable":true,
            })),
        })?;
        while let Ok(chunk) = chunk_receiver.try_recv() {
            self.emit_model_chunk(
                generation,
                &request.metadata,
                &stream_id,
                sequence,
                chunk,
                false,
            )
            .await;
            sequence = sequence.saturating_add(1);
        }
        self.emit_model_chunk(
            generation,
            &request.metadata,
            &stream_id,
            sequence,
            json!({
                "delta":"",
                "toolCalls":[],
                "usage":final_response.get("usage").cloned().unwrap_or(Value::Null),
                "finishReason":final_response.get("finishReason").cloned().unwrap_or(Value::Null),
            }),
            true,
        )
        .await;
        Ok(final_response)
    }

    async fn emit_model_chunk(
        &self,
        generation: u64,
        metadata: &RequestMetadata,
        stream_id: &str,
        sequence: u64,
        chunk: Value,
        done: bool,
    ) {
        let mut params = json!({
            "requestId":metadata.request_id,
            "threadId":metadata.thread_id,
            "turnId":metadata.turn_id,
            "contextVersion":metadata.context_version,
            "deadline":metadata.deadline,
            "streamId":stream_id,
            "sequence":sequence,
            "delta":"",
            "toolCalls":[],
            "done":done,
        });
        if let (Some(target), Some(source)) = (params.as_object_mut(), chunk.as_object()) {
            for (key, value) in source {
                target.insert(key.clone(), value.clone());
            }
        }
        self.write_response(
            generation,
            rpc_notification(HOST_MODEL_CHUNK_METHOD, params),
        )
        .await;
    }

    async fn emit_trusted_project_file_change(
        &self,
        metadata: &RequestMetadata,
        call_id: &str,
        change: &crate::commands::project_files::ProjectFileAppliedChange,
        created: bool,
    ) {
        let key = TurnKey::from_metadata(metadata);
        let sequence = {
            let mut sequences = self.event_sequences.write().await;
            let sequence = sequences.entry(key).or_insert(0);
            *sequence = sequence.saturating_add(1);
            *sequence
        };
        let event = trusted_project_file_change_event(
            metadata,
            call_id,
            change,
            created,
            sequence,
            now_millis(),
        );
        if let Err(error) = self.app.emit(AGENT_HOST_EVENT_CHANNEL, event) {
            tracing::warn!("failed to emit trusted project file change: {error}");
        }
    }

    async fn handle_tool_preflight(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: ToolPreflightRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        let expected_digest = input_digest(&request.input);
        if !constant_time_text_eq(&normalized_digest(&request.input_digest), &expected_digest) {
            return Err(SidecarRequestError::security(anyhow!(
                "tool preflight input digest does not match the canonical input"
            )));
        }
        let tool = turn.tools.get(&request.tool_name).ok_or_else(|| {
            SidecarRequestError::security(anyhow!("tool is not present in the turn manifest"))
        })?;
        if request.tool_name != RustHostTool::ShellExecute.name()
            || !tool
                .permissions
                .iter()
                .any(|permission| permission == "external")
        {
            return Err(SidecarRequestError::invalid_params(
                "command preflight is only available for shell.execute",
            ));
        }
        let result = self.shell_policy_for_input(&turn, &request.input).await?;
        let key = TurnKey::from_metadata(&request.metadata);
        let cache_key = command_preflight_cache_key(&key, &request.call_id, &result.policy_digest);
        self.command_preflights.write().await.insert(
            cache_key,
            PendingCommandPreflight {
                key,
                call_id: request.call_id,
                input_digest: expected_digest,
                tool_name: request.tool_name,
                result: result.clone(),
                expires_at: turn.deadline,
            },
        );
        serde_json::to_value(result).map_err(SidecarRequestError::from_json)
    }

    async fn shell_policy_for_input(
        &self,
        turn: &ActiveTurn,
        input: &Value,
    ) -> std::result::Result<CommandPreflightResult, SidecarRequestError> {
        let store = self
            .app
            .try_state::<MetaStore>()
            .ok_or_else(|| SidecarRequestError::tool("project metadata store is unavailable"))?;
        let config = self
            .app
            .try_state::<ConfigManager>()
            .ok_or_else(|| SidecarRequestError::tool("application settings are unavailable"))?;
        let command = required_input_text(input, "command", 32_000)?;
        let relative_directory = input
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let sandbox_mode =
            ShellSandboxMode::parse(input.get("sandboxMode").and_then(Value::as_str))
                .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let (project_root, working_directory) =
            crate::commands::project_files::agent_project_directory(
                &store,
                &turn.project_id,
                relative_directory,
            )
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        let settings = config.load_settings().map_err(SidecarRequestError::tool)?;
        Ok(evaluate_shell_command_policy(
            &project_root,
            &working_directory,
            &command,
            sandbox_mode,
            &settings,
        ))
    }

    async fn handle_tool_invoke(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: ToolInvokeRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        let expected_digest = input_digest(&request.input);
        if !constant_time_text_eq(&normalized_digest(&request.input_digest), &expected_digest) {
            return Err(SidecarRequestError::security(anyhow!(
                "tool input digest does not match the canonical input"
            )));
        }
        let tool = turn.tools.get(&request.tool_name).ok_or_else(|| {
            SidecarRequestError::security(anyhow!("tool is not present in the turn manifest"))
        })?;

        let mut lease_policy_digest = None;
        let command_preflight = if request.tool_name == RustHostTool::ShellExecute.name() {
            let result = self.shell_policy_for_input(&turn, &request.input).await?;
            let requested_digest = request.policy_digest.as_deref().ok_or_else(|| {
                SidecarRequestError::security(anyhow!(
                    "shell execution requires a command policy digest"
                ))
            })?;
            if !constant_time_text_eq(requested_digest, &result.policy_digest) {
                return Err(SidecarRequestError::security(anyhow!(
                    "command policy changed after approval; review the command again"
                )));
            }
            if result.decision == CommandPolicyDecision::Block {
                return Err(SidecarRequestError {
                    code: -32_053,
                    message: "command policy blocked shell execution".to_string(),
                    data: Some(json!({
                        "kind": "command_policy_block",
                        "recoverable": false,
                        "preflight": result,
                    })),
                });
            }
            lease_policy_digest = Some(result.policy_digest.clone());
            Some(result)
        } else if request.tool_name == RustHostTool::QueryExecuteApproved.name() {
            let query = required_input_text(&request.input, "query", 200_000)?;
            let target = self.resolve_connection(&turn, &request.input).await?;
            self.ensure_agent_mutation_target(&turn, &target)?;
            let review = self.review_approved_query(&target, &query)?;
            let current_policy =
                mutation_policy_digest(&target, &expected_digest, &review.operation_type);
            if let Some(requested_policy) = request.policy_digest.as_deref() {
                if !constant_time_text_eq(requested_policy, &current_policy) {
                    return Err(SidecarRequestError::security(anyhow!(
                        "the database target changed after approval; review the operation again"
                    )));
                }
                lease_policy_digest = Some(current_policy);
            }
            None
        } else {
            if request.policy_digest.is_some() {
                return Err(SidecarRequestError::security(anyhow!(
                    "this tool must not receive a command policy digest"
                )));
            }
            None
        };

        let high_risk = tool_requires_approval(&request.tool_name, &tool.permissions);
        if high_risk {
            let lease = request
                .approval_lease
                .as_deref()
                .ok_or_else(|| SidecarRequestError {
                    code: -32_050,
                    message: "tool execution requires an approval lease".to_string(),
                    data: Some(json!({"kind":"approval_required","recoverable":true})),
                })?;
            self.consume_approval_lease(
                lease,
                &TurnKey::from_metadata(&request.metadata),
                &request.call_id,
                &expected_digest,
                &request.tool_name,
                lease_policy_digest.as_deref(),
            )
            .await
            .map_err(SidecarRequestError::security)?;
        } else if request.approval_lease.is_some() {
            return Err(SidecarRequestError::security(anyhow!(
                "this tool must not receive an approval lease"
            )));
        }

        let execution_started = Instant::now();
        let value = match self.execute_rust_tool(&turn, &request).await {
            Ok(value) => value,
            Err(error) => {
                if let Some(preflight) = command_preflight.as_ref() {
                    tracing::warn!(
                        target: "oxide_agent_shell_audit",
                        project_id = %turn.project_id,
                        turn_id = %request.metadata.turn_id,
                        call_id = %request.call_id,
                        policy_digest = %preflight.policy_digest,
                        decision = ?preflight.decision,
                        rule_ids = ?preflight
                            .findings
                            .iter()
                            .map(|finding| finding.rule_id.as_str())
                            .collect::<Vec<_>>(),
                        executables = ?preflight.executables,
                        sandbox_mode = request
                            .input
                            .get("sandboxMode")
                            .and_then(|entry| entry.as_str())
                            .unwrap_or("workspace-write"),
                        host_error_code = error.code,
                        duration_ms = execution_started.elapsed().as_millis() as u64,
                        "agent shell command failed before a result was produced"
                    );
                }
                return Err(error);
            }
        };
        if let Some(preflight) = command_preflight.as_ref() {
            tracing::info!(
                target: "oxide_agent_shell_audit",
                project_id = %turn.project_id,
                turn_id = %request.metadata.turn_id,
                call_id = %request.call_id,
                policy_digest = %preflight.policy_digest,
                decision = ?preflight.decision,
                rule_ids = ?preflight
                    .findings
                    .iter()
                    .map(|finding| finding.rule_id.as_str())
                    .collect::<Vec<_>>(),
                executables = ?preflight.executables,
                sandbox_mode = value
                    .get("sandboxMode")
                    .and_then(|entry| entry.as_str())
                    .unwrap_or("unknown"),
                exit_code = value.get("exitCode").and_then(|entry| entry.as_i64()),
                success = value.get("success").and_then(|entry| entry.as_bool()).unwrap_or(false),
                timed_out = value.get("timedOut").and_then(|entry| entry.as_bool()).unwrap_or(false),
                duration_ms = value.get("durationMs").and_then(|entry| entry.as_u64()),
                "agent shell command completed"
            );
        }
        self.bound_tool_result(&turn.project_id, tool, value)
            .await
            .map_err(|error| SidecarRequestError {
                code: -32_052,
                message: bounded_text(&error.to_string(), 2_000),
                data: Some(json!({"kind":"tool_result_failed","recoverable":true})),
            })
            .and_then(|value| serde_json::to_value(value).map_err(SidecarRequestError::from_json))
    }

    async fn execute_rust_tool(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let Some(tool) = RustHostTool::from_name(&request.tool_name) else {
            return Err(SidecarRequestError {
                code: -32_061,
                message: format!(
                    "tool {} requires a Rust host bridge that is not installed",
                    bounded_text(&request.tool_name, 200)
                ),
                data: Some(json!({
                    "kind": "host_tool_bridge_required",
                    "recoverable": true,
                    "toolName": request.tool_name,
                })),
            });
        };

        match tool {
            RustHostTool::ProjectListFiles => {
                let store = self.app.try_state::<MetaStore>().ok_or_else(|| {
                    SidecarRequestError::tool("project metadata store is unavailable")
                })?;
                let directory = request
                    .input
                    .get("directory")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let entries = crate::commands::project_files::agent_list_project_entries(
                    &store,
                    &turn.project_id,
                    directory,
                )
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                serde_json::to_value(entries).map_err(SidecarRequestError::from_json)
            }
            RustHostTool::ProjectReadFile => {
                let store = self.app.try_state::<MetaStore>().ok_or_else(|| {
                    SidecarRequestError::tool("project metadata store is unavailable")
                })?;
                let path = required_input_text(&request.input, "path", 2_000)?;
                let file = crate::commands::project_files::agent_read_project_file(
                    &store,
                    &turn.project_id,
                    &path,
                )
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                serde_json::to_value(file).map_err(SidecarRequestError::from_json)
            }
            RustHostTool::ProjectWriteFile => {
                let store = self.app.try_state::<MetaStore>().ok_or_else(|| {
                    SidecarRequestError::tool("project metadata store is unavailable")
                })?;
                let path = required_input_text(&request.input, "path", 2_000)?;
                let content = request
                    .input
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SidecarRequestError::invalid_params("content is required"))?;
                let expected_revision = request
                    .input
                    .get("expectedRevision")
                    .and_then(Value::as_str);
                let create = request
                    .input
                    .get("create")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let change = crate::commands::project_files::agent_apply_project_file_change(
                    &store,
                    &turn.project_id,
                    &path,
                    content,
                    expected_revision,
                    create,
                )
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                self.emit_trusted_project_file_change(
                    &request.metadata,
                    &request.call_id,
                    &change,
                    create,
                )
                .await;
                Ok(json!({
                    "relativePath": change.relative_path,
                    "operation": if create { "created" } else { "updated" },
                    "revision": change.revision,
                    "previousRevision": change.previous_revision,
                    "additions": change.additions,
                    "deletions": change.deletions,
                    "applied": true,
                    "reviewable": true,
                }))
            }
            RustHostTool::ConnectionList => {
                let store =
                    self.app
                        .try_state::<MetaStore>()
                        .ok_or_else(|| SidecarRequestError {
                            code: -32_060,
                            message: "connection metadata store is unavailable".to_string(),
                            data: Some(json!({"kind":"host_tool_unavailable","recoverable":true})),
                        })?;
                let connections = store
                    .get_connections(&turn.project_id)
                    .await
                    .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                Ok(Value::Array(
                    connections
                        .into_iter()
                        .map(|connection| {
                            json!({
                                "id": connection.id,
                                "projectId": connection.project_id,
                                "name": connection.name,
                                "driver": connection.driver,
                            })
                        })
                        .collect(),
                ))
            }
            RustHostTool::ConnectionCapabilities => {
                let capabilities = if let Some(driver) = request
                    .input
                    .get("driver")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    self.resolve_agent_driver_contract(driver, None)?.0
                } else {
                    self.resolve_connection(turn, &request.input)
                        .await?
                        .capabilities
                };
                serde_json::to_value(capabilities).map_err(SidecarRequestError::from_json)
            }
            RustHostTool::ProviderList => serde_json::to_value(self.agent_provider_capabilities())
                .map_err(SidecarRequestError::from_json),
            RustHostTool::WorkspaceGetActiveTab => {
                Ok(turn.active_tab.clone().unwrap_or(Value::Null))
            }
            RustHostTool::MetadataListCollections | RustHostTool::MetadataListObjects => {
                self.execute_metadata_list(turn, request).await
            }
            RustHostTool::MetadataDescribeObject => {
                self.execute_metadata_describe(turn, request).await
            }
            RustHostTool::QueryRunReadOnly => self.execute_read_only_query(turn, request).await,
            RustHostTool::QueryExplain => self.execute_explain_query(turn, request).await,
            RustHostTool::QueryExecuteApproved => self.execute_approved_query(turn, request).await,
            RustHostTool::ShellExecute => {
                let store = self.app.try_state::<MetaStore>().ok_or_else(|| {
                    SidecarRequestError::tool("project metadata store is unavailable")
                })?;
                let command = required_input_text(&request.input, "command", 32_000)?;
                let relative_directory = request
                    .input
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let sandbox_mode = ShellSandboxMode::parse(
                    request.input.get("sandboxMode").and_then(Value::as_str),
                )
                .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
                let requested_timeout = request
                    .input
                    .get("timeoutMs")
                    .and_then(Value::as_u64)
                    .unwrap_or(DEFAULT_SHELL_TIMEOUT_MS)
                    .clamp(1_000, MAX_SHELL_TIMEOUT_MS);
                let deadline =
                    tool_deadline_duration(turn, &request.tool_name, request.metadata.deadline)?;
                let timeout_ms = requested_timeout.min(deadline.as_millis().max(100) as u64);
                let (project_root, working_directory) =
                    crate::commands::project_files::agent_project_directory(
                        &store,
                        &turn.project_id,
                        relative_directory,
                    )
                    .await
                    .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                let result = execute_shell_command(
                    &project_root,
                    &working_directory,
                    &command,
                    sandbox_mode,
                    timeout_ms,
                )
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                serde_json::to_value(result).map_err(SidecarRequestError::from_json)
            }
        }
    }

    async fn resolve_connection(
        &self,
        turn: &ActiveTurn,
        input: &Value,
    ) -> std::result::Result<ResolvedAgentConnection, SidecarRequestError> {
        let store = self
            .app
            .try_state::<MetaStore>()
            .ok_or_else(|| SidecarRequestError::tool("connection metadata store is unavailable"))?;
        let project_exists = store
            .get_project(&turn.project_id)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?
            .is_some();
        if !project_exists {
            return Err(SidecarRequestError::security(anyhow!(
                "active agent project no longer exists"
            )));
        }
        let connections = store
            .get_connections(&turn.project_id)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        if connections.is_empty() {
            return Err(SidecarRequestError {
                code: -32_063,
                message: "no saved database connection is available in this project".to_string(),
                data: Some(json!({
                    "kind":"connection_required",
                    "recoverable":true,
                    "projectId":turn.project_id,
                })),
            });
        }

        // Stable priority: explicit tool input, a unique connection named or
        // typed in the user's prompt, active tab/workspace context, then the
        // only project-scoped candidate. Remaining ambiguity is returned as
        // structured data so the sidecar can ask inline and retry safely.
        let explicit_id = input
            .get("connectionId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let tab_id = turn
            .tab_connection_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let context_id = turn
            .connection_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let prompt_connection = resolve_prompt_connection(&connections, &turn.prompt);
        let selected = if let Some(id) = explicit_id {
            connections.iter().find(|connection| connection.id == id)
        } else if let Some(connection) = prompt_connection {
            Some(connection)
        } else if let Some(id) = tab_id {
            connections.iter().find(|connection| connection.id == id)
        } else if let Some(id) = context_id {
            connections.iter().find(|connection| connection.id == id)
        } else if connections.len() == 1 {
            connections.first()
        } else {
            None
        };
        let Some(selected) = selected else {
            if explicit_id.is_some() || tab_id.is_some() || context_id.is_some() {
                return Err(SidecarRequestError::security(anyhow!(
                    "requested connection is not part of the active project"
                )));
            }
            return Err(SidecarRequestError {
                code: -32_064,
                message:
                    "multiple database connections are available; ask the user which one to use"
                        .to_string(),
                data: Some(json!({
                    "kind":"connection_selection_required",
                    "recoverable":true,
                    "candidates":connections.iter().map(|connection| json!({
                        "id":connection.id,
                        "name":connection.name,
                        "driver":connection.driver,
                    })).collect::<Vec<_>>(),
                })),
            });
        };
        validate_stored_connection(&turn.project_id, selected)?;
        let config: ConfigSavedConnection = serde_json::from_value(selected.config.clone())
            .map_err(|_| {
                SidecarRequestError::security(anyhow!("saved connection configuration is invalid"))
            })?;
        validate_connection_config(&turn.project_id, selected, &config)?;
        let (capabilities, sidecar_read_only_enforced) = self.resolve_agent_driver_contract(
            &selected.driver,
            config.driver_package_version.as_deref(),
        )?;
        let configured_database = config
            .database
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let database = turn
            .database
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .or({
                if matches!(
                    capabilities.connection_mode,
                    crate::core::dialect::DatabaseConnectionMode::Network
                ) && capabilities.supports_database_catalogs
                {
                    configured_database.map(ToString::to_string)
                } else {
                    None
                }
            });
        let namespace = input
            .get("namespace")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| {
                turn.tab_namespace
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
            .or_else(|| {
                turn.namespace
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
            .or(database.as_deref())
            .or({
                if matches!(
                    capabilities.connection_mode,
                    crate::core::dialect::DatabaseConnectionMode::Network
                ) {
                    configured_database
                } else {
                    None
                }
            })
            .unwrap_or_else(|| {
                if capabilities.driver == "postgres" {
                    "public"
                } else if capabilities.driver == "redis" {
                    "0"
                } else if matches!(
                    capabilities.connection_mode,
                    crate::core::dialect::DatabaseConnectionMode::File
                ) {
                    "main"
                } else {
                    ""
                }
            })
            .to_string();
        let config_digest = input_digest(&json!({
            "projectId": selected.project_id,
            "id": selected.id,
            "driver": selected.driver,
            "config": selected.config,
            "updatedAt": selected.updated_at,
        }));
        Ok(ResolvedAgentConnection {
            id: selected.id.clone(),
            driver: selected.driver.clone(),
            capabilities,
            sidecar_read_only_enforced,
            config,
            config_digest,
            database,
            namespace,
        })
    }

    /// Resolve the same signed driver contract used by the normal connection
    /// path. New sidecar-only database families are not present in the static
    /// dialect table, so Agent tooling must never use that table as its only
    /// capability source.
    fn resolve_agent_driver_contract(
        &self,
        driver: &str,
        package_version: Option<&str>,
    ) -> std::result::Result<(DatabaseCapabilities, bool), SidecarRequestError> {
        let requested = driver.trim();
        let normalized = requested.to_ascii_lowercase();
        let canonical = canonical_driver_name(requested).unwrap_or(normalized.as_str());
        if !is_safe_driver_package_token(canonical) {
            return Err(SidecarRequestError::security(anyhow!(
                "saved connection driver is invalid"
            )));
        }
        let registry = self
            .app
            .try_state::<DatabaseDriverPackageRegistry>()
            .ok_or_else(|| {
                SidecarRequestError::tool("database driver package registry is unavailable")
            })?;
        let has_active_package = registry.list_installed().into_iter().any(|package| {
            package.active && package.manifest.driver_id.eq_ignore_ascii_case(canonical)
        });
        if package_version
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
            || has_active_package
        {
            let package = match package_version
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                Some(version) => registry.resolve_version(canonical, version),
                None => registry.resolve_active(canonical),
            }
            .map_err(SidecarRequestError::tool)?;
            return package
                .manifest
                .capabilities
                .map(|capabilities| (capabilities, true))
                .ok_or_else(|| {
                    SidecarRequestError::tool(
                        "external driver package does not declare Agent-safe database capabilities",
                    )
                });
        }
        database_capabilities_for_driver(canonical)
            .map(|capabilities| (capabilities, false))
            .map_err(|error| SidecarRequestError::tool(error.to_string()))
    }

    /// Advertise installed external families to the Agent alongside bundled
    /// drivers. Only a ready, active, capability-declaring package may replace
    /// a bundled profile; invalid or inactive packages stay invisible here.
    fn agent_provider_capabilities(&self) -> Vec<DatabaseCapabilities> {
        let mut capabilities = all_database_capabilities();
        let Some(registry) = self.app.try_state::<DatabaseDriverPackageRegistry>() else {
            return capabilities;
        };
        for package in registry.list_installed().into_iter().filter(|package| {
            package.active
                && package.status == DriverPackageStatus::Ready
                && package.manifest.capabilities.is_some()
        }) {
            let Some(package_capabilities) = package.manifest.capabilities else {
                continue;
            };
            if let Some(index) = capabilities.iter().position(|current| {
                current
                    .driver
                    .eq_ignore_ascii_case(&package_capabilities.driver)
            }) {
                capabilities[index] = package_capabilities;
            } else {
                capabilities.push(package_capabilities);
            }
        }
        capabilities.sort_by(|left, right| {
            left.display_name
                .to_ascii_lowercase()
                .cmp(&right.display_name.to_ascii_lowercase())
        });
        capabilities
    }

    async fn ensure_agent_connection(
        &self,
        project_id: &str,
        target: &ResolvedAgentConnection,
    ) -> std::result::Result<(), SidecarRequestError> {
        let is_current = self
            .connected_targets
            .read()
            .await
            .get(&target.id)
            .is_some_and(|connected| {
                connected.project_id == project_id
                    && connected.config_digest == target.config_digest
            });
        if is_current && self.agent_connections.ping(&target.id).await.is_ok() {
            return Ok(());
        }

        let _guard = self.connection_lock.lock().await;
        let is_current = self
            .connected_targets
            .read()
            .await
            .get(&target.id)
            .is_some_and(|connected| {
                connected.project_id == project_id
                    && connected.config_digest == target.config_digest
            });
        if is_current && self.agent_connections.ping(&target.id).await.is_ok() {
            return Ok(());
        }

        let url = connection_url_from_config(&target.capabilities, &target.config)
            .map_err(SidecarRequestError::security)?;
        let registry = self
            .app
            .try_state::<DatabaseDriverPackageRegistry>()
            .ok_or_else(|| {
                SidecarRequestError::tool("database driver package registry is unavailable")
            })?;
        let remote_sqlite = canonical_driver_name(&target.driver)
            .is_some_and(|driver| driver.eq_ignore_ascii_case("sqlite"))
            && target
                .config
                .ssh_tunnel
                .as_ref()
                .is_some_and(|ssh| ssh.enabled && ssh.remote_sqlite.is_some());
        let (driver, tunnel): (Box<dyn DatabaseDriver>, Option<SshTunnel>) = if remote_sqlite {
            if target.config.driver_package_version.is_some() {
                return Err(SidecarRequestError::security(anyhow!(
                    "remote SQLite cannot use an external driver package"
                )));
            }
            let worker_registry = self
                .app
                .try_state::<SqliteWorkerArtifactRegistry>()
                .ok_or_else(|| {
                    SidecarRequestError::tool("SQLite worker registry is unavailable")
                })?;
            let ssh = target.config.ssh_tunnel.as_ref().ok_or_else(|| {
                SidecarRequestError::security(anyhow!("remote SQLite SSH settings are unavailable"))
            })?;
            let driver = RemoteSqliteDriver::open(&worker_registry, &target.id, &url, ssh, true)
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            (Box::new(driver), None)
        } else {
            let (connection_url, tunnel) =
                SshTunnel::prepare(&target.driver, &url, target.config.ssh_tunnel.as_ref())
                    .await
                    .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            let driver = connect_agent_read_only_preferred_driver(
                &registry,
                &target.driver,
                &connection_url,
                target.id.clone(),
                target.config.driver_package_version.as_deref(),
            )
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            (driver, tunnel)
        };
        if let Err(error) = driver.ping().await {
            let _ = driver.disconnect().await;
            if let Some(tunnel) = tunnel {
                tunnel.shutdown().await;
            }
            return Err(SidecarRequestError::tool(format!(
                "database connection test failed: {error}"
            )));
        }
        self.agent_connections
            .replace_connection_with_tunnel(target.id.clone(), driver, tunnel)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        self.connected_targets.write().await.insert(
            target.id.clone(),
            ConnectedAgentTarget {
                project_id: project_id.to_string(),
                config_digest: target.config_digest.clone(),
            },
        );
        Ok(())
    }

    async fn ensure_mutation_connection(
        &self,
        project_id: &str,
        target: &ResolvedAgentConnection,
    ) -> std::result::Result<(), SidecarRequestError> {
        self.ensure_trusted_mutation_adapter(target)?;
        let is_current = self
            .connected_mutation_targets
            .read()
            .await
            .get(&target.id)
            .is_some_and(|connected| {
                connected.project_id == project_id
                    && connected.config_digest == target.config_digest
            });
        if is_current && self.mutation_connections.ping(&target.id).await.is_ok() {
            return Ok(());
        }

        let _guard = self.mutation_connection_lock.lock().await;
        let is_current = self
            .connected_mutation_targets
            .read()
            .await
            .get(&target.id)
            .is_some_and(|connected| {
                connected.project_id == project_id
                    && connected.config_digest == target.config_digest
            });
        if is_current && self.mutation_connections.ping(&target.id).await.is_ok() {
            return Ok(());
        }

        let url = connection_url_from_config(&target.capabilities, &target.config)
            .map_err(SidecarRequestError::security)?;
        let registry = self
            .app
            .try_state::<DatabaseDriverPackageRegistry>()
            .ok_or_else(|| {
                SidecarRequestError::tool("database driver package registry is unavailable")
            })?;
        let remote_sqlite = canonical_driver_name(&target.driver)
            .is_some_and(|driver| driver.eq_ignore_ascii_case("sqlite"))
            && target
                .config
                .ssh_tunnel
                .as_ref()
                .is_some_and(|ssh| ssh.enabled && ssh.remote_sqlite.is_some());
        let (driver, tunnel): (Box<dyn DatabaseDriver>, Option<SshTunnel>) = if remote_sqlite {
            if target.config.driver_package_version.is_some() {
                return Err(SidecarRequestError::security(anyhow!(
                    "remote SQLite cannot use an external driver package"
                )));
            }
            let worker_registry = self
                .app
                .try_state::<SqliteWorkerArtifactRegistry>()
                .ok_or_else(|| {
                    SidecarRequestError::tool("SQLite worker registry is unavailable")
                })?;
            let ssh = target.config.ssh_tunnel.as_ref().ok_or_else(|| {
                SidecarRequestError::security(anyhow!("remote SQLite SSH settings are unavailable"))
            })?;
            let driver = RemoteSqliteDriver::open(
                &worker_registry,
                &format!("agent-mutation-{}", target.id),
                &url,
                ssh,
                false,
            )
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            (Box::new(driver), None)
        } else {
            let (connection_url, tunnel) =
                SshTunnel::prepare(&target.driver, &url, target.config.ssh_tunnel.as_ref())
                    .await
                    .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            let driver = connect_preferred_driver(
                &registry,
                &target.driver,
                &connection_url,
                format!("agent-mutation-{}", target.id),
                target.config.driver_package_version.as_deref(),
            )
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            (driver, tunnel)
        };
        if let Err(error) = driver.ping().await {
            let _ = driver.disconnect().await;
            if let Some(tunnel) = tunnel {
                tunnel.shutdown().await;
            }
            return Err(SidecarRequestError::tool(format!(
                "database mutation connection test failed: {error}"
            )));
        }
        self.mutation_connections
            .replace_connection_with_tunnel(target.id.clone(), driver, tunnel)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        self.connected_mutation_targets.write().await.insert(
            target.id.clone(),
            ConnectedAgentTarget {
                project_id: project_id.to_string(),
                config_digest: target.config_digest.clone(),
            },
        );
        Ok(())
    }

    fn ensure_trusted_mutation_adapter(
        &self,
        target: &ResolvedAgentConnection,
    ) -> std::result::Result<(), SidecarRequestError> {
        let requested = target.driver.trim();
        let normalized = requested.to_ascii_lowercase();
        let canonical = canonical_driver_name(requested).unwrap_or(normalized.as_str());
        let registry = self
            .app
            .try_state::<DatabaseDriverPackageRegistry>()
            .ok_or_else(|| {
                SidecarRequestError::tool("database driver package registry is unavailable")
            })?;
        let external_selected = target
            .config
            .driver_package_version
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            || registry.list_installed().into_iter().any(|package| {
                package.active && package.manifest.driver_id.eq_ignore_ascii_case(canonical)
            });
        if external_selected
            || !matches!(
                canonical,
                "postgres" | "mysql" | "sqlite" | "mongodb" | "redis" | "elasticsearch"
            )
        {
            return Err(SidecarRequestError {
                code: -32_068,
                message: "This driver does not expose a reviewed Agent mutation adapter; generate a script for manual execution instead".to_string(),
                data: Some(json!({
                    "kind":"agent_mutation_unsupported",
                    "recoverable":false,
                    "driver":bounded_text(canonical, 80),
                })),
            });
        }
        Ok(())
    }

    async fn execute_metadata_list(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let target = self.resolve_connection(turn, &request.input).await?;
        self.ensure_agent_connection(&turn.project_id, &target)
            .await?;
        let capabilities = target.capabilities.clone();

        if capabilities.supports_table_browsing {
            if request.tool_name == "metadata.listCollections" {
                return Ok(Value::Array(Vec::new()));
            }
            let tables = if let Some(database) = target.database.as_deref() {
                self.agent_connections
                    .get_database_tables(&target.id, database, &target.namespace)
                    .await
            } else {
                self.agent_connections
                    .get_tables(&target.id, &target.namespace)
                    .await
            }
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            return Ok(Value::Array(
                tables
                    .into_iter()
                    .map(|table| {
                        json!({
                            "name":table.name,
                            "namespace":table.schema.unwrap_or_else(|| target.namespace.clone()),
                            "kind":"relation",
                            "type":table.table_type,
                            "comment":table.comment,
                        })
                    })
                    .collect(),
            ));
        }

        if capabilities.supports_collection_browsing || capabilities.supports_key_value_browsing {
            let collections = self
                .agent_connections
                .get_collections(&target.id, &target.namespace)
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            let kind = match capabilities.data_model {
                crate::core::dialect::DatabaseDataModel::Document => "collection",
                crate::core::dialect::DatabaseDataModel::Search => "index",
                crate::core::dialect::DatabaseDataModel::KeyValue => "key",
                crate::core::dialect::DatabaseDataModel::Relational => "object",
                crate::core::dialect::DatabaseDataModel::Graph
                | crate::core::dialect::DatabaseDataModel::WideColumn
                | crate::core::dialect::DatabaseDataModel::TimeSeries
                | crate::core::dialect::DatabaseDataModel::Coordination
                | crate::core::dialect::DatabaseDataModel::Queue => "object",
            };
            return Ok(Value::Array(
                collections
                    .into_iter()
                    .map(|collection| {
                        json!({
                            "name":collection.name,
                            "namespace":collection.namespace.unwrap_or_else(|| target.namespace.clone()),
                            "kind":kind,
                            "type":collection.collection_type,
                            "documentCount":collection.document_count,
                        })
                    })
                    .collect(),
            ));
        }
        Ok(Value::Array(Vec::new()))
    }

    async fn execute_metadata_describe(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let name = required_input_text(&request.input, "name", 512)?;
        let target = self.resolve_connection(turn, &request.input).await?;
        self.ensure_agent_connection(&turn.project_id, &target)
            .await?;
        let capabilities = target.capabilities.clone();

        if capabilities.supports_table_browsing {
            let columns = if let Some(database) = target.database.as_deref() {
                self.agent_connections
                    .get_database_columns(&target.id, database, &target.namespace, &name)
                    .await
            } else {
                self.agent_connections
                    .get_columns(&target.id, &target.namespace, &name)
                    .await
            }
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            let indexes = if capabilities.supports_table_indexes {
                if let Some(database) = target.database.as_deref() {
                    self.agent_connections
                        .get_database_indexes(&target.id, database, &target.namespace, &name)
                        .await
                } else {
                    self.agent_connections
                        .get_indexes(&target.id, &target.namespace, &name)
                        .await
                }
                .unwrap_or_default()
            } else {
                Vec::new()
            };
            let constraints = if capabilities.supports_table_constraints {
                if let Some(database) = target.database.as_deref() {
                    self.agent_connections
                        .get_database_constraints(&target.id, database, &target.namespace, &name)
                        .await
                } else {
                    self.agent_connections
                        .get_constraints(&target.id, &target.namespace, &name)
                        .await
                }
                .unwrap_or_default()
            } else {
                Vec::new()
            };
            return Ok(json!({
                "connectionId":target.id,
                "namespace":target.namespace,
                "name":name,
                "driver":target.driver,
                "kind":"relation",
                "columns":columns,
                "indexes":indexes,
                "constraints":constraints,
            }));
        }

        let collections = self
            .agent_connections
            .get_collections(&target.id, &target.namespace)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        let collection = collections.into_iter().find(|value| value.name == name);
        Ok(json!({
            "connectionId":target.id,
            "namespace":target.namespace,
            "name":name,
            "driver":target.driver,
            "kind":match capabilities.data_model {
                crate::core::dialect::DatabaseDataModel::Document => "collection",
                crate::core::dialect::DatabaseDataModel::Search => "index",
                crate::core::dialect::DatabaseDataModel::KeyValue => "key",
                crate::core::dialect::DatabaseDataModel::Relational => "object",
                crate::core::dialect::DatabaseDataModel::Graph
                | crate::core::dialect::DatabaseDataModel::WideColumn
                | crate::core::dialect::DatabaseDataModel::TimeSeries
                | crate::core::dialect::DatabaseDataModel::Coordination
                | crate::core::dialect::DatabaseDataModel::Queue => "object",
            },
            "collection":collection,
        }))
    }

    async fn execute_read_only_query(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let query = required_input_text(&request.input, "query", 200_000)?;
        let target = self.resolve_connection(turn, &request.input).await?;
        self.ensure_agent_connection(&turn.project_id, &target)
            .await?;
        let dialect = self
            .agent_connections
            .statement_scan_dialect(&target.id)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        let mut results = if target.driver.eq_ignore_ascii_case("sqlite")
            || target.driver.eq_ignore_ascii_case("sqlite3")
        {
            // The connection itself was opened with SQLite read_only=true.
            // Retain a conservative lexical gate for diagnostics and reject
            // multi-statement/mutation input before it reaches the engine.
            validate_read_only_sql(&query, StatementScanDialect::Postgres)
                .map_err(SidecarRequestError::tool)?;
            self.execute_bounded_query(turn, request, &target, query)
                .await?
        } else if target.sidecar_read_only_enforced {
            let dialect = dialect.ok_or_else(|| {
                SidecarRequestError::tool("Agent read-only queries require a declared SQL dialect")
            })?;
            validate_read_only_sql(&query, dialect).map_err(SidecarRequestError::tool)?;
            self.execute_bounded_query(turn, request, &target, query)
                .await?
        } else if let Some(dialect) = dialect {
            validate_read_only_sql(&query, dialect).map_err(SidecarRequestError::tool)?;
            let kind = database_kind_for_dialect(dialect).ok_or_else(|| {
                SidecarRequestError::tool(
                    "This SQL dialect requires a driver-enforced read-only endpoint",
                )
            })?;
            let script = read_only_transaction_script(kind, &query);
            let mut results = self
                .execute_bounded_query(turn, request, &target, script)
                .await?;
            strip_transaction_results(&mut results);
            results
        } else {
            validate_native_read_only_query(&target.driver, &query)
                .map_err(SidecarRequestError::tool)?;
            self.execute_bounded_query(turn, request, &target, query)
                .await?
        };
        let requested_limit = request
            .input
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(200)
            .clamp(1, MAX_TOOL_RESULT_ROWS as u64) as usize;
        truncate_query_rows(&mut results, requested_limit);
        serde_json::to_value(results).map_err(SidecarRequestError::from_json)
    }

    async fn execute_approved_query(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        if turn.profile != AgentProfile::Agent {
            return Err(SidecarRequestError::security(anyhow!(
                "query.executeApproved is available only in Agent mode"
            )));
        }
        let query = required_input_text(&request.input, "query", 200_000)?;
        let target = self.resolve_connection(turn, &request.input).await?;
        self.ensure_agent_mutation_target(turn, &target)?;
        let review = self.review_approved_query(&target, &query)?;
        self.ensure_mutation_connection(&turn.project_id, &target)
            .await?;

        let query_id = format!(
            "agent-mutation-{}-{}",
            bounded_identifier(&request.metadata.turn_id, 80),
            bounded_identifier(&request.call_id, 80)
        );
        let timeout = tool_deadline_duration(turn, &request.tool_name, request.metadata.deadline)?;
        let started_at = Instant::now();
        let turn_key = TurnKey::from_metadata(&request.metadata);
        self.set_mutation_turn_state(&turn_key, MutationTurnState::Started)
            .await;
        let execute = async {
            if let Some(database) = target
                .database
                .as_deref()
                .filter(|_| target.capabilities.supports_database_catalogs)
            {
                self.mutation_connections
                    .query_database_with_context(
                        &target.id,
                        database,
                        &query,
                        non_empty(&target.namespace),
                        Some(&query_id),
                    )
                    .await
            } else {
                self.mutation_connections
                    .query(
                        &target.id,
                        &query,
                        non_empty(&target.namespace).map(ToString::to_string),
                        None,
                        Some(query_id.clone()),
                    )
                    .await
            }
        };
        let result = match tokio::time::timeout(timeout, execute).await {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => {
                self.set_mutation_turn_state(&turn_key, MutationTurnState::Unknown)
                    .await;
                return Err(SidecarRequestError {
                    code: -32_069,
                    message: bounded_text(&error.to_string(), 2_000),
                    data: Some(json!({
                        "kind":"mutation_execution_failed",
                        "recoverable":false,
                        "manualVerificationRequired":true,
                    })),
                });
            }
            Err(_) => {
                let _ = self
                    .mutation_connections
                    .cancel_query(&target.id, &query_id)
                    .await;
                tracing::warn!(
                    target: "oxide_agent_mutation_audit",
                    project_id = %turn.project_id,
                    turn_id = %request.metadata.turn_id,
                    call_id = %request.call_id,
                    input_digest = %request.input_digest,
                    operation_type = %review.operation_type,
                    connection_id = %target.id,
                    database = ?target.database,
                    duration_ms = started_at.elapsed().as_millis() as u64,
                    result_unknown = true,
                    "approved Agent database operation timed out"
                );
                self.set_mutation_turn_state(&turn_key, MutationTurnState::Unknown)
                    .await;
                return Err(SidecarRequestError {
                    code: -32_067,
                    message: "The approved database operation timed out after it was sent; verify the target manually before retrying".to_string(),
                    data: Some(json!({
                        "kind":"mutation_result_unknown",
                        "recoverable":false,
                        "manualVerificationRequired":true,
                    })),
                });
            }
        };
        self.set_mutation_turn_state(&turn_key, MutationTurnState::Completed)
            .await;
        tracing::info!(
            target: "oxide_agent_mutation_audit",
            project_id = %turn.project_id,
            turn_id = %request.metadata.turn_id,
            call_id = %request.call_id,
            input_digest = %request.input_digest,
            operation_type = %review.operation_type,
            destructive = review.destructive,
            connection_id = %target.id,
            database = ?target.database,
            duration_ms = started_at.elapsed().as_millis() as u64,
            result_unknown = false,
            "approved Agent database operation completed"
        );
        serde_json::to_value(json!({
            "connectionId": target.id,
            "database": target.database,
            "namespace": target.namespace,
            "operationType": review.operation_type,
            "inputDigest": request.input_digest,
            "results": result,
            "mutationReceipt": {
                "callId": request.call_id,
                "completed": true,
                "manualVerificationRequired": false,
            }
        }))
        .map_err(SidecarRequestError::from_json)
    }

    async fn set_mutation_turn_state(&self, key: &TurnKey, state: MutationTurnState) {
        let turns = self.turns.read().await;
        if turns.contains_key(key) {
            self.mutation_turn_states
                .write()
                .await
                .insert(key.clone(), state);
        }
    }

    fn ensure_agent_mutation_target(
        &self,
        turn: &ActiveTurn,
        target: &ResolvedAgentConnection,
    ) -> std::result::Result<(), SidecarRequestError> {
        let frozen_connection = turn
            .tab_connection_id
            .as_deref()
            .or(turn.connection_id.as_deref())
            .ok_or_else(|| {
                SidecarRequestError::security(anyhow!(
                    "Agent writes require a connection frozen into the current workspace turn"
                ))
            })?;
        if frozen_connection != target.id {
            return Err(SidecarRequestError::security(anyhow!(
                "the mutation target differs from the connection frozen into this turn"
            )));
        }
        match target.config.environment {
            ConnectionEnvironment::Development | ConnectionEnvironment::Staging => {}
            ConnectionEnvironment::Unclassified => {
                return Err(SidecarRequestError {
                    code: -32_066,
                    message: "AI writes are disabled until this connection is explicitly classified as development or staging".to_string(),
                    data: Some(json!({"kind":"unclassified_connection_write_blocked","recoverable":false})),
                });
            }
            ConnectionEnvironment::Production => {
                return Err(SidecarRequestError {
                    code: -32_066,
                    message: "AI writes are always disabled for production connections".to_string(),
                    data: Some(
                        json!({"kind":"production_connection_write_blocked","recoverable":false}),
                    ),
                });
            }
        }
        let protected = target.config.production_databases.iter().any(|protected| {
            let protected = protected.trim();
            protected == "*"
                || target
                    .database
                    .as_deref()
                    .is_some_and(|value| value.eq_ignore_ascii_case(protected))
                || (!target.namespace.is_empty()
                    && target.namespace.eq_ignore_ascii_case(protected))
        });
        if protected {
            return Err(SidecarRequestError {
                code: -32_066,
                message: "AI writes are disabled for this protected database or namespace"
                    .to_string(),
                data: Some(json!({"kind":"protected_database_write_blocked","recoverable":false})),
            });
        }
        self.ensure_trusted_mutation_adapter(target)
    }

    fn review_approved_query(
        &self,
        target: &ResolvedAgentConnection,
        query: &str,
    ) -> std::result::Result<ApprovedQueryReview, SidecarRequestError> {
        let canonical = canonical_driver_name(&target.driver)
            .unwrap_or(target.driver.trim())
            .to_ascii_lowercase();
        let dialect = match canonical.as_str() {
            "mysql" => Some(StatementScanDialect::Mysql),
            "sqlite" | "postgres" => Some(StatementScanDialect::Postgres),
            _ if target.capabilities.supports_sql_query => Some(StatementScanDialect::Postgres),
            _ => None,
        };
        review_approved_query_input(&target.driver, dialect, query, &target.id)
            .map_err(SidecarRequestError::invalid_params)
    }

    async fn execute_explain_query(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let query = required_input_text(&request.input, "query", 200_000)?;
        let target = self.resolve_connection(turn, &request.input).await?;
        self.ensure_agent_connection(&turn.project_id, &target)
            .await?;
        let dialect = self
            .agent_connections
            .statement_scan_dialect(&target.id)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?
            .ok_or_else(|| {
                SidecarRequestError::tool("Explain Plan is unsupported for this driver")
            })?;
        let kind = database_kind_for_dialect(dialect).ok_or_else(|| {
            SidecarRequestError::tool(
                "Explain Plan requires a driver-specific implementation for this SQL dialect",
            )
        })?;
        let (statement, format) = build_explain_statement(&query, kind, ExplainPlanMode::Estimate)
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        let script = if target.sidecar_read_only_enforced {
            statement
        } else {
            read_only_transaction_script(kind, &statement)
        };
        let started_at = std::time::Instant::now();
        let mut results = self
            .execute_bounded_query(turn, request, &target, script)
            .await?;
        if !target.sidecar_read_only_enforced {
            strip_transaction_results(&mut results);
        }
        let plan = parse_explain_results(
            request.call_id.clone(),
            kind,
            ExplainPlanMode::Estimate,
            format,
            started_at.elapsed().as_secs_f64() * 1_000.0,
            &results,
        )
        .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        serde_json::to_value(plan).map_err(SidecarRequestError::from_json)
    }

    async fn execute_bounded_query(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
        target: &ResolvedAgentConnection,
        sql: String,
    ) -> std::result::Result<Vec<QueryResult>, SidecarRequestError> {
        let query_id = format!(
            "agent-{}-{}",
            bounded_identifier(&request.metadata.turn_id, 80),
            bounded_identifier(&request.call_id, 80)
        );
        let timeout = tool_deadline_duration(turn, &request.tool_name, request.metadata.deadline)?;
        let execute = async {
            if let Some(database) = target
                .database
                .as_deref()
                .filter(|_| target.capabilities.supports_database_catalogs)
            {
                self.agent_connections
                    .query_database_with_context(
                        &target.id,
                        database,
                        &sql,
                        non_empty(&target.namespace),
                        Some(&query_id),
                    )
                    .await
            } else {
                self.agent_connections
                    .query(
                        &target.id,
                        &sql,
                        non_empty(&target.namespace).map(ToString::to_string),
                        None,
                        Some(query_id.clone()),
                    )
                    .await
            }
        };
        match tokio::time::timeout(timeout, execute).await {
            Ok(result) => result.map_err(|error| SidecarRequestError::tool(error.to_string())),
            Err(_) => {
                let _ = self
                    .agent_connections
                    .cancel_query(&target.id, &query_id)
                    .await;
                Err(SidecarRequestError {
                    code: -32_065,
                    message: "database tool execution exceeded its deadline".to_string(),
                    data: Some(json!({"kind":"tool_timeout","recoverable":true})),
                })
            }
        }
    }

    async fn bound_tool_result(
        &self,
        project_id: &str,
        tool: &AgentToolManifestEntry,
        mut value: Value,
    ) -> Result<BoundedObservation> {
        let max_rows = tool
            .result_limit
            .as_ref()
            .and_then(|limit| limit.max_rows)
            .unwrap_or(MAX_TOOL_RESULT_ROWS)
            .min(MAX_TOOL_RESULT_ROWS);
        let mut truncated = false;
        let row_count = value.as_array().map(Vec::len);
        if let Some(rows) = value.as_array_mut() {
            if rows.len() > max_rows {
                rows.truncate(max_rows);
                truncated = true;
            }
        }
        let bytes = serde_json::to_vec(&value)?;
        let byte_count = bytes.len();
        let citation_preview = bounded_tool_citation_preview(&tool.name, &value);
        let max_bytes = tool
            .result_limit
            .as_ref()
            .and_then(|limit| limit.max_bytes)
            .unwrap_or(DEFAULT_TOOL_RESULT_BYTES)
            .clamp(1, MAX_TOOL_RESULT_BYTES);
        if byte_count <= max_bytes {
            return Ok(BoundedObservation {
                summary: format!("{} returned a bounded result", tool.name),
                data: Some(value),
                row_count,
                byte_count,
                truncated,
                artifact_ref: None,
            });
        }

        let artifact_id = format!("tool-result-{}", random_token(18));
        self.store
            .save_artifact(project_id, &artifact_id, &value)
            .await?;
        Ok(BoundedObservation {
            summary: format!(
                "{} result exceeded {} bytes and was offloaded",
                tool.name, max_bytes
            ),
            data: citation_preview,
            row_count,
            byte_count,
            truncated: true,
            artifact_ref: Some(artifact_id),
        })
    }

    async fn handle_checkpoint_save(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: CheckpointRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        if request.project_id != turn.project_id {
            return Err(SidecarRequestError::security(anyhow!(
                "checkpoint project does not match the active turn"
            )));
        }
        let checkpoint = request.checkpoint.ok_or_else(|| {
            SidecarRequestError::invalid_params("checkpoint is required for checkpoint.save")
        })?;
        self.store
            .save_checkpoint(
                &request.project_id,
                &request.metadata.thread_id,
                request.checkpoint_version,
                &checkpoint,
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({"saved": true, "checkpointVersion": request.checkpoint_version}))
    }

    async fn handle_checkpoint_load(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: CheckpointRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        if request.project_id != turn.project_id {
            return Err(SidecarRequestError::security(anyhow!(
                "checkpoint project does not match the active turn"
            )));
        }
        let checkpoint = self
            .store
            .load_checkpoint(
                &request.project_id,
                &request.metadata.thread_id,
                request.checkpoint_version,
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({
            "checkpointVersion": request.checkpoint_version,
            "checkpoint": checkpoint,
        }))
    }

    async fn handle_graph_checkpoint_get(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: GraphCheckpointGetRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        self.validate_graph_checkpoint_scope(&request.scope).await?;
        let record = self
            .store
            .load_graph_checkpoint(
                &request.scope.project_id,
                &request.scope.checkpoint_thread_id,
                &request.scope.checkpoint_ns,
                request.checkpoint_id.as_deref(),
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({"record": record.map(graph_checkpoint_record_value)}))
    }

    async fn handle_graph_checkpoint_list(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: GraphCheckpointListRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        self.validate_graph_checkpoint_scope(&request.scope).await?;
        if request.limit == 0 || request.limit > 1_000 {
            return Err(SidecarRequestError::invalid_params(
                "graph checkpoint list limit must be between 1 and 1000",
            ));
        }
        if request
            .filter
            .as_ref()
            .is_some_and(|value| !value.is_object())
        {
            return Err(SidecarRequestError::invalid_params(
                "graph checkpoint metadata filter must be an object",
            ));
        }
        let records = self
            .store
            .list_graph_checkpoints(
                &request.scope.project_id,
                &request.scope.checkpoint_thread_id,
                &request.scope.checkpoint_ns,
                request.checkpoint_id.as_deref(),
                request.before_checkpoint_id.as_deref(),
                request.limit,
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({
            "records": records.into_iter().map(graph_checkpoint_record_value).collect::<Vec<_>>()
        }))
    }

    async fn handle_graph_checkpoint_put(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: GraphCheckpointPutRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        self.validate_graph_checkpoint_scope(&request.scope).await?;
        validate_graph_typed_blob(&request.checkpoint)?;
        validate_graph_typed_blob(&request.metadata)?;
        self.store
            .save_graph_checkpoint(
                &request.scope.project_id,
                &request.scope.checkpoint_thread_id,
                &request.scope.checkpoint_ns,
                &request.checkpoint_id,
                request.parent_checkpoint_id.as_deref(),
                &serde_json::to_value(&request.checkpoint)
                    .map_err(|error| SidecarRequestError::storage(error.into()))?,
                &serde_json::to_value(&request.metadata)
                    .map_err(|error| SidecarRequestError::storage(error.into()))?,
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({"saved": true, "checkpointId": request.checkpoint_id}))
    }

    async fn handle_graph_checkpoint_put_writes(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: GraphCheckpointPutWritesRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        self.validate_graph_checkpoint_scope(&request.scope).await?;
        if request.writes.len() > 2_048 {
            return Err(SidecarRequestError::invalid_params(
                "too many graph checkpoint writes",
            ));
        }
        let writes = request
            .writes
            .iter()
            .map(|write| {
                validate_graph_typed_blob(&write.value)?;
                Ok(StoredGraphWrite {
                    task_id: write.task_id.clone(),
                    index: write.index,
                    channel: write.channel.clone(),
                    value: serde_json::to_value(&write.value)
                        .map_err(|error| SidecarRequestError::storage(error.into()))?,
                })
            })
            .collect::<std::result::Result<Vec<_>, SidecarRequestError>>()?;
        self.store
            .save_graph_writes(
                &request.scope.project_id,
                &request.scope.checkpoint_thread_id,
                &request.scope.checkpoint_ns,
                &request.checkpoint_id,
                &writes,
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({"saved": true, "writeCount": writes.len()}))
    }

    async fn handle_graph_checkpoint_delete_thread(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: GraphCheckpointDeleteThreadRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        if request.project_id != turn.project_id
            || request.checkpoint_thread_id != turn.checkpoint_thread_id
        {
            return Err(SidecarRequestError::security(anyhow!(
                "graph checkpoint delete scope does not match the active turn"
            )));
        }
        let deleted = self
            .store
            .delete_graph_thread(&request.project_id, &request.checkpoint_thread_id)
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({"deleted": deleted}))
    }

    async fn validate_graph_checkpoint_scope(
        &self,
        scope: &crate::agent::protocol::GraphCheckpointScopeRequest,
    ) -> std::result::Result<ActiveTurn, SidecarRequestError> {
        let turn = self
            .validate_active(&scope.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        if scope.project_id != turn.project_id
            || scope.checkpoint_thread_id != turn.checkpoint_thread_id
        {
            return Err(SidecarRequestError::security(anyhow!(
                "graph checkpoint scope does not match the active turn"
            )));
        }
        if scope.checkpoint_ns.chars().count() > 512 {
            return Err(SidecarRequestError::invalid_params(
                "graph checkpoint namespace exceeds 512 characters",
            ));
        }
        Ok(turn)
    }

    async fn handle_artifact_read(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: ArtifactReadRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        validate_artifact_id(&request.artifact_id)?;
        validate_artifact_read_bytes(request.max_bytes)?;
        if request.project_id != turn.project_id {
            return Err(SidecarRequestError::security(anyhow!(
                "artifact project does not match the active turn"
            )));
        }
        let artifact = self
            .store
            .load_artifact(&request.project_id, &request.artifact_id)
            .await
            .map_err(SidecarRequestError::storage)?;
        let Some(artifact) = artifact else {
            return Ok(json!({"artifactId": request.artifact_id, "value": null}));
        };
        let content = serde_json::to_string(&artifact).map_err(SidecarRequestError::from_json)?;
        if request.offset == 0 && content.len() <= request.max_bytes {
            return Ok(json!({"artifactId": request.artifact_id, "value": artifact}));
        }
        let (offset, end, content_range) =
            artifact_text_range(&content, request.offset, request.max_bytes);
        Ok(json!({
            "artifactId":request.artifact_id,
            "encoding":"base64-json",
            "offset":offset,
            "nextOffset":end,
            "totalBytes":content.len(),
            "eof":end == content.len(),
            "content":BASE64_URL.encode(content_range.as_bytes()),
        }))
    }

    async fn handle_artifact_search(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: ArtifactSearchRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        validate_artifact_id(&request.artifact_id)?;
        let query = request.query.trim();
        validate_artifact_search(query, request.max_matches, request.context_bytes)?;
        if request.project_id != turn.project_id {
            return Err(SidecarRequestError::security(anyhow!(
                "artifact project does not match the active turn"
            )));
        }
        let artifact = self
            .store
            .load_artifact(&request.project_id, &request.artifact_id)
            .await
            .map_err(SidecarRequestError::storage)?;
        let Some(artifact) = artifact else {
            return Ok(json!({
                "artifactId": request.artifact_id,
                "query": query,
                "totalBytes": 0,
                "matchCount": 0,
                "truncated": false,
                "matches": [],
            }));
        };
        let content = serde_json::to_string(&artifact).map_err(SidecarRequestError::from_json)?;
        let (matches, truncated) =
            search_artifact_text(&content, query, request.max_matches, request.context_bytes);
        Ok(json!({
            "artifactId": request.artifact_id,
            "query": query,
            "totalBytes": content.len(),
            "matchCount": matches.len(),
            "truncated": truncated,
            "matches": matches,
        }))
    }

    async fn handle_agent_event(&self, mut event: Value) {
        let Some(object) = event.as_object() else {
            return;
        };
        let Some(thread_id) = object
            .get("threadId")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            return;
        };
        if thread_id.is_empty() {
            return;
        }
        let Some(turn_id) = object
            .get("turnId")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            return;
        };
        if turn_id.is_empty() {
            return;
        }
        let Some(_sidecar_sequence) = object.get("sequence").and_then(Value::as_u64) else {
            return;
        };
        let occurred_at = object
            .get("occurredAt")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        if occurred_at <= 0 {
            return;
        }
        let Some(event_type) = object
            .get("type")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            return;
        };
        if !valid_agent_event_shape(&event_type, object) {
            return;
        }
        let context_metrics_update = context_metrics_update(&event_type, object);
        let key = TurnKey { thread_id, turn_id };
        let active = self.turns.read().await.get(&key).cloned();
        let Some(active) = active else {
            return;
        };
        let sequence = {
            let mut sequences = self.event_sequences.write().await;
            let sequence = sequences.entry(key.clone()).or_insert(0);
            *sequence = sequence.saturating_add(1);
            *sequence
        };
        let Some(object) = event.as_object_mut() else {
            return;
        };
        object.insert("sequence".to_string(), Value::Number(sequence.into()));

        match event_type.as_str() {
            "clarification" => {
                let Some(clarification_id) = object
                    .get("clarificationId")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                else {
                    return;
                };
                self.clarifications.write().await.insert(
                    clarification_id.to_string(),
                    PendingClarification {
                        key: key.clone(),
                        expires_at: active.deadline,
                    },
                );
            }
            "approval" => {
                let fields = (
                    object
                        .get("approvalId")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    object
                        .get("callId")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    object
                        .get("inputDigest")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    object
                        .get("toolName")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                );
                let (Some(approval_id), Some(call_id), Some(input_digest_value), Some(tool_name)) =
                    fields
                else {
                    return;
                };
                let Some(tool) = active.tools.get(&tool_name) else {
                    return;
                };
                if !tool.permissions.iter().any(|permission| {
                    matches!(permission.as_str(), "write" | "destructive" | "external")
                }) || input_digest_value.trim().is_empty()
                {
                    return;
                }
                let (policy_digest, confirmation_phrase) = if tool_name
                    == RustHostTool::ShellExecute.name()
                {
                    let Some(requested_policy_digest) = object
                        .get("policyDigest")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                    else {
                        return;
                    };
                    let preflight = self
                        .command_preflights
                        .read()
                        .await
                        .get(&command_preflight_cache_key(
                            &key,
                            &call_id,
                            &requested_policy_digest,
                        ))
                        .filter(|preflight| {
                            preflight.key == key
                                && preflight.call_id == call_id
                                && constant_time_text_eq(
                                    &preflight.input_digest,
                                    &normalized_digest(&input_digest_value),
                                )
                                && preflight.tool_name == tool_name
                                && preflight.expires_at >= now_millis()
                                && preflight.result.decision != CommandPolicyDecision::Block
                        })
                        .cloned();
                    let Some(preflight) = preflight else {
                        return;
                    };
                    object.insert(
                        "findings".to_string(),
                        serde_json::to_value(&preflight.result.findings)
                            .unwrap_or_else(|_| Value::Array(Vec::new())),
                    );
                    object.insert(
                        "summary".to_string(),
                        Value::String(preflight.result.summary.clone()),
                    );
                    if let Some(confirmation) = preflight.result.confirmation.as_ref() {
                        object.insert(
                            "confirmation".to_string(),
                            serde_json::to_value(confirmation).unwrap_or(Value::Null),
                        );
                    } else {
                        object.remove("confirmation");
                    }
                    (
                        Some(preflight.result.policy_digest),
                        preflight.result.confirmation.map(|value| value.phrase),
                    )
                } else if tool_name == RustHostTool::QueryExecuteApproved.name() {
                    let phrase = "EXECUTE DATABASE CHANGE".to_string();
                    object.remove("policyDigest");
                    object.remove("findings");
                    object.insert("risk".to_string(), Value::String("destructive".to_string()));
                    object.insert(
                            "summary".to_string(),
                            Value::String(
                                "Approve one exact, digest-bound database operation. The Desktop will revalidate the frozen target and input immediately before execution."
                                    .to_string(),
                            ),
                        );
                    object.insert(
                            "confirmation".to_string(),
                            json!({
                                "kind":"phrase",
                                "phrase":phrase,
                                "prompt":"Type EXECUTE DATABASE CHANGE to confirm this database operation.",
                            }),
                        );
                    (None, Some(phrase))
                } else {
                    object.remove("policyDigest");
                    object.remove("findings");
                    object.remove("confirmation");
                    (None, None)
                };
                self.approvals.write().await.insert(
                    approval_id,
                    PendingApproval {
                        key: key.clone(),
                        call_id,
                        input_digest: normalized_digest(&input_digest_value),
                        tool_name,
                        policy_digest,
                        confirmation_phrase,
                        origin: ApprovalOrigin::Sidecar,
                        expires_at: active.deadline,
                    },
                );
            }
            _ => {}
        }

        if let Some(update) = context_metrics_update {
            match self
                .record_context_metrics(&active.project_id, update, occurred_at)
                .await
            {
                Ok(metrics) => {
                    if let Ok(value) = serde_json::to_value(metrics) {
                        object.insert("projectMetrics".to_string(), value);
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        "failed to persist agent context metrics: {}",
                        bounded_text(&error.to_string(), 512)
                    );
                }
            }
        }

        let terminal = event_type == "turn.status"
            && matches!(
                object.get("status").and_then(Value::as_str),
                Some("completed" | "failed" | "cancelled")
            );

        self.persist_turn_journal_event(&key, &active.project_id, &event)
            .await;
        if let Err(error) = self.app.emit(AGENT_HOST_EVENT_CHANNEL, event.clone()) {
            tracing::warn!("failed to emit agent event: {error}");
        }

        if terminal {
            self.clear_turn(&key).await;
        }
    }

    async fn consume_approval_lease(
        &self,
        lease: &str,
        key: &TurnKey,
        call_id: &str,
        input_digest_value: &str,
        tool_name: &str,
        policy_digest: Option<&str>,
    ) -> Result<()> {
        let mut leases = self.leases.write().await;
        leases.retain(|_, grant| grant.expires_at >= now_millis());
        let grant = leases
            .remove(lease)
            .ok_or_else(|| anyhow!("approval lease is invalid, expired, or already consumed"))?;
        if grant.key != *key
            || grant.call_id != call_id
            || !constant_time_text_eq(&grant.input_digest, input_digest_value)
            || grant.tool_name != tool_name
            || match (grant.policy_digest.as_deref(), policy_digest) {
                (Some(granted), Some(requested)) => !constant_time_text_eq(granted, requested),
                (None, None) => false,
                _ => true,
            }
        {
            return Err(anyhow!("approval lease does not authorize this tool input"));
        }
        Ok(())
    }

    async fn persist_turn_journal_event(&self, key: &TurnKey, project_id: &str, event: &Value) {
        let event_type = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        // Answer deltas are already checkpointed by the desktop and can arrive
        // thousands of times. The journal retains state transitions only.
        if matches!(event_type, "answer.delta" | "model.chunk") {
            return;
        }
        let encoded_len = serde_json::to_vec(event)
            .map(|value| value.len())
            .unwrap_or(0);
        let mut entry = event.clone();
        let entry_was_truncated = encoded_len > MAX_TURN_JOURNAL_EVENT_BYTES;
        if entry_was_truncated {
            entry = json!({
                "type": event_type,
                "threadId": key.thread_id,
                "turnId": key.turn_id,
                "sequence": event.get("sequence").cloned().unwrap_or(Value::Null),
                "occurredAt": event.get("occurredAt").cloned().unwrap_or(Value::Null),
                "detail": "Event payload exceeded the encrypted recovery journal limit.",
            });
        }
        let (events, truncated) = {
            let mut journals = self.turn_journals.write().await;
            let journal = journals.entry(key.clone()).or_default();
            journal.events.push(entry);
            if journal.events.len() > MAX_TURN_JOURNAL_EVENTS {
                let overflow = journal.events.len() - MAX_TURN_JOURNAL_EVENTS;
                journal.events.drain(0..overflow);
                journal.truncated = true;
            }
            journal.truncated |= entry_was_truncated;
            (journal.events.clone(), journal.truncated)
        };
        let journal = AgentTurnJournal {
            project_id: project_id.to_string(),
            thread_id: key.thread_id.clone(),
            turn_id: key.turn_id.clone(),
            events,
            truncated,
            updated_at: now_millis(),
        };
        let value = match serde_json::to_value(journal) {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!("failed to encode agent recovery journal: {error}");
                return;
            }
        };
        if let Err(error) = self
            .store
            .save_turn_journal(project_id, &key.turn_id, &value)
            .await
        {
            tracing::warn!("failed to persist agent recovery journal: {error}");
        }
    }

    async fn clear_turn(&self, key: &TurnKey) {
        if let Some(handle) = self.cli_turns.lock().await.remove(key) {
            let _ = handle.cancellation.send(true);
        }
        self.providers.write().await.remove(key);
        self.turns.write().await.remove(key);
        self.turn_journals.write().await.remove(key);
        self.event_sequences.write().await.remove(key);
        self.clarifications
            .write()
            .await
            .retain(|_, pending| pending.key != *key);
        let approval_ids = {
            let mut approvals = self.approvals.write().await;
            let ids = approvals
                .iter()
                .filter(|(_, pending)| pending.key == *key)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            approvals.retain(|_, pending| pending.key != *key);
            ids
        };
        if !approval_ids.is_empty() {
            let mut waiters = self.approval_waiters.lock().await;
            for approval_id in approval_ids {
                waiters.remove(&approval_id);
            }
        }
        self.leases
            .write()
            .await
            .retain(|_, grant| grant.key != *key);
        self.command_preflights
            .write()
            .await
            .retain(|_, preflight| preflight.key != *key);
        self.mutation_turn_states.write().await.remove(key);
    }

    async fn reset_failed_generation(&self, generation: Option<u64>, message: &str) {
        let mut process_slot = self.process.write().await;
        let should_clear = generation.is_none()
            || process_slot
                .as_ref()
                .is_some_and(|process| Some(process.generation) == generation);
        if should_clear {
            process_slot.take();
        }
        drop(process_slot);

        let mut pending = self.pending.lock().await;
        let keys = pending
            .iter()
            .filter(|(_, response)| generation.is_none() || Some(response.generation) == generation)
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        for key in keys {
            if let Some(response) = pending.remove(&key) {
                let _ = response.sender.send(Err(HostCallError::Transport(
                    "DeepAgents sidecar terminated".to_string(),
                )));
            }
        }
        drop(pending);
        let mut inbound = self.inbound_cancellations.lock().await;
        let keys = inbound
            .iter()
            .filter(|(_, cancellation)| {
                generation.is_none() || Some(cancellation.generation) == generation
            })
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        for key in keys {
            if let Some(cancellation) = inbound.remove(&key) {
                let _ = cancellation.sender.send(true);
            }
        }
        drop(inbound);
        if should_clear {
            self.set_lifecycle(
                LifecycleState::Crashed,
                None,
                Some(bounded_text(message, 2_000)),
                Vec::new(),
            )
            .await;
        }
    }

    async fn set_lifecycle(
        &self,
        state: LifecycleState,
        binary_path: Option<PathBuf>,
        last_error: Option<String>,
        capabilities: Vec<String>,
    ) {
        *self.lifecycle.write().await = Lifecycle {
            state,
            capabilities,
            binary_path,
            last_error,
        };
    }
}

impl TurnKey {
    fn from_metadata(metadata: &RequestMetadata) -> Self {
        Self {
            thread_id: metadata.thread_id.clone(),
            turn_id: metadata.turn_id.clone(),
        }
    }
}

fn command_preflight_cache_key(key: &TurnKey, call_id: &str, policy_digest: &str) -> String {
    format!(
        "{}\0{}\0{}\0{}",
        key.thread_id, key.turn_id, call_id, policy_digest
    )
}

impl ActiveTurn {
    fn from_request(request: &AgentTurnRequest) -> Self {
        Self {
            project_id: request.project_id.clone(),
            profile: request.profile,
            checkpoint_thread_id: expected_graph_thread_id(request),
            context_version: request.metadata.context_version.clone(),
            prompt: request.prompt.clone(),
            active_tab: request
                .workspace
                .summary
                .get("activeTab")
                .filter(|tab| !tab.is_null())
                .cloned(),
            tab_connection_id: request
                .workspace
                .summary
                .get("activeTab")
                .and_then(|tab| tab.get("connectionId"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            tab_namespace: request
                .workspace
                .summary
                .get("activeTab")
                .and_then(Value::as_object)
                .and_then(|tab| {
                    tab.get("targetSchema")
                        .or_else(|| tab.get("schemaName"))
                        .and_then(Value::as_str)
                })
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            connection_id: request.workspace.connection_id.clone(),
            database: request.workspace.database.clone(),
            namespace: request.workspace.namespace.clone(),
            deadline: request.metadata.deadline,
            tools: request
                .tools
                .iter()
                .cloned()
                .map(|tool| (tool.name.clone(), tool))
                .collect(),
        }
    }
}

#[derive(Debug)]
struct SidecarRequestError {
    code: i64,
    message: String,
    data: Option<Value>,
}

impl SidecarRequestError {
    fn invalid_params(message: impl Into<String>) -> Self {
        Self {
            code: -32_602,
            message: bounded_text(&message.into(), 2_000),
            data: Some(json!({"kind":"invalid_params","recoverable":false})),
        }
    }

    fn method_not_found(method: &str) -> Self {
        Self {
            code: -32_601,
            message: format!("unsupported sidecar method: {}", bounded_text(method, 200)),
            data: None,
        }
    }

    fn security(error: anyhow::Error) -> Self {
        Self {
            code: -32_051,
            message: bounded_text(&error.to_string(), 2_000),
            data: Some(json!({"kind":"security_validation_failed","recoverable":false})),
        }
    }

    fn tool(message: impl Into<String>) -> Self {
        Self {
            code: -32_062,
            message: bounded_text(&message.into(), 2_000),
            data: Some(json!({"kind":"tool_execution_failed","recoverable":true})),
        }
    }

    fn storage(error: anyhow::Error) -> Self {
        Self {
            code: -32_070,
            message: bounded_text(&error.to_string(), 2_000),
            data: Some(json!({"kind":"encrypted_storage_failed","recoverable":true})),
        }
    }

    fn from_json(error: serde_json::Error) -> Self {
        Self::tool(error.to_string())
    }
}

async fn read_sidecar_stdout(
    inner: Weak<AgentHostInner>,
    generation: u64,
    stdout: tokio::process::ChildStdout,
) {
    let mut reader = BufReader::new(stdout);
    loop {
        match read_json_frame(&mut reader).await {
            Ok(Some(message)) => {
                let Some(inner) = inner.upgrade() else {
                    return;
                };
                inner.handle_protocol_message(generation, message).await;
            }
            Ok(None) => {
                if let Some(inner) = inner.upgrade() {
                    inner
                        .reset_failed_generation(
                            Some(generation),
                            "DeepAgents sidecar closed its protocol stream",
                        )
                        .await;
                }
                return;
            }
            Err(error) => {
                if let Some(inner) = inner.upgrade() {
                    inner
                        .reset_failed_generation(Some(generation), &error.to_string())
                        .await;
                }
                return;
            }
        }
    }
}

async fn read_sidecar_stderr(stderr: tokio::process::ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let safe = sanitize_log_line(&line);
        if !safe.is_empty() {
            tracing::warn!("DeepAgents sidecar: {safe}");
        }
    }
}

fn validate_handshake(value: Value) -> std::result::Result<Vec<String>, HostCallError> {
    if value.get("protocolVersion").and_then(Value::as_u64)
        != Some(AGENT_HOST_PROTOCOL_VERSION as u64)
    {
        return Err(HostCallError::Transport(
            "DeepAgents sidecar protocol version is incompatible".to_string(),
        ));
    }
    if value.get("runtime").and_then(Value::as_str) != Some("deepagents-typescript") {
        return Err(HostCallError::Transport(
            "DeepAgents sidecar reported an unsupported runtime".to_string(),
        ));
    }
    if value
        .get("runtimeVersion")
        .and_then(Value::as_str)
        .is_none()
        || value.get("nodeVersion").and_then(Value::as_str).is_none()
        || value
            .get("maxFrameBytes")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            < AGENT_HOST_MAX_FRAME_BYTES as u64
    {
        return Err(HostCallError::Transport(
            "DeepAgents sidecar handshake is incomplete".to_string(),
        ));
    }
    let capabilities = value
        .get("capabilities")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            HostCallError::Transport("DeepAgents sidecar capabilities are missing".to_string())
        })?
        .iter()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let available = capabilities
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let missing = REQUIRED_CAPABILITIES
        .iter()
        .copied()
        .filter(|capability| !available.contains(capability))
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(HostCallError::Transport(format!(
            "DeepAgents sidecar is missing required capabilities: {}",
            missing.join(", ")
        )));
    }
    Ok(capabilities)
}

fn find_agent_binary(app: &AppHandle) -> Option<PathBuf> {
    let executable = executable_name();
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("OXIDE_AGENT_HOST_BINARY") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join(&executable));
            candidates.push(parent.join("resources").join(&executable));
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join(&executable));
        candidates.push(resources.join("binaries").join(&executable));
    }
    let development_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    candidates.push(development_dir.join(&executable));
    let target = env!("TAURI_ENV_TARGET_TRIPLE");
    let target_extension = if cfg!(windows) { ".exe" } else { "" };
    candidates.push(development_dir.join(format!("oxide-agent-host-{target}{target_extension}")));
    candidates.into_iter().find(|path| is_regular_file(path))
}

fn find_oxide_agent_cli_binary(app: &AppHandle) -> Option<PathBuf> {
    let executable = if cfg!(windows) {
        "oxide-agent.exe"
    } else {
        "oxide-agent"
    };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("OXIDE_AGENT_BINARY") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join(executable));
            candidates.push(parent.join("resources").join(executable));
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join(executable));
        candidates.push(resources.join("binaries").join(executable));
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("target").join("debug").join(executable));
    candidates.push(manifest.join("target").join("release").join(executable));
    let target = env!("TAURI_ENV_TARGET_TRIPLE");
    let extension = if cfg!(windows) { ".exe" } else { "" };
    candidates.push(
        manifest
            .join("binaries")
            .join(format!("oxide-agent-{target}{extension}")),
    );
    candidates.into_iter().find(|path| is_regular_file(path))
}

fn find_agent_launch(app: &AppHandle) -> Option<AgentLaunch> {
    if let Some(binary) = find_agent_binary(app) {
        return Some(AgentLaunch {
            program: binary.clone(),
            arguments: Vec::new(),
            display_path: binary,
        });
    }

    #[cfg(debug_assertions)]
    {
        let bundle = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("agent-host")
            .join("dist")
            .join("oxide-agent-host.cjs");
        if is_regular_file(&bundle) {
            let node = std::env::var_os("OXIDE_AGENT_HOST_NODE")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("node"));
            return Some(AgentLaunch {
                program: node,
                arguments: vec![bundle.clone()],
                display_path: bundle,
            });
        }
    }

    None
}

fn executable_name() -> String {
    if cfg!(windows) {
        "oxide-agent-host.exe".to_string()
    } else {
        "oxide-agent-host".to_string()
    }
}

fn is_regular_file(path: &Path) -> bool {
    path.metadata()
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

fn validate_stored_connection(
    project_id: &str,
    connection: &StoreSavedConnection,
) -> std::result::Result<(), SidecarRequestError> {
    if connection.project_id != project_id {
        return Err(SidecarRequestError::security(anyhow!(
            "saved connection project scope is invalid"
        )));
    }
    if connection.id.trim().is_empty() || connection.id.chars().count() > 240 {
        return Err(SidecarRequestError::security(anyhow!(
            "saved connection id is invalid"
        )));
    }
    if !is_safe_driver_package_token(connection.driver.trim()) {
        return Err(SidecarRequestError::security(anyhow!(
            "saved connection driver is invalid"
        )));
    }
    Ok(())
}

fn validate_connection_config(
    project_id: &str,
    stored: &StoreSavedConnection,
    config: &ConfigSavedConnection,
) -> std::result::Result<(), SidecarRequestError> {
    if config.project_id != project_id || config.id != stored.id {
        return Err(SidecarRequestError::security(anyhow!(
            "saved connection configuration does not match its project identity"
        )));
    }
    let stored_driver = canonical_driver_name(&stored.driver)
        .unwrap_or(stored.driver.trim())
        .to_ascii_lowercase();
    let configured_driver = canonical_driver_name(&config.driver)
        .unwrap_or(config.driver.trim())
        .to_ascii_lowercase();
    if !is_safe_driver_package_token(&stored_driver)
        || !is_safe_driver_package_token(&configured_driver)
        || stored_driver != configured_driver
    {
        return Err(SidecarRequestError::security(anyhow!(
            "saved connection driver does not match its configuration"
        )));
    }
    Ok(())
}

fn connection_url_from_config(
    capabilities: &DatabaseCapabilities,
    config: &ConfigSavedConnection,
) -> Result<String> {
    let is_file_connection = matches!(
        capabilities.connection_mode,
        crate::core::dialect::DatabaseConnectionMode::File
    );
    if let Some(value) = config
        .connection_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let value = config.url.trim();
            (!value.is_empty()).then_some(value)
        })
    {
        let value = value.strip_prefix("jdbc:").unwrap_or(value);
        // File-backed packages (SQLite and signed external implementations
        // such as DuckDB) receive the raw location rather than a network URL.
        if is_file_connection {
            return Ok(value.to_string());
        }
        let parsed = url::Url::parse(value).context("saved connection URL is invalid")?;
        if parsed.host_str().is_none() && parsed.scheme() != "redis" {
            return Err(anyhow!("saved connection URL must include a host"));
        }
        return Ok(value.to_string());
    }

    if is_file_connection {
        return config
            .database
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .or_else(|| {
                config
                    .host
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
            .map(str::to_string)
            .ok_or_else(|| anyhow!("saved SQLite database file is required"));
    }
    let host = config
        .host
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("saved connection host is required"))?;
    let ssl_enabled = config
        .ssl_mode
        .as_deref()
        .is_some_and(|value| !value.eq_ignore_ascii_case("disable"));
    let scheme = match capabilities.driver.as_str() {
        "postgres" => "postgres",
        "mysql" => "mysql",
        "mongodb" => "mongodb",
        "redis" => "redis",
        "elasticsearch" if ssl_enabled => "https",
        "elasticsearch" => "http",
        _ => return Err(anyhow!("unsupported saved connection driver")),
    };
    let mut url = url::Url::parse(&format!("{scheme}://{host}"))
        .context("failed to construct saved connection URL")?;
    url.set_port(Some(config.port.unwrap_or(capabilities.default_port)))
        .map_err(|_| anyhow!("saved connection port is invalid"))?;
    if let Some(user) = config.user.as_deref().filter(|value| !value.is_empty()) {
        url.set_username(user)
            .map_err(|_| anyhow!("saved connection username is invalid"))?;
    }
    if let Some(password) = config.password.as_deref().filter(|value| !value.is_empty()) {
        url.set_password(Some(password))
            .map_err(|_| anyhow!("saved connection password is invalid"))?;
    }
    if let Some(database) = config
        .database
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        url.set_path(database);
    }
    if let Some(ssl_mode) = config
        .ssl_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("disable"))
    {
        let parameter = match capabilities.driver.as_str() {
            "postgres" => "sslmode",
            "mysql" => "ssl-mode",
            "mongodb" | "redis" => "tls",
            "elasticsearch" => "ssl",
            _ => "sslmode",
        };
        url.query_pairs_mut().append_pair(parameter, ssl_mode);
    }
    Ok(url.to_string())
}

fn required_input_text(
    input: &Value,
    field: &str,
    max_chars: usize,
) -> std::result::Result<String, SidecarRequestError> {
    let value = input
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| SidecarRequestError::invalid_params(format!("{field} is required")))?;
    if value.chars().count() > max_chars {
        return Err(SidecarRequestError::invalid_params(format!(
            "{field} exceeds {max_chars} characters"
        )));
    }
    Ok(value.to_string())
}

fn resolve_prompt_connection<'a>(
    connections: &'a [StoreSavedConnection],
    prompt: &str,
) -> Option<&'a StoreSavedConnection> {
    let normalized_prompt = prompt.to_lowercase();
    let name_matches = connections
        .iter()
        .filter(|connection| {
            let name = connection.name.trim().to_lowercase();
            name.chars().count() >= 3 && normalized_prompt.contains(&name)
        })
        .collect::<Vec<_>>();
    let hinted_drivers = [
        ("elasticsearch", ["elasticsearch", "elastic", "es", "", ""]),
        ("mongodb", ["mongodb", "mongo", "", "", ""]),
        ("postgres", ["postgresql", "postgres", "pgsql", "pg", ""]),
        ("mysql", ["mysql", "", "", "", ""]),
        ("sqlite", ["sqlite", "sqlite3", "", "", ""]),
        ("redis", ["redis", "", "", "", ""]),
    ]
    .into_iter()
    .filter_map(|(driver, aliases)| {
        aliases
            .iter()
            .filter(|alias| !alias.is_empty())
            .any(|alias| contains_ascii_bounded_alias(&normalized_prompt, alias))
            .then_some(driver)
    })
    .collect::<Vec<_>>();
    if hinted_drivers.len() > 1 {
        return None;
    }
    let Some(driver) = hinted_drivers.first() else {
        return match name_matches.as_slice() {
            [connection] => Some(*connection),
            _ => None,
        };
    };
    let driver_matches = connections
        .iter()
        .filter(|connection| connection.driver.eq_ignore_ascii_case(driver))
        .collect::<Vec<_>>();
    if let [connection] = name_matches.as_slice() {
        if connection.driver.eq_ignore_ascii_case(driver) {
            return Some(*connection);
        }
    }
    match driver_matches.as_slice() {
        [connection] => Some(*connection),
        _ => None,
    }
}

fn contains_ascii_bounded_alias(value: &str, alias: &str) -> bool {
    value.match_indices(alias).any(|(start, matched)| {
        let before = value[..start].chars().next_back();
        let end = start + matched.len();
        let after = value[end..].chars().next();
        !before.is_some_and(is_ascii_identifier_character)
            && !after.is_some_and(is_ascii_identifier_character)
    })
}

fn is_ascii_identifier_character(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '_'
}

fn database_kind_for_dialect(dialect: StatementScanDialect) -> Option<DatabaseKind> {
    match dialect {
        StatementScanDialect::Postgres => Some(DatabaseKind::Postgres),
        StatementScanDialect::Mysql => Some(DatabaseKind::Mysql),
        StatementScanDialect::SqlServer => None,
    }
}

fn read_only_transaction_script(kind: DatabaseKind, sql: &str) -> String {
    let begin = match kind {
        DatabaseKind::Postgres => "BEGIN READ ONLY;",
        DatabaseKind::Mysql => "START TRANSACTION READ ONLY;",
    };
    format!("{begin}\n{}\n;\nROLLBACK;", sql.trim())
}

fn review_approved_query_input(
    driver: &str,
    dialect: Option<StatementScanDialect>,
    query: &str,
    connection_id: &str,
) -> std::result::Result<ApprovedQueryReview, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("query is required".to_string());
    }
    let canonical = canonical_driver_name(driver)
        .unwrap_or(driver.trim())
        .to_ascii_lowercase();
    let (operation_type, destructive) = if let Some(dialect) = dialect {
        let statements = split_sql_statements(query, dialect);
        if statements.len() != 1 {
            return Err(
                "query.executeApproved requires exactly one complete SQL statement".to_string(),
            );
        }
        if validate_read_only_sql(statements[0], dialect).is_ok() {
            return Err("Read-only SQL must use query.runReadOnly".to_string());
        }
        let kind = execution_statement_kind(statements[0]);
        if matches!(
            kind,
            StatementKind::Begin
                | StatementKind::Start
                | StatementKind::Commit
                | StatementKind::Rollback
                | StatementKind::Savepoint
                | StatementKind::Release
                | StatementKind::Set
                | StatementKind::Use
        ) {
            return Err(
                "Transaction and session control statements are forbidden for Agent execution"
                    .to_string(),
            );
        }
        let destructive = matches!(
            kind,
            StatementKind::Create
                | StatementKind::Alter
                | StatementKind::Drop
                | StatementKind::Truncate
                | StatementKind::Comment
                | StatementKind::Rename
        );
        (kind.as_str().to_string(), destructive)
    } else {
        if validate_native_read_only_query(&canonical, query).is_ok() {
            return Err("Read-only native operations must use query.runReadOnly".to_string());
        }
        match canonical.as_str() {
            "mongodb" => review_mongodb_mutation(query)?,
            "redis" => review_redis_mutation(query)?,
            "elasticsearch" => review_elasticsearch_mutation(query)?,
            _ => {
                return Err(format!(
                    "query.executeApproved is unsupported for driver {}",
                    bounded_text(&canonical, 80)
                ));
            }
        }
    };
    let confirmation_phrase = destructive.then(|| format!("EXECUTE {operation_type}"));
    Ok(ApprovedQueryReview {
        summary: format!(
            "Approve one {operation_type} operation on connection {}. The exact input is digest-bound and can be executed once.",
            bounded_text(connection_id, 80)
        ),
        operation_type,
        destructive,
        confirmation_phrase,
    })
}

fn mutation_policy_digest(
    target: &ResolvedAgentConnection,
    input_digest_value: &str,
    operation_type: &str,
) -> String {
    input_digest(&json!({
        "policy":"oxide-agent-approved-query-v1",
        "projectId":target.config.project_id,
        "connectionId":target.id,
        "connectionConfigDigest":target.config_digest,
        "database":target.database,
        "namespace":target.namespace,
        "environment":target.config.environment,
        "protectedDatabases":target.config.production_databases,
        "inputDigest":input_digest_value,
        "operationType":operation_type,
    }))
}

fn review_mongodb_mutation(query: &str) -> std::result::Result<(String, bool), String> {
    let value: Value = serde_json::from_str(query)
        .map_err(|_| "MongoDB mutation must be one valid JSON object".to_string())?;
    let object = value.as_object().ok_or_else(|| {
        "MongoDB mutation must contain exactly one JSON command object".to_string()
    })?;
    if contains_native_transaction_control(&value) {
        return Err("MongoDB transaction and session controls are forbidden".to_string());
    }
    let operations = object
        .keys()
        .filter_map(|key| {
            let normalized = key.to_ascii_lowercase();
            matches!(
                normalized.as_str(),
                "insertone"
                    | "insertmany"
                    | "updateone"
                    | "updatemany"
                    | "replaceone"
                    | "deleteone"
                    | "deletemany"
                    | "findoneandupdate"
                    | "findoneandreplace"
                    | "findoneanddelete"
                    | "drop"
                    | "dropdatabase"
                    | "create"
                    | "createindexes"
                    | "dropindexes"
                    | "renamecollection"
                    | "command"
            )
            .then_some(normalized)
        })
        .collect::<Vec<_>>();
    if operations.len() != 1 {
        return Err("MongoDB mutation must contain exactly one recognized operation".to_string());
    }
    let operation = operations[0].to_ascii_uppercase();
    let destructive = matches!(
        operations[0].as_str(),
        "deleteone"
            | "deletemany"
            | "findoneanddelete"
            | "drop"
            | "dropdatabase"
            | "dropindexes"
            | "renamecollection"
    );
    Ok((operation, destructive))
}

fn review_redis_mutation(query: &str) -> std::result::Result<(String, bool), String> {
    let commands = query
        .split(['\n', '\r', ';'])
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect::<Vec<_>>();
    if commands.len() != 1 {
        return Err("Redis Agent execution requires exactly one command".to_string());
    }
    let operation = commands[0]
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if operation.is_empty()
        || matches!(
            operation.as_str(),
            "MULTI" | "EXEC" | "DISCARD" | "WATCH" | "UNWATCH" | "SELECT"
        )
    {
        return Err(
            "Redis transaction, watch, and database-selection commands are forbidden".to_string(),
        );
    }
    let destructive = matches!(
        operation.as_str(),
        "DEL" | "UNLINK" | "FLUSHALL" | "FLUSHDB" | "RENAME" | "RENAMENX"
    );
    Ok((operation, destructive))
}

fn review_elasticsearch_mutation(query: &str) -> std::result::Result<(String, bool), String> {
    let request_lines = query
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let method = parts.next()?.to_ascii_uppercase();
            matches!(
                method.as_str(),
                "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE"
            )
            .then(|| (method, parts.next().unwrap_or_default().to_string()))
        })
        .collect::<Vec<_>>();
    if request_lines.len() != 1 || request_lines[0].1.trim().is_empty() {
        return Err(
            "Elasticsearch Agent execution requires exactly one Kibana-style request".to_string(),
        );
    }
    if request_lines[0].1.contains("://") {
        return Err("Elasticsearch request paths must be relative".to_string());
    }
    let (method, path) = &request_lines[0];
    let normalized_path = path.to_ascii_lowercase();
    let destructive = method == "DELETE"
        || normalized_path.contains("_delete_by_query")
        || normalized_path.contains("_close")
        || normalized_path.contains("_forcemerge");
    Ok((format!("{method} REQUEST"), destructive))
}

fn contains_native_transaction_control(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            let normalized = key
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect::<String>();
            matches!(
                normalized.as_str(),
                "starttransaction"
                    | "committransaction"
                    | "aborttransaction"
                    | "transaction"
                    | "session"
                    | "lsid"
                    | "autocommit"
            ) || contains_native_transaction_control(value)
        }),
        Value::Array(values) => values.iter().any(contains_native_transaction_control),
        _ => false,
    }
}

fn validate_native_read_only_query(driver: &str, query: &str) -> std::result::Result<(), String> {
    let driver = driver.trim().to_ascii_lowercase();
    match driver.as_str() {
        "elasticsearch" | "elastic" | "es" => validate_elasticsearch_read_only_query(query),
        "mongodb" | "mongo" => validate_mongodb_read_only_query(query),
        "redis" => validate_redis_read_only_query(query),
        _ => Err(format!(
            "query.runReadOnly is unsupported for driver {}",
            bounded_text(&driver, 80)
        )),
    }
}

fn validate_elasticsearch_read_only_query(query: &str) -> std::result::Result<(), String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Elasticsearch read request is empty".to_string());
    }
    if query.starts_with('{') || query.starts_with('[') {
        let value: Value = serde_json::from_str(query)
            .map_err(|_| "Elasticsearch search body must be valid JSON".to_string())?;
        if value.is_object() || value.is_array() {
            return Ok(());
        }
        return Err("Elasticsearch search body must be a JSON object or array".to_string());
    }

    let mut request_count = 0usize;
    for line in query.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let method = parts.next().unwrap_or_default().to_ascii_uppercase();
        if !matches!(
            method.as_str(),
            "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE"
        ) {
            if request_count == 0 {
                return Err(
                    "Elasticsearch read request must start with a Kibana-style request line"
                        .to_string(),
                );
            }
            continue;
        }
        let path = parts
            .next()
            .ok_or_else(|| "Elasticsearch request path is required".to_string())?;
        if path.contains("://") {
            return Err("Elasticsearch request path must be relative".to_string());
        }
        request_count += 1;
        if request_count > 20 {
            return Err("Elasticsearch read request exceeds 20 operations".to_string());
        }
        match method.as_str() {
            "GET" | "HEAD" => {}
            "POST" if is_elasticsearch_read_only_post_path(path) => {}
            _ => {
                return Err(format!(
                    "Elasticsearch {method} {path} is not allowed by query.runReadOnly"
                ));
            }
        }
    }
    if request_count == 0 {
        return Err("Elasticsearch read request contains no operations".to_string());
    }
    Ok(())
}

fn is_elasticsearch_read_only_post_path(path: &str) -> bool {
    let path = path
        .split(['?', '#'])
        .next()
        .unwrap_or(path)
        .trim_start_matches('/')
        .to_ascii_lowercase();
    matches!(
        path.as_str(),
        "_search"
            | "_msearch"
            | "_count"
            | "_sql"
            | "_eql/search"
            | "_async_search"
            | "_search/scroll"
    ) || path.ends_with("/_search")
        || path.ends_with("/_msearch")
        || path.ends_with("/_count")
        || path.ends_with("/_eql/search")
        || path.ends_with("/_async_search")
}

fn validate_mongodb_read_only_query(query: &str) -> std::result::Result<(), String> {
    let value: Value = serde_json::from_str(query.trim())
        .map_err(|_| "MongoDB read request must be valid JSON".to_string())?;
    let commands = value
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_else(|| std::slice::from_ref(&value));
    if commands.is_empty() || commands.len() > 20 {
        return Err("MongoDB read request must contain 1 to 20 commands".to_string());
    }
    if commands.iter().all(is_mongodb_read_only_command) {
        Ok(())
    } else {
        Err("MongoDB request is not a supported read-only command".to_string())
    }
}

fn is_mongodb_read_only_command(value: &Value) -> bool {
    let Some(command) = value.as_object() else {
        return false;
    };
    let operations = command
        .keys()
        .filter(|key| {
            matches!(
                key.to_ascii_lowercase().as_str(),
                "find"
                    | "aggregate"
                    | "count"
                    | "countdocuments"
                    | "insertone"
                    | "insertmany"
                    | "updateone"
                    | "updatemany"
                    | "deleteone"
                    | "deletemany"
                    | "command"
            )
        })
        .collect::<Vec<_>>();
    if operations.len() > 1 {
        return false;
    }
    match operations
        .first()
        .map(|operation| operation.to_ascii_lowercase())
        .as_deref()
    {
        Some("find") => {
            let find = command.get("find");
            let has_collection = command
                .get("collection")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty());
            let has_native_collection = find
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty());
            let filter_is_valid = command.get("filter").is_none_or(Value::is_object);
            (find.is_some_and(Value::is_object) && has_collection || has_native_collection)
                && filter_is_valid
        }
        Some("count") => {
            command
                .get("count")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
                && command.get("query").is_none_or(Value::is_object)
        }
        Some("countdocuments") => {
            command
                .get("collection")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
                && command.get("countDocuments").is_some_and(Value::is_object)
        }
        Some("aggregate") => {
            let aggregate = command.get("aggregate");
            let shorthand = aggregate.is_some_and(Value::is_array)
                && command
                    .get("collection")
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty());
            let native = aggregate
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
                && command.get("pipeline").is_some_and(Value::is_array);
            (shorthand || native)
                && !mongodb_pipeline_has_write_stage(if native {
                    command.get("pipeline")
                } else {
                    aggregate
                })
        }
        Some("command") => command
            .get("command")
            .and_then(Value::as_object)
            .and_then(|body| {
                body.keys()
                    .next()
                    .map(|name| (name.to_ascii_lowercase(), body))
            })
            .is_some_and(|(name, body)| {
                if name == "aggregate" {
                    return !mongodb_pipeline_has_write_stage(body.get("pipeline"));
                }
                matches!(
                    name.as_str(),
                    "buildinfo"
                        | "collstats"
                        | "count"
                        | "dbstats"
                        | "distinct"
                        | "explain"
                        | "find"
                        | "hello"
                        | "ismaster"
                        | "listcollections"
                        | "listdatabases"
                        | "listindexes"
                        | "ping"
                        | "serverstatus"
                )
            }),
        Some(_) => false,
        None => {
            command.get("collection").and_then(Value::as_str).is_some()
                && command.keys().all(|key| {
                    matches!(
                        key.to_ascii_lowercase().as_str(),
                        "collection" | "database" | "limit" | "skip" | "sort" | "projection"
                    )
                })
        }
    }
}

fn mongodb_pipeline_has_write_stage(value: Option<&Value>) -> bool {
    value.and_then(Value::as_array).is_none_or(|pipeline| {
        pipeline.iter().any(|stage| {
            stage.as_object().is_some_and(|stage| {
                stage
                    .keys()
                    .any(|key| matches!(key.to_ascii_lowercase().as_str(), "$out" | "$merge"))
            })
        })
    })
}

fn validate_redis_read_only_query(query: &str) -> std::result::Result<(), String> {
    let commands = query
        .split(['\n', '\r', ';'])
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect::<Vec<_>>();
    if commands.is_empty() || commands.len() > 50 {
        return Err("Redis read request must contain 1 to 50 commands".to_string());
    }
    if commands.iter().all(|command| {
        let mut tokens = command.split_whitespace();
        let name = tokens.next().unwrap_or_default().to_ascii_uppercase();
        let subcommand = tokens.next().unwrap_or_default().to_ascii_uppercase();
        matches!(
            name.as_str(),
            "COMMAND"
                | "DBSIZE"
                | "EXISTS"
                | "FT.INFO"
                | "FT.SEARCH"
                | "GET"
                | "GETRANGE"
                | "HGET"
                | "HGETALL"
                | "HEXISTS"
                | "HKEYS"
                | "HLEN"
                | "HMGET"
                | "HSCAN"
                | "HSTRLEN"
                | "HVALS"
                | "INFO"
                | "JSON.GET"
                | "JSON.MGET"
                | "LINDEX"
                | "LLEN"
                | "LRANGE"
                | "MGET"
                | "PING"
                | "PTTL"
                | "SCAN"
                | "SCARD"
                | "SISMEMBER"
                | "SMEMBERS"
                | "SRANDMEMBER"
                | "SSCAN"
                | "STRLEN"
                | "TTL"
                | "TYPE"
                | "XINFO"
                | "XLEN"
                | "XRANGE"
                | "XREAD"
                | "XREVRANGE"
                | "ZCARD"
                | "ZCOUNT"
                | "ZLEXCOUNT"
                | "ZRANGE"
                | "ZRANGEBYLEX"
                | "ZRANGEBYSCORE"
                | "ZRANK"
                | "ZREVRANGE"
                | "ZREVRANGEBYLEX"
                | "ZREVRANGEBYSCORE"
                | "ZREVRANK"
                | "ZSCAN"
                | "ZSCORE"
        ) || matches!(
            (name.as_str(), subcommand.as_str()),
            ("ACL", "CAT" | "GETUSER" | "LIST")
                | ("CLIENT", "ID" | "INFO" | "LIST")
                | ("CONFIG", "GET" | "HELP")
                | ("FUNCTION", "LIST" | "STATS")
                | ("MEMORY", "STATS" | "USAGE")
                | ("SCRIPT", "EXISTS" | "HELP")
                | ("SLOWLOG", "GET" | "LEN")
        )
    }) {
        Ok(())
    } else {
        Err("Redis request contains a command that is not read-only".to_string())
    }
}

fn strip_transaction_results(results: &mut Vec<QueryResult>) {
    let first = results
        .first()
        .and_then(|result| result.statement_type.as_deref());
    let last = results
        .last()
        .and_then(|result| result.statement_type.as_deref());
    if first.is_some_and(|kind| {
        kind.eq_ignore_ascii_case("BEGIN") || kind.eq_ignore_ascii_case("START")
    }) && last.is_some_and(|kind| kind.eq_ignore_ascii_case("ROLLBACK"))
    {
        results.remove(0);
        results.pop();
    }
}

fn truncate_query_rows(results: &mut [QueryResult], max_rows: usize) {
    let mut remaining = max_rows;
    for result in results {
        if result.rows.len() > remaining {
            result.rows.truncate(remaining);
        }
        remaining = remaining.saturating_sub(result.rows.len());
        if remaining == 0 {
            break;
        }
    }
}

fn tool_deadline_duration(
    turn: &ActiveTurn,
    tool_name: &str,
    request_deadline: i64,
) -> std::result::Result<Duration, SidecarRequestError> {
    let remaining = request_deadline
        .min(turn.deadline)
        .saturating_sub(now_millis());
    if remaining <= 0 {
        return Err(SidecarRequestError {
            code: -32_008,
            message: "agent request deadline has expired".to_string(),
            data: Some(json!({"kind":"deadline_exceeded","recoverable":true})),
        });
    }
    let configured = turn
        .tools
        .get(tool_name)
        .and_then(|tool| tool.timeout_ms)
        .unwrap_or(30_000)
        .clamp(100, 120_000);
    Ok(Duration::from_millis(configured.min(remaining as u64)))
}

fn non_empty(value: &str) -> Option<&str> {
    (!value.trim().is_empty()).then_some(value)
}

fn tool_requires_approval(tool_name: &str, permissions: &[String]) -> bool {
    let reviewable_workspace_write =
        tool_name == "project.writeFile" && permissions.len() == 1 && permissions[0] == "write";
    !reviewable_workspace_write
        && permissions
            .iter()
            .any(|permission| matches!(permission.as_str(), "write" | "destructive" | "external"))
}

fn trusted_project_file_change_event(
    metadata: &RequestMetadata,
    call_id: &str,
    change: &crate::commands::project_files::ProjectFileAppliedChange,
    created: bool,
    sequence: u64,
    occurred_at: i64,
) -> Value {
    json!({
        "type": "file.changed",
        "threadId": metadata.thread_id,
        "turnId": metadata.turn_id,
        "sequence": sequence,
        "occurredAt": occurred_at,
        "callId": call_id,
        "relativePath": change.relative_path,
        "operation": if created { "created" } else { "updated" },
        "revision": change.revision,
        "previousRevision": change.previous_revision,
        "originalContent": change.original_content,
        "appliedContent": change.applied_content,
        "additions": change.additions,
        "deletions": change.deletions,
        "introducedLines": change.introduced_lines,
        "lineEvidenceTruncated": change.line_evidence_truncated,
        "reviewable": true,
    })
}

fn bounded_tool_citation_preview(tool_name: &str, value: &Value) -> Option<Value> {
    const OBJECT_FIELDS: [&str; 4] = ["name", "namespace", "kind", "type"];
    const DESCRIPTION_FIELDS: [&str; 5] = ["connectionId", "namespace", "name", "driver", "kind"];
    const PLAN_FIELDS: [&str; 3] = ["id", "driver", "mode"];
    const PLAN_NODE_FIELDS: [&str; 5] = ["id", "nodeType", "relation", "alias", "index"];
    const ACTIVE_TAB_FIELDS: [&str; 6] = [
        "id",
        "type",
        "title",
        "connectionId",
        "databaseName",
        "schemaName",
    ];

    match tool_name {
        "metadata.listObjects" | "metadata.listCollections" => {
            let items = value.as_array()?;
            Some(Value::Array(
                items
                    .iter()
                    .take(8)
                    .filter_map(|item| bounded_object_fields(item, &OBJECT_FIELDS))
                    .map(Value::Object)
                    .collect(),
            ))
        }
        "metadata.describeObject" => {
            bounded_object_fields(value, &DESCRIPTION_FIELDS).map(Value::Object)
        }
        "query.explain" => {
            let source = value.as_object()?;
            let mut preview = bounded_object_fields(value, &PLAN_FIELDS)?;
            if let Some(root) = source
                .get("root")
                .and_then(|root| bounded_object_fields(root, &PLAN_NODE_FIELDS))
            {
                preview.insert("root".to_string(), Value::Object(root));
            }
            Some(Value::Object(preview))
        }
        "workspace.getActiveTab" => {
            let source = value.as_object()?;
            let mut preview = bounded_object_fields(value, &ACTIVE_TAB_FIELDS)?;
            if let Some(plan) = source
                .get("explainPlan")
                .and_then(bounded_active_plan_preview)
            {
                preview.insert("explainPlan".to_string(), plan);
            }
            Some(Value::Object(preview))
        }
        _ => None,
    }
}

fn bounded_active_plan_preview(value: &Value) -> Option<Value> {
    const PLAN_TEXT_FIELDS: [&str; 4] = ["id", "driver", "mode", "rootNodeId"];
    const PLAN_NUMBER_FIELDS: [&str; 5] = [
        "generatedInMs",
        "planningTimeMs",
        "executionTimeMs",
        "totalCost",
        "estimatedRows",
    ];
    const NODE_TEXT_FIELDS: [&str; 6] = [
        "id",
        "parentId",
        "nodeType",
        "relation",
        "index",
        "accessType",
    ];
    const NODE_NUMBER_FIELDS: [&str; 5] = [
        "totalCost",
        "estimatedRows",
        "actualTotalTimeMs",
        "actualRows",
        "loops",
    ];
    let source = value.as_object()?;
    let mut preview = bounded_object_fields(value, &PLAN_TEXT_FIELDS)?;
    copy_finite_number_fields(source, &mut preview, &PLAN_NUMBER_FIELDS);
    if let Some(Value::Bool(truncated)) = source.get("truncated") {
        preview.insert("truncated".to_string(), Value::Bool(*truncated));
    }
    if let Some(nodes) = source.get("nodes").and_then(Value::as_array) {
        let bounded_nodes = nodes
            .iter()
            .take(12)
            .filter_map(|node| {
                let source = node.as_object()?;
                let mut bounded = bounded_object_fields(node, &NODE_TEXT_FIELDS)?;
                copy_finite_number_fields(source, &mut bounded, &NODE_NUMBER_FIELDS);
                Some(Value::Object(bounded))
            })
            .collect::<Vec<_>>();
        preview.insert("nodes".to_string(), Value::Array(bounded_nodes));
    }
    Some(Value::Object(preview))
}

fn copy_finite_number_fields(
    source: &Map<String, Value>,
    target: &mut Map<String, Value>,
    fields: &[&str],
) {
    for field in fields {
        if let Some(value @ Value::Number(number)) = source.get(*field) {
            if number.as_f64().is_some_and(f64::is_finite) {
                target.insert((*field).to_string(), value.clone());
            }
        }
    }
}

fn bounded_object_fields(value: &Value, fields: &[&str]) -> Option<Map<String, Value>> {
    let source = value.as_object()?;
    let mut bounded = Map::new();
    for field in fields {
        if let Some(Value::String(text)) = source.get(*field) {
            bounded.insert(
                (*field).to_string(),
                Value::String(text.chars().take(512).collect()),
            );
        }
    }
    Some(bounded)
}

fn valid_agent_event_shape(event_type: &str, object: &Map<String, Value>) -> bool {
    match event_type {
        "turn.status" => {
            matches!(
                object.get("status").and_then(Value::as_str),
                Some(
                    "starting"
                        | "planning"
                        | "running"
                        | "awaiting_input"
                        | "awaiting_approval"
                        | "completed"
                        | "failed"
                        | "cancelled"
                )
            ) && optional_string_field(object, "label")
        }
        "plan.changed" => object
            .get("items")
            .and_then(Value::as_array)
            .filter(|items| items.len() <= 512)
            .is_some_and(|items| {
                items.iter().all(|item| {
                    let Some(item) = item.as_object() else {
                        return false;
                    };
                    has_string_field(item, "id")
                        && has_string_field(item, "title")
                        && matches!(
                            item.get("status").and_then(Value::as_str),
                            Some("pending" | "running" | "completed" | "failed")
                        )
                })
            }),
        "tool.started" | "tool.finished" => {
            has_string_field(object, "callId")
                && has_string_field(object, "toolName")
                && has_string_field(object, "label")
                && optional_agent_relative_path(object, "relativePath")
                && optional_bool_field(object, "success")
                && optional_string_field(object, "detail")
        }
        "subagent" => {
            has_string_field(object, "name")
                && matches!(
                    object.get("status").and_then(Value::as_str),
                    Some("started" | "completed" | "failed")
                )
                && optional_string_field(object, "detail")
        }
        "clarification" => {
            non_empty_string_field(object, "clarificationId")
                && optional_string_field(object, "context")
                && object
                    .get("questions")
                    .and_then(Value::as_array)
                    .filter(|questions| (1..=3).contains(&questions.len()))
                    .is_some_and(|questions| questions.iter().all(valid_clarification_question))
        }
        "approval" => {
            [
                "approvalId",
                "callId",
                "inputDigest",
                "toolName",
                "title",
                "summary",
            ]
            .iter()
            .all(|key| has_string_field(object, key))
                && matches!(
                    object.get("risk").and_then(Value::as_str),
                    Some("write" | "destructive" | "external")
                )
        }
        "context.compacted" => ["inputTokens", "retainedTokens", "offloadedArtifacts"]
            .iter()
            .all(|key| object.get(*key).and_then(Value::as_u64).is_some()),
        "model.usage" => {
            object
                .get("calls")
                .and_then(Value::as_u64)
                .is_some_and(|calls| calls > 0)
                && ["inputTokens", "outputTokens", "totalTokens"]
                    .iter()
                    .all(|key| object.get(*key).and_then(Value::as_u64).is_some())
        }
        "answer.delta" => {
            has_string_field(object, "content") && optional_bool_field(object, "reset")
        }
        "final.answer" => {
            has_string_field(object, "content")
                && optional_string_array_field(object, "artifacts")
                && valid_optional_agent_citations(object)
        }
        "failure" => {
            has_string_field(object, "code")
                && has_string_field(object, "message")
                && object.get("retryable").and_then(Value::as_bool).is_some()
        }
        _ => false,
    }
}

fn valid_optional_agent_citations(object: &Map<String, Value>) -> bool {
    let Some(value) = object.get("citations") else {
        return true;
    };
    value
        .as_array()
        .filter(|citations| citations.len() <= 8)
        .is_some_and(|citations| citations.iter().all(valid_agent_citation))
}

fn valid_agent_citation(value: &Value) -> bool {
    let Some(citation) = value.as_object() else {
        return false;
    };
    if !bounded_non_empty_string_field(citation, "id", 80)
        || !bounded_non_empty_string_field(citation, "label", 200)
        || !bounded_non_empty_string_field(citation, "toolName", 120)
        || !bounded_non_empty_string_field(citation, "projectId", 240)
        || !bounded_optional_string_field(citation, "detail", 500)
        || ![
            "connectionId",
            "databaseName",
            "schemaName",
            "objectName",
            "tabId",
            "planId",
            "nodeId",
        ]
        .iter()
        .all(|key| bounded_optional_string_field(citation, key, 240))
        || !bounded_optional_string_field(citation, "objectType", 120)
    {
        return false;
    }
    match citation.get("kind").and_then(Value::as_str) {
        Some("databaseSchema") => ["connectionId", "schemaName"]
            .iter()
            .all(|key| non_empty_string_field(citation, key)),
        Some("databaseObject") => ["connectionId", "schemaName", "objectName"]
            .iter()
            .all(|key| non_empty_string_field(citation, key)),
        Some("planNode") => ["tabId", "planId", "nodeId"]
            .iter()
            .all(|key| non_empty_string_field(citation, key)),
        _ => false,
    }
}

fn context_metrics_update(
    event_type: &str,
    object: &Map<String, Value>,
) -> Option<ContextMetricsUpdate> {
    match event_type {
        "context.compacted" => Some(ContextMetricsUpdate::Compaction {
            input_tokens: object.get("inputTokens")?.as_u64()?,
            retained_tokens: object.get("retainedTokens")?.as_u64()?,
            offloaded_artifacts: object.get("offloadedArtifacts")?.as_u64()?,
        }),
        "model.usage" => Some(ContextMetricsUpdate::ModelUsage {
            calls: object.get("calls")?.as_u64()?,
            input_tokens: object.get("inputTokens")?.as_u64()?,
            output_tokens: object.get("outputTokens")?.as_u64()?,
            total_tokens: object.get("totalTokens")?.as_u64()?,
        }),
        _ => None,
    }
}

fn apply_context_metrics_update(
    metrics: &mut AgentContextMetrics,
    update: ContextMetricsUpdate,
    occurred_at: i64,
) {
    match update {
        ContextMetricsUpdate::Compaction {
            input_tokens,
            retained_tokens,
            offloaded_artifacts,
        } => {
            let compaction = metrics
                .compaction
                .get_or_insert_with(AgentContextCompactionMetrics::default);
            compaction.count = compaction.count.saturating_add(1);
            compaction.last_input_tokens = input_tokens;
            compaction.last_retained_tokens = retained_tokens;
            compaction.offloaded_artifacts = compaction
                .offloaded_artifacts
                .saturating_add(offloaded_artifacts);
        }
        ContextMetricsUpdate::ModelUsage {
            calls,
            input_tokens,
            output_tokens,
            total_tokens,
        } => {
            let usage = metrics
                .model_usage
                .get_or_insert_with(AgentModelUsageMetrics::default);
            usage.calls = usage.calls.saturating_add(calls);
            usage.input_tokens = usage.input_tokens.saturating_add(input_tokens);
            usage.output_tokens = usage.output_tokens.saturating_add(output_tokens);
            usage.total_tokens = usage.total_tokens.saturating_add(total_tokens);
        }
    }
    metrics.updated_at = metrics.updated_at.max(occurred_at);
}

fn validate_project_id(project_id: &str) -> Result<()> {
    if project_id.trim().is_empty() || project_id.chars().count() > 240 {
        return Err(anyhow!("projectId must contain 1 to 240 characters"));
    }
    Ok(())
}

fn validate_conversation_id(conversation_id: Option<&str>) -> Result<()> {
    let Some(conversation_id) = conversation_id else {
        return Ok(());
    };
    if conversation_id.trim().is_empty()
        || conversation_id.chars().count() > 80
        || !conversation_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.')
        })
    {
        return Err(anyhow!(
            "conversationId must contain 1 to 80 letters, numbers, dashes, underscores, colons, or dots"
        ));
    }
    Ok(())
}

fn conversation_snapshot_store_key(conversation_id: Option<&str>) -> String {
    match conversation_id {
        Some(conversation_id) => format!("{CONVERSATION_SNAPSHOT_THREAD_ID}:{conversation_id}"),
        None => CONVERSATION_SNAPSHOT_THREAD_ID.to_string(),
    }
}

fn conversation_belongs_to_scope(conversation_id: &str, conversation_scope: &str) -> bool {
    conversation_id == conversation_scope
        || conversation_id
            .strip_prefix(conversation_scope)
            .is_some_and(|suffix| suffix.starts_with(":chat:"))
}

fn conversation_summary_title(message: &str) -> String {
    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut characters = normalized.chars();
    let title = characters.by_ref().take(79).collect::<String>();
    if characters.next().is_some() {
        format!("{title}…")
    } else {
        title
    }
}

fn valid_clarification_question(value: &Value) -> bool {
    let Some(question) = value.as_object() else {
        return false;
    };
    non_empty_string_field(question, "id")
        && non_empty_string_field(question, "prompt")
        && question.get("allowFreeText").and_then(Value::as_bool) == Some(true)
        && question
            .get("options")
            .and_then(Value::as_array)
            .filter(|options| (2..=3).contains(&options.len()))
            .is_some_and(|options| {
                options.iter().all(|option| {
                    let Some(option) = option.as_object() else {
                        return false;
                    };
                    non_empty_string_field(option, "id")
                        && non_empty_string_field(option, "label")
                        && optional_string_field(option, "description")
                })
            })
}

fn has_string_field(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).and_then(Value::as_str).is_some()
}

fn non_empty_string_field(object: &Map<String, Value>, key: &str) -> bool {
    object
        .get(key)
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
}

fn bounded_non_empty_string_field(
    object: &Map<String, Value>,
    key: &str,
    max_chars: usize,
) -> bool {
    object
        .get(key)
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty() && value.chars().count() <= max_chars)
}

fn bounded_optional_string_field(object: &Map<String, Value>, key: &str, max_chars: usize) -> bool {
    object.get(key).is_none()
        || object
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty() && value.chars().count() <= max_chars)
}

fn optional_string_field(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).is_none() || has_string_field(object, key)
}

fn optional_agent_relative_path(object: &Map<String, Value>, key: &str) -> bool {
    let Some(value) = object.get(key) else {
        return true;
    };
    let Some(path) = value.as_str() else {
        return false;
    };
    if path.is_empty()
        || path.chars().count() > 2_000
        || path.contains('\0')
        || path.starts_with('/')
        || path.starts_with('\\')
        || (path.len() >= 2
            && path.as_bytes()[0].is_ascii_alphabetic()
            && path.as_bytes()[1] == b':')
    {
        return false;
    }
    !path.split(['/', '\\']).any(|segment| segment == "..")
}

fn optional_bool_field(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).is_none() || object.get(key).and_then(Value::as_bool).is_some()
}

fn optional_string_array_field(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).is_none()
        || object
            .get(key)
            .and_then(Value::as_array)
            .is_some_and(|values| values.iter().all(Value::is_string))
}

fn bounded_identifier(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(max_chars)
        .collect()
}

fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut canonical = Map::new();
            for key in keys {
                canonical.insert(key.clone(), canonical_json(&object[key]));
            }
            Value::Object(canonical)
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical_json).collect()),
        _ => value.clone(),
    }
}

fn input_digest(value: &Value) -> String {
    let bytes = serde_json::to_vec(&canonical_json(value)).unwrap_or_default();
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn contains_approval_claim(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            let normalized = key
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect::<String>();
            matches!(
                normalized.as_str(),
                "approved" | "approval" | "approvallease" | "approvaltoken" | "isapproved"
            ) || contains_approval_claim(value)
        }),
        Value::Array(values) => values.iter().any(contains_approval_claim),
        _ => false,
    }
}

fn normalized_digest(value: &str) -> String {
    value
        .trim()
        .strip_prefix("sha256:")
        .unwrap_or(value.trim())
        .to_ascii_lowercase()
}

fn constant_time_text_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

fn random_token(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    OsRng.fill_bytes(&mut value);
    BASE64_URL.encode(value)
}

fn deadline_duration(deadline: i64) -> std::result::Result<Duration, HostCallError> {
    let remaining = deadline.saturating_sub(now_millis());
    if remaining <= 0 {
        return Err(HostCallError::Remote {
            code: -32_008,
            message: "agent request deadline has expired".to_string(),
        });
    }
    Ok(Duration::from_millis(remaining as u64))
}

fn ensure_not_expired(deadline: i64) -> Result<()> {
    if deadline <= now_millis() {
        Err(anyhow!("agent request deadline has expired"))
    } else {
        Ok(())
    }
}

fn expected_graph_thread_id(request: &AgentTurnRequest) -> String {
    let profile = match request.profile {
        crate::agent::protocol::AgentProfile::Chat => "chat",
        crate::agent::protocol::AgentProfile::Plan => "plan",
        crate::agent::protocol::AgentProfile::Agent => "agent",
    };
    let mut digest = Sha256::new();
    digest.update(request.project_id.as_bytes());
    digest.update(b"\0");
    digest.update(profile.as_bytes());
    digest.update(b"\0");
    digest.update(request.metadata.thread_id.as_bytes());
    format!("oxide-{}", BASE64_URL.encode(digest.finalize()))
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn bounded_text(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn validate_artifact_id(artifact_id: &str) -> std::result::Result<(), SidecarRequestError> {
    if artifact_id.trim().is_empty()
        || artifact_id.chars().count() > 240
        || artifact_id.chars().any(char::is_control)
    {
        return Err(SidecarRequestError::invalid_params(
            "artifactId must contain 1 to 240 non-control characters",
        ));
    }
    Ok(())
}

fn validate_artifact_read_bytes(max_bytes: usize) -> std::result::Result<(), SidecarRequestError> {
    if max_bytes == 0 || max_bytes > MAX_ARTIFACT_READ_BYTES {
        return Err(SidecarRequestError::invalid_params(
            "artifact maxBytes must be between 1 and 65536",
        ));
    }
    Ok(())
}

fn validate_artifact_search(
    query: &str,
    max_matches: usize,
    context_bytes: usize,
) -> std::result::Result<(), SidecarRequestError> {
    if query.trim().is_empty() || query.trim().chars().count() > 256 {
        return Err(SidecarRequestError::invalid_params(
            "artifact search query must contain 1 to 256 characters",
        ));
    }
    if max_matches == 0 || max_matches > MAX_ARTIFACT_SEARCH_MATCHES {
        return Err(SidecarRequestError::invalid_params(
            "artifact maxMatches must be between 1 and 20",
        ));
    }
    if !(16..=MAX_ARTIFACT_SEARCH_CONTEXT_BYTES).contains(&context_bytes) {
        return Err(SidecarRequestError::invalid_params(
            "artifact contextBytes must be between 16 and 512",
        ));
    }
    Ok(())
}

fn artifact_text_range(
    content: &str,
    requested_offset: usize,
    max_bytes: usize,
) -> (usize, usize, &str) {
    let offset = ceil_char_boundary(content, requested_offset.min(content.len()));
    let requested_end = offset.saturating_add(max_bytes).min(content.len());
    let mut end = floor_char_boundary(content, requested_end);
    if end == offset && end < content.len() {
        end = ceil_char_boundary(content, end.saturating_add(1));
    }
    (offset, end, &content[offset..end])
}

fn artifact_export_file_name(suggested: Option<&str>, artifact_id: &str) -> String {
    let source = suggested
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(artifact_id);
    let mut name = source
        .trim()
        .chars()
        .take(100)
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    name = name.trim_matches(['.', '-', '_']).to_string();
    if name.is_empty() {
        name = "oxide-agent-result".to_string();
    }
    if !name.to_ascii_lowercase().ends_with(".json") {
        name.push_str(".json");
    }
    name
}

fn search_artifact_text(
    content: &str,
    query: &str,
    max_matches: usize,
    context_bytes: usize,
) -> (Vec<AgentArtifactSearchMatch>, bool) {
    let case_insensitive = query.is_ascii();
    let haystack = if case_insensitive {
        content.to_ascii_lowercase()
    } else {
        content.to_string()
    };
    let needle = if case_insensitive {
        query.to_ascii_lowercase()
    } else {
        query.to_string()
    };
    let mut matches = Vec::new();
    let mut cursor = 0;
    let mut truncated = false;
    while cursor <= haystack.len() {
        let Some(relative) = haystack[cursor..].find(&needle) else {
            break;
        };
        let offset = cursor + relative;
        if matches.len() >= max_matches {
            truncated = true;
            break;
        }
        let end = offset.saturating_add(needle.len()).min(content.len());
        let snippet_start = floor_char_boundary(content, offset.saturating_sub(context_bytes));
        let snippet_end = ceil_char_boundary(
            content,
            end.saturating_add(context_bytes).min(content.len()),
        );
        matches.push(AgentArtifactSearchMatch {
            offset,
            length: end.saturating_sub(offset),
            snippet_offset: snippet_start,
            snippet: content[snippet_start..snippet_end].to_string(),
        });
        cursor = end.max(cursor.saturating_add(1));
    }
    (matches, truncated)
}

fn floor_char_boundary(value: &str, mut index: usize) -> usize {
    index = index.min(value.len());
    while index > 0 && !value.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn ceil_char_boundary(value: &str, mut index: usize) -> usize {
    index = index.min(value.len());
    while index < value.len() && !value.is_char_boundary(index) {
        index += 1;
    }
    index
}

fn sidecar_resumed(response: &Value) -> bool {
    response.get("resumed").and_then(Value::as_bool) == Some(true)
}

fn validate_graph_typed_blob(
    blob: &GraphTypedBlob,
) -> std::result::Result<(), SidecarRequestError> {
    blob.validate()
        .map_err(SidecarRequestError::invalid_params)?;
    let decoded = BASE64_STANDARD.decode(blob.data.as_bytes()).map_err(|_| {
        SidecarRequestError::invalid_params("graph typed blob data is not valid base64")
    })?;
    if decoded.len() > AGENT_HOST_MAX_FRAME_BYTES {
        return Err(SidecarRequestError::invalid_params(
            "decoded graph typed blob exceeds the maximum frame size",
        ));
    }
    Ok(())
}

fn graph_checkpoint_record_value(record: StoredGraphCheckpoint) -> Value {
    json!({
        "checkpointThreadId": record.checkpoint_thread_id,
        "checkpointNs": record.checkpoint_ns,
        "checkpointId": record.checkpoint_id,
        "parentCheckpointId": record.parent_checkpoint_id,
        "checkpoint": record.checkpoint,
        "metadata": record.metadata,
        "pendingWrites": record.pending_writes.into_iter().map(|write| json!({
            "taskId": write.task_id,
            "index": write.index,
            "channel": write.channel,
            "value": write.value,
        })).collect::<Vec<_>>(),
    })
}

fn sanitize_log_line(line: &str) -> String {
    let line = line
        .chars()
        .filter(|character| !character.is_control() || *character == '\t')
        .take(512)
        .collect::<String>();
    let lower = line.to_ascii_lowercase();
    if lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("authorization")
        || lower.contains("bearer ")
    {
        "<redacted sidecar diagnostic>".to_string()
    } else {
        line
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_conversation_snapshots_use_distinct_validated_store_keys() {
        assert_eq!(
            conversation_snapshot_store_key(None),
            CONVERSATION_SNAPSHOT_THREAD_ID
        );
        assert_ne!(
            conversation_snapshot_store_key(Some("provider:codex-cli")),
            conversation_snapshot_store_key(Some("provider:codebuddy-cli"))
        );
        assert!(validate_conversation_id(Some("provider:codex-cli")).is_ok());
        assert!(validate_conversation_id(Some("../../other-session")).is_err());
        assert!(conversation_belongs_to_scope(
            "provider:codex-cli:chat:abc",
            "provider:codex-cli"
        ));
        assert!(!conversation_belongs_to_scope(
            "provider:codex-cli-other:chat:abc",
            "provider:codex-cli"
        ));
        assert_eq!(
            conversation_summary_title(
                "  Explain   why this query is slow and suggest a safe index  "
            ),
            "Explain why this query is slow and suggest a safe index"
        );
    }

    fn tool_manifest(name: &str) -> AgentToolManifestEntry {
        let permissions = RustHostTool::from_name(name)
            .map(|tool| {
                tool.permissions()
                    .iter()
                    .map(|permission| (*permission).to_string())
                    .collect()
            })
            .unwrap_or_else(|| vec!["read".to_string()]);
        AgentToolManifestEntry {
            name: name.to_string(),
            description: "test tool".to_string(),
            input_schema: json!({"type":"object"}),
            permissions,
            timeout_ms: None,
            result_limit: None,
        }
    }

    fn stored_connection(id: &str, name: &str, driver: &str) -> StoreSavedConnection {
        StoreSavedConnection {
            id: id.to_string(),
            project_id: "project".to_string(),
            name: name.to_string(),
            driver: driver.to_string(),
            config: json!({}),
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn canonical_digest_is_stable_across_object_key_order() {
        let first = json!({"b":2,"a":{"z":1,"x":0}});
        let second = json!({"a":{"x":0,"z":1},"b":2});
        assert_eq!(input_digest(&first), input_digest(&second));
        assert_eq!(input_digest(&first).len(), 64);
    }

    #[test]
    fn reviewable_project_writes_bypass_preapproval_without_weakening_other_mutations() {
        assert!(!tool_requires_approval(
            "project.writeFile",
            &["write".to_string()]
        ));
        assert!(tool_requires_approval(
            "database.mutate",
            &["write".to_string()]
        ));
        assert!(tool_requires_approval(
            "project.writeFile",
            &["destructive".to_string()]
        ));
        assert!(!tool_requires_approval(
            "project.readFile",
            &["read".to_string()]
        ));
    }

    #[test]
    fn installed_tool_catalog_and_manifest_validation_share_one_dispatch_enum() {
        let advertised = installed_host_tool_names();
        assert_eq!(advertised.len(), RustHostTool::ALL.len());
        assert!(advertised.windows(2).all(|pair| pair[0] != pair[1]));
        assert!(advertised
            .iter()
            .all(|name| RustHostTool::from_name(name).is_some()));

        let supported = advertised
            .iter()
            .map(|name| tool_manifest(name))
            .collect::<Vec<_>>();
        assert!(validate_host_tool_manifest(AgentProfile::Agent, &supported).is_ok());
        assert!(validate_host_tool_manifest(
            AgentProfile::Agent,
            &[tool_manifest("editor.proposePatch")]
        )
        .is_err());

        let mut downgraded_write = tool_manifest("project.writeFile");
        downgraded_write.permissions = vec!["read".to_string()];
        assert!(validate_host_tool_manifest(AgentProfile::Agent, &[downgraded_write]).is_err());
        assert!(validate_host_tool_manifest(
            AgentProfile::Chat,
            &[tool_manifest("workspace.getActiveTab")]
        )
        .is_ok());
        assert!(validate_host_tool_manifest(
            AgentProfile::Chat,
            &[tool_manifest("query.runReadOnly")]
        )
        .is_err());
        assert!(validate_host_tool_manifest(
            AgentProfile::Plan,
            &[tool_manifest("project.writeFile")]
        )
        .is_err());
    }

    #[test]
    fn canonical_digest_matches_cross_language_unicode_fixture() {
        let fixture = json!({"😀":1,"中":2,"é":3,"a":4});
        assert_eq!(
            serde_json::to_string(&canonical_json(&fixture)).unwrap(),
            r#"{"a":4,"é":3,"中":2,"😀":1}"#
        );
        assert_eq!(
            input_digest(&fixture),
            "2d2372dac0fb37d70eedcaf38ba9a540481b2684d280a7ab2aefbd01911d2de9"
        );
    }

    #[test]
    fn prompt_selects_a_unique_connection_by_driver_alias_or_name() {
        let connections = vec![
            stored_connection("es-1", "New Elasticsearch Connection", "elasticsearch"),
            stored_connection("mongo-1", "New MongoDB Connection", "mongodb"),
            stored_connection("mysql-1", "Pkulaw-test", "mysql"),
            stored_connection("sqlite-1", "Local analytics", "sqlite"),
        ];

        assert_eq!(
            resolve_prompt_connection(&connections, "查看我 es 中有哪些表")
                .map(|connection| connection.id.as_str()),
            Some("es-1")
        );
        assert_eq!(
            resolve_prompt_connection(&connections, "查看我MongoDB中的集合")
                .map(|connection| connection.id.as_str()),
            Some("mongo-1")
        );
        assert_eq!(
            resolve_prompt_connection(&connections, "查询 Pkulaw-test")
                .map(|connection| connection.id.as_str()),
            Some("mysql-1")
        );
        assert_eq!(
            resolve_prompt_connection(&connections, "查询 SQLite 本地库中的 entries")
                .map(|connection| connection.id.as_str()),
            Some("sqlite-1")
        );
    }

    #[test]
    fn prompt_does_not_guess_when_a_driver_has_multiple_connections() {
        let connections = vec![
            stored_connection("es-1", "Elasticsearch One", "elasticsearch"),
            stored_connection("es-2", "Elasticsearch Two", "elasticsearch"),
            stored_connection("mysql-1", "MySQL", "mysql"),
        ];

        assert!(resolve_prompt_connection(&connections, "查看 ES 中的索引").is_none());
        assert!(resolve_prompt_connection(&connections, "比较 ES 和 MySQL").is_none());
        assert!(resolve_prompt_connection(&connections, "有哪些数据库").is_none());
    }

    #[test]
    fn native_read_only_gate_accepts_elasticsearch_search_syntax() {
        for query in [
            r#"{"query":{"match_all":{}},"size":5}"#,
            "POST articles/_search\n{\"query\":{\"match\":{\"title\":\"rust\"}}}",
            "POST /articles/_count\n{\"query\":{\"term\":{\"published\":true}}}",
            "GET /articles/_mapping",
        ] {
            assert!(
                validate_native_read_only_query("elasticsearch", query).is_ok(),
                "{query}"
            );
        }
    }

    #[test]
    fn native_read_only_gate_rejects_elasticsearch_mutations() {
        for query in [
            "DELETE /articles/_doc/1",
            "PUT /articles/_doc/1\n{\"title\":\"changed\"}",
            "POST /_bulk\n{\"delete\":{\"_index\":\"articles\",\"_id\":\"1\"}}",
            "POST /articles/_delete_by_query\n{\"query\":{\"match_all\":{}}}",
        ] {
            assert!(
                validate_native_read_only_query("elasticsearch", query).is_err(),
                "{query}"
            );
        }
    }

    #[test]
    fn native_read_only_gate_preserves_mongodb_and_redis_safety() {
        assert!(validate_native_read_only_query(
            "mongodb",
            r#"{"collection":"users","find":{"active":true},"limit":5}"#
        )
        .is_ok());
        assert!(validate_native_read_only_query(
            "mongodb",
            r#"{"find":"users","filter":{"active":true},"limit":5}"#
        )
        .is_ok());
        assert!(validate_native_read_only_query(
            "mongodb",
            r#"{"aggregate":"users","pipeline":[{"$match":{"active":true}}],"cursor":{}}"#
        )
        .is_ok());
        assert!(validate_native_read_only_query(
            "mongodb",
            r#"{"count":"users","query":{"active":true}}"#
        )
        .is_ok());
        assert!(validate_native_read_only_query(
            "mongodb",
            r#"{"collection":"users","aggregate":[{"$match":{"active":true}},{"$out":"copy"}]}"#
        )
        .is_err());
        assert!(validate_native_read_only_query(
            "mongodb",
            r#"{"aggregate":"users","pipeline":[{"$match":{"active":true}},{"$merge":"copy"}],"cursor":{}}"#
        )
        .is_err());
        assert!(
            validate_native_read_only_query("mongodb", r#"{"find":"users","filter":[]}"#).is_err()
        );
        assert!(validate_native_read_only_query("redis", "GET user:1\nTTL user:1").is_ok());
        assert!(validate_native_read_only_query("redis", "DEL user:1").is_err());
    }

    #[test]
    fn handshake_requires_protocol_runtime_and_capabilities() {
        let valid = json!({
            "protocolVersion": AGENT_HOST_PROTOCOL_VERSION,
            "runtime": "deepagents-typescript",
            "runtimeVersion": "1.0.0",
            "nodeVersion": "22.0.0",
            "maxFrameBytes": AGENT_HOST_MAX_FRAME_BYTES,
            "capabilities": REQUIRED_CAPABILITIES,
        });
        assert!(validate_handshake(valid).is_ok());
        let invalid = json!({
            "protocolVersion": 2,
            "runtime": "deepagents-typescript",
            "runtimeVersion": "1.0.0",
            "nodeVersion": "22.0.0",
            "maxFrameBytes": AGENT_HOST_MAX_FRAME_BYTES,
            "capabilities": REQUIRED_CAPABILITIES,
        });
        assert!(validate_handshake(invalid).is_err());
    }

    #[test]
    fn sidecar_log_sanitizer_redacts_likely_credentials() {
        assert_eq!(
            sanitize_log_line("Authorization: Bearer secret"),
            "<redacted sidecar diagnostic>"
        );
        assert_eq!(sanitize_log_line("host ready\n"), "host ready");
    }

    #[test]
    fn answer_delta_event_requires_content_and_boolean_reset() {
        let valid = json!({"content":"partial answer","reset":false});
        assert!(valid_agent_event_shape(
            "answer.delta",
            valid.as_object().unwrap()
        ));
        let invalid = json!({"content":"partial answer","reset":"false"});
        assert!(!valid_agent_event_shape(
            "answer.delta",
            invalid.as_object().unwrap()
        ));
        assert!(!valid_agent_event_shape(
            "unknown.event",
            valid.as_object().unwrap()
        ));
    }

    #[test]
    fn tool_activity_accepts_only_safe_project_relative_paths() {
        let valid = json!({
            "callId": "call-read",
            "toolName": "project.readFile",
            "label": "Read project file",
            "relativePath": "sql/reports/daily.sql"
        });
        assert!(valid_agent_event_shape(
            "tool.started",
            valid.as_object().unwrap()
        ));

        let traversal = json!({
            "callId": "call-read",
            "toolName": "project.readFile",
            "label": "Read project file",
            "relativePath": "../outside.sql"
        });
        assert!(!valid_agent_event_shape(
            "tool.started",
            traversal.as_object().unwrap()
        ));
    }

    #[test]
    fn final_answer_citations_require_stable_navigation_targets() {
        let valid = json!({
            "content": "users exists [1].",
            "artifacts": [],
            "citations": [{
                "id": "cite-object-users",
                "kind": "databaseObject",
                "label": "users",
                "detail": "app.public.users",
                "toolName": "metadata.describeObject",
                "projectId": "project",
                "connectionId": "postgres-1",
                "databaseName": "app",
                "schemaName": "public",
                "objectName": "users",
                "objectType": "table"
            }]
        });
        assert!(valid_agent_event_shape(
            "final.answer",
            valid.as_object().unwrap()
        ));

        let invalid = json!({
            "content": "missing target",
            "citations": [{
                "id": "cite-invalid",
                "kind": "planNode",
                "label": "Plan",
                "toolName": "query.explain",
                "projectId": "project",
                "planId": "plan-1"
            }]
        });
        assert!(!valid_agent_event_shape(
            "final.answer",
            invalid.as_object().unwrap()
        ));
    }

    #[test]
    fn offloaded_metadata_and_plan_results_keep_only_navigation_identity() {
        let metadata = json!([{
            "name": "users",
            "namespace": "public",
            "kind": "relation",
            "type": "table",
            "comment": "must not cross the compact citation boundary"
        }]);
        assert_eq!(
            bounded_tool_citation_preview("metadata.listObjects", &metadata),
            Some(json!([{
                "name": "users",
                "namespace": "public",
                "kind": "relation",
                "type": "table"
            }]))
        );

        let plan = json!({
            "id": "plan-1",
            "driver": "postgres",
            "mode": "estimate",
            "rawPlan": {"secretlyLarge": [1, 2, 3]},
            "root": {
                "id": "plan-1:root",
                "nodeType": "Seq Scan",
                "relation": "users",
                "condition": "email = 'sensitive@example.test'"
            }
        });
        assert_eq!(
            bounded_tool_citation_preview("query.explain", &plan),
            Some(json!({
                "id": "plan-1",
                "driver": "postgres",
                "mode": "estimate",
                "root": {
                    "id": "plan-1:root",
                    "nodeType": "Seq Scan",
                    "relation": "users"
                }
            }))
        );

        let active_tab = json!({
            "id": "query-1",
            "type": "query",
            "title": "Revenue query",
            "sql": "SELECT secret_column FROM revenue",
            "explainPlan": {
                "id": "plan-runtime-1",
                "driver": "postgres",
                "mode": "analyze",
                "rootNodeId": "node-0",
                "executionTimeMs": 18.5,
                "truncated": false,
                "nodes": [{
                    "id": "node-0",
                    "nodeType": "Index Scan",
                    "relation": "revenue",
                    "actualTotalTimeMs": 17.2,
                    "actualRows": 42,
                    "condition": "tenant_id = 'sensitive'"
                }],
                "rawPlan": {"mustNotCross": true}
            }
        });
        assert_eq!(
            bounded_tool_citation_preview("workspace.getActiveTab", &active_tab),
            Some(json!({
                "id": "query-1",
                "type": "query",
                "title": "Revenue query",
                "explainPlan": {
                    "id": "plan-runtime-1",
                    "driver": "postgres",
                    "mode": "analyze",
                    "rootNodeId": "node-0",
                    "executionTimeMs": 18.5,
                    "truncated": false,
                    "nodes": [{
                        "id": "node-0",
                        "nodeType": "Index Scan",
                        "relation": "revenue",
                        "actualTotalTimeMs": 17.2,
                        "actualRows": 42
                    }]
                }
            }))
        );
    }

    #[test]
    fn trusted_file_change_events_include_applied_content_for_review() {
        let metadata = RequestMetadata {
            request_id: "request".to_string(),
            thread_id: "thread".to_string(),
            turn_id: "turn".to_string(),
            context_version: "context".to_string(),
            deadline: now_millis() + 10_000,
        };
        let change = crate::commands::project_files::ProjectFileAppliedChange {
            relative_path: "queries/report.sql".to_string(),
            revision: "a".repeat(64),
            previous_revision: None,
            original_content: String::new(),
            applied_content: "select 1;\nselect 2;".to_string(),
            additions: 2,
            deletions: 0,
            introduced_lines: vec![1, 2],
            line_evidence_truncated: false,
        };
        let event = trusted_project_file_change_event(&metadata, "call-1", &change, true, 4, 100);

        assert_eq!(event["type"], "file.changed");
        assert_eq!(event["relativePath"], "queries/report.sql");
        assert_eq!(event["operation"], "created");
        assert_eq!(event["revision"], "a".repeat(64));
        assert_eq!(event["previousRevision"], Value::Null);
        assert_eq!(event["originalContent"], "");
        assert_eq!(event["appliedContent"], "select 1;\nselect 2;");
        assert_eq!(event["additions"], 2);
        assert_eq!(event["deletions"], 0);
        assert_eq!(event["reviewable"], true);
        assert!(event.get("absolutePath").is_none());
        assert!(!valid_agent_event_shape(
            "file.changed",
            event.as_object().unwrap()
        ));
    }

    #[test]
    fn model_usage_event_requires_positive_calls_and_nonnegative_tokens() {
        let valid = json!({
            "calls": 2,
            "inputTokens": 1200,
            "outputTokens": 300,
            "totalTokens": 1500
        });
        assert!(valid_agent_event_shape(
            "model.usage",
            valid.as_object().unwrap()
        ));
        let zero_calls = json!({
            "calls": 0,
            "inputTokens": 1200,
            "outputTokens": 300,
            "totalTokens": 1500
        });
        assert!(!valid_agent_event_shape(
            "model.usage",
            zero_calls.as_object().unwrap()
        ));
    }

    #[test]
    fn context_metrics_accumulate_without_losing_the_latest_compaction() {
        let mut metrics = AgentContextMetrics {
            project_id: "project".to_string(),
            ..AgentContextMetrics::default()
        };
        apply_context_metrics_update(
            &mut metrics,
            ContextMetricsUpdate::Compaction {
                input_tokens: 2_000,
                retained_tokens: 700,
                offloaded_artifacts: 2,
            },
            100,
        );
        apply_context_metrics_update(
            &mut metrics,
            ContextMetricsUpdate::ModelUsage {
                calls: 2,
                input_tokens: 1_200,
                output_tokens: 300,
                total_tokens: 1_500,
            },
            101,
        );
        apply_context_metrics_update(
            &mut metrics,
            ContextMetricsUpdate::Compaction {
                input_tokens: 3_000,
                retained_tokens: 900,
                offloaded_artifacts: 1,
            },
            102,
        );

        assert_eq!(
            metrics.compaction,
            Some(AgentContextCompactionMetrics {
                count: 2,
                last_input_tokens: 3_000,
                last_retained_tokens: 900,
                offloaded_artifacts: 3,
            })
        );
        assert_eq!(
            metrics.model_usage,
            Some(AgentModelUsageMetrics {
                calls: 2,
                input_tokens: 1_200,
                output_tokens: 300,
                total_tokens: 1_500,
            })
        );
        assert_eq!(metrics.updated_at, 102);
    }

    #[test]
    fn artifact_search_is_bounded_and_keeps_utf8_snippets_valid() {
        let content = r#"{"rows":[{"name":"Alpha 中文"},{"name":"alpha"},{"name":"ALPHA"}]}"#;
        let (matches, truncated) = search_artifact_text(content, "alpha", 2, 16);
        assert_eq!(matches.len(), 2);
        assert!(truncated);
        assert_eq!(matches[0].offset, 18);
        assert!(matches.iter().all(|value| !value.snippet.is_empty()));

        let (unicode_matches, unicode_truncated) = search_artifact_text(content, "中文", 8, 16);
        assert_eq!(unicode_matches.len(), 1);
        assert!(!unicode_truncated);
        assert!(unicode_matches[0].snippet.contains("中文"));
    }

    #[test]
    fn artifact_ranges_and_export_names_are_utf8_safe() {
        let content = "{\n  \"name\": \"Alpha 中文\",\n  \"active\": true\n}";
        let (offset, next_offset, range) = artifact_text_range(content, 17, 8);
        assert!(content.is_char_boundary(offset));
        assert!(content.is_char_boundary(next_offset));
        assert_eq!(range, &content[offset..next_offset]);
        assert_eq!(
            artifact_export_file_name(Some("../../Results 2026"), "ignored"),
            "Results-2026.json"
        );
        assert_eq!(
            artifact_export_file_name(None, "tool-result-safe"),
            "tool-result-safe.json"
        );
    }

    #[test]
    fn hitl_resume_requires_an_explicit_true_response() {
        assert!(sidecar_resumed(&json!({"resumed": true})));
        assert!(!sidecar_resumed(&json!({"resumed": false})));
        assert!(!sidecar_resumed(&json!({})));
        assert!(!sidecar_resumed(&json!({"resumed": "true"})));
    }

    #[test]
    fn caller_cannot_smuggle_an_approved_boolean_into_tool_request() {
        let value = json!({
            "requestId":"request",
            "threadId":"thread",
            "turnId":"turn",
            "contextVersion":"context",
            "deadline": now_millis() + 10_000,
            "callId":"call",
            "toolName":"query.runMutation",
            "input":{},
            "inputDigest":input_digest(&json!({})),
            "approved":true
        });
        // Serde ignores the field, and authorization still depends exclusively on a host lease.
        let parsed: ToolInvokeRequest = serde_json::from_value(value).unwrap();
        assert!(parsed.approval_lease.is_none());
    }

    #[test]
    fn connection_url_builder_encodes_credentials_without_logging_them() {
        let config = ConfigSavedConnection {
            id: "connection".to_string(),
            project_id: "project".to_string(),
            name: "Postgres".to_string(),
            driver: "postgres".to_string(),
            driver_package_version: None,
            url: String::new(),
            host: Some("db.internal".to_string()),
            port: Some(5432),
            user: Some("user@example.com".to_string()),
            password: Some("p@ss/word".to_string()),
            database: Some("app data".to_string()),
            connection_url: None,
            ssl_mode: Some("require".to_string()),
            index_grouping_pattern: None,
            ssh_tunnel: None,
            tags: None,
            note: None,
            icon: None,
            color: None,
            environment: Default::default(),
            production_databases: Vec::new(),
        };
        let capabilities = database_capabilities_for_driver("postgres").unwrap();
        let url = connection_url_from_config(&capabilities, &config).unwrap();
        assert!(url.starts_with("postgres://user%40example.com:p%40ss%2Fword@db.internal:5432/"));
        assert!(url.contains("app%20data"));
        assert!(url.contains("sslmode=require"));
    }

    #[test]
    fn sqlite_connection_url_uses_file_target_without_a_network_host() {
        let config = ConfigSavedConnection {
            id: "connection".to_string(),
            project_id: "project".to_string(),
            name: "SQLite".to_string(),
            driver: "sqlite".to_string(),
            driver_package_version: None,
            url: "sqlite:///tmp/workspace.db".to_string(),
            host: None,
            port: None,
            user: None,
            password: None,
            database: None,
            connection_url: None,
            ssl_mode: None,
            index_grouping_pattern: None,
            ssh_tunnel: None,
            tags: None,
            note: None,
            icon: None,
            color: None,
            environment: Default::default(),
            production_databases: Vec::new(),
        };
        assert_eq!(
            connection_url_from_config(
                &database_capabilities_for_driver("sqlite").unwrap(),
                &config,
            )
            .unwrap(),
            "sqlite:///tmp/workspace.db"
        );
    }

    #[test]
    fn read_only_wrapper_and_row_limit_are_backend_enforced() {
        assert_eq!(
            read_only_transaction_script(DatabaseKind::Postgres, "SELECT 1"),
            "BEGIN READ ONLY;\nSELECT 1\n;\nROLLBACK;"
        );
        let mut results = vec![
            QueryResult::rows(vec![], vec![vec![json!(1)], vec![json!(2)]]),
            QueryResult::rows(vec![], vec![vec![json!(3)], vec![json!(4)]]),
        ];
        truncate_query_rows(&mut results, 3);
        assert_eq!(results[0].rows.len(), 2);
        assert_eq!(results[1].rows.len(), 1);
    }

    #[test]
    fn approved_query_review_requires_one_mutation_and_blocks_transaction_control() {
        let update = review_approved_query_input(
            "postgres",
            Some(StatementScanDialect::Postgres),
            "UPDATE accounts SET active = false WHERE id = 7",
            "connection",
        )
        .unwrap();
        assert_eq!(update.operation_type, "UPDATE");
        assert!(!update.destructive);
        assert!(update.confirmation_phrase.is_none());

        let drop = review_approved_query_input(
            "postgres",
            Some(StatementScanDialect::Postgres),
            "DROP TABLE obsolete_accounts",
            "connection",
        )
        .unwrap();
        assert!(drop.destructive);
        assert_eq!(drop.confirmation_phrase.as_deref(), Some("EXECUTE DROP"));

        for forbidden in [
            "SELECT * FROM accounts",
            "BEGIN",
            "COMMIT",
            "UPDATE accounts SET active = false; DELETE FROM accounts",
        ] {
            assert!(review_approved_query_input(
                "postgres",
                Some(StatementScanDialect::Postgres),
                forbidden,
                "connection",
            )
            .is_err());
        }
    }

    #[test]
    fn approved_native_review_rejects_batches_and_session_controls() {
        assert!(review_approved_query_input("redis", None, "SET flag 1", "redis").is_ok());
        assert!(review_approved_query_input("redis", None, "MULTI", "redis").is_err());
        assert!(review_approved_query_input("redis", None, "SET a 1; SET b 2", "redis").is_err());

        let mongo = review_approved_query_input(
            "mongodb",
            None,
            r#"{"deleteOne":{"filter":{"id":1}},"collection":"users"}"#,
            "mongo",
        )
        .unwrap();
        assert!(mongo.destructive);
        assert!(review_approved_query_input(
            "mongodb",
            None,
            r#"{"commitTransaction":1}"#,
            "mongo",
        )
        .is_err());

        assert!(
            review_approved_query_input("elasticsearch", None, "DELETE users/_doc/1", "elastic",)
                .unwrap()
                .destructive
        );
        assert!(review_approved_query_input(
            "elasticsearch",
            None,
            "PUT users/_doc/1\n{}\nDELETE users/_doc/2",
            "elastic",
        )
        .is_err());
    }

    #[test]
    fn approval_fields_are_rejected_recursively() {
        assert!(contains_approval_claim(&json!({"approved":true})));
        assert!(contains_approval_claim(
            &json!({"meta":{"approvalLease":"caller"}})
        ));
        assert!(!contains_approval_claim(
            &json!({"query":"UPDATE t SET approved = true"})
        ));
    }
}
