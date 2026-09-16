use super::*;

#[test]
fn exports_replayable_sql_insert_statements() {
    assert_eq!(
        sql_insert_statements(
            SqlInsertExportOptions {
                kind: DatabaseKind::Postgres,
                dialect: SqlExportDialect::Postgres,
                override_system_value: false,
                batch_rows: SQL_EXPORT_INSERT_BATCH_ROWS,
                conflict_policy: SqlInsertConflictPolicy::Strict,
                conflict_key_columns: &[],
                schema: "public",
                table: "users",
            },
            &[
                ColumnDef {
                    name: "id".to_string(),
                    data_type: "integer".to_string(),
                },
                ColumnDef {
                    name: "display name".to_string(),
                    data_type: "text".to_string(),
                },
            ],
            &[vec![json!(7), json!("O'Reilly")]],
        )
        .unwrap(),
        vec![
            r#"INSERT INTO "public"."users" ("id", "display name") VALUES
(7, 'O''Reilly');"#
        ]
    );
    assert_eq!(
        sql_insert_statements(
            SqlInsertExportOptions {
                kind: DatabaseKind::Mysql,
                dialect: SqlExportDialect::Mysql,
                override_system_value: false,
                batch_rows: SQL_EXPORT_INSERT_BATCH_ROWS,
                conflict_policy: SqlInsertConflictPolicy::Strict,
                conflict_key_columns: &[],
                schema: "app",
                table: "events",
            },
            &[
                ColumnDef {
                    name: "payload".to_string(),
                    data_type: "JSON".to_string(),
                },
                ColumnDef {
                    name: "active".to_string(),
                    data_type: "BOOLEAN".to_string(),
                },
            ],
            &[vec![json!({"kind": "login"}), json!(true)]],
        )
        .unwrap(),
        vec![
            r#"INSERT INTO `app`.`events` (`payload`, `active`) VALUES
('{"kind":"login"}', TRUE);"#
        ]
    );
}

#[test]
fn sql_export_filter_keeps_columns_and_values_aligned() {
    let columns = vec![
        ColumnDef {
            name: "id".to_string(),
            data_type: "integer".to_string(),
        },
        ColumnDef {
            name: "computed".to_string(),
            data_type: "integer".to_string(),
        },
        ColumnDef {
            name: "label".to_string(),
            data_type: "text".to_string(),
        },
    ];
    let excluded = HashSet::from(["computed".to_string()]);
    let (columns, rows) = filter_sql_export_batch(
        columns,
        vec![vec![json!(1), json!(2), json!("one")], vec![json!(3)]],
        &excluded,
    )
    .expect("filtered SQL batch");

    assert_eq!(
        columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["id", "label"]
    );
    assert_eq!(rows[0], vec![json!(1), json!("one")]);
    assert_eq!(rows[1], vec![json!(3), Value::Null]);

    assert!(filter_sql_export_batch(
        vec![ColumnDef {
            name: "computed".to_string(),
            data_type: "integer".to_string(),
        }],
        vec![vec![json!(2)]],
        &excluded,
    )
    .is_err());
}

#[test]
fn postgres_sql_export_overrides_always_identity_values_only_when_requested() {
    let columns = [ColumnDef {
        name: "id".to_string(),
        data_type: "bigint".to_string(),
    }];
    let rows = [vec![json!(42)]];

    let overridden = sql_insert_statements(
        SqlInsertExportOptions {
            kind: DatabaseKind::Postgres,
            dialect: SqlExportDialect::Postgres,
            override_system_value: true,
            batch_rows: SQL_EXPORT_INSERT_BATCH_ROWS,
            conflict_policy: SqlInsertConflictPolicy::Strict,
            conflict_key_columns: &[],
            schema: "public",
            table: "users",
        },
        &columns,
        &rows,
    )
    .unwrap();
    assert!(overridden[0].contains(") OVERRIDING SYSTEM VALUE VALUES"));

    let mysql = sql_insert_statements(
        SqlInsertExportOptions {
            kind: DatabaseKind::Mysql,
            dialect: SqlExportDialect::Mysql,
            override_system_value: true,
            batch_rows: SQL_EXPORT_INSERT_BATCH_ROWS,
            conflict_policy: SqlInsertConflictPolicy::Strict,
            conflict_key_columns: &[],
            schema: "app",
            table: "users",
        },
        &columns,
        &rows,
    )
    .unwrap();
    assert!(!mysql[0].contains("OVERRIDING SYSTEM VALUE"));
}

#[test]
fn sql_export_can_skip_conflicting_rows_for_reviewed_native_dialects() {
    let columns = [ColumnDef {
        name: "id".to_string(),
        data_type: "integer".to_string(),
    }];
    let rows = [vec![json!(42)]];
    let statement = |kind, dialect| {
        sql_insert_statements(
            SqlInsertExportOptions {
                kind,
                dialect,
                override_system_value: false,
                batch_rows: SQL_EXPORT_INSERT_BATCH_ROWS,
                conflict_policy: SqlInsertConflictPolicy::Skip,
                conflict_key_columns: &[],
                schema: "main",
                table: "events",
            },
            &columns,
            &rows,
        )
        .unwrap()
        .remove(0)
    };

    assert!(
        statement(DatabaseKind::Postgres, SqlExportDialect::Postgres)
            .ends_with(" ON CONFLICT DO NOTHING;")
    );
    assert!(
        statement(DatabaseKind::Mysql, SqlExportDialect::Mysql).starts_with("INSERT IGNORE INTO ")
    );
    assert!(statement(DatabaseKind::Postgres, SqlExportDialect::Sqlite)
        .starts_with("INSERT OR IGNORE INTO "));
    assert!(ensure_sql_insert_conflict_policy(
        SqlExportDialect::Standard,
        SqlInsertConflictPolicy::Skip
    )
    .is_err());
    assert!(ensure_sql_insert_conflict_policy(
        SqlExportDialect::DuckDb,
        SqlInsertConflictPolicy::Skip
    )
    .is_err());
}

#[test]
fn sql_export_can_update_conflicting_rows_by_complete_primary_key() {
    let columns = [
        ColumnDef {
            name: "tenant_id".to_string(),
            data_type: "integer".to_string(),
        },
        ColumnDef {
            name: "event_id".to_string(),
            data_type: "integer".to_string(),
        },
        ColumnDef {
            name: "display name".to_string(),
            data_type: "text".to_string(),
        },
    ];
    let conflict_keys = vec!["tenant_id".to_string(), "event_id".to_string()];
    let statement = |kind, dialect| {
        sql_insert_statements(
            SqlInsertExportOptions {
                kind,
                dialect,
                override_system_value: false,
                batch_rows: SQL_EXPORT_INSERT_BATCH_ROWS,
                conflict_policy: SqlInsertConflictPolicy::Update,
                conflict_key_columns: &conflict_keys,
                schema: "main",
                table: "events",
            },
            &columns,
            &[vec![json!(7), json!(42), json!("renamed")]],
        )
        .unwrap()
        .remove(0)
    };

    assert!(statement(DatabaseKind::Postgres, SqlExportDialect::Postgres).ends_with(
            " ON CONFLICT (\"tenant_id\", \"event_id\") DO UPDATE SET \"display name\" = excluded.\"display name\";"
        ));
    assert!(statement(DatabaseKind::Postgres, SqlExportDialect::Sqlite).ends_with(
            " ON CONFLICT (\"tenant_id\", \"event_id\") DO UPDATE SET \"display name\" = excluded.\"display name\";"
        ));
    assert!(statement(DatabaseKind::Mysql, SqlExportDialect::Mysql)
        .ends_with(" ON DUPLICATE KEY UPDATE `display name` = VALUES(`display name`);"));

    let missing_key = sql_insert_statements(
        SqlInsertExportOptions {
            kind: DatabaseKind::Postgres,
            dialect: SqlExportDialect::Postgres,
            override_system_value: false,
            batch_rows: SQL_EXPORT_INSERT_BATCH_ROWS,
            conflict_policy: SqlInsertConflictPolicy::Update,
            conflict_key_columns: &[],
            schema: "public",
            table: "events",
        },
        &columns,
        &[vec![json!(7), json!(42), json!("renamed")]],
    );
    assert!(missing_key.is_err());
    assert!(ensure_sql_insert_conflict_policy(
        SqlExportDialect::Standard,
        SqlInsertConflictPolicy::Update
    )
    .is_err());
}

#[test]
fn sql_exports_batch_rows_and_preserve_typed_literals() {
    let columns = vec![
        ColumnDef {
            name: "tags".to_string(),
            data_type: "text[]".to_string(),
        },
        ColumnDef {
            name: "payload".to_string(),
            data_type: "bytea".to_string(),
        },
    ];
    let rows = (0..101)
        .map(|index| vec![json!(["one", format!("item-{index}")]), json!("\\x00ff")])
        .collect::<Vec<_>>();
    let statements = sql_insert_statements(
        SqlInsertExportOptions {
            kind: DatabaseKind::Postgres,
            dialect: SqlExportDialect::Postgres,
            override_system_value: false,
            batch_rows: SQL_EXPORT_INSERT_BATCH_ROWS,
            conflict_policy: SqlInsertConflictPolicy::Strict,
            conflict_key_columns: &[],
            schema: "public",
            table: "events",
        },
        &columns,
        &rows,
    )
    .unwrap();

    assert_eq!(statements.len(), 2);
    assert_eq!(statements[0].matches("ARRAY[").count(), 100);
    assert_eq!(statements[1].matches("ARRAY[").count(), 1);
    assert!(statements[0].contains("ARRAY['one', 'item-0']::text[]"));
    assert!(statements[0].contains("decode('00ff', 'hex')"));

    let mysql = sql_insert_statements(
        SqlInsertExportOptions {
            kind: DatabaseKind::Mysql,
            dialect: SqlExportDialect::Mysql,
            override_system_value: false,
            batch_rows: SQL_EXPORT_INSERT_BATCH_ROWS,
            conflict_policy: SqlInsertConflictPolicy::Strict,
            conflict_key_columns: &[],
            schema: "app",
            table: "files",
        },
        &[
            ColumnDef {
                name: "contents".to_string(),
                data_type: "BLOB".to_string(),
            },
            ColumnDef {
                name: "note".to_string(),
                data_type: "TEXT".to_string(),
            },
        ],
        &[vec![json!("0x00ff"), json!("line one\nline two\\tail")]],
    )
    .unwrap();
    assert!(mysql[0].contains("(0X00FF, 'line one\\nline two\\\\tail')"));

    let sqlite = sql_insert_statements(
        SqlInsertExportOptions {
            kind: DatabaseKind::Postgres,
            dialect: SqlExportDialect::Sqlite,
            override_system_value: false,
            batch_rows: SQL_EXPORT_INSERT_BATCH_ROWS,
            conflict_policy: SqlInsertConflictPolicy::Strict,
            conflict_key_columns: &[],
            schema: "main",
            table: "files",
        },
        &[
            ColumnDef {
                name: "contents".to_string(),
                data_type: "BLOB".to_string(),
            },
            ColumnDef {
                name: "labels".to_string(),
                data_type: "text[]".to_string(),
            },
        ],
        &[vec![json!("0x00ff"), json!(["one", "two"])]],
    )
    .unwrap();
    assert!(sqlite[0].contains("(X'00FF', '[\"one\",\"two\"]')"));
}

#[test]
fn sql_export_batch_size_is_configurable_with_a_hard_upper_bound() {
    assert_eq!(sql_export_insert_batch_rows(None).unwrap(), 100);
    assert_eq!(sql_export_insert_batch_rows(Some(25)).unwrap(), 25);
    assert!(sql_export_insert_batch_rows(Some(0)).is_err());
    assert!(sql_export_insert_batch_rows(Some(SQL_EXPORT_MAX_INSERT_BATCH_ROWS + 1)).is_err());

    let rows = (0..26).map(|value| vec![json!(value)]).collect::<Vec<_>>();
    let statements = sql_insert_statements(
        SqlInsertExportOptions {
            kind: DatabaseKind::Postgres,
            dialect: SqlExportDialect::Postgres,
            override_system_value: false,
            batch_rows: 25,
            conflict_policy: SqlInsertConflictPolicy::Strict,
            conflict_key_columns: &[],
            schema: "public",
            table: "events",
        },
        &[ColumnDef {
            name: "id".to_string(),
            data_type: "integer".to_string(),
        }],
        &rows,
    )
    .unwrap();
    assert_eq!(statements.len(), 2);
    assert_eq!(statements[0].matches('(').count(), 26);
    assert_eq!(statements[1].matches('(').count(), 2);
}
