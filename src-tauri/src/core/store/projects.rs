use super::models::{current_timestamp_millis, MetaStore, Project};
use anyhow::Context;
use anyhow::Result;
use sqlx::Row;

impl MetaStore {
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
        sqlx::query("DELETE FROM saved_sql_files WHERE project_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM saved_sql_folders WHERE project_id = ?")
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
        sqlx::query("DELETE FROM connection_credentials WHERE project_id = ?")
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
}
