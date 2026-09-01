use crate::core::config::{RemoteSqliteSshConfig, SqliteWorkerPlacement, SshTunnelConfig};
use crate::core::driver::{DatabaseDriver, LocalDatabaseBackupControl, LocalDatabaseFileReceipt};
use crate::core::protocol::{
    ColumnDef, ColumnInfo, ConstraintInfo, IndexInfo, ParameterizedStatement, QueryParameter,
    QueryResult, TableInfo, DEFAULT_QUERY_RESULT_ROW_LIMIT,
};
use crate::core::sqlite_worker_artifact::{ResolvedSqliteWorker, SqliteWorkerArtifactRegistry};
use crate::core::ssh::SshSession;
use crate::core::statement::{
    execution_mode, execution_statement_kind, split_sql_statements, QueryExecutionMode,
    StatementScanDialect,
};
use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use oxide_sqlite_worker::{
    MetadataRequest, WorkerErrorCode, WorkerOperation, WorkerParameter, WorkerRequest,
    WorkerResponse, WorkerResponseBody, SQLITE_WORKER_PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{ConnectOptions, Connection};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, WriteHalf};
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use uuid::Uuid;

const WORKER_START_TIMEOUT: Duration = Duration::from_secs(30);
const WORKER_REQUEST_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const WORKER_MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const REMOTE_WORKER_DIRECTORY: &str = ".cache/oxide/sqlite-worker";

type WorkerStream = russh::ChannelStream<russh::client::Msg>;
type WorkerWriter = WriteHalf<WorkerStream>;
type PendingResponse = oneshot::Sender<Result<WorkerResponseBody, String>>;

pub async fn detect_remote_sqlite_platform(config: &SshTunnelConfig) -> Result<String> {
    if !config.enabled {
        bail!("Remote SQLite requires an enabled SSH connection");
    }
    if !config.strict_host_key_checking {
        bail!("Remote SQLite requires strict SSH host-key verification");
    }
    let session = SshSession::connect(config).await?;
    let platform = remote_platform(&session).await;
    session.shutdown().await;
    platform
}

pub struct RemoteSqliteDriver {
    client: Arc<SqliteWorkerClient>,
    sqlite_version: String,
    read_only: bool,
    transaction: Mutex<Option<String>>,
    operation_gate: Mutex<()>,
    file_operation: Mutex<()>,
}

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

    async fn run_statement(
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

    async fn run_script(&self, query_id: Option<&str>, sql: &str) -> Result<Vec<QueryResult>> {
        let statements = split_sql_statements(sql, StatementScanDialect::Postgres);
        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            results.push(self.run_statement(query_id, statement, &[]).await?);
        }
        Ok(results)
    }

    async fn require_no_transaction(&self, operation: &str) -> Result<()> {
        if self.transaction.lock().await.is_some() {
            bail!("Finish or roll back the active SQLite transaction before {operation}");
        }
        Ok(())
    }

    async fn metadata(&self, request: MetadataRequest) -> Result<WorkerTable> {
        worker_table(
            self.client
                .roundtrip(WorkerOperation::Metadata { request })
                .await?,
        )
    }

    async fn backup_controlled(
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
            let temporary = super::sqlite::temporary_backup_path(destination)?;
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
            super::sqlite::sync_file(&temporary).await?;
            if control.is_cancelled() {
                let _ = std::fs::remove_file(&temporary);
                bail!("SQLite backup was cancelled");
            }
            super::sqlite::replace_backup_file(&temporary, destination)?;
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

#[async_trait]
impl DatabaseDriver for RemoteSqliteDriver {
    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        None
    }

    async fn server_version(&self) -> Option<String> {
        Some(self.sqlite_version.clone())
    }

    async fn connect(&mut self) -> Result<()> {
        self.ping().await
    }

    async fn disconnect(&self) -> Result<()> {
        self.client.shutdown().await;
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        expect_ok(self.client.roundtrip(WorkerOperation::Ping).await?)
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("running a query outside its transaction session")
            .await?;
        self.run_script(None, sql).await
    }

    async fn query_tracked(&self, query_id: Option<&str>, sql: &str) -> Result<Vec<QueryResult>> {
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("running a query outside its transaction session")
            .await?;
        self.run_script(query_id, sql).await
    }

    async fn execute_parameterized(&self, sql: &str, params: &[QueryParameter]) -> Result<u64> {
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("executing a mutation outside its transaction session")
            .await?;
        Ok(self
            .run_statement(None, sql, params)
            .await?
            .rows_affected
            .unwrap_or(0))
    }

    async fn query_parameterized(
        &self,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("running a query outside its transaction session")
            .await?;
        Ok(vec![self.run_statement(None, sql, params).await?])
    }

    async fn execute_parameterized_batch(
        &self,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("a parameterized batch").await?;
        self.run_statement(None, "BEGIN", &[]).await?;
        let mut affected = Vec::with_capacity(statements.len());
        for statement in statements {
            match self
                .run_statement(None, &statement.sql, &statement.params)
                .await
            {
                Ok(result) => affected.push(result.rows_affected.unwrap_or(0)),
                Err(error) => {
                    let _ = self.run_statement(None, "ROLLBACK", &[]).await;
                    return Err(error);
                }
            }
        }
        self.run_statement(None, "COMMIT", &[]).await?;
        Ok(affected)
    }

    async fn begin_transaction(&self, session_id: &str, _schema: Option<&str>) -> Result<()> {
        let _operation = self.operation_gate.lock().await;
        let mut active = self.transaction.lock().await;
        if active.is_some() {
            bail!("Remote SQLite already has an active transaction");
        }
        self.run_statement(None, "BEGIN", &[]).await?;
        *active = Some(session_id.to_string());
        Ok(())
    }

    async fn query_transaction(&self, session_id: &str, sql: &str) -> Result<Vec<QueryResult>> {
        let _operation = self.operation_gate.lock().await;
        require_transaction(&self.transaction, session_id).await?;
        self.run_script(None, sql).await
    }

    async fn query_transaction_tracked(
        &self,
        query_id: Option<&str>,
        session_id: &str,
        sql: &str,
    ) -> Result<Vec<QueryResult>> {
        let _operation = self.operation_gate.lock().await;
        require_transaction(&self.transaction, session_id).await?;
        self.run_script(query_id, sql).await
    }

    async fn execute_parameterized_transaction(
        &self,
        session_id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let _operation = self.operation_gate.lock().await;
        require_transaction(&self.transaction, session_id).await?;
        let mut affected = Vec::with_capacity(statements.len());
        for statement in statements {
            affected.push(
                self.run_statement(None, &statement.sql, &statement.params)
                    .await?
                    .rows_affected
                    .unwrap_or(0),
            );
        }
        Ok(affected)
    }

    async fn cancel_query(&self, query_id: &str) -> Result<bool> {
        self.client.cancel_tracked(query_id).await
    }

    async fn commit_transaction(&self, session_id: &str) -> Result<()> {
        let _operation = self.operation_gate.lock().await;
        require_transaction(&self.transaction, session_id).await?;
        self.run_statement(None, "COMMIT", &[]).await?;
        *self.transaction.lock().await = None;
        Ok(())
    }

    async fn rollback_transaction(&self, session_id: &str) -> Result<()> {
        let _operation = self.operation_gate.lock().await;
        require_transaction(&self.transaction, session_id).await?;
        self.run_statement(None, "ROLLBACK", &[]).await?;
        *self.transaction.lock().await = None;
        Ok(())
    }

    async fn backup_local_database(&self, destination: &Path) -> Result<LocalDatabaseFileReceipt> {
        self.backup_controlled(destination, &LocalDatabaseBackupControl::default())
            .await
    }

    async fn backup_local_database_controlled(
        &self,
        destination: &Path,
        control: &LocalDatabaseBackupControl,
    ) -> Result<LocalDatabaseFileReceipt> {
        self.backup_controlled(destination, control).await
    }

    async fn restore_local_database(&self, source: &Path) -> Result<LocalDatabaseFileReceipt> {
        if self.read_only {
            bail!("Restore is unavailable through a read-only remote SQLite connection");
        }
        let _file_operation = self.file_operation.lock().await;
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("restore").await?;
        let integrity = verify_local_sqlite_file(source).await?;
        let byte_len = std::fs::metadata(source)?.len();
        let remote_path = self.client.remote_transfer_path("restore").await?;
        let result = async {
            let uploaded = self
                .client
                .session
                .upload_local_file_atomic(source, &remote_path)
                .await?;
            if uploaded != byte_len {
                bail!("Uploaded SQLite restore size changed in transit");
            }
            let response = self
                .client
                .roundtrip(WorkerOperation::Restore {
                    source: remote_path.clone(),
                })
                .await?;
            let (restored_bytes, restored_integrity) = expect_file(response)?;
            if restored_bytes != byte_len || !restored_integrity.eq_ignore_ascii_case(&integrity) {
                bail!("Remote SQLite restore receipt does not match the reviewed source");
            }
            Ok(LocalDatabaseFileReceipt {
                byte_len,
                integrity_check: integrity,
            })
        }
        .await;
        if let Err(error) = self.client.session.remove_file(&remote_path).await {
            tracing::warn!(
                remote_path,
                "Failed to remove remote SQLite restore transfer: {error}"
            );
        }
        result
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        let table = self.metadata(MetadataRequest::Schemas).await?;
        let name = table.column_index("name").unwrap_or(1);
        let mut schemas = table
            .rows
            .iter()
            .filter_map(|row| string_at(row, name))
            .collect::<Vec<_>>();
        schemas.sort();
        schemas.dedup();
        Ok(schemas)
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let schema = normalized_schema(schema);
        let table = self
            .metadata(MetadataRequest::Tables {
                schema: schema.to_string(),
            })
            .await?;
        let name = table.column_index("name").unwrap_or(0);
        let kind = table.column_index("type").unwrap_or(1);
        Ok(table
            .rows
            .iter()
            .filter_map(|row| {
                Some(TableInfo {
                    name: string_at(row, name)?,
                    schema: Some(schema.to_string()),
                    table_type: string_at(row, kind),
                    comment: None,
                })
            })
            .collect())
    }

    async fn get_columns(&self, schema: &str, table_name: &str) -> Result<Vec<ColumnInfo>> {
        let schema = normalized_schema(schema);
        let table = self
            .metadata(MetadataRequest::Columns {
                schema: schema.into(),
                table: table_name.into(),
            })
            .await?;
        let indexes = self.get_indexes(schema, table_name).await?;
        let name = table.required_column("name")?;
        let data_type = table.required_column("type")?;
        let not_null = table.required_column("notnull")?;
        let default = table.required_column("dflt_value")?;
        let primary = table.required_column("pk")?;
        let hidden = table.column_index("hidden");
        Ok(table
            .rows
            .iter()
            .filter_map(|row| {
                let name = string_at(row, name)?;
                let hidden = hidden.and_then(|index| integer_at(row, index)).unwrap_or(0);
                Some(ColumnInfo {
                    name: name.clone(),
                    data_type: string_at(row, data_type).unwrap_or_else(|| "TEXT".into()),
                    is_nullable: integer_at(row, not_null).unwrap_or(0) == 0,
                    is_primary_key: integer_at(row, primary).unwrap_or(0) > 0,
                    is_unique: indexes
                        .iter()
                        .any(|index| index.is_unique && index.columns.contains(&name)),
                    is_indexed: indexes.iter().any(|index| index.columns.contains(&name)),
                    is_auto_increment: false,
                    identity_generation: None,
                    is_generated: Some(hidden >= 2),
                    is_hidden: Some(hidden == 1),
                    default_value: string_at(row, default),
                    comment: None,
                })
            })
            .collect())
    }

    async fn get_generated_columns(&self, schema: &str, table_name: &str) -> Result<Vec<String>> {
        Ok(self
            .get_columns(schema, table_name)
            .await?
            .into_iter()
            .filter(|column| column.is_generated == Some(true))
            .map(|column| column.name)
            .collect())
    }

    async fn get_indexes(&self, schema: &str, table_name: &str) -> Result<Vec<IndexInfo>> {
        let schema = normalized_schema(schema);
        let list = self
            .metadata(MetadataRequest::Indexes {
                schema: schema.into(),
                table: table_name.into(),
            })
            .await?;
        let name_index = list.required_column("name")?;
        let unique_index = list.required_column("unique")?;
        let origin_index = list.column_index("origin");
        let mut indexes = Vec::new();
        for row in &list.rows {
            let Some(name) = string_at(row, name_index) else {
                continue;
            };
            let columns = self
                .run_statement(
                    None,
                    &format!(
                        "PRAGMA {}.index_info({})",
                        quote_identifier(schema)?,
                        quote_identifier(&name)?
                    ),
                    &[],
                )
                .await?;
            let name_column = columns
                .columns
                .iter()
                .position(|column| column.name == "name")
                .unwrap_or(2);
            indexes.push(IndexInfo {
                name,
                columns: columns
                    .rows
                    .iter()
                    .filter_map(|row| string_at(row, name_column))
                    .collect(),
                is_unique: integer_at(row, unique_index).unwrap_or(0) != 0,
                is_primary: origin_index
                    .and_then(|index| string_at(row, index))
                    .is_some_and(|origin| origin == "pk"),
                filter: None,
                index_type: Some("BTREE".into()),
                included_columns: None,
                definition: None,
                comment: None,
                key_is_expression: Vec::new(),
            });
        }
        Ok(indexes)
    }

    async fn get_constraints(&self, schema: &str, table_name: &str) -> Result<Vec<ConstraintInfo>> {
        let schema = normalized_schema(schema);
        let table = self
            .metadata(MetadataRequest::ForeignKeys {
                schema: schema.into(),
                table: table_name.into(),
            })
            .await?;
        let id = table.required_column("id")?;
        let sequence = table.required_column("seq")?;
        let referenced_table = table.required_column("table")?;
        let from = table.required_column("from")?;
        let to = table.required_column("to")?;
        let on_update = table.column_index("on_update");
        let on_delete = table.column_index("on_delete");
        let mut grouped = BTreeMap::<i64, Vec<&Vec<serde_json::Value>>>::new();
        for row in &table.rows {
            grouped
                .entry(integer_at(row, id).unwrap_or_default())
                .or_default()
                .push(row);
        }
        Ok(grouped
            .into_iter()
            .map(|(id, mut rows)| {
                rows.sort_by_key(|row| integer_at(row, sequence).unwrap_or_default());
                ConstraintInfo {
                    name: format!("fk_{table_name}_{id}"),
                    constraint_type: "FOREIGN KEY".into(),
                    columns: rows.iter().filter_map(|row| string_at(row, from)).collect(),
                    referenced_schema: Some(schema.into()),
                    referenced_table: rows
                        .first()
                        .and_then(|row| string_at(row, referenced_table)),
                    referenced_columns: rows.iter().filter_map(|row| string_at(row, to)).collect(),
                    definition: None,
                    on_update: rows
                        .first()
                        .and_then(|row| on_update.and_then(|index| string_at(row, index))),
                    on_delete: rows
                        .first()
                        .and_then(|row| on_delete.and_then(|index| string_at(row, index))),
                }
            })
            .collect())
    }
}

struct SqliteWorkerClient {
    writer: Mutex<Option<WorkerWriter>>,
    pending: Arc<Mutex<HashMap<u64, PendingResponse>>>,
    tracked: Mutex<HashMap<String, u64>>,
    next_id: AtomicU64,
    reader_task: Mutex<Option<JoinHandle<()>>>,
    session: Arc<SshSession>,
    remote_home: String,
    remove_worker_path: Option<String>,
}

impl SqliteWorkerClient {
    fn start(
        stream: WorkerStream,
        session: Arc<SshSession>,
        remote_home: String,
        remove_worker_path: Option<String>,
    ) -> Self {
        let (reader, writer) = tokio::io::split(stream);
        let pending = Arc::new(Mutex::new(HashMap::<u64, PendingResponse>::new()));
        let reader_pending = Arc::clone(&pending);
        let reader_task = tokio::spawn(async move {
            let mut reader = BufReader::new(reader);
            loop {
                let mut line = Vec::new();
                let read = match reader.read_until(b'\n', &mut line).await {
                    Ok(read) => read,
                    Err(error) => {
                        fail_pending(
                            &reader_pending,
                            format!("SQLite worker response failed: {error}"),
                        )
                        .await;
                        return;
                    }
                };
                if read == 0 {
                    fail_pending(
                        &reader_pending,
                        "SQLite worker closed its SSH channel".into(),
                    )
                    .await;
                    return;
                }
                if line.len() > WORKER_MAX_RESPONSE_BYTES {
                    fail_pending(
                        &reader_pending,
                        "SQLite worker response exceeded 16 MiB".into(),
                    )
                    .await;
                    return;
                }
                let response: WorkerResponse = match serde_json::from_slice(&line) {
                    Ok(response) => response,
                    Err(error) => {
                        fail_pending(
                            &reader_pending,
                            format!("SQLite worker returned invalid JSON: {error}"),
                        )
                        .await;
                        return;
                    }
                };
                let result = if response.protocol_version == SQLITE_WORKER_PROTOCOL_VERSION {
                    Ok(response.body)
                } else {
                    Err(format!(
                        "SQLite worker protocol {} is incompatible",
                        response.protocol_version
                    ))
                };
                if let Some(sender) = reader_pending.lock().await.remove(&response.id) {
                    let _ = sender.send(result);
                }
            }
        });
        Self {
            writer: Mutex::new(Some(writer)),
            pending,
            tracked: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            reader_task: Mutex::new(Some(reader_task)),
            session,
            remote_home,
            remove_worker_path,
        }
    }

    fn next_request_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    async fn roundtrip(&self, operation: WorkerOperation) -> Result<WorkerResponseBody> {
        self.roundtrip_id(self.next_request_id(), operation).await
    }

    async fn roundtrip_tracked(
        &self,
        query_id: Option<&str>,
        operation: WorkerOperation,
    ) -> Result<WorkerResponseBody> {
        let id = self.next_request_id();
        if let Some(query_id) = query_id {
            self.tracked.lock().await.insert(query_id.to_string(), id);
        }
        let result = self.roundtrip_id(id, operation).await;
        if let Some(query_id) = query_id {
            let mut tracked = self.tracked.lock().await;
            if tracked.get(query_id) == Some(&id) {
                tracked.remove(query_id);
            }
        }
        result
    }

    async fn roundtrip_id(
        &self,
        id: u64,
        operation: WorkerOperation,
    ) -> Result<WorkerResponseBody> {
        let request = WorkerRequest::new(id, operation);
        let mut bytes =
            serde_json::to_vec(&request).context("Cannot encode SQLite worker request")?;
        bytes.push(b'\n');
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);
        let write_result = async {
            let mut writer = self.writer.lock().await;
            let writer = writer
                .as_mut()
                .ok_or_else(|| anyhow!("SQLite worker is closed"))?;
            writer
                .write_all(&bytes)
                .await
                .context("Failed to write SQLite worker request")?;
            writer
                .flush()
                .await
                .context("Failed to flush SQLite worker request")
        }
        .await;
        if let Err(error) = write_result {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        match timeout(WORKER_REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(Ok(body))) => worker_body_result(body),
            Ok(Ok(Err(error))) => Err(anyhow!(error)),
            Ok(Err(_)) => Err(anyhow!("SQLite worker response channel closed")),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(anyhow!("SQLite worker request timed out"))
            }
        }
    }

    async fn roundtrip_controlled(
        &self,
        id: u64,
        operation: WorkerOperation,
        control: &LocalDatabaseBackupControl,
    ) -> Result<WorkerResponseBody> {
        let request = self.roundtrip_id(id, operation);
        tokio::pin!(request);
        let mut interrupt_sent = false;
        loop {
            tokio::select! {
                result = &mut request => return result,
                _ = tokio::time::sleep(Duration::from_millis(50)) => {
                    if control.is_cancelled() && !interrupt_sent {
                        interrupt_sent = true;
                        let _ = self.interrupt_request(id).await;
                    }
                }
            }
        }
    }

    async fn cancel_tracked(&self, query_id: &str) -> Result<bool> {
        let Some(request_id) = self.tracked.lock().await.get(query_id).copied() else {
            return Ok(false);
        };
        self.interrupt_request(request_id).await
    }

    async fn interrupt_request(&self, request_id: u64) -> Result<bool> {
        match self
            .roundtrip(WorkerOperation::Interrupt { request_id })
            .await?
        {
            WorkerResponseBody::Interrupt {
                request_id: returned,
                accepted,
            } if returned == request_id => Ok(accepted),
            _ => bail!("SQLite worker returned an invalid interrupt receipt"),
        }
    }

    async fn remote_transfer_path(&self, kind: &str) -> Result<String> {
        if !matches!(kind, "backup" | "restore") {
            bail!("Invalid SQLite transfer kind");
        }
        Ok(format!(
            "{}/{REMOTE_WORKER_DIRECTORY}/transfers/{kind}-{}.db",
            self.remote_home.trim_end_matches('/'),
            Uuid::new_v4()
        ))
    }

    async fn shutdown(&self) {
        let _ = timeout(WORKER_START_TIMEOUT, self.roundtrip(WorkerOperation::Close)).await;
        if let Some(mut writer) = self.writer.lock().await.take() {
            let _ = writer.shutdown().await;
        }
        if let Some(task) = self.reader_task.lock().await.take() {
            task.abort();
        }
        fail_pending(&self.pending, "SQLite worker was closed".into()).await;
        if let Some(path) = self.remove_worker_path.as_deref() {
            if let Err(error) = self.session.remove_file(path).await {
                tracing::warn!(
                    worker_path = path,
                    "Failed to remove session SQLite worker: {error}"
                );
            }
        }
        self.session.shutdown().await;
    }
}

async fn fail_pending(pending: &Arc<Mutex<HashMap<u64, PendingResponse>>>, message: String) {
    let pending = std::mem::take(&mut *pending.lock().await);
    for (_, sender) in pending {
        let _ = sender.send(Err(message.clone()));
    }
}

async fn prepare_and_start_worker(
    session: Arc<SshSession>,
    config: &RemoteSqliteSshConfig,
    worker: &ResolvedSqliteWorker,
    worker_path: &str,
    remove_worker_on_close: bool,
) -> Result<SqliteWorkerClient> {
    if config.placement != SqliteWorkerPlacement::Preplaced {
        if !worker_upload_is_approved(config, worker) {
            bail!(
                "Preparing and approving this exact signed SQLite worker is required before upload"
            );
        }
        session
            .upload_atomic_executable(worker_path, &worker.bytes)
            .await?;
    } else {
        session.ensure_regular_file(worker_path).await?;
    }
    let remote_digest = session.sha256(worker_path).await?;
    if remote_digest != worker.digest {
        bail!("Remote SQLite worker digest does not match the signed local artifact");
    }
    let home = remote_home(session.as_ref()).await?;
    let stream = session.start_stdio(worker_path).await?;
    Ok(SqliteWorkerClient::start(
        stream,
        session,
        home,
        remove_worker_on_close.then(|| worker_path.to_string()),
    ))
}

fn worker_upload_is_approved(
    config: &RemoteSqliteSshConfig,
    worker: &ResolvedSqliteWorker,
) -> bool {
    config.allow_worker_upload
        && config
            .approved_worker_digest
            .as_deref()
            .is_some_and(|digest| digest.eq_ignore_ascii_case(&worker.digest))
}

async fn remote_home(session: &SshSession) -> Result<String> {
    let home = session.capture_fixed("printf %s \"$HOME\"").await?;
    let home = home.trim();
    validate_remote_absolute_path(home)?;
    Ok(home.trim_end_matches('/').to_string())
}

async fn remote_platform(session: &SshSession) -> Result<String> {
    let operating_system = session.capture_fixed("uname -s").await?;
    if !operating_system.trim().eq_ignore_ascii_case("linux") {
        bail!(
            "Remote SQLite supports Linux hosts only; found {}",
            operating_system.trim()
        );
    }
    match session.capture_fixed("uname -m").await?.trim() {
        "x86_64" | "amd64" => Ok("linux-x64".into()),
        "aarch64" | "arm64" => Ok("linux-aarch64".into()),
        architecture => {
            bail!("Remote SQLite supports Linux amd64/arm64 only; found {architecture}")
        }
    }
}

fn worker_remote_path(
    connection_id: &str,
    config: &RemoteSqliteSshConfig,
    worker: &ResolvedSqliteWorker,
    home: &str,
) -> Result<(String, bool)> {
    let default_root = format!("{home}/{REMOTE_WORKER_DIRECTORY}");
    let path = match config.placement {
        SqliteWorkerPlacement::Session => {
            let id = format!("{:x}", Sha256::digest(connection_id.as_bytes()));
            format!("{default_root}/session-{}-{}", &id[..16], worker.digest)
        }
        SqliteWorkerPlacement::Persist => config
            .worker_path
            .as_deref()
            .map(|path| expand_remote_home(path, home))
            .transpose()?
            .unwrap_or_else(|| format!("{default_root}/{}-{}", worker.version, worker.digest)),
        SqliteWorkerPlacement::Preplaced => expand_remote_home(
            config
                .worker_path
                .as_deref()
                .filter(|path| !path.trim().is_empty())
                .ok_or_else(|| anyhow!("Preplaced SQLite worker path is required"))?,
            home,
        )?,
    };
    validate_remote_absolute_path(&path)?;
    Ok((path, config.placement == SqliteWorkerPlacement::Session))
}

fn remote_sqlite_path(database_url: &str) -> Result<String> {
    let value = database_url.trim();
    let path = value
        .strip_prefix("sqlite://")
        .or_else(|| value.strip_prefix("sqlite:"))
        .unwrap_or(value);
    if path == ":memory:" || path.is_empty() || path.contains('?') || path.contains('#') {
        bail!("Remote SQLite requires one absolute file path without URL parameters");
    }
    Ok(path.to_string())
}

fn expand_remote_home(path: &str, home: &str) -> Result<String> {
    if path == "~" {
        return Ok(home.to_string());
    }
    if let Some(relative) = path.strip_prefix("~/") {
        return Ok(format!("{}/{}", home.trim_end_matches('/'), relative));
    }
    Ok(path.to_string())
}

fn validate_remote_absolute_path(path: &str) -> Result<()> {
    if !path.starts_with('/')
        || path.contains('\0')
        || path.contains('\n')
        || path.contains('\r')
        || path.split('/').any(|component| component == "..")
    {
        bail!("Remote SQLite path must be an absolute normalized Linux path");
    }
    Ok(())
}

fn validate_worker_capabilities(capabilities: &[String]) -> Result<()> {
    for capability in [
        "parameterized-query",
        "parameterized-execute",
        "metadata",
        "online-backup",
        "restore",
        "interrupt",
    ] {
        if !capabilities.iter().any(|value| value == capability) {
            bail!("SQLite worker is missing required capability {capability}");
        }
    }
    Ok(())
}

fn worker_parameters(parameters: &[QueryParameter]) -> Vec<WorkerParameter> {
    parameters
        .iter()
        .map(|parameter| WorkerParameter {
            value: parameter.value.clone(),
            data_type: parameter.data_type.clone(),
        })
        .collect()
}

fn worker_body_result(body: WorkerResponseBody) -> Result<WorkerResponseBody> {
    match body {
        WorkerResponseBody::Error { code, message } => {
            Err(anyhow!(worker_error_message(code, &message)))
        }
        body => Ok(body),
    }
}

fn worker_error_message(code: WorkerErrorCode, message: &str) -> String {
    format!("sqlite_worker_{code:?}: {message}")
}

fn expect_ok(body: WorkerResponseBody) -> Result<()> {
    match body {
        WorkerResponseBody::Ok => Ok(()),
        _ => bail!("SQLite worker returned an unexpected response"),
    }
}

fn expect_file(body: WorkerResponseBody) -> Result<(u64, String)> {
    match body {
        WorkerResponseBody::File {
            byte_len,
            integrity_check,
        } if byte_len > 0 && integrity_check.eq_ignore_ascii_case("ok") => {
            Ok((byte_len, integrity_check))
        }
        _ => bail!("SQLite worker returned an invalid file receipt"),
    }
}

fn worker_query_result(sql: &str, body: WorkerResponseBody) -> Result<QueryResult> {
    let WorkerResponseBody::Result {
        columns,
        mut rows,
        rows_affected,
        truncated,
    } = body
    else {
        bail!("SQLite worker returned an unexpected query response");
    };
    if columns.is_empty() {
        return Ok(QueryResult::execution(
            execution_statement_kind(sql).as_str(),
            rows_affected,
        ));
    }
    let sentinel_truncated = rows.len() > DEFAULT_QUERY_RESULT_ROW_LIMIT;
    if sentinel_truncated {
        rows.truncate(DEFAULT_QUERY_RESULT_ROW_LIMIT);
    }
    Ok(QueryResult {
        columns: columns
            .into_iter()
            .map(|column| ColumnDef {
                name: column.name,
                data_type: column.data_type,
            })
            .collect(),
        rows,
        truncated: truncated || sentinel_truncated,
        row_limit: (truncated || sentinel_truncated).then_some(DEFAULT_QUERY_RESULT_ROW_LIMIT),
        rows_affected: None,
        statement_type: None,
        message: None,
        response_meta: None,
    })
}

struct WorkerTable {
    columns: Vec<ColumnDef>,
    rows: Vec<Vec<serde_json::Value>>,
}

impl WorkerTable {
    fn column_index(&self, name: &str) -> Option<usize> {
        self.columns
            .iter()
            .position(|column| column.name.eq_ignore_ascii_case(name))
    }

    fn required_column(&self, name: &str) -> Result<usize> {
        self.column_index(name)
            .ok_or_else(|| anyhow!("SQLite metadata omitted {name}"))
    }
}

fn worker_table(body: WorkerResponseBody) -> Result<WorkerTable> {
    match body {
        WorkerResponseBody::Result { columns, rows, .. } => Ok(WorkerTable {
            columns: columns
                .into_iter()
                .map(|column| ColumnDef {
                    name: column.name,
                    data_type: column.data_type,
                })
                .collect(),
            rows,
        }),
        _ => bail!("SQLite worker returned an unexpected metadata response"),
    }
}

fn string_at(row: &[serde_json::Value], index: usize) -> Option<String> {
    match row.get(index)? {
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        serde_json::Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn integer_at(row: &[serde_json::Value], index: usize) -> Option<i64> {
    row.get(index)?
        .as_i64()
        .or_else(|| row.get(index)?.as_str()?.parse().ok())
}

fn normalized_schema(schema: &str) -> &str {
    if schema.trim().is_empty() {
        "main"
    } else {
        schema.trim()
    }
}

fn quote_identifier(value: &str) -> Result<String> {
    if value.trim().is_empty()
        || value.contains('\0')
        || value.contains('\n')
        || value.contains('\r')
    {
        bail!("Invalid SQLite identifier");
    }
    Ok(format!("\"{}\"", value.replace('"', "\"\"")))
}

async fn require_transaction(transaction: &Mutex<Option<String>>, session_id: &str) -> Result<()> {
    if transaction.lock().await.as_deref() == Some(session_id) {
        Ok(())
    } else {
        bail!("Remote SQLite transaction session is not active")
    }
}

async fn verify_local_sqlite_file(path: &Path) -> Result<String> {
    if !path.is_file() {
        bail!("SQLite file is missing");
    }
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.to_string_lossy()))?
        .read_only(true)
        .disable_statement_logging();
    let mut connection = SqliteConnection::connect_with(&options).await?;
    let integrity: String = sqlx::query_scalar("PRAGMA main.integrity_check")
        .fetch_one(&mut connection)
        .await?;
    connection.close().await?;
    if !integrity.eq_ignore_ascii_case("ok") {
        bail!("SQLite file failed its integrity check");
    }
    Ok(integrity)
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxide_sqlite_worker::WorkerColumn;

    #[test]
    fn remote_paths_and_worker_placement_are_host_owned() {
        assert_eq!(
            remote_sqlite_path("sqlite:///srv/data/app.db").unwrap(),
            "/srv/data/app.db"
        );
        assert_eq!(
            expand_remote_home("~/data/app.db", "/home/oxide").unwrap(),
            "/home/oxide/data/app.db"
        );
        assert!(validate_remote_absolute_path("../../etc/passwd").is_err());
        assert!(remote_sqlite_path("sqlite::memory:").is_err());
        let worker = ResolvedSqliteWorker {
            bytes: vec![1],
            digest: "a".repeat(64),
            version: "1.0.0".into(),
            platform: "linux-x64".into(),
        };
        let config = RemoteSqliteSshConfig {
            placement: SqliteWorkerPlacement::Session,
            worker_path: None,
            allow_worker_upload: true,
            approved_worker_digest: Some(worker.digest.clone()),
        };
        assert!(worker_upload_is_approved(&config, &worker));
        assert!(!worker_upload_is_approved(
            &RemoteSqliteSshConfig {
                approved_worker_digest: Some("b".repeat(64)),
                ..config.clone()
            },
            &worker,
        ));
        assert!(!worker_upload_is_approved(
            &RemoteSqliteSshConfig {
                allow_worker_upload: false,
                ..config.clone()
            },
            &worker,
        ));
        let (path, remove) =
            worker_remote_path("connection/unsafe", &config, &worker, "/home/oxide").unwrap();
        assert!(path.starts_with("/home/oxide/.cache/oxide/sqlite-worker/session-"));
        assert!(!path.contains("connection/unsafe"));
        assert!(remove);
    }

    #[test]
    fn query_results_keep_row_bounds_and_execution_receipts() {
        let rows = (0..=DEFAULT_QUERY_RESULT_ROW_LIMIT)
            .map(|value| vec![serde_json::json!(value)])
            .collect();
        let result = worker_query_result(
            "SELECT id FROM items",
            WorkerResponseBody::Result {
                columns: vec![WorkerColumn {
                    name: "id".into(),
                    data_type: "INTEGER".into(),
                }],
                rows,
                rows_affected: 0,
                truncated: false,
            },
        )
        .unwrap();
        assert_eq!(result.rows.len(), DEFAULT_QUERY_RESULT_ROW_LIMIT);
        assert!(result.truncated);
        let execution = worker_query_result(
            "UPDATE items SET id = id",
            WorkerResponseBody::Result {
                columns: vec![],
                rows: vec![],
                rows_affected: 4,
                truncated: false,
            },
        )
        .unwrap();
        assert_eq!(execution.rows_affected, Some(4));
    }

    #[test]
    fn composite_foreign_key_rows_can_be_read_without_string_coercion() {
        let row = vec![serde_json::json!(7), serde_json::json!("parent")];
        assert_eq!(integer_at(&row, 0), Some(7));
        assert_eq!(string_at(&row, 1).as_deref(), Some("parent"));
    }
}
