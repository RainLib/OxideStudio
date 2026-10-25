//! First-sheet XLSX row stream, including shared/inline strings and cached formula values.
use super::import_types::ImportRow;
use super::import_xlsx_package::{attributes, relationship_target, Package};
use super::import_xlsx_strings::SharedStrings;
use super::import_xlsx_values::{date_format, scalar, validate_text, validate_xlsx_headers};
use super::limits::{TABLE_IMPORT_CANCELLED, XLSX_MAX_COLUMNS, XLSX_MAX_ROWS};
use quick_xml::events::Event;
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};

const ROW_BYTES: usize = 2 * 1024 * 1024;
#[derive(Debug)]
pub(super) struct SheetInfo {
    pub(super) sheet_name: String,
    pub(super) source_columns: Vec<String>,
    pub(super) total_rows: u64,
}
struct Workbook {
    name: String,
    path: String,
    date1904: bool,
    dates: Vec<bool>,
    shared_path: Option<String>,
}
fn workbook(package: &mut Package, cancel: &dyn Fn() -> bool) -> Result<Workbook, String> {
    let mut first = None;
    let mut date1904 = false;
    {
        let mut xml = package.part("xl/workbook.xml", cancel, true)?;
        xml.expect_root(b"workbook")?;
        loop {
            match xml.next()? {
                Event::Start(event) => {
                    let name = event.local_name();
                    if name.as_ref() == b"workbookPr" {
                        date1904 = attributes(&event, &xml)?
                            .get("date1904")
                            .is_some_and(|s| s == "1" || s == "true");
                    }
                    if name.as_ref() == b"sheet" && first.is_none() {
                        let attrs = attributes(&event, &xml)?;
                        let name = attrs.get("name").ok_or("Missing XLSX sheet name")?.clone();
                        let id = attrs
                            .iter()
                            .find(|(key, _)| key.rsplit(':').next() == Some("id"))
                            .map(|(_, value)| value.clone())
                            .ok_or("Missing XLSX sheet relationship")?;
                        first = Some((name, id));
                    }
                }
                Event::Eof => break,
                _ => {}
            }
        }
    }
    let (name, id) = first.ok_or("The XLSX workbook does not contain a worksheet")?;
    let mut path = None;
    let mut shared_path = None;
    let mut styles_path = None;
    {
        let mut xml = package.part("xl/_rels/workbook.xml.rels", cancel, true)?;
        xml.expect_root(b"Relationships")?;
        loop {
            match xml.next()? {
                Event::Start(event) if event.local_name().as_ref() == b"Relationship" => {
                    let attrs = attributes(&event, &xml)?;
                    if attrs.get("Id") == Some(&id) {
                        if path.is_some() {
                            return Err("Duplicate XLSX worksheet relationship".into());
                        }
                        if attrs
                            .get("TargetMode")
                            .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
                            || !attrs
                                .get("Type")
                                .is_some_and(|kind| kind.ends_with("/worksheet"))
                        {
                            return Err("The first XLSX sheet is not an internal worksheet".into());
                        }
                        path = Some(relationship_target(
                            attrs.get("Target").ok_or("Missing XLSX worksheet target")?,
                        )?);
                    }
                    if let Some(kind) = attrs.get("Type") {
                        let slot = if kind.ends_with("/sharedStrings") {
                            Some(&mut shared_path)
                        } else if kind.ends_with("/styles") {
                            Some(&mut styles_path)
                        } else {
                            None
                        };
                        if let Some(slot) = slot {
                            if attrs
                                .get("TargetMode")
                                .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
                            {
                                return Err("External XLSX metadata relationship".into());
                            }
                            let target = relationship_target(
                                attrs.get("Target").ok_or("Missing XLSX metadata target")?,
                            )?;
                            if slot.replace(target).is_some() {
                                return Err("Duplicate XLSX metadata relationship".into());
                            }
                        }
                    }
                }
                Event::Eof => break,
                _ => {}
            }
        }
    }
    if shared_path.is_none() && package.contains("xl/sharedStrings.xml") {
        shared_path = Some("xl/sharedStrings.xml".into());
    }
    if styles_path.is_none() && package.contains("xl/styles.xml") {
        styles_path = Some("xl/styles.xml".into());
    }
    let mut dates = Vec::new();
    if let Some(styles_path) = styles_path {
        let mut xml = package.part(&styles_path, cancel, true)?;
        xml.expect_root(b"styleSheet")?;
        let mut formats = BTreeMap::new();
        let mut in_xfs = false;
        loop {
            match xml.next()? {
                Event::Start(event) => match event.local_name().as_ref() {
                    b"numFmt" => {
                        let attrs = attributes(&event, &xml)?;
                        if let (Some(id), Some(format)) =
                            (attrs.get("numFmtId"), attrs.get("formatCode"))
                        {
                            let id = id
                                .parse::<u32>()
                                .map_err(|_| "Invalid XLSX number format")?;
                            formats.insert(id, date_format(format));
                            if formats.len() > 65536 {
                                return Err("XLSX number-format budget exceeded".into());
                            }
                        }
                    }
                    b"cellXfs" => in_xfs = true,
                    b"xf" if in_xfs => {
                        let attrs = attributes(&event, &xml)?;
                        let id = attrs
                            .get("numFmtId")
                            .map(|v| v.parse::<u32>())
                            .transpose()
                            .map_err(|_| "Invalid XLSX style")?
                            .unwrap_or(0);
                        dates.push(
                            formats
                                .get(&id)
                                .copied()
                                .unwrap_or(matches!(id,14..=22|45..=47)),
                        );
                        if dates.len() > 65536 {
                            return Err("XLSX style budget exceeded".into());
                        }
                    }
                    _ => {}
                },
                Event::End(event) if event.local_name().as_ref() == b"cellXfs" => in_xfs = false,
                Event::Eof => break,
                _ => {}
            }
        }
    }
    Ok(Workbook {
        name,
        path: path.ok_or("Missing first XLSX worksheet")?,
        date1904,
        dates,
        shared_path,
    })
}
fn coordinate(reference: &str) -> Result<(u64, usize), String> {
    let mut column = 0_usize;
    let mut row = 0_u64;
    let mut digits = false;
    for byte in reference.bytes() {
        if byte.is_ascii_uppercase() && !digits {
            column = column
                .checked_mul(26)
                .and_then(|n| n.checked_add((byte - b'A' + 1) as usize))
                .ok_or("Invalid XLSX column")?;
        } else if byte.is_ascii_digit() {
            digits = true;
            row = row
                .checked_mul(10)
                .and_then(|n| n.checked_add((byte - b'0') as u64))
                .ok_or("Invalid XLSX row")?;
        } else {
            return Err("Invalid XLSX cell reference".into());
        }
    }
    if !digits || row == 0 || row > XLSX_MAX_ROWS || column == 0 || column > XLSX_MAX_COLUMNS {
        return Err("XLSX cell reference exceeds worksheet limits".into());
    }
    Ok((row, column - 1))
}
struct Cell {
    column: usize,
    kind: String,
    date: bool,
    raw: Option<String>,
    in_value: bool,
    in_inline: bool,
    in_text: bool,
    phonetic: usize,
}
struct Row {
    number: u64,
    explicit: bool,
    cells: BTreeMap<usize, (Value, Option<String>)>,
    bytes: usize,
    next_column: usize,
}
fn finish_row(
    row: Row,
    headers: &mut Vec<String>,
    offset: &mut usize,
    total: &mut u64,
    on_row: &mut dyn FnMut(u64, ImportRow) -> Result<(), String>,
) -> Result<(), String> {
    let used = row
        .cells
        .iter()
        .filter(|(_, value)| !value.0.is_null())
        .map(|(column, _)| *column)
        .collect::<Vec<_>>();
    let (Some(&first), Some(&last)) = (used.first(), used.last()) else {
        return Ok(());
    };
    if headers.is_empty() {
        for column in first..=last {
            let text = row
                .cells
                .get(&column)
                .map(|(value, label)| {
                    label.clone().unwrap_or_else(|| match value {
                        Value::String(text) => text.clone(),
                        Value::Number(number) if number.is_f64() => {
                            number.as_f64().unwrap().to_string()
                        }
                        Value::Null => String::new(),
                        _ => value.to_string(),
                    })
                })
                .unwrap_or_default();
            headers.push(text.trim().to_owned());
        }
        validate_xlsx_headers(headers)?;
        *offset = first;
        return Ok(());
    }
    if first < *offset || last >= *offset + headers.len() {
        return Err("An XLSX row contains values beyond the header columns".into());
    }
    let mut cells = row.cells;
    let values = headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            (
                header.clone(),
                cells
                    .remove(&(*offset + index))
                    .map(|(value, _)| value)
                    .unwrap_or(Value::Null),
            )
        })
        .collect::<ImportRow>();
    if serde_json::to_vec(&values)
        .map_err(|e| e.to_string())?
        .len()
        > ROW_BYTES
    {
        return Err("XLSX normalized row exceeds 2 MiB".into());
    }
    *total += 1;
    on_row(row.number, values)
}

pub(super) fn stream_xlsx_rows(
    path: &Path,
    cancel: &dyn Fn() -> bool,
    on_row: &mut dyn FnMut(u64, ImportRow) -> Result<(), String>,
) -> Result<SheetInfo, String> {
    if cancel() {
        return Err(TABLE_IMPORT_CANCELLED.into());
    }
    let mut package = Package::open(path)?;
    let workbook = workbook(&mut package, cancel)?;
    let mut strings = match workbook.shared_path.as_ref() {
        Some(path) => Some(SharedStrings::read(
            &mut package.part(path, cancel, false)?,
        )?),
        None => None,
    };
    let mut xml = package.part(&workbook.path, cancel, false)?;
    xml.expect_root(b"worksheet")?;
    let mut headers = Vec::new();
    let mut offset = 0;
    let mut total = 0;
    let mut in_data = false;
    let mut saw_data = false;
    let mut next_row = 1;
    let mut row = None::<Row>;
    let mut cell = None::<Cell>;
    loop {
        match xml.next()? {
            Event::Start(event) => match event.local_name().as_ref() {
                b"sheetData" => {
                    if saw_data {
                        return Err("Duplicate XLSX sheetData".into());
                    }
                    saw_data = true;
                    in_data = true;
                }
                b"row" if in_data => {
                    if row.is_some() {
                        return Err("Nested XLSX row".into());
                    }
                    let attrs = attributes(&event, &xml)?;
                    let number = attrs
                        .get("r")
                        .map(|v| v.parse::<u64>())
                        .transpose()
                        .map_err(|_| "Invalid XLSX row index")?
                        .unwrap_or(next_row);
                    if number < next_row || number == 0 || number > XLSX_MAX_ROWS {
                        return Err("Invalid or unordered XLSX row index".into());
                    }
                    row = Some(Row {
                        number,
                        explicit: attrs.contains_key("r"),
                        cells: BTreeMap::new(),
                        bytes: 0,
                        next_column: 0,
                    });
                    xml.begin_record();
                }
                b"c" if in_data => {
                    if cell.is_some() {
                        return Err("Nested XLSX cell".into());
                    }
                    let row = row.as_mut().ok_or("XLSX cell outside row")?;
                    let attrs = attributes(&event, &xml)?;
                    let column = if let Some(reference) = attrs.get("r") {
                        let (number, column) = coordinate(reference)?;
                        if !row.explicit && row.cells.is_empty() {
                            row.number = number;
                        }
                        if number != row.number {
                            return Err("XLSX cell and row coordinates disagree".into());
                        }
                        column
                    } else {
                        row.next_column
                    };
                    if column < row.next_column || column >= XLSX_MAX_COLUMNS {
                        return Err("Duplicate or unordered XLSX cell column".into());
                    }
                    row.next_column = column + 1;
                    let style = attrs
                        .get("s")
                        .map(|v| v.parse::<usize>())
                        .transpose()
                        .map_err(|_| "Invalid XLSX style index")?;
                    let date = match style {
                        Some(index) if index >= workbook.dates.len() => {
                            if index != 0 {
                                return Err("XLSX style index is out of range".into());
                            }
                            false
                        }
                        Some(index) => workbook.dates[index],
                        None => false,
                    };
                    cell = Some(Cell {
                        column,
                        kind: attrs.get("t").cloned().unwrap_or_default(),
                        date,
                        raw: None,
                        in_value: false,
                        in_inline: false,
                        in_text: false,
                        phonetic: 0,
                    });
                }
                b"v" if cell.is_some() => {
                    let cell = cell.as_mut().unwrap();
                    if cell.raw.is_some() {
                        return Err("Duplicate XLSX cached value".into());
                    }
                    cell.raw = Some(String::new());
                    cell.in_value = true;
                }
                b"is" if cell.is_some() => {
                    let cell = cell.as_mut().unwrap();
                    cell.in_inline = true;
                    cell.raw = Some(String::new());
                }
                b"rPh" if cell.as_ref().is_some_and(|cell| cell.in_inline) => {
                    cell.as_mut().unwrap().phonetic += 1
                }
                b"t" if cell
                    .as_ref()
                    .is_some_and(|cell| cell.in_inline && cell.phonetic == 0) =>
                {
                    cell.as_mut().unwrap().in_text = true
                }
                _ => {}
            },
            Event::Text(text)
                if cell
                    .as_ref()
                    .is_some_and(|cell| cell.in_value || cell.in_text) =>
            {
                let text = text.unescape().map_err(|e| e.to_string())?;
                let raw = cell
                    .as_mut()
                    .unwrap()
                    .raw
                    .as_mut()
                    .ok_or("Missing XLSX text buffer")?;
                raw.push_str(&text);
                validate_text(raw)?;
            }
            Event::CData(text)
                if cell
                    .as_ref()
                    .is_some_and(|cell| cell.in_value || cell.in_text) =>
            {
                let text = xml.text(&text)?;
                let raw = cell
                    .as_mut()
                    .unwrap()
                    .raw
                    .as_mut()
                    .ok_or("Missing XLSX text buffer")?;
                raw.push_str(&text);
                validate_text(raw)?;
            }
            Event::End(event) => match event.local_name().as_ref() {
                b"v" if cell.is_some() => cell.as_mut().unwrap().in_value = false,
                b"t" if cell.is_some() => cell.as_mut().unwrap().in_text = false,
                b"rPh" if cell.as_ref().is_some_and(|cell| cell.in_inline) => {
                    let cell = cell.as_mut().unwrap();
                    cell.phonetic = cell
                        .phonetic
                        .checked_sub(1)
                        .ok_or("Invalid XLSX phonetic text")?;
                }
                b"is" if cell.is_some() => cell.as_mut().unwrap().in_inline = false,
                b"c" if in_data => {
                    let cell = cell.take().ok_or("Invalid XLSX cell close")?;
                    let value = if cell.kind == "s" {
                        match cell.raw.as_deref() {
                            Some(raw) => Value::String(
                                strings
                                    .as_mut()
                                    .ok_or("Missing XLSX shared-string table")?
                                    .get(
                                        raw.parse::<u64>()
                                            .map_err(|_| "Invalid XLSX shared-string index")?,
                                    )?,
                            ),
                            None => Value::Null,
                        }
                    } else {
                        scalar(
                            &cell.kind,
                            cell.raw.as_deref(),
                            cell.date,
                            workbook.date1904,
                        )?
                    };
                    let label = if cell.kind == "e" { cell.raw } else { None };
                    let row = row.as_mut().ok_or("XLSX cell outside row")?;
                    row.bytes += serde_json::to_vec(&value).map_err(|e| e.to_string())?.len();
                    if row.bytes > ROW_BYTES {
                        return Err("XLSX decoded row exceeds 2 MiB".into());
                    }
                    row.cells.insert(cell.column, (value, label));
                }
                b"row" if in_data => {
                    if cancel() {
                        return Err(TABLE_IMPORT_CANCELLED.into());
                    }
                    let row = row.take().ok_or("Invalid XLSX row close")?;
                    next_row = row.number + 1;
                    finish_row(row, &mut headers, &mut offset, &mut total, on_row)?;
                    xml.end_record();
                }
                b"sheetData" => {
                    in_data = false;
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    if cancel() {
        return Err(TABLE_IMPORT_CANCELLED.into());
    }
    if !saw_data || row.is_some() || cell.is_some() {
        return Err("Incomplete XLSX worksheet data".into());
    }
    if headers.is_empty() {
        return Err("The XLSX worksheet does not contain a header row".into());
    }
    Ok(SheetInfo {
        sheet_name: workbook.name,
        source_columns: headers,
        total_rows: total,
    })
}
