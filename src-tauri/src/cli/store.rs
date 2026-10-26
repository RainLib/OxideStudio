use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use serde_json::Value;
use sqlx::{sqlite::SqliteConnectOptions, Pool, Row, Sqlite};
use std::path::{Path, PathBuf};

mod paths;
pub use paths::resolve_data_dir;

const APP_IDENTIFIER: &str = "com.houshuai.oxide-studio";

#[derive(Debug, Clone)]
pub struct StoredConnection {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub driver: String,
    pub config: Value,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    pub id: String,
    pub name: String,
    pub driver: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedResource {
    pub id: String,
    pub connection_id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub name: String,
    pub metadata: Value,
    pub last_updated: i64,
}

#[derive(Debug, Clone, Default)]
pub struct MetadataFilter<'a> {
    pub parent_id: Option<&'a str>,
    pub kind: Option<&'a str>,
    pub prefix: Option<&'a str>,
    pub limit: usize,
    /// Unknown legacy provenance is excluded from a restricted database grant.
    pub database_scope: Option<&'a [String]>,
    /// Legacy DATABASE nodes represent schemas for PostgreSQL, databases for
    /// namespace-oriented drivers. A schema name must never grant a database.
    pub namespace_is_database: bool,
}

#[derive(Clone)]
pub struct HeadlessStore {
    pool: Pool<Sqlite>,
    data_dir: PathBuf,
}

impl HeadlessStore {
    pub fn driver_packages(
        &self,
    ) -> Result<oxide_studio_lib::core::driver_package::DatabaseDriverPackageRegistry> {
        let default_root = paths::default_driver_package_dir(&self.data_dir)?;
        let root = oxide_studio_lib::core::config::ConfigManager::from_directory(&self.data_dir)
            .try_driver_package_store_path(default_root)
            .map_err(anyhow::Error::msg)?;
        Ok(oxide_studio_lib::core::driver_package::DatabaseDriverPackageRegistry::new(root))
    }

    pub async fn open(data_dir: &Path) -> Result<Self> {
        let database_path = data_dir.join("metadata.db");
        if !database_path.is_file() {
            return Err(anyhow!(
                "OxideStudio metadata database was not found at {}",
                database_path.display()
            ));
        }
        let options = SqliteConnectOptions::new()
            .filename(&database_path)
            .read_only(true)
            .create_if_missing(false);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(3)
            .connect_with(options)
            .await
            .with_context(|| {
                format!(
                    "failed to open OxideStudio metadata database at {}",
                    database_path.display()
                )
            })?;
        Ok(Self {
            pool,
            data_dir: data_dir.to_path_buf(),
        })
    }

    pub async fn require_project(&self, project_id: &str) -> Result<()> {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?)")
            .bind(project_id)
            .fetch_one(&self.pool)
            .await
            .context("failed to validate the project grant")?;
        if !exists {
            return Err(anyhow!("granted project does not exist: {project_id}"));
        }
        Ok(())
    }

    /// Load secrets only for the already resolved project/connection snapshot.
    /// The Desktop read API migrates legacy rows, so it cannot be used on this
    /// deliberately read-only SQLite pool.
    pub async fn runtime_config(&self, connection: &StoredConnection) -> Result<Value> {
        let has_credentials: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='connection_credentials'",
        ).fetch_one(&self.pool).await?;
        if has_credentials == 0 {
            return Ok(connection.config.clone());
        }
        let row = sqlx::query(
            "SELECT c.config, c.driver, c.updated_at, s.ciphertext, s.nonce
             FROM connections c LEFT JOIN connection_credentials s
               ON s.project_id=c.project_id AND s.connection_id=c.id
             WHERE c.project_id=? AND c.id=?",
        )
        .bind(&connection.project_id)
        .bind(&connection.id)
        .fetch_optional(&self.pool)
        .await?
        .context("saved connection disappeared before execution")?;
        let mut config: Value = row.try_get("config")?;
        if config != connection.config
            || row.try_get::<String, _>("driver")? != connection.driver
            || row.try_get::<i64, _>("updated_at")? != connection.updated_at
        {
            return Err(anyhow!("saved connection changed; repeat the tool request"));
        }
        let ciphertext = row.try_get::<Option<Vec<u8>>, _>("ciphertext")?;
        let nonce = row.try_get::<Option<Vec<u8>>, _>("nonce")?;
        match (ciphertext, nonce) {
            (Some(ciphertext), Some(nonce)) => {
                oxide_studio_lib::core::store::restore_read_only_connection_credentials(
                    &self.data_dir,
                    &connection.project_id,
                    &connection.id,
                    &mut config,
                    &ciphertext,
                    &nonce,
                )?;
            }
            (None, None) => {}
            _ => {
                return Err(anyhow!(
                    "stored local connection credential record is incomplete"
                ))
            }
        }
        Ok(config)
    }

    pub async fn connections(&self, project_id: &str) -> Result<Vec<StoredConnection>> {
        let rows = sqlx::query(
            "SELECT id, project_id, name, driver, config, updated_at FROM connections WHERE project_id = ? ORDER BY name LIMIT 1001",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
        .context("failed to read project connections")?;
        if rows.len() > 1_000 {
            return Err(anyhow!(
                "project connection count exceeds the safe CLI limit"
            ));
        }
        rows.into_iter()
            .map(|row| {
                Ok(StoredConnection {
                    id: row.try_get("id")?,
                    project_id: row.try_get("project_id")?,
                    name: row.try_get("name")?,
                    driver: row.try_get("driver")?,
                    config: row.try_get("config")?,
                    updated_at: row.try_get("updated_at")?,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()
            .context("failed to decode project connections")
    }

    pub async fn connection_summaries(
        &self,
        project_id: &str,
        connection_grant: Option<&str>,
    ) -> Result<Vec<ConnectionSummary>> {
        let connections = self.connections(project_id).await?;
        let summaries = connections
            .into_iter()
            .filter(|connection| connection_grant.is_none_or(|granted| granted == connection.id))
            .map(|connection| ConnectionSummary {
                id: connection.id,
                name: connection.name,
                driver: connection.driver,
                host: config_string(&connection.config, "host"),
                database: config_string(&connection.config, "database"),
                updated_at: connection.updated_at,
            })
            .collect();
        Ok(summaries)
    }

    pub async fn metadata(
        &self,
        project_id: &str,
        connection_id: &str,
        filter: MetadataFilter<'_>,
    ) -> Result<Vec<CachedResource>> {
        let parent_id = filter.parent_id.map(str::to_string);
        let kind = filter.kind.map(str::to_string);
        let prefix = escape_like(filter.prefix.unwrap_or_default());
        let pattern = format!("{prefix}%");
        let limit = filter.limit.clamp(1, 200) as i64;
        let database_scope = filter
            .database_scope
            .map(|scope| serde_json::json!(scope).to_string());
        let rows = sqlx::query(
            r#"
            WITH RECURSIVE ancestry(resource_id, parent_id, database_name, depth) AS (
                SELECT id, parent_id,
                    COALESCE(
                        CASE WHEN json_valid(metadata) THEN
                            COALESCE(json_extract(metadata, '$.database'), json_extract(metadata, '$.databaseName'))
                        END,
                        CASE WHEN ? AND UPPER(kind) = 'DATABASE' THEN name END
                    ), 0
                FROM resources WHERE project_id = ? AND connection_id = ?
                UNION ALL
                SELECT ancestry.resource_id, parent.parent_id,
                    COALESCE(ancestry.database_name,
                        CASE WHEN json_valid(parent.metadata) THEN
                            COALESCE(json_extract(parent.metadata, '$.database'), json_extract(parent.metadata, '$.databaseName'))
                        END,
                        CASE WHEN ? AND UPPER(parent.kind) = 'DATABASE' THEN parent.name END
                    ), ancestry.depth + 1
                FROM ancestry JOIN resources parent ON parent.id = ancestry.parent_id
                WHERE parent.project_id = ? AND parent.connection_id = ? AND ancestry.depth < 32
            )
            SELECT r.id, r.connection_id, r.parent_id, r.kind, r.name, r.metadata, r.last_updated
            FROM resources r
            WHERE r.project_id = ?
              AND r.connection_id = ?
              AND (? IS NULL OR parent_id = ?)
              AND (? IS NULL OR UPPER(kind) = UPPER(?))
              AND name LIKE ? ESCAPE '\'
              AND (? IS NULL OR EXISTS (
                  SELECT 1 FROM ancestry, json_each(?) allowed
                  WHERE ancestry.resource_id = r.id
                    AND LOWER(TRIM(ancestry.database_name, ' `"[]')) = LOWER(TRIM(allowed.value, ' `"[]'))
              ))
            ORDER BY name
            LIMIT ?
            "#,
        )
        .bind(filter.namespace_is_database)
        .bind(project_id)
        .bind(connection_id)
        .bind(filter.namespace_is_database)
        .bind(project_id)
        .bind(connection_id)
        .bind(project_id)
        .bind(connection_id)
        .bind(parent_id.as_deref())
        .bind(parent_id.as_deref())
        .bind(kind.as_deref())
        .bind(kind.as_deref())
        .bind(pattern)
        .bind(database_scope.as_deref())
        .bind(database_scope.as_deref())
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .context("failed to read cached project metadata")?;

        rows.into_iter()
            .map(|row| {
                let mut metadata: Value = row.try_get("metadata")?;
                redact_sensitive_fields(&mut metadata);
                Ok(CachedResource {
                    id: row.try_get("id")?,
                    connection_id: row.try_get("connection_id")?,
                    parent_id: row.try_get("parent_id")?,
                    kind: row.try_get("kind")?,
                    name: row.try_get("name")?,
                    metadata,
                    last_updated: row.try_get("last_updated")?,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()
            .context("failed to decode cached project metadata")
    }
}

fn config_string(config: &Value, key: &str) -> Option<String> {
    config
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn redact_sensitive_fields(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                let normalized: String = key
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric())
                    .flat_map(char::to_lowercase)
                    .collect();
                if [
                    "password",
                    "secret",
                    "token",
                    "connectionurl",
                    "privatekey",
                    "privatekeypassphrase",
                ]
                .contains(&normalized.as_str())
                {
                    *value = Value::String("[redacted]".to_string());
                } else {
                    redact_sensitive_fields(value);
                }
            }
        }
        Value::Array(values) => values.iter_mut().for_each(redact_sensitive_fields),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn metadata_redaction_is_recursive() {
        let mut value = json!({
            "safe": "kept",
            "nested": {"password": "secret", "connectionUrl": "postgres://secret"}
        });
        redact_sensitive_fields(&mut value);
        assert_eq!(value["safe"], "kept");
        assert_eq!(value["nested"]["password"], "[redacted]");
        assert_eq!(value["nested"]["connectionUrl"], "[redacted]");
    }

    #[test]
    fn like_prefix_does_not_accept_wildcard_injection() {
        assert_eq!(escape_like("ab%_\\"), "ab\\%\\_\\\\");
    }
}
