use crate::core::driver::DatabaseDriver;
use crate::core::protocol::{ColumnDef, ColumnInfo, QueryResult, TableInfo};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow};
use sqlx::{Column, ConnectOptions, MySql, Pool, Row, TypeInfo};
use std::str::FromStr;
use std::time::Duration;

pub struct MysqlDriver {
    pub pool: Option<Pool<MySql>>,
    pub connection_string: String,
}

impl MysqlDriver {
    pub fn new(connection_string: &str) -> Self {
        Self {
            pool: None,
            connection_string: connection_string.to_string(),
        }
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

        Ok(vec![QueryResult {
            columns,
            rows: data_rows,
        }])
    }
}

#[async_trait]
impl DatabaseDriver for MysqlDriver {
    async fn connect(&mut self) -> Result<()> {
        let options = MySqlConnectOptions::from_str(&self.connection_string)?
            .disable_statement_logging()
            .to_owned();

        let pool = MySqlPoolOptions::new()
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

        // Use database for this session
        sqlx::query(&format!("USE `{}`", schema))
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
        let rows = sqlx::query("SHOW DATABASES")
            .persistent(false)
            .fetch_all(pool)
            .await?;

        let mut schemas: Vec<String> = rows
            .iter()
            .map(|r| {
                if let Ok(name) = r.try_get::<String, _>(0) {
                    name
                } else if let Ok(bytes) = r.try_get::<Vec<u8>, _>(0) {
                    String::from_utf8_lossy(&bytes).to_string()
                } else {
                    "".to_string()
                }
            })
            .filter(|s| !s.is_empty())
            .collect();

        schemas.sort();

        Ok(schemas)
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let pool = self.pool.as_ref().ok_or_else(|| anyhow!("Not connected"))?;
        let rows = sqlx::query(
            "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name",
        )
        .bind(schema)
        .persistent(false)
        .fetch_all(pool)
        .await?;

        let tables = rows
            .iter()
            .map(|r| {
                let name = if let Ok(name) = r.try_get::<String, _>(0) {
                    name
                } else if let Ok(bytes) = r.try_get::<Vec<u8>, _>(0) {
                    String::from_utf8_lossy(&bytes).to_string()
                } else {
                    "".to_string()
                };

                TableInfo {
                    name,
                    schema: Some(schema.to_string()),
                    comment: None,
                }
            })
            .filter(|t| !t.name.is_empty())
            .collect();

        Ok(tables)
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        let pool = self.pool.as_ref().ok_or_else(|| anyhow!("Not connected"))?;
        let rows = sqlx::query(
            r#"
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
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
                    .try_get::<String, _>("IS_NULLABLE")
                    .unwrap_or("YES".to_string())
                    == "YES";
                ColumnInfo {
                    name: r.try_get("COLUMN_NAME").unwrap_or_default(),
                    data_type: r.try_get("DATA_TYPE").unwrap_or_default(),
                    is_nullable,
                    is_primary_key: false,
                    default_value: r.try_get("COLUMN_DEFAULT").ok(),
                    comment: None,
                }
            })
            .collect();

        Ok(cols)
    }

    async fn set_current_schema(&self, schema: &str) -> Result<()> {
        let pool = self.pool.as_ref().ok_or_else(|| anyhow!("Not connected"))?;
        // Use backticks for MySQL database names
        let sql = format!("USE `{}`", schema);
        sqlx::query(&sql).persistent(false).execute(pool).await?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use dotenvy::dotenv;
    use std::env;

    #[tokio::test]
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
