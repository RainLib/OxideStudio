use super::*;

#[test]
fn native_csv_preview_is_read_only_and_bounded_to_the_review_payload() {
    let path = std::env::temp_dir().join(format!("oxide-csv-preview-{}.csv", uuid::Uuid::new_v4()));
    fs::write(&path, b"email\nreader@example.test\n").unwrap();

    let preview = read_csv_import_preview(&path).unwrap();
    assert_eq!(
        preview.file_name,
        path.file_name().unwrap().to_string_lossy()
    );
    assert_eq!(preview.bytes, b"email\nreader@example.test\n");
    assert_eq!(preview.total_bytes, preview.bytes.len() as u64);
    assert!(!preview.truncated);

    fs::remove_file(path).unwrap();
}

#[test]
fn json_import_preview_is_structured_bounded_and_does_not_write() {
    let path =
        std::env::temp_dir().join(format!("oxide-json-preview-{}.json", uuid::Uuid::new_v4()));
    fs::write(
        &path,
        r#"[{"id":1,"name":"first"},{"id":2,"name":"second","active":true}]"#,
    )
    .unwrap();

    let preview = read_json_import_preview(&path).unwrap();
    assert_eq!(preview.total_rows, Some(2));
    assert_eq!(preview.source_columns, vec!["active", "id", "name"]);
    assert_eq!(preview.sample_rows.len(), 2);
    assert_eq!(preview.sample_rows[0].get("name"), Some(&json!("first")));
    assert!(!preview.truncated);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        r#"[{"id":1,"name":"first"},{"id":2,"name":"second","active":true}]"#
    );

    fs::remove_file(path).unwrap();
}

#[test]
fn json_document_row_stream_preserves_object_rows_and_cancellation() {
    let path = std::env::temp_dir().join(format!(
        "oxide-json-document-stream-{}.json",
        uuid::Uuid::new_v4()
    ));
    fs::write(&path, r#"[{"id":1},{"id":2}]"#).unwrap();

    let mut observed = Vec::new();
    stream_json_document_rows(&path, &|| false, &mut |row_number, row| {
        observed.push((row_number, row));
        Ok(())
    })
    .unwrap();
    assert_eq!(observed.len(), 2);
    assert_eq!(observed[0].0, 1);
    assert_eq!(observed[1].0, 2);
    assert_eq!(observed[1].1.get("id"), Some(&json!(2)));

    let cancelled = std::cell::Cell::new(false);
    let mut received = 0_u64;
    let error = stream_json_document_rows(&path, &|| cancelled.get(), &mut |_, _| {
        received += 1;
        cancelled.set(true);
        Ok(())
    })
    .unwrap_err();
    assert_eq!(received, 1);
    assert!(error.starts_with(TABLE_IMPORT_CANCELLED));

    fs::remove_file(path).unwrap();
}

#[test]
fn json_lines_preview_only_reads_a_bounded_leading_sample() {
    let path = std::env::temp_dir().join(format!(
        "oxide-json-lines-preview-{}.jsonl",
        uuid::Uuid::new_v4()
    ));
    let source = (0..=MAX_JSON_IMPORT_PREVIEW_ROWS)
        .map(|index| format!(r#"{{"id":{index}}}"#))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&path, source).unwrap();

    let preview = read_json_import_preview(&path).unwrap();
    assert_eq!(preview.total_rows, None);
    assert_eq!(preview.sample_rows.len(), MAX_JSON_IMPORT_PREVIEW_ROWS);
    assert!(preview.truncated);

    fs::remove_file(path).unwrap();
}

#[test]
fn xlsx_cells_keep_scalar_types_before_driver_coercion() {
    assert_eq!(xlsx_cell_value(&Data::Int(7)), json!(7));
    assert_eq!(xlsx_cell_value(&Data::Float(1.5)), json!(1.5));
    assert_eq!(xlsx_cell_value(&Data::Bool(true)), json!(true));
    assert_eq!(
        xlsx_cell_value(&Data::String("reader@example.test".to_string())),
        json!("reader@example.test")
    );
    assert_eq!(xlsx_cell_value(&Data::Empty), Value::Null);
}

#[test]
fn xlsx_headers_reject_empty_and_case_insensitive_duplicates() {
    assert!(validate_xlsx_headers(&["id".to_string(), "email".to_string()]).is_ok());
    assert!(validate_xlsx_headers(&["id".to_string(), " ID ".to_string()]).is_err());
    assert!(validate_xlsx_headers(&["".to_string()]).is_err());
}
