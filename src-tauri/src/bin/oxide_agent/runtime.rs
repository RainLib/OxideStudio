use crate::oxide_agent::{
    catalog,
    policy::{database_names_match, reject_self_reported_approval, Grant},
    store::{HeadlessStore, MetadataFilter, StoredConnection},
};
use anyhow::{anyhow, Context, Result};
use oxide_studio_lib::core::{
    config::SavedConnection as ConfigSavedConnection,
    connection_url::connection_url_with_capabilities,
    dialect::{database_capabilities_for_driver, DatabaseKind},
    driver_package::DatabaseDriverPackageRegistry,
    explain::{build_explain_statement, parse_explain_results},
    manager::ConnectionManager,
    parser::{SqlParser, SuggestionType},
    protocol::{ExplainPlanMode, QueryResult},
    query_scope::{sql_references_disallowed_database_with_namespace, RelationNamespace},
    statement::{
        execution_statement_kind, split_leading_execution_hint, split_sql_statements,
        validate_read_only_sql, StatementKind, StatementScanDialect,
    },
};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

mod connection;
mod documents;
mod live;
use connection::{driver_identity, SelectedDriver};

const MAX_SQL_CHARS: usize = 200_000;
const MAX_CELL_BYTES: usize = 16 * 1024;
const DEFAULT_QUERY_TIMEOUT_SECS: u64 = 30;

pub struct ToolRuntime {
    store: HeadlessStore,
    grant: Grant,
    next_query_id: AtomicU64,
    query_timeout: Option<Duration>,
    driver_packages: std::result::Result<DatabaseDriverPackageRegistry, String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EmptyInput {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MetadataInput {
    connection_id: Option<String>,
    parent_id: Option<String>,
    kind: Option<String>,
    #[serde(default)]
    prefix: String,
    #[serde(default = "default_metadata_limit")]
    limit: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueryInput {
    connection_id: Option<String>,
    sql: String,
    database: Option<String>,
    schema: Option<String>,
    max_rows: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExplainInput {
    connection_id: Option<String>,
    sql: String,
    database: Option<String>,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LspContextInput {
    connection_id: Option<String>,
    sql: String,
    cursor_byte: usize,
    #[serde(default = "default_candidate_limit")]
    candidate_limit: usize,
}

struct ResolvedConnection {
    stored: StoredConnection,
    config: ConfigSavedConnection,
}

impl ToolRuntime {
    pub async fn new(
        store: HeadlessStore,
        grant: Grant,
        query_timeout_secs: Option<u64>,
    ) -> Result<Self> {
        store.require_project(grant.project_id()).await?;
        let connections = store.connections(grant.project_id()).await?;
        if let Some(connection_id) = grant.connection_id() {
            if !connections
                .iter()
                .any(|connection| connection.id == connection_id)
            {
                return Err(anyhow!(
                    "granted connection is not part of project '{}': {connection_id}",
                    grant.project_id()
                ));
            }
        }
        Ok(Self {
            driver_packages: store.driver_packages().map_err(|error| error.to_string()),
            store,
            grant,
            next_query_id: AtomicU64::new(1),
            query_timeout: resolve_query_timeout(query_timeout_secs),
        })
    }

    pub fn grant(&self) -> &Grant {
        &self.grant
    }

    pub async fn invoke(&self, tool_name: &str, input: Value) -> Result<Value> {
        self.grant.require_tool(tool_name)?;
        if tool_name == catalog::DOCUMENT_FIND {
            documents::reject_document_approval_claims(&input)?;
        } else {
            reject_self_reported_approval(&input)?;
        }
        let data = match tool_name {
            catalog::CONNECTION_SUMMARIES => {
                parse_input::<EmptyInput>(input)?;
                serde_json::to_value(
                    self.store
                        .connection_summaries(self.grant.project_id(), self.grant.connection_id())
                        .await?,
                )?
            }
            catalog::METADATA_LIST => self.list_metadata(parse_input(input)?).await?,
            catalog::METADATA_LIVE => self.inspect_live_metadata(parse_input(input)?).await?,
            catalog::QUERY_READ_ONLY => self.run_read_only(parse_input(input)?).await?,
            catalog::DOCUMENT_FIND => self.find_documents(parse_input(input)?).await?,
            catalog::QUERY_EXPLAIN_ESTIMATE => self.explain_estimate(parse_input(input)?).await?,
            catalog::LSP_SQL_CONTEXT => self.lsp_context(parse_input(input)?).await?,
            _ => return Err(anyhow!("unknown OxideStudio tool: {tool_name}")),
        };
        Ok(bound_result(data, self.grant.max_result_bytes()))
    }

    async fn list_metadata(&self, input: MetadataInput) -> Result<Value> {
        validate_optional_text(input.parent_id.as_deref(), "parentId", 512)?;
        validate_optional_text(input.kind.as_deref(), "kind", 64)?;
        validate_text(&input.prefix, "prefix", 256, true)?;
        let connection = self
            .resolve_connection(input.connection_id.as_deref())
            .await?;
        let resources = self
            .store
            .metadata(
                self.grant.project_id(),
                &connection.stored.id,
                MetadataFilter {
                    parent_id: input.parent_id.as_deref(),
                    kind: input.kind.as_deref(),
                    prefix: Some(&input.prefix),
                    limit: input.limit.clamp(1, 200),
                    database_scope: self.grant.allowed_databases(),
                    namespace_is_database: self.legacy_namespace_is_database(&connection.stored),
                },
            )
            .await?;
        Ok(json!({
            "connectionId": connection.stored.id,
            "source": "cache",
            "objects": resources,
        }))
    }

    async fn run_read_only(&self, input: QueryInput) -> Result<Value> {
        validate_text(&input.sql, "sql", MAX_SQL_CHARS, false)?;
        validate_optional_text(input.database.as_deref(), "database", 256)?;
        validate_optional_text(input.schema.as_deref(), "schema", 256)?;
        let connection = self
            .resolve_connection(input.connection_id.as_deref())
            .await?;
        let selected = self.select_driver(&connection)?;
        let dialect = selected.query_dialect()?;
        validate_read_only_sql(&input.sql, dialect).map_err(anyhow::Error::msg)?;
        let database =
            self.resolve_query_database(&connection, &selected, input.database.as_deref())?;
        self.enforce_query_database_scope(&input.sql, dialect, &selected, database.as_deref())?;
        let statement = split_sql_statements(&input.sql, dialect)
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("read-only query is empty"))?;
        if !matches!(
            execution_statement_kind(statement),
            StatementKind::Select | StatementKind::Values
        ) {
            return Err(anyhow!(
                "external read-only query only accepts SELECT, TABLE, VALUES, or a read-only CTE"
            ));
        }

        let max_rows = input
            .max_rows
            .unwrap_or(self.grant.max_rows())
            .clamp(1, self.grant.max_rows());
        let fetch_rows = max_rows.saturating_add(1);
        let bounded_statement = bounded_read_only_statement(statement, fetch_rows);
        // SQLite is opened by the shared Agent connection factory with the
        // engine's read-only flag. It does not accept PostgreSQL/MySQL's
        // transaction syntax, so the bounded SELECT is sent directly.
        let uses_engine_read_only =
            selected.package_version.is_some() || selected.is_single_database();
        let script = if uses_engine_read_only {
            bounded_statement
        } else {
            read_only_transaction_script(dialect, &bounded_statement)?
        };
        let mut results = self
            .execute_sql(
                &connection,
                &selected,
                &script,
                database.as_deref(),
                input.schema.as_deref(),
            )
            .await?;
        if !uses_engine_read_only {
            strip_transaction_results(&mut results);
        }
        let original_rows = results
            .iter()
            .map(|result| result.rows.len())
            .sum::<usize>();
        truncate_query_results(&mut results, max_rows);
        let mut truncated = original_rows > max_rows;
        for result in &mut results {
            for row in &mut result.rows {
                for cell in row {
                    truncated |= bound_cell(cell);
                }
            }
        }
        Ok(json!({
            "connectionId": connection.stored.id,
            "database": database,
            "driverPackageVersion": selected.package_version,
            "rowCount": original_rows.min(max_rows),
            "truncated": truncated,
            "results": results,
        }))
    }

    async fn explain_estimate(&self, input: ExplainInput) -> Result<Value> {
        validate_text(&input.sql, "sql", MAX_SQL_CHARS, false)?;
        validate_optional_text(input.database.as_deref(), "database", 256)?;
        validate_optional_text(input.schema.as_deref(), "schema", 256)?;
        let connection = self
            .resolve_connection(input.connection_id.as_deref())
            .await?;
        let selected = self.select_driver(&connection)?;
        if !selected.capabilities.supports_explain_plan {
            return Err(anyhow!("estimated EXPLAIN is not supported by this driver"));
        }
        let dialect = selected.query_dialect()?;
        validate_read_only_sql(&input.sql, dialect).map_err(anyhow::Error::msg)?;
        let database =
            self.resolve_query_database(&connection, &selected, input.database.as_deref())?;
        self.enforce_query_database_scope(&input.sql, dialect, &selected, database.as_deref())?;
        let kind = kind_for_dialect(dialect)?;
        let (statement, format) =
            build_explain_statement(&input.sql, kind, ExplainPlanMode::Estimate)?;
        let uses_engine_read_only =
            selected.package_version.is_some() || selected.is_single_database();
        let script = if uses_engine_read_only {
            statement.to_string()
        } else {
            read_only_transaction_script(dialect, &statement)?
        };
        let started = Instant::now();
        let mut results = self
            .execute_sql(
                &connection,
                &selected,
                &script,
                database.as_deref(),
                input.schema.as_deref(),
            )
            .await?;
        if !uses_engine_read_only {
            strip_transaction_results(&mut results);
        }
        let plan = parse_explain_results(
            self.query_id("explain"),
            kind,
            ExplainPlanMode::Estimate,
            format,
            started.elapsed().as_secs_f64() * 1_000.0,
            &results,
        )?;
        Ok(json!({
            "connectionId": connection.stored.id,
            "database": database,
            "plan": plan,
        }))
    }

    async fn lsp_context(&self, input: LspContextInput) -> Result<Value> {
        validate_text(&input.sql, "sql", MAX_SQL_CHARS, true)?;
        if input.cursor_byte > input.sql.len() || !input.sql.is_char_boundary(input.cursor_byte) {
            return Err(anyhow!(
                "cursorByte must be a valid UTF-8 boundary inside sql"
            ));
        }
        let mut parser = SqlParser::new();
        let mut context = parser.parse_and_get_context(&input.sql, input.cursor_byte);
        let candidate_limit = input.candidate_limit.clamp(1, 100);

        let connections = self.store.connections(self.grant.project_id()).await?;
        let resolved = self.grant.resolve_connection(
            input.connection_id.as_deref(),
            connections.iter().map(|connection| connection.id.as_str()),
        );
        if let Ok(connection_id) = resolved {
            let kind = match context.suggestion_type {
                SuggestionType::Column => Some("COLUMN"),
                SuggestionType::Table => None,
                SuggestionType::Keyword | SuggestionType::None => None,
            };
            let cached = self
                .store
                .metadata(
                    self.grant.project_id(),
                    &connection_id,
                    MetadataFilter {
                        parent_id: None,
                        kind,
                        prefix: context.match_string.as_deref(),
                        limit: candidate_limit,
                        database_scope: self.grant.allowed_databases(),
                        namespace_is_database: connections
                            .iter()
                            .find(|connection| connection.id == connection_id)
                            .is_some_and(|connection| {
                                self.legacy_namespace_is_database(connection)
                            }),
                    },
                )
                .await?;
            context
                .candidates
                .extend(cached.into_iter().map(|resource| resource.name));
            context.candidates.sort();
            context.candidates.dedup();
            context.candidates.truncate(candidate_limit);
            return Ok(json!({
                "connectionId": connection_id,
                "context": context,
            }));
        }
        context.candidates.truncate(candidate_limit);
        Ok(json!({"context": context}))
    }

    async fn resolve_connection(&self, requested: Option<&str>) -> Result<ResolvedConnection> {
        validate_optional_text(requested, "connectionId", 128)?;
        let connections = self.store.connections(self.grant.project_id()).await?;
        let connection_id = self.grant.resolve_connection(
            requested,
            connections.iter().map(|connection| connection.id.as_str()),
        )?;
        let stored = connections
            .into_iter()
            .find(|connection| connection.id == connection_id)
            .ok_or_else(|| anyhow!("resolved connection disappeared"))?;
        if stored.project_id != self.grant.project_id() {
            return Err(anyhow!("stored connection escaped the granted project"));
        }
        let config: ConfigSavedConnection = serde_json::from_value(stored.config.clone())
            .context("saved connection configuration is invalid")?;
        if config.id != stored.id || config.project_id != stored.project_id {
            return Err(anyhow!(
                "saved connection identity does not match its project-scoped record"
            ));
        }
        if driver_identity(&stored.driver)? != driver_identity(&config.driver)? {
            return Err(anyhow!(
                "saved connection driver does not match its project-scoped record"
            ));
        }
        Ok(ResolvedConnection { stored, config })
    }

    fn resolve_query_database(
        &self,
        connection: &ResolvedConnection,
        selected: &SelectedDriver,
        requested: Option<&str>,
    ) -> Result<Option<String>> {
        if selected.is_single_database() {
            let selected = self.grant.resolve_database(requested, Some("main"))?;
            if !selected
                .as_deref()
                .is_some_and(|database| database_names_match(database, "main"))
            {
                return Err(anyhow!(
                    "headless file queries require the saved main database"
                ));
            }
            return Ok(Some("main".to_string()));
        }
        self.grant
            .resolve_database(
                requested,
                if selected.is_file() {
                    None
                } else {
                    connection.config.database.as_deref()
                },
            )
            .map_err(anyhow::Error::from)
    }

    fn enforce_query_database_scope(
        &self,
        sql: &str,
        dialect: StatementScanDialect,
        selected: &SelectedDriver,
        active_database: Option<&str>,
    ) -> Result<()> {
        let Some(allowed_databases) = self.grant.allowed_databases() else {
            return Ok(());
        };
        let active_database = active_database.ok_or_else(|| {
            anyhow!("database selection is required by the restricted database grant")
        })?;
        let namespace = if selected.is_single_database() {
            RelationNamespace::Database
        } else {
            dialect.into()
        };
        if sql_references_disallowed_database_with_namespace(
            sql,
            namespace,
            active_database,
            allowed_databases,
        ) {
            return Err(anyhow!(
                "SQL references a database outside the granted scope or contains an ambiguous relation target"
            ));
        }
        Ok(())
    }

    async fn execute_sql(
        &self,
        connection: &ResolvedConnection,
        selected: &SelectedDriver,
        sql: &str,
        database: Option<&str>,
        schema: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        let file = selected.is_single_database();
        if file && schema.is_some_and(|schema| !database_names_match(schema, "main")) {
            return Err(anyhow!(
                "headless file queries require the saved main database"
            ));
        }
        let schema = if file { Some("main") } else { schema };
        let manager = ConnectionManager::new();
        let deadline = self
            .query_timeout
            .map(|duration| tokio::time::Instant::now() + duration);
        let connect = self.connect_read_only(connection, selected);
        let (driver, tunnel) = match deadline {
            Some(deadline) => tokio::time::timeout_at(deadline, connect)
                .await
                .map_err(|_| anyhow!("database connection exceeded its configured deadline"))??,
            None => connect.await?,
        };
        manager
            .replace_connection_with_tunnel(connection.stored.id.clone(), driver, tunnel)
            .await?;

        let query_id = self.query_id("read");
        let execute = async {
            if let Some(database) = database.filter(|value| !file && !value.trim().is_empty()) {
                manager
                    .query_database_with_context(
                        &connection.stored.id,
                        database,
                        sql,
                        schema.filter(|value| !value.trim().is_empty()),
                        Some(&query_id),
                    )
                    .await
            } else {
                manager
                    .query(
                        &connection.stored.id,
                        sql,
                        schema
                            .filter(|value| !value.trim().is_empty())
                            .map(ToString::to_string),
                        None,
                        Some(query_id.clone()),
                    )
                    .await
            }
        };
        let result = match self.query_timeout {
            Some(timeout) => {
                match tokio::time::timeout_at(deadline.expect("configured deadline"), execute).await
                {
                    Ok(result) => result,
                    Err(_) => {
                        let _ = tokio::time::timeout(
                            Duration::from_secs(5),
                            manager.cancel_query(&connection.stored.id, &query_id),
                        )
                        .await;
                        Err(anyhow!(
                            "database tool exceeded its {} second deadline",
                            timeout.as_secs()
                        ))
                    }
                }
            }
            None => execute.await,
        };
        let cleanup = tokio::time::timeout(
            Duration::from_secs(5),
            manager.disconnect_connection(&connection.stored.id),
        )
        .await;
        match (result, cleanup) {
            (Ok(results), Ok(Ok(()))) => Ok(results),
            (Ok(_), _) => Err(anyhow!("failed to close database connection")),
            (Err(error), _) => Err(error),
        }
    }

    fn query_id(&self, prefix: &str) -> String {
        let sequence = self.next_query_id.fetch_add(1, Ordering::Relaxed);
        format!("oxide-agent-{prefix}-{}-{sequence}", std::process::id())
    }

    async fn runtime_connection_config(
        &self,
        connection: &ResolvedConnection,
    ) -> Result<ConfigSavedConnection> {
        let config: ConfigSavedConnection =
            serde_json::from_value(self.store.runtime_config(&connection.stored).await?)
                .context("saved connection configuration is invalid")?;
        if config.id != connection.stored.id
            || config.project_id != connection.stored.project_id
            || config.driver != connection.config.driver
            || config.driver_package_version != connection.config.driver_package_version
        {
            return Err(anyhow!(
                "restored connection identity does not match its granted record"
            ));
        }
        Ok(config)
    }
}

fn resolve_query_timeout(query_timeout_secs: Option<u64>) -> Option<Duration> {
    match query_timeout_secs {
        Some(0) => None,
        Some(seconds) => Some(Duration::from_secs(seconds)),
        None => Some(Duration::from_secs(DEFAULT_QUERY_TIMEOUT_SECS)),
    }
}

fn bounded_read_only_statement(statement: &str, fetch_rows: usize) -> String {
    let (execution_hint, statement) = split_leading_execution_hint(statement);
    format!(
        "{execution_hint}SELECT * FROM (\n{statement}\n) AS oxide_agent_result LIMIT {fetch_rows}"
    )
}

fn parse_input<T: DeserializeOwned>(input: Value) -> Result<T> {
    serde_json::from_value(input).context("tool input does not match its closed JSON schema")
}

fn validate_text(
    value: &str,
    field: &'static str,
    max_chars: usize,
    allow_empty: bool,
) -> Result<()> {
    if !allow_empty && value.trim().is_empty() {
        return Err(anyhow!("{field} is required"));
    }
    if value.chars().count() > max_chars {
        return Err(anyhow!("{field} exceeds {max_chars} characters"));
    }
    Ok(())
}

fn validate_optional_text(
    value: Option<&str>,
    field: &'static str,
    max_chars: usize,
) -> Result<()> {
    if let Some(value) = value {
        validate_text(value, field, max_chars, false)?;
    }
    Ok(())
}

fn default_metadata_limit() -> usize {
    100
}

fn default_candidate_limit() -> usize {
    50
}

fn dialect_for_driver(driver: &str) -> Result<StatementScanDialect> {
    let driver = database_capabilities_for_driver(driver)?.driver;
    match driver.as_str() {
        "postgres" | "sqlite" => Ok(StatementScanDialect::Postgres),
        "mysql" => Ok(StatementScanDialect::Mysql),
        _ => Err(anyhow!(
            "external SQL tools are only available for PostgreSQL, MySQL, and SQLite"
        )),
    }
}

#[cfg(test)]
fn is_file_agent_driver(driver: &str) -> Result<bool> {
    Ok(matches!(
        database_capabilities_for_driver(driver)?.connection_mode,
        oxide_studio_lib::core::dialect::DatabaseConnectionMode::File
    ))
}

fn kind_for_dialect(dialect: StatementScanDialect) -> Result<DatabaseKind> {
    match dialect {
        StatementScanDialect::Postgres => Ok(DatabaseKind::Postgres),
        StatementScanDialect::Mysql => Ok(DatabaseKind::Mysql),
        StatementScanDialect::SqlServer => Err(anyhow!(
            "SQL Server requires a driver-specific Explain Plan implementation"
        )),
    }
}

fn read_only_transaction_script(dialect: StatementScanDialect, sql: &str) -> Result<String> {
    let begin = match dialect {
        StatementScanDialect::Postgres => "BEGIN READ ONLY;",
        StatementScanDialect::Mysql => "START TRANSACTION READ ONLY;",
        StatementScanDialect::SqlServer => {
            return Err(anyhow!(
                "SQL Server requires a driver-enforced read-only execution endpoint"
            ));
        }
    };
    Ok(format!("{begin}\n{}\n;\nROLLBACK;", sql.trim()))
}

fn strip_transaction_results(results: &mut Vec<QueryResult>) {
    let first = results
        .first()
        .and_then(|result| result.statement_type.as_deref());
    let last = results
        .last()
        .and_then(|result| result.statement_type.as_deref());
    if first.is_some_and(|kind| {
        kind.eq_ignore_ascii_case("BEGIN") || kind.eq_ignore_ascii_case("START")
    }) && last.is_some_and(|kind| kind.eq_ignore_ascii_case("ROLLBACK"))
    {
        results.remove(0);
        results.pop();
    }
}

fn truncate_query_results(results: &mut [QueryResult], max_rows: usize) {
    let mut remaining = max_rows;
    for result in results {
        if remaining == 0 {
            result.rows.clear();
            continue;
        }
        if result.rows.len() > remaining {
            result.rows.truncate(remaining);
        }
        remaining = remaining.saturating_sub(result.rows.len());
    }
}

fn bound_cell(value: &mut Value) -> bool {
    let Ok(serialized) = serde_json::to_vec(value) else {
        *value = Value::String("[unserializable value]".to_string());
        return true;
    };
    if serialized.len() <= MAX_CELL_BYTES {
        return false;
    }
    let text = value
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| String::from_utf8_lossy(&serialized).into_owned());
    let preview = truncate_utf8(&text, MAX_CELL_BYTES.saturating_sub(64));
    *value = json!({
        "preview": preview,
        "truncated": true,
        "originalBytes": serialized.len(),
    });
    true
}

fn bound_result(data: Value, max_bytes: usize) -> Value {
    let bytes = serde_json::to_vec(&data).unwrap_or_default();
    if bytes.len() <= max_bytes {
        return json!({
            "data": data,
            "byteCount": bytes.len(),
            "truncated": false,
        });
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut preview_budget = max_bytes.saturating_sub(512);
    loop {
        let envelope = json!({
            "data": null,
            "preview": truncate_utf8(&text, preview_budget),
            "byteCount": bytes.len(),
            "truncated": true,
        });
        if serde_json::to_vec(&envelope).is_ok_and(|encoded| encoded.len() <= max_bytes) {
            return envelope;
        }
        if preview_budget == 0 {
            return json!({
                "data": null,
                "byteCount": bytes.len(),
                "truncated": true,
            });
        }
        preview_budget /= 2;
    }
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes.min(value.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

#[cfg(test)]
fn connection_url_from_config(driver: &str, config: &ConfigSavedConnection) -> Result<String> {
    connection_url_with_capabilities(
        driver,
        config,
        &database_capabilities_for_driver(driver)?,
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structured_native_connections_keep_driver_specific_transport_and_credentials() {
        for (driver, expected_scheme, database) in [
            ("mongodb", "mongodb", "app"),
            ("redis", "rediss", "0"),
            ("elasticsearch", "https", ""),
        ] {
            let config: ConfigSavedConnection = serde_json::from_value(json!({
                "id":"fixture", "projectId":"project", "name":"fixture", "driver":driver, "url":"",
                "host":"db.example.test", "user":"reader", "password":"p@ss", "database":database, "sslMode":"require",
            })).unwrap();
            let built = connection_url_from_config(driver, &config).unwrap();
            let parsed = url::Url::parse(&built).unwrap();
            assert_eq!(parsed.scheme(), expected_scheme);
            assert_eq!(parsed.username(), "reader");
            assert!(built.contains("p%40ss"));
            if driver == "mongodb" {
                assert!(parsed
                    .query_pairs()
                    .any(|(key, value)| key == "tls" && value == "true"));
            }
        }
    }

    #[test]
    fn http_metadata_connections_do_not_inherit_a_stale_database_path() {
        let config: ConfigSavedConnection = serde_json::from_value(json!({
            "id":"fixture", "name":"fixture", "driver":"elasticsearch", "url":"",
            "host":"127.0.0.1", "port":9200, "database":"old-database", "sslMode":"disable",
        }))
        .unwrap();
        let parsed =
            url::Url::parse(&connection_url_from_config("elasticsearch", &config).unwrap())
                .unwrap();
        assert_eq!(parsed.scheme(), "http");
        assert_eq!(parsed.port(), Some(9200));
        assert_eq!(parsed.path(), "/");
    }

    #[test]
    fn query_timeout_resolves_default_override_and_unlimited() {
        assert_eq!(
            resolve_query_timeout(None),
            Some(Duration::from_secs(DEFAULT_QUERY_TIMEOUT_SECS))
        );
        assert_eq!(
            resolve_query_timeout(Some(300)),
            Some(Duration::from_secs(300))
        );
        assert_eq!(resolve_query_timeout(Some(0)), None);
    }

    #[test]
    fn bounded_result_never_returns_unbounded_payload() {
        for value in ["x".repeat(20_000), "\u{0}\"\\".repeat(20_000)] {
            let bounded = bound_result(json!({"value": value}), 4_096);
            let encoded = serde_json::to_vec(&bounded).unwrap();
            assert!(encoded.len() <= 4_096);
            assert_eq!(bounded["truncated"], true);
        }
    }

    #[test]
    fn read_only_wrapper_has_server_side_limit_and_transaction_rollback() {
        let statement = "SELECT id FROM users";
        let wrapped = bounded_read_only_statement(statement, 201);
        let script = read_only_transaction_script(StatementScanDialect::Postgres, &wrapped)
            .expect("PostgreSQL read-only wrapper should be available");
        assert!(script.starts_with("BEGIN READ ONLY;"));
        assert!(script.contains("LIMIT 201"));
        assert!(script.ends_with("ROLLBACK;"));
    }

    #[test]
    fn read_only_wrapper_keeps_execution_hints_on_the_outer_statement() {
        for hint in [
            "/*+ MAX_EXECUTION_TIME(1000) */",
            "/*@global:true*/",
            "/*& tenant:'test' */",
        ] {
            let sql = format!("{hint}\nSELECT id FROM users");
            let statement = split_sql_statements(&sql, StatementScanDialect::Mysql)
                .into_iter()
                .next()
                .unwrap();
            let wrapped = bounded_read_only_statement(statement, 201);
            assert!(wrapped.starts_with(&format!("{hint}\nSELECT * FROM (")));
            assert!(!wrapped.contains(&format!("(\n{hint}")));
        }

        let ordinary = bounded_read_only_statement("/* report */\nSELECT 1", 2);
        assert!(ordinary.starts_with("SELECT * FROM (\n/* report */"));
    }

    #[test]
    fn sqlite_uses_the_file_and_engine_read_only_paths() {
        assert!(is_file_agent_driver("sqlite").unwrap());
        assert_eq!(
            dialect_for_driver("sqlite").unwrap(),
            StatementScanDialect::Postgres
        );
    }

    #[test]
    fn oversized_cells_are_replaced_with_bounded_previews() {
        let mut value = Value::String("x".repeat(MAX_CELL_BYTES * 2));
        assert!(bound_cell(&mut value));
        assert_eq!(value["truncated"], true);
    }
}
