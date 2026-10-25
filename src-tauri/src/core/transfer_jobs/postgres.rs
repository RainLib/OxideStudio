mod catalog;
mod copy;
mod receipt;
mod session;
mod snapshot;
mod wire;

use super::{models::*, store::JobStore};
use crate::core::{
    config::SavedConnection, connection_url::connection_url_with_capabilities,
    dialect::database_capabilities_for_driver,
};
use anyhow::{ensure, Result};
use serde_json::Value;
use sqlx::{postgres::PgConnectOptions, ConnectOptions, Connection, PgConnection};
use std::{str::FromStr, time::Duration};

pub(super) use copy::{copy_batch, initialize, publish, reconcile, remove_staging};
pub(super) use receipt::read_header;
pub(super) use snapshot::prepare_snapshot;

pub(super) fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
pub(super) fn relation(schema: &str, table: &str) -> String {
    format!("{}.{}", quote(schema), quote(table))
}
pub(super) fn options(
    config: &Value,
    endpoint: &LargeTransferEndpoint,
) -> Result<PgConnectOptions> {
    let config: SavedConnection = serde_json::from_value(config.clone())?;
    let url = connection_url_with_capabilities(
        "postgres",
        &config,
        &database_capabilities_for_driver("postgres")?,
        false,
    )?;
    let mut options = PgConnectOptions::from_str(&url)?.disable_statement_logging();
    if let Some(database) = endpoint.database.as_deref().filter(|v| !v.is_empty()) {
        options = options.database(database);
    }
    Ok(options)
}
pub(super) async fn connect_config(
    config: &Value,
    endpoint: &LargeTransferEndpoint,
    read_only: bool,
) -> Result<PgConnection> {
    let mut connection = tokio::time::timeout(
        Duration::from_secs(5),
        PgConnection::connect_with(&options(config, endpoint)?),
    )
    .await??;
    session::capture(&mut connection).await?;
    session::normalize(&mut connection).await?;
    if read_only {
        sqlx::query("SET default_transaction_read_only=on")
            .execute(&mut connection)
            .await?;
    }
    Ok(connection)
}
pub(super) async fn connect_original(
    store: &JobStore,
    job: &StoredJob,
    read_only: bool,
) -> Result<PgConnection> {
    let plan = job.postgres()?;
    let value = store.unseal_target(
        &job.summary.id,
        &job.request.project_id,
        &plan.target_connection,
    )?;
    ensure!(
        store.authenticate("target-config", &value)? == job.target_binding,
        "migration target configuration authentication failed"
    );
    let mut connection = connect_config(&value, &job.request.target, read_only).await?;
    let oid: i64 = sqlx::query_scalar(
        "SELECT oid::bigint FROM pg_catalog.pg_database WHERE datname=current_database()",
    )
    .fetch_one(&mut connection)
    .await?;
    ensure!(
        oid == plan.database_oid,
        "migration target database identity changed"
    );
    Ok(connection)
}
async fn connect_original_unprepared(store: &JobStore, job: &StoredJob) -> Result<PgConnection> {
    let value = store.unseal_target(
        &job.summary.id,
        &job.request.project_id,
        &job.postgres()?.target_connection,
    )?;
    ensure!(
        store.authenticate("target-config", &value)? == job.target_binding,
        "migration target configuration authentication failed"
    );
    connect_config(&value, &job.request.target, false).await
}
pub(super) fn table(job: &StoredJob, name: &str) -> String {
    relation(&job.request.target.schema, name)
}
