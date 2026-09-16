use crate::core::ssh::SshSession;
use anyhow::Result;
use oxide_sqlite_worker::WorkerResponseBody;
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::WriteHalf;
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;

pub(super) const WORKER_START_TIMEOUT: Duration = Duration::from_secs(30);
pub(super) const WORKER_REQUEST_TIMEOUT: Duration = Duration::from_secs(30 * 60);
pub(super) const WORKER_MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
pub(super) const REMOTE_WORKER_DIRECTORY: &str = ".cache/oxide/sqlite-worker";

pub(super) type WorkerStream = russh::ChannelStream<russh::client::Msg>;
pub(super) type WorkerWriter = WriteHalf<WorkerStream>;
pub(super) type PendingResponse = oneshot::Sender<Result<WorkerResponseBody, String>>;

pub struct RemoteSqliteDriver {
    pub(super) client: Arc<SqliteWorkerClient>,
    pub(super) sqlite_version: String,
    pub(super) read_only: bool,
    pub(super) transaction: Mutex<Option<String>>,
    pub(super) operation_gate: Mutex<()>,
    pub(super) file_operation: Mutex<()>,
}

pub(super) struct SqliteWorkerClient {
    pub(super) writer: Mutex<Option<WorkerWriter>>,
    pub(super) pending: Arc<Mutex<HashMap<u64, PendingResponse>>>,
    pub(super) tracked: Mutex<HashMap<String, u64>>,
    pub(super) next_id: AtomicU64,
    pub(super) reader_task: Mutex<Option<JoinHandle<()>>>,
    pub(super) session: Arc<SshSession>,
    pub(super) remote_home: String,
    pub(super) remove_worker_path: Option<String>,
}

pub(super) struct WorkerTable {
    pub(super) columns: Vec<crate::core::protocol::ColumnDef>,
    pub(super) rows: Vec<Vec<serde_json::Value>>,
}
