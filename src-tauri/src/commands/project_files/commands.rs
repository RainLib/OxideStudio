use super::{
    agent::project_root,
    completion::{
        completion_index, completion_indexes, invalidate_completion_index, project_lsp_documents,
        ranked_project_snippets,
    },
    models::{
        project_command_error, ProjectCompletionContextRequest, ProjectCompletionSnippet,
        ProjectEntry, ProjectFilePreview, ProjectFileRead, ProjectFileWrite, ProjectLspDocument,
        ProjectLspDocumentsRequest, ProjectRoot,
    },
};
use crate::core::{
    protocol::CommandError,
    store::{MetaStore, Project},
};
use tauri::State;

#[tauri::command]
pub async fn set_project_root(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    root_path: Option<String>,
) -> Result<Project, CommandError> {
    let error_context = serde_json::json!({ "projectId": project_id });
    let canonical_root = match root_path {
        Some(root_path) => {
            if root_path.is_empty() {
                return Err(project_command_error(
                    "PROJECT_ROOT_INVALID",
                    "project root cannot be an empty string",
                    false,
                    error_context,
                ));
            }
            let root = ProjectRoot::new(root_path).map_err(|error| {
                project_command_error("PROJECT_ROOT_INVALID", error, false, error_context.clone())
            })?;
            Some(
                root.path
                    .to_str()
                    .ok_or_else(|| {
                        project_command_error(
                            "PROJECT_ROOT_INVALID",
                            "project root is not valid UTF-8",
                            false,
                            error_context.clone(),
                        )
                    })?
                    .to_string(),
            )
        }
        None => None,
    };

    let project = meta_store
        .set_project_root(&project_id, canonical_root.as_deref())
        .await
        .map_err(|error| {
            project_command_error("PROJECT_ROOT_SAVE_FAILED", error, true, error_context)
        })?;
    if let Ok(mut indexes) = completion_indexes().lock() {
        indexes.clear();
    }
    Ok(project)
}

#[tauri::command]
pub async fn get_project_completion_context(
    meta_store: State<'_, MetaStore>,
    request: ProjectCompletionContextRequest,
) -> Result<Vec<ProjectCompletionSnippet>, CommandError> {
    let error_context = serde_json::json!({
        "projectId": request.project_id,
        "relativePath": request.active_file,
    });
    let root = project_root(
        &meta_store,
        &request.project_id,
        request.expected_root.as_deref(),
    )
    .await
    .map_err(|error| {
        project_command_error(
            "PROJECT_ROOT_RESOLUTION_FAILED",
            error,
            true,
            error_context.clone(),
        )
    })?;
    let index = completion_index(&root).map_err(|error| {
        project_command_error(
            "PROJECT_COMPLETION_INDEX_FAILED",
            error,
            true,
            error_context,
        )
    })?;
    Ok(ranked_project_snippets(&index, &request))
}

#[tauri::command]
pub async fn get_project_lsp_documents(
    meta_store: State<'_, MetaStore>,
    request: ProjectLspDocumentsRequest,
) -> Result<Vec<ProjectLspDocument>, CommandError> {
    let error_context = serde_json::json!({
        "projectId": request.project_id,
    });
    let root = project_root(
        &meta_store,
        &request.project_id,
        request.expected_root.as_deref(),
    )
    .await
    .map_err(|error| {
        project_command_error(
            "PROJECT_ROOT_RESOLUTION_FAILED",
            error,
            true,
            error_context.clone(),
        )
    })?;
    project_lsp_documents(&root).map_err(|error| {
        project_command_error("PROJECT_LSP_INDEX_FAILED", error, true, error_context)
    })
}

#[tauri::command]
pub async fn list_project_entries(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: Option<String>,
    expected_root: Option<String>,
) -> Result<Vec<ProjectEntry>, CommandError> {
    let error_context = serde_json::json!({
        "projectId": project_id,
        "relativePath": relative_path,
    });
    project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| {
            project_command_error(
                "PROJECT_ROOT_RESOLUTION_FAILED",
                error,
                true,
                error_context.clone(),
            )
        })?
        .list_entries(relative_path.as_deref())
        .map_err(|error| {
            project_command_error("PROJECT_ENTRY_LIST_FAILED", error, true, error_context)
        })
}

#[tauri::command]
pub async fn read_project_file(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    expected_root: Option<String>,
) -> Result<ProjectFileRead, CommandError> {
    let error_context = serde_json::json!({
        "projectId": project_id,
        "relativePath": relative_path,
    });
    project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| {
            project_command_error(
                "PROJECT_ROOT_RESOLUTION_FAILED",
                error,
                true,
                error_context.clone(),
            )
        })?
        .read_file(&relative_path)
        .map_err(|error| {
            project_command_error("PROJECT_FILE_READ_FAILED", error, true, error_context)
        })
}

#[tauri::command]
pub async fn read_project_file_preview(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    expected_root: Option<String>,
) -> Result<ProjectFilePreview, CommandError> {
    let error_context = serde_json::json!({
        "projectId": project_id,
        "relativePath": relative_path,
    });
    project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| {
            project_command_error(
                "PROJECT_ROOT_RESOLUTION_FAILED",
                error,
                true,
                error_context.clone(),
            )
        })?
        .read_file_preview(&relative_path)
        .map_err(|error| {
            project_command_error("PROJECT_FILE_PREVIEW_FAILED", error, true, error_context)
        })
}

#[tauri::command]
pub async fn create_project_file(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    content: Option<String>,
    expected_root: Option<String>,
) -> Result<ProjectFileWrite, CommandError> {
    let error_context = serde_json::json!({
        "projectId": project_id,
        "relativePath": relative_path,
    });
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
    let result = root
        .create_file(&relative_path, content.as_deref().unwrap_or_default())
        .map_err(|error| {
            project_command_error("PROJECT_FILE_CREATE_FAILED", error, false, error_context)
        })?;
    invalidate_completion_index(&root);
    Ok(result)
}

#[tauri::command]
pub async fn create_project_directory(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    expected_root: Option<String>,
) -> Result<ProjectEntry, CommandError> {
    let error_context = serde_json::json!({
        "projectId": project_id,
        "relativePath": relative_path,
    });
    project_root(&meta_store, &project_id, expected_root.as_deref())
        .await
        .map_err(|error| {
            project_command_error(
                "PROJECT_ROOT_RESOLUTION_FAILED",
                error,
                true,
                error_context.clone(),
            )
        })?
        .create_directory(&relative_path)
        .map_err(|error| {
            project_command_error(
                "PROJECT_DIRECTORY_CREATE_FAILED",
                error,
                false,
                error_context,
            )
        })
}

#[tauri::command]
pub async fn write_project_file(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    content: String,
    expected_revision: String,
    expected_root: Option<String>,
) -> Result<ProjectFileWrite, CommandError> {
    let error_context = serde_json::json!({
        "projectId": project_id,
        "relativePath": relative_path,
    });
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
    let result = root
        .write_file(&relative_path, &content, &expected_revision)
        .map_err(|error| {
            project_command_error("PROJECT_FILE_WRITE_FAILED", error, false, error_context)
        })?;
    invalidate_completion_index(&root);
    Ok(result)
}

#[tauri::command]
pub async fn rename_project_entry(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    new_relative_path: String,
    expected_root: Option<String>,
) -> Result<ProjectEntry, CommandError> {
    let error_context = serde_json::json!({
        "projectId": project_id,
        "relativePath": relative_path,
        "newRelativePath": new_relative_path,
    });
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
    let result = root
        .rename_entry(&relative_path, &new_relative_path)
        .map_err(|error| {
            project_command_error("PROJECT_ENTRY_RENAME_FAILED", error, false, error_context)
        })?;
    invalidate_completion_index(&root);
    Ok(result)
}

#[tauri::command]
pub async fn delete_project_entry(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    recursive: Option<bool>,
    expected_root: Option<String>,
) -> Result<(), CommandError> {
    let error_context = serde_json::json!({
        "projectId": project_id,
        "relativePath": relative_path,
        "recursive": recursive,
    });
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
    root.delete_entry(&relative_path, recursive.unwrap_or(false))
        .map_err(|error| {
            project_command_error("PROJECT_ENTRY_DELETE_FAILED", error, false, error_context)
        })?;
    invalidate_completion_index(&root);
    Ok(())
}

#[tauri::command]
pub async fn delete_project_file_if_revision(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    expected_revision: String,
    expected_root: Option<String>,
) -> Result<(), CommandError> {
    let error_context = serde_json::json!({
        "projectId": project_id,
        "relativePath": relative_path,
    });
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
    root.delete_file_if_revision(&relative_path, &expected_revision)
        .map_err(|error| {
            project_command_error("PROJECT_FILE_UNDO_FAILED", error, false, error_context)
        })?;
    invalidate_completion_index(&root);
    Ok(())
}
