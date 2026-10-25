use super::*;
use oxide_studio_lib::core::transfer_jobs::{
    FileImportPreparation, FileImportPreparationPhase, FileImportRequest, FileImportTargetBinding,
    LargeTransferListQuery, FILE_IMPORT_TARGET_CHANGED,
};

async fn prepared(
    fixture: &Fixture,
) -> Result<(
    FileImportRequest,
    std::path::PathBuf,
    FileImportPreparation,
    FileImportTargetBinding,
)> {
    let (request, source) =
        super::file_import::request(fixture, 201, LargeTransferMode::Append).await?;
    let binding = fixture
        .jobs
        .capture_file_import_target("p", &request.target)
        .await?;
    let preparation = fixture
        .jobs
        .begin_resumable_file_import_preparation(
            "p",
            "import",
            &request.source.source_digest,
            json!({"target":binding}),
        )
        .await?;
    let destination = preparation.path().join("normalized.sqlite");
    std::fs::rename(source, &destination)?;
    preparation.checkpoint(FileImportPreparationPhase::Ready, 0, 201)?;
    Ok((request, destination, preparation, binding))
}
fn query() -> LargeTransferListQuery {
    LargeTransferListQuery {
        project_id: "p".into(),
        cursor: None,
    }
}

#[tokio::test]
async fn handoff_reuses_one_job_and_review_after_raw_input_cleanup_and_reopen() -> Result<()> {
    let fixture = Fixture::new(0).await?;
    let (request, source, directory, binding) = prepared(&fixture).await?;
    let id = directory.progress()?.id;
    let first = fixture
        .jobs
        .prepare_file_import_from_preparation(request.clone(), &source, &directory, &binding)
        .await?;
    assert_eq!(first.job.id, id);
    let repeated = fixture
        .jobs
        .prepare_file_import_from_preparation(request, &source, &directory, &binding)
        .await?;
    assert_eq!(repeated.job.id, id);
    assert_eq!(repeated.confirmation_token, first.confirmation_token);
    assert_eq!(fixture.jobs.list_file_imports(query()).await?.jobs.len(), 1);
    drop(directory); // Simulate the owner exiting before disposable input cleanup.
    let restarted = open_jobs(fixture.root.path(), fixture.meta.clone()).await?;
    assert!(!source.exists());
    let recovered = restarted
        .file_import_preparation_result("p", &id)
        .await?
        .unwrap();
    assert_eq!(recovered.confirmation_token, first.confirmation_token);
    assert!(restarted
        .file_import_preparation_result("other", &id)
        .await
        .is_err());
    restarted.start("p", &id, &first.confirmation_token).await?;
    fixture.wait(&id, Phase::Completed).await?;
    assert_eq!(
        restarted
            .file_import_preparation_result("p", &id)
            .await?
            .unwrap()
            .job
            .phase,
        Phase::Completed
    );
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        201
    );
    target.close().await?;
    Ok(())
}

#[tokio::test]
async fn changed_configuration_or_same_schema_replacement_cannot_rebind_preparation() -> Result<()>
{
    let fixture = Fixture::new(0).await?;
    let (request, source, directory, binding) = prepared(&fixture).await?;
    let original = fixture
        .meta
        .get_connections("p")
        .await?
        .into_iter()
        .find(|c| c.id == "target")
        .unwrap();
    let alternate = fixture.root.path().join("alternate.sqlite");
    std::fs::copy(fixture.root.path().join("target.sqlite"), &alternate)?;
    let mut edited = original.clone();
    edited.config["url"] = json!(alternate);
    fixture.meta.save_connection(&edited).await?;
    assert!(fixture
        .jobs
        .require_file_import_target(&binding)
        .await
        .unwrap_err()
        .to_string()
        .contains(FILE_IMPORT_TARGET_CHANGED));
    assert!(fixture
        .jobs
        .prepare_file_import_from_preparation(request.clone(), &source, &directory, &binding)
        .await
        .is_err());
    assert!(fixture
        .jobs
        .list_file_imports(query())
        .await?
        .jobs
        .is_empty());
    fixture.meta.save_connection(&original).await?;
    fixture.jobs.require_file_import_target(&binding).await?;
    let target = fixture.root.path().join("target.sqlite");
    let previous = fixture.root.path().join("previous.sqlite");
    std::fs::rename(&target, &previous)?;
    std::fs::copy(&previous, &target)?;
    assert!(fixture
        .jobs
        .prepare_file_import_from_preparation(request, &source, &directory, &binding)
        .await
        .unwrap_err()
        .to_string()
        .contains(FILE_IMPORT_TARGET_CHANGED));
    assert!(fixture
        .jobs
        .list_file_imports(query())
        .await?
        .jobs
        .is_empty());
    std::fs::remove_file(&target)?;
    std::fs::rename(previous, target)?;
    fixture.jobs.require_file_import_target(&binding).await?;
    directory.close()?;
    Ok(())
}

#[tokio::test]
async fn failed_initial_handoff_resumes_the_same_inserted_record() -> Result<()> {
    let fixture = Fixture::new(0).await?;
    let (request, source, directory, binding) = prepared(&fixture).await?;
    let id = directory.progress()?.id;
    let mut target = fixture.target().await?;
    sqlx::query("ALTER TABLE items DROP COLUMN text_value")
        .execute(&mut target)
        .await?;
    target.close().await?;
    assert!(fixture
        .jobs
        .prepare_file_import_from_preparation(request.clone(), &source, &directory, &binding)
        .await
        .is_err());
    assert_eq!(fixture.jobs.list_file_imports(query()).await?.jobs.len(), 1);
    assert!(fixture
        .jobs
        .file_import_preparation_result("p", &id)
        .await?
        .is_none());
    let mut target = fixture.target().await?;
    sqlx::query("ALTER TABLE items ADD COLUMN text_value TEXT")
        .execute(&mut target)
        .await?;
    target.close().await?;
    let recovered = fixture
        .jobs
        .prepare_file_import_from_preparation(request, &source, &directory, &binding)
        .await?;
    assert_eq!(recovered.job.id, id);
    assert_eq!(fixture.jobs.list_file_imports(query()).await?.jobs.len(), 1);
    directory.close()?;
    fixture
        .jobs
        .start("p", &id, &recovered.confirmation_token)
        .await?;
    fixture.wait(&id, Phase::Completed).await?;
    Ok(())
}

#[tokio::test]
async fn interrupted_cleanup_missing_intent_is_retired_using_authenticated_job_link() -> Result<()>
{
    let fixture = Fixture::new(0).await?;
    let (request, source, directory, binding) = prepared(&fixture).await?;
    let result = fixture
        .jobs
        .prepare_file_import_from_preparation(request, &source, &directory, &binding)
        .await?;
    let path = directory.path().to_path_buf();
    std::fs::remove_file(path.join("intent.json"))?;
    drop(directory);
    let restarted = open_jobs(fixture.root.path(), fixture.meta.clone()).await?;
    assert!(!path.exists());
    assert_eq!(
        restarted
            .file_import_preparation_result("p", &result.job.id)
            .await?
            .unwrap()
            .confirmation_token,
        result.confirmation_token
    );
    assert_eq!(restarted.list_file_imports(query()).await?.jobs.len(), 1);
    Ok(())
}
