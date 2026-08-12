use crate::ai_cli::{
    runtime::{
        bounded_diagnostic, isolated_working_directory, resolve_command, run_captured,
        CliCommandSpec,
    },
    CliCommandInfo, CliConnectionTestResult, CliDetectionResult, CliModelInfo, CliProviderConfig,
    CliProviderKind,
};
use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::{
    collections::{hash_map::DefaultHasher, BTreeMap, HashSet},
    hash::{Hash, Hasher},
    process::Stdio,
    sync::LazyLock,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::Mutex,
};

const ACP_TIMEOUT: Duration = Duration::from_secs(15);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
struct CachedModels {
    key: u64,
    loaded_at: Instant,
    models: Vec<CliModelInfo>,
}

static MODEL_CACHE: LazyLock<Mutex<Option<CachedModels>>> = LazyLock::new(|| Mutex::new(None));

const EMBEDDED_COMMANDS: &[&str] = &[
    "btw",
    "context",
    "cost",
    "goal",
    "plan",
    "review",
    "skills",
    "todos",
    "effort",
    "deep-research",
    "simplify",
    "code-review",
    "verify",
    "compact",
    "security-review",
];

#[derive(Debug)]
struct AcpCatalog {
    models: Vec<CliModelInfo>,
    current_model: Option<String>,
    efforts: Vec<String>,
}

pub async fn detect(
    configured_path: Option<&str>,
    environment: &BTreeMap<String, String>,
) -> CliDetectionResult {
    match resolve_command(CliProviderKind::CodebuddyCli, configured_path).await {
        Ok(command) => match version(&command, environment).await {
            Ok(version) => CliDetectionResult {
                provider: CliProviderKind::CodebuddyCli,
                available: true,
                executable_path: command.resolved_path.clone(),
                version: Some(version),
                message: "CodeBuddy Code CLI is available".to_string(),
            },
            Err(error) => CliDetectionResult {
                provider: CliProviderKind::CodebuddyCli,
                available: false,
                executable_path: command.resolved_path.clone(),
                version: None,
                message: classify_error(&error.to_string()),
            },
        },
        Err(error) => CliDetectionResult {
            provider: CliProviderKind::CodebuddyCli,
            available: false,
            executable_path: None,
            version: None,
            message: classify_error(&error.to_string()),
        },
    }
}

pub async fn list_models(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<CliModelInfo>> {
    let command = resolve_command(
        CliProviderKind::CodebuddyCli,
        config.executable_path.as_deref(),
    )
    .await?;
    let key = model_cache_key(&command, environment);
    let now = Instant::now();
    if let Some(cached) = MODEL_CACHE.lock().await.as_ref() {
        if cached.key == key
            && now.saturating_duration_since(cached.loaded_at) < Duration::from_secs(5 * 60)
        {
            return Ok(cached.models.clone());
        }
    }
    let catalog = discover_catalog_via_acp(&command, environment, config.model.trim()).await?;
    if catalog.models.is_empty() {
        return Err(anyhow!("CodeBuddy ACP session returned no usable models"));
    }
    *MODEL_CACHE.lock().await = Some(CachedModels {
        key,
        loaded_at: now,
        models: catalog.models.clone(),
    });
    Ok(catalog.models)
}

fn model_cache_key(command: &CliCommandSpec, environment: &BTreeMap<String, String>) -> u64 {
    let mut hasher = DefaultHasher::new();
    command.program.hash(&mut hasher);
    command.prefix_args.hash(&mut hasher);
    environment.hash(&mut hasher);
    hasher.finish()
}

pub async fn list_efforts(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<String>> {
    let command = resolve_command(
        CliProviderKind::CodebuddyCli,
        config.executable_path.as_deref(),
    )
    .await?;
    Ok(
        discover_catalog_via_acp(&command, environment, config.model.trim())
            .await?
            .efforts,
    )
}

pub async fn list_commands(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<CliCommandInfo>> {
    let command = resolve_command(
        CliProviderKind::CodebuddyCli,
        config.executable_path.as_deref(),
    )
    .await?;
    tokio::time::timeout(
        ACP_TIMEOUT,
        discover_commands_via_acp(&command, environment),
    )
    .await
    .map_err(|_| anyhow!("CodeBuddy ACP command discovery timed out"))?
}

async fn discover_commands_via_acp(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<CliCommandInfo>> {
    let cwd = isolated_working_directory()?;
    let mcp_config = cwd.path().join("mcp.json");
    std::fs::write(&mcp_config, br#"{"mcpServers":{}}"#)
        .context("failed to create isolated CodeBuddy MCP configuration")?;
    let mut process = Command::new(&command.program);
    process
        .args(&command.prefix_args)
        .args([
            "--acp",
            "--acp-transport",
            "stdio",
            "--strict-mcp-config",
            "--mcp-config",
            &mcp_config.to_string_lossy(),
            "--setting-sources",
            "user",
        ])
        .envs(environment)
        .current_dir(cwd.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = process
        .spawn()
        .context("failed to start CodeBuddy ACP command discovery")?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("CodeBuddy ACP stdin is unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("CodeBuddy ACP stdout is unavailable"))?;
    let mut lines = BufReader::new(stdout).lines();
    write_rpc(
        &mut stdin,
        1,
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": { "readTextFile": false, "writeTextFile": false },
                "terminal": false
            },
            "clientInfo": { "name": "OxideStudio", "version": env!("CARGO_PKG_VERSION") }
        }),
    )
    .await?;
    read_rpc_result(&mut lines, 1).await?;
    write_rpc(&mut stdin, 2, "_codebuddy.ai/getUserInfo", json!({})).await?;
    let account = read_rpc_result(&mut lines, 2).await?;
    if !has_authenticated_user(&account) {
        let _ = child.kill().await;
        return Err(anyhow!(
            "CodeBuddy Code is not authenticated. Sign in from OxideStudio and try again."
        ));
    }
    write_rpc(
        &mut stdin,
        3,
        "session/new",
        json!({ "cwd": cwd.path().to_string_lossy(), "mcpServers": [] }),
    )
    .await?;

    let mut session_ready = false;
    let mut commands = Vec::new();
    while let Some(line) = lines.next_line().await? {
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if value.get("id").and_then(Value::as_u64) == Some(3) {
            if let Some(error) = value.get("error") {
                return Err(anyhow!("CodeBuddy ACP session failed: {error}"));
            }
            session_ready = true;
        }
        if value.get("method").and_then(Value::as_str) == Some("session/update") {
            let update = value
                .pointer("/params/update")
                .or_else(|| value.get("params"))
                .unwrap_or(&Value::Null);
            if matches!(
                update
                    .get("sessionUpdate")
                    .or_else(|| update.get("session_update"))
                    .and_then(Value::as_str),
                Some("available_commands_update")
            ) {
                commands = parse_available_commands(update);
            }
        }
        if session_ready && !commands.is_empty() {
            let _ = child.kill().await;
            return Ok(commands);
        }
    }
    Err(anyhow!(
        "CodeBuddy ACP session did not publish its command catalog"
    ))
}

fn parse_available_commands(value: &Value) -> Vec<CliCommandInfo> {
    value
        .get("availableCommands")
        .or_else(|| value.get("available_commands"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|command| {
            let name = command.get("name")?.as_str()?.trim();
            if !EMBEDDED_COMMANDS.contains(&name) {
                return None;
            }
            let description = command
                .get("description")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("CodeBuddy command");
            let mut info = CliCommandInfo::new(name, description);
            info.argument_hint = command
                .get("inputHint")
                .or_else(|| command.get("input_hint"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .or_else(|| command_argument_hint(name).map(str::to_string));
            Some(info)
        })
        .collect()
}

fn command_argument_hint(name: &str) -> Option<&'static str> {
    match name {
        "goal" => Some("condition to keep working toward"),
        "review" | "code-review" => Some("optional review target or focus"),
        "effort" => Some("minimal | low | medium | high | xhigh | max"),
        "compact" => Some("optional summary instructions"),
        "btw" => Some("side question"),
        _ => None,
    }
}

pub async fn test_connection(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<CliConnectionTestResult> {
    let started = Instant::now();
    let command = resolve_command(
        CliProviderKind::CodebuddyCli,
        config.executable_path.as_deref(),
    )
    .await?;
    let cli_version = version(&command, environment).await?;
    // Account state, model catalog and session creation are all verified over
    // ACP. Stream-json's apiKeySource is only a service origin and must never
    // be interpreted as proof that a user is signed in.
    let catalog = discover_catalog_via_acp(&command, environment, config.model.trim())
        .await
        .map_err(|error| anyhow!(classify_error(&error.to_string())))?;
    let configured = config.model.trim();
    let model = catalog
        .current_model
        .or_else(|| (!configured.is_empty()).then(|| configured.to_string()))
        .unwrap_or_else(|| "default".to_string());
    Ok(CliConnectionTestResult {
        message: "CodeBuddy Code CLI is ready. Existing sign-in verified.".to_string(),
        model,
        executable_path: command.resolved_path.unwrap_or(command.program),
        version: Some(cli_version),
        latency_ms: started.elapsed().as_millis() as u64,
    })
}

async fn version(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<String> {
    let output = run_captured(
        command,
        &["--version".to_string()],
        environment,
        None,
        None,
        VERSION_TIMEOUT,
    )
    .await?;
    if !output.success {
        return Err(anyhow!(classify_error(&output.stderr)));
    }
    Ok(output
        .stdout
        .lines()
        .chain(output.stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("CodeBuddy Code CLI")
        .chars()
        .take(200)
        .collect())
}

fn normalize_model_id(value: &str) -> String {
    let value = value.trim();
    if value.eq_ignore_ascii_case("default-model") {
        "default".to_string()
    } else {
        value.to_string()
    }
}

async fn discover_catalog_via_acp(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
    model: &str,
) -> Result<AcpCatalog> {
    tokio::time::timeout(
        ACP_TIMEOUT,
        discover_catalog_via_acp_inner(command, environment, model),
    )
    .await
    .map_err(|_| anyhow!("CodeBuddy ACP capability discovery timed out"))?
}

async fn discover_catalog_via_acp_inner(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
    model: &str,
) -> Result<AcpCatalog> {
    let cwd = isolated_working_directory()?;
    let mcp_config = cwd.path().join("mcp.json");
    std::fs::write(&mcp_config, br#"{"mcpServers":{}}"#)
        .context("failed to create isolated CodeBuddy MCP configuration")?;
    let mut process = Command::new(&command.program);
    process
        .args(&command.prefix_args)
        .args([
            "--acp",
            "--acp-transport",
            "stdio",
            "--mcp-config",
            &mcp_config.to_string_lossy(),
            "--setting-sources",
            "user",
        ])
        .envs(environment)
        .current_dir(cwd.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = process.spawn().context("failed to start CodeBuddy ACP")?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("CodeBuddy ACP stdin is unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("CodeBuddy ACP stdout is unavailable"))?;
    let mut lines = BufReader::new(stdout).lines();

    write_rpc(
        &mut stdin,
        1,
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": { "readTextFile": false, "writeTextFile": false },
                "terminal": false
            },
            "clientInfo": { "name": "OxideStudio", "version": env!("CARGO_PKG_VERSION") }
        }),
    )
    .await?;
    read_rpc_result(&mut lines, 1).await?;
    write_rpc(&mut stdin, 2, "_codebuddy.ai/getUserInfo", json!({})).await?;
    let account = read_rpc_result(&mut lines, 2).await?;
    if !has_authenticated_user(&account) {
        let _ = child.kill().await;
        return Err(anyhow!(
            "CodeBuddy Code is not authenticated. Sign in from OxideStudio and try again."
        ));
    }
    write_rpc(
        &mut stdin,
        3,
        "session/new",
        json!({
            "cwd": cwd.path().to_string_lossy(),
            "mcpServers": []
        }),
    )
    .await?;
    let session = read_rpc_result(&mut lines, 3).await?;
    let session_id = session
        .get("sessionId")
        .or_else(|| session.get("session_id"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("CodeBuddy ACP session omitted its id"))?;
    let options = if !model.is_empty() && !model.eq_ignore_ascii_case("default") {
        write_rpc(
            &mut stdin,
            4,
            "session/set_config_option",
            json!({
                "sessionId": session_id,
                "configId": "model",
                "value": model
            }),
        )
        .await?;
        read_rpc_result(&mut lines, 4).await?
    } else {
        session
    };
    let efforts = parse_effort_options(&options);
    let mut models = parse_acp_model_options(&options, &efforts);
    let current_model = current_config_value(&options, "model")
        .as_deref()
        .map(normalize_model_id);
    if let Some(current_model) = current_model.as_deref() {
        for model in &mut models {
            model.is_default = model.id == current_model;
        }
    }
    let _ = child.kill().await;
    Ok(AcpCatalog {
        models,
        current_model,
        efforts,
    })
}

fn has_authenticated_user(value: &Value) -> bool {
    value
        .get("userInfo")
        .or_else(|| value.get("user_info"))
        .is_some_and(|user| user.is_object() && !user.as_object().is_some_and(|map| map.is_empty()))
}

fn current_config_value(value: &Value, config_id: &str) -> Option<String> {
    config_options(value)
        .and_then(|options| {
            options
                .iter()
                .find(|option| option.get("id").and_then(Value::as_str) == Some(config_id))
        })
        .and_then(|option| {
            option
                .get("currentValue")
                .or_else(|| option.get("current_value"))
                .or_else(|| option.get("value"))
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn config_options(value: &Value) -> Option<&Vec<Value>> {
    value
        .get("configOptions")
        .or_else(|| value.get("config_options"))
        .and_then(Value::as_array)
}

fn parse_acp_model_options(value: &Value, efforts: &[String]) -> Vec<CliModelInfo> {
    let Some(model_config) = config_options(value).and_then(|options| {
        options
            .iter()
            .find(|option| option.get("id").and_then(Value::as_str) == Some("model"))
    }) else {
        return Vec::new();
    };
    let current = current_config_value(value, "model");
    let mut seen = HashSet::new();
    model_config
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|option| {
            let id = option
                .get("value")
                .and_then(Value::as_str)
                .or_else(|| option.as_str())?
                .trim();
            if id.is_empty() || !seen.insert(id.to_string()) {
                return None;
            }
            let label = option
                .get("name")
                .or_else(|| option.get("label"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(id);
            let mut model = CliModelInfo::new(
                normalize_model_id(id),
                label,
                current.as_deref() == Some(id),
            );
            model.reasoning_efforts = efforts.to_vec();
            Some(model)
        })
        .collect()
}

async fn write_rpc(
    stdin: &mut tokio::process::ChildStdin,
    id: u64,
    method: &str,
    params: Value,
) -> Result<()> {
    let mut payload = serde_json::to_vec(&json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    }))?;
    payload.push(b'\n');
    stdin.write_all(&payload).await?;
    stdin.flush().await?;
    Ok(())
}

async fn read_rpc_result(
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    id: u64,
) -> Result<Value> {
    while let Some(line) = lines.next_line().await? {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            return Err(anyhow!("CodeBuddy ACP request failed: {error}"));
        }
        return Ok(value.get("result").cloned().unwrap_or(Value::Null));
    }
    Err(anyhow!("CodeBuddy ACP exited before responding"))
}

fn parse_effort_options(value: &Value) -> Vec<String> {
    let options = value
        .get("configOptions")
        .or_else(|| value.get("config_options"))
        .and_then(Value::as_array);
    let Some(config) = options.and_then(|options| {
        options.iter().find(|option| {
            matches!(
                option.get("id").and_then(Value::as_str),
                Some("thought_level" | "effort" | "reasoning_effort")
            )
        })
    }) else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    config
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|option| {
            option
                .get("value")
                .and_then(Value::as_str)
                .or_else(|| option.as_str())
        })
        .map(str::trim)
        .filter(|value| !value.is_empty() && seen.insert(value.to_string()))
        .map(str::to_string)
        .collect()
}

fn classify_error(value: &str) -> String {
    let diagnostic = bounded_diagnostic(value);
    let lower = diagnostic.to_ascii_lowercase();
    if lower.contains("not authenticated")
        || lower.contains("not logged in")
        || lower.contains("login required")
        || lower.contains("unauthorized")
    {
        return "CodeBuddy Code is not authenticated. Sign in from the OxideStudio Assistant and try again.".to_string();
    }
    if lower.contains("not installed")
        || lower.contains("not found")
        || lower.contains("no such file")
    {
        return "CodeBuddy Code CLI is not installed or cannot be found. Install it or select its executable path.".to_string();
    }
    if diagnostic.is_empty() {
        "CodeBuddy Code CLI failed without diagnostic output".to_string()
    } else {
        format!("CodeBuddy Code CLI failed: {diagnostic}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_a_real_acp_user_payload() {
        assert!(has_authenticated_user(&json!({
            "userInfo": { "userName": "account", "token": "must-not-escape" }
        })));
        assert!(!has_authenticated_user(&json!({ "userInfo": null })));
        assert!(!has_authenticated_user(
            &json!({ "apiKeySource": "www.codebuddy.ai" })
        ));
    }

    #[test]
    fn parses_acp_model_catalog_with_dynamic_efforts() {
        let value = json!({
            "configOptions": [
                {
                    "id": "model",
                    "currentValue": "hy3",
                    "options": [
                        { "value": "hy3", "name": "Hy3" },
                        { "value": "glm-5.2", "name": "GLM-5.2" }
                    ]
                },
                {
                    "id": "thought_level",
                    "currentValue": "enabled",
                    "options": [{"value":"minimal"},{"value":"max"},{"value":"enabled"}]
                }
            ]
        });
        let efforts = parse_effort_options(&value);
        let models = parse_acp_model_options(&value, &efforts);
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["hy3", "glm-5.2"]
        );
        assert!(models[0].is_default);
        assert_eq!(models[1].reasoning_efforts, ["minimal", "max", "enabled"]);
    }

    #[test]
    fn filters_codebuddy_commands_for_the_embedded_surface() {
        let commands = parse_available_commands(&json!({
            "availableCommands": [
                { "name": "goal", "description": "Keep working" },
                { "name": "login", "description": "Open terminal login" },
                { "name": "compact", "description": "Compact context" }
            ]
        }));
        assert_eq!(
            commands
                .iter()
                .map(|command| command.name.as_str())
                .collect::<Vec<_>>(),
            ["goal", "compact"]
        );
        assert!(commands[0].argument_hint.is_some());
    }

    #[test]
    fn parses_dynamic_acp_effort_options() {
        let efforts = parse_effort_options(&json!({
            "configOptions": [{
                "id": "thought_level",
                "options": [{"value":"enabled"},{"value":"medium"},{"value":"xhigh"}]
            }]
        }));
        assert_eq!(efforts, ["enabled", "medium", "xhigh"]);
    }
}
