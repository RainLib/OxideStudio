use super::driver::DatabaseDriver;
use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct ConnectionManager {
    // thread-safe map of active connections
    connections: Arc<Mutex<HashMap<String, Box<dyn DatabaseDriver>>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn add_connection(&self, id: String, driver: Box<dyn DatabaseDriver>) {
        let mut conns = self.connections.lock().await;
        conns.insert(id, driver);
    }

    pub async fn remove_connection(&self, id: &str) -> Option<Box<dyn DatabaseDriver>> {
        let mut conns = self.connections.lock().await;
        conns.remove(id)
    }

    /// Ping a connection to check if it's alive
    pub async fn ping(&self, id: &str) -> Result<()> {
        let conns = self.connections.lock().await;

        if let Some(driver) = conns.get(id) {
            driver.ping().await
        } else {
            Err(anyhow!("Connection not found: {}", id))
        }
    }

    /// Execute a query
    pub async fn query(&self, id: &str, sql: &str) -> Result<Vec<super::protocol::QueryResult>> {
        let conns = self.connections.lock().await;
        if let Some(driver) = conns.get(id) {
            driver.query(sql).await
        } else {
            Err(anyhow!("Connection not found: {}", id))
        }
    }

    /// Get schemas
    pub async fn get_schemas(&self, id: &str) -> Result<Vec<String>> {
        let conns = self.connections.lock().await;
         if let Some(driver) = conns.get(id) {
            driver.get_schemas().await
        } else {
            Err(anyhow!("Connection not found: {}", id))
        }
    }

    /// Get tables
    pub async fn get_tables(&self, id: &str, schema: &str) -> Result<Vec<super::protocol::TableInfo>> {
        let conns = self.connections.lock().await;
         if let Some(driver) = conns.get(id) {
            driver.get_tables(schema).await
        } else {
            Err(anyhow!("Connection not found: {}", id))
        }
    }

    /// Get columns
    pub async fn get_columns(&self, id: &str, schema: &str, table: &str) -> Result<Vec<super::protocol::ColumnInfo>> {
        let conns = self.connections.lock().await;
         if let Some(driver) = conns.get(id) {
            driver.get_columns(schema, table).await
        } else {
            Err(anyhow!("Connection not found: {}", id))
        }
    }
}
