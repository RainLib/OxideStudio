use crate::core::{
    driver::DatabaseDriver,
    protocol::{
        ColumnDef, ColumnInfo, DatabaseInfo, QueryResult, TableInfo, DEFAULT_QUERY_RESULT_ROW_LIMIT,
    },
};
use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use futures::StreamExt;
use percent_encoding::percent_decode_str;
use reqwest::{Client, Response, StatusCode, Url};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const DEFAULT_API_PATH: &str = "/prometheus";
const DEFAULT_LOOKBACK: &str = "1h";
const VICTORIA_RESPONSE_MAX_BYTES: usize = 32 * 1024 * 1024;
const VICTORIA_ERROR_MAX_BYTES: usize = 64 * 1024;
const VICTORIA_MAX_METRICS: usize = 100_000;
const VICTORIA_SCHEMA: &str = "metrics";

pub struct VictoriaMetricsDriver {
    client: Client,
    base_url: Url,
    api_path: String,
    lookback: String,
    username: Option<String>,
    password: Option<String>,
    connected: AtomicBool,
}

#[derive(Deserialize)]
struct ApiEnvelope {
    status: String,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default, rename = "errorType")]
    error_type: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

impl VictoriaMetricsDriver {
    pub fn new(connection_url: &str) -> Result<Self> {
        let parsed = parse_victoria_connection_url(connection_url)?;
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            .build()
            .context("Failed to configure VictoriaMetrics HTTP client")?;
        Ok(Self {
            client,
            base_url: parsed.base_url,
            api_path: parsed.api_path,
            lookback: parsed.lookback,
            username: parsed.username,
            password: parsed.password,
            connected: AtomicBool::new(false),
        })
    }

    fn request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.username.as_deref() {
            Some(username) if !username.is_empty() => {
                request.basic_auth(username, self.password.as_deref())
            }
            _ => request,
        }
    }

    fn endpoint(&self, suffix: &str) -> Result<Url> {
        let path = format!("{}{}", self.api_path, suffix);
        self.base_url
            .join(path.trim_start_matches('/'))
            .context("Invalid VictoriaMetrics endpoint")
    }

    fn ensure_connected(&self) -> Result<()> {
        if !self.connected.load(Ordering::Acquire) {
            bail!("VictoriaMetrics connection is not established");
        }
        Ok(())
    }

    async fn api_get(&self, suffix: &str) -> Result<Value> {
        let response = self
            .request(self.client.get(self.endpoint(suffix)?))
            .send()
            .await
            .context("VictoriaMetrics request failed")?;
        parse_victoria_response(response).await
    }

    async fn metric_names(&self) -> Result<Vec<String>> {
        let url = self.endpoint("/api/v1/label/__name__/values")?;
        let response = self
            .request(
                self.client
                    .get(url)
                    .query(&[("start", format!("-{}", self.lookback))]),
            )
            .send()
            .await
            .context("VictoriaMetrics metric discovery failed")?;
        let values = parse_victoria_response(response).await?;
        let mut names = values
            .as_array()
            .ok_or_else(|| anyhow!("VictoriaMetrics returned invalid metric-name JSON"))?
            .iter()
            .filter_map(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .take(VICTORIA_MAX_METRICS + 1)
            .map(str::to_string)
            .collect::<Vec<_>>();
        if names.len() > VICTORIA_MAX_METRICS {
            bail!("VictoriaMetrics metric list exceeds the {VICTORIA_MAX_METRICS}-metric safety limit");
        }
        names.sort_unstable();
        names.dedup();
        Ok(names)
    }

    async fn columns_for_metric(&self, metric: &str) -> Result<Vec<ColumnInfo>> {
        if !valid_metric_name(metric) {
            bail!("VictoriaMetrics metric name is invalid");
        }
        let selector = metric_selector(metric);
        let url = self.endpoint("/api/v1/series")?;
        let start = format!("-{}", self.lookback);
        let response = self
            .request(
                self.client
                    .post(url)
                    .form(&[("match[]", selector.as_str()), ("start", start.as_str())]),
            )
            .send()
            .await
            .context("VictoriaMetrics label discovery failed")?;
        let data = parse_victoria_response(response).await?;
        let labels = data
            .as_array()
            .ok_or_else(|| anyhow!("VictoriaMetrics returned invalid series JSON"))?
            .iter()
            .filter_map(Value::as_object)
            .flat_map(|labels| labels.keys())
            .filter(|name| name.as_str() != "__name__")
            .take(VICTORIA_MAX_METRICS)
            .cloned()
            .collect::<BTreeSet<_>>();
        let labels = labels.into_iter().collect::<Vec<_>>();
        let (timestamp, value, metric_name) = result_column_names(&labels);
        let mut columns = vec![
            column(&timestamp, "timestamp", false, true, "Sample timestamp"),
            column(&value, "double", false, false, "Sample value"),
            column(&metric_name, "string", false, true, "Metric name"),
        ];
        columns.extend(
            labels
                .into_iter()
                .map(|name| column(&name, "string", true, true, "Metric label")),
        );
        Ok(columns)
    }

    async fn query_metricsql(&self, query: &str) -> Result<QueryResult> {
        self.ensure_connected()?;
        let query = query.trim().trim_end_matches(';').trim();
        if query.is_empty() {
            bail!("VictoriaMetrics query is empty");
        }
        if query.len() > 64 * 1024 {
            bail!("VictoriaMetrics query exceeds the 65536-byte safety limit");
        }
        let response = self
            .request(
                self.client
                    .post(self.endpoint("/api/v1/query")?)
                    .form(&[("query", query)]),
            )
            .send()
            .await
            .context("VictoriaMetrics query request failed")?;
        query_result_from_data(parse_victoria_response(response).await?)
    }
}

#[async_trait]
impl DatabaseDriver for VictoriaMetricsDriver {
    async fn connect(&mut self) -> Result<()> {
        self.api_get("/api/v1/status/buildinfo").await?;
        self.connected.store(true, Ordering::Release);
        Ok(())
    }
    async fn disconnect(&self) -> Result<()> {
        self.connected.store(false, Ordering::Release);
        Ok(())
    }
    async fn ping(&self) -> Result<()> {
        self.ensure_connected()?;
        self.api_get("/api/v1/status/buildinfo").await.map(|_| ())
    }
    async fn query(&self, query: &str) -> Result<Vec<QueryResult>> {
        Ok(vec![self.query_metricsql(query).await?])
    }
    async fn query_database(&self, _: &str, query: &str) -> Result<Vec<QueryResult>> {
        self.query(query).await
    }
    async fn query_database_with_context_tracked(
        &self,
        _: Option<&str>,
        _: &str,
        query: &str,
        _: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        self.query(query).await
    }
    async fn get_databases(&self) -> Result<Vec<String>> {
        self.ensure_connected()?;
        Ok(vec![VICTORIA_SCHEMA.to_string()])
    }
    async fn get_database_metadata(&self) -> Result<Vec<DatabaseInfo>> {
        Ok(vec![DatabaseInfo {
            name: VICTORIA_SCHEMA.to_string(),
            ..DatabaseInfo::default()
        }])
    }
    async fn get_schemas(&self) -> Result<Vec<String>> {
        self.ensure_connected()?;
        Ok(vec![VICTORIA_SCHEMA.to_string()])
    }
    async fn get_database_schemas(&self, _: &str) -> Result<Vec<String>> {
        self.get_schemas().await
    }
    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        self.ensure_connected()?;
        if !schema.eq_ignore_ascii_case(VICTORIA_SCHEMA) {
            return Ok(Vec::new());
        }
        Ok(self
            .metric_names()
            .await?
            .into_iter()
            .map(|name| TableInfo {
                name,
                schema: Some(VICTORIA_SCHEMA.to_string()),
                table_type: Some("METRIC".to_string()),
                comment: None,
            })
            .collect())
    }
    async fn get_database_tables(&self, _: &str, schema: &str) -> Result<Vec<TableInfo>> {
        self.get_tables(schema).await
    }
    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        self.ensure_connected()?;
        if !schema.eq_ignore_ascii_case(VICTORIA_SCHEMA) {
            return Ok(Vec::new());
        }
        self.columns_for_metric(table).await
    }
    async fn get_database_columns(
        &self,
        _: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        self.get_columns(schema, table).await
    }
}

struct VictoriaConnectionUrl {
    base_url: Url,
    api_path: String,
    lookback: String,
    username: Option<String>,
    password: Option<String>,
}

fn parse_victoria_connection_url(value: &str) -> Result<VictoriaConnectionUrl> {
    let mut url = Url::parse(value.trim()).context("Invalid VictoriaMetrics connection URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!("VictoriaMetrics connection URL must use HTTP or HTTPS and contain a host");
    }
    let path = url.path().trim_end_matches('/');
    let api_path = if path.is_empty() || path == "/" {
        DEFAULT_API_PATH.to_string()
    } else {
        normalize_api_path(path)?
    };
    let mut lookback = url
        .query_pairs()
        .find(|(key, _)| key.eq_ignore_ascii_case("lookback"))
        .map(|(_, value)| value.to_string())
        .unwrap_or_else(|| DEFAULT_LOOKBACK.to_string());
    if !valid_lookback(&lookback) {
        lookback = DEFAULT_LOOKBACK.to_string();
    }
    let username = (!url.username().is_empty()).then(|| {
        percent_decode_str(url.username())
            .decode_utf8_lossy()
            .to_string()
    });
    let password = url
        .password()
        .map(|value| percent_decode_str(value).decode_utf8_lossy().to_string())
        .filter(|value| !value.is_empty());
    url.set_username("")
        .map_err(|_| anyhow!("Invalid VictoriaMetrics username"))?;
    url.set_password(None)
        .map_err(|_| anyhow!("Invalid VictoriaMetrics password"))?;
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(VictoriaConnectionUrl {
        base_url: url,
        api_path,
        lookback,
        username,
        password,
    })
}

fn normalize_api_path(value: &str) -> Result<String> {
    let value = value.trim().trim_end_matches('/');
    if value.is_empty() || value == "/" {
        return Ok(String::new());
    }
    if !value.starts_with('/') || value.contains("//") || value.contains('\0') || value.len() > 512
    {
        bail!("VictoriaMetrics API path is invalid");
    }
    Ok(value.to_string())
}

fn valid_lookback(value: &str) -> bool {
    let value = value.trim();
    let split = value
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(value.len());
    split > 0
        && split < value.len()
        && value[..split].parse::<u64>().is_ok_and(|number| number > 0)
        && matches!(&value[split..], "ms" | "s" | "m" | "h" | "d" | "w" | "y")
}

async fn parse_victoria_response(response: Response) -> Result<Value> {
    let status = response.status();
    let bytes = bounded_victoria_body(response).await?;
    if !status.is_success() {
        let hint = match status {
            StatusCode::UNAUTHORIZED => "Unauthorized; check the VictoriaMetrics credentials",
            StatusCode::FORBIDDEN => "Access denied",
            StatusCode::NOT_FOUND => "Endpoint not found; verify the API path",
            _ => "Request failed",
        };
        let message = serde_json::from_slice::<Value>(&bytes)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| hint.to_string());
        bail!(
            "VictoriaMetrics returned HTTP {}: {message}",
            status.as_u16()
        );
    }
    let envelope = serde_json::from_slice::<ApiEnvelope>(&bytes)
        .context("VictoriaMetrics returned invalid JSON")?;
    if envelope.status != "success" {
        let kind = envelope
            .error_type
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("{value}: "))
            .unwrap_or_default();
        bail!(
            "VictoriaMetrics error: {kind}{}",
            envelope
                .error
                .unwrap_or_else(|| "unknown error".to_string())
        );
    }
    envelope
        .data
        .ok_or_else(|| anyhow!("VictoriaMetrics response is missing data"))
}

async fn bounded_victoria_body(response: Response) -> Result<Vec<u8>> {
    let limit = if response.status().is_success() {
        VICTORIA_RESPONSE_MAX_BYTES
    } else {
        VICTORIA_ERROR_MAX_BYTES
    };
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        bail!("VictoriaMetrics response exceeds the {limit}-byte safety limit");
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("Failed to read VictoriaMetrics response")?;
        if body.len().saturating_add(chunk.len()) > limit {
            bail!("VictoriaMetrics response exceeds the {limit}-byte safety limit");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn query_result_from_data(data: Value) -> Result<QueryResult> {
    let object = data
        .as_object()
        .ok_or_else(|| anyhow!("VictoriaMetrics query response is invalid"))?;
    let kind = object
        .get("resultType")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("VictoriaMetrics query response has no result type"))?;
    let value = object
        .get("result")
        .cloned()
        .ok_or_else(|| anyhow!("VictoriaMetrics query response has no result"))?;
    match kind {
        "vector" | "matrix" => series_result(value),
        "scalar" | "string" => {
            let values = value
                .as_array()
                .ok_or_else(|| anyhow!("VictoriaMetrics scalar response is invalid"))?;
            if values.len() != 2 {
                bail!("VictoriaMetrics scalar response is invalid");
            }
            let timestamp = values[0]
                .as_f64()
                .ok_or_else(|| anyhow!("VictoriaMetrics scalar timestamp is invalid"))?;
            let raw = values[1]
                .as_str()
                .ok_or_else(|| anyhow!("VictoriaMetrics scalar value is invalid"))?;
            let typed = if kind == "string" {
                Value::String(raw.to_string())
            } else {
                sample_value(raw)
            };
            Ok(QueryResult::rows_limited(
                vec![
                    ColumnDef {
                        name: "timestamp".to_string(),
                        data_type: "timestamp".to_string(),
                    },
                    ColumnDef {
                        name: "value".to_string(),
                        data_type: if kind == "string" {
                            "string".to_string()
                        } else {
                            "double".to_string()
                        },
                    },
                ],
                vec![vec![timestamp_value(timestamp), typed]],
                DEFAULT_QUERY_RESULT_ROW_LIMIT,
            ))
        }
        other => bail!("VictoriaMetrics returned unsupported result type: {other}"),
    }
}

fn series_result(value: Value) -> Result<QueryResult> {
    let series = value
        .as_array()
        .ok_or_else(|| anyhow!("VictoriaMetrics series response is invalid"))?;
    let labels = series
        .iter()
        .filter_map(|item| item.get("metric").and_then(Value::as_object))
        .flat_map(|labels| labels.keys())
        .filter(|name| name.as_str() != "__name__")
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let (timestamp, sample, metric) = result_column_names(&labels);
    let definitions = std::iter::once(ColumnDef {
        name: timestamp,
        data_type: "timestamp".to_string(),
    })
    .chain(std::iter::once(ColumnDef {
        name: sample,
        data_type: "double".to_string(),
    }))
    .chain(std::iter::once(ColumnDef {
        name: metric,
        data_type: "string".to_string(),
    }))
    .chain(labels.iter().cloned().map(|name| ColumnDef {
        name,
        data_type: "string".to_string(),
    }))
    .collect::<Vec<_>>();
    let mut rows = Vec::new();
    for item in series {
        let labels_value = item.get("metric").and_then(Value::as_object);
        let name = labels_value
            .and_then(|labels| labels.get("__name__"))
            .cloned()
            .unwrap_or(Value::Null);
        let mut samples: Vec<&Value> = Vec::new();
        if let Some(value) = item.get("value") {
            samples.push(value);
        }
        if let Some(values) = item.get("values").and_then(Value::as_array) {
            samples.extend(values.iter());
        }
        for value in samples {
            if rows.len() > DEFAULT_QUERY_RESULT_ROW_LIMIT {
                break;
            }
            let values = value
                .as_array()
                .filter(|values| values.len() == 2)
                .ok_or_else(|| anyhow!("VictoriaMetrics sample is invalid"))?;
            let timestamp = values[0]
                .as_f64()
                .ok_or_else(|| anyhow!("VictoriaMetrics sample timestamp is invalid"))?;
            let raw = values[1]
                .as_str()
                .ok_or_else(|| anyhow!("VictoriaMetrics sample value is invalid"))?;
            let mut row = vec![timestamp_value(timestamp), sample_value(raw), name.clone()];
            row.extend(labels.iter().map(|label| {
                labels_value
                    .and_then(|labels| labels.get(label))
                    .cloned()
                    .unwrap_or(Value::Null)
            }));
            rows.push(row);
        }
    }
    Ok(QueryResult::rows_limited(
        definitions,
        rows,
        DEFAULT_QUERY_RESULT_ROW_LIMIT,
    ))
}

fn column(
    name: &str,
    data_type: &str,
    is_nullable: bool,
    is_primary_key: bool,
    comment: &str,
) -> ColumnInfo {
    ColumnInfo {
        name: name.to_string(),
        data_type: data_type.to_string(),
        is_nullable,
        is_unique: false,
        is_indexed: false,
        is_auto_increment: false,
        identity_generation: None,
        is_generated: None,
        is_hidden: None,
        is_primary_key,
        default_value: None,
        comment: Some(comment.to_string()),
    }
}
fn result_column_names(labels: &[String]) -> (String, String, String) {
    let mut used = labels.iter().cloned().collect::<BTreeSet<_>>();
    (
        unique_name("timestamp", "sample_timestamp", &mut used),
        unique_name("value", "sample_value", &mut used),
        unique_name("metric", "metric_name", &mut used),
    )
}
fn unique_name(preferred: &str, fallback: &str, used: &mut BTreeSet<String>) -> String {
    let mut candidate = if used.contains(preferred) {
        fallback.to_string()
    } else {
        preferred.to_string()
    };
    let mut suffix = 2;
    while used.contains(&candidate) {
        candidate = format!("{fallback}_{suffix}");
        suffix += 1;
    }
    used.insert(candidate.clone());
    candidate
}
fn timestamp_value(value: f64) -> Value {
    DateTime::<Utc>::from_timestamp(
        value.trunc() as i64,
        (value.fract().abs() * 1_000_000_000.0) as u32,
    )
    .map(|value| Value::String(value.to_rfc3339()))
    .unwrap_or_else(|| json!(value))
}
fn sample_value(value: &str) -> Value {
    value
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite())
        .map(|number| json!(number))
        .unwrap_or_else(|| Value::String(value.to_string()))
}
fn metric_selector(name: &str) -> String {
    format!(
        r#"{{__name__="{}"}}"#,
        name.replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
    )
}
fn valid_metric_name(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 512 && !value.contains('\0')
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_paths_and_lookbacks() {
        assert_eq!(
            normalize_api_path("/select/42/prometheus/").unwrap(),
            "/select/42/prometheus"
        );
        assert!(normalize_api_path("prometheus").is_err());
        assert!(valid_lookback("15m"));
        assert!(valid_lookback("250ms"));
        assert!(!valid_lookback("0h"));
        assert!(!valid_lookback("1 hour"));
    }
    #[test]
    fn escaped_metric_selector_and_reserved_labels_are_safe() {
        assert_eq!(metric_selector("rack\"temp"), r#"{__name__="rack\"temp"}"#);
        let result = series_result(json!([{ "metric": {"__name__":"flag", "timestamp":"label"}, "value": [1720000000.0,"1"] }])).unwrap();
        assert_eq!(
            result
                .columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            vec!["sample_timestamp", "value", "metric", "timestamp"]
        );
    }
    #[test]
    fn parses_matrix_and_scalar_results() {
        let matrix = query_result_from_data(json!({"resultType":"matrix","result":[{"metric":{"__name__":"temperature","site":"shanghai"},"values":[[1720000000.0,"23.5"],[1720000060.0,"24"]]}]})).unwrap();
        assert_eq!(matrix.rows.len(), 2);
        assert_eq!(matrix.rows[0][1], json!(23.5));
        let scalar =
            query_result_from_data(json!({"resultType":"scalar","result":[1720000000.0,"42"]}))
                .unwrap();
        assert_eq!(scalar.rows[0][1], json!(42.0));
    }
    #[test]
    fn url_redacts_credentials_and_keeps_api_configuration() {
        let config = parse_victoria_connection_url(
            "https://user:secret@metrics.test:8428/select/42/prometheus?lookback=7d",
        )
        .unwrap();
        assert_eq!(config.api_path, "/select/42/prometheus");
        assert_eq!(config.lookback, "7d");
        assert!(!config.base_url.as_str().contains("secret"));
    }
}
