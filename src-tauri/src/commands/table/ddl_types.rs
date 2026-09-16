//! Ddl types for table operations.

use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTableColumn {
    pub name: String,
    pub data_type: String,
    pub length: Option<String>,
    pub is_primary_key: bool,
    pub is_not_null: bool,
    pub is_auto_increment: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlterColumnValueMode {
    Keep,
    Set,
    Drop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlterTableColumn {
    pub name: String,
    pub data_type: Option<String>,
    pub length: Option<String>,
    pub is_not_null: Option<bool>,
    pub default_mode: Option<AlterColumnValueMode>,
    pub default_value: Option<String>,
    pub comment_mode: Option<AlterColumnValueMode>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTableResult {
    pub table: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateViewResult {
    pub view: String,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMaterializedViewResult {
    pub view: String,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumnChangeResult {
    pub table: String,
    pub column: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIndexChangeResult {
    pub table: String,
    pub index: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableConstraintChangeResult {
    pub table: String,
    pub constraint: String,
    pub statements: Vec<String>,
}
