use anyhow::{anyhow, Result};
use serde_json::Value;
use sqlx::{Pool, Sqlite};
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::sync::{OnceCell, RwLock};
use zeroize::Zeroizing;

pub(super) const RETENTION_MILLIS: i64 = 7 * 24 * 60 * 60 * 1_000;
pub(super) const AGENT_STORE_KEY_BYTES: usize = 32;
pub(super) const AGENT_STORE_KEY_FILE: &str = "agent-store-master-key-v2.secret";

#[derive(Clone)]
pub struct AgentStore {
    pub(super) db_path: PathBuf,
    pub(super) key_path: PathBuf,
    pub(super) backend: Arc<OnceCell<Arc<Backend>>>,
}

pub(super) enum Backend {
    Persistent(PersistentBackend),
    Session(Box<SessionBackend>),
}

pub(super) struct PersistentBackend {
    pub(super) pool: Pool<Sqlite>,
    pub(super) key: Zeroizing<[u8; 32]>,
}

pub(super) struct SessionBackend {
    pub(super) key: Zeroizing<[u8; 32]>,
    pub(super) records: RwLock<HashMap<RecordKey, EncryptedRecord>>,
    pub(super) graph_checkpoints: RwLock<HashMap<GraphCheckpointKey, SessionGraphCheckpoint>>,
    pub(super) graph_writes: RwLock<HashMap<GraphWriteKey, SessionGraphWrite>>,
}

#[derive(Debug, Clone)]
pub(crate) struct StoredGraphCheckpoint {
    pub checkpoint_thread_id: String,
    pub checkpoint_ns: String,
    pub checkpoint_id: String,
    pub parent_checkpoint_id: Option<String>,
    pub checkpoint: Value,
    pub metadata: Value,
    pub pending_writes: Vec<StoredGraphWrite>,
}

#[derive(Debug, Clone)]
pub(crate) struct StoredGraphWrite {
    pub task_id: String,
    pub index: i64,
    pub channel: String,
    pub value: Value,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub(super) struct GraphCheckpointKey {
    pub(super) project_id: String,
    pub(super) checkpoint_thread_id: String,
    pub(super) checkpoint_ns: String,
    pub(super) checkpoint_id: String,
}

#[derive(Clone)]
pub(super) struct SessionGraphCheckpoint {
    pub(super) parent_checkpoint_id: Option<String>,
    pub(super) record: EncryptedRecord,
    pub(super) created_at: i64,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub(super) struct GraphWriteKey {
    pub(super) checkpoint: GraphCheckpointKey,
    pub(super) task_id: String,
    pub(super) index: i64,
}

#[derive(Clone)]
pub(super) struct SessionGraphWrite {
    pub(super) record: EncryptedRecord,
    pub(super) created_at: i64,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub(super) struct RecordKey {
    pub(super) kind: RecordKind,
    pub(super) project_id: String,
    pub(super) record_id: String,
    pub(super) version: u64,
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
pub(super) enum RecordKind {
    Thread,
    Journal,
    Checkpoint,
    Artifact,
}

impl RecordKind {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Thread => "thread",
            Self::Journal => "journal",
            Self::Checkpoint => "checkpoint",
            Self::Artifact => "artifact",
        }
    }
}

#[derive(Clone)]
pub(super) struct EncryptedRecord {
    pub(super) ciphertext: Vec<u8>,
    pub(super) nonce: [u8; 12],
    pub(super) expires_at: i64,
}

impl Backend {
    pub(super) fn key(&self) -> &[u8; 32] {
        match self {
            Self::Persistent(backend) => &backend.key,
            Self::Session(backend) => &backend.key,
        }
    }
}

impl RecordKey {
    pub(super) fn thread(project_id: &str, thread_id: &str) -> Self {
        Self {
            kind: RecordKind::Thread,
            project_id: project_id.to_string(),
            record_id: thread_id.to_string(),
            version: 0,
        }
    }

    pub(super) fn checkpoint(project_id: &str, thread_id: &str, version: u64) -> Self {
        Self {
            kind: RecordKind::Checkpoint,
            project_id: project_id.to_string(),
            record_id: thread_id.to_string(),
            version,
        }
    }

    pub(super) fn journal(project_id: &str, turn_id: &str) -> Self {
        Self {
            kind: RecordKind::Journal,
            project_id: project_id.to_string(),
            record_id: format!("journal:{turn_id}"),
            version: 0,
        }
    }

    pub(super) fn artifact(project_id: &str, artifact_id: &str) -> Self {
        Self {
            kind: RecordKind::Artifact,
            project_id: project_id.to_string(),
            record_id: artifact_id.to_string(),
            version: 0,
        }
    }

    pub(super) fn aad(&self) -> Vec<u8> {
        format!(
            "oxide-agent:v1:{}:{}:{}:{}",
            self.kind.label(),
            self.project_id,
            self.record_id,
            self.version
        )
        .into_bytes()
    }
}

impl GraphCheckpointKey {
    pub(super) fn new(
        project_id: &str,
        checkpoint_thread_id: &str,
        checkpoint_ns: &str,
        checkpoint_id: &str,
    ) -> Result<Self> {
        validate_graph_scope(project_id, checkpoint_thread_id, checkpoint_ns)?;
        validate_graph_scope_value("checkpoint id", checkpoint_id, false)?;
        Ok(Self {
            project_id: project_id.to_string(),
            checkpoint_thread_id: checkpoint_thread_id.to_string(),
            checkpoint_ns: checkpoint_ns.to_string(),
            checkpoint_id: checkpoint_id.to_string(),
        })
    }

    pub(super) fn aad(&self) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!([
            "oxide-agent:v1:graph-checkpoint",
            self.project_id,
            self.checkpoint_thread_id,
            self.checkpoint_ns,
            self.checkpoint_id
        ]))
        .expect("serializing graph checkpoint AAD cannot fail")
    }
}

impl GraphWriteKey {
    pub(super) fn new(checkpoint: GraphCheckpointKey, write: &StoredGraphWrite) -> Self {
        Self {
            checkpoint,
            task_id: write.task_id.clone(),
            index: write.index,
        }
    }

    pub(super) fn aad(&self) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!([
            "oxide-agent:v1:graph-write",
            self.checkpoint.project_id,
            self.checkpoint.checkpoint_thread_id,
            self.checkpoint.checkpoint_ns,
            self.checkpoint.checkpoint_id,
            self.task_id,
            self.index
        ]))
        .expect("serializing graph write AAD cannot fail")
    }
}

pub(super) fn validate_storage_key(key: &RecordKey) -> Result<()> {
    for (label, value) in [
        ("project id", key.project_id.as_str()),
        ("record id", key.record_id.as_str()),
    ] {
        validate_scope_value(label, value)?;
    }
    if key.kind == RecordKind::Checkpoint && key.version == 0 {
        return Err(anyhow!("checkpoint version must be positive"));
    }
    Ok(())
}

pub(super) fn validate_scope_value(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > 240 {
        Err(anyhow!("agent {label} must contain 1 to 240 characters"))
    } else {
        Ok(())
    }
}

pub(super) fn validate_graph_scope(
    project_id: &str,
    checkpoint_thread_id: &str,
    checkpoint_ns: &str,
) -> Result<()> {
    validate_graph_scope_value("project id", project_id, false)?;
    validate_graph_scope_value("checkpoint thread id", checkpoint_thread_id, false)?;
    validate_graph_scope_value("checkpoint namespace", checkpoint_ns, true)
}

pub(super) fn validate_graph_scope_value(
    label: &str,
    value: &str,
    allow_empty: bool,
) -> Result<()> {
    if (!allow_empty && value.trim().is_empty()) || value.chars().count() > 512 {
        Err(anyhow!(
            "agent {label} must contain at most 512 characters and satisfy its empty-value policy"
        ))
    } else {
        Ok(())
    }
}

pub(super) fn validate_graph_write(write: &StoredGraphWrite) -> Result<()> {
    validate_graph_scope_value("graph task id", &write.task_id, false)?;
    validate_graph_scope_value("graph write channel", &write.channel, false)
}
