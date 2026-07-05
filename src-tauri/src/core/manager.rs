use super::driver::DatabaseDriver;
use super::protocol::{
    ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, ParameterizedStatement, QueryParameter,
};
use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct ConnectionManager {
    // thread-safe map of active connections
    connections: Arc<Mutex<HashMap<String, Arc<dyn DatabaseDriver>>>>,
    // Store active schema per connection
    active_schemas: Arc<Mutex<HashMap<String, String>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            active_schemas: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn get_driver(&self, id: &str) -> Result<Arc<dyn DatabaseDriver>> {
        let conns = self.connections.lock().await;
        conns
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("Connection not found: {}", id))
    }

    pub async fn add_connection(&self, id: String, driver: Box<dyn DatabaseDriver>) {
        let mut conns = self.connections.lock().await;
        conns.insert(id, Arc::from(driver));
    }

    pub async fn remove_connection(&self, id: &str) -> Option<Arc<dyn DatabaseDriver>> {
        let mut conns = self.connections.lock().await;
        let removed = conns.remove(id);
        drop(conns);
        self.clear_schema_context(id).await;
        removed
    }

    pub async fn replace_connection(
        &self,
        id: String,
        driver: Box<dyn DatabaseDriver>,
    ) -> Result<()> {
        let old_driver = {
            let mut conns = self.connections.lock().await;
            conns.insert(id.clone(), Arc::from(driver))
        };

        self.clear_schema_context(&id).await;

        if let Some(old_driver) = old_driver {
            if let Err(error) = old_driver.disconnect().await {
                tracing::warn!(
                    "Failed to disconnect replaced connection {} after new driver was installed: {}",
                    id,
                    error
                );
            }
        }

        Ok(())
    }

    pub async fn disconnect_connection(&self, id: &str) -> Result<()> {
        let driver = self
            .remove_connection(id)
            .await
            .ok_or_else(|| anyhow!("Connection not found: {}", id))?;

        driver.disconnect().await
    }

    pub async fn clear_schema_context(&self, id: &str) {
        let mut schemas = self.active_schemas.lock().await;
        schemas.remove(id);
    }

    pub async fn invalidate_schema(&self, id: &str, schema: &str) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver.invalidate_schema(schema).await?;

        let mut schemas = self.active_schemas.lock().await;
        if schemas.get(id).is_some_and(|active| active == schema) {
            schemas.remove(id);
        }

        Ok(())
    }

    /// Ping a connection to check if it's alive
    pub async fn ping(&self, id: &str) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver.ping().await
    }

    /// Execute a query
    pub async fn query(
        &self,
        id: &str,
        sql: &str,
        query_schema: Option<String>,
        transaction_id: Option<String>,
        query_id: Option<String>,
    ) -> Result<Vec<super::protocol::QueryResult>> {
        let driver = self.get_driver(id).await?;
        let query_id = query_id.as_deref();
        if let Some(transaction_id) =
            transaction_id.filter(|transaction_id| !transaction_id.trim().is_empty())
        {
            return driver
                .query_transaction_tracked(query_id, &transaction_id, sql)
                .await;
        }

        // Priority: 1. Explicit schema, 2. Active schema for session, 3. Default
        if let Some(schema) = query_schema {
            driver
                .query_with_context_tracked(query_id, sql, &schema)
                .await
        } else {
            let schema = {
                let schemas = self.active_schemas.lock().await;
                schemas.get(id).cloned()
            };
            if let Some(schema) = schema {
                driver
                    .query_with_context_tracked(query_id, sql, &schema)
                    .await
            } else {
                driver.query_tracked(query_id, sql).await
            }
        }
    }

    pub async fn cancel_query(&self, id: &str, query_id: &str) -> Result<bool> {
        let driver = self.get_driver(id).await?;
        driver.cancel_query(query_id).await
    }

    pub async fn execute_parameterized(
        &self,
        id: &str,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<u64> {
        let driver = self.get_driver(id).await?;
        driver.execute_parameterized(sql, params).await
    }

    pub async fn query_parameterized(
        &self,
        id: &str,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<super::protocol::QueryResult>> {
        let driver = self.get_driver(id).await?;
        driver.query_parameterized(sql, params).await
    }

    pub async fn execute_parameterized_batch(
        &self,
        id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let driver = self.get_driver(id).await?;
        driver.execute_parameterized_batch(statements).await
    }

    pub async fn begin_transaction(
        &self,
        id: &str,
        transaction_id: &str,
        schema: Option<String>,
    ) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver
            .begin_transaction(transaction_id, schema.as_deref())
            .await
    }

    pub async fn commit_transaction(&self, id: &str, transaction_id: &str) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver.commit_transaction(transaction_id).await
    }

    pub async fn rollback_transaction(&self, id: &str, transaction_id: &str) -> Result<()> {
        let driver = self.get_driver(id).await?;
        driver.rollback_transaction(transaction_id).await
    }

    /// Get schemas
    pub async fn get_schemas(&self, id: &str) -> Result<Vec<String>> {
        let driver = self.get_driver(id).await?;
        driver.get_schemas().await
    }

    /// Get tables
    pub async fn get_tables(
        &self,
        id: &str,
        schema: &str,
    ) -> Result<Vec<super::protocol::TableInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_tables(schema).await
    }

    pub async fn get_collections(
        &self,
        id: &str,
        namespace: &str,
    ) -> Result<Vec<super::protocol::CollectionInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_collections(namespace).await
    }

    /// Get columns
    pub async fn get_columns(
        &self,
        id: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_columns(schema, table).await
    }

    pub async fn get_indexes(&self, id: &str, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_indexes(schema, table).await
    }

    pub async fn get_constraints(
        &self,
        id: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_constraints(schema, table).await
    }

    pub async fn get_functions(&self, id: &str, schema: &str) -> Result<Vec<FunctionInfo>> {
        let driver = self.get_driver(id).await?;
        driver.get_functions(schema).await
    }

    pub async fn set_current_schema(&self, connection_id: &str, schema: &str) -> Result<()> {
        let driver = self.get_driver(connection_id).await?;
        driver.set_current_schema(schema).await?;

        let mut schemas = self.active_schemas.lock().await;
        schemas.insert(connection_id.to_string(), schema.to_string());

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::protocol::{
        ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, QueryResult, TableInfo,
    };
    use anyhow::anyhow;
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::Notify;
    use tokio::time::{timeout, Duration};

    #[derive(Clone)]
    struct BlockingDriver {
        entered: Arc<AtomicUsize>,
        both_entered: Arc<Notify>,
        release: Arc<Notify>,
    }

    impl BlockingDriver {
        fn new(entered: Arc<AtomicUsize>, both_entered: Arc<Notify>, release: Arc<Notify>) -> Self {
            Self {
                entered,
                both_entered,
                release,
            }
        }
    }

    #[async_trait]
    impl DatabaseDriver for BlockingDriver {
        async fn connect(&mut self) -> Result<()> {
            Ok(())
        }

        async fn disconnect(&self) -> Result<()> {
            Ok(())
        }

        async fn ping(&self) -> Result<()> {
            Ok(())
        }

        async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
            if self.entered.fetch_add(1, Ordering::SeqCst) + 1 == 2 {
                self.both_entered.notify_one();
            }
            self.release.notified().await;
            Ok(Vec::new())
        }

        async fn query_with_context(&self, sql: &str, _schema: &str) -> Result<Vec<QueryResult>> {
            self.query(sql).await
        }

        async fn begin_transaction(&self, _session_id: &str, _schema: Option<&str>) -> Result<()> {
            Ok(())
        }

        async fn query_transaction(
            &self,
            _session_id: &str,
            sql: &str,
        ) -> Result<Vec<QueryResult>> {
            self.query(sql).await
        }

        async fn commit_transaction(&self, _session_id: &str) -> Result<()> {
            Ok(())
        }

        async fn rollback_transaction(&self, _session_id: &str) -> Result<()> {
            Ok(())
        }

        async fn get_schemas(&self) -> Result<Vec<String>> {
            Ok(Vec::new())
        }

        async fn get_tables(&self, _schema: &str) -> Result<Vec<TableInfo>> {
            Ok(Vec::new())
        }

        async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
            Ok(Vec::new())
        }

        async fn get_indexes(&self, _schema: &str, _table: &str) -> Result<Vec<IndexInfo>> {
            Ok(Vec::new())
        }

        async fn get_constraints(
            &self,
            _schema: &str,
            _table: &str,
        ) -> Result<Vec<ConstraintInfo>> {
            Ok(Vec::new())
        }

        async fn get_functions(&self, _schema: &str) -> Result<Vec<FunctionInfo>> {
            Ok(Vec::new())
        }

        async fn set_current_schema(&self, _schema: &str) -> Result<()> {
            Ok(())
        }
    }

    #[derive(Clone)]
    struct LifecycleDriver {
        disconnect_calls: Arc<AtomicUsize>,
        fail_disconnect: bool,
    }

    impl LifecycleDriver {
        fn new(disconnect_calls: Arc<AtomicUsize>, fail_disconnect: bool) -> Self {
            Self {
                disconnect_calls,
                fail_disconnect,
            }
        }
    }

    #[async_trait]
    impl DatabaseDriver for LifecycleDriver {
        async fn connect(&mut self) -> Result<()> {
            Ok(())
        }

        async fn disconnect(&self) -> Result<()> {
            self.disconnect_calls.fetch_add(1, Ordering::SeqCst);
            if self.fail_disconnect {
                Err(anyhow!("disconnect failed"))
            } else {
                Ok(())
            }
        }

        async fn ping(&self) -> Result<()> {
            Ok(())
        }

        async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
            Ok(Vec::new())
        }

        async fn query_with_context(&self, _sql: &str, _schema: &str) -> Result<Vec<QueryResult>> {
            Ok(Vec::new())
        }

        async fn begin_transaction(&self, _session_id: &str, _schema: Option<&str>) -> Result<()> {
            Ok(())
        }

        async fn query_transaction(
            &self,
            _session_id: &str,
            _sql: &str,
        ) -> Result<Vec<QueryResult>> {
            Ok(Vec::new())
        }

        async fn commit_transaction(&self, _session_id: &str) -> Result<()> {
            Ok(())
        }

        async fn rollback_transaction(&self, _session_id: &str) -> Result<()> {
            Ok(())
        }

        async fn get_schemas(&self) -> Result<Vec<String>> {
            Ok(Vec::new())
        }

        async fn get_tables(&self, _schema: &str) -> Result<Vec<TableInfo>> {
            Ok(Vec::new())
        }

        async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
            Ok(Vec::new())
        }

        async fn get_indexes(&self, _schema: &str, _table: &str) -> Result<Vec<IndexInfo>> {
            Ok(Vec::new())
        }

        async fn get_constraints(
            &self,
            _schema: &str,
            _table: &str,
        ) -> Result<Vec<ConstraintInfo>> {
            Ok(Vec::new())
        }

        async fn get_functions(&self, _schema: &str) -> Result<Vec<FunctionInfo>> {
            Ok(Vec::new())
        }

        async fn set_current_schema(&self, _schema: &str) -> Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn queries_on_different_connections_do_not_hold_global_lock() {
        let manager = Arc::new(ConnectionManager::new());
        let entered = Arc::new(AtomicUsize::new(0));
        let both_entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());

        manager
            .add_connection(
                "one".to_string(),
                Box::new(BlockingDriver::new(
                    entered.clone(),
                    both_entered.clone(),
                    release.clone(),
                )),
            )
            .await;
        manager
            .add_connection(
                "two".to_string(),
                Box::new(BlockingDriver::new(
                    entered.clone(),
                    both_entered.clone(),
                    release.clone(),
                )),
            )
            .await;

        let first = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.query("one", "SELECT 1", None, None, None).await })
        };
        let second = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.query("two", "SELECT 1", None, None, None).await })
        };

        timeout(Duration::from_millis(250), both_entered.notified())
            .await
            .expect("second query could not enter while first query was awaiting");
        release.notify_waiters();

        first.await.unwrap().unwrap();
        second.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn replace_connection_keeps_new_driver_when_old_disconnect_fails() {
        let manager = ConnectionManager::new();
        let disconnect_calls = Arc::new(AtomicUsize::new(0));

        manager
            .add_connection(
                "conn".to_string(),
                Box::new(LifecycleDriver::new(disconnect_calls.clone(), true)),
            )
            .await;

        manager
            .replace_connection(
                "conn".to_string(),
                Box::new(LifecycleDriver::new(disconnect_calls.clone(), false)),
            )
            .await
            .expect("replace should succeed after installing the new driver");

        assert_eq!(disconnect_calls.load(Ordering::SeqCst), 1);
        manager
            .ping("conn")
            .await
            .expect("new driver should remain active");
    }

    #[tokio::test]
    async fn disconnect_connection_removes_driver_and_schema_context() {
        let manager = ConnectionManager::new();
        let disconnect_calls = Arc::new(AtomicUsize::new(0));

        manager
            .add_connection(
                "conn".to_string(),
                Box::new(LifecycleDriver::new(disconnect_calls.clone(), false)),
            )
            .await;
        manager
            .set_current_schema("conn", "public")
            .await
            .expect("schema context should be stored");

        assert_eq!(
            manager
                .active_schemas
                .lock()
                .await
                .get("conn")
                .map(String::as_str),
            Some("public")
        );

        manager
            .disconnect_connection("conn")
            .await
            .expect("disconnect should succeed");

        assert_eq!(disconnect_calls.load(Ordering::SeqCst), 1);
        assert!(!manager.active_schemas.lock().await.contains_key("conn"));
        assert!(manager.ping("conn").await.is_err());
    }
}
