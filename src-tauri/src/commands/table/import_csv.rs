//! Import csv for table operations.

use super::import_types::{CsvImportRowRange, TableCsvImportOptions, TableImportTextEncoding};
use crate::core::protocol::ColumnInfo;
use serde_json::Value;
use std::collections::BTreeMap;
use std::collections::HashSet;
use std::fs::File;
use std::io::BufReader;
use std::io::Read;
use std::io::Seek;
use std::io::SeekFrom;
use std::path::Path;

pub(super) fn canonical_import_columns(
    headers: &[String],
    columns: &BTreeMap<String, ColumnInfo>,
) -> Result<Vec<String>, String> {
    if headers.is_empty() {
        return Err("The import file does not contain any columns".to_string());
    }
    let mut seen = HashSet::new();
    let mut canonical = Vec::with_capacity(headers.len());
    for header in headers {
        let header = header.trim();
        if header.is_empty() {
            return Err("Import column names cannot be empty".to_string());
        }
        let column_name = if columns.contains_key(header) {
            header.to_string()
        } else {
            let matches = columns
                .keys()
                .filter(|column| column.eq_ignore_ascii_case(header))
                .collect::<Vec<_>>();
            match matches.as_slice() {
                [column] => (*column).clone(),
                [] => return Err(format!("Import file contains unknown column: {header}")),
                _ => {
                    return Err(format!(
                        "Import column {header} matches more than one table column"
                    ));
                }
            }
        };
        if !seen.insert(column_name.clone()) {
            return Err(format!(
                "Import file contains duplicate column: {column_name}"
            ));
        }
        canonical.push(column_name);
    }
    Ok(canonical)
}

pub(super) const IMPORT_ENCODING_READ_CHUNK_BYTES: usize = 16 * 1024;

/// Incrementally transcodes a reviewed CSV into UTF-8 for the csv parser.
/// Malformed source bytes are rejected instead of being replaced with U+FFFD,
/// which would silently change imported keys or text values.
pub(super) struct StrictTranscodingReader<R> {
    pub(super) reader: R,
    pub(super) decoder: encoding_rs::Decoder,
    pub(super) encoding: TableImportTextEncoding,
    pub(super) pending_input: Vec<u8>,
    pub(super) pending_output: Vec<u8>,
    pub(super) output_offset: usize,
    pub(super) reached_eof: bool,
    pub(super) finished: bool,
}

impl<R: Read> StrictTranscodingReader<R> {
    pub(super) fn new(reader: R, encoding: TableImportTextEncoding) -> Result<Self, String> {
        let decoder = encoding
            .decoder_encoding()
            .ok_or_else(|| "Automatic CSV encoding must be resolved before decoding".to_string())?
            .new_decoder_without_bom_handling();
        Ok(Self {
            reader,
            decoder,
            encoding,
            pending_input: Vec::with_capacity(IMPORT_ENCODING_READ_CHUNK_BYTES),
            pending_output: Vec::new(),
            output_offset: 0,
            reached_eof: false,
            finished: false,
        })
    }

    pub(super) fn invalid_data_error(&self) -> std::io::Error {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "Invalid byte sequence for {} encoding",
                self.encoding.label()
            ),
        )
    }
}

impl<R: Read> Read for StrictTranscodingReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }

        loop {
            if self.output_offset < self.pending_output.len() {
                let available = &self.pending_output[self.output_offset..];
                let copied = available.len().min(buffer.len());
                buffer[..copied].copy_from_slice(&available[..copied]);
                self.output_offset += copied;
                if self.output_offset == self.pending_output.len() {
                    self.pending_output.clear();
                    self.output_offset = 0;
                }
                return Ok(copied);
            }
            if self.finished {
                return Ok(0);
            }

            if self.pending_input.is_empty() && !self.reached_eof {
                let mut input = [0_u8; IMPORT_ENCODING_READ_CHUNK_BYTES];
                let read = self.reader.read(&mut input)?;
                if read == 0 {
                    self.reached_eof = true;
                } else {
                    self.pending_input.extend_from_slice(&input[..read]);
                }
            }

            let output_capacity = self
                .decoder
                .max_utf8_buffer_length_without_replacement(self.pending_input.len())
                .unwrap_or_else(|| self.pending_input.len().saturating_mul(3).saturating_add(4))
                .max(4);
            self.pending_output.resize(output_capacity, 0);
            let (result, read, written) = self.decoder.decode_to_utf8_without_replacement(
                &self.pending_input,
                &mut self.pending_output,
                self.reached_eof,
            );
            self.pending_input.drain(..read);
            self.pending_output.truncate(written);

            match result {
                encoding_rs::DecoderResult::Malformed(_, _) => {
                    return Err(self.invalid_data_error())
                }
                encoding_rs::DecoderResult::InputEmpty if self.reached_eof => self.finished = true,
                encoding_rs::DecoderResult::InputEmpty | encoding_rs::DecoderResult::OutputFull => {
                }
            }
        }
    }
}

pub(super) fn csv_bom_encoding(bytes: &[u8]) -> Option<(TableImportTextEncoding, usize)> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        Some((TableImportTextEncoding::Utf8, 3))
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        Some((TableImportTextEncoding::Utf16Le, 2))
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        Some((TableImportTextEncoding::Utf16Be, 2))
    } else {
        None
    }
}

pub(super) struct EncodingValidationState {
    pub(super) decoder: encoding_rs::Decoder,
    pub(super) pending: Vec<u8>,
    pub(super) output: Vec<u8>,
    pub(super) valid: bool,
}

impl EncodingValidationState {
    pub(super) fn new(encoding: &'static encoding_rs::Encoding) -> Self {
        Self {
            decoder: encoding.new_decoder_without_bom_handling(),
            pending: Vec::new(),
            output: Vec::new(),
            valid: true,
        }
    }

    pub(super) fn push(&mut self, input: &[u8], last: bool) {
        if !self.valid {
            return;
        }
        self.pending.extend_from_slice(input);
        loop {
            let output_capacity = self
                .decoder
                .max_utf8_buffer_length_without_replacement(self.pending.len())
                .unwrap_or_else(|| self.pending.len().saturating_mul(3).saturating_add(4))
                .max(4);
            self.output.resize(output_capacity, 0);
            let (result, read, _) = self.decoder.decode_to_utf8_without_replacement(
                &self.pending,
                &mut self.output,
                last,
            );
            self.pending.drain(..read);
            match result {
                encoding_rs::DecoderResult::Malformed(_, _) => {
                    self.valid = false;
                    self.pending.clear();
                    return;
                }
                encoding_rs::DecoderResult::InputEmpty => return,
                // A decoder that cannot consume input or produce output would
                // otherwise spin forever on malformed boundary state.
                encoding_rs::DecoderResult::OutputFull if read == 0 => {
                    self.valid = false;
                    self.pending.clear();
                    return;
                }
                encoding_rs::DecoderResult::OutputFull => {}
            }
        }
    }
}

pub(super) fn validate_csv_text_encoding(
    path: &Path,
    encoding: TableImportTextEncoding,
    bom_len: usize,
) -> Result<(), String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(bom_len as u64))
        .map_err(|error| error.to_string())?;
    let mut reader = StrictTranscodingReader::new(BufReader::new(file), encoding)?;
    std::io::copy(&mut reader, &mut std::io::sink())
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(super) fn resolve_csv_text_encoding(
    path: &Path,
    requested: Option<TableImportTextEncoding>,
) -> Result<(TableImportTextEncoding, usize), String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut prefix = [0_u8; 3];
    let prefix_len = file.read(&mut prefix).map_err(|error| error.to_string())?;
    let bom = csv_bom_encoding(&prefix[..prefix_len]);
    let requested = requested.unwrap_or(TableImportTextEncoding::Auto);

    if requested == TableImportTextEncoding::Auto {
        if let Some((encoding, bom_len)) = bom {
            validate_csv_text_encoding(path, encoding, bom_len)?;
            return Ok((encoding, bom_len));
        }

        file.seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        // Validate both candidates in one bounded pass. This avoids choosing
        // UTF-8 from an ASCII-only prefix when GB18030 bytes appear later.
        let mut utf8 = EncodingValidationState::new(encoding_rs::UTF_8);
        let mut gb18030 = EncodingValidationState::new(encoding_rs::GBK);
        let mut input = [0_u8; IMPORT_ENCODING_READ_CHUNK_BYTES];
        loop {
            let read = file.read(&mut input).map_err(|error| error.to_string())?;
            if read == 0 {
                utf8.push(&[], true);
                gb18030.push(&[], true);
                break;
            }
            utf8.push(&input[..read], false);
            gb18030.push(&input[..read], false);
        }
        if utf8.valid {
            return Ok((TableImportTextEncoding::Utf8, 0));
        }
        if gb18030.valid {
            return Ok((TableImportTextEncoding::Gb18030, 0));
        }
        return Err(
            "Could not detect CSV encoding; select UTF-8, UTF-16, or GB18030 explicitly"
                .to_string(),
        );
    }

    let bom_len = bom
        .filter(|(encoding, _)| *encoding == requested)
        .map(|(_, length)| length)
        .unwrap_or(0);
    validate_csv_text_encoding(path, requested, bom_len)?;
    Ok((requested, bom_len))
}

pub(super) fn csv_import_reader(
    path: &Path,
    has_headers: bool,
    delimiter: u8,
    requested_encoding: Option<TableImportTextEncoding>,
) -> Result<csv::Reader<Box<dyn Read + Send>>, String> {
    let (encoding, bom_len) = resolve_csv_text_encoding(path, requested_encoding)?;
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(bom_len as u64))
        .map_err(|error| error.to_string())?;
    let decoded: Box<dyn Read + Send> = Box::new(StrictTranscodingReader::new(
        BufReader::new(file),
        encoding,
    )?);
    Ok(csv::ReaderBuilder::new()
        .has_headers(has_headers)
        .flexible(true)
        .delimiter(delimiter)
        .from_reader(decoded))
}

pub(super) fn csv_delimiter(
    path: &Path,
    options: Option<&TableCsvImportOptions>,
) -> Result<u8, String> {
    let Some(delimiter) = options.and_then(|options| options.delimiter.as_deref()) else {
        return Ok(
            if path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("tsv"))
            {
                b'\t'
            } else {
                b','
            },
        );
    };
    let bytes = delimiter.as_bytes();
    if bytes.len() != 1 || matches!(bytes[0], b'\"' | b'\r' | b'\n') {
        return Err("CSV delimiter must be one non-quote, non-line-break byte".to_string());
    }
    Ok(bytes[0])
}

pub(super) fn resolve_csv_import_row_range(
    first_row_header: Option<bool>,
    options: Option<&TableCsvImportOptions>,
) -> Result<CsvImportRowRange, String> {
    let legacy_has_header = options
        .and_then(|options| options.first_row_header)
        .or(first_row_header)
        .unwrap_or(true);
    let title_row = match options.and_then(|options| options.title_row) {
        Some(0) => None,
        Some(row) => Some(row),
        None if legacy_has_header => Some(1),
        None => None,
    };
    let data_start_row = options
        .and_then(|options| options.data_start_row)
        .unwrap_or_else(|| title_row.map_or(1, |row| row.saturating_add(1)));
    if data_start_row == 0 {
        return Err("CSV data start row must be at least 1".to_string());
    }
    if title_row.is_some_and(|row| row >= data_start_row) {
        return Err("CSV title row must be before the data start row".to_string());
    }
    let last_data_row = match options.and_then(|options| options.last_data_row) {
        Some(0) | None => None,
        Some(row) if row < data_start_row => {
            return Err("CSV last data row must not be before the data start row".to_string());
        }
        Some(row) => Some(row),
    };
    Ok(CsvImportRowRange {
        title_row,
        data_start_row,
        last_data_row,
    })
}

pub(super) fn csv_import_source_columns(
    reader: &mut csv::Reader<Box<dyn Read + Send>>,
    row_range: CsvImportRowRange,
    ordered_columns: Vec<String>,
) -> Result<(Vec<String>, u64), String> {
    let Some(title_row) = row_range.title_row else {
        return Ok((ordered_columns, 0));
    };
    let mut record = csv::StringRecord::new();
    for row_number in 1..=title_row {
        if !reader
            .read_record(&mut record)
            .map_err(|error| error.to_string())?
        {
            return Err(format!(
                "CSV title row {title_row} is outside the source file (ended at row {})",
                row_number.saturating_sub(1)
            ));
        }
    }
    Ok((
        record
            .iter()
            .map(|value| value.trim().to_string())
            .collect(),
        title_row,
    ))
}

pub(super) fn csv_import_row_selected(row_range: CsvImportRowRange, row_number: u64) -> bool {
    row_number >= row_range.data_start_row
        && match row_range.last_data_row {
            Some(last_row) => row_number <= last_row,
            None => true,
        }
}

/// Resolves the exact mapping that was reviewed in the preview. An explicit
/// mapping has one entry per source index and can deliberately ignore source
/// columns; an omitted mapping preserves the legacy header-to-column import.
pub(super) fn resolve_csv_import_columns(
    source_columns: &[String],
    columns: &BTreeMap<String, ColumnInfo>,
    options: Option<&TableCsvImportOptions>,
) -> Result<Vec<Option<String>>, String> {
    let Some(options) = options.filter(|options| !options.column_mapping.is_empty()) else {
        return canonical_import_columns(source_columns, columns)
            .map(|columns| columns.into_iter().map(Some).collect());
    };

    let mut target_by_source = BTreeMap::new();
    let mut targets = HashSet::new();
    for mapping in &options.column_mapping {
        if mapping.source_index >= source_columns.len() {
            return Err(format!(
                "CSV mapping refers to source column {} but the file has {} columns",
                mapping.source_index + 1,
                source_columns.len()
            ));
        }
        if target_by_source.contains_key(&mapping.source_index) {
            return Err(format!(
                "CSV mapping contains source column {} more than once",
                mapping.source_index + 1
            ));
        }
        let target = mapping
            .target_column
            .as_deref()
            .map(|target| canonical_import_columns(&[target.to_string()], columns))
            .transpose()?
            .and_then(|mut targets| targets.pop());
        if let Some(target) = &target {
            if !targets.insert(target.clone()) {
                return Err(format!(
                    "CSV mapping contains duplicate target column: {target}"
                ));
            }
        }
        target_by_source.insert(mapping.source_index, target);
    }

    let resolved = (0..source_columns.len())
        .map(|index| target_by_source.remove(&index).unwrap_or(None))
        .collect::<Vec<_>>();
    if resolved.iter().all(Option::is_none) {
        return Err("CSV mapping does not include a target column".to_string());
    }
    Ok(resolved)
}

pub(super) fn csv_record_values(
    headers: &[Option<String>],
    record: &csv::StringRecord,
    empty_fields_as_null: bool,
    trim_values: bool,
) -> Result<BTreeMap<String, Value>, String> {
    if record.len() != headers.len() {
        return Err(format!(
            "CSV row has {} values but {} columns were expected",
            record.len(),
            headers.len()
        ));
    }
    Ok(headers
        .iter()
        .zip(record.iter())
        .filter_map(|(column, source_value)| {
            column.as_ref().map(|column| {
                let value = if trim_values {
                    source_value.trim()
                } else {
                    source_value
                };
                (
                    column.clone(),
                    if empty_fields_as_null && value.is_empty() {
                        Value::Null
                    } else {
                        Value::String(value.to_string())
                    },
                )
            })
        })
        .collect())
}
