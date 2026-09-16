use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::super::protocol::*;

type ResponseSender = oneshot::Sender<Result<Value>>;
const MAX_LSP_MESSAGE_BYTES: usize = 32 * 1024 * 1024;
const MAX_LSP_HEADER_LINE_BYTES: usize = 8 * 1024;
// Keep the in-flight map bounded independently from the outbound channel.
// A stalled server can otherwise accept every queued request and never reply,
// retaining one response sender per request until each caller times out.
const MAX_PENDING_LSP_RESPONSES: usize = 128;

fn validate_lsp_message_size(bytes: usize) -> Result<()> {
    anyhow::ensure!(bytes > 0, "LSP message is empty");
    anyhow::ensure!(
        bytes <= MAX_LSP_MESSAGE_BYTES,
        "LSP message exceeds the {} MiB transport limit",
        MAX_LSP_MESSAGE_BYTES / (1024 * 1024)
    );
    Ok(())
}

fn can_register_pending_response(pending_count: usize) -> bool {
    pending_count < MAX_PENDING_LSP_RESPONSES
}

/// Reads one LSP header line without allowing a malformed server to make the
/// `BufReader::read_line` allocation grow without bound. Header values are
/// small by protocol design; payloads keep their separate 32 MiB boundary.
async fn read_lsp_header_line<R>(reader: &mut R, line: &mut Vec<u8>) -> std::io::Result<usize>
where
    R: AsyncBufRead + Unpin,
{
    line.clear();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(line.len());
        }
        let take = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(available.len());
        if line.len().saturating_add(take) > MAX_LSP_HEADER_LINE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "LSP header line exceeds the 8 KiB transport limit",
            ));
        }
        line.extend_from_slice(&available[..take]);
        reader.consume(take);
        if line.last() == Some(&b'\n') {
            return Ok(line.len());
        }
    }
}

fn content_length_from_lsp_header(line: &str) -> Result<Option<usize>> {
    let Some((name, value)) = line.trim_end_matches(['\r', '\n']).split_once(':') else {
        return Ok(None);
    };
    if !name.trim().eq_ignore_ascii_case("content-length") {
        return Ok(None);
    }

    let bytes = value
        .trim()
        .parse::<usize>()
        .context("LSP returned an invalid Content-Length header")?;
    validate_lsp_message_size(bytes)?;
    Ok(Some(bytes))
}

/// Outgoing message type (Request or Notification)
pub(super) enum LspOutgoingMessage {
    Request(LspRequest, ResponseSender),
    Notification(LspNotification),
    ServerResponse(Value),
    CancelRequest(u64),
}

#[derive(Default)]
pub(super) struct LspRequestTokens {
    active: HashMap<String, u64>,
    cancelled_before_registration: HashSet<String>,
}

impl LspRequestTokens {
    pub(super) fn register(&mut self, token: String, id: u64) -> Result<bool> {
        if self.cancelled_before_registration.remove(&token) {
            return Ok(false);
        }
        anyhow::ensure!(
            !self.active.contains_key(&token),
            "LSP request token is already active"
        );
        self.active.insert(token, id);
        Ok(true)
    }

    pub(super) fn cancel(&mut self, token: &str) -> Option<u64> {
        if let Some(id) = self.active.remove(token) {
            return Some(id);
        }
        if self.cancelled_before_registration.len() >= 1_024 {
            self.cancelled_before_registration.clear();
        }
        self.cancelled_before_registration.insert(token.to_string());
        None
    }

    pub(super) fn clear(&mut self, token: &str, id: u64) {
        if self.active.get(token) == Some(&id) {
            self.active.remove(token);
        }
    }
}

pub(super) fn completion_client_capabilities() -> Value {
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

pub(super) fn server_supports_completion_resolve(capabilities: &Value) -> bool {
    capabilities
        .pointer("/completionProvider/resolveProvider")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn lsp_server_request_response(message: &Value) -> Option<Value> {
    let id = message.get("id")?.clone();
    let method = message.get("method")?.as_str()?;
    let params = message.get("params").unwrap_or(&Value::Null);

    let result = match method {
        "workspace/configuration" => {
            let item_count = params
                .get("items")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            Some(Value::Array(vec![Value::Null; item_count]))
        }
        "workspace/workspaceFolders" => Some(Value::Array(Vec::new())),
        "window/workDoneProgress/create" => Some(Value::Null),
        "window/showMessageRequest" => Some(Value::Null),
        "workspace/applyEdit" => Some(serde_json::json!({
            "applied": false,
            "failureReason": "Workspace edits initiated by the language server are not supported"
        })),
        _ => None,
    };

    Some(match result {
        Some(result) => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result
        }),
        None => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": format!("Unsupported LSP server request: {method}")
            }
        }),
    })
}

pub(super) fn spawn_lsp_transport(
    stdin: ChildStdin,
    stdout: ChildStdout,
    mut message_rx: mpsc::Receiver<LspOutgoingMessage>,
    message_tx: mpsc::Sender<LspOutgoingMessage>,
    app_handle: AppHandle,
    session_key: String,
) {
    // Map to track pending responses by request ID
    let pending_responses = Arc::new(Mutex::new(HashMap::<u64, ResponseSender>::new()));

    // Spawn stdout reader task
    let pending_responses_clone = pending_responses.clone();
    let server_response_tx = message_tx;
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = Vec::with_capacity(256);

        loop {
            line.clear();

            // Start a header block. A few servers accidentally log plain
            // text to stdout, so skip non-header lines and recover at the
            // next valid LSP frame.
            match read_lsp_header_line(&mut reader, &mut line).await {
                Ok(0) => {
                    tracing::warn!("LSP stdout closed");
                    break;
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::error!("Rejecting LSP response header: {error}");
                    break;
                }
            }
            if line == b"\r\n" || line == b"\n" || !line.contains(&b':') {
                continue;
            }

            let mut content_length = None;
            loop {
                let header = match std::str::from_utf8(&line) {
                    Ok(value) => value,
                    Err(_) => {
                        tracing::error!("Rejecting LSP response with a non-UTF-8 header");
                        content_length = None;
                        break;
                    }
                };
                match content_length_from_lsp_header(header) {
                    Ok(Some(length)) => match content_length {
                        Some(existing) if existing != length => {
                            tracing::error!("LSP returned conflicting Content-Length headers");
                            content_length = None;
                            break;
                        }
                        _ => content_length = Some(length),
                    },
                    Ok(None) => {}
                    Err(error) => {
                        tracing::error!("Rejecting LSP response: {error}");
                        content_length = None;
                        break;
                    }
                }

                line.clear();
                match read_lsp_header_line(&mut reader, &mut line).await {
                    Ok(0) => break,
                    Ok(_) if line == b"\r\n" || line == b"\n" => break,
                    Ok(_) => {}
                    Err(error) => {
                        tracing::error!("Failed to read LSP headers: {error}");
                        break;
                    }
                }
            }
            let Some(content_length) = content_length else {
                tracing::error!("LSP header block did not contain a valid Content-Length");
                break;
            };

            // Read JSON content
            let mut buffer = vec![0u8; content_length];
            if let Err(e) = reader.read_exact(&mut buffer).await {
                tracing::error!("Failed to read LSP message: {}", e);
                break;
            }

            match serde_json::from_slice::<Value>(&buffer) {
                Ok(message) => {
                    if let Some(response) = lsp_server_request_response(&message) {
                        tracing::debug!(
                            "Responding to LSP server request: {}",
                            message
                                .get("method")
                                .and_then(|value| value.as_str())
                                .unwrap_or("unknown")
                        );
                        if server_response_tx
                            .send(LspOutgoingMessage::ServerResponse(response))
                            .await
                            .is_err()
                        {
                            tracing::warn!("LSP writer closed before server response");
                            break;
                        }
                        continue;
                    }

                    if let Some(id) = message.get("id").and_then(Value::as_u64) {
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
                    } else if let Some(method) = message.get("method").and_then(|v| v.as_str()) {
                        tracing::debug!("Received LSP notification: {}", method);
                        let notification = LspServerNotification {
                            session_key: Some(session_key.clone()),
                            method: method.to_string(),
                            params: message.get("params").cloned().unwrap_or(Value::Null),
                        };
                        if let Err(error) = app_handle.emit(LSP_NOTIFICATION_EVENT, notification) {
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
        // A cancellation command can be scheduled before its request has
        // reached this single writer. Remember that small race window so
        // the superseded request is never written afterwards.
        let mut cancelled_before_send = HashSet::<u64>::new();

        while let Some(msg) = message_rx.recv().await {
            // Serialize message
            let (json, id_opt, response_tx_opt) = match msg {
                LspOutgoingMessage::Request(req, tx) => {
                    if cancelled_before_send.remove(&req.id) {
                        let _ = tx.send(Err(anyhow::anyhow!("LSP request cancelled")));
                        continue;
                    }
                    (serde_json::to_string(&req), Some(req.id), Some(tx))
                }
                LspOutgoingMessage::Notification(notif) => {
                    (serde_json::to_string(&notif), None, None)
                }
                LspOutgoingMessage::ServerResponse(response) => {
                    (serde_json::to_string(&response), None, None)
                }
                LspOutgoingMessage::CancelRequest(id) => {
                    let mut pending = pending_responses_for_writer.lock().await;
                    let was_pending = pending.remove(&id).is_some();
                    drop(pending);
                    if !was_pending {
                        if cancelled_before_send.len() >= 1_024 {
                            cancelled_before_send.clear();
                        }
                        cancelled_before_send.insert(id);
                    }
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
                if !can_register_pending_response(pending.len()) {
                    drop(pending);
                    let _ = tx.send(Err(anyhow::anyhow!(
                            "LSP server has too many in-flight requests; wait for an existing request to finish"
                        )));
                    continue;
                }
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
        can_register_pending_response, cancel_request_notification, completion_client_capabilities,
        content_length_from_lsp_header, lsp_server_request_response, read_lsp_header_line,
        server_supports_completion_resolve, validate_lsp_message_size, LspRequestTokens,
        MAX_LSP_HEADER_LINE_BYTES, MAX_LSP_MESSAGE_BYTES, MAX_PENDING_LSP_RESPONSES,
    };
    use std::io::Cursor;
    use tokio::io::BufReader;

    #[test]
    fn timeout_cancellation_uses_the_standard_lsp_notification() {
        let notification = cancel_request_notification(42);
        assert_eq!(notification.method, "$/cancelRequest");
        assert_eq!(notification.params["id"], 42);
    }

    #[test]
    fn pending_response_limit_rejects_only_new_overflow_requests() {
        assert!(can_register_pending_response(0));
        assert!(can_register_pending_response(MAX_PENDING_LSP_RESPONSES - 1));
        assert!(!can_register_pending_response(MAX_PENDING_LSP_RESPONSES));
        assert!(!can_register_pending_response(
            MAX_PENDING_LSP_RESPONSES + 1
        ));
    }

    #[tokio::test]
    async fn lsp_header_lines_are_bounded_before_collecting_untrusted_output() {
        let mut reader = BufReader::new(Cursor::new(vec![b'x'; MAX_LSP_HEADER_LINE_BYTES + 1]));
        let mut line = Vec::new();
        let error = read_lsp_header_line(&mut reader, &mut line)
            .await
            .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert_eq!(line.len(), MAX_LSP_HEADER_LINE_BYTES);
        assert!(line.capacity() <= MAX_LSP_HEADER_LINE_BYTES);

        let mut reader = BufReader::new(Cursor::new(b"Content-Length: 2\r\n".to_vec()));
        assert_eq!(
            read_lsp_header_line(&mut reader, &mut line).await.unwrap(),
            b"Content-Length: 2\r\n".len()
        );
        assert_eq!(line, b"Content-Length: 2\r\n");
    }

    #[test]
    fn request_tokens_cancel_active_and_not_yet_registered_requests() {
        let mut tokens = LspRequestTokens::default();
        assert!(tokens.register("active".to_string(), 7).unwrap());
        assert_eq!(tokens.cancel("active"), Some(7));

        assert_eq!(tokens.cancel("early"), None);
        assert!(!tokens.register("early".to_string(), 8).unwrap());
        assert!(tokens.register("next".to_string(), 9).unwrap());
        tokens.clear("next", 9);
        assert_eq!(tokens.cancel("next"), None);
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

    #[test]
    fn lsp_content_length_header_is_case_insensitive_and_allows_other_headers() {
        assert_eq!(
            content_length_from_lsp_header("content-length: 42\r\n")
                .expect("lowercase content length"),
            Some(42)
        );
        assert_eq!(
            content_length_from_lsp_header(
                "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n"
            )
            .expect("optional content type"),
            None
        );
        assert!(content_length_from_lsp_header("Content-Length: invalid\r\n").is_err());
        assert!(content_length_from_lsp_header("Content-Length: 0\r\n").is_err());
    }

    #[test]
    fn server_configuration_requests_receive_one_value_per_item() {
        let response = lsp_server_request_response(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": "server-1",
            "method": "workspace/configuration",
            "params": { "items": [{ "section": "sql" }, { "section": "editor" }] }
        }))
        .expect("server request response");

        assert_eq!(response["id"], "server-1");
        assert_eq!(response["result"], serde_json::json!([null, null]));
    }

    #[test]
    fn server_workspace_edits_are_rejected_without_mutating_user_files() {
        let response = lsp_server_request_response(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "workspace/applyEdit",
            "params": { "edit": { "changes": {} } }
        }))
        .expect("server request response");

        assert_eq!(response["result"]["applied"], false);
        assert!(response["result"]["failureReason"].is_string());
    }

    #[test]
    fn unknown_server_requests_receive_method_not_found() {
        let response = lsp_server_request_response(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 8,
            "method": "workspace/unknown"
        }))
        .expect("server request response");

        assert_eq!(response["error"]["code"], -32601);
        assert!(lsp_server_request_response(&serde_json::json!({
            "jsonrpc": "2.0",
            "method": "window/logMessage"
        }))
        .is_none());
    }
}
