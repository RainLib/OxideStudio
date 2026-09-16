use crate::{
    agent::{
        bridge::{BRIDGE_ENDPOINT_ENV, BRIDGE_TOKEN_ENV},
        protocol::{AgentProfile, AgentProviderConfig, AgentProviderKind, AgentTurnRequest},
    },
    ai_cli::CliProviderKind,
};
use anyhow::{anyhow, Context, Result};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};

pub(super) const DEFAULT_CLI_TIMEOUT: Duration = Duration::from_secs(30 * 60);
// CLI turns regularly spend more than 30 seconds reasoning or waiting for an
// approved tool. Treat the provider timeout as an inactivity timeout and do
// not inherit the short HTTP request timeout from legacy settings.
pub(super) const MIN_CLI_TIMEOUT_MS: u64 = 5 * 60 * 1_000;
pub(super) const MAX_CLI_TIMEOUT_MS: u64 = 2 * 60 * 60 * 1_000;

pub(super) fn provider_kind(kind: AgentProviderKind) -> Result<CliProviderKind> {
    match kind {
        AgentProviderKind::CodexCli => Ok(CliProviderKind::CodexCli),
        AgentProviderKind::CodebuddyCli => Ok(CliProviderKind::CodebuddyCli),
        AgentProviderKind::OpenaiCompatible => Err(anyhow!("HTTP provider is not a CLI provider")),
    }
}

pub(super) fn build_prompt(request: &AgentTurnRequest, full_access: bool) -> String {
    let current_request = request.prompt.trim();
    // Native slash commands must be the first token in the provider input.
    // Runtime tool manifests, sandboxing and Desktop approval leases still
    // enforce the Oxide boundary for commands that can invoke tools.
    if current_request.starts_with('/') {
        return current_request.to_string();
    }
    let profile = match request.profile {
        AgentProfile::Chat => "Chat (strictly read-only)",
        AgentProfile::Plan => "Plan (strictly read-only)",
        AgentProfile::Agent => "Agent (database changes require Desktop approval)",
    };
    let access_boundary = if full_access {
        "The user explicitly enabled Full access. Native shell, filesystem, project editing, and network tools may run without further approval. "
    } else {
        "Use only the tools provided by the `oxide` MCP server for workspace and database access. Do not use shell, filesystem, web, or project editing tools. "
    };
    let mut prompt = format!(
        "You are the OxideStudio database assistant running in {profile} mode.\n\
{access_boundary}\
Never ask the user to approve inside the CLI: OxideStudio Desktop owns database approvals. \
A database mutation is permitted only when `query.executeApproved` is present and Desktop returns a successful receipt. \
If a mutation result is unknown, tell the user to verify it manually and do not retry it. \
Do not reveal hidden reasoning; provide concise conclusions.\n\n"
    );
    if !request.messages.is_empty() {
        prompt.push_str("Conversation context:\n");
        for message in &request.messages {
            prompt.push_str(&format!("{}: {}\n", message.role, message.content));
        }
        prompt.push('\n');
    }
    prompt.push_str("Current request:\n");
    prompt.push_str(&request.prompt);
    prompt
}

pub(super) fn codex_args(
    _provider: &AgentProviderConfig,
    oxide_agent: &Path,
    request: &AgentTurnRequest,
    full_access: bool,
) -> Vec<String> {
    let mut args = vec![
        "app-server".to_string(),
        "-c".to_string(),
        "mcp_servers={}".to_string(),
    ];
    if !full_access {
        args.extend([
            "-c".to_string(),
            "features.shell_tool=false".to_string(),
            "-c".to_string(),
            "web_search=\"disabled\"".to_string(),
        ]);
    }
    args.extend([
        "-c".to_string(),
        format!(
            "mcp_servers.oxide.command={}",
            toml_string(&oxide_agent.to_string_lossy())
        ),
        "-c".to_string(),
        "mcp_servers.oxide.args=[\"mcp\",\"bridge\"]".to_string(),
        "-c".to_string(),
        format!(
            "mcp_servers.oxide.env_vars=[{},{}]",
            toml_string(BRIDGE_ENDPOINT_ENV),
            toml_string(BRIDGE_TOKEN_ENV)
        ),
        "-c".to_string(),
        "mcp_servers.oxide.required=true".to_string(),
        "-c".to_string(),
        "mcp_servers.oxide.startup_timeout_sec=20".to_string(),
        "-c".to_string(),
        "mcp_servers.oxide.tool_timeout_sec=120".to_string(),
        "-c".to_string(),
        "mcp_servers.oxide.default_tools_approval_mode=\"approve\"".to_string(),
        "-c".to_string(),
        format!(
            "mcp_servers.oxide.enabled_tools={}",
            serde_json::to_string(
                &request
                    .tools
                    .iter()
                    .map(|tool| &tool.name)
                    .collect::<Vec<_>>()
            )
            .unwrap_or_else(|_| "[]".to_string())
        ),
    ]);
    args
}

pub(super) fn non_default(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && !value.eq_ignore_ascii_case("default")).then(|| value.to_string())
}

pub(super) fn codebuddy_args(
    provider: &AgentProviderConfig,
    oxide_agent: &Path,
    request: &AgentTurnRequest,
    working_directory: &Path,
) -> Result<Vec<String>> {
    let config_path = working_directory.join("oxide-mcp.json");
    let config = json!({
        "mcpServers": {
            "oxide": {
                "command": oxide_agent,
                "args": ["mcp", "bridge"]
            }
        }
    });
    std::fs::write(&config_path, serde_json::to_vec(&config)?)
        .context("failed to create isolated CodeBuddy MCP configuration")?;
    let tool_names = request
        .tools
        .iter()
        .map(|tool| format!("mcp__oxide__{}", tool.name))
        .collect::<Vec<_>>();
    let permission_mode = if request.profile == AgentProfile::Plan {
        "plan"
    } else {
        "dontAsk"
    };
    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--input-format".to_string(),
        "text".to_string(),
        "--no-session-persistence".to_string(),
        "--permission-mode".to_string(),
        permission_mode.to_string(),
        "--mcp-config".to_string(),
        config_path.to_string_lossy().into_owned(),
        "--strict-mcp-config".to_string(),
        "--settings".to_string(),
        "{\"enabledMcpjsonServers\":[\"oxide\"]}".to_string(),
        "--setting-sources".to_string(),
        "user".to_string(),
    ];
    if !tool_names.is_empty() {
        args.extend([
            "--tools".to_string(),
            tool_names
                .iter()
                .map(|tool| format!("NoDefer({tool})"))
                .collect::<Vec<_>>()
                .join(","),
        ]);
        args.push("--allowedTools".to_string());
        args.extend(tool_names);
    }
    let model = provider.model.trim();
    if !model.is_empty() && !model.eq_ignore_ascii_case("default") {
        args.extend(["--model".to_string(), model.to_string()]);
    }
    if let Some(effort) = provider
        .reasoning_effort
        .as_deref()
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && !value.eq_ignore_ascii_case("default")
                && !value.eq_ignore_ascii_case("enabled")
        })
    {
        args.extend(["--effort".to_string(), effort.to_string()]);
    }
    Ok(args)
}

pub(super) fn resolve_oxide_agent_binary(app: &AppHandle) -> Result<PathBuf> {
    let executable = if cfg!(windows) {
        "oxide-agent.exe"
    } else {
        "oxide-agent"
    };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("OXIDE_AGENT_BINARY") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
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
    let target_extension = if cfg!(windows) { ".exe" } else { "" };
    candidates.push(
        manifest
            .join("binaries")
            .join(format!("oxide-agent-{target}{target_extension}")),
    );
    candidates
        .into_iter()
        .find(|path| path.metadata().is_ok_and(|metadata| metadata.is_file()))
        .ok_or_else(|| anyhow!("the bundled oxide-agent MCP bridge executable was not found"))
}

fn toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}
