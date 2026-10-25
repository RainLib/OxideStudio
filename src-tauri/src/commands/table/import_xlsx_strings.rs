//! Disk-backed shared-string lookup: data/index are anonymous temporary files.
use super::import_xlsx_package::XmlPart;
use super::import_xlsx_values::validate_text;
use quick_xml::events::Event;
use std::{
    fs::File,
    io::{BufWriter, Read, Seek, SeekFrom, Write},
};

const SCRATCH_LIMIT: u64 = 512 * 1024 * 1024;
pub(super) struct SharedStrings {
    data: File,
    index: File,
    count: u64,
    data_bytes: u64,
    last: Option<(u64, String)>,
}
impl SharedStrings {
    pub(super) fn empty() -> Result<Self, String> {
        Ok(Self {
            data: tempfile::tempfile().map_err(|e| e.to_string())?,
            index: tempfile::tempfile().map_err(|e| e.to_string())?,
            count: 0,
            data_bytes: 0,
            last: None,
        })
    }
    pub(super) fn read(xml: &mut XmlPart<'_>) -> Result<Self, String> {
        xml.expect_root(b"sst")?;
        let mut table = Self::empty()?;
        let mut data = BufWriter::with_capacity(64 * 1024, &mut table.data);
        let mut index = BufWriter::with_capacity(64 * 1024, &mut table.index);
        let mut value = None::<String>;
        let mut in_text = false;
        let mut phonetic = 0;
        loop {
            match xml.next()? {
                Event::Start(event) => match event.local_name().as_ref() {
                    b"si" => {
                        if value.is_some() {
                            return Err("Nested XLSX shared strings".into());
                        }
                        value = Some(String::new());
                        xml.begin_record();
                    }
                    b"rPh" => phonetic += 1,
                    b"t" if phonetic == 0 => in_text = true,
                    _ => {}
                },
                Event::Text(text) if in_text => {
                    let text = text.unescape().map_err(|e| e.to_string())?;
                    let value = value.as_mut().ok_or("XLSX shared text outside item")?;
                    value.push_str(&text);
                    validate_text(value)?;
                }
                Event::CData(text) if in_text => {
                    let text = xml.text(&text)?;
                    let value = value.as_mut().ok_or("XLSX shared text outside item")?;
                    value.push_str(&text);
                    validate_text(value)?;
                }
                Event::End(event) => match event.local_name().as_ref() {
                    b"t" => in_text = false,
                    b"rPh" => {
                        if phonetic == 0 {
                            return Err("Invalid XLSX phonetic text".into());
                        }
                        phonetic -= 1;
                    }
                    b"si" => {
                        let value = value.take().ok_or("Invalid XLSX shared-string item")?;
                        let next = table.data_bytes + value.len() as u64;
                        if next + (table.count + 1) * 16 > SCRATCH_LIMIT {
                            return Err("XLSX shared-string scratch budget exceeds 512 MiB".into());
                        }
                        index
                            .write_all(&table.data_bytes.to_le_bytes())
                            .map_err(|e| e.to_string())?;
                        index
                            .write_all(&(value.len() as u64).to_le_bytes())
                            .map_err(|e| e.to_string())?;
                        data.write_all(value.as_bytes())
                            .map_err(|e| e.to_string())?;
                        table.data_bytes = next;
                        table.count += 1;
                        xml.end_record();
                    }
                    _ => {}
                },
                Event::Eof => break,
                _ => {}
            }
        }
        if value.is_some() {
            return Err("Incomplete XLSX shared string".into());
        }
        data.flush().map_err(|e| e.to_string())?;
        index.flush().map_err(|e| e.to_string())?;
        drop(data);
        drop(index);
        Ok(table)
    }
    pub(super) fn get(&mut self, id: u64) -> Result<String, String> {
        if let Some((cached, value)) = &self.last {
            if *cached == id {
                return Ok(value.clone());
            }
        }
        if id >= self.count {
            return Err("XLSX shared-string index is out of range".into());
        }
        self.index
            .seek(SeekFrom::Start(id * 16))
            .map_err(|e| e.to_string())?;
        let mut record = [0; 16];
        self.index
            .read_exact(&mut record)
            .map_err(|e| e.to_string())?;
        let offset = u64::from_le_bytes(record[..8].try_into().unwrap());
        let length = u64::from_le_bytes(record[8..].try_into().unwrap());
        if length > 32767 * 4
            || offset
                .checked_add(length)
                .is_none_or(|end| end > self.data_bytes)
        {
            return Err("Invalid XLSX shared-string index record".into());
        }
        self.data
            .seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut bytes = vec![0; length as usize];
        self.data
            .read_exact(&mut bytes)
            .map_err(|e| e.to_string())?;
        let value = String::from_utf8(bytes).map_err(|e| e.to_string())?;
        self.last = Some((id, value.clone()));
        Ok(value)
    }
}
