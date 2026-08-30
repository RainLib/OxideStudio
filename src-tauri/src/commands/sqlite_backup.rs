//! Reviewed native SQLite backup and restore workflow.
//!
//! File copies of an open WAL database are not valid backups. These commands
//! bind a user-reviewed file identity to the live bundled SQLite driver and
//! delegate the actual copy to SQLite's online-backup API.

use crate::core::{manager::ConnectionManager, protocol::Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{ConnectOptions, Connection};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const FILE_HASH_BUFFER_SIZE: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SqliteBackupOperation {
    Backup,
    Restore,
}

impl SqliteBackupOperation {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Backup => "backup",
            Self::Restore => "restore",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupPlanRequest {
    pub operation: SqliteBackupOperation,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteSqliteBackupPlanRequest {
    pub plan: SqliteBackupPlanRequest,
    pub confirmation_token: String,
    pub confirmation_text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupPlan {
    pub operation: SqliteBackupOperation,
    pub path: String,
    pub file_name: String,
    pub summary: String,
    pub risk: String,
    pub destination_exists: bool,
    pub byte_len: Option<u64>,
    pub source_sha256: Option<String>,
    pub creates_recovery_point: bool,
    pub confirmation_text: String,
    pub confirmation_token: String,
    pub connected_driver: String,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupExecutionReceipt {
    pub operation: SqliteBackupOperation,
    pub path: String,
    pub byte_len: u64,
    pub integrity_check: String,
    pub recovery_path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileFingerprint {
    canonical_path: PathBuf,
    byte_len: Option<u64>,
    marker: String,
    sha256: Option<String>,
}

fn validate_user_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Select a SQLite backup file".to_string());
    }
    if trimmed.contains('\0') {
        return Err("The selected backup path is invalid".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("Select an absolute backup file path".to_string());
    }
    Ok(path)
}

fn file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "The selected backup path has no valid file name".to_string())
}

fn canonicalize_existing_or_parent(path: &Path) -> Result<PathBuf, String> {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return Ok(canonical);
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| "The selected backup path has no parent directory".to_string())?;
    let parent = std::fs::canonicalize(parent)
        .map_err(|_| "The selected backup directory does not exist".to_string())?;
    let name = path
        .file_name()
        .ok_or_else(|| "The selected backup path has no file name".to_string())?;
    Ok(parent.join(name))
}

fn metadata_marker(metadata: &std::fs::Metadata) -> String {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    format!("{}:{modified}", metadata.len())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|_| "Cannot read the selected restore file".to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; FILE_HASH_BUFFER_SIZE];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "Cannot read the selected restore file".to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

async fn fingerprint_file(
    operation: SqliteBackupOperation,
    selected_path: &Path,
) -> Result<FileFingerprint, String> {
    let canonical_path = canonicalize_existing_or_parent(selected_path)?;
    match operation {
        SqliteBackupOperation::Backup => {
            if canonical_path.is_dir() {
                return Err("Backup destination must be a file".to_string());
            }
            match std::fs::metadata(&canonical_path) {
                Ok(metadata) if metadata.is_file() => Ok(FileFingerprint {
                    canonical_path,
                    byte_len: Some(metadata.len()),
                    marker: metadata_marker(&metadata),
                    sha256: None,
                }),
                Ok(_) => Err("Backup destination must be a regular file".to_string()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(FileFingerprint {
                    canonical_path,
                    byte_len: None,
                    marker: "missing".to_string(),
                    sha256: None,
                }),
                Err(_) => Err("Cannot inspect the selected backup destination".to_string()),
            }
        }
        SqliteBackupOperation::Restore => {
            let metadata = std::fs::metadata(&canonical_path)
                .map_err(|_| "Restore source must be an existing SQLite file".to_string())?;
            if !metadata.is_file() {
                return Err("Restore source must be a regular file".to_string());
            }
            let hash_path = canonical_path.clone();
            let sha256 = tokio::task::spawn_blocking(move || sha256_file(&hash_path))
                .await
                .map_err(|_| "Restore source fingerprinting was interrupted".to_string())??;
            Ok(FileFingerprint {
                canonical_path,
                byte_len: Some(metadata.len()),
                marker: format!("{}:{sha256}", metadata.len()),
                sha256: Some(sha256),
            })
        }
    }
}

async fn validate_sqlite_restore_file(path: &Path) -> Result<(), String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .disable_statement_logging();
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| "The selected restore file is not a readable SQLite database".to_string())?;
    let integrity: String = sqlx::query_scalar("PRAGMA main.integrity_check")
        .fetch_one(&mut connection)
        .await
        .map_err(|_| "The selected restore file could not be validated".to_string())?;
    connection.close().await.map_err(|_| {
        "The selected restore file could not be closed after validation".to_string()
    })?;
    if integrity.eq_ignore_ascii_case("ok") {
        Ok(())
    } else {
        Err("The selected restore file failed SQLite integrity validation".to_string())
    }
}

async fn confirm_bundled_sqlite(
    manager: &ConnectionManager,
    connection_id: &str,
) -> Result<Option<String>, String> {
    let snapshot = manager
        .capability_snapshot(connection_id)
        .await
        .map_err(|_| "The database connection is unavailable".to_string())?;
    if snapshot.driver_id.as_deref() != Some("sqlite") {
        return Err("Native backup and restore require an active SQLite connection".to_string());
    }
    if snapshot.managed || snapshot.external_driver_id.is_some() {
        return Err(
            "This connection does not expose Oxide's bundled SQLite backup protocol".to_string(),
        );
    }
    Ok(snapshot.server_version)
}

fn confirmation_text(
    operation: SqliteBackupOperation,
    name: &str,
    destination_exists: bool,
) -> String {
    match (operation, destination_exists) {
        (SqliteBackupOperation::Backup, false) => format!("CREATE BACKUP {name}"),
        (SqliteBackupOperation::Backup, true) => format!("REPLACE BACKUP {name}"),
        (SqliteBackupOperation::Restore, _) => format!("RESTORE SQLITE FROM {name}"),
    }
}

fn plan_token(
    connection_id: &str,
    operation: SqliteBackupOperation,
    fingerprint: &FileFingerprint,
    server_version: Option<&str>,
    confirmation: &str,
) -> String {
    let mut digest = Sha256::new();
    for value in [
        "oxide-sqlite-backup-plan-v1",
        connection_id,
        operation.as_str(),
        &fingerprint.canonical_path.to_string_lossy(),
        &fingerprint.marker,
        server_version.unwrap_or("unknown"),
        confirmation,
    ] {
        digest.update(value.as_bytes());
        digest.update([0]);
    }
    format!("{:x}", digest.finalize())
}

async fn build_plan(
    manager: &ConnectionManager,
    connection_id: &str,
    request: &SqliteBackupPlanRequest,
) -> Result<SqliteBackupPlan, String> {
    let server_version = confirm_bundled_sqlite(manager, connection_id).await?;
    let selected_path = validate_user_path(&request.path)?;
    let fingerprint = fingerprint_file(request.operation, &selected_path).await?;
    if request.operation == SqliteBackupOperation::Restore {
        validate_sqlite_restore_file(&fingerprint.canonical_path).await?;
    }
    let file_name = file_name(&fingerprint.canonical_path)?;
    let destination_exists =
        request.operation == SqliteBackupOperation::Backup && fingerprint.byte_len.is_some();
    let confirmation_text = confirmation_text(request.operation, &file_name, destination_exists);
    let confirmation_token = plan_token(
        connection_id,
        request.operation,
        &fingerprint,
        server_version.as_deref(),
        &confirmation_text,
    );
    let (summary, risk, creates_recovery_point) = match (request.operation, destination_exists) {
        (SqliteBackupOperation::Backup, false) => (
            "Create a consistent SQLite backup using the live database snapshot",
            "low",
            false,
        ),
        (SqliteBackupOperation::Backup, true) => (
            "Replace the selected backup only after a new snapshot is complete",
            "medium",
            false,
        ),
        (SqliteBackupOperation::Restore, _) => (
            "Replace the live SQLite database after creating an automatic recovery point",
            "high",
            true,
        ),
    };
    Ok(SqliteBackupPlan {
        operation: request.operation,
        path: fingerprint.canonical_path.to_string_lossy().into_owned(),
        file_name,
        summary: summary.to_string(),
        risk: risk.to_string(),
        destination_exists,
        byte_len: fingerprint.byte_len,
        source_sha256: fingerprint.sha256,
        creates_recovery_point,
        confirmation_text,
        confirmation_token,
        connected_driver: "sqlite".to_string(),
        server_version,
    })
}

fn recovery_path(app: &AppHandle, connection_id: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "Oxide application data directory is unavailable".to_string())?
        .join("database-backups")
        .join("recovery");
    std::fs::create_dir_all(&root)
        .map_err(|_| "Cannot create the SQLite recovery directory".to_string())?;
    let mut identity = Sha256::new();
    identity.update(connection_id.as_bytes());
    let identity = format!("{:x}", identity.finalize());
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(root.join(format!(
        "sqlite-recovery-{}-{timestamp}-{}.sqlite",
        &identity[..12],
        uuid::Uuid::new_v4()
    )))
}

fn safe_error_response<T>(code: &str, error: &str) -> Response<T> {
    let normalized = error.to_ascii_lowercase();
    let validation = [
        "select ",
        "selected ",
        "backup destination",
        "restore source",
        "active sqlite",
        "finish or roll back",
        "plan changed",
        "confirmation text",
        "integrity",
        "bundled sqlite",
        "restore failed",
        "automatic rollback",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern));
    let message = if normalized.contains("no space")
        || normalized.contains("disk full")
        || normalized.contains("database or disk is full")
    {
        "There is not enough free disk space to complete this SQLite operation. The live database was not intentionally replaced."
            .to_string()
    } else if normalized.contains("permission denied")
        || normalized.contains("access is denied")
        || normalized.contains("os error 5")
    {
        "Oxide cannot access the selected file or directory. Choose a writable destination or a readable restore file."
            .to_string()
    } else if normalized.contains("database is locked")
        || normalized.contains("database is busy")
        || normalized.contains("finish or roll back")
    {
        "SQLite is busy. Finish active transactions and retry after current writes complete."
            .to_string()
    } else if validation {
        error.chars().take(320).collect::<String>()
    } else {
        "SQLite backup or restore failed. The original database was not intentionally discarded."
            .to_string()
    };
    Response::err(code, &message)
}

#[tauri::command]
pub async fn preview_sqlite_backup_plan(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    request: SqliteBackupPlanRequest,
) -> Result<Response<SqliteBackupPlan>, String> {
    Ok(match build_plan(&manager, &connection_id, &request).await {
        Ok(plan) => Response::ok(plan),
        Err(error) => safe_error_response("SQLITE_BACKUP_PREVIEW_ERROR", &error),
    })
}

#[tauri::command]
pub async fn execute_sqlite_backup_plan(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    request: ExecuteSqliteBackupPlanRequest,
) -> Result<Response<SqliteBackupExecutionReceipt>, String> {
    let result: Result<SqliteBackupExecutionReceipt, String> = async {
        let plan = build_plan(&manager, &connection_id, &request.plan).await?;
        if request.confirmation_token.trim() != plan.confirmation_token {
            return Err("SQLite backup plan changed; preview the selected file again".to_string());
        }
        if request.confirmation_text.trim() != plan.confirmation_text {
            return Err(
                "SQLite backup confirmation text does not match the reviewed operation"
                    .to_string(),
            );
        }
        let path = PathBuf::from(&plan.path);
        match plan.operation {
            SqliteBackupOperation::Backup => {
                let receipt = manager
                    .backup_local_database(&connection_id, &path)
                    .await
                    .map_err(|error| error.to_string())?;
                Ok(SqliteBackupExecutionReceipt {
                    operation: plan.operation,
                    path: plan.path,
                    byte_len: receipt.byte_len,
                    integrity_check: receipt.integrity_check,
                    recovery_path: None,
                    message: "SQLite backup created and integrity checked".to_string(),
                })
            }
            SqliteBackupOperation::Restore => {
                let recovery = recovery_path(&app, &connection_id)?;
                manager
                    .backup_local_database(&connection_id, &recovery)
                    .await
                    .map_err(|_| {
                        "Restore stopped because the automatic recovery point could not be created"
                            .to_string()
                    })?;
                // Creating the recovery point can take time for a large live
                // database. Re-hash the source immediately before mutation so
                // a changed file cannot reuse the earlier approval token.
                let final_plan = build_plan(&manager, &connection_id, &request.plan).await?;
                if final_plan.confirmation_token != plan.confirmation_token {
                    let _ = std::fs::remove_file(&recovery);
                    return Err(
                        "SQLite backup plan changed; preview the selected file again".to_string(),
                    );
                }
                let final_path = PathBuf::from(&final_plan.path);
                match manager
                    .restore_local_database(&connection_id, &final_path)
                    .await
                {
                    Ok(receipt) => Ok(SqliteBackupExecutionReceipt {
                        operation: plan.operation,
                        path: plan.path,
                        byte_len: receipt.byte_len,
                        integrity_check: receipt.integrity_check,
                        recovery_path: Some(recovery.to_string_lossy().into_owned()),
                        message: "SQLite database restored and integrity checked".to_string(),
                    }),
                    Err(restore_error) => {
                        let rollback = manager
                            .restore_local_database(&connection_id, &recovery)
                            .await;
                        if rollback.is_ok() {
                            Err("Restore failed; Oxide restored the automatic recovery point"
                                .to_string())
                        } else {
                            Err(format!(
                                "Restore failed and automatic rollback could not be verified. Keep the recovery file at {} and inspect the target manually. Internal failure class: {}",
                                recovery.to_string_lossy(),
                                if restore_error.to_string().is_empty() { "unknown" } else { "restore" }
                            ))
                        }
                    }
                }
            }
        }
    }
    .await;

    Ok(match result {
        Ok(receipt) => Response::ok(receipt),
        Err(error) => safe_error_response("SQLITE_BACKUP_EXECUTE_ERROR", &error),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::driver::DatabaseDriver;
    use crate::drivers::sqlite::SqliteDriver;

    #[test]
    fn confirmation_copy_distinguishes_create_replace_and_restore() {
        assert_eq!(
            confirmation_text(SqliteBackupOperation::Backup, "app.sqlite", false),
            "CREATE BACKUP app.sqlite"
        );
        assert_eq!(
            confirmation_text(SqliteBackupOperation::Backup, "app.sqlite", true),
            "REPLACE BACKUP app.sqlite"
        );
        assert_eq!(
            confirmation_text(SqliteBackupOperation::Restore, "app.sqlite", true),
            "RESTORE SQLITE FROM app.sqlite"
        );
    }

    #[test]
    fn plan_token_binds_connection_file_and_fingerprint() {
        let first = FileFingerprint {
            canonical_path: PathBuf::from("C:/data/backup.sqlite"),
            byte_len: Some(42),
            marker: "42:100".to_string(),
            sha256: None,
        };
        let mut changed = first.clone();
        changed.marker = "42:101".to_string();
        let token = plan_token(
            "connection-a",
            SqliteBackupOperation::Backup,
            &first,
            Some("3.46"),
            "REPLACE BACKUP backup.sqlite",
        );
        assert_ne!(
            token,
            plan_token(
                "connection-a",
                SqliteBackupOperation::Backup,
                &changed,
                Some("3.46"),
                "REPLACE BACKUP backup.sqlite",
            )
        );
        assert_ne!(
            token,
            plan_token(
                "connection-b",
                SqliteBackupOperation::Backup,
                &first,
                Some("3.46"),
                "REPLACE BACKUP backup.sqlite",
            )
        );
    }

    #[test]
    fn operational_errors_are_mapped_without_returning_driver_details() {
        let disk: Response<()> = safe_error_response(
            "SQLITE_BACKUP_EXECUTE_ERROR",
            "database or disk is full at secret-path",
        );
        assert!(disk
            .error
            .unwrap()
            .message
            .contains("enough free disk space"));
        let permission: Response<()> = safe_error_response(
            "SQLITE_BACKUP_EXECUTE_ERROR",
            "Access is denied: C:/private/customer.sqlite",
        );
        let message = permission.error.unwrap().message;
        assert!(message.contains("cannot access"));
        assert!(!message.contains("customer.sqlite"));
    }

    #[tokio::test]
    async fn restore_fingerprint_hashes_the_exact_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("restore.sqlite");
        std::fs::write(&path, b"first").unwrap();
        let first = fingerprint_file(SqliteBackupOperation::Restore, &path)
            .await
            .unwrap();
        std::fs::write(&path, b"second").unwrap();
        let second = fingerprint_file(SqliteBackupOperation::Restore, &path)
            .await
            .unwrap();
        assert_ne!(first.sha256, second.sha256);
        assert_ne!(first.marker, second.marker);
    }

    #[tokio::test]
    async fn plan_uses_the_captured_live_driver_identity() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("backup.sqlite");
        let mut driver = SqliteDriver::new(":memory:");
        driver.connect().await.unwrap();
        let manager = ConnectionManager::new();
        manager
            .replace_connection_with_tunnel_and_driver_id(
                "sqlite-live".to_string(),
                Box::new(driver),
                None,
                Some("sqlite".to_string()),
            )
            .await
            .unwrap();

        let plan = build_plan(
            &manager,
            "sqlite-live",
            &SqliteBackupPlanRequest {
                operation: SqliteBackupOperation::Backup,
                path: destination.to_string_lossy().into_owned(),
            },
        )
        .await
        .unwrap();
        assert_eq!(plan.connected_driver, "sqlite");
        assert_eq!(plan.confirmation_text, "CREATE BACKUP backup.sqlite");

        let mut mismatched = SqliteDriver::new(":memory:");
        mismatched.connect().await.unwrap();
        manager
            .replace_connection_with_tunnel_and_driver_id(
                "wrong-live-identity".to_string(),
                Box::new(mismatched),
                None,
                Some("postgres".to_string()),
            )
            .await
            .unwrap();
        let error = build_plan(
            &manager,
            "wrong-live-identity",
            &SqliteBackupPlanRequest {
                operation: SqliteBackupOperation::Backup,
                path: destination.to_string_lossy().into_owned(),
            },
        )
        .await
        .unwrap_err();
        assert!(error.contains("active SQLite"));
    }
}
