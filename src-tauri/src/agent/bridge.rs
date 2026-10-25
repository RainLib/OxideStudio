#[cfg(feature = "desktop")]
use crate::agent::{host::AgentHostManager, protocol::RequestMetadata};
#[cfg(any(feature = "desktop", unix))]
use anyhow::Context;
use anyhow::{anyhow, Result};
#[cfg(feature = "desktop")]
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{
    split, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, ReadHalf, WriteHalf,
};

pub const BRIDGE_ENDPOINT_ENV: &str = "OXIDE_AGENT_BRIDGE_ENDPOINT";
pub const BRIDGE_TOKEN_ENV: &str = "OXIDE_AGENT_BRIDGE_TOKEN";
const MAX_BRIDGE_FRAME_BYTES: usize = 1024 * 1024;
#[cfg(feature = "desktop")]
const BRIDGE_TOKEN_BYTES: usize = 32;

trait BridgeIo: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T> BridgeIo for T where T: AsyncRead + AsyncWrite + Unpin + Send {}
type BoxBridgeIo = Box<dyn BridgeIo>;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeRequest {
    id: u64,
    token: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeResponse {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<BridgeResponseError>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeResponseError {
    code: String,
    message: String,
}

#[cfg(feature = "desktop")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvokeParams {
    call_id: String,
    tool_name: String,
    input: Value,
}

#[cfg(feature = "desktop")]
pub struct PrivateBridgeSession {
    endpoint: String,
    token: String,
    task: tokio::task::JoinHandle<()>,
    #[cfg(unix)]
    _socket_directory: tempfile::TempDir,
}

#[cfg(feature = "desktop")]
impl PrivateBridgeSession {
    pub async fn start(manager: AgentHostManager, metadata: RequestMetadata) -> Result<Self> {
        let token = random_token(BRIDGE_TOKEN_BYTES);
        #[cfg(windows)]
        {
            let endpoint = format!(r"\\.\pipe\oxide-agent-{}", random_token(18));
            let server = tokio::net::windows::named_pipe::ServerOptions::new()
                .first_pipe_instance(true)
                .create(&endpoint)
                .with_context(|| format!("failed to create private Agent pipe {endpoint}"))?;
            let expected_token = token.clone();
            let task = tokio::spawn(async move {
                if let Err(error) = server.connect().await {
                    tracing::warn!("private Agent bridge pipe failed to accept: {error}");
                    return;
                }
                if let Err(error) =
                    serve_bridge_stream(Box::new(server), manager, metadata, expected_token).await
                {
                    tracing::warn!("private Agent bridge ended: {error}");
                }
            });
            Ok(Self {
                endpoint,
                token,
                task,
            })
        }
        #[cfg(unix)]
        {
            let socket_directory = tempfile::Builder::new()
                .prefix("oxide-agent-bridge-")
                .tempdir()
                .context("failed to create private Agent socket directory")?;
            let socket_path = socket_directory.path().join("bridge.sock");
            let listener = tokio::net::UnixListener::bind(&socket_path)
                .with_context(|| format!("failed to bind {}", socket_path.display()))?;
            let endpoint = socket_path.to_string_lossy().into_owned();
            let expected_token = token.clone();
            let task = tokio::spawn(async move {
                let stream = match listener.accept().await {
                    Ok((stream, _)) => stream,
                    Err(error) => {
                        tracing::warn!("private Agent bridge socket failed to accept: {error}");
                        return;
                    }
                };
                if let Err(error) =
                    serve_bridge_stream(Box::new(stream), manager, metadata, expected_token).await
                {
                    tracing::warn!("private Agent bridge ended: {error}");
                }
            });
            Ok(Self {
                endpoint,
                token,
                task,
                _socket_directory: socket_directory,
            })
        }
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub fn token(&self) -> &str {
        &self.token
    }
}

#[cfg(feature = "desktop")]
impl Drop for PrivateBridgeSession {
    fn drop(&mut self) {
        self.task.abort();
        self.token.clear();
    }
}

#[cfg(feature = "desktop")]
async fn serve_bridge_stream(
    stream: BoxBridgeIo,
    manager: AgentHostManager,
    metadata: RequestMetadata,
    expected_token: String,
) -> Result<()> {
    let (reader, mut writer) = split(stream);
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        let bytes = reader
            .read_line(&mut line)
            .await
            .context("failed to read private Agent bridge request")?;
        if bytes == 0 {
            return Ok(());
        }
        if bytes > MAX_BRIDGE_FRAME_BYTES {
            return Err(anyhow!(
                "private Agent bridge request exceeds the frame limit"
            ));
        }
        let request: BridgeRequest = match serde_json::from_str(line.trim_end()) {
            Ok(request) => request,
            Err(error) => {
                write_response(
                    &mut writer,
                    BridgeResponse {
                        id: 0,
                        result: None,
                        error: Some(BridgeResponseError {
                            code: "INVALID_REQUEST".to_string(),
                            message: format!("invalid private bridge JSON: {error}"),
                        }),
                    },
                )
                .await?;
                continue;
            }
        };
        if !constant_time_eq(request.token.as_bytes(), expected_token.as_bytes()) {
            write_response(
                &mut writer,
                BridgeResponse {
                    id: request.id,
                    result: None,
                    error: Some(BridgeResponseError {
                        code: "UNAUTHORIZED".to_string(),
                        message: "private Agent bridge authentication failed".to_string(),
                    }),
                },
            )
            .await?;
            return Ok(());
        }
        let result = match request.method.as_str() {
            "tools/list" => manager
                .private_bridge_tools(&metadata)
                .await
                .and_then(|tools| serde_json::to_value(tools).map_err(Into::into)),
            "tools/call" => match serde_json::from_value::<InvokeParams>(request.params) {
                Ok(params) => {
                    manager
                        .invoke_private_bridge_tool(
                            &metadata,
                            params.call_id,
                            params.tool_name,
                            params.input,
                        )
                        .await
                }
                Err(error) => Err(anyhow!("invalid tools/call parameters: {error}")),
            },
            _ => Err(anyhow!("unsupported private Agent bridge method")),
        };
        let response = match result {
            Ok(result) => BridgeResponse {
                id: request.id,
                result: Some(result),
                error: None,
            },
            Err(error) => BridgeResponse {
                id: request.id,
                result: None,
                error: Some(BridgeResponseError {
                    code: "TOOL_REJECTED".to_string(),
                    message: bounded_text(&error.to_string(), 2_000),
                }),
            },
        };
        write_response(&mut writer, response).await?;
    }
}

#[cfg(feature = "desktop")]
async fn write_response<W>(writer: &mut W, response: BridgeResponse) -> Result<()>
where
    W: AsyncWrite + Unpin,
{
    let mut bytes = serde_json::to_vec(&response)?;
    if bytes.len() > MAX_BRIDGE_FRAME_BYTES {
        bytes = serde_json::to_vec(&BridgeResponse {
            id: response.id,
            result: None,
            error: Some(BridgeResponseError {
                code: "RESPONSE_TOO_LARGE".to_string(),
                message: "private Agent bridge response exceeds the frame limit".to_string(),
            }),
        })?;
    }
    bytes.push(b'\n');
    writer.write_all(&bytes).await?;
    writer.flush().await?;
    Ok(())
}

pub struct PrivateBridgeClient {
    token: String,
    reader: BufReader<ReadHalf<BoxBridgeIo>>,
    writer: WriteHalf<BoxBridgeIo>,
    next_id: AtomicU64,
}

impl PrivateBridgeClient {
    pub async fn connect_from_environment() -> Result<Self> {
        let endpoint = std::env::var(BRIDGE_ENDPOINT_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("{BRIDGE_ENDPOINT_ENV} is required"))?;
        let token = std::env::var(BRIDGE_TOKEN_ENV)
            .ok()
            .filter(|value| value.len() >= 32 && value.len() <= 256)
            .ok_or_else(|| anyhow!("{BRIDGE_TOKEN_ENV} is missing or invalid"))?;
        let stream = connect_stream(&endpoint).await?;
        let (reader, writer) = split(stream);
        Ok(Self {
            token,
            reader: BufReader::new(reader),
            writer,
            next_id: AtomicU64::new(1),
        })
    }

    pub async fn list_tools(&mut self) -> Result<Value> {
        self.request("tools/list", json!({})).await
    }

    pub async fn call_tool(
        &mut self,
        call_id: String,
        tool_name: String,
        input: Value,
    ) -> Result<Value> {
        self.request(
            "tools/call",
            json!({
                "callId":call_id,
                "toolName":tool_name,
                "input":input,
            }),
        )
        .await
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = BridgeRequest {
            id,
            token: self.token.clone(),
            method: method.to_string(),
            params,
        };
        let mut bytes = serde_json::to_vec(&request)?;
        if bytes.len() > MAX_BRIDGE_FRAME_BYTES {
            return Err(anyhow!(
                "private Agent bridge request exceeds the frame limit"
            ));
        }
        bytes.push(b'\n');
        self.writer.write_all(&bytes).await?;
        self.writer.flush().await?;

        let mut line = String::new();
        let bytes = self.reader.read_line(&mut line).await?;
        if bytes == 0 {
            return Err(anyhow!("private Agent bridge closed unexpectedly"));
        }
        if bytes > MAX_BRIDGE_FRAME_BYTES {
            return Err(anyhow!(
                "private Agent bridge response exceeds the frame limit"
            ));
        }
        let response: BridgeResponse = serde_json::from_str(line.trim_end())?;
        if response.id != id {
            return Err(anyhow!("private Agent bridge response id mismatch"));
        }
        if let Some(error) = response.error {
            return Err(anyhow!("{}: {}", error.code, error.message));
        }
        response
            .result
            .ok_or_else(|| anyhow!("private Agent bridge returned no result"))
    }
}

impl Drop for PrivateBridgeClient {
    fn drop(&mut self) {
        self.token.clear();
    }
}

#[cfg(windows)]
async fn connect_stream(endpoint: &str) -> Result<BoxBridgeIo> {
    use tokio::net::windows::named_pipe::ClientOptions;
    let mut last_error = None;
    for _ in 0..40 {
        match ClientOptions::new().open(endpoint) {
            Ok(client) => return Ok(Box::new(client)),
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
        }
    }
    Err(anyhow!(
        "failed to connect to private Agent pipe: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "unknown pipe error".to_string())
    ))
}

#[cfg(unix)]
async fn connect_stream(endpoint: &str) -> Result<BoxBridgeIo> {
    let path = std::path::PathBuf::from(endpoint);
    let stream = tokio::net::UnixStream::connect(&path)
        .await
        .with_context(|| format!("failed to connect to {}", path.display()))?;
    Ok(Box::new(stream))
}

#[cfg(feature = "desktop")]
fn random_token(bytes: usize) -> String {
    let mut raw = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut raw);
    raw.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(any(feature = "desktop", test))]
fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(feature = "desktop")]
fn bounded_text(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_token_comparison_is_length_and_content_sensitive() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"diff"));
        assert!(!constant_time_eq(b"short", b"longer"));
    }
}
