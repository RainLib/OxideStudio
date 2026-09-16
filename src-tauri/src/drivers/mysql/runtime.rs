use crate::core::protocol::{ColumnDef, QueryResult, DEFAULT_QUERY_RESULT_ROW_LIMIT};
use crate::core::statement::{
    execution_mode, execution_statement_kind, split_sql_statements, QueryExecutionMode,
    StatementScanDialect,
};
use anyhow::{anyhow, Result};
use futures::{StreamExt, TryStreamExt};
use sqlx::mysql::{MySqlPoolOptions, MySqlRow};
use sqlx::{Column, Executor, MySql, Pool, Row, TypeInfo};
use std::collections::HashMap;
use std::sync::Mutex as StdMutex;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::timeout;

use super::models::{
    mysql_add_column_fallback_sql, mysql_add_column_if_not_exists, mysql_is_syntax_error,
    mysql_requires_unprepared, parse_mysql_connection_id, MysqlAddColumnFallback, MysqlDriver,
    MysqlTrackedQueryGuard, MysqlTransactionSession, MYSQL_CONNECTION_ID_SQL, POOL_CLOSE_TIMEOUT,
};
use super::values::decode_mysql_value;

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

    pub(super) async fn legacy_add_column_fallback_on_pool(
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

    pub(super) async fn legacy_add_column_fallback_on_connection(
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
    pub(super) async fn get_pool(&self, schema: Option<&str>) -> Result<Pool<MySql>> {
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

    pub(super) fn process_rows(
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

    pub(super) async fn process_pool_rows(
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

    pub(super) async fn process_connection_rows(
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

    pub(super) async fn query_on_pool(
        &self,
        sql: &str,
        pool: &Pool<MySql>,
    ) -> Result<Vec<QueryResult>> {
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

    pub(super) async fn query_single_on_connection(
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

    pub(super) async fn query_on_connection(
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

    pub(super) async fn track_query_on_connection<'a>(
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

    pub(super) fn drain_active_query_threads(&self) -> Vec<(String, u64)> {
        self.active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain()
            .collect()
    }

    pub(super) fn active_query_thread(&self, query_id: &str) -> Option<u64> {
        self.active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(query_id)
            .copied()
    }

    pub(super) fn remove_active_query_thread_if_matches(&self, query_id: &str, thread_id: u64) {
        let mut active_queries = self
            .active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if active_queries.get(query_id) == Some(&thread_id) {
            active_queries.remove(query_id);
        }
    }

    pub(super) async fn cancel_tracked_queries_on_pool(
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

    pub(super) async fn close_pool_with_timeout(pool: Pool<MySql>) {
        if timeout(POOL_CLOSE_TIMEOUT, pool.close()).await.is_err() {
            tracing::warn!(
                "Timed out waiting for MySQL pool to close after {:?}",
                POOL_CLOSE_TIMEOUT
            );
        }
    }

    pub(super) async fn get_transaction_session(
        &self,
        session_id: &str,
    ) -> Result<MysqlTransactionSession> {
        self.transaction_sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("Transaction not found: {}", session_id))
    }
}
