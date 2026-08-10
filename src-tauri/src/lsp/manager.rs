use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::protocol::*;

type ResponseSender = oneshot::Sender<Result<Value>>;
const MAX_LSP_MESSAGE_BYTES: usize = 32 * 1024 * 1024;

fn validate_lsp_message_size(bytes: usize) -> Result<()> {
    anyhow::ensure!(bytes > 0, "LSP message is empty");
    anyhow::ensure!(
        bytes <= MAX_LSP_MESSAGE_BYTES,
        "LSP message exceeds the {} MiB transport limit",
        MAX_LSP_MESSAGE_BYTES / (1024 * 1024)
    );
    Ok(())
}

/// Outgoing message type (Request or Notification)
enum LspOutgoingMessage {
    Request(LspRequest, ResponseSender),
    Notification(LspNotification),
    CancelRequest(u64),
}

fn completion_client_capabilities() -> Value {
    serde_json::json!({
        "completionItem": {
            "snippetSupport": true,
            "commitCharactersSupport": true,
            "documentationFormat": ["markdown", "plaintext"],
            "resolveSupport": {
                "properties": ["documentation", "detail", "additionalTextEdits"]
            },
            "deprecatedSupport": true,
            "preselectSupport": true,
            "tagSupport": { "valueSet": [1] },
            "insertReplaceSupport": true,
            "insertTextModeSupport": { "valueSet": [1, 2] },
            "labelDetailsSupport": true
        },
        "contextSupport": true,
        "insertTextMode": 2,
        "completionList": {
            "itemDefaults": [
                "commitCharacters",
                "editRange",
                "insertTextFormat",
                "insertTextMode",
                "data"
            ]
        }
    })
}

fn server_supports_completion_resolve(capabilities: &Value) -> bool {
    capabilities
        .pointer("/completionProvider/resolveProvider")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// LSP Server Manager with bidirectional communication
pub struct LspServerManager {
    process: Arc<Mutex<Option<Child>>>,
    message_tx: mpsc::Sender<LspOutgoingMessage>,
    binary_path: String,
    session_key: String,
    app_handle: AppHandle,
    server_capabilities: Arc<Mutex<Value>>,
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

        // Channel for sending messages to writer task
        let (message_tx, mut message_rx) = mpsc::channel::<LspOutgoingMessage>(100);
        self.message_tx = message_tx;

        // Map to track pending responses by request ID
        let pending_responses = Arc::new(Mutex::new(HashMap::<u64, ResponseSender>::new()));

        // Spawn stdout reader task
        let pending_responses_clone = pending_responses.clone();
        let app_handle = self.app_handle.clone();
        let session_key = self.session_key.clone();
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

                let content_length = line
                    .trim()
                    .split(':')
                    .nth(1)
                    .and_then(|s| s.trim().parse::<usize>().ok());
                let Some(content_length) = content_length else {
                    tracing::error!("LSP returned an invalid Content-Length header");
                    break;
                };
                if let Err(error) = validate_lsp_message_size(content_length) {
                    tracing::error!("Rejecting LSP response: {error}");
                    break;
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

                match serde_json::from_slice::<Value>(&buffer) {
                    Ok(message) => {
                        if let Some(id) = message.get("id").and_then(|v| v.as_u64()) {
                            if message.get("method").is_some()
                                && message.get("result").is_none()
                                && message.get("error").is_none()
                            {
                                tracing::debug!(
                                    "Ignoring unsupported LSP server request: {}",
                                    message
                                );
                                continue;
                            }

                            let mut pending = pending_responses_clone.lock().await;
                            if let Some(tx) = pending.remove(&id) {
                                let result = if let Some(error) = message.get("error") {
                                    let message = error
                                        .get("message")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown error");
                                    Err(anyhow::anyhow!("LSP error: {}", message))
                                } else {
                                    Ok(message.get("result").cloned().unwrap_or(Value::Null))
                                };
                                let _ = tx.send(result);
                            }
                        } else if let Some(method) = message.get("method").and_then(|v| v.as_str())
                        {
                            tracing::debug!("Received LSP notification: {}", method);
                            let notification = LspServerNotification {
                                session_key: Some(session_key.clone()),
                                method: method.to_string(),
                                params: message.get("params").cloned().unwrap_or(Value::Null),
                            };
                            if let Err(error) =
                                app_handle.emit(LSP_NOTIFICATION_EVENT, notification)
                            {
                                tracing::warn!("Failed to emit LSP notification: {}", error);
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to parse LSP message: {}", e);
                    }
                }
            }

            let mut pending = pending_responses_clone.lock().await;
            for (_, tx) in pending.drain() {
                let _ = tx.send(Err(anyhow::anyhow!("LSP stdout closed")));
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
                    LspOutgoingMessage::CancelRequest(id) => {
                        let mut pending = pending_responses_for_writer.lock().await;
                        pending.remove(&id);
                        drop(pending);
                        (
                            serde_json::to_string(&cancel_request_notification(id)),
                            None,
                            None,
                        )
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
                if let Err(error) = validate_lsp_message_size(json.len()) {
                    tracing::error!("Rejecting outgoing LSP message: {error}");
                    if let Some(tx) = response_tx_opt {
                        let _ = tx.send(Err(error));
                    }
                    continue;
                }

                // Format LSP message with Content-Length header
                let message = format!("Content-Length: {}\r\n\r\n{}", json.len(), json);

                if let (Some(id), Some(tx)) = (id_opt, response_tx_opt) {
                    tracing::debug!("Sending LSP request ID: {}", id);
                    let mut pending = pending_responses_for_writer.lock().await;
                    pending.insert(id, tx);
                }

                // Write to stdin
                if let Err(e) = stdin.write_all(message.as_bytes()).await {
                    println!(
                        "🔴 [LSP] Write to stdin failed: {} - Process may have crashed!",
                        e
                    );
                    tracing::error!(
                        "Failed to write to LSP stdin: {} - Process may have exited",
                        e
                    );
                    if let Some(id) = id_opt {
                        let mut pending = pending_responses_for_writer.lock().await;
                        if let Some(tx) = pending.remove(&id) {
                            let _ = tx.send(Err(anyhow::anyhow!(
                                "Write error (LSP process may have crashed): {}",
                                e
                            )));
                        }
                    }
                    if id_opt.is_none() {
                        tracing::debug!("Failed LSP notification write: {}", e);
                    }
                    continue;
                }

                if let Err(e) = stdin.flush().await {
                    tracing::error!("Failed to flush LSP stdin: {}", e);
                    if let Some(id) = id_opt {
                        let mut pending = pending_responses_for_writer.lock().await;
                        if let Some(tx) = pending.remove(&id) {
                            let _ = tx.send(Err(anyhow::anyhow!("Flush error: {}", e)));
                        }
                    }
                    continue;
                }

                if id_opt.is_none() {
                    tracing::debug!("Sent LSP notification");
                }
            }
        });

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

        match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(anyhow::anyhow!("Response channel closed")),
            Err(_) => {
                let _ = self
                    .message_tx
                    .send(LspOutgoingMessage::CancelRequest(id))
                    .await;
                Err(anyhow::anyhow!("LSP request timeout"))
            }
        }
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

fn cancel_request_notification(id: u64) -> LspNotification {
    LspNotification {
        jsonrpc: "2.0".to_string(),
        method: "$/cancelRequest".to_string(),
        params: serde_json::json!({ "id": id }),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        cancel_request_notification, completion_client_capabilities,
        server_supports_completion_resolve, validate_lsp_message_size, MAX_LSP_MESSAGE_BYTES,
    };

    #[test]
    fn timeout_cancellation_uses_the_standard_lsp_notification() {
        let notification = cancel_request_notification(42);
        assert_eq!(notification.method, "$/cancelRequest");
        assert_eq!(notification.params["id"], 42);
    }

    #[test]
    fn completion_capabilities_match_the_values_preserved_by_the_bridge() {
        let capabilities = completion_client_capabilities();

        assert_eq!(
            capabilities.pointer("/completionItem/resolveSupport/properties"),
            Some(&serde_json::json!([
                "documentation",
                "detail",
                "additionalTextEdits"
            ]))
        );
        assert_eq!(
            capabilities.pointer("/completionItem/insertReplaceSupport"),
            Some(&serde_json::json!(true))
        );
        assert_eq!(
            capabilities.pointer("/completionItem/labelDetailsSupport"),
            Some(&serde_json::json!(true))
        );
        assert_eq!(
            capabilities.pointer("/completionItem/insertTextModeSupport/valueSet"),
            Some(&serde_json::json!([1, 2]))
        );
        assert_eq!(
            capabilities.pointer("/completionList/itemDefaults"),
            Some(&serde_json::json!([
                "commitCharacters",
                "editRange",
                "insertTextFormat",
                "insertTextMode",
                "data"
            ]))
        );
    }

    #[test]
    fn completion_resolve_requires_an_explicit_server_capability() {
        assert!(server_supports_completion_resolve(&serde_json::json!({
            "completionProvider": { "resolveProvider": true }
        })));
        assert!(!server_supports_completion_resolve(&serde_json::json!({
            "completionProvider": { "triggerCharacters": ["."] }
        })));
        assert!(!server_supports_completion_resolve(
            &serde_json::Value::Null
        ));
    }

    #[test]
    fn lsp_transport_rejects_empty_and_oversized_messages() {
        assert!(validate_lsp_message_size(1).is_ok());
        assert!(validate_lsp_message_size(MAX_LSP_MESSAGE_BYTES).is_ok());
        assert!(validate_lsp_message_size(0).is_err());
        assert!(validate_lsp_message_size(MAX_LSP_MESSAGE_BYTES + 1).is_err());
    }
}
