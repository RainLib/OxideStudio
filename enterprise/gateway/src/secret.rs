use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Deserialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use url::Url;
use zeroize::Zeroize;

pub struct SecretMaterial {
    connection_url: String,
    lease_duration: Option<Duration>,
}

impl SecretMaterial {
    pub fn new(connection_url: String) -> Result<Self> {
        Self::with_lease(connection_url, None)
    }

    pub fn with_lease(connection_url: String, lease_duration: Option<Duration>) -> Result<Self> {
        if connection_url.trim().is_empty() {
            return Err(anyhow!("secret provider returned an empty connection URL"));
        }
        let parsed =
            Url::parse(&connection_url).context("secret provider returned an invalid URL")?;
        if parsed.host_str().is_none() {
            return Err(anyhow!(
                "secret provider connection URL must include a host"
            ));
        }
        Ok(Self {
            connection_url,
            lease_duration,
        })
    }

    pub fn connection_url(&self) -> &str {
        &self.connection_url
    }

    pub fn lease_duration(&self) -> Option<Duration> {
        self.lease_duration
    }
}

impl std::fmt::Debug for SecretMaterial {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SecretMaterial")
            .field("connection_url", &"****")
            .field("leased", &self.lease_duration.is_some())
            .finish()
    }
}

impl Drop for SecretMaterial {
    fn drop(&mut self) {
        self.connection_url.zeroize();
    }
}

#[async_trait]
pub trait SecretProvider: Send + Sync {
    async fn resolve(
        &self,
        secret_ref: &str,
        connection_template: Option<&str>,
    ) -> Result<SecretMaterial>;
}

pub fn configured_provider(allow_environment_secrets: bool) -> Result<Arc<dyn SecretProvider>> {
    match env::var("OXIDE_SECRET_PROVIDER")
        .unwrap_or_else(|_| "environment".into())
        .to_ascii_lowercase()
        .as_str()
    {
        "environment" if allow_environment_secrets => {
            Ok(Arc::new(EnvironmentSecretProvider::new(true)))
        }
        "environment" => Err(anyhow!(
            "environment secret provider requires OXIDE_ALLOW_ENVIRONMENT_SECRETS=true"
        )),
        "vault" => Ok(Arc::new(VaultSecretProvider::from_env()?)),
        "kubernetes" => Ok(Arc::new(KubernetesSecretProvider::from_env()?)),
        value => Err(anyhow!("unsupported Gateway secret provider: {value}")),
    }
}

/// Development-only provider. It is never selected implicitly in production:
/// the separate opt-in flag must also be true.
pub struct EnvironmentSecretProvider {
    enabled: bool,
}

impl EnvironmentSecretProvider {
    pub fn new(enabled: bool) -> Self {
        Self { enabled }
    }
}

#[async_trait]
impl SecretProvider for EnvironmentSecretProvider {
    async fn resolve(
        &self,
        secret_ref: &str,
        _connection_template: Option<&str>,
    ) -> Result<SecretMaterial> {
        if !self.enabled {
            return Err(anyhow!(
                "environment secret provider is disabled; configure a production SecretProvider"
            ));
        }
        if !secret_ref.starts_with("env:") {
            return Err(anyhow!(
                "environment secret references must start with env:"
            ));
        }
        let name = &secret_ref[4..];
        if name.is_empty()
            || !name.chars().all(|character| {
                character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
            })
        {
            return Err(anyhow!("environment secret reference is invalid"));
        }
        SecretMaterial::new(env::var(name).map_err(|_| anyhow!("gateway secret is not available"))?)
    }
}

pub struct KubernetesSecretProvider {
    directory: PathBuf,
}

impl KubernetesSecretProvider {
    fn from_env() -> Result<Self> {
        let directory = PathBuf::from(
            env::var("OXIDE_KUBERNETES_SECRET_DIRECTORY")
                .unwrap_or_else(|_| "/var/run/secrets/oxide-data-sources".into()),
        );
        let metadata = fs::metadata(&directory).with_context(|| {
            format!(
                "Kubernetes secret directory is unavailable: {}",
                directory.display()
            )
        })?;
        if !metadata.is_dir() {
            return Err(anyhow!(
                "Kubernetes secret provider path must be a directory"
            ));
        }
        Ok(Self { directory })
    }
}

#[async_trait]
impl SecretProvider for KubernetesSecretProvider {
    async fn resolve(
        &self,
        secret_ref: &str,
        _connection_template: Option<&str>,
    ) -> Result<SecretMaterial> {
        let name = secret_ref
            .strip_prefix("k8s:")
            .context("Kubernetes secret references must start with k8s:")?;
        if name.is_empty()
            || name.len() > 253
            || !name.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
            })
        {
            return Err(anyhow!("Kubernetes secret name is invalid"));
        }
        let root = fs::canonicalize(&self.directory)
            .context("Kubernetes secret directory could not be resolved")?;
        let path = fs::canonicalize(self.directory.join(name))
            .with_context(|| format!("mounted Kubernetes secret is unavailable: {name}"))?;
        if !path.starts_with(&root) {
            return Err(anyhow!(
                "mounted Kubernetes secret resolves outside the configured directory"
            ));
        }
        let metadata = fs::metadata(&path)
            .with_context(|| format!("mounted Kubernetes secret is unavailable: {name}"))?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 1024 * 1024 {
            return Err(anyhow!(
                "mounted Kubernetes secret is empty, too large, or not a regular file"
            ));
        }
        let connection_url = fs::read_to_string(path)
            .context("mounted Kubernetes secret could not be read")?
            .trim()
            .to_string();
        SecretMaterial::new(connection_url)
    }
}

struct VaultToken(String);

impl Drop for VaultToken {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

pub struct VaultSecretProvider {
    address: Url,
    namespace: Option<String>,
    token: VaultToken,
    http: reqwest::Client,
}

impl VaultSecretProvider {
    fn from_env() -> Result<Self> {
        let mut address = Url::parse(
            &env::var("OXIDE_VAULT_ADDRESS").context("OXIDE_VAULT_ADDRESS is required")?,
        )
        .context("OXIDE_VAULT_ADDRESS is invalid")?;
        let local_http = address.scheme() == "http"
            && matches!(address.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
        if address.scheme() != "https" && !local_http {
            return Err(anyhow!("Vault must use HTTPS"));
        }
        if !address.username().is_empty() || address.password().is_some() {
            return Err(anyhow!("Vault address must not contain credentials"));
        }
        address.set_query(None);
        address.set_fragment(None);
        let token_path = PathBuf::from(
            env::var("OXIDE_VAULT_TOKEN_FILE").context("OXIDE_VAULT_TOKEN_FILE is required")?,
        );
        require_private_file(&token_path)?;
        let token = fs::read_to_string(&token_path)
            .with_context(|| format!("failed to read {}", token_path.display()))?
            .trim()
            .to_string();
        if token.is_empty() || token.len() > 16 * 1024 {
            return Err(anyhow!("Vault token file is empty or too large"));
        }
        Ok(Self {
            address,
            namespace: env::var("OXIDE_VAULT_NAMESPACE")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            token: VaultToken(token),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .context("failed to configure Vault client")?,
        })
    }
}

#[derive(Deserialize)]
struct VaultResponse {
    data: serde_json::Value,
    lease_duration: Option<u64>,
}

#[async_trait]
impl SecretProvider for VaultSecretProvider {
    async fn resolve(
        &self,
        secret_ref: &str,
        connection_template: Option<&str>,
    ) -> Result<SecretMaterial> {
        let path = secret_ref
            .strip_prefix("vault:")
            .context("Vault secret references must start with vault:")?
            .trim_start_matches('/');
        if path.is_empty()
            || path.len() > 1024
            || path.split('/').any(|segment| {
                segment.is_empty()
                    || segment == "."
                    || segment == ".."
                    || !segment.chars().all(|character| {
                        character.is_ascii_alphanumeric()
                            || matches!(character, '-' | '_' | '.' | '~')
                    })
            })
        {
            return Err(anyhow!("Vault secret path is invalid"));
        }
        let endpoint = self
            .address
            .join(&format!("v1/{path}"))
            .context("Vault secret endpoint is invalid")?;
        let mut request = self
            .http
            .get(endpoint)
            .header("x-vault-token", &self.token.0);
        if let Some(namespace) = &self.namespace {
            request = request.header("x-vault-namespace", namespace);
        }
        let response = request
            .send()
            .await
            .context("Vault is unavailable")?
            .error_for_status()
            .context("Vault denied the Gateway secret request")?
            .json::<VaultResponse>()
            .await
            .context("Vault returned an invalid secret payload")?;
        let data = response.data.get("data").unwrap_or(&response.data);
        let connection_url = if let Some(connection_url) =
            data.get("connection_url").and_then(|value| value.as_str())
        {
            connection_url.to_string()
        } else {
            let template = connection_template
                .context("dynamic Vault credentials require a Gateway-local connectionTemplate")?;
            if !template.contains("{username}") || !template.contains("{password}") {
                return Err(anyhow!(
                    "connectionTemplate must contain username and password placeholders"
                ));
            }
            let username = data
                .get("username")
                .and_then(|value| value.as_str())
                .context("Vault dynamic credential has no username")?;
            let password = data
                .get("password")
                .and_then(|value| value.as_str())
                .context("Vault dynamic credential has no password")?;
            template
                .replace(
                    "{username}",
                    &utf8_percent_encode(username, NON_ALPHANUMERIC).to_string(),
                )
                .replace(
                    "{password}",
                    &utf8_percent_encode(password, NON_ALPHANUMERIC).to_string(),
                )
        };
        SecretMaterial::with_lease(
            connection_url,
            response.lease_duration.map(Duration::from_secs),
        )
    }
}

fn require_private_file(path: &Path) -> Result<()> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("secret token file is unavailable: {}", path.display()))?;
    if !metadata.is_file() {
        return Err(anyhow!("secret token path must be a regular file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(anyhow!(
                "secret token file must not be readable by group or other users"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_debug_output_is_redacted() {
        let material = SecretMaterial::new("postgres://user:secret@example/db".into()).unwrap();
        let debug = format!("{material:?}");
        assert!(!debug.contains("user"));
        assert!(!debug.contains("secret"));
    }

    #[tokio::test]
    async fn environment_provider_requires_explicit_opt_in() {
        let provider = EnvironmentSecretProvider::new(false);
        assert!(provider.resolve("env:DATABASE_URL", None).await.is_err());
    }
}
