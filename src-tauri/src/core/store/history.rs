use super::models::{MetaStore, QueryHistoryItem};
use anyhow::Result;
use sqlx::Row;

impl MetaStore {
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
}
