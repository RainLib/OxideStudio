use super::super::import_inference::infer_streamed_import_columns;
use super::super::import_transaction::import_streamed_rows_in_transaction;
use super::super::import_xlsx_stream::stream_xlsx_rows;
use super::*;
use std::{io::Write, sync::atomic::Ordering};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const START: &str =
    r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#;
const END: &str = "</sheetData></worksheet>";
const HEADERS: &str = r#"<row r="1"><c r="A1" t="inlineStr"><is><t>id</t></is></c><c r="B1" t="inlineStr"><is><t>payload</t></is></c></row>"#;
pub(super) fn package(
    sheet: &str,
    strings: Option<&str>,
    styles: Option<&str>,
    target: &str,
) -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("source.xlsx");
    let file = fs::File::create(&path).unwrap();
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for (name,body) in [
        ("[Content_Types].xml",r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>"#.to_owned()),
        ("_rels/.rels", r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#.to_owned()),
        ("xl/workbook.xml",r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><sheets><sheet name="Orders" sheetId="1" r:id="rFirst"/></sheets></workbook>"#.to_owned()),
        ("xl/_rels/workbook.xml.rels",format!(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rFirst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="{target}"/></Relationships>"#)),
        ("xl/worksheets/custom.xml",sheet.to_owned()),
    ] {archive.start_file(name,options).unwrap();archive.write_all(body.as_bytes()).unwrap();}
    if let Some(strings) = strings {
        archive.start_file("xl/sharedStrings.xml", options).unwrap();
        archive.write_all(strings.as_bytes()).unwrap();
    }
    if let Some(styles) = styles {
        archive.start_file("xl/styles.xml", options).unwrap();
        archive.write_all(styles.as_bytes()).unwrap();
    }
    archive.finish().unwrap();
    (directory, path)
}
fn normal(mut value: Value) -> Value {
    if let Value::Number(number) = &value {
        if number.is_f64() {
            let f = number.as_f64().unwrap();
            if f.fract() == 0.0 && f.abs() <= 9007199254740991.0 {
                value = json!(f as i64);
            }
        }
    }
    value
}
#[test]
fn xlsx_stream_matches_legacy_values_for_sparse_rich_styles_and_cached_formulas() {
    use calamine::Reader;
    let headers = [
        "id", "amount", "active", "label", "formula", "day", "issue", "missing",
    ];
    let mut sheet = String::from(
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="5">"#,
    );
    for (index, name) in headers.iter().enumerate() {
        let col = (b'C' + index as u8) as char;
        sheet.push_str(&format!(
            r#"<c r="{col}5" t="inlineStr"><is><t>{name}</t></is></c>"#
        ));
    }
    sheet.push_str(r#"</row><row r="6"><c r="C6"><v>7</v></c><c r="D6"><v>1.5</v></c><c r="E6" t="b"><v>1</v></c><c r="F6" t="s"><v>1</v></c><c r="G6"><f>SUM(C6,35)</f><v>42</v></c><c r="H6" s="1"><v>45292</v></c><c r="I6" t="e"><v>#N/A</v></c></row><row r="7"><c r="C7" s="0"/></row><row r="8"><c r="C8"><v>9</v></c></row></sheetData></worksheet>"#);
    let strings = r#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t></t></si><si><r><t>雪</t></r><r><t> &amp; café</t></r><rPh sb="0" eb="1"><t>phonetic</t></rPh></si></sst>"#;
    let styles = r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>"#;
    let (_dir, path) = package(&sheet, Some(strings), Some(styles), "worksheets/custom.xml");
    let mut observed = Vec::new();
    let mut numbers = Vec::new();
    let info = stream_xlsx_rows(&path, &|| false, &mut |number, row| {
        numbers.push(number);
        observed.push(row);
        Ok(())
    })
    .unwrap();
    assert_eq!(info.sheet_name, "Orders");
    assert_eq!(info.source_columns, headers);
    assert_eq!(info.total_rows, 2);
    assert_eq!(numbers, [6, 8]);
    let mut legacy = calamine::open_workbook_auto(&path).unwrap();
    let range = legacy.worksheet_range("Orders").unwrap();
    let expected = range
        .rows()
        .skip(1)
        .filter(|row| {
            row.iter()
                .any(|cell| !matches!(cell, calamine::Data::Empty))
        })
        .map(|row| {
            headers
                .iter()
                .enumerate()
                .map(|(index, header)| {
                    (
                        (*header).to_owned(),
                        normal(xlsx_cell_value(
                            row.get(index).unwrap_or(&calamine::Data::Empty),
                        )),
                    )
                })
                .collect::<BTreeMap<_, _>>()
        })
        .collect::<Vec<_>>();
    let observed = observed
        .into_iter()
        .map(|row| {
            row.into_iter()
                .map(|(key, value)| (key, normal(value)))
                .collect::<BTreeMap<_, _>>()
        })
        .collect::<Vec<_>>();
    assert_eq!(observed, expected);
    assert_eq!(observed[0]["label"], json!("雪 & café"));
    assert_eq!(observed[0]["day"], json!("45292"));
    assert_eq!(observed[0]["formula"], json!(42));
    assert_eq!(observed[0]["missing"], Value::Null);
}
#[test]
fn xlsx_stream_preserves_empty_shared_strings_exact_numbers_and_string_formula_results() {
    let sheet = format!(
        "{START}{HEADERS}{}{}",
        r#"<row r="2"><c r="A2"><v>9007199254740993</v></c><c r="B2" t="s"><v>0</v></c></row><row r="3"><c r="A3"><v>2</v></c><c r="B3" t="str"><f>TEXT(A3,"000")</f><v>002</v></c></row>"#,
        END
    );
    let (_dir, path) = package(
        &sheet,
        Some("<sst><si/><si><t>unused</t></si></sst>"),
        None,
        "worksheets/custom.xml",
    );
    let mut rows = Vec::new();
    stream_xlsx_rows(&path, &|| false, &mut |_, row| {
        rows.push(row);
        Ok(())
    })
    .unwrap();
    assert_eq!(rows[0]["id"], json!(9007199254740993_i64));
    assert_eq!(rows[0]["payload"], json!(""));
    assert_eq!(rows[1]["payload"], json!("002"));
    let preview = super::super::import_preview::read_xlsx_import_preview(&path).unwrap();
    assert_eq!(preview.sample_rows[0]["id"], json!("9007199254740993"));
    assert_eq!(rows[0]["id"], json!(9007199254740993_i64));
}
#[test]
fn xlsx_stream_ignores_claimed_dimensions_and_handles_implicit_coordinates() {
    let sheet = r#"<worksheet><dimension ref="A1:XFD1048576"/><sheetData><row><c t="inlineStr"><is><t>id</t></is></c><c t="inlineStr"><is><t>payload</t></is></c></row><row><c><v>1</v></c><c t="inlineStr"><is><t>雪</t></is></c></row></sheetData></worksheet>"#;
    let (_dir, path) = package(sheet, None, None, "/xl/worksheets/custom.xml");
    let mut rows = Vec::new();
    stream_xlsx_rows(&path, &|| false, &mut |_, row| {
        rows.push(row);
        Ok(())
    })
    .unwrap();
    assert_eq!(rows[0]["id"], json!(1));
}
#[test]
fn xlsx_stream_rejects_invalid_cells_relationships_xml_and_expansion_metadata() {
    let cases = [
        r#"<row r="2"><c r="A2"><v>1</v></c><c r="A2"><v>2</v></c></row>"#.to_owned(),
        r#"<row r="2"><c r="A2" t="s"><v>9999</v></c></row>"#.to_owned(),
        r#"<row r="1048577"><c r="A1048577"><v>1</v></c></row>"#.to_owned(),
        format!(
            r#"<row r="2"><c r="A2" t="inlineStr"><is><t>{}</t></is></c></row>"#,
            "x".repeat(32768)
        ),
        r#"<row r="2"><c r="C2"><v>3</v></c></row>"#.to_owned(),
    ];
    for body in cases {
        let (_dir, path) = package(
            &format!("{START}{HEADERS}{body}{END}"),
            None,
            None,
            "worksheets/custom.xml",
        );
        assert!(stream_xlsx_rows(&path, &|| false, &mut |_, _| Ok(())).is_err());
    }
    for sheet in [
        format!("{START}{HEADERS}</sheetData>"),
        format!("{START}{HEADERS}{END}<other/>"),
        format!("<!DOCTYPE worksheet>{START}{HEADERS}{END}"),
    ] {
        let (_dir, path) = package(&sheet, None, None, "worksheets/custom.xml");
        assert!(stream_xlsx_rows(&path, &|| false, &mut |_, _| Ok(())).is_err());
    }
    let (_dir, path) = package(
        &format!("{START}{HEADERS}{END}"),
        None,
        None,
        "../../../outside.xml",
    );
    assert!(stream_xlsx_rows(&path, &|| false, &mut |_, _| Ok(())).is_err());
    let (_dir, path) = package(
        &format!("{START}{HEADERS}{END}"),
        None,
        None,
        "https://example.test/worksheet.xml",
    );
    assert!(stream_xlsx_rows(&path, &|| false, &mut |_, _| Ok(())).is_err());
    let (_dir, path) = package(
        &format!("{START}{HEADERS}{END}"),
        None,
        None,
        "worksheets/custom.xml",
    );
    let mut bytes = fs::read(&path).unwrap();
    let at = bytes
        .windows(4)
        .enumerate()
        .find(|(offset, signature)| {
            *signature == b"PK\x01\x02"
                && bytes.get(offset + 46..offset + 46 + 15) == Some(b"xl/workbook.xml")
        })
        .map(|(offset, _)| offset)
        .unwrap();
    bytes[at + 24..at + 28].copy_from_slice(&(17 * 1024 * 1024_u32).to_le_bytes());
    fs::write(&path, bytes).unwrap();
    assert!(stream_xlsx_rows(&path, &|| false, &mut |_, _| Ok(())).is_err());
}
#[test]
fn xlsx_temporal_formats_ignore_literals_and_include_elapsed_time() {
    use super::super::import_xlsx_values::date_format;
    for value in [
        "yyyy-mm-dd",
        "hh:mm:ss",
        "[h]:mm:ss",
        "[$-404]yyyy/mm/dd",
        "AM/PM",
    ] {
        assert!(date_format(value), "{value}");
    }
    for value in [
        r#"0.00 "m""#,
        r#"\Y00000"#,
        r#"0_ ;[Red]\-0"#,
        "General",
        "0.00E+00",
    ] {
        assert!(!date_format(value), "{value}");
    }
}
async fn target() -> (ConnectionManager, BTreeMap<String, ColumnInfo>) {
    let manager = ConnectionManager::new();
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver.query("CREATE TABLE target(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);INSERT INTO target VALUES(-1,'original')").await.unwrap();
    let columns = column_lookup(driver.get_columns("main", "target").await.unwrap());
    manager
        .add_connection("xlsx-import".into(), Box::new(driver))
        .await;
    (manager, columns)
}
fn records(count: u64, duplicate: bool) -> String {
    let mut sheet = format!("{START}{HEADERS}");
    for id in 0..count {
        let row = id + 2;
        let id = if duplicate && id == 1000 { 0 } else { id };
        sheet.push_str(&format!(r#"<row r="{row}"><c r="A{row}"><v>{id}</v></c><c r="B{row}" t="inlineStr"><is><t>雪'; DROP TABLE target; --</t></is></c></row>"#));
    }
    sheet.push_str(END);
    sheet
}
#[tokio::test]
async fn xlsx_sqlite_stream_commits_all_rows_and_rolls_back_late_errors_and_cancel() {
    for mode in [TableImportMode::Append, TableImportMode::Truncate] {
        for failure in ["none", "xml", "duplicate", "cancel"] {
            let (manager, columns) = target().await;
            let mut sheet = records(1001, failure == "duplicate");
            if failure == "xml" {
                sheet.truncate(sheet.len() - 12);
            }
            let (_dir, path) = package(&sheet, None, None, "worksheets/custom.xml");
            let original = fs::read(&path).unwrap();
            let (cancel, cancel_rx) = tokio::sync::watch::channel(false);
            let written = AtomicU64::new(0);
            let result = import_streamed_rows_in_transaction(
                &manager,
                "xlsx-import",
                DatabaseKind::Postgres,
                "main",
                "target",
                &columns,
                &path,
                TableImportFormat::Xlsx,
                None,
                mode,
                &cancel_rx,
                &|rows, _| {
                    written.store(rows, Ordering::Relaxed);
                    if failure == "cancel" {
                        cancel.send_replace(true);
                    }
                },
            )
            .await;
            let rows = manager
                .query(
                    "xlsx-import",
                    "SELECT count(*),min(id),max(id) FROM target",
                    None,
                    None,
                    None,
                )
                .await
                .unwrap();
            if failure == "none" {
                assert_eq!(result.unwrap(), (1001, 3));
                assert_eq!(
                    rows[0].rows[0],
                    if mode == TableImportMode::Append {
                        vec![json!(1002), json!(-1), json!(1000)]
                    } else {
                        vec![json!(1001), json!(0), json!(1000)]
                    }
                );
            } else {
                assert!(result.is_err(), "{failure}");
                assert!(
                    written.load(Ordering::Relaxed) >= 500,
                    "must fail after database writes: {failure}"
                );
                assert_eq!(rows[0].rows[0], vec![json!(1), json!(-1), json!(-1)]);
                manager
                    .query(
                        "xlsx-import",
                        "INSERT INTO target VALUES(-2,'healthy')",
                        None,
                        None,
                        None,
                    )
                    .await
                    .unwrap();
            }
            assert_eq!(fs::read(&path).unwrap(), original);
        }
    }
}
#[test]
fn xlsx_preview_and_inference_are_bounded_and_keep_source_columns() {
    let (_dir, path) = package(&records(101, false), None, None, "worksheets/custom.xml");
    let preview = super::super::import_preview::read_xlsx_import_preview(&path).unwrap();
    assert_eq!(preview.total_rows, 101);
    assert_eq!(preview.sample_rows.len(), 50);
    assert!(preview.truncated);
    let (columns, rows) =
        infer_streamed_import_columns(&path, "sqlite", TableImportFormat::Xlsx).unwrap();
    assert_eq!(rows, 101);
    assert_eq!(
        columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
        ["id", "payload"]
    );
}

fn native_payload(id: u64) -> String {
    use sha2::Digest;
    format!("{:x}", sha2::Sha256::digest(id.to_le_bytes()))
}
#[tokio::test]
#[ignore = "native million-row shared-string XLSX; run scripts/test-xlsx-import.mjs"]
async fn xlsx_stream_million_row_sqlite_acceptance() {
    use sha2::Digest;
    let directory = PathBuf::from(
        std::env::var("OXIDE_XLSX_IMPORT_EVIDENCE_DIR").expect("dedicated fixture directory"),
    );
    let source = directory.join("million.xlsx");
    let database = directory.join("target.db");
    let workflow = std::time::Instant::now();
    let mut archive = ZipWriter::new(fs::File::create_new(&source).unwrap());
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, body) in [
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        ),
        (
            "xl/workbook.xml",
            r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Orders" sheetId="1" r:id="rFirst"/></sheets></workbook>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rFirst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/custom.xml"/><Relationship Id="rStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>"#,
        ),
    ] {
        archive.start_file(name, options).unwrap();
        archive.write_all(body.as_bytes()).unwrap();
    }
    archive.start_file("xl/sharedStrings.xml", options).unwrap();
    archive
        .write_all(br#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1000003" uniqueCount="1000003"><si><t>id</t></si><si><t>payload</t></si>"#)
        .unwrap();
    let mut expected_digest = sha2::Sha256::new();
    for id in 0..1_000_001_u64 {
        let payload = native_payload(id);
        expected_digest.update(payload.as_bytes());
        write!(archive, "<si><t>{payload}</t></si>").unwrap();
    }
    archive.write_all(b"</sst>").unwrap();
    archive
        .start_file("xl/worksheets/custom.xml", options)
        .unwrap();
    archive.write_all(br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>"#).unwrap();
    for id in 0..1_000_001_u64 {
        let row = id + 2;
        let index = id + 2;
        write!(archive,r#"<row r="{row}"><c r="A{row}"><v>{id}</v></c><c r="B{row}" t="s"><v>{index}</v></c></row>"#).unwrap();
    }
    archive.write_all(b"</sheetData></worksheet>").unwrap();
    drop(archive.finish().unwrap());
    let bytes = fs::metadata(&source).unwrap().len();
    assert!(
        bytes > 32 * 1024 * 1024,
        "must exceed previous compressed-source limit"
    );
    let original = super::super::import_preview::import_file_digest(&source).unwrap();
    let preview = super::super::import_preview::read_xlsx_import_preview(&source).unwrap();
    assert_eq!(preview.total_rows, 1_000_001);
    assert_eq!(preview.sample_rows.len(), 50);
    assert!(preview.truncated);
    let (inferred, rows) =
        infer_streamed_import_columns(&source, "sqlite", TableImportFormat::Xlsx).unwrap();
    assert_eq!(rows, 1_000_001);
    assert_eq!(inferred.len(), 2);
    let manager = ConnectionManager::new();
    let mut driver = SqliteDriver::new(&database.to_string_lossy());
    driver.connect().await.unwrap();
    let version = driver.server_version().await.unwrap();
    driver
        .query("CREATE TABLE target(id INTEGER PRIMARY KEY,payload TEXT NOT NULL)")
        .await
        .unwrap();
    let columns = column_lookup(driver.get_columns("main", "target").await.unwrap());
    manager
        .add_connection("xlsx-import".into(), Box::new(driver))
        .await;
    let (_cancel, receive_cancel) = tokio::sync::watch::channel(false);
    let import_started = std::time::Instant::now();
    let result = import_streamed_rows_in_transaction(
        &manager,
        "xlsx-import",
        DatabaseKind::Postgres,
        "main",
        "target",
        &columns,
        &source,
        TableImportFormat::Xlsx,
        None,
        TableImportMode::Append,
        &receive_cancel,
        &|_, _| {},
    )
    .await
    .unwrap();
    assert_eq!(result, (1_000_001, 2001));
    let import_ms = import_started.elapsed().as_millis();
    let output = manager
        .query(
            "xlsx-import",
            "SELECT count(*),sum(id),min(id),max(id),sum(length(payload)) FROM target",
            None,
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        output[0].rows[0],
        vec![
            json!(1_000_001),
            json!(500000500000_i64),
            json!(0),
            json!(1_000_000),
            json!(64_000_064)
        ]
    );
    let mut last = -1_i64;
    let mut verified = 0_u64;
    let mut actual_digest = sha2::Sha256::new();
    loop {
        let output = manager
            .query(
                "xlsx-import",
                &format!("SELECT id,payload FROM target WHERE id>{last} ORDER BY id LIMIT 1000"),
                None,
                None,
                None,
            )
            .await
            .unwrap();
        if output[0].rows.is_empty() {
            break;
        }
        for row in &output[0].rows {
            let id = row[0].as_i64().unwrap();
            let payload = row[1].as_str().unwrap();
            assert_eq!(id, verified as i64);
            assert_eq!(payload, native_payload(verified));
            actual_digest.update(payload.as_bytes());
            verified += 1;
            last = id;
        }
    }
    assert_eq!(verified, 1_000_001);
    let expected = format!("{:x}", expected_digest.finalize());
    assert_eq!(format!("{:x}", actual_digest.finalize()), expected);
    assert_eq!(
        super::super::import_preview::import_file_digest(&source).unwrap(),
        original
    );
    fs::write(directory.join("native-evidence.json"),serde_json::to_vec_pretty(&json!({"rows":result.0,"batches":result.1,"sourceBytes":bytes,"sourceSha256":original,"payloadSha256":expected,"allPayloadsVerified":true,"sourceUnchanged":true,"previewRows":50,"inferenceRows":rows,"sharedStrings":1_000_003,"importMilliseconds":import_ms,"workflowMilliseconds":workflow.elapsed().as_millis(),"engine":"SQLite","engineVersion":version,"scope":"native-library-xlsx-import","desktopIpcTested":false,"resumeTested":false})).unwrap()).unwrap();
    fs::write(directory.join("measure-ready"), b"ready").unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while !directory.join("measure-done").exists() {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap();
    manager.disconnect_connection("xlsx-import").await.unwrap();
    fs::remove_file(source).unwrap();
    fs::remove_file(database).unwrap();
}
#[test]
#[ignore = "parent terminates this live process to verify anonymous shared-string cleanup"]
fn xlsx_stream_anonymous_spool_crash_probe() {
    let directory = PathBuf::from(
        std::env::var("OXIDE_XLSX_IMPORT_EVIDENCE_DIR").expect("dedicated fixture directory"),
    );
    let sheet = format!(
        "{START}{HEADERS}{}{END}",
        r#"<row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>0</v></c></row>"#
    );
    let (_source_directory, path) = package(
        &sheet,
        Some("<sst><si><t>private-fixture</t></si></sst>"),
        None,
        "worksheets/custom.xml",
    );
    stream_xlsx_rows(&path, &|| false, &mut |_, _| {
        fs::write(
            directory.join("crash-ready.json"),
            serde_json::to_vec(&json!({"source":path})).unwrap(),
        )
        .unwrap();
        loop {
            std::thread::park();
        }
    })
    .unwrap();
    panic!("crash probe must still be live when parent terminates it");
}

#[test]
fn xlsx_stream_resolves_declared_shared_string_and_style_parts() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("custom.xlsx");
    let mut archive = ZipWriter::new(fs::File::create(&path).unwrap());
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for (name, text) in [
        (
            "xl/workbook.xml",
            r#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Custom" sheetId="1" r:id="rFirst"/></sheets></workbook>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<Relationships><Relationship Id="rFirst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/custom.xml"/><Relationship Id="rStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="strings/custom.xml"/><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="config/custom.xml"/></Relationships>"#,
        ),
        (
            "xl/strings/custom.xml",
            "<sst><si><t>custom 雪</t></si></sst>",
        ),
        (
            "xl/config/custom.xml",
            r#"<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>"#,
        ),
        (
            "xl/worksheets/custom.xml",
            r#"<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>label</t></is></c><c r="B1" t="inlineStr"><is><t>day</t></is></c></row><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" s="1"><v>45292</v></c></row></sheetData></worksheet>"#,
        ),
    ] {
        archive.start_file(name, options).unwrap();
        archive.write_all(text.as_bytes()).unwrap();
    }
    archive.finish().unwrap();
    let mut rows = Vec::new();
    stream_xlsx_rows(&path, &|| false, &mut |_, row| {
        rows.push(row);
        Ok(())
    })
    .unwrap();
    assert_eq!(rows[0]["label"], json!("custom 雪"));
    assert_eq!(rows[0]["day"], json!("45292"));
}
