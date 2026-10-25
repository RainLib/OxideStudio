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
use regex::Regex;
use reqwest::{Client, Response, StatusCode, Url};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    OnceLock,
};
use std::time::Duration;

const INFLUXDB3_BOOTSTRAP_DATABASE: &str = "_internal";
const INFLUXDB3_USER_SCHEMA: &str = "iox";
const INFLUXDB3_RESPONSE_MAX_BYTES: usize = 32 * 1024 * 1024;
const INFLUXDB3_ERROR_MAX_BYTES: usize = 64 * 1024;

pub struct InfluxDb3Driver {
    client: Client,
    base_url: String,
    token: Option<String>,
    default_database: Option<String>,
    connected: AtomicBool,
}

#[derive(Serialize)]
struct InfluxDb3Query<'a> {
    db: &'a str,
    q: &'a str,
    format: &'static str,
}

impl InfluxDb3Driver {
    pub fn new(connection_url: &str) -> Result<Self> {
        let (base_url, token, default_database) = parse_influxdb3_connection_url(connection_url)?;
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            .build()
            .context("Failed to configure InfluxDB 3 HTTP client")?;
        Ok(Self {
            client,
            base_url,
            token,
            default_database,
            connected: AtomicBool::new(false),
        })
    }

    fn request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.token.as_deref() {
            Some(token) => request.bearer_auth(token),
            None => request,
        }
    }

    fn ensure_connected(&self) -> Result<()> {
        if !self.connected.load(Ordering::Acquire) {
            bail!("InfluxDB 3 connection is not established");
        }
        Ok(())
    }

    fn default_database(&self) -> Result<&str> {
        self.default_database
            .as_deref()
            .ok_or_else(|| anyhow!("Select an InfluxDB 3 database before running a query"))
    }

    async fn post_query_rows(&self, database: &str, sql: &str) -> Result<Vec<Value>> {
        let url = format!("{}/api/v3/query_sql", self.base_url);
        let response = self
            .request(self.client.post(url).json(&InfluxDb3Query {
                db: database,
                q: sql,
                format: "json",
            }))
            .send()
            .await
            .context("InfluxDB 3 query request failed")?;
        parse_influxdb3_json_response(response).await
    }

    async fn list_database_names(&self) -> Result<Vec<String>> {
        let url = format!("{}/api/v3/configure/database?format=json", self.base_url);
        let response = self
            .request(self.client.get(url))
            .send()
            .await
            .context("InfluxDB 3 database discovery failed")?;
        let rows = parse_influxdb3_json_response(response).await?;
        Ok(influxdb3_database_names(&rows))
    }

    async fn probe(&self) -> Result<()> {
        let database = if let Some(database) = self.default_database.as_deref() {
            database.to_string()
        } else {
            self.list_database_names()
                .await
                .ok()
                .and_then(|databases| databases.into_iter().next())
                .unwrap_or_else(|| INFLUXDB3_BOOTSTRAP_DATABASE.to_string())
        };
        self.post_query_rows(&database, "SELECT 1").await?;
        Ok(())
    }

    async fn query_database_bounded(&self, database: &str, sql: &str) -> Result<Vec<QueryResult>> {
        self.ensure_connected()?;
        let effective_sql = inject_influxdb3_limit(sql, DEFAULT_QUERY_RESULT_ROW_LIMIT)
            .unwrap_or_else(|| sql.to_string());
        let rows = self.post_query_rows(database, &effective_sql).await?;
        Ok(vec![influxdb3_query_result(
            rows,
            DEFAULT_QUERY_RESULT_ROW_LIMIT,
        )])
    }

    async fn tables_for_database(&self, database: &str) -> Result<Vec<TableInfo>> {
        let rows = self.post_query_rows(database, "SHOW TABLES").await?;
        Ok(influxdb3_tables(&rows))
    }

    async fn columns_for_database(&self, database: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        if table.trim().is_empty() || table.len() > 512 || table.contains('\0') {
            bail!("InfluxDB 3 table name is invalid");
        }
        let table = table.replace('\'', "''");
        let sql = format!(
            "SELECT column_name, data_type, is_nullable FROM information_schema.columns \
             WHERE table_schema = '{INFLUXDB3_USER_SCHEMA}' AND table_name = '{table}' \
             ORDER BY ordinal_position"
        );
        let rows = self.post_query_rows(database, &sql).await?;
        Ok(influxdb3_columns(&rows))
    }
}

#[async_trait]
impl DatabaseDriver for InfluxDb3Driver {
    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        Some(StatementScanDialect::Postgres)
    }

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

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        self.query_database_bounded(self.default_database()?, sql)
            .await
    }

    async fn query_database(&self, database: &str, sql: &str) -> Result<Vec<QueryResult>> {
        self.query_database_bounded(database, sql).await
    }

    async fn query_database_with_context_tracked(
        &self,
        _query_id: Option<&str>,
        database: &str,
        sql: &str,
        _schema: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        self.query_database_bounded(database, sql).await
    }

    async fn get_databases(&self) -> Result<Vec<String>> {
        self.ensure_connected()?;
        self.list_database_names().await
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
        Ok(vec![INFLUXDB3_USER_SCHEMA.to_string()])
    }

    async fn get_database_schemas(&self, _database: &str) -> Result<Vec<String>> {
        self.ensure_connected()?;
        Ok(vec![INFLUXDB3_USER_SCHEMA.to_string()])
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        self.ensure_connected()?;
        if !schema.eq_ignore_ascii_case(INFLUXDB3_USER_SCHEMA) {
            return Ok(Vec::new());
        }
        self.tables_for_database(self.default_database()?).await
    }

    async fn get_database_tables(&self, database: &str, schema: &str) -> Result<Vec<TableInfo>> {
        self.ensure_connected()?;
        if !schema.eq_ignore_ascii_case(INFLUXDB3_USER_SCHEMA) {
            return Ok(Vec::new());
        }
        self.tables_for_database(database).await
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        self.ensure_connected()?;
        if !schema.eq_ignore_ascii_case(INFLUXDB3_USER_SCHEMA) {
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
        if !schema.eq_ignore_ascii_case(INFLUXDB3_USER_SCHEMA) {
            return Ok(Vec::new());
        }
        self.columns_for_database(database, table).await
    }
}

fn parse_influxdb3_connection_url(url: &str) -> Result<(String, Option<String>, Option<String>)> {
    let mut parsed = Url::parse(url.trim()).context("Invalid InfluxDB 3 connection URL")?;
    if !matches!(parsed.scheme(), "http" | "https") {
        bail!("InfluxDB 3 connection URL must use HTTP or HTTPS");
    }
    if parsed.host_str().is_none() {
        bail!("InfluxDB 3 connection URL must contain a host");
    }
    let token = parsed
        .password()
        .and_then(|value| percent_decode_str(value).decode_utf8().ok())
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty());
    let default_database = parsed
        .path_segments()
        .and_then(|mut segments| segments.find(|segment| !segment.is_empty()))
        .and_then(|segment| percent_decode_str(segment).decode_utf8().ok())
        .map(|database| database.to_string());
    parsed
        .set_username("")
        .map_err(|_| anyhow!("Invalid InfluxDB 3 username"))?;
    parsed
        .set_password(None)
        .map_err(|_| anyhow!("Invalid InfluxDB 3 password"))?;
    parsed.set_path("");
    parsed.set_query(None);
    parsed.set_fragment(None);
    Ok((
        parsed.as_str().trim_end_matches('/').to_string(),
        token,
        default_database,
    ))
}

async fn parse_influxdb3_json_response(response: Response) -> Result<Vec<Value>> {
    let status = response.status();
    let limit = if status.is_success() {
        INFLUXDB3_RESPONSE_MAX_BYTES
    } else {
        INFLUXDB3_ERROR_MAX_BYTES
    };
    let body = bounded_influxdb3_response_body(response, limit).await?;
    if !status.is_success() {
        let hint = match status {
            StatusCode::UNAUTHORIZED => "Unauthorized; check the API token",
            StatusCode::FORBIDDEN => "Access denied",
            StatusCode::NOT_FOUND => "Endpoint not found; verify the InfluxDB 3 base URL",
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
        bail!("InfluxDB 3 returned HTTP {}: {message}", status.as_u16());
    }
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(Vec::new());
    }
    serde_json::from_slice::<Vec<Value>>(&body).context("InfluxDB 3 returned invalid JSON")
}

async fn bounded_influxdb3_response_body(response: Response, limit: usize) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        bail!("InfluxDB 3 response exceeds the {limit}-byte safety limit");
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("Failed to read InfluxDB 3 response")?;
        if body.len().saturating_add(chunk.len()) > limit {
            bail!("InfluxDB 3 response exceeds the {limit}-byte safety limit");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn influxdb3_database_names(rows: &[Value]) -> Vec<String> {
    rows.iter()
        .filter_map(Value::as_object)
        .filter_map(|row| {
            row.get("iox::database")
                .or_else(|| row.get("db_name"))
                .or_else(|| row.get("name"))
                .and_then(Value::as_str)
        })
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

fn influxdb3_tables(rows: &[Value]) -> Vec<TableInfo> {
    rows.iter()
        .filter_map(Value::as_object)
        .filter(|row| {
            row.get("table_schema")
                .and_then(Value::as_str)
                .is_some_and(|schema| schema == INFLUXDB3_USER_SCHEMA)
        })
        .filter_map(|row| {
            row.get("table_name")
                .or_else(|| row.get("name"))
                .and_then(Value::as_str)
        })
        .map(|name| TableInfo {
            name: name.to_string(),
            schema: Some(INFLUXDB3_USER_SCHEMA.to_string()),
            table_type: Some("TABLE".to_string()),
            comment: None,
        })
        .collect()
}

fn influxdb3_columns(rows: &[Value]) -> Vec<ColumnInfo> {
    rows.iter()
        .filter_map(Value::as_object)
        .filter_map(|row| {
            let name = row.get("column_name")?.as_str()?.to_string();
            let data_type = row
                .get("data_type")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let is_nullable = row
                .get("is_nullable")
                .and_then(Value::as_str)
                .map(|value| !value.eq_ignore_ascii_case("NO"))
                .unwrap_or(true);
            Some(ColumnInfo {
                is_primary_key: name == "time",
                name,
                data_type,
                is_nullable,
                is_unique: false,
                is_indexed: false,
                is_auto_increment: false,
                identity_generation: None,
                is_generated: None,
                is_hidden: None,
                character_set: None,
                collation: None,
                default_value: None,
                comment: None,
            })
        })
        .collect()
}

fn influxdb3_query_result(rows: Vec<Value>, row_limit: usize) -> QueryResult {
    let mut columns = Vec::<String>::new();
    let mut indexes = HashMap::<String, usize>::new();
    for row in &rows {
        if let Some(object) = row.as_object() {
            for name in object.keys() {
                if !indexes.contains_key(name) {
                    indexes.insert(name.clone(), columns.len());
                    columns.push(name.clone());
                }
            }
        }
    }
    let definitions = columns
        .iter()
        .map(|name| ColumnDef {
            name: name.clone(),
            data_type: rows
                .iter()
                .filter_map(Value::as_object)
                .filter_map(|row| row.get(name))
                .find(|value| !value.is_null())
                .map(influxdb3_json_type)
                .unwrap_or("unknown")
                .to_string(),
        })
        .collect();
    let values = rows
        .into_iter()
        .map(|row| {
            let mut cells = vec![Value::Null; columns.len()];
            if let Some(object) = row.as_object() {
                for (name, value) in object {
                    if let Some(index) = indexes.get(name) {
                        cells[*index] = value.clone();
                    }
                }
            }
            cells
        })
        .collect();
    QueryResult::rows_limited(definitions, values, row_limit)
}

fn influxdb3_json_type(value: &Value) -> &'static str {
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

fn inject_influxdb3_limit(sql: &str, max_rows: usize) -> Option<String> {
    let trimmed = sql.trim().trim_end_matches(';').trim_end();
    if !influxdb3_select_head_re().is_match(trimmed)
        || influxdb3_limit_clause_re().is_match(trimmed)
    {
        return None;
    }
    Some(format!("{trimmed} LIMIT {}", max_rows.saturating_add(1)))
}

fn influxdb3_select_head_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?is)^\s*(--[^\n]*\n|/\*.*?\*/|\s)*select\b").unwrap())
}

fn influxdb3_limit_clause_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // False positives only skip the server-side rewrite; the bounded response
    // reader remains the final memory guard.
    RE.get_or_init(|| Regex::new(r"(?i)\blimit\b").unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn connection_url_extracts_token_database_and_redacts_base_url() {
        let (base, token, database) = parse_influxdb3_connection_url(
            "https://ignored:secret%20token@metrics.example:8181/customer%20metrics?trace=1",
        )
        .unwrap();
        assert_eq!(base, "https://metrics.example:8181");
        assert_eq!(token.as_deref(), Some("secret token"));
        assert_eq!(database.as_deref(), Some("customer metrics"));
        assert!(!base.contains("secret"));
    }

    #[test]
    fn connection_url_rejects_non_http_transports() {
        assert!(parse_influxdb3_connection_url("file:///tmp/influx").is_err());
        assert!(parse_influxdb3_connection_url("influxdb3://localhost:8181/db").is_err());
    }

    #[test]
    fn query_limit_only_wraps_unbounded_top_level_select() {
        assert_eq!(
            inject_influxdb3_limit("SELECT * FROM cpu;", 100).as_deref(),
            Some("SELECT * FROM cpu LIMIT 101")
        );
        assert!(inject_influxdb3_limit("SELECT * FROM cpu LIMIT 5", 100).is_none());
        assert!(inject_influxdb3_limit("SHOW TABLES", 100).is_none());
        assert_eq!(
            inject_influxdb3_limit("-- recent rows\nSELECT * FROM cpu;", 5).as_deref(),
            Some("-- recent rows\nSELECT * FROM cpu LIMIT 6")
        );
        assert_eq!(
            inject_influxdb3_limit("/* bounded */ SELECT * FROM cpu", 5).as_deref(),
            Some("/* bounded */ SELECT * FROM cpu LIMIT 6")
        );
    }

    #[test]
    fn metadata_filters_internal_tables_and_maps_time_identity() {
        let tables = influxdb3_tables(&[
            json!({"table_schema": "system", "table_name": "queries"}),
            json!({"table_schema": "iox", "table_name": "cpu"}),
        ]);
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].name, "cpu");

        let columns = influxdb3_columns(&[
            json!({"column_name": "time", "data_type": "Timestamp", "is_nullable": "NO"}),
            json!({"column_name": "usage", "data_type": "Float64", "is_nullable": "YES"}),
        ]);
        assert!(columns[0].is_primary_key);
        assert!(!columns[0].is_nullable);
        assert!(!columns[1].is_primary_key);
    }

    #[test]
    fn query_results_preserve_discovered_columns_and_bound_rows() {
        let result = influxdb3_query_result(
            vec![
                json!({"time": "2026-01-01T00:00:00Z", "host": "a"}),
                json!({"time": "2026-01-01T00:01:00Z", "value": 2}),
                json!({"time": "2026-01-01T00:02:00Z", "value": 3}),
            ],
            2,
        );
        assert_eq!(
            result
                .columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            vec!["time", "host", "value"]
        );
        assert_eq!(result.rows.len(), 2);
        assert!(result.truncated);
        assert_eq!(result.row_limit, Some(2));
    }

    #[test]
    fn database_discovery_accepts_core_and_compatibility_field_names() {
        assert_eq!(
            influxdb3_database_names(&[
                json!({"iox::database": "metrics"}),
                json!({"db_name": "logs"}),
                json!({"name": "traces"}),
            ]),
            vec!["metrics", "logs", "traces"]
        );
    }
}
