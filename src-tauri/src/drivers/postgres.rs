use crate::core::dialect::DatabaseKind;
use crate::core::driver::DatabaseDriver;
use crate::core::protocol::{
    ColumnDef, ColumnInfo, ConstraintInfo, FunctionInfo, FunctionParameterInfo, IndexInfo,
    ParameterizedStatement, QueryParameter, QueryResult, TableInfo,
};
use crate::core::statement::{
    classify_statement, execution_mode, has_multiple_statements, QueryExecutionMode,
    StatementScanDialect,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use sqlx::pool::PoolConnection;
use sqlx::postgres::{PgArguments, PgConnectOptions, PgPoolOptions, PgRow};
use sqlx::query::Query;
use sqlx::{Column, ConnectOptions, Executor, Pool, Postgres, Row, TypeInfo};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::Mutex;

type PostgresTransactionSession = Arc<Mutex<PoolConnection<Postgres>>>;

pub struct PostgresDriver {
    pub pool: Mutex<Option<Pool<Postgres>>>,
    pub connection_string: String,
    pub transaction_sessions: Mutex<HashMap<String, PostgresTransactionSession>>,
    pub active_queries: StdMutex<HashMap<String, i32>>,
}

struct PostgresTrackedQueryGuard<'a> {
    active_queries: &'a StdMutex<HashMap<String, i32>>,
    query_id: Option<String>,
}

impl Drop for PostgresTrackedQueryGuard<'_> {
    fn drop(&mut self) {
        if let Some(query_id) = self.query_id.take() {
            let mut active_queries = self
                .active_queries
                .lock()
                .expect("PostgreSQL active query map mutex poisoned");
            active_queries.remove(&query_id);
        }
    }
}

impl PostgresDriver {
    pub fn new(connection_string: &str) -> Self {
        Self {
            pool: Mutex::new(None),
            connection_string: connection_string.to_string(),
            transaction_sessions: Mutex::new(HashMap::new()),
            active_queries: StdMutex::new(HashMap::new()),
        }
    }

    async fn get_pool(&self) -> Result<Pool<Postgres>> {
        let pool = self.pool.lock().await;
        pool.clone().ok_or_else(|| anyhow!("Not connected"))
    }

    fn process_rows(&self, rows: Vec<PgRow>) -> Result<Vec<QueryResult>> {
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
                let val = decode_pg_value(&row, i);
                row_values.push(val);
            }
            data_rows.push(row_values);
        }

        Ok(vec![QueryResult::rows(columns, data_rows)])
    }

    async fn query_on_pool(&self, sql: &str, pool: &Pool<Postgres>) -> Result<Vec<QueryResult>> {
        if has_multiple_statements(sql, StatementScanDialect::Postgres) {
            return match execution_mode(sql) {
                QueryExecutionMode::ReturnsRows => {
                    let rows = sqlx::raw_sql(sql).fetch_all(pool).await?;
                    self.process_rows(rows)
                }
                QueryExecutionMode::AffectsRows => {
                    let result = sqlx::raw_sql(sql).execute(pool).await?;
                    Ok(vec![QueryResult::execution(
                        classify_statement(sql).as_str(),
                        result.rows_affected(),
                    )])
                }
            };
        }

        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let rows = sqlx::query(sql).persistent(false).fetch_all(pool).await?;
                self.process_rows(rows)
            }
            QueryExecutionMode::AffectsRows => {
                let result = sqlx::query(sql).persistent(false).execute(pool).await?;
                Ok(vec![QueryResult::execution(
                    classify_statement(sql).as_str(),
                    result.rows_affected(),
                )])
            }
        }
    }

    async fn query_on_connection(
        &self,
        sql: &str,
        conn: &mut sqlx::PgConnection,
    ) -> Result<Vec<QueryResult>> {
        if has_multiple_statements(sql, StatementScanDialect::Postgres) {
            return match execution_mode(sql) {
                QueryExecutionMode::ReturnsRows => {
                    let rows = (&mut *conn).fetch_all(sql).await?;
                    self.process_rows(rows)
                }
                QueryExecutionMode::AffectsRows => {
                    let result = (&mut *conn).execute(sql).await?;
                    Ok(vec![QueryResult::execution(
                        classify_statement(sql).as_str(),
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
                    classify_statement(sql).as_str(),
                    result.rows_affected(),
                )])
            }
        }
    }

    async fn track_query_on_connection<'a>(
        &'a self,
        query_id: Option<&str>,
        conn: &mut sqlx::PgConnection,
    ) -> Result<PostgresTrackedQueryGuard<'a>> {
        let tracked_query_id = if let Some(query_id) = query_id {
            let backend_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
                .persistent(false)
                .fetch_one(&mut *conn)
                .await?;
            let mut active_queries = self
                .active_queries
                .lock()
                .expect("PostgreSQL active query map mutex poisoned");
            active_queries.insert(query_id.to_string(), backend_pid);
            Some(query_id.to_string())
        } else {
            None
        };

        Ok(PostgresTrackedQueryGuard {
            active_queries: &self.active_queries,
            query_id: tracked_query_id,
        })
    }

    async fn get_transaction_session(
        &self,
        session_id: &str,
    ) -> Result<PostgresTransactionSession> {
        self.transaction_sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("Transaction not found: {}", session_id))
    }
}

fn split_postgres_arguments(arguments: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let chars: Vec<char> = arguments.chars().collect();
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];
        if ch == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
        } else if ch == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
        } else if !in_single_quote && !in_double_quote {
            if ch == '(' {
                depth += 1;
            } else if ch == ')' {
                depth -= 1;
            } else if ch == ',' && depth == 0 {
                let part = current.trim();
                if !part.is_empty() {
                    parts.push(part.to_string());
                }
                current.clear();
                index += 1;
                continue;
            }
        }

        current.push(ch);
        index += 1;
    }

    let part = current.trim();
    if !part.is_empty() {
        parts.push(part.to_string());
    }

    parts
}

fn strip_default_expression(argument: &str) -> (&str, bool) {
    let upper = argument.to_ascii_uppercase();
    if let Some(index) = upper.find(" DEFAULT ") {
        return (argument[..index].trim(), true);
    }
    if let Some(index) = argument.find(" = ") {
        return (argument[..index].trim(), true);
    }
    (argument.trim(), false)
}

fn parse_postgres_function_parameters(arguments: &str) -> Vec<FunctionParameterInfo> {
    split_postgres_arguments(arguments)
        .into_iter()
        .enumerate()
        .filter_map(|(index, argument)| {
            let (argument, optional) = strip_default_expression(&argument);
            let mut tokens = argument.split_whitespace().collect::<Vec<_>>();
            if tokens.is_empty() {
                return None;
            }

            if matches!(
                tokens[0].to_ascii_uppercase().as_str(),
                "IN" | "OUT" | "INOUT" | "VARIADIC"
            ) {
                tokens.remove(0);
            }

            if tokens.is_empty() {
                return None;
            }

            let (name, data_type) = if tokens.len() == 1 {
                (format!("arg{}", index + 1), tokens[0].to_string())
            } else {
                (tokens[0].to_string(), tokens[1..].join(" "))
            };

            Some(FunctionParameterInfo {
                name,
                data_type,
                optional,
            })
        })
        .collect()
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    async fn connect(&mut self) -> Result<()> {
        let options = PgConnectOptions::from_str(&self.connection_string)?
            .disable_statement_logging()
            .statement_cache_capacity(0)
            .to_owned();

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(30))
            .connect_with(options)
            .await?;

        let mut current_pool = self.pool.lock().await;
        *current_pool = Some(pool);
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        self.active_queries
            .lock()
            .expect("PostgreSQL active query map mutex poisoned")
            .clear();

        let mut sessions = self.transaction_sessions.lock().await;
        let drained_sessions: Vec<_> = sessions.drain().map(|(_, conn)| conn).collect();
        drop(sessions);

        for session in drained_sessions {
            let mut conn = session.lock().await;
            if let Err(error) = sqlx::query("ROLLBACK").execute(&mut **conn).await {
                tracing::warn!(
                    "Failed to rollback PostgreSQL transaction on disconnect: {}",
                    error
                );
            }
        }

        let pool = {
            let mut pool = self.pool.lock().await;
            pool.take()
        };
        if let Some(pool) = pool {
            pool.close().await;
        }
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        let pool = self.get_pool().await?;
        sqlx::query("SELECT 1")
            .persistent(false)
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let pool = self.get_pool().await?;
        self.query_on_pool(sql, &pool).await
    }

    async fn execute_parameterized(&self, sql: &str, params: &[QueryParameter]) -> Result<u64> {
        let pool = self.get_pool().await?;
        let mut query = sqlx::query(sql).persistent(false);
        for param in params {
            query = bind_pg_parameter(query, param);
        }
        let result = query.execute(&pool).await?;
        Ok(result.rows_affected())
    }

    async fn query_parameterized(
        &self,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        let pool = self.get_pool().await?;
        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let mut query = sqlx::query(sql).persistent(false);
                for param in params {
                    query = bind_pg_parameter(query, param);
                }
                let rows = query.fetch_all(&pool).await?;
                self.process_rows(rows)
            }
            QueryExecutionMode::AffectsRows => {
                let mut query = sqlx::query(sql).persistent(false);
                for param in params {
                    query = bind_pg_parameter(query, param);
                }
                let result = query.execute(&pool).await?;
                Ok(vec![QueryResult::execution(
                    classify_statement(sql).as_str(),
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

        let pool = self.get_pool().await?;
        let mut conn = pool.acquire().await?;
        sqlx::query("BEGIN")
            .persistent(false)
            .execute(&mut *conn)
            .await?;

        let mut rows_affected = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.sql).persistent(false);
            for param in &statement.params {
                query = bind_pg_parameter(query, param);
            }

            match query.execute(&mut *conn).await {
                Ok(result) => rows_affected.push(result.rows_affected()),
                Err(error) => {
                    if let Err(rollback_error) = sqlx::query("ROLLBACK")
                        .persistent(false)
                        .execute(&mut *conn)
                        .await
                    {
                        tracing::warn!(
                            "Failed to rollback PostgreSQL mutation batch: {}",
                            rollback_error
                        );
                    }
                    return Err(error.into());
                }
            }
        }

        sqlx::query("COMMIT")
            .persistent(false)
            .execute(&mut *conn)
            .await?;
        Ok(rows_affected)
    }

    async fn query_tracked(&self, query_id: Option<&str>, sql: &str) -> Result<Vec<QueryResult>> {
        if query_id.is_none() {
            return self.query(sql).await;
        }

        let pool = self.get_pool().await?;
        let mut conn = pool.acquire().await?;
        let tracked_query = self.track_query_on_connection(query_id, &mut conn).await?;
        let result = self.query_on_connection(sql, &mut conn).await;
        drop(tracked_query);
        result
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        let pool = self.get_pool().await?;
        let mut conn = pool.acquire().await?;
        let search_path = DatabaseKind::Postgres.quote_identifier(schema);

        sqlx::query("SELECT set_config('search_path', $1, false)")
            .bind(search_path)
            .persistent(false)
            .execute(&mut *conn)
            .await?;

        let query_result = self.query_on_connection(sql, &mut conn).await;

        let reset_result = sqlx::query("RESET search_path")
            .persistent(false)
            .execute(&mut *conn)
            .await;

        match query_result {
            Ok(rows) => {
                reset_result?;
                Ok(rows)
            }
            Err(query_error) => {
                if let Err(reset_error) = reset_result {
                    tracing::warn!("Failed to reset PostgreSQL search_path: {}", reset_error);
                }
                Err(query_error.into())
            }
        }
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

        let pool = self.get_pool().await?;
        let mut conn = pool.acquire().await?;
        let search_path = DatabaseKind::Postgres.quote_identifier(schema);

        sqlx::query("SELECT set_config('search_path', $1, false)")
            .bind(search_path)
            .persistent(false)
            .execute(&mut *conn)
            .await?;

        let tracked_query = self.track_query_on_connection(query_id, &mut conn).await?;
        let query_result = self.query_on_connection(sql, &mut conn).await;
        drop(tracked_query);

        let reset_result = sqlx::query("RESET search_path")
            .persistent(false)
            .execute(&mut *conn)
            .await;

        match query_result {
            Ok(rows) => {
                reset_result?;
                Ok(rows)
            }
            Err(query_error) => {
                if let Err(reset_error) = reset_result {
                    tracing::warn!("Failed to reset PostgreSQL search_path: {}", reset_error);
                }
                Err(query_error.into())
            }
        }
    }

    async fn begin_transaction(&self, session_id: &str, schema: Option<&str>) -> Result<()> {
        {
            let sessions = self.transaction_sessions.lock().await;
            if sessions.contains_key(session_id) {
                return Err(anyhow!("Transaction already active: {}", session_id));
            }
        }

        let pool = self.get_pool().await?;
        let mut conn = pool.acquire().await?;

        sqlx::query("BEGIN")
            .persistent(false)
            .execute(&mut *conn)
            .await?;

        if let Some(schema) = schema.filter(|schema| !schema.trim().is_empty()) {
            let search_path = DatabaseKind::Postgres.quote_identifier(schema);
            if let Err(error) = sqlx::query("SELECT set_config('search_path', $1, true)")
                .bind(search_path)
                .persistent(false)
                .execute(&mut *conn)
                .await
            {
                if let Err(rollback_error) = sqlx::query("ROLLBACK")
                    .persistent(false)
                    .execute(&mut *conn)
                    .await
                {
                    tracing::warn!(
                        "Failed to rollback PostgreSQL transaction after search_path setup failed: {}",
                        rollback_error
                    );
                }
                return Err(error.into());
            }
        }

        let mut sessions = self.transaction_sessions.lock().await;
        if sessions.contains_key(session_id) {
            drop(sessions);
            sqlx::query("ROLLBACK")
                .persistent(false)
                .execute(&mut *conn)
                .await?;
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
        let backend_pid = self
            .active_queries
            .lock()
            .expect("PostgreSQL active query map mutex poisoned")
            .remove(query_id);

        if let Some(backend_pid) = backend_pid {
            let pool = self.get_pool().await?;
            let cancelled: bool = sqlx::query_scalar("SELECT pg_cancel_backend($1)")
                .bind(backend_pid)
                .persistent(false)
                .fetch_one(&pool)
                .await?;
            Ok(cancelled)
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

        sqlx::query("COMMIT")
            .persistent(false)
            .execute(&mut **conn)
            .await?;
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

        sqlx::query("ROLLBACK")
            .persistent(false)
            .execute(&mut **conn)
            .await?;
        Ok(())
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        let pool = self.get_pool().await?;
        let rows = sqlx::query("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') ORDER BY schema_name")
            .persistent(false)
            .fetch_all(&pool)
            .await?;

        let schemas: Vec<String> = rows
            .iter()
            .map(|r| r.try_get(0).unwrap_or_default())
            .collect();

        Ok(schemas)
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let pool = self.get_pool().await?;
        let rows = sqlx::query(
            r#"
            SELECT
                c.relname AS table_name,
                CASE c.relkind
                    WHEN 'r' THEN 'BASE TABLE'
                    WHEN 'p' THEN 'PARTITIONED TABLE'
                    WHEN 'v' THEN 'VIEW'
                    WHEN 'm' THEN 'MATERIALIZED VIEW'
                    WHEN 'f' THEN 'FOREIGN TABLE'
                    ELSE c.relkind::text
                END AS table_type,
                obj_description(c.oid, 'pg_class') AS comment
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
            ORDER BY c.relname
            "#,
        )
        .bind(schema)
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        let tables = rows
            .iter()
            .map(|r| TableInfo {
                name: r.try_get("table_name").unwrap_or_default(),
                schema: Some(schema.to_string()),
                table_type: r.try_get("table_type").ok(),
                comment: r.try_get("comment").ok(),
            })
            .collect();

        Ok(tables)
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        let pool = self.get_pool().await?;
        let rows = sqlx::query(
            r#"
            SELECT
                a.attname AS column_name,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                NOT a.attnotnull AS is_nullable,
                pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
                (
                    a.attidentity <> ''
                    OR COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') LIKE 'nextval(%'
                ) AS is_auto_increment,
                d.description AS column_comment,
                EXISTS (
                    SELECT 1
                    FROM pg_constraint con
                    WHERE con.conrelid = t.oid
                      AND con.contype = 'p'
                      AND a.attnum = ANY(con.conkey)
                ) as is_primary_key,
                EXISTS (
                    SELECT 1
                    FROM pg_constraint con
                    WHERE con.conrelid = t.oid
                      AND con.contype IN ('p', 'u')
                      AND a.attnum = ANY(con.conkey)
                ) as is_unique,
                EXISTS (
                    SELECT 1
                    FROM pg_index i
                    WHERE i.indrelid = t.oid
                      AND a.attnum = ANY(i.indkey)
                ) as is_indexed
            FROM pg_class t
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_attribute a ON a.attrelid = t.oid
            LEFT JOIN pg_attrdef ad ON ad.adrelid = t.oid AND ad.adnum = a.attnum
            LEFT JOIN pg_description d ON d.objoid = t.oid AND d.objsubid = a.attnum
            WHERE n.nspname = $1
              AND t.relname = $2
              AND t.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum
            "#,
        )
        .bind(schema)
        .bind(table)
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        let cols = rows
            .iter()
            .map(|r| {
                let is_nullable = r.try_get::<bool, _>("is_nullable").unwrap_or(true);
                let is_primary_key = r.try_get::<bool, _>("is_primary_key").unwrap_or(false);
                let is_unique = r.try_get::<bool, _>("is_unique").unwrap_or(false);
                let is_indexed = r.try_get::<bool, _>("is_indexed").unwrap_or(false);

                ColumnInfo {
                    name: r.try_get("column_name").unwrap_or_default(),
                    data_type: r.try_get("data_type").unwrap_or_default(),
                    is_nullable,
                    is_primary_key,
                    is_unique,
                    is_indexed,
                    is_auto_increment: r.try_get("is_auto_increment").unwrap_or(false),
                    default_value: r.try_get("column_default").ok(),
                    comment: r.try_get("column_comment").ok(),
                }
            })
            .collect();

        Ok(cols)
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
        let pool = self.get_pool().await?;
        let rows = sqlx::query(
            r#"
            SELECT
                i.relname AS index_name,
                ix.indisunique,
                ix.indisprimary,
                am.amname AS index_type,
                pg_get_indexdef(ix.indexrelid) AS definition,
                COALESCE((
                    SELECT array_agg(a.attname ORDER BY keys.ordinality)
                    FROM unnest(ix.indkey) WITH ORDINALITY AS keys(attnum, ordinality)
                    JOIN pg_attribute a
                      ON a.attrelid = ix.indrelid
                     AND a.attnum = keys.attnum
                    WHERE keys.attnum > 0
                ), ARRAY[]::text[]) AS columns
            FROM pg_class t
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_index ix ON ix.indrelid = t.oid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_am am ON am.oid = i.relam
            WHERE n.nspname = $1 AND t.relname = $2
            ORDER BY ix.indisprimary DESC, ix.indisunique DESC, i.relname
            "#,
        )
        .bind(schema)
        .bind(table)
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| IndexInfo {
                name: row.try_get("index_name").unwrap_or_default(),
                columns: row.try_get("columns").unwrap_or_default(),
                is_unique: row.try_get("indisunique").unwrap_or(false),
                is_primary: row.try_get("indisprimary").unwrap_or(false),
                index_type: row.try_get("index_type").ok(),
                definition: row.try_get("definition").ok(),
            })
            .collect())
    }

    async fn get_constraints(&self, schema: &str, table: &str) -> Result<Vec<ConstraintInfo>> {
        let pool = self.get_pool().await?;
        let rows = sqlx::query(
            r#"
            SELECT
                c.conname AS constraint_name,
                CASE c.contype
                    WHEN 'p' THEN 'PRIMARY KEY'
                    WHEN 'f' THEN 'FOREIGN KEY'
                    WHEN 'u' THEN 'UNIQUE'
                    WHEN 'c' THEN 'CHECK'
                    WHEN 'x' THEN 'EXCLUDE'
                    ELSE c.contype::text
                END AS constraint_type,
                pg_get_constraintdef(c.oid) AS definition,
                COALESCE((
                    SELECT array_agg(a.attname ORDER BY keys.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
                    JOIN pg_attribute a
                      ON a.attrelid = c.conrelid
                     AND a.attnum = keys.attnum
                ), ARRAY[]::text[]) AS columns,
                ref_ns.nspname AS referenced_schema,
                ref_table.relname AS referenced_table,
                COALESCE((
                    SELECT array_agg(a.attname ORDER BY keys.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS keys(attnum, ordinality)
                    JOIN pg_attribute a
                      ON a.attrelid = c.confrelid
                     AND a.attnum = keys.attnum
                ), ARRAY[]::text[]) AS referenced_columns
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            LEFT JOIN pg_class ref_table ON ref_table.oid = c.confrelid
            LEFT JOIN pg_namespace ref_ns ON ref_ns.oid = ref_table.relnamespace
            WHERE n.nspname = $1 AND t.relname = $2
            ORDER BY c.contype, c.conname
            "#,
        )
        .bind(schema)
        .bind(table)
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| ConstraintInfo {
                name: row.try_get("constraint_name").unwrap_or_default(),
                constraint_type: row.try_get("constraint_type").unwrap_or_default(),
                columns: row.try_get("columns").unwrap_or_default(),
                referenced_schema: row.try_get("referenced_schema").ok(),
                referenced_table: row.try_get("referenced_table").ok(),
                referenced_columns: row.try_get("referenced_columns").unwrap_or_default(),
                definition: row.try_get("definition").ok(),
            })
            .collect())
    }

    async fn get_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>> {
        let pool = self.get_pool().await?;
        let rows = sqlx::query(
            r#"
            SELECT
                p.proname AS function_name,
                pg_get_function_arguments(p.oid) AS arguments,
                CASE
                    WHEN p.prokind = 'p' THEN 'procedure'
                    ELSE 'function'
                END AS routine_type,
                CASE
                    WHEN p.prokind = 'p' THEN 'void'
                    ELSE pg_get_function_result(p.oid)
                END AS return_type,
                obj_description(p.oid, 'pg_proc') AS description
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = $1
              AND p.prokind IN ('f', 'p')
            ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
            "#,
        )
        .bind(schema)
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                let arguments = row.try_get::<String, _>("arguments").unwrap_or_default();
                FunctionInfo {
                    name: row.try_get("function_name").unwrap_or_default(),
                    routine_type: row.try_get("routine_type").ok(),
                    parameters: parse_postgres_function_parameters(&arguments),
                    return_type: row
                        .try_get("return_type")
                        .unwrap_or_else(|_| "unknown".to_string()),
                    description: row.try_get("description").ok(),
                }
            })
            .collect())
    }

    async fn set_current_schema(&self, schema: &str) -> Result<()> {
        let pool = self.get_pool().await?;
        let exists: Option<(i32,)> =
            sqlx::query_as("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1")
                .bind(schema)
                .persistent(false)
                .fetch_optional(&pool)
                .await?;

        exists
            .map(|_| ())
            .ok_or_else(|| anyhow!("Schema not found: {}", schema))
    }
}

fn decode_pg_value(row: &PgRow, index: usize) -> serde_json::Value {
    let col = row.column(index);
    let type_info = col.type_info();
    let type_name = type_info.name();

    // Helper macro to try getting a type, returning Null if it fails (silently)
    // In a real debug scenario, we might want to log this error.
    macro_rules! try_get {
        ($ty:ty) => {
            match row.try_get::<$ty, _>(index) {
                Ok(v) => serde_json::to_value(v).unwrap_or(serde_json::Value::Null),
                Err(_) => serde_json::Value::Null,
            }
        };
    }

    match type_name {
        "BOOL" | "bool" => try_get!(bool),
        "INT2" | "int2" => try_get!(i16), // smallint
        "INT4" | "int4" => try_get!(i32), // integer
        "INT8" | "int8" => try_get!(i64), // bigint
        "FLOAT4" | "float4" => try_get!(f32),
        "FLOAT8" | "float8" => try_get!(f64),
        "NUMERIC" | "numeric" => {
            // sqlx maps numeric to BigDecimal, which might not serialize directly to JSON number easily without extra crates.
            // safely cast to f64 for display, or string to preserve precision.
            // For simplicity in this display-focused app, let's try string first to convert, then f64.
            // Actually, sqlx recommend crate `rust_decimal`. Without it, let's just get as string?
            // Fallback: try to get as f64 locally if possible, or string.
            // Safest for generalized tools: String representation of the number.
            // BUT, users want to sort potentially.
            // Let's try `rust_decimal::Decimal` if available, but we don't have it in dependencies maybe?
            // Let's just assume string for accuracy or f64 for convenience.
            // If we try `row.try_get::<f64, _>(index)`, sqlx often allows numeric->f64 conversion.
            if let Ok(v) = row.try_get::<f64, _>(index) {
                serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
            } else {
                // Fallback to string if f64 conversion fails (e.g. too big)
                if let Ok(v) = row.try_get::<String, _>(index) {
                    serde_json::Value::String(v)
                } else {
                    serde_json::Value::Null
                }
            }
        }
        "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" | "text" | "varchar" | "char"
        | "bpchar" | "name" => {
            try_get!(String)
        }
        "JSON" | "JSONB" | "json" | "jsonb" => match row.try_get::<serde_json::Value, _>(index) {
            Ok(v) => v,
            Err(_) => serde_json::Value::Null,
        },
        "UUID" | "uuid" => {
            // UUID provided by sqlx::types::Uuid
            // Try fetching as string mostly works for UUID in sqlx if features enabled, otherwise need Uuid type.
            // Let's try string representation directly.
            if let Ok(v) = row.try_get::<String, _>(index) {
                serde_json::Value::String(v)
            } else {
                // Try getting raw Uuid and to_string? - Requires uuid crate dependency in main
                // Simplest fallback for unknown types is usually checking if we can get it as String.
                // SQLx `Row::try_get` for `String` works for many types that implement Display.
                serde_json::Value::Null
            }
        }
        "TIMESTAMPTZ" | "TIMESTAMP" | "DATE" | "TIME" | "timestamptz" | "timestamp" | "date"
        | "time" => {
            // Try formatting as string.
            // SQLx often maps these to `chrono` types.
            if let Ok(v) = row.try_get::<String, _>(index) {
                serde_json::Value::String(v)
            } else {
                // If string retrieve fails, maybe it's because we need to decode to chrono, then stringify.
                // But typically string work. If not, returning Null is safer than panic.
                serde_json::Value::Null
            }
        }
        _ => {
            // "Catch-all": Try to read as String. This handles ENUMs, UUIDs (often), custom types etc.
            if let Ok(v) = row.try_get::<String, _>(index) {
                serde_json::Value::String(v)
            } else {
                // If we really can't get it, return a placeholder describing the type so the user knows.
                serde_json::Value::String(format!("<{}>", type_name))
            }
        }
    }
}

fn bind_pg_parameter<'q>(
    query: Query<'q, Postgres, PgArguments>,
    param: &QueryParameter,
) -> Query<'q, Postgres, PgArguments> {
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
    let base_type = normalized.split('(').next().unwrap_or("").trim();
    matches!(
        base_type,
        "smallint"
            | "integer"
            | "int"
            | "int2"
            | "int4"
            | "bigint"
            | "int8"
            | "serial"
            | "bigserial"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use dotenvy::dotenv;
    use std::env;

    #[test]
    fn parses_postgres_function_arguments() {
        let params = parse_postgres_function_parameters(
            "IN account_id integer, amount numeric(10, 2) DEFAULT 0, VARIADIC tags text[]",
        );

        assert_eq!(params.len(), 3);
        assert_eq!(params[0].name, "account_id");
        assert_eq!(params[0].data_type, "integer");
        assert!(!params[0].optional);
        assert_eq!(params[1].name, "amount");
        assert_eq!(params[1].data_type, "numeric(10, 2)");
        assert!(params[1].optional);
        assert_eq!(params[2].name, "tags");
        assert_eq!(params[2].data_type, "text[]");
    }

    #[test]
    fn tracked_query_guard_removes_active_query_on_drop() {
        let active_queries = StdMutex::new(HashMap::from([("q1".to_string(), 42)]));

        {
            let _guard = PostgresTrackedQueryGuard {
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
    fn postgres_multi_statement_detection_ignores_comments_and_literals() {
        assert!(has_multiple_statements(
            "SELECT 1; CREATE TEMP TABLE oxide_pg_multi(id integer)",
            StatementScanDialect::Postgres
        ));
        assert!(has_multiple_statements(
            "CREATE FUNCTION f() RETURNS integer LANGUAGE SQL AS $$ SELECT 1; $$; SELECT f();",
            StatementScanDialect::Postgres
        ));
        assert!(!has_multiple_statements(
            "SELECT ';' AS semicolon;",
            StatementScanDialect::Postgres
        ));
        assert!(!has_multiple_statements(
            "SELECT 1 /* ; */ -- ;\n;",
            StatementScanDialect::Postgres
        ));
        assert!(!has_multiple_statements(
            "CREATE FUNCTION f() RETURNS integer LANGUAGE SQL AS $$ SELECT 1; $$;",
            StatementScanDialect::Postgres
        ));
    }

    #[tokio::test]
    #[ignore = "requires a live TEST_POSTGRES_URL database"]
    async fn test_get_schemas() {
        dotenv().ok();
        let database_url = env::var("TEST_POSTGRES_URL").expect("TEST_POSTGRES_URL must be set");

        let mut driver = PostgresDriver::new(&database_url);
        driver.connect().await.expect("Failed to connect");

        let schemas = driver.get_schemas().await.expect("Failed to get schemas");
        println!("Schemas: {:?}", schemas);
        assert!(!schemas.is_empty());

        driver.disconnect().await.expect("Failed to disconnect");
    }
}
