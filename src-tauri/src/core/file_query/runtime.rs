use super::*;
use crate::core::{
    driver_package::InstalledDriverPackage,
    protocol::{ColumnDef, QueryResult},
};
use oxide_driver_protocol::{
    DriverQueryContext, DriverRequest, DriverResponse, DriverResult, SecretConnectionConfig,
};

impl FileQuerySessions {
    pub(super) async fn connect(
        &self,
        entry: &Entry,
        file: &AuthorizedFile,
        package: &InstalledDriverPackage,
    ) -> Result<()> {
        if entry.closed.load(Ordering::Acquire) || entry.cancelled.load(Ordering::Acquire) {
            bail!("file-query preparation was cancelled");
        }
        let process = Arc::new(
            DatabaseDriverSidecar::spawn_file_query(
                package,
                &self.0.registry,
                env!("CARGO_PKG_VERSION"),
                &entry.workspace,
            )
            .await
            .map_err(anyhow::Error::msg)?,
        );
        *entry
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("file-query process state is unavailable"))? =
            Some(process.clone());
        if entry.closed.load(Ordering::Acquire) || entry.cancelled.load(Ordering::Acquire) {
            bail!("file-query preparation was cancelled");
        }
        validate_runtime(process.capabilities())?;
        let result = process
            .request(
                DriverRequest::Connect {
                    connection_id: entry.descriptor.id.clone(),
                    config: SecretConnectionConfig {
                        url: file
                            .path
                            .to_str()
                            .context("invalid file-query path")?
                            .into(),
                        options: [
                            ("readOnly".into(), "true".into()),
                            ("fileQueryFormat".into(), file.format.clone()),
                            ("fileQueryCsvHeader".into(), file.csv_header.as_str().into()),
                        ]
                        .into_iter()
                        .collect(),
                    },
                },
                OPEN_TIMEOUT,
            )
            .await
            .map_err(anyhow::Error::msg)?;
        if !matches!(result, DriverResult::Empty | DriverResult::Boolean(true)) {
            bail!("driver returned an invalid file-query connect response");
        }
        let version = process
            .request(
                DriverRequest::ServerVersion {
                    connection_id: entry.descriptor.id.clone(),
                },
                OPEN_TIMEOUT,
            )
            .await
            .map_err(anyhow::Error::msg)?;
        let DriverResult::ServerVersion(version) = version else {
            bail!("invalid file-query server version response");
        };
        crate::core::driver_package::validate_server_version_compatibility(
            package.manifest.server_version_range.as_deref(),
            version.as_deref(),
        )
        .map_err(anyhow::Error::msg)?;
        if entry.closed.load(Ordering::Acquire) || entry.cancelled.load(Ordering::Acquire) {
            bail!("file-query preparation was cancelled");
        }
        Ok(())
    }

    pub async fn query(
        &self,
        owner: &FileQueryOwner,
        id: &str,
        sql: &str,
    ) -> Result<Vec<QueryResult>> {
        self.query_with_deadline(owner, id, sql, QUERY_TIMEOUT)
            .await
    }

    pub(super) async fn query_with_deadline(
        &self,
        owner: &FileQueryOwner,
        id: &str,
        sql: &str,
        deadline: Duration,
    ) -> Result<Vec<QueryResult>> {
        if sql.len() > 64 * 1024 {
            bail!("file queries are limited to 64 KiB SQL");
        }
        let entry = self
            .find(owner, id)?
            .context("file-query session has ended; reopen the file")?;
        let operation = entry
            .operation
            .try_lock()
            .map_err(|_| anyhow::anyhow!("file-query session is already busy"))?;
        if entry.closed.load(Ordering::Acquire) {
            bail!("file-query session has ended; reopen the file");
        }
        entry.touched_at.store(now(), Ordering::Release);
        let process = entry
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("file-query process state is unavailable"))?
            .clone()
            .context("file-query session is not ready")?;
        let mut abandoned = AbandonedOperation::new(self.clone(), owner.clone(), id.into());
        let result = tokio::time::timeout(
            deadline,
            process.request_response(
                DriverRequest::Query {
                    connection_id: id.into(),
                    statement: sql.into(),
                    parameters: Vec::new(),
                    context: DriverQueryContext {
                        read_only: true,
                        ..Default::default()
                    },
                    query_id: None,
                },
                deadline,
            ),
        )
        .await;
        drop(operation);
        let database_error = matches!(&result, Ok(Ok(DriverResponse::Error(_))));
        let result = match result {
            Ok(Ok(DriverResponse::Ok(DriverResult::Query(results)))) => validate_results(results),
            Ok(Ok(DriverResponse::Error(error))) => {
                Err(anyhow::anyhow!("{}: {}", error.code, error.message))
            }
            Ok(Ok(_)) => Err(anyhow::anyhow!(
                "driver returned an invalid file-query response"
            )),
            Ok(Err(error)) => Err(anyhow::anyhow!("File-query session ended: {error}")),
            Err(_) => Err(anyhow::anyhow!(
                "file query timed out; its session was closed"
            )),
        };
        if result.is_err() && !database_error {
            self.close(owner, id).await?;
        }
        abandoned.armed = false;
        entry.touched_at.store(now(), Ordering::Release);
        result
    }
}

pub(super) fn validate_runtime(
    caps: &oxide_driver_protocol::DriverRuntimeCapabilities,
) -> Result<()> {
    if !caps.query
        || !caps.file_queries
        || !caps.host_managed_file_queries
        || !caps.read_only_enforcement
        || !caps.read_only_connections
    {
        bail!("selected driver runtime does not enforce Host-managed read-only file sessions");
    }
    Ok(())
}

fn validate_results(
    results: Vec<oxide_driver_protocol::DriverQueryResult>,
) -> Result<Vec<QueryResult>> {
    if results.len() != 1 {
        bail!("file-query driver must return exactly one read-only result");
    }
    let mut output = Vec::new();
    for result in results {
        if result.rows.len() > 1000
            || result.columns.len() > 256
            || result.rows_affected.is_some()
            || result
                .rows
                .iter()
                .any(|row| row.len() != result.columns.len())
            || serde_json::to_vec(&result)?.len() > 3 * 1024 * 1024
            || (result.truncated && result.row_limit != Some(1000))
        {
            bail!("file-query driver exceeded its read-only result contract");
        }
        output.push(QueryResult {
            columns: result
                .columns
                .into_iter()
                .map(|column| ColumnDef {
                    name: column.name,
                    data_type: column.data_type,
                })
                .collect(),
            rows: result.rows,
            truncated: result.truncated,
            row_limit: result.row_limit.map(|value| value as usize),
            rows_affected: None,
            statement_type: result.statement_type,
            message: result.message,
            response_meta: None,
        });
    }
    Ok(output)
}
