//! Export xlsx for table operations.

use super::limits::{XLSX_MAX_CELL_CHARS, XLSX_MAX_COLUMNS, XLSX_MAX_ROWS};
use serde_json::Value;
use std::fs::File;
use std::io::Write;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

/// Writes a standards-compatible XLSX archive one row at a time. Values are
/// encoded as inline strings or scalar cells so memory use stays bounded by a
/// single database page and the archive never needs a shared-string table.
pub(super) struct StreamingXlsxWriter {
    pub(super) archive: ZipWriter<File>,
    pub(super) columns: usize,
    pub(super) sheet_row: u64,
    pub(super) sheet_started: bool,
    pub(super) auto_filter: bool,
}

impl StreamingXlsxWriter {
    pub(super) fn new(file: File, auto_filter: bool) -> Self {
        Self {
            archive: ZipWriter::new(file),
            columns: 0,
            sheet_row: 0,
            sheet_started: false,
            auto_filter,
        }
    }

    pub(super) fn options() -> SimpleFileOptions {
        SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
    }

    pub(super) fn write_header(&mut self, columns: &[String]) -> Result<(), String> {
        if self.sheet_started {
            return Err("XLSX worksheet header was already written".to_string());
        }
        if columns.len() > XLSX_MAX_COLUMNS {
            return Err(format!(
                "XLSX supports at most {XLSX_MAX_COLUMNS} columns; export has {}",
                columns.len()
            ));
        }

        self.columns = columns.len();
        self.archive
            .start_file("xl/worksheets/sheet1.xml", Self::options())
            .map_err(|error| error.to_string())?;
        self.archive
            .write_all(
                br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>"#,
            )
            .map_err(|error| error.to_string())?;
        if !columns.is_empty() {
            self.archive
                .write_all(b"<cols><col min=\"1\" max=\"")
                .map_err(|error| error.to_string())?;
            write!(self.archive, "{}", columns.len()).map_err(|error| error.to_string())?;
            self.archive
                .write_all(b"\" width=\"16\" customWidth=\"1\"/></cols>")
                .map_err(|error| error.to_string())?;
        }
        self.archive
            .write_all(b"<sheetData>")
            .map_err(|error| error.to_string())?;
        self.sheet_started = true;

        if !columns.is_empty() {
            self.sheet_row = 1;
            write!(self.archive, "<row r=\"{}\">", self.sheet_row)
                .map_err(|error| error.to_string())?;
            for (index, column) in columns.iter().enumerate() {
                let reference = xlsx_cell_reference(index, self.sheet_row)?;
                self.write_inline_string_cell(&reference, column, Some(1))?;
            }
            self.archive
                .write_all(b"</row>")
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub(super) fn write_row(&mut self, row: &[Value]) -> Result<(), String> {
        if !self.sheet_started {
            return Err("XLSX worksheet header must be written before rows".to_string());
        }
        if self.sheet_row >= XLSX_MAX_ROWS {
            return Err(format!(
                "XLSX supports at most {XLSX_MAX_ROWS} rows including the header"
            ));
        }
        self.sheet_row += 1;
        write!(self.archive, "<row r=\"{}\">", self.sheet_row)
            .map_err(|error| error.to_string())?;
        for index in 0..self.columns {
            let reference = xlsx_cell_reference(index, self.sheet_row)?;
            self.write_value_cell(&reference, row.get(index).unwrap_or(&Value::Null))?;
        }
        self.archive
            .write_all(b"</row>")
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(super) fn write_value_cell(
        &mut self,
        reference: &str,
        value: &Value,
    ) -> Result<(), String> {
        match value {
            Value::Null => {
                write!(self.archive, "<c r=\"{reference}\"/>").map_err(|error| error.to_string())
            }
            Value::Bool(value) => write!(
                self.archive,
                "<c r=\"{reference}\" t=\"b\"><v>{}</v></c>",
                if *value { 1 } else { 0 }
            )
            .map_err(|error| error.to_string()),
            Value::Number(value) => {
                let raw = value.to_string();
                let digits = raw.trim_start_matches('-');
                let loses_integer_precision = !digits.contains(['.', 'e', 'E'])
                    && digits
                        .chars()
                        .filter(|character| character.is_ascii_digit())
                        .count()
                        > 15;
                if loses_integer_precision {
                    self.write_inline_string_cell(reference, &raw, None)
                } else {
                    write!(self.archive, "<c r=\"{reference}\"><v>{raw}</v></c>")
                        .map_err(|error| error.to_string())
                }
            }
            Value::String(value) => self.write_inline_string_cell(reference, value, None),
            Value::Array(_) | Value::Object(_) => {
                self.write_inline_string_cell(reference, &value.to_string(), None)
            }
        }
    }

    pub(super) fn write_inline_string_cell(
        &mut self,
        reference: &str,
        value: &str,
        style: Option<u8>,
    ) -> Result<(), String> {
        let escaped = xlsx_escape_text(value)?;
        match style {
            Some(style) => write!(
                self.archive,
                "<c r=\"{reference}\" s=\"{style}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{escaped}</t></is></c>"
            ),
            None => write!(
                self.archive,
                "<c r=\"{reference}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{escaped}</t></is></c>"
            ),
        }
        .map_err(|error| error.to_string())
    }

    pub(super) fn finish(mut self) -> Result<(), String> {
        if !self.sheet_started {
            self.write_header(&[])?;
        }
        self.archive
            .write_all(b"</sheetData>")
            .map_err(|error| error.to_string())?;
        if self.auto_filter && self.columns > 0 && self.sheet_row > 0 {
            let last_column = xlsx_column_name(self.columns - 1)?;
            write!(
                self.archive,
                "<autoFilter ref=\"A1:{last_column}{}\"/>",
                self.sheet_row
            )
            .map_err(|error| error.to_string())?;
        }
        self.archive
            .write_all(b"</worksheet>")
            .map_err(|error| error.to_string())?;

        self.write_package_part(
            "[Content_Types].xml",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>"#,
        )?;
        self.write_package_part(
            "_rels/.rels",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        )?;
        self.write_package_part(
            "xl/workbook.xml",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        )?;
        self.write_package_part(
            "xl/_rels/workbook.xml.rels",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#,
        )?;
        self.write_package_part(
            "xl/styles.xml",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#,
        )?;

        let file = self.archive.finish().map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())
    }

    pub(super) fn write_package_part(&mut self, name: &str, contents: &[u8]) -> Result<(), String> {
        self.archive
            .start_file(name, Self::options())
            .map_err(|error| error.to_string())?;
        self.archive
            .write_all(contents)
            .map_err(|error| error.to_string())
    }
}

pub(super) fn xlsx_column_name(index: usize) -> Result<String, String> {
    if index >= XLSX_MAX_COLUMNS {
        return Err(format!(
            "XLSX column index {index} exceeds the format limit"
        ));
    }
    let mut value = index + 1;
    let mut name = String::new();
    while value > 0 {
        let remainder = (value - 1) % 26;
        name.insert(0, (b'A' + remainder as u8) as char);
        value = (value - 1) / 26;
    }
    Ok(name)
}

pub(super) fn xlsx_cell_reference(column: usize, row: u64) -> Result<String, String> {
    Ok(format!("{}{row}", xlsx_column_name(column)?))
}

pub(super) fn xlsx_escape_text(value: &str) -> Result<String, String> {
    if value.chars().count() > XLSX_MAX_CELL_CHARS {
        return Err(format!(
            "XLSX cell text exceeds the {XLSX_MAX_CELL_CHARS} character limit"
        ));
    }
    if value.chars().any(|character| {
        let code = character as u32;
        code < 0x20 && !matches!(character, '\t' | '\n' | '\r')
    }) {
        return Err("XLSX cell text contains an unsupported XML control character".to_string());
    }

    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '\"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(character),
        }
    }
    Ok(escaped)
}
