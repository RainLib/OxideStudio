//! Row types for table operations.

use crate::core::protocol::QueryResult;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePageResult {
    pub result: QueryResult,
    pub page: u32,
    pub page_size: u32,
    pub total_rows: Option<u64>,
}

pub(super) fn should_calculate_table_total(include_total: Option<bool>) -> bool {
    include_total.unwrap_or(false)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRowUpdate {
    pub key: BTreeMap<String, Value>,
    pub values: BTreeMap<String, Value>,
    /// Explicit grid-expression edits. They are validated as a single SQL
    /// expression before they can enter a generated SET assignment; regular
    /// values above always remain bound parameters.
    #[serde(default)]
    pub expressions: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRowDelete {
    pub key: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMutationResult {
    pub inserted: u64,
    pub updated: u64,
    pub deleted: u64,
    pub rows_affected: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableFilter {
    pub column: String,
    pub operator: String,
    pub value: String,
    pub logic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSort {
    pub column: String,
    pub direction: String,
}
