use crate::core::{protocol::CommandError, store::MetaStore};
use anyhow::Result;
use tauri::State;

use super::models::{ProjectGitFileVersions, ProjectGitOperationResult, ProjectGitPatch};
use super::repository::{diff_counts, git_blob, working_tree_blob};
use super::runtime::{
    command_error, command_failure, project_root, require_repository, run_git, run_git_with_input,
    GIT_PATCH_LIMIT, GIT_READ_TIMEOUT, GIT_WRITE_TIMEOUT,
};
use super::validation::validate_relative_path;

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
