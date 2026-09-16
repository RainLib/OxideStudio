use crate::core::{
    protocol::{QueryResult, Response},
    redaction::redact_connection_url,
};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DatabaseAdminErrorKind {
    PermissionDenied,
    ConnectionUnavailable,
    Unsupported,
    Validation,
    QueryFailed,
}

impl DatabaseAdminErrorKind {
    const fn code_suffix(self) -> Option<&'static str> {
        match self {
            Self::PermissionDenied => Some("PERMISSION_DENIED"),
            Self::ConnectionUnavailable => Some("CONNECTION_UNAVAILABLE"),
            Self::Unsupported => Some("UNSUPPORTED"),
            Self::Validation => Some("VALIDATION_FAILED"),
            Self::QueryFailed => None,
        }
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::PermissionDenied => "permissionDenied",
            Self::ConnectionUnavailable => "connectionUnavailable",
            Self::Unsupported => "unsupported",
            Self::Validation => "validation",
            Self::QueryFailed => "queryFailed",
        }
    }

    const fn retryable(self) -> bool {
        matches!(self, Self::ConnectionUnavailable)
    }
}

pub(super) fn value_string(value: Option<&Value>) -> Option<String> {
    value.and_then(|value| match value {
        Value::Null => None,
        Value::String(value) => (!value.trim().is_empty()).then(|| value.clone()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        other => Some(other.to_string()),
    })
}

pub(super) fn value_bool(value: Option<&Value>) -> Option<bool> {
    match value {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::Number(value)) => value.as_i64().map(|value| value != 0),
        Some(Value::String(value)) => match value.trim().to_ascii_lowercase().as_str() {
            "true" | "t" | "1" | "yes" | "y" => Some(true),
            "false" | "f" | "0" | "no" | "n" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

pub(super) fn value_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(value)) => value.as_u64(),
        Some(Value::String(value)) => value.trim().parse().ok(),
        _ => None,
    }
}

pub(super) fn primary_result(results: Vec<QueryResult>) -> Result<QueryResult, String> {
    results
        .into_iter()
        .next()
        .ok_or_else(|| "Database returned no administration result".to_string())
}

pub(super) fn result_row<'a>(
    result: &'a QueryResult,
    row: &'a [Value],
    name: &str,
) -> Option<&'a Value> {
    result
        .columns
        .iter()
        .position(|column| column.name.eq_ignore_ascii_case(name))
        .and_then(|index| row.get(index))
}

pub(super) fn validate_text<'a>(
    value: &'a str,
    field: &str,
    max_length: usize,
) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{field} is required"));
    }
    if value.len() > max_length || value.contains('\0') {
        return Err(format!("Invalid {field}"));
    }
    Ok(value)
}

pub(super) fn require_confirmed(confirmed: bool) -> Result<(), String> {
    if confirmed {
        Ok(())
    } else {
        Err("Explicit confirmation is required for this administration action".to_string())
    }
}

pub(super) fn sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub(super) fn postgres_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

pub(super) fn mysql_identifier(value: &str) -> String {
    format!("`{}`", value.replace('`', "``"))
}

pub(super) fn mysql_account(name: &str, host: Option<&str>) -> Result<String, String> {
    let name = validate_text(name, "User name", 128)?;
    let host = validate_text(host.unwrap_or("%"), "Host", 255)?;
    Ok(format!("{}@{}", sql_string(name), sql_string(host)))
}

pub(super) fn classify_database_admin_error(error: &str) -> DatabaseAdminErrorKind {
    let normalized = error.to_ascii_lowercase();
    if [
        "permission denied",
        "insufficient privilege",
        "insufficient_privilege",
        "must be superuser",
        "only superuser",
        "access denied",
        "command denied",
        "sqlstate 42501",
        "sqlstate: 42501",
        "error 1044",
        "error 1045",
        "error 1142",
        "error 1227",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
    {
        DatabaseAdminErrorKind::PermissionDenied
    } else if [
        "explicit confirmation",
        " is required",
        "invalid ",
        "must be a positive number",
        "does not match the active connection identity",
        "maintenance target table is no longer available",
        "maintenance target must be a base table",
        "maintenance plan changed",
        "maintenance confirmation text does not match",
        "event target no longer exists",
        "event target already exists",
        "event plan changed",
        "event confirmation text does not match",
        "event body must",
        "event body may",
        "invalid event",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
    {
        DatabaseAdminErrorKind::Validation
    } else if [
        "does not provide a verified semantic database-administration protocol",
        "database administration is currently available",
        "unsupported database driver",
        "metadata is unavailable",
        " is not supported for ",
        "remote database maintenance is supported only",
        "event administration is available only",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
    {
        DatabaseAdminErrorKind::Unsupported
    } else if [
        "connection not found",
        "connection is unavailable",
        "connection closed",
        "connection refused",
        "lost connection",
        "broken pipe",
        "server has gone away",
        "network is unreachable",
        "timed out",
        "timeout",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
    {
        DatabaseAdminErrorKind::ConnectionUnavailable
    } else {
        DatabaseAdminErrorKind::QueryFailed
    }
}

pub(super) fn bounded_admin_validation_message(error: &str) -> String {
    let redacted = redact_connection_url(error);
    let normalized = redacted.split_whitespace().collect::<Vec<_>>().join(" ");
    normalized.chars().take(320).collect()
}

pub(super) fn database_admin_error_message(kind: DatabaseAdminErrorKind, error: &str) -> String {
    match kind {
        DatabaseAdminErrorKind::PermissionDenied => {
            "The connected account does not have permission for this database administration operation."
                .to_string()
        }
        DatabaseAdminErrorKind::ConnectionUnavailable => {
            "The database connection is unavailable. Reconnect and try again.".to_string()
        }
        DatabaseAdminErrorKind::Unsupported => {
            "This driver or server does not expose the required database administration capability."
                .to_string()
        }
        DatabaseAdminErrorKind::Validation => bounded_admin_validation_message(error),
        DatabaseAdminErrorKind::QueryFailed => {
            "The database administration request failed. Review the server diagnostics and try again."
                .to_string()
        }
    }
}

pub(super) fn database_admin_error_response<T>(base_code: &str, error: &str) -> Response<T> {
    let kind = classify_database_admin_error(error);
    let code = kind.code_suffix().map_or_else(
        || base_code.to_string(),
        |suffix| {
            format!(
                "{}_{}",
                base_code.strip_suffix("_ERROR").unwrap_or(base_code),
                suffix
            )
        },
    );
    Response::err_with_details(
        &code,
        &database_admin_error_message(kind, error),
        kind.retryable(),
        Some(serde_json::json!({ "adminErrorKind": kind.as_str() })),
    )
}
