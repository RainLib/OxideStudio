use super::connection::{elasticsearch_response_error, elasticsearch_response_lacks_pit_shard_doc};
use super::console::encode_elasticsearch_path_segment;
use super::models::{
    ElasticsearchDocumentCursor, ElasticsearchDriver, ElasticsearchRequest,
    ELASTICSEARCH_DOCUMENT_CURSOR_MAX_BYTES, ELASTICSEARCH_MAX_RESULT_WINDOW,
    ELASTICSEARCH_PIT_KEEP_ALIVE,
};
use super::results::{elasticsearch_table_result, normalize_elasticsearch_response};
use crate::core::protocol::{DocumentPage, QueryResult};
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;

pub(super) fn encode_elasticsearch_document_cursor(
    cursor: &ElasticsearchDocumentCursor,
) -> Result<String> {
    let encoded = serde_json::to_vec(cursor).context("Failed to encode Elasticsearch cursor")?;
    if encoded.len() > ELASTICSEARCH_DOCUMENT_CURSOR_MAX_BYTES {
        return Err(anyhow!("Elasticsearch cursor exceeds the local size limit"));
    }
    Ok(URL_SAFE_NO_PAD.encode(encoded))
}

pub(super) fn decode_elasticsearch_document_cursor(
    cursor: &str,
) -> Result<ElasticsearchDocumentCursor> {
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

pub(super) fn parse_elasticsearch_document_filter(filter: Option<&str>) -> Result<Option<Value>> {
    let Some(filter) = filter.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let value: Value = serde_json::from_str(filter).context("Elasticsearch filter must be JSON")?;
    if !value.is_object() {
        return Err(anyhow!("Elasticsearch filter must be a JSON object"));
    }
    Ok(Some(value))
}

pub(super) fn parse_elasticsearch_document_sort(
    sort: Option<&str>,
    pit: bool,
) -> Result<Vec<Value>> {
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

pub(super) fn build_elasticsearch_document_search_body(
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
    if let Some(offset) = offset {
        body.insert("from".to_string(), json!(offset));
    }
    Value::Object(body)
}

pub(super) fn elasticsearch_document_total(response: &Value) -> Option<u64> {
    let total = response.pointer("/hits/total")?;
    total
        .as_u64()
        .or_else(|| total.get("value").and_then(Value::as_u64))
}

pub(super) fn elasticsearch_document_hits(response: &Value) -> &[Value] {
    response
        .pointer("/hits/hits")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

pub(super) fn elasticsearch_document_result(response: &Value) -> QueryResult {
    let normalized = normalize_elasticsearch_response(response.clone());
    elasticsearch_table_result(&normalized)
        .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()))
}

impl ElasticsearchDriver {
    pub(super) async fn open_document_pit(&self, index: &str) -> Result<String> {
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

    pub(super) async fn close_document_pit(&self, pit_id: &str) -> Result<()> {
        let request = ElasticsearchRequest {
            method: Method::DELETE,
            path: "/_pit".to_string(),
            body: Some(json!({ "id": pit_id }).to_string()),
        };
        self.send_request(&request).await.map(|_| ())
    }

    pub(super) async fn run_document_search(&self, path: String, body: Value) -> Result<Value> {
        let (status, response) = self.run_document_search_response(path, body).await?;
        if !status.is_success() {
            return Err(elasticsearch_response_error(status, &response));
        }
        Ok(response)
    }

    pub(super) async fn run_document_search_response(
        &self,
        path: String,
        body: Value,
    ) -> Result<(StatusCode, Value)> {
        self.ensure_connected().await?;
        let request = ElasticsearchRequest {
            method: Method::POST,
            path,
            body: Some(body.to_string()),
        };
        self.send_request_response(&request).await
    }

    pub(super) async fn first_document_page(
        &self,
        index: &str,
        limit: usize,
        filter: Option<Value>,
        requested_sort: Option<&str>,
    ) -> Result<DocumentPage> {
        if !self.pit_shard_doc_supported.load(Ordering::Relaxed) {
            let offset_sort = parse_elasticsearch_document_sort(requested_sort, false)?;
            return self
                .offset_document_page(index, 0, limit, filter, offset_sort)
                .await;
        }

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
                match self
                    .run_document_search_response("/_search".to_string(), body)
                    .await
                {
                    Ok((status, response)) if status.is_success() => {
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
                    Ok((status, response))
                        if elasticsearch_response_lacks_pit_shard_doc(status, &response) =>
                    {
                        let _ = self.close_document_pit(&pit_id).await;
                        self.pit_shard_doc_supported.store(false, Ordering::Relaxed);
                        tracing::debug!(
                            "Elasticsearch PIT does not expose _shard_doc; using bounded offset pagination for this connection"
                        );
                        let offset_sort = parse_elasticsearch_document_sort(requested_sort, false)?;
                        self.offset_document_page(index, 0, limit, filter, offset_sort)
                            .await
                    }
                    Ok((status, response)) => {
                        let _ = self.close_document_pit(&pit_id).await;
                        Err(elasticsearch_response_error(status, &response))
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

    pub(super) async fn offset_document_page(
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
