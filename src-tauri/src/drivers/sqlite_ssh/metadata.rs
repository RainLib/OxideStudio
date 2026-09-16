use crate::core::protocol::ColumnDef;
use anyhow::{anyhow, bail, Result};
use oxide_sqlite_worker::WorkerResponseBody;

use super::models::WorkerTable;

impl WorkerTable {
    pub(super) fn column_index(&self, name: &str) -> Option<usize> {
        self.columns
            .iter()
            .position(|column| column.name.eq_ignore_ascii_case(name))
    }

    pub(super) fn required_column(&self, name: &str) -> Result<usize> {
        self.column_index(name)
            .ok_or_else(|| anyhow!("SQLite metadata omitted {name}"))
    }
}

pub(super) fn worker_table(body: WorkerResponseBody) -> Result<WorkerTable> {
    match body {
        WorkerResponseBody::Result { columns, rows, .. } => Ok(WorkerTable {
            columns: columns
                .into_iter()
                .map(|column| ColumnDef {
                    name: column.name,
                    data_type: column.data_type,
                })
                .collect(),
            rows,
        }),
        _ => bail!("SQLite worker returned an unexpected metadata response"),
    }
}

pub(super) fn string_at(row: &[serde_json::Value], index: usize) -> Option<String> {
    match row.get(index)? {
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        serde_json::Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

pub(super) fn integer_at(row: &[serde_json::Value], index: usize) -> Option<i64> {
    row.get(index)?
        .as_i64()
        .or_else(|| row.get(index)?.as_str()?.parse().ok())
}

pub(super) fn normalized_schema(schema: &str) -> &str {
    if schema.trim().is_empty() {
        "main"
    } else {
        schema.trim()
    }
}

pub(super) fn quote_identifier(value: &str) -> Result<String> {
    if value.trim().is_empty()
        || value.contains('\0')
        || value.contains('\n')
        || value.contains('\r')
    {
        bail!("Invalid SQLite identifier");
    }
    Ok(format!("\"{}\"", value.replace('"', "\"\"")))
}
