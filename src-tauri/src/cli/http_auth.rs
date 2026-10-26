use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::{collections::HashSet, sync::Arc};
use url::Url;

/// Authentication and browser-origin policy for the public read-only MCP
/// endpoint. The bearer token is intentionally omitted from Debug output and
/// diagnostics.
#[derive(Clone)]
pub struct HttpAuth {
    token: Arc<[u8]>,
    allowed_origins: Arc<HashSet<String>>,
    allow_loopback_origins: bool,
}

impl HttpAuth {
    pub fn new(
        token: String,
        allowed_origins: impl IntoIterator<Item = String>,
        allow_loopback_origins: bool,
    ) -> Result<Self, String> {
        validate_token(&token)?;
        let mut normalized_origins = HashSet::new();
        for origin in allowed_origins {
            normalized_origins.insert(normalize_origin(&origin)?);
        }
        Ok(Self {
            token: Arc::from(token.into_bytes()),
            allowed_origins: Arc::new(normalized_origins),
            allow_loopback_origins,
        })
    }

    fn token_matches(&self, candidate: &str) -> bool {
        let candidate = candidate.as_bytes();
        if candidate.len() != self.token.len() {
            return false;
        }
        self.token
            .iter()
            .zip(candidate)
            .fold(0_u8, |difference, (expected, actual)| {
                difference | (expected ^ actual)
            })
            == 0
    }

    pub fn origin_is_allowed(&self, origin: &str) -> bool {
        let Ok(origin) = normalize_origin(origin) else {
            return false;
        };
        self.allowed_origins.contains(&origin)
            || (self.allow_loopback_origins && origin_is_loopback(&origin))
    }
}

pub async fn authorize_request(
    State(auth): State<HttpAuth>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    if let Some(origin) = request.headers().get(header::ORIGIN) {
        let Ok(origin) = origin.to_str() else {
            eprintln!(
                "oxide-agent MCP HTTP rejected: method={method} path={path} reason=invalid-origin"
            );
            return forbidden();
        };
        if !auth.origin_is_allowed(origin) {
            eprintln!(
                "oxide-agent MCP HTTP rejected: method={method} path={path} reason=origin-not-allowed"
            );
            return forbidden();
        }
    }

    let Some(token) = bearer_token(request.headers().get(header::AUTHORIZATION)) else {
        eprintln!(
            "oxide-agent MCP HTTP rejected: method={method} path={path} reason=missing-bearer-token"
        );
        return unauthorized();
    };
    if !auth.token_matches(token) {
        eprintln!(
            "oxide-agent MCP HTTP rejected: method={method} path={path} reason=invalid-bearer-token"
        );
        return unauthorized();
    }

    let response = next.run(request).await;
    eprintln!(
        "oxide-agent MCP HTTP authenticated: method={method} path={path} status={}",
        response.status()
    );
    response
}

fn validate_token(token: &str) -> Result<(), String> {
    let length = token.len();
    if !(32..=4096).contains(&length) || token.chars().any(char::is_whitespace) {
        return Err(
            "MCP HTTP bearer token must contain 32 to 4096 bytes and no whitespace".to_string(),
        );
    }
    Ok(())
}

fn bearer_token(value: Option<&HeaderValue>) -> Option<&str> {
    let value = value?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bearer")
        && !token.is_empty()
        && !token.chars().any(char::is_whitespace))
    .then_some(token)
}

fn normalize_origin(origin: &str) -> Result<String, String> {
    let url = Url::parse(origin).map_err(|_| format!("invalid allowed origin: {origin}"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(format!(
            "allowed origin must be an HTTP(S) origin without credentials, path, query, or fragment: {origin}"
        ));
    }
    Ok(url.origin().ascii_serialization())
}

fn origin_is_loopback(origin: &str) -> bool {
    let Ok(url) = Url::parse(origin) else {
        return false;
    };
    match url.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback()),
        None => false,
    }
}

fn unauthorized() -> Response {
    let mut response = (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    response
        .headers_mut()
        .insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
    response
}

fn forbidden() -> Response {
    (StatusCode::FORBIDDEN, "Forbidden").into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, middleware, routing::get, Router};
    use tower::ServiceExt;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn token_requires_entropy_sized_non_whitespace_value() {
        assert!(HttpAuth::new(TOKEN.to_string(), [], true).is_ok());
        assert!(HttpAuth::new("short".to_string(), [], true).is_err());
        assert!(HttpAuth::new(format!("{TOKEN} bad"), [], true).is_err());
    }

    #[test]
    fn loopback_and_explicit_origins_are_normalized() {
        let auth = HttpAuth::new(
            TOKEN.to_string(),
            ["https://EXAMPLE.com:443".to_string()],
            true,
        )
        .unwrap();
        assert!(auth.origin_is_allowed("https://example.com"));
        assert!(auth.origin_is_allowed("http://localhost:1420"));
        assert!(auth.origin_is_allowed("http://127.0.0.1:9000"));
        assert!(!auth.origin_is_allowed("https://attacker.example"));
        assert!(!auth.origin_is_allowed("https://example.com/path"));
    }

    #[tokio::test]
    async fn middleware_rejects_missing_wrong_token_and_disallowed_origin() {
        let auth = HttpAuth::new(TOKEN.to_string(), [], true).unwrap();
        let app = Router::new()
            .route("/mcp", get(|| async { "ok" }))
            .layer(middleware::from_fn_with_state(auth, authorize_request));

        let missing = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/mcp")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            missing.headers().get(header::WWW_AUTHENTICATE),
            Some(&HeaderValue::from_static("Bearer"))
        );

        let wrong = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/mcp")
                    .header(
                        header::AUTHORIZATION,
                        "Bearer 00000000000000000000000000000000",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);

        let bad_origin = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/mcp")
                    .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
                    .header(header::ORIGIN, "https://attacker.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bad_origin.status(), StatusCode::FORBIDDEN);

        let allowed = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/mcp")
                    .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
                    .header(header::ORIGIN, "http://localhost:1420")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);
    }
}
