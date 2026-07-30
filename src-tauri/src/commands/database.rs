use crate::core::{
    dialect::{
        all_database_capabilities, database_capabilities_for_driver, DatabaseCapabilities,
        DatabaseKind,
    },
    manager::ConnectionManager,
    protocol::Response,
};
use serde::Serialize;
use std::str::FromStr;
use tauri::State;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDriverInstallation {
    pub driver: &'static str,
    pub display_name: &'static str,
    pub client_library: &'static str,
    pub client_version: &'static str,
    pub distribution: &'static str,
    pub update_policy: &'static str,
    pub independently_updatable: bool,
    pub server_version_policy: &'static str,
    pub implementation: &'static str,
}

fn bundled_database_driver_installations() -> Vec<DatabaseDriverInstallation> {
    let sqlx_version = env!("OXIDE_DRIVER_SQLX_VERSION");
    [
        (
            "postgres",
            "PostgreSQL",
            "sqlx-postgres",
            sqlx_version,
            "native Rust client",
        ),
        (
            "mysql",
            "MySQL",
            "sqlx-mysql",
            sqlx_version,
            "native Rust client",
        ),
        (
            "mongodb",
            "MongoDB",
            "mongodb",
            env!("OXIDE_DRIVER_MONGODB_VERSION"),
            "native Rust client",
        ),
        (
            "redis",
            "Redis",
            "redis",
            env!("OXIDE_DRIVER_REDIS_VERSION"),
            "native Rust client",
        ),
        (
            "elasticsearch",
            "Elasticsearch",
            "reqwest",
            env!("OXIDE_DRIVER_REQWEST_VERSION"),
            "OxideStudio HTTP adapter",
        ),
    ]
    .into_iter()
    .map(
        |(driver, display_name, client_library, client_version, implementation)| {
            DatabaseDriverInstallation {
                driver,
                display_name,
                client_library,
                client_version,
                distribution: "bundled",
                update_policy: "application-update",
                independently_updatable: false,
                server_version_policy: "detected-at-connection",
                implementation,
            }
        },
    )
    .collect()
}

fn validate_token(value: &str, field: &str) -> Result<(), String> {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        Ok(())
    } else {
        Err(format!("Invalid {field}: {value}"))
    }
}

fn validate_namespace_name(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Database name is required".to_string());
    }

    Ok(value)
}

fn is_protected_namespace(kind: DatabaseKind, value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    match kind {
        DatabaseKind::Postgres => {
            normalized == "information_schema"
                || normalized == "pg_catalog"
                || normalized == "pg_toast"
                || normalized.starts_with("pg_temp_")
                || normalized.starts_with("pg_toast_temp_")
        }
        DatabaseKind::Mysql => {
            matches!(
                normalized.as_str(),
                "information_schema" | "mysql" | "performance_schema" | "sys"
            )
        }
    }
}

fn ensure_mutable_namespace(kind: DatabaseKind, value: &str) -> Result<&str, String> {
    let value = validate_namespace_name(value)?;
    if is_protected_namespace(kind, value) {
        return Err(format!(
            "System database/schema cannot be modified: {value}"
        ));
    }

    Ok(value)
}

fn create_database_sql(
    kind: DatabaseKind,
    database: &str,
    charset: Option<&str>,
    collation: Option<&str>,
    owner: Option<&str>,
) -> Result<String, String> {
    let database = ensure_mutable_namespace(kind, database)?;
    let mut sql = match kind {
        DatabaseKind::Postgres => {
            let mut sql = format!("CREATE SCHEMA {}", kind.quote_identifier(database));
            if let Some(owner) = owner.map(str::trim).filter(|value| !value.is_empty()) {
                sql.push_str(" AUTHORIZATION ");
                sql.push_str(&kind.quote_identifier(owner));
            }
            sql
        }
        DatabaseKind::Mysql => format!("CREATE DATABASE {}", kind.quote_identifier(database)),
    };

    if matches!(kind, DatabaseKind::Mysql) {
        if let Some(charset) = charset.map(str::trim).filter(|value| !value.is_empty()) {
            validate_token(charset, "charset")?;
            sql.push_str(" CHARACTER SET ");
            sql.push_str(charset);
        }

        if let Some(collation) = collation.map(str::trim).filter(|value| !value.is_empty()) {
            validate_token(collation, "collation")?;
            sql.push_str(" COLLATE ");
            sql.push_str(collation);
        }
    }

    sql.push(';');
    Ok(sql)
}

fn drop_database_sql(kind: DatabaseKind, database: &str, cascade: bool) -> Result<String, String> {
    let database = ensure_mutable_namespace(kind, database)?;
    match kind {
        DatabaseKind::Postgres => {
            let behavior = if cascade { " CASCADE" } else { " RESTRICT" };
            Ok(format!(
                "DROP SCHEMA {}{};",
                kind.quote_identifier(database),
                behavior
            ))
        }
        DatabaseKind::Mysql => Ok(format!(
            "DROP DATABASE {};",
            kind.quote_identifier(database)
        )),
    }
}

fn rename_database_sql(
    kind: DatabaseKind,
    old_name: &str,
    new_name: &str,
) -> Result<String, String> {
    let old_name = ensure_mutable_namespace(kind, old_name)?;
    let new_name = ensure_mutable_namespace(kind, new_name)?;
    if old_name == new_name {
        return Err("New database name must be different".to_string());
    }

    match kind {
        DatabaseKind::Postgres => Ok(format!(
            "ALTER SCHEMA {} RENAME TO {};",
            kind.quote_identifier(old_name),
            kind.quote_identifier(new_name)
        )),
        DatabaseKind::Mysql => Err(
            "MySQL does not support renaming databases safely; create a new database and move objects explicitly"
                .to_string(),
        ),
    }
}

#[tauri::command]
pub async fn get_database_capabilities(
    driver: String,
) -> Result<Response<DatabaseCapabilities>, String> {
    let result = DatabaseKind::from_str(&driver)
        .map(DatabaseKind::capabilities)
        .or_else(|_| database_capabilities_for_driver(&driver))
        .map_err(|error| error.to_string());

    match result {
        Ok(capabilities) => Ok(Response::ok(capabilities)),
        Err(error) => Ok(Response::err("DATABASE_CAPABILITIES_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn list_database_capabilities() -> Result<Response<Vec<DatabaseCapabilities>>, String> {
    Ok(Response::ok(all_database_capabilities()))
}

#[tauri::command]
pub async fn list_database_driver_installations(
) -> Result<Response<Vec<DatabaseDriverInstallation>>, String> {
    Ok(Response::ok(bundled_database_driver_installations()))
}

#[tauri::command]
pub async fn create_database(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    database: String,
    charset: Option<String>,
    collation: Option<String>,
    owner: Option<String>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let sql = create_database_sql(
            kind,
            &database,
            charset.as_deref(),
            collation.as_deref(),
            owner.as_deref(),
        )?;
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        let label = match kind {
            DatabaseKind::Postgres => "Schema",
            DatabaseKind::Mysql => "Database",
        };
        Ok(format!("{label} {} created", database.trim()))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("CREATE_DATABASE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_database(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    database: String,
    cascade: Option<bool>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let database_name = ensure_mutable_namespace(kind, &database)?.to_string();
        let sql = drop_database_sql(kind, &database_name, cascade.unwrap_or(false))?;
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        manager
            .invalidate_schema(&connection_id, &database_name)
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!("Database/schema {} dropped", database_name))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("DROP_DATABASE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn rename_database(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    old_name: String,
    new_name: String,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let old_name = ensure_mutable_namespace(kind, &old_name)?.to_string();
        let new_name = ensure_mutable_namespace(kind, &new_name)?.to_string();
        let sql = rename_database_sql(kind, &old_name, &new_name)?;
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        manager
            .invalidate_schema(&connection_id, &old_name)
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!(
            "Database/schema {} renamed to {}",
            old_name, new_name
        ))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("RENAME_DATABASE_ERROR", &error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_driver_specific_create_database_sql() {
        assert_eq!(
            create_database_sql(DatabaseKind::Postgres, "app", None, None, None).unwrap(),
            r#"CREATE SCHEMA "app";"#
        );
        assert_eq!(
            create_database_sql(
                DatabaseKind::Mysql,
                "app",
                Some("utf8mb4"),
                Some("utf8mb4_general_ci"),
                None
            )
            .unwrap(),
            "CREATE DATABASE `app` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
        );
    }

    #[test]
    fn rejects_unsafe_charset_tokens() {
        assert!(
            create_database_sql(DatabaseKind::Mysql, "app", Some("utf8mb4;DROP"), None, None)
                .is_err()
        );
    }

    #[test]
    fn builds_postgres_schema_authorization() {
        assert_eq!(
            create_database_sql(
                DatabaseKind::Postgres,
                "app data",
                None,
                None,
                Some("app owner")
            )
            .unwrap(),
            r#"CREATE SCHEMA "app data" AUTHORIZATION "app owner";"#
        );
    }

    #[test]
    fn builds_driver_specific_drop_database_sql() {
        assert_eq!(
            drop_database_sql(DatabaseKind::Postgres, "app", true).unwrap(),
            r#"DROP SCHEMA "app" CASCADE;"#
        );
        assert_eq!(
            drop_database_sql(DatabaseKind::Mysql, "app", true).unwrap(),
            "DROP DATABASE `app`;"
        );
    }

    #[test]
    fn builds_supported_rename_database_sql() {
        assert_eq!(
            rename_database_sql(DatabaseKind::Postgres, "old_app", "new_app").unwrap(),
            r#"ALTER SCHEMA "old_app" RENAME TO "new_app";"#
        );
        assert!(rename_database_sql(DatabaseKind::Mysql, "old_app", "new_app").is_err());
    }

    #[test]
    fn rejects_protected_namespaces() {
        assert!(drop_database_sql(DatabaseKind::Postgres, "pg_catalog", true).is_err());
        assert!(drop_database_sql(DatabaseKind::Mysql, "mysql", true).is_err());
    }

    #[test]
    fn reports_the_real_bundled_driver_update_boundary() {
        let installations = bundled_database_driver_installations();
        assert_eq!(installations.len(), 5);
        assert!(installations.iter().all(|driver| {
            driver.distribution == "bundled"
                && driver.update_policy == "application-update"
                && !driver.independently_updatable
                && !driver.client_version.is_empty()
        }));
        assert_eq!(
            installations
                .iter()
                .find(|driver| driver.driver == "elasticsearch")
                .map(|driver| driver.client_library),
            Some("reqwest")
        );
    }
}
