use super::collections::elasticsearch_index_grouping_pattern;
use super::models::{
    ElasticsearchConnectionOptions, ElasticsearchServerInfo, ElasticsearchTransportMode,
    KIBANA_PROXY_STATUS_HEADER,
};
use crate::core::protocol::SearchIndexClearResult;
use anyhow::{anyhow, Context, Result};
use percent_encoding::percent_decode_str;
use reqwest::{StatusCode, Url};
use serde_json::Value;

pub(super) fn normalize_elasticsearch_base_url(url: &str) -> Result<Url> {
    let mut parsed = Url::parse(url).context("Invalid Elasticsearch URL")?;
    let original_scheme = parsed.scheme().to_ascii_lowercase();
    if !matches!(
        original_scheme.as_str(),
        "http" | "https" | "elasticsearch" | "elastic"
    ) {
        return Err(anyhow!("Elasticsearch URL must use http:// or https://"));
    }

    let ssl_mode = parsed
        .query_pairs()
        .find(|(key, _)| key.eq_ignore_ascii_case("ssl") || key.eq_ignore_ascii_case("tls"))
        .map(|(_, value)| value.into_owned().to_ascii_lowercase());
    let secure = original_scheme == "https"
        || ssl_mode
            .as_deref()
            .is_some_and(|mode| mode != "disable" && mode != "false");
    let target_scheme = if secure { "https" } else { "http" };
    if matches!(original_scheme.as_str(), "elasticsearch" | "elastic") {
        let scheme_end = url
            .find(':')
            .ok_or_else(|| anyhow!("Invalid Elasticsearch URL scheme"))?;
        parsed = Url::parse(&format!("{target_scheme}{}", &url[scheme_end..]))
            .context("Invalid Elasticsearch URL")?;
    } else {
        parsed
            .set_scheme(target_scheme)
            .map_err(|_| anyhow!("Invalid Elasticsearch URL scheme"))?;
    }

    let retained_query = parsed
        .query_pairs()
        .filter(|(key, _)| !key.eq_ignore_ascii_case("ssl") && !key.eq_ignore_ascii_case("tls"))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    parsed.set_query(None);
    if !retained_query.is_empty() {
        parsed.query_pairs_mut().extend_pairs(retained_query);
    }
    Ok(parsed)
}

pub(super) fn elasticsearch_connection_options(
    url: &Url,
) -> Result<ElasticsearchConnectionOptions> {
    let query_value = |name: &str| {
        url.query_pairs()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.into_owned())
    };
    let transport_mode = if query_value("mode")
        .as_deref()
        .is_some_and(|mode| mode.eq_ignore_ascii_case("kibana"))
    {
        ElasticsearchTransportMode::KibanaProxy
    } else {
        ElasticsearchTransportMode::Direct
    };
    let kibana_base_path = if transport_mode == ElasticsearchTransportMode::KibanaProxy {
        normalize_kibana_base_path(query_value("kibanaBasePath").as_deref().unwrap_or(""))?
    } else {
        String::new()
    };
    let connectivity_check_path = normalize_elasticsearch_connectivity_check_path(
        query_value("connectivityCheckPath")
            .as_deref()
            .unwrap_or(""),
    )?;
    let connectivity_check_disabled = query_value("connectivityCheckDisabled")
        .as_deref()
        .is_some_and(is_enabled_connection_option);
    let index_grouping = elasticsearch_index_grouping_pattern(url);

    Ok(ElasticsearchConnectionOptions {
        transport_mode,
        kibana_base_path,
        connectivity_check_path,
        connectivity_check_disabled,
        index_grouping,
    })
}

pub(super) fn strip_elasticsearch_internal_query_parameters(url: &mut Url) {
    const INTERNAL_KEYS: &[&str] = &[
        "mode",
        "kibanaBasePath",
        "connectivityCheckPath",
        "connectivityCheckDisabled",
        "indexGroupingPattern",
    ];
    let retained = url
        .query_pairs()
        .filter(|(key, _)| {
            !INTERNAL_KEYS
                .iter()
                .any(|candidate| key.eq_ignore_ascii_case(candidate))
        })
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    url.set_query(None);
    if !retained.is_empty() {
        url.query_pairs_mut().extend_pairs(retained);
    }
}

pub(super) fn normalize_kibana_base_path(value: &str) -> Result<String> {
    let value = value.trim().trim_matches('/');
    if value.is_empty() {
        return Ok(String::new());
    }
    validate_elasticsearch_local_path(value, "Kibana base path")?;
    Ok(format!("/{value}"))
}

pub(super) fn normalize_elasticsearch_connectivity_check_path(value: &str) -> Result<String> {
    let line = value.lines().next().unwrap_or("").trim();
    let without_method = line
        .strip_prefix("GET ")
        .or_else(|| line.strip_prefix("get "))
        .or_else(|| line.strip_prefix("Get "))
        .unwrap_or(line)
        .trim();
    if without_method.is_empty() || without_method == "/" {
        return Ok("/".to_string());
    }
    validate_elasticsearch_local_path(without_method, "connectivity-check path")?;
    Ok(format!("/{}", without_method.trim_start_matches('/')))
}

pub(super) fn validate_elasticsearch_local_path(path: &str, label: &str) -> Result<()> {
    if path.contains("://")
        || path.contains('\\')
        || path.contains('#')
        || path.chars().any(char::is_control)
        || path.split('/').any(|segment| matches!(segment, "." | ".."))
    {
        return Err(anyhow!("Invalid Elasticsearch {label}"));
    }
    Ok(())
}

pub(super) fn is_enabled_connection_option(value: &str) -> bool {
    let value = value.trim();
    value.eq_ignore_ascii_case("true")
        || value == "1"
        || value.eq_ignore_ascii_case("yes")
        || value.eq_ignore_ascii_case("on")
}

pub(super) fn elasticsearch_effective_response_status(
    transport_mode: ElasticsearchTransportMode,
    transport_status: StatusCode,
    headers: &reqwest::header::HeaderMap,
) -> StatusCode {
    if transport_mode == ElasticsearchTransportMode::KibanaProxy {
        if let Some(status) = headers
            .get(KIBANA_PROXY_STATUS_HEADER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u16>().ok())
            .and_then(|value| StatusCode::from_u16(value).ok())
        {
            return status;
        }
    }
    transport_status
}

pub(super) fn append_elasticsearch_base_path(url: &mut Url, base_path: &str) -> Result<()> {
    if base_path.is_empty() {
        return Ok(());
    }
    let existing = url.path().trim_end_matches('/');
    let combined = format!("{existing}{base_path}");
    url.set_path(&combined);
    Ok(())
}

pub(super) fn join_elasticsearch_request_path(base_url: &Url, request_path: &str) -> Result<Url> {
    validate_elasticsearch_local_path(request_path, "request path")?;
    let mut url = base_url.clone();
    let (path, query) = request_path
        .split_once('?')
        .map_or((request_path, None), |(path, query)| (path, Some(query)));
    let base_path = base_url.path().trim_end_matches('/');
    let request_path = path.trim_start_matches('/');
    url.set_path(&format!("{base_path}/{request_path}"));
    url.set_query(query);
    Ok(url)
}

pub(super) fn extract_basic_auth(url: &mut Url) -> Result<Option<(String, String)>> {
    let has_credentials = !url.username().is_empty() || url.password().is_some();
    if !has_credentials {
        return Ok(None);
    }
    let username = percent_decode_str(url.username())
        .decode_utf8()
        .context("Elasticsearch username is not valid UTF-8")?
        .into_owned();
    let password = percent_decode_str(url.password().unwrap_or(""))
        .decode_utf8()
        .context("Elasticsearch password is not valid UTF-8")?
        .into_owned();
    let _ = url.set_username("");
    let _ = url.set_password(None);
    Ok(Some((username, password)))
}

pub(super) fn safe_endpoint_label(url: &Url) -> String {
    let host = url.host_str().unwrap_or("unknown-host");
    match url.port_or_known_default() {
        Some(port) => format!("{}://{host}:{port}", url.scheme()),
        None => format!("{}://{host}", url.scheme()),
    }
}

pub(super) fn elasticsearch_response_error(status: StatusCode, body: &Value) -> anyhow::Error {
    match status {
        StatusCode::UNAUTHORIZED => anyhow!(
            "Elasticsearch authentication failed (HTTP 401). Verify the username and password."
        ),
        StatusCode::FORBIDDEN => anyhow!(
            "Elasticsearch authentication succeeded but this user is not authorized (HTTP 403)."
        ),
        _ => {
            let reason = elasticsearch_error_reason(body).unwrap_or_else(|| {
                status
                    .canonical_reason()
                    .unwrap_or("request failed")
                    .to_string()
            });
            anyhow!(
                "Elasticsearch request failed (HTTP {}): {}",
                status.as_u16(),
                truncate_error_reason(&reason)
            )
        }
    }
}

pub(super) fn parse_elasticsearch_clear_result(value: &Value) -> Result<SearchIndexClearResult> {
    let object = value
        .as_object()
        .ok_or_else(|| anyhow!("Elasticsearch delete-by-query response is malformed"))?;
    let read_counter = |name: &str| -> Result<u64> {
        object
            .get(name)
            .and_then(Value::as_u64)
            .ok_or_else(|| anyhow!("Elasticsearch delete-by-query response is missing {name}"))
    };
    let failures = object
        .get("failures")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Elasticsearch delete-by-query response is missing failures"))?
        .iter()
        .take(20)
        .map(|failure| {
            let value = failure.to_string();
            if value.chars().count() <= 2_000 {
                value
            } else {
                format!("{}…", value.chars().take(2_000).collect::<String>())
            }
        })
        .collect();
    let timed_out = object
        .get("timed_out")
        .and_then(Value::as_bool)
        .ok_or_else(|| anyhow!("Elasticsearch delete-by-query response is missing timed_out"))?;
    Ok(SearchIndexClearResult {
        total: read_counter("total")?,
        deleted: read_counter("deleted")?,
        version_conflicts: read_counter("version_conflicts")?,
        timed_out,
        failures,
    })
}

pub(super) fn elasticsearch_error_reason(body: &Value) -> Option<String> {
    body.pointer("/error/root_cause/0/reason")
        .and_then(Value::as_str)
        .or_else(|| body.pointer("/error/reason").and_then(Value::as_str))
        .or_else(|| body.get("error").and_then(Value::as_str))
        .map(ToString::to_string)
}

pub(super) fn elasticsearch_response_lacks_pit_shard_doc(status: StatusCode, body: &Value) -> bool {
    if status != StatusCode::BAD_REQUEST {
        return false;
    }

    fn collect_error_strings(value: &Value, output: &mut Vec<String>) {
        match value {
            Value::String(value) => output.push(value.to_ascii_lowercase()),
            Value::Array(values) => {
                for value in values.iter().take(32) {
                    collect_error_strings(value, output);
                }
            }
            Value::Object(values) => {
                for (key, value) in values.iter().take(32) {
                    if matches!(
                        key.as_str(),
                        "error" | "root_cause" | "caused_by" | "reason" | "type"
                    ) {
                        collect_error_strings(value, output);
                    }
                }
            }
            Value::Null | Value::Bool(_) | Value::Number(_) => {}
        }
    }

    let Some(error) = body.get("error") else {
        return false;
    };
    let mut values = Vec::new();
    collect_error_strings(error, &mut values);
    let mentions_shard_doc = values.iter().any(|value| value.contains("_shard_doc"));
    let reports_unsupported_sort = values.iter().any(|value| {
        value.contains("no mapping found")
            || value.contains("unknown field")
            || value.contains("unmapped")
            || value.contains("not supported")
            || value.contains("unsupported")
    });
    mentions_shard_doc && reports_unsupported_sort
}

pub(super) fn truncate_error_reason(value: &str) -> String {
    const MAX_CHARS: usize = 500;
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(MAX_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

pub(super) fn parse_elasticsearch_server_info(body: &Value) -> Result<ElasticsearchServerInfo> {
    let version = body
        .pointer("/version/number")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            anyhow!("The endpoint responded, but did not return an Elasticsearch version")
        })?;
    let major = version
        .split('.')
        .next()
        .and_then(|value| value.parse::<u8>().ok())
        .ok_or_else(|| anyhow!("Invalid Elasticsearch version returned by server"))?;
    if !matches!(major, 6..=8) {
        return Err(anyhow!(
            "Elasticsearch {version} is not supported; supported major versions are 6, 7, and 8"
        ));
    }

    Ok(ElasticsearchServerInfo {
        version: version.to_string(),
        major,
    })
}
