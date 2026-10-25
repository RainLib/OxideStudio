//! Bounded, mapped rows for a reviewed resumable import snapshot.
use super::{
    import_csv::{
        canonical_import_columns, csv_delimiter, csv_import_reader, csv_record_values,
        resolve_csv_import_columns, resolve_csv_import_row_range,
    },
    import_json_stream::stream_json_rows,
    import_types::{ImportRow, TableCsvImportOptions, TableImportFormat},
    import_xlsx_stream::stream_xlsx_rows,
    limits::TABLE_IMPORT_CANCELLED,
    row_sql::validate_insert_values,
};
use crate::core::{protocol::ColumnInfo, transfer_jobs::FileImportColumn};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{self, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
use tokio::sync::{mpsc, watch};

const RECORD_BYTES: usize = 1024 * 1024;
#[derive(Clone)]
pub(super) struct SnapshotInput {
    pub path: PathBuf,
    pub format: TableImportFormat,
    pub first_row_header: Option<bool>,
    pub csv_options: Option<TableCsvImportOptions>,
    pub columns: BTreeMap<String, ColumnInfo>,
    pub ordered_columns: Vec<String>,
    pub source_columns: Vec<String>,
    pub targets: Vec<Option<String>>,
    pub presence_column: Option<String>,
}

struct RecordReader {
    inner: Box<dyn Read + Send>,
    record_bytes: Arc<AtomicUsize>,
    total_bytes: u64,
    cancel: watch::Receiver<bool>,
}
impl Read for RecordReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        if *self.cancel.borrow() {
            return Err(io::Error::other(TABLE_IMPORT_CANCELLED));
        }
        let remaining =
            (RECORD_BYTES + 8192).saturating_sub(self.record_bytes.load(Ordering::Relaxed));
        if remaining == 0 {
            return Err(io::Error::other("CSV record exceeds snapshot byte budget"));
        }
        let length = buffer.len().min(remaining).min(8192);
        let count = self.inner.read(&mut buffer[..length])?;
        self.record_bytes.fetch_add(count, Ordering::Relaxed);
        self.total_bytes += count as u64;
        if self.total_bytes > 2 * 1024 * 1024 * 1024 {
            return Err(io::Error::other("Decoded CSV exceeds snapshot byte budget"));
        }
        Ok(count)
    }
}

fn csv_reader(
    input: &SnapshotInput,
    cancel: &watch::Receiver<bool>,
) -> Result<(csv::Reader<RecordReader>, Arc<AtomicUsize>), String> {
    let delimiter = csv_delimiter(&input.path, input.csv_options.as_ref())?;
    let reader = csv_import_reader(
        &input.path,
        false,
        delimiter,
        input.csv_options.as_ref().and_then(|v| v.encoding),
    )?;
    let counter = Arc::new(AtomicUsize::new(0));
    let source = RecordReader {
        inner: reader.into_inner(),
        record_bytes: counter.clone(),
        total_bytes: 0,
        cancel: cancel.clone(),
    };
    Ok((
        csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .delimiter(delimiter)
            .buffer_capacity(8192)
            .from_reader(source),
        counter,
    ))
}

fn csv_header(
    input: &SnapshotInput,
    reader: &mut csv::Reader<RecordReader>,
    counter: &AtomicUsize,
) -> Result<(Vec<String>, u64), String> {
    let range = resolve_csv_import_row_range(input.first_row_header, input.csv_options.as_ref())?;
    let Some(title) = range.title_row else {
        return Ok((input.ordered_columns.clone(), 0));
    };
    let mut record = csv::StringRecord::new();
    for _ in 0..title {
        counter.store(0, Ordering::Relaxed);
        if !reader.read_record(&mut record).map_err(|e| e.to_string())? {
            return Err("CSV title row is outside the source file".into());
        }
    }
    Ok((record.iter().map(|v| v.trim().to_string()).collect(), title))
}

impl SnapshotInput {
    pub fn discover(&mut self, cancel: &watch::Receiver<bool>) -> Result<(), String> {
        let cancelled = || *cancel.borrow();
        let mut presence_required = false;
        self.source_columns = match self.format {
            TableImportFormat::Csv => {
                let (mut reader, counter) = csv_reader(self, cancel)?;
                csv_header(self, &mut reader, &counter)?.0
            }
            TableImportFormat::Json => {
                let mut names = BTreeMap::new();
                let mut rows = 0;
                let mut first_shape = None;
                stream_json_rows(&self.path, &cancelled, &mut |_, row| {
                    let headers = row.keys().cloned().collect::<Vec<_>>();
                    let targets = if headers.is_empty() {
                        Vec::new()
                    } else {
                        canonical_import_columns(&headers, &self.columns)?
                    };
                    let shape = targets.iter().cloned().collect::<BTreeSet<_>>();
                    for (source, target) in headers.into_iter().zip(targets) {
                        names.entry(target).or_insert(source);
                    }
                    if let Some(first) = &first_shape {
                        presence_required |= first != &shape;
                    } else {
                        first_shape = Some(shape.clone());
                    }
                    rows += 1;
                    if names.len() > 256 {
                        return Err("JSON source exceeds 256 fields".into());
                    }
                    Ok(())
                })?;
                if rows == 0 {
                    return Err("JSON source has no object rows".into());
                }
                presence_required |= names.is_empty();
                names.into_values().collect()
            }
            TableImportFormat::Xlsx => {
                stream_xlsx_rows(&self.path, &cancelled, &mut |_, _| Ok(()))?.source_columns
            }
        };
        if (self.source_columns.is_empty() && !presence_required) || self.source_columns.len() > 512
        {
            return Err("Resumable SQLite import supports 1–512 source columns".into());
        }
        self.targets = match self.format {
            TableImportFormat::Csv => resolve_csv_import_columns(
                &self.source_columns,
                &self.columns,
                self.csv_options.as_ref(),
            )?,
            _ if self.source_columns.is_empty() => Vec::new(),
            _ => canonical_import_columns(&self.source_columns, &self.columns)?
                .into_iter()
                .map(Some)
                .collect(),
        };
        if presence_required {
            let mut name = format!("_oxide_presence_{}", uuid::Uuid::new_v4().simple());
            while self
                .columns
                .keys()
                .chain(self.source_columns.iter())
                .any(|c| c.eq_ignore_ascii_case(&name))
            {
                name.push('_');
            }
            self.presence_column = Some(name);
        }
        Ok(())
    }
    pub fn mapping(&self) -> Vec<FileImportColumn> {
        self.source_columns
            .iter()
            .zip(&self.targets)
            .filter_map(|(source, target)| {
                target.as_ref().map(|target| FileImportColumn {
                    source: source.clone(),
                    target: target.clone(),
                })
            })
            .collect()
    }
    fn validate_row(&self, row: &ImportRow) -> Result<(), String> {
        validate_insert_values(&self.columns, row)?;
        // Include staging value overhead, so preparation rejects a row that
        // would later exceed the existing transfer executor's 1 MiB budget.
        if serde_json::to_vec(row).map_err(|e| e.to_string())?.len()
            + self.targets.iter().flatten().count() * 32
            + if self.presence_column.is_some() {
                self.targets.len().div_ceil(8) + 32
            } else {
                0
            }
            > RECORD_BYTES
        {
            return Err("Import row exceeds resumable snapshot byte budget".into());
        }
        Ok(())
    }
    fn stream(
        &self,
        cancel: &dyn Fn() -> bool,
        receive_cancel: &watch::Receiver<bool>,
        observe: &mut dyn FnMut(ImportRow) -> Result<(), String>,
    ) -> Result<(), String> {
        let allowed = self
            .targets
            .iter()
            .flatten()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let mut mapped = |row: ImportRow, csv: bool| {
            let row = if csv {
                row
            } else {
                let headers = row.keys().cloned().collect::<Vec<_>>();
                let targets = if headers.is_empty() {
                    Vec::new()
                } else {
                    canonical_import_columns(&headers, &self.columns)?
                };
                if targets
                    .iter()
                    .any(|target| !allowed.contains(target.as_str()))
                {
                    return Err("Import source columns changed".into());
                }
                targets
                    .into_iter()
                    .zip(row.into_values())
                    .collect::<ImportRow>()
            };
            self.validate_row(&row)?;
            observe(row)
        };
        match self.format {
            TableImportFormat::Json => {
                stream_json_rows(&self.path, cancel, &mut |_, row| mapped(row, false))
            }
            TableImportFormat::Xlsx => {
                stream_xlsx_rows(&self.path, cancel, &mut |_, row| mapped(row, false)).map(|_| ())
            }
            TableImportFormat::Csv => {
                let (mut reader, counter) = csv_reader(self, receive_cancel)?;
                let (headers, consumed) = csv_header(self, &mut reader, &counter)?;
                if headers != self.source_columns {
                    return Err("CSV source columns changed".into());
                }
                let range =
                    resolve_csv_import_row_range(self.first_row_header, self.csv_options.as_ref())?;
                let mut row_number = consumed;
                let mut record = csv::StringRecord::new();
                loop {
                    if cancel() {
                        return Err(TABLE_IMPORT_CANCELLED.into());
                    }
                    row_number += 1;
                    if range.last_data_row.is_some_and(|last| row_number > last) {
                        break;
                    }
                    counter.store(0, Ordering::Relaxed);
                    if !reader.read_record(&mut record).map_err(|e| e.to_string())? {
                        break;
                    }
                    if row_number < range.data_start_row {
                        continue;
                    }
                    let options = self.csv_options.as_ref();
                    let row = csv_record_values(
                        &self.targets,
                        &record,
                        options
                            .and_then(|v| v.empty_fields_as_null)
                            .unwrap_or(false),
                        options.and_then(|v| v.trim_values).unwrap_or(false),
                    )?;
                    mapped(row, true)?;
                }
                Ok(())
            }
        }
    }
}

pub(super) fn snapshot_batches(
    input: SnapshotInput,
    cancel: watch::Receiver<bool>,
    directory: crate::core::transfer_jobs::FileImportPreparation,
) -> (
    mpsc::Receiver<Vec<ImportRow>>,
    tokio::task::JoinHandle<Result<(), String>>,
) {
    let (sender, receiver) = mpsc::channel(2);
    let worker = tokio::task::spawn_blocking(move || {
        let _workspace = directory;
        let cancelled = || *cancel.borrow() || sender.is_closed();
        let mut batch = Vec::with_capacity(500);
        let mut bytes = 0;
        input.stream(&cancelled, &cancel, &mut |row| {
            let size = serde_json::to_vec(&row).map_err(|e| e.to_string())?.len();
            if !batch.is_empty() && bytes + size > 2 * 1024 * 1024 {
                sender
                    .blocking_send(std::mem::take(&mut batch))
                    .map_err(|_| TABLE_IMPORT_CANCELLED.to_string())?;
                bytes = 0;
            }
            bytes += size;
            batch.push(row);
            if batch.len() == 500 {
                sender
                    .blocking_send(std::mem::take(&mut batch))
                    .map_err(|_| TABLE_IMPORT_CANCELLED.to_string())?;
                bytes = 0;
            }
            Ok(())
        })?;
        if !batch.is_empty() {
            sender
                .blocking_send(batch)
                .map_err(|_| TABLE_IMPORT_CANCELLED.to_string())?;
        }
        Ok(())
    });
    (receiver, worker)
}

pub(super) fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub(super) fn source_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Import source needs a UTF-8 file name".into())
}
