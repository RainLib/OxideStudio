use super::*;

#[test]
fn schema_object_transfer_selection_is_bounded_and_parent_scoped() {
    let triggers = normalized_table_data_transfer_objects(&[
        TableDataTransferObjectSelection {
            object_type: TableDataTransferObjectKind::Trigger,
            name: "audit".to_string(),
            parent_name: Some("users".to_string()),
        },
        TableDataTransferObjectSelection {
            object_type: TableDataTransferObjectKind::Trigger,
            name: "audit".to_string(),
            parent_name: Some("orders".to_string()),
        },
    ])
    .unwrap();
    assert_eq!(triggers.len(), 2);
    assert!(normalized_table_data_transfer_objects(&[
        TableDataTransferObjectSelection {
            object_type: TableDataTransferObjectKind::View,
            name: "Active_Users".to_string(),
            parent_name: None,
        },
        TableDataTransferObjectSelection {
            object_type: TableDataTransferObjectKind::View,
            name: "active_users".to_string(),
            parent_name: None,
        },
    ])
    .unwrap_err()
    .contains("duplicate"));
}

#[test]
fn schema_object_transfer_builds_reviewed_postgres_view_and_sequence_ddl() {
    let source = transfer_object_snapshot(
            "source",
            "app",
            vec![
                transfer_object_relation("users", "BASE TABLE", None, &[]),
                transfer_object_relation(
                    "active_users",
                    "VIEW",
                    Some("SELECT id FROM app.users"),
                    &["users"],
                ),
            ],
            Vec::new(),
            vec![SchemaObjectSnapshot {
                name: "users_id_seq".to_string(),
                object_type: "SEQUENCE".to_string(),
                parent_name: None,
                description: None,
                definition: Some(
                    "CREATE SEQUENCE app.users_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;"
                        .to_string(),
                ),
                sequence_owner: Some(SchemaSequenceOwnerSnapshot {
                    table_name: "users".to_string(),
                    column_name: "id".to_string(),
                }),
                sequence_last_value: Some("41".to_string()),
                sequence_is_called: Some(true),
                dependencies: Vec::new(),
            }],
        );
    let target = transfer_object_snapshot(
        "target",
        "archive",
        vec![transfer_object_relation("users", "BASE TABLE", None, &[])],
        Vec::new(),
        Vec::new(),
    );
    let selections = vec![
        TableDataTransferObjectSelection {
            object_type: TableDataTransferObjectKind::Sequence,
            name: "users_id_seq".to_string(),
            parent_name: None,
        },
        TableDataTransferObjectSelection {
            object_type: TableDataTransferObjectKind::View,
            name: "active_users".to_string(),
            parent_name: None,
        },
    ];

    let plan = build_table_data_transfer_object_plan(&source, &target, &selections).unwrap();

    assert_eq!(plan.preflights.len(), 2);
    assert!(plan
        .preflights
        .iter()
        .all(|preflight| preflight.can_execute));
    let view = plan
        .preflights
        .iter()
        .find(|preflight| preflight.name == "active_users")
        .unwrap();
    assert_eq!(view.action, TableDataTransferObjectAction::Create);
    assert_eq!(view.depends_on, vec!["RELATION:users"]);
    assert!(view
        .statements
        .iter()
        .any(|sql| sql.contains("CREATE VIEW \"archive\".\"active_users\"")));
    let sequence = plan
        .preflights
        .iter()
        .find(|preflight| preflight.name == "users_id_seq")
        .unwrap();
    assert!(sequence
        .statements
        .iter()
        .any(|sql| sql.contains("CREATE SEQUENCE")
            && sql.contains("archive")
            && sql.contains("users_id_seq")));
    assert!(sequence
        .statements
        .iter()
        .any(|sql| sql.contains("OWNED BY \"archive\".\"users\".\"id\"")));
    assert!(sequence
        .statements
        .iter()
        .any(|sql| sql.contains("setval") && sql.contains("41")));
    assert_eq!(
        plan.statements.len(),
        view.statements.len() + sequence.statements.len()
    );
}

#[test]
fn schema_object_transfer_skips_existing_and_blocks_unproven_dependencies() {
    let existing_view = transfer_object_relation(
        "active_users",
        "VIEW",
        Some("SELECT id FROM app.users"),
        &["users"],
    );
    let source = transfer_object_snapshot(
            "source",
            "app",
            vec![
                transfer_object_relation("users", "BASE TABLE", None, &[]),
                existing_view.clone(),
            ],
            Vec::new(),
            vec![SchemaObjectSnapshot {
                name: "audit".to_string(),
                object_type: "TRIGGER".to_string(),
                parent_name: Some("users".to_string()),
                description: None,
                definition: Some(
                    "CREATE TRIGGER audit BEFORE UPDATE ON app.users FOR EACH ROW EXECUTE FUNCTION app.touch()"
                        .to_string(),
                ),
                sequence_owner: None,
                sequence_last_value: None,
                sequence_is_called: None,
                dependencies: vec!["touch".to_string()],
            }],
        );
    let target = transfer_object_snapshot(
        "target",
        "archive",
        vec![
            transfer_object_relation("users", "BASE TABLE", None, &[]),
            existing_view,
        ],
        Vec::new(),
        Vec::new(),
    );
    let plan = build_table_data_transfer_object_plan(
        &source,
        &target,
        &[
            TableDataTransferObjectSelection {
                object_type: TableDataTransferObjectKind::View,
                name: "active_users".to_string(),
                parent_name: None,
            },
            TableDataTransferObjectSelection {
                object_type: TableDataTransferObjectKind::Trigger,
                name: "audit".to_string(),
                parent_name: Some("users".to_string()),
            },
        ],
    )
    .unwrap();

    let existing = plan
        .preflights
        .iter()
        .find(|preflight| preflight.name == "active_users")
        .unwrap();
    assert_eq!(existing.action, TableDataTransferObjectAction::SkipExisting);
    let trigger = plan
        .preflights
        .iter()
        .find(|preflight| preflight.name == "audit")
        .unwrap();
    assert_eq!(trigger.action, TableDataTransferObjectAction::Blocked);
    assert!(trigger
        .warnings
        .iter()
        .any(|warning| warning.contains("touch")));
    assert!(plan.statements.is_empty());
}
