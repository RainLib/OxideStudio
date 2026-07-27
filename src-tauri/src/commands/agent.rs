use crate::{
    agent::{
        AgentActionAccepted, AgentAnswerClarificationRequest, AgentApproveActionRequest,
        AgentArtifactExportRequest, AgentArtifactExportResult, AgentArtifactReadRequest,
        AgentArtifactReadResult, AgentArtifactSearchRequest, AgentArtifactSearchResult,
        AgentCancelTurnRequest, AgentContextMetrics, AgentConversationSnapshot,
        AgentConversationSnapshotSaveRequest, AgentHostManager, AgentHostStatus,
        AgentProjectStateCleared, AgentTextAttachment, AgentTurnAccepted, AgentTurnRequest,
    },
    core::protocol::CommandError,
};
use std::{fs, path::Path};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

const MAX_AGENT_TEXT_ATTACHMENT_BYTES: u64 = 64 * 1024;
const AGENT_TEXT_ATTACHMENT_EXTENSIONS: &[&str] = &[
    "txt", "md", "sql", "json", "jsonl", "csv", "tsv", "yaml", "yml", "xml", "log", "toml", "ini",
    "conf", "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "kt", "sh",
];

fn agent_error(code: &'static str, error: anyhow::Error) -> CommandError {
    CommandError::new(code, error.to_string(), true, None)
}

#[tauri::command]
pub async fn agent_import_text_attachment(
    app: AppHandle,
) -> Result<Option<AgentTextAttachment>, CommandError> {
    let (sender, receiver) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Text and data files", AGENT_TEXT_ATTACHMENT_EXTENSIONS)
        .set_title("Attach a text file to the AI request")
        .pick_file(move |selection| {
            let _ = sender.send(selection);
        });
    let selection = receiver.await.map_err(|_| {
        CommandError::new(
            "AGENT_ATTACHMENT_DIALOG_FAILED",
            "The attachment dialog closed unexpectedly",
            true,
            None,
        )
    })?;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection.into_path().map_err(|error| {
        CommandError::new(
            "AGENT_ATTACHMENT_INVALID_PATH",
            error.to_string(),
            false,
            None,
        )
    })?;
    let metadata = fs::metadata(&path)
        .map_err(|error| agent_error("AGENT_ATTACHMENT_READ_FAILED", error.into()))?;
    if !metadata.is_file() {
        return Err(CommandError::new(
            "AGENT_ATTACHMENT_NOT_A_FILE",
            "The selected attachment is not a file",
            false,
            None,
        ));
    }
    if !agent_text_attachment_extension_allowed(&path) {
        return Err(CommandError::new(
            "AGENT_ATTACHMENT_UNSUPPORTED_TYPE",
            "Only supported text and data file types can be attached",
            false,
            None,
        ));
    }
    if metadata.len() > MAX_AGENT_TEXT_ATTACHMENT_BYTES {
        return Err(CommandError::new(
            "AGENT_ATTACHMENT_TOO_LARGE",
            format!(
                "AI text attachments are limited to {} KiB",
                MAX_AGENT_TEXT_ATTACHMENT_BYTES / 1024
            ),
            false,
            None,
        ));
    }
    let bytes = fs::read(&path)
        .map_err(|error| agent_error("AGENT_ATTACHMENT_READ_FAILED", error.into()))?;
    let content = String::from_utf8(bytes).map_err(|_| {
        CommandError::new(
            "AGENT_ATTACHMENT_NOT_TEXT",
            "The selected attachment is not valid UTF-8 text",
            false,
            None,
        )
    })?;
    let file_name = safe_agent_attachment_file_name(&path);

    Ok(Some(AgentTextAttachment {
        file_name,
        byte_count: content.len(),
        content,
    }))
}

fn agent_text_attachment_extension_allowed(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            AGENT_TEXT_ATTACHMENT_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn safe_agent_attachment_file_name(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment.txt");
    let sanitized = name
        .chars()
        .filter(|character| !character.is_control())
        .take(200)
        .collect::<String>();
    if sanitized.trim().is_empty() {
        "attachment.txt".to_string()
    } else {
        sanitized
    }
}

#[tauri::command]
pub async fn agent_start_turn(
    manager: State<'_, AgentHostManager>,
    request: AgentTurnRequest,
) -> Result<AgentTurnAccepted, CommandError> {
    manager
        .start_turn(request)
        .await
        .map_err(|error| agent_error("AGENT_START_FAILED", error))
}

#[tauri::command]
pub async fn agent_resume_turn(
    manager: State<'_, AgentHostManager>,
    request: AgentTurnRequest,
) -> Result<AgentTurnAccepted, CommandError> {
    manager
        .resume_turn(request)
        .await
        .map_err(|error| agent_error("AGENT_RESUME_FAILED", error))
}

#[tauri::command]
pub async fn agent_cancel_turn(
    manager: State<'_, AgentHostManager>,
    request: AgentCancelTurnRequest,
) -> Result<AgentActionAccepted, CommandError> {
    manager
        .cancel_turn(request)
        .await
        .map_err(|error| agent_error("AGENT_CANCEL_FAILED", error))
}

#[tauri::command]
pub async fn agent_answer_clarification(
    manager: State<'_, AgentHostManager>,
    request: AgentAnswerClarificationRequest,
) -> Result<AgentActionAccepted, CommandError> {
    manager
        .answer_clarification(request)
        .await
        .map_err(|error| agent_error("AGENT_CLARIFICATION_FAILED", error))
}

#[tauri::command]
pub async fn agent_approve_action(
    manager: State<'_, AgentHostManager>,
    request: AgentApproveActionRequest,
) -> Result<AgentActionAccepted, CommandError> {
    manager
        .approve_action(request)
        .await
        .map_err(|error| agent_error("AGENT_APPROVAL_FAILED", error))
}

#[tauri::command]
pub async fn agent_get_status(
    manager: State<'_, AgentHostManager>,
    provider_configured: Option<bool>,
) -> Result<AgentHostStatus, CommandError> {
    Ok(manager.status(provider_configured.unwrap_or(false)).await)
}

#[tauri::command]
pub async fn agent_get_context_metrics(
    manager: State<'_, AgentHostManager>,
    project_id: String,
) -> Result<AgentContextMetrics, CommandError> {
    manager
        .context_metrics(&project_id)
        .await
        .map_err(|error| agent_error("AGENT_CONTEXT_METRICS_FAILED", error))
}

#[tauri::command]
pub async fn agent_save_conversation_snapshot(
    manager: State<'_, AgentHostManager>,
    request: AgentConversationSnapshotSaveRequest,
) -> Result<AgentConversationSnapshot, CommandError> {
    manager
        .save_conversation_snapshot(request)
        .await
        .map_err(|error| agent_error("AGENT_CONVERSATION_SAVE_FAILED", error))
}

#[tauri::command]
pub async fn agent_load_conversation_snapshot(
    manager: State<'_, AgentHostManager>,
    project_id: String,
) -> Result<Option<AgentConversationSnapshot>, CommandError> {
    manager
        .load_conversation_snapshot(&project_id)
        .await
        .map_err(|error| agent_error("AGENT_CONVERSATION_LOAD_FAILED", error))
}

#[tauri::command]
pub async fn agent_read_artifact(
    manager: State<'_, AgentHostManager>,
    request: AgentArtifactReadRequest,
) -> Result<AgentArtifactReadResult, CommandError> {
    manager
        .read_artifact(request)
        .await
        .map_err(|error| agent_error("AGENT_ARTIFACT_READ_FAILED", error))
}

#[tauri::command]
pub async fn agent_search_artifact(
    manager: State<'_, AgentHostManager>,
    request: AgentArtifactSearchRequest,
) -> Result<AgentArtifactSearchResult, CommandError> {
    manager
        .search_artifact(request)
        .await
        .map_err(|error| agent_error("AGENT_ARTIFACT_SEARCH_FAILED", error))
}

#[tauri::command]
pub async fn agent_export_artifact(
    manager: State<'_, AgentHostManager>,
    request: AgentArtifactExportRequest,
) -> Result<AgentArtifactExportResult, CommandError> {
    manager
        .export_artifact(request)
        .await
        .map_err(|error| agent_error("AGENT_ARTIFACT_EXPORT_FAILED", error))
}

#[tauri::command]
pub async fn agent_clear_project_state(
    manager: State<'_, AgentHostManager>,
    project_id: String,
) -> Result<AgentProjectStateCleared, CommandError> {
    manager
        .clear_project_state(&project_id)
        .await
        .map_err(|error| agent_error("AGENT_CLEAR_STATE_FAILED", error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_attachment_types_are_explicit_and_case_insensitive() {
        assert!(agent_text_attachment_extension_allowed(Path::new(
            "query.SQL"
        )));
        assert!(agent_text_attachment_extension_allowed(Path::new(
            "data.jsonl"
        )));
        assert!(!agent_text_attachment_extension_allowed(Path::new(
            "archive.zip"
        )));
        assert!(!agent_text_attachment_extension_allowed(Path::new(
            "README"
        )));
    }

    #[test]
    fn text_attachment_names_cannot_inject_prompt_delimiters_with_controls() {
        assert_eq!(
            safe_agent_attachment_file_name(Path::new("report\n---.sql")),
            "report---.sql"
        );
    }
}
