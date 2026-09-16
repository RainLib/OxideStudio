use super::{
    identity::{
        ensure_host_database_admin_capability, resolve_admin_kind, server_identity_from_result,
    },
    models::{
        CreateDatabaseAdminUserRequest, DatabaseAdminServerIdentity, DeleteDatabaseAdminUserRequest,
    },
    support::{
        classify_database_admin_error, database_admin_error_response, validate_text,
        DatabaseAdminErrorKind,
    },
    write::{create_user_sql, drop_user_sql},
};
use crate::core::{
    dialect::DatabaseKind,
    protocol::{QueryResult, Response},
};
use serde_json::Value;

#[test]
fn quotes_postgres_roles_and_mysql_accounts() {
    let postgres = CreateDatabaseAdminUserRequest {
        name: "report\"reader".to_string(),
        password: Some("it'works".to_string()),
        host: None,
        can_login: true,
        confirmed: true,
    };
    assert_eq!(
        create_user_sql(DatabaseKind::Postgres, &postgres).unwrap(),
        "CREATE ROLE \"report\"\"reader\" LOGIN PASSWORD 'it''works';"
    );
    let mysql = CreateDatabaseAdminUserRequest {
        name: "app'user".to_string(),
        password: Some("secret".to_string()),
        host: Some("10.0.0.%".to_string()),
        can_login: true,
        confirmed: true,
    };
    assert_eq!(
        create_user_sql(DatabaseKind::Mysql, &mysql).unwrap(),
        "CREATE USER 'app''user'@'10.0.0.%' IDENTIFIED BY 'secret';"
    );
}

#[test]
fn external_packages_cannot_receive_host_generated_admin_commands() {
    let mut capabilities = DatabaseKind::Postgres.capabilities();
    capabilities.display_name = "PostgreSQL JDBC package".to_string();

    assert!(ensure_host_database_admin_capability(None).is_ok());
    assert_eq!(
        ensure_host_database_admin_capability(Some(&capabilities)).unwrap_err(),
        "PostgreSQL JDBC package does not provide a verified semantic database-administration protocol"
    );
}

#[test]
fn rejects_unconfirmed_mutations_and_invalid_session_ids() {
    let request = DeleteDatabaseAdminUserRequest {
        name: "app".to_string(),
        host: None,
        confirmed: false,
    };
    assert!(drop_user_sql(DatabaseKind::Postgres, &request).is_err());
    assert!(validate_text("", "User name", 128).is_err());
}

#[test]
fn confirms_the_connected_driver_family_before_selecting_admin_sql() {
    assert_eq!(
        resolve_admin_kind("mysql", Some("mariadb")).unwrap(),
        (DatabaseKind::Mysql, "mariadb".to_string())
    );
    assert_eq!(
        resolve_admin_kind("postgres", Some("mysql")).unwrap_err(),
        "Requested database driver does not match the active connection identity"
    );
}

#[test]
fn parses_server_identity_from_the_fixed_single_row_contract() {
    let result = QueryResult::rows(
        vec![
            crate::core::protocol::ColumnDef {
                name: "database_name".to_string(),
                data_type: "text".to_string(),
            },
            crate::core::protocol::ColumnDef {
                name: "account_name".to_string(),
                data_type: "text".to_string(),
            },
            crate::core::protocol::ColumnDef {
                name: "server_version".to_string(),
                data_type: "text".to_string(),
            },
        ],
        vec![vec![
            Value::String("warehouse".to_string()),
            Value::String("admin@example".to_string()),
            Value::String("16.4".to_string()),
        ]],
    );

    assert_eq!(
        server_identity_from_result(&result, "postgres".to_string()).unwrap(),
        DatabaseAdminServerIdentity {
            driver: "postgres".to_string(),
            database: Some("warehouse".to_string()),
            account: Some("admin@example".to_string()),
            server_version: Some("16.4".to_string()),
        }
    );
}

#[test]
fn classifies_admin_failures_without_returning_secret_bearing_query_errors() {
    assert_eq!(
        classify_database_admin_error("SQLSTATE 42501: permission denied"),
        DatabaseAdminErrorKind::PermissionDenied
    );
    assert_eq!(
        classify_database_admin_error("server has gone away"),
        DatabaseAdminErrorKind::ConnectionUnavailable
    );

    let response: Response<()> = database_admin_error_response(
        "DATABASE_ADMIN_USERS_ERROR",
        "query failed for postgres://user:secret@localhost/db",
    );
    let error = response.error.unwrap();
    assert_eq!(error.code, "DATABASE_ADMIN_USERS_ERROR");
    assert_eq!(error.category.as_deref(), Some("databaseAdmin"));
    assert!(!error.message.contains("secret"));
    assert_eq!(
        error.context.unwrap()["adminErrorKind"],
        Value::String("queryFailed".to_string())
    );
}
