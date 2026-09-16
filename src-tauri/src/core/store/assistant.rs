use super::assistant_validation::{assistant_task_from_row, validate_assistant_task};
use super::models::{current_timestamp_millis, AssistantTaskRecord, MetaStore};
use anyhow::Result;

impl MetaStore {
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
}
