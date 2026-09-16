use super::{
    agent::project_root,
    filesystem::{content_revision, validate_relative_path},
    models::{
        project_command_error, GitCommandOutput, ProjectGitChangeSet, ProjectGitDiffScope,
        ProjectGitFileChange, ProjectGitFileDiff, ProjectGitRevisionStatus, ProjectRoot,
        AGENT_PROJECT_FILE_LIMIT, PROJECT_GIT_COMMAND_TIMEOUT, PROJECT_GIT_DIFF_SIZE_LIMIT,
        PROJECT_GIT_FILE_LIMIT, PROJECT_GIT_STATUS_SIZE_LIMIT, PROJECT_GIT_UNTRACKED_PREVIEW_LIMIT,
    },
};
use crate::core::{protocol::CommandError, store::MetaStore};
use anyhow::{anyhow, bail, Context, Result};
use std::{fs, process::Stdio};
use tauri::State;
use tokio::io::AsyncReadExt as TokioAsyncReadExt;
use tokio::process::Command as TokioCommand;

pub(super) async fn run_git_bounded(
    root: &ProjectRoot,
    args: &[&str],
    limit: usize,
) -> Result<GitCommandOutput> {
    let mut child = TokioCommand::new("git")
        .arg("-c")
        .arg("core.fsmonitor=false")
        .arg("-C")
        .arg(&root.path)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("failed to start git")?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("failed to capture git stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("failed to capture git stderr"))?;
    let stdout_read = async {
        let mut bytes = Vec::new();
        stdout
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)
            .await?;
        Ok::<Vec<u8>, std::io::Error>(bytes)
    };
    let stderr_read = async {
        let mut bytes = Vec::new();
        stderr.take(8_193).read_to_end(&mut bytes).await?;
        Ok::<Vec<u8>, std::io::Error>(bytes)
    };
    let (status, stdout, stderr) = tokio::time::timeout(PROJECT_GIT_COMMAND_TIMEOUT, async {
        tokio::join!(child.wait(), stdout_read, stderr_read)
    })
    .await
    .context("git command timed out")?;
    let status = status.context("failed to wait for git")?;
    let mut stdout = stdout.context("failed to read git stdout")?;
    let stderr = stderr.context("failed to read git stderr")?;
    let truncated = stdout.len() > limit;
    stdout.truncate(limit);
    Ok(GitCommandOutput {
        success: status.success(),
        stdout,
        stderr,
        truncated,
    })
}

pub(super) fn git_output_text(output: &GitCommandOutput) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

pub(super) fn parse_git_status(output: &[u8]) -> Vec<ProjectGitFileChange> {
    let mut entries = output
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty());
    let mut changes = Vec::new();
    while let Some(entry) = entries.next() {
        if entry.len() < 4 || entry[2] != b' ' {
            continue;
        }
        let index_status = entry[0] as char;
        let worktree_status = entry[1] as char;
        let relative_path = String::from_utf8_lossy(&entry[3..]).to_string();
        let renamed = matches!(index_status, 'R' | 'C') || matches!(worktree_status, 'R' | 'C');
        let previous_path = renamed
            .then(|| entries.next())
            .flatten()
            .map(|path| String::from_utf8_lossy(path).to_string());
        let Ok(relative_path) = validate_relative_path(&relative_path, false) else {
            continue;
        };
        let previous_path = previous_path.and_then(|path| {
            validate_relative_path(&path, false)
                .ok()
                .map(|validated| validated.wire_path)
        });
        let untracked = index_status == '?' && worktree_status == '?';
        let conflicted = matches!(
            (index_status, worktree_status),
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
        } else if index_status == 'A' {
            "added"
        } else if index_status == 'D' || worktree_status == 'D' {
            "deleted"
        } else {
            "modified"
        };
        changes.push(ProjectGitFileChange {
            relative_path: relative_path.wire_path,
            previous_path,
            status: status.to_string(),
            staged: !matches!(index_status, ' ' | '?'),
            unstaged: !matches!(worktree_status, ' ' | '?'),
            untracked,
            conflicted,
        });
    }
    changes.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    changes
}

pub(super) fn diff_line_counts(patch: &str) -> (usize, usize) {
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

pub(super) fn untracked_file_patch(
    root: &ProjectRoot,
    relative_path: &str,
) -> Result<(String, bool, bool)> {
    let relative = validate_relative_path(relative_path, false)?;
    let path = root.resolve_existing(&relative)?;
    let metadata = fs::metadata(&path)?;
    if !metadata.is_file() {
        return Ok((String::new(), false, false));
    }
    if metadata.len() > PROJECT_GIT_UNTRACKED_PREVIEW_LIMIT {
        return Ok((String::new(), false, true));
    }
    let bytes = fs::read(&path)?;
    if bytes.contains(&0) {
        return Ok((String::new(), true, false));
    }
    let content = String::from_utf8_lossy(&bytes);
    let safe_path = relative.wire_path.replace('\n', "\\n").replace('\r', "\\r");
    let line_count = content.lines().count();
    let mut patch = format!(
        "diff --git a/{safe_path} b/{safe_path}\nnew file mode 100644\n--- /dev/null\n+++ b/{safe_path}\n@@ -0,0 +1,{line_count} @@\n"
    );
    for line in content.lines() {
        patch.push('+');
        patch.push_str(line);
        patch.push('\n');
    }
    Ok((patch, false, false))
}

pub(super) async fn git_path_is_untracked(root: &ProjectRoot, relative_path: &str) -> Result<bool> {
    let output = run_git_bounded(
        root,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            relative_path,
        ],
        64 * 1024,
    )
    .await?;
    if !output.success {
        bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
    }
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .any(|candidate| candidate == relative_path.as_bytes()))
}

pub(super) fn working_tree_content_revision(
    root: &ProjectRoot,
    relative_path: &str,
) -> Result<(Option<String>, ProjectGitRevisionStatus)> {
    let relative = validate_relative_path(relative_path, false)?;
    let lexical_path = root.path.join(&relative.path);
    let lexical_metadata = match fs::symlink_metadata(&lexical_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((None, ProjectGitRevisionStatus::Missing));
        }
        Err(error) => return Err(error.into()),
    };
    if lexical_metadata.file_type().is_symlink() {
        return Ok((None, ProjectGitRevisionStatus::Unavailable));
    }
    let path = root.resolve_existing(&relative)?;
    let metadata = fs::metadata(&path)?;
    if !metadata.is_file() || metadata.len() > AGENT_PROJECT_FILE_LIMIT {
        return Ok((None, ProjectGitRevisionStatus::Unavailable));
    }
    let bytes = fs::read(path)?;
    Ok((
        Some(content_revision(&bytes)),
        ProjectGitRevisionStatus::Available,
    ))
}

pub(super) async fn staged_content_revision(
    root: &ProjectRoot,
    relative_path: &str,
) -> Result<(Option<String>, ProjectGitRevisionStatus)> {
    let object = format!(":{relative_path}");
    let content = run_git_bounded(
        root,
        &["cat-file", "blob", object.as_str()],
        AGENT_PROJECT_FILE_LIMIT as usize,
    )
    .await?;
    if content.success {
        if content.truncated {
            return Ok((None, ProjectGitRevisionStatus::Unavailable));
        }
        return Ok((
            Some(content_revision(&content.stdout)),
            ProjectGitRevisionStatus::Available,
        ));
    }

    let index_entries = run_git_bounded(
        root,
        &["ls-files", "--stage", "-z", "--", relative_path],
        64 * 1024,
    )
    .await?;
    if !index_entries.success {
        bail!("{}", String::from_utf8_lossy(&index_entries.stderr).trim());
    }
    if index_entries.stdout.is_empty() {
        Ok((None, ProjectGitRevisionStatus::Missing))
    } else {
        Ok((None, ProjectGitRevisionStatus::Unavailable))
    }
}

pub(super) async fn git_current_side_revision(
    root: &ProjectRoot,
    relative_path: &str,
    scope: ProjectGitDiffScope,
) -> Result<(Option<String>, ProjectGitRevisionStatus)> {
    match scope {
        ProjectGitDiffScope::Staged => staged_content_revision(root, relative_path).await,
        ProjectGitDiffScope::All | ProjectGitDiffScope::Working => {
            working_tree_content_revision(root, relative_path)
        }
    }
}

#[tauri::command]
pub async fn get_project_git_changes(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    expected_root: Option<String>,
) -> Result<ProjectGitChangeSet, CommandError> {
    let error_context = serde_json::json!({ "projectId": project_id });
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| {
            project_command_error(
                "PROJECT_ROOT_RESOLUTION_FAILED",
                error,
                true,
                error_context.clone(),
            )
        })?;
    let repository = run_git_bounded(&root, &["rev-parse", "--is-inside-work-tree"], 64)
        .await
        .map_err(|error| {
            project_command_error(
                "PROJECT_GIT_UNAVAILABLE",
                error,
                true,
                error_context.clone(),
            )
        })?;
    if !repository.success || git_output_text(&repository) != "true" {
        return Ok(ProjectGitChangeSet {
            is_repository: false,
            branch: None,
            head: None,
            files: Vec::new(),
            truncated: false,
        });
    }
    let (branch, head, status) = tokio::join!(
        run_git_bounded(&root, &["branch", "--show-current"], 512),
        run_git_bounded(&root, &["rev-parse", "--short", "HEAD"], 128),
        run_git_bounded(
            &root,
            &[
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
                "--",
                ".",
            ],
            PROJECT_GIT_STATUS_SIZE_LIMIT,
        ),
    );
    let branch = branch.map_err(|error| {
        project_command_error(
            "PROJECT_GIT_STATUS_FAILED",
            error,
            true,
            error_context.clone(),
        )
    })?;
    let head = head.map_err(|error| {
        project_command_error(
            "PROJECT_GIT_STATUS_FAILED",
            error,
            true,
            error_context.clone(),
        )
    })?;
    let status = status.map_err(|error| {
        project_command_error("PROJECT_GIT_STATUS_FAILED", error, true, error_context)
    })?;
    if !status.success {
        return Err(project_command_error(
            "PROJECT_GIT_STATUS_FAILED",
            String::from_utf8_lossy(&status.stderr),
            true,
            serde_json::json!({ "projectId": project_id }),
        ));
    }
    let mut files = parse_git_status(&status.stdout);
    let files_truncated = files.len() > PROJECT_GIT_FILE_LIMIT;
    files.truncate(PROJECT_GIT_FILE_LIMIT);
    Ok(ProjectGitChangeSet {
        is_repository: true,
        branch: branch
            .success
            .then(|| git_output_text(&branch))
            .filter(|value| !value.is_empty()),
        head: head
            .success
            .then(|| git_output_text(&head))
            .filter(|value| !value.is_empty()),
        files,
        truncated: status.truncated || files_truncated,
    })
}

#[tauri::command]
pub async fn get_project_git_file_diff(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    scope: Option<String>,
    expected_root: Option<String>,
) -> Result<ProjectGitFileDiff, CommandError> {
    let error_context = serde_json::json!({
        "projectId": project_id,
        "relativePath": relative_path,
        "scope": scope.as_deref().unwrap_or("all"),
    });
    let diff_scope = ProjectGitDiffScope::parse(scope.as_deref()).ok_or_else(|| {
        project_command_error(
            "PROJECT_GIT_DIFF_SCOPE_INVALID",
            format!(
                "unsupported Git diff scope: {}",
                scope.as_deref().unwrap_or_default()
            ),
            false,
            error_context.clone(),
        )
    })?;
    let root = project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| {
            project_command_error(
                "PROJECT_ROOT_RESOLUTION_FAILED",
                error,
                true,
                error_context.clone(),
            )
        })?;
    let relative = validate_relative_path(&relative_path, false).map_err(|error| {
        project_command_error(
            "PROJECT_GIT_PATH_INVALID",
            error,
            false,
            error_context.clone(),
        )
    })?;
    let primary_arguments = diff_scope.arguments(&relative.wire_path);
    let primary = run_git_bounded(&root, &primary_arguments, PROJECT_GIT_DIFF_SIZE_LIMIT)
        .await
        .map_err(|error| {
            project_command_error(
                "PROJECT_GIT_DIFF_FAILED",
                error,
                true,
                error_context.clone(),
            )
        })?;
    let (mut patch, mut truncated) = if primary.success {
        (
            String::from_utf8_lossy(&primary.stdout).to_string(),
            primary.truncated,
        )
    } else if diff_scope == ProjectGitDiffScope::All {
        let staged_args = [
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--",
            relative.wire_path.as_str(),
        ];
        let unstaged_args = [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--",
            relative.wire_path.as_str(),
        ];
        let (staged, unstaged) = tokio::join!(
            run_git_bounded(&root, &staged_args, PROJECT_GIT_DIFF_SIZE_LIMIT / 2,),
            run_git_bounded(&root, &unstaged_args, PROJECT_GIT_DIFF_SIZE_LIMIT / 2,),
        );
        let staged = staged.map_err(|error| {
            project_command_error(
                "PROJECT_GIT_DIFF_FAILED",
                error,
                true,
                error_context.clone(),
            )
        })?;
        let unstaged = unstaged.map_err(|error| {
            project_command_error(
                "PROJECT_GIT_DIFF_FAILED",
                error,
                true,
                error_context.clone(),
            )
        })?;
        if !staged.success || !unstaged.success {
            let stderr = format!(
                "{}{}",
                String::from_utf8_lossy(&staged.stderr),
                String::from_utf8_lossy(&unstaged.stderr)
            );
            return Err(project_command_error(
                "PROJECT_GIT_DIFF_FAILED",
                stderr,
                true,
                error_context.clone(),
            ));
        }
        (
            format!(
                "{}{}",
                String::from_utf8_lossy(&staged.stdout),
                String::from_utf8_lossy(&unstaged.stdout)
            ),
            staged.truncated || unstaged.truncated,
        )
    } else {
        return Err(project_command_error(
            "PROJECT_GIT_DIFF_FAILED",
            String::from_utf8_lossy(&primary.stderr),
            true,
            error_context.clone(),
        ));
    };
    let mut binary = patch.contains("Binary files ") || patch.contains("GIT binary patch");
    if patch.trim().is_empty()
        && diff_scope.includes_untracked()
        && git_path_is_untracked(&root, &relative.wire_path)
            .await
            .map_err(|error| {
                project_command_error(
                    "PROJECT_GIT_DIFF_FAILED",
                    error,
                    true,
                    error_context.clone(),
                )
            })?
    {
        let (untracked_patch, untracked_binary, untracked_truncated) =
            untracked_file_patch(&root, &relative.wire_path).map_err(|error| {
                project_command_error(
                    "PROJECT_GIT_DIFF_FAILED",
                    error,
                    true,
                    error_context.clone(),
                )
            })?;
        patch = untracked_patch;
        binary = untracked_binary;
        truncated |= untracked_truncated;
    }
    let (additions, deletions) = diff_line_counts(&patch);
    let (current_side_revision, current_side_revision_status) =
        git_current_side_revision(&root, &relative.wire_path, diff_scope)
            .await
            .map_err(|error| {
                project_command_error(
                    "PROJECT_GIT_DIFF_REVISION_FAILED",
                    error,
                    true,
                    error_context,
                )
            })?;
    Ok(ProjectGitFileDiff {
        relative_path: relative.wire_path,
        patch,
        additions,
        deletions,
        binary,
        truncated,
        current_side_revision,
        current_side_revision_status,
    })
}
