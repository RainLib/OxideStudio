use crate::agent::protocol::AgentTurnRequest;
use anyhow::anyhow;
use anyhow::Result;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as BASE64_URL;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use serde_json::Map;
use serde_json::Value;
use sha2::Digest;
use sha2::Sha256;

pub(super) fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut canonical = Map::new();
            for key in keys {
                canonical.insert(key.clone(), canonical_json(&object[key]));
            }
            Value::Object(canonical)
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical_json).collect()),
        _ => value.clone(),
    }
}

pub(super) fn input_digest(value: &Value) -> String {
    let bytes = serde_json::to_vec(&canonical_json(value)).unwrap_or_default();
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) fn contains_approval_claim(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            let normalized = key
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect::<String>();
            matches!(
                normalized.as_str(),
                "approved" | "approval" | "approvallease" | "approvaltoken" | "isapproved"
            ) || contains_approval_claim(value)
        }),
        Value::Array(values) => values.iter().any(contains_approval_claim),
        _ => false,
    }
}

pub(super) fn normalized_digest(value: &str) -> String {
    value
        .trim()
        .strip_prefix("sha256:")
        .unwrap_or(value.trim())
        .to_ascii_lowercase()
}

pub(super) fn constant_time_text_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

pub(super) fn random_token(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    OsRng.fill_bytes(&mut value);
    BASE64_URL.encode(value)
}

pub(super) fn ensure_not_expired(deadline: i64) -> Result<()> {
    if deadline <= now_millis() {
        Err(anyhow!("agent request deadline has expired"))
    } else {
        Ok(())
    }
}

pub(super) fn expected_graph_thread_id(request: &AgentTurnRequest) -> String {
    let profile = match request.profile {
        crate::agent::protocol::AgentProfile::Chat => "chat",
        crate::agent::protocol::AgentProfile::Plan => "plan",
        crate::agent::protocol::AgentProfile::Agent => "agent",
    };
    let mut digest = Sha256::new();
    digest.update(request.project_id.as_bytes());
    digest.update(b"\0");
    digest.update(profile.as_bytes());
    digest.update(b"\0");
    digest.update(request.metadata.thread_id.as_bytes());
    format!("oxide-{}", BASE64_URL.encode(digest.finalize()))
}

pub(super) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) fn bounded_text(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}
