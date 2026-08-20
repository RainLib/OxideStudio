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
    /// Development-only escape hatch for databases which cannot provide a
    /// verified TLS endpoint. This is effective only when the Gateway process
    /// also opts in with `OXIDE_ALLOW_INSECURE_DATABASE_TRANSPORT=true`.
    #[serde(default)]
    pub allow_insecure_transport: bool,
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
    /// Process-wide development opt-in. A source must additionally opt in, so
    /// a production configuration cannot accidentally inherit insecure mode.
    pub allow_insecure_database_transport: bool,
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
        let allow_insecure_database_transport = env::var("OXIDE_ALLOW_INSECURE_DATABASE_TRANSPORT")
            .is_ok_and(|value| value.eq_ignore_ascii_case("true"));
        let source_path = PathBuf::from(required("OXIDE_GATEWAY_SOURCES_FILE")?);
        let sources = parse_sources(
            &read_private_file(
                &source_path,
                "OXIDE_GATEWAY_SOURCES_FILE",
                MAX_SOURCES_FILE_BYTES,
            )?,
            allow_insecure_database_transport,
        )?;
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
            allow_insecure_database_transport,
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

fn parse_sources(
    payload: &[u8],
    allow_insecure_database_transport: bool,
) -> Result<HashMap<Uuid, DataSourceConfig>> {
    let sources: Vec<DataSourceConfig> =
        serde_json::from_slice(payload).context("gateway source file is invalid")?;
    let mut parsed = HashMap::with_capacity(sources.len());
    for source in sources {
        validate_source(&source, allow_insecure_database_transport)?;
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

fn validate_source(
    source: &DataSourceConfig,
    allow_insecure_database_transport: bool,
) -> Result<()> {
    if !matches!(
        source.driver.trim().to_ascii_lowercase().as_str(),
        "postgres"
            | "postgresql"
            | "mysql"
            | "mongodb"
            | "mongo"
            | "elasticsearch"
            | "elastic"
            | "redis"
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
    if source.allow_insecure_transport && !allow_insecure_database_transport {
        anyhow::bail!(
            "gateway source {} requests insecure database transport without the Gateway development opt-in",
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
        let template_url = template
            .replace("{username}", "placeholder")
            .replace("{password}", "placeholder");
        validate_connection_transport(
            &source.driver,
            &template_url,
            allows_insecure_transport(source, allow_insecure_database_transport),
        )?;
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

pub(crate) fn allows_insecure_transport(
    source: &DataSourceConfig,
    allow_insecure_database_transport: bool,
) -> bool {
    source.allow_insecure_transport && allow_insecure_database_transport
}

/// Validate that a Gateway-only database URL uses the protocol expected by the
/// configured source and, by default, verifies the server identity over TLS.
/// Callers must not include the URL in an error because it can contain secrets.
pub(crate) fn validate_connection_transport(
    driver: &str,
    connection_url: &str,
    allow_insecure_transport: bool,
) -> Result<()> {
    let url = Url::parse(connection_url)
        .map_err(|_| anyhow::anyhow!("Gateway database URL is invalid"))?;
    if url.host_str().is_none() {
        anyhow::bail!("Gateway database URL must include a host");
    }
    let normalized_driver = driver.trim().to_ascii_lowercase();
    let scheme_matches = match normalized_driver.as_str() {
        "postgres" | "postgresql" => matches!(url.scheme(), "postgres" | "postgresql"),
        "mysql" => url.scheme() == "mysql",
        "mongodb" | "mongo" => matches!(url.scheme(), "mongodb" | "mongodb+srv"),
        "elasticsearch" | "elastic" => {
            matches!(url.scheme(), "http" | "https" | "elasticsearch" | "elastic")
        }
        "redis" => matches!(url.scheme(), "redis" | "rediss"),
        _ => false,
    };
    if !scheme_matches {
        anyhow::bail!("Gateway database URL does not match the configured driver");
    }
    if allow_insecure_transport {
        return Ok(());
    }
    let parameter = match normalized_driver.as_str() {
        "postgres" | "postgresql" => query_value(&url, &["sslmode"])
            .is_some_and(|value| value.eq_ignore_ascii_case("verify-full")),
        // SQLx accepts `ssl-mode` for MySQL. Do not accept a similar
        // unrecognized spelling here: it would fall back to the driver's
        // insecure `PREFERRED` default while this validator claimed success.
        "mysql" => query_value(&url, &["ssl-mode"])
            .is_some_and(|value| value.eq_ignore_ascii_case("verify_identity")),
        // MongoDB's driver accepts either spelling. Require an explicit TLS
        // setting even for mongodb+srv so the Gateway configuration itself is
        // unambiguous and cannot silently inherit a driver default.
        "mongodb" | "mongo" => query_value(&url, &["tls", "ssl"])
            .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "true" | "1")),
        // The Elasticsearch driver normalizes elastic/elasticsearch URLs, but
        // an enterprise source must still state HTTPS at the configuration
        // boundary. Its HTTP client verifies the server certificate normally.
        "elasticsearch" | "elastic" => url.scheme() == "https",
        // Redis has no URL query flag equivalent to PostgreSQL sslmode.
        // Require the TLS scheme explicitly; the Rust client then verifies
        // the server certificate rather than accepting plaintext Redis.
        "redis" => url.scheme() == "rediss",
        _ => false,
    };
    if !parameter {
        anyhow::bail!("Gateway database URL must require verified TLS server identity");
    }
    Ok(())
}

fn query_value(url: &Url, names: &[&str]) -> Option<String> {
    url.query_pairs()
        .find(|(key, _)| names.iter().any(|name| key.eq_ignore_ascii_case(name)))
        .map(|(_, value)| value.into_owned())
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
        assert!(parse_sources(payload.as_bytes(), false).is_err());
    }

    #[test]
    fn source_file_rejects_write_capabilities() {
        let payload = source(Uuid::new_v4()).replace("query.read", "data.write");
        assert!(parse_sources(format!("[{payload}]").as_bytes(), false).is_err());
    }

    #[test]
    fn source_file_accepts_supported_native_read_only_engines() {
        let mongo = format!(
            r#"[{{"id":"{}","driver":"mongodb","secretRef":"vault:database/documents","capabilities":["query.read"]}}]"#,
            Uuid::new_v4()
        );
        let elastic = format!(
            r#"[{{"id":"{}","driver":"elasticsearch","secretRef":"vault:database/search","capabilities":["query.read"]}}]"#,
            Uuid::new_v4()
        );
        assert!(parse_sources(mongo.as_bytes(), false).is_ok());
        assert!(parse_sources(elastic.as_bytes(), false).is_ok());
        let redis = mongo.replace("mongodb", "redis");
        assert!(parse_sources(redis.as_bytes(), false).is_ok());
        let unsupported = mongo.replace("mongodb", "cassandra");
        assert!(parse_sources(unsupported.as_bytes(), false).is_err());
    }

    #[test]
    fn source_file_requires_dynamic_credential_placeholders() {
        let payload = format!(
            r#"[{{"id":"{}","driver":"mysql","secretRef":"vault:database/analytics","connectionTemplate":"mysql://localhost/analytics","capabilities":["query.read"]}}]"#,
            Uuid::new_v4()
        );
        assert!(parse_sources(payload.as_bytes(), false).is_err());
    }

    #[test]
    fn verified_database_transport_requires_server_identity_validation() {
        assert!(validate_connection_transport(
            "postgres",
            "postgres://reader:secret@db.example.test/analytics?sslmode=verify-full",
            false,
        )
        .is_ok());
        assert!(validate_connection_transport(
            "postgres",
            "postgres://reader:secret@db.example.test/analytics?sslmode=require",
            false,
        )
        .is_err());
        assert!(validate_connection_transport(
            "mysql",
            "mysql://reader:secret@db.example.test/analytics?ssl-mode=VERIFY_IDENTITY",
            false,
        )
        .is_ok());
        assert!(validate_connection_transport(
            "mysql",
            "mysql://reader:secret@db.example.test/analytics?ssl-mode=REQUIRED",
            false,
        )
        .is_err());
        assert!(validate_connection_transport(
            "mongodb",
            "mongodb://reader:secret@db.example.test/analytics?tls=true",
            false,
        )
        .is_ok());
        assert!(validate_connection_transport(
            "mongodb",
            "mongodb://reader:secret@db.example.test/analytics",
            false,
        )
        .is_err());
        assert!(validate_connection_transport(
            "elasticsearch",
            "https://reader:secret@search.example.test:9200",
            false,
        )
        .is_ok());
        assert!(validate_connection_transport(
            "elasticsearch",
            "http://reader:secret@search.example.test:9200",
            false,
        )
        .is_err());
        assert!(validate_connection_transport(
            "redis",
            "rediss://reader:secret@cache.example.test:6380/2",
            false,
        )
        .is_ok());
        assert!(validate_connection_transport(
            "redis",
            "redis://reader:secret@cache.example.test:6379/2",
            false,
        )
        .is_err());
        assert!(validate_connection_transport(
            "mysql",
            "mysql://reader:secret@db.example.test/analytics?ssl_mode=VERIFY_IDENTITY",
            false,
        )
        .is_err());
    }

    #[test]
    fn database_transport_rejects_driver_mismatch_even_in_development() {
        assert!(validate_connection_transport(
            "mysql",
            "postgres://reader:secret@db.example.test/analytics?sslmode=disable",
            true,
        )
        .is_err());
        assert!(validate_connection_transport(
            "postgres",
            "postgres://reader:secret@db.example.test/analytics?sslmode=disable",
            true,
        )
        .is_ok());
    }

    #[test]
    fn source_insecure_transport_needs_two_explicit_development_opt_ins() {
        let payload = format!(
            r#"[{{"id":"{}","driver":"postgres","secretRef":"env:OXIDE_SECRET_DEV_DATABASE","allowInsecureTransport":true,"capabilities":["query.read"]}}]"#,
            Uuid::new_v4()
        );
        assert!(parse_sources(payload.as_bytes(), false).is_err());
        assert!(parse_sources(payload.as_bytes(), true).is_ok());
    }

    #[test]
    fn source_template_is_checked_for_verified_transport_before_startup() {
        let id = Uuid::new_v4();
        let insecure = format!(
            r#"[{{"id":"{id}","driver":"postgres","secretRef":"vault:database/analytics","connectionTemplate":"postgres://{{username}}:{{password}}@db.example.test/analytics?sslmode=require","capabilities":["query.read"]}}]"#,
        );
        assert!(parse_sources(insecure.as_bytes(), false).is_err());
        let verified = insecure.replace("sslmode=require", "sslmode=verify-full");
        assert!(parse_sources(verified.as_bytes(), false).is_ok());
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
