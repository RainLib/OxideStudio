use super::*;

#[test]
fn import_schema_inference_keeps_identifiers_and_uses_native_type_families() {
    assert_eq!(
        import_string_inferred_type("00123"),
        ImportInferredType::Text,
        "leading-zero values are identifiers, not numeric keys"
    );
    assert_eq!(
        import_string_inferred_type("1,234"),
        ImportInferredType::Integer
    );
    assert_eq!(
        import_string_inferred_type("1,234.50"),
        ImportInferredType::Decimal
    );
    assert_eq!(
        import_string_inferred_type("2026-08-31"),
        ImportInferredType::Date
    );
    assert_eq!(
        import_string_inferred_type("2026-08-31T14:22:00Z"),
        ImportInferredType::Timestamp
    );
    assert_eq!(
        inferred_import_data_type(ImportInferredType::Json, "postgres").unwrap(),
        "JSONB"
    );
    assert_eq!(
        inferred_import_data_type(ImportInferredType::Timestamp, "mysql").unwrap(),
        "DATETIME"
    );
    assert_eq!(
        inferred_import_data_type(ImportInferredType::Decimal, "sqlite").unwrap(),
        "REAL"
    );
}

#[test]
fn import_schema_inference_returns_reviewable_csv_mapping_and_object_types() {
    let directory = tempfile::tempdir().unwrap();
    let csv_path = directory.path().join("orders.csv");
    fs::write(
        &csv_path,
        "order_code,total,created_at\n00123,\"1,234.50\",2026-08-31\n00456,8.25,2026-09-01\n",
    )
    .unwrap();
    let (columns, rows, options) =
        infer_csv_import_columns(&csv_path, "postgres", Some(true), None).unwrap();
    assert_eq!(rows, 2);
    assert_eq!(
        columns
            .iter()
            .map(|column| (column.name.as_str(), column.data_type.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("order_code", "TEXT"),
            ("total", "DOUBLE PRECISION"),
            ("created_at", "DATE"),
        ]
    );
    assert_eq!(
        options
            .column_mapping
            .iter()
            .map(|mapping| mapping.target_column.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("order_code"), Some("total"), Some("created_at")]
    );

    let rows = vec![BTreeMap::from([
        ("id".to_string(), json!(1)),
        ("details".to_string(), json!({ "source": "native" })),
    ])];
    let (columns, rows) = infer_materialized_import_columns(rows, "postgres").unwrap();
    assert_eq!(rows, 1);
    assert_eq!(columns[0].data_type, "JSONB");
    assert_eq!(columns[1].data_type, "BIGINT");
}

#[test]
fn json_lines_schema_inference_streams_rows_without_materializing_the_document() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("events.ndjson");
    fs::write(
        &path,
        "{\"event_id\":1,\"enabled\":true}\n{\"event_id\":2,\"payload\":{\"kind\":\"login\"}}\n",
    )
    .unwrap();
    let (columns, rows) = infer_json_lines_import_columns(&path, "postgres").unwrap();
    assert_eq!(rows, 2);
    assert_eq!(
        columns
            .iter()
            .map(|column| (column.name.as_str(), column.data_type.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("enabled", "BOOLEAN"),
            ("event_id", "BIGINT"),
            ("payload", "JSONB"),
        ]
    );
}
