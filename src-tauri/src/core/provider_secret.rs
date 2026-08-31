use crate::core::private_file::replace_private_file;
use anyhow::{anyhow, Context, Result};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

static PROVIDER_SECRET_IO_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
const MAX_PROVIDER_SECRET_BYTES: usize = 64 * 1024;

/// Load an AI provider credential from OxideStudio's per-user configuration
/// directory. Provider credentials intentionally do not live in a project,
/// frontend storage, or the Agent sidecar environment.
pub async fn load_provider_secret(app: &AppHandle, base_url: &str) -> Result<Option<String>> {
    load_scoped_provider_secret(app, "assistant", base_url).await
}

pub async fn load_scoped_provider_secret(
    app: &AppHandle,
    scope: &str,
    base_url: &str,
) -> Result<Option<String>> {
    let path = scoped_provider_secret_path(app, scope, base_url)?;
    let legacy_path = provider_secret_path(app, base_url)?;
    tokio::task::spawn_blocking(move || {
        let _guard = provider_secret_io_lock()?;
        let path = match fs::metadata(&path) {
            Ok(_) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => legacy_path,
            Err(error) => {
                return Err(anyhow!(
                    "failed to inspect the provider credential file: {error}"
                ))
            }
        };
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(anyhow!(
                    "failed to inspect the provider credential file: {error}"
                ))
            }
        };
        if metadata.len() > MAX_PROVIDER_SECRET_BYTES as u64 {
            return Err(anyhow!("provider credential file is unexpectedly large"));
        }
        let mut secret = match fs::read_to_string(&path) {
            Ok(secret) => secret,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(anyhow!(
                    "failed to read the provider credential file: {error}"
                ))
            }
        };
        let normalized = normalize_provider_secret(&secret);
        secret.zeroize();
        if normalized.is_empty() {
            Ok(None)
        } else {
            Ok(Some(normalized))
        }
    })
    .await
    .context("provider credential task failed")?
}

pub async fn save_provider_secret(
    app: &AppHandle,
    base_url: &str,
    secret: Option<String>,
) -> Result<bool> {
    save_scoped_provider_secret(app, "assistant", base_url, secret).await
}

pub async fn save_scoped_provider_secret(
    app: &AppHandle,
    scope: &str,
    base_url: &str,
    secret: Option<String>,
) -> Result<bool> {
    let path = scoped_provider_secret_path(app, scope, base_url)?;
    tokio::task::spawn_blocking(move || {
        let _guard = provider_secret_io_lock()?;
        let mut secret = secret.unwrap_or_default();
        let mut normalized = normalize_provider_secret(&secret);
        if normalized.len() > MAX_PROVIDER_SECRET_BYTES {
            secret.zeroize();
            normalized.zeroize();
            return Err(anyhow!("provider credential is unexpectedly large"));
        }
        let result = if normalized.is_empty() {
            // Keep a private empty marker. A legacy URL-only credential may
            // still exist from pre-scope versions; deleting this path would
            // make the loader fall back to that credential and silently undo
            // the user's explicit Remove action.
            replace_private_file(&path, b"", "ai-provider")?;
            Ok(false)
        } else {
            replace_private_file(&path, normalized.as_bytes(), "ai-provider")?;

            // Reopen the file so Settings verifies the exact credential path
            // subsequently used by the Agent Host.
            let mut persisted = fs::read_to_string(&path)
                .context("failed to verify the saved provider credential")?;
            let mut persisted_normalized = normalize_provider_secret(&persisted);
            let verified = persisted_normalized == normalized;
            persisted.zeroize();
            persisted_normalized.zeroize();
            if verified {
                Ok(true)
            } else {
                Err(anyhow!(
                    "provider credential verification failed after saving"
                ))
            }
        };
        secret.zeroize();
        normalized.zeroize();
        result
    })
    .await
    .context("provider credential task failed")?
}

/// Normalize common copy/paste wrappers without ever logging or persisting
/// the original value. API key fields frequently receive a quoted value or a
/// complete `Bearer …` header copied from an environment file or curl command.
pub fn normalize_provider_secret(secret: &str) -> String {
    let mut value = secret.trim();
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if matches!(
            (bytes.first(), bytes.last()),
            (Some(b'\''), Some(b'\'')) | (Some(b'"'), Some(b'"'))
        ) {
            value = value[1..value.len() - 1].trim();
        }
    }
    if value
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("bearer "))
    {
        value = value[7..].trim();
    }
    value.to_string()
}

pub async fn has_provider_secret(app: &AppHandle, base_url: &str) -> Result<bool> {
    has_scoped_provider_secret(app, "assistant", base_url).await
}

pub async fn has_scoped_provider_secret(
    app: &AppHandle,
    scope: &str,
    base_url: &str,
) -> Result<bool> {
    let Some(mut secret) = load_scoped_provider_secret(app, scope, base_url).await? else {
        return Ok(false);
    };
    let available = !secret.trim().is_empty();
    secret.zeroize();
    Ok(available)
}

fn provider_secret_path(app: &AppHandle, base_url: &str) -> Result<PathBuf> {
    let normalized = normalized_provider_url(base_url)?;
    let digest = hex_digest(normalized.as_bytes());
    Ok(app
        .path()
        .app_config_dir()
        .context("failed to resolve the application configuration directory")?
        .join("credentials")
        .join(format!("ai-provider-{digest}.secret")))
}

fn scoped_provider_secret_path(app: &AppHandle, scope: &str, base_url: &str) -> Result<PathBuf> {
    let scope = normalized_provider_scope(scope)?;
    let normalized = normalized_provider_url(base_url)?;
    let digest = hex_digest(format!("{scope}:{normalized}").as_bytes());
    Ok(app
        .path()
        .app_config_dir()
        .context("failed to resolve the application configuration directory")?
        .join("credentials")
        .join(format!("ai-provider-{scope}-{digest}.secret")))
}

fn normalized_provider_scope(scope: &str) -> Result<&'static str> {
    match scope.trim() {
        "assistant" => Ok("assistant"),
        "inline" => Ok("inline"),
        _ => Err(anyhow!("unsupported AI provider credential scope")),
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

fn provider_secret_io_lock() -> Result<std::sync::MutexGuard<'static, ()>> {
    PROVIDER_SECRET_IO_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| anyhow!("provider credential file lock is poisoned"))
}

fn hex_digest(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_url_digest_is_stable_and_does_not_expose_the_url() {
        let normalized = normalized_provider_url("https://api.openai.com/v1/").unwrap();
        let digest = hex_digest(normalized.as_bytes());
        assert_eq!(digest.len(), 64);
        assert!(!digest.contains("openai.com"));
        assert_eq!(
            digest,
            hex_digest(
                normalized_provider_url("https://api.openai.com/v1")
                    .unwrap()
                    .as_bytes()
            )
        );
    }

    #[test]
    fn provider_url_rejects_embedded_credentials() {
        assert!(normalized_provider_url("https://secret@example.com/v1").is_err());
    }

    #[test]
    fn provider_credential_scopes_are_strict() {
        assert_eq!(normalized_provider_scope("assistant").unwrap(), "assistant");
        assert_eq!(normalized_provider_scope("inline").unwrap(), "inline");
        assert!(normalized_provider_scope("agent").is_err());
    }

    #[test]
    fn provider_secret_normalization_removes_copy_paste_wrappers() {
        assert_eq!(normalize_provider_secret(" sk-test "), "sk-test");
        assert_eq!(normalize_provider_secret("'sk-test'"), "sk-test");
        assert_eq!(normalize_provider_secret("\"sk-test\""), "sk-test");
        assert_eq!(normalize_provider_secret("Bearer sk-test"), "sk-test");
        assert_eq!(normalize_provider_secret("bearer   sk-test "), "sk-test");
    }

    #[test]
    fn credential_file_is_replaced_and_readable_only_by_the_current_user() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("credentials/provider.secret");
        replace_private_file(&path, b"first-secret", "ai-provider").unwrap();
        replace_private_file(&path, b"second-secret", "ai-provider").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second-secret");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
    }
}
