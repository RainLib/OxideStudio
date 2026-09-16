use super::collections::{
    elasticsearch_alias_to_collections, elasticsearch_resolve_to_collections,
};
use super::connection::elasticsearch_response_error;
use super::models::{ElasticsearchDriver, ElasticsearchRequest};
use crate::core::protocol::CollectionInfo;
use anyhow::Result;
use reqwest::{Method, StatusCode};

impl ElasticsearchDriver {
    /// `_cat/indices` requires cluster `monitor` access. Least-privilege
    /// accounts often only have index metadata/read rights, so use `_resolve`
    /// first and `_alias` as a compatibility fallback rather than presenting
    /// an empty Explorer tree.
    pub(super) async fn list_collections_via_index_metadata(&self) -> Result<Vec<CollectionInfo>> {
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
