use crate::core::{
    protocol::CommandError,
    store::{MetaStore, Project},
};
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs::{self, Metadata, Permissions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, UNIX_EPOCH};
use tauri::State;
use tempfile::NamedTempFile;
use tokio::io::AsyncReadExt as TokioAsyncReadExt;
use tokio::process::Command as TokioCommand;

const REVISION_CONFLICT_PREFIX: &str = "REVISION_CONFLICT:";
const PROJECT_ROOT_CHANGED_PREFIX: &str = "PROJECT_ROOT_CHANGED:";
static PROJECT_FILE_MUTATION_LOCK: Mutex<()> = Mutex::new(());
static PROJECT_COMPLETION_INDEXES: OnceLock<Mutex<HashMap<PathBuf, ProjectCompletionIndex>>> =
    OnceLock::new();
const COMPLETION_FILE_LIMIT: usize = 5_000;
const COMPLETION_FILE_SIZE_LIMIT: u64 = 256 * 1024;
const COMPLETION_INDEX_SIZE_LIMIT: usize = 20 * 1024 * 1024;
const COMPLETION_CONTEXT_SIZE_LIMIT: usize = 8 * 1024;
// Project SQL files are opened as bounded, read-only virtual documents in the
// local language service. Keep this smaller than the generic AI completion
// index: an LSP receives full document text rather than ranked excerpts.
const LSP_PROJECT_DOCUMENT_LIMIT: usize = 128;
const LSP_PROJECT_DOCUMENT_SIZE_LIMIT: usize = 128 * 1024;
const LSP_PROJECT_DOCUMENT_TOTAL_SIZE_LIMIT: usize = 5 * 1024 * 1024;
const PROJECT_FILE_PREVIEW_SIZE_LIMIT: u64 = 25 * 1024 * 1024;
const PROJECT_GIT_STATUS_SIZE_LIMIT: usize = 4 * 1024 * 1024;
const PROJECT_GIT_DIFF_SIZE_LIMIT: usize = 1024 * 1024;
const PROJECT_GIT_UNTRACKED_PREVIEW_LIMIT: u64 = 512 * 1024;
const PROJECT_GIT_FILE_LIMIT: usize = 500;
const PROJECT_GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(8);
const AGENT_PROJECT_FILE_LIMIT: u64 = 256 * 1024;
const AGENT_PROJECT_ENTRY_LIMIT: usize = 500;
const PROJECT_FILE_LINE_EVIDENCE_LIMIT: usize = 2_048;

fn project_command_error(
    fallback_code: &str,
    error: impl std::fmt::Display,
    retryable: bool,
    context: serde_json::Value,
) -> CommandError {
    let raw_message = error.to_string();
    let (code, message, retryable) =
        if let Some(message) = raw_message.strip_prefix(REVISION_CONFLICT_PREFIX) {
            ("REVISION_CONFLICT", message.trim(), false)
        } else if let Some(message) = raw_message.strip_prefix(PROJECT_ROOT_CHANGED_PREFIX) {
            ("PROJECT_ROOT_CHANGED", message.trim(), false)
        } else if raw_message.starts_with("project not found:") {
            ("PROJECT_NOT_FOUND", raw_message.as_str(), false)
        } else if raw_message.starts_with("project root is not configured:") {
            ("PROJECT_ROOT_NOT_CONFIGURED", raw_message.as_str(), false)
        } else {
            (fallback_code, raw_message.as_str(), retryable)
        };
    CommandError::new(code, message, retryable, Some(context))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectEntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub relative_path: String,
    pub name: String,
    pub kind: ProjectEntryKind,
    pub size: u64,
    pub modified_at: Option<i64>,
    pub is_symlink: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileRead {
    pub relative_path: String,
    pub content: String,
    pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFilePreview {
    pub relative_path: String,
    pub media_type: String,
    pub data_base64: String,
    pub revision: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileWrite {
    pub relative_path: String,
    pub revision: String,
    pub previous_revision: Option<String>,
    pub introduced_lines: Vec<u32>,
    pub line_evidence_truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileProposal {
    pub relative_path: String,
    pub proposed_revision: String,
    pub base_revision: Option<String>,
    pub original_content: String,
    pub proposed_content: String,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileAppliedChange {
    pub relative_path: String,
    pub revision: String,
    pub previous_revision: Option<String>,
    pub original_content: String,
    pub applied_content: String,
    pub additions: usize,
    pub deletions: usize,
    pub introduced_lines: Vec<u32>,
    pub line_evidence_truncated: bool,
}

fn project_file_line_evidence(previous: &str, next: &str) -> (Vec<u32>, bool) {
    let previous_lines = previous.lines().collect::<HashSet<_>>();
    let mut introduced_lines = Vec::new();
    let mut truncated = false;

    for (index, line) in next.lines().enumerate() {
        if previous_lines.contains(line) {
            continue;
        }
        if introduced_lines.len() == PROJECT_FILE_LINE_EVIDENCE_LIMIT {
            truncated = true;
            break;
        }
        introduced_lines.push((index + 1) as u32);
    }

    (introduced_lines, truncated)
}

fn project_file_line_change_counts(previous: &str, next: &str) -> (usize, usize) {
    if previous == next {
        return (0, 0);
    }

    let previous_lines = previous.lines().collect::<Vec<_>>();
    let next_lines = next.lines().collect::<Vec<_>>();
    let previous_len = previous_lines.len() as isize;
    let next_len = next_lines.len() as isize;
    let max_distance = previous_len + next_len;
    let offset = max_distance + 1;
    let mut frontier = vec![-1isize; (max_distance * 2 + 3) as usize];
    frontier[(offset + 1) as usize] = 0;

    for distance in 0..=max_distance {
        let mut diagonal = -distance;
        while diagonal <= distance {
            let index = (offset + diagonal) as usize;
            let mut x = if diagonal == -distance
                || (diagonal != distance && frontier[index - 1] < frontier[index + 1])
            {
                frontier[index + 1]
            } else {
                frontier[index - 1] + 1
            };
            let mut y = x - diagonal;
            while x < previous_len
                && y < next_len
                && previous_lines[x as usize] == next_lines[y as usize]
            {
                x += 1;
                y += 1;
            }
            frontier[index] = x;
            if x >= previous_len && y >= next_len {
                let length_delta = next_len - previous_len;
                let additions = (distance + length_delta) / 2;
                let deletions = distance - additions;
                return (additions as usize, deletions as usize);
            }
            diagonal += 2;
        }
    }

    (next_lines.len(), previous_lines.len())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitFileChange {
    pub relative_path: String,
    pub previous_path: Option<String>,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitChangeSet {
    pub is_repository: bool,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub files: Vec<ProjectGitFileChange>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitFileDiff {
    pub relative_path: String,
    pub patch: String,
    pub additions: usize,
    pub deletions: usize,
    pub binary: bool,
    pub truncated: bool,
    pub current_side_revision: Option<String>,
    pub current_side_revision_status: ProjectGitRevisionStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectGitRevisionStatus {
    Available,
    Missing,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProjectGitDiffScope {
    All,
    Staged,
    Working,
}

impl ProjectGitDiffScope {
    fn parse(value: Option<&str>) -> Option<Self> {
        match value.unwrap_or("all") {
            "all" => Some(Self::All),
            "staged" => Some(Self::Staged),
            "working" => Some(Self::Working),
            _ => None,
        }
    }

    fn arguments(self, relative_path: &str) -> Vec<&str> {
        let mut arguments = vec!["diff"];
        if self == Self::Staged {
            arguments.push("--cached");
        }
        arguments.extend(["--no-ext-diff", "--no-textconv", "--no-color"]);
        if self == Self::All {
            arguments.push("HEAD");
        }
        arguments.extend(["--", relative_path]);
        arguments
    }

    fn includes_untracked(self) -> bool {
        matches!(self, Self::All | Self::Working)
    }
}

struct GitCommandOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    truncated: bool,
}

#[derive(Debug, Clone)]
struct IndexedProjectFile {
    relative_path: String,
    content: String,
}

#[derive(Debug, Clone, Default)]
struct ProjectCompletionIndex {
    files: Vec<IndexedProjectFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCompletionContextRequest {
    pub project_id: String,
    pub expected_root: Option<String>,
    pub active_file: Option<String>,
    pub query: String,
    #[serde(default)]
    pub referenced_objects: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCompletionSnippet {
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLspDocumentsRequest {
    pub project_id: String,
    pub expected_root: Option<String>,
}

/// A saved SQL document that may be mirrored into the local language service.
/// This intentionally does not expose absolute paths or non-SQL project files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLspDocument {
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Clone)]
struct ValidatedRelativePath {
    path: PathBuf,
    wire_path: String,
}

#[derive(Debug, Clone)]
struct ProjectRoot {
    path: PathBuf,
}

impl ProjectRoot {
    fn new(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if !path.is_absolute() {
            bail!("project root must be an absolute path");
        }

        let path = fs::canonicalize(path)
            .with_context(|| format!("failed to resolve project root: {}", path.display()))?;
        if !fs::metadata(&path)
            .with_context(|| format!("failed to inspect project root: {}", path.display()))?
            .is_dir()
        {
            bail!("project root is not a directory: {}", path.display());
        }

        Ok(Self { path })
    }

    fn list_entries(&self, relative_path: Option<&str>) -> Result<Vec<ProjectEntry>> {
        let relative = validate_relative_path(relative_path.unwrap_or_default(), true)?;
        let directory = self.resolve_existing(&relative)?;
        if !fs::metadata(&directory)?.is_dir() {
            bail!("project path is not a directory: {}", relative.wire_path);
        }

        let mut entries = Vec::new();
        for entry in fs::read_dir(&directory)
            .with_context(|| format!("failed to list directory: {}", relative.wire_path))?
        {
            let entry = entry.context("failed to read a project directory entry")?;
            let name = os_str_to_utf8(&entry.file_name(), "file name")?.to_string();
            let child_relative = append_wire_path(&relative.wire_path, &name);
            let lexical_path = self.path.join(&relative.path).join(entry.file_name());
            entries.push(self.describe_entry(&lexical_path, child_relative)?);
        }

        entries.sort_by(|left, right| {
            let left_rank = usize::from(left.kind == ProjectEntryKind::File);
            let right_rank = usize::from(right.kind == ProjectEntryKind::File);
            left_rank
                .cmp(&right_rank)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
                .then_with(|| left.name.cmp(&right.name))
        });
        Ok(entries)
    }

    fn read_file(&self, relative_path: &str) -> Result<ProjectFileRead> {
        let relative = validate_relative_path(relative_path, false)?;
        let path = self.resolve_existing(&relative)?;
        if !fs::metadata(&path)?.is_file() {
            bail!("project path is not a file: {}", relative.wire_path);
        }

        let bytes = fs::read(&path)
            .with_context(|| format!("failed to read project file: {}", relative.wire_path))?;
        let revision = content_revision(&bytes);
        let content = String::from_utf8(bytes)
            .with_context(|| format!("project file is not valid UTF-8: {}", relative.wire_path))?;

        Ok(ProjectFileRead {
            relative_path: relative.wire_path,
            content,
            revision,
        })
    }

    fn read_file_preview(&self, relative_path: &str) -> Result<ProjectFilePreview> {
        let relative = validate_relative_path(relative_path, false)?;
        let path = self.resolve_existing(&relative)?;
        let metadata = fs::metadata(&path)?;
        if !metadata.is_file() {
            bail!("project path is not a file: {}", relative.wire_path);
        }

        let media_type = project_file_preview_media_type(&path).ok_or_else(|| {
            anyhow!(
                "project file preview is not supported: {}",
                relative.wire_path
            )
        })?;
        if metadata.len() > PROJECT_FILE_PREVIEW_SIZE_LIMIT {
            bail!(
                "project file is too large to preview (maximum 25 MiB): {}",
                relative.wire_path
            );
        }

        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        fs::File::open(&path)
            .with_context(|| format!("failed to open project file: {}", relative.wire_path))?
            .take(PROJECT_FILE_PREVIEW_SIZE_LIMIT + 1)
            .read_to_end(&mut bytes)
            .with_context(|| format!("failed to read project file: {}", relative.wire_path))?;
        if bytes.len() as u64 > PROJECT_FILE_PREVIEW_SIZE_LIMIT {
            bail!(
                "project file is too large to preview (maximum 25 MiB): {}",
                relative.wire_path
            );
        }
        Ok(ProjectFilePreview {
            relative_path: relative.wire_path,
            media_type: media_type.to_string(),
            data_base64: BASE64_STANDARD.encode(&bytes),
            revision: content_revision(&bytes),
            size: bytes.len() as u64,
        })
    }

    fn create_file(&self, relative_path: &str, content: &str) -> Result<ProjectFileWrite> {
        let _mutation_guard = lock_project_file_mutations()?;
        let relative = validate_relative_path(relative_path, false)?;
        let target = self.resolve_new_target(&relative)?;
        let bytes = content.as_bytes();
        persist_new_file(&target, bytes)
            .with_context(|| format!("failed to create project file: {}", relative.wire_path))?;

        let (introduced_lines, line_evidence_truncated) = project_file_line_evidence("", content);
        Ok(ProjectFileWrite {
            relative_path: relative.wire_path,
            revision: content_revision(bytes),
            previous_revision: None,
            introduced_lines,
            line_evidence_truncated,
        })
    }

    fn prepare_file_change(
        &self,
        relative_path: &str,
        content: &str,
        expected_revision: Option<&str>,
        create: bool,
    ) -> Result<ProjectFileProposal> {
        let relative = validate_relative_path(relative_path, false)?;
        let (original_content, base_revision) = if create {
            if expected_revision.is_some() {
                bail!("expectedRevision must be omitted when creating a file");
            }
            self.validate_new_target_without_mutation(&relative)?;
            (String::new(), None)
        } else {
            let expected_revision = expected_revision
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| anyhow!("expectedRevision is required when replacing a file"))?;
            let file = self.read_file(&relative.wire_path)?;
            if file.revision != expected_revision {
                bail!(
                    "{REVISION_CONFLICT_PREFIX} expected {expected_revision}, current {}",
                    file.revision
                );
            }
            (file.content, Some(file.revision))
        };
        let (additions, deletions) = project_file_line_change_counts(&original_content, content);

        Ok(ProjectFileProposal {
            relative_path: relative.wire_path,
            proposed_revision: content_revision(content.as_bytes()),
            base_revision,
            original_content,
            proposed_content: content.to_string(),
            additions,
            deletions,
        })
    }

    fn create_directory(&self, relative_path: &str) -> Result<ProjectEntry> {
        let _mutation_guard = lock_project_file_mutations()?;
        let relative = validate_relative_path(relative_path, false)?;
        let target = self.resolve_new_target(&relative)?;
        fs::create_dir(&target).with_context(|| {
            format!("failed to create project directory: {}", relative.wire_path)
        })?;
        self.describe_entry(&target, relative.wire_path)
    }

    fn write_file(
        &self,
        relative_path: &str,
        content: &str,
        expected_revision: &str,
    ) -> Result<ProjectFileWrite> {
        let _mutation_guard = lock_project_file_mutations()?;
        let relative = validate_relative_path(relative_path, false)?;
        let path = self.resolve_existing(&relative)?;
        let metadata = fs::metadata(&path)?;
        if !metadata.is_file() {
            bail!("project path is not a file: {}", relative.wire_path);
        }

        self.assert_revision(&relative, expected_revision)?;
        let previous_bytes = fs::read(&path)
            .with_context(|| format!("failed to read project file: {}", relative.wire_path))?;
        if content_revision(&previous_bytes) != expected_revision {
            bail!(
                "{REVISION_CONFLICT_PREFIX} file changed before replacement: {}",
                relative.wire_path
            );
        }
        let previous_content = String::from_utf8_lossy(&previous_bytes);
        let permissions = metadata.permissions();
        let bytes = content.as_bytes();
        let temp = prepare_temp_file(
            path.parent()
                .context("project file does not have a parent directory")?,
            bytes,
            Some(permissions),
        )?;

        // Recheck after preparing the replacement to narrow the optimistic-lock race window.
        let latest_path = self.assert_revision(&relative, expected_revision)?;
        if latest_path != path {
            bail!(
                "{REVISION_CONFLICT_PREFIX} file target changed while saving: {}",
                relative.wire_path
            );
        }
        persist_replacement(temp, &path)
            .with_context(|| format!("failed to replace project file: {}", relative.wire_path))?;

        let (introduced_lines, line_evidence_truncated) =
            project_file_line_evidence(&previous_content, content);
        Ok(ProjectFileWrite {
            relative_path: relative.wire_path,
            revision: content_revision(bytes),
            previous_revision: Some(expected_revision.to_string()),
            introduced_lines,
            line_evidence_truncated,
        })
    }

    fn rename_entry(&self, relative_path: &str, new_relative_path: &str) -> Result<ProjectEntry> {
        let _mutation_guard = lock_project_file_mutations()?;
        let source_relative = validate_relative_path(relative_path, false)?;
        let target_relative = validate_relative_path(new_relative_path, false)?;
        if source_relative.path == target_relative.path {
            bail!("source and destination paths are the same");
        }

        let source_lexical = self.path.join(&source_relative.path);
        let source_metadata = fs::symlink_metadata(&source_lexical).with_context(|| {
            format!(
                "failed to inspect project entry: {}",
                source_relative.wire_path
            )
        })?;
        self.resolve_existing(&source_relative)?;
        if is_link_or_reparse(&source_metadata) {
            bail!("renaming symbolic links or junctions is not supported");
        }

        let target = self.resolve_new_target(&target_relative)?;
        fs::rename(&source_lexical, &target).with_context(|| {
            format!(
                "failed to rename project entry from {} to {}",
                source_relative.wire_path, target_relative.wire_path
            )
        })?;

        self.describe_entry(&target, target_relative.wire_path)
    }

    fn delete_entry(&self, relative_path: &str, recursive: bool) -> Result<()> {
        let _mutation_guard = lock_project_file_mutations()?;
        let relative = validate_relative_path(relative_path, false)?;
        let lexical_path = self.path.join(&relative.path);
        let resolved = self.resolve_existing(&relative)?;
        let link_metadata = fs::symlink_metadata(&lexical_path)
            .with_context(|| format!("failed to inspect project entry: {}", relative.wire_path))?;

        if is_link_or_reparse(&link_metadata) {
            remove_link_or_reparse(&lexical_path, &link_metadata).with_context(|| {
                format!("failed to delete project link: {}", relative.wire_path)
            })?;
        } else if fs::metadata(&resolved)?.is_dir() {
            if recursive {
                remove_tree_without_following_links(&lexical_path).with_context(|| {
                    format!("failed to delete project directory: {}", relative.wire_path)
                })?;
            } else {
                fs::remove_dir(&lexical_path).with_context(|| {
                    format!("failed to delete project directory: {}", relative.wire_path)
                })?;
            }
        } else {
            fs::remove_file(&lexical_path).with_context(|| {
                format!("failed to delete project file: {}", relative.wire_path)
            })?;
        }
        Ok(())
    }

    fn delete_file_if_revision(&self, relative_path: &str, expected_revision: &str) -> Result<()> {
        let _mutation_guard = lock_project_file_mutations()?;
        let relative = validate_relative_path(relative_path, false)?;
        let lexical_path = self.path.join(&relative.path);
        let link_metadata = fs::symlink_metadata(&lexical_path).map_err(|error| {
            anyhow!(
                "{REVISION_CONFLICT_PREFIX} file is no longer available for undo: {} ({error})",
                relative.wire_path
            )
        })?;
        if is_link_or_reparse(&link_metadata) {
            bail!(
                "{REVISION_CONFLICT_PREFIX} file target changed before undo: {}",
                relative.wire_path
            );
        }
        let path = self.assert_revision(&relative, expected_revision)?;
        if !fs::metadata(&path)?.is_file() {
            bail!(
                "{REVISION_CONFLICT_PREFIX} project path is no longer a file: {}",
                relative.wire_path
            );
        }
        self.assert_revision(&relative, expected_revision)?;
        fs::remove_file(&lexical_path).with_context(|| {
            format!(
                "failed to undo created project file: {}",
                relative.wire_path
            )
        })?;
        Ok(())
    }

    fn assert_revision(
        &self,
        relative: &ValidatedRelativePath,
        expected_revision: &str,
    ) -> Result<PathBuf> {
        let path = self.resolve_existing(relative)?;
        let bytes = fs::read(&path).with_context(|| {
            format!(
                "failed to read project file revision: {}",
                relative.wire_path
            )
        })?;
        let current_revision = content_revision(&bytes);
        if current_revision != expected_revision {
            bail!(
                "{REVISION_CONFLICT_PREFIX} expected {expected_revision}, current {current_revision}"
            );
        }
        Ok(path)
    }

    fn resolve_existing(&self, relative: &ValidatedRelativePath) -> Result<PathBuf> {
        let lexical_path = self.path.join(&relative.path);
        let resolved = fs::canonicalize(&lexical_path)
            .with_context(|| format!("failed to resolve project path: {}", relative.wire_path))?;
        self.ensure_inside_root(&resolved)?;
        Ok(resolved)
    }

    fn resolve_new_target(&self, relative: &ValidatedRelativePath) -> Result<PathBuf> {
        let lexical_target = self.path.join(&relative.path);
        let lexical_parent = lexical_target
            .parent()
            .context("project path does not have a parent directory")?;
        let relative_parent = lexical_parent
            .strip_prefix(&self.path)
            .context("project path parent is outside the configured root")?;
        let mut resolved_parent = self.path.clone();

        // Walk one component at a time so a nested Agent path such as
        // `sql/report.sql` can create missing project directories without
        // turning `create_dir_all` into a symlink traversal escape.
        for component in relative_parent.components() {
            let Component::Normal(name) = component else {
                bail!("project path contains an invalid parent component");
            };
            let candidate = resolved_parent.join(name);
            match fs::symlink_metadata(&candidate) {
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    fs::create_dir(&candidate).with_context(|| {
                        format!(
                            "failed to create parent directory for: {}",
                            relative.wire_path
                        )
                    })?;
                }
                Err(error) => {
                    return Err(error).with_context(|| {
                        format!(
                            "failed to inspect parent directory for: {}",
                            relative.wire_path
                        )
                    })
                }
            }

            let resolved = fs::canonicalize(&candidate).with_context(|| {
                format!(
                    "failed to resolve parent directory for: {}",
                    relative.wire_path
                )
            })?;
            self.ensure_inside_root(&resolved)?;
            if !fs::metadata(&resolved)?.is_dir() {
                bail!(
                    "project path parent is not a directory: {}",
                    relative.wire_path
                );
            }
            resolved_parent = resolved;
        }

        let name = relative
            .path
            .file_name()
            .context("project path does not have a file name")?;
        let target = resolved_parent.join(name);
        match fs::symlink_metadata(&target) {
            Ok(_) => bail!("project path already exists: {}", relative.wire_path),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(target),
            Err(error) => Err(error)
                .with_context(|| format!("failed to inspect project path: {}", relative.wire_path)),
        }
    }

    fn validate_new_target_without_mutation(&self, relative: &ValidatedRelativePath) -> Result<()> {
        let components = relative.path.components().collect::<Vec<_>>();
        let mut resolved_parent = self.path.clone();
        for (index, component) in components.iter().enumerate() {
            let Component::Normal(name) = component else {
                bail!("project path contains an invalid component");
            };
            let candidate = resolved_parent.join(name);
            let is_target = index + 1 == components.len();
            match fs::symlink_metadata(&candidate) {
                Ok(_) if is_target => {
                    bail!("project path already exists: {}", relative.wire_path)
                }
                Ok(metadata) => {
                    if is_link_or_reparse(&metadata) {
                        let resolved = fs::canonicalize(&candidate).with_context(|| {
                            format!(
                                "failed to resolve parent directory for: {}",
                                relative.wire_path
                            )
                        })?;
                        self.ensure_inside_root(&resolved)?;
                        if !fs::metadata(&resolved)?.is_dir() {
                            bail!(
                                "project path parent is not a directory: {}",
                                relative.wire_path
                            );
                        }
                        resolved_parent = resolved;
                    } else if !metadata.is_dir() {
                        bail!(
                            "project path parent is not a directory: {}",
                            relative.wire_path
                        );
                    } else {
                        resolved_parent = candidate;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(error) => {
                    return Err(error).with_context(|| {
                        format!("failed to inspect project path: {}", relative.wire_path)
                    })
                }
            }
        }
        Ok(())
    }

    fn ensure_inside_root(&self, path: &Path) -> Result<()> {
        if !path.starts_with(&self.path) {
            bail!(
                "project path resolves outside the configured root: {}",
                path.display()
            );
        }
        Ok(())
    }

    fn describe_entry(&self, lexical_path: &Path, relative_path: String) -> Result<ProjectEntry> {
        let link_metadata = fs::symlink_metadata(lexical_path)
            .with_context(|| format!("failed to inspect project entry: {relative_path}"))?;
        let is_symlink = is_link_or_reparse(&link_metadata);
        let metadata = fs::metadata(lexical_path).unwrap_or_else(|_| link_metadata.clone());
        let kind = if metadata.is_dir() {
            ProjectEntryKind::Directory
        } else {
            ProjectEntryKind::File
        };
        let name = lexical_path
            .file_name()
            .context("project entry does not have a file name")?;

        Ok(ProjectEntry {
            relative_path,
            name: os_str_to_utf8(name, "file name")?.to_string(),
            kind,
            size: if kind == ProjectEntryKind::File {
                metadata.len()
            } else {
                0
            },
            modified_at: metadata.modified().ok().and_then(system_time_millis),
            is_symlink,
        })
    }
}

fn completion_indexes() -> &'static Mutex<HashMap<PathBuf, ProjectCompletionIndex>> {
    PROJECT_COMPLETION_INDEXES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn invalidate_completion_index(root: &ProjectRoot) {
    if let Ok(mut indexes) = completion_indexes().lock() {
        indexes.remove(&root.path);
    }
}

fn is_completion_database_file(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "sql" | "psql" | "pgsql" | "mysql" | "json" | "jsonc" | "eql" | "redis"
            )
        })
}

fn is_lsp_sql_file(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "sql" | "psql" | "pgsql" | "mysql"
            )
        })
}

fn excluded_completion_entry(name: &str, is_directory: bool) -> bool {
    let lower = name.to_ascii_lowercase();
    if name.starts_with('.') {
        return true;
    }
    if is_directory {
        return matches!(
            lower.as_str(),
            "node_modules" | "target" | "dist" | "build" | "vendor"
        );
    }
    lower.starts_with(".env")
        || lower.contains("credential")
        || lower.contains("secret")
        || matches!(
            Path::new(&lower).extension().and_then(OsStr::to_str),
            Some("pem" | "key" | "p12" | "pfx")
        )
}

fn collect_completion_files(
    root: &ProjectRoot,
    directory: &Path,
    index: &mut ProjectCompletionIndex,
    indexed_bytes: &mut usize,
) -> Result<()> {
    if index.files.len() >= COMPLETION_FILE_LIMIT || *indexed_bytes >= COMPLETION_INDEX_SIZE_LIMIT {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        if index.files.len() >= COMPLETION_FILE_LIMIT
            || *indexed_bytes >= COMPLETION_INDEX_SIZE_LIMIT
        {
            break;
        }
        let entry = entry?;
        let file_name = entry.file_name();
        let name = os_str_to_utf8(&file_name, "file name")?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if is_link_or_reparse(&metadata) || excluded_completion_entry(name, metadata.is_dir()) {
            continue;
        }
        if metadata.is_dir() {
            collect_completion_files(root, &path, index, indexed_bytes)?;
            continue;
        }
        if !metadata.is_file()
            || metadata.len() > COMPLETION_FILE_SIZE_LIMIT
            || !is_completion_database_file(&path)
        {
            continue;
        }
        let resolved = fs::canonicalize(&path)?;
        root.ensure_inside_root(&resolved)?;
        let bytes = fs::read(&resolved)?;
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        if indexed_bytes.saturating_add(content.len()) > COMPLETION_INDEX_SIZE_LIMIT {
            break;
        }
        let relative_path = path
            .strip_prefix(&root.path)
            .context("indexed file is outside the project root")?
            .components()
            .map(|component| match component {
                Component::Normal(value) => os_str_to_utf8(value, "path component"),
                _ => bail!("indexed project path is not relative"),
            })
            .collect::<Result<Vec<_>>>()?
            .join("/");
        *indexed_bytes += content.len();
        index.files.push(IndexedProjectFile {
            relative_path,
            content,
        });
    }
    Ok(())
}

fn completion_index(root: &ProjectRoot) -> Result<ProjectCompletionIndex> {
    if let Ok(indexes) = completion_indexes().lock() {
        if let Some(index) = indexes.get(&root.path) {
            return Ok(index.clone());
        }
    }
    let mut index = ProjectCompletionIndex::default();
    let mut indexed_bytes = 0;
    collect_completion_files(root, &root.path, &mut index, &mut indexed_bytes)?;
    let mut indexes = completion_indexes()
        .lock()
        .map_err(|_| anyhow!("project completion index lock is poisoned"))?;
    indexes.insert(root.path.clone(), index.clone());
    Ok(index)
}

fn project_lsp_documents(root: &ProjectRoot) -> Result<Vec<ProjectLspDocument>> {
    let index = completion_index(root)?;
    let mut total_size = 0usize;

    Ok(index
        .files
        .into_iter()
        .filter(|file| is_lsp_sql_file(Path::new(&file.relative_path)))
        .filter_map(|file| {
            if file.content.len() > LSP_PROJECT_DOCUMENT_SIZE_LIMIT
                || total_size.saturating_add(file.content.len())
                    > LSP_PROJECT_DOCUMENT_TOTAL_SIZE_LIMIT
            {
                return None;
            }
            total_size += file.content.len();
            Some(ProjectLspDocument {
                relative_path: file.relative_path,
                content: file.content,
            })
        })
        .take(LSP_PROJECT_DOCUMENT_LIMIT)
        .collect())
}

fn completion_query_terms(request: &ProjectCompletionContextRequest) -> Vec<String> {
    let mut values = request.referenced_objects.clone();
    values.extend(
        request
            .query
            .split(|ch: char| !(ch.is_alphanumeric() || matches!(ch, '_' | '.')))
            .filter(|value| value.len() >= 3)
            .map(ToString::to_string),
    );
    values.sort_by_key(|value| std::cmp::Reverse(value.len()));
    values.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    values.truncate(24);
    values
}

fn truncate_utf8_bytes(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

fn ranked_project_snippets(
    index: &ProjectCompletionIndex,
    request: &ProjectCompletionContextRequest,
) -> Vec<ProjectCompletionSnippet> {
    let terms = completion_query_terms(request);
    if terms.is_empty() {
        return Vec::new();
    }
    let active_directory = request
        .active_file
        .as_deref()
        .and_then(|path| path.rsplit_once('/').map(|(directory, _)| directory));
    let mut ranked = index
        .files
        .iter()
        .filter(|file| request.active_file.as_deref() != Some(file.relative_path.as_str()))
        .filter_map(|file| {
            let lower_content = file.content.to_ascii_lowercase();
            let lower_path = file.relative_path.to_ascii_lowercase();
            let term_score = terms
                .iter()
                .map(|term| {
                    let term = term.to_ascii_lowercase();
                    lower_content.matches(&term).count().min(8) * 3
                        + lower_path.matches(&term).count() * 5
                })
                .sum::<usize>();
            let directory_score = active_directory
                .filter(|directory| file.relative_path.starts_with(directory))
                .map_or(0, |_| 2);
            let score = term_score + directory_score;
            (score > 0).then_some((score, file))
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|(left_score, left), (right_score, right)| {
        right_score
            .cmp(left_score)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    let mut remaining = COMPLETION_CONTEXT_SIZE_LIMIT;
    ranked
        .into_iter()
        .take(3)
        .filter_map(|(_, file)| {
            if remaining == 0 {
                return None;
            }
            let lines = file.content.lines().collect::<Vec<_>>();
            let best_line = lines
                .iter()
                .enumerate()
                .max_by_key(|(_, line)| {
                    let line = line.to_ascii_lowercase();
                    terms
                        .iter()
                        .filter(|term| line.contains(&term.to_ascii_lowercase()))
                        .count()
                })
                .map_or(0, |(index, _)| index);
            let start = best_line.saturating_sub(20);
            let end = (best_line + 21).min(lines.len());
            let content = truncate_utf8_bytes(&lines[start..end].join("\n"), remaining);
            remaining = remaining.saturating_sub(content.len());
            Some(ProjectCompletionSnippet {
                relative_path: file.relative_path.clone(),
                content,
            })
        })
        .collect()
}

fn validate_relative_path(path: &str, allow_empty: bool) -> Result<ValidatedRelativePath> {
    if path.contains('\0') {
        bail!("project relative path contains a NUL byte");
    }

    let input = Path::new(path);
    if input.is_absolute() {
        bail!("project path must be relative");
    }

    let mut normalized = PathBuf::new();
    for component in input.components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir => bail!("parent path components are not allowed"),
            Component::RootDir => bail!("rooted project paths are not allowed"),
            Component::Prefix(_) => bail!("prefixed project paths are not allowed"),
        }
    }

    if normalized.as_os_str().is_empty() && !allow_empty {
        bail!("project relative path cannot be empty");
    }

    let wire_path = normalized
        .components()
        .map(|component| match component {
            Component::Normal(value) => os_str_to_utf8(value, "path component"),
            _ => unreachable!("relative path was normalized above"),
        })
        .collect::<Result<Vec<_>>>()?
        .join("/");

    Ok(ValidatedRelativePath {
        path: normalized,
        wire_path,
    })
}

fn os_str_to_utf8<'a>(value: &'a OsStr, label: &str) -> Result<&'a str> {
    value
        .to_str()
        .ok_or_else(|| anyhow!("{label} is not valid UTF-8"))
}

fn append_wire_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn lock_project_file_mutations() -> Result<MutexGuard<'static, ()>> {
    PROJECT_FILE_MUTATION_LOCK
        .lock()
        .map_err(|_| anyhow!("project file mutation lock is poisoned"))
}

fn content_revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn project_file_preview_media_type(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "svg" => Some("image/svg+xml"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

fn system_time_millis(time: std::time::SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn prepare_temp_file(
    parent: &Path,
    bytes: &[u8],
    permissions: Option<Permissions>,
) -> Result<NamedTempFile> {
    let mut temp = NamedTempFile::new_in(parent)
        .with_context(|| format!("failed to create temporary file in {}", parent.display()))?;
    temp.write_all(bytes)
        .context("failed to write temporary file")?;
    temp.flush().context("failed to flush temporary file")?;
    if let Some(permissions) = permissions {
        fs::set_permissions(temp.path(), permissions)
            .context("failed to preserve project file permissions")?;
    }
    temp.as_file()
        .sync_all()
        .context("failed to sync temporary file")?;
    Ok(temp)
}

fn persist_new_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .context("project file does not have a parent directory")?;
    let temp = prepare_temp_file(parent, bytes, None)?;
    temp.persist_noclobber(path)
        .map_err(|error| anyhow!("{}", error.error))?;
    Ok(())
}

fn persist_replacement(temp: NamedTempFile, path: &Path) -> Result<()> {
    temp.persist(path)
        .map_err(|error| anyhow!("{}", error.error))?;
    Ok(())
}

#[cfg(not(windows))]
fn is_link_or_reparse(metadata: &Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(windows)]
fn is_link_or_reparse(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn remove_link_or_reparse(path: &Path, _metadata: &Metadata) -> std::io::Result<()> {
    fs::remove_file(path)
}

#[cfg(windows)]
fn remove_link_or_reparse(path: &Path, metadata: &Metadata) -> std::io::Result<()> {
    let target_is_directory = fs::metadata(path)
        .map(|target| target.is_dir())
        .unwrap_or_else(|_| metadata.is_dir());
    if target_is_directory {
        fs::remove_dir(path)
    } else {
        fs::remove_file(path)
    }
}

fn remove_tree_without_following_links(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if is_link_or_reparse(&metadata) {
        remove_link_or_reparse(path, &metadata)?;
        return Ok(());
    }
    if !metadata.is_dir() {
        fs::remove_file(path)?;
        return Ok(());
    }

    for entry in fs::read_dir(path)? {
        remove_tree_without_following_links(&entry?.path())?;
    }
    fs::remove_dir(path)?;
    Ok(())
}

async fn project_root(
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

fn assert_expected_project_root(
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

async fn run_git_bounded(
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

fn git_output_text(output: &GitCommandOutput) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn parse_git_status(output: &[u8]) -> Vec<ProjectGitFileChange> {
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

fn diff_line_counts(patch: &str) -> (usize, usize) {
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

fn untracked_file_patch(root: &ProjectRoot, relative_path: &str) -> Result<(String, bool, bool)> {
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

async fn git_path_is_untracked(root: &ProjectRoot, relative_path: &str) -> Result<bool> {
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

fn working_tree_content_revision(
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

async fn staged_content_revision(
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

async fn git_current_side_revision(
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use tempfile::TempDir;

    #[test]
    fn parses_git_porcelain_status_without_losing_rename_scope() {
        let changes = parse_git_status(
            b" M src/query.ts\0A  src/new.ts\0?? notes.txt\0R  src/renamed.ts\0src/old.ts\0 M ../outside.sql\0",
        );

        assert_eq!(changes.len(), 4);
        assert!(changes.iter().any(|change| {
            change.relative_path == "src/query.ts" && change.unstaged && !change.staged
        }));
        assert!(changes.iter().any(|change| {
            change.relative_path == "src/new.ts" && change.status == "added" && change.staged
        }));
        assert!(changes.iter().any(|change| change.untracked));
        let renamed = changes
            .iter()
            .find(|change| change.status == "renamed")
            .unwrap();
        assert_eq!(renamed.relative_path, "src/renamed.ts");
        assert_eq!(renamed.previous_path.as_deref(), Some("src/old.ts"));
        assert!(changes
            .iter()
            .all(|change| !change.relative_path.contains("..")));
    }

    #[test]
    fn counts_only_real_added_and_removed_diff_lines() {
        let patch = "--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n-old\n+new\n same";
        assert_eq!(diff_line_counts(patch), (1, 1));
    }

    #[test]
    fn builds_git_diff_arguments_for_each_supported_scope() {
        assert_eq!(
            ProjectGitDiffScope::All.arguments("queries/report.sql"),
            vec![
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "HEAD",
                "--",
                "queries/report.sql",
            ]
        );
        assert_eq!(
            ProjectGitDiffScope::Staged.arguments("queries/report.sql"),
            vec![
                "diff",
                "--cached",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--",
                "queries/report.sql",
            ]
        );
        assert_eq!(
            ProjectGitDiffScope::Working.arguments("queries/report.sql"),
            vec![
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--",
                "queries/report.sql",
            ]
        );
        assert!(ProjectGitDiffScope::parse(Some("unknown")).is_none());
    }

    #[test]
    fn builds_a_bounded_untracked_text_diff_without_leaving_the_project() {
        let temp = TempDir::new().unwrap();
        fs::create_dir(temp.path().join("queries")).unwrap();
        fs::write(temp.path().join("queries/new.sql"), "select 1;\n").unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();

        let (patch, binary, truncated) = untracked_file_patch(&root, "queries/new.sql").unwrap();
        assert!(!binary);
        assert!(!truncated);
        assert!(patch.contains("--- /dev/null"));
        assert!(patch.contains("+++ b/queries/new.sql"));
        assert!(patch.contains("+select 1;"));
        assert!(untracked_file_patch(&root, "../outside.sql").is_err());
    }

    #[tokio::test]
    async fn identifies_only_untracked_paths_for_synthetic_diff_fallback() {
        let temp = TempDir::new().unwrap();
        let initialized = std::process::Command::new("git")
            .args(["init", "--quiet"])
            .current_dir(temp.path())
            .status()
            .unwrap();
        assert!(initialized.success());
        fs::write(temp.path().join("new.sql"), "select 1;\n").unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();

        assert!(git_path_is_untracked(&root, "new.sql").await.unwrap());

        let staged = std::process::Command::new("git")
            .args(["add", "--", "new.sql"])
            .current_dir(temp.path())
            .status()
            .unwrap();
        assert!(staged.success());
        assert!(!git_path_is_untracked(&root, "new.sql").await.unwrap());
    }

    #[tokio::test]
    async fn resolves_scope_content_revisions_without_confusing_index_and_worktree() {
        let temp = TempDir::new().unwrap();
        let initialized = std::process::Command::new("git")
            .args(["init", "--quiet"])
            .current_dir(temp.path())
            .status()
            .unwrap();
        assert!(initialized.success());
        let path = temp.path().join("report.sql");
        fs::write(&path, "select 'staged';\n").unwrap();
        let staged = std::process::Command::new("git")
            .args(["add", "--", "report.sql"])
            .current_dir(temp.path())
            .status()
            .unwrap();
        assert!(staged.success());
        fs::write(&path, "select 'working';\n").unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();

        let (index_revision, index_status) =
            git_current_side_revision(&root, "report.sql", ProjectGitDiffScope::Staged)
                .await
                .unwrap();
        let (working_revision, working_status) =
            git_current_side_revision(&root, "report.sql", ProjectGitDiffScope::Working)
                .await
                .unwrap();
        let (all_revision, all_status) =
            git_current_side_revision(&root, "report.sql", ProjectGitDiffScope::All)
                .await
                .unwrap();
        let expected_index_revision = content_revision(b"select 'staged';\n");
        let expected_working_revision = content_revision(b"select 'working';\n");

        assert_eq!(index_status, ProjectGitRevisionStatus::Available);
        assert_eq!(
            index_revision.as_deref(),
            Some(expected_index_revision.as_str())
        );
        assert_eq!(working_status, ProjectGitRevisionStatus::Available);
        assert_eq!(
            working_revision.as_deref(),
            Some(expected_working_revision.as_str())
        );
        assert_eq!(all_status, ProjectGitRevisionStatus::Available);
        assert_eq!(all_revision, working_revision);

        fs::remove_file(path).unwrap();
        let (missing_revision, missing_status) =
            git_current_side_revision(&root, "report.sql", ProjectGitDiffScope::Working)
                .await
                .unwrap();
        assert_eq!(missing_revision, None);
        assert_eq!(missing_status, ProjectGitRevisionStatus::Missing);

        fs::write(
            temp.path().join("large.sql"),
            vec![b'x'; AGENT_PROJECT_FILE_LIMIT as usize + 1],
        )
        .unwrap();
        let (large_revision, large_status) =
            git_current_side_revision(&root, "large.sql", ProjectGitDiffScope::Working)
                .await
                .unwrap();
        assert_eq!(large_revision, None);
        assert_eq!(large_status, ProjectGitRevisionStatus::Unavailable);
    }

    #[test]
    fn rejects_absolute_and_parent_paths() {
        let temp = TempDir::new().unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();
        let absolute = temp.path().join("absolute.sql");

        for invalid in [
            "../outside.sql".to_string(),
            "nested/../../outside.sql".to_string(),
            absolute.to_string_lossy().into_owned(),
        ] {
            assert!(root.read_file(&invalid).is_err(), "accepted {invalid:?}");
        }

        #[cfg(windows)]
        for invalid in [r"C:drive-relative.sql", r"\\server\share\file.sql"] {
            assert!(root.read_file(invalid).is_err(), "accepted {invalid:?}");
        }
    }

    #[test]
    fn rejects_operations_bound_to_a_different_project_root() {
        let configured = TempDir::new().unwrap();
        let stale = TempDir::new().unwrap();
        let root = ProjectRoot::new(configured.path()).unwrap();

        assert!(assert_expected_project_root(&root, configured.path().to_str()).is_ok());
        let error = assert_expected_project_root(&root, stale.path().to_str()).unwrap_err();
        assert!(error.starts_with(PROJECT_ROOT_CHANGED_PREFIX), "{error}");
    }

    #[test]
    fn project_completion_context_ranks_database_files_and_excludes_secrets() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("queries")).unwrap();
        fs::create_dir_all(temp.path().join("node_modules/pkg")).unwrap();
        fs::write(
            temp.path().join("queries/users.sql"),
            "SELECT id, email FROM users WHERE active = true;",
        )
        .unwrap();
        fs::write(
            temp.path().join("queries/orders.sql"),
            "SELECT id FROM orders;",
        )
        .unwrap();
        fs::write(temp.path().join(".env.sql"), "SELECT secret FROM users;").unwrap();
        fs::write(
            temp.path().join("node_modules/pkg/users.sql"),
            "SELECT password FROM users;",
        )
        .unwrap();

        let root = ProjectRoot::new(temp.path()).unwrap();
        let index = completion_index(&root).unwrap();
        assert_eq!(index.files.len(), 2);
        let snippets = ranked_project_snippets(
            &index,
            &ProjectCompletionContextRequest {
                project_id: "project".to_string(),
                expected_root: None,
                active_file: Some("queries/current.sql".to_string()),
                query: "SELECT users.email".to_string(),
                referenced_objects: vec!["users".to_string()],
            },
        );
        assert_eq!(snippets[0].relative_path, "queries/users.sql");
        assert!(snippets[0].content.contains("email"));
        assert!(snippets
            .iter()
            .all(|snippet| !snippet.content.contains("password")));
    }

    #[test]
    fn project_lsp_documents_only_include_bounded_saved_sql_files() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("queries")).unwrap();
        fs::create_dir_all(temp.path().join("node_modules/pkg")).unwrap();
        fs::write(temp.path().join("queries/report.sql"), "SELECT 1;").unwrap();
        fs::write(temp.path().join("queries/seed.mysql"), "SELECT 2;").unwrap();
        fs::write(
            temp.path().join("queries/config.json"),
            "{\"token\": \"no\"}",
        )
        .unwrap();
        fs::write(temp.path().join(".env.sql"), "SELECT secret;").unwrap();
        fs::write(
            temp.path().join("node_modules/pkg/dependency.sql"),
            "SELECT 3;",
        )
        .unwrap();

        let root = ProjectRoot::new(temp.path()).unwrap();
        let documents = project_lsp_documents(&root).unwrap();

        assert_eq!(documents.len(), 2);
        assert_eq!(
            documents
                .iter()
                .map(|document| document.relative_path.as_str())
                .collect::<HashSet<_>>(),
            HashSet::from(["queries/report.sql", "queries/seed.mysql"]),
        );
        assert!(documents
            .iter()
            .all(|document| !document.content.contains("secret")));
    }

    #[test]
    fn project_completion_index_is_invalidated_after_file_mutation() {
        let temp = TempDir::new().unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();
        assert!(completion_index(&root).unwrap().files.is_empty());
        root.create_file("users.sql", "SELECT id FROM users;")
            .unwrap();
        invalidate_completion_index(&root);
        assert_eq!(completion_index(&root).unwrap().files.len(), 1);
    }

    #[test]
    fn project_file_crud_preserves_revision_contract() {
        let temp = TempDir::new().unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();

        let directory = root.create_directory("queries").unwrap();
        assert_eq!(directory.kind, ProjectEntryKind::Directory);

        let created = root
            .create_file("queries/report.sql", "select 1;\n")
            .unwrap();
        assert_eq!(created.previous_revision, None);
        assert_eq!(created.introduced_lines, vec![1]);
        assert!(!created.line_evidence_truncated);
        assert!(root
            .create_file("queries/report.sql", "select 2;\n")
            .is_err());

        let read = root.read_file("queries/report.sql").unwrap();
        assert_eq!(read.content, "select 1;\n");
        assert_eq!(read.revision, created.revision);

        let entries = root.list_entries(Some("queries")).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].relative_path, "queries/report.sql");
        assert_eq!(entries[0].kind, ProjectEntryKind::File);

        let written = root
            .write_file("queries/report.sql", "select 2;\n", &read.revision)
            .unwrap();
        assert_ne!(written.revision, read.revision);
        assert_eq!(
            written.previous_revision.as_deref(),
            Some(read.revision.as_str())
        );
        assert_eq!(written.introduced_lines, vec![1]);
        assert_eq!(
            fs::read_to_string(temp.path().join("queries/report.sql")).unwrap(),
            "select 2;\n"
        );

        let renamed = root
            .rename_entry("queries/report.sql", "queries/final.sql")
            .unwrap();
        assert_eq!(renamed.relative_path, "queries/final.sql");
        assert!(!temp.path().join("queries/report.sql").exists());

        root.delete_entry("queries/final.sql", false).unwrap();
        root.delete_entry("queries", false).unwrap();
        assert!(!temp.path().join("queries").exists());
    }

    #[test]
    fn applied_file_changes_write_immediately_and_can_be_safely_undone() {
        let temp = TempDir::new().unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();
        fs::write(temp.path().join("existing.sql"), "select 1;\n").unwrap();
        let existing = root.read_file("existing.sql").unwrap();

        let updated = root
            .prepare_file_change(
                "existing.sql",
                "select 1;\nselect 2;\n",
                Some(&existing.revision),
                false,
            )
            .unwrap();
        assert_eq!(
            updated.base_revision.as_deref(),
            Some(existing.revision.as_str())
        );
        assert_eq!(updated.additions, 1);
        assert_eq!(updated.deletions, 0);
        let updated_write = root
            .write_file(
                "existing.sql",
                &updated.proposed_content,
                updated.base_revision.as_deref().unwrap(),
            )
            .unwrap();
        assert_eq!(
            fs::read_to_string(temp.path().join("existing.sql")).unwrap(),
            "select 1;\nselect 2;\n"
        );

        let created = root
            .prepare_file_change("sql/generated/new.sql", "select 3;\n", None, true)
            .unwrap();
        assert_eq!(created.base_revision, None);
        let created_write = root
            .create_file("sql/generated/new.sql", &created.proposed_content)
            .unwrap();
        assert_eq!(
            fs::read_to_string(temp.path().join("sql/generated/new.sql")).unwrap(),
            "select 3;\n"
        );

        root.write_file(
            "existing.sql",
            &updated.original_content,
            &updated_write.revision,
        )
        .unwrap();
        root.delete_file_if_revision("sql/generated/new.sql", &created_write.revision)
            .unwrap();
        assert_eq!(
            fs::read_to_string(temp.path().join("existing.sql")).unwrap(),
            "select 1;\n"
        );
        assert!(!temp.path().join("sql/generated/new.sql").exists());

        let changed = root.create_file("changed.sql", "first\n").unwrap();
        fs::write(temp.path().join("changed.sql"), "external\n").unwrap();
        let conflict = root
            .delete_file_if_revision("changed.sql", &changed.revision)
            .unwrap_err()
            .to_string();
        assert!(conflict.starts_with(REVISION_CONFLICT_PREFIX), "{conflict}");
        assert!(temp.path().join("changed.sql").exists());
    }

    #[test]
    fn file_change_counts_match_insertions_deletions_and_replacements() {
        assert_eq!(
            project_file_line_change_counts("a\nb\nc", "a\nx\nc\nd"),
            (2, 1)
        );
        assert_eq!(project_file_line_change_counts("a\nb", "a\nb"), (0, 0));
        assert_eq!(project_file_line_change_counts("", "first\nsecond"), (2, 0));
    }

    #[test]
    fn create_file_creates_missing_parent_directories_inside_project_root() {
        let temp = TempDir::new().unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();

        let created = root
            .create_file(
                "sql/generated/ai_model_select.sql",
                "SELECT model_name FROM ai_models;\n",
            )
            .unwrap();

        assert_eq!(created.relative_path, "sql/generated/ai_model_select.sql");
        assert_eq!(created.previous_revision, None);
        assert_eq!(
            fs::read_to_string(temp.path().join("sql/generated/ai_model_select.sql")).unwrap(),
            "SELECT model_name FROM ai_models;\n"
        );
        assert!(temp.path().join("sql/generated").is_dir());
    }

    #[test]
    fn create_file_rejects_a_non_directory_parent_component() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("sql"), "not a directory").unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();

        let error = root
            .create_file("sql/ai_model_select.sql", "SELECT 1;\n")
            .unwrap_err()
            .to_string();

        assert!(error.contains("parent is not a directory"), "{error}");
        assert!(!temp.path().join("ai_model_select.sql").exists());
    }

    #[test]
    fn line_evidence_only_claims_content_absent_from_the_pre_write_file() {
        let (lines, truncated) = project_file_line_evidence(
            "SELECT id\nFROM users\nORDER BY id\n",
            "SELECT id\nFROM active_users\nORDER BY id\nLIMIT 20\n",
        );

        assert_eq!(lines, vec![2, 4]);
        assert!(!truncated);

        let repeated = project_file_line_evidence("same\n", "same\nsame\nnew\n");
        assert_eq!(repeated, (vec![3], false));

        let oversized = (0..=PROJECT_FILE_LINE_EVIDENCE_LIMIT)
            .map(|index| format!("line-{index}"))
            .collect::<Vec<_>>()
            .join("\n");
        let (bounded, truncated) = project_file_line_evidence("", &oversized);
        assert_eq!(bounded.len(), PROJECT_FILE_LINE_EVIDENCE_LIMIT);
        assert!(truncated);
    }

    #[test]
    fn project_file_preview_reads_supported_images_without_utf8_decoding() {
        let temp = TempDir::new().unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();
        let bytes = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0xff];
        fs::write(temp.path().join("preview.png"), bytes).unwrap();

        let preview = root.read_file_preview("preview.png").unwrap();
        assert_eq!(preview.relative_path, "preview.png");
        assert_eq!(preview.media_type, "image/png");
        assert_eq!(preview.data_base64, BASE64_STANDARD.encode(bytes));
        assert_eq!(preview.revision, content_revision(&bytes));
        assert_eq!(preview.size, bytes.len() as u64);
        assert!(root.read_file("preview.png").is_err());
    }

    #[test]
    fn project_file_preview_rejects_unsupported_binary_files() {
        let temp = TempDir::new().unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();
        fs::write(temp.path().join("archive.bin"), [0xff, 0x00]).unwrap();

        let error = root
            .read_file_preview("archive.bin")
            .unwrap_err()
            .to_string();
        assert!(error.contains("preview is not supported"), "{error}");
    }

    #[test]
    fn detects_revision_conflicts() {
        let temp = TempDir::new().unwrap();
        let root = ProjectRoot::new(temp.path()).unwrap();
        let created = root.create_file("query.sql", "select 1").unwrap();

        fs::write(temp.path().join("query.sql"), "select 2").unwrap();
        let error = root
            .write_file("query.sql", "select 3", &created.revision)
            .unwrap_err()
            .to_string();
        assert!(error.starts_with(REVISION_CONFLICT_PREFIX), "{error}");
        assert_eq!(
            fs::read_to_string(temp.path().join("query.sql")).unwrap(),
            "select 2"
        );
    }

    #[test]
    fn concurrent_writes_with_the_same_revision_allow_only_one_winner() {
        let temp = TempDir::new().unwrap();
        let root = Arc::new(ProjectRoot::new(temp.path()).unwrap());
        let created = root.create_file("query.sql", "select 1").unwrap();
        let barrier = Arc::new(Barrier::new(3));

        let handles = ["select 2", "select 3"].map(|content| {
            let root = Arc::clone(&root);
            let barrier = Arc::clone(&barrier);
            let revision = created.revision.clone();
            std::thread::spawn(move || {
                barrier.wait();
                root.write_file("query.sql", content, &revision)
            })
        });
        barrier.wait();

        let results = handles.map(|handle| handle.join().unwrap());
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let conflict = results
            .into_iter()
            .find_map(Result::err)
            .unwrap()
            .to_string();
        assert!(conflict.starts_with(REVISION_CONFLICT_PREFIX), "{conflict}");
    }

    #[test]
    fn recursive_delete_does_not_follow_links() {
        let temp = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::create_dir(temp.path().join("queries")).unwrap();
        fs::write(outside.path().join("keep.sql"), "select 1").unwrap();

        let link = temp.path().join("queries/external");
        if !create_directory_symlink(outside.path(), &link) {
            return;
        }

        let root = ProjectRoot::new(temp.path()).unwrap();
        root.delete_entry("queries", true).unwrap();
        assert!(outside.path().join("keep.sql").exists());
    }

    #[test]
    fn rejects_links_that_resolve_outside_root() {
        let temp = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("outside.sql"), "select secret").unwrap();
        let link = temp.path().join("outside.sql");
        if !create_file_symlink(&outside.path().join("outside.sql"), &link) {
            return;
        }

        let root = ProjectRoot::new(temp.path()).unwrap();
        let error = root.read_file("outside.sql").unwrap_err().to_string();
        assert!(error.contains("outside the configured root"), "{error}");

        let directory_link = temp.path().join("external-directory");
        if !create_directory_symlink(outside.path(), &directory_link) {
            return;
        }
        let error = root
            .create_file("external-directory/new.sql", "select 1")
            .unwrap_err()
            .to_string();
        assert!(error.contains("outside the configured root"), "{error}");
        assert!(!outside.path().join("new.sql").exists());
    }

    #[cfg(unix)]
    fn create_file_symlink(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    #[cfg(windows)]
    fn create_file_symlink(target: &Path, link: &Path) -> bool {
        std::os::windows::fs::symlink_file(target, link).is_ok()
    }

    #[cfg(unix)]
    fn create_directory_symlink(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    #[cfg(windows)]
    fn create_directory_symlink(target: &Path, link: &Path) -> bool {
        std::os::windows::fs::symlink_dir(target, link).is_ok()
    }
}
