use super::session::{current_manager, LspState};
use tauri::State;

pub(super) const MAX_LSP_DOCUMENT_BYTES: usize = 4 * 1024 * 1024;

/// Send textDocument/didOpen notification
#[tauri::command]
pub async fn lsp_did_open(
    uri: String,
    language_id: String,
    version: i32,
    text: String,
    session_key: Option<String>,
    state: State<'_, LspState>,
) -> Result<(), String> {
    validate_lsp_document_size(&text)?;
    tracing::info!(
        "📄 LSP didOpen command called: uri={}, version={}",
        uri,
        version
    );
    tracing::debug!(
        "Text length: {} bytes, language: {}",
        text.len(),
        language_id
    );
    if let Ok(manager) = current_manager(&state, session_key.as_deref()).await {
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
                "languageId": language_id,
                "version": version,
                "text": text
            }
        });

        manager
            .send_notification("textDocument/didOpen".to_string(), params)
            .await
            .map_err(|e| format!("Failed to send didOpen: {}", e))?;

        tracing::debug!("✓ didOpen notification sent to LSP");
        Ok(())
    } else {
        // Silent failure if LSP not ready (common during startup)
        tracing::warn!("LSP not running, skipping didOpen");
        Ok(())
    }
}

/// Send textDocument/didChange notification
#[tauri::command]
pub async fn lsp_did_change(
    uri: String,
    version: i32,
    text: String,
    session_key: Option<String>,
    state: State<'_, LspState>,
) -> Result<(), String> {
    validate_lsp_document_size(&text)?;
    if let Ok(manager) = current_manager(&state, session_key.as_deref()).await {
        // sending full text sync for simplicity
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri,
                "version": version
            },
            "contentChanges": [
                {
                    "text": text
                }
            ]
        });

        manager
            .send_notification("textDocument/didChange".to_string(), params)
            .await
            .map_err(|e| format!("Failed to send didChange: {}", e))?;

        Ok(())
    } else {
        Ok(())
    }
}

pub(super) fn validate_lsp_document_size(text: &str) -> Result<(), String> {
    if text.len() > MAX_LSP_DOCUMENT_BYTES {
        return Err(format!(
            "LSP document exceeds the {} byte synchronization limit",
            MAX_LSP_DOCUMENT_BYTES
        ));
    }
    Ok(())
}

#[cfg(test)]
mod document_size_tests {
    use super::{validate_lsp_document_size, MAX_LSP_DOCUMENT_BYTES};

    #[test]
    fn accepts_bounded_lsp_documents() {
        assert!(validate_lsp_document_size("SELECT 1").is_ok());
    }

    #[test]
    fn rejects_oversized_lsp_documents() {
        let text = "x".repeat(MAX_LSP_DOCUMENT_BYTES + 1);
        assert!(validate_lsp_document_size(&text)
            .unwrap_err()
            .contains("synchronization limit"));
    }
}

/// Send textDocument/didClose notification
#[tauri::command]
pub async fn lsp_did_close(
    uri: String,
    session_key: Option<String>,
    state: State<'_, LspState>,
) -> Result<(), String> {
    if let Ok(manager) = current_manager(&state, session_key.as_deref()).await {
        let params = serde_json::json!({
            "textDocument": {
                "uri": uri
            }
        });

        manager
            .send_notification("textDocument/didClose".to_string(), params)
            .await
            .map_err(|e| format!("Failed to send didClose: {}", e))?;

        Ok(())
    } else {
        Ok(())
    }
}
