use super::*;

#[test]
fn names_xlsx_columns_and_rejects_invalid_cell_text() {
    assert_eq!(xlsx_column_name(0).unwrap(), "A");
    assert_eq!(xlsx_column_name(25).unwrap(), "Z");
    assert_eq!(xlsx_column_name(26).unwrap(), "AA");
    assert_eq!(xlsx_column_name(16_383).unwrap(), "XFD");
    assert!(xlsx_column_name(16_384).is_err());
    assert_eq!(
        xlsx_escape_text("A&B <value>").unwrap(),
        "A&amp;B &lt;value&gt;"
    );
    assert!(xlsx_escape_text("invalid\u{0001}").is_err());
}
