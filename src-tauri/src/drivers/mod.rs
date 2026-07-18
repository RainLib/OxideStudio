use crate::core::{
    dialect::{canonical_driver_name, DatabaseKind},
    driver::DatabaseDriver,
};
use anyhow::{Context, Result};
use std::str::FromStr;

pub mod elasticsearch;
pub mod mongodb;
pub mod mysql;
pub mod postgres;
pub mod redis;

pub async fn connect_driver(driver: &str, url: &str) -> Result<Box<dyn DatabaseDriver>> {
    let canonical_driver = canonical_driver_name(driver)
        .ok_or_else(|| anyhow::anyhow!("Unsupported database driver: {}", driver.trim()))?;

    if canonical_driver == "mongodb" {
        let mut driver = mongodb::MongoDbDriver::new(url);
        driver
            .connect()
            .await
            .context("Failed to connect to MongoDB")?;
        return Ok(Box::new(driver));
    }

    if canonical_driver == "elasticsearch" {
        let mut driver = elasticsearch::ElasticsearchDriver::new(url)?;
        if let Err(error) = driver.connect().await {
            return Err(anyhow::anyhow!(
                "Failed to connect to Elasticsearch: {error:#}"
            ));
        }
        return Ok(Box::new(driver));
    }

    if canonical_driver == "redis" {
        let mut driver = redis::RedisDriver::new(url)?;
        driver
            .connect()
            .await
            .context("Failed to connect to Redis")?;
        return Ok(Box::new(driver));
    }

    let kind = DatabaseKind::from_str(canonical_driver)?;
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
