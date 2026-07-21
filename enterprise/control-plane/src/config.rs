use anyhow::{Context, Result};
use axum::http::HeaderValue;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{env, net::SocketAddr};

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
            .decode(required("OXIDE_TICKET_SIGNING_KEY_BASE64")?)
            .context("OXIDE_TICKET_SIGNING_KEY_BASE64 is not valid base64")?;
        let ticket_signing_key = key.try_into().map_err(|_| {
            anyhow::anyhow!("OXIDE_TICKET_SIGNING_KEY_BASE64 must decode to exactly 32 bytes")
        })?;
        Ok(Self {
            bind: env::var("OXIDE_CONTROL_PLANE_BIND")
                .unwrap_or_else(|_| "127.0.0.1:8787".into())
                .parse()
                .context("OXIDE_CONTROL_PLANE_BIND is invalid")?,
            database_url: required("DATABASE_URL")?,
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
