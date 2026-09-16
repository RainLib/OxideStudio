//! Values for table operations.

use serde_json::Value;
use std::borrow::Cow;

pub(super) fn value_to_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        serde_json::Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

pub(super) fn value_to_u64(value: &serde_json::Value) -> Option<u64> {
    match value {
        serde_json::Value::Number(value) => {
            value.as_u64().or_else(|| value.as_i64().map(|v| v as u64))
        }
        serde_json::Value::String(value) => value.parse::<u64>().ok(),
        _ => None,
    }
}

pub(super) fn value_to_export_cow(value: &Value) -> Cow<'_, str> {
    match value {
        Value::Null => Cow::Borrowed(""),
        Value::String(value) => Cow::Borrowed(value),
        Value::Number(value) => Cow::Owned(value.to_string()),
        Value::Bool(true) => Cow::Borrowed("true"),
        Value::Bool(false) => Cow::Borrowed("false"),
        Value::Array(_) | Value::Object(_) => {
            Cow::Owned(serde_json::to_string(value).unwrap_or_default())
        }
    }
}

pub(super) fn value_to_export_string(value: &Value) -> String {
    value_to_export_cow(value).into_owned()
}
