use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, Pool, Row, Sqlite};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    #[serde(default = "default_project_id")]
    pub project_id: String,
    pub name: String,
    pub driver: String,            // "mysql", "postgres", "mongodb", etc.
    pub config: serde_json::Value, // Generic config (host, port, user, etc.)
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub id: String,
    #[serde(default = "default_project_id")]
    pub project_id: String,
    pub connection_id: String,
    pub parent_id: Option<String>,
    pub kind: String, // "DATABASE", "TABLE", "COLUMN", "INDEX", "VIEW", "COLLECTION"
    pub name: String,
    pub metadata: serde_json::Value,
    pub last_updated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

fn default_project_id() -> String {
    "sqls".to_string()
}

fn current_timestamp_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
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
                project_id TEXT NOT NULL DEFAULT 'sqls',
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
        self.migrate_connections_project_scope().await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_connections_project ON connections(project_id, name)",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        let now = current_timestamp_millis();
        sqlx::query(
            r#"
            INSERT INTO projects (id, name, created_at, updated_at)
            VALUES ('sqls', 'sqls', ?, ?)
            ON CONFLICT(id) DO NOTHING
            "#,
        )
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        // Create resources table (Hierarchical Metadata)
        // using an adjacency list model
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS resources (
                project_id TEXT NOT NULL DEFAULT 'sqls',
                id TEXT NOT NULL,
                connection_id TEXT NOT NULL,
                parent_id TEXT,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                metadata JSON NOT NULL,
                last_updated INTEGER NOT NULL,
                PRIMARY KEY(project_id, id),
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&self.pool)
        .await?;
        self.migrate_resources_project_scope().await?;
        sqlx::query("DROP INDEX IF EXISTS idx_resources_parent")
            .execute(&self.pool)
            .await?;
        sqlx::query("DROP INDEX IF EXISTS idx_resources_conn")
            .execute(&self.pool)
            .await?;
        sqlx::query("DROP INDEX IF EXISTS idx_resources_search")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_resources_parent ON resources(project_id, parent_id)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_resources_conn ON resources(project_id, connection_id)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_resources_search ON resources(project_id, connection_id, parent_id, kind, name)")
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    async fn migrate_connections_project_scope(&self) -> Result<()> {
        let columns = sqlx::query("PRAGMA table_info(connections)")
            .fetch_all(&self.pool)
            .await?;
        let has_project_id = columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "project_id");

        if has_project_id {
            return Ok(());
        }

        sqlx::query("ALTER TABLE connections ADD COLUMN project_id TEXT NOT NULL DEFAULT 'sqls'")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn migrate_resources_project_scope(&self) -> Result<()> {
        let columns = sqlx::query("PRAGMA table_info(resources)")
            .fetch_all(&self.pool)
            .await?;
        let has_project_id = columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "project_id");
        let project_id_is_pk = columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "project_id" && row.get::<i64, _>("pk") > 0);

        if has_project_id && project_id_is_pk {
            return Ok(());
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query("DROP TABLE IF EXISTS resources_project_migration")
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            r#"
            CREATE TABLE resources_project_migration (
                project_id TEXT NOT NULL DEFAULT 'sqls',
                id TEXT NOT NULL,
                connection_id TEXT NOT NULL,
                parent_id TEXT,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                metadata JSON NOT NULL,
                last_updated INTEGER NOT NULL,
                PRIMARY KEY(project_id, id),
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
            )
            "#,
        )
        .execute(&mut *tx)
        .await?;

        let copy_sql = if has_project_id {
            r#"
            INSERT OR REPLACE INTO resources_project_migration
                (project_id, id, connection_id, parent_id, kind, name, metadata, last_updated)
            SELECT COALESCE(project_id, 'sqls'), id, connection_id, parent_id, kind, name, metadata, last_updated
            FROM resources
            "#
        } else {
            r#"
            INSERT OR REPLACE INTO resources_project_migration
                (project_id, id, connection_id, parent_id, kind, name, metadata, last_updated)
            SELECT 'sqls', id, connection_id, parent_id, kind, name, metadata, last_updated
            FROM resources
            "#
        };
        sqlx::query(copy_sql).execute(&mut *tx).await?;
        sqlx::query("DROP TABLE resources")
            .execute(&mut *tx)
            .await?;
        sqlx::query("ALTER TABLE resources_project_migration RENAME TO resources")
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    // --- Connection Operations ---

    pub async fn save_project(&self, project: &Project) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO projects (id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&project.id)
        .bind(&project.name)
        .bind(project.created_at)
        .bind(project.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_projects(&self) -> Result<Vec<Project>> {
        let recs = sqlx::query("SELECT * FROM projects ORDER BY name")
            .fetch_all(&self.pool)
            .await?;

        let mut projects = Vec::new();
        for rec in recs {
            projects.push(Project {
                id: rec.get("id"),
                name: rec.get("name"),
                created_at: rec.get("created_at"),
                updated_at: rec.get("updated_at"),
            });
        }
        Ok(projects)
    }

    pub async fn save_connection(&self, conn: &SavedConnection) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO connections (id, project_id, name, driver, config, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                name = excluded.name,
                driver = excluded.driver,
                config = excluded.config,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&conn.id)
        .bind(&conn.project_id)
        .bind(&conn.name)
        .bind(&conn.driver)
        .bind(&conn.config)
        .bind(conn.created_at)
        .bind(conn.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn replace_connections(
        &self,
        project_id: &str,
        connections: &[SavedConnection],
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM connections WHERE project_id = ?")
            .bind(project_id)
            .execute(&mut *tx)
            .await?;

        for conn in connections {
            let scoped_project_id = if conn.project_id.is_empty() {
                project_id
            } else {
                conn.project_id.as_str()
            };
            sqlx::query(
                r#"
                INSERT INTO connections (id, project_id, name, driver, config, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    project_id = excluded.project_id,
                    name = excluded.name,
                    driver = excluded.driver,
                    config = excluded.config,
                    updated_at = excluded.updated_at
                "#,
            )
            .bind(&conn.id)
            .bind(scoped_project_id)
            .bind(&conn.name)
            .bind(&conn.driver)
            .bind(&conn.config)
            .bind(conn.created_at)
            .bind(conn.updated_at)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn get_connections(&self, project_id: &str) -> Result<Vec<SavedConnection>> {
        let recs = sqlx::query("SELECT * FROM connections WHERE project_id = ? ORDER BY name")
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;

        let mut connections = Vec::new();
        for rec in recs {
            connections.push(SavedConnection {
                id: rec.get("id"),
                project_id: rec.get("project_id"),
                name: rec.get("name"),
                driver: rec.get("driver"),
                config: rec.get("config"),
                created_at: rec.get("created_at"),
                updated_at: rec.get("updated_at"),
            });
        }
        Ok(connections)
    }

    pub async fn delete_connection(&self, project_id: &str, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM connections WHERE project_id = ? AND id = ?")
            .bind(project_id)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // --- Metadata/Resource Operations ---

    /// Upsert resources without deleting siblings. Kept for callers that append metadata.
    pub async fn save_resources(&self, project_id: &str, resources: &[Resource]) -> Result<()> {
        let mut tx = self.pool.begin().await?;

        for res in resources {
            sqlx::query(
                r#"
                INSERT INTO resources (project_id, id, connection_id, parent_id, kind, name, metadata, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, id) DO UPDATE SET
                    connection_id = excluded.connection_id,
                    parent_id = excluded.parent_id,
                    kind = excluded.kind,
                    name = excluded.name,
                    metadata = excluded.metadata,
                    last_updated = excluded.last_updated
                "#
            )
            .bind(project_id)
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

    /// Replace one authoritative resource group, deleting stale siblings first.
    pub async fn replace_resources(
        &self,
        project_id: &str,
        connection_id: &str,
        parent_id: Option<&str>,
        kind: &str,
        resources: &[Resource],
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;

        if let Some(parent_id) = parent_id {
            sqlx::query(
                "DELETE FROM resources WHERE project_id = ? AND connection_id = ? AND parent_id = ? AND kind = ?",
            )
            .bind(project_id)
            .bind(connection_id)
            .bind(parent_id)
            .bind(kind)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "DELETE FROM resources WHERE project_id = ? AND connection_id = ? AND parent_id IS NULL AND kind = ?",
            )
            .bind(project_id)
            .bind(connection_id)
            .bind(kind)
            .execute(&mut *tx)
            .await?;
        }

        for res in resources {
            sqlx::query(
                r#"
                INSERT INTO resources (project_id, id, connection_id, parent_id, kind, name, metadata, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                "#
            )
            .bind(project_id)
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

    pub async fn delete_resources(
        &self,
        project_id: &str,
        connection_id: &str,
        parent_id: Option<&str>,
        kind: Option<&str>,
    ) -> Result<()> {
        match (parent_id, kind) {
            (Some(parent_id), Some(kind)) => {
                sqlx::query(
                    "DELETE FROM resources WHERE project_id = ? AND connection_id = ? AND parent_id = ? AND kind = ?",
                )
                .bind(project_id)
                .bind(connection_id)
                .bind(parent_id)
                .bind(kind)
                .execute(&self.pool)
                .await?;
            }
            (Some(parent_id), None) => {
                sqlx::query(
                    "DELETE FROM resources WHERE project_id = ? AND connection_id = ? AND parent_id = ?",
                )
                .bind(project_id)
                .bind(connection_id)
                .bind(parent_id)
                .execute(&self.pool)
                .await?;
            }
            (None, Some(kind)) => {
                sqlx::query(
                    "DELETE FROM resources WHERE project_id = ? AND connection_id = ? AND parent_id IS NULL AND kind = ?",
                )
                .bind(project_id)
                .bind(connection_id)
                .bind(kind)
                .execute(&self.pool)
                .await?;
            }
            (None, None) => {
                sqlx::query(
                    "DELETE FROM resources WHERE project_id = ? AND connection_id = ?",
                )
                .bind(project_id)
                .bind(connection_id)
                .execute(&self.pool)
                .await?;
            }
        }

        Ok(())
    }

    pub async fn get_children(
        &self,
        project_id: &str,
        parent_id: Option<&str>,
        connection_id: &str,
    ) -> Result<Vec<Resource>> {
        let sql = if parent_id.is_some() {
            "SELECT * FROM resources WHERE project_id = ? AND connection_id = ? AND parent_id = ? ORDER BY name"
        } else {
            // Root resources (databases usually) for this connection
            "SELECT * FROM resources WHERE project_id = ? AND connection_id = ? AND parent_id IS NULL ORDER BY name"
        };

        let query = sqlx::query(sql).bind(project_id).bind(connection_id);
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
                project_id: rec.get("project_id"),
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
        project_id: &str,
        connection_id: &str,
        query: &str,
        kind: Option<&str>,
        parent_id: Option<&str>,
        limit: i32,
    ) -> Result<Vec<Resource>> {
        let mut sql =
            "SELECT * FROM resources WHERE project_id = ? AND connection_id = ?".to_string();

        if kind.is_some() {
            sql.push_str(" AND kind = ?");
        }
        if parent_id.is_some() {
            sql.push_str(" AND parent_id = ?");
        }

        // Prefix search (A%)
        sql.push_str(" AND name LIKE ? ORDER BY name LIMIT ?");

        let mut query_builder = sqlx::query(&sql).bind(project_id).bind(connection_id);

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
                project_id: rec.get("project_id"),
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
