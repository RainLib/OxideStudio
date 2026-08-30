use anyhow::{anyhow, Context, Result};
use axum::http::{header::AUTHORIZATION, HeaderMap};
use jsonwebtoken::{
    decode, decode_header,
    jwk::{Jwk, JwkSet},
    Algorithm, DecodingKey, Validation,
};
use serde::Deserialize;
use std::collections::HashSet;
use tokio::sync::{Mutex, RwLock};

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
    jwks_url: String,
    client: reqwest::Client,
    jwks: RwLock<JwkSet>,
    refresh_lock: Mutex<()>,
}

impl OidcVerifier {
    pub async fn load(issuer: String, audience: String, jwks_url: &str) -> Result<Self> {
        let client = reqwest::Client::new();
        Self::load_with_client(issuer, audience, jwks_url, client).await
    }

    async fn load_with_client(
        issuer: String,
        audience: String,
        jwks_url: &str,
        client: reqwest::Client,
    ) -> Result<Self> {
        let jwks = fetch_jwks(&client, jwks_url).await?;
        Ok(Self {
            issuer,
            audience,
            jwks_url: jwks_url.into(),
            client,
            jwks: RwLock::new(jwks),
            refresh_lock: Mutex::new(()),
        })
    }

    pub async fn authenticate(&self, headers: &HeaderMap) -> Result<AuthenticatedIdentity> {
        let token = headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("missing bearer access token"))?;
        let header = decode_header(token).context("access token header is invalid")?;
        let key = self
            .signing_key(header.kid.as_deref().unwrap_or_default())
            .await?;
        let decoding_key =
            DecodingKey::from_jwk(&key).context("OIDC signing key is unsupported")?;
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

    async fn signing_key(&self, kid: &str) -> Result<Jwk> {
        if let Some(key) = self.jwks.read().await.find(kid).cloned() {
            return Ok(key);
        }
        let _refresh = self.refresh_lock.lock().await;
        if let Some(key) = self.jwks.read().await.find(kid).cloned() {
            return Ok(key);
        }
        let refreshed = fetch_jwks(&self.client, &self.jwks_url).await?;
        let key = refreshed
            .find(kid)
            .cloned()
            .ok_or_else(|| anyhow!("access token signing key is unknown after JWKS refresh"))?;
        *self.jwks.write().await = refreshed;
        Ok(key)
    }
}

async fn fetch_jwks(client: &reqwest::Client, jwks_url: &str) -> Result<JwkSet> {
    let jwks = client
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
    Ok(jwks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, routing::get, Json, Router};
    use serde_json::json;
    use std::sync::Arc;

    fn jwk(kid: &str) -> Jwk {
        serde_json::from_value(json!({
            "kty": "RSA",
            "kid": kid,
            "alg": "RS256",
            "n": "sXchmFNyxYtJyNxItQ",
            "e": "AQAB",
        }))
        .expect("test JWK must deserialize")
    }

    async fn jwks(State(keys): State<Arc<RwLock<JwkSet>>>) -> Json<JwkSet> {
        Json(keys.read().await.clone())
    }

    #[tokio::test]
    async fn refreshes_unknown_key_ids_after_oidc_rotation() {
        let keys = Arc::new(RwLock::new(JwkSet {
            keys: vec![jwk("old")],
        }));
        let app = Router::new()
            .route("/jwks", get(jwks))
            .with_state(keys.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test JWKS listener must bind");
        let address = listener
            .local_addr()
            .expect("listener address must resolve");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("test JWKS server must run");
        });

        // Keep loopback fixtures independent from developer or CI proxy
        // environment variables. Production `load` still honors the normal
        // reqwest proxy policy for real identity-provider endpoints.
        let local_client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("test HTTP client must build");
        let verifier = OidcVerifier::load_with_client(
            "https://issuer.example".into(),
            "oxide-control-plane".into(),
            &format!("http://{address}/jwks"),
            local_client,
        )
        .await
        .expect("initial JWKS must load");
        *keys.write().await = JwkSet {
            keys: vec![jwk("new")],
        };

        let refreshed = verifier
            .signing_key("new")
            .await
            .expect("unknown kid must trigger a JWKS refresh");
        assert_eq!(refreshed.common.key_id.as_deref(), Some("new"));
        server.abort();
    }
}
