use super::authentication_state::set_authentication_browser_url;
use crate::ai_cli::runtime::{apply_environment, isolated_working_directory, CliCommandSpec};
use anyhow::{anyhow, Context, Result};
use std::collections::BTreeMap;
use std::process::Stdio;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdin};
use url::Url;

pub(super) async fn start_codex_app_server(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<(
    tempfile::TempDir,
    Child,
    ChildStdin,
    tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
)> {
    let cwd = isolated_working_directory()?;
    let mut process = command.command();
    process
        .arg("app-server")
        .current_dir(cwd.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    apply_environment(&mut process, environment);
    let mut child = process
        .spawn()
        .context("failed to start Codex app-server authentication")?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("Codex authentication stdin is unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Codex authentication stdout is unavailable"))?;
    Ok((cwd, child, stdin, BufReader::new(stdout).lines()))
}

pub(super) async fn start_codebuddy_acp(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<(
    tempfile::TempDir,
    Child,
    ChildStdin,
    tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
)> {
    let cwd = isolated_working_directory()?;
    let mut process = command.command();
    process
        .args([
            "--acp",
            "--acp-transport",
            "stdio",
            "--strict-mcp-config",
            "--mcp-config",
            r#"{"mcpServers":{}}"#,
            "--setting-sources",
            "user",
        ])
        .current_dir(cwd.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    apply_environment(&mut process, environment);
    let mut child = process
        .spawn()
        .context("failed to start CodeBuddy ACP authentication")?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("CodeBuddy authentication stdin is unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("CodeBuddy authentication stdout is unavailable"))?;
    Ok((cwd, child, stdin, BufReader::new(stdout).lines()))
}

pub(super) fn parse_authentication_url(value: &str) -> Result<Url> {
    let url = Url::parse(value).context("CLI provider returned an invalid authentication URL")?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(anyhow!(
            "CLI provider returned an unsupported authentication URL"
        ));
    }
    Ok(url)
}

pub(super) async fn open_authentication_url(
    app: &AppHandle,
    session_id: &str,
    value: &str,
) -> Result<bool> {
    let url = parse_authentication_url(value)?;
    if !set_authentication_browser_url(session_id, &url).await {
        return Err(anyhow!("authentication cancelled"));
    }
    // Keep the worker/callback alive when the system browser cannot be opened.
    // The renderer can reopen or copy this active session's link.
    Ok(app.opener().open_url(url.as_str(), None::<String>).is_ok())
}
