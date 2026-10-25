use super::{
    files,
    models::{Header, LargeTransferPhase as Phase, LargeTransferSummary, StoredJob},
    runtime::LargeTransferJobs,
    target::Target,
};
use anyhow::{bail, Result};
use std::time::Duration;

impl LargeTransferJobs {
    pub async fn get(&self, project: &str, id: &str) -> Result<LargeTransferSummary> {
        let mut job = self.store.recover(project, id).await?;
        if matches!(job.summary.phase, Phase::Completed | Phase::Cancelled)
            && job.summary.issue.as_deref() == Some("snapshot_cleanup_pending")
        {
            if let Ok(_lease) = self.store.lease(id) {
                job = self.store.load(project, id).await?;
                self.cleanup_snapshot(&mut job);
                if job.summary.issue.is_none() {
                    self.store.save(&mut job).await?;
                }
            }
        }
        if !matches!(job.summary.phase, Phase::Completed | Phase::Cancelled) {
            if let Ok(_lease) = self.store.lease(id) {
                job = self.store.load(project, id).await?;
                // A committed publication is historical fact even if a saved
                // endpoint was edited after the process died. Never reroute it.
                if !job.plan_digest.is_empty() {
                    let probe = async {
                        let mut connection = Target::open(&self.store, &job, true).await?;
                        let header = connection.read_header(&self.store, &job).await?;
                        connection.close().await?;
                        Ok::<_, anyhow::Error>(header.filter(|h| h.published))
                    };
                    if let Ok(Ok(Some(header))) =
                        tokio::time::timeout(Duration::from_secs(5), probe).await
                    {
                        self.complete(&mut job, header).await?;
                    }
                }
            }
        }
        if !matches!(job.summary.phase, Phase::Completed | Phase::Cancelled)
            && job.summary.issue.as_deref() != Some("cancellation_requires_review")
            && self.store.action(id).await? == "cancel"
        {
            if self.try_cancel(project, id).await? {
                job = self.store.load(project, id).await?;
            } else {
                self.schedule_cancellation(project.to_owned(), id.to_owned())
                    .await;
            }
        }
        Ok(job.summary)
    }

    pub(super) async fn complete(&self, job: &mut StoredJob, header: Header) -> Result<()> {
        job.summary.rows_staged = header.rows;
        job.summary.batches = header.batches;
        job.summary.phase = Phase::Completed;
        self.cleanup_snapshot(job);
        self.store.save(job).await
    }

    fn cleanup_snapshot(&self, job: &mut StoredJob) {
        job.summary.issue = files::cleanup_snapshot(&self.store.root, &job.summary.id)
            .err()
            .map(|_| "snapshot_cleanup_pending".into());
    }

    pub(super) async fn finish_cancelled(&self, job: &mut StoredJob) -> Result<()> {
        job.summary.phase = Phase::Cancelled;
        self.cleanup_snapshot(job);
        self.store.save(job).await
    }

    pub(super) async fn cancel_owned(
        &self,
        job: &mut StoredJob,
        connection: &mut Target,
    ) -> Result<()> {
        connection.remove_staging(&self.store, job).await?;
        self.finish_cancelled(job).await
    }

    /// Returns false while an active owner still holds the OS lease. A worker
    /// re-loads after acquiring it so a preparation/ready race cannot leak data.
    async fn try_cancel(&self, project: &str, id: &str) -> Result<bool> {
        let Ok(_lease) = self.store.lease(id) else {
            return Ok(false);
        };
        let mut job = self.store.load(project, id).await?;
        if matches!(job.summary.phase, Phase::Completed | Phase::Cancelled)
            || self.store.action(id).await? != "cancel"
        {
            return Ok(true);
        }
        let result = async {
            if job.plan_digest.is_empty() {
                return self.finish_cancelled(&mut job).await;
            }
            let mut connection = Target::open(&self.store, &job, false).await?;
            self.cancel_owned(&mut job, &mut connection).await?;
            connection.close().await?;
            Ok(())
        }
        .await;
        if result.is_err() {
            job.summary.phase = Phase::Paused;
            job.summary.issue = Some("cancellation_requires_review".into());
            self.store.save(&mut job).await?;
        }
        result.map(|()| true)
    }

    async fn schedule_cancellation(&self, project: String, id: String) {
        if !self.cancellation_tasks.lock().await.insert(id.clone()) {
            return;
        }
        let service = self.clone();
        tokio::spawn(async move {
            while matches!(service.try_cancel(&project, &id).await, Ok(false)) {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            service.cancellation_tasks.lock().await.remove(&id);
        });
    }

    pub(super) async fn recover_cancellations(&self) -> Result<()> {
        let mut after = String::new();
        loop {
            let requests = self.store.pending_cancellations(&after).await?;
            if requests.is_empty() {
                return Ok(());
            }
            for (project, id) in requests {
                after.clone_from(&id);
                self.schedule_cancellation(project, id).await;
            }
        }
    }

    pub async fn cancel(&self, project: &str, id: &str) -> Result<()> {
        let mut job = self.store.load(project, id).await?;
        if job.summary.phase == Phase::Cancelled {
            return Ok(());
        }
        if matches!(job.summary.phase, Phase::Completed | Phase::Publishing) {
            bail!("published or publishing migrations cannot be cancelled");
        }
        self.store.request_action(project, id, "cancel").await?;
        if let Some(control) = self.controls.lock().await.get(id) {
            control.cancel();
        }
        if !self.try_cancel(project, id).await? {
            self.schedule_cancellation(project.to_owned(), id.to_owned())
                .await;
        } else if job.summary.issue.as_deref() == Some("cancellation_requires_review") {
            // The retry completed using the unchanged original file identity.
            job = self.store.load(project, id).await?;
            if job.summary.phase != Phase::Cancelled {
                bail!("migration cancellation still requires review");
            }
        }
        Ok(())
    }
}
