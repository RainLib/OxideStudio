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

const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(15);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const AUTHENTICATION_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone)]
struct CachedModels {
    key: u64,
    loaded_at: Instant,
    ttl: Duration,
    models: Vec<CliModelInfo>,
}

static MODEL_CACHE: LazyLock<Mutex<Option<CachedModels>>> = LazyLock::new(|| Mutex::new(None));

pub fn common_commands() -> Vec<CliCommandInfo> {
    vec![
        CliCommandInfo::new(
            "review",
            "Start Codex's native review workflow for the current context",
        )
        .with_argument_hint("optional review focus"),
        CliCommandInfo::new(
            "plan",
            "Switch the request to Codex Plan collaboration mode",
        ),
        CliCommandInfo::new("compact", "Compact the current Codex thread context")
            .with_argument_hint("optional summary instructions"),
        CliCommandInfo::new("skills", "List skills available to the Codex session"),
        CliCommandInfo::new(
            "status",
            "Show the active Codex model, account and context status",
        ),
    ]
}

pub async fn detect(
    configured_path: Option<&str>,
    environment: &BTreeMap<String, String>,
) -> CliDetectionResult {
    match resolve_command(CliProviderKind::CodexCli, configured_path).await {
        Ok(command) => match version(&command, environment).await {
            Ok(version) => CliDetectionResult {
                provider: CliProviderKind::CodexCli,
                available: true,
                executable_path: command.resolved_path.clone(),
                version: Some(version),
                message: "Codex CLI is available".to_string(),
            },
            Err(error) => CliDetectionResult {
                provider: CliProviderKind::CodexCli,
                available: false,
                executable_path: command.resolved_path.clone(),
                version: None,
                message: classify_error(&error.to_string()),
            },
        },
        Err(error) => CliDetectionResult {
            provider: CliProviderKind::CodexCli,
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
    let command =
        resolve_command(CliProviderKind::CodexCli, config.executable_path.as_deref()).await?;
    let key = model_cache_key(&command, environment);
    let now = Instant::now();
    if let Some(cached) = MODEL_CACHE.lock().await.as_ref() {
        if cached.key == key && now.saturating_duration_since(cached.loaded_at) < cached.ttl {
            return Ok(cached.models.clone());
        }
    }
    let models = discover_models(&command, environment)
        .await
        .map_err(|error| {
            anyhow!(
                "Codex model catalog is unavailable: {}",
                classify_error(&error.to_string())
            )
        })?;
    if models.is_empty() {
        return Err(anyhow!("Codex model catalog returned no models"));
    }
    *MODEL_CACHE.lock().await = Some(CachedModels {
        key,
        loaded_at: now,
        ttl: Duration::from_secs(5 * 60),
        models: models.clone(),
    });
    Ok(models)
}

fn model_cache_key(command: &CliCommandSpec, environment: &BTreeMap<String, String>) -> u64 {
    let mut hasher = DefaultHasher::new();
    command.program.hash(&mut hasher);
    command.prefix_args.hash(&mut hasher);
    environment.hash(&mut hasher);
    hasher.finish()
}

pub async fn test_connection(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<CliConnectionTestResult> {
    let started = Instant::now();
    let command =
        resolve_command(CliProviderKind::CodexCli, config.executable_path.as_deref()).await?;
    let cli_version = version(&command, environment).await?;
    verify_authentication(&command, environment).await?;
    let models = discover_models(&command, environment)
        .await
        .map_err(|error| anyhow!(classify_error(&error.to_string())))?;
    if models.is_empty() {
        return Err(anyhow!(
            "Codex CLI returned no models; sign in with `codex login` and try again"
        ));
    }
    let model = effective_connection_model(config.model.trim(), &models);
    Ok(CliConnectionTestResult {
        message: "Codex CLI is ready. Existing sign-in verified.".to_string(),
        model,
        executable_path: command.resolved_path.unwrap_or(command.program),
        version: Some(cli_version),
        latency_ms: started.elapsed().as_millis() as u64,
    })
}

fn effective_connection_model(configured_model: &str, models: &[CliModelInfo]) -> String {
    if configured_model.is_empty() || configured_model.eq_ignore_ascii_case("default") {
        // `default` is a UI sentinel rather than necessarily a valid concrete
        // Codex model id. Connection diagnostics report a discovered concrete
        // model without overloading `is_default` on catalog entries.
        models
            .iter()
            .find(|model| model.id != "default")
            .map(|model| model.id.clone())
            .unwrap_or_else(|| "default".to_string())
    } else {
        configured_model.to_string()
    }
}

async fn verify_authentication(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<()> {
    // model/list is intentionally not used as an authentication signal: Codex
    // can publish a model catalog before an account has signed in.
    let output = run_captured(
        command,
        &["login".to_string(), "status".to_string()],
        environment,
        None,
        None,
        AUTHENTICATION_TIMEOUT,
    )
    .await?;
    if output.success {
        return Ok(());
    }
    let diagnostic = [output.stderr.trim(), output.stdout.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Err(anyhow!(classify_error(&diagnostic)))
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
    let version = output
        .stdout
        .lines()
        .chain(output.stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Codex CLI")
        .chars()
        .take(200)
        .collect();
    Ok(version)
}

async fn discover_models(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<CliModelInfo>> {
    tokio::time::timeout(
        DISCOVERY_TIMEOUT,
        discover_models_inner(command, environment),
    )
    .await
    .map_err(|_| anyhow!("Codex model discovery timed out"))?
}

async fn discover_models_inner(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<CliModelInfo>> {
    let cwd = isolated_working_directory()?;
    let mut process = Command::new(&command.program);
    process
        .args(&command.prefix_args)
        .arg("app-server")
        .envs(environment)
        .current_dir(cwd.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = process
        .spawn()
        .context("failed to start Codex app-server")?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("Codex app-server stdin is unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Codex app-server stdout is unavailable"))?;
    let mut lines = BufReader::new(stdout).lines();
    write_message(
        &mut stdin,
        &json!({
            "method": "initialize",
            "id": 1,
            "params": {
                "clientInfo": {
                    "name": "oxide-studio",
                    "title": "OxideStudio",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }),
    )
    .await?;

    let mut request_id = 2u64;
    let mut model_values = Vec::new();
    while let Some(line) = lines
        .next_line()
        .await
        .context("failed to read Codex app-server output")?
    {
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match message.get("id").and_then(Value::as_u64) {
            Some(1) => {
                if let Some(error) = message.get("error") {
                    return Err(anyhow!("Codex initialization failed: {error}"));
                }
                write_message(&mut stdin, &json!({ "method": "initialized" })).await?;
                write_model_request(&mut stdin, request_id, None).await?;
            }
            Some(id) if id == request_id => {
                if let Some(error) = message.get("error") {
                    return Err(anyhow!("Codex model discovery failed: {error}"));
                }
                let page = message
                    .pointer("/result/data")
                    .or_else(|| message.pointer("/result/models"))
                    .and_then(Value::as_array)
                    .ok_or_else(|| anyhow!("Codex model discovery returned invalid data"))?;
                model_values.extend(page.iter().cloned());
                let cursor = message
                    .pointer("/result/nextCursor")
                    .or_else(|| message.pointer("/result/next_cursor"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                if let Some(cursor) = cursor {
                    request_id += 1;
                    write_model_request(&mut stdin, request_id, Some(cursor)).await?;
                    continue;
                }
                return parse_models(&model_values);
            }
            _ => {}
        }
    }
    Err(anyhow!(
        "Codex app-server exited before model discovery completed"
    ))
}

async fn write_message(stdin: &mut tokio::process::ChildStdin, value: &Value) -> Result<()> {
    let mut payload = serde_json::to_vec(value)?;
    payload.push(b'\n');
    stdin.write_all(&payload).await?;
    stdin.flush().await?;
    Ok(())
}

async fn write_model_request(
    stdin: &mut tokio::process::ChildStdin,
    id: u64,
    cursor: Option<&str>,
) -> Result<()> {
    let params = cursor.map_or_else(|| json!({}), |cursor| json!({ "cursor": cursor }));
    write_message(
        stdin,
        &json!({ "method": "model/list", "id": id, "params": params }),
    )
    .await
}

fn parse_models(models: &[Value]) -> Result<Vec<CliModelInfo>> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    let mut default_model_id = None;
    let mut synthetic_default_efforts = Vec::new();
    let mut saw_model = false;
    for model in models {
        let Some(id) = model
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| model.get("model").and_then(Value::as_str))
            .map(str::trim)
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        saw_model = true;
        let label = model
            .get("displayName")
            .or_else(|| model.get("display_name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .unwrap_or(id);
        let is_provider_default = model
            .get("isDefault")
            .or_else(|| model.get("is_default"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if is_provider_default && !id.eq_ignore_ascii_case("default") && default_model_id.is_none()
        {
            default_model_id = Some(id.to_string());
        }
        let mut seen_efforts = HashSet::new();
        let reasoning_efforts = model
            .get("supportedReasoningEfforts")
            .or_else(|| model.get("supported_reasoning_efforts"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                entry
                    .as_str()
                    .or_else(|| entry.get("reasoningEffort").and_then(Value::as_str))
                    .or_else(|| entry.get("effort").and_then(Value::as_str))
            })
            .map(str::trim)
            .filter(|effort| !effort.is_empty() && seen_efforts.insert((*effort).to_string()))
            .map(str::to_string)
            .collect();
        // `default` is OxideStudio's provider-default sentinel. Never expose a
        // provider entry with the same id alongside the synthetic sentinel.
        if id.eq_ignore_ascii_case("default") {
            if synthetic_default_efforts.is_empty() {
                synthetic_default_efforts = reasoning_efforts;
            }
            continue;
        }
        if !seen.insert(id.to_string()) {
            continue;
        }
        let mut info = CliModelInfo::new(id, label, false);
        info.is_provider_default = is_provider_default;
        info.reasoning_efforts = reasoning_efforts;
        result.push(info);
    }
    if !saw_model {
        return Err(anyhow!("Codex model discovery returned no models"));
    }
    let mut default = CliModelInfo::new("default", "Default", true);
    if let Some(default_id) = default_model_id {
        if let Some(model) = result.iter().find(|model| model.id == default_id) {
            default.reasoning_efforts = model.reasoning_efforts.clone();
        }
    }
    if default.reasoning_efforts.is_empty() {
        default.reasoning_efforts = synthetic_default_efforts;
    }
    result.insert(0, default);
    Ok(result)
}

fn classify_error(value: &str) -> String {
    let diagnostic = bounded_diagnostic(value);
    let lower = diagnostic.to_ascii_lowercase();
    if lower.contains("not authenticated")
        || lower.contains("not logged in")
        || lower.contains("login required")
        || lower.contains("unauthorized")
    {
        return "Codex CLI is not authenticated. Run `codex login` in a terminal and try again."
            .to_string();
    }
    if lower.contains("not installed")
        || lower.contains("not found")
        || lower.contains("no such file")
    {
        return "Codex CLI is not installed or cannot be found. Install it or select its executable path.".to_string();
    }
    if diagnostic.is_empty() {
        "Codex CLI failed without diagnostic output".to_string()
    } else {
        format!("Codex CLI failed: {diagnostic}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_app_server_models_and_effort_levels() {
        let models = parse_models(&[
            json!({
                "id": "gpt-test",
                "displayName": "GPT Test",
                "isDefault": true,
                "supportedReasoningEfforts": [
                    " low ",
                    "low",
                    {"reasoningEffort":"high"},
                    {"effort":" high "},
                    " "
                ]
            }),
            json!({"id":"gpt-test"}),
        ])
        .unwrap();
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["default", "gpt-test"]
        );
        assert_eq!(models[0].reasoning_efforts, ["low", "high"]);
        assert_eq!(models.iter().filter(|model| model.is_default).count(), 1);
        assert!(models[0].is_default);
        assert!(!models[1].is_default);
        assert!(models[1].is_provider_default);
    }

    #[test]
    fn replaces_provider_default_sentinel_with_one_synthetic_default() {
        let models = parse_models(&[
            json!({
                "id": "default",
                "isDefault": true,
                "supportedReasoningEfforts": ["medium", " medium "]
            }),
            json!({ "id": "gpt-test", "isDefault": true }),
        ])
        .unwrap();

        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["default", "gpt-test"]
        );
        assert_eq!(models.iter().filter(|model| model.is_default).count(), 1);
        assert!(models[0].is_default);
        assert!(!models[1].is_default);
        assert!(models[1].is_provider_default);
    }

    #[test]
    fn resolves_default_connection_model_to_a_concrete_catalog_entry() {
        let models = vec![
            CliModelInfo::new("default", "Default", true),
            CliModelInfo::new("gpt-test", "GPT Test", false),
        ];

        assert_eq!(effective_connection_model("default", &models), "gpt-test");
        assert_eq!(effective_connection_model("", &models), "gpt-test");
        assert_eq!(effective_connection_model("custom", &models), "custom");
    }

    #[test]
    fn classifies_authentication_failures() {
        assert!(classify_error("Unauthorized: login required").contains("codex login"));
    }
}
