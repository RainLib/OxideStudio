use anyhow::{anyhow, Context, Result};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

const KEYRING_SERVICE: &str = "com.rainlib.oxide-studio.ai-provider";

pub async fn load_provider_secret(base_url: &str) -> Result<Option<String>> {
    let account = provider_account(base_url)?;
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
            .context("failed to open the provider credential store")?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(anyhow!("failed to read the provider credential: {error}")),
        }
    })
    .await
    .context("provider credential task failed")?
}

pub async fn save_provider_secret(base_url: &str, secret: Option<String>) -> Result<bool> {
    let account = provider_account(base_url)?;
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
            .context("failed to open the provider credential store")?;
        let mut secret = secret.unwrap_or_default();
        let result = if secret.trim().is_empty() {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(false),
                Err(error) => Err(anyhow!("failed to delete the provider credential: {error}")),
            }
        } else {
            entry
                .set_password(secret.trim())
                .map(|()| true)
                .map_err(|error| anyhow!("failed to save the provider credential: {error}"))
        };
        secret.zeroize();
        result
    })
    .await
    .context("provider credential task failed")?
}

pub async fn has_provider_secret(base_url: &str) -> Result<bool> {
    let Some(mut secret) = load_provider_secret(base_url).await? else {
        return Ok(false);
    };
    let available = !secret.trim().is_empty();
    secret.zeroize();
    Ok(available)
}

fn provider_account(base_url: &str) -> Result<String> {
    let normalized = base_url.trim().trim_end_matches('/');
    if normalized.is_empty() {
        return Err(anyhow!("AI provider base URL is required"));
    }
    let parsed = url::Url::parse(normalized).context("AI provider base URL is invalid")?;
    if parsed.username() != "" || parsed.password().is_some() {
        return Err(anyhow!("AI provider URL must not contain credentials"));
    }
    Ok(format!(
        "openai-compatible:{}",
        hex_digest(normalized.as_bytes())
    ))
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
    fn provider_account_is_stable_and_does_not_expose_the_url() {
        let account = provider_account("https://api.openai.com/v1/").unwrap();
        assert_eq!(account.len(), "openai-compatible:".len() + 64);
        assert!(!account.contains("openai.com"));
        assert_eq!(
            account,
            provider_account("https://api.openai.com/v1").unwrap()
        );
    }

    #[test]
    fn provider_account_rejects_embedded_credentials() {
        assert!(provider_account("https://secret@example.com/v1").is_err());
    }
}
