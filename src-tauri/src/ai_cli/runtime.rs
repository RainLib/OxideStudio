use crate::ai_cli::CliProviderKind;
use anyhow::{anyhow, Context, Result};
use futures::StreamExt;
use serde_json::{json, Value};
#[cfg(windows)]
use std::ffi::OsStr;
use std::{
    collections::BTreeMap,
    env,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tempfile::TempDir;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::watch,
};
use tokio_util::codec::{FramedRead, LinesCodec};

const MAX_CAPTURE_BYTES: u64 = 256 * 1024;
const MAX_JSONL_LINE_BYTES: usize = 1024 * 1024;
const MAX_PROMPT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliCommandSpec {
    pub program: String,
    pub prefix_args: Vec<String>,
    pub resolved_path: Option<String>,
}

impl CliCommandSpec {
    pub fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.prefix_args);
        command
    }
}

#[derive(Debug)]
pub struct CliCapturedOutput {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug)]
pub struct CliJsonlOutput {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stderr: String,
    pub parsed_events: usize,
}

pub fn validate_configured_program(value: Option<&str>, default_program: &str) -> Result<String> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_program);
    if value.contains('\0') || value.contains('\n') || value.contains('\r') {
        return Err(anyhow!(
            "CLI executable path contains unsupported characters"
        ));
    }
    if !is_path_like(value)
        && !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(anyhow!(
            "CLI executable must be a path or command name without arguments"
        ));
    }
    Ok(value.to_string())
}

pub async fn resolve_command(
    provider: CliProviderKind,
    configured: Option<&str>,
) -> Result<CliCommandSpec> {
    let default_program = match provider {
        CliProviderKind::CodexCli => "codex",
        CliProviderKind::CodebuddyCli => "codebuddy",
    };
    let configured = validate_configured_program(configured, default_program)?;
    if is_path_like(&configured) {
        let path = expand_tilde(&configured);
        if !path.is_file() {
            return Err(anyhow!(
                "{} executable was not found at {}",
                provider.display_name(),
                path.display()
            ));
        }
        return command_for_path(provider, path);
    }

    let mut names = vec![configured.clone()];
    if provider == CliProviderKind::CodebuddyCli && configured == default_program {
        names.push("cbc".to_string());
    }
    for name in names {
        if let Some(path) = find_program(&name) {
            return command_for_path(provider, path);
        }
    }
    Err(anyhow!(
        "{} is not installed or is not available on PATH",
        provider.display_name()
    ))
}

/// Resolve an auxiliary executable without accepting command-line arguments.
/// This is used by the managed CLI setup flow for trusted tools such as npm.
pub fn resolve_named_command(name: &str) -> Result<CliCommandSpec> {
    let configured = validate_configured_program(Some(name), name)?;
    let path = find_program(&configured)
        .ok_or_else(|| anyhow!("{configured} is not installed or is not available on PATH"))?;
    #[cfg(windows)]
    {
        // npm on Windows is normally exposed as npm.cmd. Launching that shim
        // through cmd.exe is brittle for desktop processes (especially with
        // nvm-windows and a PATH inherited before Node was installed). Use the
        // real npm JavaScript entrypoint through node.exe instead.
        if let Some(spec) = windows_npm_node_entrypoint(&path) {
            return Ok(spec);
        }
    }
    command_for_generic_path(path)
}

fn command_for_path(_provider: CliProviderKind, path: PathBuf) -> Result<CliCommandSpec> {
    #[cfg(windows)]
    {
        if _provider == CliProviderKind::CodexCli {
            if let Some(spec) = windows_codex_node_entrypoint(&path) {
                return Ok(spec);
            }
        } else if _provider == CliProviderKind::CodebuddyCli {
            if let Some(spec) = windows_codebuddy_node_entrypoint(&path) {
                return Ok(spec);
            }
        }
    }
    command_for_generic_path(path)
}

fn command_for_generic_path(path: PathBuf) -> Result<CliCommandSpec> {
    let resolved_path = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        let extension = path
            .extension()
            .and_then(OsStr::to_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(extension.as_str(), "cmd" | "bat") {
            return Ok(CliCommandSpec {
                program: env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
                prefix_args: vec![
                    "/D".to_string(),
                    "/S".to_string(),
                    "/C".to_string(),
                    resolved_path.clone(),
                ],
                resolved_path: Some(resolved_path),
            });
        }
    }
    Ok(CliCommandSpec {
        program: resolved_path.clone(),
        prefix_args: Vec::new(),
        resolved_path: Some(resolved_path),
    })
}

#[cfg(windows)]
fn windows_codex_node_entrypoint(path: &Path) -> Option<CliCommandSpec> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if extension != "cmd" && extension != "bat" {
        return None;
    }
    let parent = path.parent()?;
    let codex_js = [
        // npm global installation layout.
        parent.join("node_modules/@openai/codex/bin/codex.js"),
        // OxideStudio managed installation layout:
        // <profile>/node_modules/.bin/codex.cmd
        parent.parent()?.join("@openai/codex/bin/codex.js"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())?;
    let bundled_node = parent.join("node.exe");
    let node = if bundled_node.is_file() {
        bundled_node.to_string_lossy().into_owned()
    } else {
        find_program("node")?.to_string_lossy().into_owned()
    };
    Some(CliCommandSpec {
        program: node,
        prefix_args: vec![codex_js.to_string_lossy().into_owned()],
        resolved_path: Some(path.to_string_lossy().into_owned()),
    })
}

#[cfg(windows)]
fn windows_codebuddy_node_entrypoint(path: &Path) -> Option<CliCommandSpec> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if extension != "cmd" && extension != "bat" {
        return None;
    }
    let parent = path.parent()?;
    let codebuddy_entrypoint = [
        // npm global installation layout.
        parent.join("node_modules/@tencent-ai/codebuddy-code/bin/codebuddy"),
        // OxideStudio managed installation layout:
        // <profile>/node_modules/.bin/codebuddy.cmd
        parent
            .parent()?
            .join("@tencent-ai/codebuddy-code/bin/codebuddy"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())?;
    let bundled_node = parent.join("node.exe");
    let node = if bundled_node.is_file() {
        bundled_node.to_string_lossy().into_owned()
    } else {
        find_program("node")?.to_string_lossy().into_owned()
    };
    Some(CliCommandSpec {
        program: node,
        prefix_args: vec![codebuddy_entrypoint.to_string_lossy().into_owned()],
        resolved_path: Some(path.to_string_lossy().into_owned()),
    })
}

#[cfg(windows)]
fn windows_npm_node_entrypoint(path: &Path) -> Option<CliCommandSpec> {
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let file_name = path.file_name()?.to_str()?;
    let is_npm = file_name.eq_ignore_ascii_case("npm")
        || path
            .file_stem()
            .and_then(OsStr::to_str)
            .is_some_and(|stem| stem.eq_ignore_ascii_case("npm"));
    if !is_npm || !matches!(extension.as_str(), "" | "cmd" | "bat") {
        return None;
    }

    let parent = path.parent()?;
    let npm_cli = parent.join("node_modules/npm/bin/npm-cli.js");
    if !npm_cli.is_file() {
        return None;
    }
    let sibling_node = parent.join("node.exe");
    let node = if sibling_node.is_file() {
        sibling_node.to_string_lossy().into_owned()
    } else {
        find_program("node")?.to_string_lossy().into_owned()
    };

    Some(CliCommandSpec {
        program: node,
        prefix_args: vec![npm_cli.to_string_lossy().into_owned()],
        resolved_path: Some(path.to_string_lossy().into_owned()),
    })
}

fn find_program(name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    let mut directories = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    directories.extend(common_cli_directories());

    find_program_in_directories(name, directories)
}

fn find_program_in_directories(
    name: &str,
    directories: impl IntoIterator<Item = PathBuf>,
) -> Option<PathBuf> {
    #[cfg(windows)]
    // Node distributions contain both a Unix `npm` script and `npm.cmd`.
    // Windows launchable formats must win over an extensionless sibling.
    let extensions = [".exe", ".cmd", ".bat", ""];
    #[cfg(not(windows))]
    let extensions = [""];

    for directory in directories {
        for extension in extensions {
            let candidate = directory.join(format!("{name}{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn common_cli_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    #[cfg(windows)]
    {
        for key in ["NVM_SYMLINK", "NVM_HOME"] {
            if let Some(directory) = env::var_os(key) {
                let directory = PathBuf::from(directory);
                directories.push(directory.clone());
                directories.extend(version_directories(&directory));
            }
        }
        if let Some(app_data) = env::var_os("APPDATA") {
            directories.push(PathBuf::from(app_data).join("npm"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let local_app_data = PathBuf::from(local_app_data);
            directories.push(local_app_data.join("Programs/nodejs"));
            let nvm = local_app_data.join("nvm");
            directories.push(nvm.clone());
            directories.extend(version_directories(&nvm));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            directories.push(PathBuf::from(program_files).join("nodejs"));
        }
        if let Some(user_profile) = env::var_os("USERPROFILE") {
            let user = PathBuf::from(user_profile);
            directories.push(user.join(".local/bin"));
            let nvm = user.join("AppData/Roaming/nvm");
            directories.extend(version_directories(&nvm));
        }
        if let Some(system_drive) = env::var_os("SystemDrive") {
            directories.push(PathBuf::from(system_drive).join("nvm4w/nodejs"));
        }
        // nvm-windows commonly uses this symlink even when a desktop process
        // was launched before NVM_SYMLINK was added to its inherited environment.
        directories.push(PathBuf::from(r"C:\nvm4w\nodejs"));
    }
    #[cfg(not(windows))]
    {
        directories.extend([
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
        ]);
        if let Some(home) = env::var_os("HOME") {
            directories.push(PathBuf::from(home).join(".local/bin"));
        }
    }
    directories
}

#[cfg(windows)]
fn version_directories(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut versions = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    versions.sort_by(|left, right| right.cmp(left));
    versions
}

fn is_path_like(value: &str) -> bool {
    Path::new(value).is_absolute()
        || value.contains('/')
        || value.contains('\\')
        || value.starts_with('~')
}

fn expand_tilde(value: &str) -> PathBuf {
    if value == "~" || value.starts_with("~/") || value.starts_with("~\\") {
        let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
        if let Some(home) = home {
            let suffix = value
                .trim_start_matches('~')
                .trim_start_matches(['/', '\\']);
            return PathBuf::from(home).join(suffix);
        }
    }
    PathBuf::from(value)
}

pub fn apply_environment(command: &mut Command, environment: &BTreeMap<String, String>) {
    command.envs(environment);
    if !environment.contains_key("HTTP_PROXY") && !environment.contains_key("http_proxy") {
        if let Ok(proxy) = env::var("HTTP_PROXY") {
            command.env("HTTP_PROXY", proxy);
        }
    }
    if !environment.contains_key("HTTPS_PROXY") && !environment.contains_key("https_proxy") {
        if let Ok(proxy) = env::var("HTTPS_PROXY") {
            command.env("HTTPS_PROXY", proxy);
        }
    }
}

pub fn isolated_working_directory() -> Result<TempDir> {
    tempfile::Builder::new()
        .prefix("oxide-cli-agent-")
        .tempdir()
        .context("failed to create isolated CLI working directory")
}

pub async fn run_captured(
    spec: &CliCommandSpec,
    args: &[String],
    environment: &BTreeMap<String, String>,
    cwd: Option<&Path>,
    stdin: Option<&[u8]>,
    timeout: Duration,
) -> Result<CliCapturedOutput> {
    let mut command = spec.command();
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_environment(&mut command, environment);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start {}", spec.program))?;
    if let Some(mut child_stdin) = child.stdin.take() {
        if let Some(stdin) = stdin {
            if stdin.len() > MAX_PROMPT_BYTES {
                return Err(anyhow!("CLI input exceeds the 2 MiB limit"));
            }
            child_stdin
                .write_all(stdin)
                .await
                .context("failed to write CLI input")?;
        }
        child_stdin.shutdown().await.ok();
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("CLI stdout is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("CLI stderr is unavailable"))?;
    let stdout_task = tokio::spawn(read_bounded(stdout));
    let stderr_task = tokio::spawn(read_bounded(stderr));
    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(status) => status.context("failed to wait for CLI process")?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(anyhow!("CLI process timed out"));
        }
    };
    let stdout = stdout_task.await.context("CLI stdout task failed")??;
    let stderr = stderr_task.await.context("CLI stderr task failed")??;
    Ok(CliCapturedOutput {
        success: status.success(),
        exit_code: status.code(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

async fn read_bounded<R>(reader: R) -> Result<Vec<u8>>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut bytes = Vec::new();
    reader
        .take(MAX_CAPTURE_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .context("failed to read CLI output")?;
    if bytes.len() as u64 > MAX_CAPTURE_BYTES {
        bytes.truncate(MAX_CAPTURE_BYTES as usize);
    }
    Ok(bytes)
}

pub async fn run_jsonl_process<F>(
    spec: &CliCommandSpec,
    args: &[String],
    environment: &BTreeMap<String, String>,
    cwd: &Path,
    stdin: &[u8],
    timeout: Duration,
    mut cancellation: watch::Receiver<bool>,
    mut on_json: F,
) -> Result<CliJsonlOutput>
where
    F: FnMut(Value) + Send,
{
    if stdin.len() > MAX_PROMPT_BYTES {
        return Err(anyhow!("CLI input exceeds the 2 MiB limit"));
    }
    let mut command = spec.command();
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_environment(&mut command, environment);
    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start {}", spec.program))?;
    if let Some(mut child_stdin) = child.stdin.take() {
        child_stdin
            .write_all(stdin)
            .await
            .context("failed to write CLI input")?;
        child_stdin.shutdown().await.ok();
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("CLI stdout is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("CLI stderr is unavailable"))?;
    let stderr_task = tokio::spawn(read_bounded(stderr));
    let mut lines = FramedRead::new(
        stdout,
        LinesCodec::new_with_max_length(MAX_JSONL_LINE_BYTES),
    );
    let idle_deadline = tokio::time::sleep(timeout);
    tokio::pin!(idle_deadline);
    let hard_deadline = tokio::time::sleep(Duration::from_secs(2 * 60 * 60));
    tokio::pin!(hard_deadline);
    let mut parsed_events = 0usize;
    loop {
        tokio::select! {
            _ = cancellation.changed() => {
                if *cancellation.borrow() {
                    let _ = child.kill().await;
                    return Err(anyhow!("CLI process cancelled"));
                }
            }
            _ = &mut idle_deadline => {
                let _ = child.kill().await;
                return Err(anyhow!("CLI process became unresponsive and timed out"));
            }
            _ = &mut hard_deadline => {
                let _ = child.kill().await;
                return Err(anyhow!("CLI process exceeded the maximum two-hour turn duration"));
            }
            line = lines.next() => match line {
                Some(Ok(line)) => {
                    idle_deadline.as_mut().reset(tokio::time::Instant::now() + timeout);
                    if let Ok(value) = serde_json::from_str::<Value>(line.trim()) {
                        parsed_events += 1;
                        on_json(value);
                    }
                }
                Some(Err(error)) => return Err(anyhow!("CLI JSONL output is invalid: {error}")),
                None => break,
            }
        }
    }
    let status = child
        .wait()
        .await
        .context("failed to wait for CLI process")?;
    let stderr = stderr_task.await.context("CLI stderr task failed")??;
    Ok(CliJsonlOutput {
        success: status.success(),
        exit_code: status.code(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        parsed_events,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn run_codex_app_server<F>(
    spec: &CliCommandSpec,
    args: &[String],
    environment: &BTreeMap<String, String>,
    cwd: &Path,
    prompt: &[u8],
    model: Option<&str>,
    effort: Option<&str>,
    service_tier: Option<&str>,
    full_access: bool,
    collaboration_mode: &str,
    timeout: Duration,
    mut cancellation: watch::Receiver<bool>,
    mut on_json: F,
) -> Result<CliJsonlOutput>
where
    F: FnMut(Value) + Send,
{
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err(anyhow!("CLI input exceeds the 2 MiB limit"));
    }
    let prompt = std::str::from_utf8(prompt).context("Codex input is not valid UTF-8")?;
    let mut command = spec.command();
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_environment(&mut command, environment);
    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start {} app-server", spec.program))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("Codex app-server stdin is unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Codex app-server stdout is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("Codex app-server stderr is unavailable"))?;
    let stderr_task = tokio::spawn(read_bounded(stderr));
    let mut lines = FramedRead::new(
        stdout,
        LinesCodec::new_with_max_length(MAX_JSONL_LINE_BYTES),
    );

    write_json_line(&mut stdin, &codex_initialize_request()).await?;

    let idle_deadline = tokio::time::sleep(timeout);
    tokio::pin!(idle_deadline);
    let hard_deadline = tokio::time::sleep(Duration::from_secs(2 * 60 * 60));
    tokio::pin!(hard_deadline);
    let mut thread_id: Option<String> = None;
    let mut turn_id: Option<String> = None;
    let mut parsed_events = 0usize;
    let mut completed_successfully = false;

    loop {
        tokio::select! {
            _ = cancellation.changed() => {
                if *cancellation.borrow() {
                    if let (Some(thread_id), Some(turn_id)) = (&thread_id, &turn_id) {
                        let _ = write_json_line(
                            &mut stdin,
                            &json!({
                                "id": 90,
                                "method": "turn/interrupt",
                                "params": { "threadId": thread_id, "turnId": turn_id }
                            }),
                        ).await;
                    }
                    let _ = child.kill().await;
                    return Err(anyhow!("CLI process cancelled"));
                }
            }
            _ = &mut idle_deadline => {
                let _ = child.kill().await;
                return Err(anyhow!("CLI process became unresponsive and timed out"));
            }
            _ = &mut hard_deadline => {
                let _ = child.kill().await;
                return Err(anyhow!("CLI process exceeded the maximum two-hour turn duration"));
            }
            line = lines.next() => {
                let Some(line) = line else {
                    break;
                };
                let line = line.map_err(|error| anyhow!("Codex app-server output is invalid: {error}"))?;
                idle_deadline.as_mut().reset(tokio::time::Instant::now() + timeout);
                let value = serde_json::from_str::<Value>(line.trim())
                    .context("Codex app-server emitted invalid JSONL")?;

                if let Some(error) = value.get("error") {
                    let _ = child.kill().await;
                    return Err(anyhow!("Codex app-server request failed: {error}"));
                }
                match value.get("id").and_then(Value::as_u64) {
                    Some(1) => {
                        write_json_line(&mut stdin, &json!({ "method": "initialized" })).await?;
                        let params = codex_thread_start_params(
                            cwd,
                            model,
                            service_tier,
                            full_access,
                        );
                        write_json_line(
                            &mut stdin,
                            &json!({ "id": 2, "method": "thread/start", "params": params }),
                        ).await?;
                    }
                    Some(2) => {
                        let id = value
                            .pointer("/result/thread/id")
                            .and_then(Value::as_str)
                            .ok_or_else(|| anyhow!("Codex thread/start omitted its thread id"))?
                            .to_string();
                        thread_id = Some(id.clone());
                        let params = codex_turn_start_params(
                            &id,
                            prompt,
                            model,
                            effort,
                            service_tier,
                            collaboration_mode,
                            full_access,
                        );
                        write_json_line(
                            &mut stdin,
                            &json!({ "id": 3, "method": "turn/start", "params": params }),
                        ).await?;
                    }
                    Some(3) => {
                        turn_id = value
                            .pointer("/result/turn/id")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                    }
                    Some(id) if value.get("method").is_some() => {
                        // Host-side command/file approvals are intentionally unavailable.
                        // Database approvals continue through the private Oxide MCP bridge.
                        write_json_line(
                            &mut stdin,
                            &json!({ "id": id, "result": { "decision": "decline" } }),
                        ).await?;
                    }
                    _ => {}
                }

                if let Some(method) = value.get("method").and_then(Value::as_str) {
                    parsed_events += 1;
                    on_json(value.clone());
                    if method == "turn/completed" {
                        completed_successfully = value
                            .pointer("/params/turn/status")
                            .and_then(Value::as_str)
                            .is_some_and(|status| status == "completed");
                        break;
                    }
                }
            }
        }
    }

    let _ = child.kill().await;
    let status = child.wait().await.ok();
    let stderr = stderr_task.await.context("CLI stderr task failed")??;
    Ok(CliJsonlOutput {
        success: completed_successfully,
        exit_code: status.and_then(|status| status.code()),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        parsed_events,
    })
}

fn codex_thread_start_params(
    cwd: &Path,
    model: Option<&str>,
    service_tier: Option<&str>,
    full_access: bool,
) -> Value {
    let mut params = json!({
        "cwd": cwd,
        "approvalPolicy": "never",
        "sandbox": if full_access { "danger-full-access" } else { "read-only" },
        "ephemeral": true,
        "experimentalRawEvents": false
    });
    if let Some(model) = model {
        params["model"] = Value::String(model.to_string());
    }
    if let Some(service_tier) = service_tier {
        params["serviceTier"] = Value::String(service_tier.to_string());
    }
    params
}

#[allow(clippy::too_many_arguments)]
fn codex_turn_start_params(
    thread_id: &str,
    prompt: &str,
    model: Option<&str>,
    effort: Option<&str>,
    service_tier: Option<&str>,
    collaboration_mode: &str,
    full_access: bool,
) -> Value {
    let mut params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": prompt }],
        "approvalPolicy": "never",
        "sandboxPolicy": if full_access {
            json!({ "type": "dangerFullAccess" })
        } else {
            json!({ "type": "readOnly", "networkAccess": false })
        }
    });
    if let Some(model) = model {
        params["model"] = Value::String(model.to_string());
        let mut settings = json!({ "model": model });
        if let Some(effort) = effort {
            settings["reasoning_effort"] = Value::String(effort.to_string());
        }
        params["collaborationMode"] = json!({
            "mode": collaboration_mode,
            "settings": settings
        });
    }
    if let Some(effort) = effort {
        params["effort"] = Value::String(effort.to_string());
    }
    if let Some(service_tier) = service_tier {
        params["serviceTier"] = Value::String(service_tier.to_string());
    }
    params
}

async fn write_json_line(stdin: &mut tokio::process::ChildStdin, value: &Value) -> Result<()> {
    let mut payload = serde_json::to_vec(value)?;
    payload.push(b'\n');
    stdin.write_all(&payload).await?;
    stdin.flush().await?;
    Ok(())
}

fn codex_initialize_request() -> Value {
    json!({
        "id": 1,
        "method": "initialize",
        "params": {
            "clientInfo": {
                "name": "oxide-studio",
                "title": "OxideStudio",
                "version": env!("CARGO_PKG_VERSION")
            },
            // collaborationMode is part of Codex's negotiated experimental
            // app-server surface. Without this capability Codex accepts the
            // thread but rejects turn/start with JSON-RPC -32600.
            "capabilities": {
                "experimentalApi": true
            }
        }
    })
}

pub fn bounded_diagnostic(value: &str) -> String {
    value.trim().chars().take(2_000).collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    #[test]
    fn rejects_command_lines_disguised_as_executable_names() {
        assert!(validate_configured_program(Some("codex --dangerous"), "codex").is_err());
        assert!(validate_configured_program(Some("CODEX_HOME=x codex"), "codex").is_err());
        assert_eq!(validate_configured_program(None, "codex").unwrap(), "codex");
    }

    #[test]
    fn diagnostics_are_bounded() {
        assert_eq!(bounded_diagnostic(&"x".repeat(3_000)).len(), 2_000);
    }

    #[test]
    fn codex_initialize_negotiates_collaboration_mode_capability() {
        assert_eq!(
            codex_initialize_request().pointer("/params/capabilities/experimentalApi"),
            Some(&Value::Bool(true))
        );
    }

    #[test]
    fn codex_access_mode_params_match_app_server_protocol() {
        let restricted_thread =
            codex_thread_start_params(Path::new("project"), Some("gpt-test"), None, false);
        assert_eq!(restricted_thread["sandbox"], json!("read-only"));

        let restricted_turn = codex_turn_start_params(
            "thread-1",
            "inspect",
            Some("gpt-test"),
            Some("high"),
            None,
            "default",
            false,
        );
        assert_eq!(
            restricted_turn["sandboxPolicy"],
            json!({ "type": "readOnly", "networkAccess": false })
        );

        let full_thread = codex_thread_start_params(
            Path::new("project"),
            Some("gpt-test"),
            Some("priority"),
            true,
        );
        assert_eq!(full_thread["sandbox"], json!("danger-full-access"));
        assert_eq!(full_thread["serviceTier"], json!("priority"));

        let full_turn = codex_turn_start_params(
            "thread-1",
            "edit",
            Some("gpt-test"),
            Some("ultra"),
            Some("priority"),
            "default",
            true,
        );
        assert_eq!(
            full_turn["sandboxPolicy"],
            json!({ "type": "dangerFullAccess" })
        );
        assert_eq!(full_turn["effort"], json!("ultra"));
        assert_eq!(full_turn["serviceTier"], json!("priority"));
    }

    #[cfg(windows)]
    #[test]
    fn npm_windows_shim_uses_node_entrypoint() {
        let directory = tempfile::tempdir().unwrap();
        let npm_script = directory.path().join("npm");
        let npm_cmd = directory.path().join("npm.cmd");
        let node_exe = directory.path().join("node.exe");
        let npm_cli = directory.path().join("node_modules/npm/bin/npm-cli.js");
        std::fs::create_dir_all(npm_cli.parent().unwrap()).unwrap();
        std::fs::write(&npm_script, "#!/bin/sh\n").unwrap();
        std::fs::write(&npm_cmd, "@echo off\r\n").unwrap();
        std::fs::write(&node_exe, []).unwrap();
        std::fs::write(&npm_cli, "").unwrap();

        let resolved =
            find_program_in_directories("npm", vec![directory.path().to_path_buf()]).unwrap();
        assert_eq!(resolved, npm_cmd);

        let spec = windows_npm_node_entrypoint(&npm_cmd).unwrap();
        assert_eq!(spec.program, node_exe.to_string_lossy().into_owned());
        assert_eq!(
            spec.prefix_args,
            vec![npm_cli.to_string_lossy().into_owned()]
        );
        assert_eq!(spec.resolved_path.as_deref(), npm_cmd.to_str());

        let extensionless_spec = windows_npm_node_entrypoint(&npm_script).unwrap();
        assert_eq!(extensionless_spec.program, spec.program);
        assert_eq!(extensionless_spec.prefix_args, spec.prefix_args);
    }

    #[cfg(windows)]
    #[test]
    fn managed_codex_windows_shim_uses_local_package_entrypoint() {
        let directory = tempfile::tempdir().unwrap();
        let bin = directory.path().join("node_modules/.bin");
        let codex_cmd = bin.join("codex.cmd");
        let codex_js = directory
            .path()
            .join("node_modules/@openai/codex/bin/codex.js");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(codex_js.parent().unwrap()).unwrap();
        std::fs::write(&codex_cmd, "@echo off\r\n").unwrap();
        std::fs::write(&codex_js, "").unwrap();

        let spec = windows_codex_node_entrypoint(&codex_cmd).unwrap();
        assert_eq!(
            spec.prefix_args,
            vec![codex_js.to_string_lossy().into_owned()]
        );
        assert_eq!(spec.resolved_path.as_deref(), codex_cmd.to_str());
    }

    #[cfg(windows)]
    #[test]
    fn managed_codebuddy_windows_shim_uses_local_package_entrypoint() {
        let directory = tempfile::tempdir().unwrap();
        let bin = directory.path().join("node_modules/.bin");
        let codebuddy_cmd = bin.join("codebuddy.cmd");
        let codebuddy_entrypoint = directory
            .path()
            .join("node_modules/@tencent-ai/codebuddy-code/bin/codebuddy");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(codebuddy_entrypoint.parent().unwrap()).unwrap();
        std::fs::write(&codebuddy_cmd, "@echo off\r\n").unwrap();
        std::fs::write(&codebuddy_entrypoint, "").unwrap();

        let spec = windows_codebuddy_node_entrypoint(&codebuddy_cmd).unwrap();
        assert_eq!(
            spec.prefix_args,
            vec![codebuddy_entrypoint.to_string_lossy().into_owned()]
        );
        assert_eq!(spec.resolved_path.as_deref(), codebuddy_cmd.to_str());
    }

    #[tokio::test]
    async fn fake_cli_streams_jsonl_and_collects_stderr() {
        let fixture = fake_cli_fixture(false);
        let values = Arc::new(StdMutex::new(Vec::new()));
        let captured = Arc::clone(&values);
        let (_cancellation, receiver) = watch::channel(false);
        let output = run_jsonl_process(
            &fixture.spec,
            &[],
            &BTreeMap::new(),
            fixture.directory.path(),
            b"test prompt",
            Duration::from_secs(5),
            receiver,
            move |value| captured.lock().unwrap().push(value),
        )
        .await
        .unwrap();
        assert!(output.success);
        assert_eq!(output.parsed_events, 2);
        assert!(output.stderr.contains("fixture diagnostic"));
        assert_eq!(values.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn fake_cli_timeout_terminates_the_process() {
        let fixture = fake_cli_fixture(true);
        let (_cancellation, receiver) = watch::channel(false);
        let error = run_jsonl_process(
            &fixture.spec,
            &[],
            &BTreeMap::new(),
            fixture.directory.path(),
            b"test prompt",
            Duration::from_millis(50),
            receiver,
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("timed out"));
    }

    #[tokio::test]
    async fn fake_cli_cancellation_terminates_the_process() {
        let fixture = fake_cli_fixture(true);
        let (cancellation, receiver) = watch::channel(false);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let _ = cancellation.send(true);
        });
        let error = run_jsonl_process(
            &fixture.spec,
            &[],
            &BTreeMap::new(),
            fixture.directory.path(),
            b"test prompt",
            Duration::from_secs(5),
            receiver,
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("cancelled"));
    }

    #[tokio::test]
    async fn fake_codex_app_server_runs_thread_and_turn_protocol() {
        let fixture = fake_codex_app_server_fixture();
        let values = Arc::new(StdMutex::new(Vec::new()));
        let captured = Arc::clone(&values);
        let (_cancellation, receiver) = watch::channel(false);
        let output = run_codex_app_server(
            &fixture.spec,
            &[],
            &BTreeMap::new(),
            fixture.directory.path(),
            b"inspect the active SQL",
            Some("gpt-test"),
            Some("ultra"),
            Some("priority"),
            true,
            "default",
            Duration::from_secs(5),
            receiver,
            move |value| captured.lock().unwrap().push(value),
        )
        .await
        .unwrap();
        assert!(output.success);
        assert!(output.parsed_events >= 2);
        let values = values.lock().unwrap();
        assert!(values.iter().any(|value| {
            value.get("method").and_then(Value::as_str) == Some("item/agentMessage/delta")
        }));
        assert!(values.iter().any(|value| {
            value.get("method").and_then(Value::as_str) == Some("turn/completed")
        }));
    }

    struct FakeCliFixture {
        directory: TempDir,
        spec: CliCommandSpec,
    }

    fn fake_cli_fixture(wait: bool) -> FakeCliFixture {
        let directory = tempfile::tempdir().unwrap();
        #[cfg(windows)]
        let (script, body) = {
            let script = directory.path().join("fake-cli.cmd");
            let wait_command = if wait {
                "@ping -n 6 127.0.0.1 >nul\r\n"
            } else {
                ""
            };
            let body = format!(
                "@echo {{\"type\":\"item.completed\",\"item\":{{\"type\":\"agent_message\",\"text\":\"ok\"}}}}\r\n@echo {{\"type\":\"result\",\"subtype\":\"success\"}}\r\n@echo fixture diagnostic 1>&2\r\n{wait_command}"
            );
            (script, body)
        };
        #[cfg(unix)]
        let (script, body) = {
            let script = directory.path().join("fake-cli.sh");
            let wait_command = if wait { "sleep 5\n" } else { "" };
            let body = format!(
                "printf '%s\\n' '{{\"type\":\"item.completed\",\"item\":{{\"type\":\"agent_message\",\"text\":\"ok\"}}}}'\nprintf '%s\\n' '{{\"type\":\"result\",\"subtype\":\"success\"}}'\nprintf '%s\\n' 'fixture diagnostic' >&2\n{wait_command}"
            );
            (script, body)
        };
        std::fs::write(&script, body).unwrap();
        #[cfg(windows)]
        let spec = CliCommandSpec {
            program: std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
            prefix_args: vec![
                "/D".to_string(),
                "/S".to_string(),
                "/C".to_string(),
                script.to_string_lossy().into_owned(),
            ],
            resolved_path: Some(script.to_string_lossy().into_owned()),
        };
        #[cfg(unix)]
        let spec = CliCommandSpec {
            program: "/bin/sh".to_string(),
            prefix_args: vec![script.to_string_lossy().into_owned()],
            resolved_path: Some(script.to_string_lossy().into_owned()),
        };
        FakeCliFixture { directory, spec }
    }

    fn fake_codex_app_server_fixture() -> FakeCliFixture {
        let directory = tempfile::tempdir().unwrap();
        #[cfg(windows)]
        let (script, body) = {
            let script = directory.path().join("fake-codex-app-server.cmd");
            let body = concat!(
                "@set /p initialize=\r\n",
                "@echo {\"id\":1,\"result\":{}}\r\n",
                "@set /p initialized=\r\n",
                "@set /p thread=\r\n",
                "@echo {\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}\r\n",
                "@set /p turn=\r\n",
                "@echo {\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-1\"}}}\r\n",
                "@echo {\"method\":\"item/agentMessage/delta\",\"params\":{\"threadId\":\"thread-1\",\"turnId\":\"turn-1\",\"itemId\":\"item-1\",\"delta\":\"done\"}}\r\n",
                "@echo {\"method\":\"turn/completed\",\"params\":{\"threadId\":\"thread-1\",\"turn\":{\"id\":\"turn-1\",\"status\":\"completed\"}}}\r\n",
            );
            (script, body.to_string())
        };
        #[cfg(unix)]
        let (script, body) = {
            let script = directory.path().join("fake-codex-app-server.sh");
            let body = concat!(
                "read -r initialize\n",
                "printf '%s\\n' '{\"id\":1,\"result\":{}}'\n",
                "read -r initialized\n",
                "read -r thread\n",
                "printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}'\n",
                "read -r turn\n",
                "printf '%s\\n' '{\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-1\"}}}'\n",
                "printf '%s\\n' '{\"method\":\"item/agentMessage/delta\",\"params\":{\"threadId\":\"thread-1\",\"turnId\":\"turn-1\",\"itemId\":\"item-1\",\"delta\":\"done\"}}'\n",
                "printf '%s\\n' '{\"method\":\"turn/completed\",\"params\":{\"threadId\":\"thread-1\",\"turn\":{\"id\":\"turn-1\",\"status\":\"completed\"}}}'\n",
            );
            (script, body.to_string())
        };
        std::fs::write(&script, body).unwrap();
        #[cfg(windows)]
        let spec = CliCommandSpec {
            program: std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
            prefix_args: vec![
                "/D".to_string(),
                "/S".to_string(),
                "/C".to_string(),
                script.to_string_lossy().into_owned(),
            ],
            resolved_path: Some(script.to_string_lossy().into_owned()),
        };
        #[cfg(unix)]
        let spec = CliCommandSpec {
            program: "/bin/sh".to_string(),
            prefix_args: vec![script.to_string_lossy().into_owned()],
            resolved_path: Some(script.to_string_lossy().into_owned()),
        };
        FakeCliFixture { directory, spec }
    }
}
