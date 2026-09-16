use super::checkpoint_helpers::{graph_checkpoint_record_value, validate_graph_typed_blob};
use super::host_errors::SidecarRequestError;
use super::session_state::AgentHostInner;
use super::turn_state::ActiveTurn;
use crate::agent::protocol::CheckpointRequest;
use crate::agent::protocol::GraphCheckpointDeleteThreadRequest;
use crate::agent::protocol::GraphCheckpointGetRequest;
use crate::agent::protocol::GraphCheckpointListRequest;
use crate::agent::protocol::GraphCheckpointPutRequest;
use crate::agent::protocol::GraphCheckpointPutWritesRequest;
use crate::agent::store::StoredGraphWrite;
use anyhow::anyhow;
use serde_json::json;
use serde_json::Value;

impl AgentHostInner {
    pub(super) async fn handle_checkpoint_save(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: CheckpointRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        if request.project_id != turn.project_id {
            return Err(SidecarRequestError::security(anyhow!(
                "checkpoint project does not match the active turn"
            )));
        }
        let checkpoint = request.checkpoint.ok_or_else(|| {
            SidecarRequestError::invalid_params("checkpoint is required for checkpoint.save")
        })?;
        self.store
            .save_checkpoint(
                &request.project_id,
                &request.metadata.thread_id,
                request.checkpoint_version,
                &checkpoint,
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({"saved": true, "checkpointVersion": request.checkpoint_version}))
    }

    pub(super) async fn handle_checkpoint_load(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: CheckpointRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        if request.project_id != turn.project_id {
            return Err(SidecarRequestError::security(anyhow!(
                "checkpoint project does not match the active turn"
            )));
        }
        let checkpoint = self
            .store
            .load_checkpoint(
                &request.project_id,
                &request.metadata.thread_id,
                request.checkpoint_version,
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({
            "checkpointVersion": request.checkpoint_version,
            "checkpoint": checkpoint,
        }))
    }

    pub(super) async fn handle_graph_checkpoint_get(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: GraphCheckpointGetRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        self.validate_graph_checkpoint_scope(&request.scope).await?;
        let record = self
            .store
            .load_graph_checkpoint(
                &request.scope.project_id,
                &request.scope.checkpoint_thread_id,
                &request.scope.checkpoint_ns,
                request.checkpoint_id.as_deref(),
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({"record": record.map(graph_checkpoint_record_value)}))
    }

    pub(super) async fn handle_graph_checkpoint_list(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: GraphCheckpointListRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        self.validate_graph_checkpoint_scope(&request.scope).await?;
        if request.limit == 0 || request.limit > 1_000 {
            return Err(SidecarRequestError::invalid_params(
                "graph checkpoint list limit must be between 1 and 1000",
            ));
        }
        if request
            .filter
            .as_ref()
            .is_some_and(|value| !value.is_object())
        {
            return Err(SidecarRequestError::invalid_params(
                "graph checkpoint metadata filter must be an object",
            ));
        }
        let records = self
            .store
            .list_graph_checkpoints(
                &request.scope.project_id,
                &request.scope.checkpoint_thread_id,
                &request.scope.checkpoint_ns,
                request.checkpoint_id.as_deref(),
                request.before_checkpoint_id.as_deref(),
                request.limit,
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({
            "records": records.into_iter().map(graph_checkpoint_record_value).collect::<Vec<_>>()
        }))
    }

    pub(super) async fn handle_graph_checkpoint_put(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: GraphCheckpointPutRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        self.validate_graph_checkpoint_scope(&request.scope).await?;
        validate_graph_typed_blob(&request.checkpoint)?;
        validate_graph_typed_blob(&request.metadata)?;
        self.store
            .save_graph_checkpoint(
                &request.scope.project_id,
                &request.scope.checkpoint_thread_id,
                &request.scope.checkpoint_ns,
                &request.checkpoint_id,
                request.parent_checkpoint_id.as_deref(),
                &serde_json::to_value(&request.checkpoint)
                    .map_err(|error| SidecarRequestError::storage(error.into()))?,
                &serde_json::to_value(&request.metadata)
                    .map_err(|error| SidecarRequestError::storage(error.into()))?,
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({"saved": true, "checkpointId": request.checkpoint_id}))
    }

    pub(super) async fn handle_graph_checkpoint_put_writes(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: GraphCheckpointPutWritesRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        self.validate_graph_checkpoint_scope(&request.scope).await?;
        if request.writes.len() > 2_048 {
            return Err(SidecarRequestError::invalid_params(
                "too many graph checkpoint writes",
            ));
        }
        let writes = request
            .writes
            .iter()
            .map(|write| {
                validate_graph_typed_blob(&write.value)?;
                Ok(StoredGraphWrite {
                    task_id: write.task_id.clone(),
                    index: write.index,
                    channel: write.channel.clone(),
                    value: serde_json::to_value(&write.value)
                        .map_err(|error| SidecarRequestError::storage(error.into()))?,
                })
            })
            .collect::<std::result::Result<Vec<_>, SidecarRequestError>>()?;
        self.store
            .save_graph_writes(
                &request.scope.project_id,
                &request.scope.checkpoint_thread_id,
                &request.scope.checkpoint_ns,
                &request.checkpoint_id,
                &writes,
            )
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({"saved": true, "writeCount": writes.len()}))
    }

    pub(super) async fn handle_graph_checkpoint_delete_thread(
        &self,
        params: Value,
    ) -> std::result::Result<Value, SidecarRequestError> {
        let request: GraphCheckpointDeleteThreadRequest = serde_json::from_value(params)
            .map_err(|error| SidecarRequestError::invalid_params(error.to_string()))?;
        let turn = self
            .validate_active(&request.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        if request.project_id != turn.project_id
            || request.checkpoint_thread_id != turn.checkpoint_thread_id
        {
            return Err(SidecarRequestError::security(anyhow!(
                "graph checkpoint delete scope does not match the active turn"
            )));
        }
        let deleted = self
            .store
            .delete_graph_thread(&request.project_id, &request.checkpoint_thread_id)
            .await
            .map_err(SidecarRequestError::storage)?;
        Ok(json!({"deleted": deleted}))
    }

    pub(super) async fn validate_graph_checkpoint_scope(
        &self,
        scope: &crate::agent::protocol::GraphCheckpointScopeRequest,
    ) -> std::result::Result<ActiveTurn, SidecarRequestError> {
        let turn = self
            .validate_active(&scope.metadata)
            .await
            .map_err(SidecarRequestError::security)?;
        if scope.project_id != turn.project_id
            || scope.checkpoint_thread_id != turn.checkpoint_thread_id
        {
            return Err(SidecarRequestError::security(anyhow!(
                "graph checkpoint scope does not match the active turn"
            )));
        }
        if scope.checkpoint_ns.chars().count() > 512 {
            return Err(SidecarRequestError::invalid_params(
                "graph checkpoint namespace exceeds 512 characters",
            ));
        }
        Ok(turn)
    }
}
