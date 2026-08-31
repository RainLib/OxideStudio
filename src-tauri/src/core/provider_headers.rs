use crate::core::private_file::replace_private_file;
use anyhow::{anyhow, Context, Result};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

const MAX_PROVIDER_HEADER_BYTES: usize = 64 * 1024;
const MAX_PROVIDER_HEADER_ENTRIES: usize = 64;
const RESERVED_PROVIDER_HEADERS: &[&str] = &[
    "host",
    "content-length",
    "content-type",
    "connection",
    "transfer-encoding",
    "proxy-authorization",
];
static PROVIDER_HEADER_IO_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Values are credentials in practice (gateway tokens, tenant secrets). Keep
/// them in the Rust-owned private credential directory and only return them to
/// the settings editor on an explicit read.
pub async fn save_provider_headers(
    app: &AppHandle,
    scope: &str,
    base_url: &str,
    headers: BTreeMap<String, String>,
) -> Result<Vec<String>> {
    let path = provider_header_path(app, scope, base_url)?;
    let headers = normalize_provider_headers(headers)?;
    let names = headers.keys().cloned().collect::<Vec<_>>();
    tokio::task::spawn_blocking(move || {
        let _guard = io_lock()?;
        if headers.is_empty() {
            match fs::remove_file(&path) {
                Ok(()) => return Ok(names),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(names),
                Err(error) => return Err(anyhow!("failed to delete AI provider headers: {error}")),
            }
        }
        let mut payload =
            serde_json::to_vec(&headers).context("failed to serialize AI provider headers")?;
        if payload.len() > MAX_PROVIDER_HEADER_BYTES {
            payload.zeroize();
            return Err(anyhow!("AI provider headers exceed the 64 KiB limit"));
        }
        let result = replace_private_file(&path, &payload, "ai-provider-headers");
        payload.zeroize();
        result?;
        Ok(names)
    })
    .await
    .context("AI provider header credential task failed")?
}

pub async fn load_provider_headers(
    app: &AppHandle,
    scope: &str,
    base_url: &str,
) -> Result<BTreeMap<String, String>> {
    let path = provider_header_path(app, scope, base_url)?;
    tokio::task::spawn_blocking(move || {
        let _guard = io_lock()?;
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new())
            }
            Err(error) => return Err(anyhow!("failed to inspect AI provider headers: {error}")),
        };
        if metadata.len() > MAX_PROVIDER_HEADER_BYTES as u64 {
            return Err(anyhow!("AI provider header file is unexpectedly large"));
        }
        let mut payload = match fs::read(&path) {
            Ok(payload) => payload,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new())
            }
            Err(error) => return Err(anyhow!("failed to read AI provider headers: {error}")),
        };
        let parsed = serde_json::from_slice::<BTreeMap<String, String>>(&payload)
            .context("stored AI provider headers are invalid");
        payload.zeroize();
        normalize_provider_headers(parsed?)
    })
    .await
    .context("AI provider header credential task failed")?
}

pub fn provider_header_map(headers: &BTreeMap<String, String>) -> Result<HeaderMap> {
    let normalized = normalize_provider_headers(headers.clone())?;
    let mut result = HeaderMap::with_capacity(normalized.len());
    for (name, value) in normalized {
        let name = HeaderName::from_bytes(name.as_bytes())
            .context("AI provider header name became invalid")?;
        let value =
            HeaderValue::from_str(&value).context("AI provider header value became invalid")?;
        result.insert(name, value);
    }
    Ok(result)
}

pub fn normalize_provider_headers(
    headers: BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>> {
    if headers.len() > MAX_PROVIDER_HEADER_ENTRIES {
        return Err(anyhow!(
            "AI provider headers exceed {MAX_PROVIDER_HEADER_ENTRIES} entries"
        ));
    }
    let mut normalized = BTreeMap::new();
    let mut seen = HashSet::new();
    let mut encoded_bytes = 0usize;
    for (raw_name, value) in headers {
        let name = raw_name.trim();
        let parsed_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| anyhow!("AI provider header name is invalid: {raw_name}"))?;
        let canonical = parsed_name.as_str().to_ascii_lowercase();
        if RESERVED_PROVIDER_HEADERS.contains(&canonical.as_str()) {
            return Err(anyhow!(
                "AI provider header is reserved by OxideStudio: {name}"
            ));
        }
        if !seen.insert(canonical) {
            return Err(anyhow!("AI provider header name is duplicated: {name}"));
        }
        HeaderValue::from_str(&value)
            .map_err(|_| anyhow!("AI provider header value is invalid: {name}"))?;
        encoded_bytes = encoded_bytes
            .saturating_add(name.len())
            .saturating_add(value.len());
        if encoded_bytes > MAX_PROVIDER_HEADER_BYTES {
            return Err(anyhow!("AI provider headers exceed the 64 KiB limit"));
        }
        normalized.insert(name.to_string(), value);
    }
    Ok(normalized)
}

fn provider_header_path(app: &AppHandle, scope: &str, base_url: &str) -> Result<PathBuf> {
    let scope = normalized_scope(scope)?;
    let base_url = normalized_provider_url(base_url)?;
    let digest = Sha256::digest(format!("{scope}:{base_url}").as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(app
        .path()
        .app_config_dir()
        .context("failed to resolve the application configuration directory")?
        .join("credentials")
        .join(format!("ai-provider-headers-{scope}-{digest}.json")))
}

fn normalized_scope(scope: &str) -> Result<&'static str> {
    match scope.trim() {
        "assistant" => Ok("assistant"),
        "inline" => Ok("inline"),
        _ => Err(anyhow!("unsupported AI provider header scope")),
    }
}

fn normalized_provider_url(base_url: &str) -> Result<&str> {
    let normalized = base_url.trim().trim_end_matches('/');
    if normalized.is_empty() {
        return Err(anyhow!("AI provider base URL is required"));
    }
    let parsed = url::Url::parse(normalized).context("AI provider base URL is invalid")?;
    if parsed.username() != "" || parsed.password().is_some() {
        return Err(anyhow!("AI provider URL must not contain credentials"));
    }
    Ok(normalized)
}

fn io_lock() -> Result<std::sync::MutexGuard<'static, ()>> {
    PROVIDER_HEADER_IO_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| anyhow!("AI provider header file lock is poisoned"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_gateway_headers_and_protects_http_framing() {
        let valid = BTreeMap::from([
            (
                "Authorization".to_string(),
                "Bearer gateway-token".to_string(),
            ),
            ("X-Tenant".to_string(), "oxide".to_string()),
        ]);
        let map = provider_header_map(&valid).unwrap();
        assert_eq!(map.get("authorization").unwrap(), "Bearer gateway-token");
        assert_eq!(map.get("x-tenant").unwrap(), "oxide");
        let request = reqwest::Client::new()
            .post("https://example.test/v1/chat/completions")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::AUTHORIZATION, "Bearer provider-key")
            .headers(map)
            .build()
            .unwrap();
        assert_eq!(
            request
                .headers()
                .get(reqwest::header::AUTHORIZATION)
                .unwrap(),
            "Bearer gateway-token"
        );
        assert_eq!(
            request
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .unwrap(),
            "application/json"
        );

        for name in [
            "Content-Type",
            "Content-Length",
            "Host",
            "Proxy-Authorization",
        ] {
            assert!(normalize_provider_headers(BTreeMap::from([(
                name.to_string(),
                "value".to_string(),
            )]))
            .unwrap_err()
            .to_string()
            .contains("reserved"));
        }
        assert!(normalize_provider_headers(BTreeMap::from([
            ("X-Tenant".to_string(), "one".to_string()),
            ("x-tenant".to_string(), "two".to_string()),
        ]))
        .unwrap_err()
        .to_string()
        .contains("duplicated"));
        assert!(normalize_provider_headers(BTreeMap::from([(
            "bad header".to_string(),
            "value".to_string(),
        )]))
        .is_err());
        assert!(normalize_provider_headers(BTreeMap::from([(
            "X-Test".to_string(),
            "bad\r\nvalue".to_string(),
        )]))
        .is_err());
    }

    #[test]
    fn scope_and_destination_participate_in_the_credential_identity() {
        assert_eq!(normalized_scope("assistant").unwrap(), "assistant");
        assert_eq!(normalized_scope("inline").unwrap(), "inline");
        assert!(normalized_scope("agent").is_err());
        assert!(normalized_provider_url("https://secret@example.test/v1").is_err());
    }
}
