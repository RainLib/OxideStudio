use super::protocol::{
    CollectionInfo, ColumnInfo, ConstraintInfo, ForeignKeyReferenceInfo, FunctionInfo, IndexInfo,
    ParameterizedStatement, QueryParameter, QueryResult, TableInfo,
};
use super::statement::StatementScanDialect;
use anyhow::{anyhow, Result};
use async_trait::async_trait;

fn unsupported_driver_feature(feature: &str) -> anyhow::Error {
    anyhow!("{feature} is not implemented for this driver")
}

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    /// SQL lexer dialect for backend-enforced read-only execution.
    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        None
    }

    /// Establish connection to the database
    async fn connect(&mut self) -> Result<()>;

    /// Close the connection
    async fn disconnect(&self) -> Result<()>;

    /// Check if connection is alive (simple ping)
    async fn ping(&self) -> Result<()>;

    /// Execute a query and return generic result set
    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>>;

    /// Execute a query against an explicitly selected server database.
    ///
    /// This must not silently fall back to the driver's primary database:
    /// callers use it specifically to preserve PostgreSQL's database scope.
    async fn query_database(&self, _database: &str, _sql: &str) -> Result<Vec<QueryResult>> {
        Err(unsupported_driver_feature("Database-scoped queries"))
    }

    /// Execute a tracked query against an explicitly selected database and
    /// optional schema. Unsupported drivers must fail instead of falling back
    /// to their primary database.
    async fn query_database_with_context_tracked(
        &self,
        _query_id: Option<&str>,
        _database: &str,
        _sql: &str,
        _schema: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        Err(unsupported_driver_feature(
            "Tracked database-scoped queries",
        ))
    }

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

    /// Execute a parameterized query against an explicitly selected server
    /// database. Unsupported drivers fail instead of querying their primary
    /// database by accident.
    async fn query_database_parameterized(
        &self,
        _database: &str,
        _sql: &str,
        _params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        Err(unsupported_driver_feature(
            "Database-scoped parameterized queries",
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

    /// Execute a batch of parameterized mutations atomically against an
    /// explicitly selected server database.
    async fn execute_database_parameterized_batch(
        &self,
        _database: &str,
        _statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        Err(unsupported_driver_feature(
            "Database-scoped parameterized batch execution",
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

    /// Get databases visible from the current server connection.
    ///
    /// For drivers where a database and a schema are the same namespace, the
    /// default implementation reuses `get_schemas`. PostgreSQL overrides this
    /// because its schemas belong to one database in a larger server cluster.
    async fn get_databases(&self) -> Result<Vec<String>> {
        self.get_schemas().await
    }

    /// Get list of schemas/namespaces in the currently connected database.
    async fn get_schemas(&self) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    /// Get schemas in an explicitly selected server database.
    ///
    /// Drivers without a separate database/schema hierarchy keep their
    /// existing behavior by delegating to `get_schemas`.
    async fn get_database_schemas(&self, _database: &str) -> Result<Vec<String>> {
        self.get_schemas().await
    }

    /// Get tables in a specific schema
    async fn get_tables(&self, _schema: &str) -> Result<Vec<TableInfo>> {
        Ok(Vec::new())
    }

    /// Get tables from a schema in an explicitly selected server database.
    /// Drivers without database-scoped connections delegate to `get_tables`.
    async fn get_database_tables(&self, _database: &str, schema: &str) -> Result<Vec<TableInfo>> {
        self.get_tables(schema).await
    }

    /// Get collections, indexes, or analogous document/search objects in a namespace.
    async fn get_collections(&self, _namespace: &str) -> Result<Vec<CollectionInfo>> {
        Ok(Vec::new())
    }

    /// Get one bounded page of collection-like objects. Drivers with native
    /// cursors should override this so large namespaces are not materialized.
    async fn get_collections_page(
        &self,
        namespace: &str,
        cursor: Option<&str>,
        limit: usize,
        filter: Option<&str>,
    ) -> Result<crate::core::protocol::CollectionPage> {
        let mut items = self.get_collections(namespace).await?;
        if let Some(filter) = filter.map(str::trim).filter(|value| !value.is_empty()) {
            items.retain(|item| item.name.contains(filter));
        }
        let offset = cursor.and_then(|value| value.parse().ok()).unwrap_or(0);
        let start = offset.min(items.len());
        let end = start.saturating_add(limit.max(1)).min(items.len());
        let total = items.len() as u64;
        Ok(crate::core::protocol::CollectionPage {
            items: items[start..end].to_vec(),
            next_cursor: (end < items.len()).then(|| end.to_string()),
            total: Some(total),
        })
    }

    /// Get columns for a specific table
    async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
        Ok(Vec::new())
    }

    /// Get columns for a table in an explicitly selected server database.
    async fn get_database_columns(
        &self,
        _database: &str,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        Err(unsupported_driver_feature("Database-scoped columns"))
    }

    /// Get indexes for a specific table
    async fn get_indexes(&self, _schema: &str, _table: &str) -> Result<Vec<IndexInfo>> {
        Ok(Vec::new())
    }

    /// Get indexes for a table in an explicitly selected server database.
    async fn get_database_indexes(
        &self,
        _database: &str,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<IndexInfo>> {
        Err(unsupported_driver_feature("Database-scoped indexes"))
    }

    /// Get constraints and foreign-key relationships for a specific table
    async fn get_constraints(&self, _schema: &str, _table: &str) -> Result<Vec<ConstraintInfo>> {
        Ok(Vec::new())
    }

    /// Get constraints for a table in an explicitly selected server database.
    async fn get_database_constraints(
        &self,
        _database: &str,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ConstraintInfo>> {
        Err(unsupported_driver_feature("Database-scoped constraints"))
    }

    /// Find foreign keys owned by other relations that reference this table.
    /// Implementations should query the database catalog instead of scanning
    /// every table from the client.
    async fn get_referencing_foreign_keys(
        &self,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        Ok(Vec::new())
    }

    /// Reverse foreign-key lookup in an explicitly selected server database.
    async fn get_database_referencing_foreign_keys(
        &self,
        _database: &str,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        Err(unsupported_driver_feature(
            "Database-scoped referencing foreign keys",
        ))
    }

    /// Get functions/procedures in a specific schema/database.
    async fn get_functions(&self, _schema: &str) -> Result<Vec<FunctionInfo>> {
        Ok(Vec::new())
    }

    /// Get routines from a schema in an explicitly selected server database.
    /// This mirrors the database-scoped table API because relational explorer
    /// schema nodes load both object groups.
    async fn get_database_functions(
        &self,
        _database: &str,
        schema: &str,
    ) -> Result<Vec<FunctionInfo>> {
        self.get_functions(schema).await
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

    struct CollectionsDriver;

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

    #[async_trait]
    impl DatabaseDriver for CollectionsDriver {
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

        async fn get_collections(&self, namespace: &str) -> Result<Vec<CollectionInfo>> {
            Ok(["session:1", "user:1", "user:2"]
                .into_iter()
                .map(|name| CollectionInfo {
                    name: name.to_string(),
                    namespace: Some(namespace.to_string()),
                    collection_type: None,
                    document_count: None,
                })
                .collect())
        }
    }

    #[tokio::test]
    async fn minimal_driver_can_rely_on_non_relational_defaults() {
        let driver = MinimalDriver;

        assert_eq!(driver.get_databases().await.unwrap(), Vec::<String>::new());
        assert_eq!(driver.get_schemas().await.unwrap(), Vec::<String>::new());
        assert_eq!(
            driver.get_database_schemas("app").await.unwrap(),
            Vec::<String>::new()
        );
        assert!(driver.get_tables("default").await.unwrap().is_empty());
        assert!(driver
            .get_database_tables("app", "default")
            .await
            .unwrap()
            .is_empty());
        assert!(driver.get_collections("default").await.unwrap().is_empty());
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
        assert!(driver
            .get_database_functions("app", "default")
            .await
            .unwrap()
            .is_empty());
        assert!(driver.query_database("app", "SELECT 1").await.is_err());
        assert!(driver
            .query_database_with_context_tracked(Some("query-1"), "app", "SELECT 1", Some("public"))
            .await
            .is_err());
        assert!(driver
            .query_database_parameterized("app", "SELECT $1", &[])
            .await
            .is_err());
        assert!(driver
            .get_database_columns("app", "default", "items")
            .await
            .is_err());
        assert!(driver
            .get_database_indexes("app", "default", "items")
            .await
            .is_err());
        assert!(driver
            .get_database_constraints("app", "default", "items")
            .await
            .is_err());
        assert!(driver.set_current_schema("default").await.is_ok());
        assert!(!driver.cancel_query("query-1").await.unwrap());

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

    #[tokio::test]
    async fn default_collection_pages_filter_before_paginating() {
        let driver = CollectionsDriver;

        let first = driver
            .get_collections_page("default", None, 1, Some("user:"))
            .await
            .unwrap();
        assert_eq!(first.total, Some(2));
        assert_eq!(first.next_cursor.as_deref(), Some("1"));
        assert_eq!(first.items[0].name, "user:1");

        let second = driver
            .get_collections_page("default", first.next_cursor.as_deref(), 1, Some("user:"))
            .await
            .unwrap();
        assert_eq!(second.next_cursor, None);
        assert_eq!(second.items[0].name, "user:2");
    }
}
