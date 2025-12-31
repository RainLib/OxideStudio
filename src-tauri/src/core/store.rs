use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, Pool, Row, Sqlite};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub driver: String,            // "mysql", "postgres", "mongodb", etc.
    pub config: serde_json::Value, // Generic config (host, port, user, etc.)
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub id: String,
    pub connection_id: String,
    pub parent_id: Option<String>,
    pub kind: String, // "DATABASE", "TABLE", "COLUMN", "INDEX", "VIEW", "COLLECTION"
    pub name: String,
    pub metadata: serde_json::Value,
    pub last_updated: i64,
}

pub struct MetaStore {
    pool: Pool<Sqlite>,
}

impl MetaStore {
    pub async fn new(app: &AppHandle) -> Result<Self> {
        let app_dir = app
            .path()
            .app_config_dir()
            .context("failed to get app config dir")?;
        let db_path = app_dir.join("metadata.db");

        // Ensure directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).context("failed to create config directory")?;
        }

        let db_url = format!("sqlite://{}?mode=rwc", db_path.to_string_lossy());

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await
            .context("failed to connect to metadata database")?;

        let store = Self { pool };
        store.init().await?;

        Ok(store)
    }

    async fn init(&self) -> Result<()> {
        // Create connections table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                driver TEXT NOT NULL,
                config JSON NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Create resources table (Hierarchical Metadata)
        // using an adjacency list model
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS resources (
                id TEXT PRIMARY KEY,
                connection_id TEXT NOT NULL,
                parent_id TEXT,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                metadata JSON NOT NULL,
                last_updated INTEGER NOT NULL,
                FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_resources_parent ON resources(parent_id);
            CREATE INDEX IF NOT EXISTS idx_resources_conn ON resources(connection_id);
            CREATE INDEX IF NOT EXISTS idx_resources_search ON resources(connection_id, parent_id, kind, name);
            "#
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // --- Connection Operations ---

    pub async fn save_connection(&self, conn: &SavedConnection) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO connections (id, name, driver, config, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                driver = excluded.driver,
                config = excluded.config,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&conn.id)
        .bind(&conn.name)
        .bind(&conn.driver)
        .bind(&conn.config)
        .bind(conn.created_at)
        .bind(conn.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_connections(&self) -> Result<Vec<SavedConnection>> {
        let recs = sqlx::query("SELECT * FROM connections ORDER BY name")
            .fetch_all(&self.pool)
            .await?;

        let mut connections = Vec::new();
        for rec in recs {
            connections.push(SavedConnection {
                id: rec.get("id"),
                name: rec.get("name"),
                driver: rec.get("driver"),
                config: rec.get("config"),
                created_at: rec.get("created_at"),
                updated_at: rec.get("updated_at"),
            });
        }
        Ok(connections)
    }

    pub async fn delete_connection(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM connections WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // --- Metadata/Resource Operations ---

    /// Sync internal cache with authoritative list from driver for a given parent.
    /// This is an "Upsert" style sync. Items not in 'resources' list but in DB might need deleting?
    /// User requirement: "Update only when triggered".
    /// So this function is called when a "Refresh" happens.
    pub async fn save_resources(&self, resources: &[Resource]) -> Result<()> {
        let mut tx = self.pool.begin().await?;

        for res in resources {
            sqlx::query(
                r#"
                INSERT INTO resources (id, connection_id, parent_id, kind, name, metadata, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    kind = excluded.kind,
                    name = excluded.name,
                    metadata = excluded.metadata,
                    last_updated = excluded.last_updated
                "#
            )
            .bind(&res.id)
            .bind(&res.connection_id)
            .bind(&res.parent_id)
            .bind(&res.kind)
            .bind(&res.name)
            .bind(&res.metadata)
            .bind(res.last_updated)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn get_children(
        &self,
        parent_id: Option<&str>,
        connection_id: &str,
    ) -> Result<Vec<Resource>> {
        let sql = if let Some(pid) = parent_id {
            "SELECT * FROM resources WHERE connection_id = ? AND parent_id = ? ORDER BY name"
        } else {
            // Root resources (databases usually) for this connection
            "SELECT * FROM resources WHERE connection_id = ? AND parent_id IS NULL ORDER BY name"
        };

        let query = sqlx::query(sql).bind(connection_id);
        let query = if let Some(pid) = parent_id {
            query.bind(pid)
        } else {
            query
        };

        let recs = query.fetch_all(&self.pool).await?;
        let mut resources = Vec::new();
        for rec in recs {
            resources.push(Resource {
                id: rec.get("id"),
                connection_id: rec.get("connection_id"),
                parent_id: rec.get("parent_id"),
                kind: rec.get("kind"),
                name: rec.get("name"),
                metadata: rec.get("metadata"),
                last_updated: rec.get("last_updated"),
            })
        }
        Ok(resources)
    }

    /// Search for resources with prefix matching.
    /// Optimized for LSP scenarios (autocomplete).
    pub async fn search_resources(
        &self,
        connection_id: &str,
        query: &str,
        kind: Option<&str>,
        parent_id: Option<&str>,
        limit: i32,
    ) -> Result<Vec<Resource>> {
        let mut sql = "SELECT * FROM resources WHERE connection_id = ?".to_string();

        if kind.is_some() {
            sql.push_str(" AND kind = ?");
        }
        if parent_id.is_some() {
            sql.push_str(" AND parent_id = ?");
        }

        // Prefix search (A%)
        sql.push_str(" AND name LIKE ? ORDER BY name LIMIT ?");

        let mut query_builder = sqlx::query(&sql).bind(connection_id);

        if let Some(k) = kind {
            query_builder = query_builder.bind(k);
        }
        if let Some(pid) = parent_id {
            query_builder = query_builder.bind(pid);
        }

        // Add wildcard to query string for prefix search
        let search_pattern = format!("{}%", query);
        query_builder = query_builder.bind(search_pattern).bind(limit);

        let recs = query_builder.fetch_all(&self.pool).await?;

        // Manual mapping to avoid repeated code... or just copy paste for simplicity
        let mut resources = Vec::new();
        for rec in recs {
            resources.push(Resource {
                id: rec.get("id"),
                connection_id: rec.get("connection_id"),
                parent_id: rec.get("parent_id"),
                kind: rec.get("kind"),
                name: rec.get("name"),
                metadata: rec.get("metadata"),
                last_updated: rec.get("last_updated"),
            })
        }
        Ok(resources)
    }
}
