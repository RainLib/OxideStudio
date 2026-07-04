use super::protocol::{
    ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, ParameterizedStatement, QueryParameter,
    QueryResult, TableInfo,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;

fn unsupported_driver_feature(feature: &str) -> anyhow::Error {
    anyhow!("{feature} is not implemented for this driver")
}

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
    async fn query_with_context(&self, sql: &str, _schema: &str) -> Result<Vec<QueryResult>> {
        self.query(sql).await
    }

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
    async fn begin_transaction(&self, _session_id: &str, _schema: Option<&str>) -> Result<()> {
        Err(unsupported_driver_feature("Transactions"))
    }

    /// Execute a query in an existing named transaction session.
    async fn query_transaction(&self, _session_id: &str, _sql: &str) -> Result<Vec<QueryResult>> {
        Err(unsupported_driver_feature("Transactions"))
    }

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
    async fn commit_transaction(&self, _session_id: &str) -> Result<()> {
        Err(unsupported_driver_feature("Transactions"))
    }

    /// Roll back and release a named transaction session.
    async fn rollback_transaction(&self, _session_id: &str) -> Result<()> {
        Err(unsupported_driver_feature("Transactions"))
    }

    /// Get list of schemas (databases)
    async fn get_schemas(&self) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    /// Get tables in a specific schema
    async fn get_tables(&self, _schema: &str) -> Result<Vec<TableInfo>> {
        Ok(Vec::new())
    }

    /// Get columns for a specific table
    async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
        Ok(Vec::new())
    }

    /// Get indexes for a specific table
    async fn get_indexes(&self, _schema: &str, _table: &str) -> Result<Vec<IndexInfo>> {
        Ok(Vec::new())
    }

    /// Get constraints and foreign-key relationships for a specific table
    async fn get_constraints(&self, _schema: &str, _table: &str) -> Result<Vec<ConstraintInfo>> {
        Ok(Vec::new())
    }

    /// Get functions/procedures in a specific schema/database.
    async fn get_functions(&self, _schema: &str) -> Result<Vec<FunctionInfo>> {
        Ok(Vec::new())
    }

    /// Set the current schema/database context
    async fn set_current_schema(&self, _schema: &str) -> Result<()> {
        Ok(())
    }

    /// Invalidate cached driver resources tied to a schema/database.
    async fn invalidate_schema(&self, _schema: &str) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MinimalDriver;

    #[async_trait]
    impl DatabaseDriver for MinimalDriver {
        async fn connect(&mut self) -> Result<()> {
            Ok(())
        }

        async fn disconnect(&self) -> Result<()> {
            Ok(())
        }

        async fn ping(&self) -> Result<()> {
            Ok(())
        }

        async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(sql, 0)])
        }
    }

    #[tokio::test]
    async fn minimal_driver_can_rely_on_non_relational_defaults() {
        let driver = MinimalDriver;

        assert_eq!(driver.get_schemas().await.unwrap(), Vec::<String>::new());
        assert!(driver.get_tables("default").await.unwrap().is_empty());
        assert!(driver
            .get_columns("default", "items")
            .await
            .unwrap()
            .is_empty());
        assert!(driver
            .get_indexes("default", "items")
            .await
            .unwrap()
            .is_empty());
        assert!(driver
            .get_constraints("default", "items")
            .await
            .unwrap()
            .is_empty());
        assert!(driver.get_functions("default").await.unwrap().is_empty());
        assert!(driver.set_current_schema("default").await.is_ok());
        assert_eq!(driver.cancel_query("query-1").await.unwrap(), false);

        let result = driver
            .query_with_context("PING", "default")
            .await
            .expect("context query should delegate to query");
        assert_eq!(result[0].statement_type.as_deref(), Some("PING"));

        assert!(driver.begin_transaction("tx", None).await.is_err());
        assert!(driver.query_transaction("tx", "PING").await.is_err());
        assert!(driver.commit_transaction("tx").await.is_err());
        assert!(driver.rollback_transaction("tx").await.is_err());
    }
}
