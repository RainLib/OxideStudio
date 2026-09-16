use crate::core::{
    driver::{
        DocumentTransferClearRequest, DocumentTransferReadRequest, DocumentTransferWriteRequest,
    },
    manager::ConnectionManager,
    protocol::Response,
};
use sha2::{Digest, Sha256};
use tauri::State;

pub use super::models::{
    ExecuteMongoCollectionTransferRequest, MongoCollectionTransferMode,
    MongoCollectionTransferPlan, MongoCollectionTransferReceipt, MongoCollectionTransferRequest,
};
use super::support::{confirm_bundled_mongodb, document_error, validate_scope};

const MONGODB_COLLECTION_TRANSFER_BATCH_SIZE: usize = 500;

pub(super) fn collection_transfer_plan_token(
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

pub(super) async fn build_mongodb_collection_transfer_plan(
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
