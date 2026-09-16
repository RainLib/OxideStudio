use super::*;

#[test]
fn batch_transfer_plan_orders_acyclic_tables_and_keeps_cycles_deterministic() {
    let request = TableDataTransferBatchPlanRequest {
        source_connection_id: "source".to_string(),
        source_driver: "postgres".to_string(),
        source_database: None,
        source_schema: "public".to_string(),
        target_connection_id: "target".to_string(),
        target_driver: "postgres".to_string(),
        target_database: None,
        target_schema: "public".to_string(),
        tables: vec!["orders".to_string(), "users".to_string()],
        objects: Vec::new(),
        mode: TableDataTransferMode::Append,
        max_rows: None,
        batch_size: None,
        reseed_identity: false,
        quote_target_column_names: true,
        restore_source_schema_objects: false,
    };
    let users = ConstraintInfo {
        name: "users_pkey".to_string(),
        constraint_type: "PRIMARY KEY".to_string(),
        columns: vec!["id".to_string()],
        referenced_schema: None,
        referenced_table: None,
        referenced_columns: Vec::new(),
        definition: None,
        on_update: None,
        on_delete: None,
    };
    let order_user_fk = ConstraintInfo {
        name: "orders_user_fk".to_string(),
        constraint_type: "FOREIGN KEY".to_string(),
        columns: vec!["user_id".to_string()],
        referenced_schema: Some("public".to_string()),
        referenced_table: Some("users".to_string()),
        referenced_columns: vec!["id".to_string()],
        definition: None,
        on_update: None,
        on_delete: None,
    };
    let plan = table_data_transfer_batch_plan(
        &request,
        &request.tables,
        &[
            ("orders".to_string(), vec![order_user_fk.clone()]),
            ("users".to_string(), vec![users]),
        ],
    )
    .unwrap();
    assert_eq!(plan.ordered_tables, vec!["users", "orders"]);
    assert!(plan.cyclic_tables.is_empty());
    assert!(plan.can_execute);
    assert!(plan.table_preflights.is_empty());
    assert_eq!(plan.dependencies[0].constraint_name, "orders_user_fk");

    let cycle = table_data_transfer_batch_plan(
        &request,
        &request.tables,
        &[
            ("orders".to_string(), vec![order_user_fk]),
            (
                "users".to_string(),
                vec![ConstraintInfo {
                    name: "users_order_fk".to_string(),
                    constraint_type: "FOREIGN KEY".to_string(),
                    columns: vec!["default_order_id".to_string()],
                    referenced_schema: Some("public".to_string()),
                    referenced_table: Some("orders".to_string()),
                    referenced_columns: vec!["id".to_string()],
                    definition: None,
                    on_update: None,
                    on_delete: None,
                }],
            ),
        ],
    )
    .unwrap();
    assert_eq!(cycle.ordered_tables, vec!["orders", "users"]);
    assert_eq!(cycle.cyclic_tables, vec!["orders", "users"]);
    assert!(cycle.can_execute);

    let deferred = HashMap::from([
        (
            "orders".to_string(),
            HashSet::from(["orders_user_fk".to_string()]),
        ),
        (
            "users".to_string(),
            HashSet::from(["users_order_fk".to_string()]),
        ),
    ]);
    assert!(missing_deferred_cycle_foreign_keys(&cycle, &deferred).is_empty());

    let incomplete = HashMap::from([(
        "orders".to_string(),
        HashSet::from(["orders_user_fk".to_string()]),
    )]);
    assert_eq!(
        missing_deferred_cycle_foreign_keys(&cycle, &incomplete),
        vec!["users.users_order_fk"]
    );
}
