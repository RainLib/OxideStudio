use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::VerifyingKey;
use serde::Deserialize;
use std::{
    collections::{hash_map::Entry, HashMap},
    env, fs,
    net::SocketAddr,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const MAX_SOURCES_FILE_BYTES: u64 = 1_048_576;

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
        let sources = parse_sources(&read_private_file(
            &source_path,
            "OXIDE_GATEWAY_SOURCES_FILE",
            MAX_SOURCES_FILE_BYTES,
        )?)?;
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
            tls_private_key: read_private_file(
                &PathBuf::from(required("OXIDE_GATEWAY_TLS_PRIVATE_KEY")?),
                "OXIDE_GATEWAY_TLS_PRIVATE_KEY",
                MAX_SOURCES_FILE_BYTES,
            )?,
            client_ca_certificate: read_required_file("OXIDE_GATEWAY_CLIENT_CA_CERTIFICATE")?,
        })
    }
}

fn read_required_file(name: &str) -> Result<Vec<u8>> {
    let path = PathBuf::from(required(name)?);
    read_file(&path, name, None)
}

fn read_private_file(path: &Path, name: &str, max_bytes: u64) -> Result<Vec<u8>> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("failed to inspect {} from {name}", path.display()))?;
    if !metadata.is_file() {
        anyhow::bail!("{} from {name} must be a regular file", path.display());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            anyhow::bail!(
                "{} from {name} must not be readable by group or other users",
                path.display()
            );
        }
    }
    read_file(path, name, Some(max_bytes))
}

fn read_file(path: &Path, name: &str, max_bytes: Option<u64>) -> Result<Vec<u8>> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("failed to inspect {} from {name}", path.display()))?;
    if !metadata.is_file() {
        anyhow::bail!("{} from {name} must be a regular file", path.display());
    }
    if max_bytes.is_some_and(|limit| metadata.len() > limit) {
        anyhow::bail!(
            "{} from {name} exceeds the maximum allowed size",
            path.display()
        );
    }
    fs::read(path).with_context(|| format!("failed to read {} from {name}", path.display()))
}

fn parse_sources(payload: &[u8]) -> Result<HashMap<Uuid, DataSourceConfig>> {
    let sources: Vec<DataSourceConfig> =
        serde_json::from_slice(payload).context("gateway source file is invalid")?;
    let mut parsed = HashMap::with_capacity(sources.len());
    for source in sources {
        validate_source(&source)?;
        match parsed.entry(source.id) {
            Entry::Vacant(entry) => {
                entry.insert(source);
            }
            Entry::Occupied(_) => {
                anyhow::bail!("gateway source file contains duplicate source IDs")
            }
        }
    }
    Ok(parsed)
}

fn validate_source(source: &DataSourceConfig) -> Result<()> {
    if !matches!(
        source.driver.trim().to_ascii_lowercase().as_str(),
        "postgres" | "postgresql" | "mysql"
    ) {
        anyhow::bail!("gateway source {} has an unsupported driver", source.id);
    }
    if source.secret_ref.trim().is_empty()
        || source.secret_ref.len() > 512
        || source.secret_ref.chars().any(char::is_control)
    {
        anyhow::bail!(
            "gateway source {} has an invalid secret reference",
            source.id
        );
    }
    if let Some(template) = &source.connection_template {
        if template.trim().is_empty()
            || template.len() > 8_192
            || !template.contains("{username}")
            || !template.contains("{password}")
        {
            anyhow::bail!(
                "gateway source {} connection template must include username and password placeholders",
                source.id
            );
        }
    }
    if source.capabilities.is_empty()
        || source.capabilities.iter().any(|capability| {
            !matches!(
                capability.as_str(),
                "resource.discover" | "metadata.read" | "query.read"
            )
        })
    {
        anyhow::bail!("gateway source {} has unsupported capabilities", source.id);
    }
    Ok(())
}

fn required(name: &str) -> Result<String> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("{name} is required"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(id: Uuid) -> String {
        format!(
            r#"{{"id":"{id}","driver":"postgres","secretRef":"vault:database/analytics","capabilities":["resource.discover","metadata.read","query.read"]}}"#
        )
    }

    #[test]
    fn source_file_rejects_duplicate_ids() {
        let id = Uuid::new_v4();
        let payload = format!("[{},{}]", source(id), source(id));
        assert!(parse_sources(payload.as_bytes()).is_err());
    }

    #[test]
    fn source_file_rejects_write_capabilities() {
        let payload = source(Uuid::new_v4()).replace("query.read", "data.write");
        assert!(parse_sources(format!("[{payload}]").as_bytes()).is_err());
    }

    #[test]
    fn source_file_requires_dynamic_credential_placeholders() {
        let payload = format!(
            r#"[{{"id":"{}","driver":"mysql","secretRef":"vault:database/analytics","connectionTemplate":"mysql://localhost/analytics","capabilities":["query.read"]}}]"#,
            Uuid::new_v4()
        );
        assert!(parse_sources(payload.as_bytes()).is_err());
    }
}
