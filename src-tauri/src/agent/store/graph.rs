use anyhow::{anyhow, Result};
use serde_json::Value;

use super::crypto::{decrypt_json, encrypt_json};
use super::models::{
    validate_graph_scope, validate_graph_scope_value, validate_graph_write, AgentStore, Backend,
    GraphCheckpointKey, GraphWriteKey, SessionBackend, SessionGraphCheckpoint, SessionGraphWrite,
    StoredGraphCheckpoint, StoredGraphWrite, RETENTION_MILLIS,
};
use super::persistence::{
    decode_graph_write, list_persistent_graph_checkpoints, load_persistent_graph_checkpoint,
    now_millis,
};

impl AgentStore {
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
}
