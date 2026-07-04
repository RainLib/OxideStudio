use crate::core::{dialect::DatabaseKind, driver::DatabaseDriver};
use anyhow::{Context, Result};

pub mod mysql;
pub mod postgres;

pub async fn connect_driver(kind: DatabaseKind, url: &str) -> Result<Box<dyn DatabaseDriver>> {
    match kind {
        DatabaseKind::Postgres => {
            let mut driver = postgres::PostgresDriver::new(url);
            driver
                .connect()
                .await
                .with_context(|| format!("Failed to connect to {}", kind.display_name()))?;
            Ok(Box::new(driver))
        }
        DatabaseKind::Mysql => {
            let mut driver = mysql::MysqlDriver::new(url);
            driver
                .connect()
                .await
                .with_context(|| format!("Failed to connect to {}", kind.display_name()))?;
            Ok(Box::new(driver))
        }
    }
}
