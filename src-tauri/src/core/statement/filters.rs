use super::scanner::{dollar_quote_at, is_identifier_continue, is_identifier_start};
use super::types::StatementScanDialect;

pub(super) const FILTER_FORBIDDEN_KEYWORDS: &[&str] = &[
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

pub(super) const FILTER_TOP_LEVEL_CLAUSE_KEYWORDS: &[&str] = &[
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

pub(super) fn keyword_matches_any(keyword: &str, candidates: &[&str]) -> bool {
    candidates
        .iter()
        .any(|candidate| keyword.eq_ignore_ascii_case(candidate))
}

pub(super) fn strict_quoted_region_end(
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

pub(super) fn strict_sqlserver_bracket_identifier_end(
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
