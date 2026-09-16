use super::types::{ShellSandboxMode, MAX_SHELL_TIMEOUT_MS, SHELL_OUTPUT_LIMIT_BYTES};
use anyhow::bail;
use anyhow::Context;
use anyhow::Result;
use serde::Serialize;
use std::env;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use std::time::Instant;
use tempfile::TempDir;
use tokio::io::AsyncRead;
use tokio::io::AsyncReadExt;
use tokio::process::Child;
use tokio::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellExecutionResult {
    pub command: String,
    pub working_directory: String,
    pub sandbox_mode: String,
    pub sandboxed: bool,
    pub network_allowed: bool,
    pub exit_code: Option<i32>,
    pub success: bool,
    pub timed_out: bool,
    pub duration_ms: u128,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

pub async fn execute_shell_command(
    project_root: &Path,
    working_directory: &Path,
    command_text: &str,
    sandbox_mode: ShellSandboxMode,
    timeout_ms: u64,
) -> Result<ShellExecutionResult> {
    let command_text = command_text.trim();
    if command_text.is_empty() {
        bail!("shell command is required");
    }
    if command_text.chars().count() > 32_000 {
        bail!("shell command must not exceed 32,000 characters");
    }
    if !working_directory.starts_with(project_root) {
        bail!("shell working directory is outside the active project root");
    }

    // User input is clamped to at least one second by the host. The lower
    // internal bound lets a nearly-expired turn deadline remain authoritative.
    let timeout_ms = timeout_ms.clamp(100, MAX_SHELL_TIMEOUT_MS);
    let isolated_home = tempfile::Builder::new()
        .prefix("oxide-agent-shell-")
        .tempdir()
        .context("failed to create isolated shell home")?;
    let mut command = shell_process(
        command_text,
        project_root,
        working_directory,
        sandbox_mode,
        &isolated_home,
    )?;
    command
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_environment(&mut command, sandbox_mode, isolated_home.path());
    configure_process_group(&mut command);

    let started = Instant::now();
    let mut child = command.spawn().context("failed to start shell command")?;
    let stdout = child.stdout.take().context("shell stdout is unavailable")?;
    let stderr = child.stderr.take().context("shell stderr is unavailable")?;
    let stdout_task = tokio::spawn(read_bounded(stdout, SHELL_OUTPUT_LIMIT_BYTES));
    let stderr_task = tokio::spawn(read_bounded(stderr, SHELL_OUTPUT_LIMIT_BYTES));

    let (status, timed_out) =
        match tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await {
            Ok(status) => (
                Some(status.context("failed to wait for shell command")?),
                false,
            ),
            Err(_) => {
                terminate_process_tree(&mut child).await;
                let _ = child.wait().await;
                (None, true)
            }
        };
    let (stdout, stdout_truncated) = stdout_task
        .await
        .context("failed to join shell stdout reader")??;
    let (stderr, stderr_truncated) = stderr_task
        .await
        .context("failed to join shell stderr reader")??;
    let exit_code = status.as_ref().and_then(std::process::ExitStatus::code);
    let working_directory = working_directory
        .strip_prefix(project_root)
        .ok()
        .filter(|path| !path.as_os_str().is_empty())
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".to_string());

    Ok(ShellExecutionResult {
        command: command_text.to_string(),
        working_directory,
        sandbox_mode: sandbox_mode.as_str().to_string(),
        sandboxed: sandbox_mode == ShellSandboxMode::WorkspaceWrite,
        network_allowed: sandbox_mode == ShellSandboxMode::Unrestricted,
        exit_code,
        success: status.is_some_and(|value| value.success()),
        timed_out,
        duration_ms: started.elapsed().as_millis(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        stdout_truncated,
        stderr_truncated,
    })
}

pub(super) fn shell_process(
    command_text: &str,
    project_root: &Path,
    working_directory: &Path,
    sandbox_mode: ShellSandboxMode,
    isolated_home: &TempDir,
) -> Result<Command> {
    if sandbox_mode == ShellSandboxMode::Unrestricted {
        return Ok(native_shell(command_text));
    }

    #[cfg(target_os = "macos")]
    {
        let _ = working_directory;
        let sandbox_exec = Path::new("/usr/bin/sandbox-exec");
        if !sandbox_exec.is_file() {
            bail!(
                "workspace shell sandbox is unavailable on this macOS installation; request unrestricted execution explicitly if appropriate"
            );
        }
        let mut command = Command::new(sandbox_exec);
        command
            .arg("-p")
            .arg(macos_workspace_profile(project_root, isolated_home.path()))
            .arg("/bin/zsh")
            .arg("-c")
            .arg(command_text);
        Ok(command)
    }

    #[cfg(target_os = "linux")]
    {
        let bubblewrap = find_program(&["/usr/bin/bwrap", "/bin/bwrap"])
            .ok_or_else(|| anyhow::anyhow!(
                "workspace shell sandbox requires bubblewrap; install bwrap or request unrestricted execution explicitly"
            ))?;
        let mut command = Command::new(bubblewrap);
        command
            .arg("--die-with-parent")
            .arg("--new-session")
            .arg("--unshare-net")
            .arg("--ro-bind")
            .arg("/")
            .arg("/")
            .arg("--bind")
            .arg(project_root)
            .arg(project_root)
            .arg("--bind")
            .arg(isolated_home.path())
            .arg(isolated_home.path())
            .arg("--proc")
            .arg("/proc")
            .arg("--dev")
            .arg("/dev")
            .arg("--chdir")
            .arg(working_directory)
            .arg("/bin/sh")
            .arg("-c")
            .arg(command_text);
        Ok(command)
    }

    #[cfg(target_os = "windows")]
    {
        let _ = (project_root, working_directory, isolated_home);
        bail!(
            "workspace shell sandbox is not available on Windows yet; request unrestricted execution explicitly if appropriate"
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (project_root, working_directory, isolated_home);
        bail!("workspace shell sandbox is unsupported on this platform")
    }
}

pub(super) fn native_shell(command_text: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("powershell.exe");
        command
            .arg("-NoLogo")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(command_text);
        command
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/sh"
        };
        let mut command = Command::new(shell);
        command.arg("-c").arg(command_text);
        command
    }
}

pub(super) fn configure_environment(
    command: &mut Command,
    mode: ShellSandboxMode,
    isolated_home: &Path,
) {
    command.env_clear();
    for key in ["PATH", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME"] {
        if let Some(value) = env::var_os(key) {
            command.env(key, value);
        }
    }
    #[cfg(target_os = "windows")]
    for key in ["SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "PSModulePath"] {
        if let Some(value) = env::var_os(key) {
            command.env(key, value);
        }
    }
    if mode == ShellSandboxMode::Unrestricted {
        for key in ["HOME", "SSH_AUTH_SOCK", "GPG_TTY"] {
            if let Some(value) = env::var_os(key) {
                command.env(key, value);
            }
        }
        #[cfg(target_os = "windows")]
        for key in ["USERPROFILE", "APPDATA", "LOCALAPPDATA"] {
            if let Some(value) = env::var_os(key) {
                command.env(key, value);
            }
        }
    } else {
        command.env("HOME", isolated_home);
    }
    command.env("TMPDIR", isolated_home);
    #[cfg(target_os = "windows")]
    command.env("TEMP", isolated_home).env("TMP", isolated_home);
    command.env("NO_COLOR", "1");
    command.env("CI", "1");
}

#[cfg(target_os = "macos")]
pub(super) fn macos_workspace_profile(project_root: &Path, isolated_home: &Path) -> String {
    // Seatbelt checks the resolved filesystem path. macOS presents temporary
    // directories under /var while writes resolve through /private/var.
    let project_root = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());
    let isolated_home = isolated_home
        .canonicalize()
        .unwrap_or_else(|_| isolated_home.to_path_buf());
    format!(
        r#"(version 1)
(deny default)
(allow process*)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)
(allow ipc-posix*)
(allow file-read*)
(allow file-write*
  (literal "/dev/null")
  (literal "/dev/tty")
  (subpath "{}")
  (subpath "{}"))"#,
        sandbox_profile_literal(&project_root),
        sandbox_profile_literal(&isolated_home),
    )
}

#[cfg(target_os = "macos")]
pub(super) fn sandbox_profile_literal(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

#[cfg(target_os = "linux")]
pub(super) fn find_program(candidates: &[&str]) -> Option<PathBuf> {
    candidates
        .iter()
        .map(PathBuf::from)
        .find(|candidate| candidate.is_file())
}

pub(super) async fn read_bounded<R>(mut reader: R, limit: usize) -> std::io::Result<(Vec<u8>, bool)>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::with_capacity(limit.min(8 * 1024));
    let mut buffer = [0_u8; 8 * 1024];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        let remaining = limit.saturating_sub(output.len());
        if remaining > 0 {
            output.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        if count > remaining {
            truncated = true;
        }
    }
    Ok((output, truncated))
}

#[cfg(unix)]
pub(super) fn configure_process_group(command: &mut Command) {
    command.process_group(0);
}

#[cfg(not(unix))]
pub(super) fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
pub(super) async fn terminate_process_tree(child: &mut Child) {
    if let Some(process_id) = child.id() {
        // The command is started in its own process group. Killing the group
        // prevents timed-out grandchildren from surviving the agent turn.
        unsafe {
            libc::kill(-(process_id as i32), libc::SIGKILL);
        }
    }
    let _ = child.kill().await;
}

#[cfg(not(unix))]
pub(super) async fn terminate_process_tree(child: &mut Child) {
    let _ = child.kill().await;
}
