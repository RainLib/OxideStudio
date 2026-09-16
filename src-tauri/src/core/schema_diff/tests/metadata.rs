use super::super::*;
use super::support::*;

#[test]
fn index_comment_change_is_review_only_and_never_rebuilds_the_index() {
    let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
    let mut target = snapshot("actual", vec![column("id", "bigint", false)]);
    source.relations[0]
        .indexes
        .push(index("users_id_idx", &["id"], "btree"));
    target.relations[0]
        .indexes
        .push(index("users_id_idx", &["id"], "btree"));
    source.relations[0].indexes[0].comment = Some("lookup path".to_string());
    source = finalize_schema_snapshot(source).unwrap();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::IndexModify)
        .expect("index comment change");
    assert!(change.sql.is_empty());
    assert!(change.manual_review);
    assert_eq!(change.phase, SchemaChangePhase::ManualReview);
    assert!(change.blocked_reason.is_some());
    assert!(!plan.migration_sql.contains("DROP INDEX"));
    assert!(!plan.migration_sql.contains("CREATE INDEX"));
}

#[test]
fn table_comment_changes_use_semantic_postgres_ddl() {
    let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
    let target = snapshot("actual", vec![column("id", "bigint", false)]);
    source.relations[0].comment = Some("Owner's audit table".to_string());
    source = finalize_schema_snapshot(source).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| {
            change.kind == SchemaChangeKind::RelationModify
                && change.summary.contains("table comment")
        })
        .expect("table comment change");

    assert_eq!(change.risk, SchemaChangeRisk::Safe);
    assert!(!change.manual_review);
    assert_eq!(
        change.sql,
        vec!["COMMENT ON TABLE \"public\".\"users\" IS 'Owner''s audit table';"]
    );
}

#[test]
fn created_mysql_tables_restore_comments_after_creation() {
    let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
    source.driver = "mysql".to_string();
    source.schema_name = "app".to_string();
    source.relations[0].comment = Some("audit trail".to_string());
    source = finalize_schema_snapshot(source).unwrap();
    let mut target = source.clone();
    target.id = "actual".to_string();
    target.relations.clear();
    target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

    assert!(plan
        .migration_sql
        .contains("ALTER TABLE `app`.`users` COMMENT = 'audit trail';"));
}

#[test]
fn fingerprint_is_stable_after_relation_sorting() {
    let mut first = snapshot("first", vec![column("id", "int4", false)]);
    first.relations.push(SchemaRelationSnapshot {
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
    let first = finalize_schema_snapshot(first).unwrap();
    let mut second = first.clone();
    second.id = "second".to_string();
    second.relations.reverse();
    let second = finalize_schema_snapshot(second).unwrap();
    assert_eq!(first.fingerprint, second.fingerprint);
}

#[test]
fn routine_signatures_change_the_snapshot_fingerprint() {
    let legacy = snapshot("legacy", vec![column("id", "int4", false)]);
    let mut with_routine = legacy.clone();
    with_routine.id = "with-routine".to_string();
    with_routine.routines = vec![routine("normalize_email", "text")];
    let with_routine = finalize_schema_snapshot(with_routine).unwrap();

    assert_ne!(legacy.fingerprint, with_routine.fingerprint);
}

#[test]
fn generated_and_hidden_classification_changes_the_snapshot_fingerprint() {
    let ordinary = snapshot("ordinary", vec![column("total", "numeric", true)]);
    let mut generated_column = column("total", "numeric", true);
    generated_column.is_generated = Some(true);
    let generated = snapshot("generated", vec![generated_column]);
    let mut hidden_column = column("total", "numeric", true);
    hidden_column.is_hidden = Some(true);
    let hidden = snapshot("hidden", vec![hidden_column]);

    assert_ne!(ordinary.fingerprint, generated.fingerprint);
    assert_ne!(ordinary.fingerprint, hidden.fingerprint);
    assert_ne!(generated.fingerprint, hidden.fingerprint);
}

#[test]
fn postgres_identity_generation_is_preserved_and_diffed_without_partial_alter_sql() {
    let mut always = column("id", "bigint", false);
    always.identity_generation = Some("always".to_string());
    let (always_definition, always_warnings) =
        column_definition(DatabaseKind::Postgres, "public", "public", &always);
    assert!(always_warnings.is_empty());
    assert!(always_definition.contains("GENERATED ALWAYS AS IDENTITY"));

    let mut by_default = always.clone();
    by_default.identity_generation = Some("byDefault".to_string());
    let (by_default_definition, by_default_warnings) =
        column_definition(DatabaseKind::Postgres, "public", "public", &by_default);
    assert!(by_default_warnings.is_empty());
    assert!(by_default_definition.contains("GENERATED BY DEFAULT AS IDENTITY"));

    let source = snapshot("desired", vec![always]);
    let target = snapshot("actual", vec![by_default]);
    assert_ne!(source.fingerprint, target.fingerprint);
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::ColumnModify)
        .expect("identity mode change");
    assert!(change.manual_review);
    assert!(change.sql.is_empty());
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("Identity generation change")));
    assert!(!plan
        .migration_sql
        .contains("GENERATED BY DEFAULT AS IDENTITY"));
}

#[test]
fn unproven_or_invalid_postgres_identity_mode_never_emits_a_weaker_clause() {
    let unproven = column("id", "bigint", false);
    let (definition, warnings) =
        column_definition(DatabaseKind::Postgres, "public", "public", &unproven);
    assert!(!definition.contains("AS IDENTITY"));
    assert!(warnings
        .iter()
        .any(|warning| warning.contains("unproven PostgreSQL identity mode")));

    let mut invalid = unproven;
    invalid.identity_generation = Some("sometimes".to_string());
    let (definition, warnings) =
        column_definition(DatabaseKind::Postgres, "public", "public", &invalid);
    assert!(!definition.contains("AS IDENTITY"));
    assert!(warnings
        .iter()
        .any(|warning| warning.contains("Unsupported identity generation mode")));
}

#[test]
fn generated_or_unknown_column_ddl_is_review_only_without_partial_sql() {
    for classification in [Some(true), None] {
        let mut owned = column("computed_total", "numeric", true);
        owned.is_generated = classification;
        let source = snapshot("desired", vec![owned]);
        let target = snapshot("actual", Vec::new());

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        let change = plan
            .changes
            .iter()
            .find(|change| change.kind == SchemaChangeKind::ColumnAdd)
            .unwrap();
        assert!(change.manual_review);
        assert!(change.sql.is_empty());
        assert!(change.blocked_reason.is_some());
    }
}

#[test]
fn generated_visibility_changes_do_not_emit_incomplete_alter_sql() {
    let mut generated_column = column("total", "numeric", true);
    generated_column.is_generated = Some(true);
    let source = snapshot("desired", vec![generated_column]);
    let target = snapshot("actual", vec![column("total", "numeric", true)]);

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::ColumnModify)
        .unwrap();
    assert!(change.manual_review);
    assert!(change.sql.is_empty());
    assert!(change.blocked_reason.is_some());
}

#[test]
fn routine_drift_is_review_only_and_blocks_automatic_migration() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.routines = vec![routine("normalize_email", "text")];
    let source = finalize_schema_snapshot(source).unwrap();
    let target = snapshot("actual", vec![column("id", "int4", false)]);

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::RoutineCreate)
        .expect("routine creation should be visible in drift review");

    assert_eq!(change.phase, SchemaChangePhase::ManualReview);
    assert_eq!(change.risk, SchemaChangeRisk::Review);
    assert!(change.manual_review);
    assert!(change.sql.is_empty());
    assert!(change.blocked_reason.is_some());
    assert_eq!(plan.summary.blocked, 1);
    assert!(plan.migration_sql.contains("MANUAL REVIEW REQUIRED"));
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("Routine signature drift")));
}

#[test]
fn postgres_catalog_routine_definition_is_review_gated_but_executable() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    let mut routine = routine("normalize_email", "text");
    routine.definition = Some(
            "CREATE OR REPLACE FUNCTION public.normalize_email(input text) RETURNS text LANGUAGE sql AS $$ SELECT lower(input) $$"
                .to_string(),
        );
    source.routines = vec![routine];
    let source = finalize_schema_snapshot(source).unwrap();
    let target = snapshot("actual", vec![column("id", "int4", false)]);

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::RoutineCreate)
        .unwrap();

    assert!(change.manual_review);
    assert_eq!(change.risk, SchemaChangeRisk::Review);
    assert!(change.blocked_reason.is_none());
    assert_eq!(change.sql.len(), 1);
    assert!(change.sql[0].starts_with("CREATE OR REPLACE FUNCTION"));
    assert_eq!(plan.summary.blocked, 0);
}

#[test]
fn descriptor_object_drift_is_review_only_and_never_generates_ddl() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.schema_objects = vec![SchemaObjectSnapshot {
        name: "orders_id_seq".to_string(),
        object_type: "sequence".to_string(),
        parent_name: Some("orders".to_string()),
        description: Some("Primary-key generator".to_string()),
        definition: None,
        sequence_owner: None,
        sequence_last_value: None,
        sequence_is_called: None,
        dependencies: Vec::new(),
    }];
    let source = finalize_schema_snapshot(source).unwrap();
    let target = snapshot("actual", vec![column("id", "int4", false)]);

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::SchemaObjectCreate)
        .expect("schema object creation should be visible in drift review");

    assert_eq!(change.phase, SchemaChangePhase::ManualReview);
    assert_eq!(change.risk, SchemaChangeRisk::Review);
    assert!(change.manual_review);
    assert!(change.sql.is_empty());
    assert!(change.blocked_reason.is_some());
    assert_eq!(plan.summary.blocked, 1);
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("Schema object descriptor drift")));
}

#[test]
fn postgres_catalog_trigger_definition_is_review_gated_but_executable() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.schema_objects = vec![SchemaObjectSnapshot {
            name: "orders_audit".to_string(),
            object_type: "trigger".to_string(),
            parent_name: Some("orders".to_string()),
            description: None,
            definition: Some(
                "CREATE TRIGGER orders_audit AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.audit_order()"
                    .to_string(),
            ),
            sequence_owner: None,
            sequence_last_value: None,
            sequence_is_called: None,
            dependencies: Vec::new(),
        }];
    let source = finalize_schema_snapshot(source).unwrap();
    let target = snapshot("actual", vec![column("id", "int4", false)]);

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::SchemaObjectCreate)
        .unwrap();

    assert!(change.manual_review);
    assert!(change.blocked_reason.is_none());
    assert_eq!(change.sql.len(), 1);
    assert!(change.sql[0].starts_with("CREATE TRIGGER"));
}

#[test]
fn mysql_single_statement_catalog_trigger_is_review_gated_but_executable() {
    let mut source = snapshot("desired", vec![column("id", "int", false)]);
    source.driver = "mysql".to_string();
    source.schema_objects = vec![SchemaObjectSnapshot {
            name: "orders_audit".to_string(),
            object_type: "trigger".to_string(),
            parent_name: Some("orders".to_string()),
            description: None,
            definition: Some(
                "CREATE TRIGGER `orders_audit` AFTER INSERT ON `app`.`orders` FOR EACH ROW SET NEW.updated_at = NOW()"
                    .to_string(),
            ),
            sequence_owner: None,
            sequence_last_value: None,
            sequence_is_called: None,
            dependencies: Vec::new(),
        }];
    let source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot("actual", vec![column("id", "int", false)]);
    target.driver = "mysql".to_string();
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::SchemaObjectCreate)
        .unwrap();

    assert!(change.manual_review);
    assert!(change.blocked_reason.is_none());
    assert_eq!(change.sql.len(), 1);
    assert!(change.sql[0].starts_with("CREATE TRIGGER"));
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("single-statement")));
}

#[test]
fn mysql_compound_catalog_trigger_remains_blocked_without_delimiter_protocol() {
    let mut source = snapshot("desired", vec![column("id", "int", false)]);
    source.driver = "mysql".to_string();
    source.schema_objects = vec![SchemaObjectSnapshot {
            name: "orders_audit".to_string(),
            object_type: "trigger".to_string(),
            parent_name: Some("orders".to_string()),
            description: None,
            definition: Some(
                "CREATE TRIGGER `orders_audit` AFTER INSERT ON `app`.`orders` FOR EACH ROW BEGIN SET @audit = NEW.id; END"
                    .to_string(),
            ),
            sequence_owner: None,
            sequence_last_value: None,
            sequence_is_called: None,
            dependencies: Vec::new(),
        }];
    let source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot("actual", vec![column("id", "int", false)]);
    target.driver = "mysql".to_string();
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::SchemaObjectCreate)
        .unwrap();

    assert!(change.sql.is_empty());
    assert!(change.blocked_reason.is_some());
}

#[test]
fn mysql_catalog_event_is_review_gated_but_executable() {
    let mut source = snapshot("desired", vec![column("id", "int", false)]);
    source.driver = "mysql".to_string();
    source.schema_objects = vec![SchemaObjectSnapshot {
            name: "daily_sync".to_string(),
            object_type: "event".to_string(),
            parent_name: None,
            description: None,
            definition: Some(
                "CREATE EVENT `app`.`daily_sync` ON SCHEDULE EVERY 1 DAY ON COMPLETION NOT PRESERVE ENABLE DO CALL refresh_cache();"
                    .to_string(),
            ),
            sequence_owner: None,
            sequence_last_value: None,
            sequence_is_called: None,
            dependencies: Vec::new(),
        }];
    let source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot("actual", vec![column("id", "int", false)]);
    target.driver = "mysql".to_string();
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::SchemaObjectCreate)
        .unwrap();

    assert!(change.manual_review);
    assert!(change.blocked_reason.is_none());
    assert_eq!(change.sql.len(), 1);
    assert!(change.sql[0].starts_with("CREATE EVENT"));
}

#[test]
fn mysql_event_without_closed_vocabulary_shape_remains_blocked() {
    let mut source = snapshot("desired", vec![column("id", "int", false)]);
    source.driver = "mysql".to_string();
    source.schema_objects = vec![SchemaObjectSnapshot {
        name: "daily_sync".to_string(),
        object_type: "event".to_string(),
        parent_name: None,
        description: None,
        definition: Some(
            "CREATE DEFINER=`root`@`%` EVENT `app`.`daily_sync` DO CALL refresh_cache();"
                .to_string(),
        ),
        sequence_owner: None,
        sequence_last_value: None,
        sequence_is_called: None,
        dependencies: Vec::new(),
    }];
    let source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot("actual", vec![column("id", "int", false)]);
    target.driver = "mysql".to_string();
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::SchemaObjectCreate)
        .unwrap();

    assert!(change.sql.is_empty());
    assert!(change.blocked_reason.is_some());
}

#[test]
fn existing_postgres_trigger_is_not_recreated_as_an_unsafe_modify() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.schema_objects = vec![SchemaObjectSnapshot {
            name: "orders_audit".to_string(),
            object_type: "trigger".to_string(),
            parent_name: Some("orders".to_string()),
            description: None,
            definition: Some(
                "CREATE TRIGGER orders_audit AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.audit_order()"
                    .to_string(),
            ),
            sequence_owner: None,
            sequence_last_value: None,
            sequence_is_called: None,
            dependencies: Vec::new(),
        }];
    let source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot("actual", vec![column("id", "int4", false)]);
    target.schema_objects = vec![SchemaObjectSnapshot {
            name: "orders_audit".to_string(),
            object_type: "trigger".to_string(),
            parent_name: Some("orders".to_string()),
            description: None,
            definition: Some(
                "CREATE TRIGGER orders_audit AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.audit_order()"
                    .to_string(),
            ),
            sequence_owner: None,
            sequence_last_value: None,
            sequence_is_called: None,
            dependencies: Vec::new(),
        }];
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::SchemaObjectModify)
        .unwrap();
    assert!(change.sql.is_empty());
    assert!(change.blocked_reason.is_some());
}

#[test]
fn postgres_sequence_precedes_a_table_with_its_nextval_default() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.relations[0].columns[0].default_value =
        Some("nextval('public.users_id_seq'::regclass)".to_string());
    source.relations[0].sequence_dependencies = vec!["users_id_seq".to_string()];
    source.schema_objects = vec![SchemaObjectSnapshot {
            name: "users_id_seq".to_string(),
            object_type: "sequence".to_string(),
            parent_name: None,
            description: None,
            definition: Some(
                "CREATE SEQUENCE public.users_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;"
                    .to_string(),
            ),
            sequence_owner: Some(SchemaSequenceOwnerSnapshot {
                table_name: "users".to_string(),
                column_name: "id".to_string(),
            }),
            sequence_last_value: Some("42".to_string()),
            sequence_is_called: Some(true),
            dependencies: Vec::new(),
        }];
    let source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot("actual", Vec::new());
    target.relations.clear();
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let sequence = plan
        .changes
        .iter()
        .find(|change| {
            change.kind == SchemaChangeKind::SchemaObjectCreate
                && change.object_type.as_deref() == Some("sequence")
        })
        .unwrap();
    let table = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::RelationCreate)
        .unwrap();
    let state = plan
        .changes
        .iter()
        .find(|change| {
            change.kind == SchemaChangeKind::SchemaObjectModify
                && change.object_type.as_deref() == Some("sequence")
                && change.child_name.as_deref() == Some("ownership/state")
        })
        .unwrap();

    assert!(sequence.manual_review);
    assert!(sequence.blocked_reason.is_none());
    assert!(sequence.sql[0].starts_with("CREATE SEQUENCE"));
    assert!(table.depends_on.contains(&sequence.id));
    assert!(sequence.order < table.order);
    assert!(state.depends_on.contains(&sequence.id));
    assert!(state.depends_on.contains(&table.id));
    assert!(table.order < state.order);
    assert_eq!(state.sql.len(), 2);
    assert!(state.sql[0].starts_with("ALTER SEQUENCE"));
    assert!(state.sql[1].contains("pg_catalog.setval"));
    assert!(table.sql[0].contains("DEFAULT nextval('public.users_id_seq'::regclass)"));
    assert!(!table.sql[0].contains("GENERATED BY DEFAULT AS IDENTITY"));
}

#[test]
fn existing_postgres_sequence_restores_uncalled_state_and_removes_owner() {
    let definition = "CREATE SEQUENCE public.users_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;".to_string();
    let source_object = SchemaObjectSnapshot {
        name: "users_id_seq".to_string(),
        object_type: "sequence".to_string(),
        parent_name: None,
        description: None,
        definition: Some(definition.clone()),
        sequence_owner: None,
        sequence_last_value: Some("1".to_string()),
        sequence_is_called: Some(false),
        dependencies: Vec::new(),
    };
    let target_object = SchemaObjectSnapshot {
        sequence_owner: Some(SchemaSequenceOwnerSnapshot {
            table_name: "users".to_string(),
            column_name: "id".to_string(),
        }),
        sequence_last_value: Some("41".to_string()),
        sequence_is_called: Some(true),
        ..source_object.clone()
    };
    let mut source = snapshot("desired", vec![column("id", "int8", false)]);
    source.schema_objects = vec![source_object];
    let source = finalize_schema_snapshot(source).unwrap();
    let mut target = snapshot("actual", vec![column("id", "int8", false)]);
    target.schema_objects = vec![target_object];
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let changes = plan
        .changes
        .iter()
        .filter(|change| change.kind == SchemaChangeKind::SchemaObjectModify)
        .collect::<Vec<_>>();
    assert_eq!(changes.len(), 1);
    let state = changes[0];
    assert_eq!(state.child_name.as_deref(), Some("ownership/state"));
    assert!(state.blocked_reason.is_none());
    assert_eq!(
        state.sql,
        vec![
            "ALTER SEQUENCE \"public\".\"users_id_seq\" OWNED BY NONE;".to_string(),
            "SELECT pg_catalog.setval('\"public\".\"users_id_seq\"'::regclass, 1, false);"
                .to_string(),
        ]
    );
}

#[test]
fn postgres_routines_are_ordered_before_catalog_triggers() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    let mut routine = routine("audit_order", "trigger");
    routine.definition = Some(
            "CREATE OR REPLACE FUNCTION public.audit_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"
                .to_string(),
        );
    source.routines = vec![routine];
    source.schema_objects = vec![SchemaObjectSnapshot {
            name: "orders_audit".to_string(),
            object_type: "trigger".to_string(),
            parent_name: Some("orders".to_string()),
            description: None,
            definition: Some(
                "CREATE TRIGGER orders_audit AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.audit_order()"
                    .to_string(),
            ),
            sequence_owner: None,
            sequence_last_value: None,
            sequence_is_called: None,
            dependencies: vec!["audit_order".to_string()],
        }];
    let source = finalize_schema_snapshot(source).unwrap();
    let target = snapshot("actual", vec![column("id", "int4", false)]);

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let routine = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::RoutineCreate)
        .unwrap();
    let trigger = plan
        .changes
        .iter()
        .find(|change| change.kind == SchemaChangeKind::SchemaObjectCreate)
        .unwrap();
    assert!(trigger.depends_on.contains(&routine.id));
    assert!(routine.order < trigger.order);
}
