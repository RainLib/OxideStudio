use super::*;

#[test]
fn postgres_identity_reseed_preview_binds_sequence_owner_and_state() {
    let endpoint = TableDataTransferEndpoint {
        connection_id: "target".to_string(),
        driver: "postgres".to_string(),
        schema: "archive".to_string(),
        table: "users".to_string(),
        database: Some("app".to_string()),
    };
    let results = vec![QueryResult::rows(
        Vec::new(),
        vec![vec![
            serde_json::json!("archive"),
            serde_json::json!("users_id_seq"),
            serde_json::json!("archive"),
            serde_json::json!("users"),
            serde_json::json!("id"),
            serde_json::json!("41"),
            serde_json::json!("40"),
        ]],
    )];

    let plan = postgres_identity_reseed_plan_from_results(&endpoint, "id", &results).unwrap();

    assert_eq!(plan.sequence_name, "users_id_seq");
    assert_eq!(plan.current_value.as_deref(), Some("41"));
    assert_eq!(plan.target_max_value.as_deref(), Some("40"));
    let statements = postgres_identity_reseed_statements(&endpoint, &[plan]);
    assert_eq!(statements.len(), 1);
    assert!(statements[0]
        .sql
        .contains("pg_catalog.setval('\"archive\".\"users_id_seq\"'::pg_catalog.regclass"));
    assert!(!statements[0].sql.contains("pg_get_serial_sequence"));
    assert!(statements[0].sql.contains("MAX(\"id\")"));
}

#[test]
fn postgres_identity_reseed_preview_rejects_detached_or_invalid_state() {
    let endpoint = TableDataTransferEndpoint {
        connection_id: "target".to_string(),
        driver: "postgres".to_string(),
        schema: "archive".to_string(),
        table: "users".to_string(),
        database: None,
    };
    let detached = vec![QueryResult::rows(
        Vec::new(),
        vec![vec![
            serde_json::json!("archive"),
            serde_json::json!("shared_seq"),
            serde_json::json!("archive"),
            serde_json::json!("accounts"),
            serde_json::json!("id"),
            serde_json::json!("7"),
            serde_json::json!("9"),
        ]],
    )];
    let invalid_state = vec![QueryResult::rows(
        Vec::new(),
        vec![vec![
            serde_json::json!("archive"),
            serde_json::json!("users_id_seq"),
            serde_json::json!("archive"),
            serde_json::json!("users"),
            serde_json::json!("id"),
            serde_json::json!("not-a-number"),
            serde_json::Value::Null,
        ]],
    )];

    assert!(
        postgres_identity_reseed_plan_from_results(&endpoint, "id", &detached)
            .unwrap_err()
            .contains("not owned by the reviewed target column")
    );
    assert!(
        postgres_identity_reseed_plan_from_results(&endpoint, "id", &invalid_state)
            .unwrap_err()
            .contains("invalid sequence value")
    );
}

#[test]
fn postgres_identity_reseed_preview_query_is_catalog_scoped_and_read_only() {
    let endpoint = TableDataTransferEndpoint {
        connection_id: "target".to_string(),
        driver: "postgres".to_string(),
        schema: "archive".to_string(),
        table: "users".to_string(),
        database: None,
    };

    let sql = postgres_identity_reseed_plan_query(&endpoint, "id");

    assert!(sql.starts_with("WITH selected AS (SELECT"));
    assert!(sql.contains("pg_catalog.pg_get_serial_sequence"));
    assert!(sql.contains("pg_catalog.pg_depend"));
    assert!(sql.contains("FROM \"archive\".\"users\""));
    assert!(!sql.contains(';'));
    assert!(!sql.to_ascii_uppercase().contains(" UPDATE "));
    assert!(!sql.to_ascii_uppercase().contains(" DELETE "));
}
