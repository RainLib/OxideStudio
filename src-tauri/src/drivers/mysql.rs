use crate::core::driver::DatabaseDriver;
use crate::core::protocol::{
    ColumnDef, ColumnInfo, ConstraintInfo, FunctionInfo, FunctionParameterInfo, IndexInfo,
    ParameterizedStatement, QueryParameter, QueryResult, TableInfo,
};
use crate::core::statement::{
    classify_statement, execution_mode, execution_statement_kind, has_multiple_statements,
    QueryExecutionMode, StatementKind, StatementScanDialect,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use sqlx::mysql::{MySqlArguments, MySqlConnectOptions, MySqlPoolOptions, MySqlRow};
use sqlx::pool::PoolConnection;
use sqlx::query::Query;
use sqlx::{Column, ConnectOptions, Executor, MySql, Pool, Row, TypeInfo};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::timeout;

type MysqlTransactionSession = Arc<Mutex<PoolConnection<MySql>>>;
const POOL_CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

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
                .expect("MySQL active query map mutex poisoned");
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
        | StatementKind::Describe => true,
        _ => {
            let normalized = sql.trim_start().to_ascii_uppercase();
            normalized.starts_with("BEGIN")
                || normalized.starts_with("START TRANSACTION")
                || normalized.starts_with("COMMIT")
                || normalized.starts_with("ROLLBACK")
        }
    }
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

    fn process_rows(&self, rows: Vec<MySqlRow>) -> Result<Vec<QueryResult>> {
        if rows.is_empty() {
            return Ok(vec![]);
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

        Ok(vec![QueryResult::rows(columns, data_rows)])
    }

    async fn query_on_pool(&self, sql: &str, pool: &Pool<MySql>) -> Result<Vec<QueryResult>> {
        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let rows = sqlx::raw_sql(sql).fetch_all(pool).await?;
                self.process_rows(rows)
            }
            QueryExecutionMode::AffectsRows => {
                let result = sqlx::raw_sql(sql).execute(pool).await?;
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
        if mysql_requires_unprepared(sql) {
            return match execution_mode(sql) {
                QueryExecutionMode::ReturnsRows => {
                    let rows = (&mut *conn).fetch_all(sql).await?;
                    self.process_rows(rows)
                }
                QueryExecutionMode::AffectsRows => {
                    let result = (&mut *conn).execute(sql).await?;
                    Ok(vec![QueryResult::execution(
                        execution_statement_kind(sql).as_str(),
                        result.rows_affected(),
                    )])
                }
            };
        }

        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let rows = sqlx::query(sql)
                    .persistent(false)
                    .fetch_all(&mut *conn)
                    .await?;
                self.process_rows(rows)
            }
            QueryExecutionMode::AffectsRows => {
                let result = sqlx::query(sql)
                    .persistent(false)
                    .execute(&mut *conn)
                    .await?;
                Ok(vec![QueryResult::execution(
                    execution_statement_kind(sql).as_str(),
                    result.rows_affected(),
                )])
            }
        }
    }

    async fn track_query_on_connection<'a>(
        &'a self,
        query_id: Option<&str>,
        conn: &mut sqlx::MySqlConnection,
    ) -> Result<MysqlTrackedQueryGuard<'a>> {
        let tracked_query_id = if let Some(query_id) = query_id {
            let thread_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
                .persistent(false)
                .fetch_one(&mut *conn)
                .await?;
            let mut active_queries = self
                .active_queries
                .lock()
                .expect("MySQL active query map mutex poisoned");
            active_queries.insert(query_id.to_string(), thread_id);
            Some(query_id.to_string())
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
            .expect("MySQL active query map mutex poisoned")
            .drain()
            .collect()
    }

    fn active_query_thread(&self, query_id: &str) -> Option<u64> {
        self.active_queries
            .lock()
            .expect("MySQL active query map mutex poisoned")
            .get(query_id)
            .copied()
    }

    fn remove_active_query_thread_if_matches(&self, query_id: &str, thread_id: u64) {
        let mut active_queries = self
            .active_queries
            .lock()
            .expect("MySQL active query map mutex poisoned");
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
            query = bind_mysql_parameter(query, param);
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
                    query = bind_mysql_parameter(query, param);
                }
                let rows = query.fetch_all(&pool).await?;
                self.process_rows(rows)
            }
            QueryExecutionMode::AffectsRows => {
                let mut query = sqlx::query(sql).persistent(false);
                for param in params {
                    query = bind_mysql_parameter(query, param);
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
                query = bind_mysql_parameter(query, param);
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

    async fn query_transaction(&self, session_id: &str, sql: &str) -> Result<Vec<QueryResult>> {
        let session = self.get_transaction_session(session_id).await?;
        let mut conn = session.lock().await;

        self.query_on_connection(sql, &mut **conn).await
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

        let tracked_query = self
            .track_query_on_connection(query_id, &mut **conn)
            .await?;
        let result = self.query_on_connection(sql, &mut **conn).await;
        drop(tracked_query);
        result
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
                    default_value: mysql_string_by_name(r, "cd"),
                    comment,
                }
            })
            .collect();

        Ok(cols)
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
        let pool = self.get_pool(None).await?;
        let rows = sqlx::query(
            r#"
            SELECT
                index_name,
                MAX(non_unique) AS non_unique,
                MAX(index_type) AS index_type,
                GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS columns
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
                let columns = mysql_string_by_index(row, 3)
                    .unwrap_or_default()
                    .split(',')
                    .filter(|column| !column.is_empty())
                    .map(ToString::to_string)
                    .collect();

                IndexInfo {
                    is_primary: name == "PRIMARY",
                    is_unique: non_unique == 0,
                    name,
                    columns,
                    index_type: mysql_string_by_index(row, 2),
                    definition: None,
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
                MAX(cc.check_clause) AS check_clause
            FROM information_schema.table_constraints tc
            LEFT JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_schema = tc.constraint_schema
             AND kcu.table_schema = tc.table_schema
             AND kcu.table_name = tc.table_name
             AND kcu.constraint_name = tc.constraint_name
            LEFT JOIN information_schema.check_constraints cc
              ON cc.constraint_schema = tc.constraint_schema
             AND cc.constraint_name = tc.constraint_name
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
                }
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

fn decode_mysql_value(row: &MySqlRow, index: usize) -> serde_json::Value {
    let col = row.column(index);
    let type_name = col.type_info().name();

    match type_name {
        "BOOLEAN" | "BOOL" | "TINYINT" => {
            let v: Option<i8> = row.try_get(index).ok();
            serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
        }
        "SMALLINT" | "INT" | "INTEGER" | "MEDIUMINT" | "BIGINT" => {
            let v: Option<i64> = row.try_get(index).ok();
            serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
        }
        "FLOAT" | "DOUBLE" | "DECIMAL" => {
            let v: Option<f64> = row.try_get(index).ok();
            serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
        }
        "VARCHAR" | "CHAR" | "TEXT" | "LONGTEXT" | "MEDIUMTEXT" | "TINYTEXT" | "ENUM" => {
            let v: Option<String> = row.try_get(index).ok();
            serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
        }
        "JSON" => {
            let v: Option<serde_json::Value> = row.try_get(index).ok();
            v.unwrap_or(serde_json::Value::Null)
        }
        _ => {
            let v: Option<String> = row.try_get(index).ok();
            serde_json::to_value(v).unwrap_or(serde_json::Value::String(format!("<{}>", type_name)))
        }
    }
}

fn bind_mysql_parameter<'q>(
    query: Query<'q, MySql, MySqlArguments>,
    param: &QueryParameter,
) -> Query<'q, MySql, MySqlArguments> {
    match &param.value {
        serde_json::Value::Null => query.bind(Option::<String>::None),
        serde_json::Value::Bool(value) => query.bind(*value),
        serde_json::Value::Number(value) => {
            if is_integral_type(param.data_type.as_deref()) {
                if let Some(value) = value.as_i64() {
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
        serde_json::Value::String(value) => query.bind(value.clone()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            query.bind(serde_json::to_string(&param.value).unwrap_or_default())
        }
    }
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
