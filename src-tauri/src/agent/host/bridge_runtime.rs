use super::approval_types::{
    command_preflight_cache_key, ApprovalOrigin, BridgeApprovalDecision, PendingApproval,
    PendingCommandPreflight, MAX_HUMAN_RESUME_MILLIS,
};
use super::approved_query_review::{mutation_policy_digest, required_input_text};
use super::host_errors::SidecarRequestError;
use super::identity_helpers::{
    bounded_text, contains_approval_claim, ensure_not_expired, input_digest, now_millis,
    random_token,
};
use super::query_result::tool_requires_approval;
use super::session_state::AgentHostInner;
use super::tool_manifest::RustHostTool;
use super::turn_state::{ActiveTurn, TurnKey};
use crate::agent::protocol::AgentProfile;
use crate::agent::protocol::AgentToolManifestEntry;
use crate::agent::protocol::RequestMetadata;
use crate::agent::protocol::ToolInvokeRequest;
use crate::agent::shell::CommandPolicyDecision;
use anyhow::anyhow;
use anyhow::Result;
use serde_json::json;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;

impl AgentHostInner {
    pub(super) async fn validate_active(&self, metadata: &RequestMetadata) -> Result<ActiveTurn> {
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

    pub(super) async fn private_bridge_tools(
        &self,
        metadata: &RequestMetadata,
    ) -> Result<Vec<AgentToolManifestEntry>> {
        let turn = self.validate_active(metadata).await?;
        let mut tools = turn.tools.into_values().collect::<Vec<_>>();
        tools.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(tools)
    }

    pub(super) async fn invoke_private_bridge_tool(
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
    pub(super) async fn emit_private_bridge_approval(
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
        self.emit_webview_agent_event(&key, event).await;
    }

    pub(super) async fn extend_active_deadline(
        &self,
        metadata: &RequestMetadata,
    ) -> Result<ActiveTurn> {
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

    pub(super) async fn graph_resume_params(
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
}
