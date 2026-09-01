use crate::core::{
    driver::{DatabaseDriver, DocumentPageRequest},
    protocol::{
        CollectionInfo, ColumnDef, ColumnInfo, DocumentPage, QueryResult,
        DEFAULT_QUERY_RESULT_ROW_LIMIT,
    },
};
use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use futures::StreamExt;
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use reqwest::{Client, Response, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

const MEILISEARCH_RESPONSE_MAX_BYTES: usize = 8 * 1024 * 1024;
const MEILISEARCH_ERROR_MAX_BYTES: usize = 64 * 1024;
const MEILISEARCH_INDEX_PAGE_SIZE: usize = 1_000;
const MEILISEARCH_INDEX_LIST_MAX: usize = 10_000;
const MEILISEARCH_FIELD_SAMPLE_SIZE: usize = 100;
const MEILISEARCH_DOCUMENT_CURSOR_MAX_BYTES: usize = 4 * 1024;
const PATH_SEGMENT_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'/')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

/// Native, read-only Meilisearch document/index browser.
///
/// Meilisearch is deliberately not exposed as a SQL console. Its documented
/// HTTP search API has distinct filtering and task semantics; accepting SQL or
/// forwarding arbitrary REST paths here would make the ordinary query editor a
/// confused and unsafe transport escape hatch.
pub struct MeilisearchDriver {
    client: Client,
    base_url: Url,
    api_key: Option<String>,
    connected: AtomicBool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeilisearchIndex {
    uid: String,
    #[serde(default)]
    primary_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MeilisearchIndexPage {
    #[serde(default)]
    results: Vec<MeilisearchIndex>,
    #[serde(default)]
    total: usize,
    #[serde(default)]
    offset: usize,
    #[serde(default)]
    limit: usize,
}

#[derive(Debug, Deserialize)]
struct MeilisearchDocumentsPage {
    #[serde(default)]
    results: Vec<Value>,
    #[serde(default)]
    total: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct MeilisearchDocumentCursor {
    index: String,
    offset: usize,
}

impl MeilisearchDriver {
    pub fn new(connection_url: &str) -> Result<Self> {
        let (base_url, api_key) = parse_meilisearch_connection_url(connection_url)?;
        let client_builder = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30));
        // Keep deterministic local HTTP fixtures independent from a host's
        // corporate/system proxy settings. Production connections retain the
        // platform's normal proxy behavior.
        #[cfg(test)]
        let client_builder = client_builder.no_proxy();
        let client = client_builder
            .build()
            .context("Failed to configure Meilisearch HTTP client")?;
        Ok(Self {
            client,
            base_url,
            api_key,
            connected: AtomicBool::new(false),
        })
    }

    fn ensure_connected(&self) -> Result<()> {
        if self.connected.load(Ordering::Acquire) {
            Ok(())
        } else {
            bail!("Meilisearch connection is not established")
        }
    }

    fn endpoint(&self, path: &str) -> Result<Url> {
        let path = path.strip_prefix('/').unwrap_or(path);
        self.base_url
            .join(path)
            .context("Invalid Meilisearch request path")
    }

    fn request(&self, method: reqwest::Method, path: &str) -> Result<reqwest::RequestBuilder> {
        let request = self
            .client
            .request(method, self.endpoint(path)?)
            .header("accept", "application/json");
        Ok(match self.api_key.as_deref() {
            Some(api_key) => request.bearer_auth(api_key),
            None => request,
        })
    }

    async fn get_json(&self, path: &str, context: &str) -> Result<Value> {
        let response = self
            .request(reqwest::Method::GET, path)?
            .send()
            .await
            .with_context(|| format!("Meilisearch {context} request failed"))?;
        meilisearch_response_json(response, context).await
    }

    async fn probe(&self) -> Result<()> {
        self.get_json("health", "health check").await?;
        self.get_json("indexes?offset=0&limit=1", "index access check")
            .await?;
        Ok(())
    }

    async fn indexes(&self) -> Result<Vec<MeilisearchIndex>> {
        self.ensure_connected()?;
        let mut offset = 0usize;
        let mut indexes = Vec::new();
        while indexes.len() < MEILISEARCH_INDEX_LIST_MAX {
            let value = self
                .get_json(
                    &format!("indexes?offset={offset}&limit={MEILISEARCH_INDEX_PAGE_SIZE}"),
                    "index listing",
                )
                .await?;
            let page: MeilisearchIndexPage = serde_json::from_value(value)
                .context("Meilisearch returned an invalid index listing")?;
            let page_len = page.results.len();
            indexes.extend(page.results);
            let next = page.offset.saturating_add(page.limit.max(page_len));
            if page_len == 0 || next >= page.total || next <= offset {
                break;
            }
            offset = next;
        }
        indexes.sort_by(|left, right| left.uid.cmp(&right.uid));
        indexes.dedup_by(|left, right| left.uid == right.uid);
        indexes.truncate(MEILISEARCH_INDEX_LIST_MAX);
        Ok(indexes)
    }

    async fn index(&self, index: &str) -> Result<MeilisearchIndex> {
        let index = validate_index_name(index)?;
        let value = self
            .get_json(
                &format!("indexes/{}", encode_path_segment(index)),
                "index lookup",
            )
            .await?;
        serde_json::from_value(value).context("Meilisearch returned an invalid index descriptor")
    }

    async fn documents(
        &self,
        index: &str,
        offset: usize,
        limit: usize,
    ) -> Result<MeilisearchDocumentsPage> {
        let index = validate_index_name(index)?;
        let value = self
            .get_json(
                &format!(
                    "indexes/{}/documents?offset={offset}&limit={limit}",
                    encode_path_segment(index)
                ),
                "document page",
            )
            .await?;
        serde_json::from_value(value).context("Meilisearch returned an invalid document page")
    }
}

#[async_trait]
impl DatabaseDriver for MeilisearchDriver {
    async fn connect(&mut self) -> Result<()> {
        self.probe().await?;
        self.connected.store(true, Ordering::Release);
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        self.connected.store(false, Ordering::Release);
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        self.ensure_connected()?;
        self.probe().await
    }

    async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
        Err(anyhow!(
            "Meilisearch has no SQL query surface; browse an index through the document workspace"
        ))
    }

    async fn get_collections(&self, _namespace: &str) -> Result<Vec<CollectionInfo>> {
        Ok(self
            .indexes()
            .await?
            .into_iter()
            .map(|index| CollectionInfo {
                name: index.uid,
                namespace: None,
                collection_type: Some("index".to_string()),
                document_count: None,
            })
            .collect())
    }

    async fn get_document_page(&self, request: DocumentPageRequest<'_>) -> Result<DocumentPage> {
        self.ensure_connected()?;
        if request.filter.is_some_and(|value| !value.trim().is_empty())
            || request.sort.is_some_and(|value| !value.trim().is_empty())
        {
            bail!(
                "Meilisearch document filtering and sorting require its dedicated search workspace"
            );
        }
        let limit = request.limit.clamp(1, DEFAULT_QUERY_RESULT_ROW_LIMIT);
        let cursor = match request.cursor {
            Some(cursor) => decode_document_cursor(cursor)?,
            None => MeilisearchDocumentCursor {
                index: request.collection.to_string(),
                offset: 0,
            },
        };
        if cursor.index != request.collection {
            bail!("Meilisearch document cursor does not match the selected index");
        }
        let page = self.documents(&cursor.index, cursor.offset, limit).await?;
        let returned = page.results.len();
        let next_offset = cursor.offset.saturating_add(returned);
        let total = page.total;
        let next_cursor = (returned == limit
            && total.is_none_or(|total| u64::try_from(next_offset).unwrap_or(u64::MAX) < total))
        .then(|| {
            encode_document_cursor(&MeilisearchDocumentCursor {
                index: cursor.index,
                offset: next_offset,
            })
        })
        .transpose()?;
        Ok(DocumentPage {
            result: documents_query_result(page.results, limit),
            next_cursor,
            total,
        })
    }

    async fn get_columns(&self, _schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        self.ensure_connected()?;
        let index = self.index(table).await?;
        let sample = self
            .documents(&index.uid, 0, MEILISEARCH_FIELD_SAMPLE_SIZE)
            .await?;
        Ok(meilisearch_columns(
            &sample.results,
            index.primary_key.as_deref(),
        ))
    }

    async fn set_current_schema(&self, schema: &str) -> Result<()> {
        self.ensure_connected()?;
        self.index(schema).await.map(|_| ())
    }
}

fn parse_meilisearch_connection_url(input: &str) -> Result<(Url, Option<String>)> {
    let mut url = Url::parse(input.trim()).context("Invalid Meilisearch connection URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!("Meilisearch connection URL must use HTTP or HTTPS and contain a host");
    }
    let api_key = url
        .password()
        .or_else(|| (!url.username().is_empty()).then_some(url.username()))
        .and_then(|value| percent_decode_str(value).decode_utf8().ok())
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty());
    url.set_username("")
        .map_err(|_| anyhow!("Invalid Meilisearch username"))?;
    url.set_password(None)
        .map_err(|_| anyhow!("Invalid Meilisearch password"))?;
    url.set_query(None);
    url.set_fragment(None);
    if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
    Ok((url, api_key))
}

fn validate_index_name(index: &str) -> Result<&str> {
    let index = index.trim();
    if index.is_empty()
        || index.len() > 512
        || index.contains('\0')
        || index.contains(['/', '?', '#'])
    {
        bail!("Meilisearch index name is invalid");
    }
    Ok(index)
}

fn encode_path_segment(value: &str) -> String {
    utf8_percent_encode(value, PATH_SEGMENT_ENCODE_SET).to_string()
}

async fn meilisearch_response_json(response: Response, context: &str) -> Result<Value> {
    let status = response.status();
    let bytes = bounded_response_bytes(
        response,
        if status.is_success() {
            MEILISEARCH_RESPONSE_MAX_BYTES
        } else {
            MEILISEARCH_ERROR_MAX_BYTES
        },
    )
    .await?;
    if !status.is_success() {
        bail!(
            "Meilisearch {context} returned HTTP {}: {}",
            status.as_u16(),
            meilisearch_status_hint(status)
        );
    }
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&bytes).context("Meilisearch returned invalid JSON")
}

async fn bounded_response_bytes(response: Response, limit: usize) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        bail!("Meilisearch response exceeds the {limit}-byte safety limit");
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("Failed to read Meilisearch response")?;
        if bytes.len().saturating_add(chunk.len()) > limit {
            bail!("Meilisearch response exceeds the {limit}-byte safety limit");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn meilisearch_status_hint(status: StatusCode) -> &'static str {
    match status {
        StatusCode::UNAUTHORIZED => "Unauthorized; check the API key",
        StatusCode::FORBIDDEN => "Access denied",
        StatusCode::NOT_FOUND => "Endpoint or index not found",
        _ => "Request failed",
    }
}

fn encode_document_cursor(cursor: &MeilisearchDocumentCursor) -> Result<String> {
    let bytes = serde_json::to_vec(cursor).context("Failed to encode Meilisearch cursor")?;
    if bytes.len() > MEILISEARCH_DOCUMENT_CURSOR_MAX_BYTES {
        bail!("Meilisearch cursor exceeds the local size limit");
    }
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_document_cursor(value: &str) -> Result<MeilisearchDocumentCursor> {
    if value.is_empty() || value.len() > MEILISEARCH_DOCUMENT_CURSOR_MAX_BYTES * 2 {
        bail!("Invalid Meilisearch document cursor");
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .context("Invalid Meilisearch document cursor encoding")?;
    if bytes.len() > MEILISEARCH_DOCUMENT_CURSOR_MAX_BYTES {
        bail!("Meilisearch cursor exceeds the local size limit");
    }
    let cursor: MeilisearchDocumentCursor =
        serde_json::from_slice(&bytes).context("Invalid Meilisearch document cursor")?;
    validate_index_name(&cursor.index)?;
    Ok(cursor)
}

fn documents_query_result(documents: Vec<Value>, row_limit: usize) -> QueryResult {
    let mut names = Vec::new();
    let mut positions = HashMap::new();
    for document in &documents {
        if let Some(object) = document.as_object() {
            for name in object.keys() {
                if !positions.contains_key(name) {
                    positions.insert(name.clone(), names.len());
                    names.push(name.clone());
                }
            }
        }
    }
    let columns = names
        .iter()
        .map(|name| ColumnDef {
            name: name.clone(),
            data_type: documents
                .iter()
                .filter_map(Value::as_object)
                .filter_map(|document| document.get(name))
                .find(|value| !value.is_null())
                .map(json_type_name)
                .unwrap_or("unknown")
                .to_string(),
        })
        .collect();
    let rows = documents
        .into_iter()
        .map(|document| {
            let mut row = vec![Value::Null; names.len()];
            if let Some(object) = document.as_object() {
                for (name, value) in object {
                    if let Some(position) = positions.get(name) {
                        row[*position] = value.clone();
                    }
                }
            }
            row
        })
        .collect();
    QueryResult::rows_limited(columns, rows, row_limit)
}

fn meilisearch_columns(documents: &[Value], primary_key: Option<&str>) -> Vec<ColumnInfo> {
    let mut fields = BTreeMap::<String, String>::new();
    for document in documents {
        collect_field_types("", document, &mut fields);
    }
    fields
        .into_iter()
        .map(|(name, data_type)| ColumnInfo {
            is_primary_key: primary_key.is_some_and(|primary_key| primary_key == name),
            name,
            data_type,
            is_nullable: true,
            is_unique: false,
            is_indexed: false,
            is_auto_increment: false,
            identity_generation: None,
            is_generated: None,
            is_hidden: None,
            default_value: None,
            comment: None,
        })
        .collect()
}

fn collect_field_types(prefix: &str, value: &Value, fields: &mut BTreeMap<String, String>) {
    match value {
        Value::Object(object) => {
            for (name, value) in object {
                let name = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}.{name}")
                };
                fields
                    .entry(name.clone())
                    .or_insert_with(|| json_type_name(value).to_string());
                collect_field_types(&name, value, fields);
            }
        }
        Value::Array(values) => {
            for value in values.iter().take(16) {
                collect_field_types(prefix, value, fields);
            }
        }
        _ => {}
    }
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "unknown",
        Value::Bool(_) => "boolean",
        Value::Number(number) if number.is_i64() || number.is_u64() => "integer",
        Value::Number(_) => "double",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
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
        (format!("http://:test-key@{address}/tenant"), handle)
    }

    #[test]
    fn connection_url_redacts_the_api_key_and_keeps_a_base_path() {
        let (base_url, api_key) = parse_meilisearch_connection_url(
            "https://ignored:secret%20key@search.example:7700/team/search?trace=1",
        )
        .unwrap();
        assert_eq!(
            base_url.as_str(),
            "https://search.example:7700/team/search/"
        );
        assert_eq!(api_key.as_deref(), Some("secret key"));
        assert!(!base_url.as_str().contains("secret"));
    }

    #[test]
    fn connection_url_rejects_non_http_targets() {
        assert!(parse_meilisearch_connection_url("file:///tmp/meili").is_err());
        assert!(parse_meilisearch_connection_url("meilisearch://localhost:7700").is_err());
    }

    #[test]
    fn document_cursor_is_bounded_and_scoped_to_its_index() {
        let cursor = encode_document_cursor(&MeilisearchDocumentCursor {
            index: "books".to_string(),
            offset: 100,
        })
        .unwrap();
        assert_eq!(
            decode_document_cursor(&cursor).unwrap(),
            MeilisearchDocumentCursor {
                index: "books".to_string(),
                offset: 100,
            }
        );
        assert!(decode_document_cursor("!").is_err());
    }

    #[test]
    fn document_rows_and_sample_columns_keep_json_shapes() {
        let documents = vec![
            json!({ "id": 1, "title": "One", "meta": { "published": true } }),
            json!({ "id": 2, "score": 1.5, "tags": ["db"] }),
        ];
        let result = documents_query_result(documents.clone(), 100);
        assert_eq!(
            result
                .columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            ["id", "title", "meta", "score", "tags"]
        );
        assert_eq!(result.rows[0][2], json!({ "published": true }));
        let columns = meilisearch_columns(&documents, Some("id"));
        assert!(columns
            .iter()
            .any(|column| column.name == "meta.published" && column.data_type == "boolean"));
        assert!(columns
            .iter()
            .any(|column| column.name == "id" && column.is_primary_key));
    }

    #[test]
    fn index_names_reject_transport_escape_characters() {
        for index in [
            "",
            "../private",
            "books?limit=1",
            "books#section",
            "books/a",
        ] {
            assert!(validate_index_name(index).is_err(), "{index}");
        }
        assert_eq!(validate_index_name("中文-books").unwrap(), "中文-books");
    }

    #[tokio::test]
    async fn native_browser_uses_only_closed_health_index_and_document_endpoints() {
        let (url, server) = serve_test_http_responses(vec![
            r#"{"status":"available"}"#,
            r#"{"results":[],"total":0,"offset":0,"limit":1}"#,
            r#"{"results":[{"uid":"books","primaryKey":"id"}],"total":1,"offset":0,"limit":1000}"#,
            r#"{"results":[{"id":1,"title":"Database Systems"}],"total":1}"#,
        ])
        .await;
        let mut driver = MeilisearchDriver::new(&url).unwrap();
        driver.connect().await.unwrap();

        let collections = driver.get_collections("").await.unwrap();
        assert_eq!(collections[0].name, "books");
        let page = driver
            .get_document_page(DocumentPageRequest {
                namespace: "",
                collection: "books",
                cursor: None,
                limit: 50,
                filter: None,
                sort: None,
            })
            .await
            .unwrap();
        assert_eq!(page.total, Some(1));
        assert_eq!(page.result.rows[0][1], json!("Database Systems"));

        let requests = server.await.unwrap();
        assert!(requests[0].starts_with("GET /tenant/health HTTP/1.1"));
        assert!(requests[1].starts_with("GET /tenant/indexes?offset=0&limit=1 HTTP/1.1"));
        assert!(requests[2].starts_with("GET /tenant/indexes?offset=0&limit=1000 HTTP/1.1"));
        assert!(requests[3]
            .starts_with("GET /tenant/indexes/books/documents?offset=0&limit=50 HTTP/1.1"));
        assert!(requests
            .iter()
            .all(|request| request.contains("authorization: Bearer test-key")));
    }
}
