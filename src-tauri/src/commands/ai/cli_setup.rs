use super::{
    cli_environment, cli_operation_error_code, setup, AppHandle, CliAuthenticationLaunchResult,
    CliInstallationLaunchResult, CliProviderConfig, CliProviderKind, Response,
};

#[tauri::command]
pub async fn ai_cli_install_provider(
    app: AppHandle,
    provider: CliProviderKind,
) -> Result<Response<CliInstallationLaunchResult>, String> {
    match setup::begin_installation(&app, provider).await {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_INSTALL_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
    }
}

#[tauri::command]
pub async fn ai_cli_installation_status(
    session_id: String,
) -> Result<Response<crate::ai_cli::CliInstallationStatus>, String> {
    match setup::installation_status(&session_id).await {
        Ok(status) => Ok(Response::ok(status)),
        Err(error) => Ok(Response::err(
            "AI_CLI_INSTALL_STATUS_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_cli_begin_authentication(
    app: AppHandle,
    config: CliProviderConfig,
    method_id: Option<String>,
) -> Result<Response<CliAuthenticationLaunchResult>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    match setup::begin_authentication(&app, &config, &environment, method_id.as_deref()).await {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_AUTH_LAUNCH_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
    }
}

#[tauri::command]
pub async fn ai_cli_list_authentication_methods(
    app: AppHandle,
    config: CliProviderConfig,
) -> Result<Response<Vec<crate::ai_cli::CliAuthenticationMethod>>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    match setup::authentication_methods(&config, &environment).await {
        Ok(methods) => Ok(Response::ok(methods)),
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_AUTH_METHODS_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
    }
}

#[tauri::command]
pub async fn ai_cli_authentication_status(
    session_id: String,
) -> Result<Response<crate::ai_cli::CliAuthenticationStatus>, String> {
    match setup::authentication_status(&session_id).await {
        Ok(status) => Ok(Response::ok(status)),
        Err(error) => Ok(Response::err(
            "AI_CLI_AUTH_STATUS_ERROR",
            &error.to_string(),
        )),
    }
}

#[tauri::command]
pub async fn ai_cli_cancel_authentication(
    session_id: String,
) -> Result<Response<crate::ai_cli::CliAuthenticationStatus>, String> {
    match setup::cancel_authentication(&session_id).await {
        Ok(status) => Ok(Response::ok(status)),
        Err(error) => Ok(Response::err(
            "AI_CLI_AUTH_CANCEL_ERROR",
            &error.to_string(),
        )),
    }
}
