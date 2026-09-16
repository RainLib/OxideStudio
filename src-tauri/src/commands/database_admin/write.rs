use crate::core::{dialect::DatabaseKind, manager::ConnectionManager, protocol::Response};
use tauri::State;

use super::identity::confirmed_admin_kind;
pub use super::models::{
    CreateDatabaseAdminUserRequest, DeleteDatabaseAdminUserRequest, SetDatabaseAdminLoginRequest,
    UpdateDatabaseAdminPasswordRequest,
};
use super::support::{
    database_admin_error_response, mysql_account, postgres_identifier, require_confirmed,
    sql_string, validate_text,
};

pub(super) fn create_user_sql(
    kind: DatabaseKind,
    request: &CreateDatabaseAdminUserRequest,
) -> Result<String, String> {
    require_confirmed(request.confirmed)?;
    let name = validate_text(&request.name, "User name", 128)?;
    let password = request
        .password
        .as_deref()
        .map(|value| validate_text(value, "Password", 1024))
        .transpose()?;
    match kind {
        DatabaseKind::Postgres => {
            let mut sql = format!(
                "CREATE ROLE {} {}",
                postgres_identifier(name),
                if request.can_login {
                    "LOGIN"
                } else {
                    "NOLOGIN"
                }
            );
            if let Some(password) = password {
                sql.push_str(" PASSWORD ");
                sql.push_str(&sql_string(password));
            }
            Ok(format!("{sql};"))
        }
        DatabaseKind::Mysql => {
            let account = mysql_account(name, request.host.as_deref())?;
            let password = password
                .ok_or_else(|| "A password is required for MySQL/MariaDB users".to_string())?;
            Ok(format!(
                "CREATE USER {account} IDENTIFIED BY {};",
                sql_string(password)
            ))
        }
    }
}

pub(super) fn update_password_sql(
    kind: DatabaseKind,
    request: &UpdateDatabaseAdminPasswordRequest,
) -> Result<String, String> {
    require_confirmed(request.confirmed)?;
    let name = validate_text(&request.name, "User name", 128)?;
    let password = validate_text(&request.password, "Password", 1024)?;
    match kind {
        DatabaseKind::Postgres => Ok(format!(
            "ALTER ROLE {} PASSWORD {};",
            postgres_identifier(name),
            sql_string(password)
        )),
        DatabaseKind::Mysql => Ok(format!(
            "ALTER USER {} IDENTIFIED BY {};",
            mysql_account(name, request.host.as_deref())?,
            sql_string(password)
        )),
    }
}

pub(super) fn set_login_sql(
    kind: DatabaseKind,
    request: &SetDatabaseAdminLoginRequest,
) -> Result<String, String> {
    require_confirmed(request.confirmed)?;
    let name = validate_text(&request.name, "User name", 128)?;
    match kind {
        DatabaseKind::Postgres => Ok(format!(
            "ALTER ROLE {} {};",
            postgres_identifier(name),
            if request.can_login {
                "LOGIN"
            } else {
                "NOLOGIN"
            }
        )),
        DatabaseKind::Mysql => Ok(format!(
            "ALTER USER {} ACCOUNT {};",
            mysql_account(name, request.host.as_deref())?,
            if request.can_login { "UNLOCK" } else { "LOCK" }
        )),
    }
}

pub(super) fn drop_user_sql(
    kind: DatabaseKind,
    request: &DeleteDatabaseAdminUserRequest,
) -> Result<String, String> {
    require_confirmed(request.confirmed)?;
    let name = validate_text(&request.name, "User name", 128)?;
    match kind {
        DatabaseKind::Postgres => Ok(format!("DROP ROLE {};", postgres_identifier(name))),
        DatabaseKind::Mysql => Ok(format!(
            "DROP USER {};",
            mysql_account(name, request.host.as_deref())?
        )),
    }
}

pub(super) async fn execute_admin_statement(
    manager: &ConnectionManager,
    connection_id: &str,
    sql: String,
) -> Result<String, String> {
    manager
        .query(connection_id, &sql, None, None, None)
        .await
        .map_err(|error| error.to_string())?;
    Ok("Database administration change completed".to_string())
}

#[tauri::command]
pub async fn create_database_admin_user(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: CreateDatabaseAdminUserRequest,
) -> Result<Response<String>, String> {
    let result = async {
        let (kind, _) = confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        execute_admin_statement(&manager, &connection_id, create_user_sql(kind, &request)?).await
    }
    .await;
    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_CREATE_USER_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn update_database_admin_user_password(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: UpdateDatabaseAdminPasswordRequest,
) -> Result<Response<String>, String> {
    let result = async {
        let (kind, _) = confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        execute_admin_statement(
            &manager,
            &connection_id,
            update_password_sql(kind, &request)?,
        )
        .await
    }
    .await;
    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_UPDATE_PASSWORD_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn set_database_admin_user_login(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: SetDatabaseAdminLoginRequest,
) -> Result<Response<String>, String> {
    let result = async {
        let (kind, _) = confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        execute_admin_statement(&manager, &connection_id, set_login_sql(kind, &request)?).await
    }
    .await;
    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_SET_LOGIN_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn delete_database_admin_user(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: DeleteDatabaseAdminUserRequest,
) -> Result<Response<String>, String> {
    let result = async {
        let (kind, _) = confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        execute_admin_statement(&manager, &connection_id, drop_user_sql(kind, &request)?).await
    }
    .await;
    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_DELETE_USER_ERROR",
            &error,
        )),
    }
}
