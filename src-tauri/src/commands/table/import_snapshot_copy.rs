use super::{
    import_preview::validate_import_file, import_types::TableImportFormat,
    limits::TABLE_IMPORT_CANCELLED,
};
use crate::core::{
    private_file::create_private_file,
    transfer_jobs::{FileImportPreparation, FileImportPreparationPhase as Phase},
};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use tokio::sync::watch;

pub(super) fn copy_reviewed_source(
    path: &Path,
    expected: &str,
    format: TableImportFormat,
    cancel: &watch::Receiver<bool>,
    directory: FileImportPreparation,
) -> Result<(FileImportPreparation, PathBuf), String> {
    let progress = directory.progress().map_err(|e| e.to_string())?;
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .ok_or("Missing import extension")?
        .to_ascii_lowercase();
    let source = directory.path().join(format!("source.{extension}"));
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    if progress.phase >= Phase::Inspecting {
        validate_import_file(&source, format)?;
        let mut input = std::fs::File::open(&source).map_err(|e| e.to_string())?;
        let mut total = 0_u64;
        loop {
            if *cancel.borrow() {
                return Err(TABLE_IMPORT_CANCELLED.into());
            }
            let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            total += count as u64;
            if total > 512 * 1024 * 1024 {
                return Err("Import source exceeds 512 MiB".into());
            }
            digest.update(&buffer[..count]);
        }
        if total != progress.source_bytes || format!("{:x}", digest.finalize()) != expected {
            return Err("Captured import source changed".into());
        }
        return Ok((directory, source));
    }
    validate_import_file(path, format)?;
    if expected.len() != 64
        || !expected
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err("A reviewed source SHA-256 is required".into());
    }
    create_private_file(&source, b"").map_err(|e| e.to_string())?;
    let mut input = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut output = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&source)
        .map_err(|e| e.to_string())?;
    // A checkpoint is only published after syncing the captured prefix. Replay
    // its bytes against the original before appending; discard an uncommitted tail.
    let mut total = 0;
    let mut previous = [0; 64 * 1024];
    while total < progress.source_bytes {
        if *cancel.borrow() {
            return Err(TABLE_IMPORT_CANCELLED.into());
        }
        let length = buffer.len().min((progress.source_bytes - total) as usize);
        input
            .read_exact(&mut buffer[..length])
            .map_err(|e| e.to_string())?;
        output
            .read_exact(&mut previous[..length])
            .map_err(|e| e.to_string())?;
        if buffer[..length] != previous[..length] {
            return Err("Captured source prefix changed since review".into());
        }
        digest.update(&buffer[..length]);
        total += length as u64;
    }
    output.set_len(total).map_err(|e| e.to_string())?;
    output
        .seek(SeekFrom::Start(total))
        .map_err(|e| e.to_string())?;
    loop {
        if *cancel.borrow() {
            return Err(TABLE_IMPORT_CANCELLED.into());
        }
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > 512 * 1024 * 1024 {
            return Err("Import source exceeds 512 MiB".into());
        }
        digest.update(&buffer[..count]);
        output
            .write_all(&buffer[..count])
            .map_err(|e| e.to_string())?;
        if total.is_multiple_of(4 * 1024 * 1024) {
            output.sync_all().map_err(|e| e.to_string())?;
            directory
                .checkpoint(Phase::Copying, total, 0)
                .map_err(|e| e.to_string())?;
        }
    }
    output.sync_all().map_err(|e| e.to_string())?;
    if format!("{:x}", digest.finalize()) != expected {
        return Err("Import source changed since review".into());
    }
    directory
        .checkpoint(Phase::Inspecting, total, 0)
        .map_err(|e| e.to_string())?;
    Ok((directory, source))
}
