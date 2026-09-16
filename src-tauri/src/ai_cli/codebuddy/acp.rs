use super::{normalize_model_id, AcpCatalog};
use crate::ai_cli::{
    runtime::{isolated_working_directory, CliCommandSpec},
    CliCommandInfo, CliModelInfo,
};
use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashSet},
    process::Stdio,
    time::Duration,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const ACP_TIMEOUT: Duration = Duration::from_secs(15);
const COMMAND_NOTIFICATION_GRACE: Duration = Duration::from_millis(350);
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

pub(super) fn parse_available_commands(value: &Value) -> Vec<CliCommandInfo> {
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

pub(super) async fn discover_catalog_via_acp(
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
    let mut process = command.command();
    process
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

pub(super) fn has_authenticated_user(value: &Value) -> bool {
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

pub(super) fn parse_acp_model_options(value: &Value) -> Vec<CliModelInfo> {
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

pub(super) fn parse_available_commands_notification(value: &Value) -> Option<Vec<CliCommandInfo>> {
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

pub(super) fn parse_effort_options(value: &Value) -> Vec<String> {
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
        .filter(|value| {
            !value.is_empty()
                && !value.eq_ignore_ascii_case("enabled")
                && seen.insert(value.to_string())
        })
        .map(str::to_string)
        .collect()
}
