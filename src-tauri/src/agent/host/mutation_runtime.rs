use super::approved_query_review::{required_input_text, review_approved_query_input};
use super::connection_types::ResolvedAgentConnection;
use super::conversation_helpers::bounded_identifier;
use super::host_errors::SidecarRequestError;
use super::identity_helpers::bounded_text;
use super::query_result::{non_empty, tool_deadline_duration};
use super::review_types::{ApprovedQueryReview, MutationTurnState};
use super::session_state::AgentHostInner;
use super::turn_state::{ActiveTurn, TurnKey};
use crate::agent::protocol::AgentProfile;
use crate::agent::protocol::ToolInvokeRequest;
use crate::core::config::ConnectionEnvironment;
use crate::core::dialect::canonical_driver_name;
use crate::core::statement::StatementScanDialect;
use anyhow::anyhow;
use serde_json::json;
use serde_json::Value;
use std::time::Instant;

impl AgentHostInner {
    pub(super) async fn execute_approved_query(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        if turn.profile != AgentProfile::Agent {
            return Err(SidecarRequestError::security(anyhow!(
                "query.executeApproved is available only in Agent mode"
            )));
        }
        let query = required_input_text(&request.input, "query", 200_000)?;
        let target = self.resolve_connection(turn, &request.input).await?;
        self.ensure_agent_mutation_target(turn, &target)?;
        let review = self.review_approved_query(&target, &query)?;
        self.ensure_mutation_connection(&turn.project_id, &target)
            .await?;

        let query_id = format!(
            "agent-mutation-{}-{}",
            bounded_identifier(&request.metadata.turn_id, 80),
            bounded_identifier(&request.call_id, 80)
        );
        let timeout = tool_deadline_duration(turn, &request.tool_name, request.metadata.deadline)?;
        let started_at = Instant::now();
        let turn_key = TurnKey::from_metadata(&request.metadata);
        self.set_mutation_turn_state(&turn_key, MutationTurnState::Started)
            .await;
        let execute = async {
            if let Some(database) = target
                .database
                .as_deref()
                .filter(|_| target.capabilities.supports_database_catalogs)
            {
                self.mutation_connections
                    .query_database_with_context(
                        &target.id,
                        database,
                        &query,
                        non_empty(&target.namespace),
                        Some(&query_id),
                    )
                    .await
            } else {
                self.mutation_connections
                    .query(
                        &target.id,
                        &query,
                        non_empty(&target.namespace).map(ToString::to_string),
                        None,
                        Some(query_id.clone()),
                    )
                    .await
            }
        };
        let result = match tokio::time::timeout(timeout, execute).await {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => {
                self.set_mutation_turn_state(&turn_key, MutationTurnState::Unknown)
                    .await;
                return Err(SidecarRequestError {
                    code: -32_069,
                    message: bounded_text(&error.to_string(), 2_000),
                    data: Some(json!({
                        "kind":"mutation_execution_failed",
                        "recoverable":false,
                        "manualVerificationRequired":true,
                    })),
                });
            }
            Err(_) => {
                let _ = self
                    .mutation_connections
                    .cancel_query(&target.id, &query_id)
                    .await;
                tracing::warn!(
                    target: "oxide_agent_mutation_audit",
                    project_id = %turn.project_id,
                    turn_id = %request.metadata.turn_id,
                    call_id = %request.call_id,
                    input_digest = %request.input_digest,
                    operation_type = %review.operation_type,
                    connection_id = %target.id,
                    database = ?target.database,
                    duration_ms = started_at.elapsed().as_millis() as u64,
                    result_unknown = true,
                    "approved Agent database operation timed out"
                );
                self.set_mutation_turn_state(&turn_key, MutationTurnState::Unknown)
                    .await;
                return Err(SidecarRequestError {
                    code: -32_067,
                    message: "The approved database operation timed out after it was sent; verify the target manually before retrying".to_string(),
                    data: Some(json!({
                        "kind":"mutation_result_unknown",
                        "recoverable":false,
                        "manualVerificationRequired":true,
                    })),
                });
            }
        };
        self.set_mutation_turn_state(&turn_key, MutationTurnState::Completed)
            .await;
        tracing::info!(
            target: "oxide_agent_mutation_audit",
            project_id = %turn.project_id,
            turn_id = %request.metadata.turn_id,
            call_id = %request.call_id,
            input_digest = %request.input_digest,
            operation_type = %review.operation_type,
            destructive = review.destructive,
            connection_id = %target.id,
            database = ?target.database,
            duration_ms = started_at.elapsed().as_millis() as u64,
            result_unknown = false,
            "approved Agent database operation completed"
        );
        serde_json::to_value(json!({
            "connectionId": target.id,
            "database": target.database,
            "namespace": target.namespace,
            "operationType": review.operation_type,
            "inputDigest": request.input_digest,
            "results": result,
            "mutationReceipt": {
                "callId": request.call_id,
                "completed": true,
                "manualVerificationRequired": false,
            }
        }))
        .map_err(SidecarRequestError::from_json)
    }

    pub(super) async fn set_mutation_turn_state(&self, key: &TurnKey, state: MutationTurnState) {
        let turns = self.turns.read().await;
        if turns.contains_key(key) {
            self.mutation_turn_states
                .write()
                .await
                .insert(key.clone(), state);
        }
    }

    pub(super) fn ensure_agent_mutation_target(
        &self,
        turn: &ActiveTurn,
        target: &ResolvedAgentConnection,
    ) -> std::result::Result<(), SidecarRequestError> {
        let frozen_connection = turn
            .tab_connection_id
            .as_deref()
            .or(turn.connection_id.as_deref())
            .ok_or_else(|| {
                SidecarRequestError::security(anyhow!(
                    "Agent writes require a connection frozen into the current workspace turn"
                ))
            })?;
        if frozen_connection != target.id {
            return Err(SidecarRequestError::security(anyhow!(
                "the mutation target differs from the connection frozen into this turn"
            )));
        }
        match target.config.environment {
            ConnectionEnvironment::Development | ConnectionEnvironment::Staging => {}
            ConnectionEnvironment::Unclassified => {
                return Err(SidecarRequestError {
                    code: -32_066,
                    message: "AI writes are disabled until this connection is explicitly classified as development or staging".to_string(),
                    data: Some(json!({"kind":"unclassified_connection_write_blocked","recoverable":false})),
                });
            }
            ConnectionEnvironment::Production => {
                return Err(SidecarRequestError {
                    code: -32_066,
                    message: "AI writes are always disabled for production connections".to_string(),
                    data: Some(
                        json!({"kind":"production_connection_write_blocked","recoverable":false}),
                    ),
                });
            }
        }
        let protected = target.config.production_databases.iter().any(|protected| {
            let protected = protected.trim();
            protected == "*"
                || target
                    .database
                    .as_deref()
                    .is_some_and(|value| value.eq_ignore_ascii_case(protected))
                || (!target.namespace.is_empty()
                    && target.namespace.eq_ignore_ascii_case(protected))
        });
        if protected {
            return Err(SidecarRequestError {
                code: -32_066,
                message: "AI writes are disabled for this protected database or namespace"
                    .to_string(),
                data: Some(json!({"kind":"protected_database_write_blocked","recoverable":false})),
            });
        }
        self.ensure_trusted_mutation_adapter(target)
    }

    pub(super) fn review_approved_query(
        &self,
        target: &ResolvedAgentConnection,
        query: &str,
    ) -> std::result::Result<ApprovedQueryReview, SidecarRequestError> {
        let canonical = canonical_driver_name(&target.driver)
            .unwrap_or(target.driver.trim())
            .to_ascii_lowercase();
        let dialect = match canonical.as_str() {
            "mysql" => Some(StatementScanDialect::Mysql),
            "sqlite" | "postgres" => Some(StatementScanDialect::Postgres),
            _ if target.capabilities.supports_sql_query => Some(StatementScanDialect::Postgres),
            _ => None,
        };
        review_approved_query_input(&target.driver, dialect, query, &target.id)
            .map_err(SidecarRequestError::invalid_params)
    }
}
