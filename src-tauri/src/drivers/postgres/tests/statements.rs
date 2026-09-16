use crate::core::statement::has_multiple_statements;
use crate::core::statement::StatementScanDialect;

#[test]
fn postgres_multi_statement_detection_ignores_comments_and_literals() {
    assert!(has_multiple_statements(
        "SELECT 1; CREATE TEMP TABLE oxide_pg_multi(id integer)",
        StatementScanDialect::Postgres
    ));
    assert!(has_multiple_statements(
        "CREATE FUNCTION f() RETURNS integer LANGUAGE SQL AS $$ SELECT 1; $$; SELECT f();",
        StatementScanDialect::Postgres
    ));
    assert!(!has_multiple_statements(
        "SELECT ';' AS semicolon;",
        StatementScanDialect::Postgres
    ));
    assert!(!has_multiple_statements(
        "SELECT 1 /* ; */ -- ;\n;",
        StatementScanDialect::Postgres
    ));
    assert!(!has_multiple_statements(
        "CREATE FUNCTION f() RETURNS integer LANGUAGE SQL AS $$ SELECT 1; $$;",
        StatementScanDialect::Postgres
    ));
}
