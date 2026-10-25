use crate::core::{
    driver::DatabaseDriver,
    protocol::{
        ColumnDef, ColumnInfo, DatabaseInfo, QueryResult, TableInfo, DEFAULT_QUERY_RESULT_ROW_LIMIT,
    },
    statement::StatementScanDialect,
};
use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use futures::StreamExt;
use percent_encoding::percent_decode_str;
use reqwest::{Client, Response, StatusCode, Url};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const INFLUX_RESPONSE_MAX_BYTES: usize = 32 * 1024 * 1024;
const INFLUX_ERROR_MAX_BYTES: usize = 64 * 1024;
const INFLUX_SCHEMA: &str = "public";
const INFLUX_BUCKET_PAGE_SIZE: usize = 100;
const INFLUX_MAX_BUCKETS: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InfluxApiVersion {
    V1,
    V2,
}

pub struct InfluxDbDriver {
    client: Client,
    base_url: Url,
    version: InfluxApiVersion,
    username: Option<String>,
    password: Option<String>,
    organization: Option<String>,
    default_database: Option<String>,
    connected: AtomicBool,
}

#[derive(Serialize)]
struct FluxQuery<'a> {
    query: &'a str,
    #[serde(rename = "type")]
    query_type: &'static str,
}

impl InfluxDbDriver {
    pub fn new(connection_url: &str) -> Result<Self> {
        let parsed = parse_influxdb_connection_url(connection_url)?;
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            .build()
            .context("Failed to configure InfluxDB HTTP client")?;
        Ok(Self {
            client,
            base_url: parsed.base_url,
            version: parsed.version,
            username: parsed.username,
            password: parsed.password,
            organization: parsed.organization,
            default_database: parsed.default_database,
            connected: AtomicBool::new(false),
        })
    }

    fn ensure_connected(&self) -> Result<()> {
        if !self.connected.load(Ordering::Acquire) {
            bail!("InfluxDB connection is not established");
        }
        Ok(())
    }

    fn default_database(&self) -> Result<&str> {
        self.default_database
            .as_deref()
            .ok_or_else(|| anyhow!("Select an InfluxDB database or bucket before running a query"))
    }

    fn request(&self, request: reqwest::RequestBuilder) -> Result<reqwest::RequestBuilder> {
        match self.version {
            InfluxApiVersion::V1 => {
                Ok(match (self.username.as_deref(), self.password.as_deref()) {
                    (Some(username), password) if !username.is_empty() => {
                        request.basic_auth(username, password)
                    }
                    _ => request,
                })
            }
            InfluxApiVersion::V2 => {
                let token = self
                    .password
                    .as_deref()
                    .filter(|token| !token.trim().is_empty())
                    .ok_or_else(|| anyhow!("InfluxDB 2.x token is required"))?;
                Ok(request.header("Authorization", format!("Token {token}")))
            }
        }
    }

    fn endpoint(&self, path: &str) -> Result<Url> {
        self.base_url
            .join(path)
            .context("Invalid InfluxDB endpoint")
    }

    async fn v1_query(&self, database: Option<&str>, query: &str) -> Result<Value> {
        let mut url = self.endpoint("query")?;
        {
            let mut params = url.query_pairs_mut();
            params.append_pair("q", query);
            params.append_pair("epoch", "ms");
            if let Some(database) = database.filter(|database| !database.trim().is_empty()) {
                params.append_pair("db", database);
            }
        }
        let executable_read = starts_with_keyword(query, &["SELECT", "SHOW", "EXPLAIN"]);
        let request = if executable_read {
            self.client.get(url)
        } else {
            self.client.post(url)
        };
        let response = self
            .request(request)?
            .send()
            .await
            .context("InfluxDB query request failed")?;
        parse_influx_json_response(response).await
    }

    async fn v2_flux(&self, query: &str) -> Result<QueryResult> {
        let organization = self
            .organization
            .as_deref()
            .ok_or_else(|| anyhow!("InfluxDB 2.x organization is required"))?;
        let mut url = self.endpoint("api/v2/query")?;
        url.query_pairs_mut().append_pair("org", organization);
        let response = self
            .request(self.client.post(url).json(&FluxQuery {
                query,
                query_type: "flux",
            }))?
            .send()
            .await
            .context("InfluxDB Flux query request failed")?;
        let text = parse_influx_text_response(response).await?;
        parse_flux_csv(&text)
    }

    async fn v2_buckets(&self) -> Result<Vec<String>> {
        let organization = self
            .organization
            .as_deref()
            .ok_or_else(|| anyhow!("InfluxDB 2.x organization is required"))?;
        let mut offset = 0usize;
        let mut buckets = Vec::new();
        loop {
            if buckets.len() >= INFLUX_MAX_BUCKETS {
                bail!("InfluxDB bucket list exceeds the {INFLUX_MAX_BUCKETS}-bucket safety limit");
            }
            let mut url = self.endpoint("api/v2/buckets")?;
            {
                let mut params = url.query_pairs_mut();
                params.append_pair("org", organization);
                params.append_pair("limit", &INFLUX_BUCKET_PAGE_SIZE.to_string());
                params.append_pair("offset", &offset.to_string());
            }
            let response = self
                .request(self.client.get(url))?
                .send()
                .await
                .context("InfluxDB bucket discovery failed")?;
            let body = parse_influx_json_response(response).await?;
            let page = body
                .get("buckets")
                .and_then(Value::as_array)
                .ok_or_else(|| anyhow!("InfluxDB 2.x returned invalid buckets JSON"))?;
            for bucket in page {
                if let Some(name) = bucket
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|name| !name.trim().is_empty())
                {
                    buckets.push(name.to_string());
                }
            }
            if page.len() < INFLUX_BUCKET_PAGE_SIZE {
                break;
            }
            offset = offset.saturating_add(page.len());
        }
        buckets.sort_unstable();
        buckets.dedup();
        Ok(buckets)
    }

    async fn database_names(&self) -> Result<Vec<String>> {
        match self.version {
            InfluxApiVersion::V2 => self.v2_buckets().await,
            InfluxApiVersion::V1 => {
                let response = self.v1_query(None, "SHOW DATABASES").await;
                match response {
                    Ok(value) => Ok(influx_series_rows(&value)
                        .into_iter()
                        .filter_map(|(_, row, _)| {
                            row.first().and_then(Value::as_str).map(str::to_string)
                        })
                        .collect()),
                    Err(error) => {
                        let database = self.default_database.as_deref().ok_or(error)?;
                        self.v1_query(Some(database), "SHOW MEASUREMENTS").await?;
                        Ok(vec![database.to_string()])
                    }
                }
            }
        }
    }

    async fn tables_for_database(&self, database: &str) -> Result<Vec<TableInfo>> {
        let names = match self.version {
            InfluxApiVersion::V1 => {
                influx_series_rows(&self.v1_query(Some(database), "SHOW MEASUREMENTS").await?)
                    .into_iter()
                    .filter_map(|(_, row, _)| {
                        row.first().and_then(Value::as_str).map(str::to_string)
                    })
                    .collect()
            }
            InfluxApiVersion::V2 => {
                let bucket = escape_flux_string(database);
                let result = self.v2_flux(&format!("import \"influxdata/influxdb/schema\"\nschema.measurements(bucket: \"{bucket}\", start: 0)")) .await?;
                flux_column_values(&result, "_value")
            }
        };
        Ok(names
            .into_iter()
            .filter(|name| !name.trim().is_empty())
            .map(|name| TableInfo {
                name,
                schema: Some(INFLUX_SCHEMA.to_string()),
                table_type: Some("TABLE".to_string()),
                comment: None,
            })
            .collect())
    }

    async fn columns_for_database(&self, database: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        if !valid_measurement_name(table) {
            bail!("InfluxDB measurement name is invalid");
        }
        match self.version {
            InfluxApiVersion::V1 => {
                let quoted = table.replace('"', "\\\"");
                let tags = self
                    .v1_query(Some(database), &format!("SHOW TAG KEYS FROM \"{quoted}\""))
                    .await?;
                let fields = self
                    .v1_query(
                        Some(database),
                        &format!("SHOW FIELD KEYS FROM \"{quoted}\""),
                    )
                    .await?;
                let mut result = vec![influx_column("time", "timestamp", false, true)];
                for (_, row, _) in influx_series_rows(&tags) {
                    if let Some(name) = row.first().and_then(Value::as_str) {
                        result.push(influx_column(name, "string", true, true));
                    }
                }
                for (_, row, _) in influx_series_rows(&fields) {
                    if let Some(name) = row.first().and_then(Value::as_str) {
                        result.push(influx_column(
                            name,
                            row.get(1).and_then(Value::as_str).unwrap_or("unknown"),
                            true,
                            false,
                        ));
                    }
                }
                Ok(deduplicate_columns(result))
            }
            InfluxApiVersion::V2 => {
                let bucket = escape_flux_string(database);
                let measurement = escape_flux_string(table);
                let tags = self.v2_flux(&format!("import \"influxdata/influxdb/schema\"\nschema.measurementTagKeys(bucket: \"{bucket}\", measurement: \"{measurement}\", start: 0)")) .await?;
                let fields = self.v2_flux(&format!("import \"influxdata/influxdb/schema\"\nschema.measurementFieldKeys(bucket: \"{bucket}\", measurement: \"{measurement}\", start: 0)")) .await?;
                let mut result = vec![influx_column("time", "timestamp", false, true)];
                for name in flux_column_values(&tags, "_value") {
                    if !is_influx_system_column(&name) {
                        result.push(influx_column(&name, "string", true, true));
                    }
                }
                for name in flux_column_values(&fields, "_value") {
                    result.push(influx_column(&name, "field", true, false));
                }
                Ok(deduplicate_columns(result))
            }
        }
    }

    async fn query_database_bounded(
        &self,
        database: &str,
        query: &str,
    ) -> Result<Vec<QueryResult>> {
        self.ensure_connected()?;
        match self.version {
            InfluxApiVersion::V1 => Ok(vec![influx_v1_query_result(
                self.v1_query(Some(database), query).await?,
                DEFAULT_QUERY_RESULT_ROW_LIMIT,
            )]),
            InfluxApiVersion::V2 => Ok(vec![self.v2_flux(query).await?]),
        }
    }
}

#[async_trait]
impl DatabaseDriver for InfluxDbDriver {
    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        Some(StatementScanDialect::Postgres)
    }
    async fn connect(&mut self) -> Result<()> {
        self.database_names().await?;
        self.connected.store(true, Ordering::Release);
        Ok(())
    }
    async fn disconnect(&self) -> Result<()> {
        self.connected.store(false, Ordering::Release);
        Ok(())
    }
    async fn ping(&self) -> Result<()> {
        self.ensure_connected()?;
        self.database_names().await.map(|_| ())
    }
    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        self.query_database_bounded(self.default_database()?, sql)
            .await
    }
    async fn query_database(&self, database: &str, sql: &str) -> Result<Vec<QueryResult>> {
        self.query_database_bounded(database, sql).await
    }
    async fn query_database_with_context_tracked(
        &self,
        _: Option<&str>,
        database: &str,
        sql: &str,
        _: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        self.query_database_bounded(database, sql).await
    }
    async fn get_databases(&self) -> Result<Vec<String>> {
        self.ensure_connected()?;
        self.database_names().await
    }
    async fn get_database_metadata(&self) -> Result<Vec<DatabaseInfo>> {
        Ok(self
            .get_databases()
            .await?
            .into_iter()
            .map(|name| DatabaseInfo {
                name,
                ..DatabaseInfo::default()
            })
            .collect())
    }
    async fn get_schemas(&self) -> Result<Vec<String>> {
        self.ensure_connected()?;
        Ok(vec![INFLUX_SCHEMA.to_string()])
    }
    async fn get_database_schemas(&self, _: &str) -> Result<Vec<String>> {
        self.get_schemas().await
    }
    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        self.ensure_connected()?;
        if !schema.eq_ignore_ascii_case(INFLUX_SCHEMA) {
            return Ok(Vec::new());
        }
        self.tables_for_database(self.default_database()?).await
    }
    async fn get_database_tables(&self, database: &str, schema: &str) -> Result<Vec<TableInfo>> {
        self.ensure_connected()?;
        if !schema.eq_ignore_ascii_case(INFLUX_SCHEMA) {
            return Ok(Vec::new());
        }
        self.tables_for_database(database).await
    }
    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        self.ensure_connected()?;
        if !schema.eq_ignore_ascii_case(INFLUX_SCHEMA) {
            return Ok(Vec::new());
        }
        self.columns_for_database(self.default_database()?, table)
            .await
    }
    async fn get_database_columns(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        self.ensure_connected()?;
        if !schema.eq_ignore_ascii_case(INFLUX_SCHEMA) {
            return Ok(Vec::new());
        }
        self.columns_for_database(database, table).await
    }
}

struct InfluxConnectionUrl {
    base_url: Url,
    version: InfluxApiVersion,
    username: Option<String>,
    password: Option<String>,
    organization: Option<String>,
    default_database: Option<String>,
}

fn parse_influxdb_connection_url(value: &str) -> Result<InfluxConnectionUrl> {
    let mut url = Url::parse(value.trim()).context("Invalid InfluxDB connection URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!("InfluxDB connection URL must use HTTP or HTTPS and contain a host");
    }
    let query = url.query_pairs().into_owned().collect::<BTreeMap<_, _>>();
    let version = match query
        .get("apiVersion")
        .or_else(|| query.get("version"))
        .map(|value| value.to_ascii_lowercase())
    {
        Some(value) if matches!(value.as_str(), "2" | "v2") => InfluxApiVersion::V2,
        _ => InfluxApiVersion::V1,
    };
    let username = (!url.username().is_empty()).then(|| {
        percent_decode_str(url.username())
            .decode_utf8_lossy()
            .to_string()
    });
    let password = url
        .password()
        .map(|value| percent_decode_str(value).decode_utf8_lossy().to_string())
        .filter(|value| !value.is_empty());
    let default_database = query
        .get("db")
        .or_else(|| query.get("database"))
        .cloned()
        .or_else(|| {
            url.path_segments()
                .and_then(|mut parts| parts.find(|part| !part.is_empty()))
                .map(|part| percent_decode_str(part).decode_utf8_lossy().to_string())
        });
    let organization = query
        .get("org")
        .or_else(|| query.get("organization"))
        .cloned()
        .filter(|value| !value.trim().is_empty());
    url.set_username("")
        .map_err(|_| anyhow!("Invalid InfluxDB username"))?;
    url.set_password(None)
        .map_err(|_| anyhow!("Invalid InfluxDB password"))?;
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(InfluxConnectionUrl {
        base_url: url,
        version,
        username,
        password,
        organization,
        default_database,
    })
}

async fn parse_influx_json_response(response: Response) -> Result<Value> {
    let bytes = bounded_influx_body(response).await?;
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(Value::Object(Default::default()));
    }
    let value =
        serde_json::from_slice::<Value>(&bytes).context("InfluxDB returned invalid JSON")?;
    reject_influx_response_error(&value)?;
    Ok(value)
}

/// InfluxDB 1.x can report a query failure inside an HTTP-success JSON
/// envelope. Never render that failure as an empty, apparently valid grid.
fn reject_influx_response_error(value: &Value) -> Result<()> {
    let error = value
        .get("error")
        .or_else(|| value.get("message"))
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("results")
                .and_then(Value::as_array)
                .and_then(|results| {
                    results
                        .iter()
                        .find_map(|result| result.get("error").and_then(Value::as_str))
                })
        });
    if let Some(error) = error.filter(|error| !error.trim().is_empty()) {
        bail!("InfluxDB query failed: {error}");
    }
    Ok(())
}

async fn parse_influx_text_response(response: Response) -> Result<String> {
    let bytes = bounded_influx_body(response).await?;
    String::from_utf8(bytes).context("InfluxDB returned invalid UTF-8")
}

async fn bounded_influx_body(response: Response) -> Result<Vec<u8>> {
    let status = response.status();
    let limit = if status.is_success() {
        INFLUX_RESPONSE_MAX_BYTES
    } else {
        INFLUX_ERROR_MAX_BYTES
    };
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        bail!("InfluxDB response exceeds the {limit}-byte safety limit");
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("Failed to read InfluxDB response")?;
        if body.len().saturating_add(chunk.len()) > limit {
            bail!("InfluxDB response exceeds the {limit}-byte safety limit");
        }
        body.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        let hint = match status {
            StatusCode::UNAUTHORIZED => "Unauthorized; check the InfluxDB credentials or token",
            StatusCode::FORBIDDEN => "Access denied",
            StatusCode::NOT_FOUND => "Endpoint not found; verify the InfluxDB base URL",
            _ => "Request failed",
        };
        let message = serde_json::from_slice::<Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .or_else(|| value.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| hint.to_string());
        bail!("InfluxDB returned HTTP {}: {message}", status.as_u16());
    }
    Ok(body)
}

type InfluxSeriesRow = (Vec<String>, Vec<Value>, BTreeMap<String, String>);

fn influx_series_rows(value: &Value) -> Vec<InfluxSeriesRow> {
    value
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|result| {
            result
                .get("series")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|series| {
            let columns = series
                .get("columns")?
                .as_array()?
                .iter()
                .map(Value::as_str)
                .collect::<Option<Vec<_>>>()?
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>();
            let tags: BTreeMap<String, String> = series
                .get("tags")
                .and_then(Value::as_object)
                .map(|tags| {
                    tags.iter()
                        .filter_map(|(key, value)| {
                            value.as_str().map(|value| (key.clone(), value.to_string()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            Some(
                series
                    .get("values")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(move |row| {
                        row.as_array()
                            .cloned()
                            .map(|row| (columns.clone(), row, tags.clone()))
                    }),
            )
        })
        .flatten()
        .collect()
}

fn influx_v1_query_result(value: Value, limit: usize) -> QueryResult {
    let items = influx_series_rows(&value);
    let mut columns = Vec::new();
    let mut indexes = BTreeMap::new();
    let mut tag_columns = BTreeMap::new();
    for (source, _, tags) in &items {
        for name in source {
            if !indexes.contains_key(name) {
                indexes.insert(name.clone(), columns.len());
                columns.push(name.clone());
            }
        }
        for name in tags.keys() {
            if !tag_columns.contains_key(name) {
                tag_columns.insert(name.clone(), 0usize);
            }
        }
    }
    let tag_names = tag_columns.keys().cloned().collect::<Vec<_>>();
    for name in tag_names {
        tag_columns.insert(name.clone(), columns.len());
        columns.push(name);
    }
    let definitions = columns
        .iter()
        .map(|name| ColumnDef {
            name: name.clone(),
            data_type: "unknown".to_string(),
        })
        .collect::<Vec<_>>();
    let mut rows = Vec::new();
    for (source, values, tags) in items {
        if rows.len() > limit {
            break;
        }
        let mut row = vec![Value::Null; columns.len()];
        for (index, value) in values.into_iter().enumerate() {
            if let Some(target) = source.get(index).and_then(|name| indexes.get(name)) {
                row[*target] = value;
            }
        }
        for (name, value) in tags {
            if let Some(target) = tag_columns.get(&name) {
                row[*target] = Value::String(value);
            }
        }
        rows.push(row);
    }
    QueryResult::rows_limited(definitions, rows, limit)
}

fn parse_flux_csv(text: &str) -> Result<QueryResult> {
    let mut headers = None;
    let mut rows = Vec::new();
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        // Flux annotation records intentionally have a different field count
        // from the header/data rows. They are filtered below, so the CSV
        // parser must not reject the stream before that boundary.
        .flexible(true)
        .from_reader(text.as_bytes());
    for record in reader.records() {
        let record = record.context("InfluxDB Flux CSV parse error")?;
        if record.is_empty()
            || record.iter().all(|value| value.trim().is_empty())
            || record.get(0).is_some_and(|value| value.starts_with('#'))
        {
            continue;
        }
        if headers.is_none() {
            let mut names = record.iter().map(str::to_string).collect::<Vec<_>>();
            if names.first().is_some_and(String::is_empty) {
                names.remove(0);
            }
            headers = Some(names);
            continue;
        }
        let mut values = record
            .iter()
            .map(|value| {
                if value.is_empty() {
                    Value::Null
                } else {
                    Value::String(value.to_string())
                }
            })
            .collect::<Vec<_>>();
        if values.len() == headers.as_ref().map(Vec::len).unwrap_or_default() + 1
            && record.get(0).is_some_and(str::is_empty)
        {
            values.remove(0);
        }
        rows.push(values);
    }
    let columns = headers.unwrap_or_default();
    Ok(QueryResult::rows_limited(
        columns
            .into_iter()
            .map(|name| ColumnDef {
                name,
                data_type: "string".to_string(),
            })
            .collect(),
        rows,
        DEFAULT_QUERY_RESULT_ROW_LIMIT,
    ))
}

fn flux_column_values(result: &QueryResult, name: &str) -> Vec<String> {
    let Some(index) = result.columns.iter().position(|column| column.name == name) else {
        return Vec::new();
    };
    result
        .rows
        .iter()
        .filter_map(|row| row.get(index).and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .collect()
}
fn influx_column(name: &str, data_type: &str, nullable: bool, primary_key: bool) -> ColumnInfo {
    ColumnInfo {
        name: name.to_string(),
        data_type: data_type.to_string(),
        is_nullable: nullable,
        is_unique: false,
        is_indexed: false,
        is_auto_increment: false,
        identity_generation: None,
        is_generated: None,
        is_hidden: None,
        character_set: None,
        collation: None,
        is_primary_key: primary_key,
        default_value: None,
        comment: None,
    }
}
fn deduplicate_columns(columns: Vec<ColumnInfo>) -> Vec<ColumnInfo> {
    let mut seen = BTreeMap::new();
    columns
        .into_iter()
        .filter(|column| seen.insert(column.name.to_ascii_lowercase(), ()).is_none())
        .collect()
}
fn valid_measurement_name(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 512 && !value.contains('\0')
}
fn escape_flux_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
fn is_influx_system_column(value: &str) -> bool {
    matches!(
        value,
        "_start" | "_stop" | "_time" | "_value" | "_field" | "_measurement"
    )
}
fn starts_with_keyword(sql: &str, keywords: &[&str]) -> bool {
    let upper = sql.trim_start().to_ascii_uppercase();
    keywords.iter().any(|keyword| {
        upper.starts_with(keyword)
            && upper[keyword.len()..]
                .chars()
                .next()
                .is_none_or(|character| !character.is_ascii_alphabetic())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn url_keeps_credentials_out_of_base_and_selects_v2() {
        let url = parse_influxdb_connection_url(
            "https://user:secret%20token@metrics.test:8086/telemetry?version=2&org=team",
        )
        .unwrap();
        assert_eq!(url.version, InfluxApiVersion::V2);
        assert_eq!(url.default_database.as_deref(), Some("telemetry"));
        assert_eq!(url.organization.as_deref(), Some("team"));
        assert!(!url.base_url.as_str().contains("secret"));
    }
    #[test]
    fn v1_series_merge_preserves_tags_and_limits_rows() {
        let result = influx_v1_query_result(
            json!({"results":[{"series":[{"columns":["time","value"],"values":[[1,2],[2,3]],"tags":{"host":"a"}},{"columns":["time","other"],"values":[[3,4]],"tags":{"region":"us"}}]}]}),
            2,
        );
        assert_eq!(result.rows.len(), 2);
        assert!(result.truncated);
        assert_eq!(
            result
                .columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            vec!["time", "value", "other", "host", "region"]
        );
    }
    #[test]
    fn flux_parser_skips_annotations_and_keeps_csv_columns() {
        let result =
            parse_flux_csv("#datatype,string,long\n,result,table,_value\n,,0,cpu\n").unwrap();
        assert_eq!(
            result
                .columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            vec!["result", "table", "_value"]
        );
        assert_eq!(result.rows[0][2], json!("cpu"));
    }
    #[test]
    fn v1_metadata_rows_and_measurement_safety_are_bounded() {
        let rows = influx_series_rows(
            &json!({"results":[{"series":[{"columns":["name"],"values":[["cpu"]]}]}]}),
        );
        assert_eq!(rows[0].1[0], json!("cpu"));
        assert!(!valid_measurement_name(""));
        assert!(!valid_measurement_name(&"x".repeat(513)));
    }

    #[test]
    fn influx_json_envelope_errors_are_never_empty_results() {
        assert!(reject_influx_response_error(&json!({"error":"database not found"})).is_err());
        assert!(reject_influx_response_error(&json!({"results":[{"error":"forbidden"}]})).is_err());
        assert!(reject_influx_response_error(&json!({"results":[{}]})).is_ok());
    }
}
