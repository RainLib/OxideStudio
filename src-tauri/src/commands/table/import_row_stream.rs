//! Common bounded producer for structured file imports.
use super::import_json_stream::stream_json_rows;
use super::import_types::{ImportRow, TableImportFormat};
use super::import_xlsx_stream::stream_xlsx_rows;
use super::limits::{
    IMPORT_BATCH_SIZE, STRUCTURED_IMPORT_BATCH_BYTES, STRUCTURED_IMPORT_QUEUE_BATCHES,
    TABLE_IMPORT_CANCELLED,
};
use std::path::PathBuf;
use tokio::sync::{mpsc, watch};

pub(super) fn row_batch_stream(
    path: PathBuf,
    cancel: watch::Receiver<bool>,
    format: TableImportFormat,
) -> (
    mpsc::Receiver<Vec<ImportRow>>,
    tokio::task::JoinHandle<Result<(), String>>,
) {
    let (sender, receiver) = mpsc::channel(STRUCTURED_IMPORT_QUEUE_BATCHES);
    let worker = tokio::task::spawn_blocking(move || {
        let cancelled = || *cancel.borrow() || sender.is_closed();
        let mut batch = Vec::with_capacity(IMPORT_BATCH_SIZE);
        let mut bytes = 0;
        let mut rows = 0;
        let mut observe = |_, row: ImportRow| {
            let size = serde_json::to_vec(&row).map_err(|e| e.to_string())?.len();
            if size > STRUCTURED_IMPORT_BATCH_BYTES {
                return Err("Import row exceeds batch byte budget".into());
            }
            if !batch.is_empty() && bytes + size > STRUCTURED_IMPORT_BATCH_BYTES {
                sender
                    .blocking_send(std::mem::take(&mut batch))
                    .map_err(|_| TABLE_IMPORT_CANCELLED.to_string())?;
                bytes = 0;
            }
            bytes += size;
            rows += 1;
            batch.push(row);
            if batch.len() == IMPORT_BATCH_SIZE {
                sender
                    .blocking_send(std::mem::take(&mut batch))
                    .map_err(|_| TABLE_IMPORT_CANCELLED.to_string())?;
                bytes = 0;
            }
            Ok(())
        };
        match format {
            TableImportFormat::Json => stream_json_rows(&path, &cancelled, &mut observe)?,
            TableImportFormat::Xlsx => {
                stream_xlsx_rows(&path, &cancelled, &mut observe)?;
            }
            TableImportFormat::Csv => return Err("CSV has its own streaming import reader".into()),
        }
        if rows == 0 && matches!(format, TableImportFormat::Json) {
            return Err("The JSON file does not contain any object rows".into());
        }
        if !batch.is_empty() {
            sender
                .blocking_send(batch)
                .map_err(|_| TABLE_IMPORT_CANCELLED.to_string())?;
        }
        Ok(())
    });
    (receiver, worker)
}
