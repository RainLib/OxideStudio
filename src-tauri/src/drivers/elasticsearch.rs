use crate::core::{
    driver::DatabaseDriver,
    protocol::{CollectionInfo, ColumnDef, ColumnInfo, QueryResult},
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use percent_encoding::percent_decode_str;
use reqwest::{Client, Method, StatusCode, Url};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::Mutex;

pub struct ElasticsearchDriver {
    base_url: Url,
    client: Client,
    auth: Option<(String, String)>,
    server_info: Mutex<Option<ElasticsearchServerInfo>>,
    mapping_types: Mutex<HashMap<String, String>>,
    active_index: Mutex<Option<String>>,
    connected: Mutex<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ElasticsearchServerInfo {
    version: String,
    major: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ElasticsearchRequest {
    method: Method,
    path: String,
    body: Option<String>,
}

impl ElasticsearchDriver {
    pub fn new(url: &str) -> Result<Self> {
        let mut base_url = normalize_elasticsearch_base_url(url)?;
        let auth = extract_basic_auth(&mut base_url)?;
        let client_builder = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30));
        // Unit tests never perform a real transport request. Avoid asking
        // macOS SystemConfiguration for proxy state in headless/sandboxed
        // runners, where the framework can return a null dynamic store.
        #[cfg(test)]
        let client_builder = client_builder.no_proxy();
        Ok(Self {
            base_url,
            client: client_builder
                .build()
                .context("Failed to initialize Elasticsearch HTTP client")?,
            auth,
            server_info: Mutex::new(None),
            mapping_types: Mutex::new(HashMap::new()),
            active_index: Mutex::new(None),
            connected: Mutex::new(false),
        })
    }

    async fn active_index_name(&self) -> Option<String> {
        self.active_index.lock().await.clone()
    }

    async fn ensure_connected(&self) -> Result<()> {
        if *self.connected.lock().await {
            Ok(())
        } else {
            Err(anyhow!("Elasticsearch connection is not established"))
        }
    }

    async fn execute_requests(
        &self,
        requests: Vec<ElasticsearchRequest>,
        context_index: Option<String>,
    ) -> Result<Vec<QueryResult>> {
        if requests.is_empty() {
            return Err(anyhow!("Elasticsearch query is required"));
        }

        let active_index = match context_index {
            Some(index) => Some(index),
            None => self.active_index_name().await,
        };
        let mut results = Vec::new();

        for request in requests {
            let request = scope_search_request_to_index(request, active_index.as_deref());
            let request = self.prepare_request_for_server(request).await?;
            let (status, body) = self.send_request(&request).await?;
            let normalized = normalize_elasticsearch_response(body);
            if let Some(result) = elasticsearch_table_result(&normalized) {
                results.push(result);
            } else {
                results.push(elasticsearch_request_result(&request, status, normalized));
            }
        }

        Ok(results)
    }

    async fn send_request(&self, request: &ElasticsearchRequest) -> Result<(u16, Value)> {
        self.ensure_connected().await?;
        self.send_request_unchecked(request).await
    }

    async fn prepare_request_for_server(
        &self,
        mut request: ElasticsearchRequest,
    ) -> Result<ElasticsearchRequest> {
        let major = self
            .server_info
            .lock()
            .await
            .as_ref()
            .map(|info| info.major);
        if major != Some(6) || !is_typeless_document_path(&request.path) {
            return Ok(request);
        }

        let Some(index) = request
            .path
            .trim_start_matches('/')
            .split(['/', '?'])
            .next()
            .filter(|value| !value.is_empty())
        else {
            return Ok(request);
        };
        let mapping_type = self.resolve_elasticsearch_six_mapping_type(index).await?;
        request.path = rewrite_elasticsearch_six_document_path(&request.path, &mapping_type);
        Ok(request)
    }

    async fn resolve_elasticsearch_six_mapping_type(&self, index: &str) -> Result<String> {
        if let Some(mapping_type) = self.mapping_types.lock().await.get(index).cloned() {
            return Ok(mapping_type);
        }

        let request = ElasticsearchRequest {
            method: Method::GET,
            path: format!("/{index}/_mapping?ignore_unavailable=true"),
            body: None,
        };
        let (_, body) = self.send_request_unchecked(&request).await?;
        let mapping_types = elasticsearch_six_mapping_types(&body);
        let mapping_type = match mapping_types.as_slice() {
            [] => "_doc".to_string(),
            [mapping_type] => mapping_type.clone(),
            _ => {
                return Err(anyhow!(
                    "Elasticsearch 6 index has multiple mapping types; use an explicit typed request path"
                ));
            }
        };
        self.mapping_types
            .lock()
            .await
            .insert(index.to_string(), mapping_type.clone());
        Ok(mapping_type)
    }

    async fn send_request_unchecked(&self, request: &ElasticsearchRequest) -> Result<(u16, Value)> {
        let url = self
            .base_url
            .join(request.path.trim_start_matches('/'))
            .with_context(|| format!("Invalid Elasticsearch request path: {}", request.path))?;
        let mut builder = self.client.request(request.method.clone(), url);
        builder = builder.header("accept", "application/json");
        if let Some((username, password)) = &self.auth {
            builder = builder.basic_auth(username, Some(password));
        }
        if let Some(body) = request
            .body
            .as_deref()
            .filter(|body| !body.trim().is_empty())
        {
            builder = builder
                .header("content-type", "application/json")
                .body(body.to_string());
        }

        let response = builder.send().await.map_err(|error| {
            let endpoint = safe_endpoint_label(&self.base_url);
            let hint = if self.base_url.scheme() == "http" {
                " If this endpoint requires TLS, select an SSL mode so the connection uses HTTPS."
            } else {
                ""
            };
            anyhow!("Elasticsearch transport request to {endpoint} failed: {error}.{hint}")
        })?;
        let status = response.status();
        let text = response
            .text()
            .await
            .context("Failed to read Elasticsearch response")?;
        let body = if text.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text))
        };

        if !status.is_success() {
            return Err(elasticsearch_response_error(status, &body));
        }

        Ok((status.as_u16(), body))
    }
}

#[async_trait]
impl DatabaseDriver for ElasticsearchDriver {
    async fn server_version(&self) -> Option<String> {
        self.server_info
            .lock()
            .await
            .as_ref()
            .map(|info| info.version.clone())
    }

    async fn connect(&mut self) -> Result<()> {
        *self.connected.lock().await = false;
        *self.server_info.lock().await = None;
        self.mapping_types.lock().await.clear();
        let request = ElasticsearchRequest {
            method: Method::GET,
            path: "/".to_string(),
            body: None,
        };
        let (_, body) = self.send_request_unchecked(&request).await?;
        let server_info = parse_elasticsearch_server_info(&body)?;
        *self.server_info.lock().await = Some(server_info);
        *self.connected.lock().await = true;
        *self.active_index.lock().await = None;
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        *self.connected.lock().await = false;
        *self.active_index.lock().await = None;
        *self.server_info.lock().await = None;
        self.mapping_types.lock().await.clear();
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        let request = ElasticsearchRequest {
            method: Method::GET,
            path: "/".to_string(),
            body: None,
        };
        self.send_request(&request).await.map(|_| ())
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let requests = parse_elasticsearch_requests(sql)?;
        self.execute_requests(requests, None).await
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        let index = validate_elasticsearch_index_context(schema)?;
        *self.active_index.lock().await = index.clone();
        let requests = parse_elasticsearch_requests(sql)?;
        self.execute_requests(requests, index).await
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        self.ensure_connected().await?;
        Ok(vec!["default".to_string()])
    }

    async fn get_collections(&self, _namespace: &str) -> Result<Vec<CollectionInfo>> {
        let request = ElasticsearchRequest {
            method: Method::GET,
            path: "/_cat/indices?format=json&h=index,docs.count".to_string(),
            body: None,
        };
        let (_, body) = self.send_request(&request).await?;
        Ok(elasticsearch_indices_to_collections(body))
    }

    async fn get_columns(&self, _schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        let index = table.trim();
        if index.is_empty() {
            return Ok(Vec::new());
        }

        let request = ElasticsearchRequest {
            method: Method::GET,
            path: format!("/{index}/_mapping"),
            body: None,
        };
        let (_, body) = self.send_request(&request).await?;
        let major = self
            .server_info
            .lock()
            .await
            .as_ref()
            .map(|info| info.major)
            .unwrap_or(8);
        if major == 6 {
            if let [mapping_type] = elasticsearch_six_mapping_types(&body).as_slice() {
                self.mapping_types
                    .lock()
                    .await
                    .insert(index.to_string(), mapping_type.clone());
            }
        }
        Ok(elasticsearch_mapping_to_columns(&body, index, major))
    }

    async fn set_current_schema(&self, schema: &str) -> Result<()> {
        self.ensure_connected().await?;
        *self.active_index.lock().await = validate_elasticsearch_index_context(schema)?;
        Ok(())
    }
}

fn normalize_elasticsearch_base_url(url: &str) -> Result<Url> {
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

fn extract_basic_auth(url: &mut Url) -> Result<Option<(String, String)>> {
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

fn safe_endpoint_label(url: &Url) -> String {
    let host = url.host_str().unwrap_or("unknown-host");
    match url.port_or_known_default() {
        Some(port) => format!("{}://{host}:{port}", url.scheme()),
        None => format!("{}://{host}", url.scheme()),
    }
}

fn elasticsearch_response_error(status: StatusCode, body: &Value) -> anyhow::Error {
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

fn elasticsearch_error_reason(body: &Value) -> Option<String> {
    body.pointer("/error/root_cause/0/reason")
        .and_then(Value::as_str)
        .or_else(|| body.pointer("/error/reason").and_then(Value::as_str))
        .or_else(|| body.get("error").and_then(Value::as_str))
        .map(ToString::to_string)
}

fn truncate_error_reason(value: &str) -> String {
    const MAX_CHARS: usize = 500;
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(MAX_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

fn parse_elasticsearch_server_info(body: &Value) -> Result<ElasticsearchServerInfo> {
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

fn parse_elasticsearch_requests(input: &str) -> Result<Vec<ElasticsearchRequest>> {
    let input = input.trim();
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

fn parse_request_line(line: &str) -> Result<Option<(Method, String, Option<String>)>> {
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

fn validate_elasticsearch_index_context(value: &str) -> Result<Option<String>> {
    let value = value.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("default") {
        return Ok(None);
    }
    if value.chars().any(|ch| matches!(ch, '/' | '\\' | '\0')) {
        return Err(anyhow!("Invalid Elasticsearch index context: {value}"));
    }
    Ok(Some(value.to_string()))
}

fn encode_elasticsearch_path_segment(value: &str) -> String {
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

fn scope_search_request_to_index(
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

fn is_typeless_document_path(path: &str) -> bool {
    let path = path.split('?').next().unwrap_or(path);
    let segments = path.trim_start_matches('/').split('/').collect::<Vec<_>>();
    matches!(segments.as_slice(), [_, "_doc", ..] | [_, "_update", _])
}

fn rewrite_elasticsearch_six_document_path(path: &str, mapping_type: &str) -> String {
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

fn elasticsearch_six_mapping_types(value: &Value) -> Vec<String> {
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

fn normalize_elasticsearch_response(value: Value) -> Value {
    let Some(hits_container) = value.get("hits") else {
        return value;
    };
    let direct_hits = hits_container
        .get("hits")
        .or_else(|| hits_container.get("events"))
        .and_then(Value::as_array);
    let hits = direct_hits
        .map(|items| items.iter().collect::<Vec<_>>())
        .or_else(|| {
            hits_container
                .get("sequences")
                .and_then(Value::as_array)
                .map(|sequences| {
                    sequences
                        .iter()
                        .filter_map(|sequence| sequence.get("events").and_then(Value::as_array))
                        .flat_map(|events| events.iter())
                        .collect::<Vec<_>>()
                })
        });
    let Some(hits) = hits else {
        return value;
    };

    Value::Array(
        hits.into_iter()
            .map(|hit| {
                let mut document = serde_json::Map::new();
                document.insert(
                    "_index".to_string(),
                    hit.get("_index").cloned().unwrap_or(Value::Null),
                );
                document.insert(
                    "_id".to_string(),
                    hit.get("_id").cloned().unwrap_or(Value::Null),
                );
                document.insert(
                    "_score".to_string(),
                    hit.get("_score").cloned().unwrap_or(Value::Null),
                );
                if let Some(source) = hit.get("_source") {
                    flatten_elasticsearch_source("", source, &mut document);
                }
                Value::Object(document)
            })
            .collect(),
    )
}

fn flatten_elasticsearch_source(
    prefix: &str,
    value: &Value,
    output: &mut serde_json::Map<String, Value>,
) {
    let Some(object) = value.as_object() else {
        if !prefix.is_empty() {
            output.insert(prefix.to_string(), value.clone());
        }
        return;
    };

    if object.is_empty() && !prefix.is_empty() {
        output.insert(prefix.to_string(), value.clone());
        return;
    }

    for (name, field_value) in object {
        let source_name = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{prefix}.{name}")
        };
        let column_name = if matches!(source_name.as_str(), "_index" | "_id" | "_score") {
            format!("_source.{source_name}")
        } else {
            source_name
        };
        if field_value.is_object() {
            flatten_elasticsearch_source(&column_name, field_value, output);
        } else {
            output.insert(column_name, field_value.clone());
        }
    }
}

fn elasticsearch_request_result(
    request: &ElasticsearchRequest,
    status: u16,
    body: Value,
) -> QueryResult {
    QueryResult::rows(
        vec![
            ColumnDef {
                name: "method".to_string(),
                data_type: "text".to_string(),
            },
            ColumnDef {
                name: "path".to_string(),
                data_type: "text".to_string(),
            },
            ColumnDef {
                name: "status".to_string(),
                data_type: "integer".to_string(),
            },
            ColumnDef {
                name: "result".to_string(),
                data_type: "json".to_string(),
            },
        ],
        vec![vec![
            Value::String(request.method.as_str().to_string()),
            Value::String(request.path.clone()),
            json!(status),
            body,
        ]],
    )
}

fn elasticsearch_table_result(value: &Value) -> Option<QueryResult> {
    let documents = value.as_array()?;
    if !documents
        .iter()
        .all(|document| document.as_object().is_some())
    {
        return None;
    }

    let mut column_names = Vec::<String>::new();
    for document in documents {
        for name in document.as_object()?.keys() {
            if !column_names.contains(name) {
                column_names.push(name.to_string());
            }
        }
    }

    for preferred in ["_index", "_id", "_score"].iter().rev() {
        if let Some(position) = column_names.iter().position(|name| name == preferred) {
            let value = column_names.remove(position);
            column_names.insert(0, value);
        }
    }

    let columns = column_names
        .iter()
        .map(|name| ColumnDef {
            name: name.to_string(),
            data_type: "json".to_string(),
        })
        .collect::<Vec<_>>();
    let rows = documents
        .iter()
        .map(|document| {
            let object = document.as_object().expect("validated document object");
            column_names
                .iter()
                .map(|name| object.get(name).cloned().unwrap_or(Value::Null))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    Some(QueryResult::rows(columns, rows))
}

fn elasticsearch_indices_to_collections(value: Value) -> Vec<CollectionInfo> {
    value
        .as_array()
        .map(|indices| {
            indices
                .iter()
                .filter_map(|index| {
                    let name = index.get("index").and_then(Value::as_str)?.to_string();
                    let document_count = index
                        .get("docs.count")
                        .and_then(Value::as_str)
                        .and_then(|value| value.parse::<u64>().ok());
                    Some(CollectionInfo {
                        name,
                        namespace: Some("default".to_string()),
                        collection_type: Some("index".to_string()),
                        document_count,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn elasticsearch_mapping_to_columns(value: &Value, index: &str, major: u8) -> Vec<ColumnInfo> {
    let mut columns = vec![ColumnInfo {
        name: "_id".to_string(),
        data_type: "keyword".to_string(),
        is_nullable: false,
        is_primary_key: true,
        is_unique: true,
        is_indexed: true,
        is_auto_increment: false,
        default_value: None,
        comment: Some("Elasticsearch document id".to_string()),
    }];

    let mappings = value
        .get(index)
        .or_else(|| {
            value
                .as_object()
                .and_then(|indices| indices.values().next())
        })
        .and_then(|index_mapping| index_mapping.get("mappings"));

    if let Some(properties) = mappings
        .and_then(|mappings| mappings.get("properties"))
        .and_then(Value::as_object)
    {
        collect_mapping_properties("", properties, &mut columns);
    } else if major == 6 {
        // Elasticsearch 6 keeps one mapping-type wrapper around `properties`.
        // Elasticsearch 7/8 return `mappings.properties` directly.
        if let Some(mapping_types) = mappings.and_then(Value::as_object) {
            for mapping in mapping_types.values() {
                if let Some(properties) = mapping.get("properties").and_then(Value::as_object) {
                    collect_mapping_properties("", properties, &mut columns);
                }
            }
        }
    }

    columns
}

fn collect_mapping_properties(
    prefix: &str,
    properties: &serde_json::Map<String, Value>,
    columns: &mut Vec<ColumnInfo>,
) {
    for (field, mapping) in properties {
        let name = if prefix.is_empty() {
            field.to_string()
        } else {
            format!("{prefix}.{field}")
        };
        let data_type = elasticsearch_mapping_type(mapping);
        let is_indexed = mapping
            .get("index")
            .and_then(Value::as_bool)
            .unwrap_or(true);

        if !columns.iter().any(|column| column.name == name) {
            columns.push(ColumnInfo {
                name: name.clone(),
                data_type,
                is_nullable: true,
                is_primary_key: false,
                is_unique: false,
                is_indexed,
                is_auto_increment: false,
                default_value: None,
                comment: None,
            });
        }

        if let Some(nested_properties) = mapping.get("properties").and_then(Value::as_object) {
            collect_mapping_properties(&name, nested_properties, columns);
        }
    }
}

fn elasticsearch_mapping_type(mapping: &Value) -> String {
    mapping
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| {
            mapping
                .get("properties")
                .and_then(Value::as_object)
                .map(|_| "object")
        })
        .unwrap_or("object")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_body_as_default_search() {
        let requests = parse_elasticsearch_requests(r#"{"query":{"match_all":{}}}"#).unwrap();

        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, Method::POST);
        assert_eq!(requests[0].path, "/_search");
        assert!(requests[0].body.as_deref().unwrap().contains("match_all"));
    }

    #[test]
    fn scopes_default_search_to_active_index() {
        let request = parse_elasticsearch_requests(r#"{"query":{"match_all":{}}}"#)
            .unwrap()
            .remove(0);
        let scoped = scope_search_request_to_index(request, Some("user events"));

        assert_eq!(scoped.path, "/user%20events/_search");

        let eql = ElasticsearchRequest {
            method: Method::POST,
            path: "/_eql/search".to_string(),
            body: Some(r#"{"query":"process where true"}"#.to_string()),
        };
        let eql = scope_search_request_to_index(eql, Some("events"));
        assert_eq!(eql.path, "/events/_eql/search");

        let explicit = parse_elasticsearch_requests(
            r#"
            GET /users/_search
            {"query":{"match_all":{}}}
            "#,
        )
        .unwrap()
        .remove(0);
        let explicit = scope_search_request_to_index(explicit, Some("orders"));

        assert_eq!(explicit.path, "/users/_search");
    }

    #[test]
    fn rewrites_typeless_document_paths_for_elasticsearch_six() {
        assert_eq!(
            rewrite_elasticsearch_six_document_path("/events/_doc/42", "event"),
            "/events/event/42"
        );
        assert_eq!(
            rewrite_elasticsearch_six_document_path("/events/_update/42?refresh=wait_for", "event",),
            "/events/event/42/_update?refresh=wait_for"
        );
        assert_eq!(
            rewrite_elasticsearch_six_document_path("/events/_doc", "event log"),
            "/events/event%20log"
        );
    }

    #[test]
    fn validates_index_context_without_treating_default_as_index() {
        assert_eq!(validate_elasticsearch_index_context("").unwrap(), None);
        assert_eq!(
            validate_elasticsearch_index_context(" default ").unwrap(),
            None
        );
        assert_eq!(
            validate_elasticsearch_index_context("logs-2026").unwrap(),
            Some("logs-2026".to_string())
        );
        assert!(validate_elasticsearch_index_context("logs/2026").is_err());
    }

    #[tokio::test]
    async fn tracks_active_index_context() {
        let driver = ElasticsearchDriver::new("http://localhost:9200").unwrap();

        assert_eq!(driver.active_index_name().await, None);
        *driver.connected.lock().await = true;
        driver.set_current_schema("logs-2026").await.unwrap();
        assert_eq!(
            driver.active_index_name().await,
            Some("logs-2026".to_string())
        );
        driver.set_current_schema("default").await.unwrap();
        assert_eq!(driver.active_index_name().await, None);
    }

    #[tokio::test]
    async fn disconnect_marks_driver_unavailable_and_clears_active_index() {
        let driver = ElasticsearchDriver::new("http://localhost:9200").unwrap();
        *driver.connected.lock().await = true;
        *driver.active_index.lock().await = Some("logs-2026".to_string());

        driver.disconnect().await.unwrap();

        assert!(!*driver.connected.lock().await);
        assert_eq!(driver.active_index_name().await, None);
        assert!(driver.ping().await.is_err());
        assert!(driver.get_schemas().await.is_err());
    }

    #[test]
    fn parses_http_style_elasticsearch_requests() {
        let requests = parse_elasticsearch_requests(
            r#"
            GET /_cluster/health
            POST users/_search
            {"query":{"term":{"active":true}}}
            "#,
        )
        .unwrap();

        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].method, Method::GET);
        assert_eq!(requests[0].path, "/_cluster/health");
        assert_eq!(requests[0].body, None);
        assert_eq!(requests[1].method, Method::POST);
        assert_eq!(requests[1].path, "/users/_search");
        assert!(requests[1].body.as_deref().unwrap().contains("active"));
    }

    #[test]
    fn rejects_invalid_request_lines() {
        assert!(parse_elasticsearch_requests("GET").is_err());
        assert!(parse_elasticsearch_requests("GET https://other.test/_search").is_err());
        assert!(parse_elasticsearch_requests("not-json").is_err());
    }

    #[test]
    fn extracts_basic_auth_from_url() {
        let mut url = Url::parse("http://service%24account:p%40ss%3Aword@localhost:9200").unwrap();
        assert_eq!(
            extract_basic_auth(&mut url).unwrap(),
            Some(("service$account".to_string(), "p@ss:word".to_string()))
        );
        assert_eq!(url.as_str(), "http://localhost:9200/");
    }

    #[test]
    fn normalizes_https_alias_and_removes_internal_ssl_parameter() {
        let url = normalize_elasticsearch_base_url(
            "elasticsearch://reader:encoded@search.example.test:9200?ssl=require&request_cache=true",
        )
        .unwrap();

        assert_eq!(url.scheme(), "https");
        assert_eq!(url.query(), Some("request_cache=true"));
    }

    #[test]
    fn detects_supported_server_versions() {
        for (version, major) in [("6.8.23", 6), ("7.17.29", 7), ("8.19.4", 8)] {
            let info = parse_elasticsearch_server_info(&json!({
                "version": { "number": version }
            }))
            .unwrap();
            assert_eq!(info.version, version);
            assert_eq!(info.major, major);
        }

        assert!(parse_elasticsearch_server_info(&json!({
            "version": { "number": "5.6.16" }
        }))
        .unwrap_err()
        .to_string()
        .contains("supported major versions are 6, 7, and 8"));
    }

    #[test]
    fn normalizes_search_hits_for_grid_display() {
        let value = json!({
            "hits": {
                "hits": [
                    {"_index": "users", "_id": "1", "_score": 1.0, "_source": {"name": "Ada"}}
                ]
            }
        });

        assert_eq!(
            normalize_elasticsearch_response(value),
            json!([{
                "_index": "users",
                "_id": "1",
                "_score": 1.0,
                "name": "Ada"
            }])
        );
    }

    #[test]
    fn normalizes_eql_events_and_flattens_nested_source_fields() {
        let value = json!({
            "hits": {
                "events": [{
                    "_index": "events",
                    "_id": "42",
                    "_source": {
                        "event": {"category": "process"},
                        "tags": ["prod", "linux"]
                    }
                }]
            }
        });

        assert_eq!(
            normalize_elasticsearch_response(value),
            json!([{
                "_index": "events",
                "_id": "42",
                "_score": null,
                "event.category": "process",
                "tags": ["prod", "linux"]
            }])
        );
    }

    #[test]
    fn converts_search_hits_to_tabular_result() {
        let value = normalize_elasticsearch_response(json!({
            "hits": {
                "hits": [
                    {"_index": "users", "_id": "1", "_score": 1.0, "_source": {"name": "Ada"}},
                    {"_index": "users", "_id": "2", "_score": 0.8, "_source": {"name": "Grace"}}
                ]
            }
        }));
        let result = elasticsearch_table_result(&value).unwrap();

        assert_eq!(
            result
                .columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            vec!["_index", "_id", "_score", "name"]
        );
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0][0], json!("users"));
        assert_eq!(result.rows[1][3], json!("Grace"));
    }

    #[test]
    fn maps_cat_indices_to_collections() {
        let collections = elasticsearch_indices_to_collections(json!([
            {"index": "users", "docs.count": "42"},
            {"index": "orders", "docs.count": "7"}
        ]));

        assert_eq!(collections.len(), 2);
        assert_eq!(collections[0].name, "users");
        assert_eq!(collections[0].collection_type.as_deref(), Some("index"));
        assert_eq!(collections[0].document_count, Some(42));
    }

    #[test]
    fn maps_index_mapping_to_columns() {
        let columns = elasticsearch_mapping_to_columns(
            &json!({
                "users": {
                    "mappings": {
                        "properties": {
                            "email": {"type": "keyword"},
                            "active": {"type": "boolean"},
                            "profile": {
                                "properties": {
                                    "age": {"type": "integer"},
                                    "bio": {"type": "text", "index": false}
                                }
                            }
                        }
                    }
                }
            }),
            "users",
            8,
        );

        let id = columns.iter().find(|column| column.name == "_id").unwrap();
        assert_eq!(id.data_type, "keyword");
        assert!(id.is_primary_key);
        assert!(id.is_unique);

        let email = columns
            .iter()
            .find(|column| column.name == "email")
            .unwrap();
        assert_eq!(email.data_type, "keyword");
        assert!(email.is_indexed);

        let profile = columns
            .iter()
            .find(|column| column.name == "profile")
            .unwrap();
        assert_eq!(profile.data_type, "object");

        let bio = columns
            .iter()
            .find(|column| column.name == "profile.bio")
            .unwrap();
        assert_eq!(bio.data_type, "text");
        assert!(!bio.is_indexed);
    }

    #[test]
    fn maps_elasticsearch_six_typed_mappings_to_columns() {
        let mapping = json!({
            "events": {
                "mappings": {
                    "event": {
                        "properties": {
                            "kind": {"type": "keyword"},
                            "created_at": {"type": "date"}
                        }
                    }
                }
            }
        });
        assert_eq!(
            elasticsearch_six_mapping_types(&mapping),
            vec!["event".to_string()]
        );
        let columns = elasticsearch_mapping_to_columns(&mapping, "events", 6);

        assert_eq!(
            columns
                .iter()
                .find(|column| column.name == "kind")
                .map(|column| column.data_type.as_str()),
            Some("keyword")
        );
        assert_eq!(
            columns
                .iter()
                .find(|column| column.name == "created_at")
                .map(|column| column.data_type.as_str()),
            Some("date")
        );
    }
}
