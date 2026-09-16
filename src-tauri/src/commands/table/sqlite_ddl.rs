//! Sqlite ddl for table operations.

use crate::core::dialect::database_spec_for_driver;
use crate::core::dialect::DatabaseKind;
use crate::core::statement::split_sql_statements;
use crate::core::statement::StatementScanDialect;

pub(super) fn is_sqlite_driver(driver: &str) -> bool {
    database_spec_for_driver(driver).is_some_and(|spec| spec.driver.eq_ignore_ascii_case("sqlite"))
}

pub(super) fn sqlite_quote_identifier(value: &str) -> String {
    // SQLite shares ANSI double-quoted identifier rules with PostgreSQL.  Keep
    // this local rather than expanding DatabaseKind: its many Postgres/MySQL
    // helpers encode DDL semantics SQLite does not share.
    DatabaseKind::Postgres.quote_identifier(value.trim())
}

pub(super) fn sqlite_qualified_relation(schema: &str, relation: &str) -> Result<String, String> {
    let relation = relation.trim();
    if relation.is_empty() {
        return Err("Table name is required".to_string());
    }
    let relation = sqlite_quote_identifier(relation);
    match schema.trim() {
        "" => Ok(relation),
        schema => Ok(format!("{}.{}", sqlite_quote_identifier(schema), relation)),
    }
}

pub(super) fn normalized_sqlite_schema(schema: &str) -> &str {
    let schema = schema.trim();
    if schema.is_empty() {
        "main"
    } else {
        schema
    }
}

pub(super) fn sqlite_qualified_index(schema: &str, index: &str) -> Result<String, String> {
    let index = index.trim();
    if index.is_empty() {
        return Err("Index name is required".to_string());
    }
    let index = sqlite_quote_identifier(index);
    match schema.trim() {
        "" => Ok(index),
        schema => Ok(format!("{}.{}", sqlite_quote_identifier(schema), index)),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum SqliteCatalogDdlKind {
    Table,
    Index { unique: bool },
}

pub(super) fn sqlite_catalog_prefix_tokens(prefix: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let bytes = prefix.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index].is_ascii_alphabetic() {
            let start = index;
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            tokens.push(prefix[start..index].to_ascii_uppercase());
        } else {
            index += 1;
        }
    }
    tokens
}

/// Extract the catalog-owned portion of a SQLite CREATE statement while
/// rejecting additional statements and malformed quote/comment state. Object
/// identity is never copied from the catalog: callers rebuild that prefix from
/// the frozen target endpoint and only retain the validated structural suffix.
pub(super) fn sqlite_catalog_ddl_suffix(
    source_sql: &str,
    kind: SqliteCatalogDdlKind,
) -> Result<String, String> {
    let sql = source_sql.trim();
    if sql.is_empty() {
        return Err("SQLite catalog returned an empty DDL definition".to_string());
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum ScanState {
        Normal,
        SingleQuote,
        DoubleQuote,
        Backtick,
        Bracket,
        LineComment,
        BlockComment,
    }

    let bytes = sql.as_bytes();
    let mut state = ScanState::Normal;
    let mut index = 0;
    let mut depth = 0usize;
    let mut first_open = None;
    let mut first_close = None;
    let mut terminator = None;
    while index < bytes.len() {
        let byte = bytes[index];
        let next = bytes.get(index + 1).copied();
        match state {
            ScanState::Normal => match (byte, next) {
                (b'\'', _) => state = ScanState::SingleQuote,
                (b'"', _) => state = ScanState::DoubleQuote,
                (b'`', _) => state = ScanState::Backtick,
                (b'[', _) => state = ScanState::Bracket,
                (b'-', Some(b'-')) => {
                    state = ScanState::LineComment;
                    index += 1;
                }
                (b'/', Some(b'*')) => {
                    state = ScanState::BlockComment;
                    index += 1;
                }
                (b'(', _) => {
                    if first_open.is_none() {
                        first_open = Some(index);
                    }
                    depth = depth.saturating_add(1);
                }
                (b')', _) => {
                    if depth == 0 {
                        return Err(
                            "SQLite catalog DDL has an unmatched closing parenthesis".to_string()
                        );
                    }
                    depth -= 1;
                    if depth == 0 && first_close.is_none() {
                        first_close = Some(index);
                    }
                }
                (b';', _) if depth == 0 => {
                    if terminator.replace(index).is_some() {
                        return Err(
                            "SQLite catalog DDL contains more than one statement".to_string()
                        );
                    }
                }
                _ => {}
            },
            ScanState::SingleQuote => {
                if byte == b'\'' {
                    if next == Some(b'\'') {
                        index += 1;
                    } else {
                        state = ScanState::Normal;
                    }
                }
            }
            ScanState::DoubleQuote => {
                if byte == b'"' {
                    if next == Some(b'"') {
                        index += 1;
                    } else {
                        state = ScanState::Normal;
                    }
                }
            }
            ScanState::Backtick => {
                if byte == b'`' {
                    if next == Some(b'`') {
                        index += 1;
                    } else {
                        state = ScanState::Normal;
                    }
                }
            }
            ScanState::Bracket => {
                if byte == b']' {
                    state = ScanState::Normal;
                }
            }
            ScanState::LineComment => {
                if byte == b'\n' || byte == b'\r' {
                    state = ScanState::Normal;
                }
            }
            ScanState::BlockComment => {
                if byte == b'*' && next == Some(b'/') {
                    state = ScanState::Normal;
                    index += 1;
                }
            }
        }
        index += 1;
    }
    if !matches!(state, ScanState::Normal | ScanState::LineComment) {
        return Err("SQLite catalog DDL contains an unterminated quote or comment".to_string());
    }
    if depth != 0 {
        return Err("SQLite catalog DDL has unbalanced parentheses".to_string());
    }

    let open = first_open
        .ok_or_else(|| "SQLite catalog DDL is missing its structural body".to_string())?;
    let close = first_close
        .ok_or_else(|| "SQLite catalog DDL is missing its closing parenthesis".to_string())?;
    let prefix_tokens = sqlite_catalog_prefix_tokens(&sql[..open]);
    let expected_prefix = match kind {
        SqliteCatalogDdlKind::Table => ["CREATE", "TABLE"].as_slice(),
        SqliteCatalogDdlKind::Index { unique: false } => ["CREATE", "INDEX"].as_slice(),
        SqliteCatalogDdlKind::Index { unique: true } => ["CREATE", "UNIQUE", "INDEX"].as_slice(),
    };
    if prefix_tokens.len() < expected_prefix.len()
        || !prefix_tokens
            .iter()
            .zip(expected_prefix)
            .all(|(actual, expected)| actual == expected)
    {
        return Err("SQLite catalog DDL has an unexpected CREATE statement type".to_string());
    }

    let content_end = terminator.unwrap_or(sql.len());
    if let Some(terminator) = terminator {
        if !sql[terminator + 1..].trim().is_empty() {
            return Err("SQLite catalog DDL contains a trailing statement".to_string());
        }
    }
    if content_end <= close {
        return Err("SQLite catalog DDL has an invalid structural suffix".to_string());
    }
    let suffix = sql[open..content_end].trim();
    if matches!(kind, SqliteCatalogDdlKind::Table) {
        let table_options = sql[close + 1..content_end]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_uppercase();
        if !matches!(
            table_options.as_str(),
            "" | "STRICT" | "WITHOUT ROWID" | "STRICT, WITHOUT ROWID" | "WITHOUT ROWID, STRICT"
        ) {
            return Err(format!(
                "SQLite table DDL has unsupported trailing options: {table_options}"
            ));
        }
    } else {
        let tail = sql[close + 1..content_end].trim();
        let has_where_clause = tail
            .get(..5)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("WHERE"))
            && tail
                .as_bytes()
                .get(5)
                .is_none_or(|byte| byte.is_ascii_whitespace() || *byte == b'(');
        if !tail.is_empty() && !has_where_clause {
            return Err("SQLite index DDL has an unsupported trailing clause".to_string());
        }
    }
    Ok(suffix.to_string())
}

pub(crate) fn rewrite_sqlite_create_table_for_transfer(
    source_sql: &str,
    source_table: &str,
    target_schema: &str,
    target_table: &str,
) -> Result<String, String> {
    let suffix = sqlite_catalog_ddl_suffix(source_sql, SqliteCatalogDdlKind::Table)?;
    let suffix = rewrite_sqlite_self_references(&suffix, source_table, target_table)?;
    Ok(format!(
        "CREATE TABLE {} {suffix};",
        sqlite_qualified_relation(target_schema, target_table)?
    ))
}

pub(super) fn sqlite_consume_catalog_keyword(
    input: &str,
    start: usize,
    expected: &str,
) -> Result<usize, String> {
    let start = sqlite_skip_whitespace_and_comments(input, start)?;
    let mut end = start;
    for (offset, character) in input[start..].char_indices() {
        if !character.is_ascii_alphabetic() {
            break;
        }
        end = start + offset + character.len_utf8();
    }
    if end == start || !input[start..end].eq_ignore_ascii_case(expected) {
        return Err(format!(
            "SQLite catalog DDL expected {expected} in its CREATE prefix"
        ));
    }
    if input[end..]
        .chars()
        .next()
        .is_some_and(sqlite_unquoted_identifier_continue)
    {
        return Err(format!(
            "SQLite catalog DDL has an invalid {expected} keyword boundary"
        ));
    }
    Ok(end)
}

pub(crate) fn rewrite_sqlite_create_trigger_for_transfer(
    source_sql: &str,
    source_trigger: &str,
    target_schema: &str,
    target_trigger: &str,
) -> Result<String, String> {
    let statements = split_sql_statements(source_sql, StatementScanDialect::Mysql);
    if statements.len() != 1 {
        return Err("SQLite trigger catalog DDL must contain exactly one statement".to_string());
    }
    let sql = statements[0].trim();
    if sql.is_empty() || sql.contains('\0') || sql.len() > 1024 * 1024 {
        return Err("SQLite trigger catalog DDL is empty or exceeds its safety bound".to_string());
    }
    let mut index = sqlite_consume_catalog_keyword(sql, 0, "CREATE")?;
    let next = sqlite_skip_whitespace_and_comments(sql, index)?;
    let prefix = sqlite_catalog_prefix_tokens(&sql[next..]);
    if prefix
        .first()
        .is_some_and(|token| matches!(token.as_str(), "TEMP" | "TEMPORARY"))
    {
        index = sqlite_consume_catalog_keyword(
            sql,
            next,
            if prefix[0] == "TEMP" {
                "TEMP"
            } else {
                "TEMPORARY"
            },
        )?;
    }
    index = sqlite_consume_catalog_keyword(sql, index, "TRIGGER")?;
    let mut identifier_start = sqlite_skip_whitespace_and_comments(sql, index)?;
    let optional_prefix = sqlite_catalog_prefix_tokens(&sql[identifier_start..]);
    if optional_prefix.first().is_some_and(|token| token == "IF") {
        index = sqlite_consume_catalog_keyword(sql, identifier_start, "IF")?;
        index = sqlite_consume_catalog_keyword(sql, index, "NOT")?;
        index = sqlite_consume_catalog_keyword(sql, index, "EXISTS")?;
        identifier_start = sqlite_skip_whitespace_and_comments(sql, index)?;
    }
    let (mut identifier_end, mut parsed_trigger) =
        sqlite_parse_reference_identifier(sql, identifier_start)?;
    let separator = sqlite_skip_whitespace_and_comments(sql, identifier_end)?;
    if sql[separator..].starts_with('.') {
        let qualified_start = sqlite_skip_whitespace_and_comments(sql, separator + 1)?;
        (identifier_end, parsed_trigger) = sqlite_parse_reference_identifier(sql, qualified_start)?;
    }
    if !parsed_trigger.eq_ignore_ascii_case(source_trigger.trim()) {
        return Err(format!(
            "SQLite trigger catalog identity {parsed_trigger} does not match {source_trigger}"
        ));
    }
    let suffix = sql[identifier_end..].trim().trim_end_matches(';').trim();
    if suffix.is_empty() {
        return Err("SQLite trigger catalog DDL is missing its trigger body".to_string());
    }
    Ok(format!(
        "CREATE TRIGGER {} {suffix};",
        sqlite_qualified_index(target_schema, target_trigger)?
    ))
}

pub(crate) fn rewrite_sqlite_create_view_for_transfer(
    source_sql: &str,
    source_view: &str,
    target_schema: &str,
    target_view: &str,
) -> Result<String, String> {
    let statements = split_sql_statements(source_sql, StatementScanDialect::Postgres);
    if statements.len() != 1 {
        return Err("SQLite view catalog DDL must contain exactly one statement".to_string());
    }
    let sql = statements[0].trim();
    if sql.is_empty() || sql.contains('\0') || sql.len() > 1024 * 1024 {
        return Err("SQLite view catalog DDL is empty or exceeds its safety bound".to_string());
    }
    let mut index = sqlite_consume_catalog_keyword(sql, 0, "CREATE")?;
    let next = sqlite_skip_whitespace_and_comments(sql, index)?;
    let prefix = sqlite_catalog_prefix_tokens(&sql[next..]);
    if prefix
        .first()
        .is_some_and(|token| matches!(token.as_str(), "TEMP" | "TEMPORARY"))
    {
        index = sqlite_consume_catalog_keyword(
            sql,
            next,
            if prefix[0] == "TEMP" {
                "TEMP"
            } else {
                "TEMPORARY"
            },
        )?;
    }
    index = sqlite_consume_catalog_keyword(sql, index, "VIEW")?;
    let mut identifier_start = sqlite_skip_whitespace_and_comments(sql, index)?;
    let optional_prefix = sqlite_catalog_prefix_tokens(&sql[identifier_start..]);
    if optional_prefix.first().is_some_and(|token| token == "IF") {
        index = sqlite_consume_catalog_keyword(sql, identifier_start, "IF")?;
        index = sqlite_consume_catalog_keyword(sql, index, "NOT")?;
        index = sqlite_consume_catalog_keyword(sql, index, "EXISTS")?;
        identifier_start = sqlite_skip_whitespace_and_comments(sql, index)?;
    }
    let (mut identifier_end, mut parsed_view) =
        sqlite_parse_reference_identifier(sql, identifier_start)?;
    let separator = sqlite_skip_whitespace_and_comments(sql, identifier_end)?;
    if sql[separator..].starts_with('.') {
        let qualified_start = sqlite_skip_whitespace_and_comments(sql, separator + 1)?;
        (identifier_end, parsed_view) = sqlite_parse_reference_identifier(sql, qualified_start)?;
    }
    if !parsed_view.eq_ignore_ascii_case(source_view.trim()) {
        return Err(format!(
            "SQLite view catalog identity {parsed_view} does not match {source_view}"
        ));
    }
    let suffix = sql[identifier_end..].trim().trim_end_matches(';').trim();
    if suffix.is_empty()
        || !sqlite_catalog_prefix_tokens(suffix)
            .iter()
            .any(|token| token == "AS")
    {
        return Err("SQLite view catalog DDL is missing its AS query body".to_string());
    }
    Ok(format!(
        "CREATE VIEW {} {suffix};",
        sqlite_qualified_relation(target_schema, target_view)?
    ))
}

pub(super) fn sqlite_skip_whitespace_and_comments(
    input: &str,
    mut index: usize,
) -> Result<usize, String> {
    let bytes = input.as_bytes();
    loop {
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        match (bytes.get(index).copied(), bytes.get(index + 1).copied()) {
            (Some(b'-'), Some(b'-')) => {
                index += 2;
                while bytes
                    .get(index)
                    .is_some_and(|byte| !matches!(*byte, b'\n' | b'\r'))
                {
                    index += 1;
                }
            }
            (Some(b'/'), Some(b'*')) => {
                let Some(relative_end) = input[index + 2..].find("*/") else {
                    return Err(
                        "SQLite catalog DDL contains an unterminated block comment".to_string()
                    );
                };
                index += relative_end + 4;
            }
            _ => return Ok(index),
        }
    }
}

pub(super) fn sqlite_unquoted_identifier_continue(character: char) -> bool {
    character == '_'
        || character == '$'
        || character.is_ascii_alphanumeric()
        || (!character.is_ascii() && !character.is_whitespace() && !character.is_control())
}

pub(super) fn sqlite_parse_reference_identifier(
    input: &str,
    start: usize,
) -> Result<(usize, String), String> {
    let Some(first) = input[start..].chars().next() else {
        return Err("SQLite REFERENCES clause is missing its target table".to_string());
    };
    let (close, escape) = match first {
        '"' => ('"', Some("\"\"")),
        '`' => ('`', Some("``")),
        '[' => (']', None),
        '\'' => {
            return Err(
                "SQLite single-quoted foreign-table identifiers are not safe to rewrite"
                    .to_string(),
            )
        }
        _ => {
            let mut end = start;
            for (offset, character) in input[start..].char_indices() {
                if !sqlite_unquoted_identifier_continue(character) {
                    break;
                }
                end = start + offset + character.len_utf8();
            }
            if end == start {
                return Err("SQLite REFERENCES clause has an invalid target table".to_string());
            }
            return Ok((end, input[start..end].to_string()));
        }
    };

    let content_start = start + first.len_utf8();
    let mut decoded = String::new();
    let mut index = content_start;
    while index < input.len() {
        if let Some(escape) = escape {
            if input[index..].starts_with(escape) {
                decoded.push(close);
                index += escape.len();
                continue;
            }
        }
        let character = input[index..]
            .chars()
            .next()
            .expect("index is inside a UTF-8 string");
        if character == close {
            return Ok((index + character.len_utf8(), decoded));
        }
        decoded.push(character);
        index += character.len_utf8();
    }
    Err("SQLite REFERENCES clause has an unterminated target identifier".to_string())
}

/// Rewrite only catalog-proven self-referencing foreign keys when a SQLite
/// table is copied under a new identity. The scanner deliberately ignores SQL
/// strings, quoted identifiers and comments until it encounters the REFERENCES
/// grammar keyword. SQLite foreign-key targets are schema-local; a qualified
/// target is rejected rather than guessed across attached databases.
pub(super) fn rewrite_sqlite_self_references(
    suffix: &str,
    source_table: &str,
    target_table: &str,
) -> Result<String, String> {
    if source_table.trim() == target_table.trim() {
        return Ok(suffix.to_string());
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum State {
        Normal,
        SingleQuote,
        DoubleQuote,
        Backtick,
        Bracket,
        LineComment,
        BlockComment,
    }

    let bytes = suffix.as_bytes();
    let mut state = State::Normal;
    let mut index = 0usize;
    let mut replacements = Vec::new();
    while index < bytes.len() {
        let byte = bytes[index];
        let next = bytes.get(index + 1).copied();
        match state {
            State::Normal => match (byte, next) {
                (b'\'', _) => state = State::SingleQuote,
                (b'"', _) => state = State::DoubleQuote,
                (b'`', _) => state = State::Backtick,
                (b'[', _) => state = State::Bracket,
                (b'-', Some(b'-')) => {
                    state = State::LineComment;
                    index += 1;
                }
                (b'/', Some(b'*')) => {
                    state = State::BlockComment;
                    index += 1;
                }
                _ if byte.is_ascii_alphabetic() || byte == b'_' => {
                    let start = index;
                    index += 1;
                    while bytes.get(index).is_some_and(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(*byte, b'_' | b'$')
                    }) {
                        index += 1;
                    }
                    if suffix[start..index].eq_ignore_ascii_case("REFERENCES") {
                        let identifier_start = sqlite_skip_whitespace_and_comments(suffix, index)?;
                        let (identifier_end, identifier) =
                            sqlite_parse_reference_identifier(suffix, identifier_start)?;
                        let after_identifier =
                            sqlite_skip_whitespace_and_comments(suffix, identifier_end)?;
                        if bytes.get(after_identifier) == Some(&b'.') {
                            return Err(
                                "SQLite schema-qualified foreign-key targets cannot be remapped safely"
                                    .to_string(),
                            );
                        }
                        if identifier.eq_ignore_ascii_case(source_table.trim()) {
                            replacements.push((identifier_start, identifier_end));
                        }
                        index = identifier_end;
                        continue;
                    }
                    continue;
                }
                _ => {}
            },
            State::SingleQuote => {
                if byte == b'\'' {
                    if next == Some(b'\'') {
                        index += 1;
                    } else {
                        state = State::Normal;
                    }
                }
            }
            State::DoubleQuote => {
                if byte == b'"' {
                    if next == Some(b'"') {
                        index += 1;
                    } else {
                        state = State::Normal;
                    }
                }
            }
            State::Backtick => {
                if byte == b'`' {
                    if next == Some(b'`') {
                        index += 1;
                    } else {
                        state = State::Normal;
                    }
                }
            }
            State::Bracket => {
                if byte == b']' {
                    state = State::Normal;
                }
            }
            State::LineComment => {
                if matches!(byte, b'\n' | b'\r') {
                    state = State::Normal;
                }
            }
            State::BlockComment => {
                if byte == b'*' && next == Some(b'/') {
                    state = State::Normal;
                    index += 1;
                }
            }
        }
        index += 1;
    }

    if replacements.is_empty() {
        return Ok(suffix.to_string());
    }
    let quoted_target = sqlite_quote_identifier(target_table.trim());
    let mut rewritten = String::with_capacity(suffix.len() + replacements.len() * 8);
    let mut emitted = 0usize;
    for (start, end) in replacements {
        rewritten.push_str(&suffix[emitted..start]);
        rewritten.push_str(&quoted_target);
        emitted = end;
    }
    rewritten.push_str(&suffix[emitted..]);
    Ok(rewritten)
}

pub(super) fn sqlite_transfer_target_index_name(
    source_table: &str,
    target_table: &str,
    source_index: &str,
) -> String {
    if source_table.trim() == target_table.trim() {
        source_index.trim().to_string()
    } else {
        format!("{}__{}", target_table.trim(), source_index.trim())
    }
}

pub(crate) fn rewrite_sqlite_create_index_for_transfer(
    source_sql: &str,
    target_schema: &str,
    target_table: &str,
    index_name: &str,
    unique: bool,
) -> Result<String, String> {
    let suffix = sqlite_catalog_ddl_suffix(source_sql, SqliteCatalogDdlKind::Index { unique })?;
    Ok(format!(
        "CREATE {}INDEX {} ON {} {suffix};",
        if unique { "UNIQUE " } else { "" },
        sqlite_qualified_index(target_schema, index_name)?,
        sqlite_quote_identifier(target_table.trim())
    ))
}
