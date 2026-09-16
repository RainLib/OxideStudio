use super::{
    classify_statement, execution_mode, execution_statement_kind, has_multiple_statements,
    split_leading_execution_hint, split_sql_statement_spans,
    split_sql_statement_spans_with_soft_boundaries, split_sql_statements, validate_read_only_sql,
    validate_sql_filter_expression, QueryExecutionMode, StatementKind, StatementScanDialect,
};

#[test]
fn classifies_leading_comments() {
    assert_eq!(
        classify_statement("-- hi\nselect * from users"),
        StatementKind::Select
    );
    assert_eq!(
        classify_statement("/* hi */ update users set name = 'x'"),
        StatementKind::Update
    );
    assert_eq!(
        classify_statement("explain analyze select * from users"),
        StatementKind::Explain
    );
    assert_eq!(classify_statement("analyze users"), StatementKind::Analyze);
}

#[test]
fn splits_only_supported_leading_execution_hints() {
    for hint in ["/*+ optimizer */", "/*@global:true*/", "/*& tenant:'a' */"] {
        let sql = format!("-- report\n{hint}\nSELECT 1");
        let (prefix, statement) = split_leading_execution_hint(&sql);
        assert_eq!(prefix, format!("{hint}\n"));
        assert_eq!(statement, "SELECT 1");
    }

    let ordinary = "/* report */\nSELECT 1";
    assert_eq!(split_leading_execution_hint(ordinary), ("", ordinary));
}

#[test]
fn chooses_execution_mode() {
    assert_eq!(execution_mode("select 1"), QueryExecutionMode::ReturnsRows);
    assert_eq!(
        execution_mode("insert into users(name) values ('a')"),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(
        execution_mode("update users set name = 'a' returning id"),
        QueryExecutionMode::ReturnsRows
    );
    assert_eq!(
        execution_mode("comment on table users is 'app users'"),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(
        execution_mode("rename table old_users to users"),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(
        execution_mode("refresh materialized view active_users_mv"),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(
        execution_mode("set search_path to app"),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(
        execution_mode("analyze users"),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(
        execution_mode("vacuum users"),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(execution_mode("BEGIN"), QueryExecutionMode::AffectsRows);
    assert_eq!(execution_mode("COMMIT"), QueryExecutionMode::AffectsRows);
    assert_eq!(
        execution_mode("ROLLBACK TO SAVEPOINT before_edit"),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(
        execution_mode("# client comment\nSTART TRANSACTION"),
        QueryExecutionMode::AffectsRows
    );
}

#[test]
fn detects_dml_returning_as_top_level_keyword() {
    assert_eq!(
        execution_mode("insert into users(name) values ('a')\nreturning id"),
        QueryExecutionMode::ReturnsRows
    );
    assert_eq!(
        execution_mode("update users set note = 'RETURNING' where id = 1"),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(
        execution_mode("delete from users where note = /* RETURNING */ 'x'"),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(
        execution_mode("update users set name = 'a' returning id; select 1"),
        QueryExecutionMode::ReturnsRows
    );
}

#[test]
fn derives_execution_kind_from_cte_body_statement() {
    assert_eq!(
        execution_statement_kind("with c as (select 1) update users set name = 'a'"),
        StatementKind::Update
    );
    assert_eq!(
        execution_mode("with c as (select 1) update users set name = 'a'"),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(
        execution_mode("with c as (select 1) update users set name = 'a' returning id"),
        QueryExecutionMode::ReturnsRows
    );
    assert_eq!(
        execution_mode(
            "with moved as (delete from old_users returning id) \
             insert into archived_users(id) select id from moved"
        ),
        QueryExecutionMode::AffectsRows
    );
    assert_eq!(
        execution_mode(
            "with recursive c(n) as (select 1 union all select n + 1 from c where n < 3) \
             select * from c"
        ),
        QueryExecutionMode::ReturnsRows
    );
    assert_eq!(
        execution_mode("with c as materialized (select 1) insert into users(id) select * from c"),
        QueryExecutionMode::AffectsRows
    );
}

#[test]
fn validates_assistant_read_only_sql_with_dialect_aware_boundaries() {
    for sql in [
        "SELECT * FROM users",
        "WITH active AS (SELECT * FROM users) SELECT * FROM active",
        "SELECT payload #> '{enabled}' FROM events",
        "SELECT payload ? 'enabled' FROM events",
        "SELECT '-- COMMIT; DELETE FROM users' AS note",
        "SELECT $body$; COMMIT; DELETE FROM users$body$ AS body",
        "SHOW CREATE TABLE users",
    ] {
        assert!(
            validate_read_only_sql(sql, StatementScanDialect::Postgres).is_ok(),
            "rejected safe PostgreSQL SQL: {sql}"
        );
    }

    for sql in [
        "SELECT * INTO backup_users FROM users",
        "WITH active AS (SELECT * FROM users) SELECT * INTO backup_users FROM active",
        "SELECT '{}'::jsonb #> '{}'; COMMIT; DELETE FROM users",
        "SELECT 1; SELECT 2",
        "SELECT * FROM users FOR UPDATE",
        "EXPLAIN ANALYZE DELETE FROM users",
    ] {
        assert!(
            validate_read_only_sql(sql, StatementScanDialect::Postgres).is_err(),
            "accepted unsafe PostgreSQL SQL: {sql}"
        );
    }

    assert!(validate_read_only_sql(
        "SELECT 1--1; COMMIT; DELETE FROM users",
        StatementScanDialect::Mysql
    )
    .is_err());
    assert!(validate_read_only_sql(
        "SELECT email INTO OUTFILE '/tmp/users.csv' FROM users",
        StatementScanDialect::Mysql
    )
    .is_err());
    assert!(validate_read_only_sql(
        "SELECT 1 /*! INTO OUTFILE '/tmp/users.csv' */",
        StatementScanDialect::Mysql
    )
    .is_err());
    assert!(
        validate_read_only_sql("SHOW /*!50000 WARNINGS */", StatementScanDialect::Mysql).is_err()
    );
    for sql in [
        "SELECT pg_write_file('/tmp/x', 'data')",
        "SELECT pg_terminate_backend(42)",
        "SELECT \"lo_export\"(123, '/tmp/large-object')",
        "SELECT \"lo_export\" (123, '/tmp/large-object')",
        "SELECT sys_exec('touch /tmp/x')",
    ] {
        assert!(
            validate_read_only_sql(sql, StatementScanDialect::Postgres).is_err(),
            "accepted dangerous read function: {sql}"
        );
    }
}

#[test]
fn sqlserver_bracket_identifiers_preserve_statement_and_filter_boundaries() {
    let sql = "SELECT [semi;colon] FROM [dbo].[orders]; SELECT 2";
    assert_eq!(
        split_sql_statements(sql, StatementScanDialect::SqlServer),
        vec!["SELECT [semi;colon] FROM [dbo].[orders]", "SELECT 2"]
    );
    assert!(validate_read_only_sql(
        "SELECT [DELETE;] FROM [dbo].[orders]",
        StatementScanDialect::SqlServer,
    )
    .is_ok());
    assert!(
        validate_sql_filter_expression("[order;status] = 1", StatementScanDialect::SqlServer,)
            .is_ok()
    );
}

#[test]
fn detects_mysql_multi_statement_scripts() {
    assert!(has_multiple_statements(
        "SELECT 1; CREATE TABLE users(id INT)",
        StatementScanDialect::Mysql
    ));
    assert!(has_multiple_statements(
        "SELECT ';' AS semicolon; UPDATE users SET name = 'a'",
        StatementScanDialect::Mysql
    ));
    assert!(!has_multiple_statements(
        "SELECT ';' AS semicolon;",
        StatementScanDialect::Mysql
    ));
    assert!(!has_multiple_statements(
        "SELECT 1 /* ; */ -- ;\n;",
        StatementScanDialect::Mysql
    ));
    assert!(!has_multiple_statements(
        "SELECT `semi;colon` FROM users;",
        StatementScanDialect::Mysql
    ));
}

#[test]
fn detects_postgres_multi_statement_scripts() {
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

#[test]
fn splits_scripts_without_cutting_quoted_or_commented_semicolons() {
    assert_eq!(
        split_sql_statements(
            "-- before\nSELECT '中;文'; /* separator ; */ UPDATE t SET note = 'x;y';",
            StatementScanDialect::Postgres,
        ),
        vec![
            "-- before\nSELECT '中;文'",
            "/* separator ; */ UPDATE t SET note = 'x;y'",
        ]
    );
    assert_eq!(
        split_sql_statements(
            "CREATE FUNCTION f() RETURNS integer LANGUAGE SQL AS $body$ SELECT 1; $body$; SELECT f()",
            StatementScanDialect::Postgres,
        ),
        vec![
            "CREATE FUNCTION f() RETURNS integer LANGUAGE SQL AS $body$ SELECT 1; $body$",
            "SELECT f()",
        ]
    );
    assert_eq!(
        split_sql_statements(
            "SELECT `semi;colon` FROM t; SELECT \"also;one\"",
            StatementScanDialect::Mysql,
        ),
        vec!["SELECT `semi;colon` FROM t", "SELECT \"also;one\""]
    );
}

#[test]
fn statement_spans_preserve_utf8_byte_boundaries_and_trimmed_offsets() {
    let sql = "  SELECT '中文';\n\n  UPDATE users SET name = 'x';  ";
    let statements = split_sql_statement_spans(sql, StatementScanDialect::Postgres);

    assert_eq!(statements.len(), 2);
    assert_eq!(statements[0].text, "SELECT '中文'");
    assert_eq!(
        &sql[statements[0].start..statements[0].end],
        statements[0].text
    );
    assert_eq!(statements[1].text, "UPDATE users SET name = 'x'");
    assert_eq!(
        &sql[statements[1].start..statements[1].end],
        statements[1].text
    );
}

#[test]
fn soft_boundaries_recover_blank_line_separated_top_level_queries() {
    let sql = "SELECT * FROM first_table\n\nSELECT * FROM second_table";
    let statements =
        split_sql_statement_spans_with_soft_boundaries(sql, StatementScanDialect::Postgres);

    assert_eq!(statements.len(), 2);
    assert_eq!(statements[0].text, "SELECT * FROM first_table");
    assert_eq!(statements[1].text, "SELECT * FROM second_table");
}

#[test]
fn soft_boundaries_keep_wrapped_nested_and_set_queries_together() {
    for sql in [
        "WITH recent AS (\n  SELECT 1\n)\n\nSELECT * FROM recent",
        "SELECT * FROM (\n\n  SELECT * FROM nested\n) nested_query",
        "SELECT 1\nUNION ALL\n\nSELECT 2",
        "SELECT '-- SELECT'\n\n/* SELECT */\nFROM logs",
    ] {
        let statements =
            split_sql_statement_spans_with_soft_boundaries(sql, StatementScanDialect::Postgres);
        assert_eq!(statements.len(), 1, "should not split: {sql}");
    }
}

#[test]
fn splits_mysql_comments_and_escaped_strings_using_mysql_lexing_rules() {
    assert_eq!(
        split_sql_statements(
            "SELECT 1 # ignored ;\n; -- ignored ;\nSELECT \"semi\\\";colon\"; SELECT 3",
            StatementScanDialect::Mysql,
        ),
        vec![
            "SELECT 1 # ignored ;",
            "-- ignored ;\nSELECT \"semi\\\";colon\"",
            "SELECT 3",
        ]
    );
    assert_eq!(
        split_sql_statements("SELECT 1--2; SELECT 3", StatementScanDialect::Mysql),
        vec!["SELECT 1--2", "SELECT 3"]
    );
    assert!(split_sql_statements(
        "# comment ;\n/* another ; */ ;",
        StatementScanDialect::Mysql
    )
    .is_empty());
}

#[test]
fn splits_mysql_routine_ddl_with_delimiter_directives() {
    assert_eq!(
        split_sql_statements(
            "DELIMITER //\n\
             CREATE PROCEDURE refresh_users()\n\
             BEGIN\n\
               UPDATE users SET refreshed = 1;\n\
               INSERT INTO audit_log(message) VALUES ('refreshed; users');\n\
             END//\n\
             delimiter ;\n\
             SELECT 1;",
            StatementScanDialect::Mysql,
        ),
        vec![
            "CREATE PROCEDURE refresh_users()\n\
             BEGIN\n\
               UPDATE users SET refreshed = 1;\n\
               INSERT INTO audit_log(message) VALUES ('refreshed; users');\n\
             END",
            "SELECT 1",
        ]
    );
}

#[test]
fn keeps_mysql_compound_routine_bodies_without_delimiter_directives() {
    assert_eq!(
        split_sql_statements(
            "CREATE DEFINER = app_user PROCEDURE refresh_users()\n\
             BEGIN\n\
               UPDATE users SET refreshed = 1;\n\
               IF ROW_COUNT() > 0 THEN\n\
                 INSERT INTO audit_log(message) VALUES ('updated; users');\n\
               END IF;\n\
               CASE 1 WHEN 1 THEN SET @done = 1; END CASE;\n\
             END;\n\
             SELECT 1;",
            StatementScanDialect::Mysql,
        ),
        vec![
            "CREATE DEFINER = app_user PROCEDURE refresh_users()\n\
             BEGIN\n\
               UPDATE users SET refreshed = 1;\n\
               IF ROW_COUNT() > 0 THEN\n\
                 INSERT INTO audit_log(message) VALUES ('updated; users');\n\
               END IF;\n\
               CASE 1 WHEN 1 THEN SET @done = 1; END CASE;\n\
             END",
            "SELECT 1",
        ]
    );
}

#[test]
fn mysql_compound_routine_scan_is_single_pass_for_large_bodies() {
    let mut sql = String::from("CREATE PROCEDURE bulk_refresh()\nBEGIN\n");
    for index in 0..20_000 {
        sql.push_str(&format!("SET @value = {index};\n"));
    }
    sql.push_str("END;\nSELECT 2;");

    let statements = split_sql_statement_spans(&sql, StatementScanDialect::Mysql);
    assert_eq!(statements.len(), 2);
    assert!(statements[0]
        .text
        .starts_with("CREATE PROCEDURE bulk_refresh"));
    assert!(statements[0].text.ends_with("END"));
    assert_eq!(statements[1].text, "SELECT 2");
}

#[test]
fn mysql_non_routine_create_statements_keep_normal_semicolon_boundaries() {
    assert_eq!(
        split_sql_statements(
            "CREATE TABLE events (id BIGINT); INSERT INTO events VALUES (1);",
            StatementScanDialect::Mysql,
        ),
        vec![
            "CREATE TABLE events (id BIGINT)",
            "INSERT INTO events VALUES (1)",
        ]
    );
}

#[test]
fn splits_postgres_nested_comments_escape_strings_and_dollar_identifiers() {
    assert_eq!(
        split_sql_statements(
            "/* outer ; /* inner ; */ still outer ; */ SELECT E'one\\';two'; SELECT 2",
            StatementScanDialect::Postgres,
        ),
        vec![
            "/* outer ; /* inner ; */ still outer ; */ SELECT E'one\\';two'",
            "SELECT 2",
        ]
    );
    assert_eq!(
        split_sql_statements(
            "SELECT identifier$tag$; SELECT $tag$body;still body$tag$",
            StatementScanDialect::Postgres,
        ),
        vec!["SELECT identifier$tag$", "SELECT $tag$body;still body$tag$",]
    );
    assert!(split_sql_statements(
        "/* outer ; /* inner ; */ still outer ; */",
        StatementScanDialect::Postgres
    )
    .is_empty());
}

#[test]
fn accepts_common_single_filter_expressions() {
    for filter in [
        "active = true AND age >= 18",
        "WHERE status IN ('active', 'pending')",
        "name LIKE '%semi;colon%' AND note = '-- not a comment'",
        "created_at >= NOW() - INTERVAL '7 days'",
        "EXTRACT(year FROM created_at) = 2026",
        "external_id IS DISTINCT FROM legacy_id",
        r#"metadata->>'kind' = 'customer'"#,
        r#""semi;colon" = 'value'"#,
        "label = $$DELETE; -- text only$$",
    ] {
        assert!(
            validate_sql_filter_expression(filter, StatementScanDialect::Postgres).is_ok(),
            "expected a valid Postgres filter: {filter}"
        );
    }

    for filter in [
        "active = 1 AND age >= 18",
        "WHERE status IN ('active', 'pending')",
        "name LIKE '%semi;colon%' AND note = '/* not a comment */'",
        "`semi;colon` = 'value'",
    ] {
        assert!(
            validate_sql_filter_expression(filter, StatementScanDialect::Mysql).is_ok(),
            "expected a valid MySQL filter: {filter}"
        );
    }
}

#[test]
fn rejects_filter_statement_separators_and_comments() {
    for filter in [
        "id = 1; DELETE FROM users",
        "id IN (1; 2)",
        "id = 1 -- ignore the appended LIMIT",
        "id = 1 /* ignore the appended LIMIT */",
        "id = 1 */ DELETE FROM users /*",
    ] {
        assert!(
            validate_sql_filter_expression(filter, StatementScanDialect::Postgres).is_err(),
            "expected an invalid Postgres filter: {filter}"
        );
    }

    assert!(validate_sql_filter_expression(
        "id = 1 # ignore the appended LIMIT",
        StatementScanDialect::Mysql
    )
    .is_err());
}

#[test]
fn rejects_filter_statements_unions_and_subqueries() {
    for filter in [
        "id = 1 OR DELETE FROM users",
        "id = 1 UNION SELECT password FROM users",
        "id IN (SELECT id FROM admins)",
        "EXISTS (WITH admins AS (SELECT id FROM users) SELECT 1 FROM admins)",
        "id = 1 RETURNING secret",
        "id = 1 ORDER BY secret",
        "BEGIN TRANSACTION",
        "DROP TABLE users",
    ] {
        assert!(
            validate_sql_filter_expression(filter, StatementScanDialect::Postgres).is_err(),
            "expected an invalid Postgres filter: {filter}"
        );
    }
}

#[test]
fn rejects_malformed_filter_boundaries() {
    for filter in [
        "WHERE",
        "(id = 1",
        "id = 1)",
        "note = 'unterminated",
        r#"note = 'safe\' OR id = '; DELETE FROM users; -- '"#,
        r#"note = E'safe\' OR id = '; DELETE FROM users; -- '"#,
    ] {
        assert!(
            validate_sql_filter_expression(filter, StatementScanDialect::Postgres).is_err(),
            "expected an invalid Postgres filter: {filter}"
        );
    }
}
