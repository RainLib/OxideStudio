use super::{AGENT_HOST_MAX_FRAME_BYTES, MAX_HEADER_BYTES};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Error as IoError, ErrorKind};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcErrorObject {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

pub fn rpc_request(id: u64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

pub fn rpc_notification(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

pub fn rpc_success(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn rpc_error(id: Value, code: i64, message: impl Into<String>, data: Option<Value>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": JsonRpcErrorObject { code, message: message.into(), data },
    })
}

pub fn rpc_id_key(id: &Value) -> Option<String> {
    match id {
        Value::String(value) => Some(format!("s:{value}")),
        Value::Number(value) => Some(format!("n:{value}")),
        _ => None,
    }
}

pub async fn read_json_frame<R>(reader: &mut R) -> Result<Option<Value>, IoError>
where
    R: AsyncBufRead + Unpin,
{
    let mut content_length = None;
    let mut header_bytes = 0usize;

    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).await?;
        if read == 0 {
            return if header_bytes == 0 {
                Ok(None)
            } else {
                Err(IoError::new(
                    ErrorKind::UnexpectedEof,
                    "agent host closed while reading frame headers",
                ))
            };
        }
        header_bytes = header_bytes.saturating_add(read);
        if header_bytes > MAX_HEADER_BYTES {
            return Err(IoError::new(
                ErrorKind::InvalidData,
                "agent host frame headers exceed 8 KiB",
            ));
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("Content-Length") {
                if content_length.is_some() {
                    return Err(IoError::new(
                        ErrorKind::InvalidData,
                        "duplicate Content-Length header",
                    ));
                }
                let parsed = value.trim().parse::<usize>().map_err(|_| {
                    IoError::new(ErrorKind::InvalidData, "invalid Content-Length header")
                })?;
                content_length = Some(parsed);
            }
        }
    }

    let content_length = content_length
        .ok_or_else(|| IoError::new(ErrorKind::InvalidData, "Content-Length header is required"))?;
    if content_length == 0 || content_length > AGENT_HOST_MAX_FRAME_BYTES {
        return Err(IoError::new(
            ErrorKind::InvalidData,
            format!(
                "agent host frame length must be between 1 and {} bytes",
                AGENT_HOST_MAX_FRAME_BYTES
            ),
        ));
    }

    let mut payload = vec![0u8; content_length];
    reader.read_exact(&mut payload).await?;
    serde_json::from_slice(&payload).map(Some).map_err(|error| {
        IoError::new(
            ErrorKind::InvalidData,
            format!("invalid agent host JSON frame: {error}"),
        )
    })
}

pub async fn write_json_frame<W>(writer: &mut W, value: &Value) -> Result<(), IoError>
where
    W: AsyncWrite + Unpin,
{
    let payload = serde_json::to_vec(value).map_err(|error| {
        IoError::new(
            ErrorKind::InvalidData,
            format!("failed to serialize agent host frame: {error}"),
        )
    })?;
    if payload.is_empty() || payload.len() > AGENT_HOST_MAX_FRAME_BYTES {
        return Err(IoError::new(
            ErrorKind::InvalidData,
            format!(
                "agent host frame length must be between 1 and {} bytes",
                AGENT_HOST_MAX_FRAME_BYTES
            ),
        ));
    }
    writer
        .write_all(format!("Content-Length: {}\r\n\r\n", payload.len()).as_bytes())
        .await?;
    writer.write_all(&payload).await?;
    writer.flush().await
}
