use super::authentication_state::update_authentication;
use crate::ai_cli::{codebuddy, codex, CliAuthenticationPhase, CliProviderConfig, CliProviderKind};
use anyhow::{anyhow, Result};
use std::collections::BTreeMap;
use std::time::Duration;
use tokio::sync::watch;

pub(super) const AUTHENTICATION_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub(super) const AUTHENTICATION_INITIALIZE_TIMEOUT: Duration = Duration::from_secs(30);

// OAuth callbacks may reach the browser before a CLI persists its refreshed
// credential. Keep verification bounded, but do not report a false failed
// sign-in just because the first account probe races that persistence.
pub(super) const AUTHENTICATION_VERIFICATION_TIMEOUT: Duration = Duration::from_secs(18);

pub(super) const AUTHENTICATION_VERIFICATION_RETRY: Duration = Duration::from_millis(900);

pub(super) async fn verify_authenticated_provider(
    config: &CliProviderConfig,
    environment: &BTreeMap<String, String>,
    session_id: &str,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<()> {
    update_authentication(
        session_id,
        CliAuthenticationPhase::Verifying,
        "Confirming the provider session in OxideStudio...",
    )
    .await;
    let deadline = tokio::time::Instant::now() + AUTHENTICATION_VERIFICATION_TIMEOUT;

    loop {
        let result = match config.kind {
            CliProviderKind::CodexCli => codex::test_connection(config, environment).await,
            CliProviderKind::CodebuddyCli => codebuddy::test_connection(config, environment).await,
        };
        let pending_error = match result {
            Ok(_) => return Ok(()),
            Err(error) if authentication_verification_may_be_pending(&error.to_string()) => error,
            Err(error) => return Err(error),
        };

        let now = tokio::time::Instant::now();
        if now >= deadline {
            return Err(anyhow!(
                "provider sign-in completed but the CLI session did not become ready in time: {pending_error}"
            ));
        }
        update_authentication(
            session_id,
            CliAuthenticationPhase::Verifying,
            "Sign-in completed. Waiting for the CLI to finish saving the account...",
        )
        .await;
        tokio::select! {
            changed = cancellation.changed() => {
                if changed.is_err() || *cancellation.borrow() {
                    return Err(anyhow!("authentication cancelled"));
                }
            }
            _ = tokio::time::sleep((deadline - now).min(AUTHENTICATION_VERIFICATION_RETRY)) => {}
        }
    }
}

pub(super) fn authentication_verification_may_be_pending(error: &str) -> bool {
    let value = error.to_ascii_lowercase();
    [
        "not authenticated",
        "not logged in",
        "login required",
        "sign in",
        "account access",
        "authorization pending",
        "credential is still",
        "credentials are still",
        "token is still",
        "token not found",
    ]
    .iter()
    .any(|needle| value.contains(needle))
}
