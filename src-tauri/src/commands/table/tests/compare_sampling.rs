use super::super::compare_rows::{data_compare_sample_coverage, fetch_sampled_data_compare_rows};
use super::super::compare_sampling::{fetch_data_compare_sample_keys, sample_windows};
use super::*;

fn endpoint(table: &str) -> TableDataCompareEndpoint {
    TableDataCompareEndpoint {
        connection_id: "sampling".into(),
        driver: "sqlite".into(),
        database: None,
        schema: "main".into(),
        table: table.into(),
    }
}

async fn fixture(sql: &str) -> ConnectionManager {
    let manager = ConnectionManager::new();
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver.query(sql).await.unwrap();
    manager
        .add_connection("sampling".into(), Box::new(driver))
        .await;
    manager
}

#[test]
fn sampling_windows_cover_disjoint_strata_within_query_and_position_budgets() {
    for rows in 0..=100_u64 {
        for size in 1..=100 {
            for strategy in [
                TableDataCompareSamplingStrategy::ExtremeValues,
                TableDataCompareSamplingStrategy::Stratified,
            ] {
                let windows = sample_windows(rows, size, &strategy).unwrap();
                let mut positions = std::collections::BTreeSet::new();
                for window in windows {
                    assert!(window.limit <= 1000);
                    let start = if window.descending {
                        rows - window.offset - u64::from(window.limit)
                    } else {
                        window.offset
                    };
                    for position in start..start + u64::from(window.limit) {
                        assert!(
                            position < rows && positions.insert(position),
                            "strata must not overlap"
                        );
                    }
                }
                assert_eq!(positions.len() as u64, rows.min(u64::from(size)));
            }
        }
    }
    for strategy in [
        TableDataCompareSamplingStrategy::ExtremeValues,
        TableDataCompareSamplingStrategy::Stratified,
    ] {
        let windows = sample_windows(10_000_000, 10_000, &strategy).unwrap();
        assert!(windows.len() <= 16);
        assert!(windows.iter().all(|window| window.limit <= 1000));
        assert_eq!(
            windows
                .iter()
                .map(|window| u64::from(window.limit))
                .sum::<u64>(),
            10_000
        );
        assert!(
            windows
                .iter()
                .map(|window| window.offset + u64::from(window.limit))
                .sum::<u64>()
                <= 40_000_000
        );
    }
    assert!(sample_windows(
        10_000_001,
        10,
        &TableDataCompareSamplingStrategy::Stratified
    )
    .is_err());
    assert!(sample_windows(10, 10_001, &TableDataCompareSamplingStrategy::Stratified).is_err());
}

#[tokio::test]
async fn stratified_sampling_finds_middle_only_difference_that_extremes_miss() {
    let manager = fixture("CREATE TABLE source(id INTEGER PRIMARY KEY,value TEXT NOT NULL); WITH RECURSIVE n(i) AS(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<100001) INSERT INTO source SELECT i,'same' FROM n; CREATE TABLE target(id INTEGER PRIMARY KEY,value TEXT NOT NULL); INSERT INTO target SELECT * FROM source; UPDATE target SET value='middle change' WHERE id=50001;").await;
    let columns = vec!["id".into(), "value".into()];
    let keys = vec!["id".into()];
    let metadata = column_lookup(
        manager
            .get_columns("sampling", "main", "source")
            .await
            .unwrap(),
    );
    let (_sender, cancellation) = watch::channel(false);
    for strategy in [
        TableDataCompareSamplingStrategy::ExtremeValues,
        TableDataCompareSamplingStrategy::Stratified,
    ] {
        let source_keys = fetch_data_compare_sample_keys(
            &manager,
            &endpoint("source"),
            "sample-source",
            &cancellation,
            DatabaseKind::Postgres,
            &keys,
            3,
            100001,
            &strategy,
            |_| {},
        )
        .await
        .unwrap();
        let target_keys = fetch_data_compare_sample_keys(
            &manager,
            &endpoint("target"),
            "sample-target",
            &cancellation,
            DatabaseKind::Postgres,
            &keys,
            3,
            100001,
            &strategy,
            |_| {},
        )
        .await
        .unwrap();
        let shared = merge_data_compare_sample_keys(source_keys, target_keys).unwrap();
        let source = fetch_sampled_data_compare_rows(
            &manager,
            &endpoint("source"),
            &cancellation,
            DatabaseKind::Postgres,
            &columns,
            &metadata,
            &keys,
            &shared,
            |_| {},
        )
        .await
        .unwrap();
        let target = fetch_sampled_data_compare_rows(
            &manager,
            &endpoint("target"),
            &cancellation,
            DatabaseKind::Postgres,
            &columns,
            &metadata,
            &keys,
            &shared,
            |_| {},
        )
        .await
        .unwrap();
        let coverage = data_compare_sample_coverage(source.len(), target.len(), 100001, 100001);
        let result = build_table_data_compare_result(
            source,
            target,
            &columns,
            &keys,
            100001,
            100001,
            1000,
            TableDataCompareDegradationLevel::Sample,
            Some(strategy.clone()),
            coverage,
            None,
            "sampling_acceptance",
            true,
            &cancellation,
        )
        .unwrap();
        assert!(!result.counts_exact && result.confidence_score.is_none());
        assert_eq!(result.sampled_key_count, 3);
        if strategy == TableDataCompareSamplingStrategy::Stratified {
            assert_eq!(result.modified_count, 1);
            assert_eq!(result.modified[0].source_values["id"], json!(50001));
            assert_eq!(result.checksums_match, Some(false));
        } else {
            assert_eq!(result.modified_count, 0);
            assert_eq!(result.checksums_match, Some(true));
        }
    }
}

#[tokio::test]
async fn both_sampling_strategies_read_ten_thousand_keys_without_driver_truncation() {
    let manager=fixture("CREATE TABLE source(id INTEGER PRIMARY KEY); WITH RECURSIVE n(i) AS(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<20000) INSERT INTO source SELECT i FROM n;").await;
    let (_sender, cancellation) = watch::channel(false);
    for strategy in [
        TableDataCompareSamplingStrategy::ExtremeValues,
        TableDataCompareSamplingStrategy::Stratified,
    ] {
        let keys = fetch_data_compare_sample_keys(
            &manager,
            &endpoint("source"),
            "sample-large",
            &cancellation,
            DatabaseKind::Postgres,
            &["id".into()],
            10000,
            20000,
            &strategy,
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(keys.len(), 10000);
        assert!(keys.iter().any(|key| key[0] == json!(1)));
        assert!(keys.iter().any(|key| key[0] == json!(20000)));
    }
}

#[tokio::test]
async fn sampling_preserves_sparse_composite_unicode_and_large_integer_keys() {
    let manager=fixture("CREATE TABLE source(tenant TEXT COLLATE BINARY NOT NULL,id INTEGER NOT NULL,PRIMARY KEY(tenant,id)) WITHOUT ROWID; WITH RECURSIVE n(i) AS(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<101) INSERT INTO source SELECT CASE WHEN i%2=0 THEN '租户-ß' ELSE 'a' END,9007199254740993+i*7 FROM n;").await;
    let (_sender, cancellation) = watch::channel(false);
    let keys = fetch_data_compare_sample_keys(
        &manager,
        &endpoint("source"),
        "sample-composite",
        &cancellation,
        DatabaseKind::Postgres,
        &["tenant".into(), "id".into()],
        17,
        101,
        &TableDataCompareSamplingStrategy::Stratified,
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(keys.len(), 17);
    assert!(keys
        .iter()
        .all(|key| key[1].as_i64().unwrap() > 9_007_199_254_740_992));
    assert!(keys.iter().any(|key| key[0] == json!("租户-ß")));
    assert!(keys.iter().any(|key| key[0] == json!("a")));
}

#[tokio::test]
async fn sampling_rejects_incomplete_windows_and_stops_between_windows_on_cancel() {
    let manager =
        fixture("CREATE TABLE source(id INTEGER PRIMARY KEY); INSERT INTO source VALUES(1);").await;
    let (_sender, cancellation) = watch::channel(false);
    let error = fetch_data_compare_sample_keys(
        &manager,
        &endpoint("source"),
        "sample-short",
        &cancellation,
        DatabaseKind::Postgres,
        &["id".into()],
        100,
        10000,
        &TableDataCompareSamplingStrategy::Stratified,
        |_| {},
    )
    .await
    .unwrap_err();
    assert!(error.contains("incomplete"));
    for count in [1, 2] {
        let (sender, cancellation) = watch::channel(false);
        let mut events = 0;
        let error = fetch_data_compare_sample_keys(
            &manager,
            &endpoint("source"),
            "sample-cancel",
            &cancellation,
            DatabaseKind::Postgres,
            &["id".into()],
            count,
            count.into(),
            &TableDataCompareSamplingStrategy::Stratified,
            |_| {
                events += 1;
                sender.send(true).unwrap();
            },
        )
        .await;
        // Cover both the next-window boundary and the final window.
        assert_eq!(events, 1);
        assert!(error.unwrap_err().contains("TABLE_DATA_COMPARE_CANCELLED"));
    }
}

#[test]
fn sampling_coverage_counts_actual_rows_in_each_endpoint_instead_of_union_keys() {
    assert_eq!(
        data_compare_sample_coverage(10000, 10000, 1000000, 1000000),
        0.01
    );
    assert_eq!(
        data_compare_sample_coverage(10000, 5000, 1000000, 1000000),
        0.005
    );
    assert_eq!(data_compare_sample_coverage(0, 5000, 0, 1000000), 0.005);
}
