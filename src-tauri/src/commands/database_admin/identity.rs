use crate::core::{
    dialect::DatabaseKind,
    manager::ConnectionManager,
    protocol::{QueryResult, Response},
};
use std::str::FromStr;
use tauri::State;

pub use super::models::DatabaseAdminServerIdentity;
use super::support::{database_admin_error_response, primary_result, result_row, value_string};

fn admin_kind(driver: &str) -> Result<DatabaseKind, String> {
    DatabaseKind::from_str(driver).map_err(|_| {
        "Database administration is currently available for PostgreSQL and MySQL/MariaDB"
            .to_string()
    })
}

pub(super) fn ensure_host_database_admin_capability(
    capabilities: Option<&crate::core::dialect::DatabaseCapabilities>,
) -> Result<(), String> {
    if let Some(capabilities) = capabilities {
        return Err(format!(
            "{} does not provide a verified semantic database-administration protocol",
            capabilities.display_name
        ));
    }
    Ok(())
}

pub(super) async fn ensure_host_database_admin_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
) -> Result<(), String> {
    let capabilities = manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?;
    ensure_host_database_admin_capability(capabilities.as_ref())
}

pub(super) fn resolve_admin_kind(
    requested_driver: &str,
    connected_driver: Option<&str>,
) -> Result<(DatabaseKind, String), String> {
    let requested_kind = admin_kind(requested_driver)?;
    let Some(connected_driver) = connected_driver else {
        // A small number of unit-test/legacy manager callers predate captured
        // connection identity. New desktop connections always provide it.
        return Ok((requested_kind, requested_kind.as_str().to_string()));
    };
    let connected_kind = admin_kind(connected_driver)?;
    if connected_kind != requested_kind {
        return Err(
            "Requested database driver does not match the active connection identity".to_string(),
        );
    }
    Ok((connected_kind, connected_driver.trim().to_ascii_lowercase()))
}

pub(super) async fn confirmed_admin_kind(
    manager: &ConnectionManager,
    connection_id: &str,
    requested_driver: &str,
) -> Result<(DatabaseKind, String), String> {
    ensure_host_database_admin_allowed(manager, connection_id).await?;
    let connected_driver = manager
        .connection_driver_id(connection_id)
        .await
        .map_err(|error| error.to_string())?;
    resolve_admin_kind(requested_driver, connected_driver.as_deref())
}

pub(super) fn server_identity_sql(kind: DatabaseKind) -> &'static str {
    match kind {
        DatabaseKind::Postgres => {
            "SELECT current_database()::text AS database_name, current_user::text AS account_name, current_setting('server_version')::text AS server_version"
        }
        DatabaseKind::Mysql => {
            "SELECT DATABASE() AS database_name, CURRENT_USER() AS account_name, VERSION() AS server_version"
        }
    }
}

pub(super) fn server_identity_from_result(
    result: &QueryResult,
    driver: String,
) -> Result<DatabaseAdminServerIdentity, String> {
    let row = result
        .rows
        .first()
        .ok_or_else(|| "Database returned no server identity row".to_string())?;
    Ok(DatabaseAdminServerIdentity {
        driver,
        database: value_string(result_row(result, row, "database_name")),
        account: value_string(result_row(result, row, "account_name")),
        server_version: value_string(result_row(result, row, "server_version")),
    })
}

#[tauri::command]
pub async fn get_database_admin_server_identity(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
) -> Result<Response<DatabaseAdminServerIdentity>, String> {
    let result: Result<DatabaseAdminServerIdentity, String> = async {
        let (kind, connected_driver) =
            confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        let result = primary_result(
            manager
                .query(&connection_id, server_identity_sql(kind), None, None, None)
                .await
                .map_err(|error| error.to_string())?,
        )?;
        server_identity_from_result(&result, connected_driver)
    }
    .await;
    match result {
        Ok(identity) => Ok(Response::ok(identity)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_SERVER_IDENTITY_ERROR",
            &error,
        )),
    }
}
