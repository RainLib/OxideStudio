use super::*;
use serde_json::json;
use std::collections::HashMap;
use std::io::ErrorKind;
use tokio::io::{duplex, BufReader};

#[tokio::test]
async fn content_length_frame_round_trips_json() {
    let (mut client, server) = duplex(4096);
    let mut reader = BufReader::new(server);
    let expected = json!({"jsonrpc":"2.0","id":1,"result":{"ok":true}});

    let write = tokio::spawn(async move {
        write_json_frame(&mut client, &expected).await.unwrap();
        expected
    });
    let actual = read_json_frame(&mut reader).await.unwrap().unwrap();
    assert_eq!(actual, write.await.unwrap());
}

#[tokio::test]
async fn rejects_frames_larger_than_four_mebibytes_before_allocating_payload() {
    let input = format!("Content-Length: {}\r\n\r\n", AGENT_HOST_MAX_FRAME_BYTES + 1);
    let mut reader = BufReader::new(input.as_bytes());
    let error = read_json_frame(&mut reader).await.unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidData);
}

#[tokio::test]
async fn rejects_ambiguous_duplicate_content_length_headers() {
    let input = b"Content-Length: 2\r\nContent-Length: 3\r\n\r\n{}";
    let mut reader = BufReader::new(input.as_slice());
    let error = read_json_frame(&mut reader).await.unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidData);
}

#[test]
fn model_stream_request_flattens_metadata_and_echoes_stream_id() {
    let request: ModelStreamRequest = serde_json::from_value(json!({
        "requestId":"request:model:1",
        "threadId":"thread",
        "turnId":"turn",
        "contextVersion":"ctx",
        "deadline":123,
        "streamId":"stream-1",
        "messages":[{"role":"user","content":"hello"}],
        "tools":[]
    }))
    .unwrap();
    assert_eq!(request.stream_id, "stream-1");
    assert_eq!(request.request.metadata.request_id, "request:model:1");
    assert_eq!(request.request.metadata.context_version, "ctx");
}

#[test]
fn full_access_requires_codex_agent_mode_and_ultra_reasoning() {
    let mut request = codex_full_access_request();
    assert!(request.validate().is_ok());

    request.profile = AgentProfile::Plan;
    assert_eq!(
        request.validate().unwrap_err(),
        "Full access requires Agent mode with Ultra reasoning"
    );

    request.profile = AgentProfile::Agent;
    request.provider.reasoning_effort = Some("high".to_string());
    assert_eq!(
        request.validate().unwrap_err(),
        "Full access requires Agent mode with Ultra reasoning"
    );

    request.provider.reasoning_effort = Some("ultra".to_string());
    request.provider.kind = AgentProviderKind::CodebuddyCli;
    assert_eq!(
        request.validate().unwrap_err(),
        "Full access is only supported by Codex CLI"
    );
}

fn codex_full_access_request() -> AgentTurnRequest {
    AgentTurnRequest {
        metadata: RequestMetadata {
            request_id: "request".to_string(),
            thread_id: "thread".to_string(),
            turn_id: "turn".to_string(),
            context_version: "ctx".to_string(),
            deadline: 1,
        },
        project_id: "project".to_string(),
        profile: AgentProfile::Agent,
        messages: Vec::new(),
        prompt: "edit the project".to_string(),
        provider: AgentProviderConfig {
            kind: AgentProviderKind::CodexCli,
            base_url: String::new(),
            api_key: None,
            model: "gpt-test".to_string(),
            timeout_ms: None,
            capabilities: ProviderCapabilities {
                streaming: true,
                tool_calling: true,
                structured_output: true,
                max_input_tokens: None,
                max_output_tokens: None,
            },
            profile_id: Some("codex-cli-default".to_string()),
            executable_path: None,
            reasoning_effort: Some("ultra".to_string()),
            service_tier: None,
            access_mode: Some("full".to_string()),
            environment_keys: Vec::new(),
            custom_headers: Default::default(),
        },
        workspace: WorkspaceContext {
            project_id: "project".to_string(),
            connection_id: None,
            database: None,
            namespace: None,
            active_tab_id: None,
            config_revision: None,
            fingerprint: "fingerprint".to_string(),
            summary: HashMap::new(),
        },
        tools: Vec::new(),
        resume_checkpoint: None,
    }
}

#[test]
fn sidecar_params_do_not_include_provider_secrets() {
    let request = AgentTurnRequest {
        metadata: RequestMetadata {
            request_id: "request".to_string(),
            thread_id: "thread".to_string(),
            turn_id: "turn".to_string(),
            context_version: "ctx".to_string(),
            deadline: 1,
        },
        project_id: "project".to_string(),
        profile: AgentProfile::Agent,
        messages: vec![],
        prompt: "hello".to_string(),
        provider: AgentProviderConfig {
            kind: AgentProviderKind::OpenaiCompatible,
            base_url: "https://example.com/v1".to_string(),
            api_key: Some("super-secret".to_string()),
            model: "model".to_string(),
            timeout_ms: None,
            capabilities: ProviderCapabilities {
                streaming: false,
                tool_calling: true,
                structured_output: true,
                max_input_tokens: None,
                max_output_tokens: None,
            },
            profile_id: None,
            executable_path: None,
            reasoning_effort: None,
            service_tier: None,
            access_mode: None,
            environment_keys: Vec::new(),
            custom_headers: std::collections::BTreeMap::from([(
                "Authorization".to_string(),
                "Bearer gateway-secret".to_string(),
            )]),
        },
        workspace: WorkspaceContext {
            project_id: "project".to_string(),
            connection_id: None,
            database: None,
            namespace: None,
            active_tab_id: None,
            config_revision: None,
            fingerprint: "fingerprint".to_string(),
            summary: HashMap::new(),
        },
        tools: vec![AgentToolManifestEntry {
            name: "metadata.listObjects".to_string(),
            description: "List objects".to_string(),
            input_schema: json!({"type":"object"}),
            permissions: vec!["read".to_string()],
            timeout_ms: None,
            result_limit: None,
        }],
        resume_checkpoint: None,
    };
    let params = request.sidecar_params();
    let serialized = params.to_string();
    assert!(!serialized.contains("super-secret"));
    assert!(!serialized.contains("gateway-secret"));
    assert!(!serialized.contains("baseUrl"));
    let tool = params["tools"][0].as_object().unwrap();
    assert!(!tool.contains_key("timeoutMs"));
    assert!(!tool.contains_key("resultLimit"));

    let resumable = request.resumable_value();
    let resumable_serialized = resumable.to_string();
    assert_eq!(
        resumable["provider"]["baseUrl"],
        json!("https://example.com/v1")
    );
    assert!(!resumable_serialized.contains("super-secret"));
    assert!(!resumable_serialized.contains("gateway-secret"));
    assert!(resumable["provider"].get("apiKey").is_none());
}

#[test]
fn renderer_cannot_inject_provider_header_values() {
    let provider: AgentProviderConfig = serde_json::from_value(json!({
        "kind": "openai-compatible",
        "baseUrl": "https://example.test/v1",
        "apiKey": null,
        "model": "model",
        "timeoutMs": 30000,
        "capabilities": {
            "streaming": true,
            "toolCalling": true,
            "structuredOutput": true,
            "maxInputTokens": null,
            "maxOutputTokens": null
        },
        "customHeaders": {
            "Authorization": "Bearer renderer-injected"
        }
    }))
    .unwrap();

    assert!(provider.custom_headers.is_empty());
    assert!(!format!("{provider:?}").contains("renderer-injected"));
}
