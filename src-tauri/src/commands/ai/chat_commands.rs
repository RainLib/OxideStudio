use super::{
    send_chat_completion, AiCancellationState, AiChatCompletionRequest, AiChatCompletionResult,
    AiChatMessage, AiProviderConfig, AiProviderTestResult, AppHandle, Response, State,
};

#[tauri::command]
pub async fn ai_chat_completion(
    app: AppHandle,
    request: AiChatCompletionRequest,
    cancellation: State<'_, AiCancellationState>,
) -> Result<Response<AiChatCompletionResult>, String> {
    let request_id = request
        .request_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let mut cancel_rx = if let Some(request_id) = request_id.as_deref() {
        match cancellation.register(request_id).await {
            Ok(receiver) => Some(receiver),
            Err(error) => return Ok(Response::err("AI_REQUEST_CANCELLED", &error)),
        }
    } else {
        None
    };

    let result = if let Some(cancel_rx) = cancel_rx.as_mut() {
        tokio::select! {
            result = send_chat_completion(&app, request) => result,
            _ = cancel_rx.changed() => Err("AI request cancelled".to_string()),
        }
    } else {
        send_chat_completion(&app, request).await
    };

    if let Some(request_id) = request_id.as_deref() {
        cancellation.finish(request_id).await;
    }

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) if error == "AI request cancelled" => {
            Ok(Response::err("AI_REQUEST_CANCELLED", &error))
        }
        Err(error) => Ok(Response::err("AI_CHAT_COMPLETION_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn ai_test_provider(
    app: AppHandle,
    config: AiProviderConfig,
) -> Result<Response<AiProviderTestResult>, String> {
    let model = config.model.trim().to_string();
    let request = AiChatCompletionRequest {
        request_id: None,
        config,
        messages: vec![
            AiChatMessage {
                role: "system".to_string(),
                content: "Reply with a short plain-text readiness confirmation.".to_string(),
            },
            AiChatMessage {
                role: "user".to_string(),
                content: "Connection test".to_string(),
            },
        ],
        temperature: Some(0.0),
        max_tokens: Some(16),
    };

    match send_chat_completion(&app, request).await {
        Ok(_) => Ok(Response::ok(AiProviderTestResult {
            message: "AI provider connection is available".to_string(),
            model,
        })),
        Err(error) => Ok(Response::err("AI_PROVIDER_TEST_ERROR", &error)),
    }
}
