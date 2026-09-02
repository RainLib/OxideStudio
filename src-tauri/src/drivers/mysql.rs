use crate::core::driver::DatabaseDriver;
use crate::core::protocol::{
    ColumnDef, ColumnInfo, ConstraintInfo, DatabaseInfo, ForeignKeyReferenceInfo, FunctionInfo,
    FunctionParameterInfo, IndexInfo, ParameterizedStatement, QueryParameter, QueryResult,
    SchemaObjectInfo, TableInfo, DEFAULT_QUERY_RESULT_ROW_LIMIT,
};
use crate::core::statement::{
    classify_statement, execution_mode, execution_statement_kind, has_multiple_statements,
    split_sql_statements, QueryExecutionMode, StatementKind, StatementScanDialect,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::{StreamExt, TryStreamExt};
use sqlparser::ast::{AlterTableOperation, ObjectNamePart, Statement};
use sqlparser::dialect::MySqlDialect;
use sqlparser::parser::Parser;
use sqlx::mysql::types::MySqlTime;
use sqlx::mysql::{MySqlArguments, MySqlConnectOptions, MySqlPoolOptions, MySqlRow};
use sqlx::pool::PoolConnection;
use sqlx::query::Query;
use sqlx::types::chrono::{NaiveDate, NaiveDateTime};
use sqlx::types::BigDecimal;
use sqlx::{Column, ConnectOptions, Executor, MySql, Pool, Row, TypeInfo};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::timeout;

type MysqlTransactionSession = Arc<Mutex<PoolConnection<MySql>>>;
const POOL_CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
const MYSQL_CONNECTION_ID_SQL: &str = "SELECT CAST(CONNECTION_ID() AS CHAR)";
const MYSQL_SCHEMA_OBJECTS_SQL: &str = r#"
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

#[derive(Debug, PartialEq, Eq)]
struct MysqlAddColumnIfNotExists {
    database: Option<String>,
    table: String,
    column: String,
}

enum MysqlAddColumnFallback {
    AlreadyExists,
    Retry(String),
}

fn parse_mysql_connection_id(value: &str) -> Option<u64> {
    value
        .trim()
        .parse::<u64>()
        .ok()
        .filter(|thread_id| *thread_id > 0)
}

fn mysql_column_ownership(extra: &str) -> (bool, bool) {
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

struct MysqlTrackedQueryGuard<'a> {
    active_queries: &'a StdMutex<HashMap<String, u64>>,
    query_id: Option<String>,
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

fn mysql_string_by_index(row: &MySqlRow, index: usize) -> Option<String> {
    if let Ok(value) = row.try_get::<String, _>(index) {
        Some(value)
    } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(index) {
        Some(String::from_utf8_lossy(&bytes).to_string())
    } else {
        None
    }
}

fn mysql_string_by_name(row: &MySqlRow, name: &str) -> Option<String> {
    if let Ok(value) = row.try_get::<String, _>(name) {
        Some(value)
    } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(name) {
        Some(String::from_utf8_lossy(&bytes).to_string())
    } else {
        None
    }
}

fn mysql_requires_unprepared(sql: &str) -> bool {
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
fn mysql_add_column_if_not_exists(sql: &str) -> Option<MysqlAddColumnIfNotExists> {
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

fn mysql_add_column_fallback_sql(sql: &str) -> Option<String> {
    let (start, end) = mysql_if_not_exists_clause(sql)?;
    let mut fallback_sql = String::with_capacity(sql.len());
    fallback_sql.push_str(&sql[..start]);
    fallback_sql.push_str(&sql[end..]);
    Some(fallback_sql)
}

/// Locate keywords without reading quoted literals or comments. This is kept
/// intentionally small and is followed by AST validation above.
fn mysql_if_not_exists_clause(sql: &str) -> Option<(usize, usize)> {
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

fn mysql_is_syntax_error(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|database| database.code())
        .is_some_and(|code| code == "1064")
}

impl MysqlDriver {
    pub fn new(connection_string: &str) -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
            transaction_sessions: Mutex::new(HashMap::new()),
            active_queries: StdMutex::new(HashMap::new()),
            base_options: Mutex::new(None),
            connection_string: connection_string.to_string(),
        }
    }

    async fn legacy_add_column_fallback_on_pool(
        pool: &Pool<MySql>,
        sql: &str,
        error: &sqlx::Error,
    ) -> Option<MysqlAddColumnFallback> {
        if !mysql_is_syntax_error(error) {
            return None;
        }
        let target = mysql_add_column_if_not_exists(sql)?;
        let exists = if let Some(database) = target.database.as_deref() {
            sqlx::query_scalar::<_, i64>(
                "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
            )
            .bind(database)
            .bind(&target.table)
            .bind(&target.column)
            .fetch_optional(pool)
            .await
            .ok()?
            .is_some()
        } else {
            sqlx::query_scalar::<_, i64>(
                "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
            )
            .bind(&target.table)
            .bind(&target.column)
            .fetch_optional(pool)
            .await
            .ok()?
            .is_some()
        };
        Some(if exists {
            MysqlAddColumnFallback::AlreadyExists
        } else {
            MysqlAddColumnFallback::Retry(mysql_add_column_fallback_sql(sql)?)
        })
    }

    async fn legacy_add_column_fallback_on_connection(
        conn: &mut sqlx::MySqlConnection,
        sql: &str,
        error: &sqlx::Error,
    ) -> Option<MysqlAddColumnFallback> {
        if !mysql_is_syntax_error(error) {
            return None;
        }
        let target = mysql_add_column_if_not_exists(sql)?;
        let exists = if let Some(database) = target.database.as_deref() {
            sqlx::query_scalar::<_, i64>(
                "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
            )
            .bind(database)
            .bind(&target.table)
            .bind(&target.column)
            .fetch_optional(&mut *conn)
            .await
            .ok()?
            .is_some()
        } else {
            sqlx::query_scalar::<_, i64>(
                "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
            )
            .bind(&target.table)
            .bind(&target.column)
            .fetch_optional(&mut *conn)
            .await
            .ok()?
            .is_some()
        };
        Some(if exists {
            MysqlAddColumnFallback::AlreadyExists
        } else {
            MysqlAddColumnFallback::Retry(mysql_add_column_fallback_sql(sql)?)
        })
    }

    /// Helper to get or create a pool for a specific schema
    async fn get_pool(&self, schema: Option<&str>) -> Result<Pool<MySql>> {
        let schema_key = schema.unwrap_or("").to_string();
        let mut options = {
            let base_options = self.base_options.lock().await;
            base_options
                .clone()
                .ok_or_else(|| anyhow!("Driver not connected (no base options)"))?
        };

        // internal scope to drop the lock before awaiting pool creation if possible
        // but we need to insert it back.
        // For simplicity, we can hold the lock if pool creation is fast enough, OR
        // we can double check.
        // To avoid holding lock during network op (pool connect), we check first.

        {
            let pools = self.pools.lock().await;
            if let Some(pool) = pools.get(&schema_key) {
                return Ok(pool.clone());
            }
        }

        if !schema_key.is_empty() {
            options = options.database(&schema_key);
        }

        let new_pool = MySqlPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(30))
            .connect_with(options)
            .await?;

        let base_options = self.base_options.lock().await;
        if base_options.is_none() {
            drop(base_options);
            Self::close_pool_with_timeout(new_pool).await;
            return Err(anyhow!(
                "Driver disconnected while opening MySQL schema pool"
            ));
        }

        let mut pools = self.pools.lock().await;
        if let Some(existing_pool) = pools.get(&schema_key) {
            let existing_pool = existing_pool.clone();
            drop(pools);
            drop(base_options);
            Self::close_pool_with_timeout(new_pool).await;
            return Ok(existing_pool);
        }
        pools.insert(schema_key.clone(), new_pool.clone());
        drop(pools);
        drop(base_options);

        Ok(new_pool)
    }

    fn process_rows(
        &self,
        rows: Vec<MySqlRow>,
        empty_columns: Vec<ColumnDef>,
    ) -> Result<Vec<QueryResult>> {
        if rows.is_empty() {
            return Ok(vec![QueryResult::rows(empty_columns, Vec::new())]);
        }

        let first_row = &rows[0];
        let columns: Vec<ColumnDef> = first_row
            .columns()
            .iter()
            .map(|c| ColumnDef {
                name: c.name().to_string(),
                data_type: c.type_info().name().to_string(),
            })
            .collect();

        let mut data_rows = Vec::new();
        for row in rows {
            let mut row_values = Vec::new();
            for (i, _) in columns.iter().enumerate() {
                let val = decode_mysql_value(&row, i);
                row_values.push(val);
            }
            data_rows.push(row_values);
        }

        Ok(vec![QueryResult::rows_limited(
            columns,
            data_rows,
            DEFAULT_QUERY_RESULT_ROW_LIMIT,
        )])
    }

    async fn process_pool_rows(
        &self,
        sql: &str,
        rows: Vec<MySqlRow>,
        pool: &Pool<MySql>,
    ) -> Result<Vec<QueryResult>> {
        let columns = if rows.is_empty() {
            pool.describe(sql)
                .await
                .map(|description| {
                    description
                        .columns()
                        .iter()
                        .map(|column| ColumnDef {
                            name: column.name().to_string(),
                            data_type: column.type_info().name().to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        self.process_rows(rows, columns)
    }

    async fn process_connection_rows(
        &self,
        sql: &str,
        rows: Vec<MySqlRow>,
        conn: &mut sqlx::MySqlConnection,
    ) -> Result<Vec<QueryResult>> {
        let columns = if rows.is_empty() {
            (&mut *conn)
                .describe(sql)
                .await
                .map(|description| {
                    description
                        .columns()
                        .iter()
                        .map(|column| ColumnDef {
                            name: column.name().to_string(),
                            data_type: column.type_info().name().to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        self.process_rows(rows, columns)
    }

    async fn query_on_pool(&self, sql: &str, pool: &Pool<MySql>) -> Result<Vec<QueryResult>> {
        let statements = split_sql_statements(sql, StatementScanDialect::Mysql);
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        if statements.len() > 1 {
            let mut connection = pool.acquire().await?;
            // A script may change session or transaction state. Never return that connection to
            // the pool if execution is cancelled between statements or the script leaves a
            // transaction open; dropping it closes the backend connection instead.
            connection.close_on_drop();
            let mut results = Vec::with_capacity(statements.len());
            for statement in statements {
                results.extend(
                    self.query_single_on_connection(statement, &mut connection)
                        .await?,
                );
            }
            return Ok(results);
        }
        let sql = statements[0];

        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let rows = sqlx::raw_sql(sql)
                    .fetch(pool)
                    .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                    .try_collect::<Vec<_>>()
                    .await?;
                self.process_pool_rows(sql, rows, pool).await
            }
            QueryExecutionMode::AffectsRows => {
                let result = match sqlx::raw_sql(sql).execute(pool).await {
                    Ok(result) => result,
                    Err(error) => {
                        match Self::legacy_add_column_fallback_on_pool(pool, sql, &error).await {
                            Some(MysqlAddColumnFallback::AlreadyExists) => {
                                return Ok(vec![QueryResult::execution(
                                    execution_statement_kind(sql).as_str(),
                                    0,
                                )]);
                            }
                            Some(MysqlAddColumnFallback::Retry(fallback_sql)) => {
                                sqlx::raw_sql(&fallback_sql).execute(pool).await?
                            }
                            None => return Err(error.into()),
                        }
                    }
                };
                Ok(vec![QueryResult::execution(
                    execution_statement_kind(sql).as_str(),
                    result.rows_affected(),
                )])
            }
        }
    }

    async fn query_single_on_connection(
        &self,
        sql: &str,
        conn: &mut sqlx::MySqlConnection,
    ) -> Result<Vec<QueryResult>> {
        if mysql_requires_unprepared(sql) {
            return match execution_mode(sql) {
                QueryExecutionMode::ReturnsRows => {
                    let rows = {
                        let stream = (&mut *conn).fetch(sql);
                        stream
                            .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                            .try_collect::<Vec<_>>()
                            .await?
                    };
                    self.process_connection_rows(sql, rows, conn).await
                }
                QueryExecutionMode::AffectsRows => {
                    let result = match (&mut *conn).execute(sql).await {
                        Ok(result) => result,
                        Err(error) => {
                            match Self::legacy_add_column_fallback_on_connection(conn, sql, &error)
                                .await
                            {
                                Some(MysqlAddColumnFallback::AlreadyExists) => {
                                    return Ok(vec![QueryResult::execution(
                                        execution_statement_kind(sql).as_str(),
                                        0,
                                    )]);
                                }
                                Some(MysqlAddColumnFallback::Retry(fallback_sql)) => {
                                    (&mut *conn).execute(fallback_sql.as_str()).await?
                                }
                                None => return Err(error.into()),
                            }
                        }
                    };
                    Ok(vec![QueryResult::execution(
                        execution_statement_kind(sql).as_str(),
                        result.rows_affected(),
                    )])
                }
            };
        }

        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let rows = {
                    let stream = sqlx::query(sql).persistent(false).fetch(&mut *conn);
                    stream
                        .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                        .try_collect::<Vec<_>>()
                        .await?
                };
                self.process_connection_rows(sql, rows, conn).await
            }
            QueryExecutionMode::AffectsRows => {
                let result = match sqlx::query(sql).persistent(false).execute(&mut *conn).await {
                    Ok(result) => result,
                    Err(error) => {
                        match Self::legacy_add_column_fallback_on_connection(conn, sql, &error)
                            .await
                        {
                            Some(MysqlAddColumnFallback::AlreadyExists) => {
                                return Ok(vec![QueryResult::execution(
                                    execution_statement_kind(sql).as_str(),
                                    0,
                                )]);
                            }
                            Some(MysqlAddColumnFallback::Retry(fallback_sql)) => {
                                (&mut *conn).execute(fallback_sql.as_str()).await?
                            }
                            None => return Err(error.into()),
                        }
                    }
                };
                Ok(vec![QueryResult::execution(
                    execution_statement_kind(sql).as_str(),
                    result.rows_affected(),
                )])
            }
        }
    }

    async fn query_on_connection(
        &self,
        sql: &str,
        conn: &mut sqlx::MySqlConnection,
    ) -> Result<Vec<QueryResult>> {
        let statements = split_sql_statements(sql, StatementScanDialect::Mysql);
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        if statements.len() <= 1 {
            return self.query_single_on_connection(statements[0], conn).await;
        }

        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            results.extend(self.query_single_on_connection(statement, conn).await?);
        }
        Ok(results)
    }

    async fn track_query_on_connection<'a>(
        &'a self,
        query_id: Option<&str>,
        conn: &mut sqlx::MySqlConnection,
    ) -> Result<MysqlTrackedQueryGuard<'a>> {
        let tracked_query_id = if let Some(query_id) = query_id {
            // `query_scalar` intentionally decodes only column zero. That also
            // tolerates MySQL-compatible servers which append metadata columns
            // to otherwise scalar queries.
            let thread_id = sqlx::query_scalar::<_, String>(MYSQL_CONNECTION_ID_SQL)
                .persistent(false)
                .fetch_one(&mut *conn)
                .await
                .ok()
                .and_then(|value| parse_mysql_connection_id(&value));

            if let Some(thread_id) = thread_id {
                let mut active_queries = self
                    .active_queries
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                active_queries.insert(query_id.to_string(), thread_id);
                Some(query_id.to_string())
            } else {
                // Query execution remains available on compatible products that
                // do not expose a standard MySQL connection id. Only server-side
                // KILL QUERY support is unavailable for this request.
                tracing::debug!(
                    "MySQL-compatible server did not expose a cancellable connection id"
                );
                None
            }
        } else {
            None
        };

        Ok(MysqlTrackedQueryGuard {
            active_queries: &self.active_queries,
            query_id: tracked_query_id,
        })
    }

    fn drain_active_query_threads(&self) -> Vec<(String, u64)> {
        self.active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain()
            .collect()
    }

    fn active_query_thread(&self, query_id: &str) -> Option<u64> {
        self.active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(query_id)
            .copied()
    }

    fn remove_active_query_thread_if_matches(&self, query_id: &str, thread_id: u64) {
        let mut active_queries = self
            .active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if active_queries.get(query_id) == Some(&thread_id) {
            active_queries.remove(query_id);
        }
    }

    async fn cancel_tracked_queries_on_pool(
        &self,
        pool: &Pool<MySql>,
        active_queries: Vec<(String, u64)>,
    ) {
        for (query_id, thread_id) in active_queries {
            let sql = format!("KILL QUERY {thread_id}");
            if let Err(error) = sqlx::raw_sql(&sql).execute(pool).await {
                tracing::warn!(
                    "Failed to cancel active MySQL query {} during disconnect: {}",
                    query_id,
                    error
                );
            }
        }
    }

    async fn close_pool_with_timeout(pool: Pool<MySql>) {
        if timeout(POOL_CLOSE_TIMEOUT, pool.close()).await.is_err() {
            tracing::warn!(
                "Timed out waiting for MySQL pool to close after {:?}",
                POOL_CLOSE_TIMEOUT
            );
        }
    }

    async fn get_transaction_session(&self, session_id: &str) -> Result<MysqlTransactionSession> {
        self.transaction_sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("Transaction not found: {}", session_id))
    }
}

#[async_trait]
impl DatabaseDriver for MysqlDriver {
    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        Some(StatementScanDialect::Mysql)
    }

    async fn connect(&mut self) -> Result<()> {
        let options = MySqlConnectOptions::from_str(&self.connection_string)?
            .disable_statement_logging()
            .to_owned();

        // Initialize default pool
        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(30))
            .connect_with(options.clone())
            .await?;

        let pools = self.pools.get_mut(); // Since we have &mut self, we can get_mut access to Mutex
        let old_pools = pools.drain().map(|(_, pool)| pool).collect::<Vec<_>>();
        pools.insert("".to_string(), pool);
        *self.base_options.get_mut() = Some(options);

        for old_pool in old_pools {
            Self::close_pool_with_timeout(old_pool).await;
        }

        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        {
            let mut base_options = self.base_options.lock().await;
            *base_options = None;
        }

        let active_queries = self.drain_active_query_threads();
        if !active_queries.is_empty() {
            let cancel_pool = {
                let pools = self.pools.lock().await;
                if let Some(pool) = pools.get("") {
                    Some(pool.clone())
                } else {
                    pools.values().next().cloned()
                }
            };

            if let Some(pool) = cancel_pool {
                self.cancel_tracked_queries_on_pool(&pool, active_queries)
                    .await;
            } else {
                tracing::warn!(
                    "Unable to cancel active MySQL queries during disconnect because no pool is available"
                );
            }
        }

        let mut sessions = self.transaction_sessions.lock().await;
        let drained_sessions: Vec<_> = sessions.drain().map(|(_, conn)| conn).collect();
        drop(sessions);

        for session in drained_sessions {
            let mut conn = session.lock().await;
            if let Err(error) = (&mut **conn).execute("ROLLBACK").await {
                tracing::warn!(
                    "Failed to rollback MySQL transaction on disconnect: {}",
                    error
                );
            }
        }

        let drained_pools = {
            let mut pools = self.pools.lock().await;
            pools.drain().map(|(_, pool)| pool).collect::<Vec<_>>()
        };
        for pool in drained_pools {
            Self::close_pool_with_timeout(pool).await;
        }

        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        let pool = self.get_pool(None).await?;
        sqlx::query("SELECT 1")
            .persistent(false)
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        // Use default pool
        let pool = self.get_pool(None).await?;
        self.query_on_pool(sql, &pool).await
    }

    async fn execute_parameterized(&self, sql: &str, params: &[QueryParameter]) -> Result<u64> {
        let pool = self.get_pool(None).await?;
        let mut query = sqlx::query(sql).persistent(false);
        for param in params {
            query = bind_mysql_parameter(query, param)?;
        }
        let result = query.execute(&pool).await?;
        Ok(result.rows_affected())
    }

    async fn query_parameterized(
        &self,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        let pool = self.get_pool(None).await?;
        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let mut query = sqlx::query(sql).persistent(false);
                for param in params {
                    query = bind_mysql_parameter(query, param)?;
                }
                let rows = query
                    .fetch(&pool)
                    .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                    .try_collect::<Vec<_>>()
                    .await?;
                self.process_pool_rows(sql, rows, &pool).await
            }
            QueryExecutionMode::AffectsRows => {
                let mut query = sqlx::query(sql).persistent(false);
                for param in params {
                    query = bind_mysql_parameter(query, param)?;
                }
                let result = query.execute(&pool).await?;
                Ok(vec![QueryResult::execution(
                    execution_statement_kind(sql).as_str(),
                    result.rows_affected(),
                )])
            }
        }
    }

    async fn execute_parameterized_batch(
        &self,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }

        let pool = self.get_pool(None).await?;
        let mut conn = pool.acquire().await?;
        (&mut *conn).execute("BEGIN").await?;

        let mut rows_affected = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.sql).persistent(false);
            for param in &statement.params {
                query = bind_mysql_parameter(query, param)?;
            }

            match query.execute(&mut *conn).await {
                Ok(result) => rows_affected.push(result.rows_affected()),
                Err(error) => {
                    if let Err(rollback_error) = (&mut *conn).execute("ROLLBACK").await {
                        tracing::warn!(
                            "Failed to rollback MySQL mutation batch: {}",
                            rollback_error
                        );
                    }
                    return Err(error.into());
                }
            }
        }

        (&mut *conn).execute("COMMIT").await?;
        Ok(rows_affected)
    }

    async fn query_tracked(&self, query_id: Option<&str>, sql: &str) -> Result<Vec<QueryResult>> {
        if query_id.is_none() {
            return self.query(sql).await;
        }

        let pool = self.get_pool(None).await?;
        let mut conn = pool.acquire().await?;
        if has_multiple_statements(sql, StatementScanDialect::Mysql) {
            conn.close_on_drop();
        }
        let tracked_query = self.track_query_on_connection(query_id, &mut conn).await?;
        let result = self.query_on_connection(sql, &mut conn).await;
        drop(tracked_query);
        result
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        // Get or create pool for this specific schema
        let pool = self.get_pool(Some(schema)).await?;

        // Execute query on that pool directly, no USE needed
        self.query_on_pool(sql, &pool).await
    }

    async fn query_with_context_tracked(
        &self,
        query_id: Option<&str>,
        sql: &str,
        schema: &str,
    ) -> Result<Vec<QueryResult>> {
        if query_id.is_none() {
            return self.query_with_context(sql, schema).await;
        }

        let pool = self.get_pool(Some(schema)).await?;
        let mut conn = pool.acquire().await?;
        if has_multiple_statements(sql, StatementScanDialect::Mysql) {
            conn.close_on_drop();
        }
        let tracked_query = self.track_query_on_connection(query_id, &mut conn).await?;
        let result = self.query_on_connection(sql, &mut conn).await;
        drop(tracked_query);
        result
    }

    async fn begin_transaction(&self, session_id: &str, schema: Option<&str>) -> Result<()> {
        {
            let sessions = self.transaction_sessions.lock().await;
            if sessions.contains_key(session_id) {
                return Err(anyhow!("Transaction already active: {}", session_id));
            }
        }

        let pool = self
            .get_pool(schema.filter(|schema| !schema.trim().is_empty()))
            .await?;
        let mut conn = pool.acquire().await?;

        (&mut *conn).execute("BEGIN").await?;

        let mut sessions = self.transaction_sessions.lock().await;
        if sessions.contains_key(session_id) {
            drop(sessions);
            (&mut *conn).execute("ROLLBACK").await?;
            return Err(anyhow!("Transaction already active: {}", session_id));
        }

        sessions.insert(session_id.to_string(), Arc::new(Mutex::new(conn)));
        Ok(())
    }

    async fn begin_database_transaction(
        &self,
        session_id: &str,
        database: &str,
        _schema: Option<&str>,
    ) -> Result<()> {
        self.begin_transaction(session_id, Some(database)).await
    }

    async fn query_transaction(&self, session_id: &str, sql: &str) -> Result<Vec<QueryResult>> {
        let session = self.get_transaction_session(session_id).await?;
        let mut conn = session.lock().await;

        self.query_on_connection(sql, &mut conn).await
    }

    async fn query_transaction_tracked(
        &self,
        query_id: Option<&str>,
        session_id: &str,
        sql: &str,
    ) -> Result<Vec<QueryResult>> {
        if query_id.is_none() {
            return self.query_transaction(session_id, sql).await;
        }

        let session = self.get_transaction_session(session_id).await?;
        let mut conn = session.lock().await;

        let tracked_query = self.track_query_on_connection(query_id, &mut conn).await?;
        let result = self.query_on_connection(sql, &mut conn).await;
        drop(tracked_query);
        result
    }

    async fn execute_parameterized_transaction(
        &self,
        session_id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let session = self.get_transaction_session(session_id).await?;
        let mut conn = session.lock().await;
        let mut rows_affected = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.sql).persistent(false);
            for param in &statement.params {
                query = bind_mysql_parameter(query, param)?;
            }
            rows_affected.push(query.execute(&mut **conn).await?.rows_affected());
        }
        Ok(rows_affected)
    }

    async fn cancel_query(&self, query_id: &str) -> Result<bool> {
        if let Some(thread_id) = self.active_query_thread(query_id) {
            let pool = self.get_pool(None).await?;
            let sql = format!("KILL QUERY {thread_id}");
            sqlx::raw_sql(&sql).execute(&pool).await?;
            self.remove_active_query_thread_if_matches(query_id, thread_id);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    async fn commit_transaction(&self, session_id: &str) -> Result<()> {
        let session = {
            let mut sessions = self.transaction_sessions.lock().await;
            sessions
                .remove(session_id)
                .ok_or_else(|| anyhow!("Transaction not found: {}", session_id))?
        };
        let mut conn = session.lock().await;

        (&mut **conn).execute("COMMIT").await?;
        Ok(())
    }

    async fn rollback_transaction(&self, session_id: &str) -> Result<()> {
        let session = {
            let mut sessions = self.transaction_sessions.lock().await;
            sessions
                .remove(session_id)
                .ok_or_else(|| anyhow!("Transaction not found: {}", session_id))?
        };
        let mut conn = session.lock().await;

        (&mut **conn).execute("ROLLBACK").await?;
        Ok(())
    }

    async fn get_database_metadata(&self) -> Result<Vec<DatabaseInfo>> {
        let pool = self.get_pool(None).await?;
        let metadata = sqlx::query(
            r#"
            SELECT s.SCHEMA_NAME,
                   s.DEFAULT_CHARACTER_SET_NAME,
                   s.DEFAULT_COLLATION_NAME,
                   SUM(COALESCE(t.DATA_LENGTH, 0) + COALESCE(t.INDEX_LENGTH, 0)) AS SIZE_BYTES
            FROM information_schema.SCHEMATA s
            LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
            GROUP BY s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME
            ORDER BY s.SCHEMA_NAME
            "#,
        )
        .persistent(false)
        .fetch_all(&pool)
        .await;

        match metadata {
            Ok(rows) => Ok(rows
                .iter()
                .map(|row| DatabaseInfo {
                    name: mysql_string_by_index(row, 0).unwrap_or_default(),
                    default_charset: mysql_string_by_index(row, 1)
                        .filter(|value| !value.trim().is_empty()),
                    default_collation: mysql_string_by_index(row, 2)
                        .filter(|value| !value.trim().is_empty()),
                    size_bytes: row
                        .try_get::<Option<i64>, _>(3)
                        .ok()
                        .flatten()
                        .or_else(|| mysql_string_by_index(row, 3)?.parse::<i64>().ok()),
                    ..DatabaseInfo::default()
                })
                .filter(|database| !database.name.trim().is_empty())
                .collect()),
            Err(error) => {
                tracing::debug!(
                    "Falling back to MySQL database names after metadata query failed: {error}"
                );
                Ok(self
                    .get_schemas()
                    .await?
                    .into_iter()
                    .map(|name| DatabaseInfo {
                        name,
                        ..DatabaseInfo::default()
                    })
                    .collect())
            }
        }
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        let pool = self.get_pool(None).await?;
        let rows = sqlx::query("SHOW DATABASES")
            .persistent(false)
            .fetch_all(&pool)
            .await?;

        let mut schemas: Vec<String> = rows
            .iter()
            .map(|r| mysql_string_by_index(r, 0).unwrap_or_default())
            .filter(|s| !s.is_empty())
            .collect();

        schemas.sort();

        Ok(schemas)
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let pool = self.get_pool(None).await?; // Information schema is global usually, or can use default pool
                                               // Actually, information_schema is accessible from any DB if user has permissions.
                                               // Using default pool is safer than creating a pool for a potentially invalid schema just to check tables.

        let rows = sqlx::query(
            "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name",
        )
        .bind(schema)
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        let tables = rows
            .iter()
            .map(|r| {
                let name = mysql_string_by_index(r, 0).unwrap_or_default();
                let table_type = mysql_string_by_index(r, 1);

                TableInfo {
                    name,
                    schema: Some(schema.to_string()),
                    table_type,
                    comment: None,
                }
            })
            .filter(|t| !t.name.is_empty())
            .collect();

        Ok(tables)
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        let pool = self.get_pool(None).await?;
        let rows = sqlx::query(
            r#"
            SELECT
                column_name AS cn,
                column_type AS dt,
                is_nullable AS inl,
                column_default AS cd,
                column_key AS ck,
                extra AS ex,
                column_comment AS cc
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
            ORDER BY ordinal_position
            "#,
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await?;

        let cols = rows
            .iter()
            .map(|r| {
                let is_nullable =
                    mysql_string_by_name(r, "inl").unwrap_or_else(|| "YES".to_string()) == "YES";

                let column_key = mysql_string_by_name(r, "ck").unwrap_or_default();
                let is_primary_key = column_key == "PRI";
                let is_unique = column_key == "PRI" || column_key == "UNI";
                let is_indexed = !column_key.is_empty();
                let extra = mysql_string_by_name(r, "ex").unwrap_or_default();
                let (is_generated, is_hidden) = mysql_column_ownership(&extra);
                let comment = mysql_string_by_name(r, "cc")
                    .and_then(|value| (!value.trim().is_empty()).then_some(value));

                ColumnInfo {
                    name: mysql_string_by_name(r, "cn").unwrap_or_default(),
                    data_type: mysql_string_by_name(r, "dt").unwrap_or_default(),
                    is_nullable,
                    is_primary_key,
                    is_unique,
                    is_indexed,
                    is_auto_increment: extra.to_ascii_lowercase().contains("auto_increment"),
                    identity_generation: None,
                    is_generated: Some(is_generated),
                    is_hidden: Some(is_hidden),
                    default_value: mysql_string_by_name(r, "cd"),
                    comment,
                }
            })
            .collect();

        Ok(cols)
    }

    async fn get_generated_columns(&self, schema: &str, table: &str) -> Result<Vec<String>> {
        let pool = self.get_pool(None).await?;
        let rows = sqlx::query(
            r#"
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = ?
              AND table_name = ?
              AND (
                LOWER(extra) LIKE '%virtual generated%'
                OR LOWER(extra) LIKE '%stored generated%'
              )
            ORDER BY ordinal_position
            "#,
        )
        .bind(schema)
        .bind(table)
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        Ok(rows
            .iter()
            .filter_map(|row| mysql_string_by_index(row, 0))
            .filter(|name| !name.is_empty())
            .collect())
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
        let pool = self.get_pool(None).await?;
        let rows = sqlx::query(
            r#"
            SELECT
                index_name,
                MAX(non_unique) AS non_unique,
                MAX(index_type) AS index_type,
                MAX(index_comment) AS index_comment,
                GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS columns,
                GROUP_CONCAT(
                    CASE
                        WHEN column_name IS NULL OR sub_part IS NOT NULL OR collation = 'D' THEN '1'
                        ELSE '0'
                    END
                    ORDER BY seq_in_index SEPARATOR ','
                ) AS nonportable_keys
            FROM information_schema.statistics
            WHERE table_schema = ? AND table_name = ?
            GROUP BY index_name
            ORDER BY index_name = 'PRIMARY' DESC, non_unique ASC, index_name
            "#,
        )
        .bind(schema)
        .bind(table)
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                let name = mysql_string_by_index(row, 0).unwrap_or_default();
                let non_unique: i64 = row.try_get(1).unwrap_or(1);
                let columns = mysql_string_by_index(row, 4)
                    .unwrap_or_default()
                    .split(',')
                    .filter(|column| !column.is_empty())
                    .map(ToString::to_string)
                    .collect();
                let key_is_expression = mysql_string_by_index(row, 5)
                    .unwrap_or_default()
                    .split(',')
                    .filter(|value| !value.is_empty())
                    .map(|value| value == "1")
                    .collect();

                IndexInfo {
                    is_primary: name == "PRIMARY",
                    is_unique: non_unique == 0,
                    name,
                    columns,
                    filter: None,
                    index_type: mysql_string_by_index(row, 2),
                    included_columns: None,
                    definition: None,
                    comment: mysql_string_by_index(row, 3)
                        .filter(|comment| !comment.trim().is_empty()),
                    // The shared protocol uses this vector as the conservative
                    // "raw key semantics" marker. MySQL functional keys,
                    // prefix lengths and descending order cannot be recreated
                    // from the plain column list, so mark each of them as
                    // non-portable rather than silently weakening the index.
                    key_is_expression,
                }
            })
            .collect())
    }

    async fn get_constraints(&self, schema: &str, table: &str) -> Result<Vec<ConstraintInfo>> {
        let pool = self.get_pool(None).await?;
        let rows = sqlx::query(
            r#"
            SELECT
                tc.constraint_name,
                tc.constraint_type,
                GROUP_CONCAT(kcu.column_name ORDER BY kcu.ordinal_position SEPARATOR ',') AS columns,
                MAX(kcu.referenced_table_schema) AS referenced_schema,
                MAX(kcu.referenced_table_name) AS referenced_table,
                GROUP_CONCAT(kcu.referenced_column_name ORDER BY kcu.position_in_unique_constraint SEPARATOR ',') AS referenced_columns,
                MAX(cc.check_clause) AS check_clause,
                MAX(rc.update_rule) AS on_update,
                MAX(rc.delete_rule) AS on_delete
            FROM information_schema.table_constraints tc
            LEFT JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_schema = tc.constraint_schema
             AND kcu.table_schema = tc.table_schema
             AND kcu.table_name = tc.table_name
             AND kcu.constraint_name = tc.constraint_name
            LEFT JOIN information_schema.check_constraints cc
              ON cc.constraint_schema = tc.constraint_schema
             AND cc.constraint_name = tc.constraint_name
            LEFT JOIN information_schema.referential_constraints rc
              ON rc.constraint_schema = tc.constraint_schema
             AND rc.table_name = tc.table_name
             AND rc.constraint_name = tc.constraint_name
            WHERE tc.table_schema = ? AND tc.table_name = ?
            GROUP BY tc.constraint_name, tc.constraint_type
            ORDER BY tc.constraint_type, tc.constraint_name
            "#,
        )
        .bind(schema)
        .bind(table)
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                let columns = mysql_string_by_index(row, 2)
                    .unwrap_or_default()
                    .split(',')
                    .filter(|column| !column.is_empty())
                    .map(ToString::to_string)
                    .collect();
                let referenced_columns = mysql_string_by_index(row, 5)
                    .unwrap_or_default()
                    .split(',')
                    .filter(|column| !column.is_empty())
                    .map(ToString::to_string)
                    .collect();

                ConstraintInfo {
                    name: mysql_string_by_index(row, 0).unwrap_or_default(),
                    constraint_type: mysql_string_by_index(row, 1).unwrap_or_default(),
                    columns,
                    referenced_schema: mysql_string_by_index(row, 3),
                    referenced_table: mysql_string_by_index(row, 4),
                    referenced_columns,
                    definition: mysql_string_by_index(row, 6),
                    on_update: mysql_string_by_index(row, 7),
                    on_delete: mysql_string_by_index(row, 8),
                }
            })
            .collect())
    }

    async fn get_referencing_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        let pool = self.get_pool(None).await?;
        let rows = sqlx::query(
            r#"
            SELECT
                kcu.constraint_name,
                kcu.table_schema,
                kcu.table_name,
                GROUP_CONCAT(kcu.column_name ORDER BY kcu.ordinal_position SEPARATOR ',') AS columns,
                kcu.referenced_table_schema,
                kcu.referenced_table_name,
                GROUP_CONCAT(kcu.referenced_column_name ORDER BY kcu.ordinal_position SEPARATOR ',') AS referenced_columns
            FROM information_schema.key_column_usage kcu
            WHERE kcu.referenced_table_schema = ?
              AND kcu.referenced_table_name = ?
            GROUP BY
                kcu.constraint_name,
                kcu.table_schema,
                kcu.table_name,
                kcu.referenced_table_schema,
                kcu.referenced_table_name
            ORDER BY kcu.table_schema, kcu.table_name, kcu.constraint_name
            "#,
        )
        .bind(schema)
        .bind(table)
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| ForeignKeyReferenceInfo {
                name: mysql_string_by_index(row, 0).unwrap_or_default(),
                schema: mysql_string_by_index(row, 1).unwrap_or_default(),
                table: mysql_string_by_index(row, 2).unwrap_or_default(),
                columns: mysql_string_by_index(row, 3)
                    .unwrap_or_default()
                    .split(',')
                    .filter(|column| !column.is_empty())
                    .map(ToString::to_string)
                    .collect(),
                referenced_schema: mysql_string_by_index(row, 4).unwrap_or_default(),
                referenced_table: mysql_string_by_index(row, 5).unwrap_or_default(),
                referenced_columns: mysql_string_by_index(row, 6)
                    .unwrap_or_default()
                    .split(',')
                    .filter(|column| !column.is_empty())
                    .map(ToString::to_string)
                    .collect(),
            })
            .collect())
    }

    async fn get_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>> {
        let pool = self.get_pool(None).await?;
        let rows = sqlx::query(
            r#"
            SELECT
                r.routine_name,
                r.specific_name,
                LOWER(r.routine_type) AS routine_type,
                CASE
                    WHEN r.routine_type = 'PROCEDURE' THEN 'void'
                    ELSE COALESCE(r.dtd_identifier, r.data_type, 'unknown')
                END AS return_type,
                NULLIF(r.routine_comment, '') AS description,
                p.parameter_name,
                p.dtd_identifier AS parameter_type,
                p.parameter_mode,
                p.ordinal_position
            FROM information_schema.routines r
            LEFT JOIN information_schema.parameters p
              ON p.specific_schema = r.routine_schema
             AND p.specific_name = r.specific_name
            WHERE r.routine_schema = ?
              AND r.routine_type IN ('FUNCTION', 'PROCEDURE')
            ORDER BY r.routine_name, r.specific_name, p.ordinal_position
            "#,
        )
        .bind(schema)
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        let mut functions = Vec::<FunctionInfo>::new();
        let mut function_indexes = HashMap::<String, usize>::new();

        for row in rows {
            let specific_name = mysql_string_by_index(&row, 1)
                .unwrap_or_else(|| mysql_string_by_index(&row, 0).unwrap_or_default());
            let function_index = if let Some(index) = function_indexes.get(&specific_name) {
                *index
            } else {
                let index = functions.len();
                function_indexes.insert(specific_name.clone(), index);
                functions.push(FunctionInfo {
                    name: mysql_string_by_index(&row, 0).unwrap_or_default(),
                    routine_type: mysql_string_by_index(&row, 2),
                    parameters: Vec::new(),
                    return_type: mysql_string_by_index(&row, 3)
                        .unwrap_or_else(|| "unknown".to_string()),
                    description: mysql_string_by_index(&row, 4),
                });
                index
            };

            let parameter_name =
                mysql_string_by_index(&row, 5).filter(|value| !value.trim().is_empty());
            let parameter_mode = mysql_string_by_index(&row, 7)
                .unwrap_or_default()
                .to_ascii_uppercase();
            if parameter_name.is_none() || parameter_mode == "RETURN" {
                continue;
            }

            let position = row.try_get::<i32, _>(8).unwrap_or(0);
            functions[function_index]
                .parameters
                .push(FunctionParameterInfo {
                    name: parameter_name.unwrap_or_else(|| format!("arg{position}")),
                    data_type: mysql_string_by_index(&row, 6)
                        .unwrap_or_else(|| "unknown".to_string()),
                    optional: false,
                });
        }

        Ok(functions)
    }

    async fn get_schema_objects(&self, schema: &str) -> Result<Vec<SchemaObjectInfo>> {
        let schema = schema.trim();
        if schema.is_empty() {
            return Ok(Vec::new());
        }
        let pool = self.get_pool(None).await?;
        let rows = sqlx::query(MYSQL_SCHEMA_OBJECTS_SQL)
            .bind(schema)
            .bind(schema)
            .persistent(false)
            .fetch_all(&pool)
            .await?;
        Ok(rows
            .iter()
            .filter_map(|row| {
                let name = mysql_string_by_name(row, "object_name")?;
                let object_type = mysql_string_by_name(row, "object_type")?;
                (!name.trim().is_empty() && !object_type.trim().is_empty()).then(|| {
                    SchemaObjectInfo {
                        name,
                        schema: Some(schema.to_string()),
                        object_type,
                        parent_name: mysql_string_by_name(row, "parent_name")
                            .filter(|value| !value.trim().is_empty()),
                        comment: None,
                        members_expandable: false,
                    }
                })
            })
            .collect())
    }

    async fn set_current_schema(&self, _schema: &str) -> Result<()> {
        // With multi-pool, we don't strictly need to "set" it on the connection.
        // But we could pre-warm the pool here.
        self.get_pool(Some(_schema)).await?;
        Ok(())
    }

    async fn invalidate_schema(&self, schema: &str) -> Result<()> {
        let schema = schema.trim();
        if schema.is_empty() {
            return Ok(());
        }

        let pool = {
            let mut pools = self.pools.lock().await;
            pools.remove(schema)
        };

        if let Some(pool) = pool {
            pool.close().await;
        }

        Ok(())
    }
}

const JS_SAFE_INTEGER_MAX: i64 = 9_007_199_254_740_991;

fn json_i64(value: i64) -> serde_json::Value {
    if (-JS_SAFE_INTEGER_MAX..=JS_SAFE_INTEGER_MAX).contains(&value) {
        serde_json::Value::Number(value.into())
    } else {
        serde_json::Value::String(value.to_string())
    }
}

fn json_u64(value: u64) -> serde_json::Value {
    if value <= JS_SAFE_INTEGER_MAX as u64 {
        serde_json::Value::Number(value.into())
    } else {
        serde_json::Value::String(value.to_string())
    }
}

fn non_finite_float_text(value: f64) -> &'static str {
    if value.is_nan() {
        "NaN"
    } else if value.is_sign_positive() {
        "Infinity"
    } else {
        "-Infinity"
    }
}

fn json_f32(value: f32) -> serde_json::Value {
    if value.is_finite() {
        value
            .to_string()
            .parse::<serde_json::Number>()
            .map(serde_json::Value::Number)
            .expect("finite f32 values always have a valid JSON representation")
    } else {
        serde_json::Value::String(non_finite_float_text(f64::from(value)).into())
    }
}

fn json_f64(value: f64) -> serde_json::Value {
    serde_json::Number::from_f64(value)
        .map(serde_json::Value::Number)
        .unwrap_or_else(|| serde_json::Value::String(non_finite_float_text(value).into()))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn hex_decode(value: &str) -> Result<Vec<u8>> {
    let value = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("\\x"))
        .unwrap_or(value);
    if !value.len().is_multiple_of(2) {
        return Err(anyhow!(
            "Hex-encoded binary values must contain an even number of digits"
        ));
    }

    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).expect("hex pairs are always UTF-8");
            u8::from_str_radix(pair, 16)
                .map_err(|_| anyhow!("Invalid hex byte in binary value: {pair}"))
        })
        .collect()
}

fn binary_json(bytes: &[u8]) -> serde_json::Value {
    serde_json::Value::String(format!("0x{}", hex_encode(bytes)))
}

fn mysql_fallback_value(row: &MySqlRow, index: usize, type_name: &str) -> serde_json::Value {
    if let Ok(value) = row.try_get_unchecked::<String, _>(index) {
        return serde_json::Value::String(value);
    }
    if let Ok(value) = row.try_get_unchecked::<Vec<u8>, _>(index) {
        return binary_json(&value);
    }

    serde_json::Value::String(format!("<unreadable MySQL {type_name} value>"))
}

fn decode_mysql_value(row: &MySqlRow, index: usize) -> serde_json::Value {
    let col = row.column(index);
    let type_name = col.type_info().name();

    macro_rules! decode {
        ($ty:ty, $map:expr) => {
            row.try_get_unchecked::<Option<$ty>, _>(index)
                .map(|value| value.map($map).unwrap_or(serde_json::Value::Null))
                .unwrap_or_else(|_| mysql_fallback_value(row, index, type_name))
        };
    }

    match type_name {
        "BOOLEAN" | "BOOL" => decode!(bool, serde_json::Value::Bool),
        "TINYINT" => decode!(i8, |value| json_i64(i64::from(value))),
        "TINYINT UNSIGNED" => decode!(u8, |value| json_u64(u64::from(value))),
        "SMALLINT" => decode!(i16, |value| json_i64(i64::from(value))),
        "SMALLINT UNSIGNED" => decode!(u16, |value| json_u64(u64::from(value))),
        "INT" | "INTEGER" | "MEDIUMINT" => {
            decode!(i32, |value| json_i64(i64::from(value)))
        }
        "INT UNSIGNED" | "INTEGER UNSIGNED" | "MEDIUMINT UNSIGNED" => {
            decode!(u32, |value| json_u64(u64::from(value)))
        }
        "BIGINT" => decode!(i64, json_i64),
        "BIGINT UNSIGNED" => decode!(u64, json_u64),
        "YEAR" => decode!(u16, |value| json_u64(u64::from(value))),
        "BIT" => decode!(u64, json_u64),
        "FLOAT" => decode!(f32, json_f32),
        "DOUBLE" => decode!(f64, json_f64),
        "DECIMAL" => decode!(BigDecimal, |value| serde_json::Value::String(
            value.to_string()
        )),
        "VARCHAR" | "CHAR" | "TEXT" | "LONGTEXT" | "MEDIUMTEXT" | "TINYTEXT" | "ENUM" | "SET" => {
            decode!(String, serde_json::Value::String)
        }
        "JSON" => decode!(serde_json::Value, |value| value),
        "DATE" => decode!(NaiveDate, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIMESTAMP" | "DATETIME" => decode!(NaiveDateTime, |value| {
            serde_json::Value::String(value.to_string())
        }),
        "TIME" => decode!(MySqlTime, |value| serde_json::Value::String(
            value.to_string()
        )),
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" | "GEOMETRY" => {
            decode!(Vec<u8>, |value| binary_json(&value))
        }
        "NULL" => serde_json::Value::Null,
        _ => mysql_fallback_value(row, index, type_name),
    }
}

fn is_mysql_binary_type(data_type: Option<&str>) -> bool {
    let Some(data_type) = data_type else {
        return false;
    };
    let normalized = data_type.to_ascii_lowercase();
    let base_type = normalized
        .split_whitespace()
        .next()
        .unwrap_or("")
        .split('(')
        .next()
        .unwrap_or("")
        .trim();
    matches!(
        base_type,
        "binary" | "varbinary" | "tinyblob" | "blob" | "mediumblob" | "longblob"
    )
}

fn binary_parameter_bytes(value: &serde_json::Value) -> Result<Vec<u8>> {
    match value {
        serde_json::Value::String(value) if value.starts_with("0x") || value.starts_with("\\x") => {
            hex_decode(value)
        }
        serde_json::Value::String(value) => Ok(value.as_bytes().to_vec()),
        serde_json::Value::Array(values) => values
            .iter()
            .map(|value| {
                value
                    .as_u64()
                    .and_then(|value| u8::try_from(value).ok())
                    .ok_or_else(|| anyhow!("Binary byte arrays may only contain integers 0..255"))
            })
            .collect(),
        _ => Err(anyhow!(
            "Binary parameters must be hex strings, text, or byte arrays"
        )),
    }
}

fn is_mysql_unsigned_type(data_type: Option<&str>) -> bool {
    data_type.is_some_and(|data_type| {
        data_type
            .split_whitespace()
            .any(|part| part.eq_ignore_ascii_case("unsigned"))
    })
}

fn is_mysql_bit_type(data_type: Option<&str>) -> bool {
    data_type.is_some_and(|data_type| {
        data_type
            .trim()
            .split('(')
            .next()
            .unwrap_or("")
            .eq_ignore_ascii_case("bit")
    })
}

fn bind_mysql_parameter<'q>(
    query: Query<'q, MySql, MySqlArguments>,
    param: &QueryParameter,
) -> Result<Query<'q, MySql, MySqlArguments>> {
    if param.value.is_null() {
        return Ok(query.bind(Option::<String>::None));
    }
    if is_mysql_binary_type(param.data_type.as_deref()) {
        return Ok(query.bind(binary_parameter_bytes(&param.value)?));
    }
    if is_mysql_bit_type(param.data_type.as_deref()) {
        let value = match &param.value {
            serde_json::Value::Number(value) => value.as_u64(),
            serde_json::Value::String(value) => value.parse::<u64>().ok(),
            _ => None,
        }
        .ok_or_else(|| anyhow!("MySQL BIT parameters must be unsigned integers"))?;
        return Ok(query.bind(value));
    }

    Ok(match &param.value {
        serde_json::Value::Null => unreachable!("NULL parameters return above"),
        serde_json::Value::Bool(value) => query.bind(*value),
        serde_json::Value::Number(value) => {
            if is_integral_type(param.data_type.as_deref()) {
                if is_mysql_unsigned_type(param.data_type.as_deref()) {
                    if let Some(value) = value.as_u64() {
                        query.bind(value)
                    } else {
                        query.bind(value.to_string())
                    }
                } else if let Some(value) = value.as_i64() {
                    query.bind(value)
                } else if let Some(value) =
                    value.as_u64().and_then(|value| i64::try_from(value).ok())
                {
                    query.bind(value)
                } else {
                    query.bind(value.to_string())
                }
            } else if let Some(value) = value.as_f64() {
                query.bind(value)
            } else {
                query.bind(value.to_string())
            }
        }
        serde_json::Value::String(value) => {
            if is_integral_type(param.data_type.as_deref()) {
                if is_mysql_unsigned_type(param.data_type.as_deref()) {
                    if let Ok(value) = value.parse::<u64>() {
                        query.bind(value)
                    } else {
                        query.bind(value.clone())
                    }
                } else if let Ok(value) = value.parse::<i64>() {
                    query.bind(value)
                } else {
                    query.bind(value.clone())
                }
            } else {
                query.bind(value.clone())
            }
        }
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            query.bind(serde_json::to_string(&param.value)?)
        }
    })
}

fn is_integral_type(data_type: Option<&str>) -> bool {
    let Some(data_type) = data_type else {
        return false;
    };
    let normalized = data_type.to_ascii_lowercase();
    let base_type = normalized
        .split_whitespace()
        .next()
        .unwrap_or("")
        .split('(')
        .next()
        .unwrap_or("")
        .trim();
    matches!(
        base_type,
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint" | "serial"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use dotenvy::dotenv;
    use std::env;

    #[test]
    fn mysql_column_ownership_does_not_confuse_default_generated_with_computed() {
        assert_eq!(mysql_column_ownership("DEFAULT_GENERATED"), (false, false));
        assert_eq!(
            mysql_column_ownership("DEFAULT_GENERATED on update CURRENT_TIMESTAMP"),
            (false, false)
        );
        assert_eq!(mysql_column_ownership("VIRTUAL GENERATED"), (true, false));
        assert_eq!(
            mysql_column_ownership("STORED GENERATED INVISIBLE"),
            (true, true)
        );
        assert_eq!(mysql_column_ownership("INVISIBLE"), (false, true));
    }

    #[test]
    fn legacy_add_column_if_not_exists_only_accepts_one_verified_operation() {
        assert_eq!(
            mysql_add_column_if_not_exists(
                "ALTER TABLE `app`.`users` ADD COLUMN IF NOT EXISTS `nickname` VARCHAR(64) AFTER `email`"
            ),
            Some(MysqlAddColumnIfNotExists {
                database: Some("app".to_string()),
                table: "users".to_string(),
                column: "nickname".to_string(),
            })
        );
        assert!(mysql_add_column_if_not_exists(
            "ALTER TABLE users ADD COLUMN nickname VARCHAR(64)"
        )
        .is_none());
        assert!(mysql_add_column_if_not_exists(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(64), ADD COLUMN status INT"
        )
        .is_none());
        assert!(
            mysql_add_column_if_not_exists("ALTER TABLE users DROP COLUMN IF EXISTS nickname")
                .is_none()
        );
    }

    #[test]
    fn legacy_add_column_if_not_exists_skips_comments_and_literals() {
        let sql = "/* IF NOT EXISTS */ ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(64) DEFAULT 'IF NOT EXISTS'";
        assert_eq!(
            mysql_add_column_fallback_sql(sql),
            Some("/* IF NOT EXISTS */ ALTER TABLE users ADD COLUMN  nickname VARCHAR(64) DEFAULT 'IF NOT EXISTS'".to_string())
        );
        assert_eq!(
            mysql_add_column_if_not_exists(sql),
            Some(MysqlAddColumnIfNotExists {
                database: None,
                table: "users".to_string(),
                column: "nickname".to_string(),
            })
        );
    }

    #[test]
    fn empty_mysql_rows_preserve_described_columns() {
        let driver = MysqlDriver::new("mysql://user:pass@localhost/db");
        let results = driver
            .process_rows(
                Vec::new(),
                vec![
                    ColumnDef {
                        name: "id".to_string(),
                        data_type: "BIGINT".to_string(),
                    },
                    ColumnDef {
                        name: "email".to_string(),
                        data_type: "VARCHAR".to_string(),
                    },
                ],
            )
            .expect("empty rows should produce a query result");

        assert_eq!(results.len(), 1);
        assert!(results[0].rows.is_empty());
        assert_eq!(results[0].columns.len(), 2);
        assert_eq!(results[0].columns[0].name, "id");
        assert_eq!(results[0].columns[0].data_type, "BIGINT");
        assert_eq!(results[0].columns[1].name, "email");
        assert_eq!(results[0].columns[1].data_type, "VARCHAR");
    }

    #[test]
    fn mysql_json_integers_only_use_numbers_inside_javascript_safe_range() {
        assert_eq!(
            json_i64(JS_SAFE_INTEGER_MAX),
            serde_json::json!(9_007_199_254_740_991_i64)
        );
        assert_eq!(
            json_i64(JS_SAFE_INTEGER_MAX + 1),
            serde_json::json!("9007199254740992")
        );
        assert_eq!(
            json_i64(i64::MIN),
            serde_json::json!("-9223372036854775808")
        );
        assert_eq!(
            json_u64(u64::MAX),
            serde_json::json!("18446744073709551615")
        );
    }

    #[test]
    fn mysql_binary_hex_representation_is_reversible() {
        let bytes = vec![0x00, 0x7f, 0x80, 0xff];
        assert_eq!(binary_json(&bytes), serde_json::json!("0x007f80ff"));
        assert_eq!(hex_decode("0x007f80ff").unwrap(), bytes);
        assert!(hex_decode("0x0").is_err());
        assert!(hex_decode("0xzz").is_err());
    }

    #[test]
    fn mysql_float_representation_keeps_f32_shape_and_special_values() {
        assert_eq!(json_f32(0.1), serde_json::json!(0.1));
        assert_eq!(json_f32(f32::NAN), serde_json::json!("NaN"));
        assert_eq!(json_f64(f64::INFINITY), serde_json::json!("Infinity"));
        assert_eq!(json_f64(f64::NEG_INFINITY), serde_json::json!("-Infinity"));
    }

    #[test]
    fn mysql_type_detection_preserves_unsigned_and_binary_bindings() {
        assert!(is_mysql_unsigned_type(Some("bigint unsigned")));
        assert!(!is_mysql_unsigned_type(Some("bigint")));
        assert!(is_mysql_binary_type(Some("varbinary(255)")));
        assert!(is_mysql_binary_type(Some("longblob")));
        assert!(!is_mysql_binary_type(Some("varchar(255)")));
        assert!(is_mysql_bit_type(Some("bit(64)")));
    }

    #[test]
    fn parses_mysql_connection_id_from_compatible_text_value() {
        assert_eq!(parse_mysql_connection_id(" 4242 "), Some(4242));
        assert_eq!(parse_mysql_connection_id("0"), None);
        assert_eq!(parse_mysql_connection_id("-1"), None);
        assert_eq!(parse_mysql_connection_id("not-a-thread"), None);
    }

    #[test]
    fn mysql_connection_id_query_normalizes_compatible_numeric_types() {
        assert_eq!(
            MYSQL_CONNECTION_ID_SQL,
            "SELECT CAST(CONNECTION_ID() AS CHAR)"
        );
    }

    #[test]
    fn schema_object_catalog_covers_triggers_and_events_without_ddl() {
        assert!(MYSQL_SCHEMA_OBJECTS_SQL.contains("information_schema.triggers"));
        assert!(MYSQL_SCHEMA_OBJECTS_SQL.contains("information_schema.events"));
        assert!(MYSQL_SCHEMA_OBJECTS_SQL.contains("event_object_table AS parent_name"));
        assert!(!MYSQL_SCHEMA_OBJECTS_SQL
            .to_ascii_uppercase()
            .contains("SHOW CREATE"));
        assert!(!MYSQL_SCHEMA_OBJECTS_SQL
            .to_ascii_uppercase()
            .contains("INSERT"));
    }

    #[test]
    fn tracked_query_guard_removes_active_query_on_drop() {
        let active_queries = StdMutex::new(HashMap::from([("q1".to_string(), 42)]));

        {
            let _guard = MysqlTrackedQueryGuard {
                active_queries: &active_queries,
                query_id: Some("q1".to_string()),
            };
        }

        assert!(!active_queries
            .lock()
            .expect("active query map mutex poisoned")
            .contains_key("q1"));
    }

    #[test]
    fn drain_active_query_threads_clears_tracked_queries() {
        let driver = MysqlDriver::new("mysql://user:pass@localhost/db");
        driver
            .active_queries
            .lock()
            .expect("active query map mutex poisoned")
            .extend([("q1".to_string(), 11), ("q2".to_string(), 12)]);

        let mut drained = driver.drain_active_query_threads();
        drained.sort_by(|left, right| left.0.cmp(&right.0));

        assert_eq!(
            drained,
            vec![("q1".to_string(), 11), ("q2".to_string(), 12)]
        );
        assert!(driver
            .active_queries
            .lock()
            .expect("active query map mutex poisoned")
            .is_empty());
    }

    #[test]
    fn remove_active_query_thread_only_removes_matching_thread() {
        let driver = MysqlDriver::new("mysql://user:pass@localhost/db");
        driver
            .active_queries
            .lock()
            .expect("active query map mutex poisoned")
            .insert("q1".to_string(), 41);

        driver.remove_active_query_thread_if_matches("q1", 42);
        assert_eq!(driver.active_query_thread("q1"), Some(41));

        driver.remove_active_query_thread_if_matches("q1", 41);
        assert_eq!(driver.active_query_thread("q1"), None);
    }

    #[tokio::test]
    async fn cancel_query_retains_tracking_when_mysql_pool_is_unavailable() {
        let driver = MysqlDriver::new("mysql://user:pass@localhost/db");
        driver
            .active_queries
            .lock()
            .expect("active query map mutex poisoned")
            .insert("q1".to_string(), 42);

        let error = driver
            .cancel_query("q1")
            .await
            .expect_err("missing pool should fail cancellation");

        assert!(error.to_string().contains("Driver not connected"));
        assert_eq!(driver.active_query_thread("q1"), Some(42));
    }

    #[tokio::test]
    async fn get_pool_rejects_when_driver_is_not_connected() {
        let driver = MysqlDriver::new("mysql://user:pass@localhost/db");

        let error = driver.get_pool(None).await.unwrap_err().to_string();

        assert!(error.contains("Driver not connected"));
    }

    #[tokio::test]
    async fn disconnect_clears_mysql_connection_options() {
        let driver = MysqlDriver::new("mysql://user:pass@localhost/db");
        let options = MySqlConnectOptions::from_str("mysql://user:pass@localhost/db")
            .expect("test MySQL URL should parse")
            .disable_statement_logging()
            .to_owned();
        {
            let mut base_options = driver.base_options.lock().await;
            *base_options = Some(options);
        }

        driver
            .disconnect()
            .await
            .expect("disconnect should succeed");
        driver
            .disconnect()
            .await
            .expect("second disconnect should be idempotent");

        assert!(driver.base_options.lock().await.is_none());
        assert!(driver.pools.lock().await.is_empty());
    }

    #[test]
    fn mysql_unprepared_routing_covers_ddl_and_mysql_commands() {
        assert!(mysql_requires_unprepared("CREATE DATABASE app"));
        assert!(mysql_requires_unprepared("show tables"));
        assert!(mysql_requires_unprepared("DESCRIBE users"));
        assert!(mysql_requires_unprepared("BEGIN"));
        assert!(mysql_requires_unprepared(
            "# generated dump\nCREATE TABLE users(id INT)"
        ));
        assert!(mysql_requires_unprepared(
            "/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */"
        ));
        assert!(mysql_requires_unprepared(
            "SELECT 1; CREATE TABLE users(id INT)"
        ));
        assert!(mysql_requires_unprepared(
            "SELECT ';' AS semicolon; UPDATE users SET name = 'a'"
        ));
        assert!(!mysql_requires_unprepared("SELECT * FROM users"));
        assert!(!mysql_requires_unprepared("SELECT ';' AS semicolon;"));
        assert!(!mysql_requires_unprepared("SELECT 1 /* ; */ -- ;\n;"));
        assert!(!mysql_requires_unprepared(
            "UPDATE users SET name = 'a' WHERE id = 1"
        ));
    }

    #[tokio::test]
    #[ignore = "requires a live TEST_MYSQL_URL database"]
    async fn test_get_schemas() {
        dotenv().ok();
        let database_url = env::var("TEST_MYSQL_URL").expect("TEST_MYSQL_URL must be set");

        let mut driver = MysqlDriver::new(&database_url);
        driver.connect().await.expect("Failed to connect");

        let schemas = driver.get_schemas().await.expect("Failed to get schemas");
        println!("Schemas: {:?}", schemas);
        assert!(!schemas.is_empty());

        driver.disconnect().await.expect("Failed to disconnect");
    }
}
