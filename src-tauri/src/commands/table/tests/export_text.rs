use super::*;

#[test]
fn escapes_csv_values() {
    assert_eq!(csv_escape(&json!("plain")), "plain");
    assert_eq!(csv_escape(&json!("a,b")), "\"a,b\"");
    assert_eq!(csv_escape(&json!("a\"b")), "\"a\"\"b\"");
    assert_eq!(csv_escape(&json!(null)), "");
}

#[test]
fn escapes_tsv_control_characters_without_materializing_rows() {
    assert_eq!(
        tsv_escape(&json!("first\tsecond\nthird")),
        "first second third"
    );
    assert_eq!(tsv_escape(&json!(null)), "");
}

#[test]
fn reuses_one_delimited_row_buffer_without_changing_output() {
    let mut buffer = String::with_capacity(128);
    push_delimited_export_row(
        &mut buffer,
        TableExportFormat::Csv,
        &[json!("a,b"), json!("a\"b"), Value::Null],
    );
    assert_eq!(buffer, "\"a,b\",\"a\"\"b\",\n");
    let retained_capacity = buffer.capacity();

    push_delimited_export_row(
        &mut buffer,
        TableExportFormat::Tsv,
        &[json!("first\tsecond\nthird"), json!(true)],
    );
    assert_eq!(buffer, "first second third\ttrue\n");
    assert!(buffer.capacity() >= retained_capacity);

    push_delimited_export_row(
        &mut buffer,
        TableExportFormat::Markdown,
        &[json!("Ada|one\r\nline"), Value::Null],
    );
    assert_eq!(buffer, "| Ada\\|one<br>line | NULL |\n");
}
