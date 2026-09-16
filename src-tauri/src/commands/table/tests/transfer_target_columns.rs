use super::*;

#[test]
fn transfer_target_materializes_generated_values_and_omits_hidden_columns() {
    let mut generated = target_column("computed_total");
    generated.is_generated = Some(true);
    let mut hidden = target_column("period_start");
    hidden.is_hidden = Some(true);

    let plan = build_transfer_target_columns(
        &[target_column("id"), generated, hidden],
        "postgres",
        "mysql",
    )
    .unwrap();
    assert_eq!(
        plan.columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["id", "computed_total"]
    );
    assert_eq!(plan.create_columns.len(), 2);
    assert!(plan
        .warnings
        .iter()
        .any(|warning| { warning.contains("period_start") && warning.contains("omitted") }));
    assert!(plan
        .warnings
        .iter()
        .any(|warning| { warning.contains("computed_total") && warning.contains("materialized") }));

    let mut unknown = target_column("legacy_package_column");
    unknown.is_hidden = None;
    assert!(
        build_transfer_target_columns(&[unknown], "postgres", "mysql")
            .unwrap_err()
            .contains("Target DDL cannot safely decide")
    );
}

#[test]
fn transfer_defaults_use_quote_aware_single_expression_validation() {
    assert!(validate_default_expression("'literal; -- /* text'").is_ok());
    assert!(validate_default_expression("timezone('UTC', now())").is_ok());
    for invalid in [
        "now(); DROP TABLE users",
        "now() -- trailing",
        "now(/* comment */)",
        "(now()",
        "'unterminated",
        "$body$; -- dialect-specific quoting$body$",
    ] {
        assert!(
            validate_default_expression(invalid).is_err(),
            "default should be rejected: {invalid}"
        );
    }
    assert!(validate_default_expression(&"x".repeat(16 * 1024 + 1)).is_err());

    let mut unsafe_default = target_column("payload");
    unsafe_default.default_value = Some("'safe'; DROP TABLE audit".to_string());
    let plan = build_transfer_target_columns(&[unsafe_default], "postgres", "postgres").unwrap();
    assert!(plan.columns[0].has_source_default);
    assert!(!plan.columns[0].default_retained);
    assert!(plan.default_expressions.is_empty());
}

#[test]
fn transfer_defaults_do_not_copy_generated_or_source_sequence_expressions() {
    let mut generated = target_column("search_text");
    generated.default_value = Some("lower(title)".to_string());
    generated.is_generated = Some(true);

    let mut source_sequence = target_column("legacy_id");
    source_sequence.data_type = "integer".to_string();
    source_sequence.default_value =
        Some("pg_catalog.nextval ('legacy_id_seq'::regclass)".to_string());

    let mut sequence_literal = target_column("sequence_label");
    sequence_literal.default_value = Some("'nextval('".to_string());

    let plan = build_transfer_target_columns(
        &[generated, source_sequence, sequence_literal],
        "postgres",
        "postgres",
    )
    .unwrap();
    assert!(plan.columns.iter().all(|column| column.has_source_default));
    assert!(plan.columns[..2]
        .iter()
        .all(|column| !column.default_retained));
    assert!(plan.columns[2].default_retained);
    assert_eq!(
        plan.default_expressions.get("sequence_label"),
        Some(&"'nextval('".to_string())
    );
    assert!(plan.columns.iter().any(|column| {
        column.name == "search_text" && column.reason.contains("Generated-column")
    }));
    assert!(plan.columns.iter().any(|column| {
        column.name == "legacy_id" && column.reason.contains("sequence reference")
    }));
    assert!(plan
        .warnings
        .iter()
        .any(|warning| { warning.contains("search_text") && warning.contains("legacy_id") }));
}

#[test]
fn sqlite_transfer_defaults_share_the_reviewed_ddl_renderer() {
    let mut enabled = target_column("enabled");
    enabled.data_type = "boolean".to_string();
    enabled.default_value = Some("false".to_string());
    let plan = build_transfer_target_columns(&[enabled], "postgres", "sqlite").unwrap();
    let ddl = build_sqlite_create_table_statements_with_defaults(
        "main",
        "settings_copy",
        &plan.create_columns,
        &plan.default_expressions,
    )
    .unwrap()
    .join("\n");
    assert!(ddl.contains("\"enabled\" BOOLEAN DEFAULT FALSE"));

    let mapping = transfer_target_default_expression(
        &target_column("without_default"),
        "postgres",
        "sqlite",
        false,
    );
    assert!(mapping.is_none());
}
