use crate::core::{
    dialect::{canonical_driver_name, DatabaseCapabilities, DatabaseKind},
    manager::ConnectionManager,
    protocol::{DatabaseCreateRequest, Response},
};
use std::str::FromStr;
use tauri::State;

pub(super) fn validate_token(value: &str, field: &str) -> Result<(), String> {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        Ok(())
    } else {
        Err(format!("Invalid {field}: {value}"))
    }
}

pub(super) fn validate_namespace_name(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Database name is required".to_string());
    }

    Ok(value)
}

pub(super) fn validate_external_create_option(
    value: Option<String>,
    field: &str,
) -> Result<Option<String>, String> {
    let Some(value) = value.map(|value| value.trim().to_string()) else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > 256 || value.contains('\0') {
        return Err(format!("Invalid {field}"));
    }
    Ok(Some(value))
}

pub(super) fn ensure_host_managed_namespace_mutation(
    capabilities: Option<DatabaseCapabilities>,
    operation: &str,
) -> Result<(), String> {
    if let Some(capabilities) = capabilities {
        return Err(format!(
            "{} does not provide a verified semantic namespace {operation} operation",
            capabilities.display_name
        ));
    }
    Ok(())
}

pub(super) fn is_protected_namespace(kind: DatabaseKind, value: &str) -> bool {
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

pub(super) fn ensure_mutable_namespace(kind: DatabaseKind, value: &str) -> Result<&str, String> {
    let value = validate_namespace_name(value)?;
    if is_protected_namespace(kind, value) {
        return Err(format!(
            "System database/schema cannot be modified: {value}"
        ));
    }

    Ok(value)
}

pub(super) fn create_database_sql(
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

pub(super) fn drop_database_sql(
    kind: DatabaseKind,
    database: &str,
    cascade: bool,
) -> Result<String, String> {
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

pub(super) fn rename_database_sql(
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
        let external_capabilities = manager
            .package_capabilities(&connection_id)
            .await
            .map_err(|error| error.to_string())?;

        // A live external connection is always routed through its manifest-
        // bound semantic request, even if a renderer supplies a built-in
        // driver name. This prevents an untrusted command payload from
        // coercing a JDBC/sidecar driver into Host-generated PostgreSQL or
        // MySQL DDL.
        if external_capabilities.is_none() {
            if canonical_driver_name(&driver) == Some("mongodb") {
                if charset
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                    || collation
                        .as_deref()
                        .is_some_and(|value| !value.trim().is_empty())
                    || owner
                        .as_deref()
                        .is_some_and(|value| !value.trim().is_empty())
                {
                    return Err(
                        "MongoDB database creation does not support charset, collation, or owner options"
                            .to_string(),
                    );
                }
                let name = validate_namespace_name(&database)?.to_string();
                manager
                    .create_database(
                        &connection_id,
                        DatabaseCreateRequest {
                            name: name.clone(),
                            charset: None,
                            collation: None,
                            owner: None,
                            namespace_kind: Some("database".to_string()),
                        },
                    )
                    .await
                    .map_err(|error| error.to_string())?;
                return Ok(format!("Database {name} created"));
            }
            let kind = DatabaseKind::from_str(&driver).map_err(|error| error.to_string())?;
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
            return Ok(format!("{label} {} created", database.trim()));
        }

        // External packages receive a semantic namespace-create request, but
        // the Host still owns the capability gate.  This prevents a sidecar
        // implementation from exposing an undeclared CREATE operation merely
        // because a renderer invoked the command directly.
        let capabilities = external_capabilities.expect("external capability check above");
        if !capabilities.supports_create_database {
            return Err(format!(
                "{} does not support namespace creation",
                capabilities.display_name
            ));
        }
        if charset
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            && !capabilities.supports_create_database_charset
        {
            return Err(format!(
                "{} does not support namespace character sets",
                capabilities.display_name
            ));
        }
        if collation
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            && !capabilities.supports_create_database_collation
        {
            return Err(format!(
                "{} does not support namespace collations",
                capabilities.display_name
            ));
        }
        if owner
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            && !capabilities.supports_create_database_owner
        {
            return Err(format!(
                "{} does not support setting a namespace owner",
                capabilities.display_name
            ));
        }

        let request = DatabaseCreateRequest {
            name: validate_namespace_name(&database)?.to_string(),
            charset: validate_external_create_option(charset, "charset")?,
            collation: validate_external_create_option(collation, "collation")?,
            owner: validate_external_create_option(owner, "owner")?,
            namespace_kind: match capabilities
                .namespace_label
                .trim()
                .to_ascii_lowercase()
                .as_str()
            {
                "database" => Some("database".to_string()),
                "schema" => Some("schema".to_string()),
                _ => None,
            },
        };
        let name = request.name.clone();
        manager
            .create_database(&connection_id, request)
            .await
            .map_err(|error| error.to_string())?;
        Ok(format!("Namespace {name} created"))
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
        // Do not turn a renderer-provided `postgres`/`mysql` alias into raw
        // Host DDL for a connected external package. Unlike creation, the
        // current sidecar protocol has no semantic delete operation yet.
        ensure_host_managed_namespace_mutation(
            manager
                .package_capabilities(&connection_id)
                .await
                .map_err(|error| error.to_string())?,
            "deletion",
        )?;
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
        // See `drop_database`: no host-generated rename SQL may be routed
        // through an external runtime until the driver protocol carries a
        // separately declared semantic rename request.
        ensure_host_managed_namespace_mutation(
            manager
                .package_capabilities(&connection_id)
                .await
                .map_err(|error| error.to_string())?,
            "rename",
        )?;
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
