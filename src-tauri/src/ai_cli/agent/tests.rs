use super::{events, *};
use crate::ai_cli::CliProviderKind;
use serde_json::json;

#[test]
fn maps_codex_jsonl_without_exposing_reasoning_text() {
    let mut parser = CliAgentEventParser::new(CliProviderKind::CodexCli);
    assert_eq!(
        parser.parse(
            &json!({"type":"item.completed","item":{"type":"reasoning","text":"secret chain"}})
        ),
        vec![CliAgentEvent::Activity {
            status: "running",
            label: "Codex completed a reasoning step".to_string(),
        }]
    );
    assert_eq!(
        parser
            .parse(&json!({"type":"item.completed","item":{"type":"agent_message","text":"done"}})),
        vec![CliAgentEvent::TextDelta("done".to_string())]
    );
    assert_eq!(parser.final_text(), "done");
}

#[test]
fn maps_codex_app_server_stream_and_final_usage() {
    let mut parser = CliAgentEventParser::new(CliProviderKind::CodexCli);
    assert_eq!(
        parser.parse(&json!({
            "method":"item/agentMessage/delta",
            "params":{"delta":"hello"}
        })),
        vec![CliAgentEvent::TextDelta("hello".to_string())]
    );
    assert!(parser
        .parse(&json!({
            "method":"thread/tokenUsage/updated",
            "params":{"tokenUsage":{"last":{"inputTokens":21,"outputTokens":8}}}
        }))
        .is_empty());
    assert_eq!(
        parser.parse(&json!({
            "method":"turn/completed",
            "params":{"turn":{"status":"completed"}}
        })),
        vec![
            CliAgentEvent::Usage {
                input_tokens: 21,
                output_tokens: 8,
            },
            CliAgentEvent::End,
        ]
    );
    assert_eq!(parser.final_text(), "hello");
}

#[test]
fn codex_plan_uses_authoritative_completed_item() {
    let mut parser = CliAgentEventParser::new(CliProviderKind::CodexCli);
    parser.parse(&json!({"method":"item/agentMessage/delta","params":{"delta":"Checking data."}}));
    assert!(parser
        .parse(&json!({"method":"item/plan/delta","params":{"itemId":"p1","delta":"draft"}}))
        .is_empty());
    assert_eq!(parser.parse(&json!({"method":"item/completed","params":{"item":{"type":"plan","id":"p1","text":"# Verified plan"}}})), vec![CliAgentEvent::TextDelta("\n\n# Verified plan".to_string())]);
    assert_eq!(parser.final_text(), "Checking data.\n\n# Verified plan");
}

#[test]
fn maps_codebuddy_tool_lifecycle_and_usage() {
    let mut parser = CliAgentEventParser::new(CliProviderKind::CodebuddyCli);
    let started = parser.parse(&json!({
            "type":"assistant",
            "message":{"content":[{"type":"tool_use","id":"c1","name":"mcp__oxide__query.runReadOnly","input":{}}]}
        }));
    assert!(
        matches!(started.first(), Some(CliAgentEvent::ToolStarted { tool_name, .. }) if tool_name == "query.runReadOnly")
    );
    let finished = parser.parse(&json!({
        "type":"user",
        "message":{"content":[{"type":"tool_result","tool_use_id":"c1","content":"ok"}]}
    }));
    assert!(matches!(
        finished.first(),
        Some(CliAgentEvent::ToolFinished { success: true, .. })
    ));
    let result = parser.parse(&json!({
        "type":"result",
        "subtype":"success",
        "usage":{"input_tokens":12,"output_tokens":7}
    }));
    assert_eq!(
        result,
        vec![
            CliAgentEvent::Usage {
                input_tokens: 12,
                output_tokens: 7
            },
            CliAgentEvent::End,
        ]
    );
}

#[test]
fn maps_codebuddy_normalized_tool_names_from_the_turn_manifest() {
    for name in [
        "workspace.getActiveTab",
        "query.runReadOnly",
        "query.executeApproved",
    ] {
        let mut parser = CliAgentEventParser::new(CliProviderKind::CodebuddyCli)
            .with_tool_names([name.to_string()]);
        let started = parser.parse(&json!({
            "type":"assistant",
            "message":{"content":[{"type":"tool_use","id":"call-1",
                "name":format!("mcp__oxide__{}", name.replace('.', "_")),"input":{}}]}
        }));
        assert_eq!(
            started,
            vec![CliAgentEvent::ToolStarted {
                call_id: "call-1".to_string(),
                tool_name: name.to_string(),
            }]
        );
        assert_eq!(
            parser.has_pending_mutation(),
            name == "query.executeApproved"
        );
        let finished = parser.parse(&json!({
            "type":"user",
            "message":{"content":[{"type":"tool_result","tool_use_id":"call-1",
                "content":"ok","is_error":false}]}
        }));
        assert_eq!(
            finished,
            vec![CliAgentEvent::ToolFinished {
                call_id: "call-1".to_string(),
                tool_name: name.to_string(),
                success: true,
                detail: None,
            }]
        );
        assert!(!parser.has_pending_mutation());
    }
    let mut parser = CliAgentEventParser::new(CliProviderKind::CodebuddyCli)
        .with_tool_names(["workspace.getActiveTab".to_string()]);
    let events = parser.parse(&json!({"type":"assistant","message":{"content":[{
        "type":"tool_use","id":"unknown","name":"mcp__oxide__custom_tool_name","input":{}
    }]}}));
    assert!(
        matches!(events.first(), Some(CliAgentEvent::ToolStarted { tool_name, .. })
        if tool_name == "custom_tool_name")
    );
}

#[test]
fn preserves_codebuddy_model_entitlement_errors_from_string_arrays() {
    let mut parser = CliAgentEventParser::new(CliProviderKind::CodebuddyCli);
    let message = "400 model [gpt-5.4] is not allowed for user type [personal_free_user]";
    let events = parser.parse(&json!({
        "type":"result", "subtype":"error_during_execution", "is_error":true,
        "errors":[message]
    }));
    assert!(matches!(events.as_slice(), [CliAgentEvent::Error(error)] if error.message == message));
    assert!(parser.saw_terminal());
    assert!(parser.saw_error());
    let events = parser.parse(&json!({"type":"error","error":"upstream unavailable"}));
    assert!(matches!(events.as_slice(), [CliAgentEvent::Error(error)]
        if error.message == "upstream unavailable"));
}

#[test]
fn classifies_authentication_and_mcp_failures() {
    assert_eq!(
        classify_cli_error(
            CliProviderKind::CodexCli,
            "Not authenticated; run codex login"
        )
        .code,
        "cli_authentication_required"
    );
    assert_eq!(
        classify_cli_error(CliProviderKind::CodebuddyCli, "MCP server failed to start").code,
        "cli_mcp_startup_failed"
    );
}

#[test]
fn distinguishes_success_receipts_from_unknown_mutations() {
    assert!(!events::requires_manual_verification(
        &json!({"mutationReceipt":{"completed":true,"manualVerificationRequired":false}})
    ));
    assert!(events::requires_manual_verification(
        &json!({"error":{"kind":"mutation_result_unknown","manualVerificationRequired":true}})
    ));
}
