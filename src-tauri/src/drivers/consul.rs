use crate::core::{
    driver::DatabaseDriver,
    protocol::{CollectionInfo, CollectionPage, ColumnDef, QueryResult},
};
use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use reqwest::{Client, Response, StatusCode, Url};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const CONSUL_RESPONSE_MAX_BYTES: usize = 8 * 1024 * 1024;
const CONSUL_ERROR_MAX_BYTES: usize = 64 * 1024;
const CONSUL_PAGE_LIMIT: usize = 1_000;
const CONSUL_VALUE_PREVIEW_MAX_BYTES: usize = 64 * 1024;
const PATH_SEGMENT_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'?')
    .add(b'[')
    .add(b'\\')
    .add(b']');

/// A deliberately read-only Consul KV browser. The DBX Consul workspace has
/// many operational/write endpoints; exposing an arbitrary REST console here
/// would bypass the desktop's approval model, so this driver only owns the
/// fixed health and KV-key listing endpoints.
pub struct ConsulDriver {
    client: Client,
    base_url: Url,
    token: Option<String>,
    connected: AtomicBool,
}

impl ConsulDriver {
    pub fn new(connection_url: &str) -> Result<Self> {
        let (base_url, token) = parse_consul_connection_url(connection_url)?;
        let client_builder = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30));
        #[cfg(test)]
        let client_builder = client_builder.no_proxy();
        Ok(Self {
            client: client_builder
                .build()
                .context("Failed to configure Consul HTTP client")?,
            base_url,
            token,
            connected: AtomicBool::new(false),
        })
    }

    fn ensure_connected(&self) -> Result<()> {
        if self.connected.load(Ordering::Acquire) {
            Ok(())
        } else {
            bail!("Consul connection is not established")
        }
    }

    fn endpoint(&self, suffix: &str) -> Result<Url> {
        self.base_url
            .join(suffix.trim_start_matches('/'))
            .context("Invalid Consul endpoint")
    }

    fn request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.token.as_deref().filter(|token| !token.is_empty()) {
            Some(token) => request.header("X-Consul-Token", token),
            None => request,
        }
    }

    async fn read_json(&self, url: Url, operation: &str) -> Result<Value> {
        let response = self
            .request(self.client.get(url))
            .send()
            .await
            .with_context(|| format!("Consul {operation} request failed"))?;
        parse_consul_response(response, operation).await
    }

    async fn list_prefix(&self, prefix: &str) -> Result<Vec<String>> {
        validate_prefix(prefix)?;
        let encoded = prefix
            .split('/')
            .filter(|segment| !segment.is_empty())
            .map(|segment| utf8_percent_encode(segment, PATH_SEGMENT_ENCODE_SET).to_string())
            .collect::<Vec<_>>()
            .join("/");
        let suffix = if encoded.is_empty() {
            "v1/kv/".to_string()
        } else {
            format!("v1/kv/{encoded}")
        };
        let mut url = self.endpoint(&suffix)?;
        url.query_pairs_mut()
            .append_pair("keys", "")
            .append_pair("separator", "/");
        let data = self.read_json(url, "KV key listing").await?;
        let mut keys = data
            .as_array()
            .ok_or_else(|| anyhow!("Consul returned invalid KV key list JSON"))?
            .iter()
            .filter_map(Value::as_str)
            .filter(|key| valid_key(key))
            .map(str::to_string)
            .collect::<Vec<_>>();
        keys.sort_unstable();
        keys.dedup();
        if keys.len() > CONSUL_PAGE_LIMIT * 10 {
            bail!("Consul KV prefix contains too many keys to browse safely")
        }
        Ok(keys)
    }

    async fn get_key(&self, key: &str) -> Result<QueryResult> {
        validate_prefix(key)?;
        if key.is_empty() || key.ends_with('/') {
            bail!("Consul GET requires one concrete KV key")
        }
        let encoded = key
            .split('/')
            .map(|segment| utf8_percent_encode(segment, PATH_SEGMENT_ENCODE_SET).to_string())
            .collect::<Vec<_>>()
            .join("/");
        let data = self
            .read_json(self.endpoint(&format!("v1/kv/{encoded}"))?, "KV key read")
            .await?;
        let entry = data
            .as_array()
            .and_then(|entries| entries.first())
            .and_then(Value::as_object)
            .ok_or_else(|| anyhow!("Consul returned invalid KV key JSON"))?;
        let value = entry.get("Value").and_then(Value::as_str).unwrap_or("");
        let bytes = STANDARD
            .decode(value)
            .context("Consul KV value is not valid base64")?;
        let truncated = bytes.len() > CONSUL_VALUE_PREVIEW_MAX_BYTES;
        let visible = &bytes[..bytes.len().min(CONSUL_VALUE_PREVIEW_MAX_BYTES)];
        let preview = String::from_utf8(visible.to_vec())
            .map(Value::String)
            .unwrap_or_else(|_| Value::String(STANDARD.encode(visible)));
        let mut result = QueryResult::rows(
            vec![
                ColumnDef {
                    name: "key".to_string(),
                    data_type: "string".to_string(),
                },
                ColumnDef {
                    name: "value".to_string(),
                    data_type: "string".to_string(),
                },
                ColumnDef {
                    name: "modify_index".to_string(),
                    data_type: "string".to_string(),
                },
            ],
            vec![vec![
                Value::String(key.to_string()),
                preview,
                entry.get("ModifyIndex").cloned().unwrap_or(Value::Null),
            ]],
        );
        result.truncated = truncated;
        result.row_limit = truncated.then_some(CONSUL_VALUE_PREVIEW_MAX_BYTES);
        result.message =
            truncated.then(|| "Consul KV value preview is truncated at 64 KiB".to_string());
        Ok(result)
    }
}

#[async_trait]
impl DatabaseDriver for ConsulDriver {
    async fn connect(&mut self) -> Result<()> {
        let value = self
            .read_json(self.endpoint("v1/agent/self")?, "agent health")
            .await?;
        if !value.is_object() {
            bail!("Consul agent health response is invalid")
        }
        self.connected.store(true, Ordering::Release);
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        self.connected.store(false, Ordering::Release);
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        self.ensure_connected()?;
        let value = self
            .read_json(self.endpoint("v1/status/leader")?, "leader health")
            .await?;
        if value.as_str().is_none() {
            bail!("Consul leader health response is invalid")
        }
        Ok(())
    }

    async fn query(&self, command: &str) -> Result<Vec<QueryResult>> {
        self.ensure_connected()?;
        let command = command.trim();
        let key = command
            .strip_prefix("GET ")
            .or_else(|| command.strip_prefix("get "))
            .ok_or_else(|| anyhow!("Consul only supports GET <JSON-quoted-key> previews"))?;
        let key: String =
            serde_json::from_str(key.trim()).context("Consul GET requires a JSON-quoted key")?;
        Ok(vec![self.get_key(&key).await?])
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        self.ensure_connected()?;
        Ok(vec!["kv".to_string()])
    }

    async fn get_collections(&self, namespace: &str) -> Result<Vec<CollectionInfo>> {
        Ok(self
            .get_collections_page(namespace, None, 100, None)
            .await?
            .items)
    }

    async fn get_collections_page(
        &self,
        namespace: &str,
        cursor: Option<&str>,
        limit: usize,
        filter: Option<&str>,
    ) -> Result<CollectionPage> {
        self.ensure_connected()?;
        if !namespace.trim().is_empty() && namespace != "kv" {
            return Ok(CollectionPage {
                items: Vec::new(),
                next_cursor: None,
                total: Some(0),
            });
        }
        let filter = filter.unwrap_or("").trim();
        if filter.len() > 512 || filter.contains('\0') {
            bail!("Consul KV filter is invalid")
        }
        let start = cursor
            .map(str::trim)
            .filter(|cursor| !cursor.is_empty())
            .map(str::to_string);
        let keys = self.list_prefix("").await?;
        let filtered = keys
            .into_iter()
            .filter(|key| filter.is_empty() || key.contains(filter))
            .filter(|key| start.as_deref().is_none_or(|after| key.as_str() > after))
            .collect::<Vec<_>>();
        let limit = limit.clamp(1, CONSUL_PAGE_LIMIT);
        let more = filtered.len() > limit;
        let items = filtered
            .into_iter()
            .take(limit)
            .map(|name| CollectionInfo {
                name,
                namespace: Some("kv".to_string()),
                collection_type: Some("KEY_OR_PREFIX".to_string()),
                document_count: None,
            })
            .collect::<Vec<_>>();
        Ok(CollectionPage {
            next_cursor: more
                .then(|| items.last().map(|item| item.name.clone()))
                .flatten(),
            total: None,
            items,
        })
    }
}

fn parse_consul_connection_url(value: &str) -> Result<(Url, Option<String>)> {
    let mut url = Url::parse(value.trim()).context("Invalid Consul connection URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!("Consul connection URL must use HTTP or HTTPS and contain a host")
    }
    let token = url
        .password()
        .map(str::to_string)
        .filter(|token| !token.is_empty());
    url.set_username("")
        .map_err(|_| anyhow!("Invalid Consul username"))?;
    url.set_password(None)
        .map_err(|_| anyhow!("Invalid Consul token"))?;
    url.set_query(None);
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/').to_string();
    let normalized_path = if path.is_empty() {
        "/".to_string()
    } else {
        format!("{path}/")
    };
    url.set_path(&normalized_path);
    Ok((url, token))
}

fn validate_prefix(value: &str) -> Result<()> {
    if value.len() > 1_024 || value.contains('\0') || value.contains("..") {
        bail!("Consul KV prefix is invalid")
    }
    Ok(())
}

fn valid_key(value: &str) -> bool {
    !value.is_empty() && value.len() <= 4_096 && !value.contains('\0')
}

async fn parse_consul_response(response: Response, operation: &str) -> Result<Value> {
    let status = response.status();
    let limit = if status.is_success() {
        CONSUL_RESPONSE_MAX_BYTES
    } else {
        CONSUL_ERROR_MAX_BYTES
    };
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        bail!("Consul {operation} response exceeds the safety limit")
    }
    let body = response
        .bytes()
        .await
        .with_context(|| format!("Failed to read Consul {operation} response"))?;
    if body.len() > limit {
        bail!("Consul {operation} response exceeds the safety limit")
    }
    if !status.is_success() {
        let hint = match status {
            StatusCode::UNAUTHORIZED => "Unauthorized; check the Consul token",
            StatusCode::FORBIDDEN => "Access denied",
            StatusCode::NOT_FOUND => "Endpoint not found",
            _ => "Request failed",
        };
        bail!(
            "Consul {operation} returned HTTP {}: {hint}",
            status.as_u16()
        )
    }
    serde_json::from_slice(&body)
        .with_context(|| format!("Consul {operation} returned invalid JSON"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::time::timeout;

    async fn serve_test_http_responses(
        responses: Vec<&'static str>,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let mut requests = Vec::new();
            for body in responses {
                let Ok(Ok((mut socket, _))) =
                    timeout(Duration::from_millis(500), listener.accept()).await
                else {
                    break;
                };
                let mut request = vec![0u8; 8 * 1024];
                let Ok(Ok(size)) =
                    timeout(Duration::from_millis(500), socket.read(&mut request)).await
                else {
                    break;
                };
                requests.push(String::from_utf8_lossy(&request[..size]).to_string());
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body,
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        (format!("http://:test-token@{address}/tenant"), handle)
    }

    #[test]
    fn url_redacts_token_and_preserves_base_path() {
        let (url, token) = parse_consul_connection_url(
            "https://:secret@consul.example.test:8501/edge/consul?dc=ignored",
        )
        .unwrap();
        assert_eq!(token.as_deref(), Some("secret"));
        assert_eq!(
            url.as_str(),
            "https://consul.example.test:8501/edge/consul/"
        );
    }

    #[test]
    fn prefix_and_key_validation_reject_transport_escapes() {
        assert!(validate_prefix("services/api").is_ok());
        assert!(validate_prefix("../admin").is_err());
        assert!(!valid_key(""));
        assert!(!valid_key("a\0b"));
    }

    #[tokio::test]
    async fn native_browser_uses_only_agent_leader_and_kv_key_endpoints() {
        let (url, server) = serve_test_http_responses(vec![
            r#"{"Config":{"NodeName":"test"}}"#,
            r#""127.0.0.1:8300""#,
            r#"["api/","app/config","app/feature"]"#,
            r#"[{"Key":"app/config","Value":"eyJlbmFibGVkIjp0cnVlfQ==","ModifyIndex":42}]"#,
        ])
        .await;
        let mut driver = ConsulDriver::new(&url).unwrap();
        driver.connect().await.unwrap();
        driver.ping().await.unwrap();
        let page = driver
            .get_collections_page("kv", None, 2, Some("app"))
            .await
            .unwrap();
        assert_eq!(
            page.items
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            vec!["app/config", "app/feature"]
        );
        let preview = driver.query(r#"GET "app/config""#).await.unwrap();
        assert_eq!(
            preview[0].rows[0][0],
            Value::String("app/config".to_string())
        );
        assert_eq!(
            preview[0].rows[0][1],
            Value::String(r#"{"enabled":true}"#.to_string())
        );
        assert_eq!(preview[0].rows[0][2], Value::from(42));
        let requests = server.await.unwrap();
        assert!(requests[0].starts_with("GET /tenant/v1/agent/self HTTP/1.1"));
        assert!(requests[1].starts_with("GET /tenant/v1/status/leader HTTP/1.1"));
        assert!(requests[2].starts_with("GET /tenant/v1/kv/?keys=&separator=%2F HTTP/1.1"));
        assert!(requests[3].starts_with("GET /tenant/v1/kv/app/config HTTP/1.1"));
        assert!(requests
            .iter()
            .all(|request| request.contains("x-consul-token: test-token")));
    }
}
