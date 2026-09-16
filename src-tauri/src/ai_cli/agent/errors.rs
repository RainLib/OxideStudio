use crate::ai_cli::{runtime::bounded_diagnostic, CliProviderKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliAgentError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

pub fn classify_cli_error(provider: CliProviderKind, message: &str) -> CliAgentError {
    let message = bounded_diagnostic(message);
    let lower = message.to_ascii_lowercase();
    let (code, retryable) = if lower.contains("cancel") {
        ("cli_cancelled", true)
    } else if lower.contains("timed out") || lower.contains("timeout") {
        ("cli_timeout", true)
    } else if lower.contains("not authenticated")
        || lower.contains("not logged in")
        || lower.contains("unauthorized")
        || lower.contains("sign in")
        || lower.contains("login required")
    {
        ("cli_authentication_required", false)
    } else if lower.contains("mcp") || lower.contains("oxide-agent") {
        ("cli_mcp_startup_failed", true)
    } else if lower.contains("not installed")
        || lower.contains("not available on path")
        || lower.contains("failed to start")
        || lower.contains("was not found")
    {
        ("cli_not_installed", false)
    } else if lower.contains("jsonl") || lower.contains("protocol") {
        ("cli_protocol_error", true)
    } else {
        ("cli_execution_failed", true)
    };
    CliAgentError {
        code,
        message: if message.is_empty() {
            format!("{} exited without a diagnostic", provider.display_name())
        } else {
            message
        },
        retryable,
    }
}
