use super::*;

#[test]
fn sanitizes_export_file_parts() {
    assert_eq!(sanitize_file_part("public"), "public");
    assert_eq!(sanitize_file_part("sales/orders"), "sales_orders");
    assert_eq!(sanitize_file_part(" "), "table");
}
