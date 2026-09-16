use super::super::*;
use super::support::*;

#[test]
fn postgres_materialized_view_preserves_captured_population_state() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.relations.push(SchemaRelationSnapshot {
        name: "active_users_mv".to_string(),
        object_type: Some("MATERIALIZED VIEW".to_string()),
        comment: None,
        definition: Some("SELECT id FROM users WHERE active".to_string()),
        materialized_view_populated: Some(false),
        dependencies: vec!["users".to_string()],
        external_dependencies: Vec::new(),
        sequence_dependencies: Vec::new(),
        columns: vec![column("id", "int4", false)],
        indexes: Vec::new(),
        constraints: Vec::new(),
    });
    source.relations.push(SchemaRelationSnapshot {
        name: "all_users_mv".to_string(),
        object_type: Some("MATERIALIZED VIEW".to_string()),
        comment: None,
        definition: Some("SELECT id FROM users".to_string()),
        materialized_view_populated: Some(true),
        dependencies: vec!["users".to_string()],
        external_dependencies: Vec::new(),
        sequence_dependencies: Vec::new(),
        columns: vec![column("id", "int4", false)],
        indexes: Vec::new(),
        constraints: Vec::new(),
    });
    let mut target = snapshot("actual", Vec::new());
    target.relations.clear();
    let source = finalize_schema_snapshot(source).unwrap();
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let users = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "users")
        .expect("table creation should be planned");
    let materialized_view = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "active_users_mv")
        .expect("materialized view creation should be planned");

    assert!(materialized_view.manual_review);
    assert!(materialized_view.depends_on.contains(&users.id));
    assert_eq!(
            materialized_view.sql,
            vec![
                "CREATE MATERIALIZED VIEW \"public\".\"active_users_mv\" AS\nSELECT id FROM users WHERE active\nWITH NO DATA;"
                    .to_string()
            ]
        );
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("WITH NO DATA")));
    let populated_materialized_view = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "all_users_mv")
        .expect("populated materialized view creation should be planned");
    assert!(populated_materialized_view.depends_on.contains(&users.id));
    assert_eq!(
            populated_materialized_view.sql,
            vec![
                "CREATE MATERIALIZED VIEW \"public\".\"all_users_mv\" AS\nSELECT id FROM users\nWITH DATA;"
                    .to_string()
            ]
        );
}

#[test]
fn changed_postgres_materialized_view_is_a_destructive_reviewed_recreation() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.relations.push(SchemaRelationSnapshot {
        name: "active_users_mv".to_string(),
        object_type: Some("MATERIALIZED VIEW".to_string()),
        comment: None,
        definition: Some("SELECT id FROM users WHERE active".to_string()),
        materialized_view_populated: Some(false),
        dependencies: vec!["users".to_string()],
        external_dependencies: Vec::new(),
        sequence_dependencies: Vec::new(),
        columns: vec![column("id", "int4", false)],
        indexes: Vec::new(),
        constraints: Vec::new(),
    });
    let mut target = source.clone();
    let target_view = target
        .relations
        .iter_mut()
        .find(|relation| relation.name == "active_users_mv")
        .expect("target materialized view");
    target_view.definition = Some("SELECT id FROM users WHERE NOT active".to_string());
    target_view.materialized_view_populated = Some(true);
    let source = finalize_schema_snapshot(source).unwrap();
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "active_users_mv")
        .expect("materialized view recreation should be planned");

    assert_eq!(change.kind, SchemaChangeKind::RelationModify);
    assert_eq!(change.risk, SchemaChangeRisk::Destructive);
    assert!(change.manual_review);
    assert!(!change.reversible);
    assert_eq!(
            change.sql,
            vec![
                "DROP MATERIALIZED VIEW \"public\".\"active_users_mv\";".to_string(),
                "CREATE MATERIALIZED VIEW \"public\".\"active_users_mv\" AS\nSELECT id FROM users WHERE active\nWITH NO DATA;"
                    .to_string(),
            ]
        );
    assert!(plan.requires_destructive_approval);
    assert!(!change.sql.join("\n").contains("CASCADE"));
}

#[test]
fn materialized_view_recreation_rebuilds_captured_dependent_views_without_cascade() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.relations.extend([
        SchemaRelationSnapshot {
            name: "active_users_mv".to_string(),
            object_type: Some("MATERIALIZED VIEW".to_string()),
            comment: None,
            definition: Some("SELECT id FROM users WHERE active".to_string()),
            materialized_view_populated: Some(false),
            dependencies: vec!["users".to_string()],
            external_dependencies: Vec::new(),
            sequence_dependencies: Vec::new(),
            columns: vec![column("id", "int4", false)],
            indexes: Vec::new(),
            constraints: Vec::new(),
        },
        SchemaRelationSnapshot {
            name: "active_users".to_string(),
            object_type: Some("VIEW".to_string()),
            comment: None,
            definition: Some("SELECT id FROM active_users_mv".to_string()),
            materialized_view_populated: None,
            dependencies: vec!["active_users_mv".to_string()],
            external_dependencies: Vec::new(),
            sequence_dependencies: Vec::new(),
            columns: vec![column("id", "int4", false)],
            indexes: Vec::new(),
            constraints: Vec::new(),
        },
        SchemaRelationSnapshot {
            name: "active_users_report".to_string(),
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
        },
    ]);
    let mut target = source.clone();
    target
        .relations
        .iter_mut()
        .find(|relation| relation.name == "active_users_mv")
        .expect("target materialized view")
        .definition = Some("SELECT id FROM users WHERE NOT active".to_string());
    let source = finalize_schema_snapshot(source).unwrap();
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let drop_report = plan
        .changes
        .iter()
        .find(|change| change.summary == "Temporarily drop dependent view active_users_report")
        .expect("transitive dependent view drop");
    let drop_view = plan
        .changes
        .iter()
        .find(|change| change.summary == "Temporarily drop dependent view active_users")
        .expect("direct dependent view drop");
    let materialized = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "active_users_mv")
        .expect("materialized recreation");
    let recreate_view = plan
        .changes
        .iter()
        .find(|change| change.summary == "Recreate dependent view active_users")
        .expect("direct dependent view recreation");
    let recreate_report = plan
        .changes
        .iter()
        .find(|change| change.summary == "Recreate dependent view active_users_report")
        .expect("transitive dependent view recreation");

    assert!(drop_view.depends_on.contains(&drop_report.id));
    assert!(materialized.depends_on.contains(&drop_view.id));
    assert!(recreate_view.depends_on.contains(&materialized.id));
    assert!(recreate_report.depends_on.contains(&recreate_view.id));
    assert!(plan.changes.iter().all(|change| change.manual_review));
    assert!(plan
        .changes
        .iter()
        .flat_map(|change| change.sql.iter())
        .all(|sql| !sql.contains("CASCADE")));
}

#[test]
fn materialized_view_recreation_blocks_when_a_dependent_view_cannot_be_rebuilt() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.relations.extend([
        SchemaRelationSnapshot {
            name: "active_users_mv".to_string(),
            object_type: Some("MATERIALIZED VIEW".to_string()),
            comment: None,
            definition: Some("SELECT id FROM users WHERE active".to_string()),
            materialized_view_populated: Some(false),
            dependencies: vec!["users".to_string()],
            external_dependencies: Vec::new(),
            sequence_dependencies: Vec::new(),
            columns: vec![column("id", "int4", false)],
            indexes: Vec::new(),
            constraints: Vec::new(),
        },
        SchemaRelationSnapshot {
            name: "active_users".to_string(),
            object_type: Some("VIEW".to_string()),
            comment: None,
            definition: None,
            materialized_view_populated: None,
            dependencies: vec!["active_users_mv".to_string()],
            external_dependencies: Vec::new(),
            sequence_dependencies: Vec::new(),
            columns: vec![column("id", "int4", false)],
            indexes: Vec::new(),
            constraints: Vec::new(),
        },
    ]);
    let mut target = source.clone();
    target
        .relations
        .iter_mut()
        .find(|relation| relation.name == "active_users_mv")
        .expect("target materialized view")
        .definition = Some("SELECT id FROM users WHERE NOT active".to_string());
    let source = finalize_schema_snapshot(source).unwrap();
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let materialized = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "active_users_mv")
        .expect("materialized recreation");

    assert!(materialized.sql.is_empty());
    assert!(materialized
        .blocked_reason
        .as_deref()
        .is_some_and(|reason| reason.contains("active_users")));
    assert!(!plan
        .changes
        .iter()
        .any(|change| { change.summary == "Temporarily drop dependent view active_users" }));
}

#[test]
fn external_view_dependencies_are_preserved_and_warn_on_creation() {
    let mut source = snapshot("desired", vec![column("id", "int4", false)]);
    source.relations.push(SchemaRelationSnapshot {
        name: "audit_users".to_string(),
        object_type: Some("VIEW".to_string()),
        comment: None,
        definition: Some("SELECT id FROM users".to_string()),
        materialized_view_populated: None,
        dependencies: vec!["users".to_string()],
        external_dependencies: vec!["audit.events".to_string(), "shared.users".to_string()],
        sequence_dependencies: Vec::new(),
        columns: vec![column("id", "int4", false)],
        indexes: Vec::new(),
        constraints: Vec::new(),
    });
    let mut target = source.clone();
    target
        .relations
        .retain(|relation| relation.name != "audit_users");
    let source = finalize_schema_snapshot(source).unwrap();
    let target = finalize_schema_snapshot(target).unwrap();

    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    let change = plan
        .changes
        .iter()
        .find(|change| change.relation_name == "audit_users")
        .expect("view creation should be planned");

    assert!(change.manual_review);
    assert!(change.sql[0].contains("CREATE VIEW"));
    assert!(plan.warnings.iter().any(|warning| {
        warning.contains("out-of-scope PostgreSQL relation")
            && warning.contains("audit.events")
            && warning.contains("shared.users")
    }));
}

#[test]
fn postgres_schema_reference_rewrite_preserves_literals_and_comments() {
    let input = "SELECT * FROM source.users -- source.audit\nWHERE note = 'source.users' AND id = nextval('source.users_id_seq'::regclass) AND \"source\".kind = 'x'";
    assert_eq!(
            rewrite_postgres_schema_qualified_references(input, "source", "target"),
            "SELECT * FROM \"target\".users -- source.audit\nWHERE note = 'source.users' AND id = nextval('\"target\".users_id_seq'::regclass) AND \"target\".kind = 'x'"
        );
}

#[test]
fn postgres_schema_reference_rewrite_preserves_dollar_quoted_routine_bodies() {
    let input = "CREATE FUNCTION source.fn() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN RAISE NOTICE 'source.users'; PERFORM source.dynamic_sql; END $body$; SELECT * FROM source.users";
    assert_eq!(
            rewrite_postgres_schema_qualified_references(input, "source", "target"),
            "CREATE FUNCTION \"target\".fn() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN RAISE NOTICE 'source.users'; PERFORM source.dynamic_sql; END $body$; SELECT * FROM \"target\".users"
        );
}
