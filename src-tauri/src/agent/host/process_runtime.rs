use super::host_errors::deadline_duration;
use super::host_errors::{HostCallError, SidecarRequestError};
use super::identity_helpers::{bounded_text, now_millis};
use super::process_helpers::{
    find_agent_launch, read_sidecar_stderr, read_sidecar_stdout, validate_handshake,
    HANDSHAKE_TIMEOUT_MILLIS,
};
use super::session_state::{
    AgentHostInner, AgentLaunch, HostProcess, InboundCancellation, LifecycleState, PendingResponse,
};
use super::tool_manifest::REQUIRED_CAPABILITIES;
use crate::agent::protocol::rpc_error;
use crate::agent::protocol::rpc_id_key;
use crate::agent::protocol::rpc_notification;
use crate::agent::protocol::rpc_request;
use crate::agent::protocol::rpc_success;
use crate::agent::protocol::write_json_frame;
use crate::agent::protocol::AGENT_HOST_MAX_FRAME_BYTES;
use crate::agent::protocol::AGENT_HOST_PROTOCOL_VERSION;
use crate::agent::protocol::HOST_INITIALIZE_METHOD;
use crate::agent::protocol::SIDECAR_ARTIFACT_READ_METHOD;
use crate::agent::protocol::SIDECAR_ARTIFACT_SEARCH_METHOD;
use crate::agent::protocol::SIDECAR_CHECKPOINT_LOAD_METHOD;
use crate::agent::protocol::SIDECAR_CHECKPOINT_SAVE_METHOD;
use crate::agent::protocol::SIDECAR_EVENT_METHOD;
use crate::agent::protocol::SIDECAR_GRAPH_CHECKPOINT_DELETE_THREAD_METHOD;
use crate::agent::protocol::SIDECAR_GRAPH_CHECKPOINT_GET_METHOD;
use crate::agent::protocol::SIDECAR_GRAPH_CHECKPOINT_LIST_METHOD;
use crate::agent::protocol::SIDECAR_GRAPH_CHECKPOINT_PUT_METHOD;
use crate::agent::protocol::SIDECAR_GRAPH_CHECKPOINT_PUT_WRITES_METHOD;
use crate::agent::protocol::SIDECAR_MODEL_COMPLETE_METHOD;
use crate::agent::protocol::SIDECAR_MODEL_STREAM_METHOD;
use crate::agent::protocol::SIDECAR_TOOL_INVOKE_METHOD;
use crate::agent::protocol::SIDECAR_TOOL_PREFLIGHT_METHOD;
use serde_json::json;
use serde_json::Value;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::oneshot;
use tokio::sync::watch;
use tokio::sync::Mutex;

impl AgentHostInner {
    pub(super) async fn invoke_with_restart(
        self: &Arc<Self>,
        method: &str,
        params: Value,
        deadline: i64,
    ) -> std::result::Result<Value, HostCallError> {
        let mut restarted = false;
        loop {
            let process = match self.ensure_ready().await {
                Ok(process) => process,
                Err(error) if error.is_transport() && !restarted => {
                    restarted = true;
                    self.reset_failed_generation(None, &error.safe_message())
                        .await;
                    continue;
                }
                Err(error) => return Err(error),
            };
            match self
                .send_request_on(&process, method, params.clone(), deadline)
                .await
            {
                Err(error) if error.is_transport() && !restarted => {
                    restarted = true;
                    self.reset_failed_generation(Some(process.generation), &error.safe_message())
                        .await;
                }
                result => return result,
            }
        }
    }

    pub(super) async fn ensure_ready(
        self: &Arc<Self>,
    ) -> std::result::Result<Arc<HostProcess>, HostCallError> {
        if let Some(process) = self.ready_process().await {
            return Ok(process);
        }
        let _start_guard = self.start_lock.lock().await;
        if let Some(process) = self.ready_process().await {
            return Ok(process);
        }

        self.set_lifecycle(LifecycleState::Starting, None, None, Vec::new())
            .await;
        let launch = find_agent_launch(&self.app).ok_or_else(|| {
            HostCallError::Transport(
                "DeepAgents sidecar is not installed; AI agent features are unavailable"
                    .to_string(),
            )
        });
        let launch = match launch {
            Ok(launch) => launch,
            Err(error) => {
                self.set_lifecycle(
                    LifecycleState::Unavailable,
                    None,
                    Some(error.safe_message()),
                    Vec::new(),
                )
                .await;
                return Err(error);
            }
        };
        let display_path = launch.display_path.clone();
        let process = match self.spawn_process(launch).await {
            Ok(process) => process,
            Err(error) => {
                self.set_lifecycle(
                    LifecycleState::Unavailable,
                    Some(display_path),
                    Some(error.safe_message()),
                    Vec::new(),
                )
                .await;
                return Err(error);
            }
        };
        *self.process.write().await = Some(process.clone());

        let deadline = now_millis().saturating_add(HANDSHAKE_TIMEOUT_MILLIS);
        let params = json!({
            "protocolVersion": AGENT_HOST_PROTOCOL_VERSION,
            "appVersion": self.app.package_info().version.to_string(),
            "maxFrameBytes": AGENT_HOST_MAX_FRAME_BYTES,
            "requiredCapabilities": REQUIRED_CAPABILITIES,
        });
        let handshake = self
            .send_request_on(&process, HOST_INITIALIZE_METHOD, params, deadline)
            .await
            .and_then(validate_handshake);
        let capabilities = match handshake {
            Ok(capabilities) => capabilities,
            Err(error) => {
                self.reset_failed_generation(Some(process.generation), &error.safe_message())
                    .await;
                return Err(error);
            }
        };
        self.set_lifecycle(
            LifecycleState::Ready,
            Some(process.binary_path.clone()),
            None,
            capabilities,
        )
        .await;
        Ok(process)
    }

    pub(super) async fn ready_process(&self) -> Option<Arc<HostProcess>> {
        if self.lifecycle.read().await.state != LifecycleState::Ready {
            return None;
        }
        self.process.read().await.clone()
    }

    pub(super) async fn spawn_process(
        self: &Arc<Self>,
        launch: AgentLaunch,
    ) -> std::result::Result<Arc<HostProcess>, HostCallError> {
        let mut command = Command::new(&launch.program);
        command
            .args(&launch.arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| {
            HostCallError::Transport(format!("failed to start DeepAgents sidecar: {error}"))
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            HostCallError::Transport("DeepAgents sidecar stdin is unavailable".to_string())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            HostCallError::Transport("DeepAgents sidecar stdout is unavailable".to_string())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            HostCallError::Transport("DeepAgents sidecar stderr is unavailable".to_string())
        })?;
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let process = Arc::new(HostProcess {
            generation,
            writer: Mutex::new(stdin),
            _child: Mutex::new(child),
            binary_path: launch.display_path,
        });

        let weak = Arc::downgrade(self);
        tokio::spawn(read_sidecar_stdout(weak, generation, stdout));
        tokio::spawn(read_sidecar_stderr(stderr));
        Ok(process)
    }

    pub(super) async fn send_request_on(
        &self,
        process: &Arc<HostProcess>,
        method: &str,
        params: Value,
        deadline: i64,
    ) -> std::result::Result<Value, HostCallError> {
        let timeout = deadline_duration(deadline)?;
        let id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let id_value = Value::Number(id.into());
        let id_key = rpc_id_key(&id_value).expect("numeric request ids always have a key");
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(
            id_key.clone(),
            PendingResponse {
                generation: process.generation,
                sender,
            },
        );

        let write = {
            let mut writer = process.writer.lock().await;
            write_json_frame(&mut *writer, &rpc_request(id, method, params)).await
        };
        if let Err(error) = write {
            self.pending.lock().await.remove(&id_key);
            return Err(HostCallError::Transport(format!(
                "failed to write to DeepAgents sidecar: {error}"
            )));
        }

        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(HostCallError::Transport(
                "DeepAgents sidecar response channel closed".to_string(),
            )),
            Err(_) => {
                self.pending.lock().await.remove(&id_key);
                let cancellation = rpc_notification("$/cancelRequest", json!({"id": id_value}));
                let mut writer = process.writer.lock().await;
                let _ = write_json_frame(&mut *writer, &cancellation).await;
                Err(HostCallError::Transport(format!(
                    "DeepAgents sidecar request timed out: {method}"
                )))
            }
        }
    }

    pub(super) async fn handle_protocol_message(self: &Arc<Self>, generation: u64, message: Value) {
        if let Some(method) = message.get("method").and_then(Value::as_str) {
            let params = message.get("params").cloned().unwrap_or(Value::Null);
            if let Some(id) = message.get("id").cloned() {
                let Some(id_key) = rpc_id_key(&id) else {
                    return;
                };
                let id_key = format!("{generation}:{id_key}");
                let (cancellation_sender, cancellation) = watch::channel(false);
                self.inbound_cancellations.lock().await.insert(
                    id_key.clone(),
                    InboundCancellation {
                        generation,
                        sender: cancellation_sender,
                    },
                );
                let inner = self.clone();
                let method = method.to_string();
                tokio::spawn(async move {
                    let response = inner
                        .handle_sidecar_request(generation, &method, params, cancellation)
                        .await;
                    inner.inbound_cancellations.lock().await.remove(&id_key);
                    let frame = match response {
                        Ok(value) => rpc_success(id, value),
                        Err(error) => rpc_error(id, error.code, error.message, error.data),
                    };
                    inner.write_response(generation, frame).await;
                });
            } else if method == SIDECAR_EVENT_METHOD {
                self.handle_agent_event(params).await;
            } else if method == "$/cancelRequest" {
                if let Some(id_key) = params.get("id").and_then(rpc_id_key) {
                    let id_key = format!("{generation}:{id_key}");
                    if let Some(cancellation) = self.inbound_cancellations.lock().await.get(&id_key)
                    {
                        let _ = cancellation.sender.send(true);
                    }
                }
            }
            return;
        }

        let Some(id) = message.get("id").and_then(rpc_id_key) else {
            return;
        };
        let pending = self.pending.lock().await.remove(&id);
        let Some(pending) = pending.filter(|pending| pending.generation == generation) else {
            return;
        };
        let result = if let Some(error) = message.get("error") {
            Err(HostCallError::Remote {
                code: error.get("code").and_then(Value::as_i64).unwrap_or(-32_000),
                message: error
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|value| bounded_text(value, 2_000))
                    .unwrap_or_else(|| "DeepAgents sidecar returned an RPC error".to_string()),
            })
        } else if let Some(result) = message.get("result") {
            Ok(result.clone())
        } else {
            Err(HostCallError::Transport(
                "DeepAgents sidecar returned a malformed response".to_string(),
            ))
        };
        let _ = pending.sender.send(result);
    }

    pub(super) async fn write_response(&self, generation: u64, frame: Value) {
        let process = self.process.read().await.clone();
        let Some(process) = process.filter(|process| process.generation == generation) else {
            return;
        };
        let result = {
            let mut writer = process.writer.lock().await;
            write_json_frame(&mut *writer, &frame).await
        };
        if let Err(error) = result {
            self.reset_failed_generation(Some(generation), &error.to_string())
                .await;
        }
    }

    pub(super) async fn handle_sidecar_request(
        &self,
        generation: u64,
        method: &str,
        params: Value,
        cancellation: watch::Receiver<bool>,
    ) -> std::result::Result<Value, SidecarRequestError> {
        match method {
            SIDECAR_MODEL_COMPLETE_METHOD => self.handle_model_complete(params).await,
            SIDECAR_MODEL_STREAM_METHOD => {
                self.handle_model_stream(generation, params, cancellation)
                    .await
            }
            SIDECAR_TOOL_PREFLIGHT_METHOD => self.handle_tool_preflight(params).await,
            SIDECAR_TOOL_INVOKE_METHOD => self.handle_tool_invoke(params).await,
            SIDECAR_CHECKPOINT_LOAD_METHOD => self.handle_checkpoint_load(params).await,
            SIDECAR_CHECKPOINT_SAVE_METHOD => self.handle_checkpoint_save(params).await,
            SIDECAR_GRAPH_CHECKPOINT_GET_METHOD => self.handle_graph_checkpoint_get(params).await,
            SIDECAR_GRAPH_CHECKPOINT_LIST_METHOD => self.handle_graph_checkpoint_list(params).await,
            SIDECAR_GRAPH_CHECKPOINT_PUT_METHOD => self.handle_graph_checkpoint_put(params).await,
            SIDECAR_GRAPH_CHECKPOINT_PUT_WRITES_METHOD => {
                self.handle_graph_checkpoint_put_writes(params).await
            }
            SIDECAR_GRAPH_CHECKPOINT_DELETE_THREAD_METHOD => {
                self.handle_graph_checkpoint_delete_thread(params).await
            }
            SIDECAR_ARTIFACT_READ_METHOD => self.handle_artifact_read(params).await,
            SIDECAR_ARTIFACT_SEARCH_METHOD => self.handle_artifact_search(params).await,
            _ => Err(SidecarRequestError::method_not_found(method)),
        }
    }
}
