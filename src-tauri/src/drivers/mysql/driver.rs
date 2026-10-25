use crate::core::driver::DatabaseDriver;
use crate::core::protocol::{
    ColumnInfo, ConstraintInfo, DatabaseInfo, ForeignKeyReferenceInfo, FunctionInfo,
    FunctionParameterInfo, IndexInfo, ParameterizedStatement, QueryParameter, QueryResult,
    SchemaObjectInfo, TableInfo, DEFAULT_QUERY_RESULT_ROW_LIMIT,
};
use crate::core::statement::{
    execution_mode, execution_statement_kind, has_multiple_statements, QueryExecutionMode,
    StatementScanDialect,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::{StreamExt, TryStreamExt};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::{ConnectOptions, Executor, Row};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use super::models::{
    mysql_column_ownership, mysql_statistics_expression_is_unsupported, mysql_string_by_index,
    mysql_string_by_name, MysqlDriver, MYSQL_INDEX_METADATA_SQL_LEGACY,
    MYSQL_INDEX_METADATA_SQL_WITH_EXPRESSIONS, MYSQL_SCHEMA_OBJECTS_SQL,
};
use super::values::bind_mysql_parameter;

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
                column_comment AS cc,
                character_set_name AS cs,
                collation_name AS col
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
            ORDER BY ordinal_position
            "#,
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await?;

        // COLUMN_KEY=PRI includes every member of a composite primary key.
        // Inspect complete physical unique indexes before marking one column
        // independently unique (a prerequisite for stable compare pagination).
        let unique_rows = sqlx::query("SELECT CAST(MAX(COLUMN_NAME) AS CHAR CHARACTER SET utf8mb4) AS cn FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND NON_UNIQUE=0 GROUP BY INDEX_NAME HAVING COUNT(*)=1 AND MAX(COLUMN_NAME) IS NOT NULL")
            .bind(schema).bind(table).fetch_all(&pool).await?;
        let unique_columns = unique_rows
            .iter()
            .filter_map(|row| mysql_string_by_name(row, "cn"))
            .collect::<std::collections::HashSet<_>>();
        let cols = rows
            .iter()
            .map(|r| {
                let is_nullable =
                    mysql_string_by_name(r, "inl").unwrap_or_else(|| "YES".to_string()) == "YES";

                let column_key = mysql_string_by_name(r, "ck").unwrap_or_default();
                let is_primary_key = column_key == "PRI";
                let name = mysql_string_by_name(r, "cn").unwrap_or_default();
                let is_unique = unique_columns.contains(&name);
                let is_indexed = !column_key.is_empty();
                let extra = mysql_string_by_name(r, "ex").unwrap_or_default();
                let (is_generated, is_hidden) = mysql_column_ownership(&extra);
                let comment = mysql_string_by_name(r, "cc")
                    .and_then(|value| (!value.trim().is_empty()).then_some(value));

                ColumnInfo {
                    name,
                    data_type: mysql_string_by_name(r, "dt").unwrap_or_default(),
                    is_nullable,
                    is_primary_key,
                    is_unique,
                    is_indexed,
                    is_auto_increment: extra.to_ascii_lowercase().contains("auto_increment"),
                    identity_generation: None,
                    is_generated: Some(is_generated),
                    is_hidden: Some(is_hidden),
                    character_set: mysql_string_by_name(r, "cs"),
                    collation: mysql_string_by_name(r, "col"),
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
        let (rows, includes_expression) =
            match sqlx::query(MYSQL_INDEX_METADATA_SQL_WITH_EXPRESSIONS)
                .bind(schema)
                .bind(table)
                .persistent(false)
                .fetch_all(&pool)
                .await
            {
                Ok(rows) => (rows, true),
                Err(error) if mysql_statistics_expression_is_unsupported(&error) => (
                    sqlx::query(MYSQL_INDEX_METADATA_SQL_LEGACY)
                        .bind(schema)
                        .bind(table)
                        .persistent(false)
                        .fetch_all(&pool)
                        .await?,
                    false,
                ),
                Err(error) => return Err(error.into()),
            };

        let mut indexes = Vec::<IndexInfo>::new();
        let mut positions = HashMap::<String, usize>::new();
        for row in &rows {
            let name = mysql_string_by_index(row, 0).unwrap_or_default();
            let position = if let Some(position) = positions.get(&name) {
                *position
            } else {
                let position = indexes.len();
                positions.insert(name.clone(), position);
                indexes.push(IndexInfo {
                    is_primary: name == "PRIMARY",
                    is_unique: row.try_get::<i64, _>(1).unwrap_or(1) == 0,
                    name,
                    columns: Vec::new(),
                    filter: None,
                    index_type: mysql_string_by_index(row, 2),
                    included_columns: None,
                    definition: None,
                    comment: mysql_string_by_index(row, 3)
                        .filter(|comment| !comment.trim().is_empty()),
                    key_is_expression: Vec::new(),
                });
                position
            };

            let (column_index, expression_index, sub_part_index, collation_index) =
                if includes_expression {
                    (4, Some(5), 6, 7)
                } else {
                    (4, None, 5, 6)
                };
            let expression = expression_index
                .and_then(|index| mysql_string_by_index(row, index))
                .filter(|value| !value.trim().is_empty());
            let column =
                mysql_string_by_index(row, column_index).filter(|value| !value.trim().is_empty());
            let key_is_expression = expression.is_some()
                || column.is_none()
                || row
                    .try_get::<Option<i64>, _>(sub_part_index)
                    .unwrap_or(None)
                    .is_some()
                || mysql_string_by_index(row, collation_index)
                    .is_some_and(|collation| collation.eq_ignore_ascii_case("D"));
            if let Some(column) = expression
                .map(|value| format!("({})", value.trim()))
                .or(column)
            {
                indexes[position].columns.push(column);
                // Functional keys, prefix lengths and descending order cannot
                // be recreated from the plain column list. Preserve the raw
                // expression for display and block unsafe transfer rewrites.
                indexes[position].key_is_expression.push(key_is_expression);
            }
        }

        Ok(indexes)
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
                    mode: (!parameter_mode.is_empty()).then_some(parameter_mode),
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
