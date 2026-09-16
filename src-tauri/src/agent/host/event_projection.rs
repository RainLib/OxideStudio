use super::conversation_helpers::{
    bounded_non_empty_string_field, bounded_optional_string_field, has_string_field,
    non_empty_string_field, optional_agent_relative_path, optional_bool_field,
    optional_string_array_field, optional_string_field, valid_clarification_question,
};
use crate::agent::protocol::RequestMetadata;
use serde_json::json;
use serde_json::Map;
use serde_json::Value;

pub(super) fn trusted_project_file_change_event(
    metadata: &RequestMetadata,
    call_id: &str,
    change: &crate::commands::project_files::ProjectFileAppliedChange,
    created: bool,
    sequence: u64,
    occurred_at: i64,
) -> Value {
    json!({
        "type": "file.changed",
        "threadId": metadata.thread_id,
        "turnId": metadata.turn_id,
        "sequence": sequence,
        "occurredAt": occurred_at,
        "callId": call_id,
        "relativePath": change.relative_path,
        "operation": if created { "created" } else { "updated" },
        "revision": change.revision,
        "previousRevision": change.previous_revision,
        "originalContent": change.original_content,
        "appliedContent": change.applied_content,
        "additions": change.additions,
        "deletions": change.deletions,
        "introducedLines": change.introduced_lines,
        "lineEvidenceTruncated": change.line_evidence_truncated,
        "reviewable": true,
    })
}

pub(super) fn bounded_tool_citation_preview(tool_name: &str, value: &Value) -> Option<Value> {
    const OBJECT_FIELDS: [&str; 4] = ["name", "namespace", "kind", "type"];
    const DESCRIPTION_FIELDS: [&str; 5] = ["connectionId", "namespace", "name", "driver", "kind"];
    const PLAN_FIELDS: [&str; 3] = ["id", "driver", "mode"];
    const PLAN_NODE_FIELDS: [&str; 5] = ["id", "nodeType", "relation", "alias", "index"];
    const ACTIVE_TAB_FIELDS: [&str; 6] = [
        "id",
        "type",
        "title",
        "connectionId",
        "databaseName",
        "schemaName",
    ];

    match tool_name {
        "metadata.listObjects" | "metadata.listCollections" => {
            let items = value.as_array()?;
            Some(Value::Array(
                items
                    .iter()
                    .take(8)
                    .filter_map(|item| bounded_object_fields(item, &OBJECT_FIELDS))
                    .map(Value::Object)
                    .collect(),
            ))
        }
        "metadata.describeObject" => {
            bounded_object_fields(value, &DESCRIPTION_FIELDS).map(Value::Object)
        }
        "query.explain" => {
            let source = value.as_object()?;
            let mut preview = bounded_object_fields(value, &PLAN_FIELDS)?;
            if let Some(root) = source
                .get("root")
                .and_then(|root| bounded_object_fields(root, &PLAN_NODE_FIELDS))
            {
                preview.insert("root".to_string(), Value::Object(root));
            }
            Some(Value::Object(preview))
        }
        "workspace.getActiveTab" => {
            let source = value.as_object()?;
            let mut preview = bounded_object_fields(value, &ACTIVE_TAB_FIELDS)?;
            if let Some(plan) = source
                .get("explainPlan")
                .and_then(bounded_active_plan_preview)
            {
                preview.insert("explainPlan".to_string(), plan);
            }
            Some(Value::Object(preview))
        }
        _ => None,
    }
}

pub(super) fn bounded_active_plan_preview(value: &Value) -> Option<Value> {
    const PLAN_TEXT_FIELDS: [&str; 4] = ["id", "driver", "mode", "rootNodeId"];
    const PLAN_NUMBER_FIELDS: [&str; 5] = [
        "generatedInMs",
        "planningTimeMs",
        "executionTimeMs",
        "totalCost",
        "estimatedRows",
    ];
    const NODE_TEXT_FIELDS: [&str; 6] = [
        "id",
        "parentId",
        "nodeType",
        "relation",
        "index",
        "accessType",
    ];
    const NODE_NUMBER_FIELDS: [&str; 5] = [
        "totalCost",
        "estimatedRows",
        "actualTotalTimeMs",
        "actualRows",
        "loops",
    ];
    let source = value.as_object()?;
    let mut preview = bounded_object_fields(value, &PLAN_TEXT_FIELDS)?;
    copy_finite_number_fields(source, &mut preview, &PLAN_NUMBER_FIELDS);
    if let Some(Value::Bool(truncated)) = source.get("truncated") {
        preview.insert("truncated".to_string(), Value::Bool(*truncated));
    }
    if let Some(nodes) = source.get("nodes").and_then(Value::as_array) {
        let bounded_nodes = nodes
            .iter()
            .take(12)
            .filter_map(|node| {
                let source = node.as_object()?;
                let mut bounded = bounded_object_fields(node, &NODE_TEXT_FIELDS)?;
                copy_finite_number_fields(source, &mut bounded, &NODE_NUMBER_FIELDS);
                Some(Value::Object(bounded))
            })
            .collect::<Vec<_>>();
        preview.insert("nodes".to_string(), Value::Array(bounded_nodes));
    }
    Some(Value::Object(preview))
}

pub(super) fn copy_finite_number_fields(
    source: &Map<String, Value>,
    target: &mut Map<String, Value>,
    fields: &[&str],
) {
    for field in fields {
        if let Some(value @ Value::Number(number)) = source.get(*field) {
            if number.as_f64().is_some_and(f64::is_finite) {
                target.insert((*field).to_string(), value.clone());
            }
        }
    }
}

pub(super) fn bounded_object_fields(value: &Value, fields: &[&str]) -> Option<Map<String, Value>> {
    let source = value.as_object()?;
    let mut bounded = Map::new();
    for field in fields {
        if let Some(Value::String(text)) = source.get(*field) {
            bounded.insert(
                (*field).to_string(),
                Value::String(text.chars().take(512).collect()),
            );
        }
    }
    Some(bounded)
}

pub(super) fn valid_agent_event_shape(event_type: &str, object: &Map<String, Value>) -> bool {
    match event_type {
        "turn.status" => {
            matches!(
                object.get("status").and_then(Value::as_str),
                Some(
                    "starting"
                        | "planning"
                        | "running"
                        | "awaiting_input"
                        | "awaiting_approval"
                        | "completed"
                        | "failed"
                        | "cancelled"
                )
            ) && optional_string_field(object, "label")
        }
        "plan.changed" => object
            .get("items")
            .and_then(Value::as_array)
            .filter(|items| items.len() <= 512)
            .is_some_and(|items| {
                items.iter().all(|item| {
                    let Some(item) = item.as_object() else {
                        return false;
                    };
                    has_string_field(item, "id")
                        && has_string_field(item, "title")
                        && matches!(
                            item.get("status").and_then(Value::as_str),
                            Some("pending" | "running" | "completed" | "failed")
                        )
                })
            }),
        "tool.started" | "tool.finished" => {
            has_string_field(object, "callId")
                && has_string_field(object, "toolName")
                && has_string_field(object, "label")
                && optional_agent_relative_path(object, "relativePath")
                && optional_bool_field(object, "success")
                && optional_string_field(object, "detail")
        }
        "subagent" => {
            has_string_field(object, "name")
                && matches!(
                    object.get("status").and_then(Value::as_str),
                    Some("started" | "completed" | "failed")
                )
                && optional_string_field(object, "detail")
        }
        "clarification" => {
            non_empty_string_field(object, "clarificationId")
                && optional_string_field(object, "context")
                && object
                    .get("questions")
                    .and_then(Value::as_array)
                    .filter(|questions| (1..=3).contains(&questions.len()))
                    .is_some_and(|questions| questions.iter().all(valid_clarification_question))
        }
        "approval" => {
            [
                "approvalId",
                "callId",
                "inputDigest",
                "toolName",
                "title",
                "summary",
            ]
            .iter()
            .all(|key| has_string_field(object, key))
                && matches!(
                    object.get("risk").and_then(Value::as_str),
                    Some("write" | "destructive" | "external")
                )
        }
        "context.compacted" => ["inputTokens", "retainedTokens", "offloadedArtifacts"]
            .iter()
            .all(|key| object.get(*key).and_then(Value::as_u64).is_some()),
        "model.usage" => {
            object
                .get("calls")
                .and_then(Value::as_u64)
                .is_some_and(|calls| calls > 0)
                && ["inputTokens", "outputTokens", "totalTokens"]
                    .iter()
                    .all(|key| object.get(*key).and_then(Value::as_u64).is_some())
        }
        "answer.delta" => {
            has_string_field(object, "content") && optional_bool_field(object, "reset")
        }
        "final.answer" => {
            has_string_field(object, "content")
                && optional_string_array_field(object, "artifacts")
                && valid_optional_agent_citations(object)
        }
        "failure" => {
            has_string_field(object, "code")
                && has_string_field(object, "message")
                && object.get("retryable").and_then(Value::as_bool).is_some()
        }
        _ => false,
    }
}

pub(super) fn valid_optional_agent_citations(object: &Map<String, Value>) -> bool {
    let Some(value) = object.get("citations") else {
        return true;
    };
    value
        .as_array()
        .filter(|citations| citations.len() <= 8)
        .is_some_and(|citations| citations.iter().all(valid_agent_citation))
}

pub(super) fn valid_agent_citation(value: &Value) -> bool {
    let Some(citation) = value.as_object() else {
        return false;
    };
    if !bounded_non_empty_string_field(citation, "id", 80)
        || !bounded_non_empty_string_field(citation, "label", 200)
        || !bounded_non_empty_string_field(citation, "toolName", 120)
        || !bounded_non_empty_string_field(citation, "projectId", 240)
        || !bounded_optional_string_field(citation, "detail", 500)
        || ![
            "connectionId",
            "databaseName",
            "schemaName",
            "objectName",
            "tabId",
            "planId",
            "nodeId",
        ]
        .iter()
        .all(|key| bounded_optional_string_field(citation, key, 240))
        || !bounded_optional_string_field(citation, "objectType", 120)
    {
        return false;
    }
    match citation.get("kind").and_then(Value::as_str) {
        Some("databaseSchema") => ["connectionId", "schemaName"]
            .iter()
            .all(|key| non_empty_string_field(citation, key)),
        Some("databaseObject") => ["connectionId", "schemaName", "objectName"]
            .iter()
            .all(|key| non_empty_string_field(citation, key)),
        Some("planNode") => ["tabId", "planId", "nodeId"]
            .iter()
            .all(|key| non_empty_string_field(citation, key)),
        _ => false,
    }
}
