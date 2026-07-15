use crate::{
    agent::{
        AgentActionAccepted, AgentAnswerClarificationRequest, AgentApproveActionRequest,
        AgentCancelTurnRequest, AgentHostManager, AgentHostStatus, AgentProjectStateCleared,
        AgentTurnAccepted, AgentTurnRequest,
    },
    core::protocol::CommandError,
};
use tauri::State;

fn agent_error(code: &'static str, error: anyhow::Error) -> CommandError {
    CommandError::new(code, error.to_string(), true, None)
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
pub async fn agent_clear_project_state(
    manager: State<'_, AgentHostManager>,
    project_id: String,
) -> Result<AgentProjectStateCleared, CommandError> {
    manager
        .clear_project_state(&project_id)
        .await
        .map_err(|error| agent_error("AGENT_CLEAR_STATE_FAILED", error))
}
