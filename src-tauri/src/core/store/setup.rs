use super::credential_crypto::load_or_create_credential_key;
#[cfg(test)]
use super::models::CONNECTION_CREDENTIAL_KEY_BYTES;
use super::models::{current_timestamp_millis, MetaStore, CONNECTION_CREDENTIAL_KEY_FILE};
use crate::core::private_file::{create_private_directory, restrict_sqlite_database_permissions};
use anyhow::Context;
use anyhow::Result;
use sqlx::sqlite::SqlitePoolOptions;
#[cfg(test)]
use sqlx::{Pool, Sqlite};
#[cfg(feature = "desktop")]
use tauri::{AppHandle, Manager};
#[cfg(test)]
use zeroize::Zeroizing;

impl MetaStore {
    #[cfg(test)]
    pub(crate) fn for_test(pool: Pool<Sqlite>) -> Self {
        Self {
            pool,
            credential_key: Zeroizing::new([7_u8; CONNECTION_CREDENTIAL_KEY_BYTES]),
        }
    }

    #[cfg(feature = "desktop")]
    pub async fn new(app: &AppHandle) -> Result<Self> {
        let app_dir = app
            .path()
            .app_config_dir()
            .context("failed to get app config dir")?;
        Self::open(&app_dir).await
    }

    /// Open the shared metadata store without creating a GUI runtime. Public
    /// read-only agents use HeadlessStore instead and never call this writable
    /// initialization path.
    pub async fn open(app_dir: &std::path::Path) -> Result<Self> {
        let db_path = app_dir.join("metadata.db");
        let credential_key =
            load_or_create_credential_key(&app_dir.join(CONNECTION_CREDENTIAL_KEY_FILE))?;

        // Keep the credential key, SQLite metadata and its WAL sidecars in an
        // owner-private directory even when an older installation created the
        // application config root with the default umask.
        if let Some(parent) = db_path.parent() {
            create_private_directory(parent).context("failed to create config directory")?;
        }

        let db_url = format!("sqlite://{}?mode=rwc", db_path.to_string_lossy());

        // Run before connecting (to repair an existing file) and again after
        // migrations, when SQLite may have created WAL/journal sidecars.
        restrict_sqlite_database_permissions(&db_path);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await
            .context("failed to connect to metadata database")?;

        let store = Self {
            pool,
            credential_key,
        };
        let initialized = store.init().await;
        restrict_sqlite_database_permissions(&db_path);
        initialized?;

        Ok(store)
    }

    pub(crate) async fn init(&self) -> Result<()> {
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
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS connection_credentials (
                project_id TEXT NOT NULL,
                connection_id TEXT NOT NULL,
                ciphertext BLOB NOT NULL,
                nonce BLOB NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (project_id, connection_id)
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
            CREATE TABLE IF NOT EXISTS saved_sql_folders (
                project_id TEXT NOT NULL,
                id TEXT NOT NULL,
                connection_id TEXT,
                parent_folder_id TEXT,
                name TEXT NOT NULL,
                order_index INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY(project_id, id),
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_saved_sql_folders_tree ON saved_sql_folders(project_id, connection_id, parent_folder_id, order_index, name)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_sql_folders_location_name ON saved_sql_folders(project_id, COALESCE(connection_id, ''), COALESCE(parent_folder_id, ''), name COLLATE NOCASE)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS saved_sql_files (
                project_id TEXT NOT NULL,
                id TEXT NOT NULL,
                connection_id TEXT,
                folder_id TEXT,
                name TEXT NOT NULL,
                database_name TEXT,
                schema_name TEXT,
                sql TEXT NOT NULL,
                order_index INTEGER NOT NULL DEFAULT 0,
                open_count INTEGER NOT NULL DEFAULT 0,
                opened_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY(project_id, id),
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_saved_sql_files_tree ON saved_sql_files(project_id, folder_id, order_index, name)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_sql_files_location_name ON saved_sql_files(project_id, COALESCE(connection_id, ''), COALESCE(folder_id, ''), name COLLATE NOCASE)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_saved_sql_files_recent ON saved_sql_files(project_id, updated_at DESC, id DESC)",
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

        // Provider capability catalogs are safe to persist, but their lookup
        // identity may contain executable paths, profile names and private
        // environment values. Only an opaque keyed digest is stored here.
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS cli_capability_cache (
                cache_key TEXT PRIMARY KEY NOT NULL,
                resource_kind TEXT NOT NULL CHECK(resource_kind IN ('models', 'commands', 'efforts')),
                payload TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_cli_capability_cache_expiry ON cli_capability_cache(expires_at)",
        )
        .execute(&self.pool)
        .await?;

        // Persistent external-runtime telemetry is intentionally restricted to
        // package identity, stable event codes, counters, and timestamps. It
        // must never become a sink for connection ids, URLs, stderr, or SQL.
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS driver_runtime_telemetry (
                driver_id TEXT NOT NULL,
                package_version TEXT NOT NULL,
                launch_count INTEGER NOT NULL DEFAULT 0,
                observed_exit_count INTEGER NOT NULL DEFAULT 0,
                reconnect_attempt_count INTEGER NOT NULL DEFAULT 0,
                reconnect_success_count INTEGER NOT NULL DEFAULT 0,
                reconnect_failure_count INTEGER NOT NULL DEFAULT 0,
                reconnect_budget_block_count INTEGER NOT NULL DEFAULT 0,
                last_event_code TEXT NOT NULL,
                last_event_at INTEGER NOT NULL,
                last_started_at INTEGER,
                last_exit_observed_at INTEGER,
                last_reconnect_at INTEGER,
                PRIMARY KEY(driver_id, package_version)
            );
            "#,
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_driver_runtime_telemetry_time ON driver_runtime_telemetry(last_event_at DESC)",
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
}
