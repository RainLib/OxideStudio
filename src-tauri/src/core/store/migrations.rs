use super::models::MetaStore;
use anyhow::Result;
use sqlx::Row;

impl MetaStore {
    pub(super) async fn migrate_connections_project_scope(&self) -> Result<()> {
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

    pub(super) async fn migrate_projects_root_path(&self) -> Result<()> {
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

    pub(super) async fn migrate_resources_project_scope(&self) -> Result<()> {
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
}
