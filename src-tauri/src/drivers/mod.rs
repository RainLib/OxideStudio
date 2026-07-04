use crate::core::{dialect::DatabaseKind, driver::DatabaseDriver};
use anyhow::{Context, Result};
use std::str::FromStr;

pub mod elasticsearch;
pub mod mongodb;
pub mod mysql;
pub mod postgres;
pub mod redis;

pub async fn connect_driver(driver: &str, url: &str) -> Result<Box<dyn DatabaseDriver>> {
    if driver.eq_ignore_ascii_case("mongodb") || driver.eq_ignore_ascii_case("mongo") {
        let mut driver = mongodb::MongoDbDriver::new(url);
        driver
            .connect()
            .await
            .context("Failed to connect to MongoDB")?;
        return Ok(Box::new(driver));
    }

    if driver.eq_ignore_ascii_case("elasticsearch") || driver.eq_ignore_ascii_case("elastic") {
        let mut driver = elasticsearch::ElasticsearchDriver::new(url)?;
        driver
            .connect()
            .await
            .context("Failed to connect to Elasticsearch")?;
        return Ok(Box::new(driver));
    }

    if driver.eq_ignore_ascii_case("redis") {
        let mut driver = redis::RedisDriver::new(url)?;
        driver
            .connect()
            .await
            .context("Failed to connect to Redis")?;
        return Ok(Box::new(driver));
    }

    let kind = DatabaseKind::from_str(driver)?;
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
