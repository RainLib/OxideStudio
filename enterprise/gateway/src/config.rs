use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{SigningKey, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{hash_map::Entry, HashMap},
    env, fs,
    net::SocketAddr,
    path::{Path, PathBuf},
};
use url::Url;
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
    /// Public mTLS endpoint registered with the control plane. It is distinct
    /// from the local bind address, which is often private or loopback.
    pub public_endpoint: String,
    pub control_plane_url: String,
    /// Loaded from a private file and never logged or persisted by the gateway.
    /// Required only until the first successful enrollment. An active Gateway
    /// proves identity with its enrolled signing key on later restarts.
    pub enrollment_token: Option<String>,
    pub enrollment_signing_key: SigningKey,
    pub control_plane_ca_certificate: Option<Vec<u8>>,
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
        let tls_certificate = read_required_file("OXIDE_GATEWAY_TLS_CERTIFICATE")?;
        let public_endpoint =
            validated_https_endpoint(&required("OXIDE_GATEWAY_PUBLIC_ENDPOINT")?)?;
        let control_plane_url = validated_https_endpoint(&required("OXIDE_CONTROL_PLANE_URL")?)?;
        let enrollment_token = env::var("OXIDE_GATEWAY_ENROLLMENT_TOKEN_FILE")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|path| {
                read_private_text_file(
                    &PathBuf::from(path),
                    "OXIDE_GATEWAY_ENROLLMENT_TOKEN_FILE",
                    4_096,
                )
            })
            .transpose()?;
        if enrollment_token
            .as_ref()
            .is_some_and(|token| token.len() < 32 || token.len() > 256)
        {
            anyhow::bail!(
                "OXIDE_GATEWAY_ENROLLMENT_TOKEN_FILE does not contain a valid enrollment token"
            );
        }
        let enrollment_signing_key = STANDARD
            .decode(read_private_text_file(
                &PathBuf::from(required("OXIDE_GATEWAY_ENROLLMENT_SIGNING_KEY_FILE")?),
                "OXIDE_GATEWAY_ENROLLMENT_SIGNING_KEY_FILE",
                4_096,
            )?)
            .context("OXIDE_GATEWAY_ENROLLMENT_SIGNING_KEY_FILE is not valid base64")?;
        let enrollment_signing_key: [u8; 32] = enrollment_signing_key.try_into().map_err(|_| {
            anyhow::anyhow!(
                "OXIDE_GATEWAY_ENROLLMENT_SIGNING_KEY_FILE must decode to a 32-byte Ed25519 private key"
            )
        })?;
        let control_plane_ca_certificate = env::var("OXIDE_CONTROL_PLANE_CA_CERTIFICATE")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|path| {
                read_required_file_at(&PathBuf::from(path), "OXIDE_CONTROL_PLANE_CA_CERTIFICATE")
            })
            .transpose()?;
        Ok(Self {
            id,
            bind: env::var("OXIDE_GATEWAY_BIND")
                .unwrap_or_else(|_| "127.0.0.1:8790".into())
                .parse()
                .context("OXIDE_GATEWAY_BIND is invalid")?,
            public_endpoint,
            control_plane_url,
            enrollment_token,
            enrollment_signing_key: SigningKey::from_bytes(&enrollment_signing_key),
            control_plane_ca_certificate,
            control_plane_verifying_key: VerifyingKey::from_bytes(&verifying_key)
                .context("control-plane verifying key is invalid")?,
            sources,
            allow_environment_secrets: env::var("OXIDE_ALLOW_ENVIRONMENT_SECRETS")
                .is_ok_and(|value| value.eq_ignore_ascii_case("true")),
            tls_certificate,
            tls_private_key: read_private_file(
                &PathBuf::from(required("OXIDE_GATEWAY_TLS_PRIVATE_KEY")?),
                "OXIDE_GATEWAY_TLS_PRIVATE_KEY",
                MAX_SOURCES_FILE_BYTES,
            )?,
            client_ca_certificate: read_required_file("OXIDE_GATEWAY_CLIENT_CA_CERTIFICATE")?,
        })
    }
}

/// SHA-256 fingerprint of the leaf X.509 certificate in DER form. Parsing the
/// PEM before hashing avoids line-ending and wrapping differences in deployment
/// manifests changing the registered identity.
pub fn certificate_fingerprint(certificate: &[u8]) -> Result<String> {
    let der = if certificate.starts_with(b"-----BEGIN") {
        let mut reader = std::io::BufReader::new(certificate);
        let certificates = rustls_pemfile::certs(&mut reader)
            .collect::<Result<Vec<_>, _>>()
            .context("Gateway TLS certificate PEM is invalid")?;
        if certificates.len() != 1 {
            anyhow::bail!("Gateway TLS certificate must contain exactly one leaf certificate");
        }
        certificates[0].as_ref().to_vec()
    } else {
        certificate.to_vec()
    };
    let digest = Sha256::digest(der);
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn read_required_file(name: &str) -> Result<Vec<u8>> {
    let path = PathBuf::from(required(name)?);
    read_required_file_at(&path, name)
}

fn read_required_file_at(path: &Path, name: &str) -> Result<Vec<u8>> {
    read_file(path, name, None)
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

fn read_private_text_file(path: &Path, name: &str, max_bytes: u64) -> Result<String> {
    let value = String::from_utf8(read_private_file(path, name, max_bytes)?)
        .with_context(|| format!("{name} must contain UTF-8 text"))?;
    let value = value.trim().to_string();
    if value.is_empty() {
        anyhow::bail!("{name} must not be empty");
    }
    Ok(value)
}

fn validated_https_endpoint(value: &str) -> Result<String> {
    let endpoint = Url::parse(value.trim()).context("Gateway endpoint is invalid")?;
    if endpoint.scheme() != "https"
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.host_str().is_none()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        anyhow::bail!("Gateway endpoint must be a credential-free HTTPS URL");
    }
    Ok(endpoint.as_str().trim_end_matches('/').to_string())
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

    #[test]
    fn enrollment_endpoint_rejects_non_https_or_credentialed_urls() {
        assert!(validated_https_endpoint("http://gateway.example.test").is_err());
        assert!(validated_https_endpoint("https://user:secret@gateway.example.test").is_err());
        assert_eq!(
            validated_https_endpoint("https://gateway.example.test:8790/").unwrap(),
            "https://gateway.example.test:8790"
        );
    }

    #[test]
    fn certificate_fingerprint_hashes_der_bytes() {
        assert_eq!(
            certificate_fingerprint(b"certificate").unwrap(),
            "03d66dd08835c1ca3f128cceacd1f31ac94163096b20f445ae84285bc0832d72"
        );
    }
}
