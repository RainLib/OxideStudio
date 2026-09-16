use super::scanner::{
    dollar_quote_at, line_comment_at, push_statement_span, skip_block_comment, skip_line_comment,
    skip_quoted_or_identifier_region, skip_quoted_region, split_sql_statement_spans,
};
use super::types::{SqlStatementSpan, StatementScanDialect};

pub(super) const SOFT_STATEMENT_KEYWORDS: &[&str] = &[
    "SELECT", "WITH", "INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE", "CREATE", "ALTER", "DROP",
    "TRUNCATE", "EXPLAIN", "SHOW", "DESCRIBE", "DESC", "USE", "CALL", "EXEC", "EXECUTE", "BEGIN",
    "COMMIT", "ROLLBACK", "ANALYZE", "VACUUM",
];

pub(super) fn mask_sql_noise_for_soft_boundaries(
    sql: &str,
    dialect: StatementScanDialect,
) -> String {
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

pub(super) fn soft_statement_keyword(line: &str) -> Option<&'static str> {
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

pub(super) fn soft_statement_is_wrapped_continuation(initial: &str, candidate: &str) -> bool {
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

pub(super) fn soft_statement_is_set_continuation(
    previous_non_empty_line: &str,
    candidate: &str,
) -> bool {
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
