use super::*;

#[test]
fn table_import_mode_is_bound_to_review_digest_and_uses_transactional_delete() {
    let options = TableCsvImportOptions {
        delimiter: Some(",".to_string()),
        ..Default::default()
    };
    let append_digest = table_import_mapping_digest(
        TableImportFormat::Csv,
        TableImportMode::Append,
        Some(true),
        Some(&options),
    )
    .unwrap();
    let replace_digest = table_import_mapping_digest(
        TableImportFormat::Csv,
        TableImportMode::Truncate,
        Some(true),
        Some(&options),
    )
    .unwrap();
    assert_ne!(append_digest, replace_digest);

    assert_eq!(
        table_import_replace_statement(DatabaseKind::Postgres, "public", "Order").sql,
        "DELETE FROM \"public\".\"Order\""
    );
    assert_eq!(
        table_import_replace_statement(DatabaseKind::Mysql, "store", "order-items").sql,
        "DELETE FROM `store`.`order-items`"
    );
}

#[test]
fn data_transfer_reports_use_a_bounded_project_identity_and_hashed_plan_token() {
    assert_eq!(
        normalized_table_data_transfer_project_id(Some(" project-a ")),
        Some("project-a".to_string())
    );
    assert_eq!(
        normalized_table_data_transfer_project_id(Some("\u{0000}")),
        None
    );
    assert_eq!(
        normalized_table_data_transfer_project_id(Some(&"x".repeat(129))),
        None
    );
    let token = "TRANSFER 0123456789ABCDEF";
    let digest = table_data_transfer_plan_digest(token);
    assert_eq!(digest.len(), 64);
    assert!(!digest.contains(token));
    assert_eq!(
        table_data_transfer_report_id("transfer-test-0001"),
        "table-transfer-report-transfer-test-0001"
    );

    let object_report = TableDataTransferObjectReport {
        id: "object-report".to_string(),
        project_id: "project-a".to_string(),
        transfer_id: "transfer-test-0001-object-0".to_string(),
        source_connection_id: "source".to_string(),
        source_database: Some("app".to_string()),
        source_schema: "public".to_string(),
        target_connection_id: "target".to_string(),
        target_database: Some("archive".to_string()),
        target_schema: "public".to_string(),
        object_type: TableDataTransferObjectKind::View,
        name: "active_users".to_string(),
        parent_name: None,
        action: TableDataTransferObjectAction::Create,
        plan_digest: digest,
        status: TableDataTransferProgressStatus::Done,
        started_at: 1,
        finished_at: 2,
        error: None,
    };
    let serialized = serde_json::to_value(object_report).unwrap();
    assert!(serialized.get("statements").is_none());
    assert!(serialized.get("sql").is_none());
    assert!(serialized.get("parameters").is_none());
}

#[tokio::test]
async fn synchronization_plan_tokens_are_single_use_and_expire_host_side() {
    let plans = TableDataCompareSyncPlanState::default();
    let frozen = || FrozenTableDataCompareSyncPlan {
        target: TableDataCompareEndpoint {
            connection_id: "target".to_string(),
            driver: "postgres".to_string(),
            database: None,
            schema: "public".to_string(),
            table: "users".to_string(),
        },
        metadata_digest: "metadata".to_string(),
        statements: Vec::new(),
        insert_count: 0,
        update_count: 0,
        delete_count: 0,
        plan_digest: "plan".to_string(),
        confirmation_text: "SYNC public.users".to_string(),
        expires_at: 0,
    };

    let (token, expires_at) = plans.issue(frozen()).await;
    assert!(expires_at > super::current_table_timestamp_millis());
    assert_eq!(plans.consume(&token).await.unwrap().plan_digest, "plan");
    assert!(plans
        .consume(&token)
        .await
        .unwrap_err()
        .contains("consumed"));

    let (expired_token, _) = plans.issue(frozen()).await;
    let digest = super::table_data_compare_sync_token_digest(&expired_token);
    plans.0.lock().await.get_mut(&digest).unwrap().expires_at =
        super::current_table_timestamp_millis().saturating_sub(1);
    assert!(plans
        .consume(&expired_token)
        .await
        .unwrap_err()
        .contains("expired"));
}
