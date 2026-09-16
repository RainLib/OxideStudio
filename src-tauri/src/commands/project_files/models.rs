use crate::core::protocol::CommandError;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Duration,
};

pub(super) const REVISION_CONFLICT_PREFIX: &str = "REVISION_CONFLICT:";
pub(super) const PROJECT_ROOT_CHANGED_PREFIX: &str = "PROJECT_ROOT_CHANGED:";
pub(super) static PROJECT_FILE_MUTATION_LOCK: Mutex<()> = Mutex::new(());
pub(super) static PROJECT_COMPLETION_INDEXES: OnceLock<
    Mutex<HashMap<PathBuf, ProjectCompletionIndex>>,
> = OnceLock::new();
pub(super) const COMPLETION_FILE_LIMIT: usize = 5_000;
pub(super) const COMPLETION_FILE_SIZE_LIMIT: u64 = 256 * 1024;
pub(super) const COMPLETION_INDEX_SIZE_LIMIT: usize = 20 * 1024 * 1024;
pub(super) const COMPLETION_CONTEXT_SIZE_LIMIT: usize = 8 * 1024;
// Project SQL files are opened as bounded, read-only virtual documents in the
// local language service. Keep this smaller than the generic AI completion
// index: an LSP receives full document text rather than ranked excerpts.
pub(super) const LSP_PROJECT_DOCUMENT_LIMIT: usize = 128;
pub(super) const LSP_PROJECT_DOCUMENT_SIZE_LIMIT: usize = 128 * 1024;
pub(super) const LSP_PROJECT_DOCUMENT_TOTAL_SIZE_LIMIT: usize = 5 * 1024 * 1024;
pub(super) const PROJECT_FILE_PREVIEW_SIZE_LIMIT: u64 = 25 * 1024 * 1024;
pub(super) const PROJECT_GIT_STATUS_SIZE_LIMIT: usize = 4 * 1024 * 1024;
pub(super) const PROJECT_GIT_DIFF_SIZE_LIMIT: usize = 1024 * 1024;
pub(super) const PROJECT_GIT_UNTRACKED_PREVIEW_LIMIT: u64 = 512 * 1024;
pub(super) const PROJECT_GIT_FILE_LIMIT: usize = 500;
pub(super) const PROJECT_GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(8);
pub(super) const AGENT_PROJECT_FILE_LIMIT: u64 = 256 * 1024;
pub(super) const AGENT_PROJECT_ENTRY_LIMIT: usize = 500;
pub(super) const PROJECT_FILE_LINE_EVIDENCE_LIMIT: usize = 2_048;

pub(super) fn project_command_error(
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

pub(super) fn project_file_line_evidence(previous: &str, next: &str) -> (Vec<u32>, bool) {
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

pub(super) fn project_file_line_change_counts(previous: &str, next: &str) -> (usize, usize) {
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
pub(super) enum ProjectGitDiffScope {
    All,
    Staged,
    Working,
}

impl ProjectGitDiffScope {
    pub(super) fn parse(value: Option<&str>) -> Option<Self> {
        match value.unwrap_or("all") {
            "all" => Some(Self::All),
            "staged" => Some(Self::Staged),
            "working" => Some(Self::Working),
            _ => None,
        }
    }

    pub(super) fn arguments(self, relative_path: &str) -> Vec<&str> {
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

    pub(super) fn includes_untracked(self) -> bool {
        matches!(self, Self::All | Self::Working)
    }
}

pub(super) struct GitCommandOutput {
    pub(super) success: bool,
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: Vec<u8>,
    pub(super) truncated: bool,
}

#[derive(Debug, Clone)]
pub(super) struct IndexedProjectFile {
    pub(super) relative_path: String,
    pub(super) content: String,
}

#[derive(Debug, Clone, Default)]
pub(super) struct ProjectCompletionIndex {
    pub(super) files: Vec<IndexedProjectFile>,
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
pub(super) struct ValidatedRelativePath {
    pub(super) path: PathBuf,
    pub(super) wire_path: String,
}

#[derive(Debug, Clone)]
pub(super) struct ProjectRoot {
    pub(super) path: PathBuf,
}
