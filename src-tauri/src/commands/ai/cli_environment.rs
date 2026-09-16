use super::{
    load_cli_environment, save_cli_environment, AppHandle, CliEnvironmentRequest,
    CliEnvironmentSaveResult, CliProfileRequest, CliProviderKind, Response,
};

pub(super) async fn cli_environment(
    app: &AppHandle,
    provider: CliProviderKind,
    profile_id: &str,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    load_cli_environment(app, provider.as_str(), profile_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn ai_cli_set_environment(
    app: AppHandle,
    request: CliEnvironmentRequest,
) -> Result<Response<CliEnvironmentSaveResult>, String> {
    match save_cli_environment(
        &app,
        request.provider.as_str(),
        &request.profile_id,
        request.environment,
    )
    .await
    {
        Ok(keys) => Ok(Response::ok(CliEnvironmentSaveResult {
            keys,
            // Opaque cache invalidation only; never derive this from secrets.
            revision: uuid::Uuid::new_v4().to_string(),
        })),
        Err(error) => Ok(Response::err(
            "AI_CLI_ENVIRONMENT_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_cli_get_environment(
    app: AppHandle,
    request: CliProfileRequest,
) -> Result<Response<std::collections::BTreeMap<String, String>>, String> {
    match cli_environment(&app, request.provider, &request.profile_id).await {
        Ok(environment) => Ok(Response::ok(environment)),
        Err(error) => Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    }
}
