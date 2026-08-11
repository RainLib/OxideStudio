use crate::ai_cli::{
    runtime::{bounded_diagnostic, isolated_working_directory, resolve_command, run_captured, CliCommandSpec},
    CliConnectionTestResult, CliDetectionResult, CliModelInfo, CliProviderConfig, CliProviderKind,
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

const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(20);
const ACP_TIMEOUT: Duration = Duration::from_secs(15);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
struct CachedModels {
    key: u64,
    loaded_at: Instant,
    models: Vec<CliModelInfo>,
}

static MODEL_CACHE: LazyLock<Mutex<Option<CachedModels>>> =
    LazyLock::new(|| Mutex::new(None));

#[derive(Debug)]
struct InitializeResult {
    models: Vec<CliModelInfo>,
    authenticated: bool,
    current_model: Option<String>,
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
    let command = resolve_command(CliProviderKind::CodebuddyCli, config.executable_path.as_deref()).await?;
    let key = model_cache_key(&command, environment);
    let now = Instant::now();
    if let Some(cached) = MODEL_CACHE.lock().await.as_ref() {
        if cached.key == key
            && now.saturating_duration_since(cached.loaded_at) < Duration::from_secs(5 * 60)
        {
            return Ok(cached.models.clone());
        }
    }
    let initialized = initialize(&command, environment).await?;
    if !initialized.authenticated {
        return Err(anyhow!("CodeBuddy Code is not authenticated. Open `codebuddy` in a terminal, sign in, and try again."));
    }
    if initialized.models.is_empty() {
        return Err(anyhow!("CodeBuddy initialization returned no usable models"));
    }
    *MODEL_CACHE.lock().await = Some(CachedModels {
        key,
        loaded_at: now,
        models: initialized.models.clone(),
    });
    Ok(initialized.models)
}

fn model_cache_key(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> u64 {
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
    let command = resolve_command(CliProviderKind::CodebuddyCli, config.executable_path.as_deref()).await?;
    match discover_efforts_via_acp(&command, environment, config.model.trim()).await {
        Ok(efforts) if !efforts.is_empty() => Ok(efforts),
        _ => {
            let initialized = initialize(&command, environment).await?;
            Ok(initialized
                .models
                .iter()
                .find(|model| model.id == config.model.trim())
                .map(|model| model.reasoning_efforts.clone())
                .unwrap_or_default())
        }
    }
}

pub async fn test_connection(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<CliConnectionTestResult> {
    let started = Instant::now();
    let command = resolve_command(CliProviderKind::CodebuddyCli, config.executable_path.as_deref()).await?;
    let cli_version = version(&command, environment).await?;
    let initialized = initialize(&command, environment)
        .await
        .map_err(|error| anyhow!(classify_error(&error.to_string())))?;
    if !initialized.authenticated {
        return Err(anyhow!("CodeBuddy Code is not authenticated. Open `codebuddy` in a terminal, sign in, and try again."));
    }
    let configured = config.model.trim();
    let model = initialized
        .current_model
        .or_else(|| (!configured.is_empty()).then(|| configured.to_string()))
        .unwrap_or_else(|| "default".to_string());
    Ok(CliConnectionTestResult {
        message: "CodeBuddy Code CLI is installed and authenticated".to_string(),
        model,
        executable_path: command.resolved_path.unwrap_or(command.program),
        version: Some(cli_version),
        latency_ms: started.elapsed().as_millis() as u64,
    })
}

async fn version(command: &CliCommandSpec, environment: &BTreeMap<String, String>) -> Result<String> {
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

async fn initialize(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<InitializeResult> {
    let cwd = isolated_working_directory()?;
    let args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--no-session-persistence".to_string(),
        "--setting-sources".to_string(),
        "user".to_string(),
    ];
    let mut request = serde_json::to_vec(&json!({
        "type": "control_request",
        "request_id": "oxide_model_discovery",
        "request": { "subtype": "initialize" }
    }))?;
    request.push(b'\n');
    let output = run_captured(
        command,
        &args,
        environment,
        Some(cwd.path()),
        Some(&request),
        INITIALIZE_TIMEOUT,
    )
    .await?;
    if !output.success {
        return Err(anyhow!(classify_error(&output.stderr)));
    }
    parse_initialize(&output.stdout)
        .ok_or_else(|| anyhow!("CodeBuddy initialization returned no valid control response"))
}

fn parse_initialize(stdout: &str) -> Option<InitializeResult> {
    for line in stdout.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if event.get("type").and_then(Value::as_str) != Some("control_response") {
            continue;
        }
        let response = event.get("response")?;
        let data = response.get("response").unwrap_or(response);
        let models = parse_models(data.get("models").and_then(Value::as_array));
        let authenticated = parse_authentication(data.get("account")).unwrap_or(!models.is_empty());
        let current_model = data
            .get("currentModelId")
            .or_else(|| data.get("current_model_id"))
            .and_then(Value::as_str)
            .map(normalize_model_id);
        return Some(InitializeResult {
            models,
            authenticated,
            current_model,
        });
    }
    None
}

fn parse_models(models: Option<&Vec<Value>>) -> Vec<CliModelInfo> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    let Some(models) = models else {
        return result;
    };
    for model in models {
        let Some(raw_id) = model
            .get("value")
            .and_then(Value::as_str)
            .or_else(|| model.get("id").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let id = normalize_model_id(raw_id);
        if !seen.insert(id.clone()) {
            continue;
        }
        let label = model
            .get("displayName")
            .or_else(|| model.get("display_name"))
            .or_else(|| model.get("name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&id)
            .to_string();
        let mut info = CliModelInfo::new(id, label, false);
        if model
            .get("supportsEffort")
            .or_else(|| model.get("supports_effort"))
            .and_then(Value::as_bool)
            != Some(false)
        {
            info.reasoning_efforts = effort_strings(model);
        }
        result.push(info);
    }
    if !result.is_empty() && seen.insert("default".to_string()) {
        result.insert(0, CliModelInfo::new("default", "Default", true));
    }
    result
}

fn effort_strings(value: &Value) -> Vec<String> {
    let mut seen = HashSet::new();
    value
        .get("supportedEffortLevels")
        .or_else(|| value.get("supported_effort_levels"))
        .or_else(|| value.get("effortLevels"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && seen.insert(value.to_string()))
        .map(str::to_string)
        .collect()
}

fn parse_authentication(value: Option<&Value>) -> Option<bool> {
    let value = value?;
    if let Some(value) = value.as_bool() {
        return Some(value);
    }
    for key in ["authenticated", "loggedIn", "isAuthenticated", "isLoggedIn"] {
        if let Some(value) = value.get(key).and_then(Value::as_bool) {
            return Some(value);
        }
    }
    value
        .get("status")
        .and_then(Value::as_str)
        .map(|status| matches!(status.to_ascii_lowercase().as_str(), "authenticated" | "logged_in" | "active"))
}

fn normalize_model_id(value: &str) -> String {
    let value = value.trim();
    if value.eq_ignore_ascii_case("default-model") {
        "default".to_string()
    } else {
        value.to_string()
    }
}

async fn discover_efforts_via_acp(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
    model: &str,
) -> Result<Vec<String>> {
    tokio::time::timeout(ACP_TIMEOUT, discover_efforts_via_acp_inner(command, environment, model))
        .await
        .map_err(|_| anyhow!("CodeBuddy ACP effort discovery timed out"))?
}

async fn discover_efforts_via_acp_inner(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
    model: &str,
) -> Result<Vec<String>> {
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
    let mut stdin = child.stdin.take().ok_or_else(|| anyhow!("CodeBuddy ACP stdin is unavailable"))?;
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("CodeBuddy ACP stdout is unavailable"))?;
    let mut lines = BufReader::new(stdout).lines();

    write_rpc(&mut stdin, 1, "initialize", json!({
        "protocolVersion": 1,
        "clientCapabilities": {
            "fs": { "readTextFile": false, "writeTextFile": false },
            "terminal": false
        },
        "clientInfo": { "name": "OxideStudio", "version": env!("CARGO_PKG_VERSION") }
    })).await?;
    read_rpc_result(&mut lines, 1).await?;
    write_rpc(&mut stdin, 2, "session/new", json!({
        "cwd": cwd.path().to_string_lossy(),
        "mcpServers": []
    })).await?;
    let session = read_rpc_result(&mut lines, 2).await?;
    let session_id = session
        .get("sessionId")
        .or_else(|| session.get("session_id"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("CodeBuddy ACP session omitted its id"))?;
    let options = if !model.is_empty() && !model.eq_ignore_ascii_case("default") {
        write_rpc(&mut stdin, 3, "session/set_config_option", json!({
            "sessionId": session_id,
            "configId": "model",
            "value": model
        })).await?;
        read_rpc_result(&mut lines, 3).await?
    } else {
        session
    };
    Ok(parse_effort_options(&options))
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
        .filter_map(|option| option.get("value").and_then(Value::as_str).or_else(|| option.as_str()))
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
        return "CodeBuddy Code is not authenticated. Open `codebuddy` in a terminal, sign in, and try again.".to_string();
    }
    if lower.contains("not installed") || lower.contains("not found") || lower.contains("no such file") {
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
    fn parses_initialize_without_exposing_account_payload() {
        let result = parse_initialize(
            r#"{"type":"control_response","response":{"response":{"models":[{"id":"default-model","name":"Default"},{"id":"kimi","displayName":"Kimi","supportsEffort":true,"supportedEffortLevels":["low","high"]}],"account":{"authenticated":true,"token":"must-not-escape"},"currentModelId":"kimi"}}}"#,
        )
        .unwrap();
        assert!(result.authenticated);
        assert_eq!(result.current_model.as_deref(), Some("kimi"));
        assert_eq!(result.models.iter().map(|model| model.id.as_str()).collect::<Vec<_>>(), ["default", "kimi"]);
        assert_eq!(result.models[1].reasoning_efforts, ["low", "high"]);
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
