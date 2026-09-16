use super::{
    has_scoped_provider_secret, load_provider_headers, save_provider_headers,
    save_scoped_provider_secret, AiProviderHeadersRequest, AiProviderSecretRequest, AppHandle,
    BTreeMap, Response,
};

#[tauri::command]
pub async fn ai_set_provider_secret(
    app: AppHandle,
    request: AiProviderSecretRequest,
) -> Result<Response<bool>, String> {
    match save_scoped_provider_secret(&app, &request.scope, &request.base_url, request.api_key)
        .await
    {
        Ok(saved) => Ok(Response::ok(saved)),
        Err(error) => Ok(Response::err(
            "AI_PROVIDER_SECRET_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_has_provider_secret(
    app: AppHandle,
    base_url: String,
    scope: Option<String>,
) -> Result<Response<bool>, String> {
    let scope = scope.as_deref().unwrap_or("assistant");
    match has_scoped_provider_secret(&app, scope, &base_url).await {
        Ok(available) => Ok(Response::ok(available)),
        Err(error) => Ok(Response::err(
            "AI_PROVIDER_SECRET_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_set_provider_headers(
    app: AppHandle,
    request: AiProviderHeadersRequest,
) -> Result<Response<Vec<String>>, String> {
    match save_provider_headers(&app, &request.scope, &request.base_url, request.headers).await {
        Ok(names) => Ok(Response::ok(names)),
        Err(error) => Ok(Response::err(
            "AI_PROVIDER_HEADERS_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_get_provider_headers(
    app: AppHandle,
    base_url: String,
    scope: String,
) -> Result<Response<BTreeMap<String, String>>, String> {
    match load_provider_headers(&app, &scope, &base_url).await {
        Ok(headers) => Ok(Response::ok(headers)),
        Err(error) => Ok(Response::err(
            "AI_PROVIDER_HEADERS_ERROR",
            &error.to_string(),
        )),
    }
}

pub(super) fn default_provider_scope() -> String {
    "assistant".to_string()
}
