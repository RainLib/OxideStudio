use crate::core::{protocol::CommandError, store::MetaStore};
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use url::Url;

const GIT_READ_TIMEOUT: Duration = Duration::from_secs(12);
const GIT_WRITE_TIMEOUT: Duration = Duration::from_secs(120);
const GIT_CLONE_TIMEOUT: Duration = Duration::from_secs(300);
const GIT_OUTPUT_LIMIT: usize = 4 * 1024 * 1024;
const GIT_PATCH_LIMIT: usize = 2 * 1024 * 1024;
const GIT_FILE_LIMIT: usize = 1_000;
const GIT_COMMIT_LIMIT: usize = 100;
const GITHUB_REPOSITORY_LIMIT: usize = 50;

#[derive(Debug)]
struct ProcessOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitRepository {
    pub is_repository: bool,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub files: Vec<ProjectGitWorkspaceFile>,
    pub branches: Vec<ProjectGitBranch>,
    pub remotes: Vec<ProjectGitRemote>,
    pub commits: Vec<ProjectGitCommit>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitWorkspaceFile {
    pub relative_path: String,
    pub previous_path: Option<String>,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitBranch {
    pub name: String,
    pub current: bool,
    pub remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitRemote {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitCommitFile {
    pub relative_path: String,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitCommitFiles {
    pub revision: String,
    pub files: Vec<ProjectGitCommitFile>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitPatch {
    pub scope: String,
    pub patch: String,
    pub additions: usize,
    pub deletions: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitFileVersions {
    pub relative_path: String,
    pub scope: String,
    pub original_content: String,
    pub modified_content: String,
    pub original_missing: bool,
    pub modified_missing: bool,
    pub binary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitOperationResult {
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCliStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub account: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepository {
    #[serde(rename = "fullName")]
    pub full_name: String,
    pub description: Option<String>,
    pub url: String,
    #[serde(default)]
    pub is_private: bool,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default)]
    pub stargazers_count: usize,
    pub updated_at: Option<String>,
    pub default_branch: Option<String>,
}

fn command_error(
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

async fn project_root(
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

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf> {
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

async fn run_bounded(
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

async fn run_git(
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

async fn run_git_with_input(
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

fn stdout_text(output: &ProcessOutput) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn command_failure(program: &str, output: &ProcessOutput) -> anyhow::Error {
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

async fn require_repository(root: &Path) -> Result<()> {
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

fn validate_relative_path(value: &str) -> Result<String> {
    if value.is_empty() || value.contains('\0') {
        bail!("Git path is invalid");
    }
    let path = Path::new(value);
    if path.is_absolute() {
        bail!("Git path must be relative");
    }
    let mut segments = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => segments.push(
                value
                    .to_str()
                    .context("Git path must be valid UTF-8")?
                    .to_string(),
            ),
            Component::CurDir => {}
            _ => bail!("Git path cannot leave the project root"),
        }
    }
    if segments.is_empty() {
        bail!("Git path is required");
    }
    Ok(segments.join("/"))
}

fn validated_paths(paths: &[String]) -> Result<Vec<String>> {
    if paths.is_empty() || paths.len() > GIT_FILE_LIMIT {
        bail!("select between 1 and {GIT_FILE_LIMIT} Git paths");
    }
    paths
        .iter()
        .map(|path| validate_relative_path(path))
        .collect()
}

fn validate_remote_url(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.starts_with('-') || value.chars().any(char::is_whitespace) {
        bail!("Git repository URL is invalid");
    }
    if let Ok(url) = Url::parse(value) {
        if !matches!(url.scheme(), "http" | "https" | "ssh" | "git") {
            bail!("Git repository URL must use HTTPS, HTTP, SSH, or Git protocol");
        }
        if matches!(url.scheme(), "http" | "https")
            && (!url.username().is_empty() || url.password().is_some())
        {
            bail!("Git repository URL must not contain credentials");
        }
        if url.host_str().is_none() {
            bail!("Git repository URL must include a host");
        }
        return Ok(value.to_string());
    }
    let Some((host, path)) = value.split_once(':') else {
        bail!("Git repository URL must be an absolute remote URL");
    };
    if path.is_empty()
        || !host.contains('@')
        || host.starts_with('@')
        || host.ends_with('@')
        || path.starts_with('/')
    {
        bail!("Git SSH URL is invalid");
    }
    Ok(value.to_string())
}

fn validate_remote_name(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 128
        || value.starts_with('-')
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        bail!("Git remote name is invalid");
    }
    Ok(value.to_string())
}

fn validate_commit_message(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        bail!("commit message is required");
    }
    if value.len() > 16_384 || value.contains('\0') {
        bail!("commit message is too large or invalid");
    }
    Ok(value.to_string())
}

fn validate_commit_revision(value: &str) -> Result<String> {
    let value = value.trim();
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("Git commit revision must be a full hexadecimal object id");
    }
    Ok(value.to_ascii_lowercase())
}

fn validate_clone_destination(value: &str) -> Result<PathBuf> {
    let destination = Path::new(value.trim());
    let destination = canonical_directory(destination, "clone destination")?;
    if std::fs::read_dir(&destination)?
        .next()
        .transpose()?
        .is_some()
    {
        bail!("clone destination must be an empty directory");
    }
    Ok(destination)
}

fn redact_sensitive_text(value: &str) -> String {
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

fn parse_status(output: &[u8]) -> Vec<ProjectGitWorkspaceFile> {
    let mut entries = output
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty());
    let mut files = Vec::new();
    while let Some(entry) = entries.next() {
        if entry.len() < 4 || entry[2] != b' ' {
            continue;
        }
        let index = entry[0] as char;
        let working = entry[1] as char;
        let Ok(relative_path) = validate_relative_path(&String::from_utf8_lossy(&entry[3..]))
        else {
            continue;
        };
        let renamed = matches!(index, 'R' | 'C') || matches!(working, 'R' | 'C');
        let previous_path = renamed
            .then(|| entries.next())
            .flatten()
            .and_then(|path| validate_relative_path(&String::from_utf8_lossy(path)).ok());
        let untracked = index == '?' && working == '?';
        let conflicted = matches!(
            (index, working),
            ('D', 'D')
                | ('A', 'U')
                | ('U', 'D')
                | ('U', 'A')
                | ('D', 'U')
                | ('A', 'A')
                | ('U', 'U')
        );
        let status = if untracked {
            "untracked"
        } else if conflicted {
            "conflicted"
        } else if renamed {
            "renamed"
        } else if index == 'A' {
            "added"
        } else if index == 'D' || working == 'D' {
            "deleted"
        } else {
            "modified"
        };
        files.push(ProjectGitWorkspaceFile {
            relative_path,
            previous_path,
            status: status.to_string(),
            staged: !matches!(index, ' ' | '?'),
            unstaged: !matches!(working, ' ' | '?'),
            untracked,
            conflicted,
            additions: 0,
            deletions: 0,
        });
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    files
}

fn parse_numstat(output: &[u8]) -> HashMap<String, (usize, usize)> {
    let mut entries = output
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty());
    let mut counts = HashMap::new();
    while let Some(entry) = entries.next() {
        let mut fields = entry.splitn(3, |byte| *byte == b'\t');
        let additions = fields
            .next()
            .and_then(|value| std::str::from_utf8(value).ok())
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let deletions = fields
            .next()
            .and_then(|value| std::str::from_utf8(value).ok())
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let Some(path) = fields.next() else {
            continue;
        };
        let path = if path.is_empty() {
            let _previous = entries.next();
            entries.next()
        } else {
            Some(path)
        };
        let Some(path) = path else {
            continue;
        };
        let Ok(path) = validate_relative_path(&String::from_utf8_lossy(path)) else {
            continue;
        };
        let entry = counts.entry(path).or_insert((0usize, 0usize));
        entry.0 = entry.0.saturating_add(additions);
        entry.1 = entry.1.saturating_add(deletions);
    }
    counts
}

fn add_untracked_counts(root: &Path, files: &mut [ProjectGitWorkspaceFile]) {
    for file in files.iter_mut().filter(|file| file.untracked) {
        let path = root.join(&file.relative_path);
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 512 * 1024 {
            continue;
        }
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        if bytes.contains(&0) {
            continue;
        }
        file.additions = bytes.split(|byte| *byte == b'\n').count();
        if bytes.last() == Some(&b'\n') {
            file.additions = file.additions.saturating_sub(1);
        }
    }
}

fn parse_branches(output: &[u8]) -> Vec<ProjectGitBranch> {
    let mut branches = String::from_utf8_lossy(output)
        .lines()
        .filter_map(|record| {
            let fields = record.split('\0').collect::<Vec<_>>();
            if fields.len() != 4 || fields[1].is_empty() || fields[1].ends_with("/HEAD") {
                return None;
            }
            Some(ProjectGitBranch {
                current: fields[0] == "*",
                name: fields[1].to_string(),
                upstream: (!fields[2].is_empty()).then(|| fields[2].to_string()),
                remote: fields[3].starts_with("refs/remotes/"),
            })
        })
        .collect::<Vec<_>>();
    branches.sort_by(|left, right| {
        right
            .current
            .cmp(&left.current)
            .then_with(|| left.remote.cmp(&right.remote))
            .then_with(|| left.name.cmp(&right.name))
    });
    branches
}

fn parse_commits(output: &[u8]) -> Vec<ProjectGitCommit> {
    String::from_utf8_lossy(output)
        .split('\u{1e}')
        .filter_map(|record| {
            let record = record.trim_matches(['\n', '\r']);
            if record.is_empty() {
                return None;
            }
            let fields = record.split('\u{1f}').collect::<Vec<_>>();
            if fields.len() != 6 {
                return None;
            }
            Some(ProjectGitCommit {
                hash: fields[0].to_string(),
                short_hash: fields[1].to_string(),
                author_name: fields[2].to_string(),
                author_email: fields[3].to_string(),
                timestamp: fields[4].parse().unwrap_or_default(),
                message: fields[5].to_string(),
            })
        })
        .collect()
}

fn parse_ahead_behind(value: &str) -> (usize, usize) {
    let mut values = value.split_whitespace();
    (
        values
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        values
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
    )
}

fn diff_counts(patch: &str) -> (usize, usize) {
    patch.lines().fold((0, 0), |(additions, deletions), line| {
        if line.starts_with('+') && !line.starts_with("+++") {
            (additions + 1, deletions)
        } else if line.starts_with('-') && !line.starts_with("---") {
            (additions, deletions + 1)
        } else {
            (additions, deletions)
        }
    })
}

async fn git_blob(root: &Path, object: &str) -> Result<Option<Vec<u8>>> {
    let output = run_git(
        root,
        &["cat-file", "blob", object],
        GIT_PATCH_LIMIT,
        GIT_READ_TIMEOUT,
        true,
    )
    .await?;
    if !output.success {
        return Ok(None);
    }
    if output.truncated {
        bail!("Git file is too large to open in the diff editor");
    }
    Ok(Some(output.stdout))
}

fn working_tree_blob(root: &Path, relative_path: &str) -> Result<Option<Vec<u8>>> {
    let path = root.join(relative_path);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("Git diff editor only supports regular project files");
    }
    let canonical = std::fs::canonicalize(&path)?;
    if !canonical.starts_with(root) {
        bail!("Git file resolves outside the project root");
    }
    if metadata.len() > GIT_PATCH_LIMIT as u64 {
        bail!("Git file is too large to open in the diff editor");
    }
    Ok(Some(std::fs::read(canonical)?))
}

async fn repository_snapshot(root: &Path) -> Result<ProjectGitRepository> {
    if require_repository(root).await.is_err() {
        return Ok(ProjectGitRepository {
            is_repository: false,
            branch: None,
            head: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            files: Vec::new(),
            branches: Vec::new(),
            remotes: Vec::new(),
            commits: Vec::new(),
            truncated: false,
        });
    }
    let (
        branch,
        head,
        upstream,
        status,
        working_numstat,
        staged_numstat,
        branches,
        commits,
        remote_names,
    ) = tokio::join!(
        run_git(
            root,
            &["branch", "--show-current"],
            512,
            GIT_READ_TIMEOUT,
            true
        ),
        run_git(
            root,
            &["rev-parse", "--short", "HEAD"],
            128,
            GIT_READ_TIMEOUT,
            true
        ),
        run_git(
            root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}"
            ],
            512,
            GIT_READ_TIMEOUT,
            true
        ),
        run_git(
            root,
            &[
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
                "--",
                "."
            ],
            GIT_OUTPUT_LIMIT,
            GIT_READ_TIMEOUT,
            true
        ),
        run_git(
            root,
            &["diff", "--numstat", "-z", "--", "."],
            GIT_OUTPUT_LIMIT,
            GIT_READ_TIMEOUT,
            true
        ),
        run_git(
            root,
            &["diff", "--cached", "--numstat", "-z", "--", "."],
            GIT_OUTPUT_LIMIT,
            GIT_READ_TIMEOUT,
            true
        ),
        run_git(
            root,
            &[
                "for-each-ref",
                "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(refname)",
                "refs/heads",
                "refs/remotes"
            ],
            GIT_OUTPUT_LIMIT,
            GIT_READ_TIMEOUT,
            true
        ),
        run_git(
            root,
            &[
                "log",
                "-n",
                "100",
                "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1e"
            ],
            GIT_OUTPUT_LIMIT,
            GIT_READ_TIMEOUT,
            true
        ),
        run_git(root, &["remote"], 64 * 1024, GIT_READ_TIMEOUT, true),
    );
    let status = status?;
    if !status.success {
        return Err(command_failure("git status", &status));
    }
    let mut files = parse_status(&status.stdout);
    let mut counts = HashMap::new();
    for output in [working_numstat, staged_numstat]
        .into_iter()
        .flatten()
        .filter(|output| output.success)
    {
        for (path, (additions, deletions)) in parse_numstat(&output.stdout) {
            let entry = counts.entry(path).or_insert((0usize, 0usize));
            entry.0 = entry.0.saturating_add(additions);
            entry.1 = entry.1.saturating_add(deletions);
        }
    }
    for file in &mut files {
        if let Some((additions, deletions)) = counts.get(&file.relative_path) {
            file.additions = *additions;
            file.deletions = *deletions;
        }
    }
    add_untracked_counts(root, &mut files);
    let files_truncated = files.len() > GIT_FILE_LIMIT;
    files.truncate(GIT_FILE_LIMIT);
    let branch = branch
        .ok()
        .filter(|output| output.success)
        .map(|output| stdout_text(&output))
        .filter(|value| !value.is_empty());
    let head = head
        .ok()
        .filter(|output| output.success)
        .map(|output| stdout_text(&output))
        .filter(|value| !value.is_empty());
    let upstream = upstream
        .ok()
        .filter(|output| output.success)
        .map(|output| stdout_text(&output))
        .filter(|value| !value.is_empty());
    let (ahead, behind) = if upstream.is_some() {
        let counts = run_git(
            root,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            128,
            GIT_READ_TIMEOUT,
            true,
        )
        .await?;
        if counts.success {
            parse_ahead_behind(&stdout_text(&counts))
        } else {
            (0, 0)
        }
    } else {
        (0, 0)
    };
    let mut remotes = Vec::new();
    if let Ok(names) = remote_names {
        if names.success {
            for name in stdout_text(&names).lines().take(32) {
                let fetch = run_git(
                    root,
                    &["remote", "get-url", name],
                    4_096,
                    GIT_READ_TIMEOUT,
                    true,
                )
                .await?;
                let push = run_git(
                    root,
                    &["remote", "get-url", "--push", name],
                    4_096,
                    GIT_READ_TIMEOUT,
                    true,
                )
                .await?;
                remotes.push(ProjectGitRemote {
                    name: name.to_string(),
                    fetch_url: redact_sensitive_text(&stdout_text(&fetch)),
                    push_url: redact_sensitive_text(&stdout_text(&push)),
                });
            }
        }
    }
    let branches = branches
        .ok()
        .filter(|output| output.success)
        .map(|output| parse_branches(&output.stdout))
        .unwrap_or_default();
    let commits = commits
        .ok()
        .filter(|output| output.success)
        .map(|output| parse_commits(&output.stdout))
        .unwrap_or_default();
    let commits_truncated = commits.len() >= GIT_COMMIT_LIMIT;
    Ok(ProjectGitRepository {
        is_repository: true,
        branch,
        head,
        upstream,
        ahead,
        behind,
        files,
        branches,
        remotes,
        commits,
        truncated: status.truncated || files_truncated || commits_truncated,
    })
}

async fn run_project_git_operation(
    meta_store: &MetaStore,
    project_id: &str,
    expected_root: Option<&str>,
    args: &[&str],
    message: &str,
) -> Result<ProjectGitOperationResult> {
    let root = project_root(meta_store, project_id, expected_root).await?;
    require_repository(&root).await?;
    let output = run_git(&root, args, GIT_OUTPUT_LIMIT, GIT_WRITE_TIMEOUT, false).await?;
    if !output.success {
        return Err(command_failure("git", &output));
    }
    Ok(ProjectGitOperationResult {
        message: message.to_string(),
    })
}

#[tauri::command]
pub async fn get_project_git_repository(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    expected_root: Option<String>,
) -> Result<ProjectGitRepository, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    repository_snapshot(&root)
        .await
        .map_err(|error| command_error("PROJECT_GIT_STATUS_FAILED", error, true, context))
}

#[tauri::command]
pub async fn get_project_git_commit_files(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    revision: String,
    expected_root: Option<String>,
) -> Result<ProjectGitCommitFiles, CommandError> {
    let context = serde_json::json!({ "projectId": project_id, "revision": revision });
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    require_repository(&root).await.map_err(|error| {
        command_error("PROJECT_GIT_STATUS_FAILED", error, true, context.clone())
    })?;
    let revision = validate_commit_revision(&revision).map_err(|error| {
        command_error(
            "PROJECT_GIT_REVISION_INVALID",
            error,
            false,
            context.clone(),
        )
    })?;
    let output = run_git(
        &root,
        &[
            "show",
            "--format=",
            "--numstat",
            "-z",
            "--find-renames",
            &revision,
            "--",
        ],
        GIT_OUTPUT_LIMIT,
        GIT_READ_TIMEOUT,
        true,
    )
    .await
    .map_err(|error| command_error("PROJECT_GIT_COMMIT_FAILED", error, true, context.clone()))?;
    if !output.success {
        return Err(command_error(
            "PROJECT_GIT_COMMIT_FAILED",
            command_failure("git show", &output),
            false,
            context,
        ));
    }
    let mut files = parse_numstat(&output.stdout)
        .into_iter()
        .map(
            |(relative_path, (additions, deletions))| ProjectGitCommitFile {
                relative_path,
                additions,
                deletions,
            },
        )
        .collect::<Vec<_>>();
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let files_truncated = files.len() > GIT_FILE_LIMIT;
    files.truncate(GIT_FILE_LIMIT);
    Ok(ProjectGitCommitFiles {
        revision,
        files,
        truncated: output.truncated || files_truncated,
    })
}

#[tauri::command]
pub async fn init_project_git_repository(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    let output = run_git(&root, &["init"], GIT_OUTPUT_LIMIT, GIT_WRITE_TIMEOUT, false)
        .await
        .map_err(|error| command_error("PROJECT_GIT_INIT_FAILED", error, true, context.clone()))?;
    if !output.success {
        return Err(command_error(
            "PROJECT_GIT_INIT_FAILED",
            command_failure("git init", &output),
            true,
            context,
        ));
    }
    Ok(ProjectGitOperationResult {
        message: "Git repository initialized.".to_string(),
    })
}

#[tauri::command]
pub async fn stage_project_git_paths(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    paths: Vec<String>,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    let paths = validated_paths(&paths).map_err(|error| {
        command_error("PROJECT_GIT_PATH_INVALID", error, false, context.clone())
    })?;
    let mut args = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    run_project_git_operation(
        &meta_store,
        &project_id,
        expected_root.as_deref(),
        &args,
        "Selected paths staged.",
    )
    .await
    .map_err(|error| command_error("PROJECT_GIT_STAGE_FAILED", error, true, context))
}

#[tauri::command]
pub async fn unstage_project_git_paths(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    paths: Vec<String>,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    let paths = validated_paths(&paths).map_err(|error| {
        command_error("PROJECT_GIT_PATH_INVALID", error, false, context.clone())
    })?;
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    require_repository(&root).await.map_err(|error| {
        command_error("PROJECT_GIT_UNSTAGE_FAILED", error, false, context.clone())
    })?;
    let head = run_git(
        &root,
        &["rev-parse", "--verify", "HEAD"],
        128,
        GIT_READ_TIMEOUT,
        true,
    )
    .await;
    let mut args = if head.is_ok_and(|output| output.success) {
        vec!["reset", "-q", "HEAD", "--"]
    } else {
        vec!["rm", "--cached", "-q", "--"]
    };
    args.extend(paths.iter().map(String::as_str));
    let output = run_git(&root, &args, GIT_OUTPUT_LIMIT, GIT_WRITE_TIMEOUT, false)
        .await
        .map_err(|error| {
            command_error("PROJECT_GIT_UNSTAGE_FAILED", error, true, context.clone())
        })?;
    if !output.success {
        return Err(command_error(
            "PROJECT_GIT_UNSTAGE_FAILED",
            command_failure("git unstage", &output),
            true,
            context,
        ));
    }
    Ok(ProjectGitOperationResult {
        message: "Selected paths unstaged.".to_string(),
    })
}

#[tauri::command]
pub async fn commit_project_git_changes(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    message: String,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    let message = validate_commit_message(&message).map_err(|error| {
        command_error(
            "PROJECT_GIT_COMMIT_MESSAGE_INVALID",
            error,
            false,
            context.clone(),
        )
    })?;
    run_project_git_operation(
        &meta_store,
        &project_id,
        expected_root.as_deref(),
        &["commit", "-m", &message],
        "Changes committed.",
    )
    .await
    .map_err(|error| command_error("PROJECT_GIT_COMMIT_FAILED", error, false, context))
}

#[tauri::command]
pub async fn create_project_git_branch(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    branch: String,
    checkout: bool,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    require_repository(&root).await.map_err(|error| {
        command_error("PROJECT_GIT_BRANCH_FAILED", error, false, context.clone())
    })?;
    let check = run_git(
        &root,
        &["check-ref-format", "--branch", branch.trim()],
        512,
        GIT_READ_TIMEOUT,
        true,
    )
    .await
    .map_err(|error| command_error("PROJECT_GIT_BRANCH_INVALID", error, false, context.clone()))?;
    if !check.success {
        return Err(command_error(
            "PROJECT_GIT_BRANCH_INVALID",
            "branch name is invalid",
            false,
            context,
        ));
    }
    let action = if checkout { "switch" } else { "branch" };
    let args = if checkout {
        vec![action, "-c", branch.trim()]
    } else {
        vec![action, branch.trim()]
    };
    let output = run_git(&root, &args, GIT_OUTPUT_LIMIT, GIT_WRITE_TIMEOUT, false)
        .await
        .map_err(|error| {
            command_error("PROJECT_GIT_BRANCH_FAILED", error, true, context.clone())
        })?;
    if !output.success {
        return Err(command_error(
            "PROJECT_GIT_BRANCH_FAILED",
            command_failure("git branch", &output),
            false,
            context,
        ));
    }
    Ok(ProjectGitOperationResult {
        message: if checkout {
            "Branch created and checked out."
        } else {
            "Branch created."
        }
        .to_string(),
    })
}

#[tauri::command]
pub async fn checkout_project_git_branch(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    branch: String,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    let snapshot = repository_snapshot(&root).await.map_err(|error| {
        command_error("PROJECT_GIT_BRANCH_FAILED", error, true, context.clone())
    })?;
    let branch = branch.trim();
    if !snapshot
        .branches
        .iter()
        .any(|candidate| candidate.name == branch)
    {
        return Err(command_error(
            "PROJECT_GIT_BRANCH_INVALID",
            "branch is not present in this repository",
            false,
            context,
        ));
    }
    run_project_git_operation(
        &meta_store,
        &project_id,
        expected_root.as_deref(),
        &["switch", branch],
        "Branch checked out.",
    )
    .await
    .map_err(|error| command_error("PROJECT_GIT_BRANCH_FAILED", error, false, context))
}

#[tauri::command]
pub async fn set_project_git_remote(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    name: String,
    url: String,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    let name = validate_remote_name(&name).map_err(|error| {
        command_error("PROJECT_GIT_REMOTE_INVALID", error, false, context.clone())
    })?;
    let url = validate_remote_url(&url).map_err(|error| {
        command_error("PROJECT_GIT_REMOTE_INVALID", error, false, context.clone())
    })?;
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    require_repository(&root).await.map_err(|error| {
        command_error("PROJECT_GIT_REMOTE_FAILED", error, false, context.clone())
    })?;
    let exists = run_git(
        &root,
        &["remote", "get-url", &name],
        4_096,
        GIT_READ_TIMEOUT,
        true,
    )
    .await
    .is_ok_and(|output| output.success);
    let args = if exists {
        vec!["remote", "set-url", &name, &url]
    } else {
        vec!["remote", "add", &name, &url]
    };
    let output = run_git(&root, &args, GIT_OUTPUT_LIMIT, GIT_WRITE_TIMEOUT, false)
        .await
        .map_err(|error| {
            command_error("PROJECT_GIT_REMOTE_FAILED", error, true, context.clone())
        })?;
    if !output.success {
        return Err(command_error(
            "PROJECT_GIT_REMOTE_FAILED",
            command_failure("git remote", &output),
            false,
            context,
        ));
    }
    Ok(ProjectGitOperationResult {
        message: format!("Remote {name} saved."),
    })
}

#[tauri::command]
pub async fn fetch_project_git_repository(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    run_project_git_operation(
        &meta_store,
        &project_id,
        expected_root.as_deref(),
        &["fetch", "--prune"],
        "Remote references fetched.",
    )
    .await
    .map_err(|error| command_error("PROJECT_GIT_FETCH_FAILED", error, true, context))
}

#[tauri::command]
pub async fn pull_project_git_repository(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    run_project_git_operation(
        &meta_store,
        &project_id,
        expected_root.as_deref(),
        &["pull", "--ff-only"],
        "Working tree updated with a fast-forward pull.",
    )
    .await
    .map_err(|error| command_error("PROJECT_GIT_PULL_FAILED", error, true, context))
}

#[tauri::command]
pub async fn push_project_git_repository(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    set_upstream: bool,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    require_repository(&root)
        .await
        .map_err(|error| command_error("PROJECT_GIT_PUSH_FAILED", error, false, context.clone()))?;
    let branch = run_git(
        &root,
        &["branch", "--show-current"],
        512,
        GIT_READ_TIMEOUT,
        true,
    )
    .await
    .map_err(|error| command_error("PROJECT_GIT_PUSH_FAILED", error, true, context.clone()))?;
    let branch = stdout_text(&branch);
    if branch.is_empty() {
        return Err(command_error(
            "PROJECT_GIT_PUSH_FAILED",
            "cannot push a detached HEAD",
            false,
            context,
        ));
    }
    let args = if set_upstream {
        vec!["push", "--set-upstream", "origin", branch.as_str()]
    } else {
        vec!["push"]
    };
    let output = run_git(&root, &args, GIT_OUTPUT_LIMIT, GIT_WRITE_TIMEOUT, false)
        .await
        .map_err(|error| command_error("PROJECT_GIT_PUSH_FAILED", error, true, context.clone()))?;
    if !output.success {
        return Err(command_error(
            "PROJECT_GIT_PUSH_FAILED",
            command_failure("git push", &output),
            true,
            context,
        ));
    }
    Ok(ProjectGitOperationResult {
        message: "Commits pushed.".to_string(),
    })
}

#[tauri::command]
pub async fn get_project_git_patch(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    scope: String,
    expected_root: Option<String>,
) -> Result<ProjectGitPatch, CommandError> {
    let context = serde_json::json!({ "projectId": project_id, "scope": scope });
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    require_repository(&root).await.map_err(|error| {
        command_error("PROJECT_GIT_PATCH_FAILED", error, false, context.clone())
    })?;
    let args = match scope.as_str() {
        "working" => vec!["diff", "--binary", "--", "."],
        "staged" => vec!["diff", "--cached", "--binary", "--", "."],
        "all" => vec!["diff", "HEAD", "--binary", "--", "."],
        _ => {
            return Err(command_error(
                "PROJECT_GIT_PATCH_SCOPE_INVALID",
                "patch scope must be all, staged, or working",
                false,
                context,
            ))
        }
    };
    let output = run_git(&root, &args, GIT_PATCH_LIMIT, GIT_READ_TIMEOUT, true)
        .await
        .map_err(|error| command_error("PROJECT_GIT_PATCH_FAILED", error, true, context.clone()))?;
    if !output.success {
        return Err(command_error(
            "PROJECT_GIT_PATCH_FAILED",
            command_failure("git diff", &output),
            false,
            context,
        ));
    }
    let patch = String::from_utf8_lossy(&output.stdout).to_string();
    let (additions, deletions) = diff_counts(&patch);
    Ok(ProjectGitPatch {
        scope,
        patch,
        additions,
        deletions,
        truncated: output.truncated,
    })
}

#[tauri::command]
pub async fn get_project_git_file_versions(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    scope: String,
    expected_root: Option<String>,
) -> Result<ProjectGitFileVersions, CommandError> {
    let context = serde_json::json!({
        "projectId": project_id,
        "relativePath": relative_path,
        "scope": scope,
    });
    let relative_path = validate_relative_path(&relative_path).map_err(|error| {
        command_error("PROJECT_GIT_PATH_INVALID", error, false, context.clone())
    })?;
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    require_repository(&root)
        .await
        .map_err(|error| command_error("PROJECT_GIT_DIFF_FAILED", error, false, context.clone()))?;
    let head_object = format!("HEAD:{relative_path}");
    let index_object = format!(":{relative_path}");
    let (original, modified) = match scope.as_str() {
        "working" => (
            git_blob(&root, &index_object).await,
            working_tree_blob(&root, &relative_path),
        ),
        "staged" => (
            git_blob(&root, &head_object).await,
            git_blob(&root, &index_object).await,
        ),
        "all" => (
            git_blob(&root, &head_object).await,
            working_tree_blob(&root, &relative_path),
        ),
        _ => {
            return Err(command_error(
                "PROJECT_GIT_DIFF_SCOPE_INVALID",
                "diff scope must be all, staged, or working",
                false,
                context,
            ))
        }
    };
    let original = original
        .map_err(|error| command_error("PROJECT_GIT_DIFF_FAILED", error, true, context.clone()))?;
    let modified = modified
        .map_err(|error| command_error("PROJECT_GIT_DIFF_FAILED", error, true, context.clone()))?;
    let original_missing = original.is_none();
    let modified_missing = modified.is_none();
    let original = original.unwrap_or_default();
    let modified = modified.unwrap_or_default();
    let binary = original.contains(&0) || modified.contains(&0);
    Ok(ProjectGitFileVersions {
        relative_path,
        scope,
        original_content: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&original).to_string()
        },
        modified_content: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&modified).to_string()
        },
        original_missing,
        modified_missing,
        binary,
    })
}

#[tauri::command]
pub async fn apply_project_git_patch(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    patch: String,
    reverse: bool,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    if patch.trim().is_empty() || patch.len() > GIT_PATCH_LIMIT || patch.contains('\0') {
        return Err(command_error(
            "PROJECT_GIT_PATCH_INVALID",
            "patch is empty, too large, or invalid",
            false,
            context,
        ));
    }
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    require_repository(&root).await.map_err(|error| {
        command_error("PROJECT_GIT_PATCH_FAILED", error, false, context.clone())
    })?;
    let args = if reverse {
        vec!["apply", "--check", "--reverse", "-"]
    } else {
        vec!["apply", "--check", "-"]
    };
    let check = run_git_with_input(&root, &args, patch.as_bytes(), GIT_WRITE_TIMEOUT)
        .await
        .map_err(|error| {
            command_error(
                "PROJECT_GIT_PATCH_CHECK_FAILED",
                error,
                true,
                context.clone(),
            )
        })?;
    if !check.success {
        return Err(command_error(
            "PROJECT_GIT_PATCH_CHECK_FAILED",
            command_failure("git apply --check", &check),
            false,
            context,
        ));
    }
    let args = if reverse {
        vec!["apply", "--reverse", "-"]
    } else {
        vec!["apply", "-"]
    };
    let applied = run_git_with_input(&root, &args, patch.as_bytes(), GIT_WRITE_TIMEOUT)
        .await
        .map_err(|error| {
            command_error(
                "PROJECT_GIT_PATCH_APPLY_FAILED",
                error,
                true,
                context.clone(),
            )
        })?;
    if !applied.success {
        return Err(command_error(
            "PROJECT_GIT_PATCH_APPLY_FAILED",
            command_failure("git apply", &applied),
            false,
            context,
        ));
    }
    Ok(ProjectGitOperationResult {
        message: if reverse {
            "Patch reversed."
        } else {
            "Patch applied."
        }
        .to_string(),
    })
}

#[tauri::command]
pub async fn update_project_git_index_patch(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    patch: String,
    reverse: bool,
    expected_root: Option<String>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "projectId": project_id });
    if patch.trim().is_empty() || patch.len() > GIT_PATCH_LIMIT || patch.contains('\0') {
        return Err(command_error(
            "PROJECT_GIT_INDEX_PATCH_INVALID",
            "index patch is empty, too large, or invalid",
            false,
            context,
        ));
    }
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| command_error("PROJECT_GIT_ROOT_FAILED", error, true, context.clone()))?;
    require_repository(&root).await.map_err(|error| {
        command_error(
            "PROJECT_GIT_INDEX_PATCH_FAILED",
            error,
            false,
            context.clone(),
        )
    })?;
    let check_args = if reverse {
        vec!["apply", "--cached", "--check", "--reverse", "-"]
    } else {
        vec!["apply", "--cached", "--check", "-"]
    };
    let checked = run_git_with_input(&root, &check_args, patch.as_bytes(), GIT_WRITE_TIMEOUT)
        .await
        .map_err(|error| {
            command_error(
                "PROJECT_GIT_INDEX_PATCH_CHECK_FAILED",
                error,
                true,
                context.clone(),
            )
        })?;
    if !checked.success {
        return Err(command_error(
            "PROJECT_GIT_INDEX_PATCH_CHECK_FAILED",
            command_failure("git apply --cached --check", &checked),
            false,
            context,
        ));
    }
    let apply_args = if reverse {
        vec!["apply", "--cached", "--reverse", "-"]
    } else {
        vec!["apply", "--cached", "-"]
    };
    let applied = run_git_with_input(&root, &apply_args, patch.as_bytes(), GIT_WRITE_TIMEOUT)
        .await
        .map_err(|error| {
            command_error(
                "PROJECT_GIT_INDEX_PATCH_FAILED",
                error,
                true,
                context.clone(),
            )
        })?;
    if !applied.success {
        return Err(command_error(
            "PROJECT_GIT_INDEX_PATCH_FAILED",
            command_failure("git apply --cached", &applied),
            false,
            context,
        ));
    }
    Ok(ProjectGitOperationResult {
        message: if reverse {
            "Hunk removed from the Git index."
        } else {
            "Hunk added to the Git index."
        }
        .to_string(),
    })
}

#[tauri::command]
pub async fn get_github_cli_status() -> Result<GitHubCliStatus, CommandError> {
    let context = serde_json::json!({ "host": "github.com" });
    let version = run_bounded(
        "gh",
        &["--version".to_string()],
        None,
        None,
        4_096,
        GIT_READ_TIMEOUT,
        true,
    )
    .await;
    let Ok(version) = version else {
        return Ok(GitHubCliStatus {
            installed: false,
            authenticated: false,
            account: None,
            version: None,
        });
    };
    let version_text = stdout_text(&version).lines().next().map(str::to_string);
    let status = run_bounded(
        "gh",
        &[
            "auth".to_string(),
            "status".to_string(),
            "--hostname".to_string(),
            "github.com".to_string(),
        ],
        None,
        None,
        16_384,
        GIT_READ_TIMEOUT,
        true,
    )
    .await
    .map_err(|error| command_error("GITHUB_AUTH_STATUS_FAILED", error, true, context.clone()))?;
    if !status.success {
        return Ok(GitHubCliStatus {
            installed: true,
            authenticated: false,
            account: None,
            version: version_text,
        });
    }
    let account = run_bounded(
        "gh",
        &[
            "api".to_string(),
            "user".to_string(),
            "--jq".to_string(),
            ".login".to_string(),
        ],
        None,
        None,
        4_096,
        GIT_READ_TIMEOUT,
        true,
    )
    .await
    .ok()
    .filter(|output| output.success)
    .map(|output| stdout_text(&output))
    .filter(|value| !value.is_empty());
    Ok(GitHubCliStatus {
        installed: true,
        authenticated: true,
        account,
        version: version_text,
    })
}

#[tauri::command]
pub async fn authenticate_github_cli(token: String) -> Result<GitHubCliStatus, CommandError> {
    let context = serde_json::json!({ "host": "github.com" });
    let token = token.trim();
    if token.is_empty() || token.len() > 4_096 || token.contains(['\r', '\n', '\0']) {
        return Err(command_error(
            "GITHUB_TOKEN_INVALID",
            "GitHub token is empty, too large, or invalid",
            false,
            context,
        ));
    }
    let mut input = token.as_bytes().to_vec();
    input.push(b'\n');
    let args = [
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--with-token",
    ]
    .map(str::to_string);
    let output = run_bounded(
        "gh",
        &args,
        None,
        Some(&input),
        16_384,
        Duration::from_secs(60),
        false,
    )
    .await
    .map_err(|error| command_error("GITHUB_AUTH_FAILED", error, true, context.clone()))?;
    input.fill(0);
    if !output.success {
        return Err(command_error(
            "GITHUB_AUTH_FAILED",
            command_failure("gh auth login", &output),
            false,
            context,
        ));
    }
    get_github_cli_status().await
}

#[tauri::command]
pub async fn search_github_repositories(
    query: String,
) -> Result<Vec<GitHubRepository>, CommandError> {
    let context = serde_json::json!({ "host": "github.com" });
    let query = query.trim();
    if query.is_empty() || query.len() > 256 || query.contains('\0') {
        return Err(command_error(
            "GITHUB_SEARCH_INVALID",
            "repository search query is empty, too large, or invalid",
            false,
            context,
        ));
    }
    let fields =
        "fullName,description,url,isPrivate,isArchived,stargazersCount,updatedAt,defaultBranch";
    let args = vec![
        "search".to_string(),
        "repos".to_string(),
        query.to_string(),
        "--limit".to_string(),
        GITHUB_REPOSITORY_LIMIT.to_string(),
        "--json".to_string(),
        fields.to_string(),
    ];
    let output = run_bounded(
        "gh",
        &args,
        None,
        None,
        GIT_OUTPUT_LIMIT,
        GIT_WRITE_TIMEOUT,
        true,
    )
    .await
    .map_err(|error| command_error("GITHUB_SEARCH_FAILED", error, true, context.clone()))?;
    if !output.success {
        return Err(command_error(
            "GITHUB_SEARCH_FAILED",
            command_failure("gh search repos", &output),
            true,
            context,
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| command_error("GITHUB_SEARCH_RESPONSE_INVALID", error, false, context))
}

#[tauri::command]
pub async fn clone_git_repository(
    source: String,
    destination: String,
    github: bool,
    shallow_depth: Option<u32>,
) -> Result<ProjectGitOperationResult, CommandError> {
    let context = serde_json::json!({ "destination": destination });
    let destination = validate_clone_destination(&destination).map_err(|error| {
        command_error(
            "PROJECT_GIT_CLONE_DESTINATION_INVALID",
            error,
            false,
            context.clone(),
        )
    })?;
    if shallow_depth.is_some_and(|depth| depth == 0 || depth > 100_000) {
        return Err(command_error(
            "PROJECT_GIT_CLONE_DEPTH_INVALID",
            "shallow clone depth must be between 1 and 100000",
            false,
            context,
        ));
    }
    let source = if github {
        let source = source.trim();
        if source.is_empty()
            || source.len() > 512
            || source.starts_with('-')
            || source.contains('\0')
        {
            return Err(command_error(
                "PROJECT_GIT_CLONE_SOURCE_INVALID",
                "GitHub repository name is invalid",
                false,
                context,
            ));
        }
        source.to_string()
    } else {
        validate_remote_url(&source).map_err(|error| {
            command_error(
                "PROJECT_GIT_CLONE_SOURCE_INVALID",
                error,
                false,
                context.clone(),
            )
        })?
    };
    let mut args = if github {
        vec![
            "repo".to_string(),
            "clone".to_string(),
            source,
            destination.to_string_lossy().to_string(),
        ]
    } else {
        vec![
            "clone".to_string(),
            "--".to_string(),
            source,
            destination.to_string_lossy().to_string(),
        ]
    };
    if let Some(depth) = shallow_depth {
        if github {
            args.extend(["--".to_string(), "--depth".to_string(), depth.to_string()]);
        } else {
            args.splice(1..1, ["--depth".to_string(), depth.to_string()]);
        }
    }
    let program = if github { "gh" } else { "git" };
    let output = run_bounded(
        program,
        &args,
        None,
        None,
        GIT_OUTPUT_LIMIT,
        GIT_CLONE_TIMEOUT,
        false,
    )
    .await
    .map_err(|error| command_error("PROJECT_GIT_CLONE_FAILED", error, true, context.clone()))?;
    if !output.success {
        return Err(command_error(
            "PROJECT_GIT_CLONE_FAILED",
            command_failure("repository clone", &output),
            true,
            context,
        ));
    }
    Ok(ProjectGitOperationResult {
        message: "Repository cloned.".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_url_rejects_credentials_and_local_helpers() {
        assert!(validate_remote_url("https://token@github.com/acme/repo.git").is_err());
        assert!(validate_remote_url("file:///tmp/repo").is_err());
        assert!(validate_remote_url("ext::sh -c bad").is_err());
        assert_eq!(
            validate_remote_url("git@github.com:acme/repo.git").unwrap(),
            "git@github.com:acme/repo.git"
        );
        assert_eq!(
            validate_remote_url("https://github.com/acme/repo.git").unwrap(),
            "https://github.com/acme/repo.git"
        );
    }

    #[test]
    fn relative_git_paths_stay_inside_project() {
        assert_eq!(
            validate_relative_path("sql/report.sql").unwrap(),
            "sql/report.sql"
        );
        assert!(validate_relative_path("../secret").is_err());
        assert!(validate_relative_path("/tmp/file").is_err());
    }

    #[test]
    fn status_parser_preserves_stage_and_worktree_state() {
        let files = parse_status(b"M  sql/staged.sql\0 M sql/working.sql\0?? sql/new.sql\0R  sql/new-name.sql\0sql/old-name.sql\0");
        assert_eq!(files.len(), 4);
        assert!(files
            .iter()
            .any(|file| file.relative_path == "sql/staged.sql" && file.staged && !file.unstaged));
        assert!(files
            .iter()
            .any(|file| file.relative_path == "sql/working.sql" && !file.staged && file.unstaged));
        assert!(files
            .iter()
            .any(|file| file.relative_path == "sql/new.sql" && file.untracked));
        assert!(files
            .iter()
            .any(|file| file.previous_path.as_deref() == Some("sql/old-name.sql")));
    }

    #[test]
    fn numstat_parser_handles_regular_and_renamed_files() {
        let counts = parse_numstat(b"2\t1\tsql/a.sql\x003\t4\t\x00sql/old.sql\x00sql/new.sql\x00");
        assert_eq!(counts.get("sql/a.sql"), Some(&(2, 1)));
        assert_eq!(counts.get("sql/new.sql"), Some(&(3, 4)));
    }

    #[test]
    fn history_parser_uses_control_character_boundaries() {
        let commits =
            parse_commits(b"abc\x1fa1\x1fA User\x1fa@example.com\x1f1710000000\x1fsubject\x1e");
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].short_hash, "a1");
        assert_eq!(commits[0].timestamp, 1_710_000_000);
    }

    #[test]
    fn commit_revision_requires_a_full_object_id() {
        assert_eq!(
            validate_commit_revision(&"A".repeat(40)).unwrap(),
            "a".repeat(40),
        );
        assert!(validate_commit_revision("HEAD").is_err());
        assert!(validate_commit_revision("abc1234").is_err());
        assert!(validate_commit_revision(&"g".repeat(40)).is_err());
    }

    #[test]
    fn diff_counter_ignores_patch_headers() {
        assert_eq!(
            diff_counts("--- a/a.sql\n+++ b/a.sql\n-old\n+new\n+extra\n"),
            (2, 1)
        );
    }
}
