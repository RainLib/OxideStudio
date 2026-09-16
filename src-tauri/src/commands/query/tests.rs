use super::*;
use crate::core::{dialect::DatabaseKind, protocol::QueryResult, statement::StatementScanDialect};
use serde::Deserialize;
use sqlx::error::{DatabaseError, ErrorKind};
use std::borrow::Cow;
use std::error::Error as StdError;
use std::fmt;

#[derive(Debug)]
struct MockDatabaseError;

impl fmt::Display for MockDatabaseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("duplicate row")
    }
}

impl StdError for MockDatabaseError {}

impl DatabaseError for MockDatabaseError {
    fn message(&self) -> &str {
        "duplicate row"
    }

    fn code(&self) -> Option<Cow<'_, str>> {
        Some(Cow::Borrowed("23505"))
    }

    fn as_error(&self) -> &(dyn StdError + Send + Sync + 'static) {
        self
    }

    fn as_error_mut(&mut self) -> &mut (dyn StdError + Send + Sync + 'static) {
        self
    }

    fn into_error(self: Box<Self>) -> Box<dyn StdError + Send + Sync + 'static> {
        self
    }

    fn constraint(&self) -> Option<&str> {
        Some("users_email_key")
    }

    fn table(&self) -> Option<&str> {
        Some("users")
    }

    fn kind(&self) -> ErrorKind {
        ErrorKind::UniqueViolation
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatementScopeFixture {
    id: String,
    dialect: String,
    before_cursor: String,
    after_cursor: String,
    backend_selected: String,
    statement_index: usize,
    statement_count: usize,
}

#[test]
fn statement_scope_fixtures_match_cursor_selection_contract() {
    let fixtures: Vec<StatementScopeFixture> = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/sql-statement-scope.json"
    ))
    .expect("statement scope fixture JSON should remain valid");

    for fixture in fixtures {
        let dialect = match fixture.dialect.as_str() {
            "postgres" => StatementScanDialect::Postgres,
            "mysql" => StatementScanDialect::Mysql,
            other => panic!("unknown statement scope fixture dialect: {other}"),
        };
        let sql = format!("{}{}", fixture.before_cursor, fixture.after_cursor);
        let cursor_offset = fixture.before_cursor.encode_utf16().count();
        let selected = sql_statement_at_cursor(&sql, dialect, cursor_offset)
            .unwrap_or_else(|| panic!("fixture {} should select a statement", fixture.id));

        assert_eq!(
            selected.sql, fixture.backend_selected,
            "fixture {} selected an unexpected statement",
            fixture.id
        );
        assert_eq!(
            selected.statement_index, fixture.statement_index,
            "fixture {} selected an unexpected statement index",
            fixture.id
        );
        assert_eq!(
            selected.statement_count, fixture.statement_count,
            "fixture {} produced an unexpected statement count",
            fixture.id
        );
    }
}

#[tokio::test]
async fn cancellation_state_rejects_duplicate_query_ids() {
    let state = QueryCancellationState::default();

    let _first = state
        .register("query-1", "connection-1")
        .await
        .expect("first query id should register");
    let duplicate = state.register("query-1", "connection-2").await;

    assert!(duplicate.is_err());
    assert!(state.take("query-1").await.is_some());
    assert!(state.register("query-1", "connection-2").await.is_ok());
}

#[test]
fn cursor_offset_conversion_matches_monaco_for_non_bmp_text() {
    let sql = "SELECT '🚀中文'; UPDATE t SET v = 1";
    let update_byte_offset = sql.find("UPDATE").expect("UPDATE should be present");
    let update_utf16_offset = sql[..update_byte_offset].encode_utf16().count();

    assert_eq!(
        utf16_offset_to_byte_offset(sql, update_utf16_offset),
        update_byte_offset
    );
    assert_eq!(
        byte_offset_to_utf16_offset(sql, update_byte_offset),
        update_utf16_offset
    );
}

#[test]
fn statement_at_cursor_uses_utf16_offsets_and_driver_lexing() {
    let sql = "SELECT '🚀;';\n-- next\nSELECT 2;";
    let cursor = sql[..sql.find('2').unwrap()].encode_utf16().count();
    let selected = sql_statement_at_cursor(sql, StatementScanDialect::Postgres, cursor).unwrap();

    assert_eq!(selected.sql, "-- next\nSELECT 2");
    assert_eq!(selected.statement_index, 1);
    assert_eq!(selected.statement_count, 2);
    let ranges = selected
        .statement_ranges
        .as_ref()
        .expect("ordinary documents should return cacheable statement ranges");
    assert_eq!(ranges.len(), 2);
    assert_eq!(ranges[1].start_offset, selected.start_offset);
    assert_eq!(ranges[1].end_offset, selected.end_offset);
    assert_eq!(ranges[0].start_offset, 0);
    assert_eq!(ranges[0].end_offset, "SELECT '🚀;'".encode_utf16().count());
    assert_eq!(
        &sql[utf16_offset_to_byte_offset(sql, selected.start_offset)
            ..utf16_offset_to_byte_offset(sql, selected.end_offset)],
        selected.sql
    );
}

#[test]
fn statement_range_cache_is_bounded_for_large_documents() {
    let sql = "SELECT 1;\n".repeat(MAX_CACHED_STATEMENT_RANGES + 1);
    let selected = sql_statement_at_cursor(&sql, StatementScanDialect::Postgres, 0)
        .expect("large SQL documents should still resolve the current statement");

    assert_eq!(selected.statement_count, MAX_CACHED_STATEMENT_RANGES + 1);
    assert!(selected.statement_ranges.is_none());
    assert_eq!(selected.sql, "SELECT 1");
}

#[test]
fn statement_at_cursor_recovers_blank_line_separated_queries_without_semicolons() {
    let sql = "SELECT '🚀' FROM first_table\n\nSELECT * FROM second_table";
    let cursor = sql[..sql.find("second_table").unwrap()]
        .encode_utf16()
        .count();
    let selected = sql_statement_at_cursor(sql, StatementScanDialect::Postgres, cursor).unwrap();

    assert_eq!(selected.sql, "SELECT * FROM second_table");
    assert_eq!(selected.statement_index, 1);
    assert_eq!(selected.statement_count, 2);
}

#[test]
fn statement_at_cursor_keeps_blank_lines_unassigned() {
    let sql = "SELECT 1;\n  \n  SELECT 2;";
    let blank_cursor = sql[..sql.find("  \n  SELECT").unwrap() + 1]
        .encode_utf16()
        .count();

    assert!(sql_statement_at_cursor(sql, StatementScanDialect::Postgres, blank_cursor).is_none());

    let indented_cursor = sql[..sql.find("SELECT 2").unwrap()].encode_utf16().count();
    assert_eq!(
        sql_statement_at_cursor(sql, StatementScanDialect::Postgres, indented_cursor)
            .expect("indentation on a SQL line should target its statement")
            .sql,
        "SELECT 2"
    );
}

#[test]
fn sql_import_review_digest_binds_the_exact_script_contents() {
    let original = "CREATE TABLE audit_log (id integer);";
    assert_eq!(sql_import_digest(original), sql_import_digest(original));
    assert_ne!(
        sql_import_digest(original),
        sql_import_digest("CREATE TABLE audit_log (id bigint);")
    );
}

#[test]
fn mysql_sql_import_normalizes_raw_binary_literals_without_touching_sql_noise() {
    let mut source = b"-- _binary '\\xFF'\nINSERT INTO t VALUES (_binary '".to_vec();
    source.extend_from_slice(&[
        0xAC, b'\\', 0xED, b'\\', b'0', b'\\', b'n', b'\\', b'\'', b'\\', b'\\',
    ]);
    source.extend_from_slice(b"', '_binary \\'x\\'', `col_binary`); /* _binary '\\xFF' */");

    let decoded = decode_sql_import_bytes(&source, true).expect("recover MySQL dump");

    assert_eq!(
        decoded,
        "-- _binary '\\xFF'\nINSERT INTO t VALUES (X'ACED000A275C', '_binary \\'x\\'', `col_binary`); /* _binary '\\xFF' */"
    );
}

#[test]
fn mysql_sql_import_handles_bom_utf8_and_rejects_unterminated_binary_literals() {
    let mut source = vec![0xEF, 0xBB, 0xBF];
    source.extend_from_slice(b"INSERT INTO t VALUES (_binary '");
    source.extend_from_slice(&[0x00, 0xFF, 0x1A]);
    source.extend_from_slice(b"');");

    assert_eq!(
        decode_sql_import_bytes(&source, true).unwrap(),
        "INSERT INTO t VALUES (X'00FF1A');"
    );
    assert_eq!(
        decode_sql_import_bytes(b"SELECT _binary 'abc", true).unwrap_err(),
        "Unterminated MySQL binary literal"
    );
}

#[test]
fn sql_import_decoding_preserves_gb18030_and_non_mysql_binary_introducers() {
    let sql = "INSERT INTO t VALUES ('中文');";
    let (gbk, _, had_errors) = encoding_rs::GBK.encode(sql);
    assert!(!had_errors);
    assert_eq!(decode_sql_import_bytes(gbk.as_ref(), true).unwrap(), sql);
    assert_eq!(
        decode_sql_import_bytes(b"SELECT _binary 'abc';", false).unwrap(),
        "SELECT _binary 'abc';"
    );
}

#[test]
fn sql_import_statement_preview_is_bounded_and_preserves_short_statements() {
    assert_eq!(
        sql_import_statement_preview("  SELECT * FROM users;  "),
        "SELECT * FROM users;"
    );
    let long_statement = format!("SELECT {}", "x".repeat(1_300));
    let preview = sql_import_statement_preview(&long_statement);
    assert_eq!(preview.chars().count(), 1_201);
    assert!(preview.ends_with('…'));
}

#[test]
fn syntax_validation_uses_the_requested_vendor_dialect_without_execution() {
    let postgres = validate_sql_syntax_text(
        "postgresql",
        "SELECT payload->>'name' FROM events; SELECT 2;",
        None,
        None,
    )
    .expect("PostgreSQL should be supported");
    assert!(postgres.valid);
    assert_eq!(postgres.driver, "postgres");
    assert_eq!(postgres.statement_count, 2);
    assert!(postgres.diagnostics.is_empty());

    let mysql =
        validate_sql_syntax_text("mariadb", "SELECT `name` FROM `users` LIMIT 1;", None, None)
            .expect("MySQL should be supported");
    assert!(mysql.valid);
    assert_eq!(mysql.driver, "mysql");
    assert_eq!(mysql.statement_count, 1);

    let sqlite = validate_sql_syntax_text(
        "sqlite",
        "SELECT name FROM users WHERE id = 1 LIMIT 1;",
        None,
        None,
    )
    .expect("SQLite should have editor syntax validation");
    assert!(sqlite.valid);
    assert_eq!(sqlite.driver, "sqlite");

    let duckdb = validate_sql_syntax_text(
        "duckdb",
        "SELECT name FROM metrics WHERE created_at >= CURRENT_DATE;",
        None,
        None,
    )
    .expect("DuckDB should use the SQLite-compatible validation profile");
    assert!(duckdb.valid);
    assert_eq!(duckdb.driver, "duckdb");

    let generic_package = validate_sql_syntax_text(
        "trino",
        "SELECT region, count(*) FROM analytics.orders GROUP BY region;",
        Some("sql"),
        None,
    )
    .expect("generic SQL packages should use the editor's SQL baseline");
    assert!(generic_package.valid);
    assert_eq!(generic_package.driver, "trino");

    let mysql_compatible = validate_sql_syntax_text(
        "doris",
        "SELECT `order` FROM `sales` LIMIT 1;",
        Some("sql"),
        Some("mysql"),
    )
    .expect("a generic MySQL-compatible package should use its reviewed parser baseline");
    assert!(mysql_compatible.valid);
    assert_eq!(mysql_compatible.driver, "doris");
}

#[test]
fn syntax_validation_returns_bounded_structured_diagnostics() {
    let invalid = validate_sql_syntax_text("postgres", "SELECT ( FROM users", None, None)
        .expect("invalid syntax is a validation result");
    assert!(!invalid.valid);
    assert_eq!(invalid.statement_count, 0);
    assert_eq!(invalid.diagnostics.len(), 1);
    assert!(!invalid.diagnostics[0].message.contains("sql parser error"));
    assert_eq!(invalid.diagnostics[0].line, Some(1));
    assert!(invalid.diagnostics[0].column.is_some());

    let empty = validate_sql_syntax_text("mysql", " \n", None, None)
        .expect("empty SQL is a validation result");
    assert!(!empty.valid);
    assert_eq!(empty.diagnostics[0].line, Some(1));
    assert!(validate_sql_syntax_text("redis", "GET key", None, None).is_err());
}

#[test]
fn read_only_script_uses_driver_transaction_and_hides_control_results() {
    assert_eq!(
        read_only_transaction_script(DatabaseKind::Postgres, "SELECT 1"),
        "BEGIN READ ONLY;\nSELECT 1\n;\nROLLBACK;"
    );
    assert_eq!(
        read_only_transaction_script(DatabaseKind::Mysql, "SELECT 1;"),
        "START TRANSACTION READ ONLY;\nSELECT 1;\n;\nROLLBACK;"
    );

    let results = vec![
        QueryResult::execution("BEGIN", 0),
        QueryResult::rows(Vec::new(), vec![vec![serde_json::json!(1)]]),
        QueryResult::execution("ROLLBACK", 0),
    ];
    let stripped = strip_read_only_transaction_results(results);
    assert_eq!(stripped.len(), 1);
    assert_eq!(stripped[0].rows, vec![vec![serde_json::json!(1)]]);
}

#[test]
fn generic_database_errors_preserve_only_safe_diagnostic_fields() {
    let error = anyhow::Error::new(sqlx::Error::database(MockDatabaseError));
    let extracted = extracted_database_error(&error).expect("database error");
    let context = query_error_context(
        serde_json::json!({
            "connectionId": "connection-1",
            "queryId": "query-1"
        }),
        Some(&extracted.diagnostic),
    );

    assert_eq!(extracted.message, "duplicate row");
    assert_eq!(
        context["databaseError"],
        serde_json::json!({
            "driver": "database",
            "sqlState": "23505",
            "table": "users",
            "constraint": "users_email_key",
            "kind": "uniqueViolation"
        })
    );
    assert!(context.get("sql").is_none());
    assert!(context.get("connectionString").is_none());
}

#[test]
fn database_error_identifiers_reject_control_characters_and_are_bounded() {
    assert_eq!(
        bounded_database_identifier(Some(" public ")),
        Some("public".into())
    );
    assert_eq!(bounded_database_identifier(Some("unsafe\nname")), None);
    assert_eq!(
        bounded_database_identifier(Some(&"a".repeat(600)))
            .expect("bounded identifier")
            .chars()
            .count(),
        MAX_DATABASE_ERROR_IDENTIFIER_CHARS
    );
}

#[test]
fn native_query_paging_inputs_are_bounded_and_cursor_safe() {
    assert!(validate_native_query_page_size(1, None).is_ok());
    assert!(validate_native_query_page_size(MAX_NATIVE_QUERY_PAGE_SIZE, Some(10)).is_ok());
    assert!(validate_native_query_page_size(0, None).is_err());
    assert!(validate_native_query_page_size(MAX_NATIVE_QUERY_PAGE_SIZE + 1, None).is_err());
    assert!(validate_native_query_page_size(100, Some(0)).is_err());

    assert!(validate_native_query_cursor("aB09_-cursor").is_ok());
    assert!(validate_native_query_cursor("cursor with spaces").is_err());
    assert!(validate_native_query_cursor("../../cursor").is_err());
    assert!(validate_native_query_cursor(&"a".repeat(MAX_NATIVE_QUERY_CURSOR_CHARS + 1)).is_err());
}
