use super::*;

#[test]
fn transfer_target_sqlite_identity_requires_integer_primary_key() {
    let mut supported = target_column("id");
    supported.data_type = "integer".to_string();
    supported.is_primary_key = true;
    supported.is_auto_increment = true;
    let retained = build_transfer_target_columns(&[supported], "sqlite", "sqlite").unwrap();
    assert!(retained.columns[0].identity_retained);
    assert!(retained.create_columns[0].is_auto_increment);
    let sqlite_ddl =
        build_sqlite_create_table_statements("main", "events_copy", &retained.create_columns)
            .unwrap();
    assert!(sqlite_ddl
        .join("\n")
        .to_ascii_uppercase()
        .contains("INTEGER PRIMARY KEY AUTOINCREMENT"));

    let mut invalid = target_column("sequence_value");
    invalid.data_type = "integer".to_string();
    invalid.is_auto_increment = true;
    let materialized = build_transfer_target_columns(&[invalid], "sqlite", "sqlite").unwrap();
    assert!(!materialized.columns[0].identity_retained);
    assert!(!materialized.create_columns[0].is_auto_increment);

    let mut composite_identity = target_column("tenant_id");
    composite_identity.data_type = "integer".to_string();
    composite_identity.is_primary_key = true;
    composite_identity.is_auto_increment = true;
    let mut composite_key = target_column("event_id");
    composite_key.data_type = "integer".to_string();
    composite_key.is_primary_key = true;
    let composite =
        build_transfer_target_columns(&[composite_identity, composite_key], "sqlite", "sqlite")
            .unwrap();
    assert!(!composite.columns[0].identity_retained);
    assert!(!composite.create_columns[0].is_auto_increment);
    assert!(
        build_sqlite_create_table_statements("main", "events_copy", &composite.create_columns,)
            .is_ok()
    );
}

#[test]
fn sqlite_table_ddl_builders_use_native_syntax_and_guard_unsupported_forms() {
    let id = CreateTableColumn {
        name: "id".to_string(),
        data_type: "INTEGER".to_string(),
        length: None,
        is_primary_key: true,
        is_not_null: true,
        is_auto_increment: true,
        comment: None,
    };
    let email = CreateTableColumn {
        name: "email".to_string(),
        data_type: "TEXT".to_string(),
        length: None,
        is_primary_key: false,
        is_not_null: true,
        is_auto_increment: false,
        comment: None,
    };
    assert_eq!(
            build_sqlite_create_table_statements("main", "users", &[id.clone(), email.clone()])
                .unwrap(),
            vec![
                "CREATE TABLE \"main\".\"users\" (\n  \"id\" INTEGER PRIMARY KEY AUTOINCREMENT,\n  \"email\" TEXT NOT NULL\n);"
                    .to_string(),
            ],
        );
    assert_eq!(
        build_sqlite_add_column_statements("main", "users", &email).unwrap(),
        vec!["ALTER TABLE \"main\".\"users\" ADD COLUMN \"email\" TEXT NOT NULL;".to_string()],
    );
    assert_eq!(
        build_sqlite_drop_column_statement("main", "users", "legacy").unwrap(),
        "ALTER TABLE \"main\".\"users\" DROP COLUMN \"legacy\";"
    );
    let columns = column_lookup(vec![ColumnInfo {
        name: "email".to_string(),
        data_type: "TEXT".to_string(),
        is_nullable: false,
        is_primary_key: false,
        is_unique: false,
        is_indexed: false,
        default_value: None,
        is_auto_increment: false,
        identity_generation: None,
        comment: None,
        is_generated: Some(false),
        is_hidden: Some(false),
    }]);
    assert_eq!(
        build_sqlite_create_index_statement(
            "main",
            "users",
            "users_email_idx",
            &["email".to_string()],
            &columns,
            true,
        )
        .unwrap(),
        "CREATE UNIQUE INDEX \"main\".\"users_email_idx\" ON \"main\".\"users\" (\"email\");"
    );
    assert_eq!(
        build_sqlite_drop_index_statement("main", "users", "users_email_idx").unwrap(),
        "DROP INDEX \"main\".\"users_email_idx\";"
    );

    let invalid_autoincrement = CreateTableColumn {
        data_type: "TEXT".to_string(),
        ..id
    };
    assert!(build_sqlite_create_table_statements("main", "bad", &[invalid_autoincrement]).is_err());
}
