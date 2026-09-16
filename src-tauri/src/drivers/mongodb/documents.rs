use crate::core::driver::{PreparedDocumentClone, PreparedDocumentDelete, PreparedDocumentEdit};
use anyhow::{anyhow, Context, Result};
use mongodb::bson::{doc, Bson, Document};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

use super::commands::json_to_bson;

pub(super) fn prepare_mongodb_document_clone(
    source: &Document,
    requested_draft: Option<&Value>,
) -> Result<PreparedDocumentClone> {
    let source_document = Bson::Document(source.clone()).into_canonical_extjson();
    let mut initial_draft = source_document
        .as_object()
        .cloned()
        .ok_or_else(|| anyhow!("MongoDB clone source must be a document"))?;
    initial_draft.remove("_id");
    let initial_draft = Value::Object(initial_draft);
    let draft_document = requested_draft
        .cloned()
        .unwrap_or_else(|| initial_draft.clone());
    let draft = draft_document
        .as_object()
        .ok_or_else(|| anyhow!("MongoDB clone draft must be a JSON object"))?;
    let original = initial_draft
        .as_object()
        .expect("initial MongoDB clone draft is an object");

    let keys = original
        .keys()
        .chain(draft.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let edited_fields = keys
        .into_iter()
        .filter(|field| original.get(field) != draft.get(field))
        .collect::<Vec<_>>();

    // Start with the exact source BSON and touch only fields which differ in
    // the reviewed draft. This preserves BSON values which have a friendlier
    // or lossy browser representation without asking the renderer to infer
    // their native type.
    let mut cloned = source.clone();
    cloned.remove("_id");
    for field in &edited_fields {
        if let Some(value) = draft.get(field) {
            cloned.insert(
                field,
                json_to_bson(value, &format!("MongoDB clone field {field}"))?,
            );
        } else {
            cloned.remove(field);
        }
    }
    let cloned_document = Bson::Document(cloned).into_canonical_extjson();
    let source_bytes = serde_json::to_vec(&source_document)
        .context("Failed to fingerprint the MongoDB clone source")?;
    let source_digest = format!("{:x}", Sha256::digest(source_bytes));

    Ok(PreparedDocumentClone {
        source_digest,
        source_document,
        draft_document,
        cloned_document,
        edited_fields,
    })
}

pub(super) fn source_document_digest(source_document: &Value) -> Result<String> {
    let source_bytes = serde_json::to_vec(source_document)
        .context("Failed to fingerprint the MongoDB source document")?;
    Ok(format!("{:x}", Sha256::digest(source_bytes)))
}

pub(super) fn prepare_mongodb_document_edit(
    source: &Document,
    requested_draft: Option<&Value>,
) -> Result<PreparedDocumentEdit> {
    let source_document = Bson::Document(source.clone()).into_canonical_extjson();
    let mut editable = source_document
        .as_object()
        .cloned()
        .ok_or_else(|| anyhow!("MongoDB edit source must be a document"))?;
    editable.remove("_id");
    let initial_draft = Value::Object(editable);
    let draft_document = requested_draft
        .cloned()
        .unwrap_or_else(|| initial_draft.clone());
    let draft = draft_document
        .as_object()
        .ok_or_else(|| anyhow!("MongoDB edit draft must be a JSON object"))?;
    if draft.contains_key("_id") {
        return Err(anyhow!(
            "MongoDB _id is immutable; edit the document fields without adding _id"
        ));
    }
    let original = initial_draft
        .as_object()
        .ok_or_else(|| anyhow!("MongoDB edit source must be a JSON object"))?;
    let keys = original
        .keys()
        .chain(draft.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let edited_fields = keys
        .into_iter()
        .filter(|field| original.get(field) != draft.get(field))
        .collect::<Vec<_>>();

    let mut updated = source.clone();
    for field in &edited_fields {
        if let Some(value) = draft.get(field) {
            updated.insert(
                field,
                json_to_bson(value, &format!("MongoDB edited field {field}"))?,
            );
        } else {
            updated.remove(field);
        }
    }
    let updated_document = Bson::Document(updated).into_canonical_extjson();
    let source_digest = source_document_digest(&source_document)?;
    Ok(PreparedDocumentEdit {
        source_digest,
        source_document,
        draft_document,
        updated_document,
        edited_fields,
    })
}

pub(super) fn prepare_mongodb_document_delete(source: &Document) -> Result<PreparedDocumentDelete> {
    let source_document = Bson::Document(source.clone()).into_canonical_extjson();
    let source_digest = source_document_digest(&source_document)?;
    Ok(PreparedDocumentDelete {
        source_digest,
        source_document,
    })
}

/// Bind a mutation to the exact BSON document read during review. `_id`
/// keeps the indexed lookup while `$expr` prevents added, removed, or changed
/// fields from slipping through the read/mutate window.
pub(super) fn exact_source_filter(source: &Document) -> Result<Document> {
    let source_id = source
        .get("_id")
        .cloned()
        .ok_or_else(|| anyhow!("MongoDB source document does not contain _id"))?;
    Ok(doc! {
        "_id": source_id,
        "$expr": {
            "$eq": [
                "$$ROOT",
                { "$literal": Bson::Document(source.clone()) }
            ]
        }
    })
}

pub(super) fn extract_cursor_batch(result: Document) -> Result<Vec<Document>> {
    let cursor = result
        .get_document("cursor")
        .context("MongoDB response did not include a cursor")?;
    let batch = cursor
        .get_array("firstBatch")
        .or_else(|_| cursor.get_array("nextBatch"))
        .context("MongoDB cursor response did not include a batch")?;

    batch
        .iter()
        .map(|value| match value {
            Bson::Document(document) => Ok(document.clone()),
            _ => Err(anyhow!(
                "MongoDB cursor batch contained a non-document value"
            )),
        })
        .collect()
}
