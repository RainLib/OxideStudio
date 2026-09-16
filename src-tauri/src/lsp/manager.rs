use anyhow::{Context, Result};
use serde_json::Value;
use std::process::Stdio;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::io::BufReader;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::protocol::*;

mod transport;
use transport::*;

/// LSP Server Manager with bidirectional communication
pub struct LspServerManager {
    process: Arc<Mutex<Option<Child>>>,
    message_tx: mpsc::Sender<LspOutgoingMessage>,
    binary_path: String,
    session_key: String,
    app_handle: AppHandle,
    server_capabilities: Arc<Mutex<Value>>,
    request_tokens: Arc<Mutex<LspRequestTokens>>,
}

impl LspServerManager {
    /// Create a new LSP server manager
    pub fn new(binary_path: String, app_handle: AppHandle, session_key: String) -> Self {
        let (tx, _rx) = mpsc::channel(100);

        Self {
            process: Arc::new(Mutex::new(None)),
            message_tx: tx,
            binary_path,
            session_key,
            app_handle,
            server_capabilities: Arc::new(Mutex::new(Value::Null)),
            request_tokens: Arc::new(Mutex::new(LspRequestTokens::default())),
        }
    }

    /// Start the LSP server process with bidirectional communication
    pub async fn start(&mut self) -> Result<()> {
        println!("🚀 [MANAGER] start() called");

        let mut process_lock = self.process.lock().await;

        // Kill existing process if running
        if let Some(mut child) = process_lock.take() {
            println!("🔄 [MANAGER] Killing existing process");
            tracing::info!("🔄 [LSP] Killing existing LSP process");
            let _ = child.kill().await;
            let _ = child.wait().await;
        }

        println!("🚀 [MANAGER] Binary path: {}", self.binary_path);
        tracing::info!("🚀 [LSP] Starting LSP server: {}", self.binary_path);

        // Check if binary exists and is executable
        let binary_path = std::path::Path::new(&self.binary_path);
        if !binary_path.exists() {
            println!("❌ [MANAGER] Binary not found at: {}", self.binary_path);
            return Err(anyhow::anyhow!(
                "LSP binary not found at: {}",
                self.binary_path
            ));
        }

        println!("✅ [MANAGER] Binary exists, spawning process...");

        // Spawn new LSP server process
        let mut child = Command::new(&self.binary_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .context(format!(
                "Failed to spawn LSP server process: {}",
                self.binary_path
            ))?;

        println!("✅ [MANAGER] Process spawned with PID: {:?}", child.id());
        tracing::info!(
            "✅ [LSP] LSP server process started with PID: {:?}",
            child.id()
        );

        // Capture stderr for debugging
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                    println!("🔴 [LSP stderr] {}", line.trim());
                    tracing::warn!("🔴 [LSP stderr] {}", line.trim());
                    line.clear();
                }
            });
        }

        // Take stdin/stdout
        let stdin = child.stdin.take().context("Failed to get stdin")?;
        let stdout = child.stdout.take().context("Failed to get stdout")?;

        // The transport owns framing, pending responses, server requests and writer cancellation.
        let (message_tx, message_rx) = mpsc::channel::<LspOutgoingMessage>(100);
        self.message_tx = message_tx.clone();
        spawn_lsp_transport(
            stdin,
            stdout,
            message_rx,
            message_tx,
            self.app_handle.clone(),
            self.session_key.clone(),
        );

        // Store the new channel and process
        drop(process_lock);
        *self.process.lock().await = Some(child);

        // --- LSP Handshake ---

        // 1. Send 'initialize' request
        let init_params = serde_json::json!({
            "processId": std::process::id(),
            "rootUri": Value::Null,
            "capabilities": {
                "textDocument": {
                    "completion": completion_client_capabilities(),
                    "hover": {
                        "contentFormat": ["markdown", "plaintext"]
                    },
                    "definition": {},
                    "references": {},
                    "formatting": {},
                    "publishDiagnostics": {},
                    "synchronization": {
                        "didSave": true,
                        "didChange": true,
                        "didOpen": true,
                        "didClose": true
                    }
                },
                "workspace": {
                    "configuration": true
                }
            }
        });

        println!("🤝 [HANDSHAKE] Sending LSP initialize request...");
        tracing::info!("Sending LSP initialize request...");

        match self
            .send_request("initialize".to_string(), init_params)
            .await
        {
            Ok(value) => {
                *self.server_capabilities.lock().await =
                    value.get("capabilities").cloned().unwrap_or(Value::Null);
                println!("✅ [HANDSHAKE] Initialize response received!");
                println!(
                    "✅ [HANDSHAKE] Response: {}",
                    serde_json::to_string_pretty(&value).unwrap_or_default()
                );
            }
            Err(e) => {
                println!("❌ [HANDSHAKE] Initialize failed: {}", e);
                self.kill_process().await;
                return Err(anyhow::anyhow!("LSP initialize failed: {}", e));
            }
        };

        println!("🤝 [HANDSHAKE] Sending initialized notification...");
        tracing::info!("LSP initialized successfully");

        // 2. Send 'initialized' notification
        let notif = LspNotification {
            jsonrpc: "2.0".to_string(),
            method: "initialized".to_string(),
            params: serde_json::json!({}),
        };

        self.message_tx
            .send(LspOutgoingMessage::Notification(notif))
            .await
            .context("Failed to send initialized notification")?;

        Ok(())
    }

    /// Whether the initialized server advertises lazy completion-item resolve.
    pub async fn supports_completion_resolve(&self) -> bool {
        let capabilities = self.server_capabilities.lock().await;
        server_supports_completion_resolve(&capabilities)
    }

    async fn kill_process(&self) {
        let mut process_lock = self.process.lock().await;
        if let Some(mut child) = process_lock.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    /// Stop the LSP server process
    pub async fn stop(&self) -> Result<()> {
        let mut process_lock = self.process.lock().await;

        if let Some(mut child) = process_lock.take() {
            drop(process_lock);
            let _ = self.send_request("shutdown".to_string(), Value::Null).await;
            let _ = self
                .send_notification("exit".to_string(), Value::Null)
                .await;

            tokio::select! {
                _ = child.wait() => {
                    tracing::info!("LSP server shutdown gracefully");
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {
                    let _ = child.kill().await;
                }
            }
        }

        Ok(())
    }

    /// Send a request to the LSP server and wait for response
    pub async fn send_request(&self, method: String, params: Value) -> Result<Value> {
        self.send_request_with_token(method, params, None).await
    }

    /// Send a cancellable request. The caller-provided token is local to this
    /// LSP session and is translated to the JSON-RPC request ID internally.
    pub async fn send_request_with_token(
        &self,
        method: String,
        params: Value,
        request_token: Option<String>,
    ) -> Result<Value> {
        static REQUEST_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let id = REQUEST_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        if let Some(token) = request_token.as_ref() {
            let mut tokens = self.request_tokens.lock().await;
            if !tokens.register(token.clone(), id)? {
                return Err(anyhow::anyhow!("LSP request cancelled"));
            }
        }

        let request = LspRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method,
            params,
        };

        let (tx, rx) = oneshot::channel();

        // This effectively clones the sender
        if let Err(error) = self
            .message_tx
            .send(LspOutgoingMessage::Request(request, tx))
            .await
        {
            self.clear_request_token(request_token.as_deref(), id).await;
            return Err(error).context("Failed to send request to LSP writer");
        }

        let result = match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(anyhow::anyhow!("Response channel closed")),
            Err(_) => {
                let _ = self
                    .message_tx
                    .send(LspOutgoingMessage::CancelRequest(id))
                    .await;
                Err(anyhow::anyhow!("LSP request timeout"))
            }
        };
        self.clear_request_token(request_token.as_deref(), id).await;
        result
    }

    async fn clear_request_token(&self, request_token: Option<&str>, id: u64) {
        let Some(token) = request_token else {
            return;
        };
        let mut tokens = self.request_tokens.lock().await;
        tokens.clear(token, id);
    }

    /// Cancel an active request by its caller-visible token.
    pub async fn cancel_request_token(&self, request_token: &str) -> Result<bool> {
        let mut tokens = self.request_tokens.lock().await;
        let id = tokens.cancel(request_token);
        drop(tokens);
        let Some(id) = id else {
            return Ok(false);
        };
        self.message_tx
            .send(LspOutgoingMessage::CancelRequest(id))
            .await
            .context("Failed to send cancellation to LSP writer")?;
        Ok(true)
    }

    /// Send a notification to the LSP server
    pub async fn send_notification(&self, method: String, params: Value) -> Result<()> {
        let notification = LspNotification {
            jsonrpc: "2.0".to_string(),
            method,
            params,
        };

        self.message_tx
            .send(LspOutgoingMessage::Notification(notification))
            .await
            .context("Failed to send notification to LSP writer")?;

        Ok(())
    }

    /// Check if LSP server is running
    pub async fn is_running(&self) -> bool {
        let mut process_lock = self.process.lock().await;
        let Some(child) = process_lock.as_mut() else {
            return false;
        };

        match child.try_wait() {
            Ok(Some(status)) => {
                tracing::warn!("LSP server process exited: {}", status);
                *process_lock = None;
                false
            }
            Ok(None) => true,
            Err(error) => {
                tracing::warn!("Failed to inspect LSP server process: {}", error);
                *process_lock = None;
                false
            }
        }
    }

    /// Get binary path
    pub fn binary_path(&self) -> &str {
        &self.binary_path
    }

    pub fn session_key(&self) -> &str {
        &self.session_key
    }
}
