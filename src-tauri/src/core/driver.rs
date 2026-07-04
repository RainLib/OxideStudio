use super::protocol::{
    ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, ParameterizedStatement, QueryParameter,
    QueryResult, TableInfo,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    /// Establish connection to the database
    async fn connect(&mut self) -> Result<()>;

    /// Close the connection
    async fn disconnect(&self) -> Result<()>;

    /// Check if connection is alive (simple ping)
    async fn ping(&self) -> Result<()>;

    /// Execute a query and return generic result set
    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>>;

    /// Execute a parameterized mutation and return rows affected.
    async fn execute_parameterized(&self, _sql: &str, _params: &[QueryParameter]) -> Result<u64> {
        Err(anyhow!(
            "Parameterized execution is not implemented for this driver"
        ))
    }

    /// Execute a parameterized query and return result sets.
    async fn query_parameterized(
        &self,
        _sql: &str,
        _params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        Err(anyhow!(
            "Parameterized query execution is not implemented for this driver"
        ))
    }

    /// Execute a batch of parameterized mutations atomically.
    async fn execute_parameterized_batch(
        &self,
        _statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        Err(anyhow!(
            "Parameterized batch execution is not implemented for this driver"
        ))
    }

    /// Execute a query with an optional query id used for backend cancellation.
    async fn query_tracked(&self, _query_id: Option<&str>, sql: &str) -> Result<Vec<QueryResult>> {
        self.query(sql).await
    }

    /// Execute a query within a specific schema context
    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>>;

    /// Execute a query within a schema context with an optional query id.
    async fn query_with_context_tracked(
        &self,
        _query_id: Option<&str>,
        sql: &str,
        schema: &str,
    ) -> Result<Vec<QueryResult>> {
        self.query_with_context(sql, schema).await
    }

    /// Start a named transaction session on a dedicated connection.
    async fn begin_transaction(&self, session_id: &str, schema: Option<&str>) -> Result<()>;

    /// Execute a query in an existing named transaction session.
    async fn query_transaction(&self, session_id: &str, sql: &str) -> Result<Vec<QueryResult>>;

    /// Execute a transaction query with an optional query id.
    async fn query_transaction_tracked(
        &self,
        _query_id: Option<&str>,
        session_id: &str,
        sql: &str,
    ) -> Result<Vec<QueryResult>> {
        self.query_transaction(session_id, sql).await
    }

    /// Request backend cancellation for a tracked query. Returns true when a
    /// backend cancellation command was sent.
    async fn cancel_query(&self, _query_id: &str) -> Result<bool> {
        Ok(false)
    }

    /// Commit and release a named transaction session.
    async fn commit_transaction(&self, session_id: &str) -> Result<()>;

    /// Roll back and release a named transaction session.
    async fn rollback_transaction(&self, session_id: &str) -> Result<()>;

    /// Get list of schemas (databases)
    async fn get_schemas(&self) -> Result<Vec<String>>;

    /// Get tables in a specific schema
    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>>;

    /// Get columns for a specific table
    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>>;

    /// Get indexes for a specific table
    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>>;

    /// Get constraints and foreign-key relationships for a specific table
    async fn get_constraints(&self, schema: &str, table: &str) -> Result<Vec<ConstraintInfo>>;

    /// Get functions/procedures in a specific schema/database.
    async fn get_functions(&self, _schema: &str) -> Result<Vec<FunctionInfo>> {
        Ok(Vec::new())
    }

    /// Set the current schema/database context
    async fn set_current_schema(&self, schema: &str) -> Result<()>;

    /// Invalidate cached driver resources tied to a schema/database.
    async fn invalidate_schema(&self, _schema: &str) -> Result<()> {
        Ok(())
    }
}
