#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryExecutionMode {
    ReturnsRows,
    AffectsRows,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatementScanDialect {
    Mysql,
    Postgres,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatementKind {
    Select,
    Insert,
    Update,
    Delete,
    Create,
    Alter,
    Drop,
    Truncate,
    Comment,
    Rename,
    Refresh,
    Set,
    Use,
    Show,
    Explain,
    Analyze,
    Vacuum,
    Describe,
    Values,
    With,
    Other,
}

impl StatementKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Select => "SELECT",
            Self::Insert => "INSERT",
            Self::Update => "UPDATE",
            Self::Delete => "DELETE",
            Self::Create => "CREATE",
            Self::Alter => "ALTER",
            Self::Drop => "DROP",
            Self::Truncate => "TRUNCATE",
            Self::Comment => "COMMENT",
            Self::Rename => "RENAME",
            Self::Refresh => "REFRESH",
            Self::Set => "SET",
            Self::Use => "USE",
            Self::Show => "SHOW",
            Self::Explain => "EXPLAIN",
            Self::Analyze => "ANALYZE",
            Self::Vacuum => "VACUUM",
            Self::Describe => "DESCRIBE",
            Self::Values => "VALUES",
            Self::With => "WITH",
            Self::Other => "SQL",
        }
    }
}

fn skip_ws_and_comments(sql: &str, mut index: usize) -> usize {
    loop {
        while index < sql.len() {
            let Some(ch) = sql[index..].chars().next() else {
                return index;
            };
            if !ch.is_whitespace() {
                break;
            }
            index += ch.len_utf8();
        }

        if sql[index..].starts_with("--") {
            if let Some(newline) = sql[index + 2..].find('\n') {
                index += newline + 3;
                continue;
            }
            return sql.len();
        }

        if sql[index..].starts_with("/*") {
            if let Some(end) = sql[index + 2..].find("*/") {
                index += end + 4;
                continue;
            }
            return sql.len();
        }

        return index;
    }
}

fn is_identifier_start(ch: char) -> bool {
    ch == '_' || ch.is_ascii_alphabetic()
}

fn is_identifier_continue(ch: char) -> bool {
    ch == '_' || ch == '$' || ch.is_ascii_alphanumeric()
}

fn read_keyword_at(sql: &str, index: usize) -> Option<(String, usize, usize)> {
    let start = skip_ws_and_comments(sql, index);
    let first = sql[start..].chars().next()?;
    if !is_identifier_start(first) {
        return None;
    }

    let mut end = start + first.len_utf8();
    while end < sql.len() {
        let Some(ch) = sql[end..].chars().next() else {
            break;
        };
        if !is_identifier_continue(ch) {
            break;
        }
        end += ch.len_utf8();
    }

    Some((sql[start..end].to_ascii_uppercase(), start, end))
}

fn consume_keyword(sql: &str, index: usize, expected: &str) -> Option<usize> {
    let (keyword, _, end) = read_keyword_at(sql, index)?;
    if keyword == expected {
        Some(end)
    } else {
        None
    }
}

fn first_keyword_with_offset(sql: &str) -> Option<(String, usize, usize)> {
    let mut index = 0;
    loop {
        index = skip_ws_and_comments(sql, index);
        if sql[index..].starts_with('(') {
            index += 1;
            continue;
        }
        return read_keyword_at(sql, index);
    }
}

fn first_keyword(sql: &str) -> String {
    first_keyword_with_offset(sql)
        .map(|(keyword, _, _)| keyword)
        .unwrap_or_default()
}

fn classify_keyword(keyword: &str) -> StatementKind {
    match keyword {
        "SELECT" | "TABLE" => StatementKind::Select,
        "INSERT" | "UPSERT" | "REPLACE" => StatementKind::Insert,
        "UPDATE" => StatementKind::Update,
        "DELETE" => StatementKind::Delete,
        "CREATE" => StatementKind::Create,
        "ALTER" => StatementKind::Alter,
        "DROP" => StatementKind::Drop,
        "TRUNCATE" => StatementKind::Truncate,
        "COMMENT" => StatementKind::Comment,
        "RENAME" => StatementKind::Rename,
        "REFRESH" => StatementKind::Refresh,
        "SET" => StatementKind::Set,
        "USE" => StatementKind::Use,
        "SHOW" => StatementKind::Show,
        "EXPLAIN" => StatementKind::Explain,
        "ANALYZE" => StatementKind::Analyze,
        "VACUUM" => StatementKind::Vacuum,
        "DESCRIBE" | "DESC" => StatementKind::Describe,
        "VALUES" => StatementKind::Values,
        "WITH" => StatementKind::With,
        _ => StatementKind::Other,
    }
}

pub fn classify_statement(sql: &str) -> StatementKind {
    classify_keyword(first_keyword(sql).as_str())
}

fn dollar_quote_at(sql: &str, index: usize) -> Option<&str> {
    let rest = sql.get(index..)?;
    let bytes = rest.as_bytes();
    if bytes.first() != Some(&b'$') {
        return None;
    }

    let mut end = 1;
    while end < bytes.len() {
        let byte = bytes[end];
        if byte == b'$' {
            return Some(&rest[..=end]);
        }
        if end == 1 && !(byte == b'_' || byte.is_ascii_alphabetic()) {
            return None;
        }
        if end > 1 && !(byte == b'_' || byte.is_ascii_alphanumeric()) {
            return None;
        }
        end += 1;
    }

    None
}

fn skip_quoted_region(
    sql: &str,
    mut index: usize,
    quote: char,
    dialect: StatementScanDialect,
) -> usize {
    index += quote.len_utf8();

    while index < sql.len() {
        let Some(ch) = sql[index..].chars().next() else {
            break;
        };
        index += ch.len_utf8();

        if dialect == StatementScanDialect::Mysql
            && ch == '\\'
            && quote == '\''
            && index < sql.len()
        {
            if let Some(escaped) = sql[index..].chars().next() {
                index += escaped.len_utf8();
            }
            continue;
        }

        if ch == quote {
            if sql[index..].starts_with(quote) {
                index += quote.len_utf8();
                continue;
            }
            break;
        }
    }

    index
}

fn skip_balanced_parentheses(sql: &str, mut index: usize) -> Option<usize> {
    if !sql[index..].starts_with('(') {
        return None;
    }

    let mut depth = 0usize;
    while index < sql.len() {
        if sql[index..].starts_with("--") {
            if let Some(newline) = sql[index + 2..].find('\n') {
                index += newline + 3;
            } else {
                return Some(sql.len());
            }
            continue;
        }

        if sql[index..].starts_with("/*") {
            if let Some(end) = sql[index + 2..].find("*/") {
                index += end + 4;
            } else {
                return None;
            }
            continue;
        }

        if let Some(tag) = dollar_quote_at(sql, index) {
            let search_start = index + tag.len();
            if let Some(end) = sql[search_start..].find(tag) {
                index = search_start + end + tag.len();
            } else {
                return None;
            }
            continue;
        }

        let ch = sql[index..].chars().next()?;
        if matches!(ch, '\'' | '"' | '`') {
            index = skip_quoted_region(sql, index, ch, StatementScanDialect::Mysql);
            continue;
        }

        if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Some(index + ch.len_utf8());
            }
        }

        index += ch.len_utf8();
    }

    None
}

fn skip_cte_identifier(sql: &str, index: usize) -> Option<usize> {
    let index = skip_ws_and_comments(sql, index);
    let ch = sql[index..].chars().next()?;
    if matches!(ch, '"' | '`') {
        return Some(skip_quoted_region(
            sql,
            index,
            ch,
            StatementScanDialect::Mysql,
        ));
    }

    if !is_identifier_start(ch) {
        return None;
    }

    let mut end = index + ch.len_utf8();
    while end < sql.len() {
        let Some(ch) = sql[end..].chars().next() else {
            break;
        };
        if !is_identifier_continue(ch) {
            break;
        }
        end += ch.len_utf8();
    }

    Some(end)
}

fn statement_after_cte_prefix(sql: &str, mut index: usize) -> Option<(StatementKind, usize)> {
    if let Some(end) = consume_keyword(sql, index, "RECURSIVE") {
        index = end;
    }

    loop {
        index = skip_cte_identifier(sql, index)?;
        index = skip_ws_and_comments(sql, index);
        if sql[index..].starts_with('(') {
            index = skip_balanced_parentheses(sql, index)?;
        }

        index = consume_keyword(sql, index, "AS")?;

        if let Some(not_end) = consume_keyword(sql, index, "NOT") {
            index = consume_keyword(sql, not_end, "MATERIALIZED")?;
        } else if let Some(materialized_end) = consume_keyword(sql, index, "MATERIALIZED") {
            index = materialized_end;
        }

        index = skip_ws_and_comments(sql, index);
        index = skip_balanced_parentheses(sql, index)?;
        index = skip_ws_and_comments(sql, index);

        if sql[index..].starts_with(',') {
            index += 1;
            continue;
        }

        let (keyword, start, _) = read_keyword_at(sql, index)?;
        return Some((classify_keyword(keyword.as_str()), start));
    }
}

fn effective_statement_kind_with_offset(sql: &str) -> (StatementKind, usize) {
    let Some((keyword, start, end)) = first_keyword_with_offset(sql) else {
        return (StatementKind::Other, 0);
    };

    let kind = classify_keyword(keyword.as_str());
    if kind == StatementKind::With {
        statement_after_cte_prefix(sql, end).unwrap_or((kind, start))
    } else {
        (kind, start)
    }
}

pub fn execution_statement_kind(sql: &str) -> StatementKind {
    effective_statement_kind_with_offset(sql).0
}

fn has_top_level_keyword_from(sql: &str, mut index: usize, expected: &str) -> bool {
    let mut depth = 0usize;

    while index < sql.len() {
        if sql[index..].starts_with("--") {
            if let Some(newline) = sql[index + 2..].find('\n') {
                index += newline + 3;
            } else {
                return false;
            }
            continue;
        }

        if sql[index..].starts_with("/*") {
            if let Some(end) = sql[index + 2..].find("*/") {
                index += end + 4;
            } else {
                return false;
            }
            continue;
        }

        if let Some(tag) = dollar_quote_at(sql, index) {
            let search_start = index + tag.len();
            if let Some(end) = sql[search_start..].find(tag) {
                index = search_start + end + tag.len();
            } else {
                return false;
            }
            continue;
        }

        let Some(ch) = sql[index..].chars().next() else {
            break;
        };

        if matches!(ch, '\'' | '"' | '`') {
            index = skip_quoted_region(sql, index, ch, StatementScanDialect::Mysql);
            continue;
        }

        if ch == ';' && depth == 0 {
            return false;
        }

        if ch == '(' {
            depth += 1;
            index += ch.len_utf8();
            continue;
        }

        if ch == ')' {
            depth = depth.saturating_sub(1);
            index += ch.len_utf8();
            continue;
        }

        if depth == 0 && is_identifier_start(ch) {
            let start = index;
            index += ch.len_utf8();
            while index < sql.len() {
                let Some(ch) = sql[index..].chars().next() else {
                    break;
                };
                if !is_identifier_continue(ch) {
                    break;
                }
                index += ch.len_utf8();
            }
            if sql[start..index].eq_ignore_ascii_case(expected) {
                return true;
            }
            continue;
        }

        index += ch.len_utf8();
    }

    false
}

pub fn execution_mode(sql: &str) -> QueryExecutionMode {
    let (statement_kind, statement_start) = effective_statement_kind_with_offset(sql);
    let has_returning = has_top_level_keyword_from(sql, statement_start, "RETURNING");

    match statement_kind {
        StatementKind::Select
        | StatementKind::Show
        | StatementKind::Explain
        | StatementKind::Describe
        | StatementKind::Values
        | StatementKind::With => QueryExecutionMode::ReturnsRows,
        StatementKind::Insert | StatementKind::Update | StatementKind::Delete if has_returning => {
            QueryExecutionMode::ReturnsRows
        }
        StatementKind::Other => QueryExecutionMode::ReturnsRows,
        _ => QueryExecutionMode::AffectsRows,
    }
}

fn segment_has_sql(mut segment: &str) -> bool {
    loop {
        segment = segment.trim_start();
        if segment.is_empty() {
            return false;
        }

        if let Some(rest) = segment.strip_prefix("--") {
            if let Some(newline) = rest.find('\n') {
                segment = &rest[newline + 1..];
                continue;
            }
            return false;
        }

        if let Some(rest) = segment.strip_prefix("/*") {
            if let Some(end) = rest.find("*/") {
                segment = &rest[end + 2..];
                continue;
            }
            return false;
        }

        return true;
    }
}

pub fn has_multiple_statements(sql: &str, dialect: StatementScanDialect) -> bool {
    let mut statement_count = 0;
    let mut statement_start = 0;
    let mut index = 0;

    while index < sql.len() {
        if sql[index..].starts_with("--") {
            if let Some(newline) = sql[index + 2..].find('\n') {
                index += newline + 3;
            } else {
                index = sql.len();
            }
            continue;
        }

        if sql[index..].starts_with("/*") {
            if let Some(end) = sql[index + 2..].find("*/") {
                index += end + 4;
            } else {
                index = sql.len();
            }
            continue;
        }

        if dialect == StatementScanDialect::Postgres {
            if let Some(tag) = dollar_quote_at(sql, index) {
                let search_start = index + tag.len();
                if let Some(end) = sql[search_start..].find(tag) {
                    index = search_start + end + tag.len();
                } else {
                    index = sql.len();
                }
                continue;
            }
        }

        let Some(ch) = sql[index..].chars().next() else {
            break;
        };

        let is_quoted_region = match dialect {
            StatementScanDialect::Mysql => matches!(ch, '\'' | '"' | '`'),
            StatementScanDialect::Postgres => matches!(ch, '\'' | '"'),
        };
        if is_quoted_region {
            index = skip_quoted_region(sql, index, ch, dialect);
            continue;
        }

        if ch == ';' {
            if segment_has_sql(&sql[statement_start..index]) {
                statement_count += 1;
                if statement_count > 1 {
                    return true;
                }
            }
            index += ch.len_utf8();
            statement_start = index;
            continue;
        }

        index += ch.len_utf8();
    }

    if segment_has_sql(&sql[statement_start..]) {
        statement_count += 1;
    }

    statement_count > 1
}

#[cfg(test)]
mod tests {
    use super::{
        classify_statement, execution_mode, execution_statement_kind, has_multiple_statements,
        QueryExecutionMode, StatementKind, StatementScanDialect,
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
            execution_mode(
                "with c as materialized (select 1) insert into users(id) select * from c"
            ),
            QueryExecutionMode::AffectsRows
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
}
