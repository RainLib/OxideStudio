use crate::core::{
    driver::DatabaseDriver,
    protocol::{CollectionInfo, CollectionPage, ColumnDef, QueryResult},
};
use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures::StreamExt;
use reqwest::{Client, Response, StatusCode, Url};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const ETCD_RESPONSE_MAX_BYTES: usize = 8 * 1024 * 1024;
const ETCD_ERROR_MAX_BYTES: usize = 64 * 1024;
const ETCD_PAGE_LIMIT: usize = 1_000;
const ETCD_SCAN_LIMIT: usize = 10_000;
const ETCD_VALUE_PREVIEW_MAX_BYTES: usize = 64 * 1024;

/// Read-only etcd v3 JSON-gateway browser. DBX uses a dedicated gRPC agent for
/// watches, leases, maintenance and mutations; those capabilities deliberately
/// remain unavailable until Oxide has an equivalent scoped-approval bridge.
pub struct EtcdDriver {
    client: Client,
    base_url: Url,
    basic_auth: Option<(String, String)>,
    connected: AtomicBool,
}

impl EtcdDriver {
    pub fn new(connection_url: &str) -> Result<Self> {
        let (base_url, basic_auth) = parse_etcd_connection_url(connection_url)?;
        let client_builder = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30));
        #[cfg(test)]
        let client_builder = client_builder.no_proxy();
        Ok(Self {
            client: client_builder
                .build()
                .context("Failed to configure etcd HTTP client")?,
            base_url,
            basic_auth,
            connected: AtomicBool::new(false),
        })
    }

    fn ensure_connected(&self) -> Result<()> {
        if self.connected.load(Ordering::Acquire) {
            Ok(())
        } else {
            bail!("etcd connection is not established")
        }
    }

    fn endpoint(&self, suffix: &str) -> Result<Url> {
        self.base_url
            .join(suffix.trim_start_matches('/'))
            .context("Invalid etcd endpoint")
    }

    fn request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.basic_auth.as_ref() {
            Some((username, password)) => request.basic_auth(username, Some(password)),
            None => request,
        }
    }

    async fn read_json(&self, request: reqwest::RequestBuilder, operation: &str) -> Result<Value> {
        let response = self
            .request(request)
            .send()
            .await
            .with_context(|| format!("etcd {operation} request failed"))?;
        parse_etcd_response(response, operation).await
    }

    async fn range(
        &self,
        key: &str,
        start_after: Option<&str>,
        limit: usize,
        keys_only: bool,
    ) -> Result<EtcdRange> {
        validate_key(key)?;
        if let Some(cursor) = start_after {
            validate_key(cursor)?;
        }
        let start_key = start_after.map_or_else(|| key.as_bytes().to_vec(), next_key);
        let range_end = prefix_end(key.as_bytes());
        let mut body = json!({
            "key": STANDARD.encode(start_key),
            "limit": limit.clamp(1, ETCD_SCAN_LIMIT).to_string(),
            "keys_only": keys_only,
        });
        if let Some(range_end) = range_end {
            body["range_end"] = Value::String(STANDARD.encode(range_end));
        }
        let value = self
            .read_json(
                self.client.post(self.endpoint("v3/kv/range")?).json(&body),
                "KV range",
            )
            .await?;
        let more = value.get("more").and_then(Value::as_bool).unwrap_or(false);
        let kvs = value
            .get("kvs")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut entries = Vec::with_capacity(kvs.len());
        for entry in kvs {
            let key = entry
                .get("key")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("etcd returned a KV item without a key"))?;
            let decoded = STANDARD
                .decode(key)
                .context("etcd returned an invalid base64 key")?;
            let key = String::from_utf8(decoded)
                .context("etcd key is binary and cannot be shown in the generic KV explorer")?;
            if valid_key(&key) {
                entries.push((key, entry));
            }
        }
        Ok(EtcdRange { entries, more })
    }

    async fn get_key(&self, key: &str) -> Result<QueryResult> {
        let range = self.range(key, None, 1, false).await?;
        let (_, entry) = range
            .entries
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("etcd key does not exist"))?;
        let value = entry.get("value").and_then(Value::as_str).unwrap_or("");
        let bytes = STANDARD
            .decode(value)
            .context("etcd returned an invalid base64 value")?;
        let truncated = bytes.len() > ETCD_VALUE_PREVIEW_MAX_BYTES;
        let visible = &bytes[..bytes.len().min(ETCD_VALUE_PREVIEW_MAX_BYTES)];
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
                    name: "mod_revision".to_string(),
                    data_type: "string".to_string(),
                },
                ColumnDef {
                    name: "version".to_string(),
                    data_type: "string".to_string(),
                },
            ],
            vec![vec![
                Value::String(key.to_string()),
                preview,
                entry.get("mod_revision").cloned().unwrap_or(Value::Null),
                entry.get("version").cloned().unwrap_or(Value::Null),
            ]],
        );
        result.truncated = truncated;
        result.row_limit = truncated.then_some(ETCD_VALUE_PREVIEW_MAX_BYTES);
        result.message = truncated.then(|| "etcd value preview is truncated at 64 KiB".to_string());
        Ok(result)
    }
}

struct EtcdRange {
    entries: Vec<(String, Value)>,
    more: bool,
}

#[async_trait]
impl DatabaseDriver for EtcdDriver {
    async fn connect(&mut self) -> Result<()> {
        let value = self
            .read_json(self.client.get(self.endpoint("health")?), "health")
            .await?;
        if !value
            .get("health")
            .and_then(Value::as_str)
            .is_some_and(|health| health.eq_ignore_ascii_case("true"))
        {
            bail!("etcd health response is invalid or unhealthy")
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
            .read_json(self.client.get(self.endpoint("health")?), "health")
            .await?;
        if !value
            .get("health")
            .and_then(Value::as_str)
            .is_some_and(|health| health.eq_ignore_ascii_case("true"))
        {
            bail!("etcd health response is invalid or unhealthy")
        }
        Ok(())
    }

    async fn query(&self, command: &str) -> Result<Vec<QueryResult>> {
        self.ensure_connected()?;
        let key = command
            .trim()
            .strip_prefix("GET ")
            .or_else(|| command.trim().strip_prefix("get "))
            .ok_or_else(|| anyhow!("etcd only supports GET <JSON-quoted-key> previews"))?;
        let key: String =
            serde_json::from_str(key.trim()).context("etcd GET requires a JSON-quoted key")?;
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
            bail!("etcd KV filter is invalid")
        }
        let range = self.range("", cursor, ETCD_PAGE_LIMIT, true).await?;
        let last_scanned = range.entries.last().map(|(key, _)| key.clone());
        let limit = limit.clamp(1, ETCD_PAGE_LIMIT);
        let items = range
            .entries
            .into_iter()
            .filter(|(key, _)| filter.is_empty() || key.contains(filter))
            .take(limit)
            .map(|(name, _)| CollectionInfo {
                name,
                namespace: Some("kv".to_string()),
                collection_type: Some("KEY".to_string()),
                document_count: None,
            })
            .collect::<Vec<_>>();
        Ok(CollectionPage {
            items,
            next_cursor: range.more.then_some(last_scanned).flatten(),
            total: None,
        })
    }
}

fn parse_etcd_connection_url(value: &str) -> Result<(Url, Option<(String, String)>)> {
    let mut url = Url::parse(value.trim()).context("Invalid etcd connection URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!("etcd connection URL must use HTTP or HTTPS and contain a host")
    }
    let username = url.username();
    let password = url.password();
    let basic_auth = (!username.is_empty()).then(|| {
        (
            username.to_string(),
            password.unwrap_or_default().to_string(),
        )
    });
    url.set_username("")
        .map_err(|_| anyhow!("Invalid etcd username"))?;
    url.set_password(None)
        .map_err(|_| anyhow!("Invalid etcd password"))?;
    url.set_query(None);
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/');
    let normalized_path = if path.is_empty() {
        "/".to_string()
    } else {
        format!("{path}/")
    };
    url.set_path(&normalized_path);
    Ok((url, basic_auth))
}

fn validate_key(value: &str) -> Result<()> {
    if value.len() > 4_096 || value.contains('\0') {
        bail!("etcd key is invalid")
    }
    Ok(())
}

fn valid_key(value: &str) -> bool {
    !value.is_empty() && value.len() <= 4_096 && !value.contains('\0')
}

fn next_key(value: &str) -> Vec<u8> {
    let mut next = value.as_bytes().to_vec();
    next.push(0);
    next
}

fn prefix_end(prefix: &[u8]) -> Option<Vec<u8>> {
    if prefix.is_empty() {
        return Some(vec![0]);
    }
    let mut end = prefix.to_vec();
    for index in (0..end.len()).rev() {
        if end[index] != u8::MAX {
            end[index] += 1;
            end.truncate(index + 1);
            return Some(end);
        }
    }
    None
}

async fn parse_etcd_response(response: Response, operation: &str) -> Result<Value> {
    let status = response.status();
    let limit = if status.is_success() {
        ETCD_RESPONSE_MAX_BYTES
    } else {
        ETCD_ERROR_MAX_BYTES
    };
    let body = bounded_etcd_response_bytes(response, limit, operation).await?;
    if !status.is_success() {
        let hint = match status {
            StatusCode::UNAUTHORIZED => "Unauthorized; check the etcd credentials",
            StatusCode::FORBIDDEN => "Access denied",
            StatusCode::NOT_FOUND => {
                "Endpoint not found; this etcd server may not expose the v3 JSON gateway"
            }
            _ => "Request failed",
        };
        bail!("etcd {operation} returned HTTP {}: {hint}", status.as_u16())
    }
    serde_json::from_slice(&body).with_context(|| format!("etcd {operation} returned invalid JSON"))
}

async fn bounded_etcd_response_bytes(
    response: Response,
    limit: usize,
    operation: &str,
) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        bail!("etcd {operation} response exceeds the safety limit")
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.with_context(|| format!("Failed to read etcd {operation} response"))?;
        if body.len().saturating_add(chunk.len()) > limit {
            bail!("etcd {operation} response exceeds the safety limit")
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_redacts_credentials_and_preserves_base_path() {
        let (url, auth) = parse_etcd_connection_url(
            "https://user:secret@etcd.example.test:2379/gateway?ignored=true",
        )
        .unwrap();
        assert_eq!(url.as_str(), "https://etcd.example.test:2379/gateway/");
        assert_eq!(auth, Some(("user".to_string(), "secret".to_string())));
    }

    #[test]
    fn prefix_ranges_are_bounded_and_binary_safe() {
        assert_eq!(prefix_end(b"app/"), Some(b"app0".to_vec()));
        assert_eq!(prefix_end(b""), Some(vec![0]));
        assert_eq!(prefix_end(&[u8::MAX]), None);
        assert_eq!(next_key("app"), b"app\0".to_vec());
    }
}
