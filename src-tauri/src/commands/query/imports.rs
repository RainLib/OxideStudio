/// 查询执行相关 commands
use crate::core::{
    dml_preview_sql::{
        build_dml_change_preview_sql as build_preview_sql, DmlChangePreviewSqlOptions,
        DmlChangePreviewSqlResult,
    },
    manager::ConnectionManager,
    protocol::Response,
    statement::{split_sql_statements, StatementScanDialect},
};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

use super::models::{MAX_CONSOLE_FILE_BYTES, MAX_SQL_IMPORT_BYTES};
use super::state::{
    ConsoleFileExportResult, ConsoleFileImportResult, ImportSqlScriptResult, SqlScriptImportPreview,
};

/// Convert one DML statement into a bounded SELECT preview without touching a
/// database. The generated SQL still travels through the normal query safety
/// and cancellation path when the renderer executes it.
#[tauri::command]
pub fn build_dml_change_preview_sql(
    options: DmlChangePreviewSqlOptions,
) -> Result<Response<DmlChangePreviewSqlResult>, String> {
    match build_preview_sql(options) {
        Ok(preview) => Ok(Response::ok(preview)),
        Err(error) => Ok(Response::err("DML_CHANGE_PREVIEW_UNAVAILABLE", &error)),
    }
}

pub(super) fn read_sql_import_source(
    path: &PathBuf,
    dialect: StatementScanDialect,
) -> Result<(String, u64), String> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("sql"))
    {
        return Err("Select a .sql script to import".to_string());
    }
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("The selected SQL import path is not a file".to_string());
    }
    if metadata.len() > MAX_SQL_IMPORT_BYTES {
        return Err(format!(
            "SQL import files are limited to {} MB",
            MAX_SQL_IMPORT_BYTES / 1024 / 1024
        ));
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let sql = decode_sql_import_bytes(&bytes, dialect == StatementScanDialect::Mysql)?;
    Ok((sql, metadata.len()))
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum MysqlDumpBinaryLiteralState {
    #[default]
    Normal,
    SingleQuoted,
    DoubleQuoted,
    BacktickQuoted,
    LineComment,
    BlockComment,
    BinaryQuoted,
}

/// Converts MySQL dump `_binary '<raw bytes>'` introducers to portable `X'ABCD'`
/// literals before text decoding. `mysqldump` may place arbitrary bytes inside
/// the quoted payload, so treating the whole file as UTF-8 first corrupts or
/// rejects otherwise valid dumps.
#[derive(Debug, Default)]
pub(super) struct MysqlDumpBinaryLiteralNormalizer {
    state: MysqlDumpBinaryLiteralState,
}

impl MysqlDumpBinaryLiteralNormalizer {
    pub(super) fn normalize(&mut self, input: &[u8]) -> Result<Vec<u8>, String> {
        let mut output = Vec::with_capacity(input.len());
        let mut index = 0;
        while index < input.len() {
            let byte = input[index];
            match self.state {
                MysqlDumpBinaryLiteralState::Normal => {
                    if byte == b'_'
                        && input
                            .get(index..index.saturating_add(7))
                            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(b"_binary"))
                        && !is_sql_identifier_byte(
                            index.checked_sub(1).and_then(|i| input.get(i)).copied(),
                        )
                    {
                        let mut quote_index = index + 7;
                        while input
                            .get(quote_index)
                            .is_some_and(|candidate| candidate.is_ascii_whitespace())
                        {
                            quote_index += 1;
                        }
                        if input.get(quote_index) == Some(&b'\'') {
                            output.extend_from_slice(b"X'");
                            self.state = MysqlDumpBinaryLiteralState::BinaryQuoted;
                            index = quote_index + 1;
                            continue;
                        }
                    }

                    if byte == b'-' && input.get(index + 1) == Some(&b'-') {
                        output.extend_from_slice(b"--");
                        index += 2;
                        if input.get(index).is_none_or(|next| {
                            next.is_ascii_whitespace() || next.is_ascii_control()
                        }) {
                            self.state = MysqlDumpBinaryLiteralState::LineComment;
                        }
                    } else if byte == b'#' {
                        output.push(byte);
                        index += 1;
                        self.state = MysqlDumpBinaryLiteralState::LineComment;
                    } else if byte == b'/' && input.get(index + 1) == Some(&b'*') {
                        output.extend_from_slice(b"/*");
                        index += 2;
                        self.state = MysqlDumpBinaryLiteralState::BlockComment;
                    } else {
                        output.push(byte);
                        index += 1;
                        self.state = match byte {
                            b'\'' => MysqlDumpBinaryLiteralState::SingleQuoted,
                            b'"' => MysqlDumpBinaryLiteralState::DoubleQuoted,
                            b'`' => MysqlDumpBinaryLiteralState::BacktickQuoted,
                            _ => MysqlDumpBinaryLiteralState::Normal,
                        };
                    }
                }
                MysqlDumpBinaryLiteralState::SingleQuoted
                | MysqlDumpBinaryLiteralState::DoubleQuoted
                | MysqlDumpBinaryLiteralState::BacktickQuoted => {
                    let quote = match self.state {
                        MysqlDumpBinaryLiteralState::SingleQuoted => b'\'',
                        MysqlDumpBinaryLiteralState::DoubleQuoted => b'"',
                        MysqlDumpBinaryLiteralState::BacktickQuoted => b'`',
                        _ => unreachable!(),
                    };
                    output.push(byte);
                    index += 1;
                    if byte == b'\\' {
                        if let Some(escaped) = input.get(index) {
                            output.push(*escaped);
                            index += 1;
                        }
                    } else if byte == quote {
                        if input.get(index) == Some(&quote) {
                            output.push(quote);
                            index += 1;
                        } else {
                            self.state = MysqlDumpBinaryLiteralState::Normal;
                        }
                    }
                }
                MysqlDumpBinaryLiteralState::LineComment => {
                    output.push(byte);
                    index += 1;
                    if byte == b'\n' {
                        self.state = MysqlDumpBinaryLiteralState::Normal;
                    }
                }
                MysqlDumpBinaryLiteralState::BlockComment => {
                    output.push(byte);
                    index += 1;
                    if byte == b'*' && input.get(index) == Some(&b'/') {
                        output.push(b'/');
                        index += 1;
                        self.state = MysqlDumpBinaryLiteralState::Normal;
                    }
                }
                MysqlDumpBinaryLiteralState::BinaryQuoted => {
                    if byte == b'\\' {
                        let Some(escaped) = input.get(index + 1).copied() else {
                            return Err("Unterminated MySQL binary literal".to_string());
                        };
                        let value = match escaped {
                            b'0' => 0x00,
                            b'b' => 0x08,
                            b'n' => b'\n',
                            b'r' => b'\r',
                            b't' => b'\t',
                            b'Z' => 0x1A,
                            b'\\' => b'\\',
                            b'\'' => b'\'',
                            b'"' => b'"',
                            other => other,
                        };
                        append_hex_byte(&mut output, value);
                        index += 2;
                    } else if byte == b'\'' {
                        if input.get(index + 1) == Some(&b'\'') {
                            append_hex_byte(&mut output, b'\'');
                            index += 2;
                        } else {
                            output.push(b'\'');
                            index += 1;
                            self.state = MysqlDumpBinaryLiteralState::Normal;
                        }
                    } else {
                        append_hex_byte(&mut output, byte);
                        index += 1;
                    }
                }
            }
        }
        if self.state == MysqlDumpBinaryLiteralState::BinaryQuoted {
            return Err("Unterminated MySQL binary literal".to_string());
        }
        Ok(output)
    }
}

pub(super) fn is_sql_identifier_byte(byte: Option<u8>) -> bool {
    byte.is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$'))
}

pub(super) fn append_hex_byte(output: &mut Vec<u8>, byte: u8) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    output.push(HEX[(byte >> 4) as usize]);
    output.push(HEX[(byte & 0x0F) as usize]);
}

pub(super) fn strict_decode_sql_bytes(
    bytes: &[u8],
    encoding: &'static encoding_rs::Encoding,
) -> Option<String> {
    encoding
        .decode_without_bom_handling_and_without_replacement(bytes)
        .map(|decoded| decoded.into_owned())
}

pub(super) fn decode_sql_import_bytes(
    bytes: &[u8],
    normalize_mysql_binary: bool,
) -> Result<String, String> {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return strict_decode_sql_bytes(&bytes[2..], encoding_rs::UTF_16LE)
            .ok_or_else(|| "The SQL script is not valid UTF-16 LE text".to_string());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return strict_decode_sql_bytes(&bytes[2..], encoding_rs::UTF_16BE)
            .ok_or_else(|| "The SQL script is not valid UTF-16 BE text".to_string());
    }

    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    if normalize_mysql_binary {
        let normalized = MysqlDumpBinaryLiteralNormalizer::default().normalize(bytes)?;
        if let Some(sql) = strict_decode_sql_bytes(&normalized, encoding_rs::UTF_8) {
            return Ok(sql);
        }
    } else if let Some(sql) = strict_decode_sql_bytes(bytes, encoding_rs::UTF_8) {
        return Ok(sql);
    }

    strict_decode_sql_bytes(bytes, encoding_rs::GBK).ok_or_else(|| {
        "The SQL script is not valid UTF-8, UTF-16, GB18030, or a recoverable MySQL dump"
            .to_string()
    })
}

pub(super) fn sql_import_digest(sql: &str) -> String {
    format!("{:x}", Sha256::digest(sql.as_bytes()))
}

pub(super) fn sql_import_statement_preview(statement: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 1_200;
    let normalized = statement.trim();
    let mut preview = normalized
        .chars()
        .take(MAX_PREVIEW_CHARS)
        .collect::<String>();
    if normalized.chars().nth(MAX_PREVIEW_CHARS).is_some() {
        preview.push('…');
    }
    preview
}

#[tauri::command]
pub async fn preview_sql_script_import(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    file_path: String,
) -> Result<Response<SqlScriptImportPreview>, String> {
    let result: Result<SqlScriptImportPreview, String> = async {
        let path = PathBuf::from(file_path.trim());
        let dialect = manager
            .statement_scan_dialect(&connection_id)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                "SQL script import is only available for SQL data sources".to_string()
            })?;
        let (sql, total_bytes) = read_sql_import_source(&path, dialect)?;
        let statements = split_sql_statements(&sql, dialect);
        if statements.is_empty() {
            return Err(
                "The selected SQL script does not contain executable statements".to_string(),
            );
        }
        const MAX_PREVIEW_STATEMENTS: usize = 20;
        Ok(SqlScriptImportPreview {
            file_name: path
                .file_name()
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty())
                .unwrap_or("SQL script")
                .to_string(),
            total_bytes,
            statement_count: statements.len() as u64,
            statement_preview: statements
                .iter()
                .take(MAX_PREVIEW_STATEMENTS)
                .map(|statement| sql_import_statement_preview(statement))
                .collect(),
            truncated: statements.len() > MAX_PREVIEW_STATEMENTS,
            review_digest: sql_import_digest(&sql),
        })
    }
    .await;

    match result {
        Ok(preview) => Ok(Response::ok(preview)),
        Err(error) => Ok(Response::err("PREVIEW_SQL_SCRIPT_IMPORT_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn import_sql_script(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    file_path: String,
    schema: Option<String>,
    database: Option<String>,
    review_digest: String,
) -> Result<Response<ImportSqlScriptResult>, String> {
    let result: Result<ImportSqlScriptResult, String> = async {
        let path = PathBuf::from(file_path.trim());
        let dialect = manager
            .statement_scan_dialect(&connection_id)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                "SQL script import is only available for SQL data sources".to_string()
            })?;
        let (sql, _) = read_sql_import_source(&path, dialect)?;
        if review_digest.trim().is_empty() || review_digest != sql_import_digest(&sql) {
            return Err(
                "The SQL script changed or was not reviewed. Preview it again before importing."
                    .to_string(),
            );
        }
        let statements = split_sql_statements(&sql, dialect);
        if statements.is_empty() {
            return Err(
                "The selected SQL script does not contain executable statements".to_string(),
            );
        }

        let results = match database.as_deref().filter(|value| !value.trim().is_empty()) {
            Some(database) => {
                manager
                    .query_database_with_context(
                        &connection_id,
                        database,
                        &sql,
                        schema.as_deref(),
                        None,
                    )
                    .await
            }
            None => {
                manager
                    .query(
                        &connection_id,
                        &sql,
                        schema.filter(|value| !value.trim().is_empty()),
                        None,
                        None,
                    )
                    .await
            }
        }
        .map_err(|error| error.to_string())?;

        Ok(ImportSqlScriptResult {
            file_path: path.display().to_string(),
            statements_executed: statements.len() as u64,
            rows_affected: results
                .iter()
                .filter_map(|result| result.rows_affected)
                .sum(),
        })
    }
    .await;

    match result {
        Ok(imported) => Ok(Response::ok(imported)),
        Err(error) => Ok(Response::err("IMPORT_SQL_SCRIPT_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn import_elasticsearch_console_file(
    app: AppHandle,
) -> Result<Response<Option<ConsoleFileImportResult>>, String> {
    let (sender, receiver) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Elasticsearch Console", &["txt", "es", "esdsl", "json"])
        .set_title("Import Elasticsearch Console requests")
        .pick_file(move |selection| {
            let _ = sender.send(selection);
        });
    let selection = receiver
        .await
        .map_err(|_| "Elasticsearch Console import dialog closed unexpectedly".to_string())?;
    let Some(selection) = selection else {
        return Ok(Response::ok(None));
    };
    let path = selection
        .into_path()
        .map_err(|_| "The selected Console import is not a local file".to_string())?;
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|error| format!("Unable to inspect the selected Console file: {error}"))?;
    if !metadata.is_file() {
        return Ok(Response::err(
            "ELASTICSEARCH_CONSOLE_IMPORT_ERROR",
            "The selected Console import path is not a file",
        ));
    }
    if metadata.len() > MAX_CONSOLE_FILE_BYTES {
        return Ok(Response::err(
            "ELASTICSEARCH_CONSOLE_IMPORT_ERROR",
            &format!(
                "Elasticsearch Console imports are limited to {} MB",
                MAX_CONSOLE_FILE_BYTES / 1024 / 1024
            ),
        ));
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| format!("Unable to read the selected Console file: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Elasticsearch Console")
        .to_string();

    Ok(Response::ok(Some(ConsoleFileImportResult {
        file_path: path.to_string_lossy().into_owned(),
        file_name,
        content,
    })))
}

#[tauri::command]
pub async fn export_elasticsearch_console_file(
    app: AppHandle,
    content: String,
) -> Result<Response<ConsoleFileExportResult>, String> {
    if content.len() as u64 > MAX_CONSOLE_FILE_BYTES {
        return Ok(Response::err(
            "ELASTICSEARCH_CONSOLE_EXPORT_ERROR",
            &format!(
                "Elasticsearch Console exports are limited to {} MB",
                MAX_CONSOLE_FILE_BYTES / 1024 / 1024
            ),
        ));
    }

    let (sender, receiver) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Elasticsearch Console", &["txt"])
        .set_title("Export Elasticsearch Console requests")
        .set_file_name("elasticsearch-console.txt")
        .save_file(move |selection| {
            let _ = sender.send(selection);
        });
    let selection = receiver
        .await
        .map_err(|_| "Elasticsearch Console export dialog closed unexpectedly".to_string())?;
    let Some(selection) = selection else {
        return Ok(Response::ok(ConsoleFileExportResult {
            exported: false,
            file_path: None,
            byte_count: 0,
        }));
    };
    let path = selection
        .into_path()
        .map_err(|_| "The selected Console export destination is not a local file".to_string())?;
    tokio::fs::write(&path, content.as_bytes())
        .await
        .map_err(|error| format!("Unable to export Elasticsearch Console requests: {error}"))?;

    Ok(Response::ok(ConsoleFileExportResult {
        exported: true,
        file_path: Some(path.to_string_lossy().into_owned()),
        byte_count: content.len(),
    }))
}
