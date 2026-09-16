use crate::core::config::SshTunnelConfig;
use crate::core::driver::{LocalDatabaseBackupControl, LocalDatabaseFileReceipt};
use crate::core::protocol::{QueryParameter, QueryResult, DEFAULT_QUERY_RESULT_ROW_LIMIT};
use crate::core::sqlite_worker_artifact::SqliteWorkerArtifactRegistry;
use crate::core::ssh::SshSession;
use crate::core::statement::{
    execution_mode, split_sql_statements, QueryExecutionMode, StatementScanDialect,
};
use anyhow::{anyhow, bail, Context, Result};
use oxide_sqlite_worker::{MetadataRequest, WorkerOperation, WorkerResponseBody};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::timeout;

use super::metadata::worker_table;
use super::models::{RemoteSqliteDriver, WorkerTable, WORKER_START_TIMEOUT};
use super::platform::{
    expand_remote_home, remote_home, remote_platform, remote_sqlite_path,
    validate_remote_absolute_path, validate_worker_capabilities, worker_remote_path,
};
use super::response::{
    expect_file, expect_ok, verify_local_sqlite_file, worker_parameters, worker_query_result,
};
use super::transport::prepare_and_start_worker;

impl RemoteSqliteDriver {
    pub async fn open(
        registry: &SqliteWorkerArtifactRegistry,
        connection_id: &str,
        database_url: &str,
        ssh_config: &SshTunnelConfig,
        read_only: bool,
    ) -> Result<Self> {
        if !ssh_config.enabled {
            bail!("Remote SQLite requires an enabled SSH connection");
        }
        if !ssh_config.strict_host_key_checking {
            bail!("Remote SQLite requires strict SSH host-key verification");
        }
        let remote = ssh_config.remote_sqlite.as_ref().ok_or_else(|| {
            anyhow!("Remote SQLite worker settings are required when SQLite uses SSH")
        })?;
        let session = Arc::new(SshSession::connect(ssh_config).await?);
        let setup = async {
            let home = remote_home(session.as_ref()).await?;
            let database_path = expand_remote_home(&remote_sqlite_path(database_url)?, &home)?;
            validate_remote_absolute_path(&database_path)?;
            session
                .ensure_regular_file(&database_path)
                .await
                .with_context(|| {
                    format!(
                        "Remote SQLite file is not available on {}",
                        session.identity()
                    )
                })?;
            let platform = remote_platform(session.as_ref()).await?;
            let worker = registry.resolve(&platform).map_err(anyhow::Error::msg)?;
            let (worker_path, remove_worker_on_close) =
                worker_remote_path(connection_id, remote, &worker, &home)?;
            Ok::<_, anyhow::Error>((database_path, worker, worker_path, remove_worker_on_close))
        }
        .await;
        let (database_path, worker, worker_path, remove_worker_on_close) = match setup {
            Ok(setup) => setup,
            Err(error) => {
                session.shutdown().await;
                return Err(error);
            }
        };
        let start = prepare_and_start_worker(
            Arc::clone(&session),
            remote,
            &worker,
            &worker_path,
            remove_worker_on_close,
        )
        .await;
        let client = match start {
            Ok(client) => Arc::new(client),
            Err(error) => {
                if remove_worker_on_close {
                    if let Err(cleanup_error) = session.remove_file(&worker_path).await {
                        tracing::warn!(
                            worker_path,
                            "Failed to clean up SQLite worker after startup error: {cleanup_error}"
                        );
                    }
                }
                session.shutdown().await;
                return Err(error);
            }
        };

        let initialize = async {
            let handshake = timeout(
                WORKER_START_TIMEOUT,
                client.roundtrip(WorkerOperation::Handshake),
            )
            .await
            .context("SQLite worker handshake timed out")??;
            let sqlite_version = match handshake {
                WorkerResponseBody::Handshake {
                    worker_version,
                    sqlite_version,
                    capabilities,
                } => {
                    if worker_version != worker.version && worker.version != "development" {
                        bail!("SQLite worker version does not match its signed package");
                    }
                    validate_worker_capabilities(&capabilities)?;
                    sqlite_version
                }
                _ => bail!("SQLite worker returned an invalid handshake response"),
            };
            expect_ok(
                timeout(
                    WORKER_START_TIMEOUT,
                    client.roundtrip(WorkerOperation::Open {
                        path: database_path,
                        read_only,
                    }),
                )
                .await
                .context("SQLite worker database open timed out")??,
            )?;
            Ok::<_, anyhow::Error>(sqlite_version)
        }
        .await;
        let sqlite_version = match initialize {
            Ok(version) => version,
            Err(error) => {
                client.shutdown().await;
                return Err(error);
            }
        };

        Ok(Self {
            client,
            sqlite_version,
            read_only,
            transaction: Mutex::new(None),
            operation_gate: Mutex::new(()),
            file_operation: Mutex::new(()),
        })
    }

    pub(super) async fn run_statement(
        &self,
        query_id: Option<&str>,
        sql: &str,
        parameters: &[QueryParameter],
    ) -> Result<QueryResult> {
        let parameters = worker_parameters(parameters);
        let operation = match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => WorkerOperation::Query {
                sql: sql.to_string(),
                parameters,
                max_rows: Some(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1),
            },
            QueryExecutionMode::AffectsRows => WorkerOperation::Execute {
                sql: sql.to_string(),
                parameters,
            },
        };
        let body = self.client.roundtrip_tracked(query_id, operation).await?;
        worker_query_result(sql, body)
    }

    pub(super) async fn run_execute_statement(
        &self,
        query_id: Option<&str>,
        sql: &str,
        parameters: &[QueryParameter],
    ) -> Result<QueryResult> {
        let body = self
            .client
            .roundtrip_tracked(
                query_id,
                WorkerOperation::Execute {
                    sql: sql.to_string(),
                    parameters: worker_parameters(parameters),
                },
            )
            .await?;
        worker_query_result(sql, body)
    }

    pub(super) async fn run_script(
        &self,
        query_id: Option<&str>,
        sql: &str,
    ) -> Result<Vec<QueryResult>> {
        let statements = split_sql_statements(sql, StatementScanDialect::Postgres);
        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            results.push(self.run_statement(query_id, statement, &[]).await?);
        }
        Ok(results)
    }

    pub(super) async fn require_no_transaction(&self, operation: &str) -> Result<()> {
        if self.transaction.lock().await.is_some() {
            bail!("Finish or roll back the active SQLite transaction before {operation}");
        }
        Ok(())
    }

    pub(super) async fn metadata(&self, request: MetadataRequest) -> Result<WorkerTable> {
        worker_table(
            self.client
                .roundtrip(WorkerOperation::Metadata { request })
                .await?,
        )
    }

    pub(super) async fn backup_controlled(
        &self,
        destination: &Path,
        control: &LocalDatabaseBackupControl,
    ) -> Result<LocalDatabaseFileReceipt> {
        if self.read_only {
            bail!("Backup is unavailable through a read-only remote SQLite connection");
        }
        let _file_operation = self.file_operation.lock().await;
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("backup").await?;
        self.backup_controlled_locked(destination, control).await
    }

    pub(super) async fn backup_controlled_locked(
        &self,
        destination: &Path,
        control: &LocalDatabaseBackupControl,
    ) -> Result<LocalDatabaseFileReceipt> {
        if control.is_cancelled() {
            bail!("SQLite backup was cancelled");
        }
        control.set_progress_percent(1);
        let remote_path = self.client.remote_transfer_path("backup").await?;
        let result = async {
            let request_id = self.client.next_request_id();
            let operation = WorkerOperation::Backup {
                destination: remote_path.clone(),
            };
            let response = self
                .client
                .roundtrip_controlled(request_id, operation, control)
                .await?;
            let (remote_bytes, remote_integrity) = expect_file(response)?;
            control.set_progress_percent(70);
            let temporary = super::super::sqlite::temporary_backup_path(destination)?;
            if temporary.exists() {
                std::fs::remove_file(&temporary)?;
            }
            let download =
                self.client
                    .session
                    .download_to_local_file(&remote_path, &temporary, remote_bytes);
            tokio::pin!(download);
            let downloaded = match loop {
                tokio::select! {
                    result = &mut download => break result,
                    _ = tokio::time::sleep(Duration::from_millis(100)) => {
                        if control.is_cancelled() {
                            break Err(anyhow!("SQLite backup was cancelled"));
                        }
                    }
                }
            } {
                Ok(downloaded) => downloaded,
                Err(error) => {
                    let _ = std::fs::remove_file(&temporary);
                    return Err(error);
                }
            };
            if downloaded != remote_bytes {
                let _ = std::fs::remove_file(&temporary);
                bail!("Downloaded SQLite backup size does not match the worker receipt");
            }
            control.set_progress_percent(90);
            let local_integrity = verify_local_sqlite_file(&temporary).await?;
            if !local_integrity.eq_ignore_ascii_case(&remote_integrity) {
                let _ = std::fs::remove_file(&temporary);
                bail!("Downloaded SQLite backup integrity receipt changed in transit");
            }
            super::super::sqlite::sync_file(&temporary).await?;
            if control.is_cancelled() {
                let _ = std::fs::remove_file(&temporary);
                bail!("SQLite backup was cancelled");
            }
            super::super::sqlite::replace_backup_file(&temporary, destination)?;
            control.set_progress_percent(100);
            Ok(LocalDatabaseFileReceipt {
                byte_len: downloaded,
                integrity_check: local_integrity,
            })
        }
        .await;
        if let Err(error) = self.client.session.remove_file(&remote_path).await {
            tracing::warn!(
                remote_path,
                "Failed to remove remote SQLite backup transfer: {error}"
            );
        }
        result
    }
}

pub(super) async fn require_transaction(
    transaction: &Mutex<Option<String>>,
    session_id: &str,
) -> Result<()> {
    if transaction.lock().await.as_deref() == Some(session_id) {
        Ok(())
    } else {
        bail!("Remote SQLite transaction session is not active")
    }
}
