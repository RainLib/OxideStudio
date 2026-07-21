use crate::core::private_file::create_private_file;
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, Context, Result};
use rand::{rngs::OsRng, RngCore};
use serde_json::Value;
use sqlx::{
    sqlite::{SqlitePoolOptions, SqliteRow},
    Pool, QueryBuilder, Row, Sqlite,
};
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tauri::{AppHandle, Manager};
use tokio::sync::{OnceCell, RwLock};
use zeroize::{Zeroize, Zeroizing};

const RETENTION_MILLIS: i64 = 7 * 24 * 60 * 60 * 1_000;
const AGENT_STORE_KEY_BYTES: usize = 32;
const AGENT_STORE_KEY_FILE: &str = "agent-store-master-key-v2.secret";

#[derive(Clone)]
pub struct AgentStore {
    db_path: PathBuf,
    key_path: PathBuf,
    backend: Arc<OnceCell<Arc<Backend>>>,
}

enum Backend {
    Persistent(PersistentBackend),
    Session(Box<SessionBackend>),
}

struct PersistentBackend {
    pool: Pool<Sqlite>,
    key: Zeroizing<[u8; 32]>,
}

struct SessionBackend {
    key: Zeroizing<[u8; 32]>,
    records: RwLock<HashMap<RecordKey, EncryptedRecord>>,
    graph_checkpoints: RwLock<HashMap<GraphCheckpointKey, SessionGraphCheckpoint>>,
    graph_writes: RwLock<HashMap<GraphWriteKey, SessionGraphWrite>>,
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
struct GraphCheckpointKey {
    project_id: String,
    checkpoint_thread_id: String,
    checkpoint_ns: String,
    checkpoint_id: String,
}

#[derive(Clone)]
struct SessionGraphCheckpoint {
    parent_checkpoint_id: Option<String>,
    record: EncryptedRecord,
    created_at: i64,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct GraphWriteKey {
    checkpoint: GraphCheckpointKey,
    task_id: String,
    index: i64,
}

#[derive(Clone)]
struct SessionGraphWrite {
    record: EncryptedRecord,
    created_at: i64,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct RecordKey {
    kind: RecordKind,
    project_id: String,
    record_id: String,
    version: u64,
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
enum RecordKind {
    Thread,
    Checkpoint,
    Artifact,
}

impl RecordKind {
    fn label(self) -> &'static str {
        match self {
            Self::Thread => "thread",
            Self::Checkpoint => "checkpoint",
            Self::Artifact => "artifact",
        }
    }
}

#[derive(Clone)]
struct EncryptedRecord {
    ciphertext: Vec<u8>,
    nonce: [u8; 12],
    expires_at: i64,
}

impl AgentStore {
    /// This constructor performs no filesystem or database work.
    pub fn new(app: &AppHandle) -> Self {
        let config_dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("oxide-studio"));
        Self {
            db_path: config_dir.join("agent-state-v2.db"),
            key_path: config_dir.join("credentials").join(AGENT_STORE_KEY_FILE),
            backend: Arc::new(OnceCell::new()),
        }
    }

    pub async fn storage_mode(&self) -> Result<&'static str> {
        Ok(match self.backend().await?.as_ref() {
            Backend::Persistent(_) => "encrypted-persistent",
            Backend::Session(_) => "encrypted-session",
        })
    }

    /// Reports an already initialized backend without touching disk.
    pub fn initialized_storage_mode(&self) -> Option<&'static str> {
        self.backend.get().map(|backend| match backend.as_ref() {
            Backend::Persistent(_) => "encrypted-persistent",
            Backend::Session(_) => "encrypted-session",
        })
    }

    pub async fn save_thread(
        &self,
        project_id: &str,
        thread_id: &str,
        value: &Value,
    ) -> Result<()> {
        self.put(RecordKey::thread(project_id, thread_id), value)
            .await
    }

    pub async fn load_thread(&self, project_id: &str, thread_id: &str) -> Result<Option<Value>> {
        self.get(RecordKey::thread(project_id, thread_id)).await
    }

    pub async fn save_checkpoint(
        &self,
        project_id: &str,
        thread_id: &str,
        checkpoint_version: u64,
        value: &Value,
    ) -> Result<()> {
        self.put(
            RecordKey::checkpoint(project_id, thread_id, checkpoint_version),
            value,
        )
        .await
    }

    pub async fn load_checkpoint(
        &self,
        project_id: &str,
        thread_id: &str,
        checkpoint_version: u64,
    ) -> Result<Option<Value>> {
        self.get(RecordKey::checkpoint(
            project_id,
            thread_id,
            checkpoint_version,
        ))
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn save_graph_checkpoint(
        &self,
        project_id: &str,
        checkpoint_thread_id: &str,
        checkpoint_ns: &str,
        checkpoint_id: &str,
        parent_checkpoint_id: Option<&str>,
        checkpoint: &Value,
        metadata: &Value,
    ) -> Result<()> {
        let key = GraphCheckpointKey::new(
            project_id,
            checkpoint_thread_id,
            checkpoint_ns,
            checkpoint_id,
        )?;
        if let Some(parent) = parent_checkpoint_id {
            validate_graph_scope_value("parent checkpoint id", parent, false)?;
        }
        let backend = self.backend().await?;
        let expires_at = now_millis().saturating_add(RETENTION_MILLIS);
        let record = encrypt_json(
            backend.key(),
            &key.aad(),
            &serde_json::json!({"checkpoint": checkpoint, "metadata": metadata}),
            expires_at,
        )?;
        let created_at = now_millis();
        match backend.as_ref() {
            Backend::Session(session) => {
                session.graph_checkpoints.write().await.insert(
                    key,
                    SessionGraphCheckpoint {
                        parent_checkpoint_id: parent_checkpoint_id.map(ToString::to_string),
                        record,
                        created_at,
                    },
                );
            }
            Backend::Persistent(persistent) => {
                sqlx::query(
                    r#"INSERT INTO agent_graph_checkpoints
                       (project_id, checkpoint_thread_id, checkpoint_ns, checkpoint_id,
                        parent_checkpoint_id, ciphertext, nonce, created_at, expires_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(project_id, checkpoint_thread_id, checkpoint_ns, checkpoint_id)
                       DO UPDATE SET parent_checkpoint_id=excluded.parent_checkpoint_id,
                         ciphertext=excluded.ciphertext, nonce=excluded.nonce,
                         created_at=excluded.created_at, expires_at=excluded.expires_at"#,
                )
                .bind(project_id)
                .bind(checkpoint_thread_id)
                .bind(checkpoint_ns)
                .bind(checkpoint_id)
                .bind(parent_checkpoint_id)
                .bind(&record.ciphertext)
                .bind(record.nonce.as_slice())
                .bind(created_at)
                .bind(record.expires_at)
                .execute(&persistent.pool)
                .await?;
            }
        }
        Ok(())
    }

    pub(crate) async fn load_graph_checkpoint(
        &self,
        project_id: &str,
        checkpoint_thread_id: &str,
        checkpoint_ns: &str,
        checkpoint_id: Option<&str>,
    ) -> Result<Option<StoredGraphCheckpoint>> {
        validate_graph_scope(project_id, checkpoint_thread_id, checkpoint_ns)?;
        if let Some(id) = checkpoint_id {
            validate_graph_scope_value("checkpoint id", id, false)?;
        }
        let backend = self.backend().await?;
        match backend.as_ref() {
            Backend::Session(session) => {
                let now = now_millis();
                let checkpoints = session.graph_checkpoints.read().await;
                let selected = checkpoints
                    .iter()
                    .filter(|(key, value)| {
                        key.project_id == project_id
                            && key.checkpoint_thread_id == checkpoint_thread_id
                            && key.checkpoint_ns == checkpoint_ns
                            && checkpoint_id.is_none_or(|id| key.checkpoint_id == id)
                            && value.record.expires_at > now
                    })
                    .max_by(|(left_key, left), (right_key, right)| {
                        left.created_at
                            .cmp(&right.created_at)
                            .then_with(|| left_key.checkpoint_id.cmp(&right_key.checkpoint_id))
                    })
                    .map(|(key, value)| (key.clone(), value.clone()));
                drop(checkpoints);
                let Some((key, value)) = selected else {
                    return Ok(None);
                };
                self.decode_session_graph_checkpoint(session, backend.key(), key, value)
                    .await
                    .map(Some)
            }
            Backend::Persistent(persistent) => {
                load_persistent_graph_checkpoint(
                    &persistent.pool,
                    backend.key(),
                    project_id,
                    checkpoint_thread_id,
                    checkpoint_ns,
                    checkpoint_id,
                )
                .await
            }
        }
    }

    pub(crate) async fn list_graph_checkpoints(
        &self,
        project_id: &str,
        checkpoint_thread_id: &str,
        checkpoint_ns: &str,
        checkpoint_id: Option<&str>,
        before_checkpoint_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<StoredGraphCheckpoint>> {
        validate_graph_scope(project_id, checkpoint_thread_id, checkpoint_ns)?;
        for (label, value) in [
            ("checkpoint id", checkpoint_id),
            ("before checkpoint id", before_checkpoint_id),
        ] {
            if let Some(value) = value {
                validate_graph_scope_value(label, value, false)?;
            }
        }
        let limit = limit.clamp(1, 1_000);
        let backend = self.backend().await?;
        match backend.as_ref() {
            Backend::Session(session) => {
                let now = now_millis();
                let mut selected = session
                    .graph_checkpoints
                    .read()
                    .await
                    .iter()
                    .filter(|(key, value)| {
                        key.project_id == project_id
                            && key.checkpoint_thread_id == checkpoint_thread_id
                            && key.checkpoint_ns == checkpoint_ns
                            && checkpoint_id.is_none_or(|id| key.checkpoint_id == id)
                            && before_checkpoint_id
                                .is_none_or(|before| key.checkpoint_id.as_str() < before)
                            && value.record.expires_at > now
                    })
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect::<Vec<_>>();
                selected.sort_by(|(left_key, left), (right_key, right)| {
                    right
                        .created_at
                        .cmp(&left.created_at)
                        .then_with(|| right_key.checkpoint_id.cmp(&left_key.checkpoint_id))
                });
                selected.truncate(limit);
                let mut records = Vec::with_capacity(selected.len());
                for (key, value) in selected {
                    records.push(
                        self.decode_session_graph_checkpoint(session, backend.key(), key, value)
                            .await?,
                    );
                }
                Ok(records)
            }
            Backend::Persistent(persistent) => {
                list_persistent_graph_checkpoints(
                    &persistent.pool,
                    backend.key(),
                    project_id,
                    checkpoint_thread_id,
                    checkpoint_ns,
                    checkpoint_id,
                    before_checkpoint_id,
                    limit,
                )
                .await
            }
        }
    }

    pub(crate) async fn save_graph_writes(
        &self,
        project_id: &str,
        checkpoint_thread_id: &str,
        checkpoint_ns: &str,
        checkpoint_id: &str,
        writes: &[StoredGraphWrite],
    ) -> Result<()> {
        let checkpoint_key = GraphCheckpointKey::new(
            project_id,
            checkpoint_thread_id,
            checkpoint_ns,
            checkpoint_id,
        )?;
        if writes.len() > 2_048 {
            return Err(anyhow!("too many graph checkpoint writes"));
        }
        let backend = self.backend().await?;
        let expires_at = now_millis().saturating_add(RETENTION_MILLIS);
        match backend.as_ref() {
            Backend::Session(session) => {
                let mut stored = session.graph_writes.write().await;
                for write in writes {
                    validate_graph_write(write)?;
                    let key = GraphWriteKey::new(checkpoint_key.clone(), write);
                    if write.index >= 0 && stored.contains_key(&key) {
                        continue;
                    }
                    let record = encrypt_json(
                        backend.key(),
                        &key.aad(),
                        &serde_json::json!({"channel": write.channel, "value": write.value}),
                        expires_at,
                    )?;
                    stored.insert(
                        key,
                        SessionGraphWrite {
                            record,
                            created_at: now_millis(),
                        },
                    );
                }
            }
            Backend::Persistent(persistent) => {
                let mut transaction = persistent.pool.begin().await?;
                for write in writes {
                    validate_graph_write(write)?;
                    let key = GraphWriteKey::new(checkpoint_key.clone(), write);
                    let record = encrypt_json(
                        backend.key(),
                        &key.aad(),
                        &serde_json::json!({"channel": write.channel, "value": write.value}),
                        expires_at,
                    )?;
                    let conflict = if write.index >= 0 {
                        "DO NOTHING"
                    } else {
                        "DO UPDATE SET ciphertext=excluded.ciphertext, nonce=excluded.nonce, created_at=excluded.created_at, expires_at=excluded.expires_at"
                    };
                    let statement = format!(
                        "INSERT INTO agent_graph_writes
                         (project_id, checkpoint_thread_id, checkpoint_ns, checkpoint_id,
                          task_id, write_index, ciphertext, nonce, created_at, expires_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                         ON CONFLICT(project_id, checkpoint_thread_id, checkpoint_ns,
                                     checkpoint_id, task_id, write_index) {conflict}"
                    );
                    sqlx::query(&statement)
                        .bind(project_id)
                        .bind(checkpoint_thread_id)
                        .bind(checkpoint_ns)
                        .bind(checkpoint_id)
                        .bind(&write.task_id)
                        .bind(write.index)
                        .bind(&record.ciphertext)
                        .bind(record.nonce.as_slice())
                        .bind(now_millis())
                        .bind(record.expires_at)
                        .execute(&mut *transaction)
                        .await?;
                }
                transaction.commit().await?;
            }
        }
        Ok(())
    }

    pub(crate) async fn delete_graph_thread(
        &self,
        project_id: &str,
        checkpoint_thread_id: &str,
    ) -> Result<u64> {
        validate_graph_scope_value("project id", project_id, false)?;
        validate_graph_scope_value("checkpoint thread id", checkpoint_thread_id, false)?;
        let backend = self.backend().await?;
        match backend.as_ref() {
            Backend::Session(session) => {
                let mut checkpoints = session.graph_checkpoints.write().await;
                let checkpoint_count = checkpoints.len();
                checkpoints.retain(|key, _| {
                    key.project_id != project_id || key.checkpoint_thread_id != checkpoint_thread_id
                });
                let mut writes = session.graph_writes.write().await;
                let write_count = writes.len();
                writes.retain(|key, _| {
                    key.checkpoint.project_id != project_id
                        || key.checkpoint.checkpoint_thread_id != checkpoint_thread_id
                });
                Ok(checkpoint_count.saturating_sub(checkpoints.len()) as u64
                    + write_count.saturating_sub(writes.len()) as u64)
            }
            Backend::Persistent(persistent) => {
                let mut transaction = persistent.pool.begin().await?;
                let writes = sqlx::query(
                    "DELETE FROM agent_graph_writes WHERE project_id = ? AND checkpoint_thread_id = ?",
                )
                .bind(project_id)
                .bind(checkpoint_thread_id)
                .execute(&mut *transaction)
                .await?
                .rows_affected();
                let checkpoints = sqlx::query(
                    "DELETE FROM agent_graph_checkpoints WHERE project_id = ? AND checkpoint_thread_id = ?",
                )
                .bind(project_id)
                .bind(checkpoint_thread_id)
                .execute(&mut *transaction)
                .await?
                .rows_affected();
                transaction.commit().await?;
                Ok(writes.saturating_add(checkpoints))
            }
        }
    }

    pub async fn save_artifact(
        &self,
        project_id: &str,
        artifact_id: &str,
        value: &Value,
    ) -> Result<()> {
        self.put(RecordKey::artifact(project_id, artifact_id), value)
            .await
    }

    pub async fn load_artifact(
        &self,
        project_id: &str,
        artifact_id: &str,
    ) -> Result<Option<Value>> {
        self.get(RecordKey::artifact(project_id, artifact_id)).await
    }

    pub async fn cleanup_expired(&self) -> Result<()> {
        let backend = self.backend().await?;
        cleanup_backend(backend.as_ref(), now_millis()).await
    }

    pub async fn clear_project(&self, project_id: &str) -> Result<u64> {
        validate_scope_value("project id", project_id)?;
        let backend = self.backend().await?;
        match backend.as_ref() {
            Backend::Session(session) => {
                let mut records = session.records.write().await;
                let before = records.len();
                records.retain(|key, _| key.project_id != project_id);
                let mut cleared = before.saturating_sub(records.len()) as u64;
                let mut checkpoints = session.graph_checkpoints.write().await;
                let before = checkpoints.len();
                checkpoints.retain(|key, _| key.project_id != project_id);
                cleared = cleared.saturating_add(before.saturating_sub(checkpoints.len()) as u64);
                let mut writes = session.graph_writes.write().await;
                let before = writes.len();
                writes.retain(|key, _| key.checkpoint.project_id != project_id);
                Ok(cleared.saturating_add(before.saturating_sub(writes.len()) as u64))
            }
            Backend::Persistent(persistent) => {
                let mut transaction = persistent.pool.begin().await?;
                let mut cleared = 0u64;
                for statement in [
                    "DELETE FROM agent_threads WHERE project_id = ?",
                    "DELETE FROM agent_checkpoints WHERE project_id = ?",
                    "DELETE FROM agent_artifacts WHERE project_id = ?",
                    "DELETE FROM agent_graph_writes WHERE project_id = ?",
                    "DELETE FROM agent_graph_checkpoints WHERE project_id = ?",
                ] {
                    cleared = cleared.saturating_add(
                        sqlx::query(statement)
                            .bind(project_id)
                            .execute(&mut *transaction)
                            .await?
                            .rows_affected(),
                    );
                }
                transaction.commit().await?;
                Ok(cleared)
            }
        }
    }

    async fn decode_session_graph_checkpoint(
        &self,
        session: &SessionBackend,
        encryption_key: &[u8; 32],
        key: GraphCheckpointKey,
        stored: SessionGraphCheckpoint,
    ) -> Result<StoredGraphCheckpoint> {
        let payload = decrypt_json(encryption_key, &key.aad(), &stored.record)?;
        let checkpoint = payload
            .get("checkpoint")
            .cloned()
            .ok_or_else(|| anyhow!("graph checkpoint payload is incomplete"))?;
        let metadata = payload
            .get("metadata")
            .cloned()
            .ok_or_else(|| anyhow!("graph checkpoint metadata is missing"))?;
        let mut encrypted_writes = session
            .graph_writes
            .read()
            .await
            .iter()
            .filter(|(write_key, value)| {
                write_key.checkpoint == key && value.record.expires_at > now_millis()
            })
            .map(|(write_key, value)| (write_key.clone(), value.clone()))
            .collect::<Vec<_>>();
        encrypted_writes.sort_by(|(left_key, left), (right_key, right)| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left_key.task_id.cmp(&right_key.task_id))
                .then_with(|| left_key.index.cmp(&right_key.index))
        });
        let pending_writes = encrypted_writes
            .into_iter()
            .map(|(write_key, value)| decode_graph_write(encryption_key, &write_key, &value.record))
            .collect::<Result<Vec<_>>>()?;
        Ok(StoredGraphCheckpoint {
            checkpoint_thread_id: key.checkpoint_thread_id,
            checkpoint_ns: key.checkpoint_ns,
            checkpoint_id: key.checkpoint_id,
            parent_checkpoint_id: stored.parent_checkpoint_id,
            checkpoint,
            metadata,
            pending_writes,
        })
    }

    async fn backend(&self) -> Result<&Arc<Backend>> {
        self.backend
            .get_or_try_init(|| async {
                let key_path = self.key_path.clone();
                let key = tokio::task::spawn_blocking(move || resolve_persistent_key(&key_path))
                    .await
                    .context("agent key file task failed")?;
                let backend = match key {
                    Some(key) => {
                        let parent = self
                            .db_path
                            .parent()
                            .context("agent state database has no parent directory")?;
                        tokio::fs::create_dir_all(parent)
                            .await
                            .context("failed to create agent state directory")?;
                        let url = format!("sqlite://{}?mode=rwc", self.db_path.to_string_lossy());
                        let pool = SqlitePoolOptions::new()
                            .max_connections(3)
                            .connect(&url)
                            .await
                            .context("failed to open encrypted agent state database")?;
                        init_schema(&pool).await?;
                        Backend::Persistent(PersistentBackend {
                            pool,
                            key: Zeroizing::new(key),
                        })
                    }
                    None => Backend::Session(Box::new(SessionBackend {
                        key: Zeroizing::new(random_key()),
                        records: RwLock::new(HashMap::new()),
                        graph_checkpoints: RwLock::new(HashMap::new()),
                        graph_writes: RwLock::new(HashMap::new()),
                    })),
                };
                cleanup_backend(&backend, now_millis()).await?;
                Ok(Arc::new(backend))
            })
            .await
    }

    async fn put(&self, key: RecordKey, value: &Value) -> Result<()> {
        validate_storage_key(&key)?;
        let backend = self.backend().await?;
        let mut plaintext = serde_json::to_vec(value).context("failed to encode agent state")?;
        let expires_at = now_millis().saturating_add(RETENTION_MILLIS);
        let encrypted = encrypt(backend.key(), &key, &plaintext, expires_at)?;
        plaintext.zeroize();

        match backend.as_ref() {
            Backend::Session(session) => {
                let mut records = session.records.write().await;
                records.retain(|_, record| record.expires_at > now_millis());
                records.insert(key, encrypted);
            }
            Backend::Persistent(persistent) => {
                put_persistent(&persistent.pool, &key, &encrypted).await?;
                cleanup_persistent(&persistent.pool, now_millis()).await?;
            }
        }
        Ok(())
    }

    async fn get(&self, key: RecordKey) -> Result<Option<Value>> {
        validate_storage_key(&key)?;
        let backend = self.backend().await?;
        let encrypted = match backend.as_ref() {
            Backend::Session(session) => {
                let mut records = session.records.write().await;
                records.retain(|_, record| record.expires_at > now_millis());
                records.get(&key).cloned()
            }
            Backend::Persistent(persistent) => {
                get_persistent(&persistent.pool, &key, now_millis()).await?
            }
        };

        let Some(encrypted) = encrypted else {
            return Ok(None);
        };
        let mut plaintext = decrypt(backend.key(), &key, &encrypted)?;
        let value = serde_json::from_slice(&plaintext)
            .context("decrypted agent state is not valid JSON")?;
        plaintext.zeroize();
        Ok(Some(value))
    }

    #[cfg(test)]
    fn session_for_test(db_path: PathBuf, key: [u8; 32]) -> Self {
        let backend = OnceCell::new();
        let _ = backend.set(Arc::new(Backend::Session(Box::new(SessionBackend {
            key: Zeroizing::new(key),
            records: RwLock::new(HashMap::new()),
            graph_checkpoints: RwLock::new(HashMap::new()),
            graph_writes: RwLock::new(HashMap::new()),
        }))));
        Self {
            db_path,
            key_path: PathBuf::from("unused"),
            backend: Arc::new(backend),
        }
    }

    #[cfg(test)]
    async fn persistent_for_test(db_path: PathBuf, key: [u8; 32]) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let url = format!("sqlite://{}?mode=rwc", db_path.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await?;
        init_schema(&pool).await?;
        let backend = OnceCell::new();
        let _ = backend.set(Arc::new(Backend::Persistent(PersistentBackend {
            pool,
            key: Zeroizing::new(key),
        })));
        Ok(Self {
            db_path,
            key_path: PathBuf::from("unused"),
            backend: Arc::new(backend),
        })
    }
}

impl Backend {
    fn key(&self) -> &[u8; 32] {
        match self {
            Self::Persistent(backend) => &backend.key,
            Self::Session(backend) => &backend.key,
        }
    }
}

impl RecordKey {
    fn thread(project_id: &str, thread_id: &str) -> Self {
        Self {
            kind: RecordKind::Thread,
            project_id: project_id.to_string(),
            record_id: thread_id.to_string(),
            version: 0,
        }
    }

    fn checkpoint(project_id: &str, thread_id: &str, version: u64) -> Self {
        Self {
            kind: RecordKind::Checkpoint,
            project_id: project_id.to_string(),
            record_id: thread_id.to_string(),
            version,
        }
    }

    fn artifact(project_id: &str, artifact_id: &str) -> Self {
        Self {
            kind: RecordKind::Artifact,
            project_id: project_id.to_string(),
            record_id: artifact_id.to_string(),
            version: 0,
        }
    }

    fn aad(&self) -> Vec<u8> {
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
    fn new(
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

    fn aad(&self) -> Vec<u8> {
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
    fn new(checkpoint: GraphCheckpointKey, write: &StoredGraphWrite) -> Self {
        Self {
            checkpoint,
            task_id: write.task_id.clone(),
            index: write.index,
        }
    }

    fn aad(&self) -> Vec<u8> {
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

fn validate_storage_key(key: &RecordKey) -> Result<()> {
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

fn validate_scope_value(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > 240 {
        Err(anyhow!("agent {label} must contain 1 to 240 characters"))
    } else {
        Ok(())
    }
}

fn validate_graph_scope(
    project_id: &str,
    checkpoint_thread_id: &str,
    checkpoint_ns: &str,
) -> Result<()> {
    validate_graph_scope_value("project id", project_id, false)?;
    validate_graph_scope_value("checkpoint thread id", checkpoint_thread_id, false)?;
    validate_graph_scope_value("checkpoint namespace", checkpoint_ns, true)
}

fn validate_graph_scope_value(label: &str, value: &str, allow_empty: bool) -> Result<()> {
    if (!allow_empty && value.trim().is_empty()) || value.chars().count() > 512 {
        Err(anyhow!(
            "agent {label} must contain at most 512 characters and satisfy its empty-value policy"
        ))
    } else {
        Ok(())
    }
}

fn validate_graph_write(write: &StoredGraphWrite) -> Result<()> {
    validate_graph_scope_value("graph task id", &write.task_id, false)?;
    validate_graph_scope_value("graph write channel", &write.channel, false)
}

fn resolve_persistent_key(path: &std::path::Path) -> Option<[u8; 32]> {
    match load_local_key(path) {
        Ok(Some(key)) => return Some(key),
        Ok(None) => {}
        Err(_) => return None,
    }

    let mut candidate = random_key();
    match create_private_file(path, &candidate) {
        Ok(true) => Some(candidate),
        Ok(false) => {
            candidate.zeroize();
            load_local_key(path).ok().flatten()
        }
        Err(_) => {
            candidate.zeroize();
            None
        }
    }
}

fn load_local_key(path: &std::path::Path) -> Result<Option<[u8; 32]>> {
    let mut bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(anyhow!("failed to read agent key file: {error}")),
    };
    if bytes.len() != AGENT_STORE_KEY_BYTES {
        bytes.zeroize();
        return Err(anyhow!("agent key file has an invalid length"));
    }
    let mut key = [0u8; AGENT_STORE_KEY_BYTES];
    key.copy_from_slice(&bytes);
    bytes.zeroize();
    Ok(Some(key))
}

fn random_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

fn encrypt(
    key: &[u8; 32],
    record_key: &RecordKey,
    plaintext: &[u8],
    expires_at: i64,
) -> Result<EncryptedRecord> {
    let cipher = Aes256Gcm::new_from_slice(key).context("invalid agent encryption key")?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad: &record_key.aad(),
            },
        )
        .map_err(|_| anyhow!("failed to encrypt agent state"))?;
    Ok(EncryptedRecord {
        ciphertext,
        nonce: nonce_bytes,
        expires_at,
    })
}

fn decrypt(key: &[u8; 32], record_key: &RecordKey, record: &EncryptedRecord) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).context("invalid agent encryption key")?;
    let nonce = Nonce::from(record.nonce);
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &record.ciphertext,
                aad: &record_key.aad(),
            },
        )
        .map_err(|_| anyhow!("agent state authentication failed"))
}

fn encrypt_json(
    key: &[u8; 32],
    aad: &[u8],
    value: &Value,
    expires_at: i64,
) -> Result<EncryptedRecord> {
    let mut plaintext = serde_json::to_vec(value).context("failed to encode graph checkpoint")?;
    let cipher = Aes256Gcm::new_from_slice(key).context("invalid agent encryption key")?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: &plaintext,
                aad,
            },
        )
        .map_err(|_| anyhow!("failed to encrypt graph checkpoint"))?;
    plaintext.zeroize();
    Ok(EncryptedRecord {
        ciphertext,
        nonce: nonce_bytes,
        expires_at,
    })
}

fn decrypt_json(key: &[u8; 32], aad: &[u8], record: &EncryptedRecord) -> Result<Value> {
    let cipher = Aes256Gcm::new_from_slice(key).context("invalid agent encryption key")?;
    let nonce = Nonce::from(record.nonce);
    let mut plaintext = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &record.ciphertext,
                aad,
            },
        )
        .map_err(|_| anyhow!("graph checkpoint authentication failed"))?;
    let decoded =
        serde_json::from_slice(&plaintext).context("decrypted graph checkpoint is not valid JSON");
    plaintext.zeroize();
    decoded
}

async fn init_schema(pool: &Pool<Sqlite>) -> Result<()> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_threads (
            project_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            ciphertext BLOB NOT NULL,
            nonce BLOB NOT NULL,
            updated_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY(project_id, thread_id)
        );
        CREATE TABLE IF NOT EXISTS agent_checkpoints (
            project_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            checkpoint_version INTEGER NOT NULL,
            ciphertext BLOB NOT NULL,
            nonce BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY(project_id, thread_id, checkpoint_version)
        );
        CREATE TABLE IF NOT EXISTS agent_artifacts (
            project_id TEXT NOT NULL,
            artifact_id TEXT NOT NULL,
            ciphertext BLOB NOT NULL,
            nonce BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY(project_id, artifact_id)
        );
        CREATE TABLE IF NOT EXISTS agent_graph_checkpoints (
            project_id TEXT NOT NULL,
            checkpoint_thread_id TEXT NOT NULL,
            checkpoint_ns TEXT NOT NULL,
            checkpoint_id TEXT NOT NULL,
            parent_checkpoint_id TEXT,
            ciphertext BLOB NOT NULL,
            nonce BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY(project_id, checkpoint_thread_id, checkpoint_ns, checkpoint_id)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_graph_checkpoints_latest
          ON agent_graph_checkpoints(
            project_id, checkpoint_thread_id, checkpoint_ns, checkpoint_id DESC
          );
        CREATE TABLE IF NOT EXISTS agent_graph_writes (
            project_id TEXT NOT NULL,
            checkpoint_thread_id TEXT NOT NULL,
            checkpoint_ns TEXT NOT NULL,
            checkpoint_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            write_index INTEGER NOT NULL,
            ciphertext BLOB NOT NULL,
            nonce BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY(
              project_id, checkpoint_thread_id, checkpoint_ns,
              checkpoint_id, task_id, write_index
            )
        );
        CREATE INDEX IF NOT EXISTS idx_agent_graph_writes_checkpoint
          ON agent_graph_writes(
            project_id, checkpoint_thread_id, checkpoint_ns, checkpoint_id
          );
        "#,
    )
    .execute(pool)
    .await
    .context("failed to initialize encrypted agent state schema")?;
    Ok(())
}

async fn put_persistent(
    pool: &Pool<Sqlite>,
    key: &RecordKey,
    record: &EncryptedRecord,
) -> Result<()> {
    let now = now_millis();
    match key.kind {
        RecordKind::Thread => {
            sqlx::query(
                r#"INSERT INTO agent_threads
                   (project_id, thread_id, ciphertext, nonce, updated_at, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(project_id, thread_id) DO UPDATE SET
                     ciphertext=excluded.ciphertext, nonce=excluded.nonce,
                     updated_at=excluded.updated_at, expires_at=excluded.expires_at"#,
            )
            .bind(&key.project_id)
            .bind(&key.record_id)
            .bind(&record.ciphertext)
            .bind(record.nonce.as_slice())
            .bind(now)
            .bind(record.expires_at)
            .execute(pool)
            .await?;
        }
        RecordKind::Checkpoint => {
            sqlx::query(
                r#"INSERT INTO agent_checkpoints
                   (project_id, thread_id, checkpoint_version, ciphertext, nonce, created_at, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(project_id, thread_id, checkpoint_version) DO UPDATE SET
                     ciphertext=excluded.ciphertext, nonce=excluded.nonce,
                     created_at=excluded.created_at, expires_at=excluded.expires_at"#,
            )
            .bind(&key.project_id)
            .bind(&key.record_id)
            .bind(key.version as i64)
            .bind(&record.ciphertext)
            .bind(record.nonce.as_slice())
            .bind(now)
            .bind(record.expires_at)
            .execute(pool)
            .await?;
        }
        RecordKind::Artifact => {
            sqlx::query(
                r#"INSERT INTO agent_artifacts
                   (project_id, artifact_id, ciphertext, nonce, created_at, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(project_id, artifact_id) DO UPDATE SET
                     ciphertext=excluded.ciphertext, nonce=excluded.nonce,
                     created_at=excluded.created_at, expires_at=excluded.expires_at"#,
            )
            .bind(&key.project_id)
            .bind(&key.record_id)
            .bind(&record.ciphertext)
            .bind(record.nonce.as_slice())
            .bind(now)
            .bind(record.expires_at)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

async fn get_persistent(
    pool: &Pool<Sqlite>,
    key: &RecordKey,
    now: i64,
) -> Result<Option<EncryptedRecord>> {
    let row = match key.kind {
        RecordKind::Thread => sqlx::query(
            "SELECT ciphertext, nonce, expires_at FROM agent_threads WHERE project_id = ? AND thread_id = ? AND expires_at > ?",
        )
        .bind(&key.project_id)
        .bind(&key.record_id)
        .bind(now)
        .fetch_optional(pool)
        .await?,
        RecordKind::Checkpoint => sqlx::query(
            "SELECT ciphertext, nonce, expires_at FROM agent_checkpoints WHERE project_id = ? AND thread_id = ? AND checkpoint_version = ? AND expires_at > ?",
        )
        .bind(&key.project_id)
        .bind(&key.record_id)
        .bind(key.version as i64)
        .bind(now)
        .fetch_optional(pool)
        .await?,
        RecordKind::Artifact => sqlx::query(
            "SELECT ciphertext, nonce, expires_at FROM agent_artifacts WHERE project_id = ? AND artifact_id = ? AND expires_at > ?",
        )
        .bind(&key.project_id)
        .bind(&key.record_id)
        .bind(now)
        .fetch_optional(pool)
        .await?,
    };
    row.map(|row| {
        let nonce: Vec<u8> = row.get("nonce");
        let nonce: [u8; 12] = nonce
            .try_into()
            .map_err(|_| anyhow!("stored agent nonce has an invalid length"))?;
        Ok(EncryptedRecord {
            ciphertext: row.get("ciphertext"),
            nonce,
            expires_at: row.get("expires_at"),
        })
    })
    .transpose()
}

async fn load_persistent_graph_checkpoint(
    pool: &Pool<Sqlite>,
    encryption_key: &[u8; 32],
    project_id: &str,
    checkpoint_thread_id: &str,
    checkpoint_ns: &str,
    checkpoint_id: Option<&str>,
) -> Result<Option<StoredGraphCheckpoint>> {
    let row = if let Some(checkpoint_id) = checkpoint_id {
        sqlx::query(
            r#"SELECT checkpoint_id, parent_checkpoint_id, ciphertext, nonce, expires_at
               FROM agent_graph_checkpoints
               WHERE project_id = ? AND checkpoint_thread_id = ? AND checkpoint_ns = ?
                 AND checkpoint_id = ? AND expires_at > ?"#,
        )
        .bind(project_id)
        .bind(checkpoint_thread_id)
        .bind(checkpoint_ns)
        .bind(checkpoint_id)
        .bind(now_millis())
        .fetch_optional(pool)
        .await?
    } else {
        sqlx::query(
            r#"SELECT checkpoint_id, parent_checkpoint_id, ciphertext, nonce, expires_at
               FROM agent_graph_checkpoints
               WHERE project_id = ? AND checkpoint_thread_id = ? AND checkpoint_ns = ?
                 AND expires_at > ?
               ORDER BY checkpoint_id DESC LIMIT 1"#,
        )
        .bind(project_id)
        .bind(checkpoint_thread_id)
        .bind(checkpoint_ns)
        .bind(now_millis())
        .fetch_optional(pool)
        .await?
    };
    let Some(row) = row else {
        return Ok(None);
    };
    decode_persistent_graph_checkpoint(
        pool,
        encryption_key,
        project_id,
        checkpoint_thread_id,
        checkpoint_ns,
        row,
    )
    .await
    .map(Some)
}

#[allow(clippy::too_many_arguments)]
async fn list_persistent_graph_checkpoints(
    pool: &Pool<Sqlite>,
    encryption_key: &[u8; 32],
    project_id: &str,
    checkpoint_thread_id: &str,
    checkpoint_ns: &str,
    checkpoint_id: Option<&str>,
    before_checkpoint_id: Option<&str>,
    limit: usize,
) -> Result<Vec<StoredGraphCheckpoint>> {
    let mut query = QueryBuilder::<Sqlite>::new(
        "SELECT checkpoint_id, parent_checkpoint_id, ciphertext, nonce, expires_at \
         FROM agent_graph_checkpoints WHERE project_id = ",
    );
    query
        .push_bind(project_id)
        .push(" AND checkpoint_thread_id = ")
        .push_bind(checkpoint_thread_id)
        .push(" AND checkpoint_ns = ")
        .push_bind(checkpoint_ns)
        .push(" AND expires_at > ")
        .push_bind(now_millis());
    if let Some(checkpoint_id) = checkpoint_id {
        query.push(" AND checkpoint_id = ").push_bind(checkpoint_id);
    }
    if let Some(before_checkpoint_id) = before_checkpoint_id {
        query
            .push(" AND checkpoint_id < ")
            .push_bind(before_checkpoint_id);
    }
    query
        .push(" ORDER BY checkpoint_id DESC LIMIT ")
        .push_bind(limit as i64);
    let rows = query.build().fetch_all(pool).await?;
    let mut records = Vec::with_capacity(rows.len());
    for row in rows {
        records.push(
            decode_persistent_graph_checkpoint(
                pool,
                encryption_key,
                project_id,
                checkpoint_thread_id,
                checkpoint_ns,
                row,
            )
            .await?,
        );
    }
    Ok(records)
}

async fn decode_persistent_graph_checkpoint(
    pool: &Pool<Sqlite>,
    encryption_key: &[u8; 32],
    project_id: &str,
    checkpoint_thread_id: &str,
    checkpoint_ns: &str,
    row: SqliteRow,
) -> Result<StoredGraphCheckpoint> {
    let checkpoint_id: String = row.get("checkpoint_id");
    let key = GraphCheckpointKey::new(
        project_id,
        checkpoint_thread_id,
        checkpoint_ns,
        &checkpoint_id,
    )?;
    let record = encrypted_record_from_row(&row)?;
    let payload = decrypt_json(encryption_key, &key.aad(), &record)?;
    let checkpoint = payload
        .get("checkpoint")
        .cloned()
        .ok_or_else(|| anyhow!("graph checkpoint payload is incomplete"))?;
    let metadata = payload
        .get("metadata")
        .cloned()
        .ok_or_else(|| anyhow!("graph checkpoint metadata is missing"))?;
    let write_rows = sqlx::query(
        r#"SELECT task_id, write_index, ciphertext, nonce, expires_at
           FROM agent_graph_writes
           WHERE project_id = ? AND checkpoint_thread_id = ? AND checkpoint_ns = ?
             AND checkpoint_id = ? AND expires_at > ?
           ORDER BY created_at ASC, task_id ASC, write_index ASC"#,
    )
    .bind(project_id)
    .bind(checkpoint_thread_id)
    .bind(checkpoint_ns)
    .bind(&checkpoint_id)
    .bind(now_millis())
    .fetch_all(pool)
    .await?;
    let pending_writes = write_rows
        .into_iter()
        .map(|write_row| {
            let write_key = GraphWriteKey {
                checkpoint: key.clone(),
                task_id: write_row.get("task_id"),
                index: write_row.get("write_index"),
            };
            let encrypted = encrypted_record_from_row(&write_row)?;
            decode_graph_write(encryption_key, &write_key, &encrypted)
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(StoredGraphCheckpoint {
        checkpoint_thread_id: checkpoint_thread_id.to_string(),
        checkpoint_ns: checkpoint_ns.to_string(),
        checkpoint_id,
        parent_checkpoint_id: row.get("parent_checkpoint_id"),
        checkpoint,
        metadata,
        pending_writes,
    })
}

fn encrypted_record_from_row(row: &SqliteRow) -> Result<EncryptedRecord> {
    let nonce: Vec<u8> = row.get("nonce");
    let nonce: [u8; 12] = nonce
        .try_into()
        .map_err(|_| anyhow!("stored graph checkpoint nonce has an invalid length"))?;
    Ok(EncryptedRecord {
        ciphertext: row.get("ciphertext"),
        nonce,
        expires_at: row.get("expires_at"),
    })
}

fn decode_graph_write(
    encryption_key: &[u8; 32],
    key: &GraphWriteKey,
    encrypted: &EncryptedRecord,
) -> Result<StoredGraphWrite> {
    let payload = decrypt_json(encryption_key, &key.aad(), encrypted)?;
    let channel = payload
        .get("channel")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("graph write channel is missing"))?
        .to_string();
    let value = payload
        .get("value")
        .cloned()
        .ok_or_else(|| anyhow!("graph write value is missing"))?;
    Ok(StoredGraphWrite {
        task_id: key.task_id.clone(),
        index: key.index,
        channel,
        value,
    })
}

async fn cleanup_backend(backend: &Backend, now: i64) -> Result<()> {
    match backend {
        Backend::Persistent(backend) => cleanup_persistent(&backend.pool, now).await,
        Backend::Session(backend) => {
            backend
                .records
                .write()
                .await
                .retain(|_, record| record.expires_at > now);
            backend
                .graph_checkpoints
                .write()
                .await
                .retain(|_, record| record.record.expires_at > now);
            backend
                .graph_writes
                .write()
                .await
                .retain(|_, record| record.record.expires_at > now);
            Ok(())
        }
    }
}

async fn cleanup_persistent(pool: &Pool<Sqlite>, now: i64) -> Result<()> {
    for statement in [
        "DELETE FROM agent_threads WHERE expires_at <= ?",
        "DELETE FROM agent_checkpoints WHERE expires_at <= ?",
        "DELETE FROM agent_artifacts WHERE expires_at <= ?",
        "DELETE FROM agent_graph_writes WHERE expires_at <= ?",
        "DELETE FROM agent_graph_checkpoints WHERE expires_at <= ?",
    ] {
        sqlx::query(statement).bind(now).execute(pool).await?;
    }
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn local_agent_key_is_stable_and_private() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("credentials/agent-key.secret");
        let first = resolve_persistent_key(&path).unwrap();
        let second = resolve_persistent_key(&path).unwrap();
        assert_eq!(first, second);
        assert_eq!(std::fs::read(&path).unwrap().len(), AGENT_STORE_KEY_BYTES);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[tokio::test]
    async fn session_store_round_trips_authenticated_ciphertext() {
        let store = AgentStore::session_for_test(PathBuf::from("unused"), [7u8; 32]);
        let value = serde_json::json!({"secret":"not-on-disk"});
        store
            .save_thread("project", "thread", &value)
            .await
            .unwrap();
        assert_eq!(
            store.load_thread("project", "thread").await.unwrap(),
            Some(value)
        );

        let backend = store.backend().await.unwrap();
        let Backend::Session(session) = backend.as_ref() else {
            panic!("expected a session backend");
        };
        let mut records = session.records.write().await;
        records
            .get_mut(&RecordKey::thread("project", "thread"))
            .unwrap()
            .ciphertext[0] ^= 1;
        drop(records);
        assert!(store.load_thread("project", "thread").await.is_err());
    }

    #[tokio::test]
    async fn persistent_store_never_writes_json_plaintext() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("agent.db");
        let store = AgentStore::persistent_for_test(path.clone(), [9u8; 32])
            .await
            .unwrap();
        let marker = "plaintext-marker-that-must-not-appear";
        store
            .save_artifact("project", "artifact", &serde_json::json!({"value": marker}))
            .await
            .unwrap();
        drop(store);

        let bytes = std::fs::read(path).unwrap();
        assert!(!bytes
            .windows(marker.len())
            .any(|window| window == marker.as_bytes()));
    }

    #[tokio::test]
    async fn wrong_key_cannot_decrypt_persistent_state() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("agent.db");
        let writer = AgentStore::persistent_for_test(path.clone(), [1u8; 32])
            .await
            .unwrap();
        writer
            .save_checkpoint("project", "thread", 1, &serde_json::json!({"ok":true}))
            .await
            .unwrap();
        drop(writer);

        let reader = AgentStore::persistent_for_test(path, [2u8; 32])
            .await
            .unwrap();
        assert!(reader
            .load_checkpoint("project", "thread", 1)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn project_clear_is_scoped_and_reports_removed_records() {
        let store = AgentStore::session_for_test(PathBuf::from("unused"), [7u8; 32]);
        store
            .save_thread("project-a", "thread", &serde_json::json!({"a":1}))
            .await
            .unwrap();
        store
            .save_artifact("project-a", "artifact", &serde_json::json!({"a":2}))
            .await
            .unwrap();
        store
            .save_thread("project-b", "thread", &serde_json::json!({"b":1}))
            .await
            .unwrap();

        assert_eq!(store.clear_project("project-a").await.unwrap(), 2);
        assert_eq!(
            store.load_thread("project-a", "thread").await.unwrap(),
            None
        );
        assert!(store
            .load_thread("project-b", "thread")
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn graph_checkpoint_round_trips_pending_writes_and_deletes_by_thread() {
        let store = AgentStore::session_for_test(PathBuf::from("unused"), [7u8; 32]);
        let checkpoint = serde_json::json!({"type":"json","data":"Y2hlY2twb2ludA=="});
        let metadata = serde_json::json!({"type":"json","data":"bWV0YWRhdGE="});
        store
            .save_graph_checkpoint(
                "project",
                "graph-thread",
                "",
                "checkpoint-1",
                None,
                &checkpoint,
                &metadata,
            )
            .await
            .unwrap();
        store
            .save_graph_writes(
                "project",
                "graph-thread",
                "",
                "checkpoint-1",
                &[StoredGraphWrite {
                    task_id: "task-1".to_string(),
                    index: 0,
                    channel: "messages".to_string(),
                    value: serde_json::json!({"type":"json","data":"dmFsdWU="}),
                }],
            )
            .await
            .unwrap();

        let loaded = store
            .load_graph_checkpoint("project", "graph-thread", "", None)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.checkpoint, checkpoint);
        assert_eq!(loaded.metadata, metadata);
        assert_eq!(loaded.pending_writes.len(), 1);
        assert_eq!(loaded.pending_writes[0].channel, "messages");
        assert_eq!(
            store
                .list_graph_checkpoints("project", "graph-thread", "", None, None, 10)
                .await
                .unwrap()
                .len(),
            1
        );

        assert_eq!(
            store
                .delete_graph_thread("project", "graph-thread")
                .await
                .unwrap(),
            2
        );
        assert!(store
            .load_graph_checkpoint("project", "graph-thread", "", None)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn persistent_graph_checkpoint_payload_is_encrypted() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("agent.db");
        let store = AgentStore::persistent_for_test(path.clone(), [9u8; 32])
            .await
            .unwrap();
        let marker = "graph-plaintext-marker-that-must-not-appear";
        store
            .save_graph_checkpoint(
                "project",
                "graph-thread",
                "namespace",
                "checkpoint",
                None,
                &serde_json::json!({"type":"json","data":marker}),
                &serde_json::json!({"type":"json","data":"metadata"}),
            )
            .await
            .unwrap();
        drop(store);

        let bytes = std::fs::read(path).unwrap();
        assert!(!bytes
            .windows(marker.len())
            .any(|window| window == marker.as_bytes()));
    }
}
