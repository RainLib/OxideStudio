use crate::ai_cli::CliProviderKind;
use anyhow::{anyhow, Context, Result};
use futures::StreamExt;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    env,
    ffi::OsStr,
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

fn command_for_path(provider: CliProviderKind, path: PathBuf) -> Result<CliCommandSpec> {
    let resolved_path = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        if provider == CliProviderKind::CodexCli {
            if let Some(spec) = windows_codex_node_entrypoint(&path) {
                return Ok(spec);
            }
        }
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
    let codex_js = parent.join("node_modules/@openai/codex/bin/codex.js");
    if !codex_js.is_file() {
        return None;
    }
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

fn find_program(name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    let mut directories = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    directories.extend(common_cli_directories());
    directories.sort();
    directories.dedup();

    #[cfg(windows)]
    let extensions = ["", ".exe", ".cmd", ".bat"];
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
        if let Some(app_data) = env::var_os("APPDATA") {
            directories.push(PathBuf::from(app_data).join("npm"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            directories.push(PathBuf::from(local_app_data).join("Programs/nodejs"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            directories.push(PathBuf::from(program_files).join("nodejs"));
        }
        if let Some(user_profile) = env::var_os("USERPROFILE") {
            let user = PathBuf::from(user_profile);
            directories.push(user.join(".local/bin"));
            let nvm = user.join("AppData/Roaming/nvm");
            if let Ok(entries) = std::fs::read_dir(nvm) {
                let mut versions = entries
                    .flatten()
                    .map(|entry| entry.path())
                    .collect::<Vec<_>>();
                versions.sort_by(|left, right| right.cmp(left));
                directories.extend(versions);
            }
        }
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
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    let mut parsed_events = 0usize;
    loop {
        tokio::select! {
            _ = cancellation.changed() => {
                if *cancellation.borrow() {
                    let _ = child.kill().await;
                    return Err(anyhow!("CLI process cancelled"));
                }
            }
            _ = &mut deadline => {
                let _ = child.kill().await;
                return Err(anyhow!("CLI process timed out"));
            }
            line = lines.next() => match line {
                Some(Ok(line)) => {
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
}
