use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use sqlx::Row;
use zeroize::Zeroize;

use super::crypto::{decrypt, encrypt};
use super::models::{
    validate_scope_value, validate_storage_key, AgentStore, Backend, EncryptedRecord, RecordKey,
    RecordKind, RETENTION_MILLIS,
};
use super::persistence::{
    cleanup_backend, cleanup_persistent, get_persistent, now_millis, put_persistent,
};

impl AgentStore {
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

    pub async fn list_threads_with_prefix(
        &self,
        project_id: &str,
        thread_id_prefix: &str,
        limit: usize,
    ) -> Result<Vec<Value>> {
        validate_scope_value("project id", project_id)?;
        validate_scope_value("thread id prefix", thread_id_prefix)?;
        let limit = limit.clamp(1, 100);
        let backend = self.backend().await?;
        let records = match backend.as_ref() {
            Backend::Session(session) => {
                let now = now_millis();
                let mut records = session.records.write().await;
                records.retain(|_, record| record.expires_at > now);
                records
                    .iter()
                    .filter(|(key, _)| {
                        key.kind == RecordKind::Thread
                            && key.project_id == project_id
                            && key.record_id.starts_with(thread_id_prefix)
                    })
                    .map(|(key, record)| (key.clone(), record.clone()))
                    .collect::<Vec<_>>()
            }
            Backend::Persistent(persistent) => {
                let rows = sqlx::query(
                    r#"SELECT thread_id, ciphertext, nonce, expires_at
                       FROM agent_threads
                       WHERE project_id = ?
                         AND substr(thread_id, 1, length(?)) = ?
                         AND expires_at > ?
                       ORDER BY updated_at DESC
                       LIMIT ?"#,
                )
                .bind(project_id)
                .bind(thread_id_prefix)
                .bind(thread_id_prefix)
                .bind(now_millis())
                .bind(limit as i64)
                .fetch_all(&persistent.pool)
                .await?;
                rows.into_iter()
                    .map(|row| {
                        let thread_id: String = row.get("thread_id");
                        let nonce: Vec<u8> = row.get("nonce");
                        let nonce: [u8; 12] = nonce.try_into().map_err(|_| {
                            anyhow!("stored agent thread nonce has an invalid length")
                        })?;
                        Ok((
                            RecordKey::thread(project_id, &thread_id),
                            EncryptedRecord {
                                ciphertext: row.get("ciphertext"),
                                nonce,
                                expires_at: row.get("expires_at"),
                            },
                        ))
                    })
                    .collect::<Result<Vec<_>>>()?
            }
        };

        let mut values = records
            .into_iter()
            .map(|(key, record)| {
                let mut plaintext = decrypt(backend.key(), &key, &record)?;
                let decoded = serde_json::from_slice(&plaintext)
                    .context("decrypted agent thread is not valid JSON");
                plaintext.zeroize();
                decoded
            })
            .collect::<Result<Vec<Value>>>()?;
        values.sort_by_key(|value| {
            std::cmp::Reverse(value.get("updatedAt").and_then(Value::as_i64).unwrap_or(0))
        });
        values.truncate(limit);
        Ok(values)
    }

    pub async fn save_turn_journal(
        &self,
        project_id: &str,
        turn_id: &str,
        value: &Value,
    ) -> Result<()> {
        self.put(RecordKey::journal(project_id, turn_id), value)
            .await
    }

    pub async fn load_turn_journal(
        &self,
        project_id: &str,
        turn_id: &str,
    ) -> Result<Option<Value>> {
        self.get(RecordKey::journal(project_id, turn_id)).await
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

    pub(super) async fn put(&self, key: RecordKey, value: &Value) -> Result<()> {
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

    pub(super) async fn get(&self, key: RecordKey) -> Result<Option<Value>> {
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
}
