//! Explicit process termination and new-process normalization cursor recovery.
use super::super::{
    import_jobs::{PrepareTableImportJob, SavedImportPreparation},
    import_snapshot::normalize_import_snapshot,
    import_types::{TableImportFormat, TableImportMode},
};
use super::import_preparation_formats as formats;
use crate::core::{
    driver_package::DatabaseDriverPackageRegistry,
    store::MetaStore,
    transfer_jobs::{
        FileImportRequest, LargeTransferEndpoint, LargeTransferJobs, LargeTransferListQuery,
        LargeTransferMode, LargeTransferPhase,
    },
};
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

#[tokio::test]
#[ignore = "explicit process kill/normalization resume; scripts/test-import-preparation-resume.mjs"]
async fn import_preparation_resume_process_helper() -> anyhow::Result<()> {
    let evidence = PathBuf::from(std::env::var("OXIDE_IMPORT_PREPARATION_EVIDENCE_DIR")?);
    let attempt = std::env::var("OXIDE_IMPORT_PREPARATION_ATTEMPT")?;
    let format = formats::format(
        &std::env::var("OXIDE_IMPORT_PREPARATION_FORMAT").unwrap_or_else(|_| "json".into()),
    )?;
    let format_name = formats::name(format);
    if attempt == "initial" {
        let fixture = formats::fixture().await;
        let source = fixture
            .directory
            .path()
            .join(format!("source.{format_name}"));
        formats::write_source(&source, format, 1_000_001)?;
        let digest = super::super::import_preview::import_file_digest(&source).unwrap();
        let saved = SavedImportPreparation {
            request: PrepareTableImportJob {
                project_id: "p".into(),
                import_id: "native".into(),
                connection_id: "target".into(),
                driver: "sqlite".into(),
                schema: "main".into(),
                table: "target".into(),
                database: Some("main".into()),
                file_path: source.to_str().unwrap().into(),
                format,
                mode: TableImportMode::Append,
                first_row_header: Some(true),
                csv_options: formats::csv_options(format),
                expected_file_digest: digest.clone(),
            },
            columns: fixture.columns.clone(),
            target_binding: Some(
                fixture
                    .jobs
                    .capture_file_import_target(
                        "p",
                        &LargeTransferEndpoint {
                            connection_id: "target".into(),
                            driver: "sqlite".into(),
                            schema: "main".into(),
                            table: "target".into(),
                            database: Some("main".into()),
                        },
                    )
                    .await?,
            ),
        };
        let directory = fixture
            .jobs
            .begin_resumable_file_import_preparation(
                "p",
                "native",
                &digest,
                serde_json::to_value(&saved)?,
            )
            .await?;
        let id = directory.progress()?.id;
        let bytes = std::fs::metadata(&source)?.len();
        assert!(bytes > 32 * 1024 * 1024);
        std::fs::write(
            evidence.join("fixture.json"),
            serde_json::to_vec(
                &serde_json::json!({"root":fixture.directory.path(),"format":format_name,"rows":1000001,"preparationId":id,"sourceBytes":bytes,"sourceSha256":digest}),
            )?,
        )?;
        let _snapshot = normalize_import_snapshot(
            source,
            digest,
            format,
            Some(true),
            formats::csv_options(format),
            fixture.columns.clone(),
            tokio::sync::watch::channel(false).1,
            directory,
        )
        .await
        .unwrap();
        anyhow::bail!("parent did not interrupt normalization before completion");
    }
    anyhow::ensure!(matches!(
        attempt.as_str(),
        "resume" | "prepare" | "stage" | "finish"
    ));
    let fixture: serde_json::Value =
        serde_json::from_slice(&std::fs::read(evidence.join("fixture.json"))?)?;
    assert_eq!(fixture["format"].as_str().unwrap_or("json"), format_name);
    let root = PathBuf::from(fixture["root"].as_str().unwrap());
    anyhow::ensure!(root.canonicalize()?.parent() == Some(evidence.canonicalize()?.as_path()));
    assert!(!root.join(format!("source.{format_name}")).exists());
    let jobs = LargeTransferJobs::open(
        &root.join("jobs"),
        MetaStore::open(&root.join("profile")).await?,
        DatabaseDriverPackageRegistry::new(root.join("packages")),
    )
    .await?;
    let (preview, before) = if matches!(attempt.as_str(), "stage" | "finish") {
        let marker: serde_json::Value =
            serde_json::from_slice(&std::fs::read(evidence.join("handoff-ready.json"))?)?;
        let preview = jobs
            .file_import_preparation_result("p", fixture["preparationId"].as_str().unwrap())
            .await?
            .unwrap();
        assert_eq!(preview.job.id, marker["jobId"].as_str().unwrap());
        assert_eq!(
            preview.confirmation_token,
            marker["confirmationToken"].as_str().unwrap()
        );
        assert!(!root
            .join("jobs/import-preparations")
            .join(format!("prep-{}", preview.job.id))
            .exists());
        let cursor: serde_json::Value =
            serde_json::from_slice(&std::fs::read(evidence.join("cursor-evidence.json"))?)?;
        (preview, cursor["normalizedRowsBefore"].as_i64().unwrap())
    } else {
        let pending = jobs.list_file_import_preparations("p", None).await?;
        assert_eq!(pending.preparations.len(), 1);
        assert!(!pending.preparations[0].active);
        assert_eq!(
            pending.preparations[0].id,
            fixture["preparationId"].as_str().unwrap()
        );
        assert!(jobs
            .list_file_imports(LargeTransferListQuery {
                project_id: "p".into(),
                cursor: None
            })
            .await?
            .jobs
            .is_empty());
        let directory = jobs
            .resume_file_import_preparation("p", fixture["preparationId"].as_str().unwrap())
            .await?;
        let saved: SavedImportPreparation = serde_json::from_value(directory.intent()?.unwrap())?;
        assert!(!PathBuf::from(&saved.request.file_path).exists());
        let mut normalized = SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(directory.path().join("normalized.sqlite")),
        )
        .await?;
        let cursor = sqlx::query("SELECT body,mac FROM _oxide_preparation_checkpoint WHERE id=1")
            .fetch_one(&mut normalized)
            .await?;
        let cursor: super::super::import_snapshot_checkpoint::Checkpoint =
            directory.open_checkpoint(cursor.try_get("body")?, cursor.try_get("mac")?)?;
        let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM data")
            .fetch_one(&mut normalized)
            .await?;
        assert!((5000..1_000_001).contains(&before));
        assert_eq!(cursor.rows, before as u64);
        normalized.close().await?;
        let mut target = SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(root.join("target.sqlite")),
        )
        .await?;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM target")
                .fetch_one(&mut target)
                .await?,
            0
        );
        target.close().await?;
        let snapshot = normalize_import_snapshot(
            PathBuf::from(&saved.request.file_path),
            saved.request.expected_file_digest.clone(),
            saved.request.format,
            saved.request.first_row_header,
            saved.request.csv_options.clone(),
            saved.columns,
            tokio::sync::watch::channel(false).1,
            directory,
        )
        .await
        .unwrap();
        assert_eq!(
            snapshot.plan.presence_column.is_some(),
            matches!(format, TableImportFormat::Json)
        );
        assert_eq!(
            snapshot.plan.options["csvOptions"],
            serde_json::to_value(&saved.request.csv_options)?
        );
        let preview = jobs
            .prepare_file_import_from_preparation(
                FileImportRequest {
                    project_id: "p".into(),
                    target: LargeTransferEndpoint {
                        connection_id: "target".into(),
                        driver: "sqlite".into(),
                        schema: "main".into(),
                        table: "target".into(),
                        database: Some("main".into()),
                    },
                    mode: LargeTransferMode::Append,
                    batch_rows: 500,
                    source: snapshot.plan.clone(),
                },
                &snapshot.path,
                &snapshot.directory,
                saved.target_binding.as_ref().unwrap(),
            )
            .await?;
        let mut target_check = SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(root.join("target.sqlite")),
        )
        .await?;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM target")
                .fetch_one(&mut target_check)
                .await?,
            0
        );
        target_check.close().await?;
        assert_eq!(preview.job.id, fixture["preparationId"].as_str().unwrap());
        std::fs::write(
            evidence.join("cursor-evidence.json"),
            serde_json::to_vec(&serde_json::json!({"normalizedRowsBefore":before}))?,
        )?;
        if attempt == "prepare" {
            std::fs::write(
                evidence.join("handoff-ready.json"),
                serde_json::to_vec(
                    &serde_json::json!({"jobId":preview.job.id,"confirmationToken":preview.confirmation_token}),
                )?,
            )?;
            let deadline = Instant::now() + Duration::from_secs(1200);
            while Instant::now() < deadline {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            anyhow::bail!("parent failed to interrupt the ready handoff");
        }
        snapshot.directory.close()?;
        assert_eq!(preview.job.source_rows, 1000001);
        (preview, before)
    };
    assert_eq!(
        jobs.list_file_imports(LargeTransferListQuery {
            project_id: "p".into(),
            cursor: None
        })
        .await?
        .jobs
        .len(),
        1
    );
    let staged_before = preview.job.rows_staged;
    let mut target_check = SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(root.join("target.sqlite")),
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM target")
            .fetch_one(&mut target_check)
            .await?,
        0
    );
    target_check.close().await?;
    if attempt == "finish" && !matches!(format, TableImportFormat::Json) {
        let marker: serde_json::Value =
            serde_json::from_slice(&std::fs::read(evidence.join("staging-ready.json"))?)?;
        assert_eq!(preview.job.phase, LargeTransferPhase::Paused);
        assert!(
            staged_before >= marker["rowsStaged"].as_u64().unwrap() && staged_before < 1_000_001
        );
    }
    jobs.start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    let deadline = Instant::now() + Duration::from_secs(1200);
    let mut staging_observed = 0;
    loop {
        let job = jobs.get("p", &preview.job.id).await?;
        if job.phase == LargeTransferPhase::Completed {
            break;
        }
        assert!(
            matches!(
                job.phase,
                LargeTransferPhase::Copying | LargeTransferPhase::Publishing
            ),
            "{:?} {:?}",
            job.phase,
            job.issue
        );
        if job.phase == LargeTransferPhase::Copying
            && job.rows_staged >= 1500
            && job.rows_staged < 500_000
        {
            let mut target_check = SqliteConnection::connect_with(
                &SqliteConnectOptions::new().filename(root.join("target.sqlite")),
            )
            .await?;
            let target_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM target")
                .fetch_one(&mut target_check)
                .await?;
            target_check.close().await?;
            if jobs.get("p", &preview.job.id).await?.phase == LargeTransferPhase::Copying {
                assert_eq!(target_rows, 0);
                staging_observed = job.rows_staged;
                if attempt == "stage" {
                    std::fs::write(
                        evidence.join("staging-ready.json"),
                        serde_json::to_vec(
                            &serde_json::json!({"jobId":job.id,"rowsStaged":staging_observed,"targetRows":target_rows}),
                        )?,
                    )?;
                    while Instant::now() < deadline {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                    anyhow::bail!("parent failed to interrupt active staging");
                }
            }
        }
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(
        staging_observed >= 1500,
        "must observe an unchanged target during actual staging"
    );
    let mut target = SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(root.join("target.sqlite")),
    )
    .await?;
    let mut next = 0_u64;
    let mut counts = [0_u64; 3];
    loop {
        let rows: Vec<(i64, String, Option<String>, String)> = sqlx::query_as(
            "SELECT id,payload,optional,unmapped FROM target WHERE id>=? ORDER BY id LIMIT 500",
        )
        .bind(next as i64)
        .fetch_all(&mut target)
        .await?;
        if rows.is_empty() {
            break;
        }
        for (id, value, optional, unmapped) in rows {
            assert_eq!(id as u64, next);
            assert_eq!(value, formats::payload(format, next));
            assert_eq!(optional.as_deref(), formats::optional(format, next));
            assert_eq!(unmapped, "factory");
            counts[match optional.as_deref() {
                Some("provided") => 0,
                None => 1,
                Some("factory") => 2,
                _ => unreachable!(),
            }] += 1;
            next += 1;
        }
    }
    assert_eq!(next, 1000001);
    let engine_version: String = sqlx::query_scalar("SELECT sqlite_version()")
        .fetch_one(&mut target)
        .await?;
    target.close().await?;
    assert!(jobs
        .list_file_import_preparations("p", None)
        .await?
        .preparations
        .is_empty());
    let digest = super::super::import_preview::import_file_digest(
        &root.join(format!("source.offline.{format_name}")),
    )
    .unwrap();
    assert_eq!(digest, fixture["sourceSha256"].as_str().unwrap());
    std::fs::write(
        evidence.join("native-evidence.json"),
        serde_json::to_vec(&serde_json::json!({
            "handoffRecovered":attempt=="finish","sameReviewRecovered":attempt=="finish","stableJobId":preview.job.id==fixture["preparationId"].as_str().unwrap(),"handoffJobCount":1,"preparationResumed":true,"normalizedRowsBefore":before,"appendedRows":1000001-before,"sourceOffline":true,"sourceUnchanged":true,
            "targetUnchangedBeforePublication":true,"noReadyJobBeforeResume":true,"allPayloadsAndPresenceVerified":true,"workspaceReclaimed":true,
            "format":format_name,"rows":next,"providedRows":counts[0],"explicitNullRows":counts[1],"defaultedRows":counts[2],"unmappedDefaultRows":next,"sharedStrings":if matches!(format,TableImportFormat::Xlsx){1000002}else{0},"optionsPreserved":true,"sourceBytes":fixture["sourceBytes"],"sourceSha256":digest,"parserReplayFromStart":true,
            "stagedRowsBefore":staged_before,"stagingRowsObserved":staging_observed,"targetUnchangedDuringStaging":true,"stagingResumed":staged_before>0,"engine":"SQLite","engineVersion":engine_version
        }))?,
    )?;
    if std::env::var("OXIDE_IMPORT_HANDOFF_MEASURE").as_deref() == Ok("1") {
        std::fs::write(evidence.join("measure-ready"), "ready")?;
        let deadline = Instant::now() + Duration::from_secs(60);
        while !evidence.join("measure-done").exists() {
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    Ok(())
}
