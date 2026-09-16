use crate::ai_cli::{CliAuthenticationPhase, CliAuthenticationStatus};
use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::sync::LazyLock;
use tokio::sync::{watch, Mutex};

pub(super) struct ManagedAuthenticationSession {
    pub(super) profile_id: String,
    pub(super) status: CliAuthenticationStatus,
    pub(super) cancellation: watch::Sender<bool>,
}

pub(super) static AUTHENTICATION_SESSIONS: LazyLock<
    Mutex<HashMap<String, ManagedAuthenticationSession>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub async fn authentication_status(session_id: &str) -> Result<CliAuthenticationStatus> {
    AUTHENTICATION_SESSIONS
        .lock()
        .await
        .get(session_id)
        .map(|session| session.status.clone())
        .ok_or_else(|| anyhow!("authentication session is no longer available"))
}

pub async fn cancel_authentication(session_id: &str) -> Result<CliAuthenticationStatus> {
    let mut sessions = AUTHENTICATION_SESSIONS.lock().await;
    let session = sessions
        .get_mut(session_id)
        .ok_or_else(|| anyhow!("authentication session is no longer available"))?;
    if !session.status.phase.is_terminal() {
        let _ = session.cancellation.send(true);
        session.status.phase = CliAuthenticationPhase::Cancelled;
        session.status.message =
            "Sign-in was cancelled. Your existing CLI credentials were not changed.".to_string();
    }
    Ok(session.status.clone())
}

pub(super) async fn update_authentication(
    session_id: &str,
    phase: CliAuthenticationPhase,
    message: impl Into<String>,
) {
    if let Some(session) = AUTHENTICATION_SESSIONS.lock().await.get_mut(session_id) {
        if !session.status.phase.is_terminal() {
            session.status.phase = phase;
            session.status.message = message.into();
        }
    }
}

pub(super) async fn finish_authentication_error(session_id: &str, error: &str) {
    let mut sessions = AUTHENTICATION_SESSIONS.lock().await;
    let Some(session) = sessions.get_mut(session_id) else {
        return;
    };
    if session.status.phase.is_terminal() {
        return;
    }
    if error.contains("authentication cancelled") {
        session.status.phase = CliAuthenticationPhase::Cancelled;
        session.status.message =
            "Sign-in was cancelled. Your existing CLI credentials were not changed.".to_string();
    } else {
        session.status.phase = CliAuthenticationPhase::Failed;
        session.status.message = error.to_string();
    }
}
