use super::*;

#[test]
fn parses_count_values() {
    assert_eq!(value_to_u64(&json!(42)), Some(42));
    assert_eq!(value_to_u64(&json!("42")), Some(42));
    assert_eq!(value_to_u64(&json!(null)), None);
}
