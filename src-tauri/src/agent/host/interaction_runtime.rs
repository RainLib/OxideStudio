use super::approval_types::{
    ApprovalGrant, ApprovalOrigin, BridgeApprovalDecision, PendingApproval, APPROVAL_LEASE_BYTES,
};
use super::checkpoint_helpers::sidecar_resumed;
use super::identity_helpers::{now_millis, random_token};
use super::session_state::AgentHostInner;
use super::turn_state::TurnKey;
use crate::agent::protocol::AgentActionAccepted;
use crate::agent::protocol::AgentAnswerClarificationRequest;
use crate::agent::protocol::AgentApproveActionRequest;
use crate::agent::protocol::AgentCancelTurnRequest;
use crate::agent::protocol::ApprovalDecision;
use crate::agent::protocol::HOST_CANCEL_TURN_METHOD;
use crate::agent::protocol::HOST_RESUME_TURN_METHOD;
use anyhow::anyhow;
use anyhow::Result;
use serde_json::json;
use std::sync::Arc;

impl AgentHostInner {
    pub(super) async fn cancel_turn(
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

    pub(super) async fn answer_clarification(
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

    pub(super) async fn approve_action(
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
}
