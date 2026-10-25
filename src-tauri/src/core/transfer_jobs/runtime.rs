use super::{
    file_source::FileImportPlan,
    files,
    models::{timestamp, LargeTransferPhase as Phase, *},
    mysql, postgres, sqlite,
    store::JobStore,
    target::Target,
};
use crate::core::{
    config::SavedConnection as ConnectionConfig,
    dialect::canonical_driver_name,
    driver::LocalDatabaseBackupControl,
    driver_package::DatabaseDriverPackageRegistry,
    store::{MetaStore, SavedConnection},
};
use anyhow::{bail, Context, Result};
use serde_json::Value;
use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
};
use tokio::sync::Mutex;

struct LargeTransferBindings {
    source: Option<PathBuf>,
    target: Option<PathBuf>,
    source_config: Value,
    target_config: Value,
}

#[derive(Clone)]
pub struct LargeTransferJobs {
    pub(super) store: JobStore,
    metadata: MetaStore,
    packages: DatabaseDriverPackageRegistry,
    pub(super) controls: Arc<Mutex<HashMap<String, LocalDatabaseBackupControl>>>,
    pub(super) cancellation_tasks: Arc<Mutex<HashSet<String>>>,
}

impl LargeTransferJobs {
    pub async fn open(
        root: &Path,
        metadata: MetaStore,
        packages: DatabaseDriverPackageRegistry,
    ) -> Result<Self> {
        let service = Self {
            store: JobStore::open(root).await?,
            metadata,
            packages,
            controls: Arc::new(Mutex::new(HashMap::new())),
            cancellation_tasks: Arc::default(),
        };
        service.recover_import_preparations().await?;
        service.recover_file_import_handoffs().await?;
        service.recover_cancellations().await?;
        Ok(service)
    }

    async fn bindings(
        &self,
        request: &LargeTransferRequest,
        file_import: Option<&FileImportPlan>,
    ) -> Result<LargeTransferBindings> {
        validate_request(request)?;
        if let Some(plan) = file_import {
            plan.validate()?;
            if request.source.driver != "file" || request.target.driver != "sqlite" {
                bail!("file import requires its native SQLite target adapter");
            }
        }
        let adapter = if file_import.is_some() {
            "sqlite"
        } else {
            request.source.driver.as_str()
        };
        if !matches!(adapter, "sqlite" | "postgres" | "mysql") || request.target.driver != adapter {
            bail!("large transfer requires matching native SQLite, PostgreSQL or MySQL adapters");
        }
        let connections = self.metadata.get_connections(&request.project_id).await?;
        let mut resolved = Vec::new();
        for (endpoint, target) in [(&request.source, false), (&request.target, true)] {
            if !target {
                if let Some(plan) = file_import {
                    resolved.push((None, serde_json::to_value(plan)?));
                    continue;
                }
            }
            resolved.push(self.resolve_endpoint(
                &request.project_id,
                endpoint,
                adapter,
                target,
                &connections,
            )?);
        }
        let (target, target_config) = resolved.pop().unwrap();
        let (source, source_config) = resolved.pop().unwrap();
        Ok(LargeTransferBindings {
            source,
            target,
            source_config,
            target_config,
        })
    }

    pub(super) async fn endpoint_binding(
        &self,
        project: &str,
        endpoint: &LargeTransferEndpoint,
        adapter: &str,
        target: bool,
    ) -> Result<(Option<PathBuf>, Value)> {
        let connections = self.metadata.get_connections(project).await?;
        self.resolve_endpoint(project, endpoint, adapter, target, &connections)
    }

    fn resolve_endpoint(
        &self,
        project: &str,
        endpoint: &LargeTransferEndpoint,
        adapter: &str,
        target: bool,
        connections: &[SavedConnection],
    ) -> Result<(Option<PathBuf>, Value)> {
        let saved = connections
            .iter()
            .find(|c| c.id == endpoint.connection_id && c.project_id == project)
            .context("migration connection is outside the requested project")?;
        let config: ConnectionConfig = serde_json::from_value(saved.config.clone())
            .context("saved migration configuration is invalid")?;
        if config.id != saved.id
            || config.project_id != saved.project_id
            || canonical_driver_name(&saved.driver) != Some(adapter)
            || canonical_driver_name(&config.driver) != Some(adapter)
            || canonical_driver_name(&endpoint.driver) != Some(adapter)
        {
            bail!("large transfer requires project-owned matching native endpoints");
        }
        if config.ssh_tunnel.as_ref().is_some_and(|ssh| ssh.enabled) {
            bail!("large transfer currently requires direct native connections");
        }
        if self
            .packages
            .resolve_preferred(adapter, config.driver_package_version.as_deref())
            .map_err(anyhow::Error::msg)?
            .is_some()
        {
            bail!("the selected external package does not implement durable snapshot transfer; bundled fallback is blocked");
        }
        if adapter == "mysql" {
            if endpoint.schema.chars().count() > 64
                || endpoint.table.chars().count() > 64
                || endpoint.schema.chars().any(char::is_control)
                || [
                    "mysql",
                    "sys",
                    "information_schema",
                    "performance_schema",
                    "ndbinfo",
                ]
                .iter()
                .any(|schema| endpoint.schema.eq_ignore_ascii_case(schema))
            {
                bail!("MySQL transfer requires an ordinary user database and exact identifiers");
            }
            mysql::options(&saved.config, endpoint)?;
            return Ok((None, saved.config.clone()));
        }
        if adapter == "postgres" {
            if endpoint.schema.is_empty()
                || endpoint.schema.len() > 63
                || endpoint.schema.starts_with("pg_")
                || endpoint.schema == "information_schema"
                || endpoint.schema.chars().any(char::is_control)
                || endpoint.table.len() > 63
            {
                bail!("PostgreSQL transfer requires an ordinary user schema and exact identifiers");
            }
            postgres::options(&saved.config, endpoint)?;
            return Ok((None, saved.config.clone()));
        }
        let url = config
            .connection_url
            .as_deref()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| (!config.url.trim().is_empty()).then_some(config.url.as_str()))
            .or(config.database.as_deref())
            .context("saved SQLite file is missing")?;
        let normalized = crate::drivers::sqlite::normalize_sqlite_url(url);
        let options = SqliteConnectOptions::from_str(&normalized)?;
        let normalized_url = options.to_url_lossy();
        if !options.get_filename().is_absolute()
            || normalized_url.query_pairs().any(|(key, value)| {
                key == "vfs"
                    || key == "mode" && value == "memory"
                    || target
                        && (key == "mode" && value == "ro" || key == "immutable" && value == "true")
            })
        {
            bail!("large transfer requires absolute local files and a writable target without a custom VFS");
        }
        if !endpoint.schema.is_empty() && endpoint.schema != "main" {
            bail!("durable SQLite transfers use the main database");
        }
        if let Some(database) = endpoint
            .database
            .as_deref()
            .filter(|v| !v.is_empty() && *v != "main")
        {
            if Path::new(database) != options.get_filename() {
                bail!("selected SQLite database does not match the saved file");
            }
        }
        Ok((
            Some(options.get_filename().to_path_buf()),
            saved.config.clone(),
        ))
    }

    async fn require_bindings(&self, job: &StoredJob) -> Result<()> {
        let bindings = self
            .bindings(&job.request, job.file_import.as_ref())
            .await?;
        if self
            .store
            .authenticate("source-config", &bindings.source_config)?
            != job.source_binding
            || self
                .store
                .authenticate("target-config", &bindings.target_config)?
                != job.target_binding
        {
            bail!("saved transfer connection changed; preview again");
        }
        if let Some(file) = &job.target_file {
            files::require_identity(file)?;
        }
        Ok(())
    }

    async fn create(&self, request: LargeTransferRequest) -> Result<(StoredJob, std::fs::File)> {
        self.create_with_source(request, None, None).await
    }

    pub(super) async fn create_with_source(
        &self,
        request: LargeTransferRequest,
        file_import: Option<FileImportPlan>,
        input: Option<PathBuf>,
    ) -> Result<(StoredJob, std::fs::File)> {
        self.create_with_source_fence(request, file_import, input, None)
            .await
    }

    pub(super) async fn create_with_source_fence(
        &self,
        request: LargeTransferRequest,
        file_import: Option<FileImportPlan>,
        input: Option<PathBuf>,
        preparation: Option<(
            &super::preparation_target::FileImportTargetBinding,
            FilePreparationLink,
        )>,
    ) -> Result<(StoredJob, std::fs::File)> {
        let mut bindings = self.bindings(&request, file_import.as_ref()).await?;
        if file_import.is_some() {
            bindings.source = Some(input.context("normalized file import snapshot is missing")?);
        }
        let id = preparation
            .as_ref()
            .map(|(_, link)| link.id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let (source_file, target_file, postgres, mysql, version) =
            if let (Some(source), Some(target)) = (&bindings.source, &bindings.target) {
                let source_file = files::identity(source)?;
                let target_file = files::identity(target)?;
                if source_file.volume == target_file.volume
                    && source_file.index == target_file.index
                    && request
                        .source
                        .table
                        .eq_ignore_ascii_case(&request.target.table)
                {
                    bail!("source and target refer to the same table");
                }
                let control_file = files::identity(&self.store.root.join("jobs.sqlite"))?;
                if target_file.volume == control_file.volume
                    && target_file.index == control_file.index
                {
                    bail!("migration control storage cannot be a transfer target");
                }
                (
                    Some(source_file),
                    Some(target_file),
                    None,
                    None,
                    if preparation.is_some() {
                        6
                    } else if file_import
                        .as_ref()
                        .is_some_and(|p| p.presence_column.is_some())
                    {
                        5
                    } else if file_import.is_some() {
                        4
                    } else {
                        1
                    },
                )
            } else if request.source.driver == "mysql" {
                let connection = self.store.seal_mysql_target(
                    &id,
                    &request.project_id,
                    &bindings.target_config,
                )?;
                (
                    None,
                    None,
                    None,
                    Some(MySqlPlan {
                        server_uuid: String::new(),
                        created: None,
                        native_mode: String::new(),
                        native_time_zone: String::new(),
                        columns: Vec::new(),
                        target_connection: connection,
                    }),
                    3,
                )
            } else {
                let connection =
                    self.store
                        .seal_target(&id, &request.project_id, &bindings.target_config)?;
                (
                    None,
                    None,
                    Some(PostgresPlan {
                        database_oid: 0,
                        target_oid: 0,
                        target_types: Vec::new(),
                        has_identity: false,
                        sequences: Vec::new(),
                        target_connection: connection,
                    }),
                    None,
                    2,
                )
            };
        let suffix = id.replace('-', "");
        let now = timestamp();
        let summary = LargeTransferSummary {
            id: id.clone(),
            project_id: request.project_id.clone(),
            source: request.source.clone(),
            target: request.target.clone(),
            mode: request.mode,
            phase: Phase::Preparing,
            source_rows: 0,
            rows_staged: 0,
            batches: 0,
            snapshot_bytes: 0,
            review_ready: false,
            created_at: now,
            updated_at: now,
            issue: None,
        };
        let mut job = StoredJob {
            version,
            summary,
            request,
            source_file,
            target_file,
            source_binding: self
                .store
                .authenticate("source-config", &bindings.source_config)?,
            target_binding: self
                .store
                .authenticate("target-config", &bindings.target_config)?,
            snapshot_digest: String::new(),
            target_schema_digest: String::new(),
            target_data_digest: String::new(),
            target_rows_before: 0,
            columns: Vec::new(),
            skipped_columns: Vec::new(),
            keys: Vec::new(),
            target_keys: Vec::new(),
            confirmation_token: String::new(),
            plan_digest: String::new(),
            receipt_table: format!("_oxide_transfer_receipt_{suffix}"),
            stage_table: format!("_oxide_transfer_stage_{suffix}"),
            sequence_column: format!("_oxide_sequence_{suffix}"),
            postgres,
            mysql,
            file_import,
            file_preparation: preparation.as_ref().map(|(_, link)| link.clone()),
        };
        if let Some((binding, _)) = &preparation {
            binding.require_job(&job)?;
        }
        let lease = self.store.lease(&job.summary.id)?;
        if preparation.is_some() {
            self.store.insert(&mut job).await?;
        } else {
            self.store.save(&mut job).await?;
        }
        Ok((job, lease))
    }

    pub(super) async fn prepare_job(
        &self,
        mut job: StoredJob,
        _lease: std::fs::File,
    ) -> Result<LargeTransferPreview> {
        let control = LocalDatabaseBackupControl::default();
        self.controls
            .lock()
            .await
            .insert(job.summary.id.clone(), control.clone());
        let result = async {
            if self.store.action(&job.summary.id).await? == "cancel" {
                control.cancel();
            }
            self.require_bindings(&job).await?;
            if job.mysql.is_some() {
                let config = self.bindings(&job.request, job.file_import.as_ref()).await?.source_config;
                tokio::select! {
                    result=mysql::prepare_snapshot(&self.store,&mut job,&config,&control)=>result?,
                    _=cancelled(&control)=>bail!("MySQL snapshot preparation cancelled"),
                }
            } else if job.postgres.is_some() {
                let config=self.bindings(&job.request, job.file_import.as_ref()).await?.source_config;
                tokio::select! {
                    result=postgres::prepare_snapshot(&self.store,&mut job,&config,&control)=>result?,
                    _=cancelled(&control)=>bail!("PostgreSQL snapshot preparation cancelled"),
                }
            } else {
                sqlite::prepare_snapshot(&self.store, &mut job, &control).await?;
            }
            self.require_bindings(&job).await?;
            if let Some(plan) = &job.file_import {
                let expected = plan.columns.iter().map(|c| c.target.to_ascii_lowercase()).collect::<HashSet<_>>();
                let actual = job.columns.iter().filter(|c| plan.presence_column.as_deref() != Some(c.target.as_str())).map(|c| c.target.to_ascii_lowercase()).collect::<HashSet<_>>();
                if actual != expected || !job.skipped_columns.is_empty() {
                    bail!("file import snapshot does not match its persisted mapping");
                }
            }
            if self.store.action(&job.summary.id).await? == "cancel" {
                bail!("migration preparation was cancelled");
            }
            let mut review=serde_json::json!({
                    "request": job.request,
                    "sourceFile": job.source_file, "targetFile": job.target_file,
                    "sourceBinding": job.source_binding, "targetBinding": job.target_binding,
                    "snapshot": job.snapshot_digest,
                    "schema": job.target_schema_digest, "targetData": job.target_data_digest,
                    "targetRows": job.target_rows_before, "sourceRows": job.summary.source_rows,
                    "columns": job.columns, "skipped": job.skipped_columns,
                    "keys": job.keys, "targetKeys": job.target_keys,
                });
            if let Some(plan)=&job.postgres {review["postgres"]=serde_json::to_value(plan)?;}
            if let Some(plan)=&job.mysql {review["mysql"]=serde_json::to_value(plan)?;}
            if let Some(plan)=&job.file_import {review["fileImport"]=serde_json::to_value(plan)?;}
            if let Some(link)=&job.file_preparation {review["filePreparation"]=serde_json::to_value(link)?;}
            job.plan_digest = self.store.authenticate("review", &review)?;
            job.confirmation_token =
                format!("{} {}", if job.file_import.is_some() {"IMPORT"} else {"MIGRATE"}, job.plan_digest[..12].to_ascii_uppercase());
            job.summary.review_ready = true;
            job.summary.phase = Phase::AwaitingReview;
            job.summary.issue = None;
            self.store.save(&mut job).await?;
            Ok::<_, anyhow::Error>(preview(&job))
        }
        .await;
        self.controls.lock().await.remove(&job.summary.id);
        if result.is_err() {
            if self.store.action(&job.summary.id).await? == "cancel" {
                self.finish_cancelled(&mut job).await?;
            } else {
                job.summary.phase = Phase::Failed;
                job.summary.issue = Some("preparation_failed".into());
                self.store.save(&mut job).await?;
            }
        }
        result
    }

    /// Synchronous orchestration used by native acceptance and command wrappers.
    pub async fn prepare(&self, request: LargeTransferRequest) -> Result<LargeTransferPreview> {
        let (job, lease) = self.create(request).await?;
        self.prepare_job(job, lease).await
    }

    /// Host-owned preparation survives a closed renderer/window.
    pub async fn begin_prepare(
        &self,
        request: LargeTransferRequest,
    ) -> Result<LargeTransferSummary> {
        let (job, lease) = self.create(request).await?;
        let summary = job.summary.clone();
        let service = self.clone();
        tokio::spawn(async move {
            let _ = service.prepare_job(job, lease).await;
        });
        Ok(summary)
    }
    pub async fn get_preview(&self, project: &str, id: &str) -> Result<LargeTransferPreview> {
        self.get(project, id).await?;
        let job = self.store.load(project, id).await?;
        if job.plan_digest.is_empty() {
            bail!("migration preview is not ready");
        }
        Ok(preview(&job))
    }
    pub async fn list(&self, query: LargeTransferListQuery) -> Result<LargeTransferPage> {
        self.list_for_source(query, false).await
    }
    pub async fn list_file_imports(
        &self,
        query: LargeTransferListQuery,
    ) -> Result<LargeTransferPage> {
        self.list_for_source(query, true).await
    }
    async fn list_for_source(
        &self,
        query: LargeTransferListQuery,
        file_import: bool,
    ) -> Result<LargeTransferPage> {
        let (records, next_cursor) = self.store.list(&query, file_import).await?;
        let mut result = Vec::new();
        for job in records {
            if job.postgres.is_some() || job.mysql.is_some() {
                // Network reconciliation happens when this job is opened, not
                // serially across a hundred historical server endpoints.
                result.push(
                    self.store
                        .recover(&query.project_id, &job.summary.id)
                        .await?
                        .summary,
                );
            } else {
                result.push(self.get(&query.project_id, &job.summary.id).await?);
            }
        }
        Ok(LargeTransferPage {
            jobs: result,
            next_cursor,
        })
    }
    pub async fn request_pause(&self, project: &str, id: &str) -> Result<()> {
        let job = self.store.load(project, id).await?;
        if job.summary.phase != Phase::Copying {
            bail!("migration is not in a pausable phase");
        }
        self.store.request_action(project, id, "pause").await?;
        Ok(())
    }
    pub async fn start(
        &self,
        project: &str,
        id: &str,
        token: &str,
    ) -> Result<LargeTransferSummary> {
        let summary = self.get(project, id).await?;
        if summary.phase == Phase::Completed {
            return Ok(summary);
        }
        let lease = self.store.lease(id)?;
        let mut job = self.store.load(project, id).await?;
        if job.summary.phase == Phase::Cancelled
            || job.confirmation_token.is_empty()
            || token.trim() != job.confirmation_token
        {
            bail!("migration requires its exact reviewed confirmation token");
        }
        self.require_bindings(&job).await?;
        if self.store.action(id).await? == "cancel" {
            bail!("migration cancellation is pending");
        }
        self.store.request_action(project, id, "").await?;
        job.summary.phase = Phase::Copying;
        job.summary.issue = None;
        self.store.save(&mut job).await?;
        let summary = job.summary.clone();
        let service = self.clone();
        tokio::spawn(async move {
            let _lease = lease;
            let _ = service.run(job).await;
        });
        Ok(summary)
    }

    async fn run(&self, mut job: StoredJob) -> Result<()> {
        let result = async {
            self.require_bindings(&job).await?;
            let mut connection = Target::open(&self.store, &job, false).await?;
            if let Some(header) = connection.read_header(&self.store, &job).await? {
                if header.published {
                    connection.close().await?;
                    self.complete(&mut job, header).await?;
                    return Ok(());
                }
            }
            let snapshot = self.store.require_snapshot(&job).await?;
            connection.initialize(&self.store, &job, &snapshot).await?;
            let mut receipt = connection.reconcile(&self.store, &job).await?;
            if let Some(last) = &receipt {
                job.summary.rows_staged = last.rows_after;
                job.summary.batches = last.sequence;
                self.store.save(&mut job).await?;
            }
            loop {
                if self.store.action(&job.summary.id).await? == "pause" {
                    job.summary.phase = Phase::Paused;
                    self.store.save(&mut job).await?;
                    connection.close().await?;
                    return Ok(());
                }
                if self.store.action(&job.summary.id).await? == "cancel" {
                    self.cancel_owned(&mut job, &mut connection).await?;
                    return Ok(());
                }
                self.require_bindings(&job).await?;
                match connection
                    .copy_batch(&self.store, &job, receipt.as_ref())
                    .await?
                {
                    Some(next) => {
                        job.summary.rows_staged = next.rows_after;
                        job.summary.batches = next.sequence;
                        receipt = Some(next);
                        self.store.save(&mut job).await?;
                    }
                    None => break,
                }
            }
            self.store.require_snapshot(&job).await?;
            self.require_bindings(&job).await?;
            if !self.store.claim_publication(&mut job).await? {
                if self.store.action(&job.summary.id).await? == "cancel" {
                    self.cancel_owned(&mut job, &mut connection).await?;
                } else {
                    job.summary.phase = Phase::Paused;
                    self.store.save(&mut job).await?;
                }
                return Ok(());
            }
            let header = connection.publish(&self.store, &job).await?;
            if let Some(file) = &job.target_file {
                files::require_identity(file)?;
            }
            connection.close().await?;
            self.complete(&mut job, header).await?;
            Ok::<_, anyhow::Error>(())
        }
        .await;
        if result.is_err() {
            job.summary.phase = Phase::Paused;
            job.summary.issue = Some("execution_interrupted_or_target_changed".into());
            self.store.save(&mut job).await?;
        }
        result
    }
}

pub(super) fn preview(job: &StoredJob) -> LargeTransferPreview {
    LargeTransferPreview {
        job: job.summary.clone(),
        confirmation_token: job.confirmation_token.clone(),
        target_rows_before: job.target_rows_before,
        mapped_columns: job.columns.iter().filter(|c| job.file_import.as_ref().and_then(|p|p.presence_column.as_deref()) != Some(c.target.as_str())).cloned().collect(),
        skipped_columns: job.skipped_columns.clone(),
        file_import: job.file_import.clone(),
        warnings: vec![
        if job.file_import.is_some(){"A private normalized snapshot of the reviewed file is saved on this computer. Its format, source digest, import options and column mapping are preserved in the authenticated ledger. The original file may be offline after preparation."}else if job.mysql.is_some(){"A private snapshot of the selected MySQL table is saved on this computer using native scalar values, binary floating-point values and bytes. Later source edits are not included; the source table may be unavailable after preparation."}else if job.postgres.is_some(){"A private snapshot of the selected PostgreSQL table is saved on this computer using native text representations. Later source edits are not included; the source may be offline after preparation."}else{"A private copy of the entire source SQLite file is saved on this computer, including tables not selected here. Only the selected table is imported; later source edits are not included."}.into(),
        format!("The target database will contain {} while this job is paused. Publication changes {} atomically only after all batches are verified.",if job.mysql.is_some(){"a private InnoDB journal containing staged values and receipts"}else{"a private staging table and receipt table"},job.request.target.table),
        "The source snapshot is removed after successful publication or cancellation. A small transfer receipt remains in the target to confirm a completed publication after an unexpected shutdown.".into(),
        "The final publication applies the target's types, defaults, triggers and constraints in a single transaction. Publication can take time and needs additional disk space for the snapshot, staging data and journal.".into(),
        if job.mysql.is_some(){"Changing saved connections, target server/table metadata or existing row content requires a new review. MySQL 8.0.22+ InnoDB, direct connections and visibility of all target/journal triggers are required. Publication preserves explicit zero identities and rejects conversion warnings. Native auto-increment gaps and nontransactional effects of target triggers follow MySQL semantics."}else if job.postgres.is_some(){"Changing the saved connections, target database/table identity, schema or existing row content requires a new review. Publication locks the target and restarts mapped, owned sequences transactionally; sequence ownership is required. Different target types or precision apply the displayed target conversion rules."}else{"Changing the saved source/target configuration, target file, schema or existing row content requires a new review."}.into(),
        match job.request.mode {
            LargeTransferMode::Append => "Append inserts every source row; a key conflict rolls back the entire publication.",
            LargeTransferMode::Overwrite => "Overwrite deletes all existing target rows and inserts every source row in one transaction, including the target's DELETE/INSERT triggers and foreign-key effects.",
            LargeTransferMode::Upsert => "Upsert inserts new primary keys and updates mapped non-key columns on conflicts. Existing target rows absent from the source are retained.",
        }.into(),
        ],
    }
}
async fn cancelled(control: &LocalDatabaseBackupControl) {
    while !control.is_cancelled() {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}
fn validate_request(request: &LargeTransferRequest) -> Result<()> {
    if request.project_id.is_empty()
        || request.project_id.len() > 128
        || request.project_id.chars().any(char::is_control)
        || !(1..=1_000).contains(&request.batch_rows)
    {
        bail!("invalid project or migration batch size");
    }
    for endpoint in [&request.source, &request.target] {
        if endpoint.connection_id.is_empty()
            || endpoint.connection_id.len() > 128
            || endpoint.table.is_empty()
            || endpoint.table.len() > 512
            || endpoint.table.chars().any(char::is_control)
        {
            bail!("invalid migration endpoint");
        }
    }
    Ok(())
}
