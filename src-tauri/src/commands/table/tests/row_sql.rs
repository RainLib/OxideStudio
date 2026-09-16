use super::*;

#[test]
fn json_preflight_reports_unmappable_rows_without_exposing_values() {
    let columns = column_lookup(vec![target_column("id")]);
    let mut total_rows = 0_u64;
    let mut accepted_rows = 0_u64;
    let mut rejected_rows = 0_u64;
    let mut issues = Vec::new();
    observe_json_import_preflight_row(
        7,
        [("id".to_string(), json!(1))].into_iter().collect(),
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        JsonImportPreflightCounters {
            total_rows: &mut total_rows,
            accepted_rows: &mut accepted_rows,
            rejected_rows: &mut rejected_rows,
            issues: &mut issues,
        },
    )
    .unwrap();
    observe_json_import_preflight_row(
        8,
        [("unknown".to_string(), json!("private value"))]
            .into_iter()
            .collect(),
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        JsonImportPreflightCounters {
            total_rows: &mut total_rows,
            accepted_rows: &mut accepted_rows,
            rejected_rows: &mut rejected_rows,
            issues: &mut issues,
        },
    )
    .unwrap();

    assert_eq!((total_rows, accepted_rows, rejected_rows), (2, 1, 1));
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].row_number, 8);
    assert_eq!(issues[0].code, "ROW_INVALID");
}

#[test]
fn data_transfer_upsert_uses_explicit_target_primary_key() {
    let mut id = target_column("id");
    id.is_primary_key = true;
    id.is_nullable = false;
    let columns = column_lookup(vec![id, target_column("display_name")]);
    let values = BTreeMap::from([
        ("id".to_string(), serde_json::json!(7)),
        ("display_name".to_string(), serde_json::json!("Ada")),
    ]);
    let keys = vec!["id".to_string()];

    let (postgres, postgres_params) = build_upsert_mutation(
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        &values,
        &keys,
    )
    .unwrap();
    assert!(postgres.contains("ON CONFLICT (\"id\") DO UPDATE SET"));
    assert!(postgres.contains("\"display_name\" = EXCLUDED.\"display_name\""));
    assert_eq!(postgres_params.len(), 2);

    let (mysql, mysql_params) = build_upsert_mutation(
        DatabaseKind::Mysql,
        "app",
        "users",
        &columns,
        &values,
        &keys,
    )
    .unwrap();
    assert!(mysql.contains("ON DUPLICATE KEY UPDATE"));
    assert!(mysql.contains("`display_name` = VALUES(`display_name`)"));
    assert_eq!(mysql_params.len(), 2);
}

#[test]
fn gauss_transfer_column_policy_leaves_only_safe_names_unquoted() {
    assert_eq!(
        transfer_column_identifier(DatabaseKind::Postgres, "USER_ID", false),
        "USER_ID"
    );
    assert_eq!(
        transfer_column_identifier(DatabaseKind::Postgres, "CamelName", false),
        "CamelName"
    );
    assert_eq!(
        transfer_column_identifier(DatabaseKind::Postgres, "select", false),
        "\"select\""
    );
    assert_eq!(
        transfer_column_identifier(DatabaseKind::Postgres, "has space", false),
        "\"has space\""
    );
    assert_eq!(
        transfer_column_identifier(DatabaseKind::Postgres, "USER_ID", true),
        "\"USER_ID\""
    );
    assert_eq!(
        transfer_column_identifier(DatabaseKind::Mysql, "USER_ID", false),
        "`USER_ID`"
    );
}

#[test]
fn gauss_transfer_insert_and_upsert_share_the_column_policy() {
    let mut id = target_column("USER_ID");
    id.is_primary_key = true;
    id.is_nullable = false;
    let columns = column_lookup(vec![
        id,
        target_column("CamelName"),
        target_column("select"),
    ]);
    let values = BTreeMap::from([
        ("USER_ID".to_string(), serde_json::json!(7)),
        ("CamelName".to_string(), serde_json::json!("Ada")),
        ("select".to_string(), serde_json::json!("safe")),
    ]);

    let (insert, insert_params) = build_insert_mutation_with_column_quoting(
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        &values,
        false,
    )
    .unwrap();
    assert!(insert.contains("CamelName"), "sql: {insert}");
    assert!(insert.contains("USER_ID"), "sql: {insert}");
    assert!(insert.contains("\"select\""), "sql: {insert}");
    assert!(!insert.contains("\"CamelName\""), "sql: {insert}");
    assert_eq!(insert_params.len(), 3);

    let (upsert, upsert_params) = build_upsert_mutation_with_column_quoting(
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        &values,
        &["USER_ID".to_string()],
        false,
    )
    .unwrap();
    assert!(upsert.contains("ON CONFLICT (USER_ID)"), "sql: {upsert}");
    assert!(
        upsert.contains("CamelName = EXCLUDED.CamelName"),
        "sql: {upsert}"
    );
    assert!(
        upsert.contains("\"select\" = EXCLUDED.\"select\""),
        "sql: {upsert}"
    );
    assert_eq!(upsert_params.len(), 3);
}

#[test]
fn data_transfer_upsert_rejects_an_unmapped_key() {
    let mut id = target_column("id");
    id.is_primary_key = true;
    id.is_nullable = false;
    let columns = column_lookup(vec![id, target_column("display_name")]);
    let values = BTreeMap::from([("display_name".to_string(), serde_json::json!("Ada"))]);

    let error = build_upsert_mutation(
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        &values,
        &["id".to_string()],
    )
    .unwrap_err();
    assert!(error.contains("Upsert key column id is not mapped"));
}

#[test]
fn builds_mysql_insert_with_parameter_placeholders() {
    let columns = column_lookup(vec![ColumnInfo {
        name: "name".to_string(),
        data_type: "varchar".to_string(),
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
    let mut values = BTreeMap::new();
    values.insert("name".to_string(), json!("Ada"));

    let (sql, params) =
        build_insert_mutation(DatabaseKind::Mysql, "app", "users", &columns, &values).unwrap();

    assert_eq!(sql, "INSERT INTO `app`.`users` (`name`) VALUES (?);");
    assert_eq!(params.len(), 1);
    assert_eq!(params[0].data_type.as_deref(), Some("varchar"));
}

#[test]
fn insert_builder_rechecks_required_columns_before_any_batch_is_created() {
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
            name: "id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: true,
            is_unique: true,
            is_indexed: true,
            default_value: None,
            is_auto_increment: true,
            identity_generation: None,
            comment: None,
            is_generated: Some(false),
            is_hidden: Some(false),
        },
        ColumnInfo {
            name: "status".to_string(),
            data_type: "text".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: Some("'pending'".to_string()),
            is_auto_increment: false,
            identity_generation: None,
            comment: None,
            is_generated: Some(false),
            is_hidden: Some(false),
        },
    ]);

    let error = build_insert_mutation(
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        &BTreeMap::new(),
    )
    .unwrap_err();
    assert!(error.contains("Required column email"));

    let null_email = BTreeMap::from([("email".to_string(), Value::Null)]);
    let error = build_insert_mutation(
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        &null_email,
    )
    .unwrap_err();
    assert!(error.contains("email cannot be NULL"));

    let values = BTreeMap::from([("email".to_string(), json!("ada@example.test"))]);
    assert!(
        build_insert_mutation(DatabaseKind::Postgres, "public", "users", &columns, &values,)
            .is_ok()
    );
}

#[test]
fn builds_default_values_inserts_for_empty_rows() {
    let columns = BTreeMap::new();
    let values = BTreeMap::new();

    let (postgres_sql, postgres_params) = build_insert_mutation(
        DatabaseKind::Postgres,
        "public",
        "events",
        &columns,
        &values,
    )
    .unwrap();
    assert_eq!(
        postgres_sql,
        r#"INSERT INTO "public"."events" DEFAULT VALUES;"#
    );
    assert!(postgres_params.is_empty());

    let (mysql_sql, mysql_params) =
        build_insert_mutation(DatabaseKind::Mysql, "app", "events", &columns, &values).unwrap();
    assert_eq!(mysql_sql, "INSERT INTO `app`.`events` () VALUES ();");
    assert!(mysql_params.is_empty());
}

#[test]
fn builds_postgres_update_with_casted_parameters() {
    let columns = column_lookup(vec![
        ColumnInfo {
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
        },
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
    ]);
    let mut key = BTreeMap::new();
    key.insert("id".to_string(), json!(7));
    let mut values = BTreeMap::new();
    values.insert("email".to_string(), json!("ada@example.test"));

    let (sql, params) = build_update_mutation(
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        &TableRowUpdate {
            key,
            values,
            expressions: BTreeMap::new(),
        },
    )
    .unwrap();

    assert_eq!(
        sql,
        r#"UPDATE "public"."users" SET "email" = $1::text WHERE "id" = $2::integer;"#
    );
    assert_eq!(params.len(), 2);
}

#[test]
fn builds_table_update_with_an_explicit_validated_expression() {
    let mut columns = column_lookup(vec![
        ColumnInfo {
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
        },
        ColumnInfo {
            name: "updated_at".to_string(),
            data_type: "timestamp".to_string(),
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
    let update = TableRowUpdate {
        key: BTreeMap::from([("id".to_string(), json!(7))]),
        values: BTreeMap::new(),
        expressions: BTreeMap::from([("updated_at".to_string(), "CURRENT_TIMESTAMP".to_string())]),
    };

    let (sql, params) =
        build_update_mutation(DatabaseKind::Postgres, "public", "users", &columns, &update)
            .unwrap();
    assert_eq!(
        sql,
        r#"UPDATE "public"."users" SET "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1::integer;"#
    );
    assert_eq!(params.len(), 1);

    let unsafe_update = TableRowUpdate {
        expressions: BTreeMap::from([(
            "updated_at".to_string(),
            "CURRENT_TIMESTAMP; DELETE FROM users".to_string(),
        )]),
        ..update
    };
    assert!(build_update_mutation(
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        &unsafe_update,
    )
    .unwrap_err()
    .contains("statement separators"));

    let mut generated = columns["updated_at"].clone();
    generated.is_generated = Some(true);
    columns.insert("updated_at".to_string(), generated);
    let generated_error = build_update_mutation(
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        &TableRowUpdate {
            key: BTreeMap::from([("id".to_string(), json!(7))]),
            values: BTreeMap::from([("updated_at".to_string(), json!("2026-01-01"))]),
            expressions: BTreeMap::new(),
        },
    )
    .unwrap_err();
    assert!(generated_error.contains("Generated column updated_at cannot be written"));

    let mut hidden = columns["updated_at"].clone();
    hidden.is_generated = Some(false);
    hidden.is_hidden = Some(true);
    columns.insert("updated_at".to_string(), hidden);
    let hidden_error = build_update_mutation(
        DatabaseKind::Postgres,
        "public",
        "users",
        &columns,
        &TableRowUpdate {
            key: BTreeMap::from([("id".to_string(), json!(7))]),
            values: BTreeMap::new(),
            expressions: BTreeMap::from([(
                "updated_at".to_string(),
                "CURRENT_TIMESTAMP".to_string(),
            )]),
        },
    )
    .unwrap_err();
    assert!(hidden_error.contains("Hidden column updated_at cannot be written"));
}

#[test]
fn builds_postgres_structured_filter_with_parameters() {
    let columns = column_lookup(vec![
        ColumnInfo {
            name: "name".to_string(),
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
        },
    ]);

    let (where_clause, params) = build_structured_filter_where(
        DatabaseKind::Postgres,
        &columns,
        &[
            TableFilter {
                column: "name".to_string(),
                operator: "contains".to_string(),
                value: "A%_".to_string(),
                logic: None,
            },
            TableFilter {
                column: "id".to_string(),
                operator: ">=".to_string(),
                value: "7".to_string(),
                logic: Some("AND".to_string()),
            },
        ],
    )
    .unwrap();

    assert_eq!(
        where_clause,
        r#"CAST("name" AS text) LIKE $1::text ESCAPE '=' AND "id" >= $2::integer"#
    );
    assert_eq!(params.len(), 2);
    assert_eq!(params[0].value, json!("%A=%=_%"));
    assert_eq!(params[1].data_type.as_deref(), Some("integer"));
}

#[test]
fn builds_mysql_structured_filter_with_parameters() {
    let columns = column_lookup(vec![ColumnInfo {
        name: "email".to_string(),
        data_type: "varchar".to_string(),
        is_nullable: false,
        is_primary_key: false,
        is_unique: false,
        is_indexed: true,
        default_value: None,
        is_auto_increment: false,
        identity_generation: None,
        comment: None,
        is_generated: Some(false),
        is_hidden: Some(false),
    }]);

    let (where_clause, params) = build_structured_filter_where(
        DatabaseKind::Mysql,
        &columns,
        &[TableFilter {
            column: "email".to_string(),
            operator: "startsWith".to_string(),
            value: "ops".to_string(),
            logic: None,
        }],
    )
    .unwrap();

    assert_eq!(where_clause, "CAST(`email` AS CHAR) LIKE ? ESCAPE '='");
    assert_eq!(params.len(), 1);
    assert_eq!(params[0].value, json!("ops%"));
}

#[test]
fn rejects_unknown_structured_filter_parts() {
    let columns = column_lookup(vec![ColumnInfo {
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

    assert!(build_structured_filter_where(
        DatabaseKind::Postgres,
        &columns,
        &[TableFilter {
            column: "missing".to_string(),
            operator: "equals".to_string(),
            value: "1".to_string(),
            logic: None,
        }],
    )
    .is_err());

    assert!(build_structured_filter_where(
        DatabaseKind::Postgres,
        &columns,
        &[TableFilter {
            column: "id".to_string(),
            operator: "regexp".to_string(),
            value: "1".to_string(),
            logic: None,
        }],
    )
    .is_err());
}

#[test]
fn builds_safe_table_order_by_clause() {
    let columns = column_lookup(vec![ColumnInfo {
        name: "created_at".to_string(),
        data_type: "timestamp".to_string(),
        is_nullable: false,
        is_primary_key: false,
        is_unique: false,
        is_indexed: true,
        default_value: None,
        is_auto_increment: false,
        identity_generation: None,
        comment: None,
        is_generated: Some(false),
        is_hidden: Some(false),
    }]);

    let order = build_table_order_by(
        DatabaseKind::Postgres,
        &columns,
        Some(&TableSort {
            column: "created_at".to_string(),
            direction: "desc".to_string(),
        }),
    )
    .unwrap();

    assert_eq!(order.as_deref(), Some(r#""created_at" DESC"#));
    assert!(build_table_order_by(
        DatabaseKind::Mysql,
        &columns,
        Some(&TableSort {
            column: "missing".to_string(),
            direction: "asc".to_string(),
        }),
    )
    .is_err());
    assert!(build_table_order_by(
        DatabaseKind::Mysql,
        &columns,
        Some(&TableSort {
            column: "created_at".to_string(),
            direction: "sideways".to_string(),
        }),
    )
    .is_err());

    let stable_columns = column_lookup(vec![
        ColumnInfo {
            name: "tenant_id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: true,
            is_unique: false,
            is_indexed: true,
            default_value: None,
            is_auto_increment: false,
            identity_generation: None,
            comment: None,
            is_generated: Some(false),
            is_hidden: Some(false),
        },
        ColumnInfo {
            name: "id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: true,
            is_unique: false,
            is_indexed: true,
            default_value: None,
            is_auto_increment: false,
            identity_generation: None,
            comment: None,
            is_generated: Some(false),
            is_hidden: Some(false),
        },
        ColumnInfo {
            name: "created_at".to_string(),
            data_type: "timestamp".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: true,
            default_value: None,
            is_auto_increment: false,
            identity_generation: None,
            comment: None,
            is_generated: Some(false),
            is_hidden: Some(false),
        },
    ]);
    assert_eq!(
        build_table_order_by(DatabaseKind::Postgres, &stable_columns, None)
            .unwrap()
            .as_deref(),
        Some(r#""id" ASC, "tenant_id" ASC"#)
    );
    assert_eq!(
        build_table_order_by(
            DatabaseKind::Postgres,
            &stable_columns,
            Some(&TableSort {
                column: "created_at".to_string(),
                direction: "desc".to_string(),
            }),
        )
        .unwrap()
        .as_deref(),
        Some(r#""created_at" DESC, "id" ASC, "tenant_id" ASC"#)
    );
}

#[test]
fn summarizes_mutation_affected_by_statement_group() {
    let summary = summarize_mutation_affected(&[1, 1, 3, 2], 2, 1, 1);

    assert_eq!(summary.inserted, 2);
    assert_eq!(summary.updated, 3);
    assert_eq!(summary.deleted, 2);
    assert_eq!(summary.rows_affected, 7);
}

#[test]
fn full_data_compare_requires_a_declared_unique_key() {
    let mut id = target_column("id");
    id.is_nullable = false;
    id.is_primary_key = true;
    let tenant = target_column("tenant_id");
    let columns = column_lookup(vec![id, tenant]);
    assert!(data_compare_key_columns_are_declared_unique(
        &columns,
        &["id".to_string()]
    ));
    assert!(data_compare_key_columns_are_declared_unique(
        &columns,
        &["tenant_id".to_string(), "id".to_string()]
    ));
    assert!(!data_compare_key_columns_are_declared_unique(
        &columns,
        &["tenant_id".to_string()]
    ));
}
