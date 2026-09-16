use super::execution_model::SchemaMigrationStatus;
use crate::core::schema_diff::SchemaDiffSummary;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaMigrationPreflightStatus {
    Passed,
    Warning,
    Blocked,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationPreflightResult {
    pub check_id: String,
    pub change_id: String,
    pub label: String,
    pub expectation: String,
    pub status: SchemaMigrationPreflightStatus,
    pub observed: String,
    pub blocks_execution: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRollbackArtifact {
    pub available: bool,
    pub reason: Option<String>,
    pub plan_id: Option<String>,
    pub change_count: usize,
    pub requires_manual_review: bool,
    pub sql: Option<String>,
    #[serde(default)]
    pub backup_path: Option<String>,
    #[serde(default)]
    pub backup_byte_len: Option<u64>,
    #[serde(default)]
    pub backup_integrity_check: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationVerification {
    pub matches_source: bool,
    pub target_fingerprint_after: String,
    pub remaining_plan_id: String,
    pub remaining_summary: SchemaDiffSummary,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationJournalEntry {
    pub id: String,
    pub project_id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub database_name: Option<String>,
    pub schema_name: String,
    pub plan_id: String,
    pub source_fingerprint: String,
    pub target_fingerprint_before: String,
    pub status: SchemaMigrationStatus,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub statement_count: usize,
    pub committed_statements: usize,
    pub preflight_results: Vec<SchemaMigrationPreflightResult>,
    pub rollback: SchemaRollbackArtifact,
    pub verification: Option<SchemaMigrationVerification>,
    pub error: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}
