use super::approval_types::{command_preflight_cache_key, PendingCommandPreflight};
use super::approved_query_review::{mutation_policy_digest, required_input_text};
use super::event_projection::bounded_tool_citation_preview;
use super::host_errors::SidecarRequestError;
use super::identity_helpers::{
    bounded_text, constant_time_text_eq, input_digest, normalized_digest, random_token,
};
use super::query_result::{
    tool_deadline_duration, tool_requires_approval, DEFAULT_TOOL_RESULT_BYTES,
    MAX_TOOL_RESULT_BYTES, MAX_TOOL_RESULT_ROWS,
};
use super::session_state::AgentHostInner;
use super::tool_manifest::RustHostTool;
use super::turn_state::{ActiveTurn, TurnKey};
use crate::agent::protocol::AgentToolManifestEntry;
use crate::agent::protocol::BoundedObservation;
use crate::agent::protocol::ToolInvokeRequest;
use crate::agent::protocol::ToolPreflightRequest;
use crate::agent::shell::evaluate_shell_command_policy;
use crate::agent::shell::execute_shell_command;
use crate::agent::shell::CommandPolicyDecision;
use crate::agent::shell::CommandPreflightResult;
use crate::agent::shell::ShellSandboxMode;
use crate::agent::shell::DEFAULT_SHELL_TIMEOUT_MS;
use crate::agent::shell::MAX_SHELL_TIMEOUT_MS;
use crate::core::config::ConfigManager;
use crate::core::store::MetaStore;
use anyhow::anyhow;
use anyhow::Result;
use serde_json::json;
use serde_json::Value;
use std::time::Instant;
use tauri::Manager;

impl AgentHostInner {
    pub(super) async fn handle_tool_preflight(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: ToolPreflightRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        let expected_digest = input_digest(&request.input);
        if !constant_time_text_eq(&normalized_digest(&request.input_digest), &expected_digest) {
            return Err(SidecarRequestError::security(anyhow!(
                "tool preflight input digest does not match the canonical input"
            )));
        }
        let tool = turn.tools.get(&request.tool_name).ok_or_else(|| {
            SidecarRequestError::security(anyhow!("tool is not present in the turn manifest"))
        })?;
        if request.tool_name != RustHostTool::ShellExecute.name()
            || !tool
                .permissions
                .iter()
                .any(|permission| permission == "external")
        {
            return Err(SidecarRequestError::invalid_params(
                "command preflight is only available for shell.execute",
            ));
        }
        let result = self.shell_policy_for_input(&turn, &request.input).await?;
        let key = TurnKey::from_metadata(&request.metadata);
        let cache_key = command_preflight_cache_key(&key, &request.call_id, &result.policy_digest);
        self.command_preflights.write().await.insert(
            cache_key,
            PendingCommandPreflight {
                key,
                call_id: request.call_id,
                input_digest: expected_digest,
                tool_name: request.tool_name,
                result: result.clone(),
                expires_at: turn.deadline,
            },
        );
        serde_json::to_value(result).map_err(SidecarRequestError::from_json)
    }

    pub(super) async fn shell_policy_for_input(
        &self,
        turn: &ActiveTurn,
        input: &Value,
    ) -> std::result::Result<CommandPreflightResult, SidecarRequestError> {
        let store = self
            .app
            .try_state::<MetaStore>()
            .ok_or_else(|| SidecarRequestError::tool("project metadata store is unavailable"))?;
        let config = self
            .app
            .try_state::<ConfigManager>()
            .ok_or_else(|| SidecarRequestError::tool("application settings are unavailable"))?;
        let command = required_input_text(input, "command", 32_000)?;
        let relative_directory = input
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let sandbox_mode =
            ShellSandboxMode::parse(input.get("sandboxMode").and_then(Value::as_str))
                .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let (project_root, working_directory) =
            crate::commands::project_files::agent_project_directory(
                &store,
                &turn.project_id,
                relative_directory,
            )
            .await
            .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
        let settings = config.load_settings().map_err(SidecarRequestError::tool)?;
        Ok(evaluate_shell_command_policy(
            &project_root,
            &working_directory,
            &command,
            sandbox_mode,
            &settings,
        ))
    }

    pub(super) async fn handle_tool_invoke(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: ToolInvokeRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        let expected_digest = input_digest(&request.input);
        if !constant_time_text_eq(&normalized_digest(&request.input_digest), &expected_digest) {
            return Err(SidecarRequestError::security(anyhow!(
                "tool input digest does not match the canonical input"
            )));
        }
        let tool = turn.tools.get(&request.tool_name).ok_or_else(|| {
            SidecarRequestError::security(anyhow!("tool is not present in the turn manifest"))
        })?;

        let mut lease_policy_digest = None;
        let command_preflight = if request.tool_name == RustHostTool::ShellExecute.name() {
            let result = self.shell_policy_for_input(&turn, &request.input).await?;
            let requested_digest = request.policy_digest.as_deref().ok_or_else(|| {
                SidecarRequestError::security(anyhow!(
                    "shell execution requires a command policy digest"
                ))
            })?;
            if !constant_time_text_eq(requested_digest, &result.policy_digest) {
                return Err(SidecarRequestError::security(anyhow!(
                    "command policy changed after approval; review the command again"
                )));
            }
            if result.decision == CommandPolicyDecision::Block {
                return Err(SidecarRequestError {
                    code: -32_053,
                    message: "command policy blocked shell execution".to_string(),
                    data: Some(json!({
                        "kind": "command_policy_block",
                        "recoverable": false,
                        "preflight": result,
                    })),
                });
            }
            lease_policy_digest = Some(result.policy_digest.clone());
            Some(result)
        } else if request.tool_name == RustHostTool::QueryExecuteApproved.name() {
            let query = required_input_text(&request.input, "query", 200_000)?;
            let target = self.resolve_connection(&turn, &request.input).await?;
            self.ensure_agent_mutation_target(&turn, &target)?;
            let review = self.review_approved_query(&target, &query)?;
            let current_policy =
                mutation_policy_digest(&target, &expected_digest, &review.operation_type);
            if let Some(requested_policy) = request.policy_digest.as_deref() {
                if !constant_time_text_eq(requested_policy, &current_policy) {
                    return Err(SidecarRequestError::security(anyhow!(
                        "the database target changed after approval; review the operation again"
                    )));
                }
                lease_policy_digest = Some(current_policy);
            }
            None
        } else {
            if request.policy_digest.is_some() {
                return Err(SidecarRequestError::security(anyhow!(
                    "this tool must not receive a command policy digest"
                )));
            }
            None
        };

        let high_risk = tool_requires_approval(&request.tool_name, &tool.permissions);
        if high_risk {
            let lease = request
                .approval_lease
                .as_deref()
                .ok_or_else(|| SidecarRequestError {
                    code: -32_050,
                    message: "tool execution requires an approval lease".to_string(),
                    data: Some(json!({"kind":"approval_required","recoverable":true})),
                })?;
            self.consume_approval_lease(
                lease,
                &TurnKey::from_metadata(&request.metadata),
                &request.call_id,
                &expected_digest,
                &request.tool_name,
                lease_policy_digest.as_deref(),
            )
            .await
            .map_err(SidecarRequestError::security)?;
        } else if request.approval_lease.is_some() {
            return Err(SidecarRequestError::security(anyhow!(
                "this tool must not receive an approval lease"
            )));
        }

        let execution_started = Instant::now();
        let value = match self.execute_rust_tool(&turn, &request).await {
            Ok(value) => value,
            Err(error) => {
                if let Some(preflight) = command_preflight.as_ref() {
                    tracing::warn!(
                        target: "oxide_agent_shell_audit",
                        project_id = %turn.project_id,
                        turn_id = %request.metadata.turn_id,
                        call_id = %request.call_id,
                        policy_digest = %preflight.policy_digest,
                        decision = ?preflight.decision,
                        rule_ids = ?preflight
                            .findings
                            .iter()
                            .map(|finding| finding.rule_id.as_str())
                            .collect::<Vec<_>>(),
                        executables = ?preflight.executables,
                        sandbox_mode = request
                            .input
                            .get("sandboxMode")
                            .and_then(|entry| entry.as_str())
                            .unwrap_or("workspace-write"),
                        host_error_code = error.code,
                        duration_ms = execution_started.elapsed().as_millis() as u64,
                        "agent shell command failed before a result was produced"
                    );
                }
                return Err(error);
            }
        };
        if let Some(preflight) = command_preflight.as_ref() {
            tracing::info!(
                target: "oxide_agent_shell_audit",
                project_id = %turn.project_id,
                turn_id = %request.metadata.turn_id,
                call_id = %request.call_id,
                policy_digest = %preflight.policy_digest,
                decision = ?preflight.decision,
                rule_ids = ?preflight
                    .findings
                    .iter()
                    .map(|finding| finding.rule_id.as_str())
                    .collect::<Vec<_>>(),
                executables = ?preflight.executables,
                sandbox_mode = value
                    .get("sandboxMode")
                    .and_then(|entry| entry.as_str())
                    .unwrap_or("unknown"),
                exit_code = value.get("exitCode").and_then(|entry| entry.as_i64()),
                success = value.get("success").and_then(|entry| entry.as_bool()).unwrap_or(false),
                timed_out = value.get("timedOut").and_then(|entry| entry.as_bool()).unwrap_or(false),
                duration_ms = value.get("durationMs").and_then(|entry| entry.as_u64()),
                "agent shell command completed"
            );
        }
        self.bound_tool_result(&turn.project_id, tool, value)
            .await
            .map_err(|error| SidecarRequestError {
                code: -32_052,
                message: bounded_text(&error.to_string(), 2_000),
                data: Some(json!({"kind":"tool_result_failed","recoverable":true})),
            })
            .and_then(|value| serde_json::to_value(value).map_err(SidecarRequestError::from_json))
    }

    pub(super) async fn execute_rust_tool(
        &self,
        turn: &ActiveTurn,
        request: &ToolInvokeRequest,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let Some(tool) = RustHostTool::from_name(&request.tool_name) else {
            return Err(SidecarRequestError {
                code: -32_061,
                message: format!(
                    "tool {} requires a Rust host bridge that is not installed",
                    bounded_text(&request.tool_name, 200)
                ),
                data: Some(json!({
                    "kind": "host_tool_bridge_required",
                    "recoverable": true,
                    "toolName": request.tool_name,
                })),
            });
        };

        match tool {
            RustHostTool::ProjectListFiles => {
                let store = self.app.try_state::<MetaStore>().ok_or_else(|| {
                    SidecarRequestError::tool("project metadata store is unavailable")
                })?;
                let directory = request
                    .input
                    .get("directory")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let entries = crate::commands::project_files::agent_list_project_entries(
                    &store,
                    &turn.project_id,
                    directory,
                )
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                serde_json::to_value(entries).map_err(SidecarRequestError::from_json)
            }
            RustHostTool::ProjectReadFile => {
                let store = self.app.try_state::<MetaStore>().ok_or_else(|| {
                    SidecarRequestError::tool("project metadata store is unavailable")
                })?;
                let path = required_input_text(&request.input, "path", 2_000)?;
                let file = crate::commands::project_files::agent_read_project_file(
                    &store,
                    &turn.project_id,
                    &path,
                )
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                serde_json::to_value(file).map_err(SidecarRequestError::from_json)
            }
            RustHostTool::ProjectWriteFile => {
                let store = self.app.try_state::<MetaStore>().ok_or_else(|| {
                    SidecarRequestError::tool("project metadata store is unavailable")
                })?;
                let path = required_input_text(&request.input, "path", 2_000)?;
                let content = request
                    .input
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SidecarRequestError::invalid_params("content is required"))?;
                let expected_revision = request
                    .input
                    .get("expectedRevision")
                    .and_then(Value::as_str);
                let create = request
                    .input
                    .get("create")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let change = crate::commands::project_files::agent_apply_project_file_change(
                    &store,
                    &turn.project_id,
                    &path,
                    content,
                    expected_revision,
                    create,
                )
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                self.emit_trusted_project_file_change(
                    &request.metadata,
                    &request.call_id,
                    &change,
                    create,
                )
                .await;
                Ok(json!({
                    "relativePath": change.relative_path,
                    "operation": if create { "created" } else { "updated" },
                    "revision": change.revision,
                    "previousRevision": change.previous_revision,
                    "additions": change.additions,
                    "deletions": change.deletions,
                    "applied": true,
                    "reviewable": true,
                }))
            }
            RustHostTool::ConnectionList => {
                let store =
                    self.app
                        .try_state::<MetaStore>()
                        .ok_or_else(|| SidecarRequestError {
                            code: -32_060,
                            message: "connection metadata store is unavailable".to_string(),
                            data: Some(json!({"kind":"host_tool_unavailable","recoverable":true})),
                        })?;
                let connections = store
                    .get_connections(&turn.project_id)
                    .await
                    .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                Ok(Value::Array(
                    connections
                        .into_iter()
                        .map(|connection| {
                            json!({
                                "id": connection.id,
                                "projectId": connection.project_id,
                                "name": connection.name,
                                "driver": connection.driver,
                            })
                        })
                        .collect(),
                ))
            }
            RustHostTool::ConnectionCapabilities => {
                let capabilities = if let Some(driver) = request
                    .input
                    .get("driver")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    self.resolve_agent_driver_contract(driver, None)?.0
                } else {
                    self.resolve_connection(turn, &request.input)
                        .await?
                        .capabilities
                };
                serde_json::to_value(capabilities).map_err(SidecarRequestError::from_json)
            }
            RustHostTool::ProviderList => serde_json::to_value(self.agent_provider_capabilities())
                .map_err(SidecarRequestError::from_json),
            RustHostTool::WorkspaceGetActiveTab => {
                Ok(turn.active_tab.clone().unwrap_or(Value::Null))
            }
            RustHostTool::MetadataListCollections | RustHostTool::MetadataListObjects => {
                self.execute_metadata_list(turn, request).await
            }
            RustHostTool::MetadataDescribeObject => {
                self.execute_metadata_describe(turn, request).await
            }
            RustHostTool::QueryRunReadOnly => self.execute_read_only_query(turn, request).await,
            RustHostTool::QueryExplain => self.execute_explain_query(turn, request).await,
            RustHostTool::QueryExecuteApproved => self.execute_approved_query(turn, request).await,
            RustHostTool::ShellExecute => {
                let store = self.app.try_state::<MetaStore>().ok_or_else(|| {
                    SidecarRequestError::tool("project metadata store is unavailable")
                })?;
                let command = required_input_text(&request.input, "command", 32_000)?;
                let relative_directory = request
                    .input
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let sandbox_mode = ShellSandboxMode::parse(
                    request.input.get("sandboxMode").and_then(Value::as_str),
                )
                .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
                let requested_timeout = request
                    .input
                    .get("timeoutMs")
                    .and_then(Value::as_u64)
                    .unwrap_or(DEFAULT_SHELL_TIMEOUT_MS)
                    .clamp(1_000, MAX_SHELL_TIMEOUT_MS);
                let deadline =
                    tool_deadline_duration(turn, &request.tool_name, request.metadata.deadline)?;
                let timeout_ms = requested_timeout.min(deadline.as_millis().max(100) as u64);
                let (project_root, working_directory) =
                    crate::commands::project_files::agent_project_directory(
                        &store,
                        &turn.project_id,
                        relative_directory,
                    )
                    .await
                    .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                let result = execute_shell_command(
                    &project_root,
                    &working_directory,
                    &command,
                    sandbox_mode,
                    timeout_ms,
                )
                .await
                .map_err(|error| SidecarRequestError::tool(error.to_string()))?;
                serde_json::to_value(result).map_err(SidecarRequestError::from_json)
            }
        }
    }

    pub(super) async fn bound_tool_result(
        &self,
        project_id: &str,
        tool: &AgentToolManifestEntry,
        mut value: Value,
    ) -> Result<BoundedObservation> {
        let max_rows = tool
            .result_limit
            .as_ref()
            .and_then(|limit| limit.max_rows)
            .unwrap_or(MAX_TOOL_RESULT_ROWS)
            .min(MAX_TOOL_RESULT_ROWS);
        let mut truncated = false;
        let row_count = value.as_array().map(Vec::len);
        if let Some(rows) = value.as_array_mut() {
            if rows.len() > max_rows {
                rows.truncate(max_rows);
                truncated = true;
            }
        }
        let bytes = serde_json::to_vec(&value)?;
        let byte_count = bytes.len();
        let citation_preview = bounded_tool_citation_preview(&tool.name, &value);
        let max_bytes = tool
            .result_limit
            .as_ref()
            .and_then(|limit| limit.max_bytes)
            .unwrap_or(DEFAULT_TOOL_RESULT_BYTES)
            .clamp(1, MAX_TOOL_RESULT_BYTES);
        if byte_count <= max_bytes {
            return Ok(BoundedObservation {
                summary: format!("{} returned a bounded result", tool.name),
                data: Some(value),
                row_count,
                byte_count,
                truncated,
                artifact_ref: None,
            });
        }

        let artifact_id = format!("tool-result-{}", random_token(18));
        self.store
            .save_artifact(project_id, &artifact_id, &value)
            .await?;
        Ok(BoundedObservation {
            summary: format!(
                "{} result exceeded {} bytes and was offloaded",
                tool.name, max_bytes
            ),
            data: citation_preview,
            row_count,
            byte_count,
            truncated: true,
            artifact_ref: Some(artifact_id),
        })
    }
}
