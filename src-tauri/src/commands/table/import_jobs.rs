//! Opt-in resumable preparation; ordinary imports remain transactional.
use super::{
    access::{ensure_target_relation_operation_allowed, get_target_columns},
    import_snapshot::normalize_import_snapshot,
    import_types::{
        TableCsvImportOptions, TableImportCancellationState, TableImportFormat, TableImportMode,
    },
    limits::TABLE_IMPORT_CANCELLED,
    policy::{table_data_dialect_for_connection, RelationOperation},
    reports::validate_table_import_id,
};
use crate::{
    commands::large_transfer::LargeTransferJobState,
    core::{
        manager::ConnectionManager,
        protocol::{ColumnInfo, Response},
        transfer_jobs::{
            FileImportPreparation, FileImportPreparationPage, FileImportRequest,
            FileImportTargetBinding, LargeTransferEndpoint, LargeTransferJobs,
            LargeTransferListQuery, LargeTransferMode, LargeTransferPage, LargeTransferPreview,
            FILE_IMPORT_TARGET_CHANGED,
        },
    },
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[cfg(test)]
#[path = "tests/import_preparation_command.rs"]
mod tests;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareTableImportJob {
    pub project_id: String,
    pub import_id: String,
    pub connection_id: String,
    pub driver: String,
    pub schema: String,
    pub table: String,
    pub database: Option<String>,
    pub file_path: String,
    pub format: TableImportFormat,
    pub mode: TableImportMode,
    pub first_row_header: Option<bool>,
    pub csv_options: Option<TableCsvImportOptions>,
    pub expected_file_digest: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SavedImportPreparation {
    pub request: PrepareTableImportJob,
    pub columns: Vec<ColumnInfo>,
    #[serde(default)]
    pub target_binding: Option<FileImportTargetBinding>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportPreparationRequest {
    pub project_id: String,
    pub preparation_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportPreparationList {
    pub project_id: String,
    pub cursor: Option<String>,
}

fn response(result: Result<LargeTransferPreview, String>) -> Response<LargeTransferPreview> {
    match result {
        Ok(preview) => Response::ok(preview),
        Err(error) if error.contains(TABLE_IMPORT_CANCELLED) => Response::err(TABLE_IMPORT_CANCELLED, "Import preparation cancelled; target rows were not changed."),
        Err(error) if error.contains(FILE_IMPORT_TARGET_CHANGED) => Response::err(FILE_IMPORT_TARGET_CHANGED, "The saved connection or target database file changed. Restore the original target or create a new reviewed preparation; no target rows were changed."),
        Err(error) if error.contains("TABLE_IMPORT_TARGET_REVIEW_REQUIRED") => Response::err("TABLE_IMPORT_TARGET_REVIEW_REQUIRED", "This older preparation has no authenticated target binding. Create a new reviewed preparation; its existing files were retained."),
        Err(_) => Response::err("TABLE_IMPORT_JOB_PREPARE_ERROR", "Cannot prepare this resumable file import. Check its saved source, mapping and native SQLite target. An interrupted preparation can be resumed or discarded; no target rows were changed."),
    }
}

async fn execute_preparation(
    jobs: &LargeTransferJobs,
    manager: &ConnectionManager,
    cancellation: &TableImportCancellationState,
    mut request: PrepareTableImportJob,
    existing: Option<(
        FileImportPreparation,
        Vec<ColumnInfo>,
        FileImportTargetBinding,
    )>,
) -> Result<LargeTransferPreview, String> {
    let import_id = validate_table_import_id(&request.import_id)?;
    let cancel = cancellation.register(&import_id).await?;
    let (mut directory, saved_columns, mut target_binding) = match existing {
        Some((directory, columns, binding)) => (Some(directory), Some(columns), Some(binding)),
        None => (None, None, None),
    };
    let result: Result<LargeTransferPreview, String> = async {
        if request.driver != "sqlite" {
            return Err("Resumable file import requires a native SQLite target".into());
        }
        table_data_dialect_for_connection(manager, &request.connection_id, &request.driver, true)
            .await?;
        ensure_target_relation_operation_allowed(
            manager,
            &request.connection_id,
            request.database.as_deref(),
            &request.schema,
            &request.table,
            RelationOperation::DataMutation,
        )
        .await?;
        let columns = get_target_columns(
            manager,
            &request.connection_id,
            // Native SQLite has one connected file, not a switchable server
            // catalog. Its driver intentionally has no database-scoped column
            // API. Keep the optional selector in the authenticated endpoint:
            // capture/require_file_import_target below still rejects a selector
            // that does not match the saved file before preparing any source.
            None,
            &request.schema,
            &request.table,
        )
        .await
        .map_err(|e| e.to_string())?;
        if saved_columns
            .as_ref()
            .is_some_and(|saved| saved != &columns)
        {
            return Err("Import target metadata changed since preparation".into());
        }
        if directory.is_none() {
            let endpoint = LargeTransferEndpoint {
                connection_id: request.connection_id.clone(),
                driver: request.driver.clone(),
                schema: request.schema.clone(),
                table: request.table.clone(),
                database: request.database.clone(),
            };
            target_binding = Some(
                jobs.capture_file_import_target(&request.project_id, &endpoint)
                    .await
                    .map_err(|e| e.to_string())?,
            );
            request.file_path = std::path::absolute(&request.file_path)
                .map_err(|e| e.to_string())?
                .to_str()
                .ok_or("Invalid import path")?
                .into();
            directory = Some(
                jobs.begin_resumable_file_import_preparation(
                    &request.project_id,
                    &import_id,
                    &request.expected_file_digest,
                    serde_json::to_value(SavedImportPreparation {
                        request: request.clone(),
                        columns: columns.clone(),
                        target_binding: target_binding.clone(),
                    })
                    .map_err(|e| e.to_string())?,
                )
                .await
                .map_err(|e| e.to_string())?,
            );
        }
        let binding = target_binding
            .as_ref()
            .ok_or("TABLE_IMPORT_TARGET_REVIEW_REQUIRED")?;
        jobs.require_file_import_target(binding)
            .await
            .map_err(|e| e.to_string())?;
        let snapshot = normalize_import_snapshot(
            PathBuf::from(&request.file_path),
            request.expected_file_digest.clone(),
            request.format,
            request.first_row_header,
            request.csv_options.clone(),
            columns,
            cancel.clone(),
            directory.as_ref().ok_or("Missing preparation")?.clone(),
        )
        .await?;
        let transfer = FileImportRequest {
            project_id: request.project_id.clone(),
            target: LargeTransferEndpoint {
                connection_id: request.connection_id.clone(),
                driver: request.driver.clone(),
                schema: request.schema.clone(),
                table: request.table.clone(),
                database: request.database.clone(),
            },
            mode: match request.mode {
                TableImportMode::Append => LargeTransferMode::Append,
                TableImportMode::Truncate => LargeTransferMode::Overwrite,
            },
            batch_rows: 500,
            source: snapshot.plan.clone(),
        };
        let preview = jobs
            .prepare_file_import_from_preparation(
                transfer,
                &snapshot.path,
                &snapshot.directory,
                binding,
            )
            .await
            .map_err(|e| e.to_string())?;
        if *cancel.borrow() {
            jobs.cancel(&request.project_id, &preview.job.id)
                .await
                .map_err(|e| e.to_string())?;
            return Err(TABLE_IMPORT_CANCELLED.into());
        }
        drop(snapshot.directory);
        Ok(preview)
    }
    .await;
    cancellation.take(&import_id).await;
    if result.is_ok()
        || result
            .as_ref()
            .err()
            .is_some_and(|e| e.contains(TABLE_IMPORT_CANCELLED))
    {
        if let Some(directory) = directory {
            directory.close().map_err(|e| e.to_string())?;
        }
    }
    result
}

#[tauri::command]
pub async fn prepare_table_import_job(
    jobs: State<'_, LargeTransferJobState>,
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, TableImportCancellationState>,
    request: PrepareTableImportJob,
) -> Result<Response<LargeTransferPreview>, String> {
    Ok(response(
        execute_preparation(jobs.jobs()?, &manager, &cancellation, request, None).await,
    ))
}
#[tauri::command]
pub async fn resume_table_import_preparation(
    jobs: State<'_, LargeTransferJobState>,
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, TableImportCancellationState>,
    request: ImportPreparationRequest,
) -> Result<Response<LargeTransferPreview>, String> {
    let result = async {
        if let Some(preview) = jobs
            .jobs()?
            .file_import_preparation_result(&request.project_id, &request.preparation_id)
            .await
            .map_err(|e| e.to_string())?
        {
            return Ok(preview);
        }
        let directory = jobs
            .jobs()?
            .resume_file_import_preparation(&request.project_id, &request.preparation_id)
            .await
            .map_err(|e| e.to_string())?;
        let saved: SavedImportPreparation = serde_json::from_value(
            directory
                .intent()
                .map_err(|e| e.to_string())?
                .ok_or("Missing preparation definition")?,
        )
        .map_err(|e| e.to_string())?;
        if saved.request.project_id != request.project_id
            || saved.request.import_id != directory.progress().map_err(|e| e.to_string())?.import_id
        {
            return Err("Preparation project changed".into());
        }
        directory
            .require_source_digest(&saved.request.expected_file_digest)
            .map_err(|e| e.to_string())?;
        execute_preparation(
            jobs.jobs()?,
            &manager,
            &cancellation,
            saved.request,
            Some((
                directory,
                saved.columns,
                saved
                    .target_binding
                    .ok_or("TABLE_IMPORT_TARGET_REVIEW_REQUIRED")?,
            )),
        )
        .await
    }
    .await;
    Ok(response(result))
}
#[tauri::command]
pub async fn list_table_import_preparations(
    jobs: State<'_, LargeTransferJobState>,
    request: ImportPreparationList,
) -> Result<Response<FileImportPreparationPage>, String> {
    match jobs
        .jobs()?
        .list_file_import_preparations(&request.project_id, request.cursor.as_deref())
        .await
    {
        Ok(page) => Ok(Response::ok(page)),
        Err(_) => Ok(Response::err(
            "TABLE_IMPORT_PREPARATION_LIST_ERROR",
            "Cannot read the authenticated preparations for this project.",
        )),
    }
}
#[tauri::command]
pub async fn discard_table_import_preparation(
    jobs: State<'_, LargeTransferJobState>,
    request: ImportPreparationRequest,
) -> Result<Response<()>, String> {
    let result = async {
        jobs.jobs()?
            .resume_file_import_preparation(&request.project_id, &request.preparation_id)
            .await
            .map_err(|e| e.to_string())?
            .close()
            .map_err(|e| e.to_string())
    }
    .await;
    match result { Ok(()) => Ok(Response::ok(())), Err(_) => Ok(Response::err("TABLE_IMPORT_PREPARATION_DISCARD_ERROR", "Cannot discard this preparation while it is active or its ownership cannot be verified.")) }
}
#[tauri::command]
pub async fn list_table_import_jobs(
    jobs: State<'_, LargeTransferJobState>,
    request: LargeTransferListQuery,
) -> Result<Response<LargeTransferPage>, String> {
    match jobs.jobs()?.list_file_imports(request).await {
        Ok(page) => Ok(Response::ok(page)),
        Err(_) => Ok(Response::err("TABLE_IMPORT_JOB_LIST_ERROR", "Cannot read this project's resumable import history. Keep its ledger and authentication key together.")),
    }
}
