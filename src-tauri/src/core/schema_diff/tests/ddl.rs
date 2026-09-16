use super::super::*;
use super::support::*;

#[test]
fn relation_without_captured_columns_does_not_emit_invalid_create_sql() {
    let mut source = snapshot("desired", Vec::new());
    let mut target = snapshot("actual", Vec::new());
    target.relations.clear();
    source = finalize_schema_snapshot(source).unwrap();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    assert!(plan.changes[0].sql.is_empty());
    assert_eq!(plan.changes[0].risk, SchemaChangeRisk::Review);
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("no captured columns")));
}

#[test]
fn postgres_expression_index_preserves_exact_database_definition() {
    let mut source = snapshot(
        "desired",
        vec![column("id", "int4", false), column("email", "text", true)],
    );
    source.relations[0].indexes = vec![IndexInfo {
            definition: Some(
                "CREATE INDEX users_email_lower_idx ON public.users USING btree (lower(email)) WHERE (email IS NOT NULL)"
                    .to_string(),
            ),
            ..index("users_email_lower_idx", &[], "btree")
        }];
    source = finalize_schema_snapshot(source).unwrap();
    let target = snapshot(
        "actual",
        vec![column("id", "int4", false), column("email", "text", true)],
    );

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    assert_eq!(plan.changes[0].risk, SchemaChangeRisk::Safe);
    assert_eq!(plan.changes[0].sql.len(), 1);
    assert!(plan.migration_sql.contains("lower(email)"));
    assert!(plan.migration_sql.contains("WHERE (email IS NOT NULL);"));
}

#[test]
fn unknown_mysql_index_definition_never_emits_partial_rebuild_sql() {
    let mut mysql_source = snapshot(
        "desired",
        vec![column("id", "int4", false), column("body", "text", true)],
    );
    let mut mysql_target = snapshot(
        "actual",
        vec![column("id", "int4", false), column("body", "text", true)],
    );
    mysql_source.driver = "mysql".to_string();
    mysql_source.relations[0].indexes = vec![index("users_body_fulltext", &["body"], "FULLTEXT")];
    mysql_source = finalize_schema_snapshot(mysql_source).unwrap();
    mysql_target.driver = "mysql".to_string();
    mysql_target = finalize_schema_snapshot(mysql_target).unwrap();

    let mysql_plan = compare_schema_snapshots(&mysql_source, &mysql_target, 2).unwrap();
    assert_eq!(mysql_plan.changes[0].risk, SchemaChangeRisk::Review);
    assert!(mysql_plan.changes[0].sql.is_empty());
}

#[test]
fn postgres_cross_schema_mapping_rewrites_catalog_backed_identifiers() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.schema_name = "template".to_string();
    source.relations[0].columns[0].default_value =
        Some("nextval('template.users_id_seq'::regclass)".to_string());
    source.relations[0].indexes = vec![IndexInfo {
        definition: Some(
            "CREATE INDEX users_id_idx ON template.users USING btree (id)".to_string(),
        ),
        ..index("users_id_idx", &[], "btree")
    }];
    source.relations.push(SchemaRelationSnapshot {
        name: "active_users".to_string(),
        object_type: Some("VIEW".to_string()),
        comment: None,
        definition: Some("SELECT id FROM template.users".to_string()),
        materialized_view_populated: None,
        dependencies: vec!["users".to_string()],
        external_dependencies: Vec::new(),
        sequence_dependencies: Vec::new(),
        columns: vec![column("id", "int4", false)],
        indexes: Vec::new(),
        constraints: Vec::new(),
    });
    source.routines.push(SchemaRoutineSnapshot {
            name: "refresh_users".to_string(),
            routine_type: Some("FUNCTION".to_string()),
            parameters: Vec::new(),
            return_type: "integer".to_string(),
            description: None,
            definition: Some(
                "CREATE OR REPLACE FUNCTION template.refresh_users() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;"
                    .to_string(),
            ),
        });
    source.schema_objects.push(SchemaObjectSnapshot {
        name: "users_id_seq".to_string(),
        object_type: "sequence".to_string(),
        parent_name: None,
        description: None,
        definition: Some("CREATE SEQUENCE template.users_id_seq;".to_string()),
        sequence_owner: None,
        sequence_last_value: None,
        sequence_is_called: None,
        dependencies: Vec::new(),
    });
    source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot("actual", Vec::new());
    target.relations.clear();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    assert!(plan
        .warnings
        .iter()
        .any(|warning| { warning.contains("schema mapping template -> public") }));
    assert!(plan
        .migration_sql
        .contains("nextval('\"public\".users_id_seq'::regclass)"));
    assert!(plan
        .migration_sql
        .contains("CREATE INDEX users_id_idx ON \"public\".users"));
    assert!(plan
        .migration_sql
        .contains("SELECT id FROM \"public\".users"));
    assert!(
        plan.migration_sql
            .contains("CREATE OR REPLACE FUNCTION \"public\".refresh_users"),
        "{}",
        plan.migration_sql
    );
    assert!(plan
        .migration_sql
        .contains("CREATE SEQUENCE \"public\".users_id_seq"));
}

#[test]
fn cross_schema_mapping_rejects_non_postgres_snapshots() {
    let mut source = snapshot("desired", vec![column("id", "int", false)]);
    let mut target = snapshot("actual", vec![column("id", "int", false)]);
    source.driver = "mysql".to_string();
    target.driver = "mysql".to_string();
    source.schema_name = "template".to_string();
    source = finalize_schema_snapshot(source).unwrap();
    target = finalize_schema_snapshot(target).unwrap();

    let error = compare_schema_snapshots(&source, &target, 2).unwrap_err();

    assert!(error
        .to_string()
        .contains("currently supported only for native PostgreSQL"));
}

#[test]
fn postgres_cross_schema_foreign_key_uses_the_target_schema_for_ddl_and_preflight() {
    let foreign_key = ConstraintInfo {
        referenced_schema: Some("template".to_string()),
        referenced_table: Some("accounts".to_string()),
        referenced_columns: vec!["id".to_string()],
        ..constraint("users_account_fk", "FOREIGN KEY", &["account_id"])
    };

    let ddl = add_constraint_sql(
        DatabaseKind::Postgres,
        "template",
        "public",
        "users",
        &foreign_key,
    )
    .expect("foreign key DDL");
    let preflight = foreign_key_preflight_sql(
        DatabaseKind::Postgres,
        "template",
        "public",
        "users",
        &foreign_key,
    )
    .expect("foreign key preflight");

    assert!(ddl.contains("REFERENCES \"public\".\"accounts\""));
    assert!(preflight.contains("FROM \"public\".\"accounts\" AS parent"));
}

#[test]
fn mysql_check_and_structured_foreign_key_are_executable() {
    let mut source = snapshot(
        "desired",
        vec![column("id", "int", false), column("age", "int", true)],
    );
    source.driver = "mysql".to_string();
    source.relations[0].constraints = vec![
        ConstraintInfo {
            definition: Some("age >= 0".to_string()),
            ..constraint("users_age_check", "CHECK", &[])
        },
        ConstraintInfo {
            referenced_schema: Some("public".to_string()),
            referenced_table: Some("accounts".to_string()),
            referenced_columns: vec!["id".to_string()],
            on_update: Some("CASCADE".to_string()),
            on_delete: Some("SET NULL".to_string()),
            ..constraint("users_account_fk", "FOREIGN KEY", &["id"])
        },
    ];
    source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot(
        "actual",
        vec![column("id", "int", false), column("age", "int", true)],
    );
    target.driver = "mysql".to_string();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    let check = plan
        .changes
        .iter()
        .find(|change| change.child_name.as_deref() == Some("users_age_check"))
        .unwrap();
    assert!(check.sql[0].contains("CHECK (age >= 0)"));
    let foreign_key = plan
        .changes
        .iter()
        .find(|change| change.child_name.as_deref() == Some("users_account_fk"))
        .unwrap();
    assert_eq!(foreign_key.sql.len(), 1);
    assert!(foreign_key.sql[0].contains("REFERENCES `public`.`accounts` (`id`)"));
    assert!(foreign_key.sql[0].contains("ON DELETE SET NULL"));
    assert!(foreign_key.sql[0].contains("ON UPDATE CASCADE"));
    assert!(foreign_key.manual_review);
}

#[test]
fn postgres_index_filter_include_and_expression_provenance_are_structural() {
    let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
    let mut target = snapshot("actual", vec![column("id", "bigint", false)]);
    let mut source_index = index("users_lookup_idx", &["id"], "btree");
    source_index.filter = Some("id > 0".to_string());
    source_index.included_columns = Some(vec!["email".to_string()]);
    source_index.key_is_expression = vec![false];
    source_index.definition = Some(
            "CREATE INDEX users_lookup_idx ON public.users USING btree (id) INCLUDE (email) WHERE id > 0"
                .to_string(),
        );
    let mut target_index = source_index.clone();
    target_index.filter = Some("id > 1".to_string());
    target_index.included_columns = None;
    target_index.key_is_expression = vec![true];
    target_index.definition = Some(
        "CREATE INDEX users_lookup_idx ON public.users USING btree ((id + 1)) WHERE id > 1"
            .to_string(),
    );
    source.relations[0].indexes.push(source_index);
    target.relations[0].indexes.push(target_index);
    source = finalize_schema_snapshot(source).unwrap();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let index_changes = plan
        .changes
        .iter()
        .filter(|change| change.child_name.as_deref() == Some("users_lookup_idx"))
        .collect::<Vec<_>>();

    assert_eq!(index_changes.len(), 2);
    assert_eq!(index_changes[0].kind, SchemaChangeKind::IndexDrop);
    assert_eq!(index_changes[1].kind, SchemaChangeKind::IndexAdd);
    assert!(index_changes[1].sql[0].contains("INCLUDE (email)"));
    assert!(index_changes[1].sql[0].contains("WHERE id > 0"));
}

#[test]
fn mysql_index_generation_rejects_unrepresented_key_semantics() {
    let mut source_index = index("users_lookup_idx", &["email"], "btree");
    source_index.definition = None;
    source_index.key_is_expression = vec![true];
    let error =
        create_index_sql(DatabaseKind::Mysql, "app", "app", "users", &source_index).unwrap_err();
    assert!(error.contains("requires its exact source definition"));

    source_index.key_is_expression = vec![false, true];
    assert!(create_index_sql(DatabaseKind::Mysql, "app", "app", "users", &source_index,).is_err());
}

#[test]
fn mysql_foreign_key_action_change_rebuilds_with_source_actions() {
    let mut source = snapshot("desired", vec![column("account_id", "bigint", false)]);
    let mut target = snapshot("actual", vec![column("account_id", "bigint", false)]);
    source.driver = "mysql".to_string();
    target.driver = "mysql".to_string();
    source.relations[0].constraints = vec![ConstraintInfo {
        referenced_schema: Some("app".to_string()),
        referenced_table: Some("accounts".to_string()),
        referenced_columns: vec!["id".to_string()],
        on_update: Some("CASCADE".to_string()),
        on_delete: Some("SET NULL".to_string()),
        ..constraint("users_account_fk", "FOREIGN KEY", &["account_id"])
    }];
    target.relations[0].constraints = vec![ConstraintInfo {
        referenced_schema: Some("app".to_string()),
        referenced_table: Some("accounts".to_string()),
        referenced_columns: vec!["id".to_string()],
        on_update: Some("NO ACTION".to_string()),
        on_delete: Some("RESTRICT".to_string()),
        ..constraint("users_account_fk", "FOREIGN KEY", &["account_id"])
    }];
    source = finalize_schema_snapshot(source).unwrap();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let changes = plan
        .changes
        .iter()
        .filter(|change| change.child_name.as_deref() == Some("users_account_fk"))
        .collect::<Vec<_>>();

    assert_eq!(changes.len(), 2);
    assert_eq!(changes[0].kind, SchemaChangeKind::ConstraintDrop);
    assert_eq!(changes[1].kind, SchemaChangeKind::ConstraintAdd);
    assert!(changes[1].sql[0].contains("ON DELETE SET NULL"));
    assert!(changes[1].sql[0].contains("ON UPDATE CASCADE"));
}

#[test]
fn target_only_relations_drop_foreign_keys_before_both_sides() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.relations.clear();
    source = finalize_schema_snapshot(source).unwrap();

    let mut target = snapshot("actual", vec![column("id", "int4", false)]);
    target.relations[0].constraints = vec![ConstraintInfo {
        referenced_schema: Some("public".to_string()),
        referenced_table: Some("accounts".to_string()),
        referenced_columns: vec!["id".to_string()],
        ..constraint("users_account_fk", "FOREIGN KEY", &["id"])
    }];
    target.relations.push(SchemaRelationSnapshot {
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
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    let foreign_key_drop = plan
        .changes
        .iter()
        .find(|change| change.child_name.as_deref() == Some("users_account_fk"))
        .unwrap();
    let relation_drops = plan
        .changes
        .iter()
        .filter(|change| change.kind == SchemaChangeKind::RelationDrop)
        .collect::<Vec<_>>();
    assert_eq!(foreign_key_drop.phase, SchemaChangePhase::DropDependencies);
    assert_eq!(relation_drops.len(), 2);
    assert!(relation_drops.iter().all(|drop| {
        drop.depends_on.contains(&foreign_key_drop.id) && foreign_key_drop.order < drop.order
    }));
    assert_eq!(plan.preflight_checks.len(), 2);
}

#[test]
fn preflight_covers_required_columns_not_null_and_unique_constraints() {
    let mut source = snapshot(
        "desired",
        vec![
            column("id", "int4", false),
            column("email", "text", false),
            column("tenant_id", "int4", false),
        ],
    );
    source.relations[0].constraints = vec![constraint("users_email_key", "UNIQUE", &["email"])];
    source = finalize_schema_snapshot(source).unwrap();
    let target = snapshot(
        "actual",
        vec![column("id", "int4", false), column("email", "text", true)],
    );

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    assert_eq!(plan.preflight_checks.len(), 3);
    assert_eq!(
        plan.preflight_checks
            .iter()
            .filter(|check| check.assertion == SchemaPreflightAssertion::ZeroValue)
            .count(),
        2
    );
    assert!(plan.preflight_checks.iter().any(|check| {
        check.assertion == SchemaPreflightAssertion::EmptyRows && check.result_column.is_none()
    }));
    assert!(plan.preflight_sql.contains("blocking_rows"));
    assert!(plan.preflight_sql.contains("IS NULL"));
    assert!(plan.preflight_sql.contains("duplicate_count"));
    assert!(plan.preflight_sql.contains("HAVING COUNT(*) > 1"));
}

#[test]
fn type_change_with_unchanged_dependency_is_blocked_instead_of_half_generated() {
    let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
    source.relations[0].indexes = vec![index("users_id_idx", &["id"], "btree")];
    source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot("actual", vec![column("id", "int4", false)]);
    target.relations[0].indexes = vec![index("users_id_idx", &["id"], "btree")];
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    let type_change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::ColumnModify)
        .unwrap();
    assert!(type_change.blocked_reason.is_some());
    assert!(type_change.sql.is_empty());
    assert_eq!(type_change.phase, SchemaChangePhase::ManualReview);
    assert_eq!(plan.summary.blocked, 1);
    assert!(plan.migration_sql.contains("PLAN BLOCKED"));
    assert!(!plan.migration_sql.contains("ALTER COLUMN \"id\" TYPE"));
}

#[test]
fn mongodb_snapshots_produce_metadata_only_diffs() {
    let mut source = snapshot(
        "desired",
        vec![
            column("_id", "objectId", false),
            column("email", "string", true),
        ],
    );
    source.driver = "mongodb".to_string();
    source.database_name = None;
    source.schema_name = "app".to_string();
    source.relations[0].object_type = Some("collection".to_string());
    source.relations[0].indexes = vec![
        index("email_1", &["email"], "btree"),
        // MongoDB reports the backing unique index and its logical
        // constraint through two metadata endpoints. The review plan
        // must present the latter once, not as a second index action.
        index("email_unique", &["email"], "btree"),
    ];
    source.relations[0].constraints = vec![constraint("email_unique", "UNIQUE", &["email"])];
    source = finalize_schema_snapshot(source).unwrap();

    let mut target = snapshot("actual", vec![column("_id", "objectId", false)]);
    target.driver = "mongodb".to_string();
    target.database_name = None;
    target.schema_name = "app".to_string();
    target.relations[0].object_type = Some("collection".to_string());
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    assert!(plan
        .changes
        .iter()
        .any(|change| change.kind == SchemaChangeKind::ColumnAdd));
    assert!(plan
        .changes
        .iter()
        .any(|change| change.kind == SchemaChangeKind::IndexAdd));
    assert!(plan
        .changes
        .iter()
        .any(|change| change.kind == SchemaChangeKind::ConstraintAdd));
    assert!(!plan.changes.iter().any(|change| {
        change.kind == SchemaChangeKind::IndexAdd
            && change.child_name.as_deref() == Some("email_unique")
    }));
    assert!(plan.changes.iter().all(|change| change.sql.is_empty()));
    assert!(plan
        .changes
        .iter()
        .all(|change| change.blocked_reason.is_some()));
    assert!(!plan.transactional);
    assert!(plan.migration_sql.contains("Metadata-only comparison"));
}
