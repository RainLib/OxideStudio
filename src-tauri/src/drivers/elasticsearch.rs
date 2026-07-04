use crate::core::{
    driver::DatabaseDriver,
    protocol::{CollectionInfo, ColumnDef, QueryResult},
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use reqwest::{Client, Method, Url};
use serde_json::{json, Value};

pub struct ElasticsearchDriver {
    base_url: Url,
    client: Client,
    auth: Option<(String, String)>,
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
        })
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
        if requests.is_empty() {
            return Err(anyhow!("Elasticsearch query is required"));
        }

        let columns = vec![
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
        ];
        let mut rows = Vec::new();

        for request in requests {
            let (status, body) = self.send_request(&request).await?;
            rows.push(vec![
                Value::String(request.method.as_str().to_string()),
                Value::String(request.path),
                json!(status),
                normalize_elasticsearch_response(body),
            ]);
        }

        Ok(vec![QueryResult::rows(columns, rows)])
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
}
