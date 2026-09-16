use super::host_errors::SidecarRequestError;
use crate::agent::protocol::GraphTypedBlob;
use crate::agent::protocol::AGENT_HOST_MAX_FRAME_BYTES;
use crate::agent::store::StoredGraphCheckpoint;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde_json::json;
use serde_json::Value;

pub(super) fn sidecar_resumed(response: &Value) -> bool {
    response.get("resumed").and_then(Value::as_bool) == Some(true)
}

pub(super) fn validate_graph_typed_blob(
    blob: &GraphTypedBlob,
) -> std::result::Result<(), SidecarRequestError> {
    blob.validate()
        .map_err(SidecarRequestError::invalid_params)?;
    let decoded = BASE64_STANDARD.decode(blob.data.as_bytes()).map_err(|_| {
        SidecarRequestError::invalid_params("graph typed blob data is not valid base64")
    })?;
    if decoded.len() > AGENT_HOST_MAX_FRAME_BYTES {
        return Err(SidecarRequestError::invalid_params(
            "decoded graph typed blob exceeds the maximum frame size",
        ));
    }
    Ok(())
}

pub(super) fn graph_checkpoint_record_value(record: StoredGraphCheckpoint) -> Value {
    json!({
        "checkpointThreadId": record.checkpoint_thread_id,
        "checkpointNs": record.checkpoint_ns,
        "checkpointId": record.checkpoint_id,
        "parentCheckpointId": record.parent_checkpoint_id,
        "checkpoint": record.checkpoint,
        "metadata": record.metadata,
        "pendingWrites": record.pending_writes.into_iter().map(|write| json!({
            "taskId": write.task_id,
            "index": write.index,
            "channel": write.channel,
            "value": write.value,
        })).collect::<Vec<_>>(),
    })
}
