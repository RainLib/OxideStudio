//! Sanitized operation provenance. This bridge neither executes nor stores SQL.
use crate::core::{
    manager::ConnectionManager, protocol::Response, semantic_context::ConnectionSemanticState,
};
use tauri::{Emitter, Manager, State};

pub const SEMANTIC_STATE_EVENT: &str = "connection-semantic-state";

#[tauri::command]
pub fn get_connection_semantic_state(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Response<Option<ConnectionSemanticState>>, String> {
    Ok(Response::ok(manager.semantic_state(&connection_id)))
}

pub fn install_semantic_state_events(app: &tauri::AppHandle) {
    let manager = app.state::<ConnectionManager>().inner().clone();
    let mut receiver = manager.subscribe_semantic_states();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match receiver.recv().await {
                Ok(state) => {
                    let _ = app.emit(SEMANTIC_STATE_EVENT, &state);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // A busy producer can overrun the bounded notification
                    // channel. Publish current per-connection snapshots;
                    // consumers reject older revisions and fetch on attach.
                    for state in manager.semantic_states() {
                        let _ = app.emit(SEMANTIC_STATE_EVENT, &state);
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
