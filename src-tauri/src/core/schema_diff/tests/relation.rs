use super::super::*;
use super::support::*;

#[test]
fn adds_missing_nullable_column_with_safe_preview() {
    let source = snapshot(
        "desired",
        vec![
            column("id", "int4", false),
            column("nickname", "text", true),
        ],
    );
    let target = snapshot("actual", vec![column("id", "int4", false)]);
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert_eq!(plan.summary.safe, 1);
    assert_eq!(plan.summary.destructive, 0);
    assert_eq!(plan.changes[0].kind, SchemaChangeKind::ColumnAdd);
    assert!(plan
        .migration_sql
        .contains("ALTER TABLE \"public\".\"users\" ADD COLUMN \"nickname\" text;"));
    assert!(plan.migration_sql.ends_with("ROLLBACK;"));
}

#[test]
fn marks_target_only_column_as_destructive() {
    let source = snapshot("desired", vec![column("id", "int4", false)]);
    let target = snapshot(
        "actual",
        vec![column("id", "int4", false), column("legacy", "text", true)],
    );
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert_eq!(plan.summary.destructive, 1);
    assert!(!plan.changes[0].reversible);
    assert!(plan.migration_sql.contains("DROP COLUMN \"legacy\""));
}

#[test]
fn type_changes_require_manual_review() {
    let source = snapshot("desired", vec![column("id", "bigint", false)]);
    let target = snapshot("actual", vec![column("id", "int4", false)]);
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert_eq!(plan.changes[0].risk, SchemaChangeRisk::Destructive);
    assert!(plan.changes[0].manual_review);
    assert!(plan
        .migration_sql
        .contains("TYPE bigint USING \"id\"::bigint"));
}

#[test]
fn cross_driver_comparison_is_metadata_only_and_never_generates_sql() {
    let source = snapshot("desired", vec![column("id", "bigint", false)]);
    let mut target = snapshot("actual", vec![column("id", "bigint", false)]);
    target.driver = "mysql".to_string();
    target.relations[0]
        .columns
        .push(column("legacy", "varchar", true));
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(!plan.transactional);
    assert!(plan
        .migration_sql
        .contains("Cross-driver metadata comparison"));
    assert!(plan.changes.iter().all(|change| change.sql.is_empty()));
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("review-only")));
}

#[test]
fn postgres_cross_driver_review_lists_deterministic_lossy_mappings() {
    let mut source = snapshot(
        "desired",
        vec![
            column("id", "uuid", false),
            column("tags", "text[]", true),
            column("created_at", "timestamptz", false),
            column("status", "\"public\".\"order_state\"", false),
        ],
    );
    source.relations[0].columns[2].default_value =
        Some("now()::timestamp with time zone".to_string());
    source.relations[0].indexes.push(IndexInfo {
        name: "users_tags_gin".to_string(),
        columns: vec!["tags".to_string()],
        is_unique: false,
        is_primary: false,
        filter: None,
        index_type: Some("gin".to_string()),
        included_columns: None,
        definition: Some("CREATE INDEX users_tags_gin ON users USING gin (tags)".to_string()),
        comment: None,
        key_is_expression: Vec::new(),
    });
    source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot("actual", vec![column("id", "char(36)", false)]);
    target.driver = "mysql".to_string();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    assert!(plan.migration_sql.contains("uuid -> CHAR(36)"));
    assert!(plan.migration_sql.contains("LOSSY users.tags"));
    assert!(plan.migration_sql.contains("DATETIME(6)"));
    assert!(plan.conversion_issues.iter().any(|issue| issue.feature_kind
        == SchemaConversionFeatureKind::Default
        && issue.source_data_type.starts_with("DEFAULT ")));
    assert!(plan.conversion_issues.iter().any(|issue| issue.feature_kind
        == SchemaConversionFeatureKind::Index
        && issue.column_name == "index:users_tags_gin"
        && issue.target_data_type.as_deref() == Some("BTREE INDEX")));
    assert!(plan
        .conversion_issues
        .iter()
        .any(|issue| issue.column_name == "status"
            && issue.feature_kind == SchemaConversionFeatureKind::CustomType
            && issue.compatibility == SchemaConversionCompatibility::Unsupported));
    assert!(plan.changes.iter().all(|change| change.sql.is_empty()));
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("target-side validation is required")));
}

#[test]
fn postgres_conversion_review_categorizes_extended_chartdb_mappings() {
    let mut source = snapshot(
        "desired",
        vec![
            column("event_id", "uuid", false),
            column("active_window", "int4range", true),
            column("search_vector", "tsvector", true),
            column("meeting_time", "timetz", true),
            column("sequence_id", "smallserial", false),
            column("flags", "varbit", true),
        ],
    );
    source.relations[0].columns[0].default_value = Some("gen_random_uuid()".to_string());
    source.relations[0].indexes.push(IndexInfo {
        name: "users_search_gist".to_string(),
        columns: vec!["search_vector".to_string()],
        is_unique: false,
        is_primary: false,
        filter: None,
        index_type: Some("gist".to_string()),
        included_columns: None,
        definition: Some(
            "CREATE INDEX users_search_gist ON users USING gist (search_vector)".to_string(),
        ),
        comment: None,
        key_is_expression: Vec::new(),
    });
    source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot(
        "actual",
        vec![column("event_id", "uniqueidentifier", false)],
    );
    target.driver = "sqlserver".to_string();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    assert!(plan.conversion_issues.iter().any(|issue| {
        issue.column_name == "active_window"
            && issue.feature_kind == SchemaConversionFeatureKind::Type
            && issue.target_data_type.as_deref() == Some("NVARCHAR(MAX)")
            && issue.blocks_automatic_conversion
    }));
    assert!(plan.conversion_issues.iter().any(|issue| {
        issue.column_name == "meeting_time" && issue.target_data_type.as_deref() == Some("TIME")
    }));
    assert!(plan.conversion_issues.iter().any(|issue| {
        issue.column_name == "event_id"
            && issue.feature_kind == SchemaConversionFeatureKind::Default
            && issue.target_data_type.as_deref() == Some("DEFAULT NEWID()")
            && !issue.blocks_automatic_conversion
    }));
    assert!(plan.conversion_issues.iter().any(|issue| {
        issue.column_name == "index:users_search_gist"
            && issue.feature_kind == SchemaConversionFeatureKind::Index
            && issue.target_data_type.is_none()
    }));
}

#[test]
fn driver_aliases_keep_their_shared_native_migration_planner() {
    let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
    let mut target = snapshot("actual", vec![column("id", "bigint", false)]);
    source.driver = "mariadb".to_string();
    target.driver = "mysql".to_string();
    target.relations.clear();
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert_eq!(plan.driver, "mysql");
    assert!(plan.migration_sql.contains("CREATE TABLE"));
}

#[test]
fn external_driver_snapshots_are_compared_as_read_only_metadata() {
    let mut source = snapshot("desired", vec![column("id", "INTEGER", false)]);
    let mut target = snapshot("actual", vec![column("id", "INTEGER", false)]);
    source.driver = "duckdb".to_string();
    target.driver = "duckdb".to_string();
    target.relations[0]
        .columns
        .push(column("legacy", "VARCHAR", true));
    source = finalize_schema_snapshot(source).unwrap();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    assert_eq!(plan.driver, "duckdb");
    assert!(!plan.transactional);
    assert!(plan.migration_sql.contains("Metadata-only comparison"));
    assert!(plan.changes.iter().all(|change| change.sql.is_empty()));
}

#[test]
fn mysql_preview_warns_about_auto_commit_and_uses_mysql_alter_syntax() {
    let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
    let mut target = snapshot("actual", vec![column("id", "int", false)]);
    source.driver = "mysql".to_string();
    target.driver = "mysql".to_string();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    assert!(!plan.transactional);
    assert!(plan.id.starts_with("schema-diff-"));
    assert!(plan.migration_sql.contains("MySQL DDL may auto-commit"));
    assert!(plan
        .migration_sql
        .contains("ALTER TABLE `public`.`users` MODIFY COLUMN `id` bigint"));
    assert!(!plan.migration_sql.contains("ROLLBACK;"));
}

#[test]
fn created_relation_with_foreign_key_requires_dependency_review() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.relations[0].constraints = vec![ConstraintInfo {
        referenced_schema: Some("public".to_string()),
        referenced_table: Some("accounts".to_string()),
        referenced_columns: vec!["id".to_string()],
        ..constraint("users_account_fk", "FOREIGN KEY", &["id"])
    }];
    source.relations.push(SchemaRelationSnapshot {
        name: "accounts".to_string(),
        object_type: Some("BASE TABLE".to_string()),
        comment: None,
        definition: None,
        materialized_view_populated: None,
        dependencies: Vec::new(),
        external_dependencies: Vec::new(),
        sequence_dependencies: Vec::new(),
        columns: vec![column("id", "int4", false)],
        indexes: Vec::new(),
        constraints: Vec::new(),
    });
    source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot("actual", vec![column("id", "int4", false)]);
    target.relations.clear();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    let relation_creates = plan
        .changes
        .iter()
        .filter(|change| change.kind == SchemaChangeKind::RelationCreate)
        .collect::<Vec<_>>();
    let foreign_key = plan
        .changes
        .iter()
        .find(|change| change.child_name.as_deref() == Some("users_account_fk"))
        .unwrap();
    assert_eq!(relation_creates.len(), 2);
    assert_eq!(foreign_key.kind, SchemaChangeKind::ConstraintAdd);
    assert_eq!(foreign_key.risk, SchemaChangeRisk::Review);
    assert!(foreign_key.manual_review);
    assert_eq!(foreign_key.depends_on.len(), 2);
    assert!(relation_creates
        .iter()
        .all(|create| create.order < foreign_key.order));
    assert!(plan.migration_sql.contains("FOREIGN KEY"));
}

#[test]
fn changed_view_or_foreign_table_is_a_manual_artifact_without_generated_sql() {
    for object_type in ["VIEW", "FOREIGN TABLE"] {
        let mut source = snapshot("desired", vec![column("id", "int4", false)]);
        let mut target = snapshot("actual", vec![column("id", "int4", false)]);
        source.relations[0].object_type = Some(object_type.to_string());
        target.relations[0].object_type = Some(object_type.to_string());
        target.relations[0]
            .columns
            .push(column("legacy", "text", true));
        source = finalize_schema_snapshot(source).unwrap();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert_eq!(plan.changes[0].kind, SchemaChangeKind::RelationModify);
        assert!(plan.changes[0].sql.is_empty());
        assert!(plan.changes[0].manual_review);
        assert!(plan.migration_sql.contains("MANUAL REVIEW REQUIRED"));
    }
}

#[test]
fn captured_view_source_generates_reviewable_create_sql() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.relations[0].name = "active_users".to_string();
    source.relations[0].object_type = Some("VIEW".to_string());
    source.relations[0].definition = Some("SELECT id FROM users WHERE active".to_string());
    let mut target = snapshot("actual", Vec::new());
    target.relations.clear();
    source = finalize_schema_snapshot(source).unwrap();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "active_users")
        .expect("view creation should be planned");

    assert_eq!(change.kind, SchemaChangeKind::RelationCreate);
    assert_eq!(change.risk, SchemaChangeRisk::Review);
    assert!(change.manual_review);
    assert_eq!(
        change.sql,
        vec![
            "CREATE VIEW \"public\".\"active_users\" AS\nSELECT id FROM users WHERE active;"
                .to_string()
        ]
    );
}

#[test]
fn captured_view_source_generates_reviewable_replacement_sql() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    let mut target = snapshot("actual", vec![column("id", "int4", false)]);
    for relation in [&mut source.relations[0], &mut target.relations[0]] {
        relation.name = "active_users".to_string();
        relation.object_type = Some("VIEW".to_string());
    }
    source.relations[0].definition = Some("SELECT id FROM users WHERE active".to_string());
    target.relations[0].definition = Some("SELECT id FROM users".to_string());
    source = finalize_schema_snapshot(source).unwrap();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "active_users")
        .expect("view replacement should be planned");

    assert_eq!(change.kind, SchemaChangeKind::RelationModify);
    assert_eq!(change.risk, SchemaChangeRisk::Review);
    assert!(change.manual_review);
    assert_eq!(
            change.sql,
            vec![
                "CREATE OR REPLACE VIEW \"public\".\"active_users\" AS\nSELECT id FROM users WHERE active;"
                    .to_string()
            ]
        );
}

#[test]
fn captured_view_dependencies_order_new_relations_before_dependent_views() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.relations.push(SchemaRelationSnapshot {
        name: "active_users".to_string(),
        object_type: Some("VIEW".to_string()),
        comment: None,
        definition: Some("SELECT id FROM users WHERE active".to_string()),
        materialized_view_populated: None,
        dependencies: vec!["users".to_string()],
        external_dependencies: Vec::new(),
        sequence_dependencies: Vec::new(),
        columns: vec![column("id", "int4", false)],
        indexes: Vec::new(),
        constraints: Vec::new(),
    });
    source.relations.push(SchemaRelationSnapshot {
        name: "visible_users".to_string(),
        object_type: Some("VIEW".to_string()),
        comment: None,
        definition: Some("SELECT id FROM active_users".to_string()),
        materialized_view_populated: None,
        dependencies: vec!["active_users".to_string()],
        external_dependencies: Vec::new(),
        sequence_dependencies: Vec::new(),
        columns: vec![column("id", "int4", false)],
        indexes: Vec::new(),
        constraints: Vec::new(),
    });
    let mut target = snapshot("actual", Vec::new());
    target.relations.clear();
    source = finalize_schema_snapshot(source).unwrap();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let users = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "users")
        .expect("table creation should be planned");
    let active = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "active_users")
        .expect("first view creation should be planned");
    let visible = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "visible_users")
        .expect("dependent view creation should be planned");

    assert!(active.depends_on.contains(&users.id));
    assert!(visible.depends_on.contains(&active.id));
    assert!(users.order < active.order && active.order < visible.order);
}
