//! A durable preparation has exactly one initial job record and review.
use super::{
    file_source::FileImportRequest,
    files,
    models::{
        FilePreparationLink, LargeTransferPhase as Phase, LargeTransferPreview,
        LargeTransferRequest, StoredJob,
    },
    preparation::FileImportPreparation,
    preparation_target::FileImportTargetBinding,
    runtime::{preview, LargeTransferJobs},
};
use anyhow::{bail, Context, Result};

impl LargeTransferJobs {
    /// Returns an existing review without reopening the disposable raw input.
    pub async fn file_import_preparation_result(
        &self,
        project: &str,
        id: &str,
    ) -> Result<Option<LargeTransferPreview>> {
        if !self.store.contains(id).await? {
            return Ok(None);
        }
        let mut job = self.store.load(project, id).await?;
        let link = job
            .file_preparation
            .clone()
            .context("this job is not a file preparation handoff")?;
        if job.plan_digest.is_empty() && job.summary.phase != Phase::Cancelled {
            return Ok(None);
        }
        self.get(project, id).await?;
        job = self.store.load(project, id).await?;
        if let Err(error) = self.retire_file_preparation(project, &link).await {
            tracing::warn!(%error, "retired file preparation cleanup deferred");
        }
        if job.plan_digest.is_empty() {
            bail!("file preparation job was cancelled");
        }
        Ok(Some(preview(&job)))
    }

    pub async fn prepare_file_import_from_preparation(
        &self,
        request: FileImportRequest,
        normalized: &std::path::Path,
        preparation: &FileImportPreparation,
        binding: &FileImportTargetBinding,
    ) -> Result<LargeTransferPreview> {
        preparation.require_project(&request.project_id)?;
        if preparation.progress()?.phase != super::preparation::FileImportPreparationPhase::Ready {
            bail!("file preparation is not ready for handoff");
        }
        preparation.require_source_digest(&request.source.source_digest)?;
        let link = preparation.handoff_link(&self.store)?;
        binding.require_request(&request.project_id, &request.target)?;
        request.source.validate()?;
        if request.target.driver != "sqlite"
            || request.mode == super::models::LargeTransferMode::Upsert
        {
            bail!("file preparation requires native SQLite append or overwrite");
        }
        let transfer = LargeTransferRequest {
            project_id: request.project_id.clone(),
            source: super::models::LargeTransferEndpoint {
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
        if self.store.contains(&link.id).await? {
            let job = self.store.load(&transfer.project_id, &link.id).await?;
            require_same_handoff(&job, &transfer, &request.source, &link, binding)?;
            if !job.plan_digest.is_empty() {
                return self
                    .file_import_preparation_result(&transfer.project_id, &link.id)
                    .await?
                    .context("handoff review is unavailable");
            }
        }
        self.require_file_import_target(binding).await?;
        let input = normalized.to_path_buf();
        let verify = input.clone();
        if tokio::task::spawn_blocking(move || files::digest(&verify)).await??
            != request.source.normalized_digest
        {
            bail!("normalized file import snapshot changed");
        }
        let (job, lease) = if self.store.contains(&link.id).await? {
            let lease = self.store.lease(&link.id)?;
            let job = self.store.load(&transfer.project_id, &link.id).await?;
            require_same_handoff(&job, &transfer, &request.source, &link, binding)?;
            if !job.plan_digest.is_empty() {
                return Ok(preview(&job));
            }
            if matches!(job.summary.phase, Phase::Completed | Phase::Cancelled) {
                bail!("file preparation job is terminal");
            }
            files::require_identity(job.source_file()?)?;
            if files::identity(&input)? != *job.source_file()? {
                bail!("normalization input identity changed");
            }
            (job, lease)
        } else {
            self.create_with_source_fence(
                transfer,
                Some(request.source),
                Some(input),
                Some((binding, link)),
            )
            .await?
        };
        self.prepare_job(job, lease).await
    }

    pub(super) async fn recover_file_import_handoffs(&self) -> Result<()> {
        let mut after = String::new();
        loop {
            let page = self.store.retired_preparations(&after).await?;
            if page.is_empty() {
                break;
            }
            for (project, id) in page {
                after = id.clone();
                let result = async {
                    let job = self.store.load(&project, &id).await?;
                    if let Some(link) = job.file_preparation.as_ref() {
                        self.retire_file_preparation(&project, link).await?;
                    }
                    Ok::<_, anyhow::Error>(())
                }
                .await;
                if let Err(error) = result {
                    tracing::warn!(%error, "file preparation handoff cleanup deferred");
                }
            }
        }
        Ok(())
    }
}

fn require_same_handoff(
    job: &StoredJob,
    transfer: &LargeTransferRequest,
    source: &super::file_source::FileImportPlan,
    link: &FilePreparationLink,
    binding: &FileImportTargetBinding,
) -> Result<()> {
    binding.require_job(job)?;
    if job.file_preparation.as_ref() != Some(link)
        || serde_json::to_value(&job.request)? != serde_json::to_value(transfer)?
        || serde_json::to_value(&job.file_import)? != serde_json::to_value(Some(source))?
    {
        bail!("file preparation handoff definition changed");
    }
    Ok(())
}
