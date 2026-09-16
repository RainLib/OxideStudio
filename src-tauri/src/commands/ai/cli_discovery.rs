use super::{
    cli_capability_cache_now_ms, cli_environment, cli_operation_error_code, codebuddy, codex,
    load_cached_cli_capability, AppHandle, CliCommandInfo, CliConnectionTestResult,
    CliDetectionResult, CliModelInfo, CliProviderConfig, CliProviderKind, MetaStore, Response,
    State,
};

#[tauri::command]
pub async fn ai_cli_detect(
    app: AppHandle,
    config: CliProviderConfig,
) -> Result<Response<CliDetectionResult>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let result = match config.kind {
        CliProviderKind::CodexCli => {
            codex::detect(config.executable_path.as_deref(), &environment).await
        }
        CliProviderKind::CodebuddyCli => {
            codebuddy::detect(config.executable_path.as_deref(), &environment).await
        }
    };
    Ok(Response::ok(result))
}

#[tauri::command]
pub async fn ai_cli_list_models(
    app: AppHandle,
    meta_store: State<'_, MetaStore>,
    config: CliProviderConfig,
    runtime_version: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Response<Vec<CliModelInfo>>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let force_refresh = force_refresh.unwrap_or(false);
    let result = load_cached_cli_capability(
        &meta_store,
        &config,
        &environment,
        "models",
        runtime_version.as_deref(),
        force_refresh,
        cli_capability_cache_now_ms(),
        || async {
            match config.kind {
                CliProviderKind::CodexCli => {
                    codex::list_models_with_refresh(&config, &environment, force_refresh).await
                }
                CliProviderKind::CodebuddyCli => {
                    codebuddy::list_models_with_refresh(&config, &environment, force_refresh).await
                }
            }
        },
    )
    .await;
    match result {
        Ok(models) => Ok(Response::ok(models)),
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_MODEL_DISCOVERY_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
    }
}

#[tauri::command]
pub async fn ai_cli_list_efforts(
    app: AppHandle,
    meta_store: State<'_, MetaStore>,
    config: CliProviderConfig,
    runtime_version: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Response<Vec<String>>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let force_refresh = force_refresh.unwrap_or(false);
    let result = load_cached_cli_capability(
        &meta_store,
        &config,
        &environment,
        "efforts",
        runtime_version.as_deref(),
        force_refresh,
        cli_capability_cache_now_ms(),
        || async {
            match config.kind {
                CliProviderKind::CodexCli => {
                    codex::list_models_with_refresh(&config, &environment, force_refresh)
                        .await
                        .map(|models| model_efforts_for_selection(&models, &config.model))
                }
                CliProviderKind::CodebuddyCli => {
                    codebuddy::list_efforts_with_refresh(&config, &environment, force_refresh).await
                }
            }
        },
    )
    .await;
    match result {
        Ok(efforts) => Ok(Response::ok(efforts)),
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_EFFORT_DISCOVERY_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
    }
}

pub(super) fn model_efforts_for_selection(
    models: &[CliModelInfo],
    requested_model: &str,
) -> Vec<String> {
    models
        .iter()
        .find(|model| model.id == requested_model)
        .or_else(|| models.iter().find(|model| model.id == "default"))
        .map(|model| model.reasoning_efforts.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn ai_cli_list_commands(
    app: AppHandle,
    meta_store: State<'_, MetaStore>,
    config: CliProviderConfig,
    runtime_version: Option<String>,
    force_refresh: Option<bool>,
) -> Result<Response<Vec<CliCommandInfo>>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let force_refresh = force_refresh.unwrap_or(false);
    let result = load_cached_cli_capability(
        &meta_store,
        &config,
        &environment,
        "commands",
        runtime_version.as_deref(),
        force_refresh,
        cli_capability_cache_now_ms(),
        || async {
            match config.kind {
                CliProviderKind::CodexCli => Ok(codex::common_commands()),
                CliProviderKind::CodebuddyCli => {
                    codebuddy::list_commands_with_refresh(&config, &environment, force_refresh)
                        .await
                }
            }
        },
    )
    .await;
    match result {
        Ok(commands) => Ok(Response::ok(commands)),
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_COMMAND_DISCOVERY_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
    }
}

#[tauri::command]
pub async fn ai_cli_test_provider(
    app: AppHandle,
    config: CliProviderConfig,
) -> Result<Response<CliConnectionTestResult>, String> {
    let environment = match cli_environment(&app, config.kind, &config.profile_id).await {
        Ok(environment) => environment,
        Err(error) => return Ok(Response::err("AI_CLI_ENVIRONMENT_ERROR", &error)),
    };
    let result = match config.kind {
        CliProviderKind::CodexCli => codex::test_connection(&config, &environment).await,
        CliProviderKind::CodebuddyCli => codebuddy::test_connection(&config, &environment).await,
    };
    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => {
            let diagnostic = error.to_string();
            Ok(Response::err(
                cli_operation_error_code("AI_CLI_TEST_ERROR", &diagnostic),
                &diagnostic,
            ))
        }
    }
}
