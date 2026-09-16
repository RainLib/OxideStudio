use super::host_errors::HostCallError;
use super::session_state::{AgentHostInner, AgentLaunch};
use super::tool_manifest::REQUIRED_CAPABILITIES;
use crate::agent::protocol::read_json_frame;
use crate::agent::protocol::AGENT_HOST_MAX_FRAME_BYTES;
use crate::agent::protocol::AGENT_HOST_PROTOCOL_VERSION;
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Weak;
use tauri::AppHandle;
use tauri::Manager;
use tokio::io::AsyncBufReadExt;
use tokio::io::BufReader;

pub(super) const HANDSHAKE_TIMEOUT_MILLIS: i64 = 10_000;

pub(super) async fn read_sidecar_stdout(
    inner: Weak<AgentHostInner>,
    generation: u64,
    stdout: tokio::process::ChildStdout,
) {
    let mut reader = BufReader::new(stdout);
    loop {
        match read_json_frame(&mut reader).await {
            Ok(Some(message)) => {
                let Some(inner) = inner.upgrade() else {
                    return;
                };
                inner.handle_protocol_message(generation, message).await;
            }
            Ok(None) => {
                if let Some(inner) = inner.upgrade() {
                    inner
                        .reset_failed_generation(
                            Some(generation),
                            "DeepAgents sidecar closed its protocol stream",
                        )
                        .await;
                }
                return;
            }
            Err(error) => {
                if let Some(inner) = inner.upgrade() {
                    inner
                        .reset_failed_generation(Some(generation), &error.to_string())
                        .await;
                }
                return;
            }
        }
    }
}

pub(super) async fn read_sidecar_stderr(stderr: tokio::process::ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let safe = sanitize_log_line(&line);
        if !safe.is_empty() {
            tracing::warn!("DeepAgents sidecar: {safe}");
        }
    }
}

pub(super) fn validate_handshake(value: Value) -> std::result::Result<Vec<String>, HostCallError> {
    if value.get("protocolVersion").and_then(Value::as_u64)
        != Some(AGENT_HOST_PROTOCOL_VERSION as u64)
    {
        return Err(HostCallError::Transport(
            "DeepAgents sidecar protocol version is incompatible".to_string(),
        ));
    }
    if value.get("runtime").and_then(Value::as_str) != Some("deepagents-typescript") {
        return Err(HostCallError::Transport(
            "DeepAgents sidecar reported an unsupported runtime".to_string(),
        ));
    }
    if value
        .get("runtimeVersion")
        .and_then(Value::as_str)
        .is_none()
        || value.get("nodeVersion").and_then(Value::as_str).is_none()
        || value
            .get("maxFrameBytes")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            < AGENT_HOST_MAX_FRAME_BYTES as u64
    {
        return Err(HostCallError::Transport(
            "DeepAgents sidecar handshake is incomplete".to_string(),
        ));
    }
    let capabilities = value
        .get("capabilities")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            HostCallError::Transport("DeepAgents sidecar capabilities are missing".to_string())
        })?
        .iter()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let available = capabilities
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let missing = REQUIRED_CAPABILITIES
        .iter()
        .copied()
        .filter(|capability| !available.contains(capability))
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(HostCallError::Transport(format!(
            "DeepAgents sidecar is missing required capabilities: {}",
            missing.join(", ")
        )));
    }
    Ok(capabilities)
}

pub(super) fn find_agent_binary(app: &AppHandle) -> Option<PathBuf> {
    let executable = executable_name();
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("OXIDE_AGENT_HOST_BINARY") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join(&executable));
            candidates.push(parent.join("resources").join(&executable));
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join(&executable));
        candidates.push(resources.join("binaries").join(&executable));
    }
    let development_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    candidates.push(development_dir.join(&executable));
    let target = env!("TAURI_ENV_TARGET_TRIPLE");
    let target_extension = if cfg!(windows) { ".exe" } else { "" };
    candidates.push(development_dir.join(format!("oxide-agent-host-{target}{target_extension}")));
    candidates.into_iter().find(|path| is_regular_file(path))
}

pub(super) fn find_oxide_agent_cli_binary(app: &AppHandle) -> Option<PathBuf> {
    let executable = if cfg!(windows) {
        "oxide-agent.exe"
    } else {
        "oxide-agent"
    };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("OXIDE_AGENT_BINARY") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join(executable));
            candidates.push(parent.join("resources").join(executable));
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join(executable));
        candidates.push(resources.join("binaries").join(executable));
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("target").join("debug").join(executable));
    candidates.push(manifest.join("target").join("release").join(executable));
    let target = env!("TAURI_ENV_TARGET_TRIPLE");
    let extension = if cfg!(windows) { ".exe" } else { "" };
    candidates.push(
        manifest
            .join("binaries")
            .join(format!("oxide-agent-{target}{extension}")),
    );
    candidates.into_iter().find(|path| is_regular_file(path))
}

pub(super) fn find_agent_launch(app: &AppHandle) -> Option<AgentLaunch> {
    if let Some(binary) = find_agent_binary(app) {
        return Some(AgentLaunch {
            program: binary.clone(),
            arguments: Vec::new(),
            display_path: binary,
        });
    }

    #[cfg(debug_assertions)]
    {
        let bundle = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("agent-host")
            .join("dist")
            .join("oxide-agent-host.cjs");
        if is_regular_file(&bundle) {
            let node = std::env::var_os("OXIDE_AGENT_HOST_NODE")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("node"));
            return Some(AgentLaunch {
                program: node,
                arguments: vec![bundle.clone()],
                display_path: bundle,
            });
        }
    }

    None
}

pub(super) fn executable_name() -> String {
    if cfg!(windows) {
        "oxide-agent-host.exe".to_string()
    } else {
        "oxide-agent-host".to_string()
    }
}

pub(super) fn is_regular_file(path: &Path) -> bool {
    path.metadata()
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

pub(super) fn sanitize_log_line(line: &str) -> String {
    let line = line
        .chars()
        .filter(|character| !character.is_control() || *character == '\t')
        .take(512)
        .collect::<String>();
    let lower = line.to_ascii_lowercase();
    if lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("authorization")
        || lower.contains("bearer ")
    {
        "<redacted sidecar diagnostic>".to_string()
    } else {
        line
    }
}
