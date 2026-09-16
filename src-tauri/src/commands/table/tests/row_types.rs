#[test]
fn table_page_total_count_is_opt_in() {
    assert!(!super::should_calculate_table_total(None));
    assert!(!super::should_calculate_table_total(Some(false)));
    assert!(super::should_calculate_table_total(Some(true)));
}
