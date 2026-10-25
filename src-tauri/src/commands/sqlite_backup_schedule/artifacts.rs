use super::artifact_files::{
    delete_recorded_file, inspect_file, recorded_identity, ArtifactFileIdentity,
    BackupFileDeleteLease,
};
use super::control::writer_allowed;
use super::files::safe_run_file;
use super::models::{
    SqliteBackupArtifactPage, SqliteBackupArtifactQuery, SqliteBackupDeletePreview,
    SqliteBackupRun, SqliteBackupRunStatus,
};
use super::state::{LockedScheduleData, SqliteBackupScheduleState};
use super::validation::validate_identity;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteRow, SqliteSynchronous};
use sqlx::{ConnectOptions, Connection, QueryBuilder, Row, Sqlite, SqliteConnection};
use std::collections::HashMap;
use std::time::Duration;

const MAX_RECEIPT_BYTES: usize = 256 * 1024;
const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;

pub(super) struct ArtifactLedger {
    connection: SqliteConnection,
}

pub(super) struct StoredArtifact {
    pub(super) run: SqliteBackupRun,
    identity: Option<ArtifactFileIdentity>,
    pub(super) removed: bool,
}

#[derive(Serialize, Deserialize)]
struct ArtifactCursor {
    micros: i64,
    id: String,
    scope: String,
}

fn cursor_scope(
    project_id: &Option<String>,
    schedule_id: &Option<String>,
    search: &str,
) -> Result<String, String> {
    let bytes = serde_json::to_vec(&(project_id, schedule_id, search))
        .map_err(|_| "Cannot encode backup file filter scope")?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn ledger_error(_: sqlx::Error) -> String {
    "Cannot access the backup file ledger".to_string()
}

fn same_owner(left: &SqliteBackupRun, right: &SqliteBackupRun) -> bool {
    left.id == right.id
        && left.project_id == right.project_id
        && left.connection_id == right.connection_id
        && left.schedule_id == right.schedule_id
        && left.destination_directory == right.destination_directory
        && left.started_at == right.started_at
}

fn decode(row: SqliteRow) -> Result<StoredArtifact, String> {
    let payload: String = row.try_get("run_json").map_err(ledger_error)?;
    if payload.len() > MAX_RECEIPT_BYTES {
        return Err("Backup file receipt exceeds its size limit".to_string());
    }
    let run: SqliteBackupRun =
        serde_json::from_str(&payload).map_err(|_| "The backup file receipt is invalid")?;
    let started = chrono::DateTime::parse_from_rfc3339(&run.started_at)
        .map_err(|_| "Invalid backup file receipt time")?
        .timestamp_micros();
    let verified_flag = row.try_get::<i64, _>("verified").map_err(ledger_error)?;
    let removed_flag = row.try_get::<i64, _>("removed").map_err(ledger_error)?;
    if !matches!(verified_flag, 0 | 1) || !matches!(removed_flag, 0 | 1) {
        return Err("Invalid backup file ledger state".to_string());
    }
    let verified = verified_flag != 0;
    if !matches!(
        run.status,
        SqliteBackupRunStatus::Success | SqliteBackupRunStatus::Interrupted
    ) || verified != (run.status == SqliteBackupRunStatus::Success)
        || run.id != row.try_get::<String, _>("run_id").map_err(ledger_error)?
        || run.project_id
            != row
                .try_get::<String, _>("project_id")
                .map_err(ledger_error)?
        || run.schedule_id
            != row
                .try_get::<String, _>("schedule_id")
                .map_err(ledger_error)?
        || run.connection_id
            != row
                .try_get::<String, _>("connection_id")
                .map_err(ledger_error)?
        || run.schedule_name
            != row
                .try_get::<String, _>("schedule_name")
                .map_err(ledger_error)?
        || started != row.try_get::<i64, _>("started_us").map_err(ledger_error)?
        || run.file_path.as_deref()
            != Some(
                row.try_get::<String, _>("file_path")
                    .map_err(ledger_error)?
                    .as_str(),
            )
    {
        return Err("Backup file receipt does not match its ledger identity".to_string());
    }
    let identity = row
        .try_get::<Option<String>, _>("identity_json")
        .map_err(ledger_error)?
        .map(|value| {
            serde_json::from_str(&value)
                .map_err(|_| "The backup file identity is invalid".to_string())
        })
        .transpose()?;
    Ok(StoredArtifact {
        run,
        identity,
        removed: removed_flag != 0,
    })
}

impl ArtifactLedger {
    /// The caller holds store.lock for every operation, including JSON changes.
    /// Receipt commits precede history truncation; deletion tombstones precede
    /// JSON removal. Both directions can be replayed after a process crash.
    pub(super) async fn open(
        state: &SqliteBackupScheduleState,
        _guard: &LockedScheduleData,
    ) -> Result<Self, String> {
        {
            let instance = state
                .worker_instance
                .lock()
                .map_err(|_| "Cannot inspect worker ownership")?;
            writer_allowed(state.root(), &state.config_dir, instance.as_deref())?;
        }
        let path = state.root().join("sqlite-artifacts.db");
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .busy_timeout(Duration::from_secs(3))
            .disable_statement_logging();
        let mut connection = SqliteConnection::connect_with(&options)
            .await
            .map_err(ledger_error)?;
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&mut connection)
            .await
            .map_err(ledger_error)?;
        if version > 2 {
            return Err("The backup file ledger was created by a newer Oxide version".to_string());
        }
        if version == 0 {
            let mut transaction = connection.begin().await.map_err(ledger_error)?;
            sqlx::query("CREATE TABLE IF NOT EXISTS artifacts (
            run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, connection_id TEXT NOT NULL,
            schedule_id TEXT NOT NULL, schedule_name TEXT NOT NULL, file_path TEXT NOT NULL,
            started_us INTEGER NOT NULL, run_json TEXT NOT NULL, identity_json TEXT,
            removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0,1)),
            verified INTEGER NOT NULL DEFAULT 1 CHECK (verified IN (0,1))
        ); CREATE INDEX IF NOT EXISTS artifacts_retention ON artifacts(schedule_id, removed, verified, started_us DESC, run_id DESC);
        CREATE INDEX IF NOT EXISTS artifacts_project ON artifacts(project_id, removed, started_us DESC, run_id DESC);
        CREATE INDEX IF NOT EXISTS artifacts_all ON artifacts(removed, started_us DESC, run_id DESC)")
            .execute(&mut *transaction).await.map_err(ledger_error)?;
            sqlx::query("PRAGMA user_version=2")
                .execute(&mut *transaction)
                .await
                .map_err(ledger_error)?;
            transaction.commit().await.map_err(ledger_error)?;
        }
        if version == 1 {
            let mut transaction = connection.begin().await.map_err(ledger_error)?;
            sqlx::query("ALTER TABLE artifacts ADD COLUMN verified INTEGER NOT NULL DEFAULT 1 CHECK (verified IN (0,1)); DROP INDEX IF EXISTS artifacts_retention; CREATE INDEX artifacts_retention ON artifacts(schedule_id,removed,verified,started_us DESC,run_id DESC); PRAGMA user_version=2")
                .execute(&mut *transaction).await.map_err(ledger_error)?;
            transaction.commit().await.map_err(ledger_error)?;
        }
        crate::core::private_file::restrict_sqlite_database_permissions(&path);
        Ok(Self { connection })
    }

    pub(super) async fn close(self) -> Result<(), String> {
        self.connection.close().await.map_err(ledger_error)
    }

    pub(super) async fn lookup(&mut self, id: &str) -> Result<Option<StoredArtifact>, String> {
        sqlx::query("SELECT * FROM artifacts WHERE run_id=?")
            .bind(id)
            .fetch_optional(&mut self.connection)
            .await
            .map_err(ledger_error)?
            .map(decode)
            .transpose()
    }

    pub(super) async fn terminal_receipt(
        &mut self,
        run: &SqliteBackupRun,
    ) -> Result<Option<SqliteBackupRun>, String> {
        let Some(stored) = self.lookup(&run.id).await? else {
            return Ok(None);
        };
        if !same_owner(run, &stored.run) {
            return Err("The backup receipt belongs to another run context".to_string());
        }
        Ok((!stored.removed).then_some(stored.run))
    }

    async fn insert_on(
        connection: &mut SqliteConnection,
        run: &SqliteBackupRun,
        identity: Option<ArtifactFileIdentity>,
    ) -> Result<(), String> {
        if !matches!(
            run.status,
            SqliteBackupRunStatus::Success | SqliteBackupRunStatus::Interrupted
        ) {
            return Ok(());
        }
        let Some(path) = run.file_path.as_deref() else {
            return Ok(());
        };
        let payload =
            serde_json::to_string(run).map_err(|_| "Cannot encode the backup file receipt")?;
        if payload.len() > MAX_RECEIPT_BYTES {
            return Err("Backup file receipt exceeds its size limit".to_string());
        }
        let started = chrono::DateTime::parse_from_rfc3339(&run.started_at)
            .map_err(|_| "Invalid backup file receipt time")?
            .timestamp_micros();
        let identity = identity
            .map(|identity| {
                serde_json::to_string(&identity)
                    .map_err(|_| "Cannot encode the backup file identity")
            })
            .transpose()?;
        sqlx::query("INSERT OR IGNORE INTO artifacts(run_id,project_id,connection_id,schedule_id,schedule_name,file_path,started_us,run_json,identity_json,verified) VALUES(?,?,?,?,?,?,?,?,?,?)")
            .bind(&run.id).bind(&run.project_id).bind(&run.connection_id).bind(&run.schedule_id).bind(&run.schedule_name)
            .bind(path).bind(started).bind(payload).bind(identity).bind(i64::from(run.status == SqliteBackupRunStatus::Success)).execute(connection).await.map_err(ledger_error)?;
        Ok(())
    }

    pub(super) async fn register_completed(
        &mut self,
        run: &SqliteBackupRun,
    ) -> Result<SqliteBackupRun, String> {
        if run.status != SqliteBackupRunStatus::Success
            || run.file_path.is_none()
            || run.byte_len.is_none()
            || run
                .integrity_check
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
        {
            return Err("A completed backup file receipt is incomplete".to_string());
        }
        if let Some(existing) = self.terminal_receipt(run).await? {
            if existing.status != SqliteBackupRunStatus::Success {
                return Err("This run already has an interrupted file receipt".to_string());
            }
            return Ok(existing);
        }
        if self
            .lookup(&run.id)
            .await?
            .is_some_and(|stored| stored.removed)
        {
            return Err("The backup file receipt was already deleted".to_string());
        }
        Self::insert_on(&mut self.connection, run, recorded_identity(run)).await?;
        Ok(run.clone())
    }

    pub(super) async fn archive_history(&mut self, runs: &[SqliteBackupRun]) -> Result<(), String> {
        let successful = runs
            .iter()
            .filter(|run| {
                matches!(
                    run.status,
                    SqliteBackupRunStatus::Success | SqliteBackupRunStatus::Interrupted
                ) && run.file_path.is_some()
            })
            .collect::<Vec<_>>();
        if successful.is_empty() {
            return Ok(());
        }
        let mut query = QueryBuilder::<Sqlite>::new("SELECT * FROM artifacts WHERE run_id IN (");
        let mut separated = query.separated(",");
        for run in &successful {
            separated.push_bind(&run.id);
        }
        separated.push_unseparated(")");
        let mut known = HashMap::new();
        for row in query
            .build()
            .fetch_all(&mut self.connection)
            .await
            .map_err(ledger_error)?
        {
            let stored = decode(row)?;
            known.insert(stored.run.id.clone(), stored.run);
        }
        let mut transaction = self.connection.begin().await.map_err(ledger_error)?;
        for run in successful {
            if let Some(existing) = known.get(&run.id) {
                if !same_owner(run, existing) {
                    return Err("A backup receipt conflicts with the existing ledger".to_string());
                }
                continue;
            }
            // Migration preserves the old receipt without probing an offline
            // destination. Legacy size/time checks run only when deleting it.
            Self::insert_on(&mut transaction, run, None).await?;
        }
        transaction.commit().await.map_err(ledger_error)
    }

    pub(super) async fn stale(
        &mut self,
        schedule_id: &str,
        keep: u16,
        after: Option<&SqliteBackupRun>,
    ) -> Result<Vec<StoredArtifact>, String> {
        let mut query = QueryBuilder::<Sqlite>::new(
            "SELECT * FROM artifacts WHERE removed=0 AND verified=1 AND schedule_id=",
        );
        query.push_bind(schedule_id).push(" AND (started_us,run_id) < (SELECT started_us,run_id FROM artifacts WHERE removed=0 AND verified=1 AND schedule_id=")
            .push_bind(schedule_id).push(" ORDER BY started_us DESC,run_id DESC LIMIT 1 OFFSET ").push_bind(i64::from(keep.clamp(1,100)) - 1).push(")");
        if let Some(after) = after {
            let micros = chrono::DateTime::parse_from_rfc3339(&after.started_at)
                .map_err(|_| "Invalid backup retention cursor")?
                .timestamp_micros();
            query
                .push(" AND (started_us,run_id) < (")
                .push_bind(micros)
                .push(",")
                .push_bind(&after.id)
                .push(")");
        }
        query.push(" ORDER BY started_us DESC,run_id DESC LIMIT 100");
        query
            .build()
            .fetch_all(&mut self.connection)
            .await
            .map_err(ledger_error)?
            .into_iter()
            .map(decode)
            .collect()
    }

    pub(super) async fn remove(&mut self, artifact: &StoredArtifact) -> Result<(), String> {
        self.remove_confirmed(artifact, None).await
    }

    async fn remove_confirmed(
        &mut self,
        artifact: &StoredArtifact,
        confirmation: Option<&ArtifactFileIdentity>,
    ) -> Result<(), String> {
        if artifact.removed {
            return Ok(());
        }
        delete_recorded_file(&artifact.run, confirmation.or(artifact.identity.as_ref()))?;
        // If JSON persistence later fails, this witness prevents a stale
        // history entry from deleting a replacement file on the next retry.
        sqlx::query("UPDATE artifacts SET removed=1 WHERE run_id=?")
            .bind(&artifact.run.id)
            .execute(&mut self.connection)
            .await
            .map_err(ledger_error)?;
        Ok(())
    }

    pub(super) async fn prune_tombstones(
        &mut self,
        recent: &[SqliteBackupRun],
    ) -> Result<(), String> {
        let mut query = QueryBuilder::<Sqlite>::new("DELETE FROM artifacts WHERE removed=1");
        if !recent.is_empty() {
            query.push(" AND run_id NOT IN (");
            let mut separated = query.separated(",");
            for run in recent {
                separated.push_bind(&run.id);
            }
            separated.push_unseparated(")");
        }
        query
            .build()
            .execute(&mut self.connection)
            .await
            .map_err(ledger_error)?;
        Ok(())
    }

    pub(super) async fn page(
        &mut self,
        request: SqliteBackupArtifactQuery,
    ) -> Result<SqliteBackupArtifactPage, String> {
        let project_id = request
            .project_id
            .as_deref()
            .map(|value| validate_identity(value, "project identity"))
            .transpose()?;
        let schedule_id = request
            .schedule_id
            .as_deref()
            .map(|value| validate_identity(value, "schedule identity"))
            .transpose()?;
        let search = request.search.trim().to_string();
        if search.chars().count() > 200 || search.chars().any(char::is_control) {
            return Err("Backup file search must contain up to 200 characters".to_string());
        }
        let limit = request.limit.unwrap_or(50);
        if !(1..=100).contains(&limit) {
            return Err("Backup file page size must be from 1 to 100".to_string());
        }
        let scope = cursor_scope(&project_id, &schedule_id, &search)?;
        let cursor = request
            .cursor
            .as_deref()
            .map(|value| {
                if value.len() > 2048 {
                    return Err("Invalid backup file page cursor".to_string());
                }
                let bytes = URL_SAFE_NO_PAD
                    .decode(value)
                    .map_err(|_| "Invalid backup file page cursor")?;
                let cursor: ArtifactCursor = serde_json::from_slice(&bytes)
                    .map_err(|_| "Invalid backup file page cursor")?;
                if cursor.scope != scope {
                    return Err("The backup file page cursor belongs to another filter".to_string());
                }
                Ok(cursor)
            })
            .transpose()?;
        let mut query = QueryBuilder::<Sqlite>::new("SELECT * FROM artifacts WHERE removed=0");
        if let Some(id) = &project_id {
            query.push(" AND project_id=").push_bind(id);
        }
        if let Some(id) = &schedule_id {
            query.push(" AND schedule_id=").push_bind(id);
        }
        if !search.is_empty() {
            let pattern = format!(
                "%{}%",
                search
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            );
            query
                .push(" AND (schedule_name LIKE ")
                .push_bind(pattern.clone())
                .push(" ESCAPE '\\' OR file_path LIKE ")
                .push_bind(pattern)
                .push(" ESCAPE '\\')");
        }
        if let Some(cursor) = cursor {
            query
                .push(" AND (started_us < ")
                .push_bind(cursor.micros)
                .push(" OR (started_us = ")
                .push_bind(cursor.micros)
                .push(" AND run_id < ")
                .push_bind(cursor.id)
                .push("))");
        }
        query
            .push(" ORDER BY started_us DESC,run_id DESC LIMIT ")
            .push_bind(i64::from(limit) + 1);
        let rows = query
            .build()
            .fetch_all(&mut self.connection)
            .await
            .map_err(ledger_error)?;
        let mut items = Vec::new();
        // Reserve space for the envelope and opaque continuation token.
        let mut bytes = 4096;
        let mut has_more = false;
        for row in rows {
            let artifact = decode(row)?;
            let size = serde_json::to_vec(&artifact.run)
                .map_err(|_| "Cannot encode a backup file page")?
                .len();
            if items.len() >= usize::from(limit) || bytes + size > MAX_PAGE_BYTES {
                has_more = true;
                break;
            }
            bytes += size;
            items.push(artifact.run);
        }
        let next_cursor = if has_more {
            let last = items
                .last()
                .ok_or("Backup file page exceeds its response budget")?;
            Some(
                URL_SAFE_NO_PAD.encode(
                    serde_json::to_vec(&ArtifactCursor {
                        micros: chrono::DateTime::parse_from_rfc3339(&last.started_at)
                            .map_err(|_| "Invalid backup receipt time")?
                            .timestamp_micros(),
                        id: last.id.clone(),
                        scope,
                    })
                    .map_err(|_| "Cannot encode the backup page cursor")?,
                ),
            )
        } else {
            None
        };
        Ok(SqliteBackupArtifactPage { items, next_cursor })
    }
}

impl SqliteBackupScheduleState {
    pub async fn list_artifacts(
        &self,
        request: SqliteBackupArtifactQuery,
    ) -> Result<SqliteBackupArtifactPage, String> {
        let data = self.lock_data().await?;
        let mut ledger = ArtifactLedger::open(self, &data).await?;
        ledger.archive_history(&data.runs).await?;
        let page = ledger.page(request).await?;
        ledger.close().await?;
        Ok(page)
    }

    pub async fn preview_delete_backup(
        &self,
        id: &str,
    ) -> Result<SqliteBackupDeletePreview, String> {
        let id = validate_identity(id, "backup run identity")?;
        let data = self.lock_data().await?;
        if data
            .runs
            .iter()
            .any(|run| run.id == id && run.status.is_active())
        {
            return Err("A running or queued backup cannot be deleted".to_string());
        }
        let recent = data.runs.iter().find(|run| run.id == id);
        let mut ledger = ArtifactLedger::open(self, &data).await?;
        ledger.archive_history(&data.runs).await?;
        let stored = ledger.lookup(&id).await?;
        let run = stored
            .as_ref()
            .filter(|stored| !stored.removed)
            .map(|stored| &stored.run)
            .or(recent);
        if run.is_none() {
            return Err("This backup record no longer exists".to_string());
        }
        let mut preview = SqliteBackupDeletePreview {
            id: id.clone(),
            file_path: None,
            byte_len: None,
            review_required: false,
            confirmation_token: None,
        };
        if stored.as_ref().is_none_or(|stored| !stored.removed) {
            let run = run.expect("resolved backup record");
            if let Some(identity) = inspect_file(run)? {
                preview.file_path = run.file_path.clone();
                preview.byte_len = Some(identity.byte_len());
                preview.review_required =
                    stored.as_ref().and_then(|stored| stored.identity.as_ref()) != Some(&identity);
                let mut leases = self.delete_leases.lock().await;
                let now = std::time::Instant::now();
                leases.retain(|_, lease| lease.expires > now);
                if leases.len() >= 64 {
                    return Err(
                        "Too many pending backup file confirmations; retry shortly".to_string()
                    );
                }
                let token = uuid::Uuid::new_v4().to_string();
                leases.insert(
                    token.clone(),
                    BackupFileDeleteLease {
                        run_id: id,
                        file_path: run.file_path.clone().expect("inspected file path"),
                        identity,
                        expires: now + Duration::from_secs(300),
                    },
                );
                preview.confirmation_token = Some(token);
            }
        }
        ledger.close().await?;
        Ok(preview)
    }

    pub async fn delete_backup(&self, id: &str) -> Result<bool, String> {
        self.delete_backup_confirmed(id, None).await
    }

    pub async fn delete_backup_confirmed(
        &self,
        id: &str,
        token: Option<&str>,
    ) -> Result<bool, String> {
        let id = validate_identity(id, "backup run identity")?;
        let mut data = self.lock_data().await?;
        if data
            .runs
            .iter()
            .any(|run| run.id == id && run.status.is_active())
        {
            return Err("A running or queued backup cannot be deleted".to_string());
        }
        let recent = data.runs.iter().find(|run| run.id == id).cloned();
        let mut ledger = ArtifactLedger::open(self, &data).await?;
        ledger.archive_history(&data.runs).await?;
        let stored = ledger.lookup(&id).await?;
        if let Some(stored) = &stored {
            let identity = if let Some(token) = token {
                if token.len() > 128 {
                    return Err("Invalid backup file confirmation".to_string());
                }
                let lease = self
                    .delete_leases
                    .lock()
                    .await
                    .remove(token)
                    .ok_or("Backup file confirmation expired or was already used")?;
                if lease.expires <= std::time::Instant::now()
                    || lease.run_id != id
                    || Some(lease.file_path.as_str()) != stored.run.file_path.as_deref()
                {
                    return Err("Backup file confirmation does not match this file".to_string());
                }
                Some(lease.identity)
            } else {
                None
            };
            ledger.remove_confirmed(stored, identity.as_ref()).await?;
        } else if let Some(run) = recent.as_ref().filter(|run| run.file_path.is_some()) {
            let absent = safe_run_file(run)
                .and_then(|path| std::fs::symlink_metadata(path).err())
                .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound);
            if !absent {
                return Err("This backup has no completed file receipt; inspect its file before deleting the history".to_string());
            }
        }
        if recent.is_none() && stored.is_none() {
            return Ok(false);
        }
        data.runs.retain(|run| run.id != id);
        self.persist(&data)?;
        ledger.prune_tombstones(&data.runs).await?;
        ledger.close().await?;
        Ok(true)
    }
}
