use super::approved_query_review::{
    read_only_transaction_script, resolve_prompt_connection, review_approved_query_input,
};
use super::artifact_helpers::{
    artifact_export_file_name, artifact_text_range, search_artifact_text,
};
use super::checkpoint_helpers::sidecar_resumed;
use super::connection_config::connection_url_from_config;
use super::conversation_helpers::{
    conversation_belongs_to_scope, conversation_snapshot_store_key, conversation_summary_title,
    validate_conversation_id, CONVERSATION_SNAPSHOT_THREAD_ID,
};
use super::event_projection::{
    bounded_tool_citation_preview, trusted_project_file_change_event, valid_agent_event_shape,
};
use super::identity_helpers::{canonical_json, contains_approval_claim, input_digest, now_millis};
use super::metrics_helpers::apply_context_metrics_update;
use super::metrics_types::ContextMetricsUpdate;
use super::native_read_only::validate_native_read_only_query;
use super::process_helpers::{sanitize_log_line, validate_handshake};
use super::query_result::{tool_requires_approval, truncate_query_rows};
use super::tool_manifest::{
    installed_host_tool_names, validate_host_tool_manifest, RustHostTool, REQUIRED_CAPABILITIES,
};
use super::turn_state::{
    AgentEventDeltaBatch, AGENT_DELTA_EMIT_INTERVAL, MAX_AGENT_DELTA_BATCH_BYTES,
};
use crate::agent::protocol::AgentContextCompactionMetrics;
use crate::agent::protocol::AgentContextMetrics;
use crate::agent::protocol::AgentModelUsageMetrics;
use crate::agent::protocol::AgentProfile;
use crate::agent::protocol::AgentToolManifestEntry;
use crate::agent::protocol::RequestMetadata;
use crate::agent::protocol::ToolInvokeRequest;
use crate::agent::protocol::AGENT_HOST_MAX_FRAME_BYTES;
use crate::agent::protocol::AGENT_HOST_PROTOCOL_VERSION;
use crate::core::config::SavedConnection as ConfigSavedConnection;
use crate::core::dialect::database_capabilities_for_driver;
use crate::core::dialect::DatabaseKind;
use crate::core::protocol::QueryResult;
use crate::core::statement::StatementScanDialect;
use crate::core::store::SavedConnection as StoreSavedConnection;
use serde_json::json;
use serde_json::Value;
use std::time::Duration;
use std::time::Instant;

#[test]
fn provider_conversation_snapshots_use_distinct_validated_store_keys() {
    assert_eq!(
        conversation_snapshot_store_key(None),
        CONVERSATION_SNAPSHOT_THREAD_ID
    );
    assert_ne!(
        conversation_snapshot_store_key(Some("provider:codex-cli")),
        conversation_snapshot_store_key(Some("provider:codebuddy-cli"))
    );
    assert!(validate_conversation_id(Some("provider:codex-cli")).is_ok());
    assert!(validate_conversation_id(Some("../../other-session")).is_err());
    assert!(conversation_belongs_to_scope(
        "provider:codex-cli:chat:abc",
        "provider:codex-cli"
    ));
    assert!(!conversation_belongs_to_scope(
        "provider:codex-cli-other:chat:abc",
        "provider:codex-cli"
    ));
    assert_eq!(
        conversation_summary_title("  Explain   why this query is slow and suggest a safe index  "),
        "Explain why this query is slow and suggest a safe index"
    );
}

fn tool_manifest(name: &str) -> AgentToolManifestEntry {
    let permissions = RustHostTool::from_name(name)
        .map(|tool| {
            tool.permissions()
                .iter()
                .map(|permission| (*permission).to_string())
                .collect()
        })
        .unwrap_or_else(|| vec!["read".to_string()]);
    AgentToolManifestEntry {
        name: name.to_string(),
        description: "test tool".to_string(),
        input_schema: json!({"type":"object"}),
        permissions,
        timeout_ms: None,
        result_limit: None,
    }
}

fn stored_connection(id: &str, name: &str, driver: &str) -> StoreSavedConnection {
    StoreSavedConnection {
        id: id.to_string(),
        project_id: "project".to_string(),
        name: name.to_string(),
        driver: driver.to_string(),
        config: json!({}),
        created_at: 1,
        updated_at: 1,
    }
}

#[test]
fn canonical_digest_is_stable_across_object_key_order() {
    let first = json!({"b":2,"a":{"z":1,"x":0}});
    let second = json!({"a":{"x":0,"z":1},"b":2});
    assert_eq!(input_digest(&first), input_digest(&second));
    assert_eq!(input_digest(&first).len(), 64);
}

#[test]
fn reviewable_project_writes_bypass_preapproval_without_weakening_other_mutations() {
    assert!(!tool_requires_approval(
        "project.writeFile",
        &["write".to_string()]
    ));
    assert!(tool_requires_approval(
        "database.mutate",
        &["write".to_string()]
    ));
    assert!(tool_requires_approval(
        "project.writeFile",
        &["destructive".to_string()]
    ));
    assert!(!tool_requires_approval(
        "project.readFile",
        &["read".to_string()]
    ));
}

#[test]
fn installed_tool_catalog_and_manifest_validation_share_one_dispatch_enum() {
    let advertised = installed_host_tool_names();
    assert_eq!(advertised.len(), RustHostTool::ALL.len());
    assert!(advertised.windows(2).all(|pair| pair[0] != pair[1]));
    assert!(advertised
        .iter()
        .all(|name| RustHostTool::from_name(name).is_some()));

    let supported = advertised
        .iter()
        .map(|name| tool_manifest(name))
        .collect::<Vec<_>>();
    assert!(validate_host_tool_manifest(AgentProfile::Agent, &supported).is_ok());
    assert!(validate_host_tool_manifest(
        AgentProfile::Agent,
        &[tool_manifest("editor.proposePatch")]
    )
    .is_err());

    let mut downgraded_write = tool_manifest("project.writeFile");
    downgraded_write.permissions = vec!["read".to_string()];
    assert!(validate_host_tool_manifest(AgentProfile::Agent, &[downgraded_write]).is_err());
    assert!(validate_host_tool_manifest(
        AgentProfile::Chat,
        &[tool_manifest("workspace.getActiveTab")]
    )
    .is_ok());
    assert!(
        validate_host_tool_manifest(AgentProfile::Chat, &[tool_manifest("query.runReadOnly")])
            .is_err()
    );
    assert!(
        validate_host_tool_manifest(AgentProfile::Plan, &[tool_manifest("project.writeFile")])
            .is_err()
    );
}

#[test]
fn canonical_digest_matches_cross_language_unicode_fixture() {
    let fixture = json!({"😀":1,"中":2,"é":3,"a":4});
    assert_eq!(
        serde_json::to_string(&canonical_json(&fixture)).unwrap(),
        r#"{"a":4,"é":3,"中":2,"😀":1}"#
    );
    assert_eq!(
        input_digest(&fixture),
        "2d2372dac0fb37d70eedcaf38ba9a540481b2684d280a7ab2aefbd01911d2de9"
    );
}

#[test]
fn prompt_selects_a_unique_connection_by_driver_alias_or_name() {
    let connections = vec![
        stored_connection("es-1", "New Elasticsearch Connection", "elasticsearch"),
        stored_connection("mongo-1", "New MongoDB Connection", "mongodb"),
        stored_connection("mysql-1", "Pkulaw-test", "mysql"),
        stored_connection("sqlite-1", "Local analytics", "sqlite"),
    ];

    assert_eq!(
        resolve_prompt_connection(&connections, "查看我 es 中有哪些表")
            .map(|connection| connection.id.as_str()),
        Some("es-1")
    );
    assert_eq!(
        resolve_prompt_connection(&connections, "查看我MongoDB中的集合")
            .map(|connection| connection.id.as_str()),
        Some("mongo-1")
    );
    assert_eq!(
        resolve_prompt_connection(&connections, "查询 Pkulaw-test")
            .map(|connection| connection.id.as_str()),
        Some("mysql-1")
    );
    assert_eq!(
        resolve_prompt_connection(&connections, "查询 SQLite 本地库中的 entries")
            .map(|connection| connection.id.as_str()),
        Some("sqlite-1")
    );
}

#[test]
fn prompt_does_not_guess_when_a_driver_has_multiple_connections() {
    let connections = vec![
        stored_connection("es-1", "Elasticsearch One", "elasticsearch"),
        stored_connection("es-2", "Elasticsearch Two", "elasticsearch"),
        stored_connection("mysql-1", "MySQL", "mysql"),
    ];

    assert!(resolve_prompt_connection(&connections, "查看 ES 中的索引").is_none());
    assert!(resolve_prompt_connection(&connections, "比较 ES 和 MySQL").is_none());
    assert!(resolve_prompt_connection(&connections, "有哪些数据库").is_none());
}

#[test]
fn native_read_only_gate_accepts_elasticsearch_search_syntax() {
    for query in [
        r#"{"query":{"match_all":{}},"size":5}"#,
        "POST articles/_search\n{\"query\":{\"match\":{\"title\":\"rust\"}}}",
        "POST /articles/_count\n{\"query\":{\"term\":{\"published\":true}}}",
        "GET /articles/_mapping",
        "POST /articles/_field_caps\n{\"fields\":[\"title\"]}",
        "POST /articles/_terms_enum\n{\"field\":\"tags\"}",
        "POST /articles/_validate/query\n{\"query\":{\"match_all\":{}}}",
        "POST /articles/_explain/42\n{\"query\":{\"match_all\":{}}}",
        "POST /articles/_rank_eval\n{\"requests\":[]}",
        "POST /articles/_search_shards",
        "OPTIONS /articles/_search",
        "/* POST /articles/_delete_by_query */\n// DELETE /articles\nPOST /articles/_search\n{}",
    ] {
        assert!(
            validate_native_read_only_query("elasticsearch", query).is_ok(),
            "{query}"
        );
    }
}

#[test]
fn native_read_only_gate_rejects_elasticsearch_mutations() {
    for query in [
        "DELETE /articles/_doc/1",
        "PUT /articles/_doc/1\n{\"title\":\"changed\"}",
        "POST /_bulk\n{\"delete\":{\"_index\":\"articles\",\"_id\":\"1\"}}",
        "POST /articles/_delete_by_query\n{\"query\":{\"match_all\":{}}}",
    ] {
        assert!(
            validate_native_read_only_query("elasticsearch", query).is_err(),
            "{query}"
        );
    }
}

#[test]
fn native_read_only_gate_preserves_mongodb_and_redis_safety() {
    assert!(validate_native_read_only_query(
        "mongodb",
        r#"{"collection":"users","find":{"active":true},"limit":5}"#
    )
    .is_ok());
    assert!(validate_native_read_only_query(
        "mongodb",
        r#"{"find":"users","filter":{"active":true},"limit":5}"#
    )
    .is_ok());
    assert!(validate_native_read_only_query(
        "mongodb",
        r#"{"aggregate":"users","pipeline":[{"$match":{"active":true}}],"cursor":{}}"#
    )
    .is_ok());
    assert!(validate_native_read_only_query(
        "mongodb",
        r#"{"count":"users","query":{"active":true}}"#
    )
    .is_ok());
    assert!(validate_native_read_only_query(
        "mongodb",
        r#"{"collection":"users","aggregate":[{"$match":{"active":true}},{"$out":"copy"}]}"#
    )
    .is_err());
    assert!(validate_native_read_only_query(
        "mongodb",
        r#"{"aggregate":"users","pipeline":[{"$match":{"active":true}},{"$merge":"copy"}],"cursor":{}}"#
    )
    .is_err());
    assert!(validate_native_read_only_query("mongodb", r#"{"find":"users","filter":[]}"#).is_err());
    assert!(validate_native_read_only_query("redis", "GET user:1\nTTL user:1").is_ok());
    assert!(validate_native_read_only_query("redis", "DEL user:1").is_err());
}

#[test]
fn native_read_only_gate_allows_only_exact_new_key_value_previews() {
    for driver in ["etcd", "consul"] {
        assert!(validate_native_read_only_query(driver, r#"GET "app/config""#).is_ok());
        assert!(validate_native_read_only_query(driver, "GET app/config").is_err());
        assert!(validate_native_read_only_query(driver, r#"GET """#).is_err());
        assert!(validate_native_read_only_query(driver, r#"GET "app"\nGET "other""#).is_err());
    }
    assert!(validate_native_read_only_query(
        "nacos",
        r#"GET {"dataId":"app.yaml","group":"DEFAULT_GROUP","tenant":"prod"}"#,
    )
    .is_ok());
    assert!(validate_native_read_only_query(
        "nacos",
        r#"GET {"dataId":"app.yaml","group":"DEFAULT_GROUP"}"#,
    )
    .is_err());
    assert!(validate_native_read_only_query(
        "nacos",
        r#"GET {"dataId":"app.yaml","group":"","tenant":"prod"}"#,
    )
    .is_err());
    assert!(validate_native_read_only_query("nacos", "POST /v1/cs/configs").is_err());
}

#[test]
fn handshake_requires_protocol_runtime_and_capabilities() {
    let valid = json!({
        "protocolVersion": AGENT_HOST_PROTOCOL_VERSION,
        "runtime": "deepagents-typescript",
        "runtimeVersion": "1.0.0",
        "nodeVersion": "22.0.0",
        "maxFrameBytes": AGENT_HOST_MAX_FRAME_BYTES,
        "capabilities": REQUIRED_CAPABILITIES,
    });
    assert!(validate_handshake(valid).is_ok());
    let invalid = json!({
        "protocolVersion": 2,
        "runtime": "deepagents-typescript",
        "runtimeVersion": "1.0.0",
        "nodeVersion": "22.0.0",
        "maxFrameBytes": AGENT_HOST_MAX_FRAME_BYTES,
        "capabilities": REQUIRED_CAPABILITIES,
    });
    assert!(validate_handshake(invalid).is_err());
}

#[test]
fn sidecar_log_sanitizer_redacts_likely_credentials() {
    assert_eq!(
        sanitize_log_line("Authorization: Bearer secret"),
        "<redacted sidecar diagnostic>"
    );
    assert_eq!(sanitize_log_line("host ready\n"), "host ready");
}

#[test]
fn answer_delta_event_requires_content_and_boolean_reset() {
    let valid = json!({"content":"partial answer","reset":false});
    assert!(valid_agent_event_shape(
        "answer.delta",
        valid.as_object().unwrap()
    ));
    let invalid = json!({"content":"partial answer","reset":"false"});
    assert!(!valid_agent_event_shape(
        "answer.delta",
        invalid.as_object().unwrap()
    ));
    assert!(!valid_agent_event_shape(
        "unknown.event",
        valid.as_object().unwrap()
    ));
}

#[test]
fn answer_delta_batch_coalesces_by_interval_and_keeps_latest_sequence() {
    let started_at = Instant::now();
    let mut batch = AgentEventDeltaBatch::default();
    let event = |sequence: u64, content: &str, reset: bool| {
        json!({
            "type":"answer.delta",
            "threadId":"thread-1",
            "turnId":"turn-1",
            "sequence":sequence,
            "occurredAt":sequence as i64,
            "content":content,
            "reset":reset,
        })
    };

    assert_eq!(
        batch
            .push(event(1, "a", false), started_at)
            .and_then(|value| value.get("content").cloned()),
        Some(json!("a"))
    );
    assert!(batch
        .push(event(2, "b", false), started_at + Duration::from_millis(10))
        .is_none());
    let emitted = batch
        .push(event(3, "c", false), started_at + AGENT_DELTA_EMIT_INTERVAL)
        .unwrap();
    assert_eq!(emitted.get("content"), Some(&json!("bc")));
    assert_eq!(emitted.get("sequence"), Some(&json!(3)));
    assert_eq!(emitted.get("occurredAt"), Some(&json!(3)));
    assert_eq!(emitted.get("reset"), Some(&json!(false)));
}

#[test]
fn answer_delta_batch_preserves_reset_semantics_and_flushes_tail() {
    let started_at = Instant::now();
    let mut batch = AgentEventDeltaBatch::default();
    let event = |sequence: u64, content: &str, reset: bool| {
        json!({
            "type":"answer.delta",
            "threadId":"thread-1",
            "turnId":"turn-1",
            "sequence":sequence,
            "occurredAt":sequence as i64,
            "content":content,
            "reset":reset,
        })
    };
    assert!(batch.push(event(1, "visible", false), started_at).is_some());
    assert!(batch
        .push(
            event(2, " discarded", false),
            started_at + Duration::from_millis(10)
        )
        .is_none());
    assert!(batch
        .push(
            event(3, "replacement", true),
            started_at + Duration::from_millis(20)
        )
        .is_none());
    assert!(batch
        .push(
            event(4, " tail", false),
            started_at + Duration::from_millis(30)
        )
        .is_none());

    let emitted = batch.flush(started_at + Duration::from_millis(40)).unwrap();
    assert_eq!(emitted.get("content"), Some(&json!("replacement tail")));
    assert_eq!(emitted.get("reset"), Some(&json!(true)));
    assert_eq!(emitted.get("sequence"), Some(&json!(4)));
    assert!(batch
        .flush(started_at + Duration::from_millis(50))
        .is_none());
}

#[test]
fn answer_delta_batch_flushes_at_the_byte_boundary() {
    let started_at = Instant::now();
    let mut batch = AgentEventDeltaBatch::default();
    let base = json!({
        "type":"answer.delta",
        "threadId":"thread-1",
        "turnId":"turn-1",
        "sequence":1,
        "occurredAt":1,
        "content":"seed",
        "reset":false,
    });
    assert!(batch.push(base, started_at).is_some());
    let bounded = json!({
        "type":"answer.delta",
        "threadId":"thread-1",
        "turnId":"turn-1",
        "sequence":2,
        "occurredAt":2,
        "content":"x".repeat(MAX_AGENT_DELTA_BATCH_BYTES),
        "reset":false,
    });
    let emitted = batch
        .push(bounded, started_at + Duration::from_millis(1))
        .unwrap();
    assert_eq!(
        emitted.get("content").and_then(Value::as_str).map(str::len),
        Some(MAX_AGENT_DELTA_BATCH_BYTES)
    );
}

#[test]
fn tool_activity_accepts_only_safe_project_relative_paths() {
    let valid = json!({
        "callId": "call-read",
        "toolName": "project.readFile",
        "label": "Read project file",
        "relativePath": "sql/reports/daily.sql"
    });
    assert!(valid_agent_event_shape(
        "tool.started",
        valid.as_object().unwrap()
    ));

    let traversal = json!({
        "callId": "call-read",
        "toolName": "project.readFile",
        "label": "Read project file",
        "relativePath": "../outside.sql"
    });
    assert!(!valid_agent_event_shape(
        "tool.started",
        traversal.as_object().unwrap()
    ));
}

#[test]
fn final_answer_citations_require_stable_navigation_targets() {
    let valid = json!({
        "content": "users exists [1].",
        "artifacts": [],
        "citations": [{
            "id": "cite-object-users",
            "kind": "databaseObject",
            "label": "users",
            "detail": "app.public.users",
            "toolName": "metadata.describeObject",
            "projectId": "project",
            "connectionId": "postgres-1",
            "databaseName": "app",
            "schemaName": "public",
            "objectName": "users",
            "objectType": "table"
        }]
    });
    assert!(valid_agent_event_shape(
        "final.answer",
        valid.as_object().unwrap()
    ));

    let invalid = json!({
        "content": "missing target",
        "citations": [{
            "id": "cite-invalid",
            "kind": "planNode",
            "label": "Plan",
            "toolName": "query.explain",
            "projectId": "project",
            "planId": "plan-1"
        }]
    });
    assert!(!valid_agent_event_shape(
        "final.answer",
        invalid.as_object().unwrap()
    ));
}

#[test]
fn offloaded_metadata_and_plan_results_keep_only_navigation_identity() {
    let metadata = json!([{
        "name": "users",
        "namespace": "public",
        "kind": "relation",
        "type": "table",
        "comment": "must not cross the compact citation boundary"
    }]);
    assert_eq!(
        bounded_tool_citation_preview("metadata.listObjects", &metadata),
        Some(json!([{
            "name": "users",
            "namespace": "public",
            "kind": "relation",
            "type": "table"
        }]))
    );

    let plan = json!({
        "id": "plan-1",
        "driver": "postgres",
        "mode": "estimate",
        "rawPlan": {"secretlyLarge": [1, 2, 3]},
        "root": {
            "id": "plan-1:root",
            "nodeType": "Seq Scan",
            "relation": "users",
            "condition": "email = 'sensitive@example.test'"
        }
    });
    assert_eq!(
        bounded_tool_citation_preview("query.explain", &plan),
        Some(json!({
            "id": "plan-1",
            "driver": "postgres",
            "mode": "estimate",
            "root": {
                "id": "plan-1:root",
                "nodeType": "Seq Scan",
                "relation": "users"
            }
        }))
    );

    let active_tab = json!({
        "id": "query-1",
        "type": "query",
        "title": "Revenue query",
        "sql": "SELECT secret_column FROM revenue",
        "explainPlan": {
            "id": "plan-runtime-1",
            "driver": "postgres",
            "mode": "analyze",
            "rootNodeId": "node-0",
            "executionTimeMs": 18.5,
            "truncated": false,
            "nodes": [{
                "id": "node-0",
                "nodeType": "Index Scan",
                "relation": "revenue",
                "actualTotalTimeMs": 17.2,
                "actualRows": 42,
                "condition": "tenant_id = 'sensitive'"
            }],
            "rawPlan": {"mustNotCross": true}
        }
    });
    assert_eq!(
        bounded_tool_citation_preview("workspace.getActiveTab", &active_tab),
        Some(json!({
            "id": "query-1",
            "type": "query",
            "title": "Revenue query",
            "explainPlan": {
                "id": "plan-runtime-1",
                "driver": "postgres",
                "mode": "analyze",
                "rootNodeId": "node-0",
                "executionTimeMs": 18.5,
                "truncated": false,
                "nodes": [{
                    "id": "node-0",
                    "nodeType": "Index Scan",
                    "relation": "revenue",
                    "actualTotalTimeMs": 17.2,
                    "actualRows": 42
                }]
            }
        }))
    );
}

#[test]
fn trusted_file_change_events_include_applied_content_for_review() {
    let metadata = RequestMetadata {
        request_id: "request".to_string(),
        thread_id: "thread".to_string(),
        turn_id: "turn".to_string(),
        context_version: "context".to_string(),
        deadline: now_millis() + 10_000,
    };
    let change = crate::commands::project_files::ProjectFileAppliedChange {
        relative_path: "queries/report.sql".to_string(),
        revision: "a".repeat(64),
        previous_revision: None,
        original_content: String::new(),
        applied_content: "select 1;\nselect 2;".to_string(),
        additions: 2,
        deletions: 0,
        introduced_lines: vec![1, 2],
        line_evidence_truncated: false,
    };
    let event = trusted_project_file_change_event(&metadata, "call-1", &change, true, 4, 100);

    assert_eq!(event["type"], "file.changed");
    assert_eq!(event["relativePath"], "queries/report.sql");
    assert_eq!(event["operation"], "created");
    assert_eq!(event["revision"], "a".repeat(64));
    assert_eq!(event["previousRevision"], Value::Null);
    assert_eq!(event["originalContent"], "");
    assert_eq!(event["appliedContent"], "select 1;\nselect 2;");
    assert_eq!(event["additions"], 2);
    assert_eq!(event["deletions"], 0);
    assert_eq!(event["reviewable"], true);
    assert!(event.get("absolutePath").is_none());
    assert!(!valid_agent_event_shape(
        "file.changed",
        event.as_object().unwrap()
    ));
}

#[test]
fn model_usage_event_requires_positive_calls_and_nonnegative_tokens() {
    let valid = json!({
        "calls": 2,
        "inputTokens": 1200,
        "outputTokens": 300,
        "totalTokens": 1500
    });
    assert!(valid_agent_event_shape(
        "model.usage",
        valid.as_object().unwrap()
    ));
    let zero_calls = json!({
        "calls": 0,
        "inputTokens": 1200,
        "outputTokens": 300,
        "totalTokens": 1500
    });
    assert!(!valid_agent_event_shape(
        "model.usage",
        zero_calls.as_object().unwrap()
    ));
}

#[test]
fn context_metrics_accumulate_without_losing_the_latest_compaction() {
    let mut metrics = AgentContextMetrics {
        project_id: "project".to_string(),
        ..AgentContextMetrics::default()
    };
    apply_context_metrics_update(
        &mut metrics,
        ContextMetricsUpdate::Compaction {
            input_tokens: 2_000,
            retained_tokens: 700,
            offloaded_artifacts: 2,
        },
        100,
    );
    apply_context_metrics_update(
        &mut metrics,
        ContextMetricsUpdate::ModelUsage {
            calls: 2,
            input_tokens: 1_200,
            output_tokens: 300,
            total_tokens: 1_500,
        },
        101,
    );
    apply_context_metrics_update(
        &mut metrics,
        ContextMetricsUpdate::Compaction {
            input_tokens: 3_000,
            retained_tokens: 900,
            offloaded_artifacts: 1,
        },
        102,
    );

    assert_eq!(
        metrics.compaction,
        Some(AgentContextCompactionMetrics {
            count: 2,
            last_input_tokens: 3_000,
            last_retained_tokens: 900,
            offloaded_artifacts: 3,
        })
    );
    assert_eq!(
        metrics.model_usage,
        Some(AgentModelUsageMetrics {
            calls: 2,
            input_tokens: 1_200,
            output_tokens: 300,
            total_tokens: 1_500,
        })
    );
    assert_eq!(metrics.updated_at, 102);
}

#[test]
fn artifact_search_is_bounded_and_keeps_utf8_snippets_valid() {
    let content = r#"{"rows":[{"name":"Alpha 中文"},{"name":"alpha"},{"name":"ALPHA"}]}"#;
    let (matches, truncated) = search_artifact_text(content, "alpha", 2, 16);
    assert_eq!(matches.len(), 2);
    assert!(truncated);
    assert_eq!(matches[0].offset, 18);
    assert!(matches.iter().all(|value| !value.snippet.is_empty()));

    let (unicode_matches, unicode_truncated) = search_artifact_text(content, "中文", 8, 16);
    assert_eq!(unicode_matches.len(), 1);
    assert!(!unicode_truncated);
    assert!(unicode_matches[0].snippet.contains("中文"));
}

#[test]
fn artifact_ranges_and_export_names_are_utf8_safe() {
    let content = "{\n  \"name\": \"Alpha 中文\",\n  \"active\": true\n}";
    let (offset, next_offset, range) = artifact_text_range(content, 17, 8);
    assert!(content.is_char_boundary(offset));
    assert!(content.is_char_boundary(next_offset));
    assert_eq!(range, &content[offset..next_offset]);
    assert_eq!(
        artifact_export_file_name(Some("../../Results 2026"), "ignored"),
        "Results-2026.json"
    );
    assert_eq!(
        artifact_export_file_name(None, "tool-result-safe"),
        "tool-result-safe.json"
    );
}

#[test]
fn hitl_resume_requires_an_explicit_true_response() {
    assert!(sidecar_resumed(&json!({"resumed": true})));
    assert!(!sidecar_resumed(&json!({"resumed": false})));
    assert!(!sidecar_resumed(&json!({})));
    assert!(!sidecar_resumed(&json!({"resumed": "true"})));
}

#[test]
fn caller_cannot_smuggle_an_approved_boolean_into_tool_request() {
    let value = json!({
        "requestId":"request",
        "threadId":"thread",
        "turnId":"turn",
        "contextVersion":"context",
        "deadline": now_millis() + 10_000,
        "callId":"call",
        "toolName":"query.runMutation",
        "input":{},
        "inputDigest":input_digest(&json!({})),
        "approved":true
    });
    // Serde ignores the field, and authorization still depends exclusively on a host lease.
    let parsed: ToolInvokeRequest = serde_json::from_value(value).unwrap();
    assert!(parsed.approval_lease.is_none());
}

#[test]
fn connection_url_builder_encodes_credentials_without_logging_them() {
    let config = ConfigSavedConnection {
        id: "connection".to_string(),
        project_id: "project".to_string(),
        name: "Postgres".to_string(),
        driver: "postgres".to_string(),
        driver_package_version: None,
        url: String::new(),
        host: Some("db.internal".to_string()),
        port: Some(5432),
        user: Some("user@example.com".to_string()),
        password: Some("p@ss/word".to_string()),
        database: Some("app data".to_string()),
        connection_url: None,
        ssl_mode: Some("require".to_string()),
        elasticsearch_mode: None,
        elasticsearch_kibana_base_path: None,
        elasticsearch_connectivity_check_path: None,
        elasticsearch_connectivity_check_disabled: false,
        index_grouping_pattern: None,
        rocket_mq: None,
        ssh_tunnel: None,
        tags: None,
        note: None,
        icon: None,
        color: None,
        environment: Default::default(),
        production_databases: Vec::new(),
    };
    let capabilities = database_capabilities_for_driver("postgres").unwrap();
    let url = connection_url_from_config(&capabilities, &config).unwrap();
    assert!(url.starts_with("postgres://user%40example.com:p%40ss%2Fword@db.internal:5432/"));
    assert!(url.contains("app%20data"));
    assert!(url.contains("sslmode=require"));
}

#[test]
fn sqlite_connection_url_uses_file_target_without_a_network_host() {
    let config = ConfigSavedConnection {
        id: "connection".to_string(),
        project_id: "project".to_string(),
        name: "SQLite".to_string(),
        driver: "sqlite".to_string(),
        driver_package_version: None,
        url: "sqlite:///tmp/workspace.db".to_string(),
        host: None,
        port: None,
        user: None,
        password: None,
        database: None,
        connection_url: None,
        ssl_mode: None,
        elasticsearch_mode: None,
        elasticsearch_kibana_base_path: None,
        elasticsearch_connectivity_check_path: None,
        elasticsearch_connectivity_check_disabled: false,
        index_grouping_pattern: None,
        rocket_mq: None,
        ssh_tunnel: None,
        tags: None,
        note: None,
        icon: None,
        color: None,
        environment: Default::default(),
        production_databases: Vec::new(),
    };
    assert_eq!(
        connection_url_from_config(
            &database_capabilities_for_driver("sqlite").unwrap(),
            &config,
        )
        .unwrap(),
        "sqlite:///tmp/workspace.db"
    );
}

#[test]
fn elasticsearch_connection_url_carries_saved_console_proxy_options() {
    let config: ConfigSavedConnection = serde_json::from_value(json!({
        "id": "elastic",
        "projectId": "project",
        "name": "Elastic",
        "driver": "elasticsearch",
        "url": "",
        "host": "elastic.internal",
        "port": 5601,
        "sslMode": "require",
        "elasticsearchMode": "kibana",
        "elasticsearchKibanaBasePath": "/kibana/s/analytics/",
        "elasticsearchConnectivityCheckPath": "GET logs-*/_search",
        "elasticsearchConnectivityCheckDisabled": true,
        "indexGroupingPattern": "[-_]\\d+"
    }))
    .unwrap();
    let capabilities = database_capabilities_for_driver("elasticsearch").unwrap();
    let value = connection_url_from_config(&capabilities, &config).unwrap();
    let url = url::Url::parse(&value).unwrap();

    assert_eq!(url.scheme(), "https");
    assert_eq!(
        url.query_pairs()
            .find(|(key, _)| key == "mode")
            .map(|(_, value)| value.into_owned()),
        Some("kibana".to_string())
    );
    assert_eq!(
        url.query_pairs()
            .find(|(key, _)| key == "kibanaBasePath")
            .map(|(_, value)| value.into_owned()),
        Some("/kibana/s/analytics".to_string())
    );
    assert_eq!(
        url.query_pairs()
            .find(|(key, _)| key == "connectivityCheckPath")
            .map(|(_, value)| value.into_owned()),
        Some("/logs-*/_search".to_string())
    );
    assert_eq!(
        url.query_pairs()
            .find(|(key, _)| key == "connectivityCheckDisabled")
            .map(|(_, value)| value.into_owned()),
        Some("true".to_string())
    );
}

#[test]
fn read_only_wrapper_and_row_limit_are_backend_enforced() {
    assert_eq!(
        read_only_transaction_script(DatabaseKind::Postgres, "SELECT 1"),
        "BEGIN READ ONLY;\nSELECT 1\n;\nROLLBACK;"
    );
    let mut results = vec![
        QueryResult::rows(vec![], vec![vec![json!(1)], vec![json!(2)]]),
        QueryResult::rows(vec![], vec![vec![json!(3)], vec![json!(4)]]),
    ];
    truncate_query_rows(&mut results, 3);
    assert_eq!(results[0].rows.len(), 2);
    assert_eq!(results[1].rows.len(), 1);
}

#[test]
fn approved_query_review_requires_one_mutation_and_blocks_transaction_control() {
    let update = review_approved_query_input(
        "postgres",
        Some(StatementScanDialect::Postgres),
        "UPDATE accounts SET active = false WHERE id = 7",
        "connection",
    )
    .unwrap();
    assert_eq!(update.operation_type, "UPDATE");
    assert!(!update.destructive);
    assert!(update.confirmation_phrase.is_none());

    let drop = review_approved_query_input(
        "postgres",
        Some(StatementScanDialect::Postgres),
        "DROP TABLE obsolete_accounts",
        "connection",
    )
    .unwrap();
    assert!(drop.destructive);
    assert_eq!(drop.confirmation_phrase.as_deref(), Some("EXECUTE DROP"));

    for forbidden in [
        "SELECT * FROM accounts",
        "BEGIN",
        "COMMIT",
        "UPDATE accounts SET active = false; DELETE FROM accounts",
    ] {
        assert!(review_approved_query_input(
            "postgres",
            Some(StatementScanDialect::Postgres),
            forbidden,
            "connection",
        )
        .is_err());
    }
}

#[test]
fn approved_native_review_rejects_batches_and_session_controls() {
    assert!(review_approved_query_input("redis", None, "SET flag 1", "redis").is_ok());
    assert!(review_approved_query_input("redis", None, "MULTI", "redis").is_err());
    assert!(review_approved_query_input("redis", None, "SET a 1; SET b 2", "redis").is_err());

    let mongo = review_approved_query_input(
        "mongodb",
        None,
        r#"{"deleteOne":{"filter":{"id":1}},"collection":"users"}"#,
        "mongo",
    )
    .unwrap();
    assert!(mongo.destructive);
    assert!(
        review_approved_query_input("mongodb", None, r#"{"commitTransaction":1}"#, "mongo",)
            .is_err()
    );

    assert!(
        review_approved_query_input("elasticsearch", None, "DELETE users/_doc/1", "elastic",)
            .unwrap()
            .destructive
    );
    assert!(review_approved_query_input(
        "elasticsearch",
        None,
        "PUT users/_doc/1\n{}\nDELETE users/_doc/2",
        "elastic",
    )
    .is_err());
}

#[test]
fn approval_fields_are_rejected_recursively() {
    assert!(contains_approval_claim(&json!({"approved":true})));
    assert!(contains_approval_claim(
        &json!({"meta":{"approvalLease":"caller"}})
    ));
    assert!(!contains_approval_claim(
        &json!({"query":"UPDATE t SET approved = true"})
    ));
}
