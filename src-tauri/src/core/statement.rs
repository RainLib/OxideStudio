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
            Self::Describe => "DESCRIBE",
            Self::Values => "VALUES",
            Self::With => "WITH",
            Self::Other => "SQL",
        }
    }
}

fn strip_leading_comments(mut sql: &str) -> &str {
    loop {
        sql = sql.trim_start();
        if let Some(rest) = sql.strip_prefix("--") {
            if let Some(newline) = rest.find('\n') {
                sql = &rest[newline + 1..];
                continue;
            }
            return "";
        }

        if let Some(rest) = sql.strip_prefix("/*") {
            if let Some(end) = rest.find("*/") {
                sql = &rest[end + 2..];
                continue;
            }
            return "";
        }

        return sql;
    }
}

fn first_keyword(sql: &str) -> String {
    strip_leading_comments(sql)
        .chars()
        .skip_while(|ch| ch.is_whitespace() || *ch == '(')
        .take_while(|ch| ch.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_uppercase()
}

pub fn classify_statement(sql: &str) -> StatementKind {
    match first_keyword(sql).as_str() {
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
        "EXPLAIN" | "ANALYZE" => StatementKind::Explain,
        "DESCRIBE" | "DESC" => StatementKind::Describe,
        "VALUES" => StatementKind::Values,
        "WITH" => StatementKind::With,
        _ => StatementKind::Other,
    }
}

pub fn execution_mode(sql: &str) -> QueryExecutionMode {
    let normalized = strip_leading_comments(sql).to_ascii_uppercase();
    let has_returning = normalized.contains(" RETURNING ");

    match classify_statement(sql) {
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
        classify_statement, execution_mode, has_multiple_statements, QueryExecutionMode,
        StatementKind, StatementScanDialect,
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
