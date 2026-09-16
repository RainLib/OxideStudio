use crate::core::{manager::ConnectionManager, protocol::Response};

pub(super) fn validate_scope(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 255 || value.contains('\0') {
        return Err(format!("Invalid MongoDB {label}"));
    }
    Ok(value.to_string())
}

pub(super) async fn confirm_bundled_mongodb(
    manager: &ConnectionManager,
    connection_id: &str,
    requested_driver: &str,
) -> Result<Option<String>, String> {
    if manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Err(
            "External drivers do not provide a verified native document mutation protocol"
                .to_string(),
        );
    }
    if !requested_driver.trim().eq_ignore_ascii_case("mongodb") {
        return Err("Reviewed document mutations are currently available for MongoDB".to_string());
    }
    let connected_driver = manager
        .connection_driver_id(connection_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The active connection identity is unavailable".to_string())?;
    if !connected_driver.trim().eq_ignore_ascii_case("mongodb") {
        return Err(
            "Requested document driver does not match the active connection identity".to_string(),
        );
    }
    manager
        .server_version(connection_id)
        .await
        .map_err(|error| error.to_string())
}

pub(super) async fn confirm_bundled_elasticsearch(
    manager: &ConnectionManager,
    connection_id: &str,
    requested_driver: &str,
) -> Result<Option<String>, String> {
    if manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Err(
            "External drivers do not provide the reviewed Elasticsearch index-management protocol"
                .to_string(),
        );
    }
    if !requested_driver
        .trim()
        .eq_ignore_ascii_case("elasticsearch")
    {
        return Err("Index management is currently available for Elasticsearch".to_string());
    }
    let connected_driver = manager
        .connection_driver_id(connection_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The active connection identity is unavailable".to_string())?;
    if !connected_driver
        .trim()
        .eq_ignore_ascii_case("elasticsearch")
    {
        return Err(
            "Requested search driver does not match the active connection identity".to_string(),
        );
    }
    manager
        .server_version(connection_id)
        .await
        .map_err(|error| error.to_string())
}

pub(super) fn document_error<T>(code: &str, error: &str) -> Response<T> {
    let retryable = ["connection", "timed out", "temporarily unavailable"]
        .iter()
        .any(|pattern| error.to_ascii_lowercase().contains(pattern));
    Response::err_with_details(code, error, retryable, None)
}
