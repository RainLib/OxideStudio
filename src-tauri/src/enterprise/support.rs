use anyhow::{anyhow, Context, Result};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

pub(super) const ENTERPRISE_REFRESH_SERVICE: &str = "com.houshuai.oxide-studio.enterprise";
pub(super) const ENTERPRISE_REFRESH_ACCOUNT: &str = "active-session";
pub(super) const ENTERPRISE_SESSION_KEY_ACCOUNT: &str = "active-session-key-v2";
pub(super) const LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);
pub(super) const MAX_CALLBACK_BYTES: usize = 16 * 1024;
pub(super) const ENTERPRISE_CACHE_RETENTION_SECONDS: i64 = 7 * 24 * 60 * 60;
pub(super) const ENTERPRISE_CACHE_AAD: &[u8] = b"oxide-enterprise-cache-v1";
pub(super) const ENTERPRISE_SESSION_AAD: &[u8] = b"oxide-enterprise-session-v2";

pub(super) fn normalized_https_url(value: &str, label: &str) -> Result<String> {
    let mut url = Url::parse(value.trim()).with_context(|| format!("{label} URL is invalid"))?;
    let local_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if url.scheme() != "https" && !local_http {
        return Err(anyhow!("{label} must use HTTPS"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(anyhow!("{label} URL must not contain credentials"));
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

pub(super) fn normalize_optional_path(value: &mut Option<String>) {
    *value = value
        .take()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
}

pub(super) fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

pub(super) fn user_facing_enterprise_error(error: &anyhow::Error) -> String {
    let message = error.to_string();
    if message.contains("credential storage") {
        "Secure sign-in storage is unavailable on this device. Unlock the system credential store and try again.".into()
    } else if message.contains("identity provider") {
        format!("Enterprise sign-in could not be completed: {message}")
    } else if message.contains("control plane") || message.contains("synchronize") {
        "OxideStudio could not reach the enterprise service. Local projects remain available; check the network and try again.".into()
    } else {
        message
    }
}
