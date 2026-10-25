//! Bounded producers for real, independently interrupted format acceptances.
use super::super::import_types::{
    TableCsvColumnMapping, TableCsvImportOptions, TableImportFormat, TableImportTextEncoding,
};
use super::import_jobs::Fixture;
use sha2::{Digest, Sha256};
use std::{io::Write, path::Path};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

pub(super) fn format(name: &str) -> anyhow::Result<TableImportFormat> {
    Ok(match name {
        "csv" => TableImportFormat::Csv,
        "json" => TableImportFormat::Json,
        "xlsx" => TableImportFormat::Xlsx,
        _ => anyhow::bail!("unsupported fixture format"),
    })
}
pub(super) fn name(format: TableImportFormat) -> &'static str {
    match format {
        TableImportFormat::Csv => "csv",
        TableImportFormat::Json => "json",
        TableImportFormat::Xlsx => "xlsx",
    }
}
pub(super) fn payload(format: TableImportFormat, id: u64) -> String {
    let digest = format!("{:x}", Sha256::digest(id.to_le_bytes()));
    match format {
        TableImportFormat::Json => digest,
        _ => format!("customer,{id};\"雪 & café\"\n{digest}"),
    }
}
pub(super) fn optional(format: TableImportFormat, id: u64) -> Option<&'static str> {
    match id % 3 {
        0 => Some("provided"),
        2 if matches!(format, TableImportFormat::Json) => Some("factory"),
        _ => None,
    }
}
pub(super) fn csv_options(format: TableImportFormat) -> Option<TableCsvImportOptions> {
    matches!(format, TableImportFormat::Csv).then(|| TableCsvImportOptions {
        delimiter: Some(";".into()),
        first_row_header: Some(true),
        title_row: Some(2),
        data_start_row: Some(4),
        last_data_row: Some(0),
        column_mapping: [None, Some("payload"), Some("id"), Some("optional")]
            .into_iter()
            .enumerate()
            .map(|(source_index, target)| TableCsvColumnMapping {
                source_index,
                target_column: target.map(str::to_string),
            })
            .collect(),
        empty_fields_as_null: Some(true),
        trim_values: Some(false),
        encoding: Some(TableImportTextEncoding::Utf8),
    })
}
pub(super) async fn fixture() -> Fixture {
    use sqlx::Connection;
    let mut fixture = Fixture::new().await;
    let mut target = fixture.target().await;
    sqlx::query("ALTER TABLE target ADD COLUMN unmapped TEXT DEFAULT 'factory'")
        .execute(&mut target)
        .await
        .unwrap();
    target.close().await.unwrap();
    let mut unmapped = fixture
        .columns
        .iter()
        .find(|c| c.name == "optional")
        .unwrap()
        .clone();
    unmapped.name = "unmapped".into();
    fixture.columns.push(unmapped);
    fixture
}
pub(super) fn write_source(
    path: &Path,
    format: TableImportFormat,
    rows: u64,
) -> anyhow::Result<()> {
    let file = std::io::BufWriter::new(std::fs::File::create_new(path)?);
    match format {
        TableImportFormat::Json => {
            let mut output = file;
            output.write_all(b"[")?;
            for id in 0..rows {
                if id != 0 {
                    output.write_all(b",")?;
                }
                write!(
                    output,
                    "{{\"id\":{id},\"payload\":\"{}\"",
                    payload(format, id)
                )?;
                match id % 3 {
                    0 => output.write_all(b",\"optional\":\"provided\"")?,
                    1 => output.write_all(b",\"optional\":null")?,
                    _ => (),
                }
                output.write_all(b"}")?;
            }
            output.write_all(b"]")?;
            output.flush()?;
        }
        TableImportFormat::Csv => {
            let mut output = csv::WriterBuilder::new()
                .delimiter(b';')
                .flexible(true)
                .from_writer(file);
            output.write_record(["preamble, not data"])?;
            output.write_record([
                "discard_me",
                "payload_source",
                "id_source",
                "optional_source",
            ])?;
            output.write_record(["skip", "not imported", "-1", "skip"])?;
            for id in 0..rows {
                output.write_record([
                    "ignored",
                    &payload(format, id),
                    &id.to_string(),
                    if id % 3 == 0 { "provided" } else { "" },
                ])?;
            }
            output.flush()?;
        }
        TableImportFormat::Xlsx => write_xlsx(file, rows)?,
    }
    Ok(())
}
fn write_xlsx<W: Write + std::io::Seek>(file: W, rows: u64) -> anyhow::Result<()> {
    let mut output = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (part, body) in [
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="workbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        ),
        (
            "xl/workbook.xml",
            r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Customers" sheetId="1" r:id="first"/></sheets></workbook>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="first" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/custom.xml"/><Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>"#,
        ),
    ] {
        output.start_file(part, options)?;
        output.write_all(body.as_bytes())?;
    }
    output.start_file("xl/sharedStrings.xml", options)?;
    write!(
        output,
        r#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{}" uniqueCount="{}"><si><t>provided</t></si>"#,
        rows + rows.div_ceil(3),
        rows + 1
    )?;
    for id in 0..rows {
        write!(
            output,
            "<si><t>{}</t></si>",
            payload(TableImportFormat::Xlsx, id).replace('&', "&amp;")
        )?;
    }
    output.write_all(b"</sst>")?;
    output.start_file("xl/worksheets/custom.xml", options)?;
    output.write_all(br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>id</t></is></c><c r="B1" t="inlineStr"><is><t>payload</t></is></c><c r="C1" t="inlineStr"><is><t>optional</t></is></c></row>"#)?;
    for id in 0..rows {
        let row = id + 2;
        let index = id + 1;
        write!(
            output,
            r#"<row r="{row}"><c r="A{row}"><v>{id}</v></c><c r="B{row}" t="s"><v>{index}</v></c>"#
        )?;
        match id % 3 {
            0 => write!(output, r#"<c r="C{row}" t="s"><v>0</v></c>"#)?,
            1 => write!(output, r#"<c r="C{row}"/>"#)?,
            _ => (),
        }
        output.write_all(b"</row>")?;
    }
    output.write_all(b"</sheetData></worksheet>")?;
    output.finish()?.flush()?;
    Ok(())
}

#[tokio::test]
async fn format_producers_preserve_escaped_values_aliases_nulls_and_unmapped_defaults() {
    use super::super::import_snapshot::normalize_import_snapshot;
    use sqlx::Connection;
    for format in [
        TableImportFormat::Json,
        TableImportFormat::Csv,
        TableImportFormat::Xlsx,
    ] {
        let fixture = fixture().await;
        let source = fixture
            .directory
            .path()
            .join(format!("source.{}", name(format)));
        write_source(&source, format, 17).unwrap();
        let digest = super::super::import_preview::import_file_digest(&source).unwrap();
        let directory = fixture
            .jobs
            .begin_file_import_preparation("p", "small", &digest)
            .await
            .unwrap();
        let snapshot = normalize_import_snapshot(
            source,
            digest,
            format,
            Some(true),
            csv_options(format),
            fixture.columns.clone(),
            tokio::sync::watch::channel(false).1,
            directory,
        )
        .await
        .unwrap();
        assert_eq!(
            snapshot.plan.presence_column.is_some(),
            matches!(format, TableImportFormat::Json)
        );
        fixture.publish(snapshot).await;
        let mut target = fixture.target().await;
        let rows: Vec<(i64, String, Option<String>, String)> =
            sqlx::query_as("SELECT id,payload,optional,unmapped FROM target ORDER BY id")
                .fetch_all(&mut target)
                .await
                .unwrap();
        assert_eq!(rows.len(), 17);
        for (index, (id, value, nullable, defaulted)) in rows.into_iter().enumerate() {
            assert_eq!(id, index as i64);
            assert_eq!(value, payload(format, id as u64));
            assert_eq!(nullable.as_deref(), optional(format, id as u64));
            assert_eq!(defaulted, "factory");
        }
        target.close().await.unwrap();
    }
}
