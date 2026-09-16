use crate::core::protocol::{
    ColumnDef, ParameterizedStatement, QueryResult, DEFAULT_QUERY_RESULT_ROW_LIMIT,
};
use crate::core::statement::{
    execution_mode, execution_statement_kind, split_sql_statements, QueryExecutionMode,
    StatementScanDialect,
};
use anyhow::{anyhow, Result};
use futures::{StreamExt, TryStreamExt};
use sqlx::sqlite::SqliteRow;
use sqlx::{Column, Executor, Pool, Row, Sqlite, TypeInfo};

use super::models::SqliteDriver;
use super::values::sqlite_value;

impl SqliteDriver {
    pub(super) async fn pool(&self) -> Result<Pool<Sqlite>> {
        self.pool
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("SQLite driver is not connected"))
    }

    pub(super) async fn rows_result(
        &self,
        sql: &str,
        rows: Vec<SqliteRow>,
    ) -> Result<Vec<QueryResult>> {
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

    pub(super) async fn query_single(&self, sql: &str) -> Result<Vec<QueryResult>> {
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

    pub(super) async fn query_script(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let statements = split_sql_statements(sql, StatementScanDialect::Postgres);
        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            results.extend(self.query_single(statement).await?);
        }
        Ok(results)
    }
}

impl SqliteDriver {
    pub(super) async fn ensure_no_active_transactions(&self) -> Result<()> {
        if self.transaction_sessions.lock().await.is_empty() {
            Ok(())
        } else {
            Err(anyhow!(
                "Finish or roll back active SQLite transactions before backup or restore"
            ))
        }
    }
}

pub(crate) fn validate_sqlite_rebuild_statements(
    statements: &[ParameterizedStatement],
) -> Result<()> {
    if statements.is_empty() {
        return Err(anyhow!("SQLite rebuild contains no executable statements"));
    }
    for statement in statements {
        if !statement.params.is_empty() {
            return Err(anyhow!(
                "SQLite rebuild DDL must not contain caller-supplied parameters"
            ));
        }
        let sql = statement.sql.trim();
        if sql.is_empty() || sql.contains('\0') {
            return Err(anyhow!("SQLite rebuild contains an invalid statement"));
        }
        let normalized = sql.trim_start().to_ascii_uppercase();
        let is_trigger = normalized.starts_with("CREATE TRIGGER ")
            || normalized.starts_with("CREATE TEMP TRIGGER ")
            || normalized.starts_with("CREATE TEMPORARY TRIGGER ");
        let split = split_sql_statements(
            sql,
            if is_trigger {
                StatementScanDialect::Mysql
            } else {
                StatementScanDialect::Postgres
            },
        );
        if split.len() != 1 {
            return Err(anyhow!(
                "SQLite rebuild statements must contain exactly one SQL statement"
            ));
        }
        let first_keyword = split[0]
            .trim_start()
            .split(|character: char| character.is_ascii_whitespace() || character == '(')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        if !matches!(
            first_keyword.as_str(),
            "CREATE" | "INSERT" | "DROP" | "ALTER"
        ) {
            return Err(anyhow!(
                "SQLite rebuild contains an unsupported {first_keyword} statement"
            ));
        }
    }
    Ok(())
}
