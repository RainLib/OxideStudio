use crate::core::driver::DatabaseDriver;
use crate::core::protocol::{
    ColumnDef, ColumnInfo, ConstraintInfo, IndexInfo, ParameterizedStatement, QueryParameter,
    QueryResult, TableInfo, DEFAULT_QUERY_RESULT_ROW_LIMIT,
};
use crate::core::statement::{
    execution_mode, execution_statement_kind, split_sql_statements, QueryExecutionMode,
    StatementScanDialect,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::{StreamExt, TryStreamExt};
use serde_json::Value;
use sqlx::sqlite::{SqliteArguments, SqliteConnectOptions, SqlitePoolOptions, SqliteRow};
use sqlx::{Column, ConnectOptions, Executor, Pool, Row, Sqlite, TypeInfo};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::Mutex;

type SqliteTransactionSession = Arc<Mutex<sqlx::pool::PoolConnection<Sqlite>>>;

/// SQLite is intentionally implemented as a local, file-based driver. It has
/// no server/database switching, but exposes the same bounded query and
/// Explorer metadata contract as the network relational drivers.
pub struct SqliteDriver {
    connection_string: String,
    read_only: bool,
    pool: Mutex<Option<Pool<Sqlite>>>,
    transaction_sessions: Mutex<HashMap<String, SqliteTransactionSession>>,
}

impl SqliteDriver {
    pub fn new(connection_string: &str) -> Self {
        Self {
            connection_string: normalize_sqlite_url(connection_string),
            read_only: false,
            pool: Mutex::new(None),
            transaction_sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Agent read-only connections are protected by SQLite itself, rather than
    /// relying only on a SQL lexer or a transaction wrapper. In-memory SQLite
    /// cannot be reopened as read-only, so it is intentionally not an Agent
    /// target.
    pub fn new_read_only(connection_string: &str) -> Result<Self> {
        let connection_string = normalize_sqlite_url(connection_string);
        if connection_string == "sqlite::memory:" {
            return Err(anyhow!(
                "Agent read-only access is unavailable for in-memory SQLite databases"
            ));
        }
        Ok(Self {
            connection_string,
            read_only: true,
            pool: Mutex::new(None),
            transaction_sessions: Mutex::new(HashMap::new()),
        })
    }

    async fn pool(&self) -> Result<Pool<Sqlite>> {
        self.pool
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("SQLite driver is not connected"))
    }

    async fn rows_result(&self, sql: &str, rows: Vec<SqliteRow>) -> Result<Vec<QueryResult>> {
        let columns: Vec<ColumnDef> = if let Some(row) = rows.first() {
            row.columns()
                .iter()
                .map(|column| ColumnDef {
                    name: column.name().to_string(),
                    data_type: column.type_info().name().to_string(),
                })
                .collect()
        } else {
            self.pool()
                .await?
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
        };
        let values = rows
            .iter()
            .map(|row| {
                (0..columns.len())
                    .map(|index| sqlite_value(row, index))
                    .collect()
            })
            .collect();
        Ok(vec![QueryResult::rows_limited(
            columns,
            values,
            DEFAULT_QUERY_RESULT_ROW_LIMIT,
        )])
    }

    async fn query_single(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let pool = self.pool().await?;
        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let rows = sqlx::query(sql)
                    .persistent(false)
                    .fetch(&pool)
                    .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                    .try_collect()
                    .await?;
                self.rows_result(sql, rows).await
            }
            QueryExecutionMode::AffectsRows => {
                let result = sqlx::query(sql).persistent(false).execute(&pool).await?;
                Ok(vec![QueryResult::execution(
                    execution_statement_kind(sql).as_str(),
                    result.rows_affected(),
                )])
            }
        }
    }

    async fn query_script(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let statements = split_sql_statements(sql, StatementScanDialect::Postgres);
        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            results.extend(self.query_single(statement).await?);
        }
        Ok(results)
    }
}

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
        let mut connection = pool.acquire().await?;
        (&mut *connection).execute("BEGIN").await?;
        let mut affected = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.sql).persistent(false);
            for parameter in &statement.params {
                query = bind_sqlite_parameter(query, parameter)?;
            }
            match query.execute(&mut *connection).await {
                Ok(result) => affected.push(result.rows_affected()),
                Err(error) => {
                    let _ = (&mut *connection).execute("ROLLBACK").await;
                    return Err(error.into());
                }
            }
        }
        (&mut *connection).execute("COMMIT").await?;
        Ok(affected)
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
        let statement = format!("PRAGMA {schema}.table_info({})", sqlite_identifier(table)?);
        let rows = sqlx::query(&statement)
            .fetch_all(&self.pool().await?)
            .await?;
        let indexes = self.get_indexes(schema_name, table).await?;
        Ok(rows
            .iter()
            .map(|row| {
                let name: String = row.try_get("name").unwrap_or_default();
                ColumnInfo {
                    name: name.clone(),
                    data_type: row
                        .try_get::<String, _>("type")
                        .unwrap_or_else(|_| "TEXT".to_string()),
                    is_nullable: row.try_get::<i64, _>("notnull").unwrap_or(0) == 0,
                    is_primary_key: row.try_get::<i64, _>("pk").unwrap_or(0) > 0,
                    is_unique: indexes.iter().any(|index| {
                        index.is_unique && index.columns.iter().any(|column| column == &name)
                    }),
                    is_indexed: indexes
                        .iter()
                        .any(|index| index.columns.iter().any(|column| column == &name)),
                    is_auto_increment: false,
                    default_value: row.try_get("dflt_value").ok(),
                    comment: None,
                }
            })
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
                index_type: Some("BTREE".to_string()),
                definition: None,
                comment: None,
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
        Ok(rows
            .iter()
            .map(|row| ConstraintInfo {
                name: format!(
                    "fk_{}_{}",
                    table,
                    row.try_get::<i64, _>("id").unwrap_or_default()
                ),
                constraint_type: "FOREIGN KEY".to_string(),
                columns: row
                    .try_get("from")
                    .map(|value| vec![value])
                    .unwrap_or_default(),
                referenced_schema: Some(schema_name.to_string()),
                referenced_table: row.try_get("table").ok(),
                referenced_columns: row
                    .try_get("to")
                    .map(|value| vec![value])
                    .unwrap_or_default(),
                definition: None,
            })
            .collect())
    }
}

fn normalize_sqlite_url(value: &str) -> String {
    let value = value.trim();
    if value == ":memory:" {
        "sqlite::memory:".to_string()
    } else if value.starts_with("sqlite:") {
        value.to_string()
    } else {
        format!("sqlite://{value}")
    }
}

fn sqlite_identifier(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.contains('\0') {
        return Err(anyhow!("Invalid SQLite identifier"));
    }
    Ok(format!("\"{}\"", value.replace('"', "\"\"")))
}

fn sqlite_schema_identifier(value: &str) -> Result<String> {
    sqlite_identifier(normalized_sqlite_schema(value))
}

fn normalized_sqlite_schema(value: &str) -> &str {
    let value = value.trim();
    if value.is_empty() {
        "main"
    } else {
        value
    }
}

fn sqlite_value(row: &SqliteRow, index: usize) -> Value {
    // SQLite permits permissive coercion (for example TEXT -> i64 yields 0),
    // so probing decoders in an arbitrary order corrupts visible result data.
    // Use the value's actual SQLite storage type reported by SQLx instead.
    let storage_type = row.column(index).type_info().name().to_ascii_uppercase();
    match storage_type.as_str() {
        "NULL" => Value::Null,
        "INTEGER" | "BOOLEAN" => row
            .try_get_unchecked::<Option<i64>, _>(index)
            .ok()
            .flatten()
            .map(serde_json::Number::from)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        "REAL" | "FLOAT" | "DOUBLE" => row
            .try_get_unchecked::<Option<f64>, _>(index)
            .ok()
            .flatten()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        "BLOB" => row
            .try_get_unchecked::<Option<Vec<u8>>, _>(index)
            .ok()
            .flatten()
            .map(|bytes| {
                Value::String(format!(
                    "0x{}",
                    bytes
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect::<String>()
                ))
            })
            .unwrap_or(Value::Null),
        _ => row
            .try_get_unchecked::<Option<String>, _>(index)
            .ok()
            .flatten()
            .map(Value::String)
            .unwrap_or(Value::Null),
    }
}

fn bind_sqlite_parameter<'q>(
    query: sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>,
    parameter: &QueryParameter,
) -> Result<sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>> {
    match &parameter.value {
        Value::Null => Ok(query.bind(Option::<String>::None)),
        Value::Bool(value) => Ok(query.bind(*value)),
        Value::Number(value) if value.is_i64() => {
            Ok(query.bind(value.as_i64().unwrap_or_default()))
        }
        Value::Number(value) if value.is_u64() => {
            Ok(query.bind(value.as_u64().unwrap_or_default() as i64))
        }
        Value::Number(value) => Ok(query.bind(value.as_f64().unwrap_or_default())),
        Value::String(value) => Ok(query.bind(value.clone())),
        value => Ok(query.bind(serde_json::to_string(value)?)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sqlite_driver_exposes_bounded_query_and_explorer_metadata() {
        let mut driver = SqliteDriver::new(":memory:");
        driver.connect().await.unwrap();
        driver.query("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE); INSERT INTO users VALUES (1, 'hello@example.test');").await.unwrap();
        let rows = driver.query("SELECT id, email FROM users").await.unwrap();
        assert_eq!(rows[0].rows.len(), 1);
        assert_eq!(driver.get_tables("main").await.unwrap()[0].name, "users");
        assert!(driver
            .get_columns("main", "users")
            .await
            .unwrap()
            .iter()
            .any(|column| column.is_primary_key));
        assert!(driver
            .get_indexes("main", "users")
            .await
            .unwrap()
            .iter()
            .any(|index| index.is_unique));

        // The Data Grid uses numbered bind markers on its shared relational
        // path. Verify SQLite executes that exact shape in an in-memory pool.
        assert_eq!(
            driver
                .execute_parameterized(
                    "UPDATE users SET email = $1 WHERE id = $2",
                    &[
                        QueryParameter {
                            value: Value::String("updated@example.test".to_string()),
                            data_type: Some("TEXT".to_string()),
                        },
                        QueryParameter {
                            value: Value::from(1),
                            data_type: Some("INTEGER".to_string()),
                        },
                    ],
                )
                .await
                .unwrap(),
            1
        );
        let updated = driver
            .query("SELECT email FROM users WHERE id = 1")
            .await
            .unwrap();
        assert_eq!(
            updated[0].rows[0][0],
            Value::String("updated@example.test".to_string())
        );

        driver
            .query(
                "ATTACH DATABASE ':memory:' AS analytics; CREATE TABLE analytics.events (id INTEGER PRIMARY KEY, name TEXT);",
            )
            .await
            .unwrap();
        assert!(driver
            .get_schemas()
            .await
            .unwrap()
            .iter()
            .any(|schema| schema == "analytics"));
        assert_eq!(
            driver.get_tables("analytics").await.unwrap()[0].name,
            "events"
        );
        assert!(driver
            .get_columns("analytics", "events")
            .await
            .unwrap()
            .iter()
            .any(|column| column.name == "name"));
    }

    #[test]
    fn readonly_sqlite_driver_rejects_in_memory_targets() {
        assert!(SqliteDriver::new_read_only(":memory:").is_err());
        assert!(SqliteDriver::new_read_only("sqlite://workspace.db").is_ok());
    }

    #[tokio::test]
    async fn readonly_sqlite_driver_allows_selects_but_engine_rejects_writes() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let path = file.path().to_string_lossy().into_owned();

        let mut writable = SqliteDriver::new(&path);
        writable.connect().await.unwrap();
        writable
            .query("CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO entries VALUES (1, 'safe');")
            .await
            .unwrap();
        writable.disconnect().await.unwrap();

        let mut read_only = SqliteDriver::new_read_only(&path).unwrap();
        read_only.connect().await.unwrap();
        let rows = read_only.query("SELECT value FROM entries").await.unwrap();
        assert_eq!(rows[0].rows[0][0], Value::String("safe".to_string()));
        assert!(read_only
            .query("INSERT INTO entries VALUES (2, 'blocked')")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn parameterized_batches_share_the_explicit_transaction_boundary() {
        let mut driver = SqliteDriver::new(":memory:");
        driver.connect().await.unwrap();
        driver
            .query("CREATE TABLE imports (id INTEGER PRIMARY KEY, label TEXT NOT NULL)")
            .await
            .unwrap();

        driver.begin_transaction("csv-import", None).await.unwrap();
        let affected = driver
            .execute_parameterized_transaction(
                "csv-import",
                &[
                    ParameterizedStatement {
                        sql: "INSERT INTO imports (id, label) VALUES ($1, $2)".to_string(),
                        params: vec![
                            QueryParameter {
                                value: Value::from(1),
                                data_type: Some("INTEGER".to_string()),
                            },
                            QueryParameter {
                                value: Value::String("first".to_string()),
                                data_type: Some("TEXT".to_string()),
                            },
                        ],
                    },
                    ParameterizedStatement {
                        sql: "INSERT INTO imports (id, label) VALUES ($1, $2)".to_string(),
                        params: vec![
                            QueryParameter {
                                value: Value::from(2),
                                data_type: Some("INTEGER".to_string()),
                            },
                            QueryParameter {
                                value: Value::String("second".to_string()),
                                data_type: Some("TEXT".to_string()),
                            },
                        ],
                    },
                ],
            )
            .await
            .unwrap();
        assert_eq!(affected, vec![1, 1]);
        driver.rollback_transaction("csv-import").await.unwrap();

        let rows = driver.query("SELECT * FROM imports").await.unwrap();
        assert!(rows[0].rows.is_empty());
    }
}
