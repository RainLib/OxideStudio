use super::*;

#[tokio::test]
async fn dropped_transfer_task_guard_aborts_the_isolated_worker() {
    let task = tokio::spawn(std::future::pending::<()>());
    let guard = AbortTableDataTransferTaskOnDrop(task.abort_handle());

    drop(guard);

    assert!(task
        .await
        .expect_err("guard should abort task")
        .is_cancelled());
}

#[tokio::test]
async fn table_import_cancellation_ids_are_single_owner_and_replay_safe() {
    let state = TableImportCancellationState::default();
    let receiver = state.register("table-import-test_123").await.unwrap();
    assert!(!*receiver.borrow());
    assert!(state
        .register("table-import-test_123")
        .await
        .unwrap_err()
        .contains("already active"));

    let handle = state
        .cancellation_handle("table-import-test_123")
        .await
        .unwrap();
    handle.sender.send(true).unwrap();
    assert!(*receiver.borrow());

    state.take("table-import-test_123").await;
    assert!(state
        .cancellation_handle("table-import-test_123")
        .await
        .is_none());
    assert!(state.register("../unsafe").await.is_err());
}

#[test]
fn legacy_transfer_requests_keep_target_column_quoting_enabled() {
    let request: TableDataTransferRequest = serde_json::from_value(serde_json::json!({
        "transferId": "transfer-legacy-0001",
        "source": {
            "connectionId": "source",
            "driver": "postgres",
            "schema": "public",
            "table": "users"
        },
        "target": {
            "connectionId": "target",
            "driver": "gaussdb",
            "schema": "public",
            "table": "users_copy"
        }
    }))
    .unwrap();
    assert!(request.quote_target_column_names);

    let batch: TableDataTransferBatchPlanRequest = serde_json::from_value(serde_json::json!({
        "sourceConnectionId": "source",
        "sourceDriver": "postgres",
        "sourceSchema": "public",
        "targetConnectionId": "target",
        "targetDriver": "gaussdb",
        "targetSchema": "public",
        "tables": ["users"]
    }))
    .unwrap();
    assert!(batch.quote_target_column_names);
}

#[tokio::test]
async fn data_transfer_cancellation_registry_rejects_replay_until_execution_releases_id() {
    let cancellation = TableDataTransferCancellationState::default();
    let mut receiver = cancellation
        .register("transfer-test-0001", "source")
        .await
        .unwrap();
    assert!(cancellation
        .register("transfer-test-0001", "source")
        .await
        .is_err());

    let handle = cancellation
        .request_cancel("transfer-test-0001")
        .await
        .unwrap();
    handle.sender.send(true).unwrap();
    receiver.changed().await.unwrap();
    assert!(*receiver.borrow());
    assert!(cancellation
        .request_cancel("transfer-test-0001")
        .await
        .is_some());

    cancellation.take("transfer-test-0001").await;
    assert!(cancellation
        .register("transfer-test-0001", "source")
        .await
        .is_ok());
}

#[test]
fn transfer_report_fixture_preserves_baseline_and_legacy_compatibility() {
    let fixture: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/table-data-transfer-report.json"
    )))
    .expect("transfer report fixture JSON should remain valid");
    let current: TableDataTransferReport = serde_json::from_value(
        fixture
            .get("current")
            .cloned()
            .expect("fixture should contain the current report"),
    )
    .expect("current transfer report fixture should deserialize");
    let legacy: TableDataTransferReport = serde_json::from_value(
        fixture
            .get("legacy")
            .cloned()
            .expect("fixture should contain the legacy report"),
    )
    .expect("legacy transfer report fixture should deserialize");

    assert_eq!(current.target_rows_before, Some(41));
    assert_eq!(
        current
            .verification
            .as_ref()
            .and_then(|value| value.expected_rows),
        Some(43)
    );
    assert_eq!(legacy.target_rows_before, None);
    assert!(legacy.verification.is_none());
    assert_eq!(
        legacy.retry_policy,
        TableDataTransferRetryPolicy::FreshPreview
    );
    assert!(legacy.post_commit_receipt.is_none());
    let encoded =
        serde_json::to_value(&current).expect("current transfer report fixture should serialize");
    assert!(encoded.get("connectionString").is_none());
    assert!(encoded.get("sql").is_none());
    assert!(encoded.get("parameters").is_none());
}

#[test]
fn transfer_preview_fixture_preserves_confirmation_and_execution_boundaries() {
    let fixture: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/table-data-transfer-preview.json"
    )))
    .expect("transfer preview fixture JSON should remain valid");
    let append: TableDataTransferPreview = serde_json::from_value(
        fixture
            .get("append")
            .cloned()
            .expect("fixture should contain the append preview"),
    )
    .expect("append transfer preview fixture should deserialize");
    let unsupported: TableDataTransferPreview = serde_json::from_value(
        fixture
            .get("unsupported")
            .cloned()
            .expect("fixture should contain the unsupported preview"),
    )
    .expect("unsupported transfer preview fixture should deserialize");

    assert_eq!(append.target_rows_before, Some(41));
    assert_eq!(append.identity_reseed_columns, vec!["id"]);
    assert!(append.can_execute);
    assert!(append
        .mapped_columns
        .iter()
        .all(|column| column.compatibility != TableDataTransferCompatibility::Unsupported));
    assert!(!unsupported.can_execute);
    assert!(unsupported
        .mapped_columns
        .iter()
        .any(|column| column.compatibility == TableDataTransferCompatibility::Unsupported));
    let encoded =
        serde_json::to_value(&append).expect("append transfer preview fixture should serialize");
    assert!(encoded.get("connectionString").is_none());
    assert!(encoded.get("sql").is_none());
    assert!(encoded.get("parameters").is_none());
}

#[test]
fn writes_streaming_xlsx_with_precision_safe_scalar_cells() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("table-export.xlsx");
    let file = fs::File::create(&path).unwrap();
    let mut writer = StreamingXlsxWriter::new(file, true);
    writer
        .write_header(&["id".to_string(), "label".to_string(), "enabled".to_string()])
        .unwrap();
    writer
        .write_row(&[
            json!(9_007_199_254_740_993_i64),
            json!("A&B <value>"),
            json!(true),
        ])
        .unwrap();
    writer.finish().unwrap();

    let mut workbook = open_workbook_auto(&path).unwrap();
    let sheet = workbook.worksheet_range("Data").unwrap();
    assert_eq!(sheet.get((0, 0)), Some(&Data::String("id".to_string())));
    assert_eq!(
        sheet.get((1, 0)),
        Some(&Data::String("9007199254740993".to_string()))
    );
    assert_eq!(
        sheet.get((1, 1)),
        Some(&Data::String("A&B <value>".to_string()))
    );
    assert_eq!(sheet.get((1, 2)), Some(&Data::Bool(true)));
}

#[test]
fn streaming_xlsx_can_omit_header_auto_filter() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("table-export-no-filter.xlsx");
    let file = fs::File::create(&path).unwrap();
    let mut writer = StreamingXlsxWriter::new(file, false);
    writer.write_header(&["id".to_string()]).unwrap();
    writer.write_row(&[json!(1)]).unwrap();
    writer.finish().unwrap();

    let file = fs::File::open(&path).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    let mut worksheet = String::new();
    archive
        .by_name("xl/worksheets/sheet1.xml")
        .unwrap()
        .read_to_string(&mut worksheet)
        .unwrap();
    assert!(!worksheet.contains("<autoFilter"));
}

#[test]
fn full_data_compare_preview_is_bounded_per_status() {
    let mut preview = Vec::new();
    for index in 0..=MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS {
        if preview.len() < MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS {
            preview.push(index);
        }
    }
    assert_eq!(preview.len(), MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS);
    assert_eq!(preview.first(), Some(&0));
    assert_eq!(
        preview.last(),
        Some(&(MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS - 1))
    );
}

#[test]
fn full_data_compare_fixture_preserves_exact_counts_and_bounded_preview() {
    let result: TableDataCompareResult = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/table-data-compare-result.json"
    )))
    .expect("full data compare fixture should deserialize");

    assert_eq!(result.added_count, 2_500);
    assert_eq!(result.modified_count, 1_400);
    assert_eq!(result.detail_limit_per_status, 1_000);
    assert!(result.details_truncated);
    assert_eq!(
        result.degradation_level,
        TableDataCompareDegradationLevel::Full
    );
    assert!(result.counts_exact);
    assert_eq!(result.sampling_rate, 1.0);
    assert_eq!(result.confidence_score, Some(1.0));
    assert_eq!(result.added.len(), 1);
    assert_eq!(result.modified.len(), 1);
    assert!(result.added.len() < result.added_count as usize);
    assert!(result.modified.len() < result.modified_count as usize);
}

#[tokio::test]
async fn data_compare_cancellation_registry_binds_both_endpoint_query_ids() {
    let cancellation = TableDataCompareCancellationState::default();
    let (receiver, source_query_id, target_query_id) = cancellation
        .register(
            "compare-test-0001",
            "source-connection",
            "target-connection",
        )
        .await
        .unwrap();
    assert_eq!(source_query_id, "compare-test-0001-source");
    assert_eq!(target_query_id, "compare-test-0001-target");
    assert!(cancellation
        .register(
            "compare-test-0001",
            "source-connection",
            "target-connection"
        )
        .await
        .is_err());

    let handle = cancellation
        .request_cancel("compare-test-0001")
        .await
        .unwrap();
    handle.sender.send(true).unwrap();
    assert!(*receiver.borrow());
    assert_eq!(handle.source_connection_id, "source-connection");
    assert_eq!(handle.target_connection_id, "target-connection");

    cancellation.take("compare-test-0001").await;
    assert!(cancellation
        .request_cancel("compare-test-0001")
        .await
        .is_none());
}
