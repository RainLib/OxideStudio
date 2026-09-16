/// 查询执行相关 commands
use super::models::{
    MAX_CACHED_STATEMENT_RANGES, MAX_SQL_SYNTAX_DIAGNOSTIC_CHARS, MAX_SQL_SYNTAX_VALIDATION_CHARS,
};
use crate::core::{
    dialect::{canonical_driver_name, DatabaseKind},
    parser::SqlParser,
    protocol::ExplainPlanMode,
    statement::{
        split_sql_statement_spans_with_soft_boundaries, SqlStatementSpan, StatementScanDialect,
    },
};
use serde::{Deserialize, Serialize};
use sqlparser::{
    dialect::{MySqlDialect, PostgreSqlDialect},
    parser::Parser,
};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::Mutex;
use tokio::sync::{watch, Mutex as AsyncMutex};

/// SQL Parser 状态
pub struct ParserState(pub Mutex<SqlParser>);

pub struct QueryCancellationHandle {
    pub connection_id: String,
    pub sender: watch::Sender<bool>,
}

#[derive(Default)]
pub struct QueryCancellationState(pub Arc<AsyncMutex<HashMap<String, QueryCancellationHandle>>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainQueryRequest {
    pub connection_id: String,
    pub sql: String,
    pub schema: Option<String>,
    pub database: Option<String>,
    pub query_id: String,
    pub mode: ExplainPlanMode,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSqlScriptResult {
    pub file_path: String,
    pub statements_executed: u64,
    pub rows_affected: u64,
}

/// Bounded, read-only review data for a SQL script import. Execution requires
/// the digest returned here and recomputes it immediately before sending SQL
/// to the selected data source.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlScriptImportPreview {
    pub file_name: String,
    pub total_bytes: u64,
    pub statement_count: u64,
    pub statement_preview: Vec<String>,
    pub truncated: bool,
    pub review_digest: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleFileImportResult {
    pub file_path: String,
    pub file_name: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleFileExportResult {
    pub exported: bool,
    pub file_path: Option<String>,
    pub byte_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlStatementRange {
    pub start_offset: usize,
    pub end_offset: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlStatementSelection {
    pub sql: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub statement_index: usize,
    pub statement_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub statement_ranges: Option<Vec<SqlStatementRange>>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SqlSyntaxDiagnostic {
    pub severity: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SqlSyntaxValidation {
    pub valid: bool,
    pub driver: String,
    pub statement_count: usize,
    pub diagnostics: Vec<SqlSyntaxDiagnostic>,
}

pub(super) fn bounded_syntax_diagnostic(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("sql parser error:")
        .trim()
        .chars()
        .filter(|character| !character.is_control() || character.is_whitespace())
        .take(MAX_SQL_SYNTAX_DIAGNOSTIC_CHARS)
        .collect()
}

pub(super) fn syntax_diagnostic(error: impl ToString) -> SqlSyntaxDiagnostic {
    let message = bounded_syntax_diagnostic(&error.to_string());
    let marker = " at Line: ";
    let (message, line, column) = message
        .rfind(marker)
        .and_then(|marker_index| {
            let location = &message[marker_index + marker.len()..];
            let (line, column) = location.split_once(", Column: ")?;
            Some((
                message[..marker_index].trim().to_string(),
                line.parse::<u64>().ok(),
                column.parse::<u64>().ok(),
            ))
        })
        .unwrap_or((message, None, None));

    SqlSyntaxDiagnostic {
        severity: "error",
        message,
        line,
        column,
    }
}

pub(super) fn validate_sql_syntax_text(
    driver: &str,
    sql: &str,
    lsp_language_id: Option<&str>,
    lsp_server_dialect: Option<&str>,
) -> Result<SqlSyntaxValidation, String> {
    let requested_driver = driver.trim();
    let canonical_driver = canonical_driver_name(requested_driver)
        .map(str::to_string)
        .unwrap_or_else(|| requested_driver.to_ascii_lowercase());
    if canonical_driver.is_empty() {
        return Err("Database driver is required".to_string());
    }
    let parser_kind = DatabaseKind::from_str(&canonical_driver).ok();
    let declared_language = lsp_language_id
        .map(str::trim)
        .filter(|language| !language.is_empty())
        .map(str::to_ascii_lowercase);
    let declared_server_dialect = lsp_server_dialect
        .map(str::trim)
        .filter(|dialect| !dialect.is_empty())
        .map(str::to_ascii_lowercase);
    if sql.chars().count() > MAX_SQL_SYNTAX_VALIDATION_CHARS {
        return Err(format!(
            "SQL syntax validation is limited to {MAX_SQL_SYNTAX_VALIDATION_CHARS} characters"
        ));
    }
    if sql.trim().is_empty() {
        return Ok(SqlSyntaxValidation {
            valid: false,
            driver: canonical_driver.clone(),
            statement_count: 0,
            diagnostics: vec![SqlSyntaxDiagnostic {
                severity: "error",
                message: "Enter at least one SQL statement.".to_string(),
                line: Some(1),
                column: Some(1),
            }],
        });
    }

    // Generic SQL documents can retain their neutral UI language while a
    // signed capability selects a reviewed parser baseline (for example a
    // MySQL-wire-compatible driver). Dedicated document languages continue to
    // select their own parser and never accept an unrelated override.
    let parser_language = match declared_language.as_deref() {
        Some("sql") => declared_server_dialect.as_deref().unwrap_or("sql"),
        Some(language) => language,
        None => "",
    };
    let parsed = match parser_language {
        // `sql` is the product's generic editor language. It intentionally
        // follows the same PostgreSQL-compatible conservative parser used by
        // the generic LSP baseline, while retaining the vendor driver label in
        // the returned diagnostic.
        "postgres" | "sqlite" | "duckdb" | "sql" => Parser::parse_sql(&PostgreSqlDialect {}, sql),
        "mysql" => Parser::parse_sql(&MySqlDialect {}, sql),
        // A known editor language without a matching Host parser must not be
        // silently parsed as PostgreSQL; execution/server diagnostics remain
        // authoritative for that dialect.
        language if !language.is_empty() => {
            return Err(format!(
                "SQL syntax validation is not supported for {canonical_driver} ({language})"
            ))
        }
        _ => match parser_kind {
            Some(DatabaseKind::Mysql) => Parser::parse_sql(&MySqlDialect {}, sql),
            // SQLite's common SELECT/DML grammar is validated by the same
            // conservative parser used by its LSP compatibility dialect. Native
            // execution remains the source of truth for SQLite-specific DDL.
            // DuckDB external packages use the SQLite-compatible LSP profile.
            // Syntax validation deliberately follows that same conservative
            // baseline rather than becoming unavailable merely because the driver
            // is independently installed instead of linked into the app.
            Some(DatabaseKind::Postgres) | None
                if matches!(canonical_driver.as_str(), "sqlite" | "duckdb") =>
            {
                Parser::parse_sql(&PostgreSqlDialect {}, sql)
            }
            Some(DatabaseKind::Postgres) => Parser::parse_sql(&PostgreSqlDialect {}, sql),
            None => {
                return Err(format!(
                    "SQL syntax validation is not supported for {canonical_driver}"
                ))
            }
        },
    };
    match parsed {
        Ok(statements) => Ok(SqlSyntaxValidation {
            valid: true,
            driver: canonical_driver.clone(),
            statement_count: statements.len(),
            diagnostics: Vec::new(),
        }),
        Err(error) => Ok(SqlSyntaxValidation {
            valid: false,
            driver: canonical_driver,
            statement_count: 0,
            diagnostics: vec![syntax_diagnostic(error)],
        }),
    }
}

pub(super) fn utf16_offset_to_byte_offset(value: &str, utf16_offset: usize) -> usize {
    let mut consumed_utf16 = 0;
    for (byte_offset, character) in value.char_indices() {
        if consumed_utf16 >= utf16_offset {
            return byte_offset;
        }
        let next_utf16 = consumed_utf16 + character.len_utf16();
        if next_utf16 > utf16_offset {
            return byte_offset;
        }
        consumed_utf16 = next_utf16;
    }
    value.len()
}

pub(super) fn byte_offset_to_utf16_offset(value: &str, byte_offset: usize) -> usize {
    value[..byte_offset.min(value.len())].encode_utf16().count()
}

pub(super) fn sql_statement_ranges_utf16(
    sql: &str,
    statements: &[SqlStatementSpan<'_>],
) -> Vec<SqlStatementRange> {
    let mut previous_byte_offset = 0;
    let mut utf16_offset = 0;
    statements
        .iter()
        .map(|statement| {
            utf16_offset += sql[previous_byte_offset..statement.start]
                .encode_utf16()
                .count();
            let start_offset = utf16_offset;
            utf16_offset += sql[statement.start..statement.end].encode_utf16().count();
            previous_byte_offset = statement.end;
            SqlStatementRange {
                start_offset,
                end_offset: utf16_offset,
            }
        })
        .collect()
}

pub(super) fn sql_statement_at_cursor(
    sql: &str,
    dialect: StatementScanDialect,
    cursor_utf16_offset: usize,
) -> Option<SqlStatementSelection> {
    let statements = split_sql_statement_spans_with_soft_boundaries(sql, dialect);
    if statements.is_empty() {
        return None;
    }
    let cursor_byte_offset = utf16_offset_to_byte_offset(sql, cursor_utf16_offset);
    let line_start = sql[..cursor_byte_offset]
        .rfind('\n')
        .map(|index| index + 1)
        .unwrap_or(0);
    let line_end = sql[cursor_byte_offset..]
        .find('\n')
        .map(|index| cursor_byte_offset + index)
        .unwrap_or(sql.len());
    if sql[line_start..line_end].trim().is_empty() {
        return None;
    }
    let statement_index = statements
        .iter()
        .position(|statement| {
            cursor_byte_offset >= statement.start && cursor_byte_offset <= statement.end
        })
        .or_else(|| {
            statements
                .iter()
                .position(|statement| statement.start > cursor_byte_offset)
        })
        .unwrap_or(statements.len() - 1);
    let statement = statements[statement_index];
    let statement_ranges = (statements.len() <= MAX_CACHED_STATEMENT_RANGES)
        .then(|| sql_statement_ranges_utf16(sql, &statements));
    let (start_offset, end_offset) = statement_ranges
        .as_ref()
        .and_then(|ranges| ranges.get(statement_index))
        .map(|range| (range.start_offset, range.end_offset))
        .unwrap_or_else(|| {
            (
                byte_offset_to_utf16_offset(sql, statement.start),
                byte_offset_to_utf16_offset(sql, statement.end),
            )
        });
    Some(SqlStatementSelection {
        sql: statement.text.to_string(),
        start_offset,
        end_offset,
        statement_index,
        statement_count: statements.len(),
        statement_ranges,
    })
}

impl QueryCancellationState {
    pub(super) async fn register(
        &self,
        query_id: &str,
        connection_id: &str,
    ) -> Result<watch::Receiver<bool>, String> {
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let mut handles = self.0.lock().await;
        if handles.contains_key(query_id) {
            return Err(format!("Query already active: {query_id}"));
        }

        handles.insert(
            query_id.to_string(),
            QueryCancellationHandle {
                connection_id: connection_id.to_string(),
                sender: cancel_tx,
            },
        );
        Ok(cancel_rx)
    }

    pub(super) async fn take(&self, query_id: &str) -> Option<QueryCancellationHandle> {
        self.0.lock().await.remove(query_id)
    }
}
