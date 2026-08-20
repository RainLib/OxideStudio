use anyhow::{Context, Result};
use axum::http::HeaderValue;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{env, fs, net::SocketAddr, path::Path};

const MAX_SECRET_FILE_BYTES: u64 = 16 * 1024;

pub struct Config {
    pub bind: SocketAddr,
    pub database_url: String,
    pub oidc_issuer: String,
    pub oidc_audience: String,
    pub oidc_jwks_url: String,
    pub ticket_signing_key: [u8; 32],
    pub allowed_origins: Vec<HeaderValue>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let oidc_issuer = required("OXIDE_OIDC_ISSUER")?;
        let key = STANDARD
            .decode(required_secret("OXIDE_TICKET_SIGNING_KEY_BASE64")?)
            .context("OXIDE_TICKET_SIGNING_KEY_BASE64 is not valid base64")?;
        let ticket_signing_key = key.try_into().map_err(|_| {
            anyhow::anyhow!("OXIDE_TICKET_SIGNING_KEY_BASE64 must decode to exactly 32 bytes")
        })?;
        Ok(Self {
            bind: env::var("OXIDE_CONTROL_PLANE_BIND")
                .unwrap_or_else(|_| "127.0.0.1:8787".into())
                .parse()
                .context("OXIDE_CONTROL_PLANE_BIND is invalid")?,
            database_url: required_secret("DATABASE_URL")?,
            oidc_jwks_url: env::var("OXIDE_OIDC_JWKS_URL")
                .unwrap_or_else(|_| format!("{oidc_issuer}/protocol/openid-connect/certs")),
            oidc_issuer,
            oidc_audience: required("OXIDE_OIDC_AUDIENCE")?,
            ticket_signing_key,
            allowed_origins: env::var("OXIDE_ALLOWED_ORIGINS")
                .unwrap_or_else(|_| "http://127.0.0.1:1430,http://localhost:1430".into())
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| {
                    value
                        .parse()
                        .with_context(|| format!("invalid CORS origin: {value}"))
                })
                .collect::<Result<Vec<_>>>()?,
        })
    }
}

fn required(name: &str) -> Result<String> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("{name} is required"))
}

fn required_secret(name: &str) -> Result<String> {
    let file_name = format!("{name}_FILE");
    let inline = env::var(name).ok().filter(|value| !value.trim().is_empty());
    let file = env::var(&file_name)
        .ok()
        .filter(|value| !value.trim().is_empty());
    match (inline, file) {
        (Some(_), Some(_)) => anyhow::bail!("{name} and {file_name} cannot both be set"),
        (Some(value), None) => Ok(value),
        (None, Some(path)) => read_private_secret_file(Path::new(&path), &file_name),
        (None, None) => anyhow::bail!("{name} or {file_name} is required"),
    }
}

fn read_private_secret_file(path: &Path, name: &str) -> Result<String> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("failed to inspect {} from {name}", path.display()))?;
    if !metadata.is_file() {
        anyhow::bail!("{} from {name} must be a regular file", path.display());
    }
    if metadata.len() > MAX_SECRET_FILE_BYTES {
        anyhow::bail!(
            "{} from {name} exceeds the maximum allowed size",
            path.display()
        );
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
    let value = fs::read_to_string(path)
        .with_context(|| format!("failed to read {} from {name}", path.display()))?;
    let value = value.trim().to_string();
    if value.is_empty() {
        anyhow::bail!("{} from {name} must not be empty", path.display());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_secret_files_reject_non_regular_paths() {
        let path = std::env::temp_dir();
        assert!(read_private_secret_file(&path, "TEST_SECRET_FILE").is_err());
    }
}
