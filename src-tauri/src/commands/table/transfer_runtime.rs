//! Transfer runtime for table operations.

use super::access::query_target;
use super::export_analytical::analytical_bool;
use super::export_sql::sql_string_literal;
use super::limits::{
    DEFAULT_TRANSFER_BATCH_SIZE, DEFAULT_TRANSFER_ROWS, MAX_TRANSFER_BATCH_SIZE,
    MAX_TRANSFER_OVERWRITE_ROWS, MAX_TRANSFER_ROWS, TABLE_DATA_TRANSFER_PROGRESS_BATCH_INTERVAL,
    TABLE_DATA_TRANSFER_PROGRESS_EVENT, TABLE_DATA_TRANSFER_PROGRESS_QUEUE_CAPACITY,
};
use super::policy::{schema_option, table_data_transfer_dialect};
use super::transfer_batch_plan::{
    resolve_table_data_transfer_batch_plan, ResolvedTableDataTransferBatchPlan,
};
use super::transfer_plan::{resolve_table_data_transfer_plan, ResolvedTableDataTransferPlan};
use super::transfer_transaction::execute_resolved_table_data_transfer_in_transaction;
use super::transfer_types::{
    TableDataTransferBatchPlanRequest, TableDataTransferEndpoint, TableDataTransferMode,
    TableDataTransferProgress, TableDataTransferProgressStatus, TableDataTransferRequest,
    TableDataTransferResult, TableDataTransferVerification, TableDataTransferVerificationStatus,
};
use super::values::value_to_u64;
use crate::core::dialect::canonical_driver_name;
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::mpsc;
use tokio::sync::watch;

pub(super) fn normalized_transfer_limit(value: Option<u32>) -> u32 {
    value
        .unwrap_or(DEFAULT_TRANSFER_ROWS)
        .clamp(1, MAX_TRANSFER_ROWS)
}

pub(super) fn validate_table_data_transfer_id(transfer_id: &str) -> Result<(), String> {
    let transfer_id = transfer_id.trim();
    if !(8..=128).contains(&transfer_id.len())
        || !transfer_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(
            "Transfer id must contain 8-128 ASCII letters, digits, hyphens, or underscores."
                .to_string(),
        );
    }
    Ok(())
}

pub(super) fn validate_table_data_transfer_overwrite_rows(count: u64) -> Result<u64, String> {
    if count > MAX_TRANSFER_OVERWRITE_ROWS {
        return Err(format!(
            "Overwrite is limited to {MAX_TRANSFER_OVERWRITE_ROWS} existing target rows; the target currently contains {count}."
        ));
    }
    Ok(count)
}

pub(super) fn emit_table_data_transfer_progress(
    app: &AppHandle,
    progress: TableDataTransferProgress,
) {
    if let Err(error) = app.emit(TABLE_DATA_TRANSFER_PROGRESS_EVENT, progress) {
        tracing::warn!("Could not emit table data transfer progress: {error}");
    }
}

pub(super) struct TableDataTransferProgressRelay {
    pub(super) sender: mpsc::Sender<TableDataTransferProgress>,
    pub(super) task: tokio::task::JoinHandle<()>,
}

/// The transfer commands do substantial catalog work before they can begin a
/// target transaction. Keep that nested driver/metadata future off the Tauri
/// command task stack, and make sure a dropped command never leaves its plan
/// task behind to keep querying a connection the caller has abandoned.
pub(super) struct AbortTableDataTransferTaskOnDrop(pub(super) tokio::task::AbortHandle);

impl Drop for AbortTableDataTransferTaskOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub(super) async fn resolve_table_data_transfer_plan_isolated(
    manager: &ConnectionManager,
    request: &TableDataTransferRequest,
) -> Result<ResolvedTableDataTransferPlan, String> {
    let manager = manager.clone();
    let request = request.clone();
    let task =
        tokio::spawn(async move { resolve_table_data_transfer_plan(&manager, &request).await });
    let _abort_on_drop = AbortTableDataTransferTaskOnDrop(task.abort_handle());
    task.await
        .map_err(|error| format!("Table transfer planning task failed: {error}"))?
}

pub(super) async fn resolve_table_data_transfer_batch_plan_isolated(
    manager: &ConnectionManager,
    request: TableDataTransferBatchPlanRequest,
) -> Result<ResolvedTableDataTransferBatchPlan, String> {
    let manager = manager.clone();
    let task =
        tokio::spawn(
            async move { resolve_table_data_transfer_batch_plan(&manager, request).await },
        );
    let _abort_on_drop = AbortTableDataTransferTaskOnDrop(task.abort_handle());
    task.await
        .map_err(|error| format!("Batch transfer planning task failed: {error}"))?
}

/// Execute the row-copy loop on its own Tokio task.  The Tauri command keeps
/// ownership of the target transaction and terminal receipt, while the large
/// source-read / target-write future and nested driver calls use a separate
/// worker stack.  Progress crosses a bounded channel so a slow renderer never
/// makes database work retain an unbounded event backlog.
pub(super) async fn execute_resolved_table_data_transfer_isolated(
    manager: &ConnectionManager,
    request: &TableDataTransferRequest,
    plan: &ResolvedTableDataTransferPlan,
    transaction_id: &str,
    query_transfer_id: &str,
    cancel_rx: watch::Receiver<bool>,
    on_progress: &mut impl FnMut(u64, u64),
) -> Result<(u64, u64, bool), String> {
    let manager = manager.clone();
    let request = request.clone();
    let plan = plan.clone();
    let transaction_id = transaction_id.to_string();
    let query_transfer_id = query_transfer_id.to_string();
    let (progress_sender, mut progress_receiver) =
        mpsc::channel(TABLE_DATA_TRANSFER_PROGRESS_QUEUE_CAPACITY);
    let mut task = tokio::spawn(async move {
        let mut cancel_rx = cancel_rx;
        let mut relay_progress = |rows_transferred, batches| {
            try_send_table_data_transfer_progress(
                &progress_sender,
                TableDataTransferProgress {
                    transfer_id: query_transfer_id.clone(),
                    rows_transferred,
                    max_rows: plan.max_rows,
                    batches,
                    status: TableDataTransferProgressStatus::Running,
                    terminal: false,
                    message: None,
                },
            );
        };
        execute_resolved_table_data_transfer_in_transaction(
            &manager,
            &request,
            &plan,
            &transaction_id,
            &query_transfer_id,
            &mut cancel_rx,
            &mut relay_progress,
        )
        .await
    });
    let _abort_on_drop = AbortTableDataTransferTaskOnDrop(task.abort_handle());

    loop {
        tokio::select! {
            biased;
            Some(progress) = progress_receiver.recv() => {
                on_progress(progress.rows_transferred, progress.batches);
            }
            result = &mut task => {
                return result
                    .map_err(|error| format!("Table transfer execution task failed: {error}"))?;
            }
        }
    }
}

impl TableDataTransferProgressRelay {
    pub(super) fn new(app: AppHandle) -> Self {
        let (sender, mut receiver) = mpsc::channel(TABLE_DATA_TRANSFER_PROGRESS_QUEUE_CAPACITY);
        let task = tokio::spawn(async move {
            while let Some(progress) = receiver.recv().await {
                emit_table_data_transfer_progress(&app, progress);
            }
        });
        Self { sender, task }
    }

    pub(super) fn try_send(&self, progress: TableDataTransferProgress) {
        // Intermediate updates are intentionally lossy. The receiver preserves
        // FIFO order for accepted updates and finish() sends terminal state.
        try_send_table_data_transfer_progress(&self.sender, progress);
    }

    pub(super) async fn finish(self, progress: TableDataTransferProgress) {
        let Self { sender, task } = self;
        // Waiting for one final slot preserves order and ensures Done/Error/
        // Cancelled is never dropped when the renderer is temporarily slow.
        let _ = sender.send(progress).await;
        drop(sender);
        let _ = task.await;
    }
}

pub(super) fn try_send_table_data_transfer_progress(
    sender: &mpsc::Sender<TableDataTransferProgress>,
    progress: TableDataTransferProgress,
) {
    let _ = sender.try_send(progress);
}

pub(super) fn should_emit_table_data_transfer_progress(
    last_emitted_batches: &mut Option<u64>,
    batches: u64,
) -> bool {
    let should_emit = last_emitted_batches
        .map(|previous| {
            batches.saturating_sub(previous) >= TABLE_DATA_TRANSFER_PROGRESS_BATCH_INTERVAL
        })
        .unwrap_or(true);
    if should_emit {
        *last_emitted_batches = Some(batches);
    }
    should_emit
}

pub(super) fn bounded_table_data_transfer_message(message: &str) -> String {
    const MAX_CHARS: usize = 1_024;
    let mut bounded = message.chars().take(MAX_CHARS).collect::<String>();
    if message.chars().count() > MAX_CHARS {
        bounded.push('…');
    }
    bounded
}

pub(super) async fn verify_completed_table_data_transfer(
    manager: &ConnectionManager,
    request: &TableDataTransferRequest,
    transfer: &TableDataTransferResult,
) -> TableDataTransferVerification {
    let target_kind = table_data_transfer_dialect(manager, &request.target).await;
    let mut verification = if request.mode != TableDataTransferMode::Overwrite {
        TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::NeedsReview,
            expected_rows: if request.mode == TableDataTransferMode::Append {
                transfer
                    .target_rows_before
                    .and_then(|baseline| baseline.checked_add(transfer.rows_transferred))
            } else {
                None
            },
            observed_rows: None,
            identity_reseed_columns: Vec::new(),
            identity_reseed_verified: None,
            message: if request.mode == TableDataTransferMode::Append {
                "Append verification needs the reviewed target baseline and a post-commit count."
                    .to_string()
            } else if request.mode == TableDataTransferMode::Upsert {
                "Row-count verification is inconclusive for upsert because existing rows may be updated."
                    .to_string()
            } else {
                "No deterministic row-count verification is available for this transfer."
                    .to_string()
            },
        }
    } else {
        let target_kind = match target_kind.as_ref() {
            Ok(kind) => *kind,
            Err(_) => {
                return TableDataTransferVerification {
                    status: TableDataTransferVerificationStatus::NeedsReview,
                    expected_rows: Some(transfer.rows_transferred),
                    observed_rows: None,
                    identity_reseed_columns: transfer.identity_reseed_columns.clone(),
                    identity_reseed_verified: None,
                    message: "The transfer committed, but the target could not be reopened for post-commit verification."
                        .to_string(),
                }
            }
        };
        let count_sql = target_kind.count_table_query(
            schema_option(&request.target.schema),
            &request.target.table,
            None,
        );
        let observed_rows = query_target(
            manager,
            &request.target.connection_id,
            request.target.database.as_deref(),
            &count_sql,
        )
        .await
        .ok()
        .and_then(|results| {
            results
                .first()
                .and_then(|result| result.rows.first())
                .and_then(|row| row.first())
                .and_then(value_to_u64)
        });
        overwrite_transfer_verification(transfer.rows_transferred, observed_rows)
    };

    if request.mode == TableDataTransferMode::Append {
        let observed_rows = match target_kind.as_ref() {
            Ok(kind) => {
                let count_sql = kind.count_table_query(
                    schema_option(&request.target.schema),
                    &request.target.table,
                    None,
                );
                query_target(
                    manager,
                    &request.target.connection_id,
                    request.target.database.as_deref(),
                    &count_sql,
                )
                .await
                .ok()
                .and_then(|results| {
                    results
                        .first()
                        .and_then(|result| result.rows.first())
                        .and_then(|row| row.first())
                        .and_then(value_to_u64)
                })
            }
            Err(_) => None,
        };
        verification = append_transfer_verification(
            transfer.target_rows_before,
            transfer.rows_transferred,
            observed_rows,
        );
    }

    if transfer.identity_reseed_columns.is_empty() {
        return verification;
    }

    verification.identity_reseed_columns = transfer.identity_reseed_columns.clone();
    let identity_verified = match target_kind.as_ref() {
        Ok(DatabaseKind::Postgres) => {
            verify_postgres_identity_reseed(
                manager,
                &request.target,
                &transfer.identity_reseed_columns,
            )
            .await
        }
        _ => None,
    };
    verification.identity_reseed_verified = identity_verified;
    let columns = transfer.identity_reseed_columns.join(", ");
    match identity_verified {
        Some(true) => verification.message.push_str(&format!(
            " PostgreSQL generator state is at or beyond the post-commit table maximum for: {columns}."
        )),
        Some(false) => {
            verification.status = TableDataTransferVerificationStatus::NeedsReview;
            verification.message.push_str(&format!(
                " PostgreSQL generator state is behind or detached from the post-commit table maximum for: {columns}. Review before inserting more rows."
            ));
        }
        None => {
            verification.status = TableDataTransferVerificationStatus::NeedsReview;
            verification.message.push_str(&format!(
                " PostgreSQL generator state could not be verified for: {columns}. Review before inserting more rows."
            ));
        }
    }
    verification
}

pub(super) fn append_transfer_verification(
    baseline_rows: Option<u64>,
    transferred_rows: u64,
    observed_rows: Option<u64>,
) -> TableDataTransferVerification {
    let expected_rows = baseline_rows.and_then(|baseline| baseline.checked_add(transferred_rows));
    match (expected_rows, observed_rows) {
        (Some(expected), Some(observed)) if expected == observed => TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::Verified,
            expected_rows: Some(expected), observed_rows: Some(observed),
            identity_reseed_columns: Vec::new(), identity_reseed_verified: None,
            message: "Post-commit target row count matches the reviewed append baseline plus copied rows.".to_string(),
        },
        (Some(expected), Some(observed)) => TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::NeedsReview,
            expected_rows: Some(expected), observed_rows: Some(observed),
            identity_reseed_columns: Vec::new(), identity_reseed_verified: None,
            message: "The append transfer committed, but the target count differs from the reviewed baseline plus copied rows; review concurrent writes before retrying.".to_string(),
        },
        (Some(expected), None) => TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::NeedsReview,
            expected_rows: Some(expected), observed_rows: None,
            identity_reseed_columns: Vec::new(), identity_reseed_verified: None,
            message: "The append transfer committed, but the target row count could not be verified after commit.".to_string(),
        },
        (None, observed) => TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::NeedsReview,
            expected_rows: None, observed_rows: observed,
            identity_reseed_columns: Vec::new(), identity_reseed_verified: None,
            message: "The append transfer committed without a usable reviewed target baseline; review the target before retrying.".to_string(),
        },
    }
}

pub(super) async fn verify_postgres_identity_reseed(
    manager: &ConnectionManager,
    target: &TableDataTransferEndpoint,
    columns: &[String],
) -> Option<bool> {
    if columns.is_empty() {
        return Some(true);
    }
    for column in columns {
        let sql = postgres_identity_reseed_verification_query(target, column);
        let verified = query_target(
            manager,
            &target.connection_id,
            target.database.as_deref(),
            &sql,
        )
        .await
        .ok()
        .and_then(|results| {
            results
                .first()
                .and_then(|result| result.rows.first())
                .and_then(|row| row.first())
                .and_then(|value| analytical_bool(value).ok().flatten())
        });
        match verified {
            Some(true) => {}
            Some(false) => return Some(false),
            None => return None,
        }
    }
    Some(true)
}

pub(super) fn postgres_identity_reseed_verification_query(
    target: &TableDataTransferEndpoint,
    column: &str,
) -> String {
    let relation =
        DatabaseKind::Postgres.qualified_table(schema_option(&target.schema), &target.table);
    let relation_literal = sql_string_literal(&relation);
    let quoted_column = DatabaseKind::Postgres.quote_identifier(column);
    let column_literal = sql_string_literal(column);
    format!(
        "SELECT COALESCE(pg_sequence_last_value(pg_get_serial_sequence({relation_literal}, {column_literal})::regclass) >= COALESCE(MAX({quoted_column}), 0), FALSE) FROM {relation}"
    )
}

pub(super) fn overwrite_transfer_verification(
    expected_rows: u64,
    observed_rows: Option<u64>,
) -> TableDataTransferVerification {
    match observed_rows {
        Some(observed_rows) if observed_rows == expected_rows => TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::Verified,
            expected_rows: Some(expected_rows),
            observed_rows: Some(observed_rows),
            identity_reseed_columns: Vec::new(),
            identity_reseed_verified: None,
            message: "Post-commit target row count matches the completed overwrite transfer."
                .to_string(),
        },
        Some(observed_rows) => TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::NeedsReview,
            expected_rows: Some(expected_rows),
            observed_rows: Some(observed_rows),
            identity_reseed_columns: Vec::new(),
            identity_reseed_verified: None,
            message: "The transfer committed, but the post-commit target row count differs; review concurrent writes before retrying."
                .to_string(),
        },
        None => TableDataTransferVerification {
            status: TableDataTransferVerificationStatus::NeedsReview,
            expected_rows: Some(expected_rows),
            observed_rows: None,
            identity_reseed_columns: Vec::new(),
            identity_reseed_verified: None,
            message: "The transfer committed, but the target row count could not be verified after commit."
                .to_string(),
        },
    }
}

pub(super) fn normalized_transfer_batch_size(value: Option<u32>) -> u32 {
    value
        .unwrap_or(DEFAULT_TRANSFER_BATCH_SIZE)
        .clamp(1, MAX_TRANSFER_BATCH_SIZE)
}

pub(super) fn normalized_transfer_driver_id(driver: &str) -> String {
    canonical_driver_name(driver)
        .unwrap_or_else(|| driver.trim())
        .to_ascii_lowercase()
}
