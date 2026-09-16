use super::{
    hydrate_provider_headers, hydrate_provider_secret, json, normalize_provider_secret,
    provider_endpoint_url, provider_error_message, provider_header_map, validate_config,
    AiInlineCompletionRequest, AiInlineCompletionResult, AppHandle, Duration,
    InlineCompletionProtocol, Value, AUTHORIZATION, CONTENT_TYPE,
};

pub(super) fn inline_completion_timeout(configured: Option<u64>) -> Duration {
    Duration::from_millis(configured.unwrap_or(4_000).clamp(1_000, 15_000))
}

pub(super) async fn send_inline_completion(
    app: &AppHandle,
    mut request: AiInlineCompletionRequest,
) -> Result<AiInlineCompletionResult, String> {
    hydrate_provider_secret(app, "inline", &mut request.config).await?;
    hydrate_provider_headers(app, "inline", &mut request.config).await?;
    validate_config(&request.config)?;
    let timeout = inline_completion_timeout(request.config.timeout_ms);
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())?;
    let prefix = truncate_utf8_tail(&request.prefix, 8_192);
    let suffix = truncate_utf8_head(&request.suffix, 4_096);
    let related_snippets = request
        .related_snippets
        .into_iter()
        .take(3)
        .map(|mut snippet| {
            snippet.content = truncate_utf8_head(&snippet.content, 8_192);
            snippet
        })
        .collect::<Vec<_>>();
    let context = json!({
        "languageId": request.language_id,
        "dialect": request.dialect,
        "filePath": request.file_path,
        "lsp": request.lsp_context,
        "relatedSnippets": related_snippets,
    });
    let (url, payload) = match request.protocol {
        InlineCompletionProtocol::ChatCompletions => {
            let user_payload = json!({
                "context": context,
                "prefix": prefix,
                "suffix": suffix,
            });
            (
                provider_endpoint_url(&request.config.base_url, "chat/completions")?,
                json!({
                    "model": request.config.model.trim(),
                    "messages": [
                        {
                            "role": "system",
                            "content": "Complete the database-language text at the cursor. Return only the exact text to insert, with no Markdown fence or explanation. Respect the supplied dialect, schema/LSP context, suffix, and project snippets. Do not repeat the prefix or suffix. For Elasticsearch Console, preserve the exact METHOD /relative/path followed by a JSON or NDJSON body, never quote an index in the request path, stay inside the active request, and only use mapping fields supplied for the active index. Prefer a short syntactically complete continuation; do not invent an index, field, endpoint, or unsupported clause."
                        },
                        { "role": "user", "content": user_payload.to_string() }
                    ],
                    "temperature": 0.0,
                    "max_tokens": 192,
                    "stream": false
                }),
            )
        }
        InlineCompletionProtocol::TextCompletionsFim => (
            provider_endpoint_url(&request.config.base_url, "completions")?,
            json!({
                "model": request.config.model.trim(),
                "prompt": format!("<oxide_context>{context}</oxide_context>\n{prefix}"),
                "suffix": suffix,
                "temperature": 0.0,
                "max_tokens": 192,
                "stream": false
            }),
        ),
    };

    let mut builder = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .json(&payload);
    if let Some(api_key) = request
        .config
        .api_key
        .as_deref()
        .map(normalize_provider_secret)
    {
        if !api_key.is_empty() {
            builder = builder.header(AUTHORIZATION, format!("Bearer {api_key}"));
        }
    }
    builder = builder.headers(
        provider_header_map(&request.config.custom_headers).map_err(|error| error.to_string())?,
    );
    let response = builder.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|error| format!("AI provider returned invalid JSON: {error}"))?;
    if !status.is_success() {
        return Err(provider_error_message(status.as_u16(), &value));
    }

    let text = match request.protocol {
        InlineCompletionProtocol::ChatCompletions => value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str),
        InlineCompletionProtocol::TextCompletionsFim => {
            value.pointer("/choices/0/text").and_then(Value::as_str)
        }
    }
    .ok_or_else(|| "AI provider response did not include completion text".to_string())?;
    let model = value
        .get("model")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    Ok(AiInlineCompletionResult {
        text: clean_inline_completion(text),
        model,
    })
}

pub(super) fn clean_inline_completion(value: &str) -> String {
    let trimmed = value.trim_matches(['\r', '\n']);
    let without_fence = if let Some(fenced) = trimmed.strip_prefix("```") {
        let body = fenced.split_once('\n').map_or(fenced, |(_, body)| body);
        body.rsplit_once("```").map_or(body, |(body, _)| body)
    } else {
        trimmed
    };
    without_fence
        .trim_matches(['\r', '\n'])
        .lines()
        .take(12)
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(2_048)
        .collect()
}

pub(super) fn truncate_utf8_head(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

pub(super) fn truncate_utf8_tail(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut start = value.len() - max_bytes;
    while start < value.len() && !value.is_char_boundary(start) {
        start += 1;
    }
    value[start..].to_string()
}
