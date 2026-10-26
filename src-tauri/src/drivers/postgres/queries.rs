use super::models::{
    parse_postgres_backend_pid, PostgresDriver, PostgresTrackedQueryGuard,
    PostgresTransactionSessionHandle, POOL_CLOSE_TIMEOUT, POSTGRES_BACKEND_PID_SQL,
};
use super::values::{bind_pg_parameter, decode_pg_value};
use crate::core::protocol::{
    ColumnDef, QueryParameter, QueryResult, DEFAULT_QUERY_RESULT_ROW_LIMIT,
};
use crate::core::statement::{
    execution_mode, execution_statement_kind, split_sql_statements, QueryExecutionMode,
    StatementScanDialect,
};
use anyhow::{anyhow, Result};
use futures::{StreamExt, TryStreamExt};
use sqlx::postgres::PgRow;
use sqlx::{Column, Executor, Pool, Postgres, Row, TypeInfo};
use tokio::time::timeout;

impl PostgresDriver {
    pub(super) fn process_rows(
        &self,
        rows: Vec<PgRow>,
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
                let val = decode_pg_value(&row, i);
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
        rows: Vec<PgRow>,
        pool: &Pool<Postgres>,
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
        rows: Vec<PgRow>,
        conn: &mut sqlx::PgConnection,
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

    pub(super) async fn query_single_on_pool(
        &self,
        sql: &str,
        pool: &Pool<Postgres>,
    ) -> Result<Vec<QueryResult>> {
        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let rows = sqlx::query(sql)
                    .persistent(false)
                    .fetch(pool)
                    .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                    .try_collect::<Vec<_>>()
                    .await?;
                self.process_pool_rows(sql, rows, pool).await
            }
            QueryExecutionMode::AffectsRows => {
                let result = sqlx::query(sql).persistent(false).execute(pool).await?;
                Ok(vec![QueryResult::execution(
                    execution_statement_kind(sql).as_str(),
                    result.rows_affected(),
                )])
            }
        }
    }

    pub(super) async fn query_on_pool(
        &self,
        sql: &str,
        pool: &Pool<Postgres>,
    ) -> Result<Vec<QueryResult>> {
        let statements = split_sql_statements(sql, StatementScanDialect::Postgres);
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        if statements.len() <= 1 {
            return self.query_single_on_pool(statements[0], pool).await;
        }

        let mut connection = pool.acquire().await?;
        // A script may change session or transaction state. Never return that connection to the
        // pool if execution is cancelled between statements or the script leaves a transaction
        // open; dropping it closes the backend connection instead.
        connection.close_on_drop();
        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            results.extend(
                self.query_single_on_connection(statement, &mut connection)
                    .await?,
            );
        }
        Ok(results)
    }

    pub(super) async fn query_parameterized_on_pool(
        &self,
        sql: &str,
        params: &[QueryParameter],
        pool: &Pool<Postgres>,
    ) -> Result<Vec<QueryResult>> {
        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let mut query = sqlx::query(sql).persistent(false);
                for param in params {
                    query = bind_pg_parameter(query, param)?;
                }
                let rows = query
                    .fetch(pool)
                    .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                    .try_collect::<Vec<_>>()
                    .await?;
                self.process_pool_rows(sql, rows, pool).await
            }
            QueryExecutionMode::AffectsRows => {
                let mut query = sqlx::query(sql).persistent(false);
                for param in params {
                    query = bind_pg_parameter(query, param)?;
                }
                let result = query.execute(pool).await?;
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
        conn: &mut sqlx::PgConnection,
    ) -> Result<Vec<QueryResult>> {
        self.query_parameterized_on_connection(sql, &[], conn, DEFAULT_QUERY_RESULT_ROW_LIMIT)
            .await
    }

    pub(super) async fn query_parameterized_on_connection(
        &self,
        sql: &str,
        params: &[QueryParameter],
        conn: &mut sqlx::PgConnection,
        max_rows: usize,
    ) -> Result<Vec<QueryResult>> {
        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let rows = {
                    let mut query = sqlx::query(sql).persistent(false);
                    for param in params {
                        query = bind_pg_parameter(query, param)?;
                    }
                    let stream = query.fetch(&mut *conn);
                    stream
                        .take(max_rows.saturating_add(1))
                        .try_collect::<Vec<_>>()
                        .await?
                };
                self.process_connection_rows(sql, rows, conn).await
            }
            QueryExecutionMode::AffectsRows => {
                let mut query = sqlx::query(sql).persistent(false);
                for param in params {
                    query = bind_pg_parameter(query, param)?;
                }
                let result = query.execute(&mut *conn).await?;
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
        conn: &mut sqlx::PgConnection,
    ) -> Result<Vec<QueryResult>> {
        let statements = split_sql_statements(sql, StatementScanDialect::Postgres);
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
        conn: &mut sqlx::PgConnection,
    ) -> Result<PostgresTrackedQueryGuard<'a>> {
        let tracked_query_id = if let Some(query_id) = query_id {
            let backend_pid = sqlx::query_scalar::<_, String>(POSTGRES_BACKEND_PID_SQL)
                .persistent(false)
                .fetch_one(&mut *conn)
                .await
                .ok()
                .and_then(|value| parse_postgres_backend_pid(&value));

            if let Some(backend_pid) = backend_pid {
                let mut active_queries = self
                    .active_queries
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                active_queries.insert(query_id.to_string(), backend_pid);
                Some(query_id.to_string())
            } else {
                // PostgreSQL-compatible servers do not always expose the native
                // int4 backend PID. Query execution must still work; only
                // server-side cancellation is unavailable for this request.
                tracing::debug!(
                    "PostgreSQL-compatible server did not expose a cancellable backend PID"
                );
                None
            }
        } else {
            None
        };

        Ok(PostgresTrackedQueryGuard {
            active_queries: &self.active_queries,
            query_id: tracked_query_id,
        })
    }

    pub(super) fn drain_active_query_backends(&self) -> Vec<(String, i32)> {
        self.active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain()
            .collect()
    }

    pub(super) fn active_query_backend(&self, query_id: &str) -> Option<i32> {
        self.active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(query_id)
            .copied()
    }

    pub(super) fn remove_active_query_backend_if_matches(&self, query_id: &str, backend_pid: i32) {
        let mut active_queries = self
            .active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if active_queries.get(query_id) == Some(&backend_pid) {
            active_queries.remove(query_id);
        }
    }

    pub(super) async fn cancel_tracked_queries_on_pool(
        &self,
        pool: &Pool<Postgres>,
        active_queries: Vec<(String, i32)>,
    ) {
        for (query_id, backend_pid) in active_queries {
            let cancel_result: std::result::Result<bool, sqlx::Error> =
                sqlx::query_scalar("SELECT pg_cancel_backend($1)")
                    .bind(backend_pid)
                    .persistent(false)
                    .fetch_one(pool)
                    .await;

            match cancel_result {
                Ok(false) => {
                    tracing::warn!(
                        "PostgreSQL did not accept cancellation for active query {} on backend {} during disconnect",
                        query_id,
                        backend_pid
                    );
                }
                Ok(true) => {}
                Err(error) => {
                    tracing::warn!(
                        "Failed to cancel active PostgreSQL query {} during disconnect: {}",
                        query_id,
                        error
                    );
                }
            }
        }
    }

    pub(super) async fn close_pool_with_timeout(pool: Pool<Postgres>) {
        if timeout(POOL_CLOSE_TIMEOUT, pool.close()).await.is_err() {
            tracing::warn!(
                "Timed out waiting for PostgreSQL pool to close after {:?}",
                POOL_CLOSE_TIMEOUT
            );
        }
    }

    pub(super) async fn get_transaction_session(
        &self,
        session_id: &str,
    ) -> Result<PostgresTransactionSessionHandle> {
        self.transaction_sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("Transaction not found: {}", session_id))
    }
}
