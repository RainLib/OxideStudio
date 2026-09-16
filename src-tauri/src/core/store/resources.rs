use super::models::{MetaStore, Resource};
use anyhow::Result;
use sqlx::Row;

impl MetaStore {
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
