use super::event_projection::trusted_project_file_change_event;
use super::host_errors::SidecarRequestError;
use super::identity_helpers::{bounded_text, now_millis};
use super::session_state::AgentHostInner;
use super::turn_state::TurnKey;
use crate::agent::protocol::rpc_notification;
use crate::agent::protocol::ModelCompleteRequest;
use crate::agent::protocol::ModelStreamRequest;
use crate::agent::protocol::RequestMetadata;
use crate::agent::protocol::HOST_MODEL_CHUNK_METHOD;
use anyhow::anyhow;
use serde_json::json;
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::sync::watch;

impl AgentHostInner {
    pub(super) async fn handle_model_complete(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: ModelCompleteRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        self.validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        let key = TurnKey::from_metadata(&request.metadata);
        let provider = self
            .providers
            .read()
            .await
            .get(&key)
            .cloned()
            .ok_or_else(|| {
                SidecarRequestError::security(anyhow!("model provider is unavailable"))
            })?;
        let model = self.model.as_ref().map_err(|error| SidecarRequestError {
            code: -32_040,
            message: error.clone(),
            data: Some(json!({"kind":"model_proxy_unavailable","recoverable":true})),
        })?;
        model
            .complete(&provider, &request)
            .await
            .map_err(|error| SidecarRequestError {
                code: -32_041,
                message: bounded_text(&error.to_string(), 2_000),
                data: Some(json!({"kind":"model_request_failed","recoverable":true})),
            })
    }

    pub(super) async fn handle_model_stream(
        &self,
        generation: u64,
        params: Value,
        cancellation: watch::Receiver<bool>,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let stream_request: ModelStreamRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        if stream_request.stream_id.trim().is_empty()
            || stream_request.stream_id.chars().count() > 240
        {
            return Err(SidecarRequestError::invalid_params(
                "streamId must contain 1 to 240 characters".to_string(),
            ));
        }
        let request = stream_request.request;
        self.validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        let key = TurnKey::from_metadata(&request.metadata);
        let provider = self
            .providers
            .read()
            .await
            .get(&key)
            .cloned()
            .ok_or_else(|| {
                SidecarRequestError::security(anyhow!("model provider is unavailable"))
            })?;
        let model = self.model.as_ref().map_err(|error| SidecarRequestError {
            code: -32_040,
            message: error.clone(),
            data: Some(json!({"kind":"model_proxy_unavailable","recoverable":true})),
        })?;
        let stream_id = stream_request.stream_id;
        let (chunk_sender, mut chunk_receiver) = mpsc::channel(32);
        let stream = model.stream(&provider, &request, chunk_sender, cancellation);
        tokio::pin!(stream);
        let mut sequence = 0u64;
        let mut chunk_channel_open = true;

        let final_response = loop {
            tokio::select! {
                biased;
                chunk = chunk_receiver.recv(), if chunk_channel_open => {
                    match chunk {
                        Some(chunk) => {
                            self.emit_model_chunk(
                                generation,
                                &request.metadata,
                                &stream_id,
                                sequence,
                                chunk,
                                false,
                            ).await;
                            sequence = sequence.saturating_add(1);
                        }
                        None => chunk_channel_open = false,
                    }
                }
                result = &mut stream => break result,
            }
        }
        .map_err(|error| SidecarRequestError {
            code: if error.to_string().contains("cancelled") {
                -32_008
            } else {
                -32_042
            },
            message: bounded_text(&error.to_string(), 2_000),
            data: Some(json!({
                "kind":if error.to_string().contains("cancelled") {
                    "model_stream_cancelled"
                } else {
                    "model_stream_failed"
                },
                "recoverable":true,
            })),
        })?;
        while let Ok(chunk) = chunk_receiver.try_recv() {
            self.emit_model_chunk(
                generation,
                &request.metadata,
                &stream_id,
                sequence,
                chunk,
                false,
            )
            .await;
            sequence = sequence.saturating_add(1);
        }
        self.emit_model_chunk(
            generation,
            &request.metadata,
            &stream_id,
            sequence,
            json!({
                "delta":"",
                "toolCalls":[],
                "usage":final_response.get("usage").cloned().unwrap_or(Value::Null),
                "finishReason":final_response.get("finishReason").cloned().unwrap_or(Value::Null),
            }),
            true,
        )
        .await;
        Ok(final_response)
    }

    pub(super) async fn emit_model_chunk(
        &self,
        generation: u64,
        metadata: &RequestMetadata,
        stream_id: &str,
        sequence: u64,
        chunk: Value,
        done: bool,
    ) {
        let mut params = json!({
            "requestId":metadata.request_id,
            "threadId":metadata.thread_id,
            "turnId":metadata.turn_id,
            "contextVersion":metadata.context_version,
            "deadline":metadata.deadline,
            "streamId":stream_id,
            "sequence":sequence,
            "delta":"",
            "toolCalls":[],
            "done":done,
        });
        if let (Some(target), Some(source)) = (params.as_object_mut(), chunk.as_object()) {
            for (key, value) in source {
                target.insert(key.clone(), value.clone());
            }
        }
        self.write_response(
            generation,
            rpc_notification(HOST_MODEL_CHUNK_METHOD, params),
        )
        .await;
    }

    pub(super) async fn emit_trusted_project_file_change(
        &self,
        metadata: &RequestMetadata,
        call_id: &str,
        change: &crate::commands::project_files::ProjectFileAppliedChange,
        created: bool,
    ) {
        let key = TurnKey::from_metadata(metadata);
        let sequence = {
            let mut sequences = self.event_sequences.write().await;
            let sequence = sequences.entry(key.clone()).or_insert(0);
            *sequence = sequence.saturating_add(1);
            *sequence
        };
        let event = trusted_project_file_change_event(
            metadata,
            call_id,
            change,
            created,
            sequence,
            now_millis(),
        );
        self.emit_webview_agent_event(&key, event).await;
    }
}
