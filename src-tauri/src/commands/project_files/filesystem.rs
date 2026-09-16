use super::models::{
    project_file_line_change_counts, project_file_line_evidence, ProjectEntry, ProjectEntryKind,
    ProjectFilePreview, ProjectFileProposal, ProjectFileRead, ProjectFileWrite, ProjectRoot,
    ValidatedRelativePath, PROJECT_FILE_MUTATION_LOCK, PROJECT_FILE_PREVIEW_SIZE_LIMIT,
    REVISION_CONFLICT_PREFIX,
};
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsStr,
    fs::{self, Metadata, Permissions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::MutexGuard,
    time::UNIX_EPOCH,
};
use tempfile::NamedTempFile;

impl ProjectRoot {
    pub(super) fn new(path: impl AsRef<Path>) -> Result<Self> {
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

    pub(super) fn list_entries(&self, relative_path: Option<&str>) -> Result<Vec<ProjectEntry>> {
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

    pub(super) fn read_file(&self, relative_path: &str) -> Result<ProjectFileRead> {
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

    pub(super) fn read_file_preview(&self, relative_path: &str) -> Result<ProjectFilePreview> {
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

    pub(super) fn create_file(
        &self,
        relative_path: &str,
        content: &str,
    ) -> Result<ProjectFileWrite> {
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

    pub(super) fn prepare_file_change(
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

    pub(super) fn create_directory(&self, relative_path: &str) -> Result<ProjectEntry> {
        let _mutation_guard = lock_project_file_mutations()?;
        let relative = validate_relative_path(relative_path, false)?;
        let target = self.resolve_new_target(&relative)?;
        fs::create_dir(&target).with_context(|| {
            format!("failed to create project directory: {}", relative.wire_path)
        })?;
        self.describe_entry(&target, relative.wire_path)
    }

    pub(super) fn write_file(
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

    pub(super) fn rename_entry(
        &self,
        relative_path: &str,
        new_relative_path: &str,
    ) -> Result<ProjectEntry> {
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

    pub(super) fn delete_entry(&self, relative_path: &str, recursive: bool) -> Result<()> {
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

    pub(super) fn delete_file_if_revision(
        &self,
        relative_path: &str,
        expected_revision: &str,
    ) -> Result<()> {
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

    pub(super) fn assert_revision(
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

    pub(super) fn resolve_existing(&self, relative: &ValidatedRelativePath) -> Result<PathBuf> {
        let lexical_path = self.path.join(&relative.path);
        let resolved = fs::canonicalize(&lexical_path)
            .with_context(|| format!("failed to resolve project path: {}", relative.wire_path))?;
        self.ensure_inside_root(&resolved)?;
        Ok(resolved)
    }

    pub(super) fn resolve_new_target(&self, relative: &ValidatedRelativePath) -> Result<PathBuf> {
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

    pub(super) fn validate_new_target_without_mutation(
        &self,
        relative: &ValidatedRelativePath,
    ) -> Result<()> {
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

    pub(super) fn ensure_inside_root(&self, path: &Path) -> Result<()> {
        if !path.starts_with(&self.path) {
            bail!(
                "project path resolves outside the configured root: {}",
                path.display()
            );
        }
        Ok(())
    }

    pub(super) fn describe_entry(
        &self,
        lexical_path: &Path,
        relative_path: String,
    ) -> Result<ProjectEntry> {
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

pub(super) fn validate_relative_path(
    path: &str,
    allow_empty: bool,
) -> Result<ValidatedRelativePath> {
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

pub(super) fn os_str_to_utf8<'a>(value: &'a OsStr, label: &str) -> Result<&'a str> {
    value
        .to_str()
        .ok_or_else(|| anyhow!("{label} is not valid UTF-8"))
}

pub(super) fn append_wire_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

pub(super) fn lock_project_file_mutations() -> Result<MutexGuard<'static, ()>> {
    PROJECT_FILE_MUTATION_LOCK
        .lock()
        .map_err(|_| anyhow!("project file mutation lock is poisoned"))
}

pub(super) fn content_revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn project_file_preview_media_type(path: &Path) -> Option<&'static str> {
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

pub(super) fn system_time_millis(time: std::time::SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

pub(super) fn prepare_temp_file(
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

pub(super) fn persist_new_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .context("project file does not have a parent directory")?;
    let temp = prepare_temp_file(parent, bytes, None)?;
    temp.persist_noclobber(path)
        .map_err(|error| anyhow!("{}", error.error))?;
    Ok(())
}

pub(super) fn persist_replacement(temp: NamedTempFile, path: &Path) -> Result<()> {
    temp.persist(path)
        .map_err(|error| anyhow!("{}", error.error))?;
    Ok(())
}

#[cfg(not(windows))]
pub(super) fn is_link_or_reparse(metadata: &Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(windows)]
pub(super) fn is_link_or_reparse(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
pub(super) fn remove_link_or_reparse(path: &Path, _metadata: &Metadata) -> std::io::Result<()> {
    fs::remove_file(path)
}

#[cfg(windows)]
pub(super) fn remove_link_or_reparse(path: &Path, metadata: &Metadata) -> std::io::Result<()> {
    let target_is_directory = fs::metadata(path)
        .map(|target| target.is_dir())
        .unwrap_or_else(|_| metadata.is_dir());
    if target_is_directory {
        fs::remove_dir(path)
    } else {
        fs::remove_file(path)
    }
}

pub(super) fn remove_tree_without_following_links(path: &Path) -> Result<()> {
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
