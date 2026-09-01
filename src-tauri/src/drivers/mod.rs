use crate::core::{
    dialect::{canonical_driver_name, DatabaseKind},
    driver::DatabaseDriver,
    driver_package::{is_safe_driver_package_token, DatabaseDriverPackageRegistry},
};
use anyhow::{Context, Result};
use std::str::FromStr;

pub mod elasticsearch;
pub mod external;
pub mod influxdb3;
pub mod meilisearch;
pub mod mongodb;
mod mongodb_shell;
pub mod mysql;
pub mod postgres;
pub mod redis;
pub mod sqlite;
pub mod sqlite_ssh;

pub async fn connect_driver(driver: &str, url: &str) -> Result<Box<dyn DatabaseDriver>> {
    let requested_driver = driver.trim();
    let normalized_requested = requested_driver.to_ascii_lowercase();
    let canonical_driver =
        canonical_driver_name(requested_driver).unwrap_or(normalized_requested.as_str());
    if !is_safe_driver_package_token(canonical_driver) {
        return Err(anyhow::anyhow!(
            "Unsupported database driver: {}",
            requested_driver
        ));
    }

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

    if canonical_driver == "influxdb3" {
        let mut driver = influxdb3::InfluxDb3Driver::new(url)?;
        driver
            .connect()
            .await
            .context("Failed to connect to InfluxDB 3")?;
        return Ok(Box::new(driver));
    }

    if canonical_driver == "meilisearch" {
        let mut driver = meilisearch::MeilisearchDriver::new(url)?;
        driver
            .connect()
            .await
            .context("Failed to connect to Meilisearch")?;
        return Ok(Box::new(driver));
    }

    if canonical_driver == "sqlite" {
        let mut driver = sqlite::SqliteDriver::new(url);
        driver
            .connect()
            .await
            .context("Failed to connect to SQLite")?;
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

/// Open an agent-owned connection with the strongest available read-only
/// boundary. Server SQL drivers continue to use their transaction wrappers;
/// SQLite instead opens the database handle in read-only mode at the engine
/// layer, so a parser bypass cannot mutate the source file.
pub async fn connect_agent_read_only_driver(
    driver: &str,
    url: &str,
) -> Result<Box<dyn DatabaseDriver>> {
    let requested_driver = driver.trim();
    let normalized_requested = requested_driver.to_ascii_lowercase();
    let canonical_driver =
        canonical_driver_name(requested_driver).unwrap_or(normalized_requested.as_str());
    if canonical_driver == "sqlite" {
        let mut driver = sqlite::SqliteDriver::new_read_only(url)?;
        driver
            .connect()
            .await
            .context("Failed to open SQLite in read-only mode")?;
        return Ok(Box::new(driver));
    }
    connect_driver(driver, url).await
}

/// Agent equivalent of `connect_preferred_driver`. It deliberately refuses
/// an external runtime unless the package advertises execution-side read-only
/// enforcement; the Agent must not rely on lexer checks alone.
pub async fn connect_agent_read_only_preferred_driver(
    registry: &DatabaseDriverPackageRegistry,
    driver: &str,
    url: &str,
    connection_id: String,
    package_version: Option<&str>,
) -> Result<Box<dyn DatabaseDriver>> {
    let requested_driver = driver.trim();
    let normalized_requested = requested_driver.to_ascii_lowercase();
    let canonical_driver =
        canonical_driver_name(requested_driver).unwrap_or(normalized_requested.as_str());
    if !is_safe_driver_package_token(canonical_driver) {
        return Err(anyhow::anyhow!(
            "Unsupported database driver: {}",
            requested_driver
        ));
    }
    let active_external = registry.list_installed().into_iter().any(|package| {
        package.active
            && package
                .manifest
                .driver_id
                .eq_ignore_ascii_case(canonical_driver)
    });
    if package_version.is_none() && !active_external {
        return connect_agent_read_only_driver(canonical_driver, url).await;
    }

    let package = match package_version
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(version) => registry.resolve_version(canonical_driver, version),
        None => registry.resolve_active(canonical_driver),
    }
    .map_err(|error| anyhow::anyhow!(error))?;
    let mut driver = external::ExternalDriver::new_agent_read_only(
        package,
        registry.clone(),
        connection_id,
        url.to_string(),
    );
    driver
        .connect()
        .await
        .context("Failed to connect through the external read-only driver package")?;
    Ok(Box::new(driver))
}

/// Prefer an explicitly activated external package for its canonical driver id.
/// If no package is active, the bundled implementation remains the recovery path.
/// An active package that fails verification never silently falls back: the user
/// must fix or roll back the selected package instead of connecting with a
/// different client version than the settings indicate.
pub async fn connect_preferred_driver(
    registry: &DatabaseDriverPackageRegistry,
    driver: &str,
    url: &str,
    connection_id: String,
    package_version: Option<&str>,
) -> Result<Box<dyn DatabaseDriver>> {
    let requested_driver = driver.trim();
    let normalized_requested = requested_driver.to_ascii_lowercase();
    let canonical_driver =
        canonical_driver_name(requested_driver).unwrap_or(normalized_requested.as_str());
    if !is_safe_driver_package_token(canonical_driver) {
        return Err(anyhow::anyhow!(
            "Unsupported database driver: {}",
            requested_driver
        ));
    }
    let active_external = registry.list_installed().into_iter().any(|package| {
        package.active
            && package
                .manifest
                .driver_id
                .eq_ignore_ascii_case(canonical_driver)
    });
    if package_version.is_none() && !active_external {
        return connect_driver(canonical_driver, url).await;
    }

    let package = match package_version
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(version) => registry.resolve_version(canonical_driver, version),
        None => registry.resolve_active(canonical_driver),
    }
    .map_err(|error| anyhow::anyhow!(error))?;
    let mut driver =
        external::ExternalDriver::new(package, registry.clone(), connection_id, url.to_string());
    driver
        .connect()
        .await
        .context("Failed to connect through the external driver package")?;
    Ok(Box::new(driver))
}
