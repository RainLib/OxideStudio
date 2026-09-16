use super::host_errors::SidecarRequestError;
use crate::agent::protocol::AgentArtifactSearchMatch;

pub(super) const MAX_ARTIFACT_READ_BYTES: usize = 64 * 1024;
pub(super) const MAX_ARTIFACT_SEARCH_MATCHES: usize = 20;
pub(super) const MAX_ARTIFACT_SEARCH_CONTEXT_BYTES: usize = 512;

pub(super) fn validate_artifact_id(
    artifact_id: &str,
) -> std::result::Result<(), SidecarRequestError> {
    if artifact_id.trim().is_empty()
        || artifact_id.chars().count() > 240
        || artifact_id.chars().any(char::is_control)
    {
        return Err(SidecarRequestError::invalid_params(
            "artifactId must contain 1 to 240 non-control characters",
        ));
    }
    Ok(())
}

pub(super) fn validate_artifact_read_bytes(
    max_bytes: usize,
) -> std::result::Result<(), SidecarRequestError> {
    if max_bytes == 0 || max_bytes > MAX_ARTIFACT_READ_BYTES {
        return Err(SidecarRequestError::invalid_params(
            "artifact maxBytes must be between 1 and 65536",
        ));
    }
    Ok(())
}

pub(super) fn validate_artifact_search(
    query: &str,
    max_matches: usize,
    context_bytes: usize,
) -> std::result::Result<(), SidecarRequestError> {
    if query.trim().is_empty() || query.trim().chars().count() > 256 {
        return Err(SidecarRequestError::invalid_params(
            "artifact search query must contain 1 to 256 characters",
        ));
    }
    if max_matches == 0 || max_matches > MAX_ARTIFACT_SEARCH_MATCHES {
        return Err(SidecarRequestError::invalid_params(
            "artifact maxMatches must be between 1 and 20",
        ));
    }
    if !(16..=MAX_ARTIFACT_SEARCH_CONTEXT_BYTES).contains(&context_bytes) {
        return Err(SidecarRequestError::invalid_params(
            "artifact contextBytes must be between 16 and 512",
        ));
    }
    Ok(())
}

pub(super) fn artifact_text_range(
    content: &str,
    requested_offset: usize,
    max_bytes: usize,
) -> (usize, usize, &str) {
    let offset = ceil_char_boundary(content, requested_offset.min(content.len()));
    let requested_end = offset.saturating_add(max_bytes).min(content.len());
    let mut end = floor_char_boundary(content, requested_end);
    if end == offset && end < content.len() {
        end = ceil_char_boundary(content, end.saturating_add(1));
    }
    (offset, end, &content[offset..end])
}

pub(super) fn artifact_export_file_name(suggested: Option<&str>, artifact_id: &str) -> String {
    let source = suggested
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(artifact_id);
    let mut name = source
        .trim()
        .chars()
        .take(100)
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    name = name.trim_matches(['.', '-', '_']).to_string();
    if name.is_empty() {
        name = "oxide-agent-result".to_string();
    }
    if !name.to_ascii_lowercase().ends_with(".json") {
        name.push_str(".json");
    }
    name
}

pub(super) fn search_artifact_text(
    content: &str,
    query: &str,
    max_matches: usize,
    context_bytes: usize,
) -> (Vec<AgentArtifactSearchMatch>, bool) {
    let case_insensitive = query.is_ascii();
    let haystack = if case_insensitive {
        content.to_ascii_lowercase()
    } else {
        content.to_string()
    };
    let needle = if case_insensitive {
        query.to_ascii_lowercase()
    } else {
        query.to_string()
    };
    let mut matches = Vec::new();
    let mut cursor = 0;
    let mut truncated = false;
    while cursor <= haystack.len() {
        let Some(relative) = haystack[cursor..].find(&needle) else {
            break;
        };
        let offset = cursor + relative;
        if matches.len() >= max_matches {
            truncated = true;
            break;
        }
        let end = offset.saturating_add(needle.len()).min(content.len());
        let snippet_start = floor_char_boundary(content, offset.saturating_sub(context_bytes));
        let snippet_end = ceil_char_boundary(
            content,
            end.saturating_add(context_bytes).min(content.len()),
        );
        matches.push(AgentArtifactSearchMatch {
            offset,
            length: end.saturating_sub(offset),
            snippet_offset: snippet_start,
            snippet: content[snippet_start..snippet_end].to_string(),
        });
        cursor = end.max(cursor.saturating_add(1));
    }
    (matches, truncated)
}

pub(super) fn floor_char_boundary(value: &str, mut index: usize) -> usize {
    index = index.min(value.len());
    while index > 0 && !value.is_char_boundary(index) {
        index -= 1;
    }
    index
}

pub(super) fn ceil_char_boundary(value: &str, mut index: usize) -> usize {
    index = index.min(value.len());
    while index < value.len() && !value.is_char_boundary(index) {
        index += 1;
    }
    index
}
