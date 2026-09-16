use super::{
    elasticsearch::elasticsearch_clear_plan_token,
    models::*,
    mongodb::{clone_plan_token, mutation_plan_token, MutationPlanTokenInput},
    support::validate_scope,
    transfer::collection_transfer_plan_token,
};

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
    let base = collection_transfer_plan_token(&append, Some("8.0.1"), Some("8.0.2"), 12, 3, None);
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
