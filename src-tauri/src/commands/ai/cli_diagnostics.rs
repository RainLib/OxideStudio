/// Provider CLIs produce rich but provider-specific diagnostics. Preserve the
/// raw diagnostic as the response message while exposing a small, stable code
/// family to the desktop UI so recovery does not depend on English wording.
pub(super) fn cli_operation_error_code(fallback: &'static str, diagnostic: &str) -> &'static str {
    let value = diagnostic.to_ascii_lowercase();
    if value.contains("not authenticated")
        || value.contains("not logged in")
        || value.contains("login required")
        || value.contains("sign in")
        || value.contains("unauthorized")
        || value.contains("authentication failed")
    {
        "AI_CLI_AUTH_REQUIRED"
    } else if value.contains("not installed")
        || value.contains("not found")
        || value.contains("no such file")
        || value.contains("failed to start")
    {
        "AI_CLI_NOT_INSTALLED"
    } else if value.contains("timed out") || value.contains("timeout") {
        "AI_CLI_TIMEOUT"
    } else if value.contains("acp")
        || value.contains("app-server")
        || value.contains("protocol")
        || value.contains("stream-json")
    {
        "AI_CLI_PROTOCOL_ERROR"
    } else {
        fallback
    }
}
