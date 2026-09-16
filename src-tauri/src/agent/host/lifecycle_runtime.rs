use super::conversation_helpers::validate_project_id;
use super::identity_helpers::bounded_text;
use super::process_helpers::find_agent_launch;
use super::session_state::{AgentHostInner, LifecycleState};
use super::tool_manifest::installed_host_tool_names;
use crate::agent::protocol::AgentHostStatus;
use crate::agent::protocol::AgentProjectStateCleared;
use crate::agent::protocol::AGENT_HOST_PROTOCOL_VERSION;
use anyhow::anyhow;
use anyhow::Result;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

impl AgentHostInner {
    pub(super) async fn status(&self) -> AgentHostStatus {
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

    pub(super) async fn prewarm(self: &Arc<Self>) {
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

    pub(super) fn start_cleanup_task(self: &Arc<Self>) {
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

    pub(super) async fn clear_project_state(
        &self,
        project_id: &str,
    ) -> Result<AgentProjectStateCleared> {
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
}
