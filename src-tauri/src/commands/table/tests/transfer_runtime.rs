use super::*;

#[test]
fn table_transfer_progress_is_bounded_but_keeps_the_first_update() {
    let mut last = Some(0_u64);
    assert!(!should_emit_table_data_transfer_progress(&mut last, 1));
    assert!(!should_emit_table_data_transfer_progress(
        &mut last,
        TABLE_DATA_TRANSFER_PROGRESS_BATCH_INTERVAL - 1,
    ));
    assert!(should_emit_table_data_transfer_progress(
        &mut last,
        TABLE_DATA_TRANSFER_PROGRESS_BATCH_INTERVAL,
    ));
    assert_eq!(last, Some(TABLE_DATA_TRANSFER_PROGRESS_BATCH_INTERVAL));

    let mut empty = None;
    assert!(should_emit_table_data_transfer_progress(&mut empty, 1));
    assert_eq!(empty, Some(1));
}

#[test]
fn table_transfer_progress_relay_queue_is_bounded() {
    let (sender, receiver) = mpsc::channel(TABLE_DATA_TRANSFER_PROGRESS_QUEUE_CAPACITY);
    for batches in 0..=TABLE_DATA_TRANSFER_PROGRESS_QUEUE_CAPACITY {
        try_send_table_data_transfer_progress(
            &sender,
            TableDataTransferProgress {
                transfer_id: "transfer".to_string(),
                rows_transferred: batches as u64,
                max_rows: 100,
                batches: batches as u64,
                status: TableDataTransferProgressStatus::Running,
                terminal: false,
                message: None,
            },
        );
    }
    assert_eq!(receiver.len(), TABLE_DATA_TRANSFER_PROGRESS_QUEUE_CAPACITY);
}

#[test]
fn data_transfer_ids_are_bounded_and_safe_for_driver_query_tracking() {
    assert!(validate_table_data_transfer_id("transfer-12345678").is_ok());
    assert!(validate_table_data_transfer_id("short").is_err());
    assert!(validate_table_data_transfer_id("transfer/escape").is_err());
    assert!(validate_table_data_transfer_id(&"x".repeat(129)).is_err());
}

#[test]
fn data_transfer_overwrite_row_count_is_hard_bounded() {
    assert_eq!(
        validate_table_data_transfer_overwrite_rows(MAX_TRANSFER_OVERWRITE_ROWS).unwrap(),
        MAX_TRANSFER_OVERWRITE_ROWS
    );
    assert!(
        validate_table_data_transfer_overwrite_rows(MAX_TRANSFER_OVERWRITE_ROWS + 1)
            .unwrap_err()
            .contains("Overwrite is limited")
    );
}

#[test]
fn data_transfer_progress_errors_are_bounded_before_emission() {
    let message = bounded_table_data_transfer_message(&"值".repeat(2_000));
    assert_eq!(message.chars().count(), 1_025);
    assert!(message.ends_with('…'));
}

#[test]
fn overwrite_transfer_post_verify_requires_an_exact_target_count() {
    let verified = overwrite_transfer_verification(4, Some(4));
    assert_eq!(
        verified.status,
        TableDataTransferVerificationStatus::Verified
    );
    assert_eq!(verified.observed_rows, Some(4));

    let concurrent_write = overwrite_transfer_verification(4, Some(5));
    assert_eq!(
        concurrent_write.status,
        TableDataTransferVerificationStatus::NeedsReview
    );

    let unavailable = overwrite_transfer_verification(4, None);
    assert_eq!(
        unavailable.status,
        TableDataTransferVerificationStatus::NeedsReview
    );
    assert_eq!(unavailable.observed_rows, None);
}

#[test]
fn append_transfer_post_verify_binds_baseline_and_copied_rows() {
    let verified = append_transfer_verification(Some(8), 4, Some(12));
    assert_eq!(
        verified.status,
        TableDataTransferVerificationStatus::Verified
    );
    assert_eq!(verified.expected_rows, Some(12));

    let concurrent_write = append_transfer_verification(Some(8), 4, Some(13));
    assert_eq!(
        concurrent_write.status,
        TableDataTransferVerificationStatus::NeedsReview
    );
    assert_eq!(concurrent_write.expected_rows, Some(12));
    assert_eq!(concurrent_write.observed_rows, Some(13));

    let missing_baseline = append_transfer_verification(None, 4, Some(12));
    assert_eq!(
        missing_baseline.status,
        TableDataTransferVerificationStatus::NeedsReview
    );
    assert_eq!(missing_baseline.expected_rows, None);
}

#[test]
fn postgres_identity_verification_query_quotes_reviewed_identifiers() {
    let query = postgres_identity_reseed_verification_query(
        &TableDataTransferEndpoint {
            connection_id: "target".to_string(),
            driver: "postgres".to_string(),
            schema: "sales data".to_string(),
            table: "order's".to_string(),
            database: None,
        },
        "identity value",
    );

    assert!(query.contains(r#"FROM "sales data"."order's""#));
    assert!(query.contains(r#"MAX("identity value")"#));
    assert!(query.contains(r#"'"sales data"."order''s"'"#));
    assert!(query.contains("'identity value'"));
    assert!(query.contains("pg_sequence_last_value"));
}
