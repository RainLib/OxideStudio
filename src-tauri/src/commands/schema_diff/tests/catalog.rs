use super::super::*;
use serde_json::json;

#[test]
fn native_view_definition_queries_are_catalog_scoped_and_read_only() {
    let postgres = native_view_definition_query("postgres", "public", "active_users")
        .expect("PostgreSQL view introspection should be supported");
    assert!(postgres.contains("pg_catalog.pg_get_viewdef"));
    assert!(postgres.contains("class.relispopulated::text"));
    assert!(postgres.contains("materialized_view_populated"));
    assert!(postgres.contains("namespace.nspname = 'public'"));
    assert!(postgres.contains("class.relname = 'active_users'"));

    let mysql = native_view_definition_query("mysql", "app", "active_users")
        .expect("MySQL view introspection should be supported");
    assert!(mysql.contains("information_schema.VIEWS"));
    assert!(mysql.contains("TABLE_SCHEMA = 'app'"));
    assert!(mysql.contains("TABLE_NAME = 'active_users'"));

    let sqlite = native_view_definition_query("sqlite", "tenant\"data", "active_users")
        .expect("SQLite view introspection should be supported");
    assert!(sqlite.contains("FROM \"tenant\"\"data\".sqlite_schema"));
    assert!(sqlite.contains("type = 'view'"));
    assert!(sqlite.contains("name = 'active_users'"));
    assert!(sqlite.contains("sql IS NOT NULL"));
    assert!(
        native_view_definition_query("postgres", "p'ublic", "active_users")
            .expect("quoted PostgreSQL catalog query")
            .contains("'p''ublic'")
    );
}

#[test]
fn postgres_view_dependency_query_captures_external_dependencies_and_is_read_only() {
    let query = postgres_view_dependency_query("public");
    assert!(query.contains("pg_catalog.pg_rewrite"));
    assert!(query.contains("dependent_namespace.nspname = 'public'"));
    assert!(query.contains("referenced_namespace.nspname AS depends_on_schema"));
    assert!(!query.contains("referenced_namespace.nspname = 'public'"));
    assert!(query.contains("dependent.relkind IN ('v', 'm')"));
    assert!(query.contains("referenced.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')"));
    assert!(!query.contains("INSERT"));
    assert!(!query.contains("UPDATE"));
}

#[test]
fn native_object_source_queries_are_catalog_scoped_and_read_only() {
    let routine = postgres_routine_definition_query("public");
    assert!(routine.contains("pg_catalog.pg_get_functiondef"));
    assert!(routine.contains("namespace.nspname = 'public'"));
    assert!(routine.contains("procedure.prokind IN ('f', 'p')"));
    assert!(routine.contains("ORDER BY procedure.proname"));
    assert!(!routine.contains("INSERT"));

    let trigger = postgres_trigger_definition_query("public");
    assert!(trigger.contains("pg_catalog.pg_get_triggerdef"));
    assert!(trigger.contains("namespace.nspname = 'public'"));
    assert!(trigger.contains("NOT trigger.tgisinternal"));
    assert!(!trigger.contains("UPDATE"));

    let sequence = postgres_sequence_definition_query("public");
    assert!(sequence.contains("pg_catalog.pg_sequence"));
    assert!(sequence.contains("CREATE SEQUENCE"));
    assert!(sequence.contains("namespace.nspname = 'public'"));

    let sequence_owner = postgres_sequence_owner_query("public");
    assert!(sequence_owner.contains("pg_catalog.pg_depend"));
    assert!(sequence_owner.contains("ownership.deptype IN ('a', 'i')"));
    assert!(sequence_owner.contains("namespace.nspname = 'public'"));
    assert!(!sequence_owner.contains("ALTER SEQUENCE"));

    let sequence_last_value = postgres_sequence_last_value_query("public");
    assert!(sequence_last_value.contains("pg_catalog.pg_sequence_last_value"));
    assert!(sequence_last_value.contains("pg_catalog.has_sequence_privilege"));
    assert!(sequence_last_value.contains("parameters.seqstart"));
    assert!(sequence_last_value.contains("IS NOT NULL"));
    assert!(sequence_last_value.contains("namespace.nspname = 'public'"));
    assert!(!sequence_last_value.contains("setval"));
    assert_eq!(
        optional_postgres_sequence_boolean(Some(&json!(false))),
        Some(false)
    );
    assert_eq!(
        optional_postgres_sequence_boolean(Some(&json!("t"))),
        Some(true)
    );
    assert_eq!(
        optional_postgres_sequence_boolean(Some(&json!("unknown"))),
        None
    );

    let sequence_dependency = postgres_relation_sequence_dependency_query("public");
    assert!(sequence_dependency.contains("pg_catalog.pg_attrdef"));
    assert!(sequence_dependency.contains("sequence.relkind = 'S'"));
    assert!(sequence_dependency.contains("relation_namespace.nspname = 'public'"));
    assert!(!sequence_dependency.contains("DELETE"));

    let trigger_dependency = postgres_trigger_routine_dependency_query("public");
    assert!(trigger_dependency.contains("trigger.tgfoid"));
    assert!(trigger_dependency.contains("namespace.nspname = 'public'"));
    assert!(trigger_dependency.contains("NOT trigger.tgisinternal"));
    assert!(!trigger_dependency.contains("INSERT"));
    assert_eq!(
        schema_object_definition_key(Some("orders"), "orders_audit"),
        "orders\u{1f}orders_audit"
    );

    let mysql_trigger = mysql_trigger_definition_query("app");
    assert!(mysql_trigger.contains("information_schema.TRIGGERS"));
    assert!(mysql_trigger.contains("TRIGGER_SCHEMA = 'app'"));
    assert!(mysql_trigger.contains("ACTION_STATEMENT"));
    assert!(!mysql_trigger.contains("INSERT"));
    assert!(!mysql_trigger.contains("UPDATE"));
    assert_eq!(mysql_quote_identifier("order`audit"), "`order``audit`");

    let mysql_event = mysql_event_definition_query("app");
    assert!(mysql_event.contains("information_schema.EVENTS"));
    assert!(mysql_event.contains("EVENT_SCHEMA = 'app'"));
    assert!(mysql_event.contains("EVENT_DEFINITION"));
    assert!(mysql_event.contains("TIME_ZONE"));
    assert!(!mysql_event.contains("INSERT"));
    assert!(!mysql_event.contains("UPDATE"));
}

#[test]
fn mysql_event_definition_reuses_the_reviewed_event_vocabulary() {
    let row = vec![
        "daily_sync".into(),
        "RECURRING".into(),
        serde_json::Value::Null,
        "1".into(),
        "DAY".into(),
        "2026-01-01 00:00:00".into(),
        serde_json::Value::Null,
        "ENABLED".into(),
        "PRESERVE".into(),
        "sync job".into(),
        "CALL refresh_cache()".into(),
        "SYSTEM".into(),
    ];
    let definition = mysql_event_definition_from_row("app", &row).unwrap();
    assert_eq!(
            definition,
            "CREATE EVENT `app`.`daily_sync` ON SCHEDULE EVERY 1 DAY STARTS '2026-01-01 00:00:00' ON COMPLETION PRESERVE ENABLE COMMENT 'sync job' DO CALL refresh_cache();"
        );

    let mut foreign_time_zone = row.clone();
    foreign_time_zone[11] = "UTC".into();
    assert!(mysql_event_definition_from_row("app", &foreign_time_zone).is_none());

    let mut compound_body = row;
    compound_body[10] = "BEGIN CALL refresh_cache(); CALL prune_cache(); END".into();
    assert!(mysql_event_definition_from_row("app", &compound_body).is_none());
}

#[test]
fn migration_execution_mode_keeps_mysql_non_transactional() {
    assert_eq!(
        schema_migration_execution_mode("postgres"),
        Some(SchemaMigrationExecutionMode::Transactional)
    );
    assert_eq!(
        schema_migration_execution_mode("mysql"),
        Some(SchemaMigrationExecutionMode::NonTransactional)
    );
    assert_eq!(
        schema_migration_execution_mode("mariadb"),
        Some(SchemaMigrationExecutionMode::NonTransactional)
    );
    assert_eq!(
        schema_migration_execution_mode("sqlite"),
        Some(SchemaMigrationExecutionMode::SqliteRebuild)
    );
    assert_eq!(schema_migration_execution_mode("duckdb"), None);
}

#[test]
fn sqlite_table_definition_query_is_catalog_scoped_and_read_only() {
    let sql = sqlite_table_definition_query("sqlite", "tenant\"data", "user's table")
        .expect("SQLite should expose its catalog definition query");

    assert!(sql.contains("FROM \"tenant\"\"data\".sqlite_schema"));
    assert!(sql.contains("name = 'user''s table'"));
    assert!(sql.contains("type = 'table'"));
    assert!(sql.contains("LIMIT 1"));
    assert!(!sql.to_ascii_uppercase().contains("PRAGMA"));
    assert!(sqlite_table_definition_query("postgres", "public", "users").is_none());
}

#[test]
fn sqlite_trigger_definition_query_is_catalog_scoped_and_read_only() {
    let sql = sqlite_trigger_definition_query("sqlite", "tenant\"data")
        .expect("SQLite should expose trigger catalog definitions");

    assert!(sql.contains("FROM \"tenant\"\"data\".sqlite_schema"));
    assert!(sql.contains("type = 'trigger'"));
    assert!(sql.contains("sql IS NOT NULL"));
    assert!(sql.contains("ORDER BY tbl_name, name"));
    assert!(!sql.to_ascii_uppercase().contains("PRAGMA"));
    assert!(sqlite_trigger_definition_query("postgres", "public").is_none());
}
