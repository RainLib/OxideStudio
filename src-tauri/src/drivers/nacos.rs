use crate::core::{
    driver::DatabaseDriver,
    protocol::{CollectionInfo, CollectionPage, ColumnDef, QueryResult},
};
use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use futures::StreamExt;
use reqwest::{Client, Response, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const NACOS_RESPONSE_MAX_BYTES: usize = 8 * 1024 * 1024;
const NACOS_ERROR_MAX_BYTES: usize = 64 * 1024;
const NACOS_PAGE_LIMIT: usize = 500;
const NACOS_CONTENT_PREVIEW_MAX_BYTES: usize = 64 * 1024;

/// Official Nacos OpenAPI, deliberately restricted to configuration reads.
/// Nacos service registration, namespace management and all write/admin
/// actions require a product-specific approval surface and are not exposed by
/// this generic KV explorer.
pub struct NacosDriver {
    client: Client,
    base_url: Url,
    credentials: Option<(String, String)>,
    namespace: String,
    access_token: Mutex<Option<AccessToken>>,
    connected: AtomicBool,
}

#[derive(Clone)]
struct AccessToken {
    value: String,
    expires_at: Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NacosConfigKey {
    data_id: String,
    group: String,
    tenant: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NacosConfigList {
    #[serde(default)]
    total_count: u64,
    #[serde(default)]
    page_items: Vec<NacosConfigListItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NacosConfigListItem {
    data_id: String,
    #[serde(default = "default_group")]
    group: String,
    #[serde(default)]
    tenant: String,
    #[serde(default)]
    #[allow(dead_code)]
    r#type: String,
    #[serde(default)]
    md5: String,
}

fn default_group() -> String {
    "DEFAULT_GROUP".to_string()
}

impl NacosDriver {
    pub fn new(connection_url: &str) -> Result<Self> {
        let (base_url, credentials, namespace) = parse_nacos_connection_url(connection_url)?;
        let client_builder = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30));
        #[cfg(test)]
        let client_builder = client_builder.no_proxy();
        Ok(Self {
            client: client_builder
                .build()
                .context("Failed to configure Nacos HTTP client")?,
            base_url,
            credentials,
            namespace,
            access_token: Mutex::new(None),
            connected: AtomicBool::new(false),
        })
    }

    fn ensure_connected(&self) -> Result<()> {
        if self.connected.load(Ordering::Acquire) {
            Ok(())
        } else {
            bail!("Nacos connection is not established")
        }
    }

    fn endpoint(&self, suffix: &str) -> Result<Url> {
        self.base_url
            .join(suffix.trim_start_matches('/'))
            .context("Invalid Nacos endpoint")
    }

    async fn token(&self) -> Result<Option<String>> {
        let Some((username, password)) = self.credentials.as_ref() else {
            return Ok(None);
        };
        if let Some(token) = self
            .access_token
            .lock()
            .expect("Nacos token lock must not be poisoned")
            .as_ref()
            .filter(|token| token.expires_at > Instant::now() + Duration::from_secs(30))
        {
            return Ok(Some(token.value.clone()));
        }
        let response = self
            .client
            .post(self.endpoint("v1/auth/users/login")?)
            .form(&[("username", username), ("password", password)])
            .send()
            .await
            .context("Nacos authentication request failed")?;
        let value = parse_nacos_response(response, "authentication").await?;
        let source = value
            .get("data")
            .filter(|value| value.is_object())
            .unwrap_or(&value);
        let token = source
            .get("accessToken")
            .or_else(|| source.get("access_token"))
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| {
                anyhow!("Nacos authentication response did not include an access token")
            })?
            .to_string();
        let ttl = source
            .get("tokenTtl")
            .or_else(|| source.get("expiresIn"))
            .and_then(Value::as_u64)
            .unwrap_or(18_000);
        *self
            .access_token
            .lock()
            .expect("Nacos token lock must not be poisoned") = Some(AccessToken {
            value: token.clone(),
            expires_at: Instant::now() + Duration::from_secs(ttl.saturating_sub(30).max(60)),
        });
        Ok(Some(token))
    }

    async fn get_json(
        &self,
        path: &str,
        mut query: Vec<(String, String)>,
        operation: &str,
    ) -> Result<Value> {
        if let Some(token) = self.token().await? {
            query.push(("accessToken".to_string(), token));
        }
        let response = self
            .client
            .get(self.endpoint(path)?)
            .query(&query)
            .send()
            .await
            .with_context(|| format!("Nacos {operation} request failed"))?;
        parse_nacos_response(response, operation).await
    }

    async fn get_text(
        &self,
        path: &str,
        mut query: Vec<(String, String)>,
        operation: &str,
    ) -> Result<String> {
        if let Some(token) = self.token().await? {
            query.push(("accessToken".to_string(), token));
        }
        let response = self
            .client
            .get(self.endpoint(path)?)
            .query(&query)
            .send()
            .await
            .with_context(|| format!("Nacos {operation} request failed"))?;
        let status = response.status();
        let body = bounded_nacos_response_bytes(
            response,
            if status.is_success() {
                NACOS_RESPONSE_MAX_BYTES
            } else {
                NACOS_ERROR_MAX_BYTES
            },
            operation,
        )
        .await?;
        nacos_status_error(status, operation)?;
        String::from_utf8(body)
            .with_context(|| format!("Nacos {operation} returned non-UTF-8 content"))
    }

    async fn list_configs(
        &self,
        page: usize,
        limit: usize,
        filter: &str,
    ) -> Result<NacosConfigList> {
        let page = page.max(1);
        let limit = limit.clamp(1, NACOS_PAGE_LIMIT);
        let mut query = vec![
            ("pageNo".to_string(), page.to_string()),
            ("pageSize".to_string(), limit.to_string()),
            ("search".to_string(), "blur".to_string()),
            ("tenant".to_string(), self.namespace.clone()),
        ];
        if !filter.is_empty() {
            query.push(("dataId".to_string(), filter.to_string()));
        }
        let value = self
            .get_json("v1/cs/configs", query, "configuration listing")
            .await?;
        serde_json::from_value(value).context("Nacos returned an invalid configuration list")
    }

    async fn get_config(&self, key: &NacosConfigKey) -> Result<QueryResult> {
        validate_config_key(key)?;
        // A configuration can itself be JSON. Keep this endpoint as raw text;
        // parsing it as an OpenAPI JSON envelope would reject valid configs.
        let content = self
            .get_text(
                "v1/cs/configs",
                vec![
                    ("dataId".to_string(), key.data_id.clone()),
                    ("group".to_string(), key.group.clone()),
                    ("tenant".to_string(), key.tenant.clone()),
                ],
                "configuration read",
            )
            .await?;
        let truncated = content.len() > NACOS_CONTENT_PREVIEW_MAX_BYTES;
        let preview = truncate_utf8(&content, NACOS_CONTENT_PREVIEW_MAX_BYTES);
        let mut result = QueryResult::rows(
            vec![
                ColumnDef {
                    name: "data_id".to_string(),
                    data_type: "string".to_string(),
                },
                ColumnDef {
                    name: "group".to_string(),
                    data_type: "string".to_string(),
                },
                ColumnDef {
                    name: "tenant".to_string(),
                    data_type: "string".to_string(),
                },
                ColumnDef {
                    name: "content".to_string(),
                    data_type: "string".to_string(),
                },
            ],
            vec![vec![
                Value::String(key.data_id.clone()),
                Value::String(key.group.clone()),
                Value::String(key.tenant.clone()),
                Value::String(preview),
            ]],
        );
        result.truncated = truncated;
        result.row_limit = truncated.then_some(NACOS_CONTENT_PREVIEW_MAX_BYTES);
        result.message =
            truncated.then(|| "Nacos configuration preview is truncated at 64 KiB".to_string());
        Ok(result)
    }
}

#[async_trait]
impl DatabaseDriver for NacosDriver {
    async fn connect(&mut self) -> Result<()> {
        self.list_configs(1, 1, "").await?;
        self.connected.store(true, Ordering::Release);
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        self.connected.store(false, Ordering::Release);
        *self
            .access_token
            .lock()
            .expect("Nacos token lock must not be poisoned") = None;
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        self.ensure_connected()?;
        self.list_configs(1, 1, "").await.map(|_| ())
    }

    async fn query(&self, command: &str) -> Result<Vec<QueryResult>> {
        self.ensure_connected()?;
        let input = command
            .trim()
            .strip_prefix("GET ")
            .or_else(|| command.trim().strip_prefix("get "))
            .ok_or_else(|| anyhow!("Nacos only supports GET <JSON-config-key> previews"))?;
        let key: NacosConfigKey =
            serde_json::from_str(input.trim()).context("Nacos GET requires a JSON config key")?;
        Ok(vec![self.get_config(&key).await?])
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        self.ensure_connected()?;
        Ok(vec!["config".to_string()])
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
        if !namespace.trim().is_empty() && namespace != "config" {
            return Ok(CollectionPage {
                items: Vec::new(),
                next_cursor: None,
                total: Some(0),
            });
        }
        let filter = filter.unwrap_or("").trim();
        if filter.len() > 512 || filter.contains('\0') {
            bail!("Nacos configuration filter is invalid")
        }
        let page = cursor
            .map(str::trim)
            .filter(|cursor| !cursor.is_empty())
            .map(|cursor| {
                cursor
                    .parse::<usize>()
                    .context("Invalid Nacos configuration cursor")
            })
            .transpose()?
            .unwrap_or(1);
        let page_size = limit.clamp(1, NACOS_PAGE_LIMIT);
        let result = self.list_configs(page, page_size, filter).await?;
        let items = result
            .page_items
            .into_iter()
            .map(|item| {
                let tenant = if item.tenant.is_empty() {
                    self.namespace.clone()
                } else {
                    item.tenant
                };
                let key = NacosConfigKey {
                    data_id: item.data_id,
                    group: item.group,
                    tenant,
                };
                Ok(CollectionInfo {
                    name: serde_json::to_string(&key)
                        .context("Failed to encode Nacos config key")?,
                    namespace: Some("config".to_string()),
                    collection_type: Some(if item.md5.is_empty() {
                        "CONFIG".to_string()
                    } else {
                        "CONFIG_WITH_MD5".to_string()
                    }),
                    document_count: None,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let next_page = page.checked_add(1);
        Ok(CollectionPage {
            items,
            next_cursor: (result.total_count > page.saturating_mul(page_size) as u64)
                .then(|| next_page.map(|next| next.to_string()))
                .flatten(),
            total: Some(result.total_count),
        })
    }
}

fn parse_nacos_connection_url(value: &str) -> Result<(Url, Option<(String, String)>, String)> {
    let mut url = Url::parse(value.trim()).context("Invalid Nacos connection URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!("Nacos connection URL must use HTTP or HTTPS and contain a host")
    }
    let credentials = (!url.username().is_empty()).then(|| {
        (
            url.username().to_string(),
            url.password().unwrap_or_default().to_string(),
        )
    });
    let namespace = url
        .query_pairs()
        .find(|(name, _)| name == "namespace" || name == "tenant")
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default();
    if namespace.len() > 256 || namespace.contains('\0') {
        bail!("Nacos namespace is invalid")
    }
    url.set_username("")
        .map_err(|_| anyhow!("Invalid Nacos username"))?;
    url.set_password(None)
        .map_err(|_| anyhow!("Invalid Nacos password"))?;
    url.set_query(None);
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/');
    let normalized_path = if path.is_empty() {
        "/".to_string()
    } else {
        format!("{path}/")
    };
    url.set_path(&normalized_path);
    Ok((url, credentials, namespace))
}

fn validate_config_key(key: &NacosConfigKey) -> Result<()> {
    for value in [&key.data_id, &key.group, &key.tenant] {
        if value.len() > 1_024 || value.contains('\0') {
            bail!("Nacos configuration key is invalid")
        }
    }
    if key.data_id.trim().is_empty() || key.group.trim().is_empty() {
        bail!("Nacos configuration dataId and group are required")
    }
    Ok(())
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

async fn parse_nacos_response(response: Response, operation: &str) -> Result<Value> {
    let status = response.status();
    let body = bounded_nacos_response_bytes(
        response,
        if status.is_success() {
            NACOS_RESPONSE_MAX_BYTES
        } else {
            NACOS_ERROR_MAX_BYTES
        },
        operation,
    )
    .await?;
    nacos_status_error(status, operation)?;
    serde_json::from_slice(&body)
        .with_context(|| format!("Nacos {operation} returned invalid JSON"))
}

fn nacos_status_error(status: StatusCode, operation: &str) -> Result<()> {
    if status.is_success() {
        return Ok(());
    }
    let hint = match status {
        StatusCode::UNAUTHORIZED => "Unauthorized; check the Nacos credentials",
        StatusCode::FORBIDDEN => "Access denied",
        StatusCode::NOT_FOUND => "Endpoint not found",
        _ => "Request failed",
    };
    bail!(
        "Nacos {operation} returned HTTP {}: {hint}",
        status.as_u16()
    )
}

async fn bounded_nacos_response_bytes(
    response: Response,
    limit: usize,
    operation: &str,
) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        bail!("Nacos {operation} response exceeds the safety limit")
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.with_context(|| format!("Failed to read Nacos {operation} response"))?;
        if body.len().saturating_add(chunk.len()) > limit {
            bail!("Nacos {operation} response exceeds the safety limit")
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::time::timeout;

    async fn serve_test_http_responses(
        responses: Vec<(&'static str, &'static str)>,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let mut requests = Vec::new();
            for (content_type, body) in responses {
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
                    "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len(),
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        (
            format!("http://nacos:secret@{address}/tenant?namespace=prod"),
            handle,
        )
    }

    #[test]
    fn url_redacts_credentials_namespace_and_preserves_context_path() {
        let (url, credentials, namespace) = parse_nacos_connection_url(
            "https://nacos:secret@nacos.example.test:8848/nacos?namespace=prod",
        )
        .unwrap();
        assert_eq!(url.as_str(), "https://nacos.example.test:8848/nacos/");
        assert_eq!(
            credentials,
            Some(("nacos".to_string(), "secret".to_string()))
        );
        assert_eq!(namespace, "prod");
    }

    #[test]
    fn config_key_and_preview_boundaries_are_safe() {
        assert!(validate_config_key(&NacosConfigKey {
            data_id: "app.yaml".to_string(),
            group: "DEFAULT_GROUP".to_string(),
            tenant: String::new(),
        })
        .is_ok());
        assert!(validate_config_key(&NacosConfigKey {
            data_id: String::new(),
            group: "DEFAULT_GROUP".to_string(),
            tenant: String::new(),
        })
        .is_err());
        assert_eq!(truncate_utf8("你好", 4), "你");
    }

    #[tokio::test]
    async fn native_browser_uses_only_fixed_openapi_read_endpoints() {
        let (url, server) = serve_test_http_responses(vec![
            ("application/json", r#"{"accessToken":"fixture-token","tokenTtl":3600}"#),
            (
                "application/json",
                r#"{"totalCount":1,"pageItems":[{"dataId":"app.json","group":"DEFAULT_GROUP","tenant":"prod","md5":"abc"}]}"#,
            ),
            ("application/json", r#"{"totalCount":0,"pageItems":[]}"#),
            (
                "application/json",
                r#"{"totalCount":1,"pageItems":[{"dataId":"app.json","group":"DEFAULT_GROUP","tenant":"prod","md5":"abc"}]}"#,
            ),
            ("text/plain", r#"{"enabled":true}"#),
        ])
        .await;
        let mut driver = NacosDriver::new(&url).unwrap();
        driver.connect().await.unwrap();
        driver.ping().await.unwrap();
        let page = driver
            .get_collections_page("config", None, 10, None)
            .await
            .unwrap();
        assert_eq!(page.total, Some(1));
        assert_eq!(page.items.len(), 1);
        let preview = driver
            .query(&format!("GET {}", page.items[0].name))
            .await
            .unwrap();
        assert_eq!(
            preview[0].rows[0][3],
            Value::String(r#"{"enabled":true}"#.to_string())
        );

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 5);
        assert!(requests[0].starts_with("POST /tenant/v1/auth/users/login HTTP/1.1"));
        assert!(requests[0].contains("username=nacos&password=secret"));
        assert!(requests[1].starts_with("GET /tenant/v1/cs/configs?"));
        assert!(requests[2].starts_with("GET /tenant/v1/cs/configs?"));
        assert!(requests[3].starts_with("GET /tenant/v1/cs/configs?"));
        assert!(requests[4].starts_with("GET /tenant/v1/cs/configs?"));
        assert!(requests[1..]
            .iter()
            .all(|request| request.contains("accessToken=fixture-token")));
        assert!(requests[1..]
            .iter()
            .all(|request| !request.contains("authorization: Basic")));
        assert!(requests[4].contains("dataId=app.json"));
        assert!(requests[4].contains("group=DEFAULT_GROUP"));
        assert!(requests[4].contains("tenant=prod"));
        assert!(requests.iter().all(|request| {
            request.starts_with("POST /tenant/v1/auth/users/login HTTP/1.1")
                || request.starts_with("GET /tenant/v1/cs/configs?")
        }));
    }
}
