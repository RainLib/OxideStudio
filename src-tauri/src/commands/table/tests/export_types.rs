use super::*;

#[test]
fn selected_database_sql_export_preserves_exact_order_and_rejects_stale_objects() {
    let relation = |name: &str, table_type: &str| TableInfo {
        name: name.to_string(),
        schema: Some("public".to_string()),
        table_type: Some(table_type.to_string()),
        comment: None,
    };
    let relations = vec![
        relation("accounts", "TABLE"),
        relation("orders", "BASE TABLE"),
        relation("active_orders", "VIEW"),
    ];
    let requested = vec!["orders".to_string(), "accounts".to_string()];
    let selected = select_database_sql_export_tables(&relations, Some(&requested)).unwrap();
    assert_eq!(
        selected
            .iter()
            .map(|table| table.name.as_str())
            .collect::<Vec<_>>(),
        vec!["orders", "accounts"]
    );

    assert!(
        select_database_sql_export_tables(&relations, Some(&["active_orders".to_string()]),)
            .unwrap_err()
            .contains("not a base table")
    );
    assert!(
        select_database_sql_export_tables(&relations, Some(&["missing".to_string()]),)
            .unwrap_err()
            .contains("no longer exists")
    );
    assert!(select_database_sql_export_tables(
        &relations,
        Some(&["orders".to_string(), "orders".to_string()]),
    )
    .unwrap_err()
    .contains("duplicated"));
    let too_many = (0..=MAX_DATABASE_SQL_EXPORT_TABLE_SELECTION)
        .map(|index| format!("table_{index}"))
        .collect::<Vec<_>>();
    assert!(
        select_database_sql_export_tables(&relations, Some(&too_many))
            .unwrap_err()
            .contains("at most 200")
    );
    assert_eq!(
        select_database_sql_export_tables(&relations, None)
            .unwrap()
            .len(),
        2
    );
}
