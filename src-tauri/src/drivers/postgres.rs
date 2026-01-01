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
            SELECT
                c.column_name,
                c.data_type,
                c.is_nullable,
                c.column_default,
                EXISTS (
                    SELECT 1
                    FROM information_schema.key_column_usage kcu
                    JOIN information_schema.table_constraints tc ON kcu.constraint_name = tc.constraint_name
                    WHERE kcu.table_schema = c.table_schema
                      AND kcu.table_name = c.table_name
                      AND kcu.column_name = c.column_name
                      AND tc.constraint_type = 'PRIMARY KEY'
                ) as is_primary_key
            FROM information_schema.columns c
            WHERE c.table_schema = $1 AND c.table_name = $2
            ORDER BY c.ordinal_position
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
                let is_primary_key = r.try_get::<bool, _>("is_primary_key").unwrap_or(false);

                ColumnInfo {
                    name: r.try_get("column_name").unwrap_or_default(),
                    data_type: r.try_get("data_type").unwrap_or_default(),
                    is_nullable,
                    is_primary_key,
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
