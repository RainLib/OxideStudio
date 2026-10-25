mod catalog;
mod copy;
mod journal;
mod privileges;
mod projection;
mod publication;
mod session;
mod snapshot;
mod wire;

use super::{models::*, store::JobStore};
use crate::core::{
    config::SavedConnection, connection_url::connection_url_with_capabilities,
    dialect::database_capabilities_for_driver,
};
use anyhow::{ensure, Context, Result};
use serde_json::Value;
use sqlx::{mysql::MySqlConnectOptions, ConnectOptions, Connection, MySqlConnection};
use std::{str::FromStr, time::Duration};

pub(super) use copy::{copy_batch, initialize, reconcile};
pub(super) use journal::read_header;
pub(super) use publication::{publish, remove_staging};
pub(super) use snapshot::prepare_snapshot;

pub(super) fn quote(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}
pub(super) fn relation(schema: &str, name: &str) -> String {
    format!("{}.{}", quote(schema), quote(name))
}
pub(super) fn table(job: &StoredJob, name: &str) -> String {
    relation(&job.request.target.schema, name)
}
pub(super) fn options(
    config: &Value,
    endpoint: &LargeTransferEndpoint,
) -> Result<MySqlConnectOptions> {
    let saved: SavedConnection = serde_json::from_value(config.clone())?;
    let url = connection_url_with_capabilities(
        "mysql",
        &saved,
        &database_capabilities_for_driver("mysql")?,
        false,
    )?;
    let mut options = MySqlConnectOptions::from_str(&url)?
        .charset("utf8mb4")
        .collation("utf8mb4_unicode_ci")
        .disable_statement_logging();
    if !endpoint.schema.is_empty() {
        options = options.database(&endpoint.schema);
    } else if let Some(db) = endpoint.database.as_deref().filter(|s| !s.is_empty()) {
        options = options.database(db);
    }
    Ok(options)
}
pub(super) async fn connect_config(
    config: &Value,
    endpoint: &LargeTransferEndpoint,
    read_only: bool,
) -> Result<MySqlConnection> {
    let mut connection = tokio::time::timeout(
        Duration::from_secs(5),
        MySqlConnection::connect_with(&options(config, endpoint)?),
    )
    .await??;
    let version: String = sqlx::query_scalar("SELECT VERSION()")
        .fetch_one(&mut connection)
        .await?;
    let parts = version
        .split('.')
        .take(3)
        .map(|part| {
            part.split(|c: char| !c.is_ascii_digit())
                .next()
                .unwrap_or("")
                .parse::<u32>()
        })
        .collect::<std::result::Result<Vec<_>, _>>()?;
    ensure!(
        parts.len() == 3
            && (parts[0], parts[1], parts[2]) >= (8, 0, 22)
            && !version.to_ascii_lowercase().contains("mariadb")
            && !version.to_ascii_lowercase().contains("tidb"),
        "durable MySQL transfer requires native MySQL 8.0.22 or newer"
    );
    session::capture(&mut connection).await?;
    session::normalize(&mut connection).await?;
    sqlx::query("SET SESSION transaction_isolation='REPEATABLE-READ',SESSION innodb_lock_wait_timeout=5,SESSION lock_wait_timeout=5,SESSION max_execution_time=1800000").execute(&mut connection).await?;
    if read_only {
        sqlx::query("SET SESSION transaction_read_only=ON")
            .execute(&mut connection)
            .await?;
    }
    Ok(connection)
}
pub(super) async fn connect_original(
    store: &JobStore,
    job: &StoredJob,
    read_only: bool,
) -> Result<MySqlConnection> {
    let plan = job.mysql()?;
    let config = store.unseal_mysql_target(
        &job.summary.id,
        &job.request.project_id,
        &plan.target_connection,
    )?;
    ensure!(
        store.authenticate("target-config", &config)? == job.target_binding,
        "MySQL target configuration authentication failed"
    );
    let mut connection = connect_config(&config, &job.request.target, read_only).await?;
    if !plan.server_uuid.is_empty() {
        let uuid: String = sqlx::query_scalar("SELECT @@server_uuid")
            .fetch_one(&mut connection)
            .await?;
        ensure!(uuid == plan.server_uuid, "MySQL server identity changed");
        let (mode, zone) = session::native_settings(&mut connection).await?;
        ensure!(
            mode == plan.native_mode && zone == plan.native_time_zone,
            "MySQL target native session changed"
        );
    }
    if !read_only {
        let acquired: Option<i64> = sqlx::query_scalar("SELECT GET_LOCK(?,0)")
            .bind(format!("oxide.transfer.{}", job.summary.id))
            .fetch_one(&mut connection)
            .await?;
        ensure!(
            acquired == Some(1),
            "another MySQL connection owns this transfer"
        );
    }
    Ok(connection)
}
pub(super) async fn packet_budget(connection: &mut MySqlConnection) -> Result<usize> {
    let packet: u64 = sqlx::query_scalar("SELECT @@max_allowed_packet")
        .fetch_one(connection)
        .await?;
    usize::try_from((packet / 4).min(BATCH_BYTES)).context("MySQL packet budget is invalid")
}
