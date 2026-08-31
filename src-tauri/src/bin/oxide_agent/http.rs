use crate::oxide_agent::{
    http_auth::{authorize_request, HttpAuth},
    mcp::OxideMcpServer,
    runtime::ToolRuntime,
};
use anyhow::{anyhow, Context, Result};
use axum::{
    http::{HeaderValue, Method},
    middleware,
    response::IntoResponse,
    routing::get,
    Router,
};
use rmcp::transport::{
    streamable_http_server::{session::local::LocalSessionManager, tower::StreamableHttpService},
    StreamableHttpServerConfig,
};
use std::{
    fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

const MAX_TOKEN_FILE_BYTES: u64 = 4096;

pub struct HttpConfig {
    pub bind_addr: SocketAddr,
    pub path: String,
    pub token_file: PathBuf,
    pub allowed_hosts: Vec<String>,
    pub allowed_origins: Vec<String>,
    pub allow_remote: bool,
}

impl HttpConfig {
    pub fn validate(self) -> Result<ValidatedHttpConfig> {
        validate_path(&self.path)?;
        let is_loopback = self.bind_addr.ip().is_loopback();
        if !is_loopback && !self.allow_remote {
            return Err(anyhow!(
                "non-loopback MCP HTTP binding requires --allow-remote"
            ));
        }
        if !is_loopback && (self.allowed_hosts.is_empty() || self.allowed_origins.is_empty()) {
            return Err(anyhow!(
                "remote MCP HTTP binding requires allowed hosts and allowed origins"
            ));
        }
        let allowed_hosts = if is_loopback && self.allowed_hosts.is_empty() {
            vec![
                "localhost".to_string(),
                "127.0.0.1".to_string(),
                "::1".to_string(),
            ]
        } else {
            validate_allowed_hosts(self.allowed_hosts)?
        };
        let token = read_token_file(&self.token_file)?;
        let auth =
            HttpAuth::new(token, self.allowed_origins, is_loopback).map_err(anyhow::Error::msg)?;
        Ok(ValidatedHttpConfig {
            bind_addr: self.bind_addr,
            path: self.path,
            auth,
            allowed_hosts,
        })
    }
}

pub struct ValidatedHttpConfig {
    bind_addr: SocketAddr,
    path: String,
    auth: HttpAuth,
    allowed_hosts: Vec<String>,
}

pub async fn serve(runtime: Arc<ToolRuntime>, config: HttpConfig) -> Result<()> {
    let config = config.validate()?;
    let listener = tokio::net::TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("failed to bind MCP HTTP listener at {}", config.bind_addr))?;
    let cancellation = CancellationToken::new();
    let signal = cancellation.clone();
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            signal.cancel();
        }
    });
    serve_on_listener(runtime, config, cancellation, listener).await
}

async fn serve_on_listener(
    runtime: Arc<ToolRuntime>,
    config: ValidatedHttpConfig,
    cancellation: CancellationToken,
    listener: tokio::net::TcpListener,
) -> Result<()> {
    let bind_addr = listener.local_addr()?;
    let path = config.path.clone();
    let router = router(runtime, config, cancellation.child_token());
    eprintln!("oxide-agent MCP HTTP listening on http://{bind_addr}{path}");
    axum::serve(listener, router)
        .with_graceful_shutdown(async move { cancellation.cancelled().await })
        .await
        .context("MCP HTTP server stopped unexpectedly")
}

fn router(
    runtime: Arc<ToolRuntime>,
    config: ValidatedHttpConfig,
    cancellation: CancellationToken,
) -> Router {
    let rmcp_config = StreamableHttpServerConfig::default()
        .with_allowed_hosts(config.allowed_hosts)
        .with_cancellation_token(cancellation);
    let service: StreamableHttpService<OxideMcpServer, LocalSessionManager> =
        StreamableHttpService::new(
            move || Ok(OxideMcpServer::new(runtime.clone())),
            Default::default(),
            rmcp_config,
        );
    let cors_auth = config.auth.clone();
    let mcp = Router::new()
        .nest_service(&config.path, service)
        .layer(middleware::from_fn_with_state(
            config.auth,
            authorize_request,
        ))
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::predicate(move |origin, _| {
                    origin
                        .to_str()
                        .is_ok_and(|origin| cors_auth.origin_is_allowed(origin))
                }))
                .allow_methods([Method::GET, Method::POST, Method::DELETE])
                .allow_headers(Any),
        );
    Router::new()
        .route("/healthz", get(health))
        .route("/readyz", get(health))
        .merge(mcp)
}

async fn health() -> impl IntoResponse {
    (
        [(
            "x-oxide-agent-service",
            HeaderValue::from_static("read-only-mcp-v1"),
        )],
        "ok",
    )
}

fn validate_path(path: &str) -> Result<()> {
    if path == "/"
        || !path.starts_with('/')
        || path.ends_with('/')
        || path.contains('?')
        || path.contains('#')
        || path.contains("//")
        || path.chars().any(char::is_control)
    {
        return Err(anyhow!(
            "MCP HTTP path must be an absolute path such as /mcp"
        ));
    }
    Ok(())
}

fn validate_allowed_hosts(hosts: Vec<String>) -> Result<Vec<String>> {
    let mut normalized = Vec::new();
    for host in hosts {
        let host = host.trim().to_ascii_lowercase();
        if host.is_empty()
            || host.len() > 253
            || host.contains('/')
            || host.contains('@')
            || host.chars().any(char::is_whitespace)
        {
            return Err(anyhow!("invalid MCP HTTP allowed host"));
        }
        if !normalized.contains(&host) {
            normalized.push(host);
        }
    }
    Ok(normalized)
}

fn read_token_file(path: &Path) -> Result<String> {
    let link_metadata = fs::symlink_metadata(path)
        .with_context(|| format!("failed to inspect MCP HTTP token file {}", path.display()))?;
    if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
        return Err(anyhow!(
            "MCP HTTP token path must be a regular, non-symlink file"
        ));
    }
    if link_metadata.len() == 0 || link_metadata.len() > MAX_TOKEN_FILE_BYTES {
        return Err(anyhow!(
            "MCP HTTP token file must contain between 1 and {MAX_TOKEN_FILE_BYTES} bytes"
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if link_metadata.permissions().mode() & 0o077 != 0 {
            return Err(anyhow!(
                "MCP HTTP token file must not be readable or writable by group or other users"
            ));
        }
    }
    let token = fs::read_to_string(path)
        .with_context(|| format!("failed to read MCP HTTP token file {}", path.display()))?;
    let token = token.trim_end_matches(['\r', '\n']).to_string();
    if token.contains(['\r', '\n']) {
        return Err(anyhow!("MCP HTTP token file must contain exactly one line"));
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oxide_agent::{
        catalog,
        policy::{DatabaseScope, Grant, ToolScope},
        store::HeadlessStore,
    };
    use futures::StreamExt;
    use serde_json::{json, Value};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::io::Write;

    #[test]
    fn http_path_rejects_root_query_fragment_and_empty_segments() {
        for path in ["", "/", "mcp", "/mcp/", "/mcp?x=1", "/mcp#x", "/mcp//v1"] {
            assert!(validate_path(path).is_err(), "path {path} must be rejected");
        }
        assert!(validate_path("/mcp").is_ok());
        assert!(validate_path("/api/mcp").is_ok());
    }

    #[test]
    fn token_file_must_be_regular_and_bounded() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("token");
        let mut file = fs::File::create(&path).unwrap();
        writeln!(file, "0123456789abcdef0123456789abcdef").unwrap();
        drop(file);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        assert_eq!(
            read_token_file(&path).unwrap(),
            "0123456789abcdef0123456789abcdef"
        );
        assert!(read_token_file(root.path()).is_err());
    }

    #[test]
    fn remote_bind_requires_explicit_opt_in_and_origin_host_scopes() {
        let root = tempfile::tempdir().unwrap();
        let token_file = root.path().join("token");
        fs::write(&token_file, "0123456789abcdef0123456789abcdef").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&token_file, fs::Permissions::from_mode(0o600)).unwrap();
        }
        let config =
            |allow_remote, allowed_hosts: Vec<String>, allowed_origins: Vec<String>| HttpConfig {
                bind_addr: "0.0.0.0:43521".parse().unwrap(),
                path: "/mcp".to_string(),
                token_file: token_file.clone(),
                allowed_hosts,
                allowed_origins,
                allow_remote,
            };
        assert!(config(false, vec![], vec![]).validate().is_err());
        assert!(config(true, vec![], vec![]).validate().is_err());
        assert!(config(
            true,
            vec!["db.example.com".to_string()],
            vec!["https://db.example.com".to_string()]
        )
        .validate()
        .is_ok());
    }

    #[tokio::test]
    async fn streamable_http_initializes_and_filters_tools_by_grant() {
        let root = tempfile::tempdir().unwrap();
        let database_path = root.path().join("metadata.db");
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&database_path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE projects (id TEXT PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE connections (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, driver TEXT NOT NULL, config TEXT NOT NULL, updated_at INTEGER NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects (id) VALUES ('project-http')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let store = HeadlessStore::open(root.path()).await.unwrap();
        let grant = Grant::new_with_scopes(
            "project-http".to_string(),
            None,
            200,
            256 * 1024,
            DatabaseScope::All,
            ToolScope::Selected(vec![catalog::CONNECTION_SUMMARIES.to_string()]),
        )
        .unwrap();
        let runtime = Arc::new(ToolRuntime::new(store, grant, Some(5)).await.unwrap());
        let cancellation = CancellationToken::new();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(serve_on_listener(
            runtime,
            ValidatedHttpConfig {
                bind_addr: address,
                path: "/mcp".to_string(),
                auth: HttpAuth::new("0123456789abcdef0123456789abcdef".to_string(), [], true)
                    .unwrap(),
                allowed_hosts: vec!["127.0.0.1".to_string()],
            },
            cancellation.clone(),
            listener,
        ));

        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        let endpoint = format!("http://{address}/mcp");
        let authorize = |request: reqwest::RequestBuilder| {
            request
                .header("Authorization", "Bearer 0123456789abcdef0123456789abcdef")
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
        };
        let initialize = authorize(client.post(&endpoint))
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": { "name": "oxide-http-test", "version": "1" }
                }
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(initialize.status(), reqwest::StatusCode::OK);
        let session = initialize
            .headers()
            .get("mcp-session-id")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let initialized: Value = parse_sse_json(initialize).await;
        assert_eq!(initialized["result"]["protocolVersion"], "2025-11-25");
        assert_eq!(initialized["result"]["serverInfo"]["name"], "oxide-agent");

        let notification = authorize(client.post(&endpoint))
            .header("mcp-session-id", &session)
            .header("mcp-protocol-version", "2025-11-25")
            .json(&json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }))
            .send()
            .await
            .unwrap();
        assert!(notification.status().is_success());

        let listed = authorize(client.post(&endpoint))
            .header("mcp-session-id", &session)
            .header("mcp-protocol-version", "2025-11-25")
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {}
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(listed.status(), reqwest::StatusCode::OK);
        let listed: Value = parse_sse_json(listed).await;
        let tools = listed["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], catalog::CONNECTION_SUMMARIES);

        cancellation.cancel();
        server.await.unwrap().unwrap();
    }

    async fn parse_sse_json(response: reqwest::Response) -> Value {
        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        loop {
            let chunk = tokio::time::timeout(std::time::Duration::from_secs(5), stream.next())
                .await
                .expect("SSE response timed out")
                .expect("SSE response ended before a data event")
                .expect("SSE response chunk failed");
            body.extend_from_slice(&chunk);
            let body_text = String::from_utf8_lossy(&body);
            if let Some(value) = body_text
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(str::trim)
                .filter(|payload| !payload.is_empty())
                .find_map(|payload| serde_json::from_str::<Value>(payload).ok())
            {
                return value;
            }
            assert!(body.len() <= 256 * 1024, "SSE response exceeded test bound");
        }
    }
}
