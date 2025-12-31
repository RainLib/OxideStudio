use crate::core::driver::DatabaseDriver;
use crate::core::protocol::{ColumnDef, ColumnInfo, QueryResult, TableInfo};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgRow};
use sqlx::{Column, ConnectOptions, Pool, Postgres, Row, TypeInfo};
use std::str::FromStr;
use std::time::Duration;

pub struct PostgresDriver {
    pub pool: Option<Pool<Postgres>>,
    pub connection_string: String,
}

impl PostgresDriver {
    pub fn new(connection_string: &str) -> Self {
        Self {
            pool: None,
            connection_string: connection_string.to_string(),
        }
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

        Ok(vec![QueryResult {
            columns,
            rows: data_rows,
        }])
    }
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

        self.pool = Some(pool);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<()> {
        if let Some(pool) = self.pool.take() {
            pool.close().await;
        }
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        if let Some(pool) = &self.pool {
            sqlx::query("SELECT 1")
                .persistent(false)
                .execute(pool)
                .await?;
            Ok(())
        } else {
            Err(anyhow!("Not connected"))
        }
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let pool = self.pool.as_ref().ok_or_else(|| anyhow!("Not connected"))?;
        let rows = sqlx::query(sql).persistent(false).fetch_all(pool).await?;
        self.process_rows(rows)
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        let pool = self.pool.as_ref().ok_or_else(|| anyhow!("Not connected"))?;
        let mut conn = pool.acquire().await?;

        // Set search path for this session
        sqlx::query(&format!("SET search_path TO \"{}\"", schema))
            .persistent(false)
            .execute(&mut *conn)
            .await?;

        // Execute the actual query on the same connection
        let rows = sqlx::query(sql)
            .persistent(false)
            .fetch_all(&mut *conn)
            .await?;
        self.process_rows(rows)
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        let pool = self.pool.as_ref().ok_or_else(|| anyhow!("Not connected"))?;
        let rows = sqlx::query("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') ORDER BY schema_name")
            .persistent(false)
            .fetch_all(pool)
            .await?;

        let schemas: Vec<String> = rows
            .iter()
            .map(|r| r.try_get(0).unwrap_or_default())
            .collect();

        Ok(schemas)
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let pool = self.pool.as_ref().ok_or_else(|| anyhow!("Not connected"))?;
        let rows = sqlx::query(
            "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
        )
        .bind(schema)
        .persistent(false)
        .fetch_all(pool)
        .await?;

        let tables = rows
            .iter()
            .map(|r| TableInfo {
                name: r.try_get(0).unwrap_or_default(),
                schema: Some(schema.to_string()),
                comment: None,
            })
            .collect();

        Ok(tables)
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        let pool = self.pool.as_ref().ok_or_else(|| anyhow!("Not connected"))?;
        let rows = sqlx::query(
            r#"
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            "#,
        )
        .bind(schema)
        .bind(table)
        .persistent(false)
        .fetch_all(pool)
        .await?;

        let cols = rows
            .iter()
            .map(|r| {
                let is_nullable = r
                    .try_get::<String, _>("is_nullable")
                    .unwrap_or("YES".to_string())
                    == "YES";
                ColumnInfo {
                    name: r.try_get("column_name").unwrap_or_default(),
                    data_type: r.try_get("data_type").unwrap_or_default(),
                    is_nullable,
                    is_primary_key: false,
                    default_value: r.try_get("column_default").ok(),
                    comment: None,
                }
            })
            .collect();

        Ok(cols)
    }

    async fn set_current_schema(&self, schema: &str) -> Result<()> {
        let pool = self.pool.as_ref().ok_or_else(|| anyhow!("Not connected"))?;
        // Use double quotes for Postgres schema names
        let sql = format!("SET search_path TO \"{}\"", schema);
        sqlx::query(&sql).persistent(false).execute(pool).await?;
        Ok(())
    }
}

fn decode_pg_value(row: &PgRow, index: usize) -> serde_json::Value {
    let col = row.column(index);
    let type_name = col.type_info().name();

    match type_name {
        "BOOL" | "bool" => {
            let v: Option<bool> = row.try_get(index).ok();
            serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
        }
        "INT2" | "INT4" | "INT8" | "int2" | "int4" | "int8" => {
            let v: Option<i64> = row.try_get(index).ok();
            serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
        }
        "FLOAT4" | "FLOAT8" | "float4" | "float8" | "NUMERIC" | "numeric" => {
            let v: Option<f64> = row.try_get(index).ok();
            serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
        }
        "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" | "text" | "varchar" | "char" => {
            let v: Option<String> = row.try_get(index).ok();
            serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
        }
        "JSON" | "JSONB" | "json" | "jsonb" => {
            let v: Option<serde_json::Value> = row.try_get(index).ok();
            v.unwrap_or(serde_json::Value::Null)
        }
        _ => {
            let v: Option<String> = row.try_get(index).ok();
            serde_json::to_value(v).unwrap_or(serde_json::Value::String(format!("<{}>", type_name)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dotenvy::dotenv;
    use std::env;

    #[tokio::test]
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
