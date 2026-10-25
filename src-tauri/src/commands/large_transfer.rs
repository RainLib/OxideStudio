use crate::core::{
    protocol::Response,
    transfer_jobs::{
        LargeTransferJobs, LargeTransferListQuery, LargeTransferPage, LargeTransferPreview,
        LargeTransferRequest, LargeTransferSummary,
    },
};
use serde::Deserialize;
use tauri::State;

/// A damaged ledger disables this feature instead of resetting jobs or keys.
pub struct LargeTransferJobState(pub Result<LargeTransferJobs, String>);
impl LargeTransferJobState {
    pub(crate) fn jobs(&self) -> Result<&LargeTransferJobs, String> {
        self.0.as_ref().map_err(Clone::clone)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LargeTransferIdentity {
    project_id: String,
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartLargeTransfer {
    project_id: String,
    id: String,
    confirmation_token: String,
}

// Database errors (including arbitrary trigger text) never reach the renderer.
fn response<T>(result: anyhow::Result<T>, code: &str, message: &str) -> Response<T> {
    match result {
        Ok(value) => Response::ok(value),
        Err(_) => Response::err(code, message),
    }
}

#[tauri::command]
pub async fn prepare_large_transfer(
    state: State<'_, LargeTransferJobState>,
    request: LargeTransferRequest,
) -> Result<Response<LargeTransferSummary>, String> {
    Ok(response(state.jobs()?.begin_prepare(request).await, "LARGE_TRANSFER_PREPARE_ERROR",
        "Cannot prepare this transfer. Choose saved local SQLite connections in this project and an existing ordinary target table; check file access and required columns."))
}

#[tauri::command]
pub async fn list_large_transfers(
    state: State<'_, LargeTransferJobState>,
    request: LargeTransferListQuery,
) -> Result<Response<LargeTransferPage>, String> {
    Ok(response(state.jobs()?.list(request).await, "LARGE_TRANSFER_LIST_ERROR",
        "Cannot read this project's transfer history. Keep the migration ledger and its authentication key together."))
}

#[tauri::command]
pub async fn get_large_transfer(
    state: State<'_, LargeTransferJobState>,
    request: LargeTransferIdentity,
) -> Result<Response<LargeTransferSummary>, String> {
    Ok(response(state.jobs()?.get(&request.project_id, &request.id).await, "LARGE_TRANSFER_READ_ERROR",
        "Cannot read or recover this project's transfer. Check the original target file and migration ledger."))
}

#[tauri::command]
pub async fn preview_large_transfer(
    state: State<'_, LargeTransferJobState>,
    request: LargeTransferIdentity,
) -> Result<Response<LargeTransferPreview>, String> {
    Ok(response(state.jobs()?.get_preview(&request.project_id, &request.id).await, "LARGE_TRANSFER_PREVIEW_ERROR",
        "The snapshot review is unavailable. Wait for preparation, or cancel an interrupted preparation and create a new snapshot."))
}

#[tauri::command]
pub async fn start_large_transfer(
    state: State<'_, LargeTransferJobState>,
    request: StartLargeTransfer,
) -> Result<Response<LargeTransferSummary>, String> {
    Ok(response(state.jobs()?.start(&request.project_id, &request.id, &request.confirmation_token).await,
        "LARGE_TRANSFER_START_ERROR", "Cannot start this transfer. Enter the exact review phrase and check that saved connections and the original target are unchanged. Cancel and review a new snapshot if they changed."))
}

#[tauri::command]
pub async fn pause_large_transfer(
    state: State<'_, LargeTransferJobState>,
    request: LargeTransferIdentity,
) -> Result<Response<bool>, String> {
    Ok(response(
        state
            .jobs()?
            .request_pause(&request.project_id, &request.id)
            .await
            .map(|()| true),
        "LARGE_TRANSFER_PAUSE_ERROR",
        "Only a copying transfer can be paused. A publication already in progress must finish.",
    ))
}

#[tauri::command]
pub async fn cancel_large_transfer(
    state: State<'_, LargeTransferJobState>,
    request: LargeTransferIdentity,
) -> Result<Response<bool>, String> {
    Ok(response(state.jobs()?.cancel(&request.project_id, &request.id).await.map(|()| true),
        "LARGE_TRANSFER_CANCEL_ERROR", "Cannot cancel this transfer. Publication may already have started, or the original file and staging objects require review. No target rows were deleted by this cancellation request."))
}
