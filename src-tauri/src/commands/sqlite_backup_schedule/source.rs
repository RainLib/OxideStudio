use super::models::SqliteBackupSchedule;
use super::state::SqliteBackupScheduleState;
use crate::core::driver::{LocalDatabaseBackupControl, LocalDatabaseFileReceipt};
use crate::core::store::restore_read_only_connection_credentials;
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{ConnectOptions, Row};
use std::path::{Path, PathBuf};
use std::str::FromStr;

pub(super) async fn saved_source(
    state: &SqliteBackupScheduleState,
    project_id: &str,
    connection_id: &str,
) -> Result<PathBuf, String> {
    let options = SqliteConnectOptions::new()
        .filename(state.config_dir.join("metadata.db"))
        .read_only(true)
        .create_if_missing(false)
        .disable_statement_logging();
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|_| "Cannot read saved connections for scheduled backups".to_string())?;
    let result = async {
        let has_credentials: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='connection_credentials'")
            .fetch_one(&pool).await.map_err(|_| "Cannot inspect saved backup credentials")?;
        // Read the safe config and its encrypted fields from one SQLite
        // snapshot, even if the desktop changes this connection concurrently.
        let query = if has_credentials != 0 {
            "SELECT c.driver, c.config, s.ciphertext, s.nonce FROM connections c JOIN projects p ON p.id=c.project_id LEFT JOIN connection_credentials s ON s.project_id=c.project_id AND s.connection_id=c.id WHERE c.project_id=? AND c.id=?"
        } else {
            "SELECT c.driver, c.config, NULL AS ciphertext, NULL AS nonce FROM connections c JOIN projects p ON p.id=c.project_id WHERE c.project_id=? AND c.id=?"
        };
        let row = sqlx::query(query)
            .bind(project_id).bind(connection_id).fetch_optional(&pool).await.map_err(|_| "Cannot read the saved backup connection")?
            .ok_or_else(|| "The saved SQLite connection no longer exists in this project".to_string())?;
        let driver: String = row.try_get("driver").map_err(|_| "Invalid saved backup driver")?;
        let mut config: Value = row.try_get("config").map_err(|_| "Invalid saved backup configuration")?;
        if driver != "sqlite" || config.get("driver").and_then(Value::as_str).is_some_and(|driver| driver != "sqlite") {
            return Err("Scheduled backup requires the bundled SQLite driver".to_string());
        }
        if config.get("driverPackageVersion").and_then(Value::as_str).is_some_and(|version| !version.is_empty())
            || config.pointer("/sshTunnel/enabled").and_then(Value::as_bool) == Some(true)
            || config.get("origin").and_then(Value::as_str) == Some("managed") {
            return Err("Scheduled backup requires a saved local SQLite connection without an external driver or SSH".to_string());
        }
        let ciphertext: Option<Vec<u8>> = row.try_get("ciphertext").map_err(|_| "Invalid backup credential record")?;
        let nonce: Option<Vec<u8>> = row.try_get("nonce").map_err(|_| "Invalid backup credential record")?;
        match (ciphertext, nonce) {
            (Some(ciphertext), Some(nonce)) => {
                restore_read_only_connection_credentials(&state.config_dir, project_id, connection_id, &mut config, &ciphertext, &nonce)
                    .map_err(|_| "Cannot unlock the saved backup connection; restore its local credential key".to_string())?;
            },
            (None, None) => {},
            _ => return Err("The saved SQLite backup credential record is incomplete".to_string()),
        }
        let database = config.get("database").and_then(Value::as_str).filter(|value| !value.trim().is_empty());
        let url = config.get("url").and_then(Value::as_str).filter(|value| !value.trim().is_empty());
        let source = match url {
            Some(url) => {
                let options = SqliteConnectOptions::from_str(&crate::drivers::sqlite::normalize_sqlite_url(url)).map_err(|_| "Invalid saved SQLite file URL")?;
                options.get_filename().to_path_buf()
            }
            None => PathBuf::from(database.ok_or("Choose an existing SQLite source file")?),
        };
        if !source.is_absolute() || source.to_string_lossy().contains(":memory:") {
            return Err("Scheduled backups require an absolute, existing SQLite file".to_string());
        }
        let source = source.canonicalize().map_err(|_| "The saved SQLite source file is unavailable".to_string())?;
        if !source.is_file() { return Err("The saved SQLite source must be a regular file".to_string()); }
        Ok(source)
    }.await;
    pool.close().await;
    result
}

pub(super) async fn backup_saved_connection(
    state: &SqliteBackupScheduleState,
    schedule: &SqliteBackupSchedule,
    destination: &Path,
    control: &LocalDatabaseBackupControl,
) -> Result<LocalDatabaseFileReceipt, String> {
    let source = saved_source(state, &schedule.project_id, &schedule.connection_id).await?;
    crate::drivers::sqlite::backup_existing_file(&source, destination, control)
        .await
        .map_err(|_| {
            "Cannot back up the saved SQLite file; check that it is readable, valid and not busy"
                .to_string()
        })
}
