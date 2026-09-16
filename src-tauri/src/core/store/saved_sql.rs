use super::models::{
    validate_saved_sql_identity, MetaStore, SavedSqlFile, SavedSqlFolder, SavedSqlLibrary,
};
use anyhow::{anyhow, Result};
use sqlx::Row;

impl MetaStore {
    pub async fn load_saved_sql_library(&self, project_id: &str) -> Result<SavedSqlLibrary> {
        if project_id.trim().is_empty() {
            anyhow::bail!("saved SQL project id cannot be empty");
        }
        let folder_rows = sqlx::query(
            r#"
            SELECT id, project_id, connection_id, parent_folder_id, name,
                   order_index, created_at, updated_at
            FROM saved_sql_folders
            WHERE project_id = ?
            ORDER BY order_index, name COLLATE NOCASE, id
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        let file_rows = sqlx::query(
            r#"
            SELECT id, project_id, connection_id, folder_id, name,
                   database_name, schema_name, order_index, open_count,
                   opened_at, created_at, updated_at
            FROM saved_sql_files
            WHERE project_id = ?
            ORDER BY order_index, name COLLATE NOCASE, id
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(SavedSqlLibrary {
            folders: folder_rows
                .into_iter()
                .map(|row| SavedSqlFolder {
                    id: row.get("id"),
                    project_id: row.get("project_id"),
                    connection_id: row.get("connection_id"),
                    parent_folder_id: row.get("parent_folder_id"),
                    name: row.get("name"),
                    order_index: row.get("order_index"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                })
                .collect(),
            files: file_rows
                .into_iter()
                .map(|row| SavedSqlFile {
                    id: row.get("id"),
                    project_id: row.get("project_id"),
                    connection_id: row.get("connection_id"),
                    folder_id: row.get("folder_id"),
                    name: row.get("name"),
                    database_name: row.get("database_name"),
                    schema_name: row.get("schema_name"),
                    sql: String::new(),
                    sql_loaded: false,
                    order_index: row.get("order_index"),
                    open_count: row.get("open_count"),
                    opened_at: row.get("opened_at"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                })
                .collect(),
        })
    }

    pub async fn load_saved_sql_file(
        &self,
        project_id: &str,
        id: &str,
    ) -> Result<Option<SavedSqlFile>> {
        let row = sqlx::query(
            r#"
            SELECT id, project_id, connection_id, folder_id, name,
                   database_name, schema_name, sql, order_index, open_count,
                   opened_at, created_at, updated_at
            FROM saved_sql_files
            WHERE project_id = ? AND id = ?
            "#,
        )
        .bind(project_id)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| SavedSqlFile {
            id: row.get("id"),
            project_id: row.get("project_id"),
            connection_id: row.get("connection_id"),
            folder_id: row.get("folder_id"),
            name: row.get("name"),
            database_name: row.get("database_name"),
            schema_name: row.get("schema_name"),
            sql: row.get("sql"),
            sql_loaded: true,
            order_index: row.get("order_index"),
            open_count: row.get("open_count"),
            opened_at: row.get("opened_at"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }))
    }

    pub async fn load_saved_sql_files(&self, project_id: &str) -> Result<Vec<SavedSqlFile>> {
        if project_id.trim().is_empty() {
            anyhow::bail!("saved SQL project id cannot be empty");
        }
        let rows = sqlx::query(
            r#"
            SELECT id, project_id, connection_id, folder_id, name,
                   database_name, schema_name, sql, order_index, open_count,
                   opened_at, created_at, updated_at
            FROM saved_sql_files
            WHERE project_id = ?
            ORDER BY order_index, name COLLATE NOCASE, id
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| SavedSqlFile {
                id: row.get("id"),
                project_id: row.get("project_id"),
                connection_id: row.get("connection_id"),
                folder_id: row.get("folder_id"),
                name: row.get("name"),
                database_name: row.get("database_name"),
                schema_name: row.get("schema_name"),
                sql: row.get("sql"),
                sql_loaded: true,
                order_index: row.get("order_index"),
                open_count: row.get("open_count"),
                opened_at: row.get("opened_at"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect())
    }

    pub async fn save_saved_sql_folder(&self, folder: &SavedSqlFolder) -> Result<()> {
        validate_saved_sql_identity(&folder.project_id, &folder.id, &folder.name)?;
        if folder.order_index < 0 || folder.updated_at < folder.created_at {
            anyhow::bail!("saved SQL folder ordering or timing is invalid");
        }
        let mut tx = self.pool.begin().await?;
        let project_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?)")
                .bind(&folder.project_id)
                .fetch_one(&mut *tx)
                .await?;
        if !project_exists {
            anyhow::bail!("saved SQL project not found: {}", folder.project_id);
        }

        if let Some(parent_id) = folder.parent_folder_id.as_deref() {
            let mut cursor = Some(parent_id.to_string());
            let mut depth = 0;
            while let Some(candidate_id) = cursor {
                if candidate_id == folder.id {
                    anyhow::bail!("saved SQL folder cannot contain itself");
                }
                let parent = sqlx::query(
                    "SELECT connection_id, parent_folder_id FROM saved_sql_folders WHERE project_id = ? AND id = ?",
                )
                .bind(&folder.project_id)
                .bind(&candidate_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| anyhow!("saved SQL parent folder not found: {candidate_id}"))?;
                let parent_connection: Option<String> = parent.get("connection_id");
                if parent_connection != folder.connection_id {
                    anyhow::bail!(
                        "saved SQL child and parent folders must use the same connection scope"
                    );
                }
                cursor = parent.get("parent_folder_id");
                depth += 1;
                if depth > 128 {
                    anyhow::bail!("saved SQL folder hierarchy is too deep");
                }
            }
        }

        let duplicate: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM saved_sql_folders
                WHERE project_id = ? AND id <> ?
                  AND COALESCE(connection_id, '') = COALESCE(?, '')
                  AND COALESCE(parent_folder_id, '') = COALESCE(?, '')
                  AND name = ? COLLATE NOCASE
            )
            "#,
        )
        .bind(&folder.project_id)
        .bind(&folder.id)
        .bind(&folder.connection_id)
        .bind(&folder.parent_folder_id)
        .bind(folder.name.trim())
        .fetch_one(&mut *tx)
        .await?;
        if duplicate {
            anyhow::bail!(
                "a saved SQL folder with this name already exists in the target location"
            );
        }

        sqlx::query(
            r#"
            INSERT INTO saved_sql_folders (
                project_id, id, connection_id, parent_folder_id, name,
                order_index, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, id) DO UPDATE SET
                connection_id = excluded.connection_id,
                parent_folder_id = excluded.parent_folder_id,
                name = excluded.name,
                order_index = excluded.order_index,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&folder.project_id)
        .bind(&folder.id)
        .bind(&folder.connection_id)
        .bind(&folder.parent_folder_id)
        .bind(folder.name.trim())
        .bind(folder.order_index)
        .bind(folder.created_at)
        .bind(folder.updated_at)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn delete_saved_sql_folder(&self, project_id: &str, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            WITH RECURSIVE descendants(id) AS (
                SELECT id FROM saved_sql_folders WHERE project_id = ? AND id = ?
                UNION ALL
                SELECT child.id FROM saved_sql_folders child
                JOIN descendants parent ON child.parent_folder_id = parent.id
                WHERE child.project_id = ?
            )
            DELETE FROM saved_sql_files
            WHERE project_id = ? AND folder_id IN (SELECT id FROM descendants)
            "#,
        )
        .bind(project_id)
        .bind(id)
        .bind(project_id)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            WITH RECURSIVE descendants(id) AS (
                SELECT id FROM saved_sql_folders WHERE project_id = ? AND id = ?
                UNION ALL
                SELECT child.id FROM saved_sql_folders child
                JOIN descendants parent ON child.parent_folder_id = parent.id
                WHERE child.project_id = ?
            )
            DELETE FROM saved_sql_folders
            WHERE project_id = ? AND id IN (SELECT id FROM descendants)
            "#,
        )
        .bind(project_id)
        .bind(id)
        .bind(project_id)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn save_saved_sql_file(&self, file: &SavedSqlFile) -> Result<()> {
        validate_saved_sql_identity(&file.project_id, &file.id, &file.name)?;
        if file.sql.len() > 16 * 1024 * 1024 {
            anyhow::bail!("saved SQL content exceeds the 16 MiB limit");
        }
        if file.order_index < 0 || file.open_count < 0 || file.updated_at < file.created_at {
            anyhow::bail!("saved SQL file ordering, usage, or timing is invalid");
        }
        let mut tx = self.pool.begin().await?;
        let project_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?)")
                .bind(&file.project_id)
                .fetch_one(&mut *tx)
                .await?;
        if !project_exists {
            anyhow::bail!("saved SQL project not found: {}", file.project_id);
        }
        if let Some(folder_id) = file.folder_id.as_deref() {
            let folder_connection: Option<Option<String>> = sqlx::query_scalar(
                "SELECT connection_id FROM saved_sql_folders WHERE project_id = ? AND id = ?",
            )
            .bind(&file.project_id)
            .bind(folder_id)
            .fetch_optional(&mut *tx)
            .await?;
            let folder_connection = folder_connection
                .ok_or_else(|| anyhow!("saved SQL target folder not found: {folder_id}"))?;
            if folder_connection != file.connection_id {
                anyhow::bail!("saved SQL file and folder must use the same connection scope");
            }
        }
        let duplicate: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM saved_sql_files
                WHERE project_id = ? AND id <> ?
                  AND COALESCE(connection_id, '') = COALESCE(?, '')
                  AND COALESCE(folder_id, '') = COALESCE(?, '')
                  AND name = ? COLLATE NOCASE
            )
            "#,
        )
        .bind(&file.project_id)
        .bind(&file.id)
        .bind(&file.connection_id)
        .bind(&file.folder_id)
        .bind(file.name.trim())
        .fetch_one(&mut *tx)
        .await?;
        if duplicate {
            anyhow::bail!("a saved SQL file with this name already exists in the target location");
        }

        sqlx::query(
            r#"
            INSERT INTO saved_sql_files (
                project_id, id, connection_id, folder_id, name,
                database_name, schema_name, sql, order_index, open_count,
                opened_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, id) DO UPDATE SET
                connection_id = excluded.connection_id,
                folder_id = excluded.folder_id,
                name = excluded.name,
                database_name = excluded.database_name,
                schema_name = excluded.schema_name,
                sql = excluded.sql,
                order_index = excluded.order_index,
                open_count = excluded.open_count,
                opened_at = excluded.opened_at,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&file.project_id)
        .bind(&file.id)
        .bind(&file.connection_id)
        .bind(&file.folder_id)
        .bind(file.name.trim())
        .bind(&file.database_name)
        .bind(&file.schema_name)
        .bind(&file.sql)
        .bind(file.order_index)
        .bind(file.open_count)
        .bind(file.opened_at)
        .bind(file.created_at)
        .bind(file.updated_at)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Persists an imported SQL library in one transaction. Folders must be
    /// ordered before their descendants so parent validation can use the rows
    /// inserted earlier in the same transaction.
    pub async fn save_saved_sql_batch(
        &self,
        folders: &[SavedSqlFolder],
        files: &[SavedSqlFile],
    ) -> Result<()> {
        if folders.is_empty() && files.is_empty() {
            return Ok(());
        }
        if folders.len() > 5_000 || files.len() > 5_000 {
            anyhow::bail!("saved SQL batch exceeds the 5,000 item limit");
        }
        let total_sql_bytes = files.iter().try_fold(0usize, |total, file| {
            total
                .checked_add(file.sql.len())
                .ok_or_else(|| anyhow!("saved SQL batch size overflow"))
        })?;
        if total_sql_bytes > 64 * 1024 * 1024 {
            anyhow::bail!("saved SQL batch exceeds the 64 MiB content limit");
        }

        let project_id = folders
            .first()
            .map(|folder| folder.project_id.as_str())
            .or_else(|| files.first().map(|file| file.project_id.as_str()))
            .ok_or_else(|| anyhow!("saved SQL batch has no project"))?;
        if project_id.trim().is_empty()
            || folders.iter().any(|folder| folder.project_id != project_id)
            || files.iter().any(|file| file.project_id != project_id)
        {
            anyhow::bail!("saved SQL batch must target one non-empty project");
        }

        let mut tx = self.pool.begin().await?;
        let project_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?)")
                .bind(project_id)
                .fetch_one(&mut *tx)
                .await?;
        if !project_exists {
            anyhow::bail!("saved SQL project not found: {project_id}");
        }

        for folder in folders {
            validate_saved_sql_identity(&folder.project_id, &folder.id, &folder.name)?;
            if folder.order_index < 0 || folder.updated_at < folder.created_at {
                anyhow::bail!("saved SQL folder ordering or timing is invalid");
            }
            if let Some(parent_id) = folder.parent_folder_id.as_deref() {
                let mut cursor = Some(parent_id.to_string());
                let mut depth = 0;
                while let Some(candidate_id) = cursor {
                    if candidate_id == folder.id {
                        anyhow::bail!("saved SQL folder cannot contain itself");
                    }
                    let parent = sqlx::query(
                        "SELECT connection_id, parent_folder_id FROM saved_sql_folders WHERE project_id = ? AND id = ?",
                    )
                    .bind(project_id)
                    .bind(&candidate_id)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or_else(|| anyhow!("saved SQL parent folder not found: {candidate_id}"))?;
                    let parent_connection: Option<String> = parent.get("connection_id");
                    if parent_connection != folder.connection_id {
                        anyhow::bail!(
                            "saved SQL child and parent folders must use the same connection scope"
                        );
                    }
                    cursor = parent.get("parent_folder_id");
                    depth += 1;
                    if depth > 128 {
                        anyhow::bail!("saved SQL folder hierarchy is too deep");
                    }
                }
            }
            let duplicate: bool = sqlx::query_scalar(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM saved_sql_folders
                    WHERE project_id = ? AND id <> ?
                      AND COALESCE(connection_id, '') = COALESCE(?, '')
                      AND COALESCE(parent_folder_id, '') = COALESCE(?, '')
                      AND name = ? COLLATE NOCASE
                )
                "#,
            )
            .bind(project_id)
            .bind(&folder.id)
            .bind(&folder.connection_id)
            .bind(&folder.parent_folder_id)
            .bind(folder.name.trim())
            .fetch_one(&mut *tx)
            .await?;
            if duplicate {
                anyhow::bail!(
                    "a saved SQL folder with this name already exists in the target location"
                );
            }
            sqlx::query(
                r#"
                INSERT INTO saved_sql_folders (
                    project_id, id, connection_id, parent_folder_id, name,
                    order_index, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, id) DO UPDATE SET
                    connection_id = excluded.connection_id,
                    parent_folder_id = excluded.parent_folder_id,
                    name = excluded.name,
                    order_index = excluded.order_index,
                    updated_at = excluded.updated_at
                "#,
            )
            .bind(project_id)
            .bind(&folder.id)
            .bind(&folder.connection_id)
            .bind(&folder.parent_folder_id)
            .bind(folder.name.trim())
            .bind(folder.order_index)
            .bind(folder.created_at)
            .bind(folder.updated_at)
            .execute(&mut *tx)
            .await?;
        }

        for file in files {
            validate_saved_sql_identity(&file.project_id, &file.id, &file.name)?;
            if file.sql.len() > 16 * 1024 * 1024 {
                anyhow::bail!("saved SQL content exceeds the 16 MiB limit");
            }
            if file.order_index < 0 || file.open_count < 0 || file.updated_at < file.created_at {
                anyhow::bail!("saved SQL file ordering, usage, or timing is invalid");
            }
            if let Some(folder_id) = file.folder_id.as_deref() {
                let folder_connection: Option<Option<String>> = sqlx::query_scalar(
                    "SELECT connection_id FROM saved_sql_folders WHERE project_id = ? AND id = ?",
                )
                .bind(project_id)
                .bind(folder_id)
                .fetch_optional(&mut *tx)
                .await?;
                let folder_connection = folder_connection
                    .ok_or_else(|| anyhow!("saved SQL target folder not found: {folder_id}"))?;
                if folder_connection != file.connection_id {
                    anyhow::bail!("saved SQL file and folder must use the same connection scope");
                }
            }
            let duplicate: bool = sqlx::query_scalar(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM saved_sql_files
                    WHERE project_id = ? AND id <> ?
                      AND COALESCE(connection_id, '') = COALESCE(?, '')
                      AND COALESCE(folder_id, '') = COALESCE(?, '')
                      AND name = ? COLLATE NOCASE
                )
                "#,
            )
            .bind(project_id)
            .bind(&file.id)
            .bind(&file.connection_id)
            .bind(&file.folder_id)
            .bind(file.name.trim())
            .fetch_one(&mut *tx)
            .await?;
            if duplicate {
                anyhow::bail!(
                    "a saved SQL file with this name already exists in the target location"
                );
            }
            sqlx::query(
                r#"
                INSERT INTO saved_sql_files (
                    project_id, id, connection_id, folder_id, name,
                    database_name, schema_name, sql, order_index, open_count,
                    opened_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, id) DO UPDATE SET
                    connection_id = excluded.connection_id,
                    folder_id = excluded.folder_id,
                    name = excluded.name,
                    database_name = excluded.database_name,
                    schema_name = excluded.schema_name,
                    sql = excluded.sql,
                    order_index = excluded.order_index,
                    open_count = excluded.open_count,
                    opened_at = excluded.opened_at,
                    updated_at = excluded.updated_at
                "#,
            )
            .bind(project_id)
            .bind(&file.id)
            .bind(&file.connection_id)
            .bind(&file.folder_id)
            .bind(file.name.trim())
            .bind(&file.database_name)
            .bind(&file.schema_name)
            .bind(&file.sql)
            .bind(file.order_index)
            .bind(file.open_count)
            .bind(file.opened_at)
            .bind(file.created_at)
            .bind(file.updated_at)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn delete_saved_sql_file(&self, project_id: &str, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM saved_sql_files WHERE project_id = ? AND id = ?")
            .bind(project_id)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn record_saved_sql_file_opened(
        &self,
        project_id: &str,
        id: &str,
        opened_at: i64,
    ) -> Result<()> {
        let result = sqlx::query(
            "UPDATE saved_sql_files SET open_count = open_count + 1, opened_at = ? WHERE project_id = ? AND id = ?",
        )
        .bind(opened_at)
        .bind(project_id)
        .bind(id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            anyhow::bail!("saved SQL file not found: {id}");
        }
        Ok(())
    }
}
