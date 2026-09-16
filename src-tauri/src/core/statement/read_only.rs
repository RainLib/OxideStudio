use super::scanner::{
    dollar_quote_at, execution_statement_kind, is_identifier_continue, is_identifier_start,
    line_comment_at, skip_block_comment, skip_line_comment, skip_quoted_or_identifier_region,
};
use super::soft_boundaries::split_sql_statements;
use super::types::{StatementKind, StatementScanDialect};

pub(super) const READ_ONLY_FORBIDDEN_KEYWORDS: &[&str] = &[
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

pub(super) const READ_ONLY_DANGEROUS_FUNCTIONS: &[&str] = &[
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

pub(super) fn contains_dangerous_read_function(sql: &str) -> bool {
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

pub(super) fn contains_read_only_forbidden_syntax(
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
