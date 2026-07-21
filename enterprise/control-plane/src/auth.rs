use anyhow::{anyhow, Context, Result};
use axum::http::{header::AUTHORIZATION, HeaderMap};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub struct AuthenticatedIdentity {
    pub issuer: String,
    pub subject: String,
    pub display_name: String,
    pub verified_email: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Claims {
    iss: String,
    sub: String,
    exp: u64,
    name: Option<String>,
    preferred_username: Option<String>,
    email: Option<String>,
    email_verified: Option<bool>,
}

pub struct OidcVerifier {
    issuer: String,
    audience: String,
    jwks: JwkSet,
}

impl OidcVerifier {
    pub async fn load(issuer: String, audience: String, jwks_url: &str) -> Result<Self> {
        let jwks = reqwest::Client::new()
            .get(jwks_url)
            .send()
            .await
            .context("failed to fetch OIDC JWKS")?
            .error_for_status()
            .context("OIDC JWKS endpoint rejected the request")?
            .json::<JwkSet>()
            .await
            .context("OIDC JWKS response is invalid")?;
        if jwks.keys.is_empty() {
            return Err(anyhow!("OIDC JWKS does not contain signing keys"));
        }
        Ok(Self {
            issuer,
            audience,
            jwks,
        })
    }

    pub fn authenticate(&self, headers: &HeaderMap) -> Result<AuthenticatedIdentity> {
        let token = headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("missing bearer access token"))?;
        let header = decode_header(token).context("access token header is invalid")?;
        let key = self
            .jwks
            .find(header.kid.as_deref().unwrap_or_default())
            .ok_or_else(|| anyhow!("access token signing key is unknown"))?;
        let decoding_key = DecodingKey::from_jwk(key).context("OIDC signing key is unsupported")?;
        let algorithm = match header.alg {
            Algorithm::RS256 | Algorithm::RS384 | Algorithm::RS512 | Algorithm::EdDSA => header.alg,
            _ => return Err(anyhow!("access token uses a forbidden signing algorithm")),
        };
        let mut validation = Validation::new(algorithm);
        validation.set_issuer(&[self.issuer.as_str()]);
        validation.set_audience(&[self.audience.as_str()]);
        validation.required_spec_claims =
            HashSet::from(["exp".into(), "iss".into(), "sub".into(), "aud".into()]);
        let claims = decode::<Claims>(token, &decoding_key, &validation)
            .context("access token validation failed")?
            .claims;
        let _ = claims.exp;
        let verified_email = claims
            .email_verified
            .unwrap_or(false)
            .then_some(claims.email)
            .flatten();
        Ok(AuthenticatedIdentity {
            issuer: claims.iss,
            subject: claims.sub,
            display_name: claims
                .name
                .or(claims.preferred_username)
                .or_else(|| verified_email.clone())
                .unwrap_or_else(|| "Oxide user".into()),
            verified_email,
        })
    }
}
