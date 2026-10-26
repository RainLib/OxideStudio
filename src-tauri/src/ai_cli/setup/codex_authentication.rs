use super::authentication_process::{open_authentication_url, start_codex_app_server};
use super::authentication_protocol::{read_rpc_result, write_codex_rpc, write_notification};
use super::authentication_state::update_authentication;
use super::authentication_verification::{
    verify_authenticated_provider, AUTHENTICATION_INITIALIZE_TIMEOUT, AUTHENTICATION_TIMEOUT,
};
use crate::ai_cli::runtime::resolve_command;
use crate::ai_cli::{codex, CliAuthenticationPhase, CliProviderConfig};
use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tauri::AppHandle;
use tokio::sync::watch;

pub(super) async fn run_codex_authentication(
    app: &AppHandle,
    session_id: &str,
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    mut cancellation: watch::Receiver<bool>,
) -> Result<()> {
    if codex::test_connection(config, environment).await.is_ok() {
        update_authentication(
            session_id,
            CliAuthenticationPhase::Succeeded,
            "Codex is already signed in and ready in OxideStudio.",
        )
        .await;
        return Ok(());
    }
    let command = resolve_command(config.kind, config.executable_path.as_deref()).await?;
    let (_cwd, mut child, mut stdin, mut lines) =
        start_codex_app_server(&command, environment).await?;
    write_codex_rpc(
        &mut stdin,
        1,
        "initialize",
        json!({
            "clientInfo": {
                "name": "oxide-studio",
                "title": "OxideStudio",
                "version": env!("CARGO_PKG_VERSION")
            }
        }),
    )
    .await?;
    tokio::time::timeout(
        AUTHENTICATION_INITIALIZE_TIMEOUT,
        read_rpc_result(&mut lines, 1),
    )
    .await
    .map_err(|_| anyhow!("Codex authentication initialization timed out"))??;
    write_notification(&mut stdin, "initialized", None).await?;
    update_authentication(
        session_id,
        CliAuthenticationPhase::WaitingForBrowser,
        "Preparing the secure Codex browser sign-in...",
    )
    .await;
    write_codex_rpc(
        &mut stdin,
        2,
        "account/login/start",
        json!({
            "type": "chatgpt",
            "useHostedLoginSuccessPage": true,
            "appBrand": "codex"
        }),
    )
    .await?;
    let login = tokio::time::timeout(
        AUTHENTICATION_INITIALIZE_TIMEOUT,
        read_rpc_result(&mut lines, 2),
    )
    .await
    .map_err(|_| anyhow!("Codex browser sign-in did not start in time"))??;
    let login_id = login
        .get("loginId")
        .or_else(|| login.get("login_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("Codex did not return a login session id"))?
        .to_string();
    let auth_url = login
        .get("authUrl")
        .or_else(|| login.get("auth_url"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Codex did not return a browser sign-in URL"))?;
    let browser_opened = open_authentication_url(app, session_id, auth_url).await?;
    update_authentication(
        session_id,
        CliAuthenticationPhase::WaitingForCallback,
        if browser_opened {
            "Complete sign-in in your browser. OxideStudio is waiting for Codex to confirm the account..."
        } else {
            "The browser did not open automatically. Open or copy the sign-in link in OxideStudio to continue."
        },
    )
    .await;
    let deadline = tokio::time::sleep(AUTHENTICATION_TIMEOUT);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            changed = cancellation.changed() => {
                if changed.is_err() || *cancellation.borrow() {
                    let _ = write_codex_rpc(
                        &mut stdin,
                        3,
                        "account/login/cancel",
                        json!({ "loginId": login_id }),
                    ).await;
                    let _ = child.kill().await;
                    return Err(anyhow!("authentication cancelled"));
                }
            }
            _ = &mut deadline => {
                let _ = write_codex_rpc(
                    &mut stdin,
                    3,
                    "account/login/cancel",
                    json!({ "loginId": login_id }),
                ).await;
                let _ = child.kill().await;
                update_authentication(
                    session_id,
                    CliAuthenticationPhase::Expired,
                    "Codex sign-in expired. Start a new sign-in attempt.",
                ).await;
                return Ok(());
            }
            next = lines.next_line() => {
                let Some(line) = next.context("failed to read Codex authentication response")? else {
                    return Err(anyhow!("Codex closed before browser sign-in completed"));
                };
                let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
                    continue;
                };
                if value.get("method").and_then(Value::as_str) != Some("account/login/completed") {
                    continue;
                }
                let params = value.get("params").unwrap_or(&Value::Null);
                let completed_login_id = params
                    .get("loginId")
                    .or_else(|| params.get("login_id"))
                    .and_then(Value::as_str);
                if completed_login_id.is_some_and(|completed| completed != login_id) {
                    continue;
                }
                let success = params.get("success").and_then(Value::as_bool).unwrap_or(false);
                if !success {
                    let detail = params
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Codex did not authorize this account");
                    let _ = child.kill().await;
                    return Err(anyhow!("Codex browser sign-in failed: {detail}"));
                }
                break;
            }
        }
    }
    let _ = child.kill().await;
    update_authentication(
        session_id,
        CliAuthenticationPhase::Verifying,
        "Codex confirmed the account. Verifying the provider session...",
    )
    .await;
    verify_authenticated_provider(config, environment, session_id, &mut cancellation).await?;
    update_authentication(
        session_id,
        CliAuthenticationPhase::Succeeded,
        "Codex is signed in and ready in OxideStudio.",
    )
    .await;
    Ok(())
}
