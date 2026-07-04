use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct QueryResult {
    pub columns: Vec<ColumnDef>,
    pub rows: Vec<Vec<serde_json::Value>>,
    #[serde(
        default,
        rename = "rowsAffected",
        skip_serializing_if = "Option::is_none"
    )]
    pub rows_affected: Option<u64>,
    #[serde(
        default,
        rename = "statementType",
        skip_serializing_if = "Option::is_none"
    )]
    pub statement_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl QueryResult {
    pub fn rows(columns: Vec<ColumnDef>, rows: Vec<Vec<serde_json::Value>>) -> Self {
        Self {
            columns,
            rows,
            rows_affected: None,
            statement_type: None,
            message: None,
        }
    }

    pub fn execution(statement_type: &str, rows_affected: u64) -> Self {
        let message = if rows_affected == 1 {
            format!("{statement_type} executed successfully. 1 row affected.")
        } else {
            format!("{statement_type} executed successfully. {rows_affected} rows affected.")
        };

        Self {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: Some(rows_affected),
            statement_type: Some(statement_type.to_string()),
            message: Some(message),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct QueryParameter {
    pub value: serde_json::Value,
    pub data_type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ParameterizedStatement {
    pub sql: String,
    pub params: Vec<QueryParameter>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct TableInfo {
    pub name: String,
    pub schema: Option<String>,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub table_type: Option<String>,
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
    #[serde(default)]
    pub is_auto_increment: bool,
    pub default_value: Option<String>,
    pub comment: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: Option<String>,
    pub definition: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ConstraintInfo {
    pub name: String,
    pub constraint_type: String,
    pub columns: Vec<String>,
    pub referenced_schema: Option<String>,
    pub referenced_table: Option<String>,
    pub referenced_columns: Vec<String>,
    pub definition: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct FunctionParameterInfo {
    pub name: String,
    pub data_type: String,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct FunctionInfo {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub routine_type: Option<String>,
    #[serde(default)]
    pub parameters: Vec<FunctionParameterInfo>,
    pub return_type: String,
    pub description: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::QueryResult;

    #[test]
    fn execution_result_carries_affected_rows() {
        let result = QueryResult::execution("UPDATE", 3);

        assert!(result.columns.is_empty());
        assert!(result.rows.is_empty());
        assert_eq!(result.rows_affected, Some(3));
        assert_eq!(result.statement_type.as_deref(), Some("UPDATE"));
        assert!(result.message.unwrap().contains("3 rows affected"));
    }
}
