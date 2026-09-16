use super::{
    send_inline_completion, AiCancellationState, AiInlineCompletionRequest,
    AiInlineCompletionResult, AppHandle, Response, State,
};

#[tauri::command]
pub async fn ai_inline_completion(
    app: AppHandle,
    request: AiInlineCompletionRequest,
    cancellation: State<'_, AiCancellationState>,
) -> Result<Response<AiInlineCompletionResult>, String> {
    let request_id = request.request_id.trim().to_string();
    if request_id.is_empty() {
        return Ok(Response::err(
            "AI_INLINE_COMPLETION_INVALID_REQUEST",
            "Inline completion request id is required",
        ));
    }
    let mut cancel_rx = match cancellation.register(&request_id).await {
        Ok(receiver) => receiver,
        Err(error) => return Ok(Response::err("AI_REQUEST_CANCELLED", &error)),
    };

    let result = tokio::select! {
        result = send_inline_completion(&app, request) => result,
        _ = cancel_rx.changed() => Err("AI request cancelled".to_string()),
    };
    cancellation.finish(&request_id).await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) if error == "AI request cancelled" => {
            Ok(Response::err("AI_REQUEST_CANCELLED", &error))
        }
        Err(error) => Ok(Response::err("AI_INLINE_COMPLETION_ERROR", &error)),
    }
}
