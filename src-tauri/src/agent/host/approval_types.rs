use super::turn_state::TurnKey;
use crate::agent::shell::CommandPreflightResult;

pub(super) const APPROVAL_LEASE_BYTES: usize = 32;
pub(super) const MAX_HUMAN_RESUME_MILLIS: i64 = 2 * 60 * 60 * 1_000;

pub(super) struct PendingClarification {
    pub(super) key: TurnKey,
    pub(super) expires_at: i64,
}

#[derive(Clone)]
pub(super) struct PendingApproval {
    pub(super) key: TurnKey,
    pub(super) call_id: String,
    pub(super) input_digest: String,
    pub(super) tool_name: String,
    pub(super) policy_digest: Option<String>,
    pub(super) confirmation_phrase: Option<String>,
    pub(super) origin: ApprovalOrigin,
    pub(super) expires_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ApprovalOrigin {
    Sidecar,
    PrivateBridge,
}

pub(super) enum BridgeApprovalDecision {
    Approved(String),
    Rejected,
}

pub(super) struct ApprovalGrant {
    pub(super) key: TurnKey,
    pub(super) call_id: String,
    pub(super) input_digest: String,
    pub(super) tool_name: String,
    pub(super) policy_digest: Option<String>,
    pub(super) expires_at: i64,
}

#[derive(Clone)]
pub(super) struct PendingCommandPreflight {
    pub(super) key: TurnKey,
    pub(super) call_id: String,
    pub(super) input_digest: String,
    pub(super) tool_name: String,
    pub(super) result: CommandPreflightResult,
    pub(super) expires_at: i64,
}

pub(super) fn command_preflight_cache_key(
    key: &TurnKey,
    call_id: &str,
    policy_digest: &str,
) -> String {
    format!(
        "{}\0{}\0{}\0{}",
        key.thread_id, key.turn_id, call_id, policy_digest
    )
}
