//! Host-prepared file snapshots use the same authenticated receipts and atomic
//! target publication as database transfers. No synthetic saved connection.
use super::{
    files,
    models::{
        LargeTransferEndpoint, LargeTransferMode, LargeTransferPreview, LargeTransferRequest,
    },
    runtime::LargeTransferJobs,
};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileImportFormat {
    Csv,
    Json,
    Xlsx,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileImportColumn {
    pub source: String,
    pub target: String,
}

/// Persisted inside the private authenticated ledger, never a credential store.
/// The host supplies a SQLite `data` table whose column names are mapped targets.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileImportPlan {
    pub file_name: String,
    pub format: FileImportFormat,
    pub source_digest: String,
    pub normalized_digest: String,
    pub columns: Vec<FileImportColumn>,
    /// Typed import options serialized by the host, not source rows.
    pub options: serde_json::Value,
    /// Internal snapshot column. Absent for legacy fixed-shape v4 jobs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presence_column: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileImportRequest {
    pub project_id: String,
    pub target: LargeTransferEndpoint,
    pub mode: LargeTransferMode,
    pub batch_rows: u32,
    pub source: FileImportPlan,
}

impl FileImportPlan {
    pub(super) fn validate(&self) -> Result<()> {
        if self.file_name.is_empty()
            || self.file_name.len() > 1024
            || self
                .file_name
                .chars()
                .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
            || (self.columns.is_empty() && self.presence_column.is_none())
            || self.columns.len() > 512
            || serde_json::to_vec(&self.options)?.len() > 64 * 1024
            || !self.options.is_object()
        {
            bail!("file import metadata exceeds its budget or is invalid");
        }
        for digest in [&self.source_digest, &self.normalized_digest] {
            if digest.len() != 64
                || !digest
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            {
                bail!("file import requires exact SHA-256 digests");
            }
        }
        let mut targets = std::collections::HashSet::new();
        if let Some(name) = &self.presence_column {
            if self.format != FileImportFormat::Json
                || name.is_empty()
                || name.len() > 1024
                || name.chars().any(char::is_control)
                || self.columns.iter().any(|c| {
                    c.source.eq_ignore_ascii_case(name) || c.target.eq_ignore_ascii_case(name)
                })
            {
                bail!("file import presence column is invalid");
            }
        }
        for column in &self.columns {
            if [&column.source, &column.target].iter().any(|name| {
                name.is_empty() || name.len() > 1024 || name.chars().any(char::is_control)
            }) || !targets.insert(column.target.to_ascii_lowercase())
            {
                bail!("file import mapping is invalid or duplicates a target");
            }
        }
        Ok(())
    }

    pub(crate) fn presence_bytes(&self) -> usize {
        self.columns.len().div_ceil(8)
    }
}

impl LargeTransferJobs {
    /// Native host API. The renderer cannot supply a SQLite path through the
    /// ordinary database-transfer command. Preparation copies and authenticates
    /// the snapshot before returning its review; the input may then go offline.
    pub async fn prepare_file_import(
        &self,
        request: FileImportRequest,
        normalized: &Path,
    ) -> Result<LargeTransferPreview> {
        request.source.validate()?;
        if request.target.driver != "sqlite" || request.mode == LargeTransferMode::Upsert {
            bail!("file import currently supports native SQLite append or overwrite");
        }
        let input = normalized.to_path_buf();
        let verify = input.clone();
        let digest = tokio::task::spawn_blocking(move || files::digest(&verify)).await??;
        if digest != request.source.normalized_digest {
            bail!("normalized file import snapshot changed");
        }
        let transfer = LargeTransferRequest {
            project_id: request.project_id,
            // Explicit file endpoint. It is never resolved as a connection.
            source: LargeTransferEndpoint {
                connection_id: "file-import".into(),
                driver: "file".into(),
                schema: String::new(),
                table: "data".into(),
                database: None,
            },
            target: request.target,
            mode: request.mode,
            batch_rows: request.batch_rows,
        };
        let (job, lease) = self
            .create_with_source(transfer, Some(request.source), Some(input))
            .await?;
        self.prepare_job(job, lease).await
    }
}
