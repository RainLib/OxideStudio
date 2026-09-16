use super::identity_helpers::now_millis;
use super::manager::AgentHostManager;
use super::metrics_types::ContextMetricsUpdate;
use super::review_types::MutationTurnState;
use super::session_state::{AgentHostInner, CliTurnHandle};
use super::turn_state::{is_batchable_answer_delta, TurnKey};
use crate::agent::protocol::AgentProviderConfig;
use crate::agent::protocol::AgentTurnRequest;
use crate::agent::protocol::RequestMetadata;
use crate::agent::protocol::AGENT_HOST_EVENT_CHANNEL;
use crate::ai_cli::agent::classify_cli_error;
use crate::ai_cli::agent::prepare_cli_run;
use crate::ai_cli::agent::CliAgentError;
use crate::ai_cli::agent::CliAgentEvent;
use crate::ai_cli::agent::CliAgentEventParser;
use crate::ai_cli::CliProviderKind;
use anyhow::anyhow;
use anyhow::Context;
use anyhow::Result;
use serde_json::json;
use serde_json::Value;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::mpsc;
use tokio::sync::watch;

impl AgentHostInner {
    pub(super) async fn launch_cli_turn(
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
    pub(super) async fn run_cli_turn(
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

    pub(super) async fn cli_generation_is_current(&self, key: &TurnKey, generation: u64) -> bool {
        self.cli_turns
            .lock()
            .await
            .get(key)
            .is_some_and(|handle| handle.generation == generation)
    }

    pub(super) async fn emit_cli_failure(
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

    pub(super) async fn emit_cli_event(
        &self,
        key: &TurnKey,
        metadata: &RequestMetadata,
        event_type: &str,
        payload: Value,
    ) {
        self.emit_cli_event_at(key, metadata, event_type, payload, now_millis())
            .await;
    }

    pub(super) async fn emit_webview_agent_event(&self, key: &TurnKey, event: Value) {
        let now = Instant::now();
        let mut batches = self.event_delta_batches.lock().await;
        let mut events = Vec::with_capacity(2);
        if is_batchable_answer_delta(&event) {
            if let Some(event) = batches.entry(key.clone()).or_default().push(event, now) {
                events.push(event);
            }
        } else {
            if let Some(event) = batches.entry(key.clone()).or_default().flush(now) {
                events.push(event);
            }
            events.push(event);
        }
        // AppHandle::emit is synchronous. Keep the batch lock through these
        // emissions so concurrent private-bridge and provider events cannot
        // overtake the delta they are required to flush.
        for event in events {
            if let Err(error) = self.app.emit(AGENT_HOST_EVENT_CHANNEL, event) {
                tracing::warn!("failed to emit agent event: {error}");
            }
        }
    }

    pub(super) async fn flush_webview_agent_event(&self, key: &TurnKey) {
        let event = self
            .event_delta_batches
            .lock()
            .await
            .remove(key)
            .and_then(|mut batch| batch.flush(Instant::now()));
        if let Some(event) = event {
            if let Err(error) = self.app.emit(AGENT_HOST_EVENT_CHANNEL, event) {
                tracing::warn!("failed to flush agent answer delta: {error}");
            }
        }
    }

    pub(super) async fn emit_cli_event_at(
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
        self.emit_webview_agent_event(key, Value::Object(event))
            .await;
    }
}
