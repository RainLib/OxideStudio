use super::*;

#[test]
fn builds_create_index_statement_with_existing_columns() {
    let columns = column_lookup(vec![
        ColumnInfo {
            name: "email".to_string(),
            data_type: "text".to_string(),
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
        },
        ColumnInfo {
            name: "tenant_id".to_string(),
            data_type: "integer".to_string(),
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
        },
    ]);

    assert_eq!(
        build_create_table_index_statement(
            DatabaseKind::Postgres,
            "public",
            "users",
            "users_email_idx",
            &["email".to_string()],
            &columns,
            true,
        )
        .unwrap(),
        r#"CREATE UNIQUE INDEX "users_email_idx" ON "public"."users" ("email");"#
    );
    assert_eq!(
        build_create_table_index_statement(
            DatabaseKind::Mysql,
            "app",
            "users",
            "users_tenant_email_idx",
            &["tenant_id".to_string(), "email".to_string()],
            &columns,
            false,
        )
        .unwrap(),
        "CREATE INDEX `users_tenant_email_idx` ON `app`.`users` (`tenant_id`, `email`);"
    );
}

#[test]
fn rejects_create_index_for_unknown_columns() {
    let columns = column_lookup(vec![ColumnInfo {
        name: "email".to_string(),
        data_type: "text".to_string(),
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

    assert!(build_create_table_index_statement(
        DatabaseKind::Postgres,
        "public",
        "users",
        "users_missing_idx",
        &["missing".to_string()],
        &columns,
        false,
    )
    .is_err());
}

#[test]
fn builds_drop_index_statement_per_driver() {
    assert_eq!(
        build_drop_table_index_statement(
            DatabaseKind::Postgres,
            "public",
            "users",
            "users_email_idx"
        )
        .unwrap(),
        r#"DROP INDEX "public"."users_email_idx";"#
    );
    assert_eq!(
        build_drop_table_index_statement(DatabaseKind::Mysql, "app", "users", "users_email_idx")
            .unwrap(),
        "DROP INDEX `users_email_idx` ON `app`.`users`;"
    );
    assert!(
        build_drop_table_index_statement(DatabaseKind::Mysql, "app", "users", "PRIMARY").is_err()
    );
}

#[test]
fn builds_rename_index_statement_per_driver() {
    let indexes = vec![
        IndexInfo {
            name: "users_email_idx".to_string(),
            columns: vec!["email".to_string()],
            is_unique: false,
            is_primary: false,
            filter: None,
            index_type: Some("btree".to_string()),
            included_columns: None,
            definition: None,
            comment: None,
            key_is_expression: Vec::new(),
        },
        IndexInfo {
            name: "users_pkey".to_string(),
            columns: vec!["id".to_string()],
            is_unique: true,
            is_primary: true,
            filter: None,
            index_type: Some("btree".to_string()),
            included_columns: None,
            definition: None,
            comment: None,
            key_is_expression: Vec::new(),
        },
    ];

    assert_eq!(
        build_rename_table_index_statement(
            DatabaseKind::Postgres,
            "public",
            "users",
            "users_email_idx",
            "users_login_email_idx",
            &indexes,
        )
        .unwrap(),
        r#"ALTER INDEX "public"."users_email_idx" RENAME TO "users_login_email_idx";"#
    );
    assert_eq!(
        build_rename_table_index_statement(
            DatabaseKind::Mysql,
            "app",
            "users",
            "users_email_idx",
            "users_login_email_idx",
            &indexes,
        )
        .unwrap(),
        "ALTER TABLE `app`.`users` RENAME INDEX `users_email_idx` TO `users_login_email_idx`;"
    );
    assert!(build_rename_table_index_statement(
        DatabaseKind::Postgres,
        "public",
        "users",
        "users_pkey",
        "users_id_idx",
        &indexes,
    )
    .is_err());
}

#[test]
fn builds_unique_constraint_statement_with_existing_columns() {
    let columns = column_lookup(vec![ColumnInfo {
        name: "email".to_string(),
        data_type: "text".to_string(),
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
        build_create_unique_constraint_statement(
            DatabaseKind::Postgres,
            "public",
            "users",
            "users_email_key",
            &["email".to_string()],
            &columns,
        )
        .unwrap(),
        r#"ALTER TABLE "public"."users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");"#
    );
}

#[test]
fn builds_primary_key_constraint_statement_with_existing_columns() {
    let columns = column_lookup(vec![ColumnInfo {
        name: "id".to_string(),
        data_type: "integer".to_string(),
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
        build_create_primary_key_statement(
            DatabaseKind::Postgres,
            "public",
            "users",
            "users_pkey",
            &["id".to_string()],
            &columns,
        )
        .unwrap(),
        r#"ALTER TABLE "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");"#
    );
}

#[test]
fn rejects_primary_key_constraint_on_nullable_columns() {
    let columns = column_lookup(vec![ColumnInfo {
        name: "id".to_string(),
        data_type: "integer".to_string(),
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
    }]);

    assert!(build_create_primary_key_statement(
        DatabaseKind::Mysql,
        "app",
        "users",
        "users_pkey",
        &["id".to_string()],
        &columns,
    )
    .is_err());
}

#[test]
fn builds_check_constraint_statement() {
    assert_eq!(
        build_create_check_constraint_statement(
            DatabaseKind::Mysql,
            "app",
            "orders",
            "orders_amount_check",
            "amount >= 0",
        )
        .unwrap(),
        "ALTER TABLE `app`.`orders` ADD CONSTRAINT `orders_amount_check` CHECK (amount >= 0);"
    );
    assert!(build_create_check_constraint_statement(
        DatabaseKind::Postgres,
        "public",
        "orders",
        "bad_check",
        "amount >= 0; DROP TABLE orders",
    )
    .is_err());
}

#[test]
fn builds_foreign_key_statement_with_referential_actions() {
    let local_columns = column_lookup(vec![ColumnInfo {
        name: "user_id".to_string(),
        data_type: "integer".to_string(),
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
    let referenced_columns = column_lookup(vec![ColumnInfo {
        name: "id".to_string(),
        data_type: "integer".to_string(),
        is_nullable: false,
        is_primary_key: true,
        is_unique: true,
        is_indexed: true,
        default_value: None,
        is_auto_increment: false,
        identity_generation: None,
        comment: None,
        is_generated: Some(false),
        is_hidden: Some(false),
    }]);

    assert_eq!(
            build_create_foreign_key_statement(
                DatabaseKind::Mysql,
                "app",
                "orders",
                "orders_user_id_fkey",
                &["user_id".to_string()],
                &local_columns,
                "app",
                "users",
                &["id".to_string()],
                &referenced_columns,
                Some("cascade"),
                Some("restrict"),
            )
            .unwrap(),
            "ALTER TABLE `app`.`orders` ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `app`.`users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT;"
        );
    assert!(build_create_foreign_key_statement(
        DatabaseKind::Postgres,
        "public",
        "orders",
        "orders_bad_fkey",
        &["user_id".to_string()],
        &local_columns,
        "public",
        "users",
        &["id".to_string(), "email".to_string()],
        &referenced_columns,
        None,
        None,
    )
    .is_err());
}

#[test]
fn builds_drop_constraint_statement_per_driver() {
    let foreign_key = ConstraintInfo {
        name: "orders_user_id_fkey".to_string(),
        constraint_type: "FOREIGN KEY".to_string(),
        columns: vec!["user_id".to_string()],
        referenced_schema: Some("public".to_string()),
        referenced_table: Some("users".to_string()),
        referenced_columns: vec!["id".to_string()],
        definition: None,
        on_update: None,
        on_delete: None,
    };
    let unique = ConstraintInfo {
        name: "users_email_key".to_string(),
        constraint_type: "UNIQUE".to_string(),
        columns: vec!["email".to_string()],
        referenced_schema: None,
        referenced_table: None,
        referenced_columns: vec![],
        definition: None,
        on_update: None,
        on_delete: None,
    };
    let primary = ConstraintInfo {
        name: "users_pkey".to_string(),
        constraint_type: "PRIMARY KEY".to_string(),
        columns: vec!["id".to_string()],
        referenced_schema: None,
        referenced_table: None,
        referenced_columns: vec![],
        definition: None,
        on_update: None,
        on_delete: None,
    };

    assert_eq!(
        build_drop_table_constraint_statement(
            DatabaseKind::Postgres,
            "public",
            "orders",
            &foreign_key
        )
        .unwrap(),
        r#"ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_user_id_fkey";"#
    );
    assert_eq!(
        build_drop_table_constraint_statement(DatabaseKind::Mysql, "app", "orders", &foreign_key)
            .unwrap(),
        "ALTER TABLE `app`.`orders` DROP FOREIGN KEY `orders_user_id_fkey`;"
    );
    assert_eq!(
        build_drop_table_constraint_statement(DatabaseKind::Mysql, "app", "users", &unique)
            .unwrap(),
        "ALTER TABLE `app`.`users` DROP INDEX `users_email_key`;"
    );
    assert_eq!(
        build_drop_table_constraint_statement(DatabaseKind::Postgres, "public", "users", &primary)
            .unwrap(),
        r#"ALTER TABLE "public"."users" DROP CONSTRAINT "users_pkey";"#
    );
    assert_eq!(
        build_drop_table_constraint_statement(DatabaseKind::Mysql, "app", "users", &primary)
            .unwrap(),
        "ALTER TABLE `app`.`users` DROP PRIMARY KEY;"
    );
}
