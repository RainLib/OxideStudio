//! Reviewed native document mutations.
//!
//! The desktop never turns a rendered grid row directly into a MongoDB
//! insert. The driver re-reads the selected `_id`, preserves unedited BSON
//! values, and binds the source fingerprint plus edited fields into a plan
//! token before the clone can be inserted.

use crate::core::{
    driver::{
        DocumentCloneRequest, DocumentDeleteRequest, DocumentEditRequest,
        DocumentTransferClearRequest, DocumentTransferReadRequest, DocumentTransferWriteRequest,
    },
    manager::ConnectionManager,
    protocol::{Response, SearchIndexClearResult, SearchIndexMetadataKind},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::State;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MongoDocumentCloneRequest {
    pub database: String,
    pub collection: String,
    pub source_id: Value,
    pub draft_document: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteMongoDocumentCloneRequest {
    pub clone: MongoDocumentCloneRequest,
    pub confirmation_token: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MongoDocumentClonePlan {
    pub database: String,
    pub collection: String,
    pub source_id: Value,
    pub source_document: Value,
    pub draft_document: Value,
    pub preview_document: Value,
    pub edited_fields: Vec<String>,
    pub source_digest: String,
    pub confirmation_token: String,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MongoDocumentCloneReceipt {
    pub inserted_id: Value,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MongoDocumentEditRequest {
    pub database: String,
    pub collection: String,
    pub source_id: Value,
    pub draft_document: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteMongoDocumentEditRequest {
    pub edit: MongoDocumentEditRequest,
    pub confirmation_token: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MongoDocumentEditPlan {
    pub database: String,
    pub collection: String,
    pub source_id: Value,
    pub source_document: Value,
    pub draft_document: Value,
    pub preview_document: Value,
    pub edited_fields: Vec<String>,
    pub source_digest: String,
    pub confirmation_token: String,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MongoDocumentEditReceipt {
    pub matched_count: u64,
    pub modified_count: u64,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MongoDocumentDeleteRequest {
    pub database: String,
    pub collection: String,
    pub source_id: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteMongoDocumentDeleteRequest {
    pub delete: MongoDocumentDeleteRequest,
    pub confirmation_token: String,
    pub confirmation_phrase: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MongoDocumentDeletePlan {
    pub database: String,
    pub collection: String,
    pub source_id: Value,
    pub source_document: Value,
    pub source_digest: String,
    pub confirmation_token: String,
    pub confirmation_phrase: String,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MongoDocumentDeleteReceipt {
    pub deleted_count: u64,
    pub message: String,
}

/// MongoDB collection transfer is intentionally a dedicated protocol rather
/// than a variant of relational TableDataTransfer. Its payload remains
/// canonical Extended JSON from source read through target insertion.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MongoCollectionTransferRequest {
    pub source_connection_id: String,
    pub source_database: String,
    pub source_collection: String,
    pub target_connection_id: String,
    pub target_database: String,
    pub target_collection: String,
    #[serde(default)]
    pub mode: MongoCollectionTransferMode,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MongoCollectionTransferMode {
    #[default]
    Append,
    Overwrite,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteMongoCollectionTransferRequest {
    pub transfer: MongoCollectionTransferRequest,
    pub confirmation_token: String,
    #[serde(default)]
    pub confirmation_phrase: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MongoCollectionTransferPlan {
    pub source_database: String,
    pub source_collection: String,
    pub target_database: String,
    pub target_collection: String,
    pub mode: MongoCollectionTransferMode,
    pub source_document_count: u64,
    pub target_document_count: u64,
    pub batch_size: usize,
    pub preserves_bson_types: bool,
    pub is_snapshot_consistent: bool,
    pub confirmation_phrase: Option<String>,
    pub confirmation_token: String,
    pub source_server_version: Option<String>,
    pub target_server_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MongoCollectionTransferReceipt {
    pub inserted_count: u64,
    pub deleted_count: u64,
    pub source_document_count: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElasticsearchIndexClearPlan {
    pub index: String,
    pub is_pattern: bool,
    pub document_count: Option<u64>,
    pub request_preview: String,
    pub confirmation_phrase: Option<String>,
    pub confirmation_token: String,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteElasticsearchIndexClearRequest {
    pub index: String,
    pub confirmation_token: String,
    #[serde(default)]
    pub confirmation_phrase: String,
}

fn validate_scope(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 255 || value.contains('\0') {
        return Err(format!("Invalid MongoDB {label}"));
    }
    Ok(value.to_string())
}

async fn confirm_bundled_mongodb(
    manager: &ConnectionManager,
    connection_id: &str,
    requested_driver: &str,
) -> Result<Option<String>, String> {
    if manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Err(
            "External drivers do not provide a verified native document mutation protocol"
                .to_string(),
        );
    }
    if !requested_driver.trim().eq_ignore_ascii_case("mongodb") {
        return Err("Reviewed document mutations are currently available for MongoDB".to_string());
    }
    let connected_driver = manager
        .connection_driver_id(connection_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The active connection identity is unavailable".to_string())?;
    if !connected_driver.trim().eq_ignore_ascii_case("mongodb") {
        return Err(
            "Requested document driver does not match the active connection identity".to_string(),
        );
    }
    manager
        .server_version(connection_id)
        .await
        .map_err(|error| error.to_string())
}

async fn confirm_bundled_elasticsearch(
    manager: &ConnectionManager,
    connection_id: &str,
    requested_driver: &str,
) -> Result<Option<String>, String> {
    if manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Err(
            "External drivers do not provide the reviewed Elasticsearch index-management protocol"
                .to_string(),
        );
    }
    if !requested_driver
        .trim()
        .eq_ignore_ascii_case("elasticsearch")
    {
        return Err("Index management is currently available for Elasticsearch".to_string());
    }
    let connected_driver = manager
        .connection_driver_id(connection_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The active connection identity is unavailable".to_string())?;
    if !connected_driver
        .trim()
        .eq_ignore_ascii_case("elasticsearch")
    {
        return Err(
            "Requested search driver does not match the active connection identity".to_string(),
        );
    }
    manager
        .server_version(connection_id)
        .await
        .map_err(|error| error.to_string())
}

async fn resolve_elasticsearch_index(
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

fn elasticsearch_clear_plan_token(
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

async fn build_elasticsearch_clear_plan(
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

fn clone_plan_token(
    connection_id: &str,
    server_version: Option<&str>,
    request: &MongoDocumentCloneRequest,
    source_digest: &str,
    preview_document: &Value,
    edited_fields: &[String],
) -> Result<String, String> {
    let source_id = serde_json::to_vec(&request.source_id)
        .map_err(|error| format!("Failed to bind MongoDB source identity: {error}"))?;
    let preview = serde_json::to_vec(preview_document)
        .map_err(|error| format!("Failed to bind MongoDB clone preview: {error}"))?;
    let mut digest = Sha256::new();
    for value in [
        b"oxide-mongodb-document-clone-v1".as_slice(),
        connection_id.as_bytes(),
        server_version.unwrap_or("unknown").as_bytes(),
        request.database.as_bytes(),
        request.collection.as_bytes(),
        source_digest.as_bytes(),
        source_id.as_slice(),
        preview.as_slice(),
    ] {
        digest.update(value);
        digest.update([0]);
    }
    for field in edited_fields {
        digest.update(field.as_bytes());
        digest.update([0]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

struct MutationPlanTokenInput<'a> {
    action: &'a str,
    connection_id: &'a str,
    server_version: Option<&'a str>,
    database: &'a str,
    collection: &'a str,
    source_id: &'a Value,
    source_digest: &'a str,
    preview_document: Option<&'a Value>,
    edited_fields: &'a [String],
    confirmation_phrase: Option<&'a str>,
}

fn mutation_plan_token(input: MutationPlanTokenInput<'_>) -> Result<String, String> {
    let source_id = serde_json::to_vec(input.source_id)
        .map_err(|error| format!("Failed to bind MongoDB source identity: {error}"))?;
    let preview = input
        .preview_document
        .map(serde_json::to_vec)
        .transpose()
        .map_err(|error| format!("Failed to bind MongoDB mutation preview: {error}"))?
        .unwrap_or_default();
    let mut digest = Sha256::new();
    for value in [
        b"oxide-mongodb-document-mutation-v1".as_slice(),
        input.action.as_bytes(),
        input.connection_id.as_bytes(),
        input.server_version.unwrap_or("unknown").as_bytes(),
        input.database.as_bytes(),
        input.collection.as_bytes(),
        input.source_digest.as_bytes(),
        source_id.as_slice(),
        preview.as_slice(),
        input.confirmation_phrase.unwrap_or("").as_bytes(),
    ] {
        digest.update(value);
        digest.update([0]);
    }
    for field in input.edited_fields {
        digest.update(field.as_bytes());
        digest.update([0]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

async fn build_clone_plan(
    manager: &ConnectionManager,
    connection_id: &str,
    driver: &str,
    request: &MongoDocumentCloneRequest,
) -> Result<MongoDocumentClonePlan, String> {
    let server_version = confirm_bundled_mongodb(manager, connection_id, driver).await?;
    let database = validate_scope(&request.database, "database")?;
    let collection = validate_scope(&request.collection, "collection")?;
    let prepared = manager
        .prepare_document_clone(
            connection_id,
            DocumentCloneRequest {
                namespace: &database,
                collection: &collection,
                source_id: &request.source_id,
                draft_document: request.draft_document.as_ref(),
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    let normalized_request = MongoDocumentCloneRequest {
        database: database.clone(),
        collection: collection.clone(),
        source_id: request.source_id.clone(),
        draft_document: Some(prepared.draft_document.clone()),
    };
    let confirmation_token = clone_plan_token(
        connection_id,
        server_version.as_deref(),
        &normalized_request,
        &prepared.source_digest,
        &prepared.cloned_document,
        &prepared.edited_fields,
    )?;
    Ok(MongoDocumentClonePlan {
        database,
        collection,
        source_id: request.source_id.clone(),
        source_document: prepared.source_document,
        draft_document: prepared.draft_document,
        preview_document: prepared.cloned_document,
        edited_fields: prepared.edited_fields,
        source_digest: prepared.source_digest,
        confirmation_token,
        server_version,
    })
}

async fn build_edit_plan(
    manager: &ConnectionManager,
    connection_id: &str,
    driver: &str,
    request: &MongoDocumentEditRequest,
) -> Result<MongoDocumentEditPlan, String> {
    let server_version = confirm_bundled_mongodb(manager, connection_id, driver).await?;
    let database = validate_scope(&request.database, "database")?;
    let collection = validate_scope(&request.collection, "collection")?;
    let prepared = manager
        .prepare_document_edit(
            connection_id,
            DocumentEditRequest {
                namespace: &database,
                collection: &collection,
                source_id: &request.source_id,
                draft_document: request.draft_document.as_ref(),
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    let confirmation_token = mutation_plan_token(MutationPlanTokenInput {
        action: "edit",
        connection_id,
        server_version: server_version.as_deref(),
        database: &database,
        collection: &collection,
        source_id: &request.source_id,
        source_digest: &prepared.source_digest,
        preview_document: Some(&prepared.updated_document),
        edited_fields: &prepared.edited_fields,
        confirmation_phrase: None,
    })?;
    Ok(MongoDocumentEditPlan {
        database,
        collection,
        source_id: request.source_id.clone(),
        source_document: prepared.source_document,
        draft_document: prepared.draft_document,
        preview_document: prepared.updated_document,
        edited_fields: prepared.edited_fields,
        source_digest: prepared.source_digest,
        confirmation_token,
        server_version,
    })
}

async fn build_delete_plan(
    manager: &ConnectionManager,
    connection_id: &str,
    driver: &str,
    request: &MongoDocumentDeleteRequest,
) -> Result<MongoDocumentDeletePlan, String> {
    let server_version = confirm_bundled_mongodb(manager, connection_id, driver).await?;
    let database = validate_scope(&request.database, "database")?;
    let collection = validate_scope(&request.collection, "collection")?;
    let prepared = manager
        .prepare_document_delete(
            connection_id,
            DocumentDeleteRequest {
                namespace: &database,
                collection: &collection,
                source_id: &request.source_id,
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    let confirmation_phrase = format!("DELETE {collection}");
    let confirmation_token = mutation_plan_token(MutationPlanTokenInput {
        action: "delete",
        connection_id,
        server_version: server_version.as_deref(),
        database: &database,
        collection: &collection,
        source_id: &request.source_id,
        source_digest: &prepared.source_digest,
        preview_document: None,
        edited_fields: &[],
        confirmation_phrase: Some(&confirmation_phrase),
    })?;
    Ok(MongoDocumentDeletePlan {
        database,
        collection,
        source_id: request.source_id.clone(),
        source_document: prepared.source_document,
        source_digest: prepared.source_digest,
        confirmation_token,
        confirmation_phrase,
        server_version,
    })
}

const MONGODB_COLLECTION_TRANSFER_BATCH_SIZE: usize = 500;

fn collection_transfer_plan_token(
    transfer: &MongoCollectionTransferRequest,
    source_server_version: Option<&str>,
    target_server_version: Option<&str>,
    source_document_count: u64,
    target_document_count: u64,
    confirmation_phrase: Option<&str>,
) -> String {
    let mut digest = Sha256::new();
    let source_count = source_document_count.to_string();
    let target_count = target_document_count.to_string();
    for value in [
        b"oxide-mongodb-collection-transfer-v1".as_slice(),
        transfer.source_connection_id.as_bytes(),
        transfer.source_database.as_bytes(),
        transfer.source_collection.as_bytes(),
        transfer.target_connection_id.as_bytes(),
        transfer.target_database.as_bytes(),
        transfer.target_collection.as_bytes(),
        match transfer.mode {
            MongoCollectionTransferMode::Append => b"append".as_slice(),
            MongoCollectionTransferMode::Overwrite => b"overwrite".as_slice(),
        },
        source_server_version.unwrap_or("unknown").as_bytes(),
        target_server_version.unwrap_or("unknown").as_bytes(),
        source_count.as_bytes(),
        target_count.as_bytes(),
        confirmation_phrase.unwrap_or("").as_bytes(),
    ] {
        digest.update(value);
        digest.update([0]);
    }
    format!("{:x}", digest.finalize())
}

async fn build_mongodb_collection_transfer_plan(
    manager: &ConnectionManager,
    request: &MongoCollectionTransferRequest,
) -> Result<MongoCollectionTransferPlan, String> {
    let source_database = validate_scope(&request.source_database, "source database")?;
    let source_collection = validate_scope(&request.source_collection, "source collection")?;
    let target_database = validate_scope(&request.target_database, "target database")?;
    let target_collection = validate_scope(&request.target_collection, "target collection")?;
    if request.source_connection_id.trim().is_empty()
        || request.target_connection_id.trim().is_empty()
    {
        return Err("MongoDB source and target connections are required".to_string());
    }
    if request.source_connection_id == request.target_connection_id
        && source_database == target_database
        && source_collection == target_collection
    {
        return Err("MongoDB collection transfer source and target must differ".to_string());
    }
    let source_server_version =
        confirm_bundled_mongodb(manager, &request.source_connection_id, "mongodb").await?;
    let target_server_version =
        confirm_bundled_mongodb(manager, &request.target_connection_id, "mongodb").await?;
    let source = manager
        .read_document_transfer_batch(
            &request.source_connection_id,
            DocumentTransferReadRequest {
                namespace: &source_database,
                collection: &source_collection,
                offset: 0,
                limit: 1,
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    let target = manager
        .read_document_transfer_batch(
            &request.target_connection_id,
            DocumentTransferReadRequest {
                namespace: &target_database,
                collection: &target_collection,
                offset: 0,
                limit: 1,
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    let normalized = MongoCollectionTransferRequest {
        source_connection_id: request.source_connection_id.trim().to_string(),
        source_database: source_database.clone(),
        source_collection: source_collection.clone(),
        target_connection_id: request.target_connection_id.trim().to_string(),
        target_database: target_database.clone(),
        target_collection: target_collection.clone(),
        mode: request.mode,
    };
    let confirmation_phrase = matches!(normalized.mode, MongoCollectionTransferMode::Overwrite)
        .then(|| format!("OVERWRITE {target_database}.{target_collection}"));
    let confirmation_token = collection_transfer_plan_token(
        &normalized,
        source_server_version.as_deref(),
        target_server_version.as_deref(),
        source.total,
        target.total,
        confirmation_phrase.as_deref(),
    );
    Ok(MongoCollectionTransferPlan {
        source_database,
        source_collection,
        target_database,
        target_collection,
        mode: normalized.mode,
        source_document_count: source.total,
        target_document_count: target.total,
        batch_size: MONGODB_COLLECTION_TRANSFER_BATCH_SIZE,
        preserves_bson_types: true,
        // MongoDB read+insert across connections cannot promise a shared
        // snapshot without deployment-specific transaction support.
        is_snapshot_consistent: false,
        confirmation_phrase,
        confirmation_token,
        source_server_version,
        target_server_version,
    })
}

fn document_error<T>(code: &str, error: &str) -> Response<T> {
    let retryable = ["connection", "timed out", "temporarily unavailable"]
        .iter()
        .any(|pattern| error.to_ascii_lowercase().contains(pattern));
    Response::err_with_details(code, error, retryable, None)
}

#[tauri::command]
pub async fn preview_mongodb_document_clone(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: MongoDocumentCloneRequest,
) -> Result<Response<MongoDocumentClonePlan>, String> {
    Ok(
        match build_clone_plan(&manager, &connection_id, &driver, &request).await {
            Ok(plan) => Response::ok(plan),
            Err(error) => document_error("MONGODB_DOCUMENT_CLONE_PREVIEW_ERROR", &error),
        },
    )
}

#[tauri::command]
pub async fn execute_mongodb_document_clone(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: ExecuteMongoDocumentCloneRequest,
) -> Result<Response<MongoDocumentCloneReceipt>, String> {
    let result: Result<MongoDocumentCloneReceipt, String> = async {
        let plan = build_clone_plan(&manager, &connection_id, &driver, &request.clone).await?;
        if request.confirmation_token.trim() != plan.confirmation_token {
            return Err(
                "MongoDB document clone changed after preview; review the draft again".to_string(),
            );
        }
        let draft_document = plan.draft_document.clone();
        let receipt = manager
            .execute_document_clone(
                &connection_id,
                DocumentCloneRequest {
                    namespace: &plan.database,
                    collection: &plan.collection,
                    source_id: &plan.source_id,
                    draft_document: Some(&draft_document),
                },
                &plan.source_digest,
            )
            .await
            .map_err(|error| error.to_string())?;
        Ok(MongoDocumentCloneReceipt {
            inserted_id: receipt.inserted_id,
            message: format!(
                "Cloned one document into {}.{}",
                plan.database, plan.collection
            ),
        })
    }
    .await;
    Ok(match result {
        Ok(receipt) => Response::ok(receipt),
        Err(error) => document_error("MONGODB_DOCUMENT_CLONE_EXECUTE_ERROR", &error),
    })
}

#[tauri::command]
pub async fn preview_mongodb_document_edit(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: MongoDocumentEditRequest,
) -> Result<Response<MongoDocumentEditPlan>, String> {
    Ok(
        match build_edit_plan(&manager, &connection_id, &driver, &request).await {
            Ok(plan) => Response::ok(plan),
            Err(error) => document_error("MONGODB_DOCUMENT_EDIT_PREVIEW_ERROR", &error),
        },
    )
}

#[tauri::command]
pub async fn execute_mongodb_document_edit(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: ExecuteMongoDocumentEditRequest,
) -> Result<Response<MongoDocumentEditReceipt>, String> {
    let result: Result<MongoDocumentEditReceipt, String> = async {
        let plan = build_edit_plan(&manager, &connection_id, &driver, &request.edit).await?;
        if request.confirmation_token.trim() != plan.confirmation_token {
            return Err(
                "MongoDB document or draft changed after preview; review the edit again"
                    .to_string(),
            );
        }
        if plan.edited_fields.is_empty() {
            return Err("MongoDB document edit does not contain any changes".to_string());
        }
        let draft_document = plan.draft_document.clone();
        let receipt = manager
            .execute_document_edit(
                &connection_id,
                DocumentEditRequest {
                    namespace: &plan.database,
                    collection: &plan.collection,
                    source_id: &plan.source_id,
                    draft_document: Some(&draft_document),
                },
                &plan.source_digest,
            )
            .await
            .map_err(|error| error.to_string())?;
        Ok(MongoDocumentEditReceipt {
            matched_count: receipt.matched_count,
            modified_count: receipt.modified_count,
            message: format!(
                "Saved one document in {}.{}",
                plan.database, plan.collection
            ),
        })
    }
    .await;
    Ok(match result {
        Ok(receipt) => Response::ok(receipt),
        Err(error) => document_error("MONGODB_DOCUMENT_EDIT_EXECUTE_ERROR", &error),
    })
}

#[tauri::command]
pub async fn preview_mongodb_document_delete(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: MongoDocumentDeleteRequest,
) -> Result<Response<MongoDocumentDeletePlan>, String> {
    Ok(
        match build_delete_plan(&manager, &connection_id, &driver, &request).await {
            Ok(plan) => Response::ok(plan),
            Err(error) => document_error("MONGODB_DOCUMENT_DELETE_PREVIEW_ERROR", &error),
        },
    )
}

#[tauri::command]
pub async fn execute_mongodb_document_delete(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: ExecuteMongoDocumentDeleteRequest,
) -> Result<Response<MongoDocumentDeleteReceipt>, String> {
    let result: Result<MongoDocumentDeleteReceipt, String> = async {
        let plan = build_delete_plan(&manager, &connection_id, &driver, &request.delete).await?;
        if request.confirmation_token.trim() != plan.confirmation_token {
            return Err(
                "MongoDB document changed after preview; review the deletion again".to_string(),
            );
        }
        if request.confirmation_phrase != plan.confirmation_phrase {
            return Err(format!(
                "Type {} exactly to delete this document",
                plan.confirmation_phrase
            ));
        }
        let receipt = manager
            .execute_document_delete(
                &connection_id,
                DocumentDeleteRequest {
                    namespace: &plan.database,
                    collection: &plan.collection,
                    source_id: &plan.source_id,
                },
                &plan.source_digest,
            )
            .await
            .map_err(|error| error.to_string())?;
        Ok(MongoDocumentDeleteReceipt {
            deleted_count: receipt.deleted_count,
            message: format!(
                "Deleted one document from {}.{}",
                plan.database, plan.collection
            ),
        })
    }
    .await;
    Ok(match result {
        Ok(receipt) => Response::ok(receipt),
        Err(error) => document_error("MONGODB_DOCUMENT_DELETE_EXECUTE_ERROR", &error),
    })
}

#[tauri::command]
pub async fn preview_mongodb_collection_transfer(
    manager: State<'_, ConnectionManager>,
    request: MongoCollectionTransferRequest,
) -> Result<Response<MongoCollectionTransferPlan>, String> {
    Ok(
        match build_mongodb_collection_transfer_plan(&manager, &request).await {
            Ok(plan) => Response::ok(plan),
            Err(error) => document_error("MONGODB_COLLECTION_TRANSFER_PREVIEW_ERROR", &error),
        },
    )
}

#[tauri::command]
pub async fn execute_mongodb_collection_transfer(
    manager: State<'_, ConnectionManager>,
    request: ExecuteMongoCollectionTransferRequest,
) -> Result<Response<MongoCollectionTransferReceipt>, String> {
    let result: Result<MongoCollectionTransferReceipt, String> = async {
        let plan = build_mongodb_collection_transfer_plan(&manager, &request.transfer).await?;
        if request.confirmation_token.trim() != plan.confirmation_token {
            return Err(
                "MongoDB collection source or target changed after preview; review the transfer again"
                    .to_string(),
            );
        }
        if let Some(phrase) = plan.confirmation_phrase.as_deref() {
            if request.confirmation_phrase.trim() != phrase {
                return Err(format!("Type {phrase} exactly to overwrite this MongoDB collection"));
            }
        }
        let deleted_count = if matches!(plan.mode, MongoCollectionTransferMode::Overwrite) {
            manager
                .clear_document_transfer_collection(
                    &request.transfer.target_connection_id,
                    DocumentTransferClearRequest {
                        namespace: &plan.target_database,
                        collection: &plan.target_collection,
                    },
                )
                .await
                .map_err(|error| error.to_string())?
                .deleted_count
        } else {
            0
        };
        let mut inserted_count = 0_u64;
        let mut offset = 0_u64;
        loop {
            let batch = manager
                .read_document_transfer_batch(
                    &request.transfer.source_connection_id,
                    DocumentTransferReadRequest {
                        namespace: &plan.source_database,
                        collection: &plan.source_collection,
                        offset,
                        limit: plan.batch_size,
                    },
                )
                .await
                .map_err(|error| error.to_string())?;
            if batch.documents.is_empty() {
                break;
            }
            let batch_len = batch.documents.len() as u64;
            let receipt = manager
                .write_document_transfer_batch(
                    &request.transfer.target_connection_id,
                    DocumentTransferWriteRequest {
                        namespace: &plan.target_database,
                        collection: &plan.target_collection,
                        documents: &batch.documents,
                    },
                )
                .await
                .map_err(|error| error.to_string())?;
            inserted_count = inserted_count.saturating_add(receipt.inserted_count);
            offset = offset.saturating_add(batch_len);
        }
        Ok(MongoCollectionTransferReceipt {
            inserted_count,
            deleted_count,
            source_document_count: plan.source_document_count,
            message: format!(
                "Transferred {inserted_count} BSON-preserving documents from {}.{} to {}.{}",
                plan.source_database,
                plan.source_collection,
                plan.target_database,
                plan.target_collection,
            ),
        })
    }
    .await;
    Ok(match result {
        Ok(receipt) => Response::ok(receipt),
        Err(error) => document_error("MONGODB_COLLECTION_TRANSFER_EXECUTE_ERROR", &error),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> MongoDocumentCloneRequest {
        MongoDocumentCloneRequest {
            database: "app".to_string(),
            collection: "users".to_string(),
            source_id: serde_json::json!({ "$oid": "507f1f77bcf86cd799439011" }),
            draft_document: Some(serde_json::json!({ "name": "Grace" })),
        }
    }

    #[test]
    fn clone_token_binds_source_version_preview_and_edited_fields() {
        let base = clone_plan_token(
            "connection-1",
            Some("8.0.1"),
            &request(),
            "source-a",
            &serde_json::json!({ "name": "Grace" }),
            &["name".to_string()],
        )
        .unwrap();
        let changed_source = clone_plan_token(
            "connection-1",
            Some("8.0.1"),
            &request(),
            "source-b",
            &serde_json::json!({ "name": "Grace" }),
            &["name".to_string()],
        )
        .unwrap();
        let changed_fields = clone_plan_token(
            "connection-1",
            Some("8.0.1"),
            &request(),
            "source-a",
            &serde_json::json!({ "name": "Grace" }),
            &["name".to_string(), "status".to_string()],
        )
        .unwrap();

        assert_ne!(base, changed_source);
        assert_ne!(base, changed_fields);
    }

    #[test]
    fn clone_request_uses_camel_case_wire_fields() {
        let value = serde_json::to_value(request()).unwrap();
        assert!(value.get("sourceId").is_some());
        assert!(value.get("draftDocument").is_some());
        assert!(value.get("source_id").is_none());
    }

    #[test]
    fn clone_scope_is_bounded_before_driver_access() {
        assert_eq!(validate_scope(" users ", "collection").unwrap(), "users");
        assert!(validate_scope("", "collection").is_err());
        assert!(validate_scope(&"x".repeat(256), "collection").is_err());
        assert!(validate_scope("bad\0name", "collection").is_err());
    }

    #[test]
    fn mutation_token_binds_action_preview_fields_and_confirmation_phrase() {
        let source_id = serde_json::json!({ "$oid": "507f1f77bcf86cd799439011" });
        let preview = serde_json::json!({ "name": "Grace" });
        let fields = ["name".to_string()];
        let base = mutation_plan_token(MutationPlanTokenInput {
            action: "edit",
            connection_id: "connection-1",
            server_version: Some("8.0.1"),
            database: "app",
            collection: "users",
            source_id: &source_id,
            source_digest: "source-a",
            preview_document: Some(&preview),
            edited_fields: &fields,
            confirmation_phrase: None,
        })
        .unwrap();
        let delete = mutation_plan_token(MutationPlanTokenInput {
            action: "delete",
            connection_id: "connection-1",
            server_version: Some("8.0.1"),
            database: "app",
            collection: "users",
            source_id: &source_id,
            source_digest: "source-a",
            preview_document: None,
            edited_fields: &[],
            confirmation_phrase: Some("DELETE users"),
        })
        .unwrap();
        let changed = serde_json::json!({ "name": "Ada" });
        let changed_preview = mutation_plan_token(MutationPlanTokenInput {
            action: "edit",
            connection_id: "connection-1",
            server_version: Some("8.0.1"),
            database: "app",
            collection: "users",
            source_id: &source_id,
            source_digest: "source-a",
            preview_document: Some(&changed),
            edited_fields: &fields,
            confirmation_phrase: None,
        })
        .unwrap();

        assert_ne!(base, delete);
        assert_ne!(base, changed_preview);
    }

    #[test]
    fn edit_and_delete_requests_use_camel_case_wire_fields() {
        let edit = MongoDocumentEditRequest {
            database: "app".to_string(),
            collection: "users".to_string(),
            source_id: serde_json::json!(1),
            draft_document: Some(serde_json::json!({ "name": "Ada" })),
        };
        let delete = MongoDocumentDeleteRequest {
            database: "app".to_string(),
            collection: "users".to_string(),
            source_id: serde_json::json!(1),
        };

        let edit_value = serde_json::to_value(edit).unwrap();
        let delete_value = serde_json::to_value(delete).unwrap();
        assert!(edit_value.get("sourceId").is_some());
        assert!(edit_value.get("draftDocument").is_some());
        assert!(edit_value.get("source_id").is_none());
        assert!(delete_value.get("sourceId").is_some());
    }

    #[test]
    fn elasticsearch_clear_token_binds_connection_version_target_and_request() {
        let base = elasticsearch_clear_plan_token(
            "connection-1",
            Some("8.12.0"),
            "logs-*",
            "POST /logs-*/_delete_by_query",
        );
        assert_ne!(
            base,
            elasticsearch_clear_plan_token(
                "connection-2",
                Some("8.12.0"),
                "logs-*",
                "POST /logs-*/_delete_by_query",
            )
        );
        assert_ne!(
            base,
            elasticsearch_clear_plan_token(
                "connection-1",
                Some("8.13.0"),
                "logs-*",
                "POST /logs-*/_delete_by_query",
            )
        );
        assert_ne!(
            base,
            elasticsearch_clear_plan_token(
                "connection-1",
                Some("8.12.0"),
                "orders-*",
                "POST /orders-*/_delete_by_query",
            )
        );
    }

    #[test]
    fn elasticsearch_clear_plan_uses_pattern_only_confirmation_phrase() {
        let pattern = "logs-*";
        let exact = "logs-2026.08";
        assert_eq!(
            (pattern.contains('*') || pattern.contains('?')).then(|| format!("CLEAR {pattern}")),
            Some("CLEAR logs-*".to_string())
        );
        assert_eq!(
            (exact.contains('*') || exact.contains('?')).then(|| format!("CLEAR {exact}")),
            None
        );
    }

    #[test]
    fn collection_transfer_token_binds_both_scopes_mode_counts_and_overwrite_phrase() {
        let append = MongoCollectionTransferRequest {
            source_connection_id: "source-1".to_string(),
            source_database: "app".to_string(),
            source_collection: "users".to_string(),
            target_connection_id: "target-1".to_string(),
            target_database: "archive".to_string(),
            target_collection: "users_copy".to_string(),
            mode: MongoCollectionTransferMode::Append,
        };
        let base =
            collection_transfer_plan_token(&append, Some("8.0.1"), Some("8.0.2"), 12, 3, None);
        let overwrite = MongoCollectionTransferRequest {
            mode: MongoCollectionTransferMode::Overwrite,
            ..append.clone()
        };
        assert_ne!(
            base,
            collection_transfer_plan_token(
                &overwrite,
                Some("8.0.1"),
                Some("8.0.2"),
                12,
                3,
                Some("OVERWRITE archive.users_copy"),
            )
        );
        assert_ne!(
            base,
            collection_transfer_plan_token(&append, Some("8.0.1"), Some("8.0.2"), 13, 3, None)
        );
        assert_ne!(
            base,
            collection_transfer_plan_token(&append, Some("8.0.1"), Some("8.0.2"), 12, 4, None)
        );
    }

    #[test]
    fn collection_transfer_request_uses_camel_case_wire_fields() {
        let value = serde_json::to_value(MongoCollectionTransferRequest {
            source_connection_id: "source-1".to_string(),
            source_database: "app".to_string(),
            source_collection: "users".to_string(),
            target_connection_id: "target-1".to_string(),
            target_database: "archive".to_string(),
            target_collection: "users_copy".to_string(),
            mode: MongoCollectionTransferMode::Append,
        })
        .unwrap();
        assert!(value.get("sourceConnectionId").is_some());
        assert!(value.get("targetCollection").is_some());
        assert!(value.get("source_connection_id").is_none());
        assert_eq!(value.get("mode"), Some(&serde_json::json!("append")));
    }
}
