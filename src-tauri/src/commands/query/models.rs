use serde::Serialize;
use sqlx::error::{DatabaseError, ErrorKind};
use sqlx::mysql::MySqlDatabaseError;
use sqlx::postgres::{PgDatabaseError, PgErrorPosition};

pub(super) const MAX_SQL_IMPORT_BYTES: u64 = 128 * 1024 * 1024;
pub(super) const MAX_CONSOLE_FILE_BYTES: u64 = 16 * 1024 * 1024;
pub(super) const MAX_DATABASE_ERROR_IDENTIFIER_CHARS: usize = 512;
pub(super) const MAX_SQL_SYNTAX_VALIDATION_CHARS: usize = 500_000;
pub(super) const MAX_SQL_SYNTAX_DIAGNOSTIC_CHARS: usize = 1_000;
pub(super) const MAX_CACHED_STATEMENT_RANGES: usize = 10_000;
pub(super) const MAX_NATIVE_QUERY_PAGE_SIZE: u32 = 10_000;
pub(super) const MAX_NATIVE_QUERY_CURSOR_CHARS: usize = 128;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct DatabaseErrorDiagnostic {
    driver: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    sql_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vendor_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    severity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    schema: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    column: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    constraint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
}

pub(super) struct ExtractedDatabaseError {
    pub(super) message: String,
    pub(super) diagnostic: DatabaseErrorDiagnostic,
}

pub(super) fn bounded_database_identifier(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        return None;
    }
    Some(
        value
            .chars()
            .take(MAX_DATABASE_ERROR_IDENTIFIER_CHARS)
            .collect(),
    )
}

pub(super) fn database_error_kind(error: &(dyn DatabaseError + 'static)) -> Option<&'static str> {
    match error.kind() {
        ErrorKind::UniqueViolation => Some("uniqueViolation"),
        ErrorKind::ForeignKeyViolation => Some("foreignKeyViolation"),
        ErrorKind::NotNullViolation => Some("notNullViolation"),
        ErrorKind::CheckViolation => Some("checkViolation"),
        ErrorKind::Other => None,
        _ => None,
    }
}

pub(super) fn extracted_database_error(error: &anyhow::Error) -> Option<ExtractedDatabaseError> {
    let sqlx_error = error.downcast_ref::<sqlx::Error>()?;
    let database_error = sqlx_error.as_database_error()?;
    let kind = database_error_kind(database_error);

    if let Some(postgres) = database_error.try_downcast_ref::<PgDatabaseError>() {
        return Some(ExtractedDatabaseError {
            message: postgres.message().to_string(),
            diagnostic: DatabaseErrorDiagnostic {
                driver: "postgres",
                sql_state: Some(postgres.code().to_string()),
                vendor_code: None,
                severity: Some(format!("{:?}", postgres.severity()).to_ascii_uppercase()),
                position: match postgres.position() {
                    Some(PgErrorPosition::Original(position)) => Some(position),
                    // Never expose the server-generated internal query.
                    Some(PgErrorPosition::Internal { .. }) | None => None,
                },
                schema: bounded_database_identifier(postgres.schema()),
                table: bounded_database_identifier(postgres.table()),
                column: bounded_database_identifier(postgres.column()),
                constraint: bounded_database_identifier(postgres.constraint()),
                data_type: bounded_database_identifier(postgres.data_type()),
                kind,
            },
        });
    }

    if let Some(mysql) = database_error.try_downcast_ref::<MySqlDatabaseError>() {
        return Some(ExtractedDatabaseError {
            message: mysql.message().to_string(),
            diagnostic: DatabaseErrorDiagnostic {
                driver: "mysql",
                sql_state: mysql.code().map(str::to_string),
                vendor_code: Some(mysql.number()),
                severity: None,
                position: None,
                schema: None,
                table: None,
                column: None,
                constraint: None,
                data_type: None,
                kind,
            },
        });
    }

    Some(ExtractedDatabaseError {
        message: database_error.message().to_string(),
        diagnostic: DatabaseErrorDiagnostic {
            driver: "database",
            sql_state: database_error.code().map(|value| value.into_owned()),
            vendor_code: None,
            severity: None,
            position: None,
            schema: None,
            table: bounded_database_identifier(database_error.table()),
            column: None,
            constraint: bounded_database_identifier(database_error.constraint()),
            data_type: None,
            kind,
        },
    })
}

pub(super) fn query_error_context(
    mut query_context: serde_json::Value,
    diagnostic: Option<&DatabaseErrorDiagnostic>,
) -> serde_json::Value {
    if let (Some(context), Some(diagnostic)) = (query_context.as_object_mut(), diagnostic) {
        context.insert(
            "databaseError".to_string(),
            serde_json::to_value(diagnostic)
                .expect("database error diagnostics should always serialize"),
        );
    }
    query_context
}
