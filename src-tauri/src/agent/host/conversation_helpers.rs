use anyhow::anyhow;
use anyhow::Result;
use serde_json::Map;
use serde_json::Value;

pub(super) const CONTEXT_METRICS_THREAD_ID: &str = "__oxide_context_metrics_v1__";
pub(super) const CONVERSATION_SNAPSHOT_THREAD_ID: &str = "__oxide_ui_conversation_v1__";
pub(super) const MAX_CONVERSATION_TURNS: usize = 100;
pub(super) const MAX_CONVERSATION_RESUME_REQUESTS: usize = 8;
pub(super) const MAX_CONVERSATION_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;

pub(super) fn validate_project_id(project_id: &str) -> Result<()> {
    if project_id.trim().is_empty() || project_id.chars().count() > 240 {
        return Err(anyhow!("projectId must contain 1 to 240 characters"));
    }
    Ok(())
}

pub(super) fn validate_conversation_id(conversation_id: Option<&str>) -> Result<()> {
    let Some(conversation_id) = conversation_id else {
        return Ok(());
    };
    if conversation_id.trim().is_empty()
        || conversation_id.chars().count() > 80
        || !conversation_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.')
        })
    {
        return Err(anyhow!(
            "conversationId must contain 1 to 80 letters, numbers, dashes, underscores, colons, or dots"
        ));
    }
    Ok(())
}

pub(super) fn conversation_snapshot_store_key(conversation_id: Option<&str>) -> String {
    match conversation_id {
        Some(conversation_id) => format!("{CONVERSATION_SNAPSHOT_THREAD_ID}:{conversation_id}"),
        None => CONVERSATION_SNAPSHOT_THREAD_ID.to_string(),
    }
}

pub(super) fn conversation_belongs_to_scope(
    conversation_id: &str,
    conversation_scope: &str,
) -> bool {
    conversation_id == conversation_scope
        || conversation_id
            .strip_prefix(conversation_scope)
            .is_some_and(|suffix| suffix.starts_with(":chat:"))
}

pub(super) fn conversation_summary_title(message: &str) -> String {
    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut characters = normalized.chars();
    let title = characters.by_ref().take(79).collect::<String>();
    if characters.next().is_some() {
        format!("{title}…")
    } else {
        title
    }
}

pub(super) fn valid_clarification_question(value: &Value) -> bool {
    let Some(question) = value.as_object() else {
        return false;
    };
    non_empty_string_field(question, "id")
        && non_empty_string_field(question, "prompt")
        && question.get("allowFreeText").and_then(Value::as_bool) == Some(true)
        && question
            .get("options")
            .and_then(Value::as_array)
            .filter(|options| (2..=3).contains(&options.len()))
            .is_some_and(|options| {
                options.iter().all(|option| {
                    let Some(option) = option.as_object() else {
                        return false;
                    };
                    non_empty_string_field(option, "id")
                        && non_empty_string_field(option, "label")
                        && optional_string_field(option, "description")
                })
            })
}

pub(super) fn has_string_field(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).and_then(Value::as_str).is_some()
}

pub(super) fn non_empty_string_field(object: &Map<String, Value>, key: &str) -> bool {
    object
        .get(key)
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
}

pub(super) fn bounded_non_empty_string_field(
    object: &Map<String, Value>,
    key: &str,
    max_chars: usize,
) -> bool {
    object
        .get(key)
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty() && value.chars().count() <= max_chars)
}

pub(super) fn bounded_optional_string_field(
    object: &Map<String, Value>,
    key: &str,
    max_chars: usize,
) -> bool {
    object.get(key).is_none()
        || object
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty() && value.chars().count() <= max_chars)
}

pub(super) fn optional_string_field(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).is_none() || has_string_field(object, key)
}

pub(super) fn optional_agent_relative_path(object: &Map<String, Value>, key: &str) -> bool {
    let Some(value) = object.get(key) else {
        return true;
    };
    let Some(path) = value.as_str() else {
        return false;
    };
    if path.is_empty()
        || path.chars().count() > 2_000
        || path.contains('\0')
        || path.starts_with('/')
        || path.starts_with('\\')
        || (path.len() >= 2
            && path.as_bytes()[0].is_ascii_alphabetic()
            && path.as_bytes()[1] == b':')
    {
        return false;
    }
    !path.split(['/', '\\']).any(|segment| segment == "..")
}

pub(super) fn optional_bool_field(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).is_none() || object.get(key).and_then(Value::as_bool).is_some()
}

pub(super) fn optional_string_array_field(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).is_none()
        || object
            .get(key)
            .and_then(Value::as_array)
            .is_some_and(|values| values.iter().all(Value::is_string))
}

pub(super) fn bounded_identifier(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(max_chars)
        .collect()
}
