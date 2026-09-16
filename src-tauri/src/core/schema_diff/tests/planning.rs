use super::super::*;

#[test]
fn dependency_cycle_is_blocked_without_emitting_partial_sql() {
    let mut first = change(
        SchemaChangeKind::ColumnAdd,
        SchemaChangeRisk::Safe,
        "public",
        "users",
        Some("BASE TABLE".to_string()),
        Some("first".to_string()),
        "Add first".to_string(),
        vec!["ALTER TABLE users ADD first int;".to_string()],
        true,
        false,
    );
    let mut second = change(
        SchemaChangeKind::ColumnAdd,
        SchemaChangeRisk::Safe,
        "public",
        "users",
        Some("BASE TABLE".to_string()),
        Some("second".to_string()),
        "Add second".to_string(),
        vec!["ALTER TABLE users ADD second int;".to_string()],
        true,
        false,
    );
    first.depends_on = vec![second.id.clone()];
    second.depends_on = vec![first.id.clone()];
    let mut warnings = Vec::new();

    let ordered = topologically_order_changes(vec![first, second], &mut warnings);

    assert!(ordered.iter().all(|change| change.sql.is_empty()));
    assert!(ordered.iter().all(|change| change.blocked_reason.is_some()));
    assert!(warnings.iter().any(|warning| warning.contains("cycle")));
}
