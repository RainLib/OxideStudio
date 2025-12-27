use super::protocol::{ColumnInfo, QueryResult, TableInfo};
use anyhow::Result;
use async_trait::async_trait;

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    /// Establish connection to the database
    async fn connect(&mut self) -> Result<()>;

    /// Close the connection
    async fn disconnect(&mut self) -> Result<()>;

    /// Check if connection is alive (simple ping)
    async fn ping(&self) -> Result<()>;

    /// Execute a query and return generic result set
    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>>;

    /// Execute a query within a specific schema context
    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>>;

    /// Get list of schemas (databases)
    async fn get_schemas(&self) -> Result<Vec<String>>;

    /// Get tables in a specific schema
    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>>;

    /// Get columns for a specific table
    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>>;

    /// Set the current schema/database context
    async fn set_current_schema(&self, schema: &str) -> Result<()>;
}
