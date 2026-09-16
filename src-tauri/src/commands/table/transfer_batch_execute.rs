//! Transfer batch execute for table operations.

use super::limits::TABLE_DATA_TRANSFER_CANCELLED;
use super::policy::schema_option;
use super::reports::{
    current_table_timestamp_millis, normalized_table_data_transfer_project_id,
    persist_table_data_transfer_object_report, persist_table_data_transfer_report,
    table_data_transfer_plan_digest,
};
use super::transfer_batch_plan::table_data_transfer_batch_preflight_id;
use super::transfer_mapping::transfer_plan_can_execute;
use super::transfer_objects::table_data_transfer_object_kind_label;
use super::transfer_runtime::{
    bounded_table_data_transfer_message, execute_resolved_table_data_transfer_isolated,
    normalized_transfer_driver_id, normalized_transfer_limit,
    resolve_table_data_transfer_batch_plan_isolated, resolve_table_data_transfer_plan_isolated,
    should_emit_table_data_transfer_progress, verify_completed_table_data_transfer,
    TableDataTransferProgressRelay,
};
use super::transfer_transaction::{
    execute_mysql_post_commit_schema_statements, execute_transfer_schema_restore_statements,
    PostCommitSchemaStatement,
};
use super::transfer_types::{
    TableDataTransferBatchExecuteRequest, TableDataTransferBatchResult,
    TableDataTransferBatchTableResult, TableDataTransferCancellationState,
    TableDataTransferEndpoint, TableDataTransferObjectReport, TableDataTransferObjectResult,
    TableDataTransferPostCommitStatus, TableDataTransferProgress, TableDataTransferProgressStatus,
    TableDataTransferReport, TableDataTransferRequest, TableDataTransferResult,
    TableDataTransferRetryPolicy,
};
use crate::core::manager::ConnectionManager;
use crate::core::protocol::Response;
use crate::core::store::MetaStore;
use sha2::Digest;
use sha2::Sha256;
use tauri::AppHandle;
use tauri::State;

#[tauri::command]
pub async fn execute_table_data_transfer_batch(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    meta_store: State<'_, MetaStore>,
    cancellation: State<'_, TableDataTransferCancellationState>,
    request: TableDataTransferBatchExecuteRequest,
    confirmation_token: String,
) -> Result<Response<TableDataTransferBatchResult>, String> {
    let transfer_id = request.transfer_id.trim().to_string();
    let started_at = current_table_timestamp_millis();
    let cancel_rx = match cancellation
        .register(&transfer_id, &request.plan.source_connection_id)
        .await
    {
        Ok(receiver) => receiver,
        Err(error) => {
            return Ok(Response::err(
                "REGISTER_TABLE_DATA_TRANSFER_BATCH_ERROR",
                &error,
            ))
        }
    };
    let mut last_progress_rows = 0_u64;
    let mut last_progress_batches = 0_u64;
    let progress_relay = TableDataTransferProgressRelay::new(app.clone());
    let mut expected_tables = Vec::<TableDataTransferRequest>::new();
    // This parallels expected_tables and is intentionally captured before
    // the shared target transaction starts. Reports remain useful if a later
    // table fails and the entire batch rolls back.
    let mut reviewed_target_rows_before = Vec::<Option<u64>>::new();
    let mut expected_objects = Vec::<TableDataTransferObjectResult>::new();
    let result: Result<TableDataTransferBatchResult, String> = async {
        let resolved_batch_plan =
            resolve_table_data_transfer_batch_plan_isolated(&manager, request.plan.clone()).await?;
        let batch_plan = resolved_batch_plan.plan;
        let object_plan = resolved_batch_plan.object_plan;
        expected_objects = object_plan.results.clone();
        if confirmation_token.trim() != batch_plan.confirmation_token {
            return Err("Batch transfer plan changed or the confirmation token is invalid. Preview again before copying rows.".to_string());
        }
        if !batch_plan.can_execute {
            return Err("Batch transfer cannot execute because its foreign-key graph or a table mapping requires review.".to_string());
        }

        let mut resolved_tables = Vec::with_capacity(batch_plan.ordered_tables.len());
        for table in &batch_plan.ordered_tables {
            let table_request = TableDataTransferRequest {
                project_id: None,
                transfer_id: table_data_transfer_batch_preflight_id(&request.plan, table)?,
                source: TableDataTransferEndpoint {
                    connection_id: request.plan.source_connection_id.clone(),
                    driver: request.plan.source_driver.clone(),
                    database: request.plan.source_database.clone(),
                    schema: request.plan.source_schema.clone(),
                    table: table.clone(),
                },
                target: TableDataTransferEndpoint {
                    connection_id: request.plan.target_connection_id.clone(),
                    driver: request.plan.target_driver.clone(),
                    database: request.plan.target_database.clone(),
                    schema: request.plan.target_schema.clone(),
                    table: table.clone(),
                },
                mode: request.plan.mode,
                max_rows: request.plan.max_rows,
                batch_size: request.plan.batch_size,
                reseed_identity: request.plan.reseed_identity,
                quote_target_column_names: request.plan.quote_target_column_names,
                restore_source_schema_objects: request.plan.restore_source_schema_objects,
            };
            let table_plan = resolve_table_data_transfer_plan_isolated(&manager, &table_request).await?;
            let expected_digest = batch_plan
                .table_preflights
                .iter()
                .find(|preflight| preflight.table.eq_ignore_ascii_case(table))
                .and_then(|preflight| preflight.plan_digest.as_deref())
                .ok_or_else(|| format!("Batch table {table} has no executable reviewed mapping."))?;
            if expected_digest != table_data_transfer_plan_digest(&table_plan.confirmation_token) {
                return Err(format!("The source or target mapping for {table} changed after batch preview. Preview again."));
            }
            if !transfer_plan_can_execute(&table_plan.mapped_columns) {
                return Err(format!("Batch table {table} contains unsupported column mappings."));
            }
            expected_tables.push(table_request.clone());
            reviewed_target_rows_before.push(table_plan.target_rows_before);
            resolved_tables.push((table_request, table_plan));
        }

        let mysql_post_commit =
            normalized_transfer_driver_id(&request.plan.target_driver) == "mysql";
        let mysql_post_commit_statements = if mysql_post_commit {
            let mut immediate = Vec::new();
            let mut foreign_keys = Vec::new();
            for (table_index, (_, table_plan)) in resolved_tables.iter().enumerate() {
                immediate.extend(table_plan.immediate_schema_restore_statements.iter().cloned().map(
                    |sql| PostCommitSchemaStatement { table_index, sql },
                ));
                foreign_keys.extend(
                    table_plan
                        .deferred_foreign_key_statements
                        .iter()
                        .cloned()
                        .map(|sql| PostCommitSchemaStatement { table_index, sql }),
                );
            }
            immediate.extend(foreign_keys);
            immediate
        } else {
            Vec::new()
        };

        let transaction_id = format!("table-transfer-batch-{}", uuid::Uuid::new_v4());
        match request.plan.target_database.as_deref() {
            Some(database) => manager.begin_database_transaction(
                &request.plan.target_connection_id,
                &transaction_id,
                database,
                schema_option(&request.plan.target_schema).map(str::to_string),
            ).await,
            None => manager.begin_transaction(
                &request.plan.target_connection_id,
                &transaction_id,
                schema_option(&request.plan.target_schema).map(str::to_string),
            ).await,
        }.map_err(|error| format!("Could not start the target batch transfer transaction: {error}"))?;

        let total_max_rows = resolved_tables.iter().fold(0_u32, |total, (_, plan)| {
            total.saturating_add(plan.max_rows)
        });
        progress_relay.try_send(TableDataTransferProgress {
            transfer_id: transfer_id.clone(), rows_transferred: 0, max_rows: total_max_rows,
            batches: 0, status: TableDataTransferProgressStatus::Running, terminal: false, message: None,
        });

        let execution: Result<TableDataTransferBatchResult, String> = async {
            let mut rows_transferred = 0_u64;
            let mut batches = 0_u64;
            let mut last_emitted_progress_batches = Some(0_u64);
            let mut limit_reached = false;
            let mut tables = Vec::with_capacity(resolved_tables.len());
            let mut deferred_foreign_key_statements = Vec::new();
            for (table_request, table_plan) in &resolved_tables {
                let completed_rows = rows_transferred;
                let completed_batches = batches;
                let (table_rows, table_batches, table_limit_reached) = {
                    let mut on_progress = |table_rows: u64, table_batches: u64| {
                        rows_transferred = completed_rows + table_rows;
                        batches = completed_batches + table_batches;
                        last_progress_rows = rows_transferred;
                        last_progress_batches = batches;
                        if should_emit_table_data_transfer_progress(
                            &mut last_emitted_progress_batches,
                            batches,
                        ) {
                            progress_relay.try_send(TableDataTransferProgress {
                                transfer_id: transfer_id.clone(), rows_transferred, max_rows: total_max_rows,
                                batches, status: TableDataTransferProgressStatus::Running, terminal: false, message: None,
                            });
                        }
                    };
                    execute_resolved_table_data_transfer_isolated(
                        &manager, table_request, table_plan, &transaction_id, &transfer_id, cancel_rx.clone(), &mut on_progress,
                    ).await?
                };
                if !mysql_post_commit {
                    execute_transfer_schema_restore_statements(
                        &manager,
                        &request.plan.target_connection_id,
                        &transaction_id,
                        &table_plan.immediate_schema_restore_statements,
                    )
                    .await?;
                }
                deferred_foreign_key_statements
                    .extend(table_plan.deferred_foreign_key_statements.iter().cloned());
                // Empty tables never invoke the progress callback.
                rows_transferred = completed_rows + table_rows;
                batches = completed_batches + table_batches;
                last_progress_rows = rows_transferred;
                last_progress_batches = batches;
                limit_reached |= table_limit_reached;
                tables.push(TableDataTransferBatchTableResult {
                    table: table_request.target.table.clone(), rows_transferred: table_rows,
                    batches: table_batches, limit_reached: table_limit_reached,
                    target_rows_before: table_plan.target_rows_before,
                    identity_reseed_columns: table_plan.identity_reseed_columns.clone(), report_id: None,
                    restored_schema_objects: if mysql_post_commit {
                        0
                    } else {
                        table_plan.schema_restore_statements.len() as u32
                    },
                });
            }
            if *cancel_rx.borrow() {
                return Err(format!(
                    "{TABLE_DATA_TRANSFER_CANCELLED}: Transfer cancelled before deferred foreign-key restoration"
                ));
            }
            if !mysql_post_commit {
                execute_transfer_schema_restore_statements(
                    &manager,
                    &request.plan.target_connection_id,
                    &transaction_id,
                    &deferred_foreign_key_statements,
                )
                .await?;
            }
            // Non-table objects run after all table data so triggers cannot
            // observe the copy and materialized views populated WITH DATA see
            // the reviewed final rows. PostgreSQL keeps this DDL in the same
            // target transaction as the table writes.
            if !object_plan.statements.is_empty() {
                manager
                    .execute_parameterized_transaction(
                        &request.plan.target_connection_id,
                        &transaction_id,
                        &object_plan.statements,
                    )
                    .await
                    .map_err(|error| {
                        format!(
                            "Could not create the reviewed schema objects; the target batch transaction will be rolled back: {error}"
                        )
                    })?;
            }
            Ok(TableDataTransferBatchResult {
                rows_transferred,
                batches,
                limit_reached,
                tables,
                objects: object_plan.results,
                post_commit_receipt: None,
            })
        }.await;

        match execution {
            Ok(mut summary) => {
                manager.commit_transaction(&request.plan.target_connection_id, &transaction_id).await.map_err(|error| {
                    format!("Batch transfer writes completed but the final target commit failed; verify the target transaction state before retrying: {error}")
                })?;
                if mysql_post_commit && !mysql_post_commit_statements.is_empty() {
                    let post_commit = execute_mysql_post_commit_schema_statements(
                        &manager,
                        &request.plan.target_connection_id,
                        &mysql_post_commit_statements,
                        summary.tables.len(),
                        &cancel_rx,
                    )
                    .await;
                    for (table, restored) in summary
                        .tables
                        .iter_mut()
                        .zip(post_commit.succeeded_by_table.iter().copied())
                    {
                        table.restored_schema_objects = restored;
                    }
                    summary.post_commit_receipt = Some(post_commit.receipt);
                }
                Ok(summary)
            }
            Err(error) => {
                let rollback = manager.rollback_transaction(&request.plan.target_connection_id, &transaction_id).await;
                Err(match rollback {
                    Ok(()) => format!("Batch transfer failed and the target transaction was rolled back: {error}"),
                    Err(rollback_error) => format!("Batch transfer failed and rollback also failed; inspect the target before retrying: {error}; rollback: {rollback_error}"),
                })
            }
        }
    }.await;

    cancellation.take(&transfer_id).await;
    let total_max_rows = normalized_transfer_limit(request.plan.max_rows)
        .saturating_mul(expected_tables.len().max(request.plan.tables.len()) as u32);
    let terminal_progress = match &result {
        Ok(summary) => TableDataTransferProgress {
            transfer_id: transfer_id.clone(),
            rows_transferred: summary.rows_transferred,
            max_rows: total_max_rows,
            batches: summary.batches,
            status: if summary.post_commit_receipt.as_ref().is_some_and(|receipt| {
                receipt.status == TableDataTransferPostCommitStatus::NeedsManualReview
            }) {
                TableDataTransferProgressStatus::Error
            } else {
                TableDataTransferProgressStatus::Done
            },
            terminal: true,
            message: summary
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
            max_rows: total_max_rows,
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
        let (status, error) = match &result {
            Ok(summary) if summary.post_commit_receipt.as_ref().is_some_and(|receipt| {
                receipt.status == TableDataTransferPostCommitStatus::NeedsManualReview
            }) => (
                TableDataTransferProgressStatus::Error,
                summary
                    .post_commit_receipt
                    .as_ref()
                    .map(|receipt| receipt.message.clone()),
            ),
            Ok(_) => (TableDataTransferProgressStatus::Done, None),
            Err(error) if error.contains(TABLE_DATA_TRANSFER_CANCELLED) => (TableDataTransferProgressStatus::Cancelled, Some("Batch transfer cancelled and target changes were rolled back.".to_string())),
            Err(error) if error.contains("rollback also failed") => (
                TableDataTransferProgressStatus::Error,
                Some(
                    "Batch transfer failed and rollback could not be confirmed; inspect the target before retrying."
                        .to_string(),
                ),
            ),
            Err(_) => (TableDataTransferProgressStatus::Error, Some("Batch transfer failed. The target transaction was rolled back when supported; capture a fresh batch preview before retrying.".to_string())),
        };
        for (index, table_request) in expected_tables.iter().enumerate() {
            let table_result = result
                .as_ref()
                .ok()
                .and_then(|summary| summary.tables.get(index));
            let (rows_transferred, batches, limit_reached) = table_result
                .map(|table| (table.rows_transferred, table.batches, table.limit_reached))
                .unwrap_or((0, 0, false));
            let verification = match table_result {
                Some(table) => {
                    let transfer = TableDataTransferResult {
                        rows_transferred: table.rows_transferred,
                        batches: table.batches,
                        limit_reached: table.limit_reached,
                        target_rows_before: table.target_rows_before,
                        mapped_columns: Vec::new(),
                        identity_reseed_columns: table.identity_reseed_columns.clone(),
                        restored_schema_objects: table.restored_schema_objects,
                        post_commit_receipt: result
                            .as_ref()
                            .ok()
                            .and_then(|summary| summary.post_commit_receipt.clone()),
                        report_id: None,
                    };
                    Some(
                        verify_completed_table_data_transfer(
                            manager.inner(),
                            table_request,
                            &transfer,
                        )
                        .await,
                    )
                }
                None => None,
            };
            let table_digest = Sha256::digest(table_request.target.table.as_bytes());
            let report_id = format!(
                "table-transfer-report-{}-{:X}",
                transfer_id,
                u64::from_be_bytes(table_digest[..8].try_into().expect("sha256 prefix"))
            );
            let report = TableDataTransferReport {
                id: report_id.clone(),
                project_id: project_id.clone(),
                transfer_id: format!("{transfer_id}-{index}"),
                source: table_request.source.clone(),
                target: table_request.target.clone(),
                mode: table_request.mode,
                plan_digest: table_data_transfer_plan_digest(&confirmation_token),
                max_rows: normalized_transfer_limit(request.plan.max_rows),
                rows_transferred,
                batches,
                limit_reached,
                target_rows_before: reviewed_target_rows_before.get(index).copied().flatten(),
                status,
                started_at,
                finished_at: current_table_timestamp_millis(),
                error: error.clone(),
                verification,
                retry_policy: if result.as_ref().ok().is_some_and(|summary| {
                    summary.post_commit_receipt.as_ref().is_some_and(|receipt| {
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
                    .and_then(|summary| summary.post_commit_receipt.clone()),
            };
            match persist_table_data_transfer_report(meta_store.inner(), &report).await {
                Ok(()) => {
                    if let Ok(summary) = result.as_mut() {
                        if let Some(table) = summary.tables.get_mut(index) {
                            table.report_id = Some(report_id);
                        }
                    }
                }
                Err(error) => {
                    tracing::warn!(error = %error, "batch table data transfer report was not persisted")
                }
            }
        }
        for (index, object) in expected_objects.iter().enumerate() {
            let object_identity = format!(
                "{}:{}:{}:{}",
                table_data_transfer_object_kind_label(object.object_type),
                request.plan.target_schema,
                object.parent_name.as_deref().unwrap_or_default(),
                object.name
            );
            let object_digest = Sha256::digest(object_identity.as_bytes());
            let report_id = format!(
                "table-transfer-object-report-{}-{:X}",
                transfer_id,
                u64::from_be_bytes(object_digest[..8].try_into().expect("sha256 prefix"))
            );
            let report = TableDataTransferObjectReport {
                id: report_id.clone(),
                project_id: project_id.clone(),
                transfer_id: format!("{transfer_id}-object-{index}"),
                source_connection_id: request.plan.source_connection_id.clone(),
                source_database: request.plan.source_database.clone(),
                source_schema: request.plan.source_schema.clone(),
                target_connection_id: request.plan.target_connection_id.clone(),
                target_database: request.plan.target_database.clone(),
                target_schema: request.plan.target_schema.clone(),
                object_type: object.object_type,
                name: object.name.clone(),
                parent_name: object.parent_name.clone(),
                action: object.action,
                plan_digest: table_data_transfer_plan_digest(&confirmation_token),
                status,
                started_at,
                finished_at: current_table_timestamp_millis(),
                error: error.clone(),
            };
            match persist_table_data_transfer_object_report(meta_store.inner(), &report).await {
                Ok(()) => {
                    if let Ok(summary) = result.as_mut() {
                        if let Some(result_object) = summary.objects.iter_mut().find(|candidate| {
                            candidate.object_type == object.object_type
                                && candidate.name == object.name
                                && candidate.parent_name == object.parent_name
                        }) {
                            result_object.report_id = Some(report_id);
                        }
                    }
                }
                Err(error) => {
                    tracing::warn!(error = %error, "schema object transfer report was not persisted")
                }
            }
        }
    }
    match result {
        Ok(summary) => Ok(Response::ok(summary)),
        Err(error) if error.contains(TABLE_DATA_TRANSFER_CANCELLED) => Ok(Response::err(
            "TABLE_DATA_TRANSFER_CANCELLED",
            "Batch transfer cancelled and target changes were rolled back.",
        )),
        Err(error) => Ok(Response::err(
            "EXECUTE_TABLE_DATA_TRANSFER_BATCH_ERROR",
            &error,
        )),
    }
}
