use super::models::{
    configure_postgres_search_path, PostgresDriver, PostgresTransactionSession,
    METADATA_CONNECT_TIMEOUT, METADATA_POOL_IDLE_TIMEOUT, METADATA_POOL_MAX_LIFETIME,
    METADATA_QUERY_TIMEOUT,
};
use super::values::bind_pg_parameter;
use crate::core::driver::DatabaseDriver;
use crate::core::protocol::{
    ColumnInfo, ConstraintInfo, DatabaseInfo, ForeignKeyReferenceInfo, FunctionInfo, IndexInfo,
    ParameterizedStatement, QueryParameter, QueryResult, SchemaObjectInfo, TableInfo,
};
use crate::core::statement::{split_sql_statements, StatementScanDialect};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, Row};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::timeout;

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        Some(StatementScanDialect::Postgres)
    }

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

        let old_pool = self.pool.get_mut().replace(pool);
        let old_metadata_pool = self.metadata_pool.get_mut().take();
        if let Some(old_pool) = old_pool {
            Self::close_pool_with_timeout(old_pool).await;
        }
        if let Some(old_metadata_pool) = old_metadata_pool {
            Self::close_pool_with_timeout(old_metadata_pool.pool).await;
        }

        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        // Database-scoped metadata calls take this lock before checking the
        // primary pool. Taking it first here prevents a new auxiliary pool
        // from being created while disconnect is in progress.
        let mut metadata_pool = self.metadata_pool.lock().await;
        let pool = {
            let mut pool = self.pool.lock().await;
            pool.take()
        };
        let metadata_pool_to_close = metadata_pool.take();
        drop(metadata_pool);

        let active_queries = self.drain_active_query_backends();
        if !active_queries.is_empty() {
            if let Some(pool) = &pool {
                self.cancel_tracked_queries_on_pool(pool, active_queries)
                    .await;
            } else {
                tracing::warn!(
                    "Unable to cancel active PostgreSQL queries during disconnect because no pool is available"
                );
            }
        }

        let mut sessions = self.transaction_sessions.lock().await;
        let drained_sessions: Vec<_> = sessions.drain().map(|(_, conn)| conn).collect();
        drop(sessions);

        for session in drained_sessions {
            let mut conn = session.connection.lock().await;
            if let Err(error) = sqlx::query("ROLLBACK").execute(&mut **conn).await {
                tracing::warn!(
                    "Failed to rollback PostgreSQL transaction on disconnect: {}",
                    error
                );
            }
        }

        if let Some(pool) = pool {
            Self::close_pool_with_timeout(pool).await;
        }
        if let Some(metadata_pool) = metadata_pool_to_close {
            Self::close_pool_with_timeout(metadata_pool.pool).await;
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

    async fn query_database(&self, database: &str, sql: &str) -> Result<Vec<QueryResult>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;

        timeout(METADATA_QUERY_TIMEOUT, self.query_on_pool(sql, &pool))
            .await
            .map_err(|_| anyhow!("Timed out querying PostgreSQL database '{}'", database))?
    }

    async fn query_database_read_only(
        &self,
        database: &str,
        schema: Option<&str>,
        sql: &str,
        params: &[QueryParameter],
        max_rows: u32,
    ) -> Result<Vec<QueryResult>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);
        let mut transaction = pool.begin().await?;
        sqlx::query("SET TRANSACTION READ ONLY")
            .execute(&mut *transaction)
            .await?;
        sqlx::query("SET LOCAL statement_timeout = '20s'")
            .execute(&mut *transaction)
            .await?;
        sqlx::query("SET LOCAL lock_timeout = '2s'")
            .execute(&mut *transaction)
            .await?;
        if let Some(schema) = schema.filter(|value| !value.is_empty()) {
            let namespace = format!(
                "pg_catalog, {}",
                crate::core::dialect::DatabaseKind::Postgres.quote_identifier(schema)
            );
            sqlx::query("SELECT pg_catalog.set_config('search_path',$1,true)")
                .bind(namespace)
                .execute(&mut *transaction)
                .await?;
        }
        let result = self
            .query_parameterized_on_connection(sql, params, &mut transaction, max_rows as usize)
            .await;
        let rollback = transaction.rollback().await;
        match result {
            Ok(results) => {
                rollback?;
                Ok(results)
            }
            Err(error) => Err(error),
        }
    }

    async fn query_database_with_context_tracked(
        &self,
        query_id: Option<&str>,
        database: &str,
        sql: &str,
        schema: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        let mut conn = pool.acquire().await?;
        if split_sql_statements(sql, StatementScanDialect::Postgres).len() > 1 {
            conn.close_on_drop();
        }

        if let Some(schema) = schema.filter(|value| !value.trim().is_empty()) {
            configure_postgres_search_path(&mut conn, schema, false).await?;
        }

        let tracked_query = self.track_query_on_connection(query_id, &mut conn).await?;
        let query_result = self.query_on_connection(sql, &mut conn).await;
        drop(tracked_query);

        let reset_result = if schema.is_some() {
            Some(
                sqlx::query("RESET search_path")
                    .persistent(false)
                    .execute(&mut *conn)
                    .await,
            )
        } else {
            None
        };

        match query_result {
            Ok(rows) => {
                if let Some(reset_result) = reset_result {
                    reset_result?;
                }
                Ok(rows)
            }
            Err(query_error) => {
                if let Some(Err(reset_error)) = reset_result {
                    tracing::warn!(
                        "Failed to reset PostgreSQL search_path for database '{}': {}",
                        database,
                        reset_error
                    );
                }
                Err(query_error)
            }
        }
    }

    async fn execute_parameterized(&self, sql: &str, params: &[QueryParameter]) -> Result<u64> {
        let pool = self.get_pool().await?;
        let mut query = sqlx::query(sql).persistent(false);
        for param in params {
            query = bind_pg_parameter(query, param)?;
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
        self.query_parameterized_on_pool(sql, params, &pool).await
    }

    async fn query_database_parameterized(
        &self,
        database: &str,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;

        timeout(
            METADATA_QUERY_TIMEOUT,
            self.query_parameterized_on_pool(sql, params, &pool),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out running a parameterized query on PostgreSQL database '{}'",
                database
            )
        })?
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
                query = bind_pg_parameter(query, param)?;
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

    async fn execute_database_parameterized_batch(
        &self,
        database: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }

        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        let mut conn = pool.acquire().await?;
        sqlx::query("BEGIN")
            .persistent(false)
            .execute(&mut *conn)
            .await?;

        let mut rows_affected = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.sql).persistent(false);
            for param in &statement.params {
                query = bind_pg_parameter(query, param)?;
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
                            "Failed to rollback PostgreSQL mutation batch on database '{}': {}",
                            database,
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
        if split_sql_statements(sql, StatementScanDialect::Postgres).len() > 1 {
            conn.close_on_drop();
        }
        let tracked_query = self.track_query_on_connection(query_id, &mut conn).await?;
        let result = self.query_on_connection(sql, &mut conn).await;
        drop(tracked_query);
        result
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        let pool = self.get_pool().await?;
        let mut conn = pool.acquire().await?;
        if split_sql_statements(sql, StatementScanDialect::Postgres).len() > 1 {
            conn.close_on_drop();
        }
        configure_postgres_search_path(&mut conn, schema, false).await?;

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
                Err(query_error)
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
        if split_sql_statements(sql, StatementScanDialect::Postgres).len() > 1 {
            conn.close_on_drop();
        }
        configure_postgres_search_path(&mut conn, schema, false).await?;

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
                Err(query_error)
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
            if let Err(error) = configure_postgres_search_path(&mut conn, schema, true).await {
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
                return Err(error);
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

        sessions.insert(
            session_id.to_string(),
            Arc::new(PostgresTransactionSession {
                connection: Mutex::new(conn),
                _database_pool: None,
            }),
        );
        Ok(())
    }

    async fn begin_database_transaction(
        &self,
        session_id: &str,
        database: &str,
        schema: Option<&str>,
    ) -> Result<()> {
        if database.trim().is_empty() {
            return Err(anyhow!("PostgreSQL database name cannot be empty"));
        }
        {
            let sessions = self.transaction_sessions.lock().await;
            if sessions.contains_key(session_id) {
                return Err(anyhow!("Transaction already active: {}", session_id));
            }
        }

        let options = self.metadata_connect_options(database)?;
        let pool = PgPoolOptions::new()
            .min_connections(0)
            .max_connections(1)
            .acquire_timeout(METADATA_CONNECT_TIMEOUT)
            .idle_timeout(Some(METADATA_POOL_IDLE_TIMEOUT))
            .max_lifetime(Some(METADATA_POOL_MAX_LIFETIME))
            .connect_with(options)
            .await?;
        let mut conn = pool.acquire().await?;
        sqlx::query("BEGIN")
            .persistent(false)
            .execute(&mut *conn)
            .await?;

        if let Some(schema) = schema.filter(|schema| !schema.trim().is_empty()) {
            if let Err(error) = configure_postgres_search_path(&mut conn, schema, true).await {
                let _ = sqlx::query("ROLLBACK")
                    .persistent(false)
                    .execute(&mut *conn)
                    .await;
                return Err(error);
            }
        }

        let mut sessions = self.transaction_sessions.lock().await;
        if sessions.contains_key(session_id) {
            drop(sessions);
            let _ = sqlx::query("ROLLBACK")
                .persistent(false)
                .execute(&mut *conn)
                .await;
            return Err(anyhow!("Transaction already active: {}", session_id));
        }
        sessions.insert(
            session_id.to_string(),
            Arc::new(PostgresTransactionSession {
                connection: Mutex::new(conn),
                _database_pool: Some(pool),
            }),
        );
        Ok(())
    }

    async fn query_transaction(&self, session_id: &str, sql: &str) -> Result<Vec<QueryResult>> {
        let session = self.get_transaction_session(session_id).await?;
        let mut conn = session.connection.lock().await;

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
        let mut conn = session.connection.lock().await;

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
        let mut conn = session.connection.lock().await;
        let mut rows_affected = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.sql).persistent(false);
            for param in &statement.params {
                query = bind_pg_parameter(query, param)?;
            }
            rows_affected.push(query.execute(&mut **conn).await?.rows_affected());
        }
        Ok(rows_affected)
    }

    async fn cancel_query(&self, query_id: &str) -> Result<bool> {
        if let Some(backend_pid) = self.active_query_backend(query_id) {
            let pool = self.get_pool().await?;
            let cancelled: bool = sqlx::query_scalar("SELECT pg_cancel_backend($1)")
                .bind(backend_pid)
                .persistent(false)
                .fetch_one(&pool)
                .await?;
            if cancelled {
                self.remove_active_query_backend_if_matches(query_id, backend_pid);
            }
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
        let mut conn = session.connection.lock().await;

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
        let mut conn = session.connection.lock().await;

        sqlx::query("ROLLBACK")
            .persistent(false)
            .execute(&mut **conn)
            .await?;
        Ok(())
    }

    async fn get_databases(&self) -> Result<Vec<String>> {
        let pool = self.get_pool().await?;
        let databases = sqlx::query_scalar::<_, String>(
            r#"
            SELECT datname
            FROM pg_catalog.pg_database
            WHERE datallowconn
              AND NOT datistemplate
            ORDER BY datname
            "#,
        )
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        Ok(databases)
    }

    async fn get_database_metadata(&self) -> Result<Vec<DatabaseInfo>> {
        let pool = self.get_pool().await?;
        let metadata = sqlx::query(
            r#"
            SELECT d.datname,
                   CASE
                     WHEN has_database_privilege(d.datname, 'CONNECT')
                       OR COALESCE((
                         SELECT pg_has_role(current_user, r.oid, 'MEMBER')
                         FROM pg_catalog.pg_roles r
                         WHERE r.rolname = 'pg_read_all_stats'
                       ), false)
                     THEN pg_database_size(d.oid)
                     ELSE NULL
                   END AS size_bytes,
                   pg_catalog.shobj_description(d.oid, 'pg_database') AS comment,
                   pg_catalog.pg_encoding_to_char(d.encoding) AS default_charset,
                   d.datcollate AS default_collation
            FROM pg_catalog.pg_database d
            WHERE d.datallowconn AND NOT d.datistemplate
            ORDER BY d.datname
            "#,
        )
        .persistent(false)
        .fetch_all(&pool)
        .await;

        match metadata {
            Ok(rows) => Ok(rows
                .iter()
                .map(|row| DatabaseInfo {
                    name: row.try_get::<String, _>(0).unwrap_or_default(),
                    size_bytes: row.try_get::<Option<i64>, _>(1).ok().flatten(),
                    comment: row
                        .try_get::<Option<String>, _>(2)
                        .ok()
                        .flatten()
                        .filter(|value| !value.trim().is_empty()),
                    default_charset: row
                        .try_get::<Option<String>, _>(3)
                        .ok()
                        .flatten()
                        .filter(|value| !value.trim().is_empty()),
                    default_collation: row
                        .try_get::<Option<String>, _>(4)
                        .ok()
                        .flatten()
                        .filter(|value| !value.trim().is_empty()),
                    ..DatabaseInfo::default()
                })
                .collect()),
            Err(error) => {
                tracing::debug!("Falling back to PostgreSQL database names after metadata query failed: {error}");
                Ok(self
                    .get_databases()
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
        let pool = self.get_pool().await?;
        Self::schemas_on_pool(&pool).await
    }

    async fn get_database_schemas(&self, database: &str) -> Result<Vec<String>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(METADATA_QUERY_TIMEOUT, Self::schemas_on_pool(&pool))
            .await
            .map_err(|_| {
                anyhow!(
                    "Timed out loading schemas from PostgreSQL database '{}'",
                    database
                )
            })?
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let pool = self.get_pool().await?;
        Self::tables_on_pool(&pool, schema).await
    }

    async fn get_database_tables(&self, database: &str, schema: &str) -> Result<Vec<TableInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(METADATA_QUERY_TIMEOUT, Self::tables_on_pool(&pool, schema))
            .await
            .map_err(|_| {
                anyhow!(
                    "Timed out loading tables from PostgreSQL database '{}', schema '{}'",
                    database,
                    schema
                )
            })?
    }

    async fn get_database_schema_objects(
        &self,
        database: &str,
        schema: &str,
    ) -> Result<Vec<SchemaObjectInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::schema_objects_on_pool(&pool, schema),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading schema objects from PostgreSQL database '{}', schema '{}'",
                database,
                schema
            )
        })?
    }

    async fn get_schema_objects(&self, schema: &str) -> Result<Vec<SchemaObjectInfo>> {
        let pool = self.get_pool().await?;
        Self::schema_objects_on_pool(&pool, schema).await
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        let pool = self.get_pool().await?;
        Self::columns_on_pool(&pool, schema, table).await
    }

    async fn get_generated_columns(&self, schema: &str, table: &str) -> Result<Vec<String>> {
        let pool = self.get_pool().await?;
        Self::generated_columns_on_pool(&pool, schema, table).await
    }

    async fn sql_export_requires_identity_override(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<bool> {
        let pool = self.get_pool().await?;
        Self::requires_identity_override_on_pool(&pool, schema, table).await
    }

    async fn get_database_columns(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::columns_on_pool(&pool, schema, table),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading columns from PostgreSQL database '{}', table '{}.{}'",
                database,
                schema,
                table
            )
        })?
    }

    async fn get_database_generated_columns(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<String>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::generated_columns_on_pool(&pool, schema, table),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading generated columns from PostgreSQL database '{}', table '{}.{}'",
                database,
                schema,
                table
            )
        })?
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
        let pool = self.get_pool().await?;
        Self::indexes_on_pool(&pool, schema, table).await
    }

    async fn get_database_indexes(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::indexes_on_pool(&pool, schema, table),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading indexes from PostgreSQL database '{}', table '{}.{}'",
                database,
                schema,
                table
            )
        })?
    }

    async fn get_constraints(&self, schema: &str, table: &str) -> Result<Vec<ConstraintInfo>> {
        let pool = self.get_pool().await?;
        Self::constraints_on_pool(&pool, schema, table).await
    }

    async fn get_database_constraints(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::constraints_on_pool(&pool, schema, table),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading constraints from PostgreSQL database '{}', table '{}.{}'",
                database,
                schema,
                table
            )
        })?
    }

    async fn get_referencing_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        let pool = self.get_pool().await?;
        Self::referencing_foreign_keys_on_pool(&pool, schema, table).await
    }

    async fn get_database_referencing_foreign_keys(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::referencing_foreign_keys_on_pool(&pool, schema, table),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading referencing foreign keys from PostgreSQL database '{}', table '{}.{}'",
                database,
                schema,
                table
            )
        })?
    }

    async fn get_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>> {
        let pool = self.get_pool().await?;
        Self::functions_on_pool(&pool, schema).await
    }

    async fn get_database_functions(
        &self,
        database: &str,
        schema: &str,
    ) -> Result<Vec<FunctionInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::functions_on_pool(&pool, schema),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading routines from PostgreSQL database '{}', schema '{}'",
                database,
                schema
            )
        })?
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
