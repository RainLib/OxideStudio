//! Process supervisor for the dedicated RocketMQ workspace agent.
//!
//! RocketMQ is deliberately not launched through `driver_sidecar`: its RPC
//! surface models operational resources (topics, groups and messages), not a
//! SQL database.  Each saved connection owns one isolated process so an agent
//! never receives another connection's address or credentials.

use anyhow::{anyhow, Result};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio::{
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex},
    time::timeout,
};
use tokio_util::codec::{FramedRead, FramedWrite, LinesCodec};

const MAX_MQ_AGENT_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
const START_TIMEOUT: Duration = Duration::from_secs(8);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

pub struct RocketMqAgent {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<FramedWrite<ChildStdin, LinesCodec>>>,
    pending: Pending,
    next_id: AtomicU64,
}

#[derive(Default)]
pub struct RocketMqAgentManager {
    agents: Mutex<HashMap<String, Arc<RocketMqAgent>>>,
}

impl RocketMqAgentManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn connect(
        &self,
        app: &AppHandle,
        connection_id: String,
        config: Value,
    ) -> Result<Value> {
        let agent = Arc::new(RocketMqAgent::spawn(app).await?);
        let result = agent
            .request("connect", json!({ "connection": config }), REQUEST_TIMEOUT)
            .await?;
        let previous = self.agents.lock().await.insert(connection_id, agent);
        if let Some(previous) = previous {
            previous.terminate().await;
        }
        Ok(result)
    }

    pub async fn test_connection(&self, app: &AppHandle, config: Value) -> Result<Value> {
        let agent = RocketMqAgent::spawn(app).await?;
        let result = agent
            .request(
                "test_connection",
                json!({ "connection": config }),
                REQUEST_TIMEOUT,
            )
            .await;
        agent.terminate().await;
        result
    }

    pub async fn request(&self, connection_id: &str, method: &str, params: Value) -> Result<Value> {
        let agent = self
            .agents
            .lock()
            .await
            .get(connection_id)
            .cloned()
            .ok_or_else(|| anyhow!("RocketMQ workspace is not connected"))?;
        agent.request(method, params, REQUEST_TIMEOUT).await
    }

    pub async fn disconnect(&self, connection_id: &str) {
        if let Some(agent) = self.agents.lock().await.remove(connection_id) {
            agent.terminate().await;
        }
    }
}

impl RocketMqAgent {
    async fn spawn(app: &AppHandle) -> Result<Self> {
        let binary = resolve_rocketmq_agent_binary(app)?;
        let mut command = Command::new(binary);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env_clear();
        copy_safe_environment(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| anyhow!("Cannot launch RocketMQ workspace agent: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("RocketMQ workspace agent stdin is unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("RocketMQ workspace agent stdout is unavailable"))?;
        if let Some(stderr) = child.stderr.take() {
            // Drain but never retain agent output: connection parameters can be
            // present in a third-party library's diagnostics.
            tokio::spawn(async move {
                let _ = tokio::io::copy(
                    &mut tokio::io::BufReader::new(stderr),
                    &mut tokio::io::sink(),
                )
                .await;
            });
        }
        let mut reader = FramedRead::new(
            stdout,
            LinesCodec::new_with_max_length(MAX_MQ_AGENT_MESSAGE_BYTES),
        );
        let ready = timeout(START_TIMEOUT, reader.next())
            .await
            .map_err(|_| anyhow!("RocketMQ workspace agent did not become ready"))?
            .ok_or_else(|| anyhow!("RocketMQ workspace agent stopped before becoming ready"))?
            .map_err(|error| anyhow!("Cannot read RocketMQ workspace agent readiness: {error}"))?;
        if serde_json::from_str::<Value>(&ready)
            .ok()
            .and_then(|value| value.get("ready").and_then(Value::as_bool))
            != Some(true)
        {
            return Err(anyhow!(
                "RocketMQ workspace agent returned an invalid readiness message"
            ));
        }
        let pending = Arc::new(Mutex::new(HashMap::new()));
        spawn_dispatcher(reader, pending.clone());
        let agent = Self {
            child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(FramedWrite::new(stdin, LinesCodec::new()))),
            pending,
            next_id: AtomicU64::new(1),
        };
        let handshake = agent.request("handshake", json!({}), START_TIMEOUT).await?;
        if handshake.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
            agent.terminate().await;
            return Err(anyhow!("RocketMQ workspace agent protocol is incompatible"));
        }
        Ok(agent)
    }

    async fn request(
        &self,
        method: &str,
        params: Value,
        request_timeout: Duration,
    ) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        if id == u64::MAX {
            return Err(anyhow!("RocketMQ workspace request id overflow"));
        }
        let message = serde_json::to_string(
            &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
        )?;
        if message.len() > MAX_MQ_AGENT_MESSAGE_BYTES {
            return Err(anyhow!(
                "RocketMQ workspace request exceeds the message limit"
            ));
        }
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);
        let write = timeout(request_timeout, async {
            self.stdin.lock().await.send(message).await
        })
        .await;
        match write {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                self.pending.lock().await.remove(&id);
                return Err(anyhow!("Cannot send RocketMQ workspace request: {error}"));
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                return Err(anyhow!(
                    "RocketMQ workspace request timed out while sending"
                ));
            }
        }
        match timeout(request_timeout, receiver).await {
            Ok(Ok(Ok(result))) => Ok(result),
            Ok(Ok(Err(error))) => Err(anyhow!(error)),
            Ok(Err(_)) => Err(anyhow!(
                "RocketMQ workspace agent stopped before responding"
            )),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(anyhow!("RocketMQ workspace request timed out"))
            }
        }
    }

    async fn terminate(&self) {
        for (_, sender) in std::mem::take(&mut *self.pending.lock().await) {
            let _ = sender.send(Err("RocketMQ workspace agent was terminated".to_string()));
        }
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

impl Drop for RocketMqAgent {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.try_lock() {
            let _ = child.start_kill();
        }
    }
}

fn spawn_dispatcher(
    mut reader: FramedRead<tokio::process::ChildStdout, LinesCodec>,
    pending: Pending,
) {
    tokio::spawn(async move {
        let terminal = loop {
            let Some(line) = reader.next().await else {
                break "RocketMQ workspace agent stopped before responding".to_string();
            };
            let line = match line {
                Ok(line) => line,
                Err(error) => break format!("Cannot read RocketMQ workspace response: {error}"),
            };
            let value: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let Some(id) = value.get("id").and_then(Value::as_u64) else {
                continue;
            };
            let result = if let Some(error) = value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
            {
                Err(error.to_string())
            } else {
                Ok(value.get("result").cloned().unwrap_or(Value::Null))
            };
            if let Some(sender) = pending.lock().await.remove(&id) {
                let _ = sender.send(result);
            }
        };
        for (_, sender) in std::mem::take(&mut *pending.lock().await) {
            let _ = sender.send(Err(terminal.clone()));
        }
    });
}

fn resolve_rocketmq_agent_binary(app: &AppHandle) -> Result<PathBuf> {
    let executable = if cfg!(windows) {
        "oxide-agent-rocketmq.exe"
    } else {
        "oxide-agent-rocketmq"
    };
    let target = env!("TAURI_ENV_TARGET_TRIPLE");
    let extension = if cfg!(windows) { ".exe" } else { "" };
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            candidates.push(parent.join(format!("oxide-agent-rocketmq-{target}{extension}")));
            candidates.push(parent.join(executable));
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join(format!("oxide-agent-rocketmq-{target}{extension}")));
        candidates.push(resources.join(executable));
        candidates.push(
            resources
                .join("binaries")
                .join(format!("oxide-agent-rocketmq-{target}{extension}")),
        );
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(
        manifest
            .join("binaries")
            .join(format!("oxide-agent-rocketmq-{target}{extension}")),
    );
    candidates
        .into_iter()
        .find(|path| path.metadata().is_ok_and(|metadata| metadata.is_file()))
        .ok_or_else(|| anyhow!("the bundled RocketMQ workspace agent executable was not found"))
}

fn copy_safe_environment(command: &mut Command) {
    for key in [
        "SystemRoot",
        "WINDIR",
        "ComSpec",
        "PATH",
        "HOME",
        "USERPROFILE",
        "TMP",
        "TEMP",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
}
