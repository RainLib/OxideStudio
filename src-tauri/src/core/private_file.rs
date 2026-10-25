use anyhow::{anyhow, Context, Result};
#[cfg(any(feature = "desktop", test))]
use std::time::{SystemTime, UNIX_EPOCH};
use std::{fs, io::Write, path::Path};

pub(crate) fn create_private_directory(path: &Path) -> Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(path)
        .context("failed to create private application directory")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .context("failed to protect private application directory")?;
    }
    Ok(())
}

/// Best-effort protection for a SQLite database and the files SQLite creates
/// beside it while journaling. Application metadata contains encrypted
/// credentials and operational history, so a default umask must not leave the
/// database or a stale WAL/journal readable by another local account.
///
/// This deliberately does not fail startup: an existing portable data root may
/// belong to another account or live on a filesystem without POSIX modes. The
/// caller still gets the normal SQLite error for an unusable database; this
/// helper only narrows permissions where the platform permits it.
pub(crate) fn restrict_sqlite_database_permissions(database_path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let sidecar = |suffix: &str| {
            let mut name = database_path.as_os_str().to_os_string();
            name.push(suffix);
            std::path::PathBuf::from(name)
        };
        for path in [
            database_path.to_path_buf(),
            sidecar("-journal"),
            sidecar("-wal"),
            sidecar("-shm"),
        ] {
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };
            let mode = metadata.permissions().mode() & 0o777;
            let restricted = mode & 0o700;
            if mode == restricted {
                continue;
            }
            if let Err(error) = fs::set_permissions(&path, fs::Permissions::from_mode(restricted)) {
                tracing::debug!(path = %path.display(), %error, "could not restrict SQLite metadata permissions");
            }
        }
    }
    #[cfg(not(unix))]
    let _ = database_path;
}

/// Atomically replaces a user-private file.
#[cfg(any(feature = "desktop", test))]
pub(crate) fn replace_private_file(path: &Path, contents: &[u8], temp_label: &str) -> Result<()> {
    let parent = path
        .parent()
        .context("private application file has no parent directory")?;
    create_private_directory(parent)?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_path = parent.join(format!(
        ".{temp_label}-{}-{timestamp}.tmp",
        std::process::id()
    ));
    let mut file = open_private_file(&temp_path)
        .context("failed to create temporary private application file")?;
    if let Err(error) = write_and_sync(&mut file, contents) {
        let _ = fs::remove_file(&temp_path);
        return Err(anyhow!("failed to write private application file: {error}"));
    }
    drop(file);

    // rename replaces an existing file on Windows as well. Removing it first
    // left a crash window in which a durable queue or credential file vanished.
    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(anyhow!(
            "failed to publish private application file: {error}"
        ));
    }
    protect_private_file(path)
}

/// Creates a user-private file without replacing an existing one. Returning
/// `false` means another process already created the canonical file.
pub(crate) fn create_private_file(path: &Path, contents: &[u8]) -> Result<bool> {
    let parent = path
        .parent()
        .context("private application file has no parent directory")?;
    create_private_directory(parent)?;

    let mut file = match open_private_file(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Ok(false);
        }
        Err(error) => return Err(error).context("failed to create private application file"),
    };
    if let Err(error) = write_and_sync(&mut file, contents) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(anyhow!("failed to write private application file: {error}"));
    }
    drop(file);
    protect_private_file(path)?;
    Ok(true)
}

fn open_private_file(path: &Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn write_and_sync(file: &mut fs::File, contents: &[u8]) -> std::io::Result<()> {
    file.write_all(contents)?;
    file.sync_all()
}

fn protect_private_file(path: &Path) -> Result<()> {
    #[cfg(not(unix))]
    let _ = path;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .context("failed to protect private application file")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_files_are_replaced_and_not_overwritten_by_create() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("credentials/secret");
        assert!(create_private_file(&path, b"first").unwrap());
        assert!(!create_private_file(&path, b"second").unwrap());
        assert_eq!(fs::read(&path).unwrap(), b"first");

        replace_private_file(&path, b"third", "private-file").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"third");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
    }

    #[test]
    fn replacement_never_exposes_a_missing_or_partial_private_file_to_readers() {
        use std::sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc, Barrier,
        };
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("control.json");
        replace_private_file(&path, &vec![0; 64 * 1024], "replace-test").unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let reads = Arc::new(AtomicUsize::new(0));
        let ready = Arc::new(Barrier::new(2));
        let reader_path = path.clone();
        let reader_stop = stop.clone();
        let reader_reads = reads.clone();
        let reader_ready = ready.clone();
        let reader = std::thread::spawn(move || {
            reader_ready.wait();
            while !reader_stop.load(Ordering::Acquire) {
                let bytes =
                    fs::read(&reader_path).expect("the published path must never disappear");
                assert_eq!(bytes.len(), 64 * 1024);
                assert!(
                    bytes.iter().all(|byte| *byte == bytes[0]),
                    "reader observed a partial replacement"
                );
                reader_reads.fetch_add(1, Ordering::Relaxed);
            }
        });
        ready.wait();
        while reads.load(Ordering::Relaxed) == 0 && !reader.is_finished() {
            std::thread::yield_now();
        }
        for generation in 1..=64_u8 {
            replace_private_file(&path, &vec![generation; 64 * 1024], "replace-test").unwrap();
        }
        stop.store(true, Ordering::Release);
        reader.join().unwrap();
        assert!(reads.load(Ordering::Relaxed) > 0);
        assert_eq!(fs::read(&path).unwrap(), vec![64; 64 * 1024]);
    }

    #[cfg(unix)]
    #[test]
    fn sqlite_database_files_are_limited_to_the_owner() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().unwrap();
        let database = root.path().join("metadata.db");
        let mut paths = vec![database.clone()];
        for suffix in ["-journal", "-wal", "-shm"] {
            let mut name = database.as_os_str().to_os_string();
            name.push(suffix);
            paths.push(std::path::PathBuf::from(name));
        }
        for path in &paths {
            fs::write(path, b"sqlite-data").unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o664)).unwrap();
        }

        restrict_sqlite_database_permissions(&database);

        for path in paths {
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o077,
                0,
                "{} retained group or other permissions",
                path.display()
            );
        }
    }

    #[cfg(not(unix))]
    #[test]
    fn sqlite_database_permission_restriction_is_a_safe_platform_noop() {
        let root = tempfile::tempdir().unwrap();
        let database = root.path().join("metadata.db");
        fs::write(&database, b"sqlite-data").unwrap();

        restrict_sqlite_database_permissions(&database);

        assert_eq!(fs::read(&database).unwrap(), b"sqlite-data");
    }
}
