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
    collections::{hash_map::DefaultHasher, BTreeMap, HashMap, HashSet},
    future::Future,
    hash::{Hash, Hasher},
    process::Stdio,
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::Mutex,
};

const ACP_TIMEOUT: Duration = Duration::from_secs(15);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const CAPABILITY_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const EFFORT_CACHE_TTL: Duration = Duration::from_secs(30);
const COMMAND_NOTIFICATION_GRACE: Duration = Duration::from_millis(350);

#[derive(Clone, Debug)]
struct CachedCapabilities {
    loaded_at: Instant,
    models: Vec<CliModelInfo>,
    commands: Option<Vec<CliCommandInfo>>,
    current_model: Option<String>,
}

#[derive(Clone)]
struct CachedEfforts {
    loaded_at: Instant,
    efforts: Vec<String>,
}

static CAPABILITY_CACHE: LazyLock<Mutex<HashMap<u64, CachedCapabilities>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static CAPABILITY_DISCOVERY_LOCKS: LazyLock<Mutex<HashMap<u64, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static EFFORT_CACHE: LazyLock<Mutex<HashMap<u64, CachedEfforts>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static EFFORT_DISCOVERY_LOCKS: LazyLock<Mutex<HashMap<u64, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

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
    commands: Option<Vec<CliCommandInfo>>,
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
    Ok(get_or_discover_capabilities(&command, environment)
        .await?
        .models)
}

fn provider_identity_key(command: &CliCommandSpec, environment: &BTreeMap<String, String>) -> u64 {
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
    let model = normalize_model_id(config.model.trim());
    let key = effort_cache_key(&command, environment, &model);
    get_or_discover_efforts_by_key(key, || async {
        Ok(discover_catalog_via_acp(&command, environment, &model)
            .await?
            .efforts)
    })
    .await
}

fn effort_cache_key(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
    model: &str,
) -> u64 {
    let mut hasher = DefaultHasher::new();
    command.program.hash(&mut hasher);
    command.prefix_args.hash(&mut hasher);
    environment.hash(&mut hasher);
    model.hash(&mut hasher);
    hasher.finish()
}

async fn get_or_discover_efforts_by_key<F, Fut>(key: u64, discover: F) -> Result<Vec<String>>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<Vec<String>>>,
{
    let now = Instant::now();
    if let Some(cached) = EFFORT_CACHE.lock().await.get(&key) {
        if now.saturating_duration_since(cached.loaded_at) < EFFORT_CACHE_TTL {
            return Ok(cached.efforts.clone());
        }
    }

    let discovery_lock = {
        let mut locks = EFFORT_DISCOVERY_LOCKS.lock().await;
        locks
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let _discovery_guard = discovery_lock.lock().await;

    // A concurrent request for the same executable, environment and model may
    // have finished while this task waited for the model-scoped lock.
    let now = Instant::now();
    if let Some(cached) = EFFORT_CACHE.lock().await.get(&key) {
        if now.saturating_duration_since(cached.loaded_at) < EFFORT_CACHE_TTL {
            return Ok(cached.efforts.clone());
        }
    }

    let efforts = discover().await?;
    let mut cache = EFFORT_CACHE.lock().await;
    cache.retain(|_, cached| now.saturating_duration_since(cached.loaded_at) < EFFORT_CACHE_TTL);
    cache.insert(
        key,
        CachedEfforts {
            loaded_at: now,
            efforts: efforts.clone(),
        },
    );
    Ok(efforts)
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
    get_or_discover_capabilities(&command, environment)
        .await?
        .commands
        .ok_or_else(|| anyhow!("CodeBuddy ACP session did not publish its command catalog"))
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
    let capabilities = get_or_discover_capabilities(&command, environment)
        .await
        .map_err(|error| anyhow!(classify_error(&error.to_string())))?;
    let configured = config.model.trim();
    let model = capabilities
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
    if value.is_empty()
        || value.eq_ignore_ascii_case("default")
        || value.eq_ignore_ascii_case("default-model")
    {
        "default".to_string()
    } else {
        value.to_string()
    }
}

fn fresh_cached_capabilities(
    cache: &HashMap<u64, CachedCapabilities>,
    key: u64,
    now: Instant,
) -> Option<CachedCapabilities> {
    cache
        .get(&key)
        .filter(|cached| now.saturating_duration_since(cached.loaded_at) < CAPABILITY_CACHE_TTL)
        .cloned()
}

async fn get_or_discover_capabilities(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<CachedCapabilities> {
    let key = provider_identity_key(command, environment);
    get_or_discover_capabilities_by_key(key, || async {
        let catalog = discover_catalog_via_acp(command, environment, "").await?;
        if catalog.models.is_empty() {
            return Err(anyhow!("CodeBuddy ACP session returned no usable models"));
        }
        Ok(CachedCapabilities {
            loaded_at: Instant::now(),
            models: catalog.models,
            commands: catalog.commands,
            current_model: catalog.current_model,
        })
    })
    .await
}

async fn get_or_discover_capabilities_by_key<F, Fut>(
    key: u64,
    discover: F,
) -> Result<CachedCapabilities>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<CachedCapabilities>>,
{
    if let Some(cached) =
        fresh_cached_capabilities(&*CAPABILITY_CACHE.lock().await, key, Instant::now())
    {
        return Ok(cached);
    }

    let discovery_lock = {
        let mut locks = CAPABILITY_DISCOVERY_LOCKS.lock().await;
        locks
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let _discovery_guard = discovery_lock.lock().await;

    // A concurrent caller may have completed discovery while this caller was
    // waiting for the identity-scoped lock.
    if let Some(cached) =
        fresh_cached_capabilities(&*CAPABILITY_CACHE.lock().await, key, Instant::now())
    {
        return Ok(cached);
    }

    let now = Instant::now();
    let mut cached = discover().await?;
    cached.loaded_at = now;
    let mut cache = CAPABILITY_CACHE.lock().await;
    cache.retain(|_, entry| now.saturating_duration_since(entry.loaded_at) < CAPABILITY_CACHE_TTL);
    cache.insert(key, cached.clone());
    Ok(cached)
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
    let mut commands = None;
    read_rpc_result_collecting_commands(&mut lines, 1, &mut commands).await?;
    write_rpc(&mut stdin, 2, "_codebuddy.ai/getUserInfo", json!({})).await?;
    let account = read_rpc_result_collecting_commands(&mut lines, 2, &mut commands).await?;
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
    let session = read_rpc_result_collecting_commands(&mut lines, 3, &mut commands).await?;
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
        read_rpc_result_collecting_commands(&mut lines, 4, &mut commands).await?
    } else {
        session
    };
    let efforts = if model.is_empty() {
        // Catalog discovery must not attach the session's current model effort
        // options to every model in the provider catalog.
        Vec::new()
    } else {
        parse_effort_options(&options)
    };
    let models = parse_acp_model_options(&options);
    let current_model = current_config_value(&options, "model")
        .as_deref()
        .map(normalize_model_id);
    if model.is_empty() && commands.is_none() {
        collect_command_notification_with_grace(&mut lines, &mut commands).await?;
    }
    let _ = child.kill().await;
    Ok(AcpCatalog {
        models,
        current_model,
        efforts,
        commands,
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

fn parse_acp_model_options(value: &Value) -> Vec<CliModelInfo> {
    let Some(model_config) = config_options(value).and_then(|options| {
        options
            .iter()
            .find(|option| option.get("id").and_then(Value::as_str) == Some("model"))
    }) else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    let mut models: Vec<CliModelInfo> = model_config
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|option| {
            let raw_id = option
                .get("value")
                .and_then(Value::as_str)
                .or_else(|| option.as_str())?
                .trim();
            let id = normalize_model_id(raw_id);
            if id == "default" || !seen.insert(id.clone()) {
                return None;
            }
            let label = option
                .get("name")
                .or_else(|| option.get("label"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(raw_id);
            Some(CliModelInfo::new(id, label, false))
        })
        .collect();
    models.insert(0, CliModelInfo::new("default", "Default", true));
    models
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

async fn read_rpc_result_collecting_commands(
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    id: u64,
    commands: &mut Option<Vec<CliCommandInfo>>,
) -> Result<Value> {
    while let Some(line) = lines.next_line().await? {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(parsed) = parse_available_commands_notification(&value) {
            *commands = Some(parsed);
            continue;
        }
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

async fn collect_command_notification_with_grace(
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    commands: &mut Option<Vec<CliCommandInfo>>,
) -> Result<()> {
    let deadline = tokio::time::sleep(COMMAND_NOTIFICATION_GRACE);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => return Ok(()),
            next = lines.next_line() => {
                let Some(line) = next? else {
                    return Ok(());
                };
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if let Some(parsed) = parse_available_commands_notification(&value) {
                    *commands = Some(parsed);
                    return Ok(());
                }
            }
        }
    }
}

fn parse_available_commands_notification(value: &Value) -> Option<Vec<CliCommandInfo>> {
    if value.get("method").and_then(Value::as_str) != Some("session/update") {
        return None;
    }
    let update = value
        .pointer("/params/update")
        .or_else(|| value.get("params"))?;
    if !matches!(
        update
            .get("sessionUpdate")
            .or_else(|| update.get("session_update"))
            .and_then(Value::as_str),
        Some("available_commands_update")
    ) {
        return None;
    }
    Some(parse_available_commands(update))
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
    use std::sync::atomic::{AtomicUsize, Ordering};

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
    fn parses_acp_model_catalog_without_cross_model_effort_pollution() {
        let value = json!({
            "configOptions": [
                {
                    "id": "model",
                    "currentValue": "hy3",
                    "options": [
                        { "value": "default-model", "name": "Provider Default" },
                        { "value": "default", "name": "Duplicate Default" },
                        { "value": "hy3", "name": "Hy3" },
                        { "value": " hy3 ", "name": "Duplicate Hy3" },
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
        let models = parse_acp_model_options(&value);
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["default", "hy3", "glm-5.2"]
        );
        assert!(models[0].is_default);
        assert_eq!(models.iter().filter(|model| model.is_default).count(), 1);
        assert!(models.iter().skip(1).all(|model| !model.is_default));
        assert!(models
            .iter()
            .all(|model| model.reasoning_efforts.is_empty()));
        assert_eq!(efforts, ["minimal", "max", "enabled"]);
    }

    #[test]
    fn effort_cache_key_is_model_specific_and_normalized() {
        let command = CliCommandSpec {
            program: "codebuddy".to_string(),
            prefix_args: vec!["--profile".to_string(), "work".to_string()],
            resolved_path: None,
        };
        let environment = BTreeMap::from([("CODEBUDDY_REGION".to_string(), "cn".to_string())]);

        let hy3 = effort_cache_key(&command, &environment, &normalize_model_id(" hy3 "));
        let glm = effort_cache_key(&command, &environment, &normalize_model_id("glm-5.2"));
        let default_model =
            effort_cache_key(&command, &environment, &normalize_model_id("default-model"));
        let default = effort_cache_key(&command, &environment, &normalize_model_id("default"));

        assert_ne!(hy3, glm);
        assert_eq!(default_model, default);
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
    fn parses_available_command_notifications_without_exposing_unknown_commands() {
        let commands = parse_available_commands_notification(&json!({
            "method": "session/update",
            "params": {
                "update": {
                    "sessionUpdate": "available_commands_update",
                    "availableCommands": [
                        { "name": "review", "description": "Review context" },
                        { "name": "unsafe-internal", "description": "Not embedded" }
                    ]
                }
            }
        }))
        .expect("command notification");

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "review");
        assert!(parse_available_commands_notification(&json!({
            "method": "session/update",
            "params": { "update": { "sessionUpdate": "other" } }
        }))
        .is_none());
    }

    #[tokio::test]
    async fn concurrent_capability_requests_share_one_discovery() {
        static NEXT_KEY: AtomicUsize = AtomicUsize::new(10_000);
        let key = NEXT_KEY.fetch_add(1, Ordering::Relaxed) as u64;
        let discoveries = Arc::new(AtomicUsize::new(0));
        let discover_one = discoveries.clone();
        let discover_two = discoveries.clone();

        let first = get_or_discover_capabilities_by_key(key, move || async move {
            discover_one.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            Ok(CachedCapabilities {
                loaded_at: Instant::now(),
                models: vec![CliModelInfo::new("default", "Default", true)],
                commands: Some(vec![CliCommandInfo::new("review", "Review context")]),
                current_model: Some("hy3".to_string()),
            })
        });
        let second = get_or_discover_capabilities_by_key(key, move || async move {
            discover_two.fetch_add(1, Ordering::SeqCst);
            Ok(CachedCapabilities {
                loaded_at: Instant::now(),
                models: vec![CliModelInfo::new("default", "Default", true)],
                commands: None,
                current_model: None,
            })
        });

        let (first, second) = tokio::join!(first, second);
        let first = first.unwrap();
        let second = second.unwrap();
        assert_eq!(discoveries.load(Ordering::SeqCst), 1);
        assert_eq!(first.current_model, Some("hy3".to_string()));
        assert_eq!(second.current_model, Some("hy3".to_string()));
        assert_eq!(second.commands.unwrap()[0].name, "review");

        CAPABILITY_CACHE.lock().await.remove(&key);
        CAPABILITY_DISCOVERY_LOCKS.lock().await.remove(&key);
    }

    #[tokio::test]
    async fn concurrent_effort_requests_share_one_model_scoped_discovery() {
        static NEXT_KEY: AtomicUsize = AtomicUsize::new(20_000);
        let key = NEXT_KEY.fetch_add(1, Ordering::Relaxed) as u64;
        let discoveries = Arc::new(AtomicUsize::new(0));
        let discover_one = discoveries.clone();
        let discover_two = discoveries.clone();

        let first = get_or_discover_efforts_by_key(key, move || async move {
            discover_one.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            Ok(vec!["low".to_string(), "high".to_string()])
        });
        let second = get_or_discover_efforts_by_key(key, move || async move {
            discover_two.fetch_add(1, Ordering::SeqCst);
            Ok(vec!["incorrect-second-result".to_string()])
        });

        let (first, second) = tokio::join!(first, second);
        assert_eq!(discoveries.load(Ordering::SeqCst), 1);
        let expected = vec!["low".to_string(), "high".to_string()];
        assert_eq!(first.unwrap(), expected);
        assert_eq!(second.unwrap(), expected);

        EFFORT_CACHE.lock().await.remove(&key);
        EFFORT_DISCOVERY_LOCKS.lock().await.remove(&key);
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
