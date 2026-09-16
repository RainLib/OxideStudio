use crate::core::statement::{
    classify_statement, has_multiple_statements, StatementKind, StatementScanDialect,
};
use sqlparser::ast::{AlterTableOperation, ObjectNamePart, Statement};
use sqlparser::dialect::MySqlDialect;
use sqlparser::parser::Parser;
use sqlx::mysql::{MySqlConnectOptions, MySqlRow};
use sqlx::pool::PoolConnection;
use sqlx::{MySql, Pool, Row};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::Mutex;

pub(super) type MysqlTransactionSession = Arc<Mutex<PoolConnection<MySql>>>;
pub(super) const POOL_CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
pub(super) const MYSQL_CONNECTION_ID_SQL: &str = "SELECT CAST(CONNECTION_ID() AS CHAR)";
pub(super) const MYSQL_SCHEMA_OBJECTS_SQL: &str = r#"
    SELECT object_name, object_type, parent_name
    FROM (
        SELECT
            trigger_name AS object_name,
            'trigger' AS object_type,
            event_object_table AS parent_name
        FROM information_schema.triggers
        WHERE trigger_schema = ?
        UNION ALL
        SELECT
            event_name AS object_name,
            'event' AS object_type,
            NULL AS parent_name
        FROM information_schema.events
        WHERE event_schema = ?
    ) objects
    ORDER BY object_type, parent_name, object_name
"#;
pub(super) const MYSQL_INDEX_METADATA_SQL_WITH_EXPRESSIONS: &str = r#"
    SELECT
        index_name,
        non_unique,
        index_type,
        index_comment,
        column_name,
        expression,
        sub_part,
        collation
    FROM information_schema.statistics
    WHERE table_schema = ? AND table_name = ?
    ORDER BY index_name = 'PRIMARY' DESC, non_unique ASC, index_name, seq_in_index
"#;
pub(super) const MYSQL_INDEX_METADATA_SQL_LEGACY: &str = r#"
    SELECT
        index_name,
        non_unique,
        index_type,
        index_comment,
        column_name,
        sub_part,
        collation
    FROM information_schema.statistics
    WHERE table_schema = ? AND table_name = ?
    ORDER BY index_name = 'PRIMARY' DESC, non_unique ASC, index_name, seq_in_index
"#;

#[derive(Debug, PartialEq, Eq)]
pub(super) struct MysqlAddColumnIfNotExists {
    pub(super) database: Option<String>,
    pub(super) table: String,
    pub(super) column: String,
}

pub(super) enum MysqlAddColumnFallback {
    AlreadyExists,
    Retry(String),
}

pub(super) fn parse_mysql_connection_id(value: &str) -> Option<u64> {
    value
        .trim()
        .parse::<u64>()
        .ok()
        .filter(|thread_id| *thread_id > 0)
}

pub(super) fn mysql_column_ownership(extra: &str) -> (bool, bool) {
    let extra = extra.to_ascii_lowercase();
    let generated = extra.contains("virtual generated") || extra.contains("stored generated");
    let hidden = extra.split_whitespace().any(|token| token == "invisible");
    (generated, hidden)
}

pub struct MysqlDriver {
    // Map of schema name -> Pool. Empty string key "" represents the default/base connection.
    pub pools: Mutex<HashMap<String, Pool<MySql>>>,
    pub transaction_sessions: Mutex<HashMap<String, MysqlTransactionSession>>,
    pub active_queries: StdMutex<HashMap<String, u64>>,
    pub base_options: Mutex<Option<MySqlConnectOptions>>,
    pub connection_string: String,
}

pub(super) struct MysqlTrackedQueryGuard<'a> {
    pub(super) active_queries: &'a StdMutex<HashMap<String, u64>>,
    pub(super) query_id: Option<String>,
}

impl Drop for MysqlTrackedQueryGuard<'_> {
    fn drop(&mut self) {
        if let Some(query_id) = self.query_id.take() {
            let mut active_queries = self
                .active_queries
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            active_queries.remove(&query_id);
        }
    }
}

pub(super) fn mysql_string_by_index(row: &MySqlRow, index: usize) -> Option<String> {
    if let Ok(value) = row.try_get::<String, _>(index) {
        Some(value)
    } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(index) {
        Some(String::from_utf8_lossy(&bytes).to_string())
    } else {
        None
    }
}

pub(super) fn mysql_string_by_name(row: &MySqlRow, name: &str) -> Option<String> {
    if let Ok(value) = row.try_get::<String, _>(name) {
        Some(value)
    } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(name) {
        Some(String::from_utf8_lossy(&bytes).to_string())
    } else {
        None
    }
}

pub(super) fn mysql_requires_unprepared(sql: &str) -> bool {
    if has_multiple_statements(sql, StatementScanDialect::Mysql) {
        return true;
    }

    match classify_statement(sql) {
        StatementKind::Create
        | StatementKind::Alter
        | StatementKind::Drop
        | StatementKind::Truncate
        | StatementKind::Comment
        | StatementKind::Rename
        | StatementKind::Set
        | StatementKind::Use
        | StatementKind::Show
        | StatementKind::Explain
        | StatementKind::Describe
        | StatementKind::Begin
        | StatementKind::Start
        | StatementKind::Commit
        | StatementKind::Rollback
        | StatementKind::Savepoint
        | StatementKind::Release => true,
        _ => {
            let normalized = sql.trim_start().to_ascii_uppercase();
            normalized.starts_with("/*!")
                || normalized.starts_with("BEGIN")
                || normalized.starts_with("START TRANSACTION")
                || normalized.starts_with("COMMIT")
                || normalized.starts_with("ROLLBACK")
        }
    }
}

/// Recognize only the one legacy-compatible statement shape. Older MySQL and
/// MariaDB versions reject `ADD COLUMN IF NOT EXISTS`; broad string rewriting
/// would be unsafe for multi-operation ALTER statements or quoted SQL text.
pub(super) fn mysql_add_column_if_not_exists(sql: &str) -> Option<MysqlAddColumnIfNotExists> {
    let fallback_sql = mysql_add_column_fallback_sql(sql)?;
    let statements = Parser::parse_sql(&MySqlDialect {}, &fallback_sql).ok()?;
    let [Statement::AlterTable {
        name, operations, ..
    }] = statements.as_slice()
    else {
        return None;
    };
    let [AlterTableOperation::AddColumn {
        if_not_exists: false,
        column_def,
        ..
    }] = operations.as_slice()
    else {
        return None;
    };

    let (database, table) = match name.0.as_slice() {
        [ObjectNamePart::Identifier(table)] => (None, table.value.clone()),
        [ObjectNamePart::Identifier(database), ObjectNamePart::Identifier(table)] => {
            (Some(database.value.clone()), table.value.clone())
        }
        _ => return None,
    };

    Some(MysqlAddColumnIfNotExists {
        database,
        table,
        column: column_def.name.value.clone(),
    })
}

pub(super) fn mysql_add_column_fallback_sql(sql: &str) -> Option<String> {
    let (start, end) = mysql_if_not_exists_clause(sql)?;
    let mut fallback_sql = String::with_capacity(sql.len());
    fallback_sql.push_str(&sql[..start]);
    fallback_sql.push_str(&sql[end..]);
    Some(fallback_sql)
}

/// Locate keywords without reading quoted literals or comments. This is kept
/// intentionally small and is followed by AST validation above.
pub(super) fn mysql_if_not_exists_clause(sql: &str) -> Option<(usize, usize)> {
    let bytes = sql.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index].is_ascii_whitespace() {
            index += 1;
            continue;
        }
        if index + 1 < bytes.len() && bytes[index] == b'/' && bytes[index + 1] == b'*' {
            index += 2;
            while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                index += 1;
            }
            index = (index + 2).min(bytes.len());
            continue;
        }
        if bytes[index] == b'#'
            || (bytes[index] == b'-' && index + 1 < bytes.len() && bytes[index + 1] == b'-')
        {
            index += if bytes[index] == b'#' { 1 } else { 2 };
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if matches!(bytes[index], b'\'' | b'"' | b'`') {
            let quote = bytes[index];
            index += 1;
            while index < bytes.len() {
                if bytes[index] == quote {
                    if index + 1 < bytes.len() && bytes[index + 1] == quote {
                        index += 2;
                    } else {
                        index += 1;
                        break;
                    }
                } else if bytes[index] == b'\\' && quote != b'`' {
                    index = (index + 2).min(bytes.len());
                } else {
                    index += 1;
                }
            }
            continue;
        }
        if bytes[index].is_ascii_alphabetic() || bytes[index] == b'_' {
            let start = index;
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            tokens.push((sql[start..index].to_ascii_lowercase(), start, index));
        } else {
            index += 1;
        }
    }

    tokens.windows(3).find_map(|window| {
        (window[0].0 == "if" && window[1].0 == "not" && window[2].0 == "exists")
            .then_some((window[0].1, window[2].2))
    })
}

pub(super) fn mysql_is_syntax_error(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|database| database.code())
        .is_some_and(|code| code == "1064")
}

/// MySQL 5.7-era servers omit `STATISTICS.EXPRESSION`. PolarDB-X/DRDS may
/// report that same missing column as optimizer errors 3009 or 4518. Keep this
/// narrow: permissions, connectivity and unrelated metadata errors must not
/// silently downgrade the index description.
pub(super) fn mysql_statistics_expression_is_unsupported(error: &sqlx::Error) -> bool {
    let Some(database) = error.as_database_error() else {
        return false;
    };
    mysql_statistics_expression_error_is_unsupported(database.code().as_deref(), database.message())
}

pub(super) fn mysql_statistics_expression_error_is_unsupported(
    code: Option<&str>,
    message: &str,
) -> bool {
    if !matches!(code, Some("1054" | "3009" | "4518")) {
        return false;
    }
    let message = message.to_ascii_lowercase();
    message.contains("expression")
        && message.contains("column")
        && (message.contains("unknown") || message.contains("not found"))
}
