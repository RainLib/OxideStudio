use super::*;

#[test]
fn import_headers_resolve_to_canonical_table_columns() {
    let columns = column_lookup(vec![target_column("user_id"), target_column("DisplayName")]);
    assert_eq!(
        canonical_import_columns(
            &["USER_ID".to_string(), "displayname".to_string()],
            &columns,
        )
        .unwrap(),
        vec!["user_id".to_string(), "DisplayName".to_string()]
    );
    assert!(canonical_import_columns(&["missing".to_string()], &columns).is_err());
}

#[test]
fn csv_plan_mapping_and_empty_values_match_the_reviewed_contract() {
    let columns = column_lookup(vec![target_column("id"), target_column("display_name")]);
    let source = vec![
        "legacy_id".to_string(),
        "name".to_string(),
        "ignored".to_string(),
    ];
    let options = TableCsvImportOptions {
        delimiter: Some(";".to_string()),
        first_row_header: Some(true),
        title_row: None,
        data_start_row: None,
        last_data_row: None,
        column_mapping: vec![
            TableCsvColumnMapping {
                source_index: 0,
                target_column: Some("ID".to_string()),
            },
            TableCsvColumnMapping {
                source_index: 1,
                target_column: Some("display_name".to_string()),
            },
            TableCsvColumnMapping {
                source_index: 2,
                target_column: None,
            },
        ],
        empty_fields_as_null: Some(true),
        trim_values: Some(false),
        encoding: Some(TableImportTextEncoding::Utf8),
    };
    let resolved = resolve_csv_import_columns(&source, &columns, Some(&options)).unwrap();
    assert_eq!(
        resolved,
        vec![
            Some("id".to_string()),
            Some("display_name".to_string()),
            None
        ]
    );
    assert_eq!(
        csv_delimiter(Path::new("source.txt"), Some(&options)).unwrap(),
        b';'
    );
    let record = csv::StringRecord::from(vec!["7", "", "discard"]);
    let values = csv_record_values(&resolved, &record, true, false).unwrap();
    assert_eq!(values.get("id"), Some(&Value::String("7".to_string())));
    assert_eq!(values.get("display_name"), Some(&Value::Null));
    assert!(!values.contains_key("ignored"));
}

#[test]
fn csv_row_range_supports_preamble_footer_and_legacy_defaults() {
    let legacy = resolve_csv_import_row_range(Some(true), None).unwrap();
    assert_eq!(legacy.title_row, Some(1));
    assert_eq!(legacy.data_start_row, 2);
    assert_eq!(legacy.last_data_row, None);

    let options = TableCsvImportOptions {
        title_row: Some(3),
        data_start_row: Some(5),
        last_data_row: Some(7),
        ..Default::default()
    };
    let range = resolve_csv_import_row_range(None, Some(&options)).unwrap();
    assert_eq!(range.title_row, Some(3));
    assert!(!csv_import_row_selected(range, 4));
    assert!(csv_import_row_selected(range, 5));
    assert!(csv_import_row_selected(range, 7));
    assert!(!csv_import_row_selected(range, 8));

    assert!(resolve_csv_import_row_range(
        None,
        Some(&TableCsvImportOptions {
            title_row: Some(3),
            data_start_row: Some(3),
            ..Default::default()
        })
    )
    .unwrap_err()
    .contains("before the data start"));
    assert!(resolve_csv_import_row_range(
        None,
        Some(&TableCsvImportOptions {
            title_row: Some(0),
            data_start_row: Some(4),
            last_data_row: Some(2),
            ..Default::default()
        })
    )
    .unwrap_err()
    .contains("last data row"));
}

#[test]
fn delimited_import_reads_a_late_title_row_and_trims_values_strictly() {
    let path = std::env::temp_dir().join(format!(
        "oxide-delimited-row-range-{}.tsv",
        uuid::Uuid::new_v4()
    ));
    fs::write(
        &path,
        "generated report\tignored\nmetadata\tignored\n id \t display_name \n1\t  Ada  \n",
    )
    .unwrap();
    assert_eq!(csv_delimiter(&path, None).unwrap(), b'\t');

    let row_range = resolve_csv_import_row_range(
        None,
        Some(&TableCsvImportOptions {
            title_row: Some(3),
            data_start_row: Some(4),
            ..Default::default()
        }),
    )
    .unwrap();
    let mut reader = csv_import_reader(
        &path,
        false,
        csv_delimiter(&path, None).unwrap(),
        Some(TableImportTextEncoding::Utf8),
    )
    .unwrap();
    let (source_columns, consumed) =
        csv_import_source_columns(&mut reader, row_range, vec!["fallback".to_string()]).unwrap();
    assert_eq!(source_columns, vec!["id", "display_name"]);
    assert_eq!(consumed, 3);

    let record = reader.records().next().unwrap().unwrap();
    let values = csv_record_values(
        &[Some("id".to_string()), Some("display_name".to_string())],
        &record,
        false,
        true,
    )
    .unwrap();
    assert_eq!(values.get("id"), Some(&Value::String("1".to_string())));
    assert_eq!(
        values.get("display_name"),
        Some(&Value::String("Ada".to_string()))
    );
    fs::remove_file(path).unwrap();
}

#[test]
fn native_csv_reader_auto_detects_utf16_bom_and_gb18030() {
    let utf16_path =
        std::env::temp_dir().join(format!("oxide-csv-utf16-{}.csv", uuid::Uuid::new_v4()));
    let mut utf16_bytes = vec![0xFF, 0xFE];
    for unit in "name\n值\n".encode_utf16() {
        utf16_bytes.extend_from_slice(&unit.to_le_bytes());
    }
    fs::write(&utf16_path, utf16_bytes).unwrap();
    assert_eq!(
        resolve_csv_text_encoding(&utf16_path, Some(TableImportTextEncoding::Auto)).unwrap(),
        (TableImportTextEncoding::Utf16Le, 2)
    );
    let mut utf16_reader =
        csv_import_reader(&utf16_path, true, b',', Some(TableImportTextEncoding::Auto)).unwrap();
    assert_eq!(utf16_reader.headers().unwrap().get(0), Some("name"));
    assert_eq!(
        utf16_reader.records().next().unwrap().unwrap().get(0),
        Some("值")
    );

    let gb_path =
        std::env::temp_dir().join(format!("oxide-csv-gb18030-{}.csv", uuid::Uuid::new_v4()));
    fs::write(&gb_path, b"name\n\xD6\xD0\xCE\xC4\n").unwrap();
    assert_eq!(
        resolve_csv_text_encoding(&gb_path, Some(TableImportTextEncoding::Auto)).unwrap(),
        (TableImportTextEncoding::Gb18030, 0)
    );
    let mut gb_reader =
        csv_import_reader(&gb_path, true, b',', Some(TableImportTextEncoding::Auto)).unwrap();
    assert_eq!(gb_reader.headers().unwrap().get(0), Some("name"));
    assert_eq!(
        gb_reader.records().next().unwrap().unwrap().get(0),
        Some("中文")
    );

    let gb_four_byte_path = std::env::temp_dir().join(format!(
        "oxide-csv-gb18030-four-byte-{}.csv",
        uuid::Uuid::new_v4()
    ));
    let (gb_four_byte_source, _, had_errors) = encoding_rs::GB18030.encode("name\n😀\n");
    assert!(!had_errors);
    fs::write(&gb_four_byte_path, gb_four_byte_source.as_ref()).unwrap();
    let mut gb_four_byte_reader = csv_import_reader(
        &gb_four_byte_path,
        true,
        b',',
        Some(TableImportTextEncoding::Auto),
    )
    .unwrap();
    assert_eq!(
        gb_four_byte_reader
            .records()
            .next()
            .unwrap()
            .unwrap()
            .get(0),
        Some("😀")
    );

    let late_gb_path = std::env::temp_dir().join(format!(
        "oxide-csv-late-gb18030-{}.csv",
        uuid::Uuid::new_v4()
    ));
    let mut late_gb_bytes = b"name\n".to_vec();
    late_gb_bytes.extend(std::iter::repeat_n(b'a', 70 * 1024));
    late_gb_bytes.extend_from_slice(b"\xD6\xD0\n");
    fs::write(&late_gb_path, late_gb_bytes).unwrap();
    assert_eq!(
        resolve_csv_text_encoding(&late_gb_path, Some(TableImportTextEncoding::Auto),).unwrap(),
        (TableImportTextEncoding::Gb18030, 0)
    );

    fs::remove_file(utf16_path).unwrap();
    fs::remove_file(gb_path).unwrap();
    fs::remove_file(gb_four_byte_path).unwrap();
    fs::remove_file(late_gb_path).unwrap();
}

#[test]
fn native_csv_reader_rejects_malformed_selected_encoding() {
    let path = std::env::temp_dir().join(format!("oxide-csv-invalid-{}.csv", uuid::Uuid::new_v4()));
    fs::write(&path, b"name\n\xFF\n").unwrap();
    let error = match csv_import_reader(&path, true, b',', Some(TableImportTextEncoding::Utf8)) {
        Ok(_) => panic!("malformed UTF-8 should be rejected before CSV parsing"),
        Err(error) => error,
    };
    assert!(error.contains("Invalid byte sequence for UTF-8 encoding"));
    fs::remove_file(path).unwrap();
}

#[test]
fn csv_plan_rejects_unsafe_mapping_shapes() {
    let columns = column_lookup(vec![target_column("id")]);
    let source = vec!["source".to_string()];
    let duplicate = TableCsvImportOptions {
        delimiter: None,
        first_row_header: None,
        title_row: None,
        data_start_row: None,
        last_data_row: None,
        column_mapping: vec![
            TableCsvColumnMapping {
                source_index: 0,
                target_column: Some("id".to_string()),
            },
            TableCsvColumnMapping {
                source_index: 0,
                target_column: None,
            },
        ],
        empty_fields_as_null: None,
        trim_values: None,
        encoding: None,
    };
    assert!(resolve_csv_import_columns(&source, &columns, Some(&duplicate)).is_err());
    assert!(csv_delimiter(
        Path::new("source.csv"),
        Some(&TableCsvImportOptions {
            delimiter: Some("::".to_string()),
            ..Default::default()
        })
    )
    .is_err());
}
