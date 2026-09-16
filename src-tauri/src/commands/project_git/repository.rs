use crate::core::{protocol::CommandError, store::MetaStore};
use anyhow::{bail, Result};
use std::collections::HashMap;
use std::path::Path;
use tauri::State;

use super::models::{
    ProjectGitBranch, ProjectGitCommit, ProjectGitCommitFile, ProjectGitCommitFiles,
    ProjectGitRemote, ProjectGitRepository, ProjectGitWorkspaceFile,
};
use super::runtime::{
    command_error, command_failure, project_root, redact_sensitive_text, require_repository,
    run_git, stdout_text, GIT_COMMIT_LIMIT, GIT_FILE_LIMIT, GIT_OUTPUT_LIMIT, GIT_PATCH_LIMIT,
    GIT_READ_TIMEOUT,
};
use super::validation::{validate_commit_revision, validate_relative_path};

pub(super) fn parse_status(output: &[u8]) -> Vec<ProjectGitWorkspaceFile> {
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

pub(super) fn parse_numstat(output: &[u8]) -> HashMap<String, (usize, usize)> {
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

pub(super) fn add_untracked_counts(root: &Path, files: &mut [ProjectGitWorkspaceFile]) {
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

pub(super) fn parse_branches(output: &[u8]) -> Vec<ProjectGitBranch> {
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

pub(super) fn parse_commits(output: &[u8]) -> Vec<ProjectGitCommit> {
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

pub(super) fn parse_ahead_behind(value: &str) -> (usize, usize) {
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

pub(super) fn diff_counts(patch: &str) -> (usize, usize) {
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

pub(super) async fn git_blob(root: &Path, object: &str) -> Result<Option<Vec<u8>>> {
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

pub(super) fn working_tree_blob(root: &Path, relative_path: &str) -> Result<Option<Vec<u8>>> {
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

pub(super) async fn repository_snapshot(root: &Path) -> Result<ProjectGitRepository> {
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
