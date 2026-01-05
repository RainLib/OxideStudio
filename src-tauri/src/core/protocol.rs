use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct QueryResult {
    pub columns: Vec<ColumnDef>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct TableInfo {
    pub name: String,
    pub schema: Option<String>,
    pub comment: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub is_unique: bool,
    pub is_indexed: bool,
    pub default_value: Option<String>,
    pub comment: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "action", content = "payload")]
pub enum Request {
    Connect {
        driver: String,
        url: String,
        name: Option<String>,
    },
    Disconnect {
        connection_id: String,
    },
    Query {
        connection_id: String,
        sql: String,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Response<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<ErrorResponse>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ErrorResponse {
    pub code: String,
    pub message: String,
}

impl<T> Response<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(code: &str, message: &str) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(ErrorResponse {
                code: code.to_string(),
                message: message.to_string(),
            }),
        }
    }
}
