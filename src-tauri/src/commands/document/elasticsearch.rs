use crate::core::{
    manager::ConnectionManager,
    protocol::{Response, SearchIndexClearResult, SearchIndexMetadataKind},
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::State;

pub use super::models::{ElasticsearchIndexClearPlan, ExecuteElasticsearchIndexClearRequest};
use super::support::{confirm_bundled_elasticsearch, document_error};

pub(super) async fn resolve_elasticsearch_index(
    manager: &ConnectionManager,
    connection_id: &str,
    index: &str,
) -> Result<(String, Option<u64>), String> {
    let index = index.trim();
    if index.is_empty() {
        return Err("Elasticsearch index is required".to_string());
    }
    let collections = manager
        .get_collections(connection_id, "default")
        .await
        .map_err(|error| error.to_string())?;
    let collection = collections
        .into_iter()
        .find(|collection| {
            collection.name == index && collection.collection_type.as_deref() == Some("index")
        })
        .ok_or_else(|| {
            "The selected Elasticsearch index is no longer present in the active catalog"
                .to_string()
        })?;
    Ok((collection.name, collection.document_count))
}

pub(super) fn elasticsearch_clear_plan_token(
    connection_id: &str,
    server_version: Option<&str>,
    index: &str,
    request_preview: &str,
) -> String {
    let mut digest = Sha256::new();
    for value in [
        b"oxide-elasticsearch-index-clear-v1".as_slice(),
        connection_id.as_bytes(),
        server_version.unwrap_or("unknown").as_bytes(),
        index.as_bytes(),
        request_preview.as_bytes(),
    ] {
        digest.update(value);
        digest.update([0]);
    }
    format!("{:x}", digest.finalize())
}

pub(super) async fn build_elasticsearch_clear_plan(
    manager: &ConnectionManager,
    connection_id: &str,
    driver: &str,
    requested_index: &str,
) -> Result<ElasticsearchIndexClearPlan, String> {
    let server_version = confirm_bundled_elasticsearch(manager, connection_id, driver).await?;
    let (index, document_count) =
        resolve_elasticsearch_index(manager, connection_id, requested_index).await?;
    let is_pattern = index.contains('*') || index.contains('?');
    let request_preview = format!(
        "POST /{index}/_delete_by_query?conflicts=proceed&refresh=true\n{{ \"query\": {{ \"match_all\": {{}} }} }}"
    );
    let confirmation_phrase = is_pattern.then(|| format!("CLEAR {index}"));
    let confirmation_token = elasticsearch_clear_plan_token(
        connection_id,
        server_version.as_deref(),
        &index,
        &request_preview,
    );
    Ok(ElasticsearchIndexClearPlan {
        index,
        is_pattern,
        document_count,
        request_preview,
        confirmation_phrase,
        confirmation_token,
        server_version,
    })
}

#[tauri::command]
pub async fn get_elasticsearch_index_metadata(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    index: String,
    kind: SearchIndexMetadataKind,
) -> Result<Response<Value>, String> {
    let result: Result<Value, String> = async {
        confirm_bundled_elasticsearch(&manager, &connection_id, &driver).await?;
        let (index, _) = resolve_elasticsearch_index(&manager, &connection_id, &index).await?;
        manager
            .get_search_index_metadata(&connection_id, &index, kind)
            .await
            .map_err(|error| error.to_string())
    }
    .await;
    Ok(match result {
        Ok(metadata) => Response::ok(metadata),
        Err(error) => document_error("ELASTICSEARCH_INDEX_METADATA_ERROR", &error),
    })
}

#[tauri::command]
pub async fn preview_elasticsearch_index_clear(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    index: String,
) -> Result<Response<ElasticsearchIndexClearPlan>, String> {
    Ok(
        match build_elasticsearch_clear_plan(&manager, &connection_id, &driver, &index).await {
            Ok(plan) => Response::ok(plan),
            Err(error) => document_error("ELASTICSEARCH_INDEX_CLEAR_PREVIEW_ERROR", &error),
        },
    )
}

#[tauri::command]
pub async fn execute_elasticsearch_index_clear(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: ExecuteElasticsearchIndexClearRequest,
) -> Result<Response<SearchIndexClearResult>, String> {
    let result: Result<SearchIndexClearResult, String> = async {
        let plan =
            build_elasticsearch_clear_plan(&manager, &connection_id, &driver, &request.index)
                .await?;
        if request.confirmation_token.trim() != plan.confirmation_token {
            return Err(
                "Elasticsearch index target changed after preview; review the clear operation again"
                    .to_string(),
            );
        }
        if let Some(phrase) = plan.confirmation_phrase.as_deref() {
            if request.confirmation_phrase.trim() != phrase {
                return Err(format!("Type {phrase} exactly to clear this index pattern"));
            }
        }
        manager
            .clear_search_index_documents(&connection_id, &plan.index)
            .await
            .map_err(|error| error.to_string())
    }
    .await;
    Ok(match result {
        Ok(receipt) => Response::ok(receipt),
        Err(error) => document_error("ELASTICSEARCH_INDEX_CLEAR_EXECUTE_ERROR", &error),
    })
}
