use super::approval_types::{
    command_preflight_cache_key, ApprovalOrigin, PendingApproval, PendingClarification,
};
use super::event_projection::valid_agent_event_shape;
use super::host_errors::HostCallError;
use super::identity_helpers::{bounded_text, constant_time_text_eq, normalized_digest, now_millis};
use super::metrics_helpers::context_metrics_update;
use super::session_state::{AgentHostInner, Lifecycle, LifecycleState};
use super::tool_manifest::RustHostTool;
use super::turn_state::{TurnKey, MAX_TURN_JOURNAL_EVENTS, MAX_TURN_JOURNAL_EVENT_BYTES};
use crate::agent::protocol::AgentTurnJournal;
use crate::agent::shell::CommandPolicyDecision;
use anyhow::anyhow;
use anyhow::Result;
use serde_json::json;
use serde_json::Value;
use std::path::PathBuf;

impl AgentHostInner {
    pub(super) async fn handle_agent_event(&self, mut event: Value) {
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
        self.emit_webview_agent_event(&key, event.clone()).await;

        if terminal {
            self.clear_turn(&key).await;
        }
    }

    pub(super) async fn consume_approval_lease(
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

    pub(super) async fn persist_turn_journal_event(
        &self,
        key: &TurnKey,
        project_id: &str,
        event: &Value,
    ) {
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

    pub(super) async fn clear_turn(&self, key: &TurnKey) {
        self.flush_webview_agent_event(key).await;
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

    pub(super) async fn reset_failed_generation(&self, generation: Option<u64>, message: &str) {
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

    pub(super) async fn set_lifecycle(
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
