mod sealing;
use super::{
    files,
    models::{
        timestamp, LargeTransferCursor, LargeTransferListQuery, LargeTransferPhase, StoredJob,
    },
};
use crate::core::private_file::{
    create_private_directory, create_private_file, restrict_sqlite_database_permissions,
};
use anyhow::{anyhow, bail, Context, Result};
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use serde::{de::DeserializeOwned, Serialize};
use sha2::Sha256;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
};
use zeroize::{Zeroize, Zeroizing};

#[derive(Clone)]
pub(super) struct JobStore {
    pub root: PathBuf,
    pub pool: SqlitePool,
    key: std::sync::Arc<Zeroizing<[u8; 32]>>,
}

impl JobStore {
    pub async fn open(root: &Path) -> Result<Self> {
        create_private_directory(root)?;
        let root = root.canonicalize()?;
        let database = root.join("jobs.sqlite");
        let key_path = root.join("authentication.secret");
        if !key_path.exists() {
            if database.exists() {
                bail!("migration authentication key is missing; existing jobs cannot be reset");
            }
            let mut generated = [0; 32];
            OsRng.fill_bytes(&mut generated);
            create_private_file(&key_path, &generated)?;
            generated.zeroize();
        }
        if std::fs::symlink_metadata(&key_path)?
            .file_type()
            .is_symlink()
        {
            bail!("migration key cannot be a link");
        }
        let mut bytes = std::fs::read(key_path)?;
        if bytes.len() != 32 {
            bytes.zeroize();
            bail!("migration authentication key is invalid");
        }
        let mut key = Zeroizing::new([0; 32]);
        key.copy_from_slice(&bytes);
        bytes.zeroize();
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&database)
                    .create_if_missing(true)
                    .foreign_keys(true)
                    .busy_timeout(std::time::Duration::from_secs(5)),
            )
            .await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, body TEXT NOT NULL, mac TEXT NOT NULL, action TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)").execute(&pool).await?;
        restrict_sqlite_database_permissions(&database);
        Ok(Self {
            root,
            pool,
            key: std::sync::Arc::new(key),
        })
    }

    pub fn authenticate<T: Serialize>(&self, purpose: &str, value: &T) -> Result<String> {
        let mut mac = Hmac::<Sha256>::new_from_slice(self.key.as_ref().as_ref())
            .map_err(|_| anyhow!("invalid migration key"))?;
        mac.update(b"oxide-large-transfer-v1\0");
        mac.update(purpose.as_bytes());
        mac.update(b"\0");
        mac.update(&serde_json::to_vec(value)?);
        Ok(hex_bytes(&mac.finalize().into_bytes()))
    }

    pub fn encode<T: Serialize>(&self, purpose: &str, value: &T) -> Result<(String, String)> {
        let body = serde_json::to_string(value)?;
        if body.len() > 512 * 1024 {
            bail!("migration record exceeds its size budget");
        }
        Ok((body, self.authenticate(purpose, value)?))
    }

    pub fn decode<T: DeserializeOwned + Serialize>(
        &self,
        purpose: &str,
        body: &str,
        signature: &str,
    ) -> Result<T> {
        if body.len() > 512 * 1024 {
            bail!("migration record exceeds its size budget");
        }
        let value: T = serde_json::from_str(body)?;
        let expected = self.authenticate(purpose, &value)?;
        // Fixed-size hexadecimal signatures; compare without early exits.
        if signature.len() != expected.len()
            || signature
                .bytes()
                .zip(expected.bytes())
                .fold(0, |diff, (a, b)| diff | (a ^ b))
                != 0
        {
            bail!("migration record authentication failed");
        }
        Ok(value)
    }

    pub fn snapshot(&self, id: &str) -> Result<PathBuf> {
        validate_id(id)?;
        Ok(self.root.join(format!("{id}.snapshot.sqlite")))
    }

    pub fn lease(&self, id: &str) -> Result<File> {
        validate_id(id)?;
        let path = self.root.join(format!("{id}.lease"));
        create_private_file(&path, b"")?;
        let file = OpenOptions::new().read(true).write(true).open(path)?;
        file.try_lock()
            .map_err(|_| anyhow!("migration job is already running in another task or process"))?;
        Ok(file)
    }

    pub async fn save(&self, job: &mut StoredJob) -> Result<()> {
        job.summary.updated_at = timestamp();
        let (body, mac) = self.encode("job", job)?;
        sqlx::query("INSERT INTO jobs(id,project_id,body,mac,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,mac=excluded.mac,updated_at=excluded.updated_at")
            .bind(&job.summary.id).bind(&job.request.project_id).bind(body).bind(mac).bind(job.summary.updated_at).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn load(&self, project: &str, id: &str) -> Result<StoredJob> {
        validate_id(id)?;
        let row = sqlx::query("SELECT body,mac FROM jobs WHERE id=? AND project_id=?")
            .bind(id)
            .bind(project)
            .fetch_optional(&self.pool)
            .await?
            .context("migration job is outside this project or unavailable")?;
        let job: StoredJob = self.decode("job", row.try_get("body")?, row.try_get("mac")?)?;
        job.validate_version()?;
        if job.summary.id != id || job.request.project_id != project {
            bail!("migration job identity is invalid");
        }
        Ok(job)
    }

    pub async fn insert(&self, job: &mut StoredJob) -> Result<()> {
        job.summary.updated_at = timestamp();
        let (body, mac) = self.encode("job", job)?;
        sqlx::query("INSERT INTO jobs(id,project_id,body,mac,updated_at) VALUES(?,?,?,?,?)")
            .bind(&job.summary.id)
            .bind(&job.request.project_id)
            .bind(body)
            .bind(mac)
            .bind(job.summary.updated_at)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn contains(&self, id: &str) -> Result<bool> {
        validate_id(id)?;
        Ok(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM jobs WHERE id=?")
                .bind(id)
                .fetch_one(&self.pool)
                .await?
                != 0,
        )
    }

    pub async fn retired_preparations(&self, after: &str) -> Result<Vec<(String, String)>> {
        Ok(sqlx::query_as("SELECT project_id,id FROM jobs WHERE id>? AND json_type(body,'$.file_preparation') IS NOT NULL AND (json_extract(body,'$.plan_digest')!='' OR json_extract(body,'$.summary.phase')='cancelled') ORDER BY id LIMIT 100")
            .bind(after).fetch_all(&self.pool).await?)
    }
    pub async fn action(&self, id: &str) -> Result<String> {
        Ok(sqlx::query_scalar("SELECT action FROM jobs WHERE id=?")
            .bind(id)
            .fetch_one(&self.pool)
            .await?)
    }
    pub async fn request_action(&self, project: &str, id: &str, action: &str) -> Result<()> {
        if !matches!(action, "" | "pause" | "cancel") {
            bail!("unknown migration action");
        }
        self.load(project, id).await?;
        let changed=sqlx::query("UPDATE jobs SET action=? WHERE project_id=? AND id=? AND ((?='' AND action!='cancel') OR (?!='' AND json_extract(body,'$.summary.phase') NOT IN ('publishing','completed','cancelled')))")
            .bind(action)
            .bind(project)
            .bind(id)
            .bind(action)
            .bind(action)
            .execute(&self.pool)
            .await?;
        if changed.rows_affected() != 1 {
            bail!("migration is publishing, terminal, or cancellation is pending");
        }
        Ok(())
    }

    pub async fn claim_publication(&self, job: &mut StoredJob) -> Result<bool> {
        job.summary.phase = LargeTransferPhase::Publishing;
        job.summary.updated_at = timestamp();
        let (body, mac) = self.encode("job", job)?;
        let changed=sqlx::query("UPDATE jobs SET body=?,mac=?,updated_at=? WHERE id=? AND action='' AND json_extract(body,'$.summary.phase')='copying'")
            .bind(body).bind(mac).bind(job.summary.updated_at).bind(&job.summary.id).execute(&self.pool).await?;
        Ok(changed.rows_affected() == 1)
    }
    pub async fn list(
        &self,
        query: &LargeTransferListQuery,
        file_import: bool,
    ) -> Result<(Vec<StoredJob>, Option<LargeTransferCursor>)> {
        if query.project_id.is_empty() || query.project_id.len() > 128 {
            bail!("invalid migration project");
        }
        if let Some(cursor) = &query.cursor {
            validate_id(&cursor.id)?;
        }
        let rows = sqlx::query(
            "SELECT body,mac FROM jobs WHERE project_id=? AND (json_type(body,'$.file_import') IS NOT NULL)=? AND (? IS NULL OR (updated_at,id)<(?,?)) ORDER BY updated_at DESC,id DESC LIMIT 101",
        )
        .bind(&query.project_id)
        .bind(file_import)
        .bind(query.cursor.as_ref().map(|c| c.updated_at))
        .bind(query.cursor.as_ref().map(|c| c.updated_at))
        .bind(query.cursor.as_ref().map(|c| c.id.as_str()))
        .fetch_all(&self.pool)
        .await?;
        let mut jobs: Vec<StoredJob> = rows
            .into_iter()
            .map(|row| self.decode("job", row.try_get("body")?, row.try_get("mac")?))
            .collect::<Result<_>>()?;
        let next = if jobs.len() > 100 {
            jobs.truncate(100);
            jobs.last().map(|j| LargeTransferCursor {
                updated_at: j.summary.updated_at,
                id: j.summary.id.clone(),
            })
        } else {
            None
        };
        Ok((jobs, next))
    }
    pub async fn pending_cancellations(&self, after: &str) -> Result<Vec<(String, String)>> {
        Ok(sqlx::query_as("SELECT project_id,id FROM jobs WHERE action='cancel' AND id>? AND json_extract(body,'$.summary.phase') NOT IN ('completed','cancelled') AND COALESCE(json_extract(body,'$.summary.issue'),'')!='cancellation_requires_review' ORDER BY id LIMIT 100")
            .bind(after).fetch_all(&self.pool).await?)
    }
    pub async fn recover(&self, project: &str, id: &str) -> Result<StoredJob> {
        let mut job = self.load(project, id).await?;
        if matches!(
            job.summary.phase,
            LargeTransferPhase::Preparing
                | LargeTransferPhase::Copying
                | LargeTransferPhase::Publishing
        ) {
            if let Ok(_lease) = self.lease(id) {
                job.summary.phase = LargeTransferPhase::Paused;
                job.summary.issue = Some("process_interrupted".into());
                self.save(&mut job).await?;
            }
        }
        Ok(job)
    }
    pub async fn require_snapshot(&self, job: &StoredJob) -> Result<PathBuf> {
        let path = self.snapshot(&job.summary.id)?;
        let expected = job.snapshot_digest.clone();
        let verify = path.clone();
        let actual = tokio::task::spawn_blocking(move || files::digest(&verify)).await??;
        if actual != expected {
            bail!("migration source snapshot changed or is incomplete");
        }
        Ok(path)
    }
}

fn validate_id(id: &str) -> Result<()> {
    if uuid::Uuid::parse_str(id).is_err() || id.len() != 36 {
        bail!("invalid migration job id");
    }
    Ok(())
}
fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
