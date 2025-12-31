use super::driver::DatabaseDriver;
use super::protocol::ColumnInfo;
use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct ConnectionManager {
    // thread-safe map of active connections
    connections: Arc<Mutex<HashMap<String, Box<dyn DatabaseDriver>>>>,
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
    pub async fn query(
        &self,
        id: &str,
        sql: &str,
        query_schema: Option<String>,
    ) -> Result<Vec<super::protocol::QueryResult>> {
        let conns = self.connections.lock().await;
        if let Some(driver) = conns.get(id) {
            // Priority: 1. Explicit schema, 2. Active schema for session, 3. Default
            if let Some(schema) = query_schema {
                driver.query_with_context(sql, &schema).await
            } else {
                let schemas = self.active_schemas.lock().await;
                if let Some(schema) = schemas.get(id) {
                    driver.query_with_context(sql, schema).await
                } else {
                    driver.query(sql).await
                }
            }
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
    pub async fn get_tables(
        &self,
        id: &str,
        schema: &str,
    ) -> Result<Vec<super::protocol::TableInfo>> {
        let conns = self.connections.lock().await;
        if let Some(driver) = conns.get(id) {
            driver.get_tables(schema).await
        } else {
            Err(anyhow!("Connection not found: {}", id))
        }
    }

    /// Get columns
    pub async fn get_columns(
        &self,
        id: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        let conns = self.connections.lock().await;
        if let Some(driver) = conns.get(id) {
            driver.get_columns(schema, table).await
        } else {
            Err(anyhow!("Connection not found: {}", id))
        }
    }

    pub async fn set_current_schema(&self, connection_id: &str, schema: &str) -> Result<()> {
        let conns = self.connections.lock().await;
        let conn = conns
            .get(connection_id)
            .ok_or_else(|| anyhow!("Connection not found"))?;

        // Store it first
        let mut schemas = self.active_schemas.lock().await;
        schemas.insert(connection_id.to_string(), schema.to_string());

        conn.set_current_schema(schema).await
    }
}
