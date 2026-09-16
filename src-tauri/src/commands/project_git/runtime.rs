use crate::core::{protocol::CommandError, store::MetaStore};
use anyhow::{anyhow, bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use url::Url;

pub(super) const GIT_READ_TIMEOUT: Duration = Duration::from_secs(12);
pub(super) const GIT_WRITE_TIMEOUT: Duration = Duration::from_secs(120);
pub(super) const GIT_CLONE_TIMEOUT: Duration = Duration::from_secs(300);
pub(super) const GIT_OUTPUT_LIMIT: usize = 4 * 1024 * 1024;
pub(super) const GIT_PATCH_LIMIT: usize = 2 * 1024 * 1024;
pub(super) const GIT_FILE_LIMIT: usize = 1_000;
pub(super) const GIT_COMMIT_LIMIT: usize = 100;
pub(super) const GITHUB_REPOSITORY_LIMIT: usize = 50;

#[derive(Debug)]
pub(super) struct ProcessOutput {
    pub(super) success: bool,
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: Vec<u8>,
    pub(super) truncated: bool,
}

pub(super) fn command_error(
    code: &str,
    error: impl std::fmt::Display,
    retryable: bool,
    context: serde_json::Value,
) -> CommandError {
    CommandError::new(
        code,
        redact_sensitive_text(&error.to_string()),
        retryable,
        Some(context),
    )
}

pub(super) async fn project_root(
    meta_store: &MetaStore,
    project_id: &str,
    expected_root: Option<&str>,
) -> Result<PathBuf> {
    let project = meta_store
        .get_project(project_id)
        .await?
        .ok_or_else(|| anyhow!("project not found: {project_id}"))?;
    let configured = project
        .root_path
        .ok_or_else(|| anyhow!("project root is not configured: {project_id}"))?;
    let root = canonical_directory(Path::new(&configured), "project root")?;
    if let Some(expected) = expected_root.filter(|value| !value.trim().is_empty()) {
        let expected = canonical_directory(Path::new(expected), "expected project root")?;
        if root != expected {
            bail!(
                "configured project root changed from {} to {}",
                expected.display(),
                root.display()
            );
        }
    }
    Ok(root)
}

pub(super) fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf> {
    if !path.is_absolute() {
        bail!("{label} must be an absolute path");
    }
    let canonical = std::fs::canonicalize(path)
        .with_context(|| format!("failed to resolve {label}: {}", path.display()))?;
    if !std::fs::metadata(&canonical)?.is_dir() {
        bail!("{label} is not a directory: {}", canonical.display());
    }
    Ok(canonical)
}

pub(super) async fn run_bounded(
    program: &str,
    args: &[String],
    cwd: Option<&Path>,
    stdin: Option<&[u8]>,
    limit: usize,
    timeout: Duration,
    read_only: bool,
) -> Result<ProcessOutput> {
    let mut command = Command::new(program);
    command
        .args(args)
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if read_only {
        command.env("GIT_OPTIONAL_LOCKS", "0");
    }
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start {program}"))?;
    if let Some(input) = stdin {
        let mut input_pipe = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("failed to open {program} standard input"))?;
        input_pipe.write_all(input).await?;
        input_pipe.shutdown().await?;
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("failed to capture {program} stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("failed to capture {program} stderr"))?;
    let stdout_read = async {
        let mut bytes = Vec::new();
        stdout
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)
            .await?;
        Ok::<_, std::io::Error>(bytes)
    };
    let stderr_read = async {
        let mut bytes = Vec::new();
        stderr.take(65_537).read_to_end(&mut bytes).await?;
        Ok::<_, std::io::Error>(bytes)
    };
    let (status, stdout, stderr) = tokio::time::timeout(timeout, async {
        tokio::join!(child.wait(), stdout_read, stderr_read)
    })
    .await
    .with_context(|| format!("{program} command timed out"))?;
    let status = status.with_context(|| format!("failed to wait for {program}"))?;
    let mut stdout = stdout.with_context(|| format!("failed to read {program} stdout"))?;
    let stderr = stderr.with_context(|| format!("failed to read {program} stderr"))?;
    let truncated = stdout.len() > limit;
    stdout.truncate(limit);
    Ok(ProcessOutput {
        success: status.success(),
        stdout,
        stderr,
        truncated,
    })
}

pub(super) async fn run_git(
    root: &Path,
    args: &[&str],
    limit: usize,
    timeout: Duration,
    read_only: bool,
) -> Result<ProcessOutput> {
    let mut full_args = vec![
        "-c".to_string(),
        "core.fsmonitor=false".to_string(),
        "-C".to_string(),
        root.to_string_lossy().to_string(),
    ];
    full_args.extend(args.iter().map(|value| (*value).to_string()));
    run_bounded("git", &full_args, None, None, limit, timeout, read_only).await
}

pub(super) async fn run_git_with_input(
    root: &Path,
    args: &[&str],
    input: &[u8],
    timeout: Duration,
) -> Result<ProcessOutput> {
    let mut full_args = vec![
        "-c".to_string(),
        "core.fsmonitor=false".to_string(),
        "-C".to_string(),
        root.to_string_lossy().to_string(),
    ];
    full_args.extend(args.iter().map(|value| (*value).to_string()));
    run_bounded(
        "git",
        &full_args,
        None,
        Some(input),
        GIT_OUTPUT_LIMIT,
        timeout,
        false,
    )
    .await
}

pub(super) fn stdout_text(output: &ProcessOutput) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

pub(super) fn command_failure(program: &str, output: &ProcessOutput) -> anyhow::Error {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = stdout_text(output);
    anyhow!(
        "{}",
        if stderr.is_empty() {
            if stdout.is_empty() {
                format!("{program} command failed")
            } else {
                stdout
            }
        } else {
            stderr
        }
    )
}

pub(super) async fn require_repository(root: &Path) -> Result<()> {
    let output = run_git(
        root,
        &["rev-parse", "--is-inside-work-tree"],
        64,
        GIT_READ_TIMEOUT,
        true,
    )
    .await?;
    if !output.success || stdout_text(&output) != "true" {
        bail!("project directory is not a Git repository");
    }
    Ok(())
}

pub(super) fn redact_sensitive_text(value: &str) -> String {
    value
        .split_whitespace()
        .map(|token| {
            let prefix = token.trim_start_matches(|character: char| {
                matches!(character, '(' | '[' | '{' | '\'' | '"')
            });
            let suffix_len = token.len().saturating_sub(prefix.len());
            if let Ok(mut url) = Url::parse(prefix.trim_end_matches(|character: char| {
                matches!(character, ')' | ']' | '}' | ',' | ';' | '\'' | '"')
            })) {
                if !url.username().is_empty() || url.password().is_some() {
                    let _ = url.set_username("redacted");
                    let _ = url.set_password(None);
                    let leading = &token[..suffix_len];
                    return format!("{leading}{url}");
                }
            }
            token.to_string()
        })
        .collect::<Vec<_>>()
        .join(" ")
}
