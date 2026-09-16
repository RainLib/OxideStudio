use crate::core::config::{RemoteSqliteSshConfig, SqliteWorkerPlacement};
use crate::core::driver::LocalDatabaseBackupControl;
use crate::core::sqlite_worker_artifact::ResolvedSqliteWorker;
use crate::core::ssh::SshSession;
use anyhow::{anyhow, bail, Context, Result};
use oxide_sqlite_worker::{
    WorkerOperation, WorkerRequest, WorkerResponse, WorkerResponseBody,
    SQLITE_WORKER_PROTOCOL_VERSION,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;
use uuid::Uuid;

use super::models::{
    PendingResponse, SqliteWorkerClient, WorkerStream, REMOTE_WORKER_DIRECTORY,
    WORKER_MAX_RESPONSE_BYTES, WORKER_REQUEST_TIMEOUT, WORKER_START_TIMEOUT,
};
use super::platform::{remote_home, worker_upload_is_approved};
use super::response::worker_body_result;

impl SqliteWorkerClient {
    pub(super) fn start(
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

    pub(super) fn next_request_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    pub(super) async fn roundtrip(&self, operation: WorkerOperation) -> Result<WorkerResponseBody> {
        self.roundtrip_id(self.next_request_id(), operation).await
    }

    pub(super) async fn roundtrip_tracked(
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

    pub(super) async fn roundtrip_id(
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

    pub(super) async fn roundtrip_controlled(
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

    pub(super) async fn cancel_tracked(&self, query_id: &str) -> Result<bool> {
        let Some(request_id) = self.tracked.lock().await.get(query_id).copied() else {
            return Ok(false);
        };
        self.interrupt_request(request_id).await
    }

    pub(super) async fn interrupt_request(&self, request_id: u64) -> Result<bool> {
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

    pub(super) async fn remote_transfer_path(&self, kind: &str) -> Result<String> {
        if !matches!(kind, "backup" | "restore") {
            bail!("Invalid SQLite transfer kind");
        }
        Ok(format!(
            "{}/{REMOTE_WORKER_DIRECTORY}/transfers/{kind}-{}.db",
            self.remote_home.trim_end_matches('/'),
            Uuid::new_v4()
        ))
    }

    pub(super) async fn shutdown(&self) {
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

pub(super) async fn fail_pending(
    pending: &Arc<Mutex<HashMap<u64, PendingResponse>>>,
    message: String,
) {
    let pending = std::mem::take(&mut *pending.lock().await);
    for (_, sender) in pending {
        let _ = sender.send(Err(message.clone()));
    }
}

pub(super) async fn prepare_and_start_worker(
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
