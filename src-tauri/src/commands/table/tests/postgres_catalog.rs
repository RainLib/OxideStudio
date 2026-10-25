use super::*;

#[test]
fn generates_postgres_table_ddl_from_columns() {
    let ddl = generate_postgres_table_ddl(
        "public",
        "users",
        &[
            ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: true,
                is_unique: true,
                is_indexed: true,
                default_value: Some("nextval('users_id_seq'::regclass)".to_string()),
                is_auto_increment: false,
                identity_generation: None,
                comment: None,
                is_generated: Some(false),
                is_hidden: Some(false),
                character_set: None,
                collation: None,
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
                character_set: None,
                collation: None,
            },
        ],
        &[
            ConstraintInfo {
                name: "users_pkey".to_string(),
                constraint_type: "PRIMARY KEY".to_string(),
                columns: vec!["id".to_string()],
                referenced_schema: None,
                referenced_table: None,
                referenced_columns: vec![],
                definition: Some("PRIMARY KEY (id)".to_string()),
                on_update: None,
                on_delete: None,
            },
            ConstraintInfo {
                name: "users_email_key".to_string(),
                constraint_type: "UNIQUE".to_string(),
                columns: vec!["email".to_string()],
                referenced_schema: None,
                referenced_table: None,
                referenced_columns: vec![],
                definition: Some("UNIQUE (email)".to_string()),
                on_update: None,
                on_delete: None,
            },
        ],
        &[IndexInfo {
            name: "users_email_idx".to_string(),
            columns: vec!["email".to_string()],
            is_unique: false,
            is_primary: false,
            filter: None,
            index_type: Some("btree".to_string()),
            included_columns: None,
            definition: Some(
                "CREATE INDEX users_email_idx ON public.users USING btree (email)".to_string(),
            ),
            comment: None,
            key_is_expression: Vec::new(),
        }],
    );

    assert!(ddl.contains(r#"CREATE TABLE "public"."users""#));
    assert!(ddl.contains(r#""id" integer DEFAULT nextval"#));
    assert!(ddl.contains(r#"CONSTRAINT "users_pkey" PRIMARY KEY (id)"#));
    assert!(ddl.contains(r#"CONSTRAINT "users_email_key" UNIQUE (email)"#));
    assert!(ddl.contains("CREATE INDEX users_email_idx"));
}

#[test]
fn generates_postgres_view_ddl() {
    assert!(object_type_is_view(Some("VIEW")));
    assert!(object_type_is_view(Some("SYSTEM VIEW")));
    assert!(object_type_is_view(Some("MATERIALIZED VIEW")));
    assert!(object_type_is_materialized_view(Some("MATERIALIZED VIEW")));
    assert!(!object_type_is_materialized_view(Some("VIEW")));
    assert!(object_type_is_foreign_table(Some("FOREIGN TABLE")));
    assert!(!object_type_is_view(Some("BASE TABLE")));
    assert_eq!(
        object_label_from_type(Some("MATERIALIZED VIEW")),
        "Materialized view"
    );
    assert_eq!(
        object_label_from_type(Some("FOREIGN TABLE")),
        "Foreign table"
    );

    assert_eq!(
        postgres_view_definition_query(DatabaseKind::Postgres, "public", "active_users"),
        r#"SELECT pg_get_viewdef(to_regclass('"public"."active_users"'), true) AS definition;"#
    );
    assert_eq!(
        postgres_materialized_view_populated_query(
            DatabaseKind::Postgres,
            "public",
            "active_users_mv",
        ),
        r#"SELECT relispopulated FROM pg_catalog.pg_class WHERE oid = to_regclass('"public"."active_users_mv"') AND relkind = 'm';"#
    );
    assert_eq!(
        view_definition_query(DatabaseKind::Postgres, "public", "active_users"),
        r#"SELECT pg_get_viewdef(to_regclass('"public"."active_users"'), true) AS definition;"#
    );
    assert_eq!(
            view_definition_query(DatabaseKind::Mysql, "app", "active_users"),
            "SELECT VIEW_DEFINITION AS definition FROM information_schema.VIEWS WHERE TABLE_SCHEMA = 'app' AND TABLE_NAME = 'active_users';"
        );
    assert_eq!(
        generate_postgres_view_ddl(
            DatabaseKind::Postgres,
            "public",
            "active_users",
            " SELECT id FROM users WHERE active "
        ),
        r#"CREATE OR REPLACE VIEW "public"."active_users" AS
SELECT id FROM users WHERE active;"#
    );
    assert_eq!(
        generate_postgres_materialized_view_ddl(
            DatabaseKind::Postgres,
            "public",
            "active_users_mv",
            " SELECT id FROM users WHERE active "
        ),
        r#"CREATE MATERIALIZED VIEW "public"."active_users_mv" AS
SELECT id FROM users WHERE active WITH DATA;"#
    );
    assert_eq!(
        generate_postgres_materialized_view_ddl_with_data(
            DatabaseKind::Postgres,
            "public",
            "active_users_mv",
            " SELECT id FROM users WHERE active ",
            false,
        ),
        r#"CREATE MATERIALIZED VIEW "public"."active_users_mv" AS
SELECT id FROM users WHERE active WITH NO DATA;"#
    );
}

#[test]
fn preserves_materialized_view_index_definitions_for_backup() {
    let mut indexes = vec![IndexInfo {
            name: "active_users_mv_email_idx".to_string(),
            columns: vec!["email".to_string()],
            is_unique: true,
            is_primary: false,
            filter: None,
            index_type: Some("btree".to_string()),
            included_columns: None,
            definition: Some(
                "CREATE UNIQUE INDEX active_users_mv_email_idx ON public.active_users_mv USING btree (email);"
                    .to_string(),
            ),
            comment: None,
            key_is_expression: Vec::new(),
        }];

    assert_eq!(
            postgres_backup_index_definitions("active_users_mv", &indexes).unwrap(),
            vec![
                "CREATE UNIQUE INDEX active_users_mv_email_idx ON public.active_users_mv USING btree (email)"
                    .to_string()
            ]
        );

    indexes[0].definition = None;
    assert!(
        postgres_backup_index_definitions("active_users_mv", &indexes)
            .unwrap_err()
            .contains("active_users_mv_email_idx")
    );
}

#[test]
fn orders_postgres_views_by_catalog_dependencies() {
    let view = |name: &str, table_type: &str| TableInfo {
        name: name.to_string(),
        schema: Some("public".to_string()),
        table_type: Some(table_type.to_string()),
        comment: None,
    };
    let ordered = order_postgres_views(
        vec![
            view("active_orders", "VIEW"),
            view("order_totals", "MATERIALIZED VIEW"),
            view("orders_source", "VIEW"),
        ],
        &[
            ("active_orders".to_string(), "orders_source".to_string()),
            ("order_totals".to_string(), "active_orders".to_string()),
        ],
    )
    .unwrap();
    assert_eq!(
        ordered
            .into_iter()
            .map(|view| view.name)
            .collect::<Vec<_>>(),
        vec!["orders_source", "active_orders", "order_totals"]
    );
    assert!(postgres_view_dependency_query("public").contains("dependent.relkind IN ('v', 'm')"));
    assert!(order_postgres_views(
        vec![view("first", "VIEW"), view("second", "VIEW")],
        &[
            ("first".to_string(), "second".to_string()),
            ("second".to_string(), "first".to_string()),
        ],
    )
    .unwrap_err()
    .contains("dependency cycle"));
}

#[test]
fn keeps_postgres_routine_backup_complete_and_bounded() {
    let query = postgres_backup_routine_definitions_query("public");
    assert!(query.contains("p.prokind IN ('f', 'p')"));
    assert!(query.contains("LIMIT 1001"));

    let definitions = postgres_backup_routine_definitions(&[QueryResult::rows(
            Vec::new(),
            vec![vec![
                Value::String("calculate_total".to_string()),
                Value::String("integer".to_string()),
                Value::String(
                    "CREATE OR REPLACE FUNCTION public.calculate_total() RETURNS integer LANGUAGE sql AS $$ SELECT 1; $$;"
                        .to_string(),
                ),
            ]],
        )])
        .unwrap();
    assert_eq!(definitions.len(), 1);
    assert!(definitions[0].starts_with("CREATE OR REPLACE FUNCTION"));
    assert!(postgres_backup_routine_definitions(&[QueryResult::rows(
        Vec::new(),
        vec![vec![Value::String("missing".to_string())]],
    )])
    .unwrap_err()
    .contains("no definition"));
}

#[test]
fn preserves_postgres_range_types_with_catalog_support_functions() {
    let query = postgres_range_type_query("public");
    assert!(query.contains("JOIN pg_catalog.pg_range range"));
    assert!(query.contains("type.typtype = 'r'"));
    assert!(postgres_multirange_type_query("public").contains("type.typtype = 'm'"));

    let ddls = postgres_range_type_ddls(
        "public",
        &[QueryResult::rows(
            Vec::new(),
            vec![vec![
                Value::String("business_hours".to_string()),
                Value::String("time without time zone".to_string()),
                Value::String("pg_catalog".to_string()),
                Value::String("time_ops".to_string()),
                Value::Null,
                Value::Null,
                Value::String("pg_catalog".to_string()),
                Value::String("time_canonical".to_string()),
                Value::String("pg_catalog".to_string()),
                Value::String("time_subdiff".to_string()),
            ]],
        )],
    )
    .unwrap();
    assert_eq!(
            ddls,
            vec![
                "CREATE TYPE \"public\".\"business_hours\" AS RANGE (SUBTYPE = time without time zone, SUBTYPE_OPCLASS = \"pg_catalog\".\"time_ops\", CANONICAL = \"pg_catalog\".\"time_canonical\", SUBTYPE_DIFF = \"pg_catalog\".\"time_subdiff\");"
                    .to_string()
            ]
        );

    let non_catalog = vec![
        Value::String("business_hours".to_string()),
        Value::String("time without time zone".to_string()),
        Value::String("pg_catalog".to_string()),
        Value::String("time_ops".to_string()),
        Value::Null,
        Value::Null,
        Value::String("public".to_string()),
        Value::String("business_hours_canonical".to_string()),
        Value::Null,
        Value::Null,
    ];
    assert!(postgres_range_type_ddls(
        "public",
        &[QueryResult::rows(Vec::new(), vec![non_catalog.clone()])],
    )
    .unwrap_err()
    .contains("restore order"));

    assert_eq!(
        postgres_multirange_type_names(&[QueryResult::rows(
            Vec::new(),
            vec![vec![Value::String("business_hours_multirange".to_string())]],
        )])
        .unwrap(),
        vec!["business_hours_multirange".to_string()]
    );
}

#[test]
fn postgres_sequence_export_is_replayable_and_quoted() {
    let sequence = postgres_sequence_from_row(&[
        json!("Order Seq"),
        json!("bigint"),
        json!(100),
        json!(-100),
        json!(9223372036854775807_i64),
        json!(-2),
        json!(true),
        json!(7),
        json!(88),
    ])
    .unwrap();
    assert_eq!(
            postgres_sequence_ddl("public", &sequence),
            "CREATE SEQUENCE \"public\".\"Order Seq\" AS bigint START WITH 100 INCREMENT BY -2 MINVALUE -100 MAXVALUE 9223372036854775807 CACHE 7 CYCLE;"
        );
    assert_eq!(
        postgres_sequence_setval_sql("public", &sequence).as_deref(),
        Some("SELECT pg_catalog.setval('\"public\".\"Order Seq\"'::regclass, 88, true);")
    );
}

#[test]
fn postgres_sequence_export_preserves_never_called_state() {
    let sequence = postgres_sequence_from_row(&[
        json!("fresh_seq"),
        json!("bigint"),
        json!(5),
        json!(1),
        json!(9223372036854775807_i64),
        json!(1),
        json!(false),
        json!(1),
        json!(5),
        json!(false),
    ])
    .unwrap();
    assert_eq!(sequence.is_called, Some(false));
    assert_eq!(
        postgres_sequence_setval_sql("public", &sequence).as_deref(),
        Some("SELECT pg_catalog.setval('\"public\".\"fresh_seq\"'::regclass, 5, false);")
    );

    let metadata_query = postgres_sequence_metadata_query("p'ublic");
    assert!(metadata_query.contains("pg_catalog.has_sequence_privilege"));
    assert!(metadata_query.contains("COALESCE(sequences.last_value, sequences.start_value)"));
    assert!(metadata_query.contains("sequences.last_value IS NOT NULL"));
    assert!(metadata_query.contains("WHERE sequences.schemaname = 'p''ublic'"));
}

#[test]
fn postgres_sequence_export_rejects_untrusted_numeric_metadata() {
    let error = postgres_sequence_from_row(&[
        json!("sequence"),
        json!("integer"),
        json!("1; DROP SCHEMA public"),
        json!(1),
        json!(10),
        json!(1),
        json!(false),
        json!(1),
        Value::Null,
    ])
    .unwrap_err();
    assert!(error.contains("invalid start value"));
}
