use super::authentication_state::{
    finish_authentication_error, ManagedAuthenticationSession, AUTHENTICATION_SESSIONS,
};
use super::codebuddy_authentication::{
    codebuddy_authentication_methods, run_codebuddy_authentication,
};
use super::codex_authentication::run_codex_authentication;
use crate::ai_cli::runtime::resolve_command;
use crate::ai_cli::{
    CliAuthenticationLaunchResult, CliAuthenticationMethod, CliAuthenticationPhase,
    CliAuthenticationStatus, CliProviderConfig, CliProviderKind,
};
use anyhow::Result;
use std::collections::BTreeMap;
use tauri::AppHandle;
use tokio::sync::watch;

pub async fn begin_authentication(
    app: &AppHandle,
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    method_id: Option<&str>,
) -> Result<CliAuthenticationLaunchResult> {
    resolve_command(config.kind, config.executable_path.as_deref()).await?;
    let method_id = match config.kind {
        CliProviderKind::CodexCli => Some("browser".to_string()),
        CliProviderKind::CodebuddyCli => Some(
            method_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("external")
                .to_string(),
        ),
    };
    let session_id = uuid::Uuid::new_v4().to_string();
    let (cancellation, receiver) = watch::channel(false);
    {
        let mut sessions = AUTHENTICATION_SESSIONS.lock().await;
        if sessions.len() >= 128 {
            sessions.retain(|_, session| !session.status.phase.is_terminal());
        }
        for session in sessions.values_mut().filter(|session| {
            session.status.provider == config.kind
                && session.profile_id == config.profile_id
                && !session.status.phase.is_terminal()
        }) {
            let _ = session.cancellation.send(true);
            session.status.phase = CliAuthenticationPhase::Cancelled;
            session.status.browser_url = None;
            session.status.message = "A newer sign-in attempt replaced this one.".to_string();
        }
        sessions.insert(
            session_id.clone(),
            ManagedAuthenticationSession {
                profile_id: config.profile_id.clone(),
                status: CliAuthenticationStatus {
                    session_id: session_id.clone(),
                    provider: config.kind,
                    phase: CliAuthenticationPhase::Starting,
                    message: format!("Starting {} secure sign-in...", config.kind.display_name()),
                    method_id: method_id.clone(),
                    browser_url: None,
                },
                cancellation,
            },
        );
    }

    let task_app = app.clone();
    let task_config = config.clone();
    let task_environment = environment.clone();
    let task_session_id = session_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = match task_config.kind {
            CliProviderKind::CodexCli => {
                run_codex_authentication(
                    &task_app,
                    &task_session_id,
                    &task_config,
                    &task_environment,
                    receiver,
                )
                .await
            }
            CliProviderKind::CodebuddyCli => {
                run_codebuddy_authentication(
                    &task_app,
                    &task_session_id,
                    &task_config,
                    &task_environment,
                    method_id.as_deref().unwrap_or("internal"),
                    receiver,
                )
                .await
            }
        };
        if let Err(error) = result {
            finish_authentication_error(&task_session_id, &error.to_string()).await;
        }
    });

    Ok(CliAuthenticationLaunchResult {
        provider: config.kind,
        session_id,
        message: format!(
            "{} sign-in is starting. OxideStudio will open the provider login in your browser and confirm the returned account automatically.",
            config.kind.display_name()
        ),
    })
}

pub async fn authentication_methods(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<CliAuthenticationMethod>> {
    match config.kind {
        CliProviderKind::CodexCli => Ok(vec![CliAuthenticationMethod {
            id: "browser".to_string(),
            name: "ChatGPT / Codex account".to_string(),
            description: Some("Continue with the secure Codex browser sign-in.".to_string()),
        }]),
        CliProviderKind::CodebuddyCli => {
            codebuddy_authentication_methods(config, environment).await
        }
    }
}
