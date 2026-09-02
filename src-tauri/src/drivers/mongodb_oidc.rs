//! Interactive MongoDB OIDC authentication for the bundled desktop driver.
//!
//! The MongoDB Rust driver owns token caching and SASL negotiation.  This
//! module supplies only a deliberately narrow human callback: discovery and
//! token endpoints must be HTTPS, the browser returns to one loopback address,
//! and the authorization response is bound to a high-entropy PKCE/state pair.

use std::{
    sync::{Arc, OnceLock, RwLock},
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use futures::FutureExt;
use mongodb::{
    error::Error as MongoError,
    options::{
        oidc::{Callback, CallbackContext, IdpServerResponse},
        ClientOptions,
    },
};
use reqwest::Url;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::Mutex,
};

const CALLBACK_ADDRESS: &str = "127.0.0.1:27097";
const REDIRECT_URI: &str = "http://localhost:27097/redirect";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_CALLBACK_REQUEST_BYTES: usize = 16 * 1024;

pub type BrowserOpener = Arc<dyn Fn(&str) -> Result<(), String> + Send + Sync>;

#[derive(Debug, Deserialize)]
struct DiscoveryDocument {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    scopes_supported: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

fn browser_opener() -> &'static RwLock<Option<BrowserOpener>> {
    static OPENER: OnceLock<RwLock<Option<BrowserOpener>>> = OnceLock::new();
    OPENER.get_or_init(|| RwLock::new(None))
}

fn browser_flow_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub fn set_browser_opener(opener: BrowserOpener) {
    *browser_opener()
        .write()
        .expect("MongoDB OIDC browser opener lock poisoned") = Some(opener);
}

fn oidc_error(message: impl Into<String>) -> MongoError {
    MongoError::custom(format!(
        "MongoDB OIDC authentication failed: {}",
        message.into()
    ))
}

fn https_url(value: &str, description: &str) -> Result<Url, MongoError> {
    let url =
        Url::parse(value).map_err(|error| oidc_error(format!("invalid {description}: {error}")))?;
    if url.scheme() != "https" {
        return Err(oidc_error(format!("{description} must use HTTPS")));
    }
    Ok(url)
}

fn discovery_url(issuer: &str) -> Result<Url, MongoError> {
    let mut url = https_url(issuer, "issuer URL")?;
    if url.query().is_some() || url.fragment().is_some() {
        return Err(oidc_error(
            "issuer URL must not contain a query or fragment",
        ));
    }
    url.set_path(&format!(
        "{}/.well-known/openid-configuration",
        url.path().trim_end_matches('/')
    ));
    Ok(url)
}

async fn discover(issuer: &str) -> Result<DiscoveryDocument, MongoError> {
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|error| oidc_error(format!("failed to create HTTP client: {error}")))?;
    let response = client
        .get(discovery_url(issuer)?)
        .send()
        .await
        .map_err(|error| oidc_error(format!("failed to load provider metadata: {error}")))?;
    if !response.status().is_success() {
        return Err(oidc_error(format!(
            "provider metadata endpoint returned HTTP {}",
            response.status()
        )));
    }
    let discovery = response
        .json::<DiscoveryDocument>()
        .await
        .map_err(|error| oidc_error(format!("invalid provider metadata: {error}")))?;
    if discovery.issuer != issuer {
        return Err(oidc_error(
            "provider metadata issuer does not exactly match the MongoDB server response",
        ));
    }
    https_url(&discovery.authorization_endpoint, "authorization endpoint")?;
    https_url(&discovery.token_endpoint, "token endpoint")?;
    Ok(discovery)
}

fn random_value() -> String {
    let mut bytes = [0_u8; 32];
    bytes[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

fn requested_scopes(requested: Option<Vec<String>>, supported: Option<&[String]>) -> String {
    let mut scopes = requested.unwrap_or_default();
    let supports =
        |scope: &str| supported.is_none_or(|values| values.iter().any(|value| value == scope));
    if supports("openid") && !scopes.iter().any(|scope| scope == "openid") {
        scopes.insert(0, "openid".to_string());
    }
    if supports("offline_access") && !scopes.iter().any(|scope| scope == "offline_access") {
        scopes.push("offline_access".to_string());
    }
    scopes.join(" ")
}

async fn request_token(
    endpoint: &str,
    parameters: &[(&str, &str)],
) -> Result<TokenResponse, MongoError> {
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|error| oidc_error(format!("failed to create HTTP client: {error}")))?;
    let response = client
        .post(https_url(endpoint, "token endpoint")?)
        .form(parameters)
        .send()
        .await
        .map_err(|error| oidc_error(format!("token request failed: {error}")))?;
    if !response.status().is_success() {
        return Err(oidc_error(format!(
            "token endpoint returned HTTP {}",
            response.status()
        )));
    }
    let token = response
        .json::<TokenResponse>()
        .await
        .map_err(|error| oidc_error(format!("invalid token response: {error}")))?;
    if token.access_token.trim().is_empty() {
        return Err(oidc_error("token response did not include an access token"));
    }
    Ok(token)
}

async fn write_callback_response(stream: &mut tokio::net::TcpStream, success: bool) {
    let (status, title, body) = if success {
        ("200 OK", "Authorization received", "OxideStudio received the authorization response. Return to the application while it completes the connection.")
    } else {
        (
            "400 Bad Request",
            "Authentication failed",
            "OxideStudio could not complete authentication. Return to the application for details.",
        )
    };
    let html = format!("<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head><body><h1>{title}</h1><p>{body}</p></body></html>");
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Security-Policy: default-src 'none'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}", html.len());
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn wait_for_callback(listener: TcpListener, state: &str) -> Result<String, MongoError> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|error| oidc_error(format!("callback listener failed: {error}")))?;
        let mut buffer = Vec::with_capacity(1024);
        loop {
            if buffer.len() >= MAX_CALLBACK_REQUEST_BYTES {
                break;
            }
            let mut chunk = [0_u8; 1024];
            let read_limit = (MAX_CALLBACK_REQUEST_BYTES - buffer.len()).min(chunk.len());
            let count = stream.read(&mut chunk[..read_limit]).await.unwrap_or(0);
            if count == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..count]);
            if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        let target = std::str::from_utf8(&buffer)
            .ok()
            .and_then(|request| request.lines().next())
            .and_then(|line| line.split_whitespace().nth(1));
        let Some(target) = target else {
            write_callback_response(&mut stream, false).await;
            continue;
        };
        let parsed = Url::parse(&format!("http://localhost{target}"));
        let Ok(parsed) = parsed else {
            write_callback_response(&mut stream, false).await;
            continue;
        };
        let code = parsed
            .query_pairs()
            .find_map(|(key, value)| (key == "code").then(|| value.into_owned()));
        let returned_state = parsed
            .query_pairs()
            .find_map(|(key, value)| (key == "state").then(|| value.into_owned()));
        if parsed.path() != "/redirect"
            || returned_state.as_deref() != Some(state)
            || code.as_deref().is_none_or(str::is_empty)
        {
            write_callback_response(&mut stream, false).await;
            continue;
        }
        write_callback_response(&mut stream, true).await;
        return Ok(code.expect("checked above"));
    }
}

fn token_response(token: TokenResponse, old_refresh_token: Option<String>) -> IdpServerResponse {
    let expires = token
        .expires_in
        .and_then(|seconds| Instant::now().checked_add(Duration::from_secs(seconds)));
    IdpServerResponse::builder()
        .access_token(token.access_token)
        .refresh_token(token.refresh_token.or(old_refresh_token))
        .expires(expires)
        .build()
}

async fn authenticate(
    context: CallbackContext,
    opener: BrowserOpener,
) -> Result<IdpServerResponse, MongoError> {
    let deadline = context
        .timeout
        .unwrap_or_else(|| Instant::now() + CALLBACK_TIMEOUT);
    let info = context
        .idp_info
        .ok_or_else(|| oidc_error("MongoDB server did not provide identity provider details"))?;
    let client_id = info
        .client_id
        .ok_or_else(|| oidc_error("MongoDB server did not provide an OIDC client ID"))?;
    let discovery = discover(&info.issuer).await?;
    if let Some(refresh_token) = context.refresh_token.clone() {
        if let Ok(token) = request_token(
            &discovery.token_endpoint,
            &[
                ("grant_type", "refresh_token"),
                ("client_id", &client_id),
                ("refresh_token", &refresh_token),
            ],
        )
        .await
        {
            return Ok(token_response(token, Some(refresh_token)));
        }
    }
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Err(oidc_error("browser authentication timed out"));
    }
    let _lock = tokio::time::timeout(remaining, browser_flow_lock().lock())
        .await
        .map_err(|_| oidc_error("browser authentication timed out"))?;
    let listener = TcpListener::bind(CALLBACK_ADDRESS)
        .await
        .map_err(|error| oidc_error(format!("cannot listen on {REDIRECT_URI}: {error}")))?;
    let state = random_value();
    let verifier = random_value();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut authorization_url =
        https_url(&discovery.authorization_endpoint, "authorization endpoint")?;
    authorization_url
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair(
            "scope",
            &requested_scopes(info.request_scopes, discovery.scopes_supported.as_deref()),
        )
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    opener(authorization_url.as_str()).map_err(oidc_error)?;
    let remaining = deadline.saturating_duration_since(Instant::now());
    let code = tokio::time::timeout(remaining, wait_for_callback(listener, &state))
        .await
        .map_err(|_| oidc_error("browser authentication timed out"))??;
    let token = request_token(
        &discovery.token_endpoint,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", &client_id),
            ("code", &code),
            ("redirect_uri", REDIRECT_URI),
            ("code_verifier", &verifier),
        ],
    )
    .await?;
    Ok(token_response(token, None))
}

pub fn configure_client_options(options: &mut ClientOptions) -> Result<(), MongoError> {
    let Some(credential) = options.credential.as_mut() else {
        return Ok(());
    };
    if !matches!(
        credential.mechanism,
        Some(mongodb::options::AuthMechanism::MongoDbOidc)
    ) {
        return Ok(());
    }
    if credential
        .mechanism_properties
        .as_ref()
        .is_some_and(|properties| properties.contains_key("ENVIRONMENT"))
    {
        return Ok(());
    }
    let opener = browser_opener()
        .read()
        .expect("MongoDB OIDC browser opener lock poisoned")
        .clone()
        .ok_or_else(|| {
            oidc_error(
                "interactive browser authentication is only available in the desktop application",
            )
        })?;
    credential.oidc_callback = Callback::human(move |context| {
        let opener = opener.clone();
        async move { authenticate(context, opener).await }.boxed()
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{discovery_url, requested_scopes};

    #[test]
    fn oidc_urls_require_https_and_preserve_issuer_path() {
        assert!(discovery_url("http://idp.example").is_err());
        assert_eq!(
            discovery_url("https://idp.example/realms/oxide")
                .unwrap()
                .as_str(),
            "https://idp.example/realms/oxide/.well-known/openid-configuration"
        );
    }

    #[test]
    fn scopes_include_required_values_without_duplicates() {
        assert_eq!(
            requested_scopes(Some(vec!["profile".to_string()]), None),
            "openid profile offline_access"
        );
        assert_eq!(
            requested_scopes(
                Some(vec!["openid".to_string(), "offline_access".to_string()]),
                None
            ),
            "openid offline_access"
        );
    }
}
