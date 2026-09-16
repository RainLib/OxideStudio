use serde::{Deserialize, Serialize};
use serde_json::Value;

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
