use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LargeTransferEndpoint {
    pub connection_id: String,
    pub driver: String,
    pub schema: String,
    pub table: String,
    pub database: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LargeTransferMode {
    Append,
    Overwrite,
    Upsert,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LargeTransferRequest {
    pub project_id: String,
    pub source: LargeTransferEndpoint,
    pub target: LargeTransferEndpoint,
    pub mode: LargeTransferMode,
    #[serde(default = "default_batch_rows")]
    pub batch_rows: u32,
}
fn default_batch_rows() -> u32 {
    500
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LargeTransferPhase {
    Preparing,
    AwaitingReview,
    Copying,
    Paused,
    Publishing,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeTransferSummary {
    pub id: String,
    pub project_id: String,
    pub source: LargeTransferEndpoint,
    pub target: LargeTransferEndpoint,
    pub mode: LargeTransferMode,
    pub phase: LargeTransferPhase,
    pub source_rows: u64,
    pub rows_staged: u64,
    pub batches: u64,
    pub snapshot_bytes: u64,
    pub review_ready: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// A stable code, never raw database errors or row values.
    pub issue: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeTransferColumn {
    pub source: String,
    pub target: String,
    pub source_type: String,
    pub target_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeTransferPreview {
    pub job: LargeTransferSummary,
    pub confirmation_token: String,
    pub target_rows_before: u64,
    pub mapped_columns: Vec<LargeTransferColumn>,
    pub skipped_columns: Vec<String>,
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_import: Option<super::file_source::FileImportPlan>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct FilePreparationLink {
    pub id: String,
    pub intent_mac: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LargeTransferCursor {
    pub updated_at: i64,
    pub id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LargeTransferListQuery {
    pub project_id: String,
    pub cursor: Option<LargeTransferCursor>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeTransferPage {
    pub jobs: Vec<LargeTransferSummary>,
    pub next_cursor: Option<LargeTransferCursor>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct FileIdentity {
    pub path: PathBuf,
    pub volume: u64,
    pub index: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct SourceKey {
    pub column: String,
    pub collation: String,
    pub rowid: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) enum Cell {
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct StoredJob {
    pub version: u32,
    pub summary: LargeTransferSummary,
    pub request: LargeTransferRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_file: Option<FileIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_file: Option<FileIdentity>,
    pub source_binding: String,
    pub target_binding: String,
    pub snapshot_digest: String,
    pub target_schema_digest: String,
    pub target_data_digest: String,
    pub target_rows_before: u64,
    pub columns: Vec<LargeTransferColumn>,
    pub skipped_columns: Vec<String>,
    pub keys: Vec<SourceKey>,
    pub target_keys: Vec<String>,
    pub confirmation_token: String,
    pub plan_digest: String,
    pub receipt_table: String,
    pub stage_table: String,
    pub sequence_column: String,
    // Omitting absent fields preserves the serialized body and MAC of v1 jobs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub postgres: Option<PostgresPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mysql: Option<MySqlPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_import: Option<super::file_source::FileImportPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_preparation: Option<FilePreparationLink>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct SealedConfig {
    pub nonce: String,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct PostgresType {
    pub schema: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct PostgresSequence {
    pub schema: String,
    pub name: String,
    pub column: String,
    pub increment: i64,
    pub minimum: i64,
    pub maximum: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct PostgresPlan {
    pub database_oid: i64,
    pub target_oid: i64,
    pub target_types: Vec<PostgresType>,
    pub has_identity: bool,
    pub sequences: Vec<PostgresSequence>,
    pub target_connection: SealedConfig,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(super) enum MySqlCodec {
    Text,
    Binary,
    Float,
    Bit,
    Timestamp,
    Geometry,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct MySqlColumnPlan {
    pub definition: String,
    pub source_codec: MySqlCodec,
    pub target_codec: MySqlCodec,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct MySqlPlan {
    pub server_uuid: String,
    pub created: Option<String>,
    pub native_mode: String,
    pub native_time_zone: String,
    pub columns: Vec<MySqlColumnPlan>,
    pub target_connection: SealedConfig,
}

impl StoredJob {
    pub fn source_file(&self) -> anyhow::Result<&FileIdentity> {
        self.source_file
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("migration is not file based"))
    }
    pub fn target_file(&self) -> anyhow::Result<&FileIdentity> {
        self.target_file
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("migration is not file based"))
    }
    pub fn postgres(&self) -> anyhow::Result<&PostgresPlan> {
        self.postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("migration is not PostgreSQL"))
    }
    pub fn mysql(&self) -> anyhow::Result<&MySqlPlan> {
        self.mysql
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("migration is not MySQL"))
    }
    pub fn validate_version(&self) -> anyhow::Result<()> {
        let valid = match self.version {
            1 => {
                self.file_import.is_none()
                    && self.source_file.is_some()
                    && self.target_file.is_some()
                    && self.postgres.is_none()
                    && self.mysql.is_none()
            }
            2 => {
                self.file_import.is_none()
                    && self.source_file.is_none()
                    && self.target_file.is_none()
                    && self.postgres.is_some()
                    && self.mysql.is_none()
                    && self.request.source.driver == "postgres"
                    && self.request.target.driver == "postgres"
            }
            3 => {
                self.file_import.is_none()
                    && self.source_file.is_none()
                    && self.target_file.is_none()
                    && self.postgres.is_none()
                    && self.mysql.is_some()
                    && self.request.source.driver == "mysql"
                    && self.request.target.driver == "mysql"
            }
            4..=6 => {
                self.file_import.as_ref().is_some_and(|plan| {
                    plan.validate().is_ok()
                        && (self.version == 6
                            || plan.presence_column.is_some() == (self.version == 5))
                }) && self.source_file.is_some()
                    && self.target_file.is_some()
                    && self.postgres.is_none()
                    && self.mysql.is_none()
                    && self.request.source.driver == "file"
                    && self.request.source.connection_id == "file-import"
                    && self.request.source.table == "data"
                    && self.request.target.driver == "sqlite"
                    && self.request.mode != LargeTransferMode::Upsert
                    && (self.file_preparation.is_some() == (self.version == 6))
            }
            _ => false,
        };
        anyhow::ensure!(valid, "migration version or endpoint shape is invalid");
        if let Some(link) = &self.file_preparation {
            anyhow::ensure!(
                self.version == 6
                    && self.file_import.is_some()
                    && link.id == self.summary.id
                    && uuid::Uuid::parse_str(&link.id).is_ok()
                    && link.intent_mac.len() == 64
                    && link
                        .intent_mac
                        .bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()),
                "invalid file preparation handoff"
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Header {
    pub version: u32,
    pub job_id: String,
    pub plan_digest: String,
    pub snapshot_digest: String,
    pub stage_schema_digest: String,
    pub receipt_schema_digest: String,
    pub published: bool,
    pub rows: u64,
    pub batches: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct BatchReceipt {
    pub job_id: String,
    pub plan_digest: String,
    pub sequence: u64,
    pub rows_before: u64,
    pub rows_after: u64,
    pub cursor: Vec<Cell>,
    pub data_digest: String,
}

pub(super) const BATCH_BYTES: u64 = 4 * 1024 * 1024;
pub(super) const MAX_ROW_BYTES: u64 = 1024 * 1024;
pub(super) const MAX_KEY_BYTES: usize = 16 * 1024;

pub(super) fn timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
