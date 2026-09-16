use super::{
    completion::invalidate_completion_index,
    filesystem::validate_relative_path,
    models::{
        ProjectEntry, ProjectFileAppliedChange, ProjectFileRead, ProjectRoot,
        AGENT_PROJECT_ENTRY_LIMIT, AGENT_PROJECT_FILE_LIMIT, PROJECT_ROOT_CHANGED_PREFIX,
    },
};
use crate::core::store::MetaStore;
use anyhow::{bail, Result};
use std::{fs, path::PathBuf};

pub(super) async fn project_root(
    meta_store: &MetaStore,
    project_id: &str,
    expected_root: Option<&str>,
) -> Result<ProjectRoot, String> {
    let project = meta_store
        .get_project(project_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("project not found: {project_id}"))?;
    let root_path = project
        .root_path
        .ok_or_else(|| format!("project root is not configured: {project_id}"))?;
    let root = ProjectRoot::new(root_path).map_err(|error| error.to_string())?;
    assert_expected_project_root(&root, expected_root)?;
    Ok(root)
}

pub(crate) async fn agent_list_project_entries(
    meta_store: &MetaStore,
    project_id: &str,
    relative_path: Option<&str>,
) -> Result<Vec<ProjectEntry>> {
    let root = project_root(meta_store, project_id, None)
        .await
        .map_err(anyhow::Error::msg)?;
    let mut entries = root.list_entries(relative_path)?;
    entries.truncate(AGENT_PROJECT_ENTRY_LIMIT);
    Ok(entries)
}

pub(crate) async fn agent_read_project_file(
    meta_store: &MetaStore,
    project_id: &str,
    relative_path: &str,
) -> Result<ProjectFileRead> {
    let root = project_root(meta_store, project_id, None)
        .await
        .map_err(anyhow::Error::msg)?;
    let relative = validate_relative_path(relative_path, false)?;
    let path = root.resolve_existing(&relative)?;
    let metadata = fs::metadata(&path)?;
    if !metadata.is_file() {
        bail!("project path is not a file: {}", relative.wire_path);
    }
    if metadata.len() > AGENT_PROJECT_FILE_LIMIT {
        bail!(
            "Agent project files are limited to {} KiB",
            AGENT_PROJECT_FILE_LIMIT / 1024
        );
    }
    root.read_file(&relative.wire_path)
}

pub(crate) async fn agent_project_directory(
    meta_store: &MetaStore,
    project_id: &str,
    relative_directory: Option<&str>,
) -> Result<(PathBuf, PathBuf)> {
    let root = project_root(meta_store, project_id, None)
        .await
        .map_err(anyhow::Error::msg)?;
    let relative = validate_relative_path(relative_directory.unwrap_or_default(), true)?;
    let directory = root.resolve_existing(&relative)?;
    if !fs::metadata(&directory)?.is_dir() {
        bail!(
            "project shell working directory is not a directory: {}",
            relative.wire_path
        );
    }
    Ok((root.path.clone(), directory))
}

pub(crate) async fn agent_apply_project_file_change(
    meta_store: &MetaStore,
    project_id: &str,
    relative_path: &str,
    content: &str,
    expected_revision: Option<&str>,
    create: bool,
) -> Result<ProjectFileAppliedChange> {
    if content.len() as u64 > AGENT_PROJECT_FILE_LIMIT {
        bail!(
            "Agent project files are limited to {} KiB",
            AGENT_PROJECT_FILE_LIMIT / 1024
        );
    }
    let root = project_root(meta_store, project_id, None)
        .await
        .map_err(anyhow::Error::msg)?;
    let proposal = root.prepare_file_change(relative_path, content, expected_revision, create)?;
    let write = if create {
        root.create_file(relative_path, content)?
    } else {
        root.write_file(
            relative_path,
            content,
            expected_revision.unwrap_or_default(),
        )?
    };
    invalidate_completion_index(&root);
    Ok(ProjectFileAppliedChange {
        relative_path: write.relative_path,
        revision: write.revision,
        previous_revision: write.previous_revision,
        original_content: proposal.original_content,
        applied_content: proposal.proposed_content,
        additions: proposal.additions,
        deletions: proposal.deletions,
        introduced_lines: write.introduced_lines,
        line_evidence_truncated: write.line_evidence_truncated,
    })
}

pub(super) fn assert_expected_project_root(
    root: &ProjectRoot,
    expected_root: Option<&str>,
) -> Result<(), String> {
    let Some(expected_root) = expected_root.filter(|root| !root.trim().is_empty()) else {
        return Ok(());
    };
    let expected = ProjectRoot::new(expected_root).map_err(|error| {
        format!("{PROJECT_ROOT_CHANGED_PREFIX} expected root is unavailable: {error}")
    })?;
    if expected.path != root.path {
        return Err(format!(
            "{PROJECT_ROOT_CHANGED_PREFIX} configured project root changed from {} to {}",
            expected.path.display(),
            root.path.display()
        ));
    }
    Ok(())
}
