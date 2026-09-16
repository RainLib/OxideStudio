use super::session::{current_manager, LspState};
use serde_json::Value;
use tauri::State;

/// Send workspace/didChangeConfiguration notification
#[tauri::command]
pub async fn lsp_did_change_configuration(
    settings: Value,
    session_key: Option<String>,
    state: State<'_, LspState>,
) -> Result<String, String> {
    let manager = current_manager(&state, session_key.as_deref()).await?;

    tracing::debug!("Sending workspace/didChangeConfiguration");

    let params = serde_json::json!({
        "settings": settings
    });

    manager
        .send_notification("workspace/didChangeConfiguration".to_string(), params)
        .await
        .map_err(|e| format!("Failed to send notification: {}", e))?;

    Ok("Configuration updated".to_string())
}
