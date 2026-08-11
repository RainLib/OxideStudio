use crate::{
    agent::protocol::{
        AgentProviderConfig, AgentProviderKind, AgentToolManifestEntry, ModelCompleteRequest,
    },
    core::provider_secret::normalize_provider_secret,
};
use anyhow::{anyhow, Context, Result};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Map, Value};
use std::{collections::BTreeMap, time::Duration};
use tokio::sync::{mpsc, watch};
use url::Url;

const MAX_PROVIDER_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PROVIDER_STREAM_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone)]
pub struct ModelGateway {
    client: reqwest::Client,
}

impl ModelGateway {
    pub fn new() -> Result<Self> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .context("failed to initialize the agent model client")?;
        Ok(Self { client })
    }

    pub async fn complete(
        &self,
        provider: &AgentProviderConfig,
        request: &ModelCompleteRequest,
    ) -> Result<Value> {
        if provider.kind != AgentProviderKind::OpenaiCompatible {
            return Err(anyhow!("CLI providers are executed by the desktop CLI runtime"));
        }
        request.metadata.validate().map_err(anyhow::Error::msg)?;
        if request.messages.is_empty() {
            return Err(anyhow!("model.complete requires at least one message"));
        }

        let url = chat_completions_url(&provider.base_url)?;
        let timeout = request_timeout(provider.timeout_ms, request.metadata.deadline)?;
        let messages = request
            .messages
            .iter()
            .map(normalize_message)
            .collect::<Result<Vec<_>>>()?;
        let tools = request
            .tools
            .iter()
            .map(openai_tool_definition)
            .collect::<Vec<_>>();

        let mut body = json!({
            "model": provider.model.trim(),
            "messages": messages,
            "stream": false,
        });
        if !tools.is_empty() {
            body["tools"] = Value::Array(tools);
        }
        if let Some(temperature) = request.temperature {
            body["temperature"] = json!(temperature);
        }
        if let Some(max_tokens) = request.max_tokens {
            body["max_tokens"] = json!(max_tokens);
        }

        let mut builder = self
            .client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .json(&body);
        if let Some(api_key) = provider
            .api_key
            .as_deref()
            .map(normalize_provider_secret)
            .filter(|value| !value.is_empty())
        {
            builder = builder.header(AUTHORIZATION, format!("Bearer {api_key}"));
        }

        let response = tokio::time::timeout(timeout, builder.send())
            .await
            .map_err(|_| anyhow!("model provider deadline exceeded"))?
            .context("model provider request failed")?;
        let status = response.status();
        if response
            .content_length()
            .is_some_and(|length| length > MAX_PROVIDER_RESPONSE_BYTES)
        {
            return Err(anyhow!("model provider response exceeds 4 MiB"));
        }
        let bytes = tokio::time::timeout(timeout, response.bytes())
            .await
            .map_err(|_| anyhow!("model provider response deadline exceeded"))?
            .context("failed to read model provider response")?;
        if bytes.len() as u64 > MAX_PROVIDER_RESPONSE_BYTES {
            return Err(anyhow!("model provider response exceeds 4 MiB"));
        }
        let value: Value =
            serde_json::from_slice(&bytes).context("model provider returned invalid JSON")?;
        if !status.is_success() {
            return Err(anyhow!(provider_error_message(status.as_u16(), &value)));
        }
        parse_openai_response(&value)
    }

    /// Streams OpenAI-compatible SSE chunks to the Rust host while also
    /// producing the same complete response shape as `complete` for fallback
    /// and checkpoint consistency.
    pub async fn stream(
        &self,
        provider: &AgentProviderConfig,
        request: &ModelCompleteRequest,
        chunks: mpsc::Sender<Value>,
        mut cancellation: watch::Receiver<bool>,
    ) -> Result<Value> {
        if provider.kind != AgentProviderKind::OpenaiCompatible {
            return Err(anyhow!("CLI providers are executed by the desktop CLI runtime"));
        }
        request.metadata.validate().map_err(anyhow::Error::msg)?;
        if request.messages.is_empty() {
            return Err(anyhow!("model.stream requires at least one message"));
        }

        let url = chat_completions_url(&provider.base_url)?;
        let timeout = request_timeout(provider.timeout_ms, request.metadata.deadline)?;
        let deadline = tokio::time::Instant::now() + timeout;
        let messages = request
            .messages
            .iter()
            .map(normalize_message)
            .collect::<Result<Vec<_>>>()?;
        let tools = request
            .tools
            .iter()
            .map(openai_tool_definition)
            .collect::<Vec<_>>();
        let mut body = json!({
            "model": provider.model.trim(),
            "messages": messages,
            "stream": true,
            "stream_options": {"include_usage": true},
        });
        if !tools.is_empty() {
            body["tools"] = Value::Array(tools);
        }
        if let Some(temperature) = request.temperature {
            body["temperature"] = json!(temperature);
        }
        if let Some(max_tokens) = request.max_tokens {
            body["max_tokens"] = json!(max_tokens);
        }

        let mut builder = self
            .client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .json(&body);
        if let Some(api_key) = provider
            .api_key
            .as_deref()
            .map(normalize_provider_secret)
            .filter(|value| !value.is_empty())
        {
            builder = builder.header(AUTHORIZATION, format!("Bearer {api_key}"));
        }

        let mut response = tokio::select! {
            result = tokio::time::timeout_at(deadline, builder.send()) => {
                result.map_err(|_| anyhow!("model provider stream deadline exceeded"))?
                    .context("model provider stream request failed")?
            }
            _ = wait_for_cancellation(&mut cancellation) => {
                return Err(anyhow!("model provider stream cancelled"));
            }
        };
        let status = response.status();
        if !status.is_success() {
            let bytes = tokio::select! {
                result = tokio::time::timeout_at(deadline, response.bytes()) => {
                    result.map_err(|_| anyhow!("model provider error response deadline exceeded"))?
                        .context("failed to read model provider error response")?
                }
                _ = wait_for_cancellation(&mut cancellation) => {
                    return Err(anyhow!("model provider stream cancelled"));
                }
            };
            if bytes.len() as u64 > MAX_PROVIDER_RESPONSE_BYTES {
                return Err(anyhow!("model provider error response exceeds 4 MiB"));
            }
            let value: Value = serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| json!({"message":"model provider stream failed"}));
            return Err(anyhow!(provider_error_message(status.as_u16(), &value)));
        }

        let mut decoder = SseDecoder::default();
        let mut accumulator = StreamAccumulator::default();
        let mut total_bytes = 0usize;
        loop {
            let next = tokio::select! {
                result = tokio::time::timeout_at(deadline, response.chunk()) => {
                    result.map_err(|_| anyhow!("model provider stream deadline exceeded"))?
                        .context("failed to read model provider stream")?
                }
                _ = wait_for_cancellation(&mut cancellation) => {
                    return Err(anyhow!("model provider stream cancelled"));
                }
            };
            let Some(bytes) = next else {
                break;
            };
            total_bytes = total_bytes.saturating_add(bytes.len());
            if total_bytes > MAX_PROVIDER_STREAM_BYTES {
                return Err(anyhow!("model provider stream exceeds 32 MiB"));
            }
            for event in decoder.push(&bytes)? {
                if event == "[DONE]" {
                    continue;
                }
                let value: Value = serde_json::from_str(&event)
                    .context("model provider returned invalid SSE JSON")?;
                let notification = accumulator.apply(&value)?;
                if notification != Value::Null && chunks.send(notification).await.is_err() {
                    return Err(anyhow!("model stream consumer closed"));
                }
            }
        }
        for event in decoder.finish()? {
            if event == "[DONE]" {
                continue;
            }
            let value: Value = serde_json::from_str(&event)
                .context("model provider returned invalid trailing SSE JSON")?;
            let notification = accumulator.apply(&value)?;
            if notification != Value::Null && chunks.send(notification).await.is_err() {
                return Err(anyhow!("model stream consumer closed"));
            }
        }
        accumulator.finish()
    }
}

async fn wait_for_cancellation(cancellation: &mut watch::Receiver<bool>) {
    loop {
        if *cancellation.borrow() {
            return;
        }
        if cancellation.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
    data_lines: Vec<String>,
}

impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>> {
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(newline) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = self.buffer.drain(..=newline).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = std::str::from_utf8(&line).context("model SSE stream is not UTF-8")?;
            self.consume_line(line, &mut events);
        }
        Ok(events)
    }

    fn finish(&mut self) -> Result<Vec<String>> {
        let mut events = Vec::new();
        if !self.buffer.is_empty() {
            let line = std::str::from_utf8(&self.buffer)
                .context("model SSE stream ended with invalid UTF-8")?
                .trim_end_matches('\r')
                .to_string();
            self.buffer.clear();
            self.consume_line(&line, &mut events);
        }
        if !self.data_lines.is_empty() {
            events.push(self.data_lines.join("\n"));
            self.data_lines.clear();
        }
        Ok(events)
    }

    fn consume_line(&mut self, line: &str, events: &mut Vec<String>) {
        if line.is_empty() {
            if !self.data_lines.is_empty() {
                events.push(self.data_lines.join("\n"));
                self.data_lines.clear();
            }
            return;
        }
        if line.starts_with(':') {
            return;
        }
        if let Some(data) = line.strip_prefix("data:") {
            self.data_lines
                .push(data.strip_prefix(' ').unwrap_or(data).to_string());
        }
    }
}

#[derive(Default)]
struct StreamAccumulator {
    content: String,
    model: Option<String>,
    finish_reason: Option<String>,
    usage: Option<Value>,
    tool_calls: BTreeMap<usize, ToolCallAccumulator>,
}

#[derive(Default)]
struct ToolCallAccumulator {
    id: Option<String>,
    call_type: Option<String>,
    name: String,
    arguments: String,
}

impl StreamAccumulator {
    fn apply(&mut self, value: &Value) -> Result<Value> {
        if self.model.is_none() {
            self.model = value
                .get("model")
                .and_then(Value::as_str)
                .map(ToString::to_string);
        }
        let delta = value.pointer("/choices/0/delta").unwrap_or(&Value::Null);
        let content_delta = delta
            .get("content")
            .map(extract_content_text)
            .transpose()?
            .unwrap_or_default();
        self.content.push_str(&content_delta);
        let tool_call_deltas = delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (fallback_index, tool_call) in tool_call_deltas.iter().enumerate() {
            let index = tool_call
                .get("index")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or(fallback_index);
            let accumulated = self.tool_calls.entry(index).or_default();
            if let Some(id) = tool_call.get("id").and_then(Value::as_str) {
                accumulated.id = Some(id.to_string());
            }
            if let Some(call_type) = tool_call.get("type").and_then(Value::as_str) {
                accumulated.call_type = Some(call_type.to_string());
            }
            if let Some(name) = tool_call.pointer("/function/name").and_then(Value::as_str) {
                accumulated.name.push_str(name);
            }
            if let Some(arguments) = tool_call
                .pointer("/function/arguments")
                .and_then(Value::as_str)
            {
                accumulated.arguments.push_str(arguments);
            }
        }
        if let Some(reason) = value
            .pointer("/choices/0/finish_reason")
            .and_then(Value::as_str)
        {
            self.finish_reason = Some(reason.to_string());
        }
        let usage_delta = parse_usage(value.get("usage"));
        if let Some(usage) = usage_delta.as_ref() {
            self.usage = Some(usage.clone());
        }

        if content_delta.is_empty()
            && tool_call_deltas.is_empty()
            && usage_delta.is_none()
            && value
                .pointer("/choices/0/finish_reason")
                .and_then(Value::as_str)
                .is_none()
        {
            return Ok(Value::Null);
        }
        Ok(json!({
            "delta":content_delta,
            "toolCalls":tool_call_deltas,
            "usage":usage_delta,
            "finishReason":value.pointer("/choices/0/finish_reason").and_then(Value::as_str),
        }))
    }

    fn finish(self) -> Result<Value> {
        let tool_calls = self
            .tool_calls
            .into_values()
            .map(|tool_call| {
                json!({
                    "id":tool_call.id,
                    "type":tool_call.call_type.unwrap_or_else(|| "function".to_string()),
                    "function":{
                        "name":tool_call.name,
                        "arguments":tool_call.arguments,
                    }
                })
            })
            .collect::<Vec<_>>();
        if self.content.is_empty() && tool_calls.is_empty() {
            return Err(anyhow!(
                "model provider stream contains neither content nor tool calls"
            ));
        }
        Ok(json!({
            "content":self.content,
            "model":self.model,
            "finishReason":self.finish_reason,
            "usage":self.usage,
            "toolCalls":tool_calls,
        }))
    }
}

fn parse_usage(value: Option<&Value>) -> Option<Value> {
    let usage = value?.as_object()?;
    let input = usage
        .get("prompt_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output = usage
        .get("completion_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let total = usage
        .get("total_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(input.saturating_add(output));
    Some(json!({
        "inputTokens":input,
        "outputTokens":output,
        "totalTokens":total,
    }))
}

fn request_timeout(configured_ms: Option<u64>, deadline: i64) -> Result<Duration> {
    let now = now_millis();
    let remaining = deadline.saturating_sub(now);
    if remaining <= 0 {
        return Err(anyhow!("agent request deadline has expired"));
    }
    let configured = configured_ms.unwrap_or(60_000).clamp(1_000, 120_000);
    Ok(Duration::from_millis(configured.min(remaining as u64)))
}

fn chat_completions_url(base_url: &str) -> Result<Url> {
    let parsed = Url::parse(base_url.trim()).context("invalid model provider base URL")?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(anyhow!("model provider URL must use http or https"));
    }
    if parsed.host_str().is_none() {
        return Err(anyhow!("model provider URL must include a host"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(anyhow!("model provider URL must not contain credentials"));
    }

    let mut trimmed = base_url.trim().trim_end_matches('/');
    for suffix in ["/chat/completions", "/completions"] {
        if let Some(base) = trimmed.strip_suffix(suffix) {
            trimmed = base.trim_end_matches('/');
            break;
        }
    }
    Url::parse(&format!("{trimmed}/chat/completions"))
        .context("failed to construct model provider endpoint")
}

fn normalize_message(message: &Value) -> Result<Value> {
    let object = message
        .as_object()
        .ok_or_else(|| anyhow!("model message must be an object"))?;
    let role = object
        .get("role")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("model message role is required"))?;
    if !matches!(role, "system" | "user" | "assistant" | "tool") {
        return Err(anyhow!("unsupported model message role: {role}"));
    }
    let content = object
        .get("content")
        .cloned()
        .unwrap_or(Value::String(String::new()));
    if !content.is_string() && !content.is_array() {
        return Err(anyhow!(
            "model message content must be text or content parts"
        ));
    }

    let mut normalized = Map::new();
    normalized.insert("role".to_string(), Value::String(role.to_string()));
    normalized.insert("content".to_string(), content);

    if let Some(name) = object
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        normalized.insert("name".to_string(), Value::String(name.to_string()));
    }

    if let Some(value) = object.get("toolCallId") {
        let tool_call_id = value
            .as_str()
            .map(str::trim)
            .filter(|tool_call_id| !tool_call_id.is_empty())
            .ok_or_else(|| anyhow!("model toolCallId must be a non-empty string"))?;
        if role != "tool" {
            return Err(anyhow!("model toolCallId is only valid for tool messages"));
        }
        normalized.insert(
            "tool_call_id".to_string(),
            Value::String(tool_call_id.to_string()),
        );
    }

    if let Some(value) = object.get("toolCalls") {
        let tool_calls = value
            .as_array()
            .ok_or_else(|| anyhow!("model toolCalls must be an array"))?;
        if !tool_calls.is_empty() {
            if role != "assistant" {
                return Err(anyhow!(
                    "model toolCalls are only valid for assistant messages"
                ));
            }
            if tool_calls.iter().any(|tool_call| !tool_call.is_object()) {
                return Err(anyhow!("model toolCalls must contain objects"));
            }
            normalized.insert(
                "tool_calls".to_string(),
                Value::Array(
                    tool_calls
                        .iter()
                        .map(normalize_openai_tool_call)
                        .collect::<Result<Vec<_>>>()?,
                ),
            );
        }
    }
    Ok(Value::Object(normalized))
}

fn normalize_openai_tool_call(value: &Value) -> Result<Value> {
    let object = value
        .as_object()
        .ok_or_else(|| anyhow!("model tool call must be an object"))?;
    let function = object.get("function").and_then(Value::as_object);
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| {
            function
                .and_then(|value| value.get("name"))
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("model tool call name is required"))?;
    let raw_arguments = object
        .get("args")
        .or_else(|| function.and_then(|value| value.get("arguments")));
    let arguments = match raw_arguments {
        Some(Value::String(value)) => value.clone(),
        Some(value) => {
            serde_json::to_string(value).context("failed to serialize model tool call arguments")?
        }
        None => "{}".to_string(),
    };

    let mut normalized = json!({
        "type": "function",
        "function": {
            "name": name,
            "arguments": arguments,
        }
    });
    if let Some(id) = object
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        normalized["id"] = Value::String(id.to_string());
    }
    Ok(normalized)
}

fn openai_tool_definition(tool: &AgentToolManifestEntry) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.input_schema,
        }
    })
}

fn parse_openai_response(value: &Value) -> Result<Value> {
    let message = value
        .pointer("/choices/0/message")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("model provider response has no assistant message"))?;
    let content = message
        .get("content")
        .map(extract_content_text)
        .transpose()?
        .unwrap_or_default();
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if content.is_empty() && tool_calls.is_empty() {
        return Err(anyhow!(
            "model provider response contains neither content nor tool calls"
        ));
    }

    let usage = value.get("usage").and_then(Value::as_object).map(|usage| {
        let input = usage
            .get("prompt_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let output = usage
            .get("completion_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let total = usage
            .get("total_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(input.saturating_add(output));
        json!({
            "inputTokens": input,
            "outputTokens": output,
            "totalTokens": total,
        })
    });

    Ok(json!({
        "content": content,
        "model": value.get("model").and_then(Value::as_str),
        "finishReason": value.pointer("/choices/0/finish_reason").and_then(Value::as_str),
        "usage": usage,
        "toolCalls": tool_calls,
    }))
}

fn extract_content_text(value: &Value) -> Result<String> {
    if value.is_null() {
        return Ok(String::new());
    }
    if let Some(text) = value.as_str() {
        return Ok(text.to_string());
    }
    let parts = value
        .as_array()
        .ok_or_else(|| anyhow!("model provider returned unsupported message content"))?;
    Ok(parts
        .iter()
        .filter_map(|part| {
            part.get("text")
                .and_then(Value::as_str)
                .or_else(|| part.pointer("/text/value").and_then(Value::as_str))
        })
        .collect::<Vec<_>>()
        .join(""))
}

fn provider_error_message(status: u16, value: &Value) -> String {
    let message = value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| value.get("message").and_then(Value::as_str))
        .unwrap_or("model provider request failed");
    let bounded = message.chars().take(2_000).collect::<String>();
    format!("model provider returned HTTP {status}: {bounded}")
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_is_openai_compatible_and_rejects_embedded_credentials() {
        assert_eq!(
            chat_completions_url("https://api.example.test/v1")
                .unwrap()
                .as_str(),
            "https://api.example.test/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("http://localhost:11434/v1/chat/completions")
                .unwrap()
                .as_str(),
            "http://localhost:11434/v1/chat/completions"
        );
        assert!(chat_completions_url("https://secret@example.test/v1").is_err());
        assert!(chat_completions_url("file:///tmp/provider").is_err());
    }

    #[test]
    fn response_preserves_tool_calls_and_usage() {
        let response = json!({
            "model": "model-1",
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "content": null,
                    "tool_calls": [{
                        "id": "call-1",
                        "type": "function",
                        "function": {"name":"connection.list","arguments":"{}"}
                    }]
                }
            }],
            "usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14}
        });
        let parsed = parse_openai_response(&response).unwrap();
        assert_eq!(parsed["content"], "");
        assert_eq!(parsed["toolCalls"][0]["id"], "call-1");
        assert_eq!(parsed["usage"]["totalTokens"], 14);
    }

    #[test]
    fn camel_case_tool_message_fields_are_normalized() {
        let value = json!({
            "role": "tool",
            "content": "ok",
            "toolCallId": "call-1"
        });
        let normalized = normalize_message(&value).unwrap();
        assert_eq!(normalized["tool_call_id"], "call-1");
        assert!(normalized.get("toolCallId").is_none());
    }

    #[test]
    fn empty_assistant_tool_calls_are_omitted_for_openai_compatibility() {
        let value = json!({
            "role": "assistant",
            "content": "Hello",
            "toolCalls": []
        });
        let normalized = normalize_message(&value).unwrap();
        assert_eq!(normalized["content"], "Hello");
        assert!(normalized.get("tool_calls").is_none());
    }

    #[test]
    fn langchain_tool_calls_are_normalized_for_openai_compatibility() {
        let value = json!({
            "role": "assistant",
            "content": "",
            "toolCalls": [{
                "id": "call-1",
                "type": "tool_call",
                "name": "connection_list",
                "args": {"projectId": "project-1"}
            }]
        });
        let normalized = normalize_message(&value).unwrap();

        assert_eq!(
            normalized["tool_calls"],
            json!([{
                "id": "call-1",
                "type": "function",
                "function": {
                    "name": "connection_list",
                    "arguments": "{\"projectId\":\"project-1\"}"
                }
            }])
        );
    }

    #[test]
    fn sse_decoder_handles_split_frames_and_done_marker() {
        let bytes =
            "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\ndata: [DONE]\n\n".as_bytes();
        let split = bytes.iter().position(|byte| *byte >= 0x80).unwrap() + 1;
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(&bytes[..split]).unwrap().is_empty());
        let events = decoder.push(&bytes[split..]).unwrap();
        assert_eq!(events.len(), 2);
        assert!(events[0].contains("你"));
        assert_eq!(events[1], "[DONE]");
    }

    #[test]
    fn stream_accumulator_reconstructs_tool_calls_and_usage() {
        let mut accumulator = StreamAccumulator::default();
        accumulator
            .apply(&json!({
                "model":"model-1",
                "choices":[{"delta":{"tool_calls":[{
                    "index":0,"id":"call-1","type":"function",
                    "function":{"name":"connection.","arguments":"{\"driver\":"}
                }]}}]
            }))
            .unwrap();
        accumulator
            .apply(&json!({
                "choices":[{"delta":{"tool_calls":[{
                    "index":0,"function":{"name":"capabilities","arguments":"\"postgres\"}"}
                }]},"finish_reason":"tool_calls"}],
                "usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}
            }))
            .unwrap();
        let result = accumulator.finish().unwrap();
        assert_eq!(result["toolCalls"][0]["id"], "call-1");
        assert_eq!(
            result["toolCalls"][0]["function"]["name"],
            "connection.capabilities"
        );
        assert_eq!(
            result["toolCalls"][0]["function"]["arguments"],
            "{\"driver\":\"postgres\"}"
        );
        assert_eq!(result["usage"]["totalTokens"], 17);
        assert_eq!(result["finishReason"], "tool_calls");
    }
}
