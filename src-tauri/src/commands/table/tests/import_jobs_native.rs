//! Invoked only by scripts/test-resumable-import.mjs. Initial process is
//! intentionally killed after durable staging; a new process must resume it.
use super::import_jobs::Fixture;
use crate::core::{
    driver_package::DatabaseDriverPackageRegistry,
    store::MetaStore,
    transfer_jobs::{
        FileImportRequest, LargeTransferEndpoint, LargeTransferJobs, LargeTransferMode,
        LargeTransferPhase, LargeTransferPreview,
    },
};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::{
    io::Write,
    path::PathBuf,
    time::{Duration, Instant},
};

fn payload(id: u64) -> String {
    format!("{:x}", Sha256::digest(id.to_le_bytes()))
}

#[tokio::test]
#[ignore = "explicit preparation process-kill; scripts/test-import-preparation-recovery.mjs"]
async fn import_preparation_process_helper() -> anyhow::Result<()> {
    let evidence = PathBuf::from(std::env::var("OXIDE_IMPORT_PREPARATION_EVIDENCE_DIR")?);
    let attempt = std::env::var("OXIDE_IMPORT_PREPARATION_ATTEMPT")?;
    if attempt == "initial" {
        let fixture = Fixture::new().await;
        let source = fixture.directory.path().join("source.json");
        let mut output = std::io::BufWriter::new(std::fs::File::create_new(&source)?);
        let text = "x".repeat(300);
        output.write_all(b"[")?;
        for id in 0..120001 {
            if id != 0 {
                output.write_all(b",")?;
            }
            write!(output, "{{\"id\":{id},\"payload\":\"{text}\"}}")?;
        }
        output.write_all(b"]")?;
        output.flush()?;
        drop(output);
        let digest = super::super::import_preview::import_file_digest(&source).unwrap();
        let bytes = std::fs::metadata(&source)?.len();
        assert!(bytes > 32 * 1024 * 1024);
        std::fs::write(
            evidence.join("fixture.json"),
            serde_json::to_vec(&serde_json::json!({
                "root":fixture.directory.path(), "rows":120001, "sourceBytes":bytes, "sourceSha256":digest
            }))?,
        )?;
        let _snapshot = fixture
            .normalize(
                source,
                super::super::import_types::TableImportFormat::Json,
                None,
            )
            .await
            .unwrap();
        anyhow::bail!("parent failed to terminate normalization before it completed");
    }
    anyhow::ensure!(attempt == "recover");
    let fixture: serde_json::Value =
        serde_json::from_slice(&std::fs::read(evidence.join("fixture.json"))?)?;
    let root = PathBuf::from(fixture["root"].as_str().unwrap());
    anyhow::ensure!(root.canonicalize()?.parent() == Some(evidence.canonicalize()?.as_path()));
    let preparation_root = root.join("jobs/import-preparations");
    let owned_count = || -> anyhow::Result<usize> {
        Ok(std::fs::read_dir(&preparation_root)?
            .collect::<std::io::Result<Vec<_>>>()?
            .iter()
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .is_some_and(|s| s.starts_with("prep-"))
            })
            .count())
    };
    assert_eq!(
        owned_count()?,
        1,
        "abandoned normalization must exist before startup"
    );
    let metadata = MetaStore::open(&root.join("profile")).await?;
    let jobs = LargeTransferJobs::open(
        &root.join("jobs"),
        metadata,
        DatabaseDriverPackageRegistry::new(root.join("packages")),
    )
    .await?;
    assert_eq!(owned_count()?, 0);
    assert!(jobs
        .list_file_imports(crate::core::transfer_jobs::LargeTransferListQuery {
            project_id: "p".into(),
            cursor: None,
        })
        .await?
        .jobs
        .is_empty());
    let mut target = SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(root.join("target.sqlite")),
    )
    .await?;
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM target")
        .fetch_one(&mut target)
        .await?;
    assert_eq!(rows, 0);
    target.close().await?;
    let source_digest =
        super::super::import_preview::import_file_digest(&root.join("source.json")).unwrap();
    assert_eq!(source_digest, fixture["sourceSha256"].as_str().unwrap());
    std::fs::write(
        evidence.join("native-evidence.json"),
        serde_json::to_vec(&serde_json::json!({
            "workspaceReclaimed":true, "sourceUnchanged":true, "targetUnchanged":true, "noReadyJobCreated":true,
            "sourceBytes":fixture["sourceBytes"], "sourceSha256":source_digest, "fixtureRows":120001
        }))?,
    )?;
    Ok(())
}

#[tokio::test]
#[ignore = "explicit process-kill/million-row file import; scripts/test-resumable-import.mjs"]
async fn resumable_import_process_helper() -> anyhow::Result<()> {
    let evidence = PathBuf::from(std::env::var("OXIDE_RESUMABLE_IMPORT_EVIDENCE_DIR")?);
    let attempt = std::env::var("OXIDE_RESUMABLE_IMPORT_ATTEMPT")?;
    let clock = Instant::now();
    if attempt == "initial" {
        let fixture = Fixture::new().await;
        let source = fixture.directory.path().join("source.json");
        let mut output =
            std::io::BufWriter::with_capacity(64 * 1024, std::fs::File::create_new(&source)?);
        output.write_all(b"[")?;
        for id in 0..1_000_001_u64 {
            if id != 0 {
                output.write_all(b",")?;
            }
            write!(output, "{{\"id\":{id},\"payload\":\"{}\"", payload(id))?;
            match id % 3 {
                0 => output.write_all(b",\"optional\":\"provided\"")?,
                1 => output.write_all(b",\"optional\":null")?,
                _ => (),
            }
            output.write_all(b"}")?;
        }
        output.write_all(b"]")?;
        output.flush()?;
        drop(output);
        let source_bytes = std::fs::metadata(&source)?.len();
        assert!(source_bytes > 32 * 1024 * 1024);
        let source_digest = super::super::import_preview::import_file_digest(&source).unwrap();
        let snapshot = fixture
            .normalize(
                source.clone(),
                super::super::import_types::TableImportFormat::Json,
                None,
            )
            .await
            .unwrap();
        let request = FileImportRequest {
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
        };
        let preview = fixture
            .jobs
            .prepare_file_import(request, &snapshot.path)
            .await?;
        snapshot.directory.close()?;
        assert_eq!(preview.job.source_rows, 1_000_001);
        assert!(preview
            .file_import
            .as_ref()
            .unwrap()
            .presence_column
            .is_some());
        assert_eq!(
            preview.file_import.as_ref().unwrap().source_digest,
            source_digest
        );
        std::fs::write(evidence.join("review.json"), serde_json::to_vec(&preview)?)?;
        std::fs::write(
            evidence.join("fixture.json"),
            serde_json::to_vec(
                &serde_json::json!({"root":fixture.directory.path(),"sourceBytes":source_bytes,"sourceSha256":source_digest,"normalizationAndReviewMilliseconds":clock.elapsed().as_millis()}),
            )?,
        )?;
        fixture
            .jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?;
        let deadline = Instant::now() + Duration::from_secs(1200);
        loop {
            let job = fixture.jobs.get("p", &preview.job.id).await?;
            assert!(
                matches!(
                    job.phase,
                    LargeTransferPhase::Copying | LargeTransferPhase::Publishing
                ),
                "must remain live for parent to terminate"
            );
            if job.rows_staged >= 500 && job.rows_staged < 1_000_001 {
                let mut target = SqliteConnection::connect_with(
                    &SqliteConnectOptions::new()
                        .filename(fixture.directory.path().join("target.sqlite")),
                )
                .await?;
                let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM target")
                    .fetch_one(&mut target)
                    .await?;
                target.close().await?;
                assert_eq!(rows, 0);
                std::fs::write(
                    evidence.join("kill-ready.json"),
                    serde_json::to_vec(
                        &serde_json::json!({"rowsStaged":job.rows_staged,"batches":job.batches,"targetRowsBeforePublication":rows}),
                    )?,
                )?;
            }
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
    assert_eq!(attempt, "resume");
    let fixture: serde_json::Value =
        serde_json::from_slice(&std::fs::read(evidence.join("fixture.json"))?)?;
    let root = PathBuf::from(fixture["root"].as_str().unwrap());
    assert!(
        !root.join("source.json").exists(),
        "original source path must be offline"
    );
    let meta = MetaStore::open(&root.join("profile")).await?;
    let jobs = LargeTransferJobs::open(
        &root.join("jobs"),
        meta,
        DatabaseDriverPackageRegistry::new(root.join("packages")),
    )
    .await?;
    let review: LargeTransferPreview =
        serde_json::from_slice(&std::fs::read(evidence.join("review.json"))?)?;
    let recovered = jobs.get("p", &review.job.id).await?;
    assert_eq!(recovered.phase, LargeTransferPhase::Paused);
    assert!(recovered.rows_staged >= 500 && recovered.rows_staged < 1_000_001);
    let persisted = jobs.get_preview("p", &review.job.id).await?;
    assert_eq!(
        serde_json::to_value(&persisted.file_import)?,
        serde_json::to_value(&review.file_import)?
    );
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
    jobs.start("p", &review.job.id, &review.confirmation_token)
        .await?;
    let deadline = Instant::now() + Duration::from_secs(1200);
    let completed = loop {
        let job = jobs.get("p", &review.job.id).await?;
        if job.phase == LargeTransferPhase::Completed {
            break job;
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
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    assert_eq!(
        (completed.rows_staged, completed.batches),
        (1_000_001, 2001)
    );
    let aggregate: (i64, i64, i64, i64, i64) =
        sqlx::query_as("SELECT COUNT(*),SUM(id),MIN(id),MAX(id),COUNT(DISTINCT id) FROM target")
            .fetch_one(&mut target)
            .await?;
    assert_eq!(
        aggregate,
        (1_000_001, 500000500000, 0, 1_000_000, 1_000_001)
    );
    let mut previous = -1_i64;
    let mut verified = 0_u64;
    let mut digest = Sha256::new();
    loop {
        let rows: Vec<(i64, String, Option<String>)> = sqlx::query_as(
            "SELECT id,payload,optional FROM target WHERE id>? ORDER BY id LIMIT 1000",
        )
        .bind(previous)
        .fetch_all(&mut target)
        .await?;
        if rows.is_empty() {
            break;
        }
        for (id, value, default) in rows {
            assert_eq!(id, verified as i64);
            assert_eq!(value, payload(verified));
            assert_eq!(
                default.as_deref(),
                match verified % 3 {
                    0 => Some("provided"),
                    1 => None,
                    _ => Some("factory"),
                }
            );
            digest.update(value.as_bytes());
            previous = id;
            verified += 1;
        }
    }
    assert_eq!(verified, 1_000_001);
    target.close().await?;
    assert_eq!(
        super::super::import_preview::import_file_digest(&root.join("source.offline.json"))
            .unwrap(),
        fixture["sourceSha256"].as_str().unwrap()
    );
    assert!(!root
        .join("jobs")
        .join(format!("{}.snapshot.sqlite", review.job.id))
        .exists());
    std::fs::write(
        evidence.join("native-evidence.json"),
        serde_json::to_vec_pretty(
            &serde_json::json!({"rows":verified,"batches":completed.batches,"resumedRowsBefore":recovered.rows_staged,"allPayloadsVerified":true,"targetUnchangedAfterKill":true,"originalSourceOffline":true,"mappingRecovered":true,"presenceBitmapsRecovered":true,"providedRows":333334,"explicitNullRows":333334,"defaultedRows":333333,"sourceUnchanged":true,"payloadSha256":format!("{:x}",digest.finalize()),"sourceBytes":fixture["sourceBytes"],"sourceSha256":fixture["sourceSha256"],"normalizationAndReviewMilliseconds":fixture["normalizationAndReviewMilliseconds"],"resumeAndVerificationMilliseconds":clock.elapsed().as_millis(),"engine":"SQLite","scope":"native-library-resumable-file-import","desktopIpcTested":false}),
        )?,
    )?;
    std::fs::write(evidence.join("measure-ready"), b"ready")?;
    let deadline = Instant::now() + Duration::from_secs(30);
    while !evidence.join("measure-done").exists() {
        assert!(Instant::now() < deadline);
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Ok(())
}
