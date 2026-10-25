use crate::core::driver::{
    DatabaseDriver, LocalDatabaseBackupControl, LocalDatabaseFileReceipt, SqliteRebuildReceipt,
};
use crate::core::protocol::{
    ColumnDef, ColumnInfo, ConstraintInfo, IndexInfo, ParameterizedStatement, QueryParameter,
    QueryResult, SchemaObjectInfo, TableInfo, DEFAULT_QUERY_RESULT_ROW_LIMIT,
};
use crate::core::statement::{
    execution_mode, execution_statement_kind, split_sql_statements, QueryExecutionMode,
    StatementScanDialect,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::{StreamExt, TryStreamExt};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection, SqlitePoolOptions, SqliteRow};
use sqlx::{Column, ConnectOptions, Connection, Executor, Row, TypeInfo};
use std::collections::BTreeMap;
use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::backup::{
    copy_sqlite_database, prepare_backup_destination, publish_sqlite_backup,
    publish_sqlite_backup_controlled, sqlite_connection_integrity, validate_restore_source,
};
use super::models::{sqlite_column_ownership, SqliteDriver};
use super::runtime::validate_sqlite_rebuild_statements;
use super::values::{
    bind_sqlite_parameter, normalized_sqlite_schema, sqlite_identifier, sqlite_schema_identifier,
    sqlite_value,
};

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        // SQLite read-only Agent execution is guarded by a separate
        // engine-level connection factory. The normal editor driver therefore
        // remains outside the server transaction-wrapper dialects.
        None
    }

    async fn server_version(&self) -> Option<String> {
        let pool = self.pool().await.ok()?;
        sqlx::query_scalar::<_, String>("SELECT sqlite_version()")
            .fetch_one(&pool)
            .await
            .ok()
    }

    async fn connect(&mut self) -> Result<()> {
        let options = SqliteConnectOptions::from_str(&self.connection_string)?
            .create_if_missing(!self.read_only)
            .read_only(self.read_only)
            .disable_statement_logging();
        // A plain `:memory:` SQLite database is scoped to one connection.
        // Pooling it would make a query occasionally observe a different,
        // empty database. File-backed databases still use a small pool.
        let max_connections = if self.connection_string == "sqlite::memory:" {
            1
        } else {
            5
        };
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;
        let previous = self.pool.get_mut().replace(pool);
        if let Some(previous) = previous {
            previous.close().await;
        }
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        let sessions = std::mem::take(&mut *self.transaction_sessions.lock().await);
        for (_, session) in sessions {
            let mut connection = session.lock().await;
            let _ = (&mut **connection).execute("ROLLBACK").await;
        }
        if let Some(pool) = self.pool.lock().await.take() {
            pool.close().await;
        }
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        sqlx::query("SELECT 1").execute(&self.pool().await?).await?;
        Ok(())
    }

    async fn backup_local_database(&self, destination: &Path) -> Result<LocalDatabaseFileReceipt> {
        let control = LocalDatabaseBackupControl::default();
        self.backup_local_database_controlled(destination, &control)
            .await
    }

    async fn backup_local_database_controlled(
        &self,
        destination: &Path,
        control: &LocalDatabaseBackupControl,
    ) -> Result<LocalDatabaseFileReceipt> {
        if self.read_only {
            return Err(anyhow!(
                "Backup is unavailable through a read-only SQLite connection"
            ));
        }
        let _operation = self.file_operation.lock().await;
        self.ensure_no_active_transactions().await?;
        let pool = self.pool().await?;
        prepare_backup_destination(&pool, destination).await?;
        let mut source = pool.acquire().await?;
        publish_sqlite_backup_controlled(&mut source, destination, control).await
    }

    async fn restore_local_database(&self, source: &Path) -> Result<LocalDatabaseFileReceipt> {
        if self.read_only {
            return Err(anyhow!(
                "Restore is unavailable through a read-only SQLite connection"
            ));
        }
        let _operation = self.file_operation.lock().await;
        self.ensure_no_active_transactions().await?;
        let pool = self.pool().await?;
        validate_restore_source(&pool, source).await?;

        let options = SqliteConnectOptions::new()
            .filename(source)
            .read_only(true)
            .disable_statement_logging();
        let mut restore_source = SqliteConnection::connect_with(&options).await?;
        let source_integrity = sqlite_connection_integrity(&mut restore_source).await?;
        let mut destination = pool.acquire().await?;
        copy_sqlite_database(&mut restore_source, &mut destination).await?;
        restore_source.close().await?;
        // Return the live handle before the integrity query. In-memory
        // databases deliberately use a one-connection pool.
        drop(destination);
        let integrity_check: String = sqlx::query_scalar("PRAGMA main.integrity_check")
            .fetch_one(&pool)
            .await?;
        if !integrity_check.eq_ignore_ascii_case("ok") {
            return Err(anyhow!(
                "Restored SQLite database failed its integrity check"
            ));
        }
        let byte_len = std::fs::metadata(source)?.len();
        Ok(LocalDatabaseFileReceipt {
            byte_len,
            integrity_check: source_integrity,
        })
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        self.query_script(sql).await
    }

    async fn execute_parameterized(&self, sql: &str, params: &[QueryParameter]) -> Result<u64> {
        let mut query = sqlx::query(sql).persistent(false);
        for parameter in params {
            query = bind_sqlite_parameter(query, parameter)?;
        }
        Ok(query.execute(&self.pool().await?).await?.rows_affected())
    }

    async fn query_parameterized(
        &self,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        let mut query = sqlx::query(sql).persistent(false);
        for parameter in params {
            query = bind_sqlite_parameter(query, parameter)?;
        }
        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let rows = query
                    .fetch(&self.pool().await?)
                    .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                    .try_collect()
                    .await?;
                self.rows_result(sql, rows).await
            }
            QueryExecutionMode::AffectsRows => Ok(vec![QueryResult::execution(
                execution_statement_kind(sql).as_str(),
                query.execute(&self.pool().await?).await?.rows_affected(),
            )]),
        }
    }

    async fn execute_parameterized_batch(
        &self,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let pool = self.pool().await?;
        let mut transaction = pool.begin().await?;
        let result = async {
            let mut affected = Vec::with_capacity(statements.len());
            for statement in statements {
                let mut query = sqlx::query(&statement.sql).persistent(false);
                for parameter in &statement.params {
                    query = bind_sqlite_parameter(query, parameter)?;
                }
                affected.push(query.execute(&mut *transaction).await?.rows_affected());
            }
            Ok::<_, anyhow::Error>(affected)
        }
        .await;
        match result {
            Ok(affected) => {
                transaction.commit().await?;
                Ok(affected)
            }
            Err(error) => {
                let _ = transaction.rollback().await;
                Err(error)
            }
        }
    }

    async fn execute_sqlite_rebuild_batch(
        &self,
        statements: &[ParameterizedStatement],
        backup_destination: &Path,
    ) -> Result<SqliteRebuildReceipt> {
        if self.read_only {
            return Err(anyhow!(
                "SQLite schema rebuild is unavailable through a read-only connection"
            ));
        }
        validate_sqlite_rebuild_statements(statements)?;
        let _operation = self.file_operation.lock().await;
        self.ensure_no_active_transactions().await?;
        let pool = self.pool().await?;
        prepare_backup_destination(&pool, backup_destination).await?;
        let mut connection = pool.acquire().await?;
        let foreign_keys_enabled = sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys")
            .fetch_one(&mut *connection)
            .await?
            != 0;

        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&mut *connection)
            .await?;
        if sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys")
            .fetch_one(&mut *connection)
            .await?
            != 0
        {
            return Err(anyhow!(
                "SQLite refused to suspend foreign-key enforcement for the reviewed rebuild"
            ));
        }
        let memory_backup = if self.connection_string == "sqlite::memory:" {
            Some(publish_sqlite_backup(&mut connection, backup_destination).await?)
        } else {
            None
        };
        (&mut *connection).execute("BEGIN IMMEDIATE").await?;

        let apply_result: Result<SqliteRebuildReceipt> = async {
            let backup = match memory_backup {
                Some(receipt) => receipt,
                None => {
                    let mut backup_source = pool.acquire().await?;
                    publish_sqlite_backup(&mut backup_source, backup_destination).await?
                }
            };

            for statement in statements {
                let mut query = sqlx::query(&statement.sql).persistent(false);
                for parameter in &statement.params {
                    query = bind_sqlite_parameter(query, parameter)?;
                }
                query.execute(&mut *connection).await?;
            }
            if sqlx::query("PRAGMA foreign_key_check")
                .fetch_optional(&mut *connection)
                .await?
                .is_some()
            {
                return Err(anyhow!(
                    "SQLite foreign_key_check found a violation; the rebuild was rolled back"
                ));
            }
            (&mut *connection).execute("COMMIT").await?;
            Ok(SqliteRebuildReceipt {
                backup,
                statements_applied: statements.len(),
            })
        }
        .await;

        if apply_result.is_err() {
            let _ = (&mut *connection).execute("ROLLBACK").await;
        }
        let restore_result = if foreign_keys_enabled {
            async {
                sqlx::query("PRAGMA foreign_keys = ON")
                    .execute(&mut *connection)
                    .await?;
                if sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys")
                    .fetch_one(&mut *connection)
                    .await?
                    == 0
                {
                    return Err(anyhow!(
                        "SQLite foreign-key enforcement could not be restored after rebuild"
                    ));
                }
                Ok(())
            }
            .await
        } else {
            Ok(())
        };
        match (apply_result, restore_result) {
            (Ok(receipt), Ok(())) => Ok(receipt),
            (Err(error), Ok(())) => Err(error),
            (Ok(_), Err(error)) => Err(error),
            (Err(error), Err(restore_error)) => Err(anyhow!(
                "{error}; SQLite foreign-key setting restoration also failed: {restore_error}"
            )),
        }
    }

    async fn begin_transaction(&self, session_id: &str, _schema: Option<&str>) -> Result<()> {
        let pool = self.pool().await?;
        let mut connection = pool.acquire().await?;
        (&mut *connection).execute("BEGIN").await?;
        self.transaction_sessions
            .lock()
            .await
            .insert(session_id.to_string(), Arc::new(Mutex::new(connection)));
        Ok(())
    }

    async fn query_transaction(&self, session_id: &str, sql: &str) -> Result<Vec<QueryResult>> {
        let session = self
            .transaction_sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("Transaction not found: {session_id}"))?;
        let mut connection = session.lock().await;
        let mut results = Vec::new();
        for statement in split_sql_statements(sql, StatementScanDialect::Postgres) {
            match execution_mode(statement) {
                QueryExecutionMode::ReturnsRows => {
                    let rows: Vec<SqliteRow> = sqlx::query(statement)
                        .persistent(false)
                        .fetch(&mut **connection)
                        .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                        .try_collect()
                        .await?;
                    let columns: Vec<ColumnDef> = rows
                        .first()
                        .map(|row| {
                            row.columns()
                                .iter()
                                .map(|column| ColumnDef {
                                    name: column.name().to_string(),
                                    data_type: column.type_info().name().to_string(),
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let values = rows
                        .iter()
                        .map(|row| {
                            (0..columns.len())
                                .map(|index| sqlite_value(row, index))
                                .collect()
                        })
                        .collect();
                    results.push(QueryResult::rows_limited(
                        columns,
                        values,
                        DEFAULT_QUERY_RESULT_ROW_LIMIT,
                    ));
                }
                QueryExecutionMode::AffectsRows => {
                    let result = sqlx::query(statement)
                        .persistent(false)
                        .execute(&mut **connection)
                        .await?;
                    results.push(QueryResult::execution(
                        execution_statement_kind(statement).as_str(),
                        result.rows_affected(),
                    ));
                }
            }
        }
        Ok(results)
    }

    async fn execute_parameterized_transaction(
        &self,
        session_id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let session = self
            .transaction_sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("Transaction not found: {session_id}"))?;
        let mut connection = session.lock().await;
        let mut rows_affected = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.sql).persistent(false);
            for parameter in &statement.params {
                query = bind_sqlite_parameter(query, parameter)?;
            }
            rows_affected.push(query.execute(&mut **connection).await?.rows_affected());
        }
        Ok(rows_affected)
    }

    async fn commit_transaction(&self, session_id: &str) -> Result<()> {
        let session = self
            .transaction_sessions
            .lock()
            .await
            .remove(session_id)
            .ok_or_else(|| anyhow!("Transaction not found: {session_id}"))?;
        (&mut **session.lock().await).execute("COMMIT").await?;
        Ok(())
    }

    async fn rollback_transaction(&self, session_id: &str) -> Result<()> {
        let session = self
            .transaction_sessions
            .lock()
            .await
            .remove(session_id)
            .ok_or_else(|| anyhow!("Transaction not found: {session_id}"))?;
        (&mut **session.lock().await).execute("ROLLBACK").await?;
        Ok(())
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        let rows = sqlx::query("PRAGMA database_list")
            .fetch_all(&self.pool().await?)
            .await?;
        let mut schemas = rows
            .iter()
            .filter_map(|row| row.try_get::<String, _>("name").ok())
            .filter(|name| !name.trim().is_empty())
            .collect::<Vec<_>>();
        schemas.sort();
        schemas.dedup();
        Ok(schemas)
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let schema_name = normalized_sqlite_schema(schema);
        let schema = sqlite_schema_identifier(schema_name)?;
        let statement = format!(
            "SELECT name, type FROM {schema}.sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
        );
        let rows = sqlx::query(&statement)
            .fetch_all(&self.pool().await?)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| TableInfo {
                name: row.try_get("name").unwrap_or_default(),
                schema: Some(schema_name.to_string()),
                table_type: row.try_get("type").ok(),
                comment: None,
            })
            .collect())
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        let schema_name = normalized_sqlite_schema(schema);
        let schema = sqlite_schema_identifier(schema_name)?;
        let statement = format!("PRAGMA {schema}.table_xinfo({})", sqlite_identifier(table)?);
        let rows = sqlx::query(&statement)
            .fetch_all(&self.pool().await?)
            .await?;
        let indexes = self.get_indexes(schema_name, table).await?;
        // PRAGMA notnull does not describe the implicit NOT NULL of a rowid
        // alias. A real INTEGER PRIMARY KEY has no separate primary index;
        // INTEGER PRIMARY KEY DESC and ordinary INT keys do have one.
        let rowid_primary = rows
            .iter()
            .filter(|row| row.try_get::<i64, _>("pk").unwrap_or(0) > 0)
            .count()
            == 1
            && !indexes.iter().any(|index| index.is_primary);
        // A partial/expression/composite unique index cannot establish that
        // one of its named columns is independently unique for every row.
        let single_unique_indexes = sqlx::query_scalar::<_, String>(
            "SELECT il.name FROM pragma_index_list(?1,?2) il WHERE il.\"unique\"=1 AND il.partial=0 AND (SELECT COUNT(*) FROM pragma_index_info(il.name,?2))=1 AND NOT EXISTS(SELECT 1 FROM pragma_index_info(il.name,?2) WHERE cid<0)"
        ).bind(table).bind(schema_name).fetch_all(&self.pool().await?).await?;
        Ok(rows
            .iter()
            .map(|row| {
                let name: String = row.try_get("name").unwrap_or_default();
                let hidden = row.try_get::<i64, _>("hidden").unwrap_or(0);
                let (is_generated, is_hidden) = sqlite_column_ownership(hidden);
                let rowid_alias = rowid_primary
                    && row.try_get::<i64, _>("pk").unwrap_or(0) > 0
                    && row
                        .try_get::<&str, _>("type")
                        .unwrap_or("")
                        .trim()
                        .eq_ignore_ascii_case("INTEGER");
                ColumnInfo {
                    name: name.clone(),
                    data_type: row
                        .try_get::<String, _>("type")
                        .unwrap_or_else(|_| "TEXT".to_string()),
                    is_nullable: row.try_get::<i64, _>("notnull").unwrap_or(0) == 0 && !rowid_alias,
                    is_primary_key: row.try_get::<i64, _>("pk").unwrap_or(0) > 0,
                    is_unique: rowid_alias
                        || indexes.iter().any(|index| {
                            single_unique_indexes.contains(&index.name)
                                && index.columns.iter().any(|column| column == &name)
                        }),
                    is_indexed: indexes
                        .iter()
                        .any(|index| index.columns.iter().any(|column| column == &name)),
                    is_auto_increment: false,
                    identity_generation: None,
                    is_generated: Some(is_generated),
                    is_hidden: Some(is_hidden),
                    character_set: None,
                    collation: None,
                    default_value: row.try_get("dflt_value").ok(),
                    comment: None,
                }
            })
            .collect())
    }

    async fn get_generated_columns(&self, schema: &str, table: &str) -> Result<Vec<String>> {
        let schema = sqlite_schema_identifier(normalized_sqlite_schema(schema))?;
        let statement = format!("PRAGMA {schema}.table_xinfo({})", sqlite_identifier(table)?);
        let rows = sqlx::query(&statement)
            .fetch_all(&self.pool().await?)
            .await?;
        Ok(rows
            .iter()
            .filter(|row| row.try_get::<i64, _>("hidden").unwrap_or(0) >= 2)
            .filter_map(|row| row.try_get("name").ok())
            .collect())
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
        let schema = sqlite_schema_identifier(schema)?;
        let statement = format!("PRAGMA {schema}.index_list({})", sqlite_identifier(table)?);
        let rows = sqlx::query(&statement)
            .fetch_all(&self.pool().await?)
            .await?;
        let pool = self.pool().await?;
        let mut indexes = Vec::new();
        for row in rows {
            let name: String = row.try_get("name").unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            let column_rows = sqlx::query(&format!(
                "PRAGMA {schema}.index_info({})",
                sqlite_identifier(&name)?
            ))
            .fetch_all(&pool)
            .await?;
            let definition = sqlx::query_scalar::<_, Option<String>>(&format!(
                "SELECT sql FROM {schema}.sqlite_schema WHERE type = 'index' AND name = ? AND tbl_name = ?"
            ))
            .bind(&name)
            .bind(table)
            .fetch_optional(&pool)
            .await?
            .flatten()
            .filter(|sql| !sql.trim().is_empty());
            indexes.push(IndexInfo {
                columns: column_rows
                    .iter()
                    .filter_map(|column| column.try_get("name").ok())
                    .collect(),
                is_unique: row.try_get::<i64, _>("unique").unwrap_or(0) != 0,
                is_primary: row
                    .try_get::<String, _>("origin")
                    .map(|value| value == "pk")
                    .unwrap_or(false),
                filter: None,
                index_type: Some("BTREE".to_string()),
                included_columns: None,
                definition,
                comment: None,
                key_is_expression: Vec::new(),
                name,
            });
        }
        Ok(indexes)
    }

    async fn get_constraints(&self, schema: &str, table: &str) -> Result<Vec<ConstraintInfo>> {
        let schema_name = normalized_sqlite_schema(schema);
        let schema = sqlite_schema_identifier(schema_name)?;
        let statement = format!(
            "PRAGMA {schema}.foreign_key_list({})",
            sqlite_identifier(table)?
        );
        let rows = sqlx::query(&statement)
            .fetch_all(&self.pool().await?)
            .await?;
        let mut grouped = BTreeMap::<i64, Vec<&SqliteRow>>::new();
        for row in &rows {
            grouped
                .entry(row.try_get::<i64, _>("id").unwrap_or_default())
                .or_default()
                .push(row);
        }
        Ok(grouped
            .into_iter()
            .map(|(id, mut rows)| {
                rows.sort_by_key(|row| row.try_get::<i64, _>("seq").unwrap_or_default());
                ConstraintInfo {
                    name: format!("fk_{table}_{id}"),
                    constraint_type: "FOREIGN KEY".to_string(),
                    columns: rows
                        .iter()
                        .filter_map(|row| row.try_get("from").ok())
                        .collect(),
                    referenced_schema: Some(schema_name.to_string()),
                    referenced_table: rows.first().and_then(|row| row.try_get("table").ok()),
                    referenced_columns: rows
                        .iter()
                        .filter_map(|row| row.try_get("to").ok())
                        .collect(),
                    definition: None,
                    on_update: rows.first().and_then(|row| row.try_get("on_update").ok()),
                    on_delete: rows.first().and_then(|row| row.try_get("on_delete").ok()),
                }
            })
            .collect())
    }

    async fn get_schema_objects(&self, schema: &str) -> Result<Vec<SchemaObjectInfo>> {
        let schema_name = normalized_sqlite_schema(schema);
        let schema = sqlite_schema_identifier(schema_name)?;
        let rows = sqlx::query(&format!(
            "SELECT name, tbl_name FROM {schema}.sqlite_schema \
             WHERE type = 'trigger' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name"
        ))
        .fetch_all(&self.pool().await?)
        .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let name = row.try_get::<String, _>("name").ok()?;
                let parent_name = row.try_get::<String, _>("tbl_name").ok()?;
                Some(SchemaObjectInfo {
                    name,
                    schema: Some(schema_name.to_string()),
                    object_type: "trigger".to_string(),
                    parent_name: Some(parent_name),
                    comment: None,
                    members_expandable: false,
                })
            })
            .collect())
    }
}
