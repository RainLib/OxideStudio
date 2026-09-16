//! Compare runtime for table operations.

use super::compare_types::{
    TableDataCompareProgress, TableDataCompareProgressPhase, TableDataCompareProgressStatus,
};
use super::limits::{TABLE_DATA_COMPARE_CANCELLED, TABLE_DATA_COMPARE_PROGRESS_EVENT};
use super::transfer_runtime::bounded_table_data_transfer_message;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::watch;

pub(super) fn validate_table_data_compare_id(compare_id: &str) -> Result<(), String> {
    let compare_id = compare_id.trim();
    // Leave room for the endpoint suffix used as the backend query id.
    if !(8..=112).contains(&compare_id.len())
        || !compare_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(
            "Compare id must contain 8-112 ASCII letters, digits, hyphens, or underscores."
                .to_string(),
        );
    }
    Ok(())
}

pub(super) fn ensure_table_data_compare_not_cancelled(
    cancellation: &watch::Receiver<bool>,
) -> Result<(), String> {
    if *cancellation.borrow() {
        Err(TABLE_DATA_COMPARE_CANCELLED.to_string())
    } else {
        Ok(())
    }
}

pub(super) fn emit_table_data_compare_progress(
    app: &AppHandle,
    progress: TableDataCompareProgress,
) {
    if let Err(error) = app.emit(TABLE_DATA_COMPARE_PROGRESS_EVENT, progress) {
        tracing::warn!("Could not emit table data compare progress: {error}");
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn emit_running_table_data_compare_progress(
    app: &AppHandle,
    compare_id: &str,
    phase: TableDataCompareProgressPhase,
    endpoint: Option<&str>,
    processed_rows: u64,
    source_row_count: Option<u64>,
    target_row_count: Option<u64>,
    message: Option<&str>,
) {
    emit_table_data_compare_progress(
        app,
        TableDataCompareProgress {
            compare_id: compare_id.to_string(),
            phase,
            endpoint: endpoint.map(str::to_string),
            processed_rows,
            source_row_count,
            target_row_count,
            status: TableDataCompareProgressStatus::Running,
            terminal: false,
            message: message.map(bounded_table_data_transfer_message),
        },
    );
}
