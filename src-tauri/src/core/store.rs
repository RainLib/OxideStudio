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
    #[serde(default)]
    pub root_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryItem {
    pub id: String,
    pub project_id: String,
    pub connection_id: Option<String>,
    pub connection_name: Option<String>,
    pub driver: Option<String>,
    pub database_name: Option<String>,
    pub schema_name: Option<String>,
    pub sql: String,
    pub status: String,
    pub duration_ms: i64,
    pub row_count: Option<i64>,
    pub error_message: Option<String>,
    pub execution_mode: String,
    pub started_at: i64,
    pub finished_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskPlanStep {
    pub id: String,
    pub title: String,
    pub tool_name: Option<String>,
    pub requires_approval: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskCompletedStep {
    pub id: String,
    pub tool_name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskCheckpoint {
    pub version: u32,
    pub mode: String,
    pub plan: Vec<AssistantTaskPlanStep>,
    pub completed_steps: Vec<AssistantTaskCompletedStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTaskRecord {
    pub id: String,
    pub project_id: String,
    pub request_id: String,
    pub session_id: String,
    pub status: String,
    pub title: String,
    pub detail: Option<String>,
    pub current_step_id: Option<String>,
    pub current_tool_name: Option<String>,
    pub progress: Option<f64>,
    pub checkpoint: AssistantTaskCheckpoint,
    pub created_at: i64,
    pub updated_at: i64,
    pub finished_at: Option<i64>,
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
                root_path TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await?;
        self.migrate_projects_root_path().await?;

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

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS query_history (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                connection_id TEXT,
                connection_name TEXT,
                driver TEXT,
                database_name TEXT,
                schema_name TEXT,
                sql TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('success', 'error', 'cancelled')),
                duration_ms INTEGER NOT NULL,
                row_count INTEGER,
                error_message TEXT,
                execution_mode TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_query_history_project_time ON query_history(project_id, started_at DESC, id DESC)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_query_history_project_status ON query_history(project_id, status, started_at DESC)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_query_history_project_connection ON query_history(project_id, connection_id, started_at DESC)",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS assistant_tasks (
                project_id TEXT NOT NULL,
                id TEXT NOT NULL,
                request_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'interrupted')),
                title TEXT NOT NULL,
                detail TEXT,
                current_step_id TEXT,
                current_tool_name TEXT,
                progress REAL,
                checkpoint JSON NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                finished_at INTEGER,
                PRIMARY KEY(project_id, id),
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_assistant_tasks_project_time ON assistant_tasks(project_id, updated_at DESC, id DESC)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_assistant_tasks_project_status ON assistant_tasks(project_id, status, updated_at DESC)",
        )
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

    async fn migrate_projects_root_path(&self) -> Result<()> {
        let columns = sqlx::query("PRAGMA table_info(projects)")
            .fetch_all(&self.pool)
            .await?;
        let has_root_path = columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "root_path");

        if has_root_path {
            return Ok(());
        }

        sqlx::query("ALTER TABLE projects ADD COLUMN root_path TEXT")
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
            INSERT INTO projects (id, name, root_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                root_path = excluded.root_path,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&project.id)
        .bind(&project.name)
        .bind(&project.root_path)
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
                root_path: rec.get("root_path"),
                created_at: rec.get("created_at"),
                updated_at: rec.get("updated_at"),
            });
        }
        Ok(projects)
    }

    pub async fn get_project(&self, id: &str) -> Result<Option<Project>> {
        let rec = sqlx::query("SELECT * FROM projects WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(rec.map(|rec| Project {
            id: rec.get("id"),
            name: rec.get("name"),
            root_path: rec.get("root_path"),
            created_at: rec.get("created_at"),
            updated_at: rec.get("updated_at"),
        }))
    }

    pub async fn delete_project(&self, id: &str) -> Result<()> {
        if id == "sqls" {
            anyhow::bail!("the default project cannot be deleted");
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM query_history WHERE project_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM assistant_tasks WHERE project_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM resources WHERE project_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM connections WHERE project_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let result = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        if result.rows_affected() == 0 {
            anyhow::bail!("project not found: {id}");
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn set_project_root(&self, id: &str, root_path: Option<&str>) -> Result<Project> {
        let now = current_timestamp_millis();
        let result = sqlx::query("UPDATE projects SET root_path = ?, updated_at = ? WHERE id = ?")
            .bind(root_path)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            anyhow::bail!("project not found: {id}");
        }

        self.get_project(id)
            .await?
            .with_context(|| format!("project disappeared after updating its root: {id}"))
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

    // --- Query History Operations ---

    pub async fn save_query_history(&self, items: &[QueryHistoryItem]) -> Result<()> {
        if items.is_empty() {
            return Ok(());
        }

        for item in items {
            if item.id.trim().is_empty() {
                anyhow::bail!("query history id cannot be empty");
            }
            if !matches!(item.status.as_str(), "success" | "error" | "cancelled") {
                anyhow::bail!("invalid query history status: {}", item.status);
            }
            if item.sql.trim().is_empty() {
                anyhow::bail!("query history SQL cannot be empty");
            }
            if !matches!(item.execution_mode.as_str(), "console" | "statement") {
                anyhow::bail!(
                    "invalid query history execution mode: {}",
                    item.execution_mode
                );
            }
            if item.duration_ms < 0 || item.finished_at < item.started_at {
                anyhow::bail!("query history timing cannot be negative");
            }
            if item.row_count.is_some_and(|row_count| row_count < 0) {
                anyhow::bail!("query history row count cannot be negative");
            }
        }

        let affected_projects = items
            .iter()
            .map(|item| item.project_id.clone())
            .collect::<std::collections::HashSet<_>>();
        let mut tx = self.pool.begin().await?;
        for project_id in &affected_projects {
            let project_exists: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?)")
                    .bind(project_id)
                    .fetch_one(&mut *tx)
                    .await?;
            if !project_exists {
                anyhow::bail!("query history project not found: {project_id}");
            }
        }

        for item in items {
            sqlx::query(
                r#"
                INSERT INTO query_history (
                    id, project_id, connection_id, connection_name, driver,
                    database_name, schema_name, sql, status, duration_ms,
                    row_count, error_message, execution_mode, started_at, finished_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    project_id = excluded.project_id,
                    connection_id = excluded.connection_id,
                    connection_name = excluded.connection_name,
                    driver = excluded.driver,
                    database_name = excluded.database_name,
                    schema_name = excluded.schema_name,
                    sql = excluded.sql,
                    status = excluded.status,
                    duration_ms = excluded.duration_ms,
                    row_count = excluded.row_count,
                    error_message = excluded.error_message,
                    execution_mode = excluded.execution_mode,
                    started_at = excluded.started_at,
                    finished_at = excluded.finished_at
                "#,
            )
            .bind(&item.id)
            .bind(&item.project_id)
            .bind(&item.connection_id)
            .bind(&item.connection_name)
            .bind(&item.driver)
            .bind(&item.database_name)
            .bind(&item.schema_name)
            .bind(&item.sql)
            .bind(&item.status)
            .bind(item.duration_ms)
            .bind(item.row_count)
            .bind(&item.error_message)
            .bind(&item.execution_mode)
            .bind(item.started_at)
            .bind(item.finished_at)
            .execute(&mut *tx)
            .await?;
        }

        for project_id in affected_projects {
            sqlx::query(
                r#"
                DELETE FROM query_history
                WHERE project_id = ? AND id IN (
                    SELECT id FROM query_history
                    WHERE project_id = ?
                    ORDER BY started_at DESC, id DESC
                    LIMIT -1 OFFSET 500
                )
                "#,
            )
            .bind(&project_id)
            .bind(&project_id)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn get_query_history(
        &self,
        project_id: &str,
        limit: i64,
    ) -> Result<Vec<QueryHistoryItem>> {
        let rows = sqlx::query(
            r#"
            SELECT * FROM query_history
            WHERE project_id = ?
            ORDER BY started_at DESC, id DESC
            LIMIT ?
            "#,
        )
        .bind(project_id)
        .bind(limit.clamp(1, 500))
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| QueryHistoryItem {
                id: row.get("id"),
                project_id: row.get("project_id"),
                connection_id: row.get("connection_id"),
                connection_name: row.get("connection_name"),
                driver: row.get("driver"),
                database_name: row.get("database_name"),
                schema_name: row.get("schema_name"),
                sql: row.get("sql"),
                status: row.get("status"),
                duration_ms: row.get("duration_ms"),
                row_count: row.get("row_count"),
                error_message: row.get("error_message"),
                execution_mode: row.get("execution_mode"),
                started_at: row.get("started_at"),
                finished_at: row.get("finished_at"),
            })
            .collect())
    }

    pub async fn delete_query_history_item(&self, project_id: &str, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM query_history WHERE project_id = ? AND id = ?")
            .bind(project_id)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn clear_query_history(&self, project_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM query_history WHERE project_id = ?")
            .bind(project_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn save_assistant_task(&self, task: &AssistantTaskRecord) -> Result<()> {
        validate_assistant_task(task)?;
        if self.get_project(&task.project_id).await?.is_none() {
            anyhow::bail!("assistant task project not found: {}", task.project_id);
        }
        let checkpoint = serde_json::to_value(&task.checkpoint)?;
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            INSERT INTO assistant_tasks (
                project_id, id, request_id, session_id, status, title, detail,
                current_step_id, current_tool_name, progress, checkpoint,
                created_at, updated_at, finished_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, id) DO UPDATE SET
                request_id = excluded.request_id,
                session_id = excluded.session_id,
                status = excluded.status,
                title = excluded.title,
                detail = excluded.detail,
                current_step_id = excluded.current_step_id,
                current_tool_name = excluded.current_tool_name,
                progress = excluded.progress,
                checkpoint = excluded.checkpoint,
                updated_at = excluded.updated_at,
                finished_at = excluded.finished_at
            "#,
        )
        .bind(&task.project_id)
        .bind(&task.id)
        .bind(&task.request_id)
        .bind(&task.session_id)
        .bind(&task.status)
        .bind(&task.title)
        .bind(&task.detail)
        .bind(&task.current_step_id)
        .bind(&task.current_tool_name)
        .bind(task.progress)
        .bind(checkpoint)
        .bind(task.created_at)
        .bind(task.updated_at)
        .bind(task.finished_at)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            DELETE FROM assistant_tasks
            WHERE project_id = ?
              AND status NOT IN ('running', 'awaiting_approval')
              AND id IN (
                  SELECT id FROM assistant_tasks
                  WHERE project_id = ?
                    AND status NOT IN ('running', 'awaiting_approval')
                  ORDER BY updated_at DESC, id DESC
                  LIMIT -1 OFFSET 100
              )
            "#,
        )
        .bind(&task.project_id)
        .bind(&task.project_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn get_assistant_tasks(
        &self,
        project_id: &str,
        session_id: &str,
        limit: i64,
    ) -> Result<Vec<AssistantTaskRecord>> {
        let now = current_timestamp_millis();
        sqlx::query(
            r#"
            UPDATE assistant_tasks
            SET status = 'interrupted',
                detail = 'Application closed before the task completed',
                updated_at = ?,
                finished_at = ?
            WHERE project_id = ?
              AND session_id <> ?
              AND status IN ('running', 'awaiting_approval')
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(project_id)
        .bind(session_id)
        .execute(&self.pool)
        .await?;

        let rows = sqlx::query(
            r#"
            SELECT * FROM assistant_tasks
            WHERE project_id = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT ?
            "#,
        )
        .bind(project_id)
        .bind(limit.clamp(1, 100))
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(assistant_task_from_row).collect()
    }

    pub async fn clear_finished_assistant_tasks(&self, project_id: &str) -> Result<()> {
        sqlx::query(
            "DELETE FROM assistant_tasks WHERE project_id = ? AND status NOT IN ('running', 'awaiting_approval')",
        )
        .bind(project_id)
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
                sqlx::query("DELETE FROM resources WHERE project_id = ? AND connection_id = ?")
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

fn validate_assistant_task(task: &AssistantTaskRecord) -> Result<()> {
    const ALLOWED_STATUSES: [&str; 6] = [
        "running",
        "awaiting_approval",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
    ];
    if task.id.trim().is_empty()
        || task.project_id.trim().is_empty()
        || task.request_id.trim().is_empty()
        || task.session_id.trim().is_empty()
    {
        anyhow::bail!("assistant task identity fields are required");
    }
    if task.id.chars().count() > 200
        || task.project_id.chars().count() > 200
        || task.request_id.chars().count() > 200
        || task.session_id.chars().count() > 200
    {
        anyhow::bail!("assistant task identity fields must not exceed 200 characters");
    }
    if !ALLOWED_STATUSES.contains(&task.status.as_str()) {
        anyhow::bail!("unsupported assistant task status: {}", task.status);
    }
    if task.title.trim().is_empty() || task.title.chars().count() > 200 {
        anyhow::bail!("assistant task title must contain 1 to 200 characters");
    }
    if task
        .detail
        .as_ref()
        .is_some_and(|value| value.chars().count() > 2_000)
    {
        anyhow::bail!("assistant task detail must not exceed 2,000 characters");
    }
    if task.checkpoint.version != 1 || task.checkpoint.mode != "agent" {
        anyhow::bail!("unsupported assistant task checkpoint");
    }
    if task.checkpoint.plan.len() > 100 || task.checkpoint.completed_steps.len() > 100 {
        anyhow::bail!("assistant task checkpoint exceeds the 100-step limit");
    }
    for step in &task.checkpoint.plan {
        if step.id.trim().is_empty()
            || step.id.chars().count() > 120
            || step.title.trim().is_empty()
            || step.title.chars().count() > 200
            || step
                .tool_name
                .as_ref()
                .is_some_and(|value| value.chars().count() > 200)
        {
            anyhow::bail!("assistant task plan step exceeds its field limits");
        }
    }
    for step in &task.checkpoint.completed_steps {
        if step.id.trim().is_empty()
            || step.id.chars().count() > 120
            || step.tool_name.trim().is_empty()
            || step.tool_name.chars().count() > 200
            || !["success", "requiresApproval", "error"].contains(&step.status.as_str())
        {
            anyhow::bail!("assistant task completed step is invalid");
        }
    }
    if serde_json::to_vec(&task.checkpoint)?.len() > 64 * 1024 {
        anyhow::bail!("assistant task checkpoint exceeds 64 KiB");
    }
    if task
        .current_step_id
        .as_ref()
        .is_some_and(|value| value.chars().count() > 120)
        || task
            .current_tool_name
            .as_ref()
            .is_some_and(|value| value.chars().count() > 200)
    {
        anyhow::bail!("assistant task current step fields exceed their limits");
    }
    if task
        .progress
        .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
    {
        anyhow::bail!("assistant task progress must be between 0 and 1");
    }
    Ok(())
}

fn assistant_task_from_row(row: sqlx::sqlite::SqliteRow) -> Result<AssistantTaskRecord> {
    let checkpoint: serde_json::Value = row.get("checkpoint");
    Ok(AssistantTaskRecord {
        id: row.get("id"),
        project_id: row.get("project_id"),
        request_id: row.get("request_id"),
        session_id: row.get("session_id"),
        status: row.get("status"),
        title: row.get("title"),
        detail: row.get("detail"),
        current_step_id: row.get("current_step_id"),
        current_tool_name: row.get("current_tool_name"),
        progress: row.get("progress"),
        checkpoint: serde_json::from_value(checkpoint)?,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        finished_at: row.get("finished_at"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrates_legacy_projects_with_nullable_root_path() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            r#"
            CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES ('legacy', 'Legacy', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let store = MetaStore { pool };
        store.init().await.unwrap();

        let legacy = store.get_project("legacy").await.unwrap().unwrap();
        assert_eq!(legacy.root_path, None);
        let updated = store
            .set_project_root("legacy", Some("C:/workspace"))
            .await
            .unwrap();
        assert_eq!(updated.root_path.as_deref(), Some("C:/workspace"));

        let columns = sqlx::query("PRAGMA table_info(projects)")
            .fetch_all(&store.pool)
            .await
            .unwrap();
        assert!(columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "root_path"));
    }

    #[tokio::test]
    async fn deletes_project_connections_and_cached_resources_without_touching_default() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let store = MetaStore { pool };
        store.init().await.unwrap();

        let project = Project {
            id: "workspace".to_string(),
            name: "Workspace".to_string(),
            root_path: Some("/tmp/workspace".to_string()),
            created_at: 1,
            updated_at: 1,
        };
        store.save_project(&project).await.unwrap();
        store
            .save_connection(&SavedConnection {
                id: "connection".to_string(),
                project_id: project.id.clone(),
                name: "Database".to_string(),
                driver: "postgres".to_string(),
                config: serde_json::json!({}),
                created_at: 1,
                updated_at: 1,
            })
            .await
            .unwrap();
        store
            .save_resources(
                &project.id,
                &[Resource {
                    id: "schema".to_string(),
                    project_id: project.id.clone(),
                    connection_id: "connection".to_string(),
                    parent_id: None,
                    kind: "SCHEMA".to_string(),
                    name: "public".to_string(),
                    metadata: serde_json::json!({}),
                    last_updated: 1,
                }],
            )
            .await
            .unwrap();

        store.delete_project(&project.id).await.unwrap();

        assert!(store.get_project(&project.id).await.unwrap().is_none());
        assert!(store.get_connections(&project.id).await.unwrap().is_empty());
        let resource_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM resources WHERE project_id = ?")
                .bind(&project.id)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(resource_count, 0);

        assert!(store.delete_project("sqls").await.is_err());
        assert!(store.get_project("sqls").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn stores_filters_and_removes_project_query_history() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let store = MetaStore { pool };
        store.init().await.unwrap();

        let project = Project {
            id: "history-project".to_string(),
            name: "History".to_string(),
            root_path: None,
            created_at: 1,
            updated_at: 1,
        };
        store.save_project(&project).await.unwrap();

        let entry = |id: &str, status: &str, started_at: i64| QueryHistoryItem {
            id: id.to_string(),
            project_id: project.id.clone(),
            connection_id: Some("postgres-1".to_string()),
            connection_name: Some("Local PostgreSQL".to_string()),
            driver: Some("postgres".to_string()),
            database_name: Some("app".to_string()),
            schema_name: Some("public".to_string()),
            sql: format!("SELECT '{id}'"),
            status: status.to_string(),
            duration_ms: 12,
            row_count: Some(1),
            error_message: None,
            execution_mode: "console".to_string(),
            started_at,
            finished_at: started_at + 12,
        };

        store
            .save_query_history(&[entry("older", "success", 10), entry("newer", "error", 20)])
            .await
            .unwrap();

        let history = store.get_query_history(&project.id, 500).await.unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, "newer");
        assert_eq!(history[1].id, "older");

        store
            .delete_query_history_item(&project.id, "newer")
            .await
            .unwrap();
        assert_eq!(
            store
                .get_query_history(&project.id, 500)
                .await
                .unwrap()
                .len(),
            1
        );

        store.clear_query_history(&project.id).await.unwrap();
        assert!(store
            .get_query_history(&project.id, 500)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn bounds_query_history_to_five_hundred_entries_per_project() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let store = MetaStore { pool };
        store.init().await.unwrap();

        let entries = (0..505)
            .map(|index| QueryHistoryItem {
                id: format!("entry-{index:03}"),
                project_id: "sqls".to_string(),
                connection_id: None,
                connection_name: None,
                driver: None,
                database_name: None,
                schema_name: None,
                sql: format!("SELECT {index}"),
                status: "success".to_string(),
                duration_ms: 1,
                row_count: Some(1),
                error_message: None,
                execution_mode: "console".to_string(),
                started_at: index,
                finished_at: index + 1,
            })
            .collect::<Vec<_>>();

        store.save_query_history(&entries).await.unwrap();

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM query_history WHERE project_id = 'sqls'")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(count, 500);
        let retained = store.get_query_history("sqls", 500).await.unwrap();
        assert_eq!(retained.first().unwrap().id, "entry-504");
        assert_eq!(retained.last().unwrap().id, "entry-005");
    }

    #[tokio::test]
    async fn stores_project_scoped_assistant_tasks_and_interrupts_only_old_sessions() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let store = MetaStore { pool };
        store.init().await.unwrap();
        for id in ["project-a", "project-b"] {
            store
                .save_project(&Project {
                    id: id.to_string(),
                    name: id.to_string(),
                    root_path: None,
                    created_at: 1,
                    updated_at: 1,
                })
                .await
                .unwrap();
        }

        let task =
            |id: &str, project_id: &str, session_id: &str, status: &str| AssistantTaskRecord {
                id: id.to_string(),
                project_id: project_id.to_string(),
                request_id: format!("request-{id}"),
                session_id: session_id.to_string(),
                status: status.to_string(),
                title: "Assistant task".to_string(),
                detail: None,
                current_step_id: Some("inspect".to_string()),
                current_tool_name: Some("metadata.listObjects".to_string()),
                progress: Some(0.5),
                checkpoint: AssistantTaskCheckpoint {
                    version: 1,
                    mode: "agent".to_string(),
                    plan: vec![AssistantTaskPlanStep {
                        id: "inspect".to_string(),
                        title: "Inspect metadata".to_string(),
                        tool_name: Some("metadata.listObjects".to_string()),
                        requires_approval: false,
                    }],
                    completed_steps: vec![],
                },
                created_at: 10,
                updated_at: 10,
                finished_at: None,
            };
        store
            .save_assistant_task(&task("running-a", "project-a", "old-session", "running"))
            .await
            .unwrap();
        let mut completed = task("completed-a", "project-a", "old-session", "completed");
        completed.finished_at = Some(12);
        store.save_assistant_task(&completed).await.unwrap();
        store
            .save_assistant_task(&task("running-b", "project-b", "old-session", "running"))
            .await
            .unwrap();

        let project_a = store
            .get_assistant_tasks("project-a", "new-session", 50)
            .await
            .unwrap();
        assert_eq!(project_a.len(), 2);
        assert_eq!(
            project_a
                .iter()
                .find(|candidate| candidate.id == "running-a")
                .unwrap()
                .status,
            "interrupted"
        );
        assert_eq!(
            project_a
                .iter()
                .find(|candidate| candidate.id == "completed-a")
                .unwrap()
                .status,
            "completed"
        );

        let project_b = store
            .get_assistant_tasks("project-b", "old-session", 50)
            .await
            .unwrap();
        assert_eq!(project_b.len(), 1);
        assert_eq!(project_b[0].status, "running");

        store
            .clear_finished_assistant_tasks("project-a")
            .await
            .unwrap();
        assert!(store
            .get_assistant_tasks("project-a", "new-session", 50)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            store
                .get_assistant_tasks("project-b", "old-session", 50)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn rejects_unbounded_or_invalid_assistant_task_checkpoints() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let store = MetaStore { pool };
        store.init().await.unwrap();
        let task = AssistantTaskRecord {
            id: "invalid".to_string(),
            project_id: "sqls".to_string(),
            request_id: "request-invalid".to_string(),
            session_id: "session".to_string(),
            status: "running".to_string(),
            title: "Assistant task".to_string(),
            detail: None,
            current_step_id: None,
            current_tool_name: None,
            progress: Some(2.0),
            checkpoint: AssistantTaskCheckpoint {
                version: 1,
                mode: "agent".to_string(),
                plan: vec![],
                completed_steps: vec![],
            },
            created_at: 1,
            updated_at: 1,
            finished_at: None,
        };
        assert!(store.save_assistant_task(&task).await.is_err());
    }
}
