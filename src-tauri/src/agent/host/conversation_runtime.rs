use super::conversation_helpers::{
    conversation_belongs_to_scope, conversation_snapshot_store_key, conversation_summary_title,
    validate_conversation_id, validate_project_id, CONTEXT_METRICS_THREAD_ID,
    MAX_CONVERSATION_RESUME_REQUESTS, MAX_CONVERSATION_SNAPSHOT_BYTES, MAX_CONVERSATION_TURNS,
};
use super::identity_helpers::now_millis;
use super::metrics_helpers::apply_context_metrics_update;
use super::metrics_types::ContextMetricsUpdate;
use super::session_state::AgentHostInner;
use crate::agent::protocol::AgentContextMetrics;
use crate::agent::protocol::AgentConversationSnapshot;
use crate::agent::protocol::AgentConversationSnapshotSaveRequest;
use crate::agent::protocol::AgentConversationSummary;
use crate::agent::protocol::AgentTurnRequest;
use anyhow::anyhow;
use anyhow::Context;
use anyhow::Result;
use serde_json::Value;

impl AgentHostInner {
    pub(super) async fn load_context_metrics(
        &self,
        project_id: &str,
    ) -> Result<AgentContextMetrics> {
        validate_project_id(project_id)?;
        let _guard = self.context_metrics_lock.lock().await;
        self.load_context_metrics_unlocked(project_id).await
    }

    pub(super) async fn save_conversation_snapshot(
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

    pub(super) async fn load_conversation_snapshot(
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

    pub(super) async fn list_conversation_snapshots(
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

    pub(super) async fn load_context_metrics_unlocked(
        &self,
        project_id: &str,
    ) -> Result<AgentContextMetrics> {
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

    pub(super) async fn record_context_metrics(
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
}
