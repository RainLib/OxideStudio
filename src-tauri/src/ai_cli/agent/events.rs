use super::errors::{classify_cli_error, CliAgentError};
use crate::ai_cli::CliProviderKind;
use serde_json::Value;
use sha2::Digest;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub enum CliAgentEvent {
    TextDelta(String),
    Activity {
        status: &'static str,
        label: String,
    },
    ToolStarted {
        call_id: String,
        tool_name: String,
    },
    ToolFinished {
        call_id: String,
        tool_name: String,
        success: bool,
        detail: Option<String>,
    },
    Usage {
        input_tokens: u64,
        output_tokens: u64,
    },
    End,
    Error(CliAgentError),
}

#[derive(Debug)]
pub struct CliAgentEventParser {
    provider: CliProviderKind,
    tool_names: HashMap<String, String>,
    tool_aliases: HashMap<String, String>,
    final_text: String,
    saw_terminal: bool,
    saw_error: bool,
    mutation_result_unknown: bool,
    last_usage: Option<(u64, u64)>,
}

impl CliAgentEventParser {
    pub fn new(provider: CliProviderKind) -> Self {
        Self {
            provider,
            tool_names: HashMap::new(),
            tool_aliases: HashMap::new(),
            final_text: String::new(),
            saw_terminal: false,
            saw_error: false,
            mutation_result_unknown: false,
            last_usage: None,
        }
    }

    pub fn with_tool_names(mut self, names: impl IntoIterator<Item = String>) -> Self {
        for name in names {
            // CodeBuddy normalizes MCP punctuation in streamed tool names.
            // Resolve only names declared for this turn; leave unknown names intact.
            self.tool_aliases.insert(name.replace('.', "_"), name);
        }
        self
    }

    pub fn parse(&mut self, value: &Value) -> Vec<CliAgentEvent> {
        match self.provider {
            CliProviderKind::CodexCli => self.parse_codex(value),
            CliProviderKind::CodebuddyCli => self.parse_codebuddy(value),
        }
    }

    pub fn final_text(&self) -> &str {
        self.final_text.trim()
    }

    pub fn saw_terminal(&self) -> bool {
        self.saw_terminal
    }

    pub fn saw_error(&self) -> bool {
        self.saw_error
    }

    pub fn has_pending_mutation(&self) -> bool {
        self.tool_names
            .values()
            .any(|tool_name| tool_name == "query.executeApproved")
    }

    pub fn mutation_result_unknown(&self) -> bool {
        self.mutation_result_unknown
    }

    fn parse_codex(&mut self, value: &Value) -> Vec<CliAgentEvent> {
        if let Some(method) = value.get("method").and_then(Value::as_str) {
            return self.parse_codex_app_server(method, value.get("params").unwrap_or(value));
        }
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match event_type {
            "item.started" => {
                let item = value.get("item").unwrap_or(value);
                parse_codex_tool(item).map_or_else(Vec::new, |(call_id, tool_name)| {
                    self.tool_names.insert(call_id.clone(), tool_name.clone());
                    vec![CliAgentEvent::ToolStarted { call_id, tool_name }]
                })
            }
            "item.completed" => {
                let item = value.get("item").unwrap_or(value);
                match item.get("type").and_then(Value::as_str).unwrap_or_default() {
                    "agent_message" | "message" => {
                        let text = text_field(item, &["text", "content", "message"]);
                        self.push_text(text)
                    }
                    "reasoning" => vec![CliAgentEvent::Activity {
                        status: "running",
                        label: "Codex completed a reasoning step".to_string(),
                    }],
                    "mcp_tool_call" | "mcp_tool" | "tool_call" => {
                        let (call_id, parsed_name) = parse_codex_tool(item)
                            .unwrap_or_else(|| (fallback_call_id(item), "oxide tool".to_string()));
                        let tool_name = self.tool_names.remove(&call_id).unwrap_or(parsed_name);
                        let status = item
                            .get("status")
                            .and_then(Value::as_str)
                            .unwrap_or("completed");
                        let success = !matches!(status, "failed" | "error" | "cancelled");
                        let detail = safe_tool_detail(item);
                        self.mutation_result_unknown |= detail.is_some();
                        vec![CliAgentEvent::ToolFinished {
                            call_id,
                            tool_name,
                            success,
                            detail,
                        }]
                    }
                    _ => Vec::new(),
                }
            }
            "turn.completed" => {
                self.saw_terminal = true;
                let mut events = parse_usage(value);
                events.push(CliAgentEvent::End);
                events
            }
            "turn.failed" | "error" => {
                self.saw_terminal = true;
                self.saw_error = true;
                vec![CliAgentEvent::Error(classify_cli_error(
                    CliProviderKind::CodexCli,
                    &error_message(value),
                ))]
            }
            _ => Vec::new(),
        }
    }

    fn parse_codex_app_server(&mut self, method: &str, params: &Value) -> Vec<CliAgentEvent> {
        match method {
            "item/agentMessage/delta" => self.push_text(
                params
                    .get("delta")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            ),
            "item/started" => {
                let item = params.get("item").unwrap_or(params);
                parse_codex_tool(item).map_or_else(Vec::new, |(call_id, tool_name)| {
                    self.tool_names.insert(call_id.clone(), tool_name.clone());
                    vec![CliAgentEvent::ToolStarted { call_id, tool_name }]
                })
            }
            "item/completed" => {
                let item = params.get("item").unwrap_or(params);
                let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
                if item_type == "plan" {
                    // The completed plan is authoritative: streamed plan deltas
                    // are explicitly not guaranteed to concatenate to its text.
                    let text = text_field(item, &["text"]);
                    let text = text.filter(|value| !value.trim().is_empty()).map(|value| {
                        if self.final_text.is_empty() {
                            value
                        } else {
                            format!("\n\n{value}")
                        }
                    });
                    self.push_text(text)
                } else if matches!(item_type, "mcpToolCall" | "mcp_tool_call" | "mcpTool") {
                    let (call_id, parsed_name) = parse_codex_tool(item)
                        .unwrap_or_else(|| (fallback_call_id(item), "oxide tool".to_string()));
                    let tool_name = self.tool_names.remove(&call_id).unwrap_or(parsed_name);
                    let status = item
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("completed");
                    let success = !matches!(status, "failed" | "error" | "cancelled");
                    let detail = safe_tool_detail(item);
                    self.mutation_result_unknown |= detail.is_some();
                    vec![CliAgentEvent::ToolFinished {
                        call_id,
                        tool_name,
                        success,
                        detail,
                    }]
                } else {
                    Vec::new()
                }
            }
            "thread/tokenUsage/updated" => {
                let usage = params.pointer("/tokenUsage/last").unwrap_or(params);
                self.last_usage = Some((
                    usage
                        .get("inputTokens")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                    usage
                        .get("outputTokens")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                ));
                Vec::new()
            }
            "turn/completed" => {
                self.saw_terminal = true;
                let turn = params.get("turn").unwrap_or(params);
                let status = turn
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("failed");
                if status == "completed" {
                    let mut events = self
                        .last_usage
                        .take()
                        .map(|(input_tokens, output_tokens)| CliAgentEvent::Usage {
                            input_tokens,
                            output_tokens,
                        })
                        .into_iter()
                        .collect::<Vec<_>>();
                    events.push(CliAgentEvent::End);
                    events
                } else {
                    self.saw_error = true;
                    vec![CliAgentEvent::Error(classify_cli_error(
                        CliProviderKind::CodexCli,
                        &error_message(turn),
                    ))]
                }
            }
            "error" => {
                self.saw_error = true;
                vec![CliAgentEvent::Error(classify_cli_error(
                    CliProviderKind::CodexCli,
                    &error_message(params),
                ))]
            }
            _ => Vec::new(),
        }
    }

    fn parse_codebuddy(&mut self, value: &Value) -> Vec<CliAgentEvent> {
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "assistant" => {
                let content = value
                    .pointer("/message/content")
                    .or_else(|| value.get("content"));
                let mut events = Vec::new();
                for block in content_blocks(content) {
                    match block
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                    {
                        "text" => {
                            events.extend(self.push_text(text_field(block, &["text", "content"])))
                        }
                        "thinking" => events.push(CliAgentEvent::Activity {
                            status: "running",
                            label: "CodeBuddy completed a reasoning step".to_string(),
                        }),
                        "tool_use" => {
                            let call_id = block
                                .get("id")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                                .unwrap_or_else(|| fallback_call_id(block));
                            let tool_name = block
                                .get("name")
                                .and_then(Value::as_str)
                                .map(display_tool_name)
                                .unwrap_or_else(|| "oxide tool".to_string());
                            let tool_name = self
                                .tool_aliases
                                .get(&tool_name)
                                .cloned()
                                .unwrap_or(tool_name);
                            self.tool_names.insert(call_id.clone(), tool_name.clone());
                            events.push(CliAgentEvent::ToolStarted { call_id, tool_name });
                        }
                        _ => {}
                    }
                }
                events
            }
            "user" => {
                let content = value
                    .pointer("/message/content")
                    .or_else(|| value.get("content"));
                let mut events = Vec::new();
                for block in content_blocks(content) {
                    if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                        continue;
                    }
                    let call_id = block
                        .get("tool_use_id")
                        .or_else(|| block.get("id"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| fallback_call_id(block));
                    let tool_name = self
                        .tool_names
                        .remove(&call_id)
                        .unwrap_or_else(|| "oxide tool".to_string());
                    let success = !block
                        .get("is_error")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let detail = safe_tool_detail(block);
                    self.mutation_result_unknown |= detail.is_some();
                    events.push(CliAgentEvent::ToolFinished {
                        call_id,
                        tool_name,
                        success,
                        detail,
                    });
                }
                events
            }
            "result" => {
                self.saw_terminal = true;
                let subtype = value
                    .get("subtype")
                    .and_then(Value::as_str)
                    .unwrap_or("success");
                if matches!(subtype, "success" | "completed") {
                    let mut events = parse_usage(value);
                    events.push(CliAgentEvent::End);
                    events
                } else {
                    self.saw_error = true;
                    vec![CliAgentEvent::Error(classify_cli_error(
                        CliProviderKind::CodebuddyCli,
                        &error_message(value),
                    ))]
                }
            }
            "error" => {
                self.saw_terminal = true;
                self.saw_error = true;
                vec![CliAgentEvent::Error(classify_cli_error(
                    CliProviderKind::CodebuddyCli,
                    &error_message(value),
                ))]
            }
            _ => Vec::new(),
        }
    }

    fn push_text(&mut self, text: Option<String>) -> Vec<CliAgentEvent> {
        let Some(text) = text.filter(|text| !text.is_empty()) else {
            return Vec::new();
        };
        self.final_text.push_str(&text);
        vec![CliAgentEvent::TextDelta(text)]
    }
}

fn parse_codex_tool(item: &Value) -> Option<(String, String)> {
    if !matches!(
        item.get("type").and_then(Value::as_str),
        Some("mcp_tool_call" | "mcp_tool" | "tool_call" | "mcpToolCall" | "mcpTool")
    ) {
        return None;
    }
    let call_id = item
        .get("id")
        .or_else(|| item.get("call_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| fallback_call_id(item));
    let tool_name = item
        .get("tool_name")
        .or_else(|| item.get("toolName"))
        .or_else(|| item.get("tool"))
        .or_else(|| item.get("name"))
        .or_else(|| item.get("server_tool_name"))
        .and_then(Value::as_str)
        .map(display_tool_name)
        .unwrap_or_else(|| "oxide tool".to_string());
    Some((call_id, tool_name))
}

fn display_tool_name(value: &str) -> String {
    value
        .strip_prefix("mcp__oxide__")
        .or_else(|| value.strip_prefix("oxide/"))
        .or_else(|| value.strip_prefix("oxide__"))
        .or_else(|| value.strip_prefix("oxide."))
        .unwrap_or(value)
        .chars()
        .take(200)
        .collect()
}

fn fallback_call_id(value: &Value) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let digest = sha2::Sha256::digest(bytes);
    let suffix = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("cli-{suffix}")
}

fn text_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|value| match value {
            Value::String(text) => Some(text.clone()),
            Value::Array(blocks) => Some(
                blocks
                    .iter()
                    .filter_map(|block| block.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(""),
            ),
            _ => None,
        })
    })
}

fn content_blocks(content: Option<&Value>) -> Vec<&Value> {
    match content {
        Some(Value::Array(blocks)) => blocks.iter().collect(),
        Some(value @ Value::Object(_)) => vec![value],
        _ => Vec::new(),
    }
}

fn parse_usage(value: &Value) -> Vec<CliAgentEvent> {
    let usage = value
        .get("usage")
        .or_else(|| value.pointer("/result/usage"));
    let Some(usage) = usage else {
        return Vec::new();
    };
    let input_tokens = number_field(usage, &["input_tokens", "inputTokens", "prompt_tokens"]);
    let output_tokens = number_field(
        usage,
        &["output_tokens", "outputTokens", "completion_tokens"],
    );
    if input_tokens == 0 && output_tokens == 0 {
        Vec::new()
    } else {
        vec![CliAgentEvent::Usage {
            input_tokens,
            output_tokens,
        }]
    }
}

fn number_field(value: &Value, keys: &[&str]) -> u64 {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_u64))
        .unwrap_or(0)
}

fn error_message(value: &Value) -> String {
    for pointer in [
        "/message",
        "/error/message",
        "/error",
        "/result/error",
        "/result/message",
        "/errors/0/message",
        "/errors/0",
    ] {
        if let Some(message) = value.pointer(pointer).and_then(Value::as_str) {
            return message.to_string();
        }
    }
    "CLI execution failed".to_string()
}

fn safe_tool_detail(value: &Value) -> Option<String> {
    if requires_manual_verification(value) {
        Some(
            "Database operation result is unknown; verify the target manually before retrying."
                .to_string(),
        )
    } else {
        None
    }
}

pub(super) fn requires_manual_verification(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            object
                .get("manualVerificationRequired")
                .and_then(Value::as_bool)
                == Some(true)
                || object.get("kind").and_then(Value::as_str) == Some("mutation_result_unknown")
                || object.values().any(requires_manual_verification)
        }
        Value::Array(values) => values.iter().any(requires_manual_verification),
        Value::String(text) => {
            let lower = text.to_ascii_lowercase();
            lower.contains("verify the target manually")
                || lower.contains("mutation_result_unknown")
                || lower.contains("\"manualverificationrequired\":true")
        }
        _ => false,
    }
}
