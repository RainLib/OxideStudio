use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::VerifyingKey;
use serde::Deserialize;
use std::{collections::HashMap, env, fs, net::SocketAddr, path::PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataSourceConfig {
    pub id: Uuid,
    pub driver: String,
    /// Gateway-local lookup key. This value never leaves the gateway.
    pub secret_ref: String,
    /// Optional Gateway-local URL template used with dynamic credentials.
    /// It must contain `{username}` and `{password}` placeholders.
    pub connection_template: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

pub struct GatewayConfig {
    pub id: Uuid,
    pub bind: SocketAddr,
    pub control_plane_verifying_key: VerifyingKey,
    pub sources: HashMap<Uuid, DataSourceConfig>,
    pub allow_environment_secrets: bool,
    pub tls_certificate: Vec<u8>,
    pub tls_private_key: Vec<u8>,
    pub client_ca_certificate: Vec<u8>,
}

impl GatewayConfig {
    pub fn from_env() -> Result<Self> {
        let id = required("OXIDE_GATEWAY_ID")?
            .parse()
            .context("OXIDE_GATEWAY_ID must be a UUID")?;
        let verifying_key = STANDARD
            .decode(required("OXIDE_CONTROL_PLANE_VERIFYING_KEY_BASE64")?)
            .context("OXIDE_CONTROL_PLANE_VERIFYING_KEY_BASE64 is not valid base64")?;
        let verifying_key: [u8; 32] = verifying_key.try_into().map_err(|_| {
            anyhow::anyhow!(
                "OXIDE_CONTROL_PLANE_VERIFYING_KEY_BASE64 must decode to exactly 32 bytes"
            )
        })?;
        let source_path = PathBuf::from(required("OXIDE_GATEWAY_SOURCES_FILE")?);
        let sources = fs::read(&source_path)
            .with_context(|| format!("failed to read {}", source_path.display()))?;
        let sources: Vec<DataSourceConfig> =
            serde_json::from_slice(&sources).context("gateway source file is invalid")?;
        let sources = sources
            .into_iter()
            .map(|source| (source.id, source))
            .collect();
        Ok(Self {
            id,
            bind: env::var("OXIDE_GATEWAY_BIND")
                .unwrap_or_else(|_| "127.0.0.1:8790".into())
                .parse()
                .context("OXIDE_GATEWAY_BIND is invalid")?,
            control_plane_verifying_key: VerifyingKey::from_bytes(&verifying_key)
                .context("control-plane verifying key is invalid")?,
            sources,
            allow_environment_secrets: env::var("OXIDE_ALLOW_ENVIRONMENT_SECRETS")
                .is_ok_and(|value| value.eq_ignore_ascii_case("true")),
            tls_certificate: read_required_file("OXIDE_GATEWAY_TLS_CERTIFICATE")?,
            tls_private_key: read_required_file("OXIDE_GATEWAY_TLS_PRIVATE_KEY")?,
            client_ca_certificate: read_required_file("OXIDE_GATEWAY_CLIENT_CA_CERTIFICATE")?,
        })
    }
}

fn read_required_file(name: &str) -> Result<Vec<u8>> {
    let path = PathBuf::from(required(name)?);
    fs::read(&path).with_context(|| format!("failed to read {} from {name}", path.display()))
}

fn required(name: &str) -> Result<String> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("{name} is required"))
}
