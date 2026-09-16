use super::approval_types::{
    ApprovalGrant, BridgeApprovalDecision, PendingApproval, PendingClarification,
    PendingCommandPreflight,
};
use super::connection_types::ConnectedAgentTarget;
use super::host_errors::HostCallError;
use super::review_types::MutationTurnState;
use super::turn_state::{ActiveTurn, AgentEventDeltaBatch, TurnJournalBuffer, TurnKey};
use crate::agent::model::ModelGateway;
use crate::agent::protocol::AgentProviderConfig;
use crate::agent::store::AgentStore;
use crate::core::manager::ConnectionManager;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::process::Child;
use tokio::process::ChildStdin;
use tokio::sync::oneshot;
use tokio::sync::watch;
use tokio::sync::Mutex;
use tokio::sync::RwLock;

pub(super) struct AgentHostInner {
    pub(super) app: AppHandle,
    pub(super) store: AgentStore,
    pub(super) model: std::result::Result<ModelGateway, String>,
    pub(super) lifecycle: RwLock<Lifecycle>,
    pub(super) process: RwLock<Option<Arc<HostProcess>>>,
    pub(super) start_lock: Mutex<()>,
    pub(super) turn_transition_lock: Mutex<()>,
    pub(super) pending: Mutex<HashMap<String, PendingResponse>>,
    pub(super) inbound_cancellations: Mutex<HashMap<String, InboundCancellation>>,
    pub(super) providers: RwLock<HashMap<TurnKey, AgentProviderConfig>>,
    pub(super) turns: RwLock<HashMap<TurnKey, ActiveTurn>>,
    pub(super) cli_turns: Mutex<HashMap<TurnKey, CliTurnHandle>>,
    pub(super) event_sequences: RwLock<HashMap<TurnKey, u64>>,
    pub(super) event_delta_batches: Mutex<HashMap<TurnKey, AgentEventDeltaBatch>>,
    pub(super) turn_journals: RwLock<HashMap<TurnKey, TurnJournalBuffer>>,
    pub(super) clarifications: RwLock<HashMap<String, PendingClarification>>,
    pub(super) approvals: RwLock<HashMap<String, PendingApproval>>,
    pub(super) approval_waiters: Mutex<HashMap<String, oneshot::Sender<BridgeApprovalDecision>>>,
    pub(super) leases: RwLock<HashMap<String, ApprovalGrant>>,
    pub(super) command_preflights: RwLock<HashMap<String, PendingCommandPreflight>>,
    pub(super) agent_connections: ConnectionManager,
    pub(super) connected_targets: RwLock<HashMap<String, ConnectedAgentTarget>>,
    pub(super) mutation_connections: ConnectionManager,
    pub(super) connected_mutation_targets: RwLock<HashMap<String, ConnectedAgentTarget>>,
    pub(super) mutation_turn_states: RwLock<HashMap<TurnKey, MutationTurnState>>,
    pub(super) connection_lock: Mutex<()>,
    pub(super) mutation_connection_lock: Mutex<()>,
    pub(super) context_metrics_lock: Mutex<()>,
    pub(super) cleanup_started: AtomicBool,
    pub(super) next_request_id: AtomicU64,
    pub(super) next_generation: AtomicU64,
}

pub(super) struct HostProcess {
    pub(super) generation: u64,
    pub(super) writer: Mutex<ChildStdin>,
    // Retaining Child makes kill_on_drop effective when a failed generation is replaced.
    pub(super) _child: Mutex<Child>,
    pub(super) binary_path: PathBuf,
}

#[derive(Clone)]
pub(super) struct CliTurnHandle {
    pub(super) generation: u64,
    pub(super) cancellation: watch::Sender<bool>,
}

#[derive(Clone)]
pub(super) struct AgentLaunch {
    pub(super) program: PathBuf,
    pub(super) arguments: Vec<PathBuf>,
    pub(super) display_path: PathBuf,
}

pub(super) struct PendingResponse {
    pub(super) generation: u64,
    pub(super) sender: oneshot::Sender<std::result::Result<Value, HostCallError>>,
}

pub(super) struct InboundCancellation {
    pub(super) generation: u64,
    pub(super) sender: watch::Sender<bool>,
}

#[derive(Debug, Clone)]
pub(super) struct Lifecycle {
    pub(super) state: LifecycleState,
    pub(super) capabilities: Vec<String>,
    pub(super) binary_path: Option<PathBuf>,
    pub(super) last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LifecycleState {
    Stopped,
    Starting,
    Ready,
    Unavailable,
    Crashed,
}

impl LifecycleState {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Stopped => "stopped",
            Self::Starting => "starting",
            Self::Ready => "ready",
            Self::Unavailable => "unavailable",
            Self::Crashed => "crashed",
        }
    }
}
