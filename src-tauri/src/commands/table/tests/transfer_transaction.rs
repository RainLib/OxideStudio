use super::*;

#[tokio::test]
async fn data_transfer_overwrite_uses_transactional_delete_and_rechecks_reviewed_count() {
    let manager = ConnectionManager::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    manager
        .add_connection(
            "target".to_string(),
            Box::new(TransferTransactionDriver {
                events: Arc::clone(&events),
                delete_rows: 12,
                rollback_error: None,
            }),
        )
        .await;
    let endpoint = TableDataTransferEndpoint {
        connection_id: "target".to_string(),
        driver: "mysql".to_string(),
        schema: "app".to_string(),
        table: "users".to_string(),
        database: None,
    };

    delete_table_data_transfer_target_for_overwrite(
        &manager,
        &endpoint,
        DatabaseKind::Mysql,
        "transfer-overwrite",
        12,
    )
    .await
    .unwrap();
    assert_eq!(
        events.lock().expect("transfer event mutex").as_slice(),
        ["execute:transfer-overwrite:DELETE FROM `app`.`users`"]
    );

    let error = delete_table_data_transfer_target_for_overwrite(
        &manager,
        &endpoint,
        DatabaseKind::Mysql,
        "transfer-overwrite",
        11,
    )
    .await
    .unwrap_err();
    assert!(error.contains("changed after preview"));
    assert!(error.contains("expected to delete 11"));
}

#[tokio::test]
async fn data_transfer_commits_only_after_a_successful_complete_plan() {
    let manager = ConnectionManager::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    manager
        .add_connection(
            "target".to_string(),
            Box::new(TransferTransactionDriver {
                events: Arc::clone(&events),
                delete_rows: 0,
                rollback_error: None,
            }),
        )
        .await;

    let summary = finish_table_data_transfer_transaction(
        &manager,
        "target",
        "transfer-1",
        Ok((42, 3, false)),
    )
    .await
    .unwrap();

    assert_eq!(summary, (42, 3, false));
    assert_eq!(
        events.lock().expect("transfer event mutex").as_slice(),
        ["commit:transfer-1"]
    );
}

#[tokio::test]
async fn data_transfer_rolls_back_without_committing_after_any_batch_failure() {
    let manager = ConnectionManager::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    manager
        .add_connection(
            "target".to_string(),
            Box::new(TransferTransactionDriver {
                events: Arc::clone(&events),
                delete_rows: 0,
                rollback_error: None,
            }),
        )
        .await;

    let error = finish_table_data_transfer_transaction(
        &manager,
        "target",
        "transfer-2",
        Err("batch 2 rejected a value".to_string()),
    )
    .await
    .unwrap_err();

    assert!(error.contains("rolled back"));
    assert!(error.contains("batch 2 rejected a value"));
    assert_eq!(
        events.lock().expect("transfer event mutex").as_slice(),
        ["rollback:transfer-2"]
    );
}

#[tokio::test]
async fn data_transfer_marks_the_target_for_manual_inspection_when_rollback_fails() {
    let manager = ConnectionManager::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    manager
        .add_connection(
            "target".to_string(),
            Box::new(TransferTransactionDriver {
                events: Arc::clone(&events),
                delete_rows: 0,
                rollback_error: Some("target connection was lost".to_string()),
            }),
        )
        .await;

    let error = finish_table_data_transfer_transaction(
        &manager,
        "target",
        "transfer-rollback-failure",
        Err("batch 4 rejected a value".to_string()),
    )
    .await
    .unwrap_err();

    assert!(error.contains("rollback also failed"));
    assert!(error.contains("inspect the target before retrying"));
    assert!(error.contains("target connection was lost"));
    assert_eq!(
        events.lock().expect("transfer event mutex").as_slice(),
        ["rollback:transfer-rollback-failure"]
    );
}

#[test]
fn mysql_post_commit_receipt_blocks_ambiguous_automatic_retry() {
    let completed = post_commit_schema_receipt(3, 3, false);
    assert_eq!(
        completed.status,
        TableDataTransferPostCommitStatus::Completed
    );
    assert_eq!(completed.statements_succeeded, 3);
    assert!(!completed.message.contains("automatic retry is disabled"));

    let partial = post_commit_schema_receipt(3, 1, false);
    assert_eq!(
        partial.status,
        TableDataTransferPostCommitStatus::NeedsManualReview
    );
    assert_eq!(partial.statements_total, 3);
    assert_eq!(partial.statements_succeeded, 1);
    assert!(partial.message.contains("Row writes are committed"));
    assert!(partial.message.contains("automatic retry is disabled"));
    assert!(!partial.message.contains("ALTER TABLE"));

    let cancelled = post_commit_schema_receipt(2, 0, true);
    assert_eq!(
        cancelled.status,
        TableDataTransferPostCommitStatus::NeedsManualReview
    );
    assert!(cancelled.message.contains("cancelled"));
}

#[tokio::test]
async fn mysql_post_commit_execution_stops_at_first_failure_and_counts_per_table() {
    let manager = ConnectionManager::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    manager
        .add_connection(
            "target".to_string(),
            Box::new(PostCommitTransferDriver {
                events: Arc::clone(&events),
            }),
        )
        .await;
    let statements = vec![
        PostCommitSchemaStatement {
            table_index: 0,
            sql: "FIRST".to_string(),
        },
        PostCommitSchemaStatement {
            table_index: 1,
            sql: "FAIL".to_string(),
        },
        PostCommitSchemaStatement {
            table_index: 0,
            sql: "MUST_NOT_RUN".to_string(),
        },
    ];
    let (_, cancel_rx) = watch::channel(false);

    let execution =
        execute_mysql_post_commit_schema_statements(&manager, "target", &statements, 2, &cancel_rx)
            .await;

    assert_eq!(
        execution.receipt.status,
        TableDataTransferPostCommitStatus::NeedsManualReview
    );
    assert_eq!(execution.receipt.statements_succeeded, 1);
    assert_eq!(execution.succeeded_by_table, vec![1, 0]);
    assert_eq!(
        events.lock().expect("post-commit event mutex").as_slice(),
        ["FIRST", "FAIL"]
    );
    assert!(!execution.receipt.message.contains("sensitive detail"));
}
