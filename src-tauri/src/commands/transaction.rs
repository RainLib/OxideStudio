use crate::core::{manager::ConnectionManager, protocol::Response};
use tauri::State;

#[tauri::command]
pub async fn begin_transaction(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    transaction_id: String,
    schema: Option<String>,
) -> Result<Response<String>, String> {
    match manager
        .begin_transaction(&connection_id, &transaction_id, schema)
        .await
    {
        Ok(_) => Ok(Response::ok("Transaction started".to_string())),
        Err(error) => Ok(Response::err("BEGIN_TRANSACTION_ERROR", &error.to_string())),
    }
}

#[tauri::command]
pub async fn commit_transaction(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    transaction_id: String,
) -> Result<Response<String>, String> {
    match manager
        .commit_transaction(&connection_id, &transaction_id)
        .await
    {
        Ok(_) => Ok(Response::ok("Transaction committed".to_string())),
        Err(error) => Ok(Response::err(
            "COMMIT_TRANSACTION_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn rollback_transaction(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    transaction_id: String,
) -> Result<Response<String>, String> {
    match manager
        .rollback_transaction(&connection_id, &transaction_id)
        .await
    {
        Ok(_) => Ok(Response::ok("Transaction rolled back".to_string())),
        Err(error) => Ok(Response::err(
            "ROLLBACK_TRANSACTION_ERROR",
            &error.to_string(),
        )),
    }
}
