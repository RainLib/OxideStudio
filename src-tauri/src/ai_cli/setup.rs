use crate::ai_cli::{
    codebuddy, codex,
    runtime::{
        apply_environment, isolated_working_directory, resolve_command, resolve_named_command,
        run_captured, CliCommandSpec,
    },
    CliAuthenticationLaunchResult, CliAuthenticationMethod, CliAuthenticationPhase,
    CliAuthenticationStatus, CliInstallResult, CliProviderConfig, CliProviderKind,
};
use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
    process::Stdio,
    sync::LazyLock,
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{watch, Mutex},
};
use url::Url;

const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const AUTHENTICATION_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const AUTHENTICATION_INITIALIZE_TIMEOUT: Duration = Duration::from_secs(30);
const NPM_REGISTRY: &str = "https://registry.npmjs.org/";

struct ManagedAuthenticationSession {
    profile_id: String,
    status: CliAuthenticationStatus,
    cancellation: watch::Sender<bool>,
}

static AUTHENTICATION_SESSIONS: LazyLock<Mutex<HashMap<String, ManagedAuthenticationSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub async fn install_provider(
    app: &AppHandle,
    provider: CliProviderKind,
) -> Result<CliInstallResult> {
    let npm = resolve_named_command("npm").map_err(|error| {
        anyhow!(
            "Node.js and npm are required for managed installation. Install Node.js LTS or, if it was installed after OxideStudio started, restart OxideStudio and retry. {error}"
        )
    })?;
    let package = match provider {
        CliProviderKind::CodexCli => "@openai/codex@latest",
        CliProviderKind::CodebuddyCli => "@tencent-ai/codebuddy-code@latest",
    };
    let target = managed_provider_root(app, provider)?;
    std::fs::create_dir_all(&target)
        .with_context(|| format!("failed to create {}", target.display()))?;
    let args = vec![
        "install".to_string(),
        "--prefix".to_string(),
        target.to_string_lossy().into_owned(),
        "--no-save".to_string(),
        "--omit=dev".to_string(),
        "--no-audit".to_string(),
        "--no-fund".to_string(),
        format!("--registry={NPM_REGISTRY}"),
        package.to_string(),
    ];
    let output = run_captured(
        &npm,
        &args,
        &BTreeMap::new(),
        Some(&target),
        None,
        INSTALL_TIMEOUT,
    )
    .await?;
    if !output.success {
        let detail = output
            .stderr
            .lines()
            .chain(output.stdout.lines())
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("npm did not provide an error message");
        return Err(anyhow!("managed installation failed: {detail}"));
    }

    let executable_path = managed_executable_path(&target, provider);
    if !executable_path.is_file() {
        return Err(anyhow!(
            "managed installation completed but {} was not created",
            executable_path.display()
        ));
    }
    Ok(CliInstallResult {
        provider,
        executable_path: executable_path.to_string_lossy().into_owned(),
        message: format!(
            "{} was installed in OxideStudio's managed agent directory",
            provider.display_name()
        ),
    })
}

pub async fn begin_authentication(
    app: &AppHandle,
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    method_id: Option<&str>,
) -> Result<CliAuthenticationLaunchResult> {
    resolve_command(config.kind, config.executable_path.as_deref()).await?;
    let method_id = match config.kind {
        CliProviderKind::CodexCli => Some("browser".to_string()),
        CliProviderKind::CodebuddyCli => Some(
            method_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("external")
                .to_string(),
        ),
    };
    let session_id = uuid::Uuid::new_v4().to_string();
    let (cancellation, receiver) = watch::channel(false);
    {
        let mut sessions = AUTHENTICATION_SESSIONS.lock().await;
        if sessions.len() >= 128 {
            sessions.retain(|_, session| !session.status.phase.is_terminal());
        }
        for session in sessions.values_mut().filter(|session| {
            session.status.provider == config.kind
                && session.profile_id == config.profile_id
                && !session.status.phase.is_terminal()
        }) {
            let _ = session.cancellation.send(true);
            session.status.phase = CliAuthenticationPhase::Cancelled;
            session.status.message = "A newer sign-in attempt replaced this one.".to_string();
        }
        sessions.insert(
            session_id.clone(),
            ManagedAuthenticationSession {
                profile_id: config.profile_id.clone(),
                status: CliAuthenticationStatus {
                    session_id: session_id.clone(),
                    provider: config.kind,
                    phase: CliAuthenticationPhase::Starting,
                    message: format!("Starting {} secure sign-in...", config.kind.display_name()),
                    method_id: method_id.clone(),
                },
                cancellation,
            },
        );
    }

    let task_app = app.clone();
    let task_config = config.clone();
    let task_environment = environment.clone();
    let task_session_id = session_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = match task_config.kind {
            CliProviderKind::CodexCli => {
                run_codex_authentication(
                    &task_app,
                    &task_session_id,
                    &task_config,
                    &task_environment,
                    receiver,
                )
                .await
            }
            CliProviderKind::CodebuddyCli => {
                run_codebuddy_authentication(
                    &task_app,
                    &task_session_id,
                    &task_config,
                    &task_environment,
                    method_id.as_deref().unwrap_or("internal"),
                    receiver,
                )
                .await
            }
        };
        if let Err(error) = result {
            finish_authentication_error(&task_session_id, &error.to_string()).await;
        }
    });

    Ok(CliAuthenticationLaunchResult {
        provider: config.kind,
        session_id,
        message: format!(
            "{} sign-in is starting. OxideStudio will open the provider login in your browser and confirm the returned account automatically.",
            config.kind.display_name()
        ),
    })
}

pub async fn authentication_methods(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<CliAuthenticationMethod>> {
    match config.kind {
        CliProviderKind::CodexCli => Ok(vec![CliAuthenticationMethod {
            id: "browser".to_string(),
            name: "ChatGPT / Codex account".to_string(),
            description: Some("Continue with the secure Codex browser sign-in.".to_string()),
        }]),
        CliProviderKind::CodebuddyCli => {
            codebuddy_authentication_methods(config, environment).await
        }
    }
}

pub async fn authentication_status(session_id: &str) -> Result<CliAuthenticationStatus> {
    AUTHENTICATION_SESSIONS
        .lock()
        .await
        .get(session_id)
        .map(|session| session.status.clone())
        .ok_or_else(|| anyhow!("authentication session is no longer available"))
}

pub async fn cancel_authentication(session_id: &str) -> Result<CliAuthenticationStatus> {
    let mut sessions = AUTHENTICATION_SESSIONS.lock().await;
    let session = sessions
        .get_mut(session_id)
        .ok_or_else(|| anyhow!("authentication session is no longer available"))?;
    if !session.status.phase.is_terminal() {
        let _ = session.cancellation.send(true);
        session.status.phase = CliAuthenticationPhase::Cancelled;
        session.status.message =
            "Sign-in was cancelled. Your existing CLI credentials were not changed.".to_string();
    }
    Ok(session.status.clone())
}

async fn codebuddy_authentication_methods(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<CliAuthenticationMethod>> {
    let command = resolve_command(config.kind, config.executable_path.as_deref()).await?;
    let (_cwd, mut child, mut stdin, mut lines) =
        start_codebuddy_acp(&command, environment).await?;
    write_rpc(&mut stdin, 1, "initialize", codebuddy_initialize_params()).await?;
    let initialized = tokio::time::timeout(
        AUTHENTICATION_INITIALIZE_TIMEOUT,
        read_rpc_result(&mut lines, 1),
    )
    .await
    .map_err(|_| anyhow!("CodeBuddy authentication discovery timed out"))??;
    let _ = child.kill().await;
    let mut methods = parse_authentication_methods(&initialized);
    methods.sort_by_key(|method| match method.id.as_str() {
        "external" => 0,
        "internal" => 1,
        "iOA" => 2,
        "selfhosted" => 3,
        _ => 4,
    });
    if methods.is_empty() {
        return Err(anyhow!(
            "CodeBuddy did not advertise any supported authentication methods"
        ));
    }
    Ok(methods)
}

async fn run_codebuddy_authentication(
    app: &AppHandle,
    session_id: &str,
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    method_id: &str,
    mut cancellation: watch::Receiver<bool>,
) -> Result<()> {
    let command = resolve_command(config.kind, config.executable_path.as_deref()).await?;
    let (_cwd, mut child, mut stdin, mut lines) =
        start_codebuddy_acp(&command, environment).await?;
    write_rpc(&mut stdin, 1, "initialize", codebuddy_initialize_params()).await?;
    let initialized = tokio::time::timeout(
        AUTHENTICATION_INITIALIZE_TIMEOUT,
        read_rpc_result(&mut lines, 1),
    )
    .await
    .map_err(|_| anyhow!("CodeBuddy authentication initialization timed out"))??;
    let methods = parse_authentication_methods(&initialized);
    if !methods.iter().any(|method| method.id == method_id) {
        let _ = child.kill().await;
        return Err(anyhow!(
            "CodeBuddy does not support authentication method `{method_id}`"
        ));
    }

    // A genuine account response is authoritative. Avoid CodeBuddy's forced
    // re-authentication behavior when the CLI is already signed in.
    write_rpc(&mut stdin, 2, "_codebuddy.ai/getUserInfo", json!({})).await?;
    let user_info = tokio::time::timeout(
        AUTHENTICATION_INITIALIZE_TIMEOUT,
        read_rpc_result(&mut lines, 2),
    )
    .await
    .map_err(|_| anyhow!("CodeBuddy account lookup timed out"))??;
    if has_codebuddy_user(&user_info) {
        update_authentication(
            session_id,
            CliAuthenticationPhase::Verifying,
            "Existing CodeBuddy account found. Verifying the provider session...",
        )
        .await;
        let _ = child.kill().await;
        codebuddy::test_connection(config, environment).await?;
        update_authentication(
            session_id,
            CliAuthenticationPhase::Succeeded,
            "CodeBuddy is signed in and ready in OxideStudio.",
        )
        .await;
        return Ok(());
    }

    update_authentication(
        session_id,
        CliAuthenticationPhase::WaitingForBrowser,
        "Preparing the CodeBuddy browser sign-in...",
    )
    .await;
    write_rpc(
        &mut stdin,
        3,
        "authenticate",
        json!({ "methodId": method_id }),
    )
    .await?;

    let deadline = tokio::time::sleep(AUTHENTICATION_TIMEOUT);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            changed = cancellation.changed() => {
                if changed.is_err() || *cancellation.borrow() {
                    let _ = child.kill().await;
                    return Err(anyhow!("authentication cancelled"));
                }
            }
            _ = &mut deadline => {
                let _ = child.kill().await;
                update_authentication(
                    session_id,
                    CliAuthenticationPhase::Expired,
                    "CodeBuddy sign-in expired. Start a new sign-in attempt.",
                ).await;
                return Ok(());
            }
            next = lines.next_line() => {
                let Some(line) = next.context("failed to read CodeBuddy authentication response")? else {
                    return Err(anyhow!("CodeBuddy closed before browser sign-in completed"));
                };
                let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
                    continue;
                };
                if value.get("method").and_then(Value::as_str) == Some("_codebuddy.ai/authUrl") {
                    let auth_url = value
                        .get("params")
                        .and_then(|params| params.get("authUrl"))
                        .and_then(Value::as_str)
                        .ok_or_else(|| anyhow!("CodeBuddy returned an invalid browser sign-in response"))?;
                    open_authentication_url(app, auth_url)?;
                    update_authentication(
                        session_id,
                        CliAuthenticationPhase::WaitingForCallback,
                        "Complete sign-in in your browser. OxideStudio is waiting for CodeBuddy to confirm the account...",
                    ).await;
                    continue;
                }
                if value.get("id").and_then(Value::as_u64) != Some(3) {
                    continue;
                }
                if let Some(error) = value.get("error") {
                    return Err(anyhow!("CodeBuddy authentication failed: {error}"));
                }
                update_authentication(
                    session_id,
                    CliAuthenticationPhase::Verifying,
                    "CodeBuddy confirmed the account. Verifying the provider session...",
                ).await;
                let _ = child.kill().await;
                codebuddy::test_connection(config, environment).await?;
                update_authentication(
                    session_id,
                    CliAuthenticationPhase::Succeeded,
                    "CodeBuddy is signed in and ready in OxideStudio.",
                ).await;
                return Ok(());
            }
        }
    }
}

async fn run_codex_authentication(
    app: &AppHandle,
    session_id: &str,
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    mut cancellation: watch::Receiver<bool>,
) -> Result<()> {
    if codex::test_connection(config, environment).await.is_ok() {
        update_authentication(
            session_id,
            CliAuthenticationPhase::Succeeded,
            "Codex is already signed in and ready in OxideStudio.",
        )
        .await;
        return Ok(());
    }
    let command = resolve_command(config.kind, config.executable_path.as_deref()).await?;
    let (_cwd, mut child, mut stdin, mut lines) =
        start_codex_app_server(&command, environment).await?;
    write_codex_rpc(
        &mut stdin,
        1,
        "initialize",
        json!({
            "clientInfo": {
                "name": "oxide-studio",
                "title": "OxideStudio",
                "version": env!("CARGO_PKG_VERSION")
            }
        }),
    )
    .await?;
    tokio::time::timeout(
        AUTHENTICATION_INITIALIZE_TIMEOUT,
        read_rpc_result(&mut lines, 1),
    )
    .await
    .map_err(|_| anyhow!("Codex authentication initialization timed out"))??;
    write_notification(&mut stdin, "initialized", None).await?;
    update_authentication(
        session_id,
        CliAuthenticationPhase::WaitingForBrowser,
        "Preparing the secure Codex browser sign-in...",
    )
    .await;
    write_codex_rpc(
        &mut stdin,
        2,
        "account/login/start",
        json!({
            "type": "chatgpt",
            "useHostedLoginSuccessPage": true,
            "appBrand": "codex"
        }),
    )
    .await?;
    let login = tokio::time::timeout(
        AUTHENTICATION_INITIALIZE_TIMEOUT,
        read_rpc_result(&mut lines, 2),
    )
    .await
    .map_err(|_| anyhow!("Codex browser sign-in did not start in time"))??;
    let login_id = login
        .get("loginId")
        .or_else(|| login.get("login_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("Codex did not return a login session id"))?
        .to_string();
    let auth_url = login
        .get("authUrl")
        .or_else(|| login.get("auth_url"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Codex did not return a browser sign-in URL"))?;
    open_authentication_url(app, auth_url)?;
    update_authentication(
        session_id,
        CliAuthenticationPhase::WaitingForCallback,
        "Complete sign-in in your browser. OxideStudio is waiting for Codex to confirm the account...",
    )
    .await;
    let deadline = tokio::time::sleep(AUTHENTICATION_TIMEOUT);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            changed = cancellation.changed() => {
                if changed.is_err() || *cancellation.borrow() {
                    let _ = write_codex_rpc(
                        &mut stdin,
                        3,
                        "account/login/cancel",
                        json!({ "loginId": login_id }),
                    ).await;
                    let _ = child.kill().await;
                    return Err(anyhow!("authentication cancelled"));
                }
            }
            _ = &mut deadline => {
                let _ = write_codex_rpc(
                    &mut stdin,
                    3,
                    "account/login/cancel",
                    json!({ "loginId": login_id }),
                ).await;
                let _ = child.kill().await;
                update_authentication(
                    session_id,
                    CliAuthenticationPhase::Expired,
                    "Codex sign-in expired. Start a new sign-in attempt.",
                ).await;
                return Ok(());
            }
            next = lines.next_line() => {
                let Some(line) = next.context("failed to read Codex authentication response")? else {
                    return Err(anyhow!("Codex closed before browser sign-in completed"));
                };
                let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
                    continue;
                };
                if value.get("method").and_then(Value::as_str) != Some("account/login/completed") {
                    continue;
                }
                let params = value.get("params").unwrap_or(&Value::Null);
                let completed_login_id = params
                    .get("loginId")
                    .or_else(|| params.get("login_id"))
                    .and_then(Value::as_str);
                if completed_login_id.is_some_and(|completed| completed != login_id) {
                    continue;
                }
                let success = params.get("success").and_then(Value::as_bool).unwrap_or(false);
                if !success {
                    let detail = params
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Codex did not authorize this account");
                    let _ = child.kill().await;
                    return Err(anyhow!("Codex browser sign-in failed: {detail}"));
                }
                break;
            }
        }
    }
    let _ = child.kill().await;
    update_authentication(
        session_id,
        CliAuthenticationPhase::Verifying,
        "Codex confirmed the account. Verifying the provider session...",
    )
    .await;
    codex::test_connection(config, environment).await?;
    update_authentication(
        session_id,
        CliAuthenticationPhase::Succeeded,
        "Codex is signed in and ready in OxideStudio.",
    )
    .await;
    Ok(())
}

async fn start_codex_app_server(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<(
    tempfile::TempDir,
    Child,
    ChildStdin,
    tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
)> {
    let cwd = isolated_working_directory()?;
    let mut process = Command::new(&command.program);
    process
        .args(&command.prefix_args)
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

async fn start_codebuddy_acp(
    command: &CliCommandSpec,
    environment: &BTreeMap<String, String>,
) -> Result<(
    tempfile::TempDir,
    Child,
    ChildStdin,
    tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
)> {
    let cwd = isolated_working_directory()?;
    let mut process = Command::new(&command.program);
    process
        .args(&command.prefix_args)
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

fn codebuddy_initialize_params() -> Value {
    json!({
        "protocolVersion": 1,
        "clientCapabilities": {
            "fs": { "readTextFile": false, "writeTextFile": false },
            "terminal": false,
            "auth": { "terminal": false }
        },
        "clientInfo": {
            "name": "OxideStudio",
            "version": env!("CARGO_PKG_VERSION")
        }
    })
}

fn parse_authentication_methods(value: &Value) -> Vec<CliAuthenticationMethod> {
    value
        .get("authMethods")
        .or_else(|| value.get("auth_methods"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|method| {
            let id = method.get("id")?.as_str()?.trim();
            let name = method.get("name")?.as_str()?.trim();
            if id.is_empty() || name.is_empty() {
                return None;
            }
            Some(CliAuthenticationMethod {
                id: id.to_string(),
                name: name.to_string(),
                description: method
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .or_else(|| authentication_method_description(id).map(str::to_string)),
            })
        })
        .collect()
}

fn authentication_method_description(id: &str) -> Option<&'static str> {
    match id {
        "external" => Some("Continue with Google or GitHub in your browser."),
        "internal" => Some("Continue with WeChat in your browser."),
        "iOA" => Some("Continue with your organization iOA account."),
        "selfhosted" => Some("Continue with an enterprise domain account."),
        _ => None,
    }
}

fn has_codebuddy_user(value: &Value) -> bool {
    value
        .get("userInfo")
        .or_else(|| value.get("user_info"))
        .is_some_and(|user| user.is_object() && !user.as_object().is_some_and(|map| map.is_empty()))
}

fn open_authentication_url(app: &AppHandle, value: &str) -> Result<()> {
    let url = Url::parse(value).context("CLI provider returned an invalid authentication URL")?;
    if !matches!(url.scheme(), "https" | "http") {
        return Err(anyhow!(
            "CLI provider returned an unsupported authentication URL scheme"
        ));
    }
    app.opener()
        .open_url(url.as_str(), None::<String>)
        .context("failed to open the provider sign-in page")
}

async fn write_rpc(stdin: &mut ChildStdin, id: u64, method: &str, params: Value) -> Result<()> {
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

async fn write_codex_rpc(
    stdin: &mut ChildStdin,
    id: u64,
    method: &str,
    params: Value,
) -> Result<()> {
    write_message(
        stdin,
        &json!({
            "id": id,
            "method": method,
            "params": params
        }),
    )
    .await
}

async fn write_notification(
    stdin: &mut ChildStdin,
    method: &str,
    params: Option<Value>,
) -> Result<()> {
    let message = params.map_or_else(
        || json!({ "method": method }),
        |params| json!({ "method": method, "params": params }),
    );
    write_message(stdin, &message).await
}

async fn write_message(stdin: &mut ChildStdin, value: &Value) -> Result<()> {
    let mut payload = serde_json::to_vec(value)?;
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
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if value.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            return Err(anyhow!("CLI protocol request failed: {error}"));
        }
        return Ok(value.get("result").cloned().unwrap_or(Value::Null));
    }
    Err(anyhow!("CLI provider exited before responding"))
}

async fn update_authentication(
    session_id: &str,
    phase: CliAuthenticationPhase,
    message: impl Into<String>,
) {
    if let Some(session) = AUTHENTICATION_SESSIONS.lock().await.get_mut(session_id) {
        if !session.status.phase.is_terminal() {
            session.status.phase = phase;
            session.status.message = message.into();
        }
    }
}

async fn finish_authentication_error(session_id: &str, error: &str) {
    let mut sessions = AUTHENTICATION_SESSIONS.lock().await;
    let Some(session) = sessions.get_mut(session_id) else {
        return;
    };
    if session.status.phase.is_terminal() {
        return;
    }
    if error.contains("authentication cancelled") {
        session.status.phase = CliAuthenticationPhase::Cancelled;
        session.status.message =
            "Sign-in was cancelled. Your existing CLI credentials were not changed.".to_string();
    } else {
        session.status.phase = CliAuthenticationPhase::Failed;
        session.status.message = error.to_string();
    }
}

fn managed_provider_root(app: &AppHandle, provider: CliProviderKind) -> Result<PathBuf> {
    let app_data = app
        .path()
        .app_data_dir()
        .context("failed to resolve the application data directory")?;
    Ok(app_data.join("ai-agents").join(provider.as_str()))
}

fn managed_executable_path(root: &std::path::Path, provider: CliProviderKind) -> PathBuf {
    let executable = match provider {
        CliProviderKind::CodexCli => "codex",
        CliProviderKind::CodebuddyCli => "codebuddy",
    };
    #[cfg(windows)]
    return root
        .join("node_modules")
        .join(".bin")
        .join(format!("{executable}.cmd"));
    #[cfg(not(windows))]
    return root.join("node_modules").join(".bin").join(executable);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_codebuddy_acp_authentication_methods() {
        let methods = parse_authentication_methods(&json!({
            "authMethods": [
                { "id": "internal", "name": "Login with WeChat", "description": null },
                { "id": "external", "name": "Login with Google/Github", "description": "Browser login" }
            ]
        }));
        assert_eq!(methods.len(), 2);
        assert_eq!(methods[0].id, "internal");
        assert_eq!(methods[1].description.as_deref(), Some("Browser login"));
    }

    #[test]
    fn recognizes_codebuddy_user_without_reading_credentials() {
        assert!(has_codebuddy_user(&json!({
            "userInfo": { "userName": "user", "token": "must-not-escape" }
        })));
        assert!(!has_codebuddy_user(&json!({ "userInfo": null })));
    }
}
