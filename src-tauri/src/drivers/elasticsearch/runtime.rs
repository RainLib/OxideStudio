use super::connection::{
    append_elasticsearch_base_path, elasticsearch_connection_options,
    elasticsearch_effective_response_status, elasticsearch_response_error, extract_basic_auth,
    join_elasticsearch_request_path, normalize_elasticsearch_base_url, safe_endpoint_label,
    strip_elasticsearch_internal_query_parameters,
};
use super::console::{
    elasticsearch_six_mapping_types, is_elasticsearch_ndjson_path, is_typeless_document_path,
    normalize_elasticsearch_ndjson_body, rewrite_elasticsearch_six_document_path,
    scope_search_request_to_index,
};
use super::models::{ElasticsearchDriver, ElasticsearchRequest, ElasticsearchTransportMode};
use super::results::{
    elasticsearch_aggregation_table_result, elasticsearch_request_result,
    elasticsearch_table_result, normalize_elasticsearch_response,
};
use crate::core::protocol::{QueryResponseMeta, QueryResult};
use anyhow::{anyhow, Context, Result};
use reqwest::{Client, Method, StatusCode, Url};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

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
            pit_shard_doc_supported: AtomicBool::new(true),
            index_grouping: options.index_grouping,
        })
    }

    pub(super) async fn active_index_name(&self) -> Option<String> {
        self.active_index.lock().await.clone()
    }

    pub(super) async fn ensure_connected(&self) -> Result<()> {
        if *self.connected.lock().await {
            Ok(())
        } else {
            Err(anyhow!("Elasticsearch connection is not established"))
        }
    }

    pub(super) async fn execute_requests(
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
            let mut result = elasticsearch_table_result(&normalized)
                .or_else(|| elasticsearch_aggregation_table_result(&normalized))
                .unwrap_or_else(|| elasticsearch_request_result(&request, status, normalized));
            result.response_meta = Some(response_meta);
            results.push(result);
        }

        Ok(results)
    }

    pub(super) async fn send_request(
        &self,
        request: &ElasticsearchRequest,
    ) -> Result<(u16, Value)> {
        self.ensure_connected().await?;
        self.send_request_unchecked(request).await
    }

    pub(super) async fn prepare_request_for_server(
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

    pub(super) async fn resolve_elasticsearch_six_mapping_type(
        &self,
        index: &str,
    ) -> Result<String> {
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

    pub(super) async fn send_request_unchecked(
        &self,
        request: &ElasticsearchRequest,
    ) -> Result<(u16, Value)> {
        let (status, body) = self.send_request_response(request).await?;
        if !status.is_success() {
            return Err(elasticsearch_response_error(status, &body));
        }
        Ok((status.as_u16(), body))
    }

    pub(super) async fn send_request_response(
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

    pub(super) fn build_transport_request(
        &self,
        request: &ElasticsearchRequest,
    ) -> Result<reqwest::Request> {
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

    pub(super) fn request_target(&self, request: &ElasticsearchRequest) -> Result<(Method, Url)> {
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
}
