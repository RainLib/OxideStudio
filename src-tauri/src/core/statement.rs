#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryExecutionMode {
    ReturnsRows,
    AffectsRows,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatementScanDialect {
    Mysql,
    Postgres,
    /// T-SQL uses `[identifier]` quoting, including `]]` escapes. Keeping it
    /// separate from the generic/PostgreSQL scanner prevents a semicolon in a
    /// legal SQL Server identifier from changing the current-statement scope.
    SqlServer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqlStatementSpan<'a> {
    pub text: &'a str,
    pub start: usize,
    pub end: usize,
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
    Begin,
    Start,
    Commit,
    Rollback,
    Savepoint,
    Release,
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
            Self::Begin => "BEGIN",
            Self::Start => "START",
            Self::Commit => "COMMIT",
            Self::Rollback => "ROLLBACK",
            Self::Savepoint => "SAVEPOINT",
            Self::Release => "RELEASE",
            Self::Other => "SQL",
        }
    }
}

fn skip_block_comment(sql: &str, mut index: usize, dialect: StatementScanDialect) -> usize {
    debug_assert!(sql[index..].starts_with("/*"));
    index += 2;
    let mut depth = 1usize;

    while index < sql.len() {
        if matches!(
            dialect,
            StatementScanDialect::Postgres | StatementScanDialect::SqlServer
        ) && sql[index..].starts_with("/*")
        {
            depth += 1;
            index += 2;
            continue;
        }

        if sql[index..].starts_with("*/") {
            depth -= 1;
            index += 2;
            if depth == 0 {
                return index;
            }
            continue;
        }

        let Some(ch) = sql[index..].chars().next() else {
            break;
        };
        index += ch.len_utf8();
    }

    sql.len()
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

        if sql[index..].starts_with('#') {
            if let Some(newline) = sql[index + 1..].find('\n') {
                index += newline + 2;
                continue;
            }
            return sql.len();
        }

        if sql[index..].starts_with("/*") {
            index = skip_block_comment(sql, index, StatementScanDialect::Postgres);
            continue;
        }

        return index;
    }
}

/// Separates a vendor execution/routing hint from the leading comment block so
/// callers that wrap a read-only statement can keep the hint attached to the
/// outer statement. Ordinary comments remain with the original SQL.
pub fn split_leading_execution_hint(sql: &str) -> (&str, &str) {
    let mut index = 0usize;
    let mut hint_start = None;

    loop {
        while index < sql.len() {
            let Some(character) = sql[index..].chars().next() else {
                break;
            };
            if !character.is_whitespace() {
                break;
            }
            index += character.len_utf8();
        }

        let rest = &sql[index..];
        if rest.starts_with("--") {
            index += 2;
            while index < sql.len() {
                let character = sql[index..]
                    .chars()
                    .next()
                    .expect("index remains on a character boundary");
                index += character.len_utf8();
                if character == '\n' {
                    break;
                }
            }
            continue;
        }
        if !rest.starts_with("/*") {
            return hint_start
                .map(|start| (&sql[start..index], sql[index..].trim_start()))
                .unwrap_or(("", sql));
        }

        let marker = sql[index + 2..].chars().next();
        if hint_start.is_none() && matches!(marker, Some('+' | '@' | '&')) {
            hint_start = Some(index);
        }
        index = skip_block_comment(sql, index, StatementScanDialect::Postgres);
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
        "BEGIN" => StatementKind::Begin,
        "START" => StatementKind::Start,
        "COMMIT" => StatementKind::Commit,
        "ROLLBACK" => StatementKind::Rollback,
        "SAVEPOINT" => StatementKind::Savepoint,
        "RELEASE" => StatementKind::Release,
        _ => StatementKind::Other,
    }
}

pub fn classify_statement(sql: &str) -> StatementKind {
    classify_keyword(first_keyword(sql).as_str())
}

fn dollar_quote_at(sql: &str, index: usize) -> Option<&str> {
    if sql[..index]
        .chars()
        .next_back()
        .is_some_and(is_identifier_continue)
    {
        return None;
    }

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
    let quote_start = index;
    let postgres_escape_string = dialect == StatementScanDialect::Postgres
        && quote == '\''
        && sql[..quote_start]
            .chars()
            .next_back()
            .is_some_and(|prefix| matches!(prefix, 'e' | 'E'))
        && sql[..quote_start]
            .char_indices()
            .next_back()
            .and_then(|(prefix_index, _)| sql[..prefix_index].chars().next_back())
            .is_none_or(|ch| !is_identifier_continue(ch));
    index += quote.len_utf8();

    while index < sql.len() {
        let Some(ch) = sql[index..].chars().next() else {
            break;
        };
        index += ch.len_utf8();

        if ch == '\\'
            && index < sql.len()
            && ((dialect == StatementScanDialect::Mysql && matches!(quote, '\'' | '"'))
                || postgres_escape_string)
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

fn skip_sqlserver_bracket_identifier(sql: &str, mut index: usize) -> usize {
    debug_assert!(sql[index..].starts_with('['));
    index += '['.len_utf8();

    while index < sql.len() {
        let Some(ch) = sql[index..].chars().next() else {
            break;
        };
        index += ch.len_utf8();
        if ch != ']' {
            continue;
        }
        if sql[index..].starts_with(']') {
            index += ']'.len_utf8();
            continue;
        }
        return index;
    }

    sql.len()
}

fn skip_quoted_or_identifier_region(
    sql: &str,
    index: usize,
    dialect: StatementScanDialect,
) -> Option<usize> {
    let ch = sql[index..].chars().next()?;
    match dialect {
        StatementScanDialect::Mysql if matches!(ch, '\'' | '"' | '`') => {
            Some(skip_quoted_region(sql, index, ch, dialect))
        }
        StatementScanDialect::Postgres if matches!(ch, '\'' | '"') => {
            Some(skip_quoted_region(sql, index, ch, dialect))
        }
        StatementScanDialect::SqlServer if ch == '[' => {
            Some(skip_sqlserver_bracket_identifier(sql, index))
        }
        StatementScanDialect::SqlServer if matches!(ch, '\'' | '"') => {
            Some(skip_quoted_region(sql, index, ch, dialect))
        }
        _ => None,
    }
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
            let end = sql[index + 2..].find("*/")?;
            index += end + 4;
            continue;
        }

        if let Some(tag) = dollar_quote_at(sql, index) {
            let search_start = index + tag.len();
            let end = sql[search_start..].find(tag)?;
            index = search_start + end + tag.len();
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

fn mysql_dash_comment_at(sql: &str, index: usize) -> bool {
    if !sql[index..].starts_with("--") {
        return false;
    }

    sql[index + 2..]
        .chars()
        .next()
        .is_none_or(|ch| ch.is_whitespace() || ch.is_control())
}

fn line_comment_at(sql: &str, index: usize, dialect: StatementScanDialect) -> bool {
    match dialect {
        StatementScanDialect::Postgres | StatementScanDialect::SqlServer => {
            sql[index..].starts_with("--")
        }
        StatementScanDialect::Mysql => {
            sql[index..].starts_with('#') || mysql_dash_comment_at(sql, index)
        }
    }
}

fn skip_line_comment(sql: &str, index: usize) -> usize {
    match sql[index..].find('\n') {
        Some(newline) => index + newline + 1,
        None => sql.len(),
    }
}

fn segment_has_sql(mut segment: &str, dialect: StatementScanDialect) -> bool {
    loop {
        segment = segment.trim_start();
        if segment.is_empty() {
            return false;
        }

        if line_comment_at(segment, 0, dialect) {
            segment = &segment[skip_line_comment(segment, 0)..];
            continue;
        }

        if segment.starts_with("/*") {
            // MySQL version comments are executable SQL rather than ordinary comments.
            if dialect == StatementScanDialect::Mysql && segment.starts_with("/*!") {
                return true;
            }
            let end = skip_block_comment(segment, 0, dialect);
            segment = &segment[end..];
            continue;
        }

        return true;
    }
}

fn mysql_delimiter_directive_at(sql: &str, index: usize) -> Option<(&str, usize)> {
    if index > 0 && !sql[..index].ends_with('\n') {
        return None;
    }

    let line_end = sql[index..]
        .find('\n')
        .map(|offset| index + offset)
        .unwrap_or(sql.len());
    let line = sql[index..line_end].trim();
    let keyword = line.get(.."DELIMITER".len())?;
    if !keyword.eq_ignore_ascii_case("DELIMITER") {
        return None;
    }

    let rest = &line["DELIMITER".len()..];
    if !rest.chars().next().is_some_and(char::is_whitespace) {
        return None;
    }
    let delimiter = rest.trim();
    if delimiter.is_empty() || delimiter.chars().any(char::is_whitespace) {
        return None;
    }

    let next_line = if line_end < sql.len() {
        line_end + '\n'.len_utf8()
    } else {
        line_end
    };
    Some((delimiter, next_line))
}

fn push_statement_span<'a>(
    statements: &mut Vec<SqlStatementSpan<'a>>,
    sql: &'a str,
    start: usize,
    end: usize,
    dialect: StatementScanDialect,
) {
    let raw = &sql[start..end];
    if !segment_has_sql(raw, dialect) {
        return;
    }

    let text = raw.trim();
    let leading_whitespace = raw.find(text).unwrap_or(0);
    let span_start = start + leading_whitespace;
    statements.push(SqlStatementSpan {
        text,
        start: span_start,
        end: span_start + text.len(),
    });
}

pub fn split_sql_statement_spans(
    sql: &str,
    dialect: StatementScanDialect,
) -> Vec<SqlStatementSpan<'_>> {
    let mut statements = Vec::new();
    let mut statement_start = 0;
    let mut index = 0;
    let mut delimiter = ";";

    while index < sql.len() {
        if dialect == StatementScanDialect::Mysql && (index == 0 || sql[..index].ends_with('\n')) {
            if let Some((new_delimiter, next_line)) = mysql_delimiter_directive_at(sql, index) {
                if !segment_has_sql(&sql[statement_start..index], dialect) {
                    delimiter = new_delimiter;
                    index = next_line;
                    statement_start = next_line;
                    continue;
                }
            }
        }

        if line_comment_at(sql, index, dialect) {
            index = skip_line_comment(sql, index);
            continue;
        }

        if sql[index..].starts_with("/*") {
            index = skip_block_comment(sql, index, dialect);
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

        if let Some(end) = skip_quoted_or_identifier_region(sql, index, dialect) {
            index = end;
            continue;
        }

        let Some(ch) = sql[index..].chars().next() else {
            break;
        };

        if sql[index..].starts_with(delimiter) {
            push_statement_span(&mut statements, sql, statement_start, index, dialect);
            index += delimiter.len();
            statement_start = index;
            continue;
        }

        index += ch.len_utf8();
    }

    push_statement_span(&mut statements, sql, statement_start, sql.len(), dialect);

    statements
}

const SOFT_STATEMENT_KEYWORDS: &[&str] = &[
    "SELECT", "WITH", "INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE", "CREATE", "ALTER", "DROP",
    "TRUNCATE", "EXPLAIN", "SHOW", "DESCRIBE", "DESC", "USE", "CALL", "EXEC", "EXECUTE", "BEGIN",
    "COMMIT", "ROLLBACK", "ANALYZE", "VACUUM",
];

fn mask_sql_noise_for_soft_boundaries(sql: &str, dialect: StatementScanDialect) -> String {
    let mut masked = sql.as_bytes().to_vec();
    let mut index = 0usize;
    while index < sql.len() {
        let end = if line_comment_at(sql, index, dialect) {
            skip_line_comment(sql, index)
        } else if sql[index..].starts_with("/*") {
            skip_block_comment(sql, index, dialect)
        } else if dialect == StatementScanDialect::Postgres {
            if let Some(tag) = dollar_quote_at(sql, index) {
                let search_start = index + tag.len();
                sql[search_start..]
                    .find(tag)
                    .map(|offset| search_start + offset + tag.len())
                    .unwrap_or(sql.len())
            } else {
                let Some(ch) = sql[index..].chars().next() else {
                    break;
                };
                let quoted = matches!(ch, '\'' | '"');
                if quoted {
                    skip_quoted_region(sql, index, ch, dialect)
                } else {
                    index += ch.len_utf8();
                    continue;
                }
            }
        } else if let Some(end) = skip_quoted_or_identifier_region(sql, index, dialect) {
            end
        } else {
            let Some(ch) = sql[index..].chars().next() else {
                break;
            };
            index += ch.len_utf8();
            continue;
        };
        for byte in &mut masked[index..end] {
            if !matches!(*byte, b'\n' | b'\r') {
                *byte = b' ';
            }
        }
        index = end;
    }
    // Every replaced byte is ASCII, so the original UTF-8 remains valid.
    String::from_utf8(masked).expect("SQL noise masking preserves UTF-8")
}

fn soft_statement_keyword(line: &str) -> Option<&'static str> {
    let trimmed = line.trim_start();
    let end = trimmed
        .find(|character: char| !(character.is_ascii_alphanumeric() || character == '_'))
        .unwrap_or(trimmed.len());
    let keyword = trimmed.get(..end)?;
    SOFT_STATEMENT_KEYWORDS
        .iter()
        .copied()
        .find(|candidate| keyword.eq_ignore_ascii_case(candidate))
}

fn soft_statement_is_wrapped_continuation(initial: &str, candidate: &str) -> bool {
    match initial {
        "WITH" => matches!(
            candidate,
            "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "MERGE"
        ),
        "INSERT" => matches!(candidate, "SELECT" | "WITH"),
        "EXPLAIN" | "DESCRIBE" | "DESC" => matches!(
            candidate,
            "SELECT" | "WITH" | "INSERT" | "UPDATE" | "DELETE" | "MERGE"
        ),
        "CREATE" => matches!(candidate, "SELECT" | "WITH" | "BEGIN"),
        // ClickHouse ALTER TABLE ... UPDATE is a single mutation statement.
        "ALTER" => candidate == "UPDATE",
        _ => false,
    }
}

fn soft_statement_is_set_continuation(previous_non_empty_line: &str, candidate: &str) -> bool {
    if candidate != "SELECT" {
        return false;
    }
    matches!(
        previous_non_empty_line.trim().to_ascii_uppercase().as_str(),
        "UNION" | "UNION ALL" | "INTERSECT" | "EXCEPT" | "MINUS"
    )
}

/// Split explicit semicolon-delimited statements, then recover only
/// high-confidence top-level query blocks that a user separated with a blank
/// line but forgot to terminate. This is deliberately intended for cursor
/// selection/highlighting, not bulk script execution: a console's Run All
/// action must preserve the database's own statement boundaries.
pub fn split_sql_statement_spans_with_soft_boundaries(
    sql: &str,
    dialect: StatementScanDialect,
) -> Vec<SqlStatementSpan<'_>> {
    let mut statements = Vec::new();
    for hard_span in split_sql_statement_spans(sql, dialect) {
        let source = hard_span.text;
        let masked = mask_sql_noise_for_soft_boundaries(source, dialect);
        let mut start = hard_span.start;
        let mut initial_keyword: Option<&str> = None;
        let mut previous_non_empty_line = "";
        let mut blank_lines = 0usize;
        let mut parenthesis_depth = 0usize;
        let mut line_offset = 0usize;

        for line_with_newline in masked.split_inclusive('\n') {
            let line = line_with_newline
                .strip_suffix('\n')
                .unwrap_or(line_with_newline);
            let trimmed = line.trim();
            let keyword = soft_statement_keyword(line);

            if initial_keyword.is_none() && !trimmed.is_empty() {
                initial_keyword = keyword;
            } else if blank_lines > 0 && parenthesis_depth == 0 {
                if let (Some(initial), Some(candidate)) = (initial_keyword, keyword) {
                    if !soft_statement_is_wrapped_continuation(initial, candidate)
                        && !soft_statement_is_set_continuation(previous_non_empty_line, candidate)
                    {
                        let leading = line.len() - line.trim_start().len();
                        let next_start = hard_span.start + line_offset + leading;
                        push_statement_span(&mut statements, sql, start, next_start, dialect);
                        start = next_start;
                        initial_keyword = Some(candidate);
                    }
                }
            }

            for character in line.chars() {
                match character {
                    '(' => parenthesis_depth += 1,
                    ')' => parenthesis_depth = parenthesis_depth.saturating_sub(1),
                    _ => {}
                }
            }
            if trimmed.is_empty() {
                if initial_keyword.is_some() {
                    blank_lines += 1;
                }
            } else {
                previous_non_empty_line = trimmed;
                blank_lines = 0;
            }
            line_offset += line_with_newline.len();
        }
        push_statement_span(&mut statements, sql, start, hard_span.end, dialect);
    }
    statements
}

pub fn split_sql_statements(sql: &str, dialect: StatementScanDialect) -> Vec<&str> {
    split_sql_statement_spans(sql, dialect)
        .into_iter()
        .map(|statement| statement.text)
        .collect()
}

pub fn has_multiple_statements(sql: &str, dialect: StatementScanDialect) -> bool {
    split_sql_statements(sql, dialect).len() > 1
}

const READ_ONLY_FORBIDDEN_KEYWORDS: &[&str] = &[
    // Data and schema mutation.
    "INSERT",
    "UPDATE",
    "DELETE",
    "MERGE",
    "UPSERT",
    "REPLACE",
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
    "RENAME",
    "COMMENT",
    "GRANT",
    "REVOKE",
    "COPY",
    "LOAD",
    "ATTACH",
    "DETACH",
    // Transaction, session, locking, and executable-code controls. These must
    // never be able to escape the command's enclosing read-only transaction.
    "BEGIN",
    "START",
    "COMMIT",
    "ROLLBACK",
    "SAVEPOINT",
    "RELEASE",
    "TRANSACTION",
    "ABORT",
    "SET",
    "RESET",
    "USE",
    "CALL",
    "EXEC",
    "EXECUTE",
    "PREPARE",
    "DEALLOCATE",
    "DO",
    "PRAGMA",
    "VACUUM",
    "ANALYZE",
    "REFRESH",
    "CLUSTER",
    "REINDEX",
    "LOCK",
    "UNLOCK",
    "SHARE",
    // SELECT INTO creates a PostgreSQL table and MySQL OUTFILE/DUMPFILE writes
    // outside the database transaction.
    "INTO",
    "OUTFILE",
    "DUMPFILE",
];

const READ_ONLY_DANGEROUS_FUNCTIONS: &[&str] = &[
    "BENCHMARK",
    "DBLINK_CONNECT",
    "DBLINK_CONNECT_U",
    "DBLINK_EXEC",
    "GET_LOCK",
    "LAST_INSERT_ID",
    "LOAD_FILE",
    "LO_EXPORT",
    "MASTER_POS_WAIT",
    "NEXTVAL",
    "PG_ADVISORY_LOCK",
    "PG_ADVISORY_UNLOCK",
    "PG_ADVISORY_UNLOCK_ALL",
    "PG_ADVISORY_XACT_LOCK",
    "PG_BACKUP_START",
    "PG_BACKUP_STOP",
    "PG_CANCEL_BACKEND",
    "PG_CREATE_RESTORE_POINT",
    "PG_LOGICAL_EMIT_MESSAGE",
    "PG_NOTIFY",
    "PG_PROMOTE",
    "PG_RELOAD_CONF",
    "PG_ROTATE_LOGFILE",
    "PG_SWITCH_WAL",
    "PG_TERMINATE_BACKEND",
    "PG_TRY_ADVISORY_LOCK",
    "PG_TRY_ADVISORY_XACT_LOCK",
    "PG_WRITE_FILE",
    "RELEASE_ALL_LOCKS",
    "RELEASE_LOCK",
    "SET_CONFIG",
    "SETVAL",
    "SLEEP",
    "SOURCE_POS_WAIT",
    "SYS_EVAL",
    "SYS_EXEC",
];

/// Validate SQL used by the assistant's automatically approved read tool.
///
/// This deliberately accepts one statement only. It uses the same dialect-aware
/// scanner as execution, so comments, dollar quotes, JSON operators, and MySQL
/// escaping cannot hide a second statement or transaction control command.
pub fn validate_read_only_sql(
    sql: &str,
    dialect: StatementScanDialect,
) -> Result<(), &'static str> {
    let statements = split_sql_statements(sql, dialect);
    if statements.len() != 1 {
        return Err("Read-only execution requires exactly one SQL statement");
    }

    let statement = statements[0];
    if contains_dangerous_read_function(statement) {
        return Err(
            "SQL calls a function with session, server, file, lock, or external side effects",
        );
    }
    match execution_statement_kind(statement) {
        StatementKind::Show | StatementKind::Describe => {
            if contains_read_only_forbidden_syntax(statement, dialect, false) {
                return Err("SQL contains executable comment syntax");
            }
            return Ok(());
        }
        StatementKind::Select | StatementKind::Values | StatementKind::Explain => {}
        _ => return Err("Only SELECT, TABLE, VALUES, SHOW, DESCRIBE, or EXPLAIN is allowed"),
    }

    if contains_read_only_forbidden_syntax(statement, dialect, true) {
        return Err("SQL contains mutation, transaction, locking, or external-write syntax");
    }

    Ok(())
}

fn contains_dangerous_read_function(sql: &str) -> bool {
    let normalized = sql.to_ascii_uppercase();
    READ_ONLY_DANGEROUS_FUNCTIONS.iter().any(|name| {
        normalized.match_indices(name).any(|(index, _)| {
            let before = normalized[..index].chars().next_back();
            let mut after = normalized[index + name.len()..].trim_start();
            if after.starts_with('"') || after.starts_with('`') {
                after = after[1..].trim_start();
            }
            !before.is_some_and(is_identifier_continue) && after.starts_with('(')
        })
    })
}

fn contains_read_only_forbidden_syntax(
    sql: &str,
    dialect: StatementScanDialect,
    check_keywords: bool,
) -> bool {
    let mut index = 0;
    while index < sql.len() {
        if line_comment_at(sql, index, dialect) {
            index = skip_line_comment(sql, index);
            continue;
        }
        if sql[index..].starts_with("/*") {
            if dialect == StatementScanDialect::Mysql
                && (sql[index..].starts_with("/*!")
                    || sql[index..]
                        .get(..4)
                        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("/*M!")))
            {
                return true;
            }
            index = skip_block_comment(sql, index, dialect);
            continue;
        }
        if dialect == StatementScanDialect::Postgres {
            if let Some(tag) = dollar_quote_at(sql, index) {
                let search_start = index + tag.len();
                index = sql[search_start..]
                    .find(tag)
                    .map(|end| search_start + end + tag.len())
                    .unwrap_or(sql.len());
                continue;
            }
        }

        if let Some(end) = skip_quoted_or_identifier_region(sql, index, dialect) {
            index = end;
            continue;
        }

        let Some(ch) = sql[index..].chars().next() else {
            break;
        };

        if is_identifier_start(ch) {
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
            if check_keywords
                && READ_ONLY_FORBIDDEN_KEYWORDS
                    .iter()
                    .any(|keyword| sql[start..index].eq_ignore_ascii_case(keyword))
            {
                return true;
            }
            continue;
        }

        index += ch.len_utf8();
    }

    false
}

const FILTER_FORBIDDEN_KEYWORDS: &[&str] = &[
    // Query composition. These tokens turn a predicate into a query, compound query, or CTE.
    "SELECT",
    "WITH",
    "UNION",
    "INTERSECT",
    "EXCEPT",
    "VALUES",
    "TABLE",
    // Data manipulation.
    "INSERT",
    "UPDATE",
    "DELETE",
    "MERGE",
    "UPSERT",
    "REPLACE",
    // Schema and database manipulation.
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
    "RENAME",
    "COMMENT",
    "GRANT",
    "REVOKE",
    "COPY",
    "LOAD",
    "ATTACH",
    "DETACH",
    // Transaction and session control.
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
    "SAVEPOINT",
    "RELEASE",
    "TRANSACTION",
    "ABORT",
    "SET",
    "RESET",
    "USE",
    // Commands which can execute code, change state, or expose data outside a predicate.
    "CALL",
    "EXEC",
    "EXECUTE",
    "PREPARE",
    "DEALLOCATE",
    "DO",
    "PRAGMA",
    "VACUUM",
    "ANALYZE",
    "REFRESH",
    "CLUSTER",
    "REINDEX",
    "LOCK",
    "UNLOCK",
    "SHOW",
    "DESCRIBE",
    "EXPLAIN",
];

const FILTER_TOP_LEVEL_CLAUSE_KEYWORDS: &[&str] = &[
    "WHERE",
    "JOIN",
    "ORDER",
    "GROUP",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "FETCH",
    "RETURNING",
    "INTO",
    "WINDOW",
    "QUALIFY",
    "FOR",
    "PROCEDURE",
];

fn keyword_matches_any(keyword: &str, candidates: &[&str]) -> bool {
    candidates
        .iter()
        .any(|candidate| keyword.eq_ignore_ascii_case(candidate))
}

fn strict_quoted_region_end(
    sql: &str,
    mut index: usize,
    quote: char,
) -> Result<usize, &'static str> {
    index += quote.len_utf8();
    let mut consecutive_backslashes = 0usize;

    while index < sql.len() {
        let Some(ch) = sql[index..].chars().next() else {
            break;
        };
        index += ch.len_utf8();

        if ch == '\\' {
            consecutive_backslashes += 1;
            continue;
        }

        if ch != quote {
            consecutive_backslashes = 0;
            continue;
        }

        // MySQL SQL modes and Postgres escape-string settings disagree about whether a
        // backslash escapes a quote. Reject the ambiguous form so neither interpretation can
        // hide syntax from this scanner. SQL-standard doubled quotes remain supported.
        if consecutive_backslashes % 2 == 1 {
            return Err("Filter SQL cannot contain ambiguous backslash quote escapes");
        }

        if sql[index..].starts_with(quote) {
            index += quote.len_utf8();
            consecutive_backslashes = 0;
            continue;
        }

        return Ok(index);
    }

    Err("Filter SQL contains an unterminated quoted value")
}

fn strict_sqlserver_bracket_identifier_end(
    sql: &str,
    mut index: usize,
) -> Result<usize, &'static str> {
    debug_assert!(sql[index..].starts_with('['));
    index += '['.len_utf8();

    while index < sql.len() {
        let Some(ch) = sql[index..].chars().next() else {
            break;
        };
        index += ch.len_utf8();
        if ch != ']' {
            continue;
        }
        if sql[index..].starts_with(']') {
            index += ']'.len_utf8();
            continue;
        }
        return Ok(index);
    }

    Err("Filter SQL contains an unterminated quoted identifier")
}

/// Validates an untrusted SQL fragment before it is inserted as a table `WHERE` predicate.
///
/// The validator intentionally accepts expressions rather than complete statements. Quoted
/// strings and identifiers are skipped so their contents cannot be mistaken for SQL syntax, but
/// statement separators, comments, subqueries, compound queries, mutation statements, and
/// top-level clauses are rejected.
pub fn validate_sql_filter_expression(
    sql: &str,
    dialect: StatementScanDialect,
) -> Result<(), String> {
    let sql = sql.trim();
    if sql.is_empty() {
        return Err("Filter SQL expression is required".to_string());
    }

    let mut index = 0;
    let mut depth = 0usize;
    let mut saw_token = false;
    let mut saw_expression_content = false;
    let mut accepted_where_prefix = false;

    while index < sql.len() {
        if sql[index..].starts_with("--")
            || sql[index..].starts_with("/*")
            || sql[index..].starts_with("*/")
            || (dialect == StatementScanDialect::Mysql && sql[index..].starts_with('#'))
        {
            return Err("Filter SQL cannot contain SQL comments".to_string());
        }

        if dialect == StatementScanDialect::Postgres {
            if let Some(tag) = dollar_quote_at(sql, index) {
                let search_start = index + tag.len();
                let Some(end) = sql[search_start..].find(tag) else {
                    return Err("Filter SQL contains an unterminated quoted value".to_string());
                };
                index = search_start + end + tag.len();
                saw_token = true;
                saw_expression_content = true;
                continue;
            }
        }

        let Some(ch) = sql[index..].chars().next() else {
            break;
        };

        if dialect == StatementScanDialect::SqlServer && ch == '[' {
            let end =
                strict_sqlserver_bracket_identifier_end(sql, index).map_err(ToString::to_string)?;
            index = end;
            saw_token = true;
            saw_expression_content = true;
            continue;
        }

        let is_quoted_region = match dialect {
            StatementScanDialect::Mysql => matches!(ch, '\'' | '"' | '`'),
            StatementScanDialect::Postgres | StatementScanDialect::SqlServer => {
                matches!(ch, '\'' | '"')
            }
        };
        if is_quoted_region {
            let end = strict_quoted_region_end(sql, index, ch).map_err(ToString::to_string)?;
            index = end;
            saw_token = true;
            saw_expression_content = true;
            continue;
        }

        if ch == ';' {
            return Err("Filter SQL cannot contain statement separators".to_string());
        }

        if ch == '(' {
            depth += 1;
            index += ch.len_utf8();
            saw_token = true;
            saw_expression_content = true;
            continue;
        }

        if ch == ')' {
            if depth == 0 {
                return Err("Filter SQL has unbalanced parentheses".to_string());
            }
            depth -= 1;
            index += ch.len_utf8();
            saw_token = true;
            saw_expression_content = true;
            continue;
        }

        if is_identifier_start(ch) {
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

            let keyword = &sql[start..index];
            if keyword_matches_any(keyword, FILTER_FORBIDDEN_KEYWORDS) {
                return Err(format!(
                    "Filter SQL cannot contain the {keyword} statement or clause"
                ));
            }

            if depth == 0 && keyword.eq_ignore_ascii_case("WHERE") && !saw_token {
                accepted_where_prefix = true;
                saw_token = true;
                continue;
            }

            if depth == 0 && keyword_matches_any(keyword, FILTER_TOP_LEVEL_CLAUSE_KEYWORDS) {
                return Err(format!(
                    "Filter SQL cannot contain the top-level {keyword} clause"
                ));
            }

            saw_token = true;
            saw_expression_content = true;
            continue;
        }

        if !ch.is_whitespace() {
            saw_token = true;
            saw_expression_content = true;
        }
        index += ch.len_utf8();
    }

    if depth != 0 {
        return Err("Filter SQL has unbalanced parentheses".to_string());
    }
    if accepted_where_prefix && !saw_expression_content {
        return Err("Filter SQL requires an expression after WHERE".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        classify_statement, execution_mode, execution_statement_kind, has_multiple_statements,
        split_leading_execution_hint, split_sql_statement_spans,
        split_sql_statement_spans_with_soft_boundaries, split_sql_statements,
        validate_read_only_sql, validate_sql_filter_expression, QueryExecutionMode, StatementKind,
        StatementScanDialect,
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
            execution_mode(
                "with c as materialized (select 1) insert into users(id) select * from c"
            ),
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
            validate_read_only_sql("SHOW /*!50000 WARNINGS */", StatementScanDialect::Mysql)
                .is_err()
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
        assert!(validate_sql_filter_expression(
            "[order;status] = 1",
            StatementScanDialect::SqlServer,
        )
        .is_ok());
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
}
