use super::*;

#[test]
fn preview_skips_column_metadata_without_structured_filters_or_sort() {
    let filters = [TableFilter {
        column: "status".to_string(),
        operator: "eq".to_string(),
        value: "active".to_string(),
        logic: None,
    }];
    let sort = TableSort {
        column: "id".to_string(),
        direction: "asc".to_string(),
    };

    assert!(!preview_metadata_required(None, None));
    assert!(preview_metadata_required(Some(&filters), None));
    assert!(preview_metadata_required(None, Some(&sort)));
}

#[test]
fn full_data_compare_key_preserves_composite_value_boundaries() {
    let columns = vec!["tenant".to_string(), "id".to_string()];
    let values = data_compare_row_values(&columns, &[json!("a\u{001f}b"), json!(7)]);
    assert_eq!(
        data_compare_key(&values, &columns),
        "\"a\\u001fb\"\u{001f}7"
    );
}

#[test]
fn full_data_compare_keyset_uses_bound_values_and_lexicographic_order() {
    let keys = vec![
        ColumnInfo {
            name: "tenant_id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: true,
            is_unique: true,
            is_indexed: true,
            is_auto_increment: false,
            identity_generation: None,
            default_value: None,
            comment: None,
            is_generated: Some(false),
            is_hidden: Some(false),
        },
        ColumnInfo {
            name: "id".to_string(),
            data_type: "bigint".to_string(),
            is_nullable: false,
            is_primary_key: true,
            is_unique: true,
            is_indexed: true,
            is_auto_increment: false,
            identity_generation: None,
            default_value: None,
            comment: None,
            is_generated: Some(false),
            is_hidden: Some(false),
        },
    ];
    let (predicate, params) = data_compare_keyset_continuation(
        DatabaseKind::Postgres,
        &keys,
        Some(&[json!(7), json!(42)]),
        true,
    )
    .unwrap();
    assert_eq!(
            predicate.as_deref(),
            Some("((\"tenant_id\" > $1::integer) OR (\"tenant_id\" = $2::integer AND \"id\" > $3::bigint))")
        );
    assert_eq!(
        params
            .into_iter()
            .map(|item| item.value)
            .collect::<Vec<_>>(),
        vec![json!(7), json!(7), json!(42)]
    );
    assert!(data_compare_keyset_continuation(
        DatabaseKind::Mysql,
        &keys,
        Some(&[Value::Null, json!(42)]),
        false,
    )
    .unwrap_err()
    .contains("NULL key"));
}

#[test]
fn sampled_data_compare_thresholds_degrade_without_silently_raising_limits() {
    let threshold = TableDataCompareDegradationThreshold::default();
    assert_eq!(
        data_compare_degradation_level(100_000, 99_999, &threshold),
        TableDataCompareDegradationLevel::Full
    );
    assert_eq!(
        data_compare_degradation_level(100_001, 100_000, &threshold),
        TableDataCompareDegradationLevel::Sample
    );
    assert_eq!(
        data_compare_degradation_level(10_000_001, 1, &threshold),
        TableDataCompareDegradationLevel::SkipWithRisk
    );
    assert!(normalized_data_compare_threshold(
        None,
        Some(TableDataCompareDegradationThreshold {
            full_compare_max_rows: 100_001,
            ..threshold.clone()
        }),
    )
    .unwrap_err()
    .contains("Full data compare row threshold"));
    assert!(
        normalized_data_compare_threshold(Some(100_000), Some(threshold),)
            .unwrap_err()
            .contains("either maxRows or degradationThreshold")
    );
}

#[test]
fn sampled_data_compare_uses_one_bound_key_universe_on_both_sides() {
    let merged = merge_data_compare_sample_keys(
        vec![vec![json!(1)], vec![json!(5)]],
        vec![vec![json!(1)], vec![json!(9)]],
    )
    .unwrap();
    assert_eq!(merged, vec![vec![json!(1)], vec![json!(5)], vec![json!(9)]]);

    let mut id = target_column("id");
    id.is_nullable = false;
    id.data_type = "integer".to_string();
    let (postgres_predicate, postgres_params) =
        data_compare_sample_key_predicate(DatabaseKind::Postgres, &[id.clone()], &merged, true)
            .unwrap();
    assert_eq!(
        postgres_predicate,
        "((\"id\" = $1::integer) OR (\"id\" = $2::integer) OR (\"id\" = $3::integer))"
    );
    assert_eq!(postgres_params.len(), 3);

    let (sqlite_predicate, _) =
        data_compare_sample_key_predicate(DatabaseKind::Postgres, &[id], &merged, false).unwrap();
    assert_eq!(
        sqlite_predicate,
        "((\"id\" = $1) OR (\"id\" = $2) OR (\"id\" = $3))"
    );
}

#[test]
fn sampled_data_compare_reports_sample_local_counts_and_bounded_checksums() {
    let columns = vec!["id".to_string(), "score".to_string()];
    let keys = vec!["id".to_string()];
    let (_cancel_sender, cancellation) = watch::channel(false);
    let result = build_table_data_compare_result(
        vec![
            data_compare_row_values(&columns, &[json!(1), json!(10)]),
            data_compare_row_values(&columns, &[json!(2), json!(20)]),
        ],
        vec![
            data_compare_row_values(&columns, &[json!(1), json!(11)]),
            data_compare_row_values(&columns, &[json!(3), json!(30)]),
        ],
        &columns,
        &keys,
        1_000_000,
        1_000_000,
        1_000,
        TableDataCompareDegradationLevel::Sample,
        Some(TableDataCompareSamplingStrategy::ExtremeValues),
        0.000_003,
        None,
        "extreme_key_sample",
        true,
        &cancellation,
    )
    .unwrap();
    assert!(!result.counts_exact);
    assert_eq!(result.sampled_key_count, 3);
    assert_eq!(result.added_count, 1);
    assert_eq!(result.removed_count, 1);
    assert_eq!(result.modified_count, 1);
    assert_eq!(result.equal_count, 0);
    assert_eq!(result.checksums_match, Some(false));
    assert!(result.confidence_score.is_none());
    assert_eq!(
        result.source_checksums.as_ref().map(BTreeMap::len),
        Some(columns.len())
    );
}

#[test]
fn sync_preview_rejects_sampled_or_truncated_comparisons() {
    let request = TableDataCompareSyncPreviewRequest {
        target: TableDataCompareEndpoint {
            connection_id: "target".to_string(),
            driver: "postgresql".to_string(),
            database: None,
            schema: "public".to_string(),
            table: "users".to_string(),
        },
        columns: vec!["id".to_string()],
        key_columns: vec!["id".to_string()],
        comparison: skipped_table_data_compare_result(10_000_001, 10_000_001, 1_000),
    };
    assert!(validate_table_data_compare_sync_preview(&request).is_err());

    let mut truncated = request;
    truncated.comparison.degradation_level = TableDataCompareDegradationLevel::Full;
    truncated.comparison.counts_exact = true;
    truncated.comparison.details_truncated = true;
    assert!(validate_table_data_compare_sync_preview(&truncated).is_err());
}
