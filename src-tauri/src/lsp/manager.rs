use anyhow::{Context, Result};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::protocol::*;

/// LSP Server Manager
/// Manages the lifecycle of the sql-lsp process
pub struct LspServerManager {
    process: Arc<Mutex<Option<Child>>>,
    request_id: Arc<Mutex<u64>>,
    binary_path: String,
}

impl LspServerManager {
    /// Create a new LSP server manager
    pub fn new(binary_path: String) -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            request_id: Arc::new(Mutex::new(0)),
            binary_path,
        }
    }

    /// Start the LSP server process
    pub async fn start(&self) -> Result<()> {
        let mut process_lock = self.process.lock().await;

        // Kill existing process if running
        if let Some(mut child) = process_lock.take() {
            let _ = child.kill().await;
        }

        // Spawn new LSP server process
        let child = Command::new(&self.binary_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn LSP server process")?;

        tracing::info!("LSP server started with PID: {:?}", child.id());

        *process_lock = Some(child);
        Ok(())
    }

    /// Stop the LSP server process
    pub async fn stop(&self) -> Result<()> {
        let mut process_lock = self.process.lock().await;

        if let Some(mut child) = process_lock.take() {
            // Send shutdown request
            if let Some(stdin) = child.stdin.as_mut() {
                let shutdown_request = LspRequest {
                    jsonrpc: "2.0".to_string(),
                    id: 0,
                    method: "shutdown".to_string(),
                    params: serde_json::Value::Null,
                };

                let message = serde_json::to_string(&shutdown_request)?;
                let content = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
                let _ = stdin.write_all(content.as_bytes()).await;
            }

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

    /// Send a request to the LSP server
    pub async fn send_request(
        &self,
        method: String,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let process_lock = self.process.lock().await;

        if let Some(child) = process_lock.as_ref() {
            if let Some(stdin) = child.stdin.as_ref() {
                // Generate unique request ID
                let mut id_lock = self.request_id.lock().await;
                *id_lock += 1;
                let id = *id_lock;
                drop(id_lock);

                // Create LSP request
                let request = LspRequest {
                    jsonrpc: "2.0".to_string(),
                    id,
                    method,
                    params,
                };

                // Send request with LSP message format
                let message = serde_json::to_string(&request)?;
                let content = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);

                // Note: We need to clone stdin to write, but this is a simplified version
                // In production, we'd use channels or a dedicated writer task
                tracing::debug!("Sending LSP request: {}", content);

                // TODO: Implement proper async communication and response handling
                // For now, this is a placeholder structure

                Ok(serde_json::Value::Null)
            } else {
                anyhow::bail!("LSP server stdin not available")
            }
        } else {
            anyhow::bail!("LSP server not running")
        }
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

impl Drop for LspServerManager {
    fn drop(&mut self) {
        // Note: async drop is not stable yet, so we can't call stop() here
        // In practice, the process will be killed when the parent process exits
        tracing::info!("LspServerManager dropped");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_manager_creation() {
        let manager = LspServerManager::new("/path/to/sql-lsp".to_string());
        assert_eq!(manager.binary_path(), "/path/to/sql-lsp");
        assert!(!manager.is_running().await);
    }
}
