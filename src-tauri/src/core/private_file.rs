use anyhow::{anyhow, Context, Result};
use std::{
    fs,
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

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

/// Atomically replaces a user-private file.
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

    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).context("failed to replace private application file")?;
    }
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
}
