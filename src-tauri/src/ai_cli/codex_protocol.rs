//! Pure Codex app-server protocol adapter; process I/O belongs to runtime.
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::path::Path;

pub(super) struct CodexAppServerStep {
    pub(super) outbound: Vec<Value>,
    pub(super) event: Option<Value>,
    pub(super) completed_successfully: Option<bool>,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn codex_app_server_step(
    value: Value,
    cwd: &Path,
    prompt: &str,
    model: Option<&str>,
    effort: Option<&str>,
    service_tier: Option<&str>,
    full_access: bool,
    collaboration_mode: &str,
    thread_id: &mut Option<String>,
    turn_id: &mut Option<String>,
) -> Result<CodexAppServerStep> {
    if let Some(error) = value.get("error") {
        return Err(anyhow!("Codex app-server request failed: {error}"));
    }

    // JSON-RPC request IDs belong to each sender. A provider request may
    // reuse our initialize ID or use a string; it is never a client response.
    if let (Some(id), Some(method)) = (value.get("id"), value.get("method").and_then(Value::as_str))
    {
        let response = match method {
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
                json!({ "id": id, "result": { "decision": "decline" } })
            }
            _ => {
                json!({ "id": id, "error": { "code": -32601, "message": "This host does not support the requested interaction" } })
            }
        };
        return Ok(CodexAppServerStep {
            outbound: vec![response],
            event: None,
            completed_successfully: None,
        });
    }

    let mut outbound = Vec::new();
    match value.get("id").and_then(Value::as_u64) {
        Some(1) => {
            outbound.push(json!({ "method": "initialized" }));
            outbound.push(json!({
                "id": 2,
                "method": "thread/start",
                "params": codex_thread_start_params(cwd, model, service_tier, full_access)
            }));
        }
        Some(2) => {
            let id = value
                .pointer("/result/thread/id")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("Codex thread/start omitted its thread id"))?
                .to_string();
            *thread_id = Some(id.clone());
            outbound.push(json!({
                "id": 3,
                "method": "turn/start",
                "params": codex_turn_start_params(
                    &id,
                    prompt,
                    model,
                    effort,
                    service_tier,
                    collaboration_mode,
                    full_access,
                )
            }));
        }
        Some(3) => {
            *turn_id = value
                .pointer("/result/turn/id")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        _ => {}
    }

    let method = value.get("method").and_then(Value::as_str);
    let completed_successfully = (method == Some("turn/completed")).then(|| {
        value
            .pointer("/params/turn/status")
            .and_then(Value::as_str)
            .is_some_and(|status| status == "completed")
    });
    Ok(CodexAppServerStep {
        outbound,
        event: method.is_some().then_some(value),
        completed_successfully,
    })
}

pub(super) fn codex_thread_start_params(
    cwd: &Path,
    model: Option<&str>,
    service_tier: Option<&str>,
    full_access: bool,
) -> Value {
    let mut params = json!({
        "cwd": cwd,
        "approvalPolicy": "never",
        "sandbox": if full_access { "danger-full-access" } else { "read-only" },
        "ephemeral": true,
        "experimentalRawEvents": false
    });
    if let Some(model) = model {
        params["model"] = Value::String(model.to_string());
    }
    if let Some(service_tier) = service_tier {
        params["serviceTier"] = Value::String(service_tier.to_string());
    }
    params
}

#[allow(clippy::too_many_arguments)]
pub(super) fn codex_turn_start_params(
    thread_id: &str,
    prompt: &str,
    model: Option<&str>,
    effort: Option<&str>,
    service_tier: Option<&str>,
    collaboration_mode: &str,
    full_access: bool,
) -> Value {
    let mut params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": prompt }],
        "approvalPolicy": "never",
        "sandboxPolicy": if full_access {
            json!({ "type": "dangerFullAccess" })
        } else {
            json!({ "type": "readOnly", "networkAccess": false })
        }
    });
    if let Some(model) = model {
        params["model"] = Value::String(model.to_string());
        let mut settings = json!({ "model": model });
        if let Some(effort) = effort {
            settings["reasoning_effort"] = Value::String(effort.to_string());
        }
        params["collaborationMode"] = json!({
            "mode": collaboration_mode,
            "settings": settings
        });
    }
    if let Some(effort) = effort {
        params["effort"] = Value::String(effort.to_string());
    }
    if let Some(service_tier) = service_tier {
        params["serviceTier"] = Value::String(service_tier.to_string());
    }
    params
}

pub(super) fn codex_initialize_request() -> Value {
    json!({
        "id": 1,
        "method": "initialize",
        "params": {
            "clientInfo": {
                "name": "oxide-studio",
                "title": "OxideStudio",
                "version": env!("CARGO_PKG_VERSION")
            },
            // collaborationMode is part of Codex's negotiated experimental
            // app-server surface. Without this capability Codex accepts the
            // thread but rejects turn/start with JSON-RPC -32600.
            "capabilities": {
                "experimentalApi": true
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn server_requests_do_not_collide_with_client_response_ids() {
        for id in [json!(1), json!(2), json!(3), json!("approval-1")] {
            let mut thread = Some("thread".to_string());
            let mut turn = Some("turn".to_string());
            let step = codex_app_server_step(json!({ "id": id, "method": "item/commandExecution/requestApproval", "params": {} }), Path::new("/tmp"), "", None, None, None, false, "default", &mut thread, &mut turn).unwrap();
            assert_eq!(
                step.outbound,
                vec![json!({ "id": id, "result": { "decision": "decline" } })]
            );
            assert_eq!(thread.as_deref(), Some("thread"));
            assert_eq!(turn.as_deref(), Some("turn"));
        }
    }
    #[test]
    fn unsupported_requests_receive_protocol_error() {
        let step = codex_app_server_step(
            json!({ "id": "input", "method": "item/tool/requestUserInput" }),
            Path::new("/tmp"),
            "",
            None,
            None,
            None,
            false,
            "default",
            &mut None,
            &mut None,
        )
        .unwrap();
        assert_eq!(step.outbound[0]["error"]["code"], -32601);
    }
}
