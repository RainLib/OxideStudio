use crate::{
    agent::{
        bridge::{PrivateBridgeSession, BRIDGE_ENDPOINT_ENV, BRIDGE_TOKEN_ENV},
        protocol::{AgentProfile, AgentProviderConfig, AgentProviderKind, AgentTurnRequest},
    },
    ai_cli::{
        runtime::{
            bounded_diagnostic, isolated_working_directory, resolve_command, CliCommandSpec,
        },
        CliProviderKind,
    },
    core::{cli_provider_secret::load_cli_environment, store::MetaStore},
};
use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use sha2::Digest;
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tempfile::TempDir;
use tokio::sync::{mpsc, watch};
use zeroize::Zeroize;

const DEFAULT_CLI_TIMEOUT: Duration = Duration::from_secs(30 * 60);
// CLI turns regularly spend more than 30 seconds reasoning or waiting for an
// approved tool. Treat the provider timeout as an inactivity timeout and do
// not inherit the short HTTP request timeout from legacy settings.
const MIN_CLI_TIMEOUT_MS: u64 = 5 * 60 * 1_000;
const MAX_CLI_TIMEOUT_MS: u64 = 2 * 60 * 60 * 1_000;

#[derive(Debug, Clone, PartialEq)]
pub enum CliAgentEvent {
    TextDelta(String),
    Activity {
        status: &'static str,
        label: String,
    },
    ToolStarted {
        call_id: String,
        tool_name: String,
    },
    ToolFinished {
        call_id: String,
        tool_name: String,
        success: bool,
        detail: Option<String>,
    },
    Usage {
        input_tokens: u64,
        output_tokens: u64,
    },
    End,
    Error(CliAgentError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliAgentError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

pub struct PreparedCliRun {
    pub provider: CliProviderKind,
    pub command: CliCommandSpec,
    pub args: Vec<String>,
    pub environment: BTreeMap<String, String>,
    pub stdin: Vec<u8>,
    pub timeout: Duration,
    protocol: CliRunProtocol,
    working_directory: PathBuf,
    _isolated_working_directory: TempDir,
    _bridge: PrivateBridgeSession,
}

enum CliRunProtocol {
    Jsonl,
    CodexAppServer {
        model: Option<String>,
        effort: Option<String>,
        service_tier: Option<String>,
        full_access: bool,
        collaboration_mode: &'static str,
    },
}

impl PreparedCliRun {
    pub fn working_directory(&self) -> &Path {
        &self.working_directory
    }

    pub async fn run(
        self,
        cancellation: watch::Receiver<bool>,
        events: mpsc::UnboundedSender<Value>,
    ) -> Result<crate::ai_cli::runtime::CliJsonlOutput> {
        match &self.protocol {
            CliRunProtocol::Jsonl => {
                crate::ai_cli::runtime::run_jsonl_process(
                    &self.command,
                    &self.args,
                    &self.environment,
                    self.working_directory(),
                    &self.stdin,
                    self.timeout,
                    cancellation,
                    move |event| {
                        let _ = events.send(event);
                    },
                )
                .await
            }
            CliRunProtocol::CodexAppServer {
                model,
                effort,
                service_tier,
                full_access,
                collaboration_mode,
            } => {
                crate::ai_cli::runtime::run_codex_app_server(
                    &self.command,
                    &self.args,
                    &self.environment,
                    self.working_directory(),
                    &self.stdin,
                    model.as_deref(),
                    effort.as_deref(),
                    service_tier.as_deref(),
                    *full_access,
                    collaboration_mode,
                    self.timeout,
                    cancellation,
                    move |event| {
                        let _ = events.send(event);
                    },
                )
                .await
            }
        }
    }
}

impl Drop for PreparedCliRun {
    fn drop(&mut self) {
        for value in self.environment.values_mut() {
            value.zeroize();
        }
        self.stdin.zeroize();
    }
}

#[derive(Debug)]
pub struct CliAgentEventParser {
    provider: CliProviderKind,
    tool_names: HashMap<String, String>,
    final_text: String,
    saw_terminal: bool,
    saw_error: bool,
    mutation_result_unknown: bool,
    last_usage: Option<(u64, u64)>,
}

impl CliAgentEventParser {
    pub fn new(provider: CliProviderKind) -> Self {
        Self {
            provider,
            tool_names: HashMap::new(),
            final_text: String::new(),
            saw_terminal: false,
            saw_error: false,
            mutation_result_unknown: false,
            last_usage: None,
        }
    }

    pub fn parse(&mut self, value: &Value) -> Vec<CliAgentEvent> {
        match self.provider {
            CliProviderKind::CodexCli => self.parse_codex(value),
            CliProviderKind::CodebuddyCli => self.parse_codebuddy(value),
        }
    }

    pub fn final_text(&self) -> &str {
        self.final_text.trim()
    }

    pub fn saw_terminal(&self) -> bool {
        self.saw_terminal
    }

    pub fn saw_error(&self) -> bool {
        self.saw_error
    }

    pub fn has_pending_mutation(&self) -> bool {
        self.tool_names
            .values()
            .any(|tool_name| tool_name == "query.executeApproved")
    }

    pub fn mutation_result_unknown(&self) -> bool {
        self.mutation_result_unknown
    }

    fn parse_codex(&mut self, value: &Value) -> Vec<CliAgentEvent> {
        if let Some(method) = value.get("method").and_then(Value::as_str) {
            return self.parse_codex_app_server(method, value.get("params").unwrap_or(value));
        }
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match event_type {
            "item.started" => {
                let item = value.get("item").unwrap_or(value);
                parse_codex_tool(item).map_or_else(Vec::new, |(call_id, tool_name)| {
                    self.tool_names.insert(call_id.clone(), tool_name.clone());
                    vec![CliAgentEvent::ToolStarted { call_id, tool_name }]
                })
            }
            "item.completed" => {
                let item = value.get("item").unwrap_or(value);
                match item.get("type").and_then(Value::as_str).unwrap_or_default() {
                    "agent_message" | "message" => {
                        let text = text_field(item, &["text", "content", "message"]);
                        self.push_text(text)
                    }
                    "reasoning" => vec![CliAgentEvent::Activity {
                        status: "running",
                        label: "Codex completed a reasoning step".to_string(),
                    }],
                    "mcp_tool_call" | "mcp_tool" | "tool_call" => {
                        let (call_id, parsed_name) = parse_codex_tool(item)
                            .unwrap_or_else(|| (fallback_call_id(item), "oxide tool".to_string()));
                        let tool_name = self.tool_names.remove(&call_id).unwrap_or(parsed_name);
                        let status = item
                            .get("status")
                            .and_then(Value::as_str)
                            .unwrap_or("completed");
                        let success = !matches!(status, "failed" | "error" | "cancelled");
                        let detail = safe_tool_detail(item);
                        self.mutation_result_unknown |= detail.is_some();
                        vec![CliAgentEvent::ToolFinished {
                            call_id,
                            tool_name,
                            success,
                            detail,
                        }]
                    }
                    _ => Vec::new(),
                }
            }
            "turn.completed" => {
                self.saw_terminal = true;
                let mut events = parse_usage(value);
                events.push(CliAgentEvent::End);
                events
            }
            "turn.failed" | "error" => {
                self.saw_terminal = true;
                self.saw_error = true;
                vec![CliAgentEvent::Error(classify_cli_error(
                    CliProviderKind::CodexCli,
                    &error_message(value),
                ))]
            }
            _ => Vec::new(),
        }
    }

    fn parse_codex_app_server(&mut self, method: &str, params: &Value) -> Vec<CliAgentEvent> {
        match method {
            "item/agentMessage/delta" => self.push_text(
                params
                    .get("delta")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            ),
            "item/started" => {
                let item = params.get("item").unwrap_or(params);
                parse_codex_tool(item).map_or_else(Vec::new, |(call_id, tool_name)| {
                    self.tool_names.insert(call_id.clone(), tool_name.clone());
                    vec![CliAgentEvent::ToolStarted { call_id, tool_name }]
                })
            }
            "item/completed" => {
                let item = params.get("item").unwrap_or(params);
                let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
                if matches!(item_type, "mcpToolCall" | "mcp_tool_call" | "mcpTool") {
                    let (call_id, parsed_name) = parse_codex_tool(item)
                        .unwrap_or_else(|| (fallback_call_id(item), "oxide tool".to_string()));
                    let tool_name = self.tool_names.remove(&call_id).unwrap_or(parsed_name);
                    let status = item
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("completed");
                    let success = !matches!(status, "failed" | "error" | "cancelled");
                    let detail = safe_tool_detail(item);
                    self.mutation_result_unknown |= detail.is_some();
                    vec![CliAgentEvent::ToolFinished {
                        call_id,
                        tool_name,
                        success,
                        detail,
                    }]
                } else {
                    Vec::new()
                }
            }
            "thread/tokenUsage/updated" => {
                let usage = params.pointer("/tokenUsage/last").unwrap_or(params);
                self.last_usage = Some((
                    usage
                        .get("inputTokens")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                    usage
                        .get("outputTokens")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                ));
                Vec::new()
            }
            "turn/completed" => {
                self.saw_terminal = true;
                let turn = params.get("turn").unwrap_or(params);
                let status = turn
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("failed");
                if status == "completed" {
                    let mut events = self
                        .last_usage
                        .take()
                        .map(|(input_tokens, output_tokens)| CliAgentEvent::Usage {
                            input_tokens,
                            output_tokens,
                        })
                        .into_iter()
                        .collect::<Vec<_>>();
                    events.push(CliAgentEvent::End);
                    events
                } else {
                    self.saw_error = true;
                    vec![CliAgentEvent::Error(classify_cli_error(
                        CliProviderKind::CodexCli,
                        &error_message(turn),
                    ))]
                }
            }
            "error" => {
                self.saw_error = true;
                vec![CliAgentEvent::Error(classify_cli_error(
                    CliProviderKind::CodexCli,
                    &error_message(params),
                ))]
            }
            _ => Vec::new(),
        }
    }

    fn parse_codebuddy(&mut self, value: &Value) -> Vec<CliAgentEvent> {
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "assistant" => {
                let content = value
                    .pointer("/message/content")
                    .or_else(|| value.get("content"));
                let mut events = Vec::new();
                for block in content_blocks(content) {
                    match block
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                    {
                        "text" => {
                            events.extend(self.push_text(text_field(block, &["text", "content"])))
                        }
                        "thinking" => events.push(CliAgentEvent::Activity {
                            status: "running",
                            label: "CodeBuddy completed a reasoning step".to_string(),
                        }),
                        "tool_use" => {
                            let call_id = block
                                .get("id")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                                .unwrap_or_else(|| fallback_call_id(block));
                            let tool_name = block
                                .get("name")
                                .and_then(Value::as_str)
                                .map(display_tool_name)
                                .unwrap_or_else(|| "oxide tool".to_string());
                            self.tool_names.insert(call_id.clone(), tool_name.clone());
                            events.push(CliAgentEvent::ToolStarted { call_id, tool_name });
                        }
                        _ => {}
                    }
                }
                events
            }
            "user" => {
                let content = value
                    .pointer("/message/content")
                    .or_else(|| value.get("content"));
                let mut events = Vec::new();
                for block in content_blocks(content) {
                    if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                        continue;
                    }
                    let call_id = block
                        .get("tool_use_id")
                        .or_else(|| block.get("id"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| fallback_call_id(block));
                    let tool_name = self
                        .tool_names
                        .remove(&call_id)
                        .unwrap_or_else(|| "oxide tool".to_string());
                    let success = !block
                        .get("is_error")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let detail = safe_tool_detail(block);
                    self.mutation_result_unknown |= detail.is_some();
                    events.push(CliAgentEvent::ToolFinished {
                        call_id,
                        tool_name,
                        success,
                        detail,
                    });
                }
                events
            }
            "result" => {
                self.saw_terminal = true;
                let subtype = value
                    .get("subtype")
                    .and_then(Value::as_str)
                    .unwrap_or("success");
                if matches!(subtype, "success" | "completed") {
                    let mut events = parse_usage(value);
                    events.push(CliAgentEvent::End);
                    events
                } else {
                    self.saw_error = true;
                    vec![CliAgentEvent::Error(classify_cli_error(
                        CliProviderKind::CodebuddyCli,
                        &error_message(value),
                    ))]
                }
            }
            "error" => {
                self.saw_terminal = true;
                self.saw_error = true;
                vec![CliAgentEvent::Error(classify_cli_error(
                    CliProviderKind::CodebuddyCli,
                    &error_message(value),
                ))]
            }
            _ => Vec::new(),
        }
    }

    fn push_text(&mut self, text: Option<String>) -> Vec<CliAgentEvent> {
        let Some(text) = text.filter(|text| !text.is_empty()) else {
            return Vec::new();
        };
        self.final_text.push_str(&text);
        vec![CliAgentEvent::TextDelta(text)]
    }
}

pub async fn prepare_cli_run(
    app: &AppHandle,
    request: &AgentTurnRequest,
    provider: &AgentProviderConfig,
    bridge: PrivateBridgeSession,
) -> Result<PreparedCliRun> {
    let provider_kind = provider_kind(provider.kind)?;
    let profile_id = provider
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("CLI provider profileId is required"))?;
    let command = resolve_command(provider_kind, provider.executable_path.as_deref()).await?;
    let stored_environment = load_cli_environment(app, provider_kind.as_str(), profile_id).await?;
    let mut environment = stored_environment
        .into_iter()
        .filter(|(name, _)| provider.environment_keys.iter().any(|key| key == name))
        .collect::<BTreeMap<_, _>>();
    environment.insert(
        BRIDGE_ENDPOINT_ENV.to_string(),
        bridge.endpoint().to_string(),
    );
    environment.insert(BRIDGE_TOKEN_ENV.to_string(), bridge.token().to_string());

    let isolated_working_directory = isolated_working_directory()?;
    let oxide_agent = resolve_oxide_agent_binary(app)?;
    let full_access = provider_kind == CliProviderKind::CodexCli
        && request.profile == AgentProfile::Agent
        && provider.access_mode.as_deref() == Some("full")
        && provider
            .reasoning_effort
            .as_deref()
            .is_some_and(|effort| effort.eq_ignore_ascii_case("ultra"));
    let working_directory = if full_access {
        let store = app
            .try_state::<MetaStore>()
            .ok_or_else(|| anyhow!("project metadata store is unavailable"))?;
        crate::commands::project_files::agent_project_directory(&store, &request.project_id, None)
            .await?
            .1
    } else {
        isolated_working_directory.path().to_path_buf()
    };
    let prompt = build_prompt(request, full_access);
    let timeout = Duration::from_millis(
        provider
            .timeout_ms
            .unwrap_or(DEFAULT_CLI_TIMEOUT.as_millis() as u64)
            .clamp(MIN_CLI_TIMEOUT_MS, MAX_CLI_TIMEOUT_MS),
    );
    let args = match provider_kind {
        CliProviderKind::CodexCli => codex_args(provider, &oxide_agent, request, full_access),
        CliProviderKind::CodebuddyCli => {
            codebuddy_args(provider, &oxide_agent, request, &working_directory)?
        }
    };
    let protocol = match provider_kind {
        CliProviderKind::CodexCli => CliRunProtocol::CodexAppServer {
            model: non_default(provider.model.as_str()),
            effort: provider.reasoning_effort.as_deref().and_then(non_default),
            service_tier: provider.service_tier.as_deref().and_then(non_default),
            full_access,
            collaboration_mode: if request.profile == AgentProfile::Plan {
                "plan"
            } else {
                "default"
            },
        },
        CliProviderKind::CodebuddyCli => CliRunProtocol::Jsonl,
    };
    Ok(PreparedCliRun {
        provider: provider_kind,
        command,
        args,
        environment,
        stdin: prompt.into_bytes(),
        timeout,
        protocol,
        working_directory,
        _isolated_working_directory: isolated_working_directory,
        _bridge: bridge,
    })
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
    } else if lower.contains("not installed")
        || lower.contains("not available on path")
        || lower.contains("failed to start")
        || lower.contains("was not found")
    {
        ("cli_not_installed", false)
    } else if lower.contains("mcp") || lower.contains("oxide-agent") {
        ("cli_mcp_startup_failed", true)
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

fn provider_kind(kind: AgentProviderKind) -> Result<CliProviderKind> {
    match kind {
        AgentProviderKind::CodexCli => Ok(CliProviderKind::CodexCli),
        AgentProviderKind::CodebuddyCli => Ok(CliProviderKind::CodebuddyCli),
        AgentProviderKind::OpenaiCompatible => Err(anyhow!("HTTP provider is not a CLI provider")),
    }
}

fn build_prompt(request: &AgentTurnRequest, full_access: bool) -> String {
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

fn codex_args(
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

fn non_default(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && !value.eq_ignore_ascii_case("default")).then(|| value.to_string())
}

fn codebuddy_args(
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

fn resolve_oxide_agent_binary(app: &AppHandle) -> Result<PathBuf> {
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

fn parse_codex_tool(item: &Value) -> Option<(String, String)> {
    if !matches!(
        item.get("type").and_then(Value::as_str),
        Some("mcp_tool_call" | "mcp_tool" | "tool_call" | "mcpToolCall" | "mcpTool")
    ) {
        return None;
    }
    let call_id = item
        .get("id")
        .or_else(|| item.get("call_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| fallback_call_id(item));
    let tool_name = item
        .get("tool_name")
        .or_else(|| item.get("toolName"))
        .or_else(|| item.get("tool"))
        .or_else(|| item.get("name"))
        .or_else(|| item.get("server_tool_name"))
        .and_then(Value::as_str)
        .map(display_tool_name)
        .unwrap_or_else(|| "oxide tool".to_string());
    Some((call_id, tool_name))
}

fn display_tool_name(value: &str) -> String {
    value
        .strip_prefix("mcp__oxide__")
        .or_else(|| value.strip_prefix("oxide/"))
        .or_else(|| value.strip_prefix("oxide__"))
        .or_else(|| value.strip_prefix("oxide."))
        .unwrap_or(value)
        .chars()
        .take(200)
        .collect()
}

fn fallback_call_id(value: &Value) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let digest = sha2::Sha256::digest(bytes);
    let suffix = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("cli-{suffix}")
}

fn text_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|value| match value {
            Value::String(text) => Some(text.clone()),
            Value::Array(blocks) => Some(
                blocks
                    .iter()
                    .filter_map(|block| block.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(""),
            ),
            _ => None,
        })
    })
}

fn content_blocks(content: Option<&Value>) -> Vec<&Value> {
    match content {
        Some(Value::Array(blocks)) => blocks.iter().collect(),
        Some(value @ Value::Object(_)) => vec![value],
        _ => Vec::new(),
    }
}

fn parse_usage(value: &Value) -> Vec<CliAgentEvent> {
    let usage = value
        .get("usage")
        .or_else(|| value.pointer("/result/usage"));
    let Some(usage) = usage else {
        return Vec::new();
    };
    let input_tokens = number_field(usage, &["input_tokens", "inputTokens", "prompt_tokens"]);
    let output_tokens = number_field(
        usage,
        &["output_tokens", "outputTokens", "completion_tokens"],
    );
    if input_tokens == 0 && output_tokens == 0 {
        Vec::new()
    } else {
        vec![CliAgentEvent::Usage {
            input_tokens,
            output_tokens,
        }]
    }
}

fn number_field(value: &Value, keys: &[&str]) -> u64 {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_u64))
        .unwrap_or(0)
}

fn error_message(value: &Value) -> String {
    for pointer in [
        "/message",
        "/error/message",
        "/result/error",
        "/result/message",
        "/errors/0/message",
    ] {
        if let Some(message) = value.pointer(pointer).and_then(Value::as_str) {
            return message.to_string();
        }
    }
    "CLI execution failed".to_string()
}

fn safe_tool_detail(value: &Value) -> Option<String> {
    if requires_manual_verification(value) {
        Some(
            "Database operation result is unknown; verify the target manually before retrying."
                .to_string(),
        )
    } else {
        None
    }
}

fn requires_manual_verification(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            object
                .get("manualVerificationRequired")
                .and_then(Value::as_bool)
                == Some(true)
                || object.get("kind").and_then(Value::as_str) == Some("mutation_result_unknown")
                || object.values().any(requires_manual_verification)
        }
        Value::Array(values) => values.iter().any(requires_manual_verification),
        Value::String(text) => {
            let lower = text.to_ascii_lowercase();
            lower.contains("verify the target manually")
                || lower.contains("mutation_result_unknown")
                || lower.contains("\"manualverificationrequired\":true")
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_codex_jsonl_without_exposing_reasoning_text() {
        let mut parser = CliAgentEventParser::new(CliProviderKind::CodexCli);
        assert_eq!(
            parser.parse(
                &json!({"type":"item.completed","item":{"type":"reasoning","text":"secret chain"}})
            ),
            vec![CliAgentEvent::Activity {
                status: "running",
                label: "Codex completed a reasoning step".to_string(),
            }]
        );
        assert_eq!(
            parser.parse(
                &json!({"type":"item.completed","item":{"type":"agent_message","text":"done"}})
            ),
            vec![CliAgentEvent::TextDelta("done".to_string())]
        );
        assert_eq!(parser.final_text(), "done");
    }

    #[test]
    fn maps_codex_app_server_stream_and_final_usage() {
        let mut parser = CliAgentEventParser::new(CliProviderKind::CodexCli);
        assert_eq!(
            parser.parse(&json!({
                "method":"item/agentMessage/delta",
                "params":{"delta":"hello"}
            })),
            vec![CliAgentEvent::TextDelta("hello".to_string())]
        );
        assert!(parser
            .parse(&json!({
                "method":"thread/tokenUsage/updated",
                "params":{"tokenUsage":{"last":{"inputTokens":21,"outputTokens":8}}}
            }))
            .is_empty());
        assert_eq!(
            parser.parse(&json!({
                "method":"turn/completed",
                "params":{"turn":{"status":"completed"}}
            })),
            vec![
                CliAgentEvent::Usage {
                    input_tokens: 21,
                    output_tokens: 8,
                },
                CliAgentEvent::End,
            ]
        );
        assert_eq!(parser.final_text(), "hello");
    }

    #[test]
    fn maps_codebuddy_tool_lifecycle_and_usage() {
        let mut parser = CliAgentEventParser::new(CliProviderKind::CodebuddyCli);
        let started = parser.parse(&json!({
            "type":"assistant",
            "message":{"content":[{"type":"tool_use","id":"c1","name":"mcp__oxide__query.runReadOnly","input":{}}]}
        }));
        assert!(
            matches!(started.first(), Some(CliAgentEvent::ToolStarted { tool_name, .. }) if tool_name == "query.runReadOnly")
        );
        let finished = parser.parse(&json!({
            "type":"user",
            "message":{"content":[{"type":"tool_result","tool_use_id":"c1","content":"ok"}]}
        }));
        assert!(matches!(
            finished.first(),
            Some(CliAgentEvent::ToolFinished { success: true, .. })
        ));
        let result = parser.parse(&json!({
            "type":"result",
            "subtype":"success",
            "usage":{"input_tokens":12,"output_tokens":7}
        }));
        assert_eq!(
            result,
            vec![
                CliAgentEvent::Usage {
                    input_tokens: 12,
                    output_tokens: 7
                },
                CliAgentEvent::End,
            ]
        );
    }

    #[test]
    fn classifies_authentication_and_mcp_failures() {
        assert_eq!(
            classify_cli_error(
                CliProviderKind::CodexCli,
                "Not authenticated; run codex login"
            )
            .code,
            "cli_authentication_required"
        );
        assert_eq!(
            classify_cli_error(CliProviderKind::CodebuddyCli, "MCP server failed to start").code,
            "cli_mcp_startup_failed"
        );
    }

    #[test]
    fn distinguishes_success_receipts_from_unknown_mutations() {
        assert!(!requires_manual_verification(
            &json!({"mutationReceipt":{"completed":true,"manualVerificationRequired":false}})
        ));
        assert!(requires_manual_verification(
            &json!({"error":{"kind":"mutation_result_unknown","manualVerificationRequired":true}})
        ));
    }
}
