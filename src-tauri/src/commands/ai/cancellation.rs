use super::{watch, HashMap, HashSet, Mutex, Response, State};

pub(super) const MAX_EARLY_CANCELLATIONS: usize = 256;
#[derive(Default)]
struct AiCancellationInner {
    active: HashMap<String, watch::Sender<bool>>,
    cancelled_before_start: HashSet<String>,
}

#[derive(Default)]
pub struct AiCancellationState {
    inner: Mutex<AiCancellationInner>,
}

impl AiCancellationState {
    pub(super) async fn register(&self, request_id: &str) -> Result<watch::Receiver<bool>, String> {
        let mut inner = self.inner.lock().await;
        if inner.cancelled_before_start.remove(request_id) {
            return Err("AI request cancelled".to_string());
        }
        if inner.active.contains_key(request_id) {
            return Err(format!("AI request id is already active: {request_id}"));
        }

        let (sender, receiver) = watch::channel(false);
        inner.active.insert(request_id.to_string(), sender);
        Ok(receiver)
    }

    pub(super) async fn finish(&self, request_id: &str) {
        self.inner.lock().await.active.remove(request_id);
    }

    pub(super) async fn cancel(&self, request_id: &str) -> bool {
        let mut inner = self.inner.lock().await;
        if let Some(sender) = inner.active.remove(request_id) {
            let _ = sender.send(true);
            return true;
        }

        if inner.cancelled_before_start.len() >= MAX_EARLY_CANCELLATIONS {
            inner.cancelled_before_start.clear();
        }
        inner.cancelled_before_start.insert(request_id.to_string());
        true
    }
}

#[tauri::command]
pub async fn cancel_ai_request(
    request_id: String,
    cancellation: State<'_, AiCancellationState>,
) -> Result<Response<bool>, String> {
    let request_id = request_id.trim();
    if request_id.is_empty() {
        return Ok(Response::err(
            "AI_CANCEL_INVALID_REQUEST",
            "AI request id is required",
        ));
    }
    Ok(Response::ok(cancellation.cancel(request_id).await))
}
