use super::super::*;
use crate::core::protocol::ColumnDef;
use sqlx::postgres::types::PgInterval;
use sqlx::types::BigDecimal;
use std::str::FromStr;
#[test]
fn postgres_search_path_keeps_configured_entries_when_schema_changes() {
    assert_eq!(
        postgres_search_path_with_selected_schema(
            "\"$user\", extensions, public",
            Some("public"),
            false,
            "application",
        ),
        "\"application\", \"$user\", extensions, public, pg_catalog",
    );
}

#[test]
fn legacy_prokind_fallback_only_accepts_undefined_column_failures() {
    assert!(PostgresDriver::postgres_missing_prokind_error(
        "ERROR: column p.prokind does not exist"
    ));
    assert!(PostgresDriver::postgres_missing_prokind_error(
        "ERROR: undefined column p.prokind (SQLSTATE 42703)"
    ));
    assert!(PostgresDriver::postgres_missing_prokind_error(
        "错误: 字段 p.prokind 不存在"
    ));
    assert!(!PostgresDriver::postgres_missing_prokind_error(
        "ERROR: permission denied for column p.prokind"
    ));
    assert!(!PostgresDriver::postgres_missing_prokind_error(
        "ERROR: relation public.prokind does not exist"
    ));
}

#[test]
fn postgres_search_path_keeps_existing_path_when_selected_schema_is_first() {
    assert_eq!(
        postgres_search_path_with_selected_schema(
            "application, extensions, public",
            Some("application"),
            false,
            "application",
        ),
        "application, extensions, public, pg_catalog",
    );
    assert_eq!(
        postgres_search_path_with_selected_schema(
            "extensions, pg_catalog, public",
            Some("extensions"),
            true,
            "application",
        ),
        "\"application\", extensions, pg_catalog, public",
    );
}

#[test]
fn postgres_search_path_quotes_selected_schema_and_handles_an_empty_baseline() {
    assert_eq!(
        postgres_search_path_with_selected_schema("", None, false, "tenant\"name"),
        "\"tenant\"\"name\", pg_catalog",
    );
}

#[test]
fn empty_postgres_rows_preserve_described_columns() {
    let driver = PostgresDriver::new("postgres://user:pass@localhost/db");
    let results = driver
        .process_rows(
            Vec::new(),
            vec![
                ColumnDef {
                    name: "id".to_string(),
                    data_type: "INT8".to_string(),
                },
                ColumnDef {
                    name: "email".to_string(),
                    data_type: "TEXT".to_string(),
                },
            ],
        )
        .expect("empty rows should produce a query result");

    assert_eq!(results.len(), 1);
    assert!(results[0].rows.is_empty());
    assert_eq!(results[0].columns.len(), 2);
    assert_eq!(results[0].columns[0].name, "id");
    assert_eq!(results[0].columns[0].data_type, "INT8");
    assert_eq!(results[0].columns[1].name, "email");
    assert_eq!(results[0].columns[1].data_type, "TEXT");
}

#[test]
fn postgres_json_integers_only_use_numbers_inside_javascript_safe_range() {
    assert_eq!(
        json_i64(JS_SAFE_INTEGER_MAX),
        serde_json::json!(9_007_199_254_740_991_i64)
    );
    assert_eq!(
        json_i64(JS_SAFE_INTEGER_MAX + 1),
        serde_json::json!("9007199254740992")
    );
    assert_eq!(
        json_i64(i64::MIN),
        serde_json::json!("-9223372036854775808")
    );
    assert_eq!(
        json_u64(u64::MAX),
        serde_json::json!("18446744073709551615")
    );
}

#[test]
fn postgres_binary_hex_representation_is_reversible() {
    let bytes = vec![0x00, 0x7f, 0x80, 0xff];
    assert_eq!(binary_json(&bytes), serde_json::json!("\\x007f80ff"));
    assert_eq!(hex_decode("\\x007f80ff").unwrap(), bytes);
    assert!(hex_decode("\\x0").is_err());
    assert!(hex_decode("\\xzz").is_err());
}

#[test]
fn postgres_float_representation_keeps_f32_shape_and_special_values() {
    assert_eq!(json_f32(0.1), serde_json::json!(0.1));
    assert_eq!(json_f32(f32::NAN), serde_json::json!("NaN"));
    assert_eq!(json_f64(f64::INFINITY), serde_json::json!("Infinity"));
    assert_eq!(json_f64(f64::NEG_INFINITY), serde_json::json!("-Infinity"));
}

#[test]
fn postgres_numeric_text_preserves_arbitrary_precision_and_declared_scale() {
    let integer = "9".repeat(10_000);
    let fractional = format!("{}12300", "0".repeat(300));
    let source = format!("{integer}.{fractional}");
    let value = BigDecimal::from_str(&source).unwrap();

    assert_eq!(
        pg_numeric_text(value, Some(fractional.len() as i64)),
        serde_json::Value::String(source)
    );

    let scaled_zero = BigDecimal::from_str("0").unwrap();
    assert_eq!(
        pg_numeric_text(scaled_zero, Some(4)),
        serde_json::json!("0.0000")
    );
}

#[test]
fn postgres_array_json_is_converted_to_native_literal_for_round_trip() {
    assert_eq!(
        pg_array_literal(&serde_json::json!([1, "two", null, "a\\\"b", {"x": 1}])).unwrap(),
        r#"{1,"two",NULL,"a\\\"b","{\"x\":1}"}"#
    );
    assert_eq!(
        pg_array_literal(&serde_json::json!("{1,2,NULL}")).unwrap(),
        "{1,2,NULL}"
    );
    assert!(pg_array_literal(&serde_json::json!("not an array")).is_err());
}

#[test]
fn postgres_interval_representation_keeps_all_wire_components() {
    assert_eq!(
        pg_interval_text(PgInterval {
            months: 14,
            days: -3,
            microseconds: 1_234_567,
        }),
        "14 mons -3 days 1234567 microseconds"
    );
}

#[test]
fn parses_postgres_function_arguments() {
    let params = parse_postgres_function_parameters(
        "IN account_id integer, amount numeric(10, 2) DEFAULT 0, VARIADIC tags text[]",
    );

    assert_eq!(params.len(), 3);
    assert_eq!(params[0].name, "account_id");
    assert_eq!(params[0].data_type, "integer");
    assert!(!params[0].optional);
    assert_eq!(params[1].name, "amount");
    assert_eq!(params[1].data_type, "numeric(10, 2)");
    assert!(params[1].optional);
    assert_eq!(params[2].name, "tags");
    assert_eq!(params[2].data_type, "text[]");
    assert_eq!(params[0].mode.as_deref(), Some("IN"));
    assert_eq!(params[2].mode.as_deref(), Some("VARIADIC"));
}

#[test]
fn postgres_parameter_modes_preserve_quoted_names_nested_defaults_and_output_slots() {
    let params = parse_postgres_function_parameters(
        r#"IN "account name" integer, OUT "count, total" bigint, INOUT running numeric(10, 2), VARIADIC tags text[] DEFAULT ARRAY['a,b', $q$x, DEFAULT (])$q$]"#,
    );
    assert_eq!(params.len(), 4);
    assert_eq!(params[0].name, "account name");
    assert_eq!(params[1].name, "count, total");
    assert_eq!(params[1].mode.as_deref(), Some("OUT"));
    assert_eq!(params[2].mode.as_deref(), Some("INOUT"));
    assert_eq!(params[2].data_type, "numeric(10, 2)");
    assert_eq!(params[3].data_type, "text[]");
    assert!(params[3].optional);
    let json = serde_json::to_value(&params).unwrap();
    assert_eq!(json[3]["mode"], "VARIADIC");
}

#[test]
fn postgres_parameter_modes_keep_unnamed_multiword_and_qualified_types() {
    let params = parse_postgres_function_parameters(
        "double precision, timestamp(6) with time zone, numeric(10, 2), types.custom_type[]",
    );
    assert_eq!(
        params
            .iter()
            .map(|parameter| parameter.data_type.as_str())
            .collect::<Vec<_>>(),
        vec![
            "double precision",
            "timestamp(6) with time zone",
            "numeric(10, 2)",
            "types.custom_type[]"
        ]
    );
    assert_eq!(
        params
            .iter()
            .map(|parameter| parameter.name.as_str())
            .collect::<Vec<_>>(),
        vec!["arg1", "arg2", "arg3", "arg4"]
    );
    assert!(params.iter().all(|parameter| parameter.mode.is_none()));
}

#[test]
fn postgres_parameter_modes_distinguish_default_literals_and_dollars_in_names() {
    let params = parse_postgres_function_parameters(
        r#""has DEFAULT word" text DEFAULT 'x DEFAULT y', arg$tag$ integer DEFAULT 2, x text DEFAULT E'it\'s,DEFAULT', y text DEFAULT $$,DEFAULT$$"#,
    );
    assert_eq!(params.len(), 4);
    assert_eq!(params[0].name, "has DEFAULT word");
    assert_eq!(params[1].name, "arg$tag$");
    assert!(params.iter().all(|parameter| parameter.optional));
    assert_eq!(params[1].data_type, "integer");
}

#[test]
fn parses_postgres_backend_pid_from_compatible_text_value() {
    assert_eq!(parse_postgres_backend_pid(" 4242 "), Some(4242));
    assert_eq!(parse_postgres_backend_pid("0"), None);
    assert_eq!(parse_postgres_backend_pid("-1"), None);
    assert_eq!(parse_postgres_backend_pid("2147483648"), None);
    assert_eq!(parse_postgres_backend_pid("not-a-pid"), None);
}

#[test]
fn postgres_backend_pid_query_normalizes_compatible_numeric_types() {
    assert_eq!(
        POSTGRES_BACKEND_PID_SQL,
        "SELECT CAST(pg_backend_pid() AS TEXT)"
    );
}

#[test]
fn postgres_catalog_metadata_uses_legacy_ordinality_route_before_94() {
    assert!(!postgres_supports_with_ordinality(90_300));
    assert!(postgres_supports_with_ordinality(90_400));
    assert!(postgres_supports_with_ordinality(160_000));
}
