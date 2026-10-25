use super::*;

#[test]
fn materialized_import_parsers_observe_cancellation_before_database_writes() {
    let json_path = std::env::temp_dir().join(format!(
        "oxide-table-import-cancel-{}.json",
        uuid::Uuid::new_v4()
    ));
    fs::write(&json_path, r#"[{"id":1},{"id":2}]"#).unwrap();
    let checks = AtomicU64::new(0);
    let error = stream_json_document_rows(
        &json_path,
        &|| checks.fetch_add(1, std::sync::atomic::Ordering::Relaxed) >= 1,
        &mut |_, _| Ok(()),
    )
    .unwrap_err();
    fs::remove_file(json_path).unwrap();
    assert!(error.starts_with(super::TABLE_IMPORT_CANCELLED));

    let missing_xlsx = std::env::temp_dir().join("oxide-import-cancel-missing.xlsx");
    assert_eq!(
        super::super::import_xlsx_stream::stream_xlsx_rows(
            &missing_xlsx,
            &|| true,
            &mut |_, _| Ok(())
        )
        .unwrap_err(),
        super::TABLE_IMPORT_CANCELLED
    );
}

#[test]
fn recognizes_only_line_delimited_json_for_streaming_imports() {
    assert!(is_json_lines_path(Path::new("events.jsonl")));
    assert!(is_json_lines_path(Path::new("events.NDJSON")));
    assert!(!is_json_lines_path(Path::new("events.json")));
    assert!(!is_json_lines_path(Path::new("events.csv")));
}
