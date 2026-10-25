use super::{files, models::*, mysql, postgres, sqlite, store::JobStore};
use anyhow::{Context, Result};
use sqlx::{Connection, MySqlConnection, PgConnection, Row, SqliteConnection};
use std::path::Path;

pub(super) enum Target {
    Sqlite(SqliteConnection),
    Postgres {
        connection: PgConnection,
        snapshot: Option<SqliteConnection>,
    },
    MySql {
        connection: MySqlConnection,
        snapshot: Option<SqliteConnection>,
    },
}
impl Target {
    pub async fn open(store: &JobStore, job: &StoredJob, read_only: bool) -> Result<Self> {
        if job.mysql.is_some() {
            return Ok(Self::MySql {
                connection: mysql::connect_original(store, job, read_only).await?,
                snapshot: None,
            });
        }
        if job.postgres.is_some() {
            return Ok(Self::Postgres {
                connection: postgres::connect_original(store, job, read_only).await?,
                snapshot: None,
            });
        }
        files::require_identity(job.target_file()?)?;
        Ok(Self::Sqlite(
            sqlite::connect(&job.target_file()?.path, read_only).await?,
        ))
    }
    pub async fn read_header(
        &mut self,
        store: &JobStore,
        job: &StoredJob,
    ) -> Result<Option<Header>> {
        match self {
            Self::MySql { connection, .. } => mysql::read_header(connection, store, job).await,
            Self::Sqlite(c) => sqlite::read_header(c, store, job).await,
            Self::Postgres { connection, .. } => {
                postgres::read_header(connection, store, job).await
            }
        }
    }
    pub async fn initialize(
        &mut self,
        store: &JobStore,
        job: &StoredJob,
        path: &Path,
    ) -> Result<()> {
        match self {
            Self::MySql {
                connection,
                snapshot,
            } => {
                mysql::initialize(connection, store, job).await?;
                *snapshot = Some(sqlite::connect(path, true).await?);
            }
            Self::Sqlite(c) => {
                sqlite::initialize(c, store, job, path).await?;
            }
            Self::Postgres {
                connection,
                snapshot,
            } => {
                postgres::initialize(connection, store, job).await?;
                *snapshot = Some(sqlite::connect(path, true).await?);
            }
        }
        Ok(())
    }
    pub async fn reconcile(
        &mut self,
        store: &JobStore,
        job: &StoredJob,
    ) -> Result<Option<BatchReceipt>> {
        match self {
            Self::MySql { connection, .. } => mysql::reconcile(connection, store, job).await,
            Self::Sqlite(c) => sqlite::reconcile(c, store, job).await,
            Self::Postgres { connection, .. } => postgres::reconcile(connection, store, job).await,
        }
    }
    pub async fn copy_batch(
        &mut self,
        store: &JobStore,
        job: &StoredJob,
        previous: Option<&BatchReceipt>,
    ) -> Result<Option<BatchReceipt>> {
        match self {
            Self::MySql {
                connection,
                snapshot,
            } => {
                mysql::copy_batch(
                    connection,
                    snapshot.as_mut().context("missing MySQL source snapshot")?,
                    store,
                    job,
                    previous,
                )
                .await
            }
            Self::Sqlite(c) => sqlite::copy_batch(c, store, job, previous).await,
            Self::Postgres {
                connection,
                snapshot,
            } => {
                postgres::copy_batch(
                    connection,
                    snapshot
                        .as_mut()
                        .context("missing PostgreSQL source snapshot")?,
                    store,
                    job,
                    previous,
                )
                .await
            }
        }
    }
    pub async fn publish(&mut self, store: &JobStore, job: &StoredJob) -> Result<Header> {
        match self {
            Self::MySql { connection, .. } => mysql::publish(connection, store, job).await,
            Self::Sqlite(c) => sqlite::publish(c, store, job).await,
            Self::Postgres { connection, .. } => postgres::publish(connection, store, job).await,
        }
    }
    pub async fn remove_staging(&mut self, store: &JobStore, job: &StoredJob) -> Result<()> {
        match self {
            Self::MySql {
                connection,
                snapshot,
            } => {
                mysql::remove_staging(connection, store, job).await?;
                if let Some(c) = snapshot.take() {
                    c.close().await?;
                }
            }
            Self::Sqlite(c) => {
                files::require_identity(job.target_file()?)?;
                sqlite::remove_staging(c, store, job).await?;
                let attached = sqlx::query("PRAGMA database_list")
                    .fetch_all(&mut *c)
                    .await?;
                if attached.iter().any(|r| {
                    r.try_get::<String, _>("name")
                        .is_ok_and(|n| n == "oxide_snapshot")
                }) {
                    sqlx::query("DETACH DATABASE oxide_snapshot")
                        .execute(c)
                        .await?;
                }
            }
            Self::Postgres {
                connection,
                snapshot,
            } => {
                postgres::remove_staging(connection, store, job).await?;
                if let Some(c) = snapshot.take() {
                    c.close().await?;
                }
            }
        }
        Ok(())
    }
    pub async fn close(self) -> Result<()> {
        match self {
            Self::MySql {
                connection,
                snapshot,
            } => {
                if let Some(c) = snapshot {
                    c.close().await?;
                }
                connection.close().await?;
            }
            Self::Sqlite(c) => c.close().await?,
            Self::Postgres {
                connection,
                snapshot,
            } => {
                if let Some(c) = snapshot {
                    c.close().await?;
                }
                connection.close().await?;
            }
        }
        Ok(())
    }
}
