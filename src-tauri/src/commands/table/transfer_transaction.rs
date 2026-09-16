//! Transfer transaction for table operations.
use super::limits::TABLE_DATA_TRANSFER_CANCELLED;

use super::access::query_transfer_source_tracked;
use super::policy::schema_option;
use super::row_sql::{
    build_insert_mutation_with_column_quoting, build_table_order_by,
    build_upsert_mutation_with_column_quoting,
};
use super::transfer_identity::postgres_identity_reseed_statements;
use super::transfer_plan::{map_transfer_result_rows, ResolvedTableDataTransferPlan};
use super::transfer_types::{
    TableDataTransferEndpoint, TableDataTransferMode, TableDataTransferPostCommitReceipt,
    TableDataTransferPostCommitStatus, TableDataTransferRequest,
};
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ParameterizedStatement;
use crate::core::protocol::QueryResult;
use tokio::sync::watch;

pub(super) async fn finish_table_data_transfer_transaction(
    manager: &ConnectionManager,
    connection_id: &str,
    transaction_id: &str,
    transfer_result: Result<(u64, u64, bool), String>,
) -> Result<(u64, u64, bool), String> {
    match transfer_result {
        Ok(summary) => {
            manager
                .commit_transaction(connection_id, transaction_id)
                .await
                .map_err(|error| {
                    format!(
                        "Transfer batches completed but the final target commit failed; verify the target transaction state before retrying: {error}"
                    )
                })?;
            Ok(summary)
        }
        Err(error) => {
            let rollback = manager
                .rollback_transaction(connection_id, transaction_id)
                .await;
            Err(match rollback {
                Ok(()) => {
                    format!("Transfer failed and the target transaction was rolled back: {error}")
                }
                Err(rollback_error) => format!(
                    "Transfer failed and rollback also failed; inspect the target before retrying: {error}; rollback: {rollback_error}"
                ),
            })
        }
    }
}

pub(super) async fn delete_table_data_transfer_target_for_overwrite(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
    target_kind: DatabaseKind,
    transaction_id: &str,
    expected_rows: u64,
) -> Result<(), String> {
    let statement = ParameterizedStatement {
        sql: format!(
            "DELETE FROM {}",
            target_kind.qualified_table(schema_option(&endpoint.schema), &endpoint.table)
        ),
        params: Vec::new(),
    };
    let affected = manager
        .execute_parameterized_transaction(&endpoint.connection_id, transaction_id, &[statement])
        .await
        .map_err(|error| format!("Could not clear the overwrite target: {error}"))?;
    let actual_rows = affected
        .first()
        .copied()
        .ok_or_else(|| "The target driver did not report overwrite rows affected".to_string())?;
    if actual_rows != expected_rows {
        return Err(format!(
            "The overwrite target changed after preview: expected to delete {expected_rows} row(s), but the target reported {actual_rows}. Preview again."
        ));
    }
    Ok(())
}

pub(super) async fn execute_resolved_table_data_transfer_in_transaction(
    manager: &ConnectionManager,
    request: &TableDataTransferRequest,
    plan: &ResolvedTableDataTransferPlan,
    transaction_id: &str,
    query_transfer_id: &str,
    cancel_rx: &mut watch::Receiver<bool>,
    on_progress: &mut impl FnMut(u64, u64),
) -> Result<(u64, u64, bool), String> {
    if let Some(expected_rows) = plan.target_rows_to_delete {
        delete_table_data_transfer_target_for_overwrite(
            manager,
            &request.target,
            plan.target_kind,
            transaction_id,
            expected_rows,
        )
        .await?;
    }
    let order = build_table_order_by(plan.source_kind, &plan.source_columns, None)?;
    let mut offset = 0_u64;
    let mut rows_transferred = 0_u64;
    let mut batches = 0_u64;
    let mut limit_reached = false;
    while rows_transferred < u64::from(plan.max_rows) {
        if *cancel_rx.borrow() {
            return Err(format!(
                "{TABLE_DATA_TRANSFER_CANCELLED}: Transfer cancelled by the user"
            ));
        }
        let remaining = u64::from(plan.max_rows) - rows_transferred;
        let page_size = u64::from(plan.batch_size).min(remaining) as u32;
        let sql = plan.source_kind.paged_table_query_with_order(
            schema_option(&request.source.schema),
            &request.source.table,
            None,
            order.as_deref(),
            page_size,
            offset,
        );
        let mut results = tokio::select! {
            result = query_transfer_source_tracked(manager, &request.source, query_transfer_id, &sql) => {
                result.map_err(|error| error.to_string())?
            },
            changed = cancel_rx.changed() => {
                let _ = changed;
                return Err(format!(
                    "{TABLE_DATA_TRANSFER_CANCELLED}: Transfer cancelled by the user"
                ));
            }
        };
        let source_result = results
            .drain(..)
            .next()
            .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));
        let rows = map_transfer_result_rows(&source_result, plan)?;
        if rows.is_empty() {
            break;
        }
        let statements = rows
            .iter()
            .map(|row| {
                let mutation = if request.mode == TableDataTransferMode::Upsert {
                    build_upsert_mutation_with_column_quoting(
                        plan.target_kind,
                        &request.target.schema,
                        &request.target.table,
                        &plan.target_columns,
                        row,
                        &plan.upsert_key_columns,
                        plan.quote_target_column_names,
                    )
                } else {
                    build_insert_mutation_with_column_quoting(
                        plan.target_kind,
                        &request.target.schema,
                        &request.target.table,
                        &plan.target_columns,
                        row,
                        plan.quote_target_column_names,
                    )
                };
                mutation.map(|(sql, params)| ParameterizedStatement { sql, params })
            })
            .collect::<Result<Vec<_>, _>>()?;
        manager
            .execute_parameterized_transaction(
                &request.target.connection_id,
                transaction_id,
                &statements,
            )
            .await
            .map_err(|error| error.to_string())?;
        if *cancel_rx.borrow() {
            return Err(format!(
                "{TABLE_DATA_TRANSFER_CANCELLED}: Transfer cancelled by the user"
            ));
        }
        let copied = rows.len() as u64;
        rows_transferred += copied;
        offset += copied;
        batches += 1;
        on_progress(rows_transferred, batches);
        if copied < u64::from(page_size) {
            break;
        }
        if rows_transferred == u64::from(plan.max_rows) {
            limit_reached = true;
        }
    }
    if !plan.identity_reseed_plans.is_empty() {
        let statements =
            postgres_identity_reseed_statements(&request.target, &plan.identity_reseed_plans);
        manager
            .execute_parameterized_transaction(
                &request.target.connection_id,
                transaction_id,
                &statements,
            )
            .await
            .map_err(|error| {
                format!("Could not synchronize PostgreSQL identity generators: {error}")
            })?;
    }
    Ok((rows_transferred, batches, limit_reached))
}

pub(super) async fn execute_transfer_schema_restore_statements(
    manager: &ConnectionManager,
    connection_id: &str,
    transaction_id: &str,
    statements: &[String],
) -> Result<(), String> {
    if statements.is_empty() {
        return Ok(());
    }
    let statements = statements
        .iter()
        .map(|sql| ParameterizedStatement {
            sql: sql.clone(),
            params: Vec::new(),
        })
        .collect::<Vec<_>>();
    manager
        .execute_parameterized_transaction(connection_id, transaction_id, &statements)
        .await
        .map(|_| ())
        .map_err(|error| {
            format!("Could not restore the reviewed target indexes and constraints: {error}")
        })
}

#[derive(Debug, Clone)]
pub(super) struct PostCommitSchemaStatement {
    pub(super) table_index: usize,
    pub(super) sql: String,
}

#[derive(Debug, Clone)]
pub(super) struct PostCommitSchemaExecution {
    pub(super) receipt: TableDataTransferPostCommitReceipt,
    pub(super) succeeded_by_table: Vec<u32>,
}

pub(super) fn post_commit_schema_receipt(
    statements_total: usize,
    statements_succeeded: usize,
    cancelled: bool,
) -> TableDataTransferPostCommitReceipt {
    let needs_review = statements_succeeded < statements_total;
    let status = if needs_review {
        TableDataTransferPostCommitStatus::NeedsManualReview
    } else {
        TableDataTransferPostCommitStatus::Completed
    };
    let message = if needs_review {
        let cause = if cancelled {
            "restoration was cancelled"
        } else {
            "a reviewed statement failed"
        };
        format!(
            "Row writes are committed. {statements_succeeded} of {statements_total} reviewed schema statement(s) completed before {cause}. Inspect target indexes and constraints manually; automatic retry is disabled."
        )
    } else {
        format!(
            "Row writes are committed and all {statements_total} reviewed schema statement(s) completed."
        )
    };
    TableDataTransferPostCommitReceipt {
        status,
        statements_total: statements_total.min(u32::MAX as usize) as u32,
        statements_succeeded: statements_succeeded.min(u32::MAX as usize) as u32,
        message,
    }
}

pub(super) async fn execute_mysql_post_commit_schema_statements(
    manager: &ConnectionManager,
    connection_id: &str,
    statements: &[PostCommitSchemaStatement],
    table_count: usize,
    cancel_rx: &watch::Receiver<bool>,
) -> PostCommitSchemaExecution {
    let mut statements_succeeded = 0_usize;
    let mut succeeded_by_table = vec![0_u32; table_count];
    let mut cancelled = false;
    for statement in statements {
        if *cancel_rx.borrow() {
            cancelled = true;
            break;
        }
        if manager
            .execute_parameterized(connection_id, &statement.sql, &[])
            .await
            .is_err()
        {
            // Do not log the database error or SQL. This terminal receipt is
            // intentionally bounded and the target must be inspected before
            // any new transfer is started.
            break;
        }
        statements_succeeded += 1;
        if let Some(count) = succeeded_by_table.get_mut(statement.table_index) {
            *count = count.saturating_add(1);
        }
    }
    PostCommitSchemaExecution {
        receipt: post_commit_schema_receipt(statements.len(), statements_succeeded, cancelled),
        succeeded_by_table,
    }
}
