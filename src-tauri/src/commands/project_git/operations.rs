use crate::core::{protocol::CommandError, store::MetaStore};
use anyhow::Result;
use tauri::State;

use super::models::ProjectGitOperationResult;
use super::repository::repository_snapshot;
use super::runtime::{
    command_error, command_failure, project_root, require_repository, run_git, stdout_text,
    GIT_OUTPUT_LIMIT, GIT_READ_TIMEOUT, GIT_WRITE_TIMEOUT,
};
use super::validation::{
    validate_commit_message, validate_remote_name, validate_remote_url, validated_paths,
};

pub(super) async fn run_project_git_operation(
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
