use crate::ai_cli::{
    codebuddy, codex,
    runtime::{
        apply_environment, isolated_working_directory, resolve_command, resolve_named_command,
        run_captured, CliCommandSpec,
    },
    CliAuthenticationLaunchResult, CliAuthenticationMethod, CliAuthenticationPhase,
    CliAuthenticationStatus, CliInstallResult, CliInstallationLaunchResult, CliInstallationPhase,
    CliInstallationStatus, CliProviderConfig, CliProviderKind,
};
use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
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
// OAuth callbacks may reach the browser before a CLI persists its refreshed
// credential. Keep verification bounded, but do not report a false failed
// sign-in just because the first account probe races that persistence.
const AUTHENTICATION_VERIFICATION_TIMEOUT: Duration = Duration::from_secs(18);
const AUTHENTICATION_VERIFICATION_RETRY: Duration = Duration::from_millis(900);
const NPM_REGISTRY: &str = "https://registry.npmjs.org/";
const CODEX_PACKAGE_VERSION: &str = "0.147.0";
const CODEX_PACKAGE_INTEGRITY: &str =
    "sha512-EQLEXecAG2ptxI7UpBMo2TR/ga5596/c/OsYF/0LoUDh5JANZ7IoGqlzBEWbuEVQ76JePIbtTW/ihCkp1a7Z3w==";
const CODEBUDDY_PACKAGE_VERSION: &str = "2.135.0";
const CODEBUDDY_PACKAGE_INTEGRITY: &str =
    "sha512-W6PgFWi16Px7V6F67qCZVJcfVhzW66oMhKgfoIPhtQPfhIO4TNWXawsPXfuULVgpyUl+kI6VWyR2CRQTUmC3TA==";

#[derive(Clone, Copy)]
struct ManagedPackageSpec {
    name: &'static str,
    version: &'static str,
    integrity: &'static str,
}

impl ManagedPackageSpec {
    fn reference(self) -> String {
        format!("{}@{}", self.name, self.version)
    }

    fn package_json_path(self, root: &Path) -> PathBuf {
        self.name
            .split('/')
            .fold(root.join("node_modules"), |path, part| path.join(part))
            .join("package.json")
    }
}

struct ManagedAuthenticationSession {
    profile_id: String,
    status: CliAuthenticationStatus,
    cancellation: watch::Sender<bool>,
}

struct ManagedInstallationSession {
    status: CliInstallationStatus,
}

static AUTHENTICATION_SESSIONS: LazyLock<Mutex<HashMap<String, ManagedAuthenticationSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static INSTALLATION_SESSIONS: LazyLock<Mutex<HashMap<String, ManagedInstallationSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub async fn install_provider(
    app: &AppHandle,
    provider: CliProviderKind,
) -> Result<CliInstallResult> {
    install_provider_with_progress(app, provider, None).await
}

async fn install_provider_with_progress(
    app: &AppHandle,
    provider: CliProviderKind,
    session_id: Option<&str>,
) -> Result<CliInstallResult> {
    let npm = resolve_named_command("npm").map_err(|error| {
        anyhow!(
            "Node.js and npm are required for managed installation. Install Node.js LTS or, if it was installed after OxideStudio started, restart OxideStudio and retry. {error}"
        )
    })?;
    let package = managed_package_spec(provider);
    let target = managed_provider_root(app, provider)?;
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("managed agent directory has no parent"))?;
    std::fs::create_dir_all(parent)
        .with_context(|| format!("failed to create {}", parent.display()))?;
    let install_id = uuid::Uuid::new_v4();
    let staging = parent.join(format!(".{}-install-{install_id}", provider.as_str()));
    std::fs::create_dir_all(&staging).with_context(|| {
        format!(
            "failed to create install staging directory {}",
            staging.display()
        )
    })?;
    if let Some(session_id) = session_id {
        update_installation(
            session_id,
            CliInstallationPhase::Downloading,
            "Downloading and verifying the managed CLI package...",
        )
        .await;
    }
    let archive = match download_verified_package(&npm, package, &staging, parent).await {
        Ok(archive) => archive,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let args = vec![
        "install".to_string(),
        "--prefix".to_string(),
        staging.to_string_lossy().into_owned(),
        "--no-save".to_string(),
        "--omit=dev".to_string(),
        "--no-audit".to_string(),
        "--no-fund".to_string(),
        format!("--registry={NPM_REGISTRY}"),
        archive.to_string_lossy().into_owned(),
    ];
    if let Some(session_id) = session_id {
        update_installation(
            session_id,
            CliInstallationPhase::Installing,
            "Installing the verified CLI package in OxideStudio...",
        )
        .await;
    }
    let install = run_captured(
        &npm,
        &args,
        &BTreeMap::new(),
        Some(&staging),
        None,
        INSTALL_TIMEOUT,
    )
    .await;
    let output = match install {
        Ok(output) => output,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error.context("managed installation failed before activation"));
        }
    };
    if !output.success {
        let detail = output
            .stderr
            .lines()
            .chain(output.stdout.lines())
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("npm did not provide an error message");
        let _ = std::fs::remove_dir_all(&staging);
        return Err(anyhow!("managed installation failed: {detail}"));
    }

    if let Some(session_id) = session_id {
        update_installation(
            session_id,
            CliInstallationPhase::Verifying,
            "Verifying the installed CLI entry point...",
        )
        .await;
    }
    if let Err(error) = verify_staged_install(&staging, provider, package) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    let _ = std::fs::remove_file(&archive);
    if let Err(error) = activate_managed_install(&target, &staging, provider) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }

    let executable_path = managed_executable_path(&target, provider);
    if !executable_path.is_file() {
        return Err(anyhow!(
            "managed installation activation did not preserve {}",
            executable_path.display()
        ));
    }
    Ok(CliInstallResult {
        provider,
        executable_path: executable_path.to_string_lossy().into_owned(),
        message: format!(
            "{} {} was verified and installed in OxideStudio's managed agent directory",
            provider.display_name(),
            package.version
        ),
    })
}

pub async fn begin_installation(
    app: &AppHandle,
    provider: CliProviderKind,
) -> Result<CliInstallationLaunchResult> {
    let session_id = {
        let mut sessions = INSTALLATION_SESSIONS.lock().await;
        if let Some(session) = sessions.values().find(|session| {
            session.status.provider == provider && !session.status.phase.is_terminal()
        }) {
            return Ok(CliInstallationLaunchResult {
                provider,
                session_id: session.status.session_id.clone(),
                message: session.status.message.clone(),
            });
        }
        if sessions.len() >= 64 {
            sessions.retain(|_, session| !session.status.phase.is_terminal());
        }
        let session_id = uuid::Uuid::new_v4().to_string();
        sessions.insert(
            session_id.clone(),
            ManagedInstallationSession {
                status: CliInstallationStatus {
                    session_id: session_id.clone(),
                    provider,
                    phase: CliInstallationPhase::Starting,
                    message: format!("Preparing {} installation...", provider.display_name()),
                    result: None,
                },
            },
        );
        session_id
    };
    let task_app = app.clone();
    let task_session_id = session_id.clone();
    tauri::async_runtime::spawn(async move {
        match install_provider_with_progress(&task_app, provider, Some(&task_session_id)).await {
            Ok(result) => {
                update_installation_with_result(
                    &task_session_id,
                    CliInstallationPhase::Succeeded,
                    result.message.clone(),
                    Some(result),
                )
                .await;
            }
            Err(error) => {
                update_installation_with_result(
                    &task_session_id,
                    CliInstallationPhase::Failed,
                    error.to_string(),
                    None,
                )
                .await;
            }
        }
    });
    Ok(CliInstallationLaunchResult {
        provider,
        session_id,
        message: format!("Preparing {} installation...", provider.display_name()),
    })
}

pub async fn installation_status(session_id: &str) -> Result<CliInstallationStatus> {
    INSTALLATION_SESSIONS
        .lock()
        .await
        .get(session_id)
        .map(|session| session.status.clone())
        .ok_or_else(|| anyhow!("installation session is no longer available"))
}

async fn update_installation(
    session_id: &str,
    phase: CliInstallationPhase,
    message: impl Into<String>,
) {
    update_installation_with_result(session_id, phase, message, None).await;
}

async fn update_installation_with_result(
    session_id: &str,
    phase: CliInstallationPhase,
    message: impl Into<String>,
    result: Option<CliInstallResult>,
) {
    if let Some(session) = INSTALLATION_SESSIONS.lock().await.get_mut(session_id) {
        if !session.status.phase.is_terminal() || phase.is_terminal() {
            session.status.phase = phase;
            session.status.message = message.into();
            if result.is_some() {
                session.status.result = result;
            }
        }
    }
}

fn managed_package_spec(provider: CliProviderKind) -> ManagedPackageSpec {
    match provider {
        CliProviderKind::CodexCli => ManagedPackageSpec {
            name: "@openai/codex",
            version: CODEX_PACKAGE_VERSION,
            integrity: CODEX_PACKAGE_INTEGRITY,
        },
        CliProviderKind::CodebuddyCli => ManagedPackageSpec {
            name: "@tencent-ai/codebuddy-code",
            version: CODEBUDDY_PACKAGE_VERSION,
            integrity: CODEBUDDY_PACKAGE_INTEGRITY,
        },
    }
}

async fn download_verified_package(
    npm: &CliCommandSpec,
    package: ManagedPackageSpec,
    destination: &Path,
    cwd: &Path,
) -> Result<PathBuf> {
    let args = vec![
        "pack".to_string(),
        package.reference(),
        "--json".to_string(),
        "--pack-destination".to_string(),
        destination.to_string_lossy().into_owned(),
        format!("--registry={NPM_REGISTRY}"),
    ];
    let output = run_captured(
        npm,
        &args,
        &BTreeMap::new(),
        Some(cwd),
        None,
        Duration::from_secs(60),
    )
    .await
    .context("failed to download the managed package for verification")?;
    if !output.success {
        return Err(anyhow!(
            "managed package download failed: {}",
            first_output_line(&output.stderr, &output.stdout)
        ));
    }
    let response: Value = serde_json::from_str(output.stdout.trim())
        .context("npm returned an invalid package verification response")?;
    let result = response
        .as_array()
        .and_then(|items| items.first())
        .ok_or_else(|| anyhow!("npm returned no package verification result"))?;
    let actual_integrity = result
        .get("integrity")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if actual_integrity != package.integrity {
        return Err(anyhow!(
            "managed package integrity mismatch for {}: installation was stopped",
            package.reference()
        ));
    }
    let filename = result
        .get("filename")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("npm did not identify the verified package archive"))?;
    let filename_path = Path::new(filename);
    if filename_path.file_name().and_then(|value| value.to_str()) != Some(filename) {
        return Err(anyhow!("npm returned an unsafe package archive path"));
    }
    let archive = destination.join(filename);
    if !archive.is_file() {
        return Err(anyhow!(
            "verified managed package archive was not created at {}",
            archive.display()
        ));
    }
    Ok(archive)
}

fn first_output_line<'a>(stderr: &'a str, stdout: &'a str) -> &'a str {
    stderr
        .lines()
        .chain(stdout.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("npm did not provide an error message")
}

fn verify_staged_install(
    staging: &Path,
    provider: CliProviderKind,
    package: ManagedPackageSpec,
) -> Result<()> {
    let executable = managed_executable_path(staging, provider);
    if !executable.is_file() {
        return Err(anyhow!(
            "managed installation completed but {} was not created",
            executable.display()
        ));
    }
    let package_json_path = package.package_json_path(staging);
    let package_json: Value = serde_json::from_slice(
        &std::fs::read(&package_json_path)
            .with_context(|| format!("failed to read {}", package_json_path.display()))?,
    )
    .with_context(|| format!("failed to parse {}", package_json_path.display()))?;
    let actual_version = package_json
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if actual_version != package.version {
        return Err(anyhow!(
            "managed package version mismatch: expected {}, received {}",
            package.version,
            if actual_version.is_empty() {
                "an unspecified version"
            } else {
                actual_version
            }
        ));
    }
    Ok(())
}

fn activate_managed_install(
    target: &Path,
    staging: &Path,
    provider: CliProviderKind,
) -> Result<()> {
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("managed agent directory has no parent"))?;
    if staging.parent() != Some(parent) {
        return Err(anyhow!(
            "managed install staging directory is outside its target"
        ));
    }
    let backup = parent.join(format!(
        ".{}-backup-{}",
        provider.as_str(),
        uuid::Uuid::new_v4()
    ));
    let had_existing = target.exists();
    if had_existing {
        std::fs::rename(target, &backup).with_context(|| {
            format!(
                "failed to preserve the existing managed installation at {}",
                target.display()
            )
        })?;
    }
    if let Err(error) = std::fs::rename(staging, target) {
        if had_existing {
            let _ = std::fs::rename(&backup, target);
        }
        return Err(error).with_context(|| {
            format!(
                "failed to activate the verified managed installation at {}",
                target.display()
            )
        });
    }
    if had_existing {
        let _ = std::fs::remove_dir_all(&backup);
    }
    Ok(())
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
        verify_authenticated_provider(config, environment, session_id, &mut cancellation).await?;
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
                verify_authenticated_provider(config, environment, session_id, &mut cancellation).await?;
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
    verify_authenticated_provider(config, environment, session_id, &mut cancellation).await?;
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

async fn verify_authenticated_provider(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    session_id: &str,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<()> {
    update_authentication(
        session_id,
        CliAuthenticationPhase::Verifying,
        "Confirming the provider session in OxideStudio...",
    )
    .await;
    let deadline = tokio::time::Instant::now() + AUTHENTICATION_VERIFICATION_TIMEOUT;

    loop {
        let result = match config.kind {
            CliProviderKind::CodexCli => codex::test_connection(config, environment).await,
            CliProviderKind::CodebuddyCli => codebuddy::test_connection(config, environment).await,
        };
        let pending_error = match result {
            Ok(_) => return Ok(()),
            Err(error) if authentication_verification_may_be_pending(&error.to_string()) => error,
            Err(error) => return Err(error),
        };

        let now = tokio::time::Instant::now();
        if now >= deadline {
            return Err(anyhow!(
                "provider sign-in completed but the CLI session did not become ready in time: {pending_error}"
            ));
        }
        update_authentication(
            session_id,
            CliAuthenticationPhase::Verifying,
            "Sign-in completed. Waiting for the CLI to finish saving the account...",
        )
        .await;
        tokio::select! {
            changed = cancellation.changed() => {
                if changed.is_err() || *cancellation.borrow() {
                    return Err(anyhow!("authentication cancelled"));
                }
            }
            _ = tokio::time::sleep((deadline - now).min(AUTHENTICATION_VERIFICATION_RETRY)) => {}
        }
    }
}

fn authentication_verification_may_be_pending(error: &str) -> bool {
    let value = error.to_ascii_lowercase();
    [
        "not authenticated",
        "not logged in",
        "login required",
        "sign in",
        "account access",
        "authorization pending",
        "credential is still",
        "credentials are still",
        "token is still",
        "token not found",
    ]
    .iter()
    .any(|needle| value.contains(needle))
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
    fn managed_packages_are_exactly_versioned_and_integrity_pinned() {
        for provider in [CliProviderKind::CodexCli, CliProviderKind::CodebuddyCli] {
            let package = managed_package_spec(provider);
            assert!(!package.version.is_empty());
            assert!(!package.reference().ends_with("@latest"));
            assert!(package.integrity.starts_with("sha512-"));
        }
    }

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

    #[test]
    fn treats_only_account_propagation_failures_as_verification_retryable() {
        assert!(authentication_verification_may_be_pending(
            "CodeBuddy is not authenticated yet"
        ));
        assert!(authentication_verification_may_be_pending(
            "credential is still being saved"
        ));
        assert!(!authentication_verification_may_be_pending(
            "failed to parse an authentication token"
        ));
        assert!(!authentication_verification_may_be_pending(
            "ACP protocol response was invalid"
        ));
    }
}
