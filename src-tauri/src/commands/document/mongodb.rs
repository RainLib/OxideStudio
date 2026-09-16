use crate::core::{
    driver::{DocumentCloneRequest, DocumentDeleteRequest, DocumentEditRequest},
    manager::ConnectionManager,
    protocol::Response,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::State;

pub use super::models::{
    ExecuteMongoDocumentCloneRequest, ExecuteMongoDocumentDeleteRequest,
    ExecuteMongoDocumentEditRequest, MongoDocumentClonePlan, MongoDocumentCloneReceipt,
    MongoDocumentCloneRequest, MongoDocumentDeletePlan, MongoDocumentDeleteReceipt,
    MongoDocumentDeleteRequest, MongoDocumentEditPlan, MongoDocumentEditReceipt,
    MongoDocumentEditRequest,
};
use super::support::{confirm_bundled_mongodb, document_error, validate_scope};

pub(super) fn clone_plan_token(
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

pub(super) struct MutationPlanTokenInput<'a> {
    pub(super) action: &'a str,
    pub(super) connection_id: &'a str,
    pub(super) server_version: Option<&'a str>,
    pub(super) database: &'a str,
    pub(super) collection: &'a str,
    pub(super) source_id: &'a Value,
    pub(super) source_digest: &'a str,
    pub(super) preview_document: Option<&'a Value>,
    pub(super) edited_fields: &'a [String],
    pub(super) confirmation_phrase: Option<&'a str>,
}

pub(super) fn mutation_plan_token(input: MutationPlanTokenInput<'_>) -> Result<String, String> {
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

pub(super) async fn build_clone_plan(
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

pub(super) async fn build_edit_plan(
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

pub(super) async fn build_delete_plan(
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
