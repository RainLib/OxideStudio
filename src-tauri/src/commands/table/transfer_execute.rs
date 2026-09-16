//! Transfer execute for table operations.

use super::limits::{
    TABLE_DATA_TRANSFER_CANCELLED, TABLE_DATA_TRANSFER_REPORT_KIND,
    TABLE_DATA_TRANSFER_REPORT_PARENT_ID,
};
use super::policy::schema_option;
use super::reports::{
    current_table_timestamp_millis, normalized_table_data_transfer_project_id,
    persist_table_data_transfer_report, table_data_transfer_plan_digest,
    table_data_transfer_report_id,
};
use super::transfer_mapping::transfer_plan_can_execute;
use super::transfer_plan::resolve_table_data_transfer_plan;
use super::transfer_runtime::{
    bounded_table_data_transfer_message, execute_resolved_table_data_transfer_isolated,
    normalized_transfer_limit, should_emit_table_data_transfer_progress,
    validate_table_data_transfer_id, verify_completed_table_data_transfer,
    TableDataTransferProgressRelay,
};
use super::transfer_transaction::{
    execute_mysql_post_commit_schema_statements, execute_transfer_schema_restore_statements,
    finish_table_data_transfer_transaction, PostCommitSchemaStatement,
};
use super::transfer_types::{
    TableDataTransferCancellationState, TableDataTransferPostCommitStatus,
    TableDataTransferProgress, TableDataTransferProgressStatus, TableDataTransferReport,
    TableDataTransferRequest, TableDataTransferResult, TableDataTransferRetryPolicy,
};
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::Response;
use crate::core::store::MetaStore;
use tauri::AppHandle;
use tauri::State;

#[tauri::command]
pub async fn execute_table_data_transfer(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    meta_store: State<'_, MetaStore>,
    cancellation: State<'_, TableDataTransferCancellationState>,
    request: TableDataTransferRequest,
    confirmation_token: String,
) -> Result<Response<TableDataTransferResult>, String> {
    let transfer_id = request.transfer_id.trim().to_string();
    let started_at = current_table_timestamp_millis();
    let cancel_rx = match cancellation
        .register(&transfer_id, &request.source.connection_id)
        .await
    {
        Ok(receiver) => receiver,
        Err(error) => {
            return Ok(Response::err("REGISTER_TABLE_DATA_TRANSFER_ERROR", &error));
        }
    };
    let mut last_progress_rows = 0_u64;
    let mut last_progress_batches = 0_u64;
    let mut last_emitted_progress_batches = Some(0_u64);
    let progress_relay = TableDataTransferProgressRelay::new(app.clone());
    // Keep the reviewed baseline outside the transactional result. A failed
    // transaction has no transfer result, but its terminal audit report must
    // still record the non-sensitive count that was bound to the reviewed
    // plan before execution began.
    let mut reviewed_target_rows_before = None;
    let result: Result<TableDataTransferResult, String> = async {
        let plan = resolve_table_data_transfer_plan(&manager, &request).await?;
        if confirmation_token.trim() != plan.confirmation_token {
            return Err("Transfer plan changed or the confirmation token is invalid. Preview again before copying rows.".to_string());
        }
        if !transfer_plan_can_execute(&plan.mapped_columns) {
            return Err("Transfer contains unsupported column mappings. Preview the plan and change the target schema before copying rows.".to_string());
        }
        reviewed_target_rows_before = plan.target_rows_before;

        let transaction_id = format!("table-transfer-{}", uuid::Uuid::new_v4());
        match request.target.database.as_deref() {
            Some(database) => {
                manager
                    .begin_database_transaction(
                        &request.target.connection_id,
                        &transaction_id,
                        database,
                        schema_option(&request.target.schema).map(str::to_string),
                    )
                    .await
            }
            None => {
                manager
                    .begin_transaction(
                        &request.target.connection_id,
                        &transaction_id,
                        schema_option(&request.target.schema).map(str::to_string),
                    )
                    .await
            }
        }
        .map_err(|error| format!("Could not start the target transfer transaction: {error}"))?;

        progress_relay.try_send(
            TableDataTransferProgress {
                transfer_id: transfer_id.clone(),
                rows_transferred: 0,
                max_rows: plan.max_rows,
                batches: 0,
                status: TableDataTransferProgressStatus::Running,
                terminal: false,
                message: None,
            },
        );

        let mut on_progress = |rows_transferred, batches| {
            last_progress_rows = rows_transferred;
            last_progress_batches = batches;
            if should_emit_table_data_transfer_progress(
                &mut last_emitted_progress_batches,
                batches,
            ) {
                progress_relay.try_send(
                    TableDataTransferProgress {
                        transfer_id: transfer_id.clone(),
                        rows_transferred,
                        max_rows: plan.max_rows,
                        batches,
                        status: TableDataTransferProgressStatus::Running,
                        terminal: false,
                        message: None,
                    },
                );
            }
        };
        let transfer_result = execute_resolved_table_data_transfer_isolated(
            &manager,
            &request,
            &plan,
            &transaction_id,
            &transfer_id,
            cancel_rx.clone(),
            &mut on_progress,
        )
        .await;
        let mysql_post_commit = plan.target_kind == DatabaseKind::Mysql
            && !plan.schema_restore_statements.is_empty();
        let transfer_result = match transfer_result {
            Ok(summary) if !mysql_post_commit => execute_transfer_schema_restore_statements(
                &manager,
                &request.target.connection_id,
                &transaction_id,
                &plan.schema_restore_statements,
            )
            .await
            .map(|()| summary),
            Ok(summary) => Ok(summary),
            Err(error) => Err(error),
        };

        let (rows_transferred, batches, limit_reached) =
            finish_table_data_transfer_transaction(
                &manager,
                &request.target.connection_id,
                &transaction_id,
                transfer_result,
            )
            .await?;

        let post_commit = if mysql_post_commit {
            let statements = plan
                .schema_restore_statements
                .iter()
                .cloned()
                .map(|sql| PostCommitSchemaStatement {
                    table_index: 0,
                    sql,
                })
                .collect::<Vec<_>>();
            Some(
                execute_mysql_post_commit_schema_statements(
                    &manager,
                    &request.target.connection_id,
                    &statements,
                    1,
                    &cancel_rx,
                )
                .await,
            )
        } else {
            None
        };
        let restored_schema_objects = post_commit
            .as_ref()
            .and_then(|execution| execution.succeeded_by_table.first().copied())
            .unwrap_or(plan.schema_restore_statements.len() as u32);

        Ok(TableDataTransferResult {
            rows_transferred,
            batches,
            limit_reached,
            target_rows_before: plan.target_rows_before,
            mapped_columns: plan.mapped_columns,
            identity_reseed_columns: plan.identity_reseed_columns,
            restored_schema_objects,
            post_commit_receipt: post_commit.map(|execution| execution.receipt),
            report_id: None,
        })
    }
    .await;

    cancellation.take(&transfer_id).await;

    let terminal_progress = match &result {
        Ok(transfer) => TableDataTransferProgress {
            transfer_id: transfer_id.clone(),
            rows_transferred: transfer.rows_transferred,
            max_rows: normalized_transfer_limit(request.max_rows),
            batches: transfer.batches,
            status: if transfer
                .post_commit_receipt
                .as_ref()
                .is_some_and(|receipt| {
                    receipt.status == TableDataTransferPostCommitStatus::NeedsManualReview
                }) {
                TableDataTransferProgressStatus::Error
            } else {
                TableDataTransferProgressStatus::Done
            },
            terminal: true,
            message: transfer
                .post_commit_receipt
                .as_ref()
                .filter(|receipt| {
                    receipt.status == TableDataTransferPostCommitStatus::NeedsManualReview
                })
                .map(|receipt| receipt.message.clone()),
        },
        Err(error) => TableDataTransferProgress {
            transfer_id: transfer_id.clone(),
            rows_transferred: last_progress_rows,
            max_rows: normalized_transfer_limit(request.max_rows),
            batches: last_progress_batches,
            status: if error.contains(TABLE_DATA_TRANSFER_CANCELLED) {
                TableDataTransferProgressStatus::Cancelled
            } else {
                TableDataTransferProgressStatus::Error
            },
            terminal: true,
            message: Some(bounded_table_data_transfer_message(error)),
        },
    };
    progress_relay.finish(terminal_progress).await;

    let mut result = result;
    if let Some(project_id) =
        normalized_table_data_transfer_project_id(request.project_id.as_deref())
    {
        let report_id = table_data_transfer_report_id(&transfer_id);
        let verification = match &result {
            Ok(transfer) => {
                Some(verify_completed_table_data_transfer(&manager, &request, transfer).await)
            }
            Err(_) => None,
        };
        let (status, rows_transferred, batches, limit_reached, error) = match &result {
            Ok(transfer) => (
                if transfer.post_commit_receipt.as_ref().is_some_and(|receipt| {
                    receipt.status == TableDataTransferPostCommitStatus::NeedsManualReview
                }) {
                    TableDataTransferProgressStatus::Error
                } else {
                    TableDataTransferProgressStatus::Done
                },
                transfer.rows_transferred,
                transfer.batches,
                transfer.limit_reached,
                transfer.post_commit_receipt.as_ref().and_then(|receipt| {
                    (receipt.status
                        == TableDataTransferPostCommitStatus::NeedsManualReview)
                        .then(|| receipt.message.clone())
                }),
            ),
            Err(error) if error.contains(TABLE_DATA_TRANSFER_CANCELLED) => (
                TableDataTransferProgressStatus::Cancelled,
                last_progress_rows,
                last_progress_batches,
                false,
                Some("Transfer cancelled and target changes were rolled back.".to_string()),
            ),
            Err(error) if error.contains("rollback also failed") => (
                TableDataTransferProgressStatus::Error,
                last_progress_rows,
                last_progress_batches,
                false,
                Some(
                    "Transfer failed and rollback could not be confirmed; inspect the target before retrying."
                        .to_string(),
                ),
            ),
            Err(_) => (
                TableDataTransferProgressStatus::Error,
                last_progress_rows,
                last_progress_batches,
                false,
                Some("Transfer failed. The target transaction was rolled back when supported; capture a fresh preview before retrying.".to_string()),
            ),
        };
        let report = TableDataTransferReport {
            id: report_id.clone(),
            project_id,
            transfer_id: transfer_id.clone(),
            source: request.source.clone(),
            target: request.target.clone(),
            mode: request.mode,
            plan_digest: table_data_transfer_plan_digest(&confirmation_token),
            max_rows: normalized_transfer_limit(request.max_rows),
            rows_transferred,
            batches,
            limit_reached,
            target_rows_before: reviewed_target_rows_before,
            status,
            started_at,
            finished_at: current_table_timestamp_millis(),
            error,
            verification,
            retry_policy: if result.as_ref().ok().is_some_and(|transfer| {
                transfer
                    .post_commit_receipt
                    .as_ref()
                    .is_some_and(|receipt| {
                        receipt.status == TableDataTransferPostCommitStatus::NeedsManualReview
                    })
            }) {
                TableDataTransferRetryPolicy::ManualReviewRequired
            } else {
                TableDataTransferRetryPolicy::FreshPreview
            },
            post_commit_receipt: result
                .as_ref()
                .ok()
                .and_then(|transfer| transfer.post_commit_receipt.clone()),
        };
        match persist_table_data_transfer_report(meta_store.inner(), &report).await {
            Ok(()) => {
                if let Ok(transfer) = result.as_mut() {
                    transfer.report_id = Some(report_id);
                }
            }
            Err(error) => {
                tracing::warn!(error = %error, "table data transfer report was not persisted")
            }
        }
    }

    match result {
        Ok(transfer) => Ok(Response::ok(transfer)),
        Err(error) if error.contains(TABLE_DATA_TRANSFER_CANCELLED) => Ok(Response::err(
            "TABLE_DATA_TRANSFER_CANCELLED",
            "Transfer cancelled and target changes were rolled back.",
        )),
        Err(error) => Ok(Response::err("EXECUTE_TABLE_DATA_TRANSFER_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn cancel_table_data_transfer(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, TableDataTransferCancellationState>,
    transfer_id: String,
) -> Result<Response<String>, String> {
    validate_table_data_transfer_id(&transfer_id)?;
    let Some(handle) = cancellation.request_cancel(&transfer_id).await else {
        return Ok(Response::err(
            "TABLE_DATA_TRANSFER_NOT_FOUND",
            &format!("Table data transfer is not active: {transfer_id}"),
        ));
    };

    let backend_cancelled = manager
        .cancel_query(&handle.source_connection_id, &transfer_id)
        .await
        .unwrap_or(false);
    let _ = handle.sender.send(true);
    Ok(Response::ok(
        if backend_cancelled {
            "Transfer cancellation requested on the source database backend"
        } else {
            "Transfer cancellation requested"
        }
        .to_string(),
    ))
}

/// Lists privacy-bounded terminal reports for copies that wrote into one
/// target connection. The target is the resource owner because its state is
/// what a retry or verification needs to inspect.
#[tauri::command]
pub async fn list_table_data_transfer_reports(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    connection_id: String,
    limit: Option<usize>,
) -> Result<Response<Vec<TableDataTransferReport>>, String> {
    let project_id =
        normalized_table_data_transfer_project_id(Some(&project_id)).ok_or_else(|| {
            "A valid project id is required to read table transfer reports.".to_string()
        })?;
    let reports = meta_store
        .get_children(
            &project_id,
            Some(TABLE_DATA_TRANSFER_REPORT_PARENT_ID),
            &connection_id,
        )
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|resource| resource.kind == TABLE_DATA_TRANSFER_REPORT_KIND)
        .filter_map(|resource| {
            serde_json::from_value::<TableDataTransferReport>(resource.metadata).ok()
        })
        .collect::<Vec<_>>();
    let mut reports = reports;
    reports.sort_by_key(|report| std::cmp::Reverse(report.started_at));
    reports.truncate(limit.unwrap_or(20).clamp(1, 100));
    Ok(Response::ok(reports))
}
