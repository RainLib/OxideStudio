use super::identity_helpers::{ensure_not_expired, now_millis};
use super::session_state::AgentHostInner;
use super::tool_manifest::validate_host_tool_manifest;
use super::turn_state::{ActiveTurn, TurnKey};
use crate::agent::protocol::AgentProviderKind;
use crate::agent::protocol::AgentTurnAccepted;
use crate::agent::protocol::AgentTurnRequest;
use crate::agent::protocol::HOST_RESUME_TURN_METHOD;
use crate::agent::protocol::HOST_START_TURN_METHOD;
use crate::core::provider_headers::load_provider_headers;
use crate::core::provider_secret::load_scoped_provider_secret;
use anyhow::anyhow;
use anyhow::Context;
use anyhow::Result;
use serde_json::json;
use std::sync::Arc;

impl AgentHostInner {
    pub(super) async fn start_or_resume(
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
            match load_scoped_provider_secret(&self.app, "assistant", &provider.base_url).await {
                Ok(Some(secret)) => provider.api_key = Some(secret),
                Ok(None) => {}
                Err(error) => {
                    return Err(error.context("failed to load the AI provider credential"));
                }
            }
        }
        if provider.kind == crate::agent::protocol::AgentProviderKind::OpenaiCompatible {
            provider.custom_headers =
                load_provider_headers(&self.app, "assistant", &provider.base_url)
                    .await
                    .context("failed to load the AI provider headers")?;
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
}
