use super::approved_query_review::{
    database_kind_for_dialect, read_only_transaction_script, required_input_text,
};
use super::connection_types::ResolvedAgentConnection;
use super::conversation_helpers::bounded_identifier;
use super::host_errors::SidecarRequestError;
use super::native_read_only::validate_native_read_only_query;
use super::query_result::{
    non_empty, strip_transaction_results, tool_deadline_duration, truncate_query_rows,
    MAX_TOOL_RESULT_ROWS,
};
use super::session_state::AgentHostInner;
use super::turn_state::ActiveTurn;
use crate::agent::protocol::ToolInvokeRequest;
use crate::core::explain::build_explain_statement;
use crate::core::explain::parse_explain_results;
use crate::core::protocol::ExplainPlanMode;
use crate::core::protocol::QueryResult;
use crate::core::statement::validate_read_only_sql;
use crate::core::statement::StatementScanDialect;
use serde_json::json;
use serde_json::Value;

impl AgentHostInner {
    pub(super) async fn execute_metadata_list(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let target = self.resolve_connection(turn, &request.input).await?;
        self.ensure_agent_connection(&turn.project_id, &target)
            .await?;
        let capabilities = target.capabilities.clone();

        if capabilities.supports_table_browsing {
            if request.tool_name == "metadata.listCollections" {
                return Ok(Value::Array(Vec::new()));
            }
            let tables = if let Some(database) = target.database.as_deref() {
                self.agent_connections
                    .get_database_tables(&target.id, database, &target.namespace)
                    .await
            } else {
                self.agent_connections
                    .get_tables(&target.id, &target.namespace)
                    .await
            }
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            return Ok(Value::Array(
                tables
                    .into_iter()
                    .map(|table| {
                        json!({
                            "name":table.name,
                            "namespace":table.schema.unwrap_or_else(|| target.namespace.clone()),
                            "kind":"relation",
                            "type":table.table_type,
                            "comment":table.comment,
                        })
                    })
                    .collect(),
            ));
        }

        if capabilities.supports_collection_browsing || capabilities.supports_key_value_browsing {
            let collections = self
                .agent_connections
                .get_collections(&target.id, &target.namespace)
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            let kind = match capabilities.data_model {
                crate::core::dialect::DatabaseDataModel::Document => "collection",
                crate::core::dialect::DatabaseDataModel::Search => "index",
                crate::core::dialect::DatabaseDataModel::KeyValue => "key",
                crate::core::dialect::DatabaseDataModel::Relational => "object",
                crate::core::dialect::DatabaseDataModel::Graph
                | crate::core::dialect::DatabaseDataModel::WideColumn
                | crate::core::dialect::DatabaseDataModel::TimeSeries
                | crate::core::dialect::DatabaseDataModel::Coordination
                | crate::core::dialect::DatabaseDataModel::Queue => "object",
            };
            return Ok(Value::Array(
                collections
                    .into_iter()
                    .map(|collection| {
                        json!({
                            "name":collection.name,
                            "namespace":collection.namespace.unwrap_or_else(|| target.namespace.clone()),
                            "kind":kind,
                            "type":collection.collection_type,
                            "documentCount":collection.document_count,
                        })
                    })
                    .collect(),
            ));
        }
        Ok(Value::Array(Vec::new()))
    }

    pub(super) async fn execute_metadata_describe(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let name = required_input_text(&request.input, "name", 512)?;
        let target = self.resolve_connection(turn, &request.input).await?;
        self.ensure_agent_connection(&turn.project_id, &target)
            .await?;
        let capabilities = target.capabilities.clone();

        if capabilities.supports_table_browsing {
            let columns = if let Some(database) = target.database.as_deref() {
                self.agent_connections
                    .get_database_columns(&target.id, database, &target.namespace, &name)
                    .await
            } else {
                self.agent_connections
                    .get_columns(&target.id, &target.namespace, &name)
                    .await
            }
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
            let indexes = if capabilities.supports_table_indexes {
                if let Some(database) = target.database.as_deref() {
                    self.agent_connections
                        .get_database_indexes(&target.id, database, &target.namespace, &name)
                        .await
                } else {
                    self.agent_connections
                        .get_indexes(&target.id, &target.namespace, &name)
                        .await
                }
                .unwrap_or_default()
            } else {
                Vec::new()
            };
            let constraints = if capabilities.supports_table_constraints {
                if let Some(database) = target.database.as_deref() {
                    self.agent_connections
                        .get_database_constraints(&target.id, database, &target.namespace, &name)
                        .await
                } else {
                    self.agent_connections
                        .get_constraints(&target.id, &target.namespace, &name)
                        .await
                }
                .unwrap_or_default()
            } else {
                Vec::new()
            };
            return Ok(json!({
                "connectionId":target.id,
                "namespace":target.namespace,
                "name":name,
                "driver":target.driver,
                "kind":"relation",
                "columns":columns,
                "indexes":indexes,
                "constraints":constraints,
            }));
        }

        let collections = self
            .agent_connections
            .get_collections(&target.id, &target.namespace)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        let collection = collections.into_iter().find(|value| value.name == name);
        Ok(json!({
            "connectionId":target.id,
            "namespace":target.namespace,
            "name":name,
            "driver":target.driver,
            "kind":match capabilities.data_model {
                crate::core::dialect::DatabaseDataModel::Document => "collection",
                crate::core::dialect::DatabaseDataModel::Search => "index",
                crate::core::dialect::DatabaseDataModel::KeyValue => "key",
                crate::core::dialect::DatabaseDataModel::Relational => "object",
                crate::core::dialect::DatabaseDataModel::Graph
                | crate::core::dialect::DatabaseDataModel::WideColumn
                | crate::core::dialect::DatabaseDataModel::TimeSeries
                | crate::core::dialect::DatabaseDataModel::Coordination
                | crate::core::dialect::DatabaseDataModel::Queue => "object",
            },
            "collection":collection,
        }))
    }

    pub(super) async fn execute_read_only_query(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let query = required_input_text(&request.input, "query", 200_000)?;
        let target = self.resolve_connection(turn, &request.input).await?;
        self.ensure_agent_connection(&turn.project_id, &target)
            .await?;
        let dialect = self
            .agent_connections
            .statement_scan_dialect(&target.id)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        let mut results = if target.driver.eq_ignore_ascii_case("sqlite")
            || target.driver.eq_ignore_ascii_case("sqlite3")
        {
            // The connection itself was opened with SQLite read_only=true.
            // Retain a conservative lexical gate for diagnostics and reject
            // multi-statement/mutation input before it reaches the engine.
            validate_read_only_sql(&query, StatementScanDialect::Postgres)
                .map_err(SidecarRequestError::tool)?;
            self.execute_bounded_query(turn, request, &target, query)
                .await?
        } else if target.sidecar_read_only_enforced {
            let dialect = dialect.ok_or_else(|| {
                SidecarRequestError::tool("Agent read-only queries require a declared SQL dialect")
            })?;
            validate_read_only_sql(&query, dialect).map_err(SidecarRequestError::tool)?;
            self.execute_bounded_query(turn, request, &target, query)
                .await?
        } else if let Some(dialect) = dialect {
            validate_read_only_sql(&query, dialect).map_err(SidecarRequestError::tool)?;
            let kind = database_kind_for_dialect(dialect).ok_or_else(|| {
                SidecarRequestError::tool(
                    "This SQL dialect requires a driver-enforced read-only endpoint",
                )
            })?;
            let script = read_only_transaction_script(kind, &query);
            let mut results = self
                .execute_bounded_query(turn, request, &target, script)
                .await?;
            strip_transaction_results(&mut results);
            results
        } else {
            validate_native_read_only_query(&target.driver, &query)
                .map_err(SidecarRequestError::tool)?;
            self.execute_bounded_query(turn, request, &target, query)
                .await?
        };
        let requested_limit = request
            .input
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(200)
            .clamp(1, MAX_TOOL_RESULT_ROWS as u64) as usize;
        truncate_query_rows(&mut results, requested_limit);
        serde_json::to_value(results).map_err(SidecarRequestError::from_json)
    }

    pub(super) async fn execute_explain_query(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let query = required_input_text(&request.input, "query", 200_000)?;
        let target = self.resolve_connection(turn, &request.input).await?;
        self.ensure_agent_connection(&turn.project_id, &target)
            .await?;
        let dialect = self
            .agent_connections
            .statement_scan_dialect(&target.id)
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?
            .ok_or_else(|| {
                SidecarRequestError::tool("Explain Plan is unsupported for this driver")
            })?;
        let kind = database_kind_for_dialect(dialect).ok_or_else(|| {
            SidecarRequestError::tool(
                "Explain Plan requires a driver-specific implementation for this SQL dialect",
            )
        })?;
        let (statement, format) = build_explain_statement(&query, kind, ExplainPlanMode::Estimate)
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        let script = if target.sidecar_read_only_enforced {
            statement
        } else {
            read_only_transaction_script(kind, &statement)
        };
        let started_at = std::time::Instant::now();
        let mut results = self
            .execute_bounded_query(turn, request, &target, script)
            .await?;
        if !target.sidecar_read_only_enforced {
            strip_transaction_results(&mut results);
        }
        let plan = parse_explain_results(
            request.call_id.clone(),
            kind,
            ExplainPlanMode::Estimate,
            format,
            started_at.elapsed().as_secs_f64() * 1_000.0,
            &results,
        )
        .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        serde_json::to_value(plan).map_err(SidecarRequestError::from_json)
    }

    pub(super) async fn execute_bounded_query(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
        target: &ResolvedAgentConnection,
        sql: String,
    ) -> std::result::Result<Vec<QueryResult>, SidecarRequestError> {
        let query_id = format!(
            "agent-{}-{}",
            bounded_identifier(&request.metadata.turn_id, 80),
            bounded_identifier(&request.call_id, 80)
        );
        let timeout = tool_deadline_duration(turn, &request.tool_name, request.metadata.deadline)?;
        let execute = async {
            if let Some(database) = target
                .database
                .as_deref()
                .filter(|_| target.capabilities.supports_database_catalogs)
            {
                self.agent_connections
                    .query_database_with_context(
                        &target.id,
                        database,
                        &sql,
                        non_empty(&target.namespace),
                        Some(&query_id),
                    )
                    .await
            } else {
                self.agent_connections
                    .query(
                        &target.id,
                        &sql,
                        non_empty(&target.namespace).map(ToString::to_string),
                        None,
                        Some(query_id.clone()),
                    )
                    .await
            }
        };
        match tokio::time::timeout(timeout, execute).await {
            Ok(result) => result.map_err(|error| SidecarRequestError::tool(error.to_string())),
            Err(_) => {
                let _ = self
                    .agent_connections
                    .cancel_query(&target.id, &query_id)
                    .await;
                Err(SidecarRequestError {
                    code: -32_065,
                    message: "database tool execution exceeded its deadline".to_string(),
                    data: Some(json!({"kind":"tool_timeout","recoverable":true})),
                })
            }
        }
    }
}
