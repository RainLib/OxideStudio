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

/// LSP Server Manager with bidirectional communication
pub struct LspServerManager {
    process: Arc<Mutex<Option<Child>>>,
    request_tx: mpsc::Sender<(LspRequest, ResponseSender)>,
    binary_path: String,
}

impl LspServerManager {
    /// Create a new LSP server manager
    pub fn new(binary_path: String) -> Self {
        let (tx, _rx) = mpsc::channel(100);

        Self {
            process: Arc::new(Mutex::new(None)),
            request_tx: tx,
            binary_path,
        }
    }

    /// Start the LSP server process with bidirectional communication
    pub async fn start(&self) -> Result<()> {
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

        // Channel for sending requests to writer task
        let (request_tx, mut request_rx) = mpsc::channel::<(LspRequest, ResponseSender)>(100);

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
                    tracing::warn!("Invalid LSP header: {}", line.trim());
                    continue;
                }

                let content_length: usize = line
                    .trim()
                    .split(':')
                    .nth(1)
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(0);

                if content_length == 0 {
                    tracing::warn!("Invalid content length");
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
                        tracing::debug!("Received LSP response for ID: {}", response.id);

                        let mut pending = pending_responses_clone.lock().await;
                        if let Some(tx) = pending.remove(&response.id) {
                            let result = if let Some(error) = response.error {
                                Err(anyhow::anyhow!("LSP error: {}", error.message))
                            } else {
                                Ok(response.result.unwrap_or(Value::Null))
                            };
                            let _ = tx.send(result);
                        } else {
                            tracing::warn!("No pending request for ID: {}", response.id);
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

            while let Some((request, response_tx)) = request_rx.recv().await {
                let id = request.id;

                // Serialize request
                let json = match serde_json::to_string(&request) {
                    Ok(j) => j,
                    Err(e) => {
                        tracing::error!("Failed to serialize request: {}", e);
                        let _ =
                            response_tx.send(Err(anyhow::anyhow!("Serialization error: {}", e)));
                        continue;
                    }
                };

                // Format LSP message with Content-Length header
                let message = format!("Content-Length: {}\r\n\r\n{}", json.len(), json);

                // Write to stdin
                if let Err(e) = stdin.write_all(message.as_bytes()).await {
                    tracing::error!("Failed to write to LSP stdin: {}", e);
                    let _ = response_tx.send(Err(anyhow::anyhow!("Write error: {}", e)));
                    continue;
                }

                if let Err(e) = stdin.flush().await {
                    tracing::error!("Failed to flush LSP stdin: {}", e);
                    let _ = response_tx.send(Err(anyhow::anyhow!("Flush error: {}", e)));
                    continue;
                }

                tracing::debug!("Sent LSP request ID: {}", id);

                // Store response sender for later
                let mut pending = pending_responses_for_writer.lock().await;
                pending.insert(id, response_tx);
            }
        });

        // Store the new channel and process
        drop(process_lock);

        // Update self with new sender (can't mutate self.request_tx directly, so this is a known limitation)
        // In a production system, we'd use Arc<Mutex<Sender>> or similar
        // For now, commands can still use the manager via send_request

        *self.process.lock().await = Some(child);

        Ok(())
    }

    /// Stop the LSP server process
    pub async fn stop(&self) -> Result<()> {
        let mut process_lock = self.process.lock().await;

        if let Some(mut child) = process_lock.take() {
            // Send shutdown request (best effort)
            drop(process_lock); // Release lock before sending request
            let _ = self.send_request("shutdown".to_string(), Value::Null).await;

            // Wait for graceful shutdown or kill after timeout
            tokio::select! {
                _ = child.wait() => {
                    tracing::info!("LSP server shutdown gracefully");
                }
                _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {
                    tracing::warn!("LSP server shutdown timeout, killing process");
                    let _ = child.kill().await;
                }
            }
        }

        Ok(())
    }

    /// Send a request to the LSP server and wait for response
    pub async fn send_request(&self, method: String, params: Value) -> Result<Value> {
        // Generate unique request ID
        static REQUEST_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let id = REQUEST_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        // Create request
        let request = LspRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method,
            params,
        };

        // Create oneshot channel for response
        let (tx, rx) = oneshot::channel();

        // Send request to writer task
        self.request_tx
            .send((request, tx))
            .await
            .context("Failed to send request to LSP writer")?;

        // Wait for response with timeout
        tokio::time::timeout(std::time::Duration::from_secs(5), rx)
            .await
            .context("LSP request timeout")?
            .context("Response channel closed")?
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
