//! Bounded JSON source parsing shared by preview, preflight, inference and execution.
use super::limits::{MAX_JSON_IMPORT_FILE_BYTES, TABLE_IMPORT_CANCELLED};
use serde::de::{DeserializeSeed, Error, MapAccess, SeqAccess, Visitor};
use serde_json::Value;
use std::cell::Cell;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read};
use std::path::Path;

pub(super) const JSON_ROW_BYTES: usize = 1024 * 1024;
pub(super) const JSON_ROW_COLUMNS: usize = 256;
pub(super) type JsonRow = BTreeMap<String, Value>;

pub(super) fn is_json_lines_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|v| v.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("jsonl" | "ndjson")
    )
}

struct BudgetReader<'a> {
    reader: BufReader<File>,
    row_bytes: &'a Cell<usize>,
    total: u64,
    cancelled: &'a dyn Fn() -> bool,
}
impl Read for BudgetReader<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        // serde_json reads a byte at a time. Poll cancellation at most every
        // 8 KiB, rather than locking a watch receiver for every source byte.
        if self.total.is_multiple_of(8192) && (self.cancelled)() {
            return Err(io::Error::other(TABLE_IMPORT_CANCELLED));
        }
        let count = self.reader.read(buffer)?;
        self.total += count as u64;
        self.row_bytes.set(self.row_bytes.get() + count);
        if self.total > MAX_JSON_IMPORT_FILE_BYTES {
            return Err(io::Error::other("JSON source exceeds 512 MiB"));
        }
        if self.row_bytes.get() > JSON_ROW_BYTES {
            return Err(io::Error::other("JSON record exceeds 1 MiB"));
        }
        Ok(count)
    }
}
struct RowSeed;
struct RowVisitor;
impl<'de> DeserializeSeed<'de> for RowSeed {
    type Value = JsonRow;
    fn deserialize<D: serde::Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_map(RowVisitor)
    }
}
impl<'de> Visitor<'de> for RowVisitor {
    type Value = JsonRow;
    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("a JSON object row")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<JsonRow, A::Error> {
        let mut row = JsonRow::new();
        while let Some(key) = map.next_key::<String>()? {
            if key.len() > 256 {
                return Err(A::Error::custom("JSON field name exceeds 256 UTF-8 bytes"));
            }
            if row.len() >= JSON_ROW_COLUMNS {
                return Err(A::Error::custom("JSON row exceeds 256 fields"));
            }
            if row.contains_key(&key) {
                return Err(A::Error::custom("JSON row contains duplicate fields"));
            }
            row.insert(key, map.next_value()?);
        }
        Ok(row)
    }
}
struct DocumentVisitor<'a> {
    row_bytes: &'a Cell<usize>,
    cancelled: &'a dyn Fn() -> bool,
    on_row: &'a mut dyn FnMut(u64, JsonRow) -> Result<(), String>,
}
impl<'de> Visitor<'de> for DocumentVisitor<'_> {
    type Value = ();
    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("a JSON object or array of object rows")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<(), A::Error> {
        let mut number = 0;
        loop {
            if (self.cancelled)() {
                return Err(A::Error::custom(TABLE_IMPORT_CANCELLED));
            }
            self.row_bytes.set(0);
            let Some(row) = sequence.next_element_seed(RowSeed)? else {
                break;
            };
            number += 1;
            (self.on_row)(number, row).map_err(A::Error::custom)?;
        }
        Ok(())
    }
    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<(), A::Error> {
        if (self.cancelled)() {
            return Err(A::Error::custom(TABLE_IMPORT_CANCELLED));
        }
        let row = RowVisitor.visit_map(map)?;
        (self.on_row)(1, row).map_err(A::Error::custom)
    }
}

pub(super) fn stream_json_document_rows(
    path: &Path,
    cancelled: &dyn Fn() -> bool,
    on_row: &mut dyn FnMut(u64, JsonRow) -> Result<(), String>,
) -> Result<(), String> {
    if cancelled() {
        return Err(TABLE_IMPORT_CANCELLED.into());
    }
    let row_bytes = Cell::new(0);
    let reader = BudgetReader {
        reader: BufReader::new(File::open(path).map_err(|e| e.to_string())?),
        row_bytes: &row_bytes,
        total: 0,
        cancelled,
    };
    let mut parser = serde_json::Deserializer::from_reader(reader);
    serde::de::Deserializer::deserialize_any(
        &mut parser,
        DocumentVisitor {
            row_bytes: &row_bytes,
            cancelled,
            on_row,
        },
    )
    .map_err(|e| e.to_string())?;
    row_bytes.set(0);
    parser.end().map_err(|e| e.to_string())?;
    if cancelled() {
        return Err(TABLE_IMPORT_CANCELLED.into());
    }
    Ok(())
}

pub(super) fn stream_json_rows(
    path: &Path,
    cancelled: &dyn Fn() -> bool,
    on_row: &mut dyn FnMut(u64, JsonRow) -> Result<(), String>,
) -> Result<(), String> {
    if !is_json_lines_path(path) {
        return stream_json_document_rows(path, cancelled, on_row);
    }
    let mut reader = BufReader::new(File::open(path).map_err(|e| e.to_string())?);
    let mut line = Vec::new();
    let mut line_number = 0;
    let mut total = 0_u64;
    loop {
        if cancelled() {
            return Err(TABLE_IMPORT_CANCELLED.into());
        }
        line.clear();
        let count = reader
            .by_ref()
            .take(JSON_ROW_BYTES as u64 + 1)
            .read_until(b'\n', &mut line)
            .map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > MAX_JSON_IMPORT_FILE_BYTES {
            return Err("JSON source exceeds 512 MiB".into());
        }
        if count > JSON_ROW_BYTES {
            return Err("JSON record exceeds 1 MiB".into());
        }
        line_number += 1;
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let mut parser = serde_json::Deserializer::from_slice(&line);
        let row = RowSeed
            .deserialize(&mut parser)
            .map_err(|e| format!("Invalid JSON object on line {line_number}: {e}"))?;
        parser.end().map_err(|e| e.to_string())?;
        on_row(line_number, row)?;
    }
    Ok(())
}
