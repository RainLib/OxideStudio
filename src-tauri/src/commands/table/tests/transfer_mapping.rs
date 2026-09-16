use super::*;

#[test]
fn data_transfer_mapping_is_case_insensitive_and_rejects_missing_required_columns() {
    let source = vec![
        target_column("id"),
        target_column("display_name"),
        target_column("legacy"),
    ];
    let mut required = target_column("email");
    required.is_nullable = false;
    let target = vec![target_column("ID"), target_column("display_name"), required];

    let error = build_data_transfer_column_mapping(&source, &target).unwrap_err();
    assert!(error.contains("legacy"));

    let mut source_with_email = source.clone();
    source_with_email.push(target_column("EMAIL"));
    let mut target_with_legacy = target.clone();
    target_with_legacy.push(target_column("legacy"));
    let (mappings, skipped) =
        build_data_transfer_column_mapping(&source_with_email, &target_with_legacy).unwrap();
    assert_eq!(
        mappings
            .iter()
            .map(|mapping| (mapping.source.as_str(), mapping.target.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("id", "ID"),
            ("display_name", "display_name"),
            ("legacy", "legacy"),
            ("EMAIL", "email")
        ]
    );
    assert!(skipped.is_empty());
}

#[test]
fn data_transfer_fails_closed_when_the_target_would_drop_source_columns() {
    let error = build_data_transfer_column_mapping(
        &[
            target_column("id"),
            target_column("review_mode"),
            target_column("score_snapshot_json"),
        ],
        &[target_column("id")],
    )
    .unwrap_err();

    assert!(error.contains("review_mode"));
    assert!(error.contains("score_snapshot_json"));
    assert!(error.contains("does not silently discard source columns"));
}

#[test]
fn data_transfer_requires_ownership_metadata_and_skips_database_owned_targets() {
    let mut unknown = target_column("unknown");
    unknown.is_generated = None;
    assert!(
        build_data_transfer_column_mapping(&[target_column("unknown")], &[unknown])
            .unwrap_err()
            .contains("did not classify generated/hidden status")
    );

    let mut generated = target_column("computed_total");
    generated.is_nullable = false;
    generated.is_generated = Some(true);
    let mut hidden = target_column("period_start");
    hidden.is_nullable = false;
    hidden.is_hidden = Some(true);
    let (mappings, skipped) = build_data_transfer_column_mapping(
        &[
            target_column("id"),
            target_column("computed_total"),
            target_column("period_start"),
        ],
        &[target_column("id"), generated, hidden],
    )
    .unwrap();
    assert_eq!(mappings.len(), 1);
    assert_eq!(mappings[0].target, "id");
    assert_eq!(skipped, vec!["computed_total", "period_start"]);
}

#[test]
fn data_transfer_surfaces_type_conversion_review_before_confirmation() {
    let mapping = |source: &str, target: &str, source_type: &str, target_type: &str| {
        let (compatibility, conversion, reason) =
            transfer_type_mapping_assessment(source_type, target_type);
        TableDataTransferColumnMapping {
            source: source.to_string(),
            target: target.to_string(),
            data_type: target_type.to_string(),
            source_data_type: source_type.to_string(),
            target_data_type: target_type.to_string(),
            compatibility,
            conversion,
            reason,
        }
    };
    let mappings = [
        mapping("id", "id", "bigint", "uuid"),
        mapping("amount", "amount", "integer", "decimal(18,2)"),
        mapping("ratio", "ratio", "numeric", "integer"),
    ];
    let warnings = transfer_type_mapping_warnings(&mappings);
    assert_eq!(warnings.len(), 2);
    assert!(warnings[0].contains("Blocked mapping: id (bigint) → id (uuid)"));
    assert!(warnings[1].contains("Numeric-to-integer conversion"));
    assert!(!transfer_plan_can_execute(&mappings));
}

#[test]
fn data_transfer_type_plan_serializes_json_and_blocks_unreviewed_pairs() {
    let (compatibility, conversion, _) = transfer_type_mapping_assessment("jsonb", "text");
    assert_eq!(compatibility, TableDataTransferCompatibility::Safe);
    assert_eq!(conversion, TableDataTransferConversion::StringifyJson);
    let mapping = TableDataTransferColumnMapping {
        source: "payload".to_string(),
        target: "payload_text".to_string(),
        data_type: "text".to_string(),
        source_data_type: "jsonb".to_string(),
        target_data_type: "text".to_string(),
        compatibility,
        conversion,
        reason: "JSON to text".to_string(),
    };
    assert_eq!(
        apply_transfer_conversion(&mapping, &serde_json::json!({"id": 7})).unwrap(),
        serde_json::Value::String("{\"id\":7}".to_string())
    );

    let (compatibility, conversion, reason) =
        transfer_type_mapping_assessment("bytea", "timestamp");
    assert_eq!(compatibility, TableDataTransferCompatibility::Unsupported);
    let blocked = TableDataTransferColumnMapping {
        source: "id".to_string(),
        target: "id".to_string(),
        data_type: "timestamp".to_string(),
        source_data_type: "bytea".to_string(),
        target_data_type: "timestamp".to_string(),
        compatibility,
        conversion,
        reason,
    };
    assert!(apply_transfer_conversion(&blocked, &serde_json::json!("00FF")).is_err());
}

#[test]
fn data_transfer_confirmation_binds_endpoints_and_column_plan() {
    let request = TableDataTransferRequest {
        project_id: None,
        transfer_id: "transfer-test-0001".to_string(),
        source: TableDataTransferEndpoint {
            connection_id: "source".to_string(),
            driver: "postgres".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            database: None,
        },
        target: TableDataTransferEndpoint {
            connection_id: "target".to_string(),
            driver: "mysql".to_string(),
            schema: "app".to_string(),
            table: "users_copy".to_string(),
            database: None,
        },
        mode: TableDataTransferMode::Append,
        max_rows: Some(500),
        batch_size: Some(100),
        reseed_identity: false,
        quote_target_column_names: true,
        restore_source_schema_objects: false,
    };
    let mappings =
        build_data_transfer_column_mapping(&[target_column("id")], &[target_column("id")])
            .unwrap()
            .0;
    let confirmation_token =
        |candidate: &TableDataTransferRequest,
         target_rows_before: Option<u64>,
         target_rows_to_delete: Option<u64>,
         upsert_key_columns: &[String],
         identity_reseed_plans: &[TableDataTransferIdentityReseedPlan]| {
            transfer_confirmation_token(
                candidate,
                &TableDataTransferConfirmationBinding {
                    mapped_columns: &mappings,
                    max_rows: 500,
                    batch_size: 100,
                    target_rows_before,
                    target_rows_to_delete,
                    upsert_key_columns,
                    identity_reseed_plans,
                    schema_restore_statements: &[],
                },
            )
        };
    let token = confirmation_token(&request, Some(4), None, &[], &[]).unwrap();
    assert!(token.starts_with("TRANSFER "));

    let mut changed = request.clone();
    changed.target.table = "other_users".to_string();
    assert_ne!(
        token,
        confirmation_token(&changed, Some(4), None, &[], &[]).unwrap()
    );
    changed = request.clone();
    changed.transfer_id = "transfer-test-0002".to_string();
    assert_ne!(
        token,
        confirmation_token(&changed, Some(4), None, &[], &[]).unwrap()
    );
    changed = request.clone();
    changed.mode = TableDataTransferMode::Overwrite;
    assert_ne!(
        token,
        confirmation_token(&changed, Some(12), Some(12), &[], &[]).unwrap()
    );
    changed.mode = TableDataTransferMode::Upsert;
    assert_ne!(
        token,
        confirmation_token(&changed, None, None, &["id".to_string()], &[]).unwrap()
    );
    assert_ne!(
        token,
        confirmation_token(&request, Some(5), None, &[], &[]).unwrap()
    );
    changed = request.clone();
    changed.quote_target_column_names = false;
    assert_ne!(
        token,
        confirmation_token(&changed, Some(4), None, &[], &[]).unwrap()
    );

    let generator = TableDataTransferIdentityReseedPlan {
        column: "id".to_string(),
        sequence_schema: "app".to_string(),
        sequence_name: "users_copy_id_seq".to_string(),
        owner_schema: "app".to_string(),
        owner_table: "users_copy".to_string(),
        owner_column: "id".to_string(),
        current_value: Some("41".to_string()),
        target_max_value: Some("40".to_string()),
    };
    assert_ne!(
        token,
        confirmation_token(&request, Some(4), None, &[], &[generator]).unwrap()
    );
}

#[test]
fn data_transfer_upsert_plan_requires_bundled_driver_and_complete_primary_key() {
    let mut id = target_column("id");
    id.is_primary_key = true;
    let mappings = build_data_transfer_column_mapping(&[id.clone()], &[id.clone()])
        .unwrap()
        .0;

    assert_eq!(
        resolve_transfer_upsert_key_columns(
            TableDataTransferMode::Upsert,
            false,
            &[id.clone()],
            &mappings,
        )
        .unwrap(),
        vec!["id"]
    );
    assert!(resolve_transfer_upsert_key_columns(
        TableDataTransferMode::Upsert,
        true,
        &[id.clone()],
        &mappings,
    )
    .unwrap_err()
    .contains("external driver packages"));
    assert!(resolve_transfer_upsert_key_columns(
        TableDataTransferMode::Upsert,
        false,
        &[target_column("display_name")],
        &mappings,
    )
    .unwrap_err()
    .contains("declared primary key"));
    assert!(
        resolve_transfer_upsert_key_columns(TableDataTransferMode::Upsert, false, &[id], &[],)
            .unwrap_err()
            .contains("primary-key column to be mapped")
    );
}
