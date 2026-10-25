use super::*;

#[test]
fn transfer_schema_restore_orders_postgres_constraints_indexes_and_foreign_keys() {
    let source_constraints = vec![
        ConstraintInfo {
            name: "orders_email_key".to_string(),
            constraint_type: "UNIQUE".to_string(),
            columns: vec!["email".to_string()],
            referenced_schema: None,
            referenced_table: None,
            referenced_columns: Vec::new(),
            definition: Some("UNIQUE (email)".to_string()),
            on_update: None,
            on_delete: None,
        },
        ConstraintInfo {
            name: "orders_amount_check".to_string(),
            constraint_type: "CHECK".to_string(),
            columns: Vec::new(),
            referenced_schema: None,
            referenced_table: None,
            referenced_columns: Vec::new(),
            definition: Some("CHECK (amount > 0)".to_string()),
            on_update: None,
            on_delete: None,
        },
        ConstraintInfo {
            name: "orders_account_fk".to_string(),
            constraint_type: "FOREIGN KEY".to_string(),
            columns: vec!["account_id".to_string()],
            referenced_schema: Some("template".to_string()),
            referenced_table: Some("accounts".to_string()),
            referenced_columns: vec!["id".to_string()],
            definition: Some(
                "FOREIGN KEY (account_id) REFERENCES template.accounts(id) ON DELETE CASCADE"
                    .to_string(),
            ),
            on_update: Some("NO ACTION".to_string()),
            on_delete: Some("CASCADE".to_string()),
        },
    ];
    let source_indexes = vec![
            IndexInfo {
                name: "orders_email_key".to_string(),
                columns: vec!["email".to_string()],
                is_unique: true,
                is_primary: false,
                filter: None,
                index_type: Some("btree".to_string()),
                included_columns: None,
                definition: Some(
                    "CREATE UNIQUE INDEX orders_email_key ON template.orders USING btree (email)"
                        .to_string(),
                ),
                comment: None,
                key_is_expression: vec![false],
            },
            IndexInfo {
                name: "orders_lookup_idx".to_string(),
                columns: vec!["account_id".to_string()],
                is_unique: false,
                is_primary: false,
                filter: Some("status = 'open'::text".to_string()),
                index_type: Some("btree".to_string()),
                included_columns: Some(vec!["created_at".to_string()]),
                definition: Some(
                    "CREATE INDEX orders_lookup_idx ON template.orders USING btree (account_id) INCLUDE (created_at) WHERE status = 'open'::text"
                        .to_string(),
                ),
                comment: Some("open order lookup".to_string()),
                key_is_expression: vec![false],
            },
        ];

    let restore_plan = build_transfer_schema_restore_plan(
        DatabaseKind::Postgres,
        "template",
        "public",
        "orders",
        TransferTableSchemaObjects {
            indexes: &source_indexes,
            constraints: &source_constraints,
        },
        TransferTableSchemaObjects {
            indexes: &[],
            constraints: &[],
        },
    )
    .expect("reviewable PostgreSQL restoration");
    assert_eq!(
        restore_plan.deferred_foreign_key_names,
        vec!["orders_account_fk"]
    );
    assert_eq!(restore_plan.deferred_foreign_key_statements.len(), 1);
    assert_eq!(restore_plan.immediate_statements.len(), 4);
    let statements = restore_plan.statements;

    assert_eq!(statements.len(), 5);
    assert!(statements[0].contains("orders_email_key"));
    assert!(statements[1].contains("orders_amount_check"));
    assert!(statements[2].contains("CREATE INDEX orders_lookup_idx"));
    assert!(statements[2].contains("ON \"public\".orders"));
    assert!(statements[2].contains("INCLUDE (created_at)"));
    assert!(statements[2].contains("WHERE status = 'open'::text"));
    assert!(statements[3].contains("COMMENT ON INDEX \"public\".\"orders_lookup_idx\""));
    assert!(statements[4].contains("orders_account_fk"));
    assert!(statements[4].contains("REFERENCES \"public\".accounts"));
    assert_eq!(
        statements
            .iter()
            .filter(|statement| statement.contains("CREATE UNIQUE INDEX orders_email_key"))
            .count(),
        0,
        "the index backing a named constraint must not be restored twice"
    );
}

#[test]
fn transfer_schema_restore_preserves_mysql_foreign_key_actions_and_schema_mapping() {
    let source_constraints = vec![ConstraintInfo {
        name: "orders_account_fk".to_string(),
        constraint_type: "FOREIGN KEY".to_string(),
        columns: vec!["account_id".to_string()],
        referenced_schema: Some("template".to_string()),
        referenced_table: Some("accounts".to_string()),
        referenced_columns: vec!["id".to_string()],
        definition: None,
        on_update: Some("cascade".to_string()),
        on_delete: Some("set_null".to_string()),
    }];

    let restore_plan = build_transfer_schema_restore_plan(
        DatabaseKind::Mysql,
        "template",
        "app",
        "orders",
        TransferTableSchemaObjects {
            indexes: &[],
            constraints: &source_constraints,
        },
        TransferTableSchemaObjects {
            indexes: &[],
            constraints: &[],
        },
    )
    .expect("reviewable MySQL restoration");
    let statements = restore_plan.statements;

    assert_eq!(statements.len(), 1);
    assert!(statements[0].contains("ALTER TABLE `app`.`orders`"));
    assert!(statements[0].contains("REFERENCES `app`.`accounts` (`id`)"));
    assert!(statements[0].contains("ON DELETE SET NULL"));
    assert!(statements[0].contains("ON UPDATE CASCADE"));
}

#[test]
fn transfer_schema_restore_rejects_same_name_index_drift() {
    let source = IndexInfo {
        name: "orders_lookup_idx".to_string(),
        columns: vec!["account_id".to_string()],
        is_unique: false,
        is_primary: false,
        filter: None,
        index_type: Some("btree".to_string()),
        included_columns: None,
        definition: None,
        comment: None,
        key_is_expression: vec![false],
    };
    let target = IndexInfo {
        columns: vec!["customer_id".to_string()],
        ..source.clone()
    };

    let error = build_transfer_schema_restore_plan(
        DatabaseKind::Postgres,
        "public",
        "public",
        "orders",
        TransferTableSchemaObjects {
            indexes: &[source],
            constraints: &[],
        },
        TransferTableSchemaObjects {
            indexes: &[target],
            constraints: &[],
        },
    )
    .expect_err("same-name target drift must fail closed");

    assert!(error.contains("already exists with a different definition"));
}

#[test]
fn portable_schema_restore_maps_only_structured_btree_unique_and_foreign_keys() {
    let source_indexes = vec![IndexInfo {
        name: "orders_account_idx".to_string(),
        columns: vec!["account_id".to_string()],
        is_unique: false,
        is_primary: false,
        filter: None,
        index_type: Some("btree".to_string()),
        included_columns: None,
        definition: Some(
            "CREATE INDEX orders_account_idx ON public.orders USING btree (account_id)".to_string(),
        ),
        comment: None,
        key_is_expression: vec![false],
    }];
    let source_constraints = vec![
            ConstraintInfo {
                name: "orders_email_key".to_string(),
                constraint_type: "UNIQUE".to_string(),
                columns: vec!["email".to_string()],
                referenced_schema: None,
                referenced_table: None,
                referenced_columns: Vec::new(),
                definition: Some("UNIQUE (email)".to_string()),
                on_update: None,
                on_delete: None,
            },
            ConstraintInfo {
                name: "orders_account_fk".to_string(),
                constraint_type: "FOREIGN KEY".to_string(),
                columns: vec!["account_id".to_string()],
                referenced_schema: Some("public".to_string()),
                referenced_table: Some("accounts".to_string()),
                referenced_columns: vec!["id".to_string()],
                definition: Some(
                    "FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE ON UPDATE NO ACTION"
                        .to_string(),
                ),
                on_update: Some("NO ACTION".to_string()),
                on_delete: Some("CASCADE".to_string()),
            },
        ];
    let target_columns = ["id", "email", "account_id"]
        .into_iter()
        .map(|name| ColumnInfo {
            name: name.to_string(),
            data_type: "BIGINT".to_string(),
            is_nullable: true,
            is_primary_key: name == "id",
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            identity_generation: None,
            comment: None,
            is_generated: Some(false),
            is_hidden: Some(false),
            character_set: None,
            collation: None,
        })
        .collect::<Vec<_>>();

    let plan = build_portable_transfer_schema_restore_plan(
        DatabaseKind::Mysql,
        "public",
        "app",
        "orders",
        TransferTableSchemaObjects {
            indexes: &source_indexes,
            constraints: &source_constraints,
        },
        TransferTableSchemaObjects {
            indexes: &[],
            constraints: &[],
        },
        &target_columns,
    )
    .expect("portable PostgreSQL to MySQL schema objects");

    assert_eq!(plan.immediate_statements.len(), 2);
    assert_eq!(plan.deferred_foreign_key_names, ["orders_account_fk"]);
    assert!(plan.statements[0].contains("UNIQUE (`email`)"));
    assert!(plan.statements[1].contains("CREATE INDEX `orders_account_idx`"));
    assert!(plan.statements[1].contains("ON `app`.`orders` (`account_id`)"));
    assert!(plan.statements[2].contains("REFERENCES `app`.`accounts` (`id`)"));
    assert!(plan.statements[2].contains("ON DELETE CASCADE"));
}

#[test]
fn portable_schema_restore_fails_closed_for_dialect_specific_objects() {
    let target_columns = vec![ColumnInfo {
        name: "email".to_string(),
        data_type: "TEXT".to_string(),
        is_nullable: true,
        is_primary_key: false,
        is_unique: false,
        is_indexed: false,
        default_value: None,
        is_auto_increment: false,
        identity_generation: None,
        comment: None,
        is_generated: Some(false),
        is_hidden: Some(false),
        character_set: None,
        collation: None,
    }];
    let expression_index = IndexInfo {
        name: "orders_email_lower_idx".to_string(),
        columns: vec!["lower(email)".to_string()],
        is_unique: false,
        is_primary: false,
        filter: None,
        index_type: Some("btree".to_string()),
        included_columns: None,
        definition: Some(
            "CREATE INDEX orders_email_lower_idx ON orders (lower(email))".to_string(),
        ),
        comment: None,
        key_is_expression: vec![true],
    };
    let error = build_portable_transfer_schema_restore_plan(
        DatabaseKind::Mysql,
        "public",
        "app",
        "orders",
        TransferTableSchemaObjects {
            indexes: &[expression_index],
            constraints: &[],
        },
        TransferTableSchemaObjects {
            indexes: &[],
            constraints: &[],
        },
        &target_columns,
    )
    .expect_err("expression index must remain blocked");
    assert!(error.contains("expression key"));

    let check_constraint = ConstraintInfo {
        name: "orders_email_check".to_string(),
        constraint_type: "CHECK".to_string(),
        columns: vec!["email".to_string()],
        referenced_schema: None,
        referenced_table: None,
        referenced_columns: Vec::new(),
        definition: Some("CHECK (email <> ''::text)".to_string()),
        on_update: None,
        on_delete: None,
    };
    let error = build_portable_transfer_schema_restore_plan(
        DatabaseKind::Mysql,
        "public",
        "app",
        "orders",
        TransferTableSchemaObjects {
            indexes: &[],
            constraints: &[check_constraint],
        },
        TransferTableSchemaObjects {
            indexes: &[],
            constraints: &[],
        },
        &target_columns,
    )
    .expect_err("source-dialect CHECK must remain blocked");
    assert!(error.contains("source-dialect expression"));

    let lossy_unique = ConstraintInfo {
        name: "orders_email_key".to_string(),
        constraint_type: "UNIQUE".to_string(),
        columns: vec!["email".to_string()],
        referenced_schema: None,
        referenced_table: None,
        referenced_columns: Vec::new(),
        definition: Some("UNIQUE NULLS NOT DISTINCT (email)".to_string()),
        on_update: None,
        on_delete: None,
    };
    let error = build_portable_transfer_schema_restore_plan(
        DatabaseKind::Mysql,
        "public",
        "app",
        "orders",
        TransferTableSchemaObjects {
            indexes: &[],
            constraints: &[lossy_unique],
        },
        TransferTableSchemaObjects {
            indexes: &[],
            constraints: &[],
        },
        &target_columns,
    )
    .expect_err("NULLS NOT DISTINCT must not be weakened silently");
    assert!(error.contains("null, deferrability"));
}
