use super::authentication_process::{open_authentication_url, start_codebuddy_acp};
use super::authentication_protocol::{read_rpc_result, write_rpc};
use super::authentication_state::update_authentication;
use super::authentication_verification::{
    verify_authenticated_provider, AUTHENTICATION_INITIALIZE_TIMEOUT, AUTHENTICATION_TIMEOUT,
};
use crate::ai_cli::runtime::resolve_command;
use crate::ai_cli::{CliAuthenticationMethod, CliAuthenticationPhase, CliProviderConfig};
use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tauri::AppHandle;
use tokio::sync::watch;

pub(super) async fn codebuddy_authentication_methods(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
) -> Result<Vec<CliAuthenticationMethod>> {
    let command = resolve_command(config.kind, config.executable_path.as_deref()).await?;
    let (_cwd, mut child, mut stdin, mut lines) =
        start_codebuddy_acp(&command, environment).await?;
    write_rpc(&mut stdin, 1, "initialize", codebuddy_initialize_params()).await?;
    let initialized = tokio::time::timeout(
        AUTHENTICATION_INITIALIZE_TIMEOUT,
        read_rpc_result(&mut lines, 1),
    )
    .await
    .map_err(|_| anyhow!("CodeBuddy authentication discovery timed out"))??;
    let _ = child.kill().await;
    let mut methods = parse_authentication_methods(&initialized);
    methods.sort_by_key(|method| match method.id.as_str() {
        "external" => 0,
        "internal" => 1,
        "iOA" => 2,
        "selfhosted" => 3,
        _ => 4,
    });
    if methods.is_empty() {
        return Err(anyhow!(
            "CodeBuddy did not advertise any supported authentication methods"
        ));
    }
    Ok(methods)
}

pub(super) async fn run_codebuddy_authentication(
    app: &AppHandle,
    session_id: &str,
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    method_id: &str,
    mut cancellation: watch::Receiver<bool>,
) -> Result<()> {
    let command = resolve_command(config.kind, config.executable_path.as_deref()).await?;
    let (_cwd, mut child, mut stdin, mut lines) =
        start_codebuddy_acp(&command, environment).await?;
    write_rpc(&mut stdin, 1, "initialize", codebuddy_initialize_params()).await?;
    let initialized = tokio::time::timeout(
        AUTHENTICATION_INITIALIZE_TIMEOUT,
        read_rpc_result(&mut lines, 1),
    )
    .await
    .map_err(|_| anyhow!("CodeBuddy authentication initialization timed out"))??;
    let methods = parse_authentication_methods(&initialized);
    if !methods.iter().any(|method| method.id == method_id) {
        let _ = child.kill().await;
        return Err(anyhow!(
            "CodeBuddy does not support authentication method `{method_id}`"
        ));
    }

    // A genuine account response is authoritative. Avoid CodeBuddy's forced
    // re-authentication behavior when the CLI is already signed in.
    write_rpc(&mut stdin, 2, "_codebuddy.ai/getUserInfo", json!({})).await?;
    let user_info = tokio::time::timeout(
        AUTHENTICATION_INITIALIZE_TIMEOUT,
        read_rpc_result(&mut lines, 2),
    )
    .await
    .map_err(|_| anyhow!("CodeBuddy account lookup timed out"))??;
    if has_codebuddy_user(&user_info) {
        update_authentication(
            session_id,
            CliAuthenticationPhase::Verifying,
            "Existing CodeBuddy account found. Verifying the provider session...",
        )
        .await;
        let _ = child.kill().await;
        verify_authenticated_provider(config, environment, session_id, &mut cancellation).await?;
        update_authentication(
            session_id,
            CliAuthenticationPhase::Succeeded,
            "CodeBuddy is signed in and ready in OxideStudio.",
        )
        .await;
        return Ok(());
    }

    update_authentication(
        session_id,
        CliAuthenticationPhase::WaitingForBrowser,
        "Preparing the CodeBuddy browser sign-in...",
    )
    .await;
    write_rpc(
        &mut stdin,
        3,
        "authenticate",
        json!({ "methodId": method_id }),
    )
    .await?;

    let deadline = tokio::time::sleep(AUTHENTICATION_TIMEOUT);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            changed = cancellation.changed() => {
                if changed.is_err() || *cancellation.borrow() {
                    let _ = child.kill().await;
                    return Err(anyhow!("authentication cancelled"));
                }
            }
            _ = &mut deadline => {
                let _ = child.kill().await;
                update_authentication(
                    session_id,
                    CliAuthenticationPhase::Expired,
                    "CodeBuddy sign-in expired. Start a new sign-in attempt.",
                ).await;
                return Ok(());
            }
            next = lines.next_line() => {
                let Some(line) = next.context("failed to read CodeBuddy authentication response")? else {
                    return Err(anyhow!("CodeBuddy closed before browser sign-in completed"));
                };
                let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
                    continue;
                };
                if value.get("method").and_then(Value::as_str) == Some("_codebuddy.ai/authUrl") {
                    let auth_url = value
                        .get("params")
                        .and_then(|params| params.get("authUrl"))
                        .and_then(Value::as_str)
                        .ok_or_else(|| anyhow!("CodeBuddy returned an invalid browser sign-in response"))?;
                    let browser_opened = open_authentication_url(app, session_id, auth_url).await?;
                    update_authentication(
                        session_id,
                        CliAuthenticationPhase::WaitingForCallback,
                        if browser_opened {
                            "Complete sign-in in your browser. OxideStudio is waiting for CodeBuddy to confirm the account..."
                        } else {
                            "The browser did not open automatically. Open or copy the sign-in link in OxideStudio to continue."
                        },
                    ).await;
                    continue;
                }
                if value.get("id").and_then(Value::as_u64) != Some(3) {
                    continue;
                }
                if let Some(error) = value.get("error") {
                    return Err(anyhow!("CodeBuddy authentication failed: {error}"));
                }
                update_authentication(
                    session_id,
                    CliAuthenticationPhase::Verifying,
                    "CodeBuddy confirmed the account. Verifying the provider session...",
                ).await;
                let _ = child.kill().await;
                verify_authenticated_provider(config, environment, session_id, &mut cancellation).await?;
                update_authentication(
                    session_id,
                    CliAuthenticationPhase::Succeeded,
                    "CodeBuddy is signed in and ready in OxideStudio.",
                ).await;
                return Ok(());
            }
        }
    }
}

pub(super) fn codebuddy_initialize_params() -> Value {
    json!({
        "protocolVersion": 1,
        "clientCapabilities": {
            "fs": { "readTextFile": false, "writeTextFile": false },
            "terminal": false,
            "auth": { "terminal": false }
        },
        "clientInfo": {
            "name": "OxideStudio",
            "version": env!("CARGO_PKG_VERSION")
        }
    })
}

pub(super) fn parse_authentication_methods(value: &Value) -> Vec<CliAuthenticationMethod> {
    value
        .get("authMethods")
        .or_else(|| value.get("auth_methods"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|method| {
            let id = method.get("id")?.as_str()?.trim();
            let name = method.get("name")?.as_str()?.trim();
            if id.is_empty() || name.is_empty() {
                return None;
            }
            Some(CliAuthenticationMethod {
                id: id.to_string(),
                name: name.to_string(),
                description: method
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .or_else(|| authentication_method_description(id).map(str::to_string)),
            })
        })
        .collect()
}

pub(super) fn authentication_method_description(id: &str) -> Option<&'static str> {
    match id {
        "external" => Some("Continue with Google or GitHub in your browser."),
        "internal" => Some("Continue with WeChat in your browser."),
        "iOA" => Some("Continue with your organization iOA account."),
        "selfhosted" => Some("Continue with an enterprise domain account."),
        _ => None,
    }
}

pub(super) fn has_codebuddy_user(value: &Value) -> bool {
    value
        .get("userInfo")
        .or_else(|| value.get("user_info"))
        .is_some_and(|user| user.is_object() && !user.as_object().is_some_and(|map| map.is_empty()))
}
