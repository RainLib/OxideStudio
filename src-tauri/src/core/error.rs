use thiserror::Error;

/// 应用错误类型
/// 使用 thiserror 提供结构化、类型安全的错误处理
#[derive(Error, Debug)]
pub enum AppError {
    /// 连接未找到错误
    #[error("Connection not found: {0}")]
    ConnectionNotFound(String),

    /// 数据库错误 (自动从 sqlx::Error 转换)
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    /// 连接错误
    #[error("Connection error: {0}")]
    Connection(String),

    /// 查询错误
    #[error("Query execution failed: {0}")]
    QueryError(String),

    /// Schema 错误
    #[error("Schema error: {0}")]
    SchemaError(String),

    /// IO 错误 (自动从 std::io::Error 转换)
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// 配置错误
    #[error("Configuration error: {0}")]
    Config(String),

    /// JSON 序列化错误
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// 无效参数
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),

    /// 不支持的操作
    #[error("Unsupported operation: {0}")]
    Unsupported(String),
}

impl AppError {
    /// 获取错误代码
    pub fn code(&self) -> &str {
        match self {
            AppError::ConnectionNotFound(_) => "CONNECTION_NOT_FOUND",
            AppError::Database(_) => "DATABASE_ERROR",
            AppError::Connection(_) => "CONNECTION_ERROR",
            AppError::QueryError(_) => "QUERY_ERROR",
            AppError::SchemaError(_) => "SCHEMA_ERROR",
            AppError::Io(_) => "IO_ERROR",
            AppError::Config(_) => "CONFIG_ERROR",
            AppError::Serialization(_) => "SERIALIZATION_ERROR",
            AppError::InvalidParameter(_) => "INVALID_PARAMETER",
            AppError::Unsupported(_) => "UNSUPPORTED",
        }
    }

    /// 获取错误消息
    pub fn message(&self) -> String {
        self.to_string()
    }
}

/// 应用 Result 类型别名
pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_code() {
        let err = AppError::ConnectionNotFound("test".to_string());
        assert_eq!(err.code(), "CONNECTION_NOT_FOUND");
    }

    #[test]
    fn test_error_message() {
        let err = AppError::QueryError("syntax error".to_string());
        assert!(err.message().contains("syntax error"));
    }
}
