use super::identity_helpers::expected_graph_thread_id;
use crate::agent::protocol::AgentProfile;
use crate::agent::protocol::AgentToolManifestEntry;
use crate::agent::protocol::AgentTurnRequest;
use crate::agent::protocol::RequestMetadata;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;
use std::time::Instant;

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub(super) struct TurnKey {
    pub(super) thread_id: String,
    pub(super) turn_id: String,
}

/// Streaming providers can produce dozens of answer events per second. Each
/// Tauri emission serializes JSON and crosses the WebView IPC boundary, so
/// coalesce only consecutive answer deltas while keeping interaction events
/// ordered and visually responsive.
pub(super) const AGENT_DELTA_EMIT_INTERVAL: Duration = Duration::from_millis(100);
pub(super) const MAX_AGENT_DELTA_BATCH_BYTES: usize = 64 * 1024;

#[derive(Default)]
pub(super) struct AgentEventDeltaBatch {
    pub(super) pending: Option<Value>,
    pub(super) last_emit: Option<Instant>,
}

impl AgentEventDeltaBatch {
    pub(super) fn push(&mut self, event: Value, now: Instant) -> Option<Value> {
        if let Some(pending) = self.pending.as_mut() {
            merge_answer_delta_event(pending, event);
        } else {
            self.pending = Some(event);
        }
        let reached_size_limit = self
            .pending
            .as_ref()
            .and_then(|event| event.get("content"))
            .and_then(Value::as_str)
            .is_some_and(|content| content.len() >= MAX_AGENT_DELTA_BATCH_BYTES);
        if reached_size_limit
            || self
                .last_emit
                .is_none_or(|last_emit| now.duration_since(last_emit) >= AGENT_DELTA_EMIT_INTERVAL)
        {
            return self.flush(now);
        }
        None
    }

    pub(super) fn flush(&mut self, now: Instant) -> Option<Value> {
        let pending = self.pending.take();
        if pending.is_some() {
            self.last_emit = Some(now);
        }
        pending
    }
}

pub(super) fn is_batchable_answer_delta(event: &Value) -> bool {
    event.get("type").and_then(Value::as_str) == Some("answer.delta")
        && event.get("content").and_then(Value::as_str).is_some()
        && event.get("reset").and_then(Value::as_bool).is_some()
}

/// Preserve the exact reducer semantics of a sequence of answer deltas. A
/// reset discards unflushed content; appends concatenate after either a reset
/// or another append. Metadata comes from the newest event so stale sequence
/// filtering continues to work after intermediate sequences are coalesced.
pub(super) fn merge_answer_delta_event(pending: &mut Value, next: Value) {
    let Some(next_object) = next.as_object() else {
        *pending = next;
        return;
    };
    let Some(next_content) = next_object.get("content").and_then(Value::as_str) else {
        *pending = next;
        return;
    };
    let Some(next_reset) = next_object.get("reset").and_then(Value::as_bool) else {
        *pending = next;
        return;
    };
    if next_reset {
        *pending = next;
        return;
    }
    let Some(pending_object) = pending.as_object() else {
        *pending = next;
        return;
    };
    let Some(pending_content) = pending_object.get("content").and_then(Value::as_str) else {
        *pending = next;
        return;
    };
    let pending_reset = pending_object
        .get("reset")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let merged_content = format!("{pending_content}{next_content}");
    *pending = next;
    if let Some(object) = pending.as_object_mut() {
        object.insert("content".to_string(), Value::String(merged_content));
        object.insert("reset".to_string(), Value::Bool(pending_reset));
    }
}

pub(super) const MAX_TURN_JOURNAL_EVENTS: usize = 160;
pub(super) const MAX_TURN_JOURNAL_EVENT_BYTES: usize = 24 * 1024;

#[derive(Default)]
pub(super) struct TurnJournalBuffer {
    pub(super) events: Vec<Value>,
    pub(super) truncated: bool,
}

#[derive(Clone)]
pub(super) struct ActiveTurn {
    pub(super) project_id: String,
    pub(super) profile: AgentProfile,
    pub(super) checkpoint_thread_id: String,
    pub(super) context_version: String,
    pub(super) prompt: String,
    pub(super) active_tab: Option<Value>,
    pub(super) tab_connection_id: Option<String>,
    pub(super) tab_namespace: Option<String>,
    pub(super) connection_id: Option<String>,
    pub(super) database: Option<String>,
    pub(super) namespace: Option<String>,
    pub(super) deadline: i64,
    pub(super) tools: HashMap<String, AgentToolManifestEntry>,
}

impl TurnKey {
    pub(super) fn from_metadata(metadata: &RequestMetadata) -> Self {
        Self {
            thread_id: metadata.thread_id.clone(),
            turn_id: metadata.turn_id.clone(),
        }
    }
}

impl ActiveTurn {
    pub(super) fn from_request(request: &AgentTurnRequest) -> Self {
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
