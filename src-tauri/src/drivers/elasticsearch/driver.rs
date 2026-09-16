use super::collections::{
    elasticsearch_indices_to_collections, group_elasticsearch_collections,
    merge_elasticsearch_collections,
};
use super::connection::{
    elasticsearch_response_error, parse_elasticsearch_clear_result, parse_elasticsearch_server_info,
};
use super::console::{
    build_elasticsearch_index_clear_request, build_elasticsearch_index_metadata_request,
    elasticsearch_six_mapping_types, parse_elasticsearch_requests,
    validate_elasticsearch_index_context,
};
use super::documents::{
    build_elasticsearch_document_search_body, decode_elasticsearch_document_cursor,
    elasticsearch_document_hits, elasticsearch_document_result, elasticsearch_document_total,
    encode_elasticsearch_document_cursor, parse_elasticsearch_document_filter,
    parse_elasticsearch_document_sort,
};
use super::mappings::elasticsearch_mapping_to_columns;
use super::models::{ElasticsearchDocumentCursor, ElasticsearchDriver, ElasticsearchRequest};
use crate::core::driver::{DatabaseDriver, DocumentPageRequest};
use crate::core::protocol::{
    CollectionInfo, ColumnInfo, DocumentPage, QueryResult, SearchIndexClearResult,
    SearchIndexMetadataKind,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use reqwest::{Method, StatusCode};
use serde_json::Value;
use std::sync::atomic::Ordering;

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
        self.pit_shard_doc_supported.store(true, Ordering::Relaxed);

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
        self.pit_shard_doc_supported.store(true, Ordering::Relaxed);
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
