use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::protocol::*;

type ResponseSender = oneshot::Sender<Result<Value>>;

/// Outgoing message type (Request or Notification)
enum LspOutgoingMessage {
    Request(LspRequest, ResponseSender),
    Notification(LspNotification),
}

/// LSP Server Manager with bidirectional communication
pub struct LspServerManager {
    process: Arc<Mutex<Option<Child>>>,
    message_tx: mpsc::Sender<LspOutgoingMessage>,
    binary_path: String,
}

impl LspServerManager {
    /// Create a new LSP server manager
    pub fn new(binary_path: String) -> Self {
        let (tx, _rx) = mpsc::channel(100);

        Self {
            process: Arc::new(Mutex::new(None)),
            message_tx: tx,
            binary_path,
        }
    }

    /// Start the LSP server process with bidirectional communication
    pub async fn start(&mut self) -> Result<()> {
        let mut process_lock = self.process.lock().await;

        // Kill existing process if running
        if let Some(mut child) = process_lock.take() {
            let _ = child.kill().await;
        }

        // Spawn new LSP server process
        let mut child = Command::new(&self.binary_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn LSP server process")?;

        tracing::info!("LSP server started with PID: {:?}", child.id());

        // Take stdin/stdout
        let stdin = child.stdin.take().context("Failed to get stdin")?;
        let stdout = child.stdout.take().context("Failed to get stdout")?;

        // Channel for sending messages to writer task
        let (message_tx, mut message_rx) = mpsc::channel::<LspOutgoingMessage>(100);
        self.message_tx = message_tx;

        // Map to track pending responses by request ID
        let pending_responses = Arc::new(Mutex::new(HashMap::<u64, ResponseSender>::new()));

        // Spawn stdout reader task
        let pending_responses_clone = pending_responses.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();

            loop {
                line.clear();

                // Read Content-Length header
                if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
                    tracing::warn!("LSP stdout closed");
                    break;
                }

                if !line.starts_with("Content-Length:") {
                    continue;
                }

                let content_length: usize = line
                    .trim()
                    .split(':')
                    .nth(1)
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(0);

                if content_length == 0 {
                    continue;
                }

                // Read empty line
                line.clear();
                let _ = reader.read_line(&mut line).await;

                // Read JSON content
                let mut buffer = vec![0u8; content_length];
                if let Err(e) = reader.read_exact(&mut buffer).await {
                    tracing::error!("Failed to read LSP message: {}", e);
                    break;
                }

                // Parse JSON-RPC response
                match serde_json::from_slice::<LspResponse>(&buffer) {
                    Ok(response) => {
                        let mut pending = pending_responses_clone.lock().await;
                        if let Some(tx) = pending.remove(&response.id) {
                            let result = if let Some(error) = response.error {
                                Err(anyhow::anyhow!("LSP error: {}", error.message))
                            } else {
                                Ok(response.result.unwrap_or(Value::Null))
                            };
                            let _ = tx.send(result);
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to parse LSP response: {}", e);
                    }
                }
            }
        });

        // Spawn stdin writer task
        let pending_responses_for_writer = pending_responses.clone();
        tokio::spawn(async move {
            let mut stdin = stdin;

            while let Some(msg) = message_rx.recv().await {
                // Serialize message
                let (json, id_opt, response_tx_opt) = match msg {
                    LspOutgoingMessage::Request(req, tx) => {
                        (serde_json::to_string(&req), Some(req.id), Some(tx))
                    }
                    LspOutgoingMessage::Notification(notif) => {
                        (serde_json::to_string(&notif), None, None)
                    }
                };

                let json = match json {
                    Ok(j) => j,
                    Err(e) => {
                        tracing::error!("Failed to serialize message: {}", e);
                        if let Some(tx) = response_tx_opt {
                            let _ = tx.send(Err(anyhow::anyhow!("Serialization error: {}", e)));
                        }
                        continue;
                    }
                };

                // Format LSP message with Content-Length header
                let message = format!("Content-Length: {}\r\n\r\n{}", json.len(), json);

                // Write to stdin
                if let Err(e) = stdin.write_all(message.as_bytes()).await {
                    tracing::error!("Failed to write to LSP stdin: {}", e);
                    if let Some(tx) = response_tx_opt {
                        let _ = tx.send(Err(anyhow::anyhow!("Write error: {}", e)));
                    }
                    continue;
                }

                if let Err(e) = stdin.flush().await {
                    tracing::error!("Failed to flush LSP stdin: {}", e);
                    if let Some(tx) = response_tx_opt {
                        let _ = tx.send(Err(anyhow::anyhow!("Flush error: {}", e)));
                    }
                    continue;
                }

                // If it's a request, store the response sender
                if let (Some(id), Some(tx)) = (id_opt, response_tx_opt) {
                    tracing::debug!("Sent LSP request ID: {}", id);
                    let mut pending = pending_responses_for_writer.lock().await;
                    pending.insert(id, tx);
                } else {
                    tracing::debug!("Sent LSP notification");
                }
            }
        });

        // Store the new channel and process
        drop(process_lock);
        *self.process.lock().await = Some(child);

        // Note: self.message_tx cannot be updated in-place easily without Arc<Mutex<Sender>>
        // But for this implementation, we rely on the fact that start() is called once or handles re-init
        // For complete correctness we'd wrap sender in mutex, but keeping it simple for now as per previous design

        // --- LSP Handshake ---

        // 1. Send 'initialize' request
        let init_params = serde_json::json!({
            "processId": std::process::id(),
            "rootUri": Value::Null,
            "capabilities": {
                "textDocument": {
                    "completion": {
                        "completionItem": {
                            "snippetSupport": true
                        }
                    },
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

        // We can't use self.send_request here easily because we are holding a mutable borrow
        // but we can use the message_tx clone we just created or the one in self.
        // Wait, send_request takes &self. We have &mut self.
        // We can downgrade, or just implement the send logic inline for the handshake.

        // Actually, we can clone the sender before assigning it to self for the handshake usage.
        // But send_request logic is complex (oneshot channel setup).
        // Let's rely on self.send_request AFTER we release the borrow?
        // No, start() holds &mut self for the whole duration.
        // We can split the function or just duplicate the send_request logic here using the local tx.

        tracing::info!("Sending LSP initialize request...");

        static REQUEST_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = REQUEST_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();

        let request = LspRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: "initialize".to_string(),
            params: init_params,
        };

        // Send using local message_tx (which is connected to the writer task we just spawned)
        self.message_tx
            .send(LspOutgoingMessage::Request(request, tx))
            .await
            .context("Failed to send initialize request")?;

        // Wait for initialize response
        let _init_result = tokio::time::timeout(std::time::Duration::from_secs(5), rx)
            .await
            .context("LSP initialize timeout")?
            .context("Response channel closed")?
            .context("LSP initialize failed")?;

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

    /// Stop the LSP server process
    pub async fn stop(&self) -> Result<()> {
        let mut process_lock = self.process.lock().await;

        if let Some(mut child) = process_lock.take() {
            drop(process_lock);
            let _ = self.send_request("shutdown".to_string(), Value::Null).await;

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
        static REQUEST_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let id = REQUEST_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        let request = LspRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method,
            params,
        };

        let (tx, rx) = oneshot::channel();

        // This effectively clones the sender
        self.message_tx
            .send(LspOutgoingMessage::Request(request, tx))
            .await
            .context("Failed to send request to LSP writer")?;

        tokio::time::timeout(std::time::Duration::from_secs(5), rx)
            .await
            .context("LSP request timeout")?
            .context("Response channel closed")?
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
        let process_lock = self.process.lock().await;
        process_lock.is_some()
    }

    /// Get binary path
    pub fn binary_path(&self) -> &str {
        &self.binary_path
    }
}
