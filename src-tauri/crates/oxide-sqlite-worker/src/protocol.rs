use serde::{Deserialize, Serialize};

pub const SQLITE_WORKER_PROTOCOL_VERSION: u16 = 1;
pub const MAX_REQUEST_JSON_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_RESPONSE_JSON_BYTES: usize = 16 * 1024 * 1024;
pub const DEFAULT_QUERY_ROW_LIMIT: usize = 1_000;
pub const MAX_QUERY_ROW_LIMIT: usize = 100_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRequest {
    pub protocol_version: u16,
    pub id: u64,
    #[serde(flatten)]
    pub operation: WorkerOperation,
}

impl WorkerRequest {
    pub fn new(id: u64, operation: WorkerOperation) -> Self {
        Self {
            protocol_version: SQLITE_WORKER_PROTOCOL_VERSION,
            id,
            operation,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum WorkerOperation {
    Handshake,
    Open {
        path: String,
        #[serde(default)]
        read_only: bool,
    },
    Query {
        sql: String,
        #[serde(default)]
        parameters: Vec<WorkerParameter>,
        #[serde(default)]
        max_rows: Option<usize>,
    },
    Execute {
        sql: String,
        #[serde(default)]
        parameters: Vec<WorkerParameter>,
    },
    Metadata {
        request: MetadataRequest,
    },
    Backup {
        destination: String,
    },
    Restore {
        source: String,
    },
    Interrupt {
        request_id: u64,
    },
    Ping,
    Close,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MetadataRequest {
    Schemas,
    Tables { schema: String },
    Columns { schema: String, table: String },
    Indexes { schema: String, table: String },
    ForeignKeys { schema: String, table: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkerParameter {
    pub value: serde_json::Value,
    #[serde(default)]
    pub data_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkerResponse {
    pub protocol_version: u16,
    pub id: u64,
    #[serde(flatten)]
    pub body: WorkerResponseBody,
}

impl WorkerResponse {
    pub fn ok(id: u64) -> Self {
        Self::with_body(id, WorkerResponseBody::Ok)
    }

    pub fn with_body(id: u64, body: WorkerResponseBody) -> Self {
        Self {
            protocol_version: SQLITE_WORKER_PROTOCOL_VERSION,
            id,
            body,
        }
    }

    pub fn error(id: u64, code: WorkerErrorCode, message: impl Into<String>) -> Self {
        Self::with_body(
            id,
            WorkerResponseBody::Error {
                code,
                message: message.into(),
            },
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum WorkerResponseBody {
    Ok,
    Handshake {
        worker_version: String,
        sqlite_version: String,
        capabilities: Vec<String>,
    },
    Result {
        columns: Vec<WorkerColumn>,
        rows: Vec<Vec<serde_json::Value>>,
        rows_affected: u64,
        truncated: bool,
    },
    File {
        byte_len: u64,
        integrity_check: String,
    },
    Interrupt {
        request_id: u64,
        accepted: bool,
    },
    Error {
        code: WorkerErrorCode,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkerColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkerErrorCode {
    InvalidRequest,
    ProtocolMismatch,
    NotOpen,
    ReadOnly,
    QueryFailed,
    Interrupted,
    FileInvalid,
    BackupFailed,
    RestoreFailed,
    ResponseTooLarge,
    Internal,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trip_keeps_protocol_and_parameters() {
        let request = WorkerRequest::new(
            7,
            WorkerOperation::Query {
                sql: "SELECT ?1".into(),
                parameters: vec![WorkerParameter {
                    value: serde_json::json!(42),
                    data_type: Some("integer".into()),
                }],
                max_rows: Some(10),
            },
        );
        let encoded = serde_json::to_string(&request).unwrap();
        let decoded: WorkerRequest = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, request);
        assert!(encoded.contains("\"protocolVersion\":1"));
        assert!(encoded.contains("\"op\":\"query\""));
    }

    #[test]
    fn errors_are_machine_classifiable_without_unbounded_diagnostics() {
        let response = WorkerResponse::error(9, WorkerErrorCode::ReadOnly, "write rejected");
        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["status"], "error");
        assert_eq!(value["code"], "read_only");
        assert_eq!(value["id"], 9);
    }
}
