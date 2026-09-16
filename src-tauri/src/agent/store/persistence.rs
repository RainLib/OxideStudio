use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use sqlx::{sqlite::SqliteRow, Pool, QueryBuilder, Row, Sqlite};

use super::crypto::decrypt_json;
use super::models::{
    Backend, EncryptedRecord, GraphCheckpointKey, GraphWriteKey, RecordKey, RecordKind,
    StoredGraphCheckpoint, StoredGraphWrite,
};

pub(super) async fn init_schema(pool: &Pool<Sqlite>) -> Result<()> {
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

pub(super) async fn put_persistent(
    pool: &Pool<Sqlite>,
    key: &RecordKey,
    record: &EncryptedRecord,
) -> Result<()> {
    let now = now_millis();
    match key.kind {
        RecordKind::Thread | RecordKind::Journal => {
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

pub(super) async fn get_persistent(
    pool: &Pool<Sqlite>,
    key: &RecordKey,
    now: i64,
) -> Result<Option<EncryptedRecord>> {
    let row = match key.kind {
        RecordKind::Thread | RecordKind::Journal => sqlx::query(
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

pub(super) async fn load_persistent_graph_checkpoint(
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
pub(super) async fn list_persistent_graph_checkpoints(
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

pub(super) async fn decode_persistent_graph_checkpoint(
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

pub(super) fn encrypted_record_from_row(row: &SqliteRow) -> Result<EncryptedRecord> {
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

pub(super) fn decode_graph_write(
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

pub(super) async fn cleanup_backend(backend: &Backend, now: i64) -> Result<()> {
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

pub(super) async fn cleanup_persistent(pool: &Pool<Sqlite>, now: i64) -> Result<()> {
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

pub(super) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
