use super::*;

#[test]
fn exact_data_compare_builds_a_bounded_review_only_sync_script() {
    let columns = vec!["id".to_string(), "name".to_string()];
    let keys = vec!["id".to_string()];
    let (_cancel_sender, cancellation) = watch::channel(false);
    let comparison = build_table_data_compare_result(
        vec![
            data_compare_row_values(&columns, &[json!(1), json!("O'Reilly")]),
            data_compare_row_values(&columns, &[json!(2), json!("New")]),
        ],
        vec![
            data_compare_row_values(&columns, &[json!(1), json!("Old")]),
            data_compare_row_values(&columns, &[json!(3), json!("Gone")]),
        ],
        &columns,
        &keys,
        2,
        2,
        1_000,
        TableDataCompareDegradationLevel::Full,
        None,
        1.0,
        Some(1.0),
        "full_keyset",
        true,
        &cancellation,
    )
    .unwrap();
    let request = TableDataCompareSyncPreviewRequest {
        target: TableDataCompareEndpoint {
            connection_id: "target".to_string(),
            driver: "postgresql".to_string(),
            database: Some("app".to_string()),
            schema: "public".to_string(),
            table: "users".to_string(),
        },
        columns: columns.clone(),
        key_columns: keys.clone(),
        comparison,
    };
    let (validated_columns, validated_keys) =
        validate_table_data_compare_sync_preview(&request).unwrap();
    let mut id = target_column("id");
    id.data_type = "integer".to_string();
    id.is_nullable = false;
    id.is_primary_key = true;
    let mut name = target_column("name");
    name.data_type = "text".to_string();
    let metadata = column_lookup(vec![id, name]);
    let (statements, skipped) = build_table_data_compare_sync_statements(
        &request,
        DatabaseKind::Postgres,
        SqlExportDialect::Postgres,
        &metadata,
        &validated_columns,
        &validated_keys,
    )
    .unwrap();

    assert_eq!(skipped, 0);
    assert_eq!(statements.len(), 3);
    assert_eq!(
        statements[0],
        "INSERT INTO \"public\".\"users\" (\"id\", \"name\") VALUES (2, 'New');"
    );
    assert_eq!(
            statements[1],
            "UPDATE \"public\".\"users\" SET \"name\" = 'O''Reilly' WHERE \"id\" = 1 AND \"name\" = 'Old';"
        );
    assert_eq!(
        statements[2],
        "DELETE FROM \"public\".\"users\" WHERE \"id\" = 3 AND \"name\" = 'Gone';"
    );

    let (parameterized, parameterized_skipped) =
        build_table_data_compare_sync_parameterized_statements(
            &request,
            DatabaseKind::Postgres,
            &metadata,
            &validated_columns,
            &validated_keys,
        )
        .unwrap();
    assert_eq!(parameterized_skipped, 0);
    assert_eq!(parameterized.len(), 3);
    assert_eq!(
            parameterized[1].sql,
            "UPDATE \"public\".\"users\" SET \"name\" = $1::text WHERE \"id\" = $2::integer AND \"name\" = $3::text;"
        );
    assert_eq!(
        parameterized[1]
            .params
            .iter()
            .map(|parameter| parameter.value.clone())
            .collect::<Vec<_>>(),
        vec![json!("O'Reilly"), json!(1), json!("Old")]
    );
    assert!(!parameterized[1].sql.contains("O'Reilly"));
}

#[tokio::test]
async fn frozen_synchronization_rolls_back_when_snapshot_affects_no_row() {
    let mut id = target_column("id");
    id.data_type = "integer".to_string();
    id.is_nullable = false;
    id.is_primary_key = true;
    let columns = vec![id, target_column("name")];
    let metadata_digest =
        table_data_compare_sync_metadata_digest(&column_lookup(columns.clone())).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let manager = ConnectionManager::new();
    manager
        .replace_connection_with_tunnel_and_driver_id(
            "target".to_string(),
            Box::new(SyncTransactionDriver {
                events: Arc::clone(&events),
                affected_rows: 0,
                columns,
            }),
            None,
            Some("postgres".to_string()),
        )
        .await
        .unwrap();
    let plan = FrozenTableDataCompareSyncPlan {
            target: TableDataCompareEndpoint {
                connection_id: "target".to_string(),
                driver: "postgres".to_string(),
                database: None,
                schema: "public".to_string(),
                table: "users".to_string(),
            },
            metadata_digest,
            statements: vec![ParameterizedStatement {
                sql: "UPDATE \"public\".\"users\" SET \"name\" = $1::text WHERE \"id\" = $2::integer AND \"name\" = $3::text;".to_string(),
                params: vec![],
            }],
            insert_count: 0,
            update_count: 1,
            delete_count: 0,
            plan_digest: "plan".to_string(),
            confirmation_text: "SYNC public.users".to_string(),
            expires_at: i64::MAX,
        };

    let error = execute_frozen_table_data_compare_sync(&manager, plan)
        .await
        .unwrap_err();
    assert!(error.contains("expected one affected row"));
    let events = events.lock().expect("sync event mutex");
    assert_eq!(events.len(), 3);
    assert!(events[0].starts_with("begin:table-compare-sync-"));
    assert!(events[1].starts_with("execute:table-compare-sync-"));
    assert!(events[2].starts_with("rollback:table-compare-sync-"));
    assert!(!events.iter().any(|event| event.starts_with("commit:")));
}
