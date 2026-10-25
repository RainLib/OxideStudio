//! Opaque preparation-time target fence. No saved credentials are persisted.
use super::{
    files,
    models::{FileIdentity, LargeTransferEndpoint, StoredJob},
    runtime::LargeTransferJobs,
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

pub const FILE_IMPORT_TARGET_CHANGED: &str = "TABLE_IMPORT_TARGET_CHANGED";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileImportTargetBinding {
    project_id: String,
    endpoint: LargeTransferEndpoint,
    configuration_mac: String,
    file: FileIdentity,
}
impl FileImportTargetBinding {
    pub(super) fn require_job(&self, job: &StoredJob) -> Result<()> {
        if self.project_id != job.request.project_id
            || job.request.target.driver != "sqlite"
            || serde_json::to_value(&self.endpoint)? != serde_json::to_value(&job.request.target)?
            || self.configuration_mac != job.target_binding
            || job.target_file.as_ref() != Some(&self.file)
        {
            bail!(FILE_IMPORT_TARGET_CHANGED);
        }
        Ok(())
    }
    pub(super) fn require_request(
        &self,
        project: &str,
        endpoint: &LargeTransferEndpoint,
    ) -> Result<()> {
        if self.project_id != project
            || serde_json::to_value(endpoint)? != serde_json::to_value(&self.endpoint)?
        {
            bail!(FILE_IMPORT_TARGET_CHANGED);
        }
        Ok(())
    }
}
impl LargeTransferJobs {
    pub async fn capture_file_import_target(
        &self,
        project: &str,
        endpoint: &LargeTransferEndpoint,
    ) -> Result<FileImportTargetBinding> {
        if project.is_empty()
            || project.len() > 128
            || endpoint.driver != "sqlite"
            || endpoint.connection_id.is_empty()
            || endpoint.connection_id.len() > 128
            || endpoint.table.is_empty()
            || endpoint.table.len() > 1024
        {
            bail!("invalid native file import target");
        }
        let (path, config) = self
            .endpoint_binding(project, endpoint, "sqlite", true)
            .await?;
        let file = files::identity(&path.context("file import requires a local SQLite target")?)?;
        let control = files::identity(&self.store.root.join("jobs.sqlite"))?;
        if (file.volume, file.index) == (control.volume, control.index) {
            bail!("control storage cannot be an import target");
        }
        Ok(FileImportTargetBinding {
            project_id: project.into(),
            endpoint: endpoint.clone(),
            configuration_mac: self.store.authenticate("target-config", &config)?,
            file,
        })
    }
    pub async fn require_file_import_target(
        &self,
        binding: &FileImportTargetBinding,
    ) -> Result<()> {
        let actual = self
            .capture_file_import_target(&binding.project_id, &binding.endpoint)
            .await
            .map_err(|_| anyhow::anyhow!(FILE_IMPORT_TARGET_CHANGED))?;
        if serde_json::to_value(actual)? != serde_json::to_value(binding)? {
            bail!(FILE_IMPORT_TARGET_CHANGED);
        }
        Ok(())
    }
}
