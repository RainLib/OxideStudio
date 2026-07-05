use crate::core::{
    driver::DatabaseDriver,
    protocol::{CollectionInfo, ColumnDef, ColumnInfo, QueryResult},
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use reqwest::{Client, Method, Url};
use serde_json::{json, Value};
use tokio::sync::Mutex;

pub struct ElasticsearchDriver {
    base_url: Url,
    client: Client,
    auth: Option<(String, String)>,
    active_index: Mutex<Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ElasticsearchRequest {
    method: Method,
    path: String,
    body: Option<String>,
}

impl ElasticsearchDriver {
    pub fn new(url: &str) -> Result<Self> {
        let mut base_url = Url::parse(url).context("Invalid Elasticsearch URL")?;
        let auth = extract_basic_auth(&mut base_url);
        Ok(Self {
            base_url,
            client: Client::new(),
            auth,
            active_index: Mutex::new(None),
        })
    }

    async fn active_index_name(&self) -> Option<String> {
        self.active_index.lock().await.clone()
    }

    async fn execute_requests(
        &self,
        requests: Vec<ElasticsearchRequest>,
        context_index: Option<String>,
    ) -> Result<Vec<QueryResult>> {
        if requests.is_empty() {
            return Err(anyhow!("Elasticsearch query is required"));
        }

        let active_index = match context_index {
            Some(index) => Some(index),
            None => self.active_index_name().await,
        };
        let mut results = Vec::new();

        for request in requests {
            let request = scope_search_request_to_index(request, active_index.as_deref());
            let (status, body) = self.send_request(&request).await?;
            let normalized = normalize_elasticsearch_response(body);
            if let Some(result) = elasticsearch_table_result(&normalized) {
                results.push(result);
            } else {
                results.push(elasticsearch_request_result(&request, status, normalized));
            }
        }

        Ok(results)
    }

    async fn send_request(&self, request: &ElasticsearchRequest) -> Result<(u16, Value)> {
        let url = self
            .base_url
            .join(request.path.trim_start_matches('/'))
            .with_context(|| format!("Invalid Elasticsearch request path: {}", request.path))?;
        let mut builder = self.client.request(request.method.clone(), url);
        if let Some((username, password)) = &self.auth {
            builder = builder.basic_auth(username, Some(password));
        }
        if let Some(body) = request
            .body
            .as_deref()
            .filter(|body| !body.trim().is_empty())
        {
            builder = builder
                .header("content-type", "application/json")
                .body(body.to_string());
        }

        let response = builder
            .send()
            .await
            .context("Elasticsearch request failed")?;
        let status = response.status();
        let text = response
            .text()
            .await
            .context("Failed to read Elasticsearch response")?;
        let body = if text.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text))
        };

        if !status.is_success() {
            return Err(anyhow!(
                "Elasticsearch request failed with status {}: {}",
                status.as_u16(),
                body
            ));
        }

        Ok((status.as_u16(), body))
    }
}

#[async_trait]
impl DatabaseDriver for ElasticsearchDriver {
    async fn connect(&mut self) -> Result<()> {
        self.ping().await
    }

    async fn disconnect(&self) -> Result<()> {
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        let request = ElasticsearchRequest {
            method: Method::GET,
            path: "/".to_string(),
            body: None,
        };
        self.send_request(&request).await.map(|_| ())
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let requests = parse_elasticsearch_requests(sql)?;
        self.execute_requests(requests, None).await
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        let index = validate_elasticsearch_index_context(schema)?;
        *self.active_index.lock().await = index.clone();
        let requests = parse_elasticsearch_requests(sql)?;
        self.execute_requests(requests, index).await
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        Ok(vec!["default".to_string()])
    }

    async fn get_collections(&self, _namespace: &str) -> Result<Vec<CollectionInfo>> {
        let request = ElasticsearchRequest {
            method: Method::GET,
            path: "/_cat/indices?format=json&h=index,docs.count".to_string(),
            body: None,
        };
        let (_, body) = self.send_request(&request).await?;
        Ok(elasticsearch_indices_to_collections(body))
    }

    async fn get_columns(&self, _schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        let index = table.trim();
        if index.is_empty() {
            return Ok(Vec::new());
        }

        let request = ElasticsearchRequest {
            method: Method::GET,
            path: format!("/{index}/_mapping"),
            body: None,
        };
        let (_, body) = self.send_request(&request).await?;
        Ok(elasticsearch_mapping_to_columns(&body, index))
    }

    async fn set_current_schema(&self, schema: &str) -> Result<()> {
        *self.active_index.lock().await = validate_elasticsearch_index_context(schema)?;
        Ok(())
    }
}

fn extract_basic_auth(url: &mut Url) -> Option<(String, String)> {
    let username = url.username().to_string();
    if username.is_empty() {
        return None;
    }

    let password = url.password().unwrap_or("").to_string();
    let _ = url.set_username("");
    let _ = url.set_password(None);
    Some((username, password))
}

fn parse_elasticsearch_requests(input: &str) -> Result<Vec<ElasticsearchRequest>> {
    let input = input.trim();
    if input.is_empty() {
        return Ok(Vec::new());
    }

    if input.starts_with('{') || input.starts_with('[') {
        return Ok(vec![ElasticsearchRequest {
            method: Method::POST,
            path: "/_search".to_string(),
            body: Some(input.to_string()),
        }]);
    }

    let mut requests = Vec::new();
    let mut current: Option<ElasticsearchRequest> = None;
    let mut body_lines: Vec<String> = Vec::new();

    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some((method, path, inline_body)) = parse_request_line(trimmed)? {
            if let Some(mut request) = current.take() {
                if !body_lines.is_empty() {
                    request.body = Some(body_lines.join("\n"));
                    body_lines.clear();
                }
                requests.push(request);
            }

            current = Some(ElasticsearchRequest {
                method,
                path,
                body: inline_body,
            });
        } else if current.is_some() {
            body_lines.push(trimmed.to_string());
        } else {
            return Err(anyhow!(
                "Expected Elasticsearch request line, got: {trimmed}"
            ));
        }
    }

    if let Some(mut request) = current {
        if !body_lines.is_empty() {
            request.body = Some(body_lines.join("\n"));
        }
        requests.push(request);
    }

    Ok(requests)
}

fn parse_request_line(line: &str) -> Result<Option<(Method, String, Option<String>)>> {
    let Some((method, rest)) = line.split_once(char::is_whitespace) else {
        return Ok(None);
    };
    let method = match method.to_ascii_uppercase().as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "DELETE" => Method::DELETE,
        "HEAD" => Method::HEAD,
        "PATCH" => Method::PATCH,
        _ => return Ok(None),
    };

    let rest = rest.trim();
    if rest.is_empty() {
        return Err(anyhow!("Elasticsearch request path is required"));
    }

    let mut split = rest.splitn(2, char::is_whitespace);
    let path = split.next().unwrap_or("").trim();
    if !path.starts_with('/') {
        return Err(anyhow!("Elasticsearch request path must start with '/'"));
    }
    let inline_body = split
        .next()
        .map(str::trim)
        .filter(|body| !body.is_empty())
        .map(ToString::to_string);

    Ok(Some((method, path.to_string(), inline_body)))
}

fn validate_elasticsearch_index_context(value: &str) -> Result<Option<String>> {
    let value = value.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("default") {
        return Ok(None);
    }
    if value.chars().any(|ch| matches!(ch, '/' | '\\' | '\0')) {
        return Err(anyhow!("Invalid Elasticsearch index context: {value}"));
    }
    Ok(Some(value.to_string()))
}

fn encode_elasticsearch_path_segment(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());

    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0F) as usize] as char);
        }
    }

    encoded
}

fn scope_search_request_to_index(
    mut request: ElasticsearchRequest,
    index: Option<&str>,
) -> ElasticsearchRequest {
    let Some(index) = index.map(str::trim).filter(|value| !value.is_empty()) else {
        return request;
    };

    if request.path == "/_search" {
        request.path = format!("/{}/_search", encode_elasticsearch_path_segment(index));
    }

    request
}

fn normalize_elasticsearch_response(value: Value) -> Value {
    let Some(hits) = value
        .get("hits")
        .and_then(|hits| hits.get("hits"))
        .and_then(Value::as_array)
    else {
        return value;
    };

    Value::Array(
        hits.iter()
            .map(|hit| {
                json!({
                    "index": hit.get("_index").cloned().unwrap_or(Value::Null),
                    "id": hit.get("_id").cloned().unwrap_or(Value::Null),
                    "score": hit.get("_score").cloned().unwrap_or(Value::Null),
                    "source": hit.get("_source").cloned().unwrap_or(Value::Null),
                })
            })
            .collect(),
    )
}

fn elasticsearch_request_result(
    request: &ElasticsearchRequest,
    status: u16,
    body: Value,
) -> QueryResult {
    QueryResult::rows(
        vec![
            ColumnDef {
                name: "method".to_string(),
                data_type: "text".to_string(),
            },
            ColumnDef {
                name: "path".to_string(),
                data_type: "text".to_string(),
            },
            ColumnDef {
                name: "status".to_string(),
                data_type: "integer".to_string(),
            },
            ColumnDef {
                name: "result".to_string(),
                data_type: "json".to_string(),
            },
        ],
        vec![vec![
            Value::String(request.method.as_str().to_string()),
            Value::String(request.path.clone()),
            json!(status),
            body,
        ]],
    )
}

fn elasticsearch_table_result(value: &Value) -> Option<QueryResult> {
    let documents = value.as_array()?;
    if !documents
        .iter()
        .all(|document| document.as_object().is_some())
    {
        return None;
    }

    let mut column_names = Vec::<String>::new();
    for document in documents {
        for name in document.as_object()?.keys() {
            if !column_names.contains(name) {
                column_names.push(name.to_string());
            }
        }
    }

    for preferred in ["index", "id", "score", "source"].iter().rev() {
        if let Some(position) = column_names.iter().position(|name| name == preferred) {
            let value = column_names.remove(position);
            column_names.insert(0, value);
        }
    }

    let columns = column_names
        .iter()
        .map(|name| ColumnDef {
            name: name.to_string(),
            data_type: "json".to_string(),
        })
        .collect::<Vec<_>>();
    let rows = documents
        .iter()
        .map(|document| {
            let object = document.as_object().expect("validated document object");
            column_names
                .iter()
                .map(|name| object.get(name).cloned().unwrap_or(Value::Null))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    Some(QueryResult::rows(columns, rows))
}

fn elasticsearch_indices_to_collections(value: Value) -> Vec<CollectionInfo> {
    value
        .as_array()
        .map(|indices| {
            indices
                .iter()
                .filter_map(|index| {
                    let name = index.get("index").and_then(Value::as_str)?.to_string();
                    let document_count = index
                        .get("docs.count")
                        .and_then(Value::as_str)
                        .and_then(|value| value.parse::<u64>().ok());
                    Some(CollectionInfo {
                        name,
                        namespace: Some("default".to_string()),
                        collection_type: Some("index".to_string()),
                        document_count,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn elasticsearch_mapping_to_columns(value: &Value, index: &str) -> Vec<ColumnInfo> {
    let mut columns = vec![ColumnInfo {
        name: "_id".to_string(),
        data_type: "keyword".to_string(),
        is_nullable: false,
        is_primary_key: true,
        is_unique: true,
        is_indexed: true,
        is_auto_increment: false,
        default_value: None,
        comment: Some("Elasticsearch document id".to_string()),
    }];

    let properties = value
        .get(index)
        .or_else(|| {
            value
                .as_object()
                .and_then(|indices| indices.values().next())
        })
        .and_then(|index_mapping| index_mapping.get("mappings"))
        .and_then(|mappings| mappings.get("properties"))
        .and_then(Value::as_object);

    if let Some(properties) = properties {
        collect_mapping_properties("", properties, &mut columns);
    }

    columns
}

fn collect_mapping_properties(
    prefix: &str,
    properties: &serde_json::Map<String, Value>,
    columns: &mut Vec<ColumnInfo>,
) {
    for (field, mapping) in properties {
        let name = if prefix.is_empty() {
            field.to_string()
        } else {
            format!("{prefix}.{field}")
        };
        let data_type = elasticsearch_mapping_type(mapping);
        let is_indexed = mapping
            .get("index")
            .and_then(Value::as_bool)
            .unwrap_or(true);

        columns.push(ColumnInfo {
            name: name.clone(),
            data_type,
            is_nullable: true,
            is_primary_key: false,
            is_unique: false,
            is_indexed,
            is_auto_increment: false,
            default_value: None,
            comment: None,
        });

        if let Some(nested_properties) = mapping.get("properties").and_then(Value::as_object) {
            collect_mapping_properties(&name, nested_properties, columns);
        }
    }
}

fn elasticsearch_mapping_type(mapping: &Value) -> String {
    mapping
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| {
            mapping
                .get("properties")
                .and_then(Value::as_object)
                .map(|_| "object")
        })
        .unwrap_or("object")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_body_as_default_search() {
        let requests = parse_elasticsearch_requests(r#"{"query":{"match_all":{}}}"#).unwrap();

        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, Method::POST);
        assert_eq!(requests[0].path, "/_search");
        assert!(requests[0].body.as_deref().unwrap().contains("match_all"));
    }

    #[test]
    fn scopes_default_search_to_active_index() {
        let request = parse_elasticsearch_requests(r#"{"query":{"match_all":{}}}"#)
            .unwrap()
            .remove(0);
        let scoped = scope_search_request_to_index(request, Some("user events"));

        assert_eq!(scoped.path, "/user%20events/_search");

        let explicit = parse_elasticsearch_requests(
            r#"
            GET /users/_search
            {"query":{"match_all":{}}}
            "#,
        )
        .unwrap()
        .remove(0);
        let explicit = scope_search_request_to_index(explicit, Some("orders"));

        assert_eq!(explicit.path, "/users/_search");
    }

    #[test]
    fn validates_index_context_without_treating_default_as_index() {
        assert_eq!(validate_elasticsearch_index_context("").unwrap(), None);
        assert_eq!(
            validate_elasticsearch_index_context(" default ").unwrap(),
            None
        );
        assert_eq!(
            validate_elasticsearch_index_context("logs-2026").unwrap(),
            Some("logs-2026".to_string())
        );
        assert!(validate_elasticsearch_index_context("logs/2026").is_err());
    }

    #[tokio::test]
    async fn tracks_active_index_context() {
        let driver = ElasticsearchDriver::new("http://localhost:9200").unwrap();

        assert_eq!(driver.active_index_name().await, None);
        driver.set_current_schema("logs-2026").await.unwrap();
        assert_eq!(
            driver.active_index_name().await,
            Some("logs-2026".to_string())
        );
        driver.set_current_schema("default").await.unwrap();
        assert_eq!(driver.active_index_name().await, None);
    }

    #[test]
    fn parses_http_style_elasticsearch_requests() {
        let requests = parse_elasticsearch_requests(
            r#"
            GET /_cluster/health
            POST /users/_search
            {"query":{"term":{"active":true}}}
            "#,
        )
        .unwrap();

        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].method, Method::GET);
        assert_eq!(requests[0].path, "/_cluster/health");
        assert_eq!(requests[0].body, None);
        assert_eq!(requests[1].method, Method::POST);
        assert_eq!(requests[1].path, "/users/_search");
        assert!(requests[1].body.as_deref().unwrap().contains("active"));
    }

    #[test]
    fn rejects_invalid_request_lines() {
        assert!(parse_elasticsearch_requests("GET").is_err());
        assert!(parse_elasticsearch_requests("GET _search").is_err());
        assert!(parse_elasticsearch_requests("not-json").is_err());
    }

    #[test]
    fn extracts_basic_auth_from_url() {
        let mut url = Url::parse("http://elastic:secret@localhost:9200").unwrap();
        assert_eq!(
            extract_basic_auth(&mut url),
            Some(("elastic".to_string(), "secret".to_string()))
        );
        assert_eq!(url.as_str(), "http://localhost:9200/");
    }

    #[test]
    fn normalizes_search_hits_for_grid_display() {
        let value = json!({
            "hits": {
                "hits": [
                    {"_index": "users", "_id": "1", "_score": 1.0, "_source": {"name": "Ada"}}
                ]
            }
        });

        assert_eq!(
            normalize_elasticsearch_response(value),
            json!([{
                "index": "users",
                "id": "1",
                "score": 1.0,
                "source": {"name": "Ada"}
            }])
        );
    }

    #[test]
    fn converts_search_hits_to_tabular_result() {
        let value = normalize_elasticsearch_response(json!({
            "hits": {
                "hits": [
                    {"_index": "users", "_id": "1", "_score": 1.0, "_source": {"name": "Ada"}},
                    {"_index": "users", "_id": "2", "_score": 0.8, "_source": {"name": "Grace"}}
                ]
            }
        }));
        let result = elasticsearch_table_result(&value).unwrap();

        assert_eq!(
            result
                .columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            vec!["index", "id", "score", "source"]
        );
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0][0], json!("users"));
        assert_eq!(result.rows[1][3], json!({"name": "Grace"}));
    }

    #[test]
    fn maps_cat_indices_to_collections() {
        let collections = elasticsearch_indices_to_collections(json!([
            {"index": "users", "docs.count": "42"},
            {"index": "orders", "docs.count": "7"}
        ]));

        assert_eq!(collections.len(), 2);
        assert_eq!(collections[0].name, "users");
        assert_eq!(collections[0].collection_type.as_deref(), Some("index"));
        assert_eq!(collections[0].document_count, Some(42));
    }

    #[test]
    fn maps_index_mapping_to_columns() {
        let columns = elasticsearch_mapping_to_columns(
            &json!({
                "users": {
                    "mappings": {
                        "properties": {
                            "email": {"type": "keyword"},
                            "active": {"type": "boolean"},
                            "profile": {
                                "properties": {
                                    "age": {"type": "integer"},
                                    "bio": {"type": "text", "index": false}
                                }
                            }
                        }
                    }
                }
            }),
            "users",
        );

        let id = columns.iter().find(|column| column.name == "_id").unwrap();
        assert_eq!(id.data_type, "keyword");
        assert!(id.is_primary_key);
        assert!(id.is_unique);

        let email = columns
            .iter()
            .find(|column| column.name == "email")
            .unwrap();
        assert_eq!(email.data_type, "keyword");
        assert!(email.is_indexed);

        let profile = columns
            .iter()
            .find(|column| column.name == "profile")
            .unwrap();
        assert_eq!(profile.data_type, "object");

        let bio = columns
            .iter()
            .find(|column| column.name == "profile.bio")
            .unwrap();
        assert_eq!(bio.data_type, "text");
        assert!(!bio.is_indexed);
    }
}
