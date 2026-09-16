use super::*;

#[test]
fn analytical_type_plan_covers_native_and_duckdb_scalar_types() {
    assert_eq!(
        analytical_column_kind(AnalyticalTypePolicy::Native, "BIGINT UNSIGNED").0,
        AnalyticalColumnKind::UInt64
    );
    assert_eq!(
        analytical_column_kind(AnalyticalTypePolicy::DuckDb, "UBIGINT").0,
        AnalyticalColumnKind::UInt64
    );
    assert_eq!(
        analytical_column_kind(AnalyticalTypePolicy::Native, "TIMESTAMP WITH TIME ZONE",).0,
        AnalyticalColumnKind::TimestampMicrosecond { utc: true }
    );
    assert_eq!(
        analytical_column_kind(AnalyticalTypePolicy::Native, "MEDIUMBLOB").0,
        AnalyticalColumnKind::Binary
    );
    let decimal = analytical_column_kind(AnalyticalTypePolicy::Native, "DECIMAL(38, 12)");
    assert_eq!(decimal.0, AnalyticalColumnKind::Utf8);
    assert!(decimal.2.is_some());
    let sqlite = analytical_column_kind(AnalyticalTypePolicy::SqliteDynamic, "INTEGER");
    assert_eq!(sqlite.0, AnalyticalColumnKind::Utf8);
    assert!(sqlite.2.unwrap().contains("mixed storage classes"));
}

#[test]
fn analytical_value_conversions_accept_canonical_driver_representations() {
    assert_eq!(analytical_date32(&json!(0)).unwrap(), Some(0));
    assert_eq!(
        analytical_timestamp_micros(&json!("Microsecond:123456"), false).unwrap(),
        Some(123_456)
    );
    assert_eq!(
        analytical_timestamp_micros(&json!("1970-01-01T00:00:01Z"), true).unwrap(),
        Some(1_000_000)
    );
    assert_eq!(
        analytical_binary(&json!("0x00ff10")).unwrap(),
        Some(vec![0x00, 0xff, 0x10])
    );
    assert_eq!(
        analytical_binary(&json!("plain text")).unwrap(),
        Some(b"plain text".to_vec())
    );
}
