use super::completion_parse::{
    merge_completion_item_values, parse_bounded_completion_items, parse_completion_item,
    MAX_LSP_COMPLETION_ITEMS, MAX_LSP_COMPLETION_ITEM_BYTES,
};
use super::generic::is_allowed_generic_lsp_method;
use super::session::validate_lsp_request_token;
use super::*;

#[test]
fn test_completion_request_serialization() {
    let req = CompletionRequest {
        session_key: None,
        uri: "file:///test.sql".to_string(),
        line: 10,
        character: 15,
        context: Some(CompletionContext {
            trigger_kind: 2,
            trigger_character: Some(".".to_string()),
        }),
        request_token: Some("completion-test-1".to_string()),
    };

    let json = serde_json::to_string(&req).unwrap();
    assert!(json.contains("file:///test.sql"));
    assert!(json.contains("\"triggerKind\":2"));
    assert!(json.contains("\"triggerCharacter\":\".\""));
    assert!(json.contains("\"request_token\":\"completion-test-1\""));
}

#[test]
fn validates_cancellable_request_tokens() {
    assert_eq!(
        validate_lsp_request_token(Some("completion-abc_123")).unwrap(),
        Some("completion-abc_123".to_string())
    );
    assert!(validate_lsp_request_token(Some("")).is_err());
    assert!(validate_lsp_request_token(Some("completion/token")).is_err());
    assert!(validate_lsp_request_token(Some(&"x".repeat(129))).is_err());
}

#[test]
fn parses_completion_insert_text() {
    let item = serde_json::json!({
        "label": "calculate_score",
        "labelDetails": {
            "detail": "(value numeric)",
            "description": "public"
        },
        "kind": 3,
        "detail": "Function",
        "documentation": {
            "kind": "markdown",
            "value": "Calculates **score**."
        },
        "insertText": "calculate_score()",
        "insertTextFormat": 1,
        "insertTextMode": 2,
        "sortText": "1:calculate_score",
        "filterText": "calculate_score",
        "textEdit": {
            "insert": {
                "start": { "line": 0, "character": 7 },
                "end": { "line": 0, "character": 12 }
            },
            "replace": {
                "start": { "line": 0, "character": 7 },
                "end": { "line": 0, "character": 16 }
            },
            "newText": "public.calculate_score()"
        },
        "additionalTextEdits": [{
            "range": {
                "start": { "line": 0, "character": 0 },
                "end": { "line": 0, "character": 0 }
            },
            "newText": "-- generated\n"
        }],
        "commitCharacters": ["(", "."],
        "tags": [1],
        "preselect": true
    });

    let parsed = parse_completion_item(&item, None).expect("completion should parse");

    assert_eq!(parsed.label, "calculate_score");
    assert_eq!(
        parsed.label_details,
        Some(CompletionItemLabelDetails {
            detail: Some("(value numeric)".to_string()),
            description: Some("public".to_string()),
        })
    );
    assert_eq!(parsed.insert_text.as_deref(), Some("calculate_score()"));
    assert_eq!(
        parsed.documentation,
        Some(CompletionDocumentation::Markup(CompletionMarkupContent {
            kind: "markdown".to_string(),
            value: "Calculates **score**.".to_string(),
        }))
    );
    assert_eq!(parsed.insert_text_format, Some(1));
    assert_eq!(parsed.insert_text_mode, Some(2));
    assert_eq!(parsed.sort_text.as_deref(), Some("1:calculate_score"));
    assert_eq!(parsed.filter_text.as_deref(), Some("calculate_score"));
    assert_eq!(
        parsed.text_edit,
        Some(CompletionTextEdit::InsertAndReplace(InsertReplaceEdit {
            insert: Range {
                start: Position {
                    line: 0,
                    character: 7
                },
                end: Position {
                    line: 0,
                    character: 12
                },
            },
            replace: Range {
                start: Position {
                    line: 0,
                    character: 7
                },
                end: Position {
                    line: 0,
                    character: 16
                },
            },
            new_text: "public.calculate_score()".to_string(),
        }))
    );
    assert_eq!(
        parsed.additional_text_edits,
        Some(vec![TextEdit {
            range: Range {
                start: Position {
                    line: 0,
                    character: 0
                },
                end: Position {
                    line: 0,
                    character: 0
                },
            },
            new_text: "-- generated\n".to_string(),
        }])
    );
    assert_eq!(
        parsed.commit_characters,
        Some(vec!["(".to_string(), ".".to_string()])
    );
    assert_eq!(parsed.deprecated, Some(true));
    assert_eq!(parsed.preselect, Some(true));
}

#[test]
fn applies_supported_completion_list_item_defaults() {
    let item = serde_json::json!({
        "label": "customer_id",
        "textEditText": "customer_id"
    });
    let defaults = serde_json::json!({
        "commitCharacters": ["."],
        "editRange": {
            "insert": {
                "start": { "line": 2, "character": 4 },
                "end": { "line": 2, "character": 7 }
            },
            "replace": {
                "start": { "line": 2, "character": 4 },
                "end": { "line": 2, "character": 11 }
            }
        },
        "insertTextFormat": 2,
        "insertTextMode": 1,
        "data": {
            "document": "file:///query.sql",
            "completionListRevision": 7
        }
    });

    let parsed = parse_completion_item(&item, Some(&defaults)).unwrap();

    assert_eq!(parsed.commit_characters, Some(vec![".".to_string()]));
    assert_eq!(parsed.insert_text_format, Some(2));
    assert_eq!(parsed.insert_text_mode, Some(1));
    assert_eq!(
        parsed.data,
        Some(serde_json::json!({
            "document": "file:///query.sql",
            "completionListRevision": 7
        }))
    );
    assert_eq!(
        parsed.text_edit,
        Some(CompletionTextEdit::InsertAndReplace(InsertReplaceEdit {
            new_text: "customer_id".to_string(),
            insert: Range {
                start: Position {
                    line: 2,
                    character: 4,
                },
                end: Position {
                    line: 2,
                    character: 7,
                },
            },
            replace: Range {
                start: Position {
                    line: 2,
                    character: 4,
                },
                end: Position {
                    line: 2,
                    character: 11,
                },
            },
        }))
    );
}

#[test]
fn completion_items_are_bounded_and_report_incomplete_results() {
    let items = (0..=MAX_LSP_COMPLETION_ITEMS)
        .map(|index| serde_json::json!({ "label": format!("item_{index}") }))
        .collect::<Vec<_>>();
    let (parsed, incomplete) = parse_bounded_completion_items(&items, None);
    assert_eq!(parsed.len(), MAX_LSP_COMPLETION_ITEMS);
    assert!(incomplete);

    let oversized = serde_json::json!({
        "label": "oversized",
        "documentation": "x".repeat(MAX_LSP_COMPLETION_ITEM_BYTES)
    });
    let (parsed, incomplete) = parse_bounded_completion_items(&[oversized], None);
    assert!(parsed.is_empty());
    assert!(incomplete);
}

#[test]
fn resolved_completion_fields_preserve_original_identity_and_data() {
    let original = serde_json::json!({
        "label": "customer_id",
        "kind": 5,
        "sortText": "1:customer_id",
        "data": { "document": "file:///query.sql", "symbol": 42 }
    });
    let resolved = serde_json::json!({
        "label": "customer_id",
        "detail": "customers.customer_id bigint",
        "documentation": {
            "kind": "markdown",
            "value": "Primary key"
        },
        "additionalTextEdits": [{
            "range": {
                "start": { "line": 0, "character": 0 },
                "end": { "line": 0, "character": 0 }
            },
            "newText": "-- resolved\n"
        }]
    });

    let merged = merge_completion_item_values(original, resolved);
    let parsed = parse_completion_item(&merged, None).expect("resolved item should parse");

    assert_eq!(parsed.sort_text.as_deref(), Some("1:customer_id"));
    assert_eq!(
        parsed.data,
        Some(serde_json::json!({
            "document": "file:///query.sql",
            "symbol": 42
        }))
    );
    assert_eq!(
        parsed.documentation,
        Some(CompletionDocumentation::Markup(CompletionMarkupContent {
            kind: "markdown".to_string(),
            value: "Primary key".to_string(),
        }))
    );
    assert_eq!(parsed.additional_text_edits.as_ref().map(Vec::len), Some(1));
}

#[test]
fn generic_lsp_requests_are_strictly_allowlisted() {
    assert!(is_allowed_generic_lsp_method("textDocument/signatureHelp"));
    assert!(is_allowed_generic_lsp_method("textDocument/rename"));
    assert!(is_allowed_generic_lsp_method(
        "textDocument/semanticTokens/full"
    ));
    assert!(is_allowed_generic_lsp_method("textDocument/inlayHint"));
    assert!(is_allowed_generic_lsp_method("workspace/symbol"));
    assert!(!is_allowed_generic_lsp_method("shutdown"));
    assert!(!is_allowed_generic_lsp_method("workspace/executeCommand"));
}
