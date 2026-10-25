//! XLSX archive/XML budgets. Parts stay inside ZIP; no relationship is opened as a filesystem path.
use super::limits::{MAX_XLSX_IMPORT_FILE_BYTES, TABLE_IMPORT_CANCELLED};
use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use std::{
    cell::Cell,
    collections::BTreeMap,
    fs::File,
    io::{self, BufReader, Read, Seek, SeekFrom},
    path::Path,
    rc::Rc,
};
use zip::{read::ZipFile, ZipArchive};

pub(super) const MAX_XML_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_METADATA_BYTES: u64 = 16 * 1024 * 1024;
const MAX_XML_EVENT_BYTES: u64 = 512 * 1024;
const MAX_RECORD_XML_BYTES: u64 = 8 * 1024 * 1024;

fn le16(bytes: &[u8], offset: usize) -> u64 {
    u16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap()).into()
}
fn le32(bytes: &[u8], offset: usize) -> u64 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()).into()
}
fn le64(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}

/// Check central-directory bounds before ZipArchive allocates its entry index.
fn validate_directory(file: &mut File) -> Result<(), String> {
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    if length > MAX_XLSX_IMPORT_FILE_BYTES {
        return Err("XLSX source exceeds 512 MiB".into());
    }
    let tail_length = length.min(65535 + 22) as usize;
    file.seek(SeekFrom::End(-(tail_length as i64)))
        .map_err(|e| e.to_string())?;
    let mut tail = vec![0; tail_length];
    file.read_exact(&mut tail).map_err(|e| e.to_string())?;
    let start = (0..tail.len().saturating_sub(21))
        .rev()
        .find(|&i| {
            tail[i..].starts_with(b"PK\x05\x06")
                && i + 22 + le16(&tail, i + 20) as usize == tail.len()
        })
        .ok_or("Invalid XLSX ZIP end record")?;
    let record = &tail[start..];
    if le16(record, 4) != 0 || le16(record, 6) != 0 {
        return Err("Multi-volume XLSX archives are unsupported".into());
    }
    let mut count = le16(record, 10);
    let mut size = le32(record, 12);
    let mut offset = le32(record, 16);
    if count == 65535 || size == u32::MAX as u64 || offset == u32::MAX as u64 {
        let end = length - tail_length as u64 + start as u64;
        if end < 20 {
            return Err("Invalid XLSX ZIP64 locator".into());
        }
        file.seek(SeekFrom::Start(end - 20))
            .map_err(|e| e.to_string())?;
        let mut locator = [0; 20];
        file.read_exact(&mut locator).map_err(|e| e.to_string())?;
        if &locator[..4] != b"PK\x06\x07" || le32(&locator, 4) != 0 || le32(&locator, 16) != 1 {
            return Err("Invalid XLSX ZIP64 locator".into());
        }
        let position = le64(&locator, 8);
        if position.checked_add(56).is_none_or(|v| v > length) {
            return Err("Invalid XLSX ZIP64 offset".into());
        }
        file.seek(SeekFrom::Start(position))
            .map_err(|e| e.to_string())?;
        let mut zip64 = [0; 56];
        file.read_exact(&mut zip64).map_err(|e| e.to_string())?;
        if &zip64[..4] != b"PK\x06\x06" || le32(&zip64, 16) != 0 || le32(&zip64, 20) != 0 {
            return Err("Invalid XLSX ZIP64 directory".into());
        }
        count = le64(&zip64, 32);
        size = le64(&zip64, 40);
        offset = le64(&zip64, 48);
    }
    if count > 4096
        || size > 8 * 1024 * 1024
        || offset.checked_add(size).is_none_or(|end| end > length)
    {
        return Err("XLSX central-directory budget exceeded".into());
    }
    file.rewind().map_err(|e| e.to_string())
}

pub(super) struct Package {
    zip: ZipArchive<File>,
    inflated: Rc<Cell<u64>>,
}
impl Package {
    pub(super) fn open(path: &Path) -> Result<Self, String> {
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        validate_directory(&mut file)?;
        let zip = ZipArchive::new(file).map_err(|e| format!("Unable to read XLSX archive: {e}"))?;
        if zip.len() > 4096 {
            return Err("XLSX archive entry budget exceeded".into());
        }
        Ok(Self {
            zip,
            inflated: Rc::new(Cell::new(0)),
        })
    }
    pub(super) fn contains(&self, name: &str) -> bool {
        self.zip.file_names().any(|item| item == name)
    }
    pub(super) fn part<'a>(
        &'a mut self,
        name: &str,
        cancelled: &'a dyn Fn() -> bool,
        metadata: bool,
    ) -> Result<XmlPart<'a>, String> {
        let file = self
            .zip
            .by_name(name)
            .map_err(|e| format!("Missing or invalid XLSX part {name}: {e}"))?;
        let limit = if metadata {
            MAX_METADATA_BYTES
        } else {
            MAX_XML_BYTES
        };
        if file.size() > limit {
            return Err("XLSX XML part budget exceeded".into());
        }
        let event_bytes = Rc::new(Cell::new(0));
        let span_bytes = Rc::new(Cell::new(0));
        let in_span = Rc::new(Cell::new(false));
        let source = PartRead {
            file,
            inflated: self.inflated.clone(),
            event_bytes: event_bytes.clone(),
            span_bytes: span_bytes.clone(),
            in_span: in_span.clone(),
            part_bytes: 0,
            part_limit: limit,
            cancelled,
        };
        let mut reader = Reader::from_reader(BufReader::with_capacity(8192, source));
        reader.expand_empty_elements(true);
        reader.check_end_names(true);
        Ok(XmlPart {
            reader,
            buffer: Vec::with_capacity(8192),
            event_bytes,
            span_bytes,
            in_span,
            depth: 0,
            started: false,
            closed: false,
        })
    }
}
struct PartRead<'a> {
    file: ZipFile<'a>,
    inflated: Rc<Cell<u64>>,
    event_bytes: Rc<Cell<u64>>,
    span_bytes: Rc<Cell<u64>>,
    in_span: Rc<Cell<bool>>,
    part_bytes: u64,
    part_limit: u64,
    cancelled: &'a dyn Fn() -> bool,
}
impl Read for PartRead<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if (self.cancelled)() {
            return Err(io::Error::other(TABLE_IMPORT_CANCELLED));
        }
        let count = self.file.read(buffer)?;
        let bytes = count as u64;
        self.part_bytes += bytes;
        self.inflated.set(self.inflated.get() + bytes);
        self.event_bytes.set(self.event_bytes.get() + bytes);
        if self.in_span.get() {
            self.span_bytes.set(self.span_bytes.get() + bytes);
        }
        if self.part_bytes > self.part_limit
            || self.inflated.get() > MAX_XML_BYTES
            || self.event_bytes.get() > MAX_XML_EVENT_BYTES
            || self.span_bytes.get() > MAX_RECORD_XML_BYTES
        {
            return Err(io::Error::other(
                "XLSX XML expansion or record budget exceeded",
            ));
        }
        Ok(count)
    }
}
pub(super) struct XmlPart<'a> {
    reader: Reader<BufReader<PartRead<'a>>>,
    buffer: Vec<u8>,
    event_bytes: Rc<Cell<u64>>,
    span_bytes: Rc<Cell<u64>>,
    in_span: Rc<Cell<bool>>,
    depth: usize,
    started: bool,
    closed: bool,
}
impl XmlPart<'_> {
    pub(super) fn expect_root(&mut self, name: &[u8]) -> Result<(), String> {
        loop {
            match self.next()? {
                Event::Start(event) if event.local_name().as_ref() == name => return Ok(()),
                Event::Decl(_) | Event::Comment(_) | Event::PI(_) | Event::Text(_) => {}
                _ => return Err("Unexpected XLSX XML root".into()),
            }
        }
    }
    pub(super) fn begin_record(&mut self) {
        self.span_bytes.set(0);
        self.in_span.set(true);
    }
    pub(super) fn end_record(&mut self) {
        self.span_bytes.set(0);
        self.in_span.set(false);
    }
    pub(super) fn next(&mut self) -> Result<Event<'static>, String> {
        self.event_bytes.set(0);
        self.buffer.clear();
        let event = self
            .reader
            .read_event_into(&mut self.buffer)
            .map_err(|e| format!("Invalid XLSX XML: {e}"))?
            .into_owned();
        match &event {
            Event::DocType(_) => return Err("XLSX XML document types are unsupported".into()),
            Event::Start(_) => {
                if self.closed || self.depth >= 128 {
                    return Err("Invalid XLSX XML root or nesting depth".into());
                }
                self.started = true;
                self.depth += 1;
            }
            Event::End(_) => {
                if self.depth == 0 {
                    return Err("Invalid XLSX XML closing element".into());
                }
                self.depth -= 1;
                if self.depth == 0 {
                    self.closed = true;
                }
            }
            Event::Text(text) if self.depth == 0 && !text.iter().all(u8::is_ascii_whitespace) => {
                return Err("Unexpected XLSX XML outside root".into())
            }
            Event::CData(_) if self.depth == 0 => {
                return Err("Unexpected XLSX XML outside root".into())
            }
            Event::Eof if !self.started || !self.closed || self.depth != 0 => {
                return Err("Incomplete XLSX XML document".into())
            }
            _ => {}
        }
        Ok(event)
    }
    pub(super) fn text(&self, bytes: &[u8]) -> Result<String, String> {
        self.reader
            .decoder()
            .decode(bytes)
            .map(|s| s.into_owned())
            .map_err(|e| e.to_string())
    }
}
pub(super) fn attributes(
    event: &BytesStart<'_>,
    xml: &XmlPart<'_>,
) -> Result<BTreeMap<String, String>, String> {
    event
        .attributes()
        .map(|attribute| {
            let attribute = attribute.map_err(|e| e.to_string())?;
            let key = std::str::from_utf8(attribute.key.as_ref())
                .map_err(|e| e.to_string())?
                .to_owned();
            let raw = xml.text(&attribute.value)?;
            let value = quick_xml::escape::unescape(&raw)
                .map_err(|e| e.to_string())?
                .into_owned();
            Ok((key, value))
        })
        .collect()
}
pub(super) fn relationship_target(target: &str) -> Result<String, String> {
    let decoded = percent_encoding::percent_decode_str(target)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    let text = decoded.replace('\\', "/");
    if text.contains([':', '\0', '?', '#']) {
        return Err("External or invalid XLSX relationship target".into());
    }
    let mut parts = if text.starts_with('/') {
        Vec::new()
    } else {
        vec!["xl"]
    };
    for item in text.split('/') {
        match item {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err("XLSX relationship escapes package root".into());
                }
            }
            _ => parts.push(item),
        }
    }
    Ok(parts.join("/"))
}
