use super::values::{normalized_value, string_argument};
use serde_json::{Map, Value};

pub(super) fn required_document_value(
    value: Option<&String>,
    label: &str,
) -> Result<Value, String> {
    let value = value.ok_or_else(|| format!("MongoDB {label} is required."))?;
    let value = normalized_value(value)?;
    if !value.is_object() {
        return Err(format!("MongoDB {label} must be a document."));
    }
    Ok(value)
}

pub(super) fn required_document_array(
    value: Option<&String>,
    label: &str,
) -> Result<Vec<Value>, String> {
    let value = value.ok_or_else(|| format!("MongoDB {label} is required."))?;
    let value = normalized_value(value)?;
    let Value::Array(values) = value else {
        return Err(format!("MongoDB {label} must be an array."));
    };
    if values.is_empty() || values.iter().any(|value| !value.is_object()) {
        return Err(format!(
            "MongoDB {label} must contain at least one document."
        ));
    }
    Ok(values)
}

pub(super) fn required_update_value(value: Option<&String>, label: &str) -> Result<Value, String> {
    let value = value.ok_or_else(|| format!("MongoDB {label} is required."))?;
    let value = normalized_value(value)?;
    let valid_document = value
        .as_object()
        .is_some_and(|document| !document.is_empty());
    let valid_pipeline = value
        .as_array()
        .is_some_and(|pipeline| !pipeline.is_empty() && pipeline.iter().all(Value::is_object));
    if !valid_document && !valid_pipeline {
        return Err(format!(
            "MongoDB {label} must be a non-empty document or pipeline array."
        ));
    }
    Ok(value)
}

pub(super) fn options_argument(
    value: Option<&String>,
    label: &str,
    allowed: &[&str],
) -> Result<Map<String, Value>, String> {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return Ok(Map::new());
    };
    let options = normalized_value(value)?
        .as_object()
        .cloned()
        .ok_or_else(|| format!("MongoDB {label} must be a document."))?;
    if let Some(unknown) = options.keys().find(|key| {
        !allowed
            .iter()
            .any(|allowed_key| allowed_key == &key.as_str())
    }) {
        return Err(format!("Unsupported MongoDB {label} field: {unknown}."));
    }
    Ok(options)
}

pub(super) fn find_and_modify_options(
    value: Option<&String>,
) -> Result<Map<String, Value>, String> {
    let mut options = options_argument(
        value,
        "findOneAnd* options",
        &[
            "arrayFilters",
            "bypassDocumentValidation",
            "collation",
            "comment",
            "hint",
            "let",
            "maxTimeMS",
            "projection",
            "returnDocument",
            "returnNewDocument",
            "sort",
            "upsert",
            "writeConcern",
        ],
    )?;
    if let Some(projection) = options.remove("projection") {
        if !projection.is_object() {
            return Err("MongoDB findOneAnd* projection must be a document.".into());
        }
        options.insert("fields".to_string(), projection);
    }
    let return_document = options
        .remove("returnDocument")
        .or_else(|| options.remove("returnNewDocument"));
    if let Some(value) = return_document {
        let return_new = match value {
            Value::String(value) if value.eq_ignore_ascii_case("after") => true,
            Value::String(value) if value.eq_ignore_ascii_case("before") => false,
            Value::Bool(value) => value,
            _ => {
                return Err(
                    "MongoDB findOneAnd* returnDocument must be 'before' or 'after'.".into(),
                )
            }
        };
        options.insert("new".to_string(), Value::Bool(return_new));
    }
    Ok(options)
}

pub(super) fn object_argument(
    value: Option<&String>,
    label: &str,
) -> Result<Map<String, Value>, String> {
    let value = value.map(String::as_str).unwrap_or("{}");
    normalized_value(value)?
        .as_object()
        .cloned()
        .ok_or_else(|| format!("MongoDB {label} must be a document."))
}

pub(super) fn optional_object_argument(
    value: Option<&String>,
    label: &str,
) -> Result<Option<Map<String, Value>>, String> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| object_argument(Some(value), label))
        .transpose()
}

pub(super) fn required_object_argument(
    args: &[String],
    label: &str,
) -> Result<Map<String, Value>, String> {
    if args.len() != 1 {
        return Err(format!("MongoDB {label}() requires one document."));
    }
    object_argument(args.first(), label)
}

pub(super) fn bounded_integer(
    args: &[String],
    label: &str,
    minimum: i64,
    maximum: i64,
) -> Result<i64, String> {
    if args.len() != 1 {
        return Err(format!("MongoDB {label}() requires one integer."));
    }
    let value = args[0]
        .trim()
        .parse::<i64>()
        .map_err(|_| format!("MongoDB {label}() requires an integer."))?;
    if !(minimum..=maximum).contains(&value) {
        return Err(format!(
            "MongoDB {label}() must be between {minimum} and {maximum}."
        ));
    }
    Ok(value)
}

pub(super) fn optional_explain_verbosity(args: &[String]) -> Result<String, String> {
    if args.is_empty() {
        return Ok("queryPlanner".to_string());
    }
    if args.len() != 1 {
        return Err("MongoDB explain() accepts at most one verbosity string.".into());
    }
    let value = string_argument(&args[0])?;
    if !matches!(
        value.as_str(),
        "queryPlanner" | "executionStats" | "allPlansExecution"
    ) {
        return Err("Unsupported MongoDB explain() verbosity.".into());
    }
    Ok(value)
}
