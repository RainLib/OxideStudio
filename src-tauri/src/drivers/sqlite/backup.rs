use crate::core::driver::{LocalDatabaseBackupControl, LocalDatabaseFileReceipt};
use anyhow::{anyhow, Result};
use sqlx::sqlite::{LockedSqliteHandle, SqliteConnectOptions, SqliteConnection};
use sqlx::{ConnectOptions, Connection, Pool, Row, Sqlite};
use std::ffi::CStr;
use std::path::{Path, PathBuf};

pub(super) async fn copy_sqlite_database(
    source: &mut SqliteConnection,
    destination: &mut SqliteConnection,
) -> Result<()> {
    copy_sqlite_database_controlled(source, destination, None).await
}

pub(super) async fn publish_sqlite_backup(
    source: &mut SqliteConnection,
    destination: &Path,
) -> Result<LocalDatabaseFileReceipt> {
    let temporary = temporary_backup_path(destination)?;
    let result = async {
        let options = SqliteConnectOptions::new()
            .filename(&temporary)
            .create_if_missing(true)
            .disable_statement_logging();
        let mut backup = SqliteConnection::connect_with(&options).await?;
        copy_sqlite_database(source, &mut backup).await?;
        let integrity_check = sqlite_connection_integrity(&mut backup).await?;
        backup.close().await?;
        sync_file(&temporary).await?;
        replace_backup_file(&temporary, destination)?;
        Ok(LocalDatabaseFileReceipt {
            byte_len: std::fs::metadata(destination)?.len(),
            integrity_check,
        })
    }
    .await;
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

pub(super) async fn copy_sqlite_database_controlled(
    source: &mut SqliteConnection,
    destination: &mut SqliteConnection,
    control: Option<&LocalDatabaseBackupControl>,
) -> Result<()> {
    let mut source = source.lock_handle().await?;
    let mut destination = destination.lock_handle().await?;
    sqlite_online_backup(&mut source, &mut destination, control)
}

pub(super) fn sqlite_online_backup(
    source: &mut LockedSqliteHandle<'_>,
    destination: &mut LockedSqliteHandle<'_>,
    control: Option<&LocalDatabaseBackupControl>,
) -> Result<()> {
    let source_handle = source.as_raw_handle().as_ptr();
    let destination_handle = destination.as_raw_handle().as_ptr();
    let main = c"main";
    // SAFETY: both raw handles remain exclusively locked for this function,
    // `main` is NUL-terminated, and the backup handle is always finished.
    let backup = unsafe {
        libsqlite3_sys::sqlite3_backup_init(
            destination_handle,
            main.as_ptr(),
            source_handle,
            main.as_ptr(),
        )
    };
    if backup.is_null() {
        return Err(anyhow!(sqlite_error_message(destination_handle)));
    }

    let mut busy_retries = 0_u16;
    let mut cancelled = false;
    let step_code = loop {
        if control.is_some_and(LocalDatabaseBackupControl::is_cancelled) {
            cancelled = true;
            break libsqlite3_sys::SQLITE_INTERRUPT;
        }
        // Copy in bounded page batches so a concurrent reader can briefly
        // yield without turning this operation into an unbounded busy loop.
        let code = unsafe { libsqlite3_sys::sqlite3_backup_step(backup, 256) };
        if let Some(control) = control {
            let page_count = unsafe { libsqlite3_sys::sqlite3_backup_pagecount(backup) }.max(1);
            let remaining = unsafe { libsqlite3_sys::sqlite3_backup_remaining(backup) }.max(0);
            let copied = page_count.saturating_sub(remaining);
            let percent = ((i64::from(copied) * 90) / i64::from(page_count)) as u8;
            control.set_progress_percent(percent.max(1));
        }
        match code {
            libsqlite3_sys::SQLITE_OK => busy_retries = 0,
            libsqlite3_sys::SQLITE_DONE => break code,
            libsqlite3_sys::SQLITE_BUSY | libsqlite3_sys::SQLITE_LOCKED if busy_retries < 200 => {
                busy_retries += 1;
                std::thread::yield_now();
            }
            _ => break code,
        }
    };
    let finish_code = unsafe { libsqlite3_sys::sqlite3_backup_finish(backup) };
    if cancelled {
        return Err(anyhow!("SQLite backup was cancelled"));
    }
    if step_code == libsqlite3_sys::SQLITE_DONE && finish_code == libsqlite3_sys::SQLITE_OK {
        return Ok(());
    }
    let code = if step_code == libsqlite3_sys::SQLITE_DONE {
        finish_code
    } else {
        step_code
    };
    Err(anyhow!(
        "SQLite online backup failed with code {code}: {}",
        sqlite_error_message(destination_handle)
    ))
}

pub(super) fn sqlite_error_message(handle: *mut libsqlite3_sys::sqlite3) -> String {
    // SAFETY: callers hold SQLx's exclusive LockedSqliteHandle and SQLite
    // guarantees sqlite3_errmsg returns a valid NUL-terminated string.
    unsafe { CStr::from_ptr(libsqlite3_sys::sqlite3_errmsg(handle)) }
        .to_string_lossy()
        .into_owned()
}

pub(super) async fn sqlite_connection_integrity(
    connection: &mut SqliteConnection,
) -> Result<String> {
    let result: String = sqlx::query_scalar("PRAGMA main.integrity_check")
        .fetch_one(&mut *connection)
        .await?;
    if result.eq_ignore_ascii_case("ok") {
        Ok(result)
    } else {
        Err(anyhow!("SQLite file failed its integrity check"))
    }
}

pub(super) async fn prepare_backup_destination(
    pool: &Pool<Sqlite>,
    destination: &Path,
) -> Result<()> {
    if destination.as_os_str().is_empty() {
        return Err(anyhow!("Backup destination is empty"));
    }
    if destination.is_dir() {
        return Err(anyhow!("Backup destination must be a file"));
    }
    if let Some(parent) = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }
    if let Some(source) = sqlite_main_file(pool).await? {
        if paths_match(&source, destination)? {
            return Err(anyhow!(
                "Backup destination must differ from the open SQLite database"
            ));
        }
    }
    Ok(())
}

pub(super) async fn validate_restore_source(pool: &Pool<Sqlite>, source: &Path) -> Result<()> {
    if !source.is_file() {
        return Err(anyhow!("Restore source must be an existing SQLite file"));
    }
    if let Some(destination) = sqlite_main_file(pool).await? {
        if paths_match(source, &destination)? {
            return Err(anyhow!(
                "Restore source must differ from the open SQLite database"
            ));
        }
    }
    Ok(())
}

pub(super) async fn sqlite_main_file(pool: &Pool<Sqlite>) -> Result<Option<PathBuf>> {
    let rows = sqlx::query("PRAGMA database_list").fetch_all(pool).await?;
    Ok(rows.into_iter().find_map(|row| {
        let name = row.try_get::<String, _>("name").ok()?;
        let file = row.try_get::<String, _>("file").ok()?;
        (name == "main" && !file.trim().is_empty()).then(|| PathBuf::from(file))
    }))
}

pub(super) fn paths_match(left: &Path, right: &Path) -> Result<bool> {
    Ok(canonicalize_existing_or_parent(left)? == canonicalize_existing_or_parent(right)?)
}

pub(super) fn canonicalize_existing_or_parent(path: &Path) -> Result<PathBuf> {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return Ok(canonical);
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = std::fs::canonicalize(parent)?;
    let file_name = path
        .file_name()
        .ok_or_else(|| anyhow!("File path is missing a file name"))?;
    Ok(parent.join(file_name))
}

pub(crate) fn temporary_backup_path(destination: &Path) -> Result<PathBuf> {
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("Backup destination is missing a valid file name"))?;
    Ok(destination.with_file_name(format!(
        ".{file_name}.oxide-partial-{}",
        uuid::Uuid::new_v4()
    )))
}

pub(crate) fn replace_backup_file(temporary: &Path, destination: &Path) -> Result<()> {
    if !destination.exists() {
        std::fs::rename(temporary, destination)?;
        return Ok(());
    }
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("backup.sqlite");
    let previous = destination.with_file_name(format!(
        ".{file_name}.oxide-previous-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::rename(destination, &previous)?;
    match std::fs::rename(temporary, destination) {
        Ok(()) => {
            let _ = std::fs::remove_file(previous);
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::rename(previous, destination);
            Err(anyhow!("Failed to publish SQLite backup: {error}"))
        }
    }
}

pub(crate) async fn sync_file(path: &Path) -> Result<()> {
    tokio::fs::OpenOptions::new()
        // Windows requires a writable handle for FlushFileBuffers; a
        // read-only handle reports ERROR_ACCESS_DENIED even though the
        // completed SQLite file itself is valid.
        .write(true)
        .open(path)
        .await?
        .sync_all()
        .await?;
    Ok(())
}
