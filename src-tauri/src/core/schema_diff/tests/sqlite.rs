use super::super::*;
use super::support::*;

#[test]
fn sqlite_snapshots_produce_guarded_existing_table_rebuilds() {
    let mut source = snapshot(
        "desired",
        vec![
            column("id", "INTEGER", false),
            column("email", "TEXT", true),
        ],
    );
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].columns[0].is_auto_increment = false;
    source.relations[0].definition =
        Some("CREATE TABLE users (id INTEGER NOT NULL, email TEXT)".to_string());
    source = finalize_schema_snapshot(source).unwrap();

    let mut target = snapshot("actual", vec![column("id", "INTEGER", false)]);
    target.driver = "sqlite".to_string();
    target.database_name = None;
    target.schema_name = "main".to_string();
    target.relations[0].columns[0].is_auto_increment = false;
    target.relations[0].definition = Some("CREATE TABLE users (id INTEGER NOT NULL)".to_string());
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    assert_eq!(plan.driver, "sqlite");
    assert!(plan.transactional);
    assert_eq!(plan.execution_owner, SchemaDiffExecutionOwner::HostSql);
    assert!(plan.requires_review_approval);
    assert!(plan.requires_destructive_approval);
    assert_eq!(plan.changes.len(), 1);
    let rebuild = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::RelationModify)
        .expect("SQLite table drift should produce a rebuild artifact");
    assert!(rebuild.manual_review);
    assert!(rebuild.blocked_reason.is_none());
    assert!(rebuild.sql.iter().any(|sql| sql.contains("CREATE TABLE")));
    assert!(rebuild.sql.iter().any(|sql| sql.contains("INSERT INTO")));
    assert!(rebuild.sql.iter().any(|sql| sql.contains("DROP TABLE")));
    assert!(rebuild.sql.iter().any(|sql| sql.contains("RENAME TO")));
    assert!(!plan.migration_sql.contains("BEGIN IMMEDIATE"));
    assert!(!plan.migration_sql.contains("PRAGMA foreign_key_check"));
    assert_eq!(plan.summary.blocked, 0);
}

#[test]
fn sqlite_rebuild_with_unproven_backfill_remains_review_only() {
    let mut required = column("required_code", "TEXT", false);
    required.default_value = None;
    let mut source = snapshot("desired", vec![column("id", "INTEGER", false), required]);
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].columns[0].is_auto_increment = false;
    source.relations[0].definition =
        Some("CREATE TABLE users (id INTEGER NOT NULL, required_code TEXT NOT NULL)".to_string());
    source = finalize_schema_snapshot(source).unwrap();

    let mut target = snapshot("actual", vec![column("id", "INTEGER", false)]);
    target.driver = "sqlite".to_string();
    target.database_name = None;
    target.schema_name = "main".to_string();
    target.relations[0].columns[0].is_auto_increment = false;
    target.relations[0].definition = Some("CREATE TABLE users (id INTEGER NOT NULL)".to_string());
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(!plan.transactional);
    assert_eq!(plan.execution_owner, SchemaDiffExecutionOwner::ReviewOnly);
    assert_eq!(plan.summary.blocked, 1);
    assert!(plan.changes[0].sql.is_empty());
    assert!(plan.changes[0].blocked_reason.is_some());
}

#[test]
fn sqlite_rebuild_preserves_advanced_catalog_semantics() {
    let mut source = snapshot(
        "desired",
        vec![
            column("id", "INTEGER", false),
            column("email", "TEXT", true),
        ],
    );
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].columns[0].is_auto_increment = false;
    source.relations[0].definition = Some(
            "CREATE TABLE users (id INTEGER NOT NULL, email TEXT COLLATE NOCASE, CHECK (length(email) < 100)) STRICT"
                .to_string(),
        );
    source = finalize_schema_snapshot(source).unwrap();

    let mut target = snapshot("actual", vec![column("id", "INTEGER", false)]);
    target.driver = "sqlite".to_string();
    target.database_name = None;
    target.schema_name = "main".to_string();
    target.relations[0].columns[0].is_auto_increment = false;
    target.relations[0].definition = Some("CREATE TABLE users (id INTEGER NOT NULL)".to_string());
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(plan.transactional);
    assert_eq!(plan.execution_owner, SchemaDiffExecutionOwner::HostSql);
    assert_eq!(plan.summary.blocked, 0);
    assert!(plan.changes[0].blocked_reason.is_none());
    assert!(plan.changes[0].sql[0].contains("email TEXT COLLATE NOCASE"));
    assert!(plan.changes[0].sql[0].contains("CHECK (length(email) < 100)"));
    assert!(plan.changes[0].sql[0].ends_with("STRICT;"));
}

#[test]
fn sqlite_catalog_only_drift_is_executable_from_exact_ddl() {
    let mut source = snapshot("desired", vec![column("id", "INTEGER", false)]);
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].columns[0].is_auto_increment = false;
    source.relations[0].definition =
        Some("CREATE TABLE users (id INTEGER NOT NULL CHECK (id > 0))".to_string());
    source = finalize_schema_snapshot(source).unwrap();

    let mut target = snapshot("actual", vec![column("id", "INTEGER", false)]);
    target.driver = "sqlite".to_string();
    target.database_name = None;
    target.schema_name = "main".to_string();
    target.relations[0].columns[0].is_auto_increment = false;
    target.relations[0].definition = Some("CREATE TABLE users (id INTEGER NOT NULL)".to_string());
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert_eq!(plan.summary.total, 1);
    assert_eq!(plan.summary.blocked, 0);
    assert!(plan.transactional);
    assert_eq!(plan.execution_owner, SchemaDiffExecutionOwner::HostSql);
    assert_eq!(plan.changes[0].kind, SchemaChangeKind::RelationModify);
    assert!(plan.changes[0].sql[0].contains("CHECK (id > 0)"));
}

#[test]
fn sqlite_rebuild_preserves_generated_columns_without_copying_them() {
    let mut generated = column("normalized_email", "TEXT", true);
    generated.is_generated = Some(true);
    let mut source = snapshot(
        "desired",
        vec![
            column("id", "INTEGER", false),
            column("email", "TEXT", true),
            generated,
        ],
    );
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].columns[0].is_auto_increment = false;
    source.relations[0].definition = Some(
            "CREATE TABLE users (id INTEGER NOT NULL, email TEXT, normalized_email TEXT GENERATED ALWAYS AS (lower(email)) STORED)"
                .to_string(),
        );
    source = finalize_schema_snapshot(source).unwrap();

    let mut target = snapshot(
        "actual",
        vec![
            column("id", "INTEGER", false),
            column("email", "TEXT", true),
        ],
    );
    target.driver = "sqlite".to_string();
    target.database_name = None;
    target.schema_name = "main".to_string();
    target.relations[0].columns[0].is_auto_increment = false;
    target.relations[0].definition =
        Some("CREATE TABLE users (id INTEGER NOT NULL, email TEXT)".to_string());
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(plan.transactional);
    assert_eq!(plan.summary.blocked, 0);
    assert!(plan.changes[0].sql[0]
        .contains("normalized_email TEXT GENERATED ALWAYS AS (lower(email)) STORED"));
    assert!(plan.changes[0].sql[1].contains("(\"id\", \"email\")"));
    assert!(!plan.changes[0].sql[1].contains("normalized_email"));
}

#[test]
fn sqlite_rebuild_preserves_expression_and_partial_index_definition() {
    let mut source = snapshot(
        "desired",
        vec![
            column("id", "INTEGER", false),
            column("email", "TEXT", true),
        ],
    );
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].columns[0].is_auto_increment = false;
    source.relations[0].definition =
        Some("CREATE TABLE users (id INTEGER NOT NULL, email TEXT)".to_string());
    source.relations[0].indexes = vec![IndexInfo {
            definition: Some(
                "CREATE INDEX users_email_expr ON users (lower(email) COLLATE NOCASE DESC) WHERE email IS NOT NULL"
                    .to_string(),
            ),
            key_is_expression: vec![true],
            ..index("users_email_expr", &[], "btree")
        }];
    source = finalize_schema_snapshot(source).unwrap();

    let mut target = snapshot(
        "actual",
        vec![
            column("id", "INTEGER", false),
            column("email", "TEXT", true),
        ],
    );
    target.driver = "sqlite".to_string();
    target.database_name = None;
    target.schema_name = "main".to_string();
    target.relations[0].columns[0].is_auto_increment = false;
    target.relations[0].definition =
        Some("CREATE TABLE users (id INTEGER NOT NULL, email TEXT)".to_string());
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(plan.transactional);
    assert_eq!(plan.summary.blocked, 0);
    assert!(plan.changes[0].sql.iter().any(|statement| {
        statement.contains("lower(email) COLLATE NOCASE DESC")
            && statement.contains("WHERE email IS NOT NULL")
    }));
}

#[test]
fn sqlite_rebuild_recreates_exact_trigger_definitions() {
    let trigger = SchemaObjectSnapshot {
            name: "users_audit".to_string(),
            object_type: "trigger".to_string(),
            parent_name: Some("users".to_string()),
            description: None,
            definition: Some(
                "CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN INSERT INTO audit(user_id) VALUES (NEW.id); UPDATE audit SET touched = 1 WHERE user_id = NEW.id; END"
                    .to_string(),
            ),
            sequence_owner: None,
            sequence_last_value: None,
            sequence_is_called: None,
            dependencies: Vec::new(),
        };
    let mut source = snapshot(
        "desired",
        vec![
            column("id", "INTEGER", false),
            column("email", "TEXT", true),
        ],
    );
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].columns[0].is_auto_increment = false;
    source.relations[0].definition =
        Some("CREATE TABLE users (id INTEGER NOT NULL, email TEXT)".to_string());
    source.schema_objects = vec![trigger.clone()];
    source = finalize_schema_snapshot(source).unwrap();

    let mut target = snapshot("actual", vec![column("id", "INTEGER", false)]);
    target.driver = "sqlite".to_string();
    target.database_name = None;
    target.schema_name = "main".to_string();
    target.relations[0].columns[0].is_auto_increment = false;
    target.relations[0].definition = Some("CREATE TABLE users (id INTEGER NOT NULL)".to_string());
    target.schema_objects = vec![trigger];
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(plan.transactional);
    assert_eq!(plan.summary.blocked, 0);
    let trigger_sql = plan.changes[0].sql.last().unwrap();
    assert!(trigger_sql.starts_with("CREATE TRIGGER \"main\".\"users_audit\""));
    assert!(trigger_sql.contains("INSERT INTO audit(user_id) VALUES (NEW.id);"));
    assert!(trigger_sql.contains("UPDATE audit SET touched = 1"));
    assert!(trigger_sql.ends_with("END;"));
}

#[test]
fn sqlite_standalone_trigger_create_modify_and_drop_are_executable() {
    let desired_trigger = SchemaObjectSnapshot {
            name: "users_audit".to_string(),
            object_type: "trigger".to_string(),
            parent_name: Some("users".to_string()),
            description: None,
            definition: Some(
                "CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN INSERT INTO audit(user_id) VALUES (NEW.id); END"
                    .to_string(),
            ),
            sequence_owner: None,
            sequence_last_value: None,
            sequence_is_called: None,
            dependencies: Vec::new(),
        };
    let mut source = snapshot("desired", vec![column("id", "INTEGER", false)]);
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].columns[0].is_auto_increment = false;
    source.relations[0].definition = Some("CREATE TABLE users (id INTEGER NOT NULL)".to_string());
    source.schema_objects = vec![desired_trigger.clone()];
    source = finalize_schema_snapshot(source).unwrap();

    let mut empty_target = snapshot("actual", vec![column("id", "INTEGER", false)]);
    empty_target.driver = "sqlite".to_string();
    empty_target.database_name = None;
    empty_target.schema_name = "main".to_string();
    empty_target.relations[0].columns[0].is_auto_increment = false;
    empty_target.relations[0].definition =
        Some("CREATE TABLE users (id INTEGER NOT NULL)".to_string());
    empty_target = finalize_schema_snapshot(empty_target).unwrap();

    let create_plan = compare_schema_snapshots(&source, &empty_target, 2).unwrap();
    assert!(create_plan.transactional);
    assert_eq!(create_plan.summary.blocked, 0);
    assert_eq!(
        create_plan.changes[0].kind,
        SchemaChangeKind::SchemaObjectCreate
    );
    assert!(create_plan.changes[0].sql[0].starts_with("CREATE TRIGGER \"main\".\"users_audit\""));

    let mut old_trigger = desired_trigger.clone();
    old_trigger.definition = Some(
        "CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN SELECT NEW.id; END".to_string(),
    );
    let mut changed_target = empty_target.clone();
    changed_target.schema_objects = vec![old_trigger];
    changed_target = finalize_schema_snapshot(changed_target).unwrap();
    let modify_plan = compare_schema_snapshots(&source, &changed_target, 2).unwrap();
    assert!(modify_plan.transactional);
    assert_eq!(
        modify_plan.changes[0].kind,
        SchemaChangeKind::SchemaObjectModify
    );
    assert_eq!(
        modify_plan.changes[0].sql[0],
        "DROP TRIGGER \"main\".\"users_audit\";"
    );
    assert!(modify_plan.changes[0].sql[1].contains("INSERT INTO audit"));

    let drop_plan = compare_schema_snapshots(&empty_target, &source, 2).unwrap();
    assert!(drop_plan.transactional);
    assert_eq!(
        drop_plan.changes[0].kind,
        SchemaChangeKind::SchemaObjectDrop
    );
    assert_eq!(
        drop_plan.changes[0].sql,
        vec!["DROP TRIGGER \"main\".\"users_audit\";".to_string()]
    );
}

#[test]
fn sqlite_catalog_backed_table_create_and_drop_are_executable() {
    let trigger = SchemaObjectSnapshot {
        name: "users_audit".to_string(),
        object_type: "trigger".to_string(),
        parent_name: Some("users".to_string()),
        description: None,
        definition: Some(
            "CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN SELECT NEW.id; END".to_string(),
        ),
        sequence_owner: None,
        sequence_last_value: None,
        sequence_is_called: None,
        dependencies: Vec::new(),
    };
    let mut source = snapshot(
        "desired",
        vec![
            column("id", "INTEGER", false),
            column("email", "TEXT", true),
        ],
    );
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].columns[0].is_auto_increment = false;
    source.relations[0].definition = Some(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT CHECK (length(email) > 0)) STRICT"
            .to_string(),
    );
    source.relations[0].indexes = vec![IndexInfo {
        definition: Some(
            "CREATE INDEX users_email_idx ON users (lower(email)) WHERE email IS NOT NULL"
                .to_string(),
        ),
        key_is_expression: vec![true],
        ..index("users_email_idx", &[], "btree")
    }];
    source.schema_objects = vec![trigger];
    source = finalize_schema_snapshot(source).unwrap();

    let mut empty = source.clone();
    empty.connection_name = "actual".to_string();
    empty.relations.clear();
    empty.schema_objects.clear();
    empty = finalize_schema_snapshot(empty).unwrap();

    let create_plan = compare_schema_snapshots(&source, &empty, 2).unwrap();
    assert!(create_plan.transactional);
    assert_eq!(create_plan.summary.blocked, 0);
    assert_eq!(create_plan.changes.len(), 1);
    assert_eq!(
        create_plan.changes[0].kind,
        SchemaChangeKind::RelationCreate
    );
    assert_eq!(create_plan.changes[0].sql.len(), 3);
    assert!(create_plan.changes[0].sql[0].starts_with("CREATE TABLE \"main\".\"users\""));
    assert!(create_plan.changes[0].sql[1].starts_with("CREATE INDEX \"main\".\"users_email_idx\""));
    assert!(create_plan.changes[0].sql[2].starts_with("CREATE TRIGGER \"main\".\"users_audit\""));

    let drop_plan = compare_schema_snapshots(&empty, &source, 2).unwrap();
    assert!(drop_plan.transactional);
    assert_eq!(drop_plan.summary.blocked, 0);
    assert_eq!(drop_plan.changes.len(), 1);
    assert_eq!(drop_plan.changes[0].kind, SchemaChangeKind::RelationDrop);
    assert_eq!(
        drop_plan.changes[0].sql,
        vec!["DROP TABLE \"main\".\"users\";".to_string()]
    );
}

#[test]
fn sqlite_table_create_without_exact_catalog_source_remains_blocked() {
    let mut source = snapshot("desired", vec![column("id", "INTEGER", false)]);
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].definition = None;
    source = finalize_schema_snapshot(source).unwrap();

    let mut empty = source.clone();
    empty.connection_name = "actual".to_string();
    empty.relations.clear();
    empty = finalize_schema_snapshot(empty).unwrap();

    let plan = compare_schema_snapshots(&source, &empty, 2).unwrap();
    assert!(!plan.transactional);
    assert_eq!(plan.summary.blocked, 1);
    assert!(plan.changes[0].sql.is_empty());
    assert!(plan.changes[0].blocked_reason.is_some());
}

#[test]
fn sqlite_catalog_backed_view_create_modify_and_drop_are_executable() {
    let mut source = snapshot("desired", vec![column("id", "INTEGER", false)]);
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].name = "active_users".to_string();
    source.relations[0].object_type = Some("VIEW".to_string());
    source.relations[0].definition =
        Some("CREATE VIEW active_users AS SELECT id FROM users WHERE active = 1".to_string());
    source = finalize_schema_snapshot(source).unwrap();

    let mut empty = source.clone();
    empty.connection_name = "actual".to_string();
    empty.relations.clear();
    empty = finalize_schema_snapshot(empty).unwrap();

    let create_plan = compare_schema_snapshots(&source, &empty, 2).unwrap();
    assert!(create_plan.transactional);
    assert_eq!(create_plan.summary.blocked, 0);
    assert_eq!(
        create_plan.changes[0].kind,
        SchemaChangeKind::RelationCreate
    );
    assert_eq!(
        create_plan.changes[0].sql,
        vec![
            "CREATE VIEW \"main\".\"active_users\" AS SELECT id FROM users WHERE active = 1;"
                .to_string()
        ]
    );

    let mut target = source.clone();
    target.connection_name = "actual".to_string();
    target.relations[0].definition =
        Some("CREATE VIEW active_users AS SELECT id FROM users".to_string());
    target = finalize_schema_snapshot(target).unwrap();
    let modify_plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(modify_plan.transactional);
    assert_eq!(modify_plan.summary.blocked, 0);
    assert_eq!(
        modify_plan.changes[0].kind,
        SchemaChangeKind::RelationModify
    );
    assert_eq!(
        modify_plan.changes[0].sql[0],
        "DROP VIEW \"main\".\"active_users\";"
    );
    assert!(modify_plan.changes[0].sql[1].contains("WHERE active = 1"));

    let drop_plan = compare_schema_snapshots(&empty, &source, 2).unwrap();
    assert!(drop_plan.transactional);
    assert_eq!(drop_plan.summary.blocked, 0);
    assert_eq!(drop_plan.changes[0].kind, SchemaChangeKind::RelationDrop);
    assert_eq!(
        drop_plan.changes[0].sql,
        vec!["DROP VIEW \"main\".\"active_users\";".to_string()]
    );
}

#[test]
fn sqlite_table_drop_is_blocked_by_retained_view_with_unknown_dependencies() {
    let mut source = snapshot("desired", vec![column("id", "INTEGER", false)]);
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "main".to_string();
    source.relations[0].name = "active_users".to_string();
    source.relations[0].object_type = Some("VIEW".to_string());
    source.relations[0].definition =
        Some("CREATE VIEW active_users AS SELECT id FROM users".to_string());
    source = finalize_schema_snapshot(source).unwrap();

    let mut target = source.clone();
    target.connection_name = "actual".to_string();
    target.relations.push(SchemaRelationSnapshot {
        name: "users".to_string(),
        object_type: Some("BASE TABLE".to_string()),
        comment: None,
        definition: Some("CREATE TABLE users (id INTEGER NOT NULL)".to_string()),
        materialized_view_populated: None,
        dependencies: Vec::new(),
        external_dependencies: Vec::new(),
        sequence_dependencies: Vec::new(),
        columns: vec![column("id", "INTEGER", false)],
        indexes: Vec::new(),
        constraints: Vec::new(),
    });
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(!plan.transactional);
    assert_eq!(plan.summary.blocked, 1);
    let drop = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "users")
        .unwrap();
    assert!(drop
        .blocked_reason
        .as_deref()
        .is_some_and(|reason| reason.contains("retained views")));
}

#[test]
fn sqlite_attached_schema_rebuild_is_qualified_but_backup_blocked() {
    let trigger = SchemaObjectSnapshot {
        name: "users_audit".to_string(),
        object_type: "trigger".to_string(),
        parent_name: Some("users".to_string()),
        description: None,
        definition: Some(
            "CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN SELECT NEW.id; END".to_string(),
        ),
        sequence_owner: None,
        sequence_last_value: None,
        sequence_is_called: None,
        dependencies: Vec::new(),
    };
    let mut source = snapshot(
        "desired",
        vec![
            column("id", "INTEGER", false),
            column("email", "TEXT", true),
        ],
    );
    source.driver = "sqlite".to_string();
    source.database_name = None;
    source.schema_name = "archive".to_string();
    source.relations[0].columns[0].is_auto_increment = false;
    source.relations[0].definition =
        Some("CREATE TABLE users (id INTEGER NOT NULL, email TEXT)".to_string());
    source.relations[0].indexes = vec![IndexInfo {
        definition: Some("CREATE INDEX users_email_idx ON users (email)".to_string()),
        ..index("users_email_idx", &["email"], "btree")
    }];
    source.schema_objects = vec![trigger.clone()];
    source = finalize_schema_snapshot(source).unwrap();

    let mut target = snapshot("actual", vec![column("id", "INTEGER", false)]);
    target.driver = "sqlite".to_string();
    target.database_name = None;
    target.schema_name = "archive".to_string();
    target.relations[0].columns[0].is_auto_increment = false;
    target.relations[0].definition = Some("CREATE TABLE users (id INTEGER NOT NULL)".to_string());
    target.schema_objects = vec![trigger];
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(!plan.transactional);
    assert_eq!(plan.execution_owner, SchemaDiffExecutionOwner::ReviewOnly);
    assert_eq!(plan.summary.blocked, 1);
    assert!(plan.changes[0]
        .blocked_reason
        .as_deref()
        .is_some_and(|reason| reason.contains("recovery backup")));
    let sql = &plan.changes[0].sql;
    assert!(sql[0].starts_with("CREATE TABLE \"archive\".\"__oxide_rebuild_users_"));
    assert!(sql[1].contains("INSERT INTO \"archive\".\"__oxide_rebuild_users_"));
    assert!(sql[1].contains("FROM \"archive\".\"users\""));
    assert_eq!(sql[2], "DROP TABLE \"archive\".\"users\";");
    assert!(sql[3].starts_with("ALTER TABLE \"archive\".\"__oxide_rebuild_users_"));
    assert!(sql[4].starts_with("CREATE INDEX \"archive\".\"users_email_idx\""));
    assert!(sql[5].starts_with("CREATE TRIGGER \"archive\".\"users_audit\""));
}
