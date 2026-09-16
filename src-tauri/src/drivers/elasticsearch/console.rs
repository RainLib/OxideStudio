use super::models::ElasticsearchRequest;
use crate::core::protocol::SearchIndexMetadataKind;
use anyhow::{anyhow, Context, Result};
use reqwest::Method;
use serde_json::{json, Value};

pub(super) fn parse_elasticsearch_requests(input: &str) -> Result<Vec<ElasticsearchRequest>> {
    let sanitized = strip_elasticsearch_console_comments(input);
    let input = sanitized.trim();
    if input.is_empty() {
        return Ok(Vec::new());
    }

    if input.starts_with('{') || input.starts_with('[') {
        return Ok(vec![ElasticsearchRequest {
            method: Method::POST,
            path: "/_search".to_string(),
            body: Some(input.to_string()),
        }]);
    }

    let mut requests = Vec::new();
    let mut current: Option<ElasticsearchRequest> = None;
    let mut body_lines: Vec<String> = Vec::new();

    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some((method, path, inline_body)) = parse_request_line(trimmed)? {
            if let Some(mut request) = current.take() {
                if !body_lines.is_empty() {
                    request.body = Some(body_lines.join("\n"));
                    body_lines.clear();
                }
                requests.push(request);
            }

            current = Some(ElasticsearchRequest {
                method,
                path,
                body: inline_body,
            });
        } else if current.is_some() {
            body_lines.push(trimmed.to_string());
        } else {
            return Err(anyhow!(
                "Expected Elasticsearch request line, got: {trimmed}"
            ));
        }
    }

    if let Some(mut request) = current {
        if !body_lines.is_empty() {
            request.body = Some(body_lines.join("\n"));
        }
        requests.push(request);
    }

    Ok(requests)
}

pub(super) fn is_elasticsearch_ndjson_path(path: &str) -> bool {
    let path = path.split('?').next().unwrap_or(path).trim_end_matches('/');
    path == "/_bulk"
        || path.ends_with("/_bulk")
        || path == "/_msearch"
        || path.ends_with("/_msearch")
        || path == "/_msearch/template"
        || path.ends_with("/_msearch/template")
}

pub(super) fn normalize_elasticsearch_ndjson_body(body: &str) -> Result<String> {
    let mut has_line = false;
    for (index, line) in body.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        has_line = true;
        serde_json::from_str::<Value>(line)
            .with_context(|| format!("Invalid Elasticsearch NDJSON body at line {}", index + 1))?;
    }
    if !has_line {
        return Err(anyhow!("Elasticsearch NDJSON body is required"));
    }
    let mut normalized = body.trim_end().to_string();
    normalized.push('\n');
    Ok(normalized)
}

pub(super) fn strip_elasticsearch_console_comments(input: &str) -> String {
    let characters = input.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut line_has_only_whitespace = true;

    while index < characters.len() {
        let character = characters[index];
        let next = characters.get(index + 1).copied();

        if character == '\n' {
            output.push('\n');
            in_line_comment = false;
            line_has_only_whitespace = true;
            index += 1;
            continue;
        }

        if in_line_comment {
            output.push(' ');
            index += 1;
            continue;
        }

        if in_block_comment {
            output.push(' ');
            if character == '*' && next == Some('/') {
                output.push(' ');
                in_block_comment = false;
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }

        if in_string {
            output.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            line_has_only_whitespace = false;
            index += 1;
            continue;
        }

        if character == '"' {
            output.push(character);
            in_string = true;
            line_has_only_whitespace = false;
            index += 1;
            continue;
        }

        if character == '/'
            && next == Some('/')
            && index
                .checked_sub(1)
                .and_then(|position| characters.get(position))
                != Some(&':')
        {
            output.push_str("  ");
            in_line_comment = true;
            index += 2;
            continue;
        }

        if character == '/' && next == Some('*') {
            output.push_str("  ");
            in_block_comment = true;
            index += 2;
            continue;
        }

        if character == '#' && line_has_only_whitespace {
            output.push(' ');
            in_line_comment = true;
            index += 1;
            continue;
        }

        output.push(character);
        if !character.is_whitespace() {
            line_has_only_whitespace = false;
        }
        index += 1;
    }

    output
}

pub(super) fn parse_request_line(line: &str) -> Result<Option<(Method, String, Option<String>)>> {
    let Some((method, rest)) = line.split_once(char::is_whitespace) else {
        return Ok(None);
    };
    let method = match method.to_ascii_uppercase().as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "DELETE" => Method::DELETE,
        "HEAD" => Method::HEAD,
        "PATCH" => Method::PATCH,
        _ => return Ok(None),
    };

    let rest = rest.trim();
    if rest.is_empty() {
        return Err(anyhow!("Elasticsearch request path is required"));
    }

    let mut split = rest.splitn(2, char::is_whitespace);
    let path = split.next().unwrap_or("").trim();
    if path.contains("://") {
        return Err(anyhow!(
            "Elasticsearch request path must be relative to the configured server"
        ));
    }
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let inline_body = split
        .next()
        .map(str::trim)
        .filter(|body| !body.is_empty())
        .map(ToString::to_string);

    Ok(Some((method, path, inline_body)))
}

pub(super) fn validate_elasticsearch_index_context(value: &str) -> Result<Option<String>> {
    let value = value.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("default") {
        return Ok(None);
    }
    if value.chars().any(|ch| matches!(ch, '/' | '\\' | '\0')) {
        return Err(anyhow!("Invalid Elasticsearch index context: {value}"));
    }
    Ok(Some(value.to_string()))
}

pub(super) fn validate_elasticsearch_index_target(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 255 {
        return Err(anyhow!("Invalid Elasticsearch index target"));
    }
    if matches!(value, "." | ".." | "*" | "?" | "_all")
        || value.starts_with(['-', '_', '+'])
        || !value.chars().any(|ch| !matches!(ch, '*' | '?'))
        || value.chars().any(|ch| {
            ch.is_whitespace()
                || ch.is_uppercase()
                || matches!(
                    ch,
                    '/' | '\\' | '\0' | ',' | '#' | ':' | '%' | '"' | '<' | '>' | '|'
                )
        })
    {
        return Err(anyhow!("Invalid Elasticsearch index target: {value}"));
    }
    Ok(value.to_string())
}

pub(super) fn encode_elasticsearch_index_target(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'*') {
            encoded.push(*byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0F) as usize] as char);
        }
    }
    encoded
}

pub(super) fn build_elasticsearch_index_metadata_request(
    index: &str,
    kind: SearchIndexMetadataKind,
) -> Result<ElasticsearchRequest> {
    let index = validate_elasticsearch_index_target(index)?;
    let endpoint = match kind {
        SearchIndexMetadataKind::Mapping => "_mapping",
        SearchIndexMetadataKind::Settings => "_settings",
        SearchIndexMetadataKind::Stats => "_stats",
    };
    Ok(ElasticsearchRequest {
        method: Method::GET,
        path: format!(
            "/{}/{}",
            encode_elasticsearch_index_target(&index),
            endpoint
        ),
        body: None,
    })
}

pub(super) fn build_elasticsearch_index_clear_request(index: &str) -> Result<ElasticsearchRequest> {
    let index = validate_elasticsearch_index_target(index)?;
    Ok(ElasticsearchRequest {
        method: Method::POST,
        path: format!(
            "/{}/_delete_by_query?conflicts=proceed&refresh=true",
            encode_elasticsearch_index_target(&index)
        ),
        body: Some(json!({ "query": { "match_all": {} } }).to_string()),
    })
}

pub(super) fn encode_elasticsearch_path_segment(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());

    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0F) as usize] as char);
        }
    }

    encoded
}

pub(super) fn scope_search_request_to_index(
    mut request: ElasticsearchRequest,
    index: Option<&str>,
) -> ElasticsearchRequest {
    let Some(index) = index.map(str::trim).filter(|value| !value.is_empty()) else {
        return request;
    };

    if matches!(request.path.as_str(), "/_search" | "/_eql/search") {
        request.path = format!(
            "/{}{}",
            encode_elasticsearch_path_segment(index),
            request.path
        );
    }

    request
}

pub(super) fn is_typeless_document_path(path: &str) -> bool {
    let path = path.split('?').next().unwrap_or(path);
    let segments = path.trim_start_matches('/').split('/').collect::<Vec<_>>();
    matches!(segments.as_slice(), [_, "_doc", ..] | [_, "_update", _])
}

pub(super) fn rewrite_elasticsearch_six_document_path(path: &str, mapping_type: &str) -> String {
    let (path, query) = path
        .split_once('?')
        .map(|(path, query)| (path, Some(query)))
        .unwrap_or((path, None));
    let segments = path.trim_start_matches('/').split('/').collect::<Vec<_>>();
    let mapping_type = encode_elasticsearch_path_segment(mapping_type);
    let rewritten = match segments.as_slice() {
        [index, "_doc"] => format!("/{index}/{mapping_type}"),
        [index, "_doc", id] => format!("/{index}/{mapping_type}/{id}"),
        [index, "_update", id] => format!("/{index}/{mapping_type}/{id}/_update"),
        _ => return path.to_string(),
    };
    match query {
        Some(query) => format!("{rewritten}?{query}"),
        None => rewritten,
    }
}

pub(super) fn elasticsearch_six_mapping_types(value: &Value) -> Vec<String> {
    let mut mapping_types = Vec::new();
    let Some(indices) = value.as_object() else {
        return mapping_types;
    };
    for index_mapping in indices.values() {
        let Some(mappings) = index_mapping.get("mappings").and_then(Value::as_object) else {
            continue;
        };
        for (mapping_type, mapping) in mappings {
            if mapping_type == "_default_" || !mapping.is_object() {
                continue;
            }
            if !mapping_types.contains(mapping_type) {
                mapping_types.push(mapping_type.clone());
            }
        }
    }
    mapping_types
}
