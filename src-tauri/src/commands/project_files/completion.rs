use super::{
    filesystem::{is_link_or_reparse, os_str_to_utf8},
    models::{
        IndexedProjectFile, ProjectCompletionContextRequest, ProjectCompletionIndex,
        ProjectCompletionSnippet, ProjectLspDocument, ProjectRoot, COMPLETION_CONTEXT_SIZE_LIMIT,
        COMPLETION_FILE_LIMIT, COMPLETION_FILE_SIZE_LIMIT, COMPLETION_INDEX_SIZE_LIMIT,
        LSP_PROJECT_DOCUMENT_LIMIT, LSP_PROJECT_DOCUMENT_SIZE_LIMIT,
        LSP_PROJECT_DOCUMENT_TOTAL_SIZE_LIMIT, PROJECT_COMPLETION_INDEXES,
    },
};
use anyhow::{anyhow, bail, Context, Result};
use std::{
    collections::HashMap,
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

pub(super) fn completion_indexes() -> &'static Mutex<HashMap<PathBuf, ProjectCompletionIndex>> {
    PROJECT_COMPLETION_INDEXES.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) fn invalidate_completion_index(root: &ProjectRoot) {
    if let Ok(mut indexes) = completion_indexes().lock() {
        indexes.remove(&root.path);
    }
}

pub(super) fn is_completion_database_file(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "sql" | "psql" | "pgsql" | "mysql" | "json" | "jsonc" | "eql" | "redis"
            )
        })
}

pub(super) fn is_lsp_sql_file(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "sql" | "psql" | "pgsql" | "mysql"
            )
        })
}

pub(super) fn excluded_completion_entry(name: &str, is_directory: bool) -> bool {
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

pub(super) fn collect_completion_files(
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

pub(super) fn completion_index(root: &ProjectRoot) -> Result<ProjectCompletionIndex> {
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

pub(super) fn project_lsp_documents(root: &ProjectRoot) -> Result<Vec<ProjectLspDocument>> {
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

pub(super) fn completion_query_terms(request: &ProjectCompletionContextRequest) -> Vec<String> {
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

pub(super) fn truncate_utf8_bytes(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

pub(super) fn ranked_project_snippets(
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
