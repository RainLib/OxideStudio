use super::identity_helpers::{bounded_text, now_millis};
use serde_json::json;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug)]
pub(super) enum HostCallError {
    Transport(String),
    Remote { code: i64, message: String },
}

impl HostCallError {
    pub(super) fn is_transport(&self) -> bool {
        matches!(self, Self::Transport(_))
    }

    pub(super) fn safe_message(&self) -> String {
        match self {
            Self::Transport(message) => bounded_text(message, 2_000),
            Self::Remote { message, .. } => bounded_text(message, 2_000),
        }
    }
}

impl std::fmt::Display for HostCallError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport(message) => write!(formatter, "{message}"),
            Self::Remote { code, message, .. } => {
                write!(formatter, "agent host RPC error {code}: {message}")
            }
        }
    }
}

impl std::error::Error for HostCallError {}

#[derive(Debug)]
pub(super) struct SidecarRequestError {
    pub(super) code: i64,
    pub(super) message: String,
    pub(super) data: Option<Value>,
}

impl SidecarRequestError {
    pub(super) fn invalid_params(message: impl Into<String>) -> Self {
        Self {
            code: -32_602,
            message: bounded_text(&message.into(), 2_000),
            data: Some(json!({"kind":"invalid_params","recoverable":false})),
        }
    }

    pub(super) fn method_not_found(method: &str) -> Self {
        Self {
            code: -32_601,
            message: format!("unsupported sidecar method: {}", bounded_text(method, 200)),
            data: None,
        }
    }

    pub(super) fn security(error: anyhow::Error) -> Self {
        Self {
            code: -32_051,
            message: bounded_text(&error.to_string(), 2_000),
            data: Some(json!({"kind":"security_validation_failed","recoverable":false})),
        }
    }

    pub(super) fn tool(message: impl Into<String>) -> Self {
        Self {
            code: -32_062,
            message: bounded_text(&message.into(), 2_000),
            data: Some(json!({"kind":"tool_execution_failed","recoverable":true})),
        }
    }

    pub(super) fn storage(error: anyhow::Error) -> Self {
        Self {
            code: -32_070,
            message: bounded_text(&error.to_string(), 2_000),
            data: Some(json!({"kind":"encrypted_storage_failed","recoverable":true})),
        }
    }

    pub(super) fn from_json(error: serde_json::Error) -> Self {
        Self::tool(error.to_string())
    }
}

pub(super) fn deadline_duration(deadline: i64) -> std::result::Result<Duration, HostCallError> {
    let remaining = deadline.saturating_sub(now_millis());
    if remaining <= 0 {
        return Err(HostCallError::Remote {
            code: -32_008,
            message: "agent request deadline has expired".to_string(),
        });
    }
    Ok(Duration::from_millis(remaining as u64))
}
