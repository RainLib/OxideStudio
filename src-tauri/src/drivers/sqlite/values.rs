use crate::core::protocol::QueryParameter;
use anyhow::{anyhow, Result};
use serde_json::Value;
use sqlx::sqlite::{SqliteArguments, SqliteRow};
use sqlx::{Column, Row, Sqlite, TypeInfo};

pub(super) fn normalize_sqlite_url(value: &str) -> String {
    let value = value.trim();
    if value == ":memory:" {
        "sqlite::memory:".to_string()
    } else if value.starts_with("sqlite:") {
        value.to_string()
    } else {
        format!("sqlite://{value}")
    }
}

pub(super) fn sqlite_identifier(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.contains('\0') {
        return Err(anyhow!("Invalid SQLite identifier"));
    }
    Ok(format!("\"{}\"", value.replace('"', "\"\"")))
}

pub(super) fn sqlite_schema_identifier(value: &str) -> Result<String> {
    sqlite_identifier(normalized_sqlite_schema(value))
}

pub(super) fn normalized_sqlite_schema(value: &str) -> &str {
    let value = value.trim();
    if value.is_empty() {
        "main"
    } else {
        value
    }
}

pub(super) fn sqlite_value(row: &SqliteRow, index: usize) -> Value {
    // SQLite permits permissive coercion (for example TEXT -> i64 yields 0),
    // so probing decoders in an arbitrary order corrupts visible result data.
    // Use the value's actual SQLite storage type reported by SQLx instead.
    let storage_type = row.column(index).type_info().name().to_ascii_uppercase();
    match storage_type.as_str() {
        "NULL" => Value::Null,
        "INTEGER" | "BOOLEAN" => row
            .try_get_unchecked::<Option<i64>, _>(index)
            .ok()
            .flatten()
            .map(serde_json::Number::from)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        "REAL" | "FLOAT" | "DOUBLE" => row
            .try_get_unchecked::<Option<f64>, _>(index)
            .ok()
            .flatten()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        "BLOB" => row
            .try_get_unchecked::<Option<Vec<u8>>, _>(index)
            .ok()
            .flatten()
            .map(|bytes| {
                Value::String(format!(
                    "0x{}",
                    bytes
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect::<String>()
                ))
            })
            .unwrap_or(Value::Null),
        _ => row
            .try_get_unchecked::<Option<String>, _>(index)
            .ok()
            .flatten()
            .map(Value::String)
            .unwrap_or(Value::Null),
    }
}

pub(super) fn bind_sqlite_parameter<'q>(
    query: sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>,
    parameter: &QueryParameter,
) -> Result<sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>> {
    match &parameter.value {
        Value::Null => Ok(query.bind(Option::<String>::None)),
        Value::Bool(value) => Ok(query.bind(*value)),
        Value::Number(value) if value.is_i64() => {
            Ok(query.bind(value.as_i64().unwrap_or_default()))
        }
        Value::Number(value) if value.is_u64() => {
            Ok(query.bind(value.as_u64().unwrap_or_default() as i64))
        }
        Value::Number(value) => Ok(query.bind(value.as_f64().unwrap_or_default())),
        Value::String(value) => Ok(query.bind(value.clone())),
        value => Ok(query.bind(serde_json::to_string(value)?)),
    }
}
