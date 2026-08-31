use crate::core::{
    driver::{DatabaseDriver, DocumentPageRequest},
    protocol::{
        CollectionInfo, ColumnDef, ColumnInfo, DocumentPage, QueryResponseMeta, QueryResult,
        SearchIndexClearResult, SearchIndexMetadataKind,
    },
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use percent_encoding::percent_decode_str;
use regex::Regex;
use reqwest::{Client, Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub struct ElasticsearchDriver {
    base_url: Url,
    client: Client,
    auth: Option<(String, String)>,
    transport_mode: ElasticsearchTransportMode,
    connectivity_check_path: String,
    connectivity_check_disabled: bool,
    server_info: Mutex<Option<ElasticsearchServerInfo>>,
    mapping_types: Mutex<HashMap<String, String>>,
    active_index: Mutex<Option<String>>,
    connected: Mutex<bool>,
    index_grouping: Option<Regex>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ElasticsearchTransportMode {
    Direct,
    KibanaProxy,
}

#[derive(Debug)]
struct ElasticsearchConnectionOptions {
    transport_mode: ElasticsearchTransportMode,
    kibana_base_path: String,
    connectivity_check_path: String,
    connectivity_check_disabled: bool,
    index_grouping: Option<Regex>,
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

const ELASTICSEARCH_PIT_KEEP_ALIVE: &str = "1m";
const ELASTICSEARCH_MAX_RESULT_WINDOW: usize = 10_000;
const ELASTICSEARCH_DOCUMENT_CURSOR_MAX_BYTES: usize = 64 * 1024;
const KIBANA_PROXY_STATUS_HEADER: &str = "x-console-proxy-status-code";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ElasticsearchDocumentCursor {
    Pit {
        pit_id: String,
        index: String,
        search_after: Vec<Value>,
        sort: Vec<Value>,
        limit: usize,
        filter: Option<Value>,
    },
    Offset {
        index: String,
        offset: usize,
        sort: Vec<Value>,
        limit: usize,
        filter: Option<Value>,
    },
}

fn encode_elasticsearch_document_cursor(cursor: &ElasticsearchDocumentCursor) -> Result<String> {
    let encoded = serde_json::to_vec(cursor).context("Failed to encode Elasticsearch cursor")?;
    if encoded.len() > ELASTICSEARCH_DOCUMENT_CURSOR_MAX_BYTES {
        return Err(anyhow!("Elasticsearch cursor exceeds the local size limit"));
    }
    Ok(URL_SAFE_NO_PAD.encode(encoded))
}

fn decode_elasticsearch_document_cursor(cursor: &str) -> Result<ElasticsearchDocumentCursor> {
    if cursor.is_empty() || cursor.len() > ELASTICSEARCH_DOCUMENT_CURSOR_MAX_BYTES * 2 {
        return Err(anyhow!("Invalid Elasticsearch cursor"));
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(cursor)
        .context("Invalid Elasticsearch cursor encoding")?;
    if decoded.len() > ELASTICSEARCH_DOCUMENT_CURSOR_MAX_BYTES {
        return Err(anyhow!("Elasticsearch cursor exceeds the local size limit"));
    }
    serde_json::from_slice(&decoded).context("Invalid Elasticsearch cursor payload")
}

fn parse_elasticsearch_document_filter(filter: Option<&str>) -> Result<Option<Value>> {
    let Some(filter) = filter.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let value: Value = serde_json::from_str(filter).context("Elasticsearch filter must be JSON")?;
    if !value.is_object() {
        return Err(anyhow!("Elasticsearch filter must be a JSON object"));
    }
    Ok(Some(value))
}

fn parse_elasticsearch_document_sort(sort: Option<&str>, pit: bool) -> Result<Vec<Value>> {
    let mut values = match sort.map(str::trim).filter(|value| !value.is_empty()) {
        None => Vec::new(),
        Some(sort) => {
            match serde_json::from_str::<Value>(sort).context("Elasticsearch sort must be JSON")? {
                Value::Array(values) => values,
                value @ Value::Object(_) => vec![value],
                _ => return Err(anyhow!("Elasticsearch sort must be a JSON object or array")),
            }
        }
    };
    if pit {
        if values.iter().all(|value| value.get("_shard_doc").is_none()) {
            values.push(json!({ "_shard_doc": "asc" }));
        }
    } else if values.is_empty() {
        values.push(json!({ "_doc": "asc" }));
    }
    Ok(values)
}

fn build_elasticsearch_document_search_body(
    limit: usize,
    filter: Option<&Value>,
    sort: &[Value],
    pit_id: Option<&str>,
    search_after: Option<&[Value]>,
    offset: Option<usize>,
) -> Value {
    let mut body = serde_json::Map::new();
    body.insert("size".to_string(), json!(limit));
    body.insert("track_total_hits".to_string(), Value::Bool(true));
    if let Some(filter) = filter {
        body.insert("query".to_string(), filter.clone());
    }
    body.insert("sort".to_string(), Value::Array(sort.to_vec()));
    if let Some(pit_id) = pit_id {
        body.insert(
            "pit".to_string(),
            json!({ "id": pit_id, "keep_alive": ELASTICSEARCH_PIT_KEEP_ALIVE }),
        );
    }
    if let Some(search_after) = search_after.filter(|values| !values.is_empty()) {
        body.insert(
            "search_after".to_string(),
            Value::Array(search_after.to_vec()),
        );
    }
    if let Some(offset) = offset.filter(|offset| *offset > 0) {
        body.insert("from".to_string(), json!(offset));
    }
    Value::Object(body)
}

fn elasticsearch_document_total(response: &Value) -> Option<u64> {
    let total = response.pointer("/hits/total")?;
    total
        .as_u64()
        .or_else(|| total.get("value").and_then(Value::as_u64))
}

fn elasticsearch_document_hits(response: &Value) -> &[Value] {
    response
        .pointer("/hits/hits")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn elasticsearch_document_result(response: &Value) -> QueryResult {
    let normalized = normalize_elasticsearch_response(response.clone());
    elasticsearch_table_result(&normalized)
        .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()))
}

impl ElasticsearchDriver {
    pub fn new(url: &str) -> Result<Self> {
        let mut base_url = normalize_elasticsearch_base_url(url)?;
        let options = elasticsearch_connection_options(&base_url)?;
        strip_elasticsearch_internal_query_parameters(&mut base_url);
        if options.transport_mode == ElasticsearchTransportMode::KibanaProxy {
            append_elasticsearch_base_path(&mut base_url, &options.kibana_base_path)?;
        }
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
            transport_mode: options.transport_mode,
            connectivity_check_path: options.connectivity_check_path,
            connectivity_check_disabled: options.connectivity_check_disabled,
            server_info: Mutex::new(None),
            mapping_types: Mutex::new(HashMap::new()),
            active_index: Mutex::new(None),
            connected: Mutex::new(false),
            index_grouping: options.index_grouping,
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
            let started_at = Instant::now();
            let (status, body) = self.send_request(&request).await?;
            let response_meta = QueryResponseMeta {
                request_method: request.method.as_str().to_string(),
                request_path: request.path.clone(),
                status,
                duration_ms: started_at.elapsed().as_millis() as u64,
                raw_response: body.clone(),
            };
            let normalized = normalize_elasticsearch_response(body);
            let mut result = if let Some(result) = elasticsearch_table_result(&normalized) {
                result
            } else {
                elasticsearch_request_result(&request, status, normalized)
            };
            result.response_meta = Some(response_meta);
            results.push(result);
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
        let (status, body) = self.send_request_response(request).await?;
        if !status.is_success() {
            return Err(elasticsearch_response_error(status, &body));
        }
        Ok((status.as_u16(), body))
    }

    async fn send_request_response(
        &self,
        request: &ElasticsearchRequest,
    ) -> Result<(StatusCode, Value)> {
        let transport_request = self.build_transport_request(request)?;
        let response = self.client.execute(transport_request).await.map_err(|error| {
            let endpoint = safe_endpoint_label(&self.base_url);
            let hint = if self.base_url.scheme() == "http" {
                " If this endpoint requires TLS, select an SSL mode so the connection uses HTTPS."
            } else {
                ""
            };
            anyhow!("Elasticsearch transport request to {endpoint} failed: {error}.{hint}")
        })?;
        let status = elasticsearch_effective_response_status(
            self.transport_mode,
            response.status(),
            response.headers(),
        );
        let text = response
            .text()
            .await
            .context("Failed to read Elasticsearch response")?;
        let body = if text.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text))
        };

        Ok((status, body))
    }

    fn build_transport_request(&self, request: &ElasticsearchRequest) -> Result<reqwest::Request> {
        let (method, url) = self.request_target(request)?;
        let mut builder = self.client.request(method, url);
        builder = builder.header("accept", "application/json");
        if self.transport_mode == ElasticsearchTransportMode::KibanaProxy {
            builder = builder
                .header("kbn-xsrf", "true")
                .header("osd-xsrf", "true");
        }
        if let Some((username, password)) = &self.auth {
            builder = builder.basic_auth(username, Some(password));
        }
        if let Some(body) = request
            .body
            .as_deref()
            .filter(|body| !body.trim().is_empty())
        {
            let (content_type, body) = if is_elasticsearch_ndjson_path(&request.path) {
                (
                    "application/x-ndjson",
                    normalize_elasticsearch_ndjson_body(body)?,
                )
            } else {
                ("application/json", body.to_string())
            };
            builder = builder.header("content-type", content_type).body(body);
        }
        builder
            .build()
            .context("Failed to build Elasticsearch transport request")
    }

    fn request_target(&self, request: &ElasticsearchRequest) -> Result<(Method, Url)> {
        match self.transport_mode {
            ElasticsearchTransportMode::Direct => {
                let url = join_elasticsearch_request_path(&self.base_url, &request.path)?;
                Ok((request.method.clone(), url))
            }
            ElasticsearchTransportMode::KibanaProxy => {
                let mut url =
                    join_elasticsearch_request_path(&self.base_url, "/api/console/proxy")?;
                url.query_pairs_mut()
                    .append_pair("path", &request.path)
                    .append_pair("method", request.method.as_str());
                Ok((Method::POST, url))
            }
        }
    }

    async fn open_document_pit(&self, index: &str) -> Result<String> {
        let request = ElasticsearchRequest {
            method: Method::POST,
            path: format!(
                "/{}/_pit?keep_alive={}",
                encode_elasticsearch_path_segment(index),
                ELASTICSEARCH_PIT_KEEP_ALIVE
            ),
            body: None,
        };
        let (_, body) = self.send_request(&request).await?;
        body.get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("Elasticsearch PIT response is missing its id"))
    }

    async fn close_document_pit(&self, pit_id: &str) -> Result<()> {
        let request = ElasticsearchRequest {
            method: Method::DELETE,
            path: "/_pit".to_string(),
            body: Some(json!({ "id": pit_id }).to_string()),
        };
        self.send_request(&request).await.map(|_| ())
    }

    async fn run_document_search(&self, path: String, body: Value) -> Result<Value> {
        let request = ElasticsearchRequest {
            method: Method::POST,
            path,
            body: Some(body.to_string()),
        };
        self.send_request(&request)
            .await
            .map(|(_, response)| response)
    }

    async fn first_document_page(
        &self,
        index: &str,
        limit: usize,
        filter: Option<Value>,
        requested_sort: Option<&str>,
    ) -> Result<DocumentPage> {
        let pit_sort = parse_elasticsearch_document_sort(requested_sort, true)?;
        match self.open_document_pit(index).await {
            Ok(pit_id) => {
                let body = build_elasticsearch_document_search_body(
                    limit,
                    filter.as_ref(),
                    &pit_sort,
                    Some(&pit_id),
                    None,
                    None,
                );
                match self.run_document_search("/_search".to_string(), body).await {
                    Ok(response) => {
                        let hits = elasticsearch_document_hits(&response);
                        let total = elasticsearch_document_total(&response);
                        let response_pit_id = response
                            .get("pit_id")
                            .and_then(Value::as_str)
                            .unwrap_or(&pit_id)
                            .to_string();
                        let next_cursor = hits
                            .last()
                            .and_then(|hit| hit.get("sort"))
                            .and_then(Value::as_array)
                            .filter(|_| hits.len() == limit)
                            .map(|search_after| {
                                encode_elasticsearch_document_cursor(
                                    &ElasticsearchDocumentCursor::Pit {
                                        pit_id: response_pit_id.clone(),
                                        index: index.to_string(),
                                        search_after: search_after.clone(),
                                        sort: pit_sort,
                                        limit,
                                        filter,
                                    },
                                )
                            })
                            .transpose()?;
                        if next_cursor.is_none() {
                            let _ = self.close_document_pit(&response_pit_id).await;
                        }
                        Ok(DocumentPage {
                            result: elasticsearch_document_result(&response),
                            next_cursor,
                            total,
                        })
                    }
                    Err(error) => {
                        let _ = self.close_document_pit(&pit_id).await;
                        Err(error)
                    }
                }
            }
            Err(error) => {
                tracing::debug!(error = %error, "Elasticsearch PIT is unavailable; using bounded offset pagination");
                let offset_sort = parse_elasticsearch_document_sort(requested_sort, false)?;
                self.offset_document_page(index, 0, limit, filter, offset_sort)
                    .await
            }
        }
    }

    async fn offset_document_page(
        &self,
        index: &str,
        offset: usize,
        limit: usize,
        filter: Option<Value>,
        sort: Vec<Value>,
    ) -> Result<DocumentPage> {
        if offset.saturating_add(limit) > ELASTICSEARCH_MAX_RESULT_WINDOW {
            return Err(anyhow!(
                "Elasticsearch offset pagination reached index.max_result_window; PIT is required for deeper pages"
            ));
        }
        let body = build_elasticsearch_document_search_body(
            limit,
            filter.as_ref(),
            &sort,
            None,
            None,
            Some(offset),
        );
        let response = self
            .run_document_search(
                format!("/{}/_search", encode_elasticsearch_path_segment(index)),
                body,
            )
            .await?;
        let hits = elasticsearch_document_hits(&response);
        let total = elasticsearch_document_total(&response);
        let next_offset = offset.saturating_add(hits.len());
        let has_more = hits.len() == limit
            && next_offset < ELASTICSEARCH_MAX_RESULT_WINDOW
            && total
                .map(|total| next_offset < total as usize)
                .unwrap_or(true);
        let next_cursor = has_more
            .then(|| {
                encode_elasticsearch_document_cursor(&ElasticsearchDocumentCursor::Offset {
                    index: index.to_string(),
                    offset: next_offset,
                    sort,
                    limit,
                    filter,
                })
            })
            .transpose()?;
        Ok(DocumentPage {
            result: elasticsearch_document_result(&response),
            next_cursor,
            total,
        })
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

        if self.connectivity_check_disabled {
            *self.connected.lock().await = true;
            *self.active_index.lock().await = None;
            return Ok(());
        }

        let request = ElasticsearchRequest {
            method: Method::GET,
            path: self.connectivity_check_path.clone(),
            body: None,
        };
        let (_, body) = self.send_request_unchecked(&request).await?;
        if self.connectivity_check_path == "/" {
            let server_info = parse_elasticsearch_server_info(&body)?;
            *self.server_info.lock().await = Some(server_info);
        } else {
            // A least-privilege account may only be allowed to probe an index.
            // The configured path proves connectivity; root version discovery is
            // best-effort and must not turn that successful probe into a failure.
            let version_request = ElasticsearchRequest {
                method: Method::GET,
                path: "/".to_string(),
                body: None,
            };
            if let Ok((status, body)) = self.send_request_response(&version_request).await {
                if status.is_success() {
                    if let Ok(server_info) = parse_elasticsearch_server_info(&body) {
                        *self.server_info.lock().await = Some(server_info);
                    }
                }
            }
        }
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
        self.ensure_connected().await?;
        if self.connectivity_check_disabled {
            return Ok(());
        }
        let request = ElasticsearchRequest {
            method: Method::GET,
            path: self.connectivity_check_path.clone(),
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
        self.ensure_connected().await?;
        let (status, body) = self.send_request_response(&request).await?;
        let collections = if status.is_success() {
            let indices = elasticsearch_indices_to_collections(body);
            // `_cat/indices` has useful document counts but does not list
            // aliases or data streams. Add their typed descriptors when the
            // least-privilege metadata endpoint is available; a failure here
            // must not hide the index catalog that was already authorized.
            match self.list_collections_via_index_metadata().await {
                Ok(metadata) => merge_elasticsearch_collections(indices, metadata),
                Err(error) => {
                    tracing::debug!(error = %error, "Elasticsearch alias/data-stream metadata is unavailable");
                    indices
                }
            }
        } else if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
            self.list_collections_via_index_metadata().await?
        } else {
            return Err(elasticsearch_response_error(status, &body));
        };
        Ok(group_elasticsearch_collections(
            collections,
            self.index_grouping.as_ref(),
        ))
    }

    async fn get_document_page(&self, request: DocumentPageRequest<'_>) -> Result<DocumentPage> {
        self.ensure_connected().await?;
        let index = validate_elasticsearch_index_context(request.collection)?
            .ok_or_else(|| anyhow!("Elasticsearch index is required"))?;
        let bounded_limit = request.limit.clamp(1, 1_000);
        let requested_filter = parse_elasticsearch_document_filter(request.filter)?;

        let Some(cursor) = request.cursor else {
            return self
                .first_document_page(&index, bounded_limit, requested_filter, request.sort)
                .await;
        };

        match decode_elasticsearch_document_cursor(cursor)? {
            ElasticsearchDocumentCursor::Pit {
                pit_id,
                index: cursor_index,
                search_after,
                sort: cursor_sort,
                limit: cursor_limit,
                filter: cursor_filter,
            } => {
                if cursor_index != index {
                    let _ = self.close_document_pit(&pit_id).await;
                    return Err(anyhow!("Elasticsearch cursor belongs to a different index"));
                }
                if cursor_limit != bounded_limit || cursor_filter != requested_filter {
                    let _ = self.close_document_pit(&pit_id).await;
                    return Err(anyhow!(
                        "Elasticsearch cursor no longer matches the current page or filter"
                    ));
                }
                let requested_sort = parse_elasticsearch_document_sort(request.sort, true)?;
                if requested_sort != cursor_sort {
                    let _ = self.close_document_pit(&pit_id).await;
                    return Err(anyhow!(
                        "Elasticsearch cursor no longer matches the current sort"
                    ));
                }
                let body = build_elasticsearch_document_search_body(
                    cursor_limit,
                    cursor_filter.as_ref(),
                    &cursor_sort,
                    Some(&pit_id),
                    Some(&search_after),
                    None,
                );
                let response = match self.run_document_search("/_search".to_string(), body).await {
                    Ok(response) => response,
                    Err(error) => {
                        let _ = self.close_document_pit(&pit_id).await;
                        return Err(error);
                    }
                };
                let hits = elasticsearch_document_hits(&response);
                let total = elasticsearch_document_total(&response);
                let response_pit_id = response
                    .get("pit_id")
                    .and_then(Value::as_str)
                    .unwrap_or(&pit_id)
                    .to_string();
                let next_cursor = hits
                    .last()
                    .and_then(|hit| hit.get("sort"))
                    .and_then(Value::as_array)
                    .filter(|_| hits.len() == cursor_limit)
                    .map(|next_search_after| {
                        encode_elasticsearch_document_cursor(&ElasticsearchDocumentCursor::Pit {
                            pit_id: response_pit_id.clone(),
                            index,
                            search_after: next_search_after.clone(),
                            sort: cursor_sort,
                            limit: cursor_limit,
                            filter: cursor_filter,
                        })
                    })
                    .transpose()?;
                Ok(DocumentPage {
                    result: elasticsearch_document_result(&response),
                    next_cursor,
                    total,
                })
            }
            ElasticsearchDocumentCursor::Offset {
                index: cursor_index,
                offset,
                sort: cursor_sort,
                limit: cursor_limit,
                filter: cursor_filter,
            } => {
                if cursor_index != index
                    || cursor_limit != bounded_limit
                    || cursor_filter != requested_filter
                    || cursor_sort != parse_elasticsearch_document_sort(request.sort, false)?
                {
                    return Err(anyhow!(
                        "Elasticsearch cursor no longer matches the current index, page, filter, or sort"
                    ));
                }
                self.offset_document_page(&index, offset, cursor_limit, cursor_filter, cursor_sort)
                    .await
            }
        }
    }

    async fn close_document_cursor(&self, cursor: &str) -> Result<()> {
        match decode_elasticsearch_document_cursor(cursor)? {
            ElasticsearchDocumentCursor::Pit { pit_id, .. } => {
                self.close_document_pit(&pit_id).await
            }
            ElasticsearchDocumentCursor::Offset { .. } => Ok(()),
        }
    }

    async fn get_search_index_metadata(
        &self,
        index: &str,
        kind: SearchIndexMetadataKind,
    ) -> Result<Value> {
        self.ensure_connected().await?;
        let request = build_elasticsearch_index_metadata_request(index, kind)?;
        self.send_request(&request)
            .await
            .map(|(_, response)| response)
    }

    async fn clear_search_index_documents(&self, index: &str) -> Result<SearchIndexClearResult> {
        self.ensure_connected().await?;
        let request = build_elasticsearch_index_clear_request(index)?;
        let (_, response) = self.send_request(&request).await?;
        parse_elasticsearch_clear_result(&response)
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

impl ElasticsearchDriver {
    /// `_cat/indices` requires cluster `monitor` access. Least-privilege
    /// accounts often only have index metadata/read rights, so use `_resolve`
    /// first and `_alias` as a compatibility fallback rather than presenting
    /// an empty Explorer tree.
    async fn list_collections_via_index_metadata(&self) -> Result<Vec<CollectionInfo>> {
        let resolve_request = ElasticsearchRequest {
            method: Method::GET,
            path: "/_resolve/index/*".to_string(),
            body: None,
        };
        let (status, body) = self.send_request_response(&resolve_request).await?;
        if status.is_success() {
            return Ok(elasticsearch_resolve_to_collections(&body));
        }
        // `_resolve` is unavailable on older Elasticsearch releases. Keep the
        // compatibility alias endpoint for both insufficient privileges and
        // a server which does not expose `_resolve` yet.
        if !matches!(
            status,
            StatusCode::UNAUTHORIZED
                | StatusCode::FORBIDDEN
                | StatusCode::NOT_FOUND
                | StatusCode::METHOD_NOT_ALLOWED
        ) {
            return Err(elasticsearch_response_error(status, &body));
        }

        let alias_request = ElasticsearchRequest {
            method: Method::GET,
            path: "/_alias".to_string(),
            body: None,
        };
        let (status, body) = self.send_request_response(&alias_request).await?;
        if status.is_success() {
            return Ok(elasticsearch_alias_to_collections(&body));
        }
        Err(elasticsearch_response_error(status, &body))
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

fn elasticsearch_connection_options(url: &Url) -> Result<ElasticsearchConnectionOptions> {
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

fn strip_elasticsearch_internal_query_parameters(url: &mut Url) {
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

fn normalize_kibana_base_path(value: &str) -> Result<String> {
    let value = value.trim().trim_matches('/');
    if value.is_empty() {
        return Ok(String::new());
    }
    validate_elasticsearch_local_path(value, "Kibana base path")?;
    Ok(format!("/{value}"))
}

fn normalize_elasticsearch_connectivity_check_path(value: &str) -> Result<String> {
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

fn validate_elasticsearch_local_path(path: &str, label: &str) -> Result<()> {
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

fn is_enabled_connection_option(value: &str) -> bool {
    let value = value.trim();
    value.eq_ignore_ascii_case("true")
        || value == "1"
        || value.eq_ignore_ascii_case("yes")
        || value.eq_ignore_ascii_case("on")
}

fn elasticsearch_effective_response_status(
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

fn append_elasticsearch_base_path(url: &mut Url, base_path: &str) -> Result<()> {
    if base_path.is_empty() {
        return Ok(());
    }
    let existing = url.path().trim_end_matches('/');
    let combined = format!("{existing}{base_path}");
    url.set_path(&combined);
    Ok(())
}

fn join_elasticsearch_request_path(base_url: &Url, request_path: &str) -> Result<Url> {
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

fn parse_elasticsearch_clear_result(value: &Value) -> Result<SearchIndexClearResult> {
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

fn is_elasticsearch_ndjson_path(path: &str) -> bool {
    let path = path.split('?').next().unwrap_or(path).trim_end_matches('/');
    path == "/_bulk"
        || path.ends_with("/_bulk")
        || path == "/_msearch"
        || path.ends_with("/_msearch")
        || path == "/_msearch/template"
        || path.ends_with("/_msearch/template")
}

fn normalize_elasticsearch_ndjson_body(body: &str) -> Result<String> {
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

fn strip_elasticsearch_console_comments(input: &str) -> String {
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

fn validate_elasticsearch_index_target(value: &str) -> Result<String> {
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

fn encode_elasticsearch_index_target(value: &str) -> String {
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

fn build_elasticsearch_index_metadata_request(
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

fn build_elasticsearch_index_clear_request(index: &str) -> Result<ElasticsearchRequest> {
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
    let mut collections: Vec<CollectionInfo> = value
        .as_array()
        .map(|indices| {
            indices
                .iter()
                .filter_map(|index| {
                    let name = normalize_elasticsearch_collection_name(
                        index.get("index").and_then(Value::as_str)?.to_string(),
                    )?;
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
        .unwrap_or_default();
    collections.sort_by(|left: &CollectionInfo, right| left.name.cmp(&right.name));
    collections.dedup_by(|left, right| left.name == right.name);
    collections
}

fn elasticsearch_index_grouping_pattern(url: &Url) -> Option<Regex> {
    let pattern = url
        .query_pairs()
        .find(|(key, _)| key.eq_ignore_ascii_case("indexGroupingPattern"))
        .map(|(_, value)| value.trim().to_string())?;
    if pattern.is_empty()
        || pattern.eq_ignore_ascii_case("off")
        || pattern.eq_ignore_ascii_case("none")
        || pattern.eq_ignore_ascii_case("false")
    {
        return None;
    }
    Regex::new(&pattern).ok()
}

fn normalize_elasticsearch_collection_name(name: String) -> Option<String> {
    let name = name.trim().to_string();
    (!name.is_empty() && !name.starts_with('.')).then_some(name)
}

fn elasticsearch_resolve_to_collections(value: &Value) -> Vec<CollectionInfo> {
    let mut collections = Vec::new();
    for (field, collection_type) in [
        ("indices", "index"),
        ("aliases", "alias"),
        ("data_streams", "data_stream"),
    ] {
        let names = value
            .get(field)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| item.get("name").and_then(Value::as_str))
            .map(str::to_string);
        collections.extend(elasticsearch_collection_names(names, collection_type));
    }
    sort_and_deduplicate_elasticsearch_collections(collections)
}

fn elasticsearch_alias_to_collections(value: &Value) -> Vec<CollectionInfo> {
    elasticsearch_collection_names(
        value
            .as_object()
            .into_iter()
            .flat_map(|objects| objects.keys().cloned()),
        "alias",
    )
}

fn elasticsearch_collection_names(
    names: impl IntoIterator<Item = String>,
    collection_type: &str,
) -> Vec<CollectionInfo> {
    let mut names = names
        .into_iter()
        .filter_map(normalize_elasticsearch_collection_name)
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
        .into_iter()
        .map(|name| CollectionInfo {
            name,
            namespace: Some("default".to_string()),
            collection_type: Some(collection_type.to_string()),
            document_count: None,
        })
        .collect()
}

fn merge_elasticsearch_collections(
    collections: Vec<CollectionInfo>,
    additional: Vec<CollectionInfo>,
) -> Vec<CollectionInfo> {
    sort_and_deduplicate_elasticsearch_collections(
        collections.into_iter().chain(additional).collect(),
    )
}

fn sort_and_deduplicate_elasticsearch_collections(
    mut collections: Vec<CollectionInfo>,
) -> Vec<CollectionInfo> {
    collections.sort_by(|left, right| {
        (left.name.as_str(), left.collection_type.as_deref())
            .cmp(&(right.name.as_str(), right.collection_type.as_deref()))
    });
    collections.dedup_by(|left, right| {
        if left.name != right.name || left.collection_type != right.collection_type {
            return false;
        }
        if left.document_count.is_none() {
            left.document_count = right.document_count;
        }
        true
    });
    collections
}

fn group_elasticsearch_collections(
    collections: Vec<CollectionInfo>,
    pattern: Option<&Regex>,
) -> Vec<CollectionInfo> {
    let Some(pattern) = pattern else {
        return collections;
    };
    let mut groups = BTreeMap::<(String, Option<String>), CollectionInfo>::new();
    for mut collection in collections {
        if collection.collection_type.as_deref() != Some("index") {
            groups.insert(
                (collection.name.clone(), collection.collection_type.clone()),
                collection,
            );
            continue;
        }
        let grouped_name = pattern.replace(&collection.name, "${1}*").into_owned();
        collection.name = grouped_name.clone();
        groups
            .entry((grouped_name, collection.collection_type.clone()))
            .and_modify(|existing| {
                existing.document_count = match (existing.document_count, collection.document_count)
                {
                    (Some(left), Some(right)) => Some(left.saturating_add(right)),
                    _ => None,
                };
            })
            .or_insert(collection);
    }
    groups.into_values().collect()
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
        is_generated: Some(false),
        is_hidden: Some(false),
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
                is_generated: Some(false),
                is_hidden: Some(false),
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
    fn document_cursor_round_trips_without_exposing_raw_pit_json() {
        let cursor = ElasticsearchDocumentCursor::Pit {
            pit_id: "pit/opaque+value".to_string(),
            index: "orders".to_string(),
            search_after: vec![json!(42), json!("shard")],
            sort: vec![
                json!({ "created_at": "desc" }),
                json!({ "_shard_doc": "asc" }),
            ],
            limit: 250,
            filter: Some(json!({ "term": { "tenant": "acme" } })),
        };

        let encoded = encode_elasticsearch_document_cursor(&cursor).unwrap();
        assert!(!encoded.contains("pit/opaque"));
        assert_eq!(
            decode_elasticsearch_document_cursor(&encoded).unwrap(),
            cursor
        );
    }

    #[test]
    fn pit_search_body_uses_stable_tiebreaker_and_continuation() {
        let sort =
            parse_elasticsearch_document_sort(Some(r#"[{"created_at":"desc"}]"#), true).unwrap();
        assert_eq!(sort.last(), Some(&json!({ "_shard_doc": "asc" })));

        let body = build_elasticsearch_document_search_body(
            100,
            Some(&json!({ "match_all": {} })),
            &sort,
            Some("pit-1"),
            Some(&[json!("2026-08-30"), json!(7)]),
            None,
        );
        assert_eq!(body["size"], 100);
        assert_eq!(body["pit"]["id"], "pit-1");
        assert_eq!(body["search_after"], json!(["2026-08-30", 7]));
        assert!(body.get("from").is_none());
    }

    #[test]
    fn document_total_accepts_legacy_and_object_shapes() {
        assert_eq!(
            elasticsearch_document_total(&json!({ "hits": { "total": 12, "hits": [] } })),
            Some(12)
        );
        assert_eq!(
            elasticsearch_document_total(
                &json!({ "hits": { "total": { "value": 34, "relation": "eq" }, "hits": [] } })
            ),
            Some(34)
        );
    }

    #[test]
    fn groups_rolling_index_collections_and_preserves_document_counts() {
        let pattern = Regex::new(r"[-_.@]\d{4}[-_.]?\d{2}[-_.]?\d{2}.*$").unwrap();
        let collections = elasticsearch_indices_to_collections(json!([
            { "index": ".security-7", "docs.count": "1" },
            { "index": "logs-2026.08.10", "docs.count": "7" },
            { "index": "logs-2026.08.11", "docs.count": "11" },
            { "index": "orders-2026.08.10", "docs.count": "3" }
        ]));

        let grouped = group_elasticsearch_collections(collections, Some(&pattern));
        assert_eq!(
            grouped
                .iter()
                .map(|collection| (collection.name.as_str(), collection.document_count))
                .collect::<Vec<_>>(),
            vec![("logs*", Some(18)), ("orders*", Some(3))]
        );
    }

    #[test]
    fn resolves_visible_indices_and_data_streams_without_cluster_monitor() {
        let collections = elasticsearch_resolve_to_collections(&json!({
            "indices": [{ "name": "logs-2026.08.11" }, { "name": ".kibana" }],
            "data_streams": [{ "name": "metrics-prod" }]
        }));

        assert_eq!(
            collections
                .iter()
                .map(|collection| collection.name.as_str())
                .collect::<Vec<_>>(),
            vec!["logs-2026.08.11", "metrics-prod"]
        );
        assert_eq!(
            collections
                .iter()
                .map(|collection| collection.collection_type.as_deref())
                .collect::<Vec<_>>(),
            vec![Some("index"), Some("data_stream")]
        );

        let aliases = elasticsearch_alias_to_collections(&json!({
            ".security": {},
            "logs-2026.08.11": {},
            "orders": {}
        }));
        assert_eq!(
            aliases
                .iter()
                .map(|collection| collection.name.as_str())
                .collect::<Vec<_>>(),
            vec!["logs-2026.08.11", "orders"]
        );
        assert!(aliases
            .iter()
            .all(|collection| collection.collection_type.as_deref() == Some("alias")));
    }

    #[test]
    fn merges_index_counts_with_typed_alias_and_data_stream_descriptors() {
        let merged = merge_elasticsearch_collections(
            elasticsearch_indices_to_collections(json!([
                { "index": "orders", "docs.count": "42" }
            ])),
            elasticsearch_resolve_to_collections(&json!({
                "indices": [{ "name": "orders" }],
                "aliases": [{ "name": "orders-read" }],
                "data_streams": [{ "name": "logs-prod" }]
            })),
        );
        assert_eq!(
            merged
                .iter()
                .map(|collection| (
                    collection.name.as_str(),
                    collection.collection_type.as_deref(),
                    collection.document_count,
                ))
                .collect::<Vec<_>>(),
            vec![
                ("logs-prod", Some("data_stream"), None),
                ("orders", Some("index"), Some(42)),
                ("orders-read", Some("alias"), None),
            ]
        );
    }

    #[test]
    fn grouping_patterns_do_not_rewrite_aliases_or_data_streams() {
        let pattern = Regex::new(r"-\d{4}\.\d{2}\.\d{2}$").unwrap();
        let grouped = group_elasticsearch_collections(
            vec![
                CollectionInfo {
                    name: "logs-2026.08.11".to_string(),
                    namespace: Some("default".to_string()),
                    collection_type: Some("index".to_string()),
                    document_count: Some(5),
                },
                CollectionInfo {
                    name: "logs-read".to_string(),
                    namespace: Some("default".to_string()),
                    collection_type: Some("alias".to_string()),
                    document_count: None,
                },
                CollectionInfo {
                    name: "logs-stream".to_string(),
                    namespace: Some("default".to_string()),
                    collection_type: Some("data_stream".to_string()),
                    document_count: None,
                },
            ],
            Some(&pattern),
        );
        assert_eq!(
            grouped
                .iter()
                .map(|collection| (
                    collection.name.as_str(),
                    collection.collection_type.as_deref()
                ))
                .collect::<Vec<_>>(),
            vec![
                ("logs*", Some("index")),
                ("logs-read", Some("alias")),
                ("logs-stream", Some("data_stream")),
            ]
        );
    }

    #[test]
    fn reads_optional_index_grouping_pattern_from_connection_url() {
        let url = normalize_elasticsearch_base_url(
            "http://localhost:9200?indexGroupingPattern=%5B-_%5D%5Cd%2B&ssl=disable",
        )
        .unwrap();
        assert_eq!(
            elasticsearch_index_grouping_pattern(&url)
                .as_ref()
                .map(|pattern| pattern.as_str()),
            Some("[-_]\\d+")
        );
        assert!(elasticsearch_index_grouping_pattern(
            &normalize_elasticsearch_base_url("http://localhost:9200?indexGroupingPattern=off")
                .unwrap()
        )
        .is_none());
    }

    #[test]
    fn parses_and_strips_elasticsearch_transport_options() {
        let mut url = normalize_elasticsearch_base_url(
            "http://localhost:5601/root?mode=kibana&kibanaBasePath=%2Fkibana%2Fs%2Fanalytics%2F&connectivityCheckPath=GET%20logs-%2A%2F_search&connectivityCheckDisabled=yes&indexGroupingPattern=%5B-_%5D%5Cd%2B",
        )
        .unwrap();
        let options = elasticsearch_connection_options(&url).unwrap();

        assert_eq!(
            options.transport_mode,
            ElasticsearchTransportMode::KibanaProxy
        );
        assert_eq!(options.kibana_base_path, "/kibana/s/analytics");
        assert_eq!(options.connectivity_check_path, "/logs-*/_search");
        assert!(options.connectivity_check_disabled);
        assert_eq!(
            options.index_grouping.as_ref().map(Regex::as_str),
            Some("[-_]\\d+")
        );

        strip_elasticsearch_internal_query_parameters(&mut url);
        assert!(url.query().is_none());
        append_elasticsearch_base_path(&mut url, &options.kibana_base_path).unwrap();
        assert_eq!(
            url.as_str(),
            "http://localhost:5601/root/kibana/s/analytics"
        );
    }

    #[test]
    fn normalizes_connectivity_paths_and_rejects_remote_targets() {
        assert_eq!(
            normalize_elasticsearch_connectivity_check_path("GET my-index/_search\n{\"query\":{}}")
                .unwrap(),
            "/my-index/_search"
        );
        assert_eq!(
            normalize_elasticsearch_connectivity_check_path("").unwrap(),
            "/"
        );
        assert!(normalize_elasticsearch_connectivity_check_path("https://example.com/").is_err());
        assert!(normalize_kibana_base_path("/../admin").is_err());
    }

    #[test]
    fn builds_kibana_console_proxy_target_and_uses_proxy_status() {
        let driver = ElasticsearchDriver::new(
            "http://localhost:5601?mode=kibana&kibanaBasePath=%2Fs%2Fanalytics",
        )
        .unwrap();
        let request = ElasticsearchRequest {
            method: Method::DELETE,
            path: "/logs-2026/_doc/1?refresh=true".to_string(),
            body: None,
        };
        let (method, url) = driver.request_target(&request).unwrap();

        assert_eq!(method, Method::POST);
        assert_eq!(url.path(), "/s/analytics/api/console/proxy");
        let query = url.query_pairs().collect::<HashMap<_, _>>();
        assert_eq!(
            query.get("path").map(|value| value.as_ref()),
            Some("/logs-2026/_doc/1?refresh=true")
        );
        assert_eq!(
            query.get("method").map(|value| value.as_ref()),
            Some("DELETE")
        );

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(KIBANA_PROXY_STATUS_HEADER, "404".parse().unwrap());
        assert_eq!(
            elasticsearch_effective_response_status(
                ElasticsearchTransportMode::KibanaProxy,
                StatusCode::OK,
                &headers,
            ),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            elasticsearch_effective_response_status(
                ElasticsearchTransportMode::Direct,
                StatusCode::OK,
                &headers,
            ),
            StatusCode::OK
        );

        let transport_request = driver
            .build_transport_request(&ElasticsearchRequest {
                method: Method::POST,
                path: "/_bulk".to_string(),
                body: Some("{\"index\":{}}\n{\"message\":\"ok\"}".to_string()),
            })
            .unwrap();
        assert_eq!(transport_request.method(), Method::POST);
        assert_eq!(
            transport_request
                .headers()
                .get("kbn-xsrf")
                .and_then(|value| value.to_str().ok()),
            Some("true")
        );
        assert_eq!(
            transport_request
                .headers()
                .get("osd-xsrf")
                .and_then(|value| value.to_str().ok()),
            Some("true")
        );
        assert_eq!(
            transport_request
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("application/x-ndjson")
        );
        assert!(transport_request
            .body()
            .and_then(reqwest::Body::as_bytes)
            .is_some_and(|body| body.ends_with(b"\n")));
    }

    #[tokio::test]
    async fn disabled_connectivity_check_marks_driver_connected_without_version_probe() {
        let mut driver =
            ElasticsearchDriver::new("http://127.0.0.1:9?connectivityCheckDisabled=true").unwrap();

        driver.connect().await.unwrap();
        assert!(driver.server_version().await.is_none());
        driver.ping().await.unwrap();
    }

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

    #[tokio::test]
    async fn prepares_document_paths_for_elasticsearch_six_seven_and_eight() {
        for (version, major, expected_path) in [
            ("6.8.23", 6, "/events/event/42"),
            ("7.17.29", 7, "/events/_doc/42"),
            ("8.19.4", 8, "/events/_doc/42"),
        ] {
            let driver = ElasticsearchDriver::new("http://localhost:9200").unwrap();
            *driver.server_info.lock().await = Some(ElasticsearchServerInfo {
                version: version.to_string(),
                major,
            });
            driver
                .mapping_types
                .lock()
                .await
                .insert("events".to_string(), "event".to_string());

            let prepared = driver
                .prepare_request_for_server(ElasticsearchRequest {
                    method: Method::GET,
                    path: "/events/_doc/42".to_string(),
                    body: None,
                })
                .await
                .unwrap();
            assert_eq!(prepared.path, expected_path, "Elasticsearch {version}");
        }
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
    fn strips_console_comments_without_changing_json_strings() {
        let requests = parse_elasticsearch_requests(
            r#"
            # GET /ignored
            /*
            POST /also-ignored/_search
            {}
            */
            POST /users/_search
            {
              // Search only the API URL stored in the document.
              "url": "https://example.test/path#fragment",
              "query": {"match_all": {}}
            }
            "#,
        )
        .unwrap();

        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].path, "/users/_search");
        let body = requests[0].body.as_deref().unwrap();
        assert!(!body.contains("Search only"));
        assert!(body.contains("https://example.test/path#fragment"));
        assert!(serde_json::from_str::<Value>(body).is_ok());
    }

    #[test]
    fn rejects_invalid_request_lines() {
        assert!(parse_elasticsearch_requests("GET").is_err());
        assert!(parse_elasticsearch_requests("GET https://other.test/_search").is_err());
        assert!(parse_elasticsearch_requests("not-json").is_err());
    }

    #[test]
    fn validates_and_terminates_ndjson_request_bodies() {
        assert!(is_elasticsearch_ndjson_path("/logs/_bulk?refresh=true"));
        assert!(is_elasticsearch_ndjson_path("/_msearch/template"));
        assert!(!is_elasticsearch_ndjson_path("/logs/_search"));

        let normalized = normalize_elasticsearch_ndjson_body(
            "{\"index\":{\"_index\":\"logs\"}}\n{\"message\":\"ok\"}",
        )
        .unwrap();
        assert!(normalized.ends_with('\n'));
        assert_eq!(normalized.lines().count(), 2);
        assert!(normalize_elasticsearch_ndjson_body("{invalid}").is_err());
        assert!(normalize_elasticsearch_ndjson_body("\n\n").is_err());
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
        assert!(result.response_meta.is_none());
    }

    #[test]
    fn maps_cat_indices_to_collections() {
        let collections = elasticsearch_indices_to_collections(json!([
            {"index": "users", "docs.count": "42"},
            {"index": "orders", "docs.count": "7"}
        ]));

        assert_eq!(collections.len(), 2);
        assert_eq!(collections[0].name, "orders");
        assert_eq!(collections[0].collection_type.as_deref(), Some("index"));
        assert_eq!(collections[0].document_count, Some(7));
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

    #[test]
    fn validates_and_encodes_bounded_index_management_targets() {
        assert_eq!(
            validate_elasticsearch_index_target("logs-2026.*").unwrap(),
            "logs-2026.*"
        );
        assert_eq!(
            encode_elasticsearch_index_target("logs-????.08"),
            "logs-%3F%3F%3F%3F.08"
        );
        for target in ["", "*", "?", "_all", "logs,orders", "../logs", "Logs"] {
            assert!(
                validate_elasticsearch_index_target(target).is_err(),
                "unexpected valid target: {target}"
            );
        }
    }

    #[test]
    fn builds_closed_metadata_and_clear_transport_contracts() {
        let settings = build_elasticsearch_index_metadata_request(
            "logs-????.08",
            SearchIndexMetadataKind::Settings,
        )
        .unwrap();
        assert_eq!(settings.method, Method::GET);
        assert_eq!(settings.path, "/logs-%3F%3F%3F%3F.08/_settings");
        assert!(settings.body.is_none());

        let clear = build_elasticsearch_index_clear_request("logs-*").unwrap();
        assert_eq!(clear.method, Method::POST);
        assert_eq!(
            clear.path,
            "/logs-*/_delete_by_query?conflicts=proceed&refresh=true"
        );
        assert_eq!(clear.body.as_deref(), Some(r#"{"query":{"match_all":{}}}"#));
    }

    #[test]
    fn parses_delete_by_query_partial_outcome_and_bounds_failure_details() {
        let oversized = "x".repeat(2_100);
        let result = parse_elasticsearch_clear_result(&json!({
            "total": 10,
            "deleted": 8,
            "version_conflicts": 2,
            "timed_out": false,
            "failures": [{"reason": oversized}]
        }))
        .unwrap();

        assert_eq!(result.total, 10);
        assert_eq!(result.deleted, 8);
        assert_eq!(result.version_conflicts, 2);
        assert!(!result.timed_out);
        assert_eq!(result.failures.len(), 1);
        assert!(result.failures[0].chars().count() <= 2_001);
        assert!(parse_elasticsearch_clear_result(&json!({"deleted": 1})).is_err());
    }
}
