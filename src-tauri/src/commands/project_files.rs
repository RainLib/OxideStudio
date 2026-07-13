use crate::core::store::{MetaStore, Project};
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs::{self, Metadata, Permissions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::UNIX_EPOCH;
use tauri::State;
use tempfile::NamedTempFile;

const REVISION_CONFLICT_PREFIX: &str = "REVISION_CONFLICT:";
const PROJECT_ROOT_CHANGED_PREFIX: &str = "PROJECT_ROOT_CHANGED:";
static PROJECT_FILE_MUTATION_LOCK: Mutex<()> = Mutex::new(());
static PROJECT_COMPLETION_INDEXES: OnceLock<Mutex<HashMap<PathBuf, ProjectCompletionIndex>>> =
    OnceLock::new();
const COMPLETION_FILE_LIMIT: usize = 5_000;
const COMPLETION_FILE_SIZE_LIMIT: u64 = 256 * 1024;
const COMPLETION_INDEX_SIZE_LIMIT: usize = 20 * 1024 * 1024;
const COMPLETION_CONTEXT_SIZE_LIMIT: usize = 8 * 1024;

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
pub struct ProjectFileWrite {
    pub relative_path: String,
    pub revision: String,
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

    fn create_file(&self, relative_path: &str, content: &str) -> Result<ProjectFileWrite> {
        let _mutation_guard = lock_project_file_mutations()?;
        let relative = validate_relative_path(relative_path, false)?;
        let target = self.resolve_new_target(&relative)?;
        let bytes = content.as_bytes();
        persist_new_file(&target, bytes)
            .with_context(|| format!("failed to create project file: {}", relative.wire_path))?;

        Ok(ProjectFileWrite {
            relative_path: relative.wire_path,
            revision: content_revision(bytes),
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

        Ok(ProjectFileWrite {
            relative_path: relative.wire_path,
            revision: content_revision(bytes),
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
        match fs::symlink_metadata(&lexical_target) {
            Ok(_) => bail!("project path already exists: {}", relative.wire_path),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("failed to inspect project path: {}", relative.wire_path)
                })
            }
        }

        let parent = lexical_target
            .parent()
            .context("project path does not have a parent directory")?;
        let resolved_parent = fs::canonicalize(parent).with_context(|| {
            format!(
                "failed to resolve parent directory for: {}",
                relative.wire_path
            )
        })?;
        self.ensure_inside_root(&resolved_parent)?;
        if !fs::metadata(&resolved_parent)?.is_dir() {
            bail!(
                "project path parent is not a directory: {}",
                relative.wire_path
            );
        }

        let name = relative
            .path
            .file_name()
            .context("project path does not have a file name")?;
        Ok(resolved_parent.join(name))
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
) -> Result<Project, String> {
    let canonical_root = match root_path {
        Some(root_path) => {
            if root_path.is_empty() {
                return Err("project root cannot be an empty string".to_string());
            }
            let root = ProjectRoot::new(root_path).map_err(|error| error.to_string())?;
            Some(
                root.path
                    .to_str()
                    .ok_or_else(|| "project root is not valid UTF-8".to_string())?
                    .to_string(),
            )
        }
        None => None,
    };

    let project = meta_store
        .set_project_root(&project_id, canonical_root.as_deref())
        .await
        .map_err(|error| error.to_string())?;
    if let Ok(mut indexes) = completion_indexes().lock() {
        indexes.clear();
    }
    Ok(project)
}

#[tauri::command]
pub async fn get_project_completion_context(
    meta_store: State<'_, MetaStore>,
    request: ProjectCompletionContextRequest,
) -> Result<Vec<ProjectCompletionSnippet>, String> {
    let root = project_root(
        &meta_store,
        &request.project_id,
        request.expected_root.as_deref(),
    )
    .await?;
    let index = completion_index(&root).map_err(|error| error.to_string())?;
    Ok(ranked_project_snippets(&index, &request))
}

#[tauri::command]
pub async fn list_project_entries(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: Option<String>,
    expected_root: Option<String>,
) -> Result<Vec<ProjectEntry>, String> {
    project_root(&meta_store, &project_id, expected_root.as_deref())
        .await?
        .list_entries(relative_path.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn read_project_file(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    expected_root: Option<String>,
) -> Result<ProjectFileRead, String> {
    project_root(&meta_store, &project_id, expected_root.as_deref())
        .await?
        .read_file(&relative_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_project_file(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    content: Option<String>,
    expected_root: Option<String>,
) -> Result<ProjectFileWrite, String> {
    let root = project_root(&meta_store, &project_id, expected_root.as_deref()).await?;
    let result = root
        .create_file(&relative_path, content.as_deref().unwrap_or_default())
        .map_err(|error| error.to_string())?;
    invalidate_completion_index(&root);
    Ok(result)
}

#[tauri::command]
pub async fn create_project_directory(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    expected_root: Option<String>,
) -> Result<ProjectEntry, String> {
    project_root(&meta_store, &project_id, expected_root.as_deref())
        .await?
        .create_directory(&relative_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn write_project_file(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    relative_path: String,
    content: String,
    expected_revision: String,
    expected_root: Option<String>,
) -> Result<ProjectFileWrite, String> {
    let root = project_root(&meta_store, &project_id, expected_root.as_deref()).await?;
    let result = root
        .write_file(&relative_path, &content, &expected_revision)
        .map_err(|error| error.to_string())?;
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
) -> Result<ProjectEntry, String> {
    let root = project_root(&meta_store, &project_id, expected_root.as_deref()).await?;
    let result = root
        .rename_entry(&relative_path, &new_relative_path)
        .map_err(|error| error.to_string())?;
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
) -> Result<(), String> {
    let root = project_root(&meta_store, &project_id, expected_root.as_deref()).await?;
    root.delete_entry(&relative_path, recursive.unwrap_or(false))
        .map_err(|error| error.to_string())?;
    invalidate_completion_index(&root);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use tempfile::TempDir;

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
