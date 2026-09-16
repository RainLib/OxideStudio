use super::*;
use crate::core::driver::DatabaseDriver;
use crate::core::protocol::ColumnDef;
use dotenvy::dotenv;
use sqlx::mysql::MySqlConnectOptions;
use sqlx::ConnectOptions;
use std::collections::HashMap;
use std::env;
use std::str::FromStr;
use std::sync::Mutex as StdMutex;

#[test]
fn mysql_column_ownership_does_not_confuse_default_generated_with_computed() {
    assert_eq!(mysql_column_ownership("DEFAULT_GENERATED"), (false, false));
    assert_eq!(
        mysql_column_ownership("DEFAULT_GENERATED on update CURRENT_TIMESTAMP"),
        (false, false)
    );
    assert_eq!(mysql_column_ownership("VIRTUAL GENERATED"), (true, false));
    assert_eq!(
        mysql_column_ownership("STORED GENERATED INVISIBLE"),
        (true, true)
    );
    assert_eq!(mysql_column_ownership("INVISIBLE"), (false, true));
}

#[test]
fn mysql_index_expression_metadata_fallback_is_limited_to_known_servers() {
    assert!(mysql_statistics_expression_error_is_unsupported(
        Some("1054"),
        "Unknown column 'EXPRESSION' in 'field list'",
    ));
    assert!(mysql_statistics_expression_error_is_unsupported(
        Some("3009"),
        "[TDDL-3009] Column 'EXPRESSION' not found in any table",
    ));
    assert!(mysql_statistics_expression_error_is_unsupported(
        Some("4518"),
        "[PXC-4518][ERR_VALIDATE] : Column 'EXPRESSION' not found in any table",
    ));

    assert!(!mysql_statistics_expression_error_is_unsupported(
        Some("4518"),
        "[PXC-4518] Column 'INDEX_NAME' not found in any table",
    ));
    assert!(!mysql_statistics_expression_error_is_unsupported(
        Some("1044"),
        "Access denied for metadata",
    ));
    assert!(!mysql_statistics_expression_error_is_unsupported(
        None,
        "Column 'EXPRESSION' not found in any table",
    ));
}

#[test]
fn mysql_index_metadata_sql_keeps_expression_and_legacy_paths_separate() {
    assert!(MYSQL_INDEX_METADATA_SQL_WITH_EXPRESSIONS.contains("expression"));
    assert!(!MYSQL_INDEX_METADATA_SQL_LEGACY.contains("expression"));
    assert!(MYSQL_INDEX_METADATA_SQL_WITH_EXPRESSIONS.contains("seq_in_index"));
    assert!(MYSQL_INDEX_METADATA_SQL_LEGACY.contains("seq_in_index"));
}

#[test]
fn legacy_add_column_if_not_exists_only_accepts_one_verified_operation() {
    assert_eq!(
        mysql_add_column_if_not_exists(
            "ALTER TABLE `app`.`users` ADD COLUMN IF NOT EXISTS `nickname` VARCHAR(64) AFTER `email`"
        ),
        Some(MysqlAddColumnIfNotExists {
            database: Some("app".to_string()),
            table: "users".to_string(),
            column: "nickname".to_string(),
        })
    );
    assert!(
        mysql_add_column_if_not_exists("ALTER TABLE users ADD COLUMN nickname VARCHAR(64)")
            .is_none()
    );
    assert!(mysql_add_column_if_not_exists(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(64), ADD COLUMN status INT"
    )
    .is_none());
    assert!(
        mysql_add_column_if_not_exists("ALTER TABLE users DROP COLUMN IF EXISTS nickname")
            .is_none()
    );
}

#[test]
fn legacy_add_column_if_not_exists_skips_comments_and_literals() {
    let sql = "/* IF NOT EXISTS */ ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(64) DEFAULT 'IF NOT EXISTS'";
    assert_eq!(
        mysql_add_column_fallback_sql(sql),
        Some("/* IF NOT EXISTS */ ALTER TABLE users ADD COLUMN  nickname VARCHAR(64) DEFAULT 'IF NOT EXISTS'".to_string())
    );
    assert_eq!(
        mysql_add_column_if_not_exists(sql),
        Some(MysqlAddColumnIfNotExists {
            database: None,
            table: "users".to_string(),
            column: "nickname".to_string(),
        })
    );
}

#[test]
fn empty_mysql_rows_preserve_described_columns() {
    let driver = MysqlDriver::new("mysql://user:pass@localhost/db");
    let results = driver
        .process_rows(
            Vec::new(),
            vec![
                ColumnDef {
                    name: "id".to_string(),
                    data_type: "BIGINT".to_string(),
                },
                ColumnDef {
                    name: "email".to_string(),
                    data_type: "VARCHAR".to_string(),
                },
            ],
        )
        .expect("empty rows should produce a query result");

    assert_eq!(results.len(), 1);
    assert!(results[0].rows.is_empty());
    assert_eq!(results[0].columns.len(), 2);
    assert_eq!(results[0].columns[0].name, "id");
    assert_eq!(results[0].columns[0].data_type, "BIGINT");
    assert_eq!(results[0].columns[1].name, "email");
    assert_eq!(results[0].columns[1].data_type, "VARCHAR");
}

#[test]
fn mysql_json_integers_only_use_numbers_inside_javascript_safe_range() {
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
fn mysql_binary_hex_representation_is_reversible() {
    let bytes = vec![0x00, 0x7f, 0x80, 0xff];
    assert_eq!(binary_json(&bytes), serde_json::json!("0x007f80ff"));
    assert_eq!(hex_decode("0x007f80ff").unwrap(), bytes);
    assert!(hex_decode("0x0").is_err());
    assert!(hex_decode("0xzz").is_err());
}

#[test]
fn mysql_float_representation_keeps_f32_shape_and_special_values() {
    assert_eq!(json_f32(0.1), serde_json::json!(0.1));
    assert_eq!(json_f32(f32::NAN), serde_json::json!("NaN"));
    assert_eq!(json_f64(f64::INFINITY), serde_json::json!("Infinity"));
    assert_eq!(json_f64(f64::NEG_INFINITY), serde_json::json!("-Infinity"));
}

#[test]
fn mysql_type_detection_preserves_unsigned_and_binary_bindings() {
    assert!(is_mysql_unsigned_type(Some("bigint unsigned")));
    assert!(!is_mysql_unsigned_type(Some("bigint")));
    assert!(is_mysql_binary_type(Some("varbinary(255)")));
    assert!(is_mysql_binary_type(Some("longblob")));
    assert!(!is_mysql_binary_type(Some("varchar(255)")));
    assert!(is_mysql_bit_type(Some("bit(64)")));
}

#[test]
fn parses_mysql_connection_id_from_compatible_text_value() {
    assert_eq!(parse_mysql_connection_id(" 4242 "), Some(4242));
    assert_eq!(parse_mysql_connection_id("0"), None);
    assert_eq!(parse_mysql_connection_id("-1"), None);
    assert_eq!(parse_mysql_connection_id("not-a-thread"), None);
}

#[test]
fn mysql_connection_id_query_normalizes_compatible_numeric_types() {
    assert_eq!(
        MYSQL_CONNECTION_ID_SQL,
        "SELECT CAST(CONNECTION_ID() AS CHAR)"
    );
}

#[test]
fn schema_object_catalog_covers_triggers_and_events_without_ddl() {
    assert!(MYSQL_SCHEMA_OBJECTS_SQL.contains("information_schema.triggers"));
    assert!(MYSQL_SCHEMA_OBJECTS_SQL.contains("information_schema.events"));
    assert!(MYSQL_SCHEMA_OBJECTS_SQL.contains("event_object_table AS parent_name"));
    assert!(!MYSQL_SCHEMA_OBJECTS_SQL
        .to_ascii_uppercase()
        .contains("SHOW CREATE"));
    assert!(!MYSQL_SCHEMA_OBJECTS_SQL
        .to_ascii_uppercase()
        .contains("INSERT"));
}

#[test]
fn tracked_query_guard_removes_active_query_on_drop() {
    let active_queries = StdMutex::new(HashMap::from([("q1".to_string(), 42)]));

    {
        let _guard = MysqlTrackedQueryGuard {
            active_queries: &active_queries,
            query_id: Some("q1".to_string()),
        };
    }

    assert!(!active_queries
        .lock()
        .expect("active query map mutex poisoned")
        .contains_key("q1"));
}

#[test]
fn drain_active_query_threads_clears_tracked_queries() {
    let driver = MysqlDriver::new("mysql://user:pass@localhost/db");
    driver
        .active_queries
        .lock()
        .expect("active query map mutex poisoned")
        .extend([("q1".to_string(), 11), ("q2".to_string(), 12)]);

    let mut drained = driver.drain_active_query_threads();
    drained.sort_by(|left, right| left.0.cmp(&right.0));

    assert_eq!(
        drained,
        vec![("q1".to_string(), 11), ("q2".to_string(), 12)]
    );
    assert!(driver
        .active_queries
        .lock()
        .expect("active query map mutex poisoned")
        .is_empty());
}

#[test]
fn remove_active_query_thread_only_removes_matching_thread() {
    let driver = MysqlDriver::new("mysql://user:pass@localhost/db");
    driver
        .active_queries
        .lock()
        .expect("active query map mutex poisoned")
        .insert("q1".to_string(), 41);

    driver.remove_active_query_thread_if_matches("q1", 42);
    assert_eq!(driver.active_query_thread("q1"), Some(41));

    driver.remove_active_query_thread_if_matches("q1", 41);
    assert_eq!(driver.active_query_thread("q1"), None);
}

#[tokio::test]
async fn cancel_query_retains_tracking_when_mysql_pool_is_unavailable() {
    let driver = MysqlDriver::new("mysql://user:pass@localhost/db");
    driver
        .active_queries
        .lock()
        .expect("active query map mutex poisoned")
        .insert("q1".to_string(), 42);

    let error = driver
        .cancel_query("q1")
        .await
        .expect_err("missing pool should fail cancellation");

    assert!(error.to_string().contains("Driver not connected"));
    assert_eq!(driver.active_query_thread("q1"), Some(42));
}

#[tokio::test]
async fn get_pool_rejects_when_driver_is_not_connected() {
    let driver = MysqlDriver::new("mysql://user:pass@localhost/db");

    let error = driver.get_pool(None).await.unwrap_err().to_string();

    assert!(error.contains("Driver not connected"));
}

#[tokio::test]
async fn disconnect_clears_mysql_connection_options() {
    let driver = MysqlDriver::new("mysql://user:pass@localhost/db");
    let options = MySqlConnectOptions::from_str("mysql://user:pass@localhost/db")
        .expect("test MySQL URL should parse")
        .disable_statement_logging()
        .to_owned();
    {
        let mut base_options = driver.base_options.lock().await;
        *base_options = Some(options);
    }

    driver
        .disconnect()
        .await
        .expect("disconnect should succeed");
    driver
        .disconnect()
        .await
        .expect("second disconnect should be idempotent");

    assert!(driver.base_options.lock().await.is_none());
    assert!(driver.pools.lock().await.is_empty());
}

#[test]
fn mysql_unprepared_routing_covers_ddl_and_mysql_commands() {
    assert!(mysql_requires_unprepared("CREATE DATABASE app"));
    assert!(mysql_requires_unprepared("show tables"));
    assert!(mysql_requires_unprepared("DESCRIBE users"));
    assert!(mysql_requires_unprepared("BEGIN"));
    assert!(mysql_requires_unprepared(
        "# generated dump\nCREATE TABLE users(id INT)"
    ));
    assert!(mysql_requires_unprepared(
        "/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */"
    ));
    assert!(mysql_requires_unprepared(
        "SELECT 1; CREATE TABLE users(id INT)"
    ));
    assert!(mysql_requires_unprepared(
        "SELECT ';' AS semicolon; UPDATE users SET name = 'a'"
    ));
    assert!(!mysql_requires_unprepared("SELECT * FROM users"));
    assert!(!mysql_requires_unprepared("SELECT ';' AS semicolon;"));
    assert!(!mysql_requires_unprepared("SELECT 1 /* ; */ -- ;\n;"));
    assert!(!mysql_requires_unprepared(
        "UPDATE users SET name = 'a' WHERE id = 1"
    ));
}

#[tokio::test]
#[ignore = "requires a live TEST_MYSQL_URL database"]
async fn test_get_schemas() {
    dotenv().ok();
    let database_url = env::var("TEST_MYSQL_URL").expect("TEST_MYSQL_URL must be set");

    let mut driver = MysqlDriver::new(&database_url);
    driver.connect().await.expect("Failed to connect");

    let schemas = driver.get_schemas().await.expect("Failed to get schemas");
    println!("Schemas: {:?}", schemas);
    assert!(!schemas.is_empty());

    driver.disconnect().await.expect("Failed to disconnect");
}
