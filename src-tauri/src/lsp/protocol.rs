use serde::{Deserialize, Serialize};

pub const LSP_NOTIFICATION_EVENT: &str = "lsp-notification";

/// LSP JSON-RPC Request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub params: serde_json::Value,
}

/// LSP JSON-RPC Notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub params: serde_json::Value,
}

/// Notification emitted by the embedded LSP server to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspServerNotification {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    pub method: String,
    pub params: serde_json::Value,
}

/// LSP JSON-RPC Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<LspError>,
}

/// LSP Error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// Completion Item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionItem {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
}

/// Diagnostic Severity
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}

/// Diagnostic Position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

/// Diagnostic Range
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

/// Diagnostic
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub range: Range,
    pub severity: Option<DiagnosticSeverity>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{LspNotification, LspRequest};
    use serde_json::{json, Value};

    #[test]
    fn omits_null_params_for_parameterless_lsp_methods() {
        let request = LspRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "shutdown".to_string(),
            params: Value::Null,
        };
        let notification = LspNotification {
            jsonrpc: "2.0".to_string(),
            method: "exit".to_string(),
            params: Value::Null,
        };
        assert_eq!(
            serde_json::to_value(request).unwrap(),
            json!({"jsonrpc":"2.0","id":1,"method":"shutdown"})
        );
        assert_eq!(
            serde_json::to_value(notification).unwrap(),
            json!({"jsonrpc":"2.0","method":"exit"})
        );
    }

    #[test]
    fn preserves_non_empty_lsp_params() {
        let request = LspRequest {
            jsonrpc: "2.0".to_string(),
            id: 2,
            method: "textDocument/hover".to_string(),
            params: json!({"textDocument":{"uri":"file:///query.sql"},"position":{"line":0,"character":1}}),
        };
        assert!(serde_json::to_value(request)
            .unwrap()
            .get("params")
            .is_some());
    }
}
