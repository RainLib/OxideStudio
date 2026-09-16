use super::types::{QueryExecutionMode, SqlStatementSpan, StatementKind, StatementScanDialect};

pub(super) fn skip_block_comment(
    sql: &str,
    mut index: usize,
    dialect: StatementScanDialect,
) -> usize {
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

pub(super) fn skip_ws_and_comments(sql: &str, mut index: usize) -> usize {
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

pub(super) fn is_identifier_start(ch: char) -> bool {
    ch == '_' || ch.is_ascii_alphabetic()
}

pub(super) fn is_identifier_continue(ch: char) -> bool {
    ch == '_' || ch == '$' || ch.is_ascii_alphanumeric()
}

pub(super) fn read_keyword_at(sql: &str, index: usize) -> Option<(String, usize, usize)> {
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

pub(super) fn consume_keyword(sql: &str, index: usize, expected: &str) -> Option<usize> {
    let (keyword, _, end) = read_keyword_at(sql, index)?;
    if keyword == expected {
        Some(end)
    } else {
        None
    }
}

pub(super) fn first_keyword_with_offset(sql: &str) -> Option<(String, usize, usize)> {
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

pub(super) fn first_keyword(sql: &str) -> String {
    first_keyword_with_offset(sql)
        .map(|(keyword, _, _)| keyword)
        .unwrap_or_default()
}

pub(super) fn classify_keyword(keyword: &str) -> StatementKind {
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

pub(super) fn dollar_quote_at(sql: &str, index: usize) -> Option<&str> {
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

pub(super) fn skip_quoted_region(
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

pub(super) fn skip_sqlserver_bracket_identifier(sql: &str, mut index: usize) -> usize {
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

pub(super) fn skip_quoted_or_identifier_region(
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

pub(super) fn skip_balanced_parentheses(sql: &str, mut index: usize) -> Option<usize> {
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

pub(super) fn skip_cte_identifier(sql: &str, index: usize) -> Option<usize> {
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

pub(super) fn statement_after_cte_prefix(
    sql: &str,
    mut index: usize,
) -> Option<(StatementKind, usize)> {
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

pub(super) fn effective_statement_kind_with_offset(sql: &str) -> (StatementKind, usize) {
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

pub(super) fn has_top_level_keyword_from(sql: &str, mut index: usize, expected: &str) -> bool {
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

pub(super) fn mysql_dash_comment_at(sql: &str, index: usize) -> bool {
    if !sql[index..].starts_with("--") {
        return false;
    }

    sql[index + 2..]
        .chars()
        .next()
        .is_none_or(|ch| ch.is_whitespace() || ch.is_control())
}

pub(super) fn line_comment_at(sql: &str, index: usize, dialect: StatementScanDialect) -> bool {
    match dialect {
        StatementScanDialect::Postgres | StatementScanDialect::SqlServer => {
            sql[index..].starts_with("--")
        }
        StatementScanDialect::Mysql => {
            sql[index..].starts_with('#') || mysql_dash_comment_at(sql, index)
        }
    }
}

pub(super) fn skip_line_comment(sql: &str, index: usize) -> usize {
    match sql[index..].find('\n') {
        Some(newline) => index + newline + 1,
        None => sql.len(),
    }
}

pub(super) fn segment_has_sql(mut segment: &str, dialect: StatementScanDialect) -> bool {
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

pub(super) fn mysql_delimiter_directive_at(sql: &str, index: usize) -> Option<(&str, usize)> {
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

pub(super) fn push_statement_span<'a>(
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum MysqlRoutineBlock {
    Begin,
    Case,
}

#[derive(Debug, Default)]
pub(super) struct MysqlRoutineScan {
    word_count: usize,
    routine_ddl: Option<bool>,
    blocks: Vec<MysqlRoutineBlock>,
    saw_begin: bool,
    last_word_was_end: bool,
    pending_end: bool,
}

impl MysqlRoutineScan {
    fn observe_word(&mut self, word: &str) {
        self.word_count += 1;
        if self.word_count == 1 {
            self.routine_ddl = Some(word.eq_ignore_ascii_case("CREATE"));
        } else if self.word_count <= 16 && self.routine_ddl == Some(true) {
            if mysql_routine_object_type(word) {
                // Keep scanning the body, but no longer let a later non-routine
                // word invalidate the already identified CREATE target.
                self.routine_ddl = None;
            } else if mysql_non_routine_create_type(word) {
                self.routine_ddl = Some(false);
            }
        }

        let is_routine = self.routine_ddl.is_none();
        if !is_routine {
            self.last_word_was_end = word.eq_ignore_ascii_case("END");
            return;
        }

        if self.pending_end {
            if word.eq_ignore_ascii_case("CASE") {
                if self.blocks.last() == Some(&MysqlRoutineBlock::Case) {
                    self.blocks.pop();
                }
            } else if !mysql_control_block_suffix(word) {
                self.blocks.pop();
            }
            self.pending_end = false;
        }

        if word.eq_ignore_ascii_case("BEGIN") {
            if !self.last_word_was_end {
                self.saw_begin = true;
                self.blocks.push(MysqlRoutineBlock::Begin);
            }
        } else if word.eq_ignore_ascii_case("CASE") {
            if !self.last_word_was_end {
                self.blocks.push(MysqlRoutineBlock::Case);
            }
        } else if word.eq_ignore_ascii_case("END") && self.saw_begin {
            // END needs one word of lookahead to distinguish END CASE/IF/etc.
            self.pending_end = true;
        }
        self.last_word_was_end = word.eq_ignore_ascii_case("END");
    }

    /// Returns true when this semicolon is internal to an identified compound
    /// routine and the outer BEGIN block is still open.
    fn observe_semicolon(&mut self) -> bool {
        if self.routine_ddl.is_some() || !self.saw_begin {
            self.last_word_was_end = false;
            return false;
        }
        if self.pending_end {
            self.blocks.pop();
            self.pending_end = false;
        }
        self.last_word_was_end = false;
        !self.blocks.is_empty()
    }
}

pub(super) fn mysql_routine_object_type(word: &str) -> bool {
    ["PROCEDURE", "FUNCTION", "TRIGGER", "EVENT"]
        .iter()
        .any(|candidate| word.eq_ignore_ascii_case(candidate))
}

pub(super) fn mysql_non_routine_create_type(word: &str) -> bool {
    [
        "DATABASE",
        "INDEX",
        "LOGFILE",
        "ROLE",
        "SCHEMA",
        "SERVER",
        "SPATIAL",
        "TABLE",
        "TEMPORARY",
        "UNIQUE",
        "USER",
        "VIEW",
    ]
    .iter()
    .any(|candidate| word.eq_ignore_ascii_case(candidate))
}

pub(super) fn mysql_control_block_suffix(word: &str) -> bool {
    ["IF", "LOOP", "REPEAT", "WHILE"]
        .iter()
        .any(|candidate| word.eq_ignore_ascii_case(candidate))
}

pub(super) fn mysql_routine_word_end(sql: &str, index: usize) -> Option<usize> {
    let first = sql[index..].chars().next()?;
    if !first.is_ascii_alphabetic() && first != '_' {
        return None;
    }
    let mut end = index + first.len_utf8();
    for character in sql[end..].chars() {
        if !character.is_ascii_alphanumeric() && character != '_' && character != '$' {
            break;
        }
        end += character.len_utf8();
    }
    Some(end)
}

pub fn split_sql_statement_spans(
    sql: &str,
    dialect: StatementScanDialect,
) -> Vec<SqlStatementSpan<'_>> {
    let mut statements = Vec::new();
    let mut statement_start = 0;
    let mut index = 0;
    let mut delimiter = ";";
    let mut mysql_routine_scan = MysqlRoutineScan::default();

    while index < sql.len() {
        if dialect == StatementScanDialect::Mysql && (index == 0 || sql[..index].ends_with('\n')) {
            if let Some((new_delimiter, next_line)) = mysql_delimiter_directive_at(sql, index) {
                if !segment_has_sql(&sql[statement_start..index], dialect) {
                    delimiter = new_delimiter;
                    index = next_line;
                    statement_start = next_line;
                    mysql_routine_scan = MysqlRoutineScan::default();
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

        if dialect == StatementScanDialect::Mysql && delimiter == ";" {
            if let Some(word_end) = mysql_routine_word_end(sql, index) {
                mysql_routine_scan.observe_word(&sql[index..word_end]);
                index = word_end;
                continue;
            }
        }

        if sql[index..].starts_with(delimiter) {
            if dialect == StatementScanDialect::Mysql
                && delimiter == ";"
                && mysql_routine_scan.observe_semicolon()
            {
                index += delimiter.len();
                continue;
            }
            push_statement_span(&mut statements, sql, statement_start, index, dialect);
            index += delimiter.len();
            statement_start = index;
            mysql_routine_scan = MysqlRoutineScan::default();
            continue;
        }

        index += ch.len_utf8();
    }

    push_statement_span(&mut statements, sql, statement_start, sql.len(), dialect);

    statements
}
