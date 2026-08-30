//! Fixed, driver-aware database administration commands.
//!
//! These commands intentionally expose a small typed vocabulary instead of a
//! generic "run administration SQL" escape hatch.  It keeps the UI useful for
//! common session and account operations while retaining validation, explicit
//! confirmation and database-specific quoting at the Rust boundary.

pub mod events;
pub mod maintenance;

use crate::core::{
    dialect::DatabaseKind,
    manager::ConnectionManager,
    protocol::{QueryParameter, QueryResult, Response},
    redaction::redact_connection_url,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::str::FromStr;
use tauri::State;

const ADMIN_RESULT_LIMIT: usize = 200;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminSession {
    pub id: String,
    pub user: Option<String>,
    pub host: Option<String>,
    pub database: Option<String>,
    pub state: Option<String>,
    pub statement: Option<String>,
    pub wait: Option<String>,
    pub duration_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminUser {
    pub name: String,
    pub host: Option<String>,
    pub can_login: Option<bool>,
    pub is_superuser: Option<bool>,
    pub authentication_plugin: Option<String>,
}

/// A read-only role-to-member edge. Account host qualifiers are retained only
/// where the server itself exposes them, so MySQL-family role names remain
/// unambiguous without returning grants, passwords, or SQL text.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminRoleMembership {
    pub role: String,
    pub member: String,
}

/// A bounded, read-only table privilege row. This is visibility only: grant
/// changes remain unavailable until a reviewed diff/confirmation contract is
/// introduced.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminTablePrivilege {
    pub grantee: String,
    pub schema: String,
    pub table: String,
    pub privilege: String,
}

/// A deliberately small, read-only server metric. Values remain strings so a
/// driver cannot lose precision when returning counters larger than a JS safe
/// integer. `available: false` is an explicit capability/permission downgrade,
/// not a zero value.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminMetric {
    pub key: String,
    pub label: String,
    pub value: Option<String>,
    pub unit: String,
    pub description: Option<String>,
    pub available: bool,
}

/// One edge in a server's visible blocking graph. Query text is intentionally
/// omitted: the Sessions view remains the explicit place to inspect a
/// statement, while this endpoint is safe to refresh frequently.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminLockWait {
    pub waiting_session_id: String,
    pub blocking_session_id: String,
    pub waiting_user: Option<String>,
    pub blocking_user: Option<String>,
    pub database: Option<String>,
    pub wait: Option<String>,
    pub duration_seconds: Option<u64>,
}

/// Identity read from the same live session used by the administration
/// commands. The renderer may display a connection name, but it must not be
/// trusted to choose a vendor SQL dialect or to describe the server targeted
/// by a mutation.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminServerIdentity {
    pub driver: String,
    pub database: Option<String>,
    pub account: Option<String>,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DatabaseAdminErrorKind {
    PermissionDenied,
    ConnectionUnavailable,
    Unsupported,
    Validation,
    QueryFailed,
}

impl DatabaseAdminErrorKind {
    const fn code_suffix(self) -> Option<&'static str> {
        match self {
            Self::PermissionDenied => Some("PERMISSION_DENIED"),
            Self::ConnectionUnavailable => Some("CONNECTION_UNAVAILABLE"),
            Self::Unsupported => Some("UNSUPPORTED"),
            Self::Validation => Some("VALIDATION_FAILED"),
            Self::QueryFailed => None,
        }
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::PermissionDenied => "permissionDenied",
            Self::ConnectionUnavailable => "connectionUnavailable",
            Self::Unsupported => "unsupported",
            Self::Validation => "validation",
            Self::QueryFailed => "queryFailed",
        }
    }

    const fn retryable(self) -> bool {
        matches!(self, Self::ConnectionUnavailable)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDatabaseAdminUserRequest {
    pub name: String,
    pub password: Option<String>,
    pub host: Option<String>,
    #[serde(default = "default_true")]
    pub can_login: bool,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDatabaseAdminPasswordRequest {
    pub name: String,
    pub password: String,
    pub host: Option<String>,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDatabaseAdminLoginRequest {
    pub name: String,
    pub host: Option<String>,
    pub can_login: bool,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteDatabaseAdminUserRequest {
    pub name: String,
    pub host: Option<String>,
    pub confirmed: bool,
}

fn default_true() -> bool {
    true
}

fn value_string(value: Option<&Value>) -> Option<String> {
    value.and_then(|value| match value {
        Value::Null => None,
        Value::String(value) => (!value.trim().is_empty()).then(|| value.clone()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        other => Some(other.to_string()),
    })
}

fn value_bool(value: Option<&Value>) -> Option<bool> {
    match value {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::Number(value)) => value.as_i64().map(|value| value != 0),
        Some(Value::String(value)) => match value.trim().to_ascii_lowercase().as_str() {
            "true" | "t" | "1" | "yes" | "y" => Some(true),
            "false" | "f" | "0" | "no" | "n" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn value_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(value)) => value.as_u64(),
        Some(Value::String(value)) => value.trim().parse().ok(),
        _ => None,
    }
}

fn primary_result(results: Vec<QueryResult>) -> Result<QueryResult, String> {
    results
        .into_iter()
        .next()
        .ok_or_else(|| "Database returned no administration result".to_string())
}

fn result_row<'a>(result: &'a QueryResult, row: &'a [Value], name: &str) -> Option<&'a Value> {
    result
        .columns
        .iter()
        .position(|column| column.name.eq_ignore_ascii_case(name))
        .and_then(|index| row.get(index))
}

fn validate_text<'a>(value: &'a str, field: &str, max_length: usize) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{field} is required"));
    }
    if value.len() > max_length || value.contains('\0') {
        return Err(format!("Invalid {field}"));
    }
    Ok(value)
}

fn require_confirmed(confirmed: bool) -> Result<(), String> {
    if confirmed {
        Ok(())
    } else {
        Err("Explicit confirmation is required for this administration action".to_string())
    }
}

fn sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn postgres_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn mysql_identifier(value: &str) -> String {
    format!("`{}`", value.replace('`', "``"))
}

fn mysql_account(name: &str, host: Option<&str>) -> Result<String, String> {
    let name = validate_text(name, "User name", 128)?;
    let host = validate_text(host.unwrap_or("%"), "Host", 255)?;
    Ok(format!("{}@{}", sql_string(name), sql_string(host)))
}

fn admin_kind(driver: &str) -> Result<DatabaseKind, String> {
    DatabaseKind::from_str(driver).map_err(|_| {
        "Database administration is currently available for PostgreSQL and MySQL/MariaDB"
            .to_string()
    })
}

fn ensure_host_database_admin_capability(
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

async fn ensure_host_database_admin_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
) -> Result<(), String> {
    let capabilities = manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?;
    ensure_host_database_admin_capability(capabilities.as_ref())
}

fn resolve_admin_kind(
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

async fn confirmed_admin_kind(
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

fn classify_database_admin_error(error: &str) -> DatabaseAdminErrorKind {
    let normalized = error.to_ascii_lowercase();
    if [
        "permission denied",
        "insufficient privilege",
        "insufficient_privilege",
        "must be superuser",
        "only superuser",
        "access denied",
        "command denied",
        "sqlstate 42501",
        "sqlstate: 42501",
        "error 1044",
        "error 1045",
        "error 1142",
        "error 1227",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
    {
        DatabaseAdminErrorKind::PermissionDenied
    } else if [
        "explicit confirmation",
        " is required",
        "invalid ",
        "must be a positive number",
        "does not match the active connection identity",
        "maintenance target table is no longer available",
        "maintenance target must be a base table",
        "maintenance plan changed",
        "maintenance confirmation text does not match",
        "event target no longer exists",
        "event target already exists",
        "event plan changed",
        "event confirmation text does not match",
        "event body must",
        "event body may",
        "invalid event",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
    {
        DatabaseAdminErrorKind::Validation
    } else if [
        "does not provide a verified semantic database-administration protocol",
        "database administration is currently available",
        "unsupported database driver",
        "metadata is unavailable",
        " is not supported for ",
        "remote database maintenance is supported only",
        "event administration is available only",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
    {
        DatabaseAdminErrorKind::Unsupported
    } else if [
        "connection not found",
        "connection is unavailable",
        "connection closed",
        "connection refused",
        "lost connection",
        "broken pipe",
        "server has gone away",
        "network is unreachable",
        "timed out",
        "timeout",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
    {
        DatabaseAdminErrorKind::ConnectionUnavailable
    } else {
        DatabaseAdminErrorKind::QueryFailed
    }
}

fn bounded_admin_validation_message(error: &str) -> String {
    let redacted = redact_connection_url(error);
    let normalized = redacted.split_whitespace().collect::<Vec<_>>().join(" ");
    normalized.chars().take(320).collect()
}

fn database_admin_error_message(kind: DatabaseAdminErrorKind, error: &str) -> String {
    match kind {
        DatabaseAdminErrorKind::PermissionDenied => {
            "The connected account does not have permission for this database administration operation."
                .to_string()
        }
        DatabaseAdminErrorKind::ConnectionUnavailable => {
            "The database connection is unavailable. Reconnect and try again.".to_string()
        }
        DatabaseAdminErrorKind::Unsupported => {
            "This driver or server does not expose the required database administration capability."
                .to_string()
        }
        DatabaseAdminErrorKind::Validation => bounded_admin_validation_message(error),
        DatabaseAdminErrorKind::QueryFailed => {
            "The database administration request failed. Review the server diagnostics and try again."
                .to_string()
        }
    }
}

fn database_admin_error_response<T>(base_code: &str, error: &str) -> Response<T> {
    let kind = classify_database_admin_error(error);
    let code = kind.code_suffix().map_or_else(
        || base_code.to_string(),
        |suffix| {
            format!(
                "{}_{}",
                base_code.strip_suffix("_ERROR").unwrap_or(base_code),
                suffix
            )
        },
    );
    Response::err_with_details(
        &code,
        &database_admin_error_message(kind, error),
        kind.retryable(),
        Some(serde_json::json!({ "adminErrorKind": kind.as_str() })),
    )
}

fn server_identity_sql(kind: DatabaseKind) -> &'static str {
    match kind {
        DatabaseKind::Postgres => {
            "SELECT current_database()::text AS database_name, current_user::text AS account_name, current_setting('server_version')::text AS server_version"
        }
        DatabaseKind::Mysql => {
            "SELECT DATABASE() AS database_name, CURRENT_USER() AS account_name, VERSION() AS server_version"
        }
    }
}

fn server_identity_from_result(
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

fn session_list_sql(kind: DatabaseKind) -> &'static str {
    match kind {
        DatabaseKind::Postgres => {
            "SELECT pid::text AS session_id, usename AS user_name, datname AS database_name, state, \
             COALESCE(query, '') AS statement, \
             NULLIF(CONCAT_WS(':', wait_event_type, wait_event), '') AS wait, \
             EXTRACT(EPOCH FROM (clock_timestamp() - query_start))::bigint AS duration_seconds \
             FROM pg_stat_activity WHERE pid <> pg_backend_pid() \
             ORDER BY query_start NULLS LAST LIMIT 200"
        }
        DatabaseKind::Mysql => {
            "SELECT ID AS session_id, USER AS user_name, HOST AS host, DB AS database_name, \
             COMMAND AS state, INFO AS statement, TIME AS duration_seconds \
             FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() \
             ORDER BY TIME DESC LIMIT 200"
        }
    }
}

fn user_list_sql(kind: DatabaseKind) -> &'static str {
    match kind {
        DatabaseKind::Postgres => {
            "SELECT rolname AS user_name, rolcanlogin AS can_login, rolsuper AS is_superuser \
             FROM pg_roles ORDER BY rolname LIMIT 200"
        }
        DatabaseKind::Mysql => {
            "SELECT User AS user_name, Host AS host, plugin AS authentication_plugin \
             FROM mysql.user ORDER BY User, Host LIMIT 200"
        }
    }
}

const MYSQL_ROLE_MEMBERSHIPS_SQL: &str = "SELECT \
    CONCAT(FROM_USER, '@', FROM_HOST) AS role_name, \
    CONCAT(TO_USER, '@', TO_HOST) AS member_name \
    FROM mysql.role_edges ORDER BY FROM_USER, FROM_HOST, TO_USER, TO_HOST LIMIT 200";

const MARIADB_ROLE_MEMBERSHIPS_SQL: &str = "SELECT \
    Role AS role_name, CONCAT(User, '@', Host) AS member_name \
    FROM mysql.roles_mapping ORDER BY Role, User, Host LIMIT 200";

fn postgres_role_memberships_sql() -> &'static str {
    "SELECT role.rolname AS role_name, member.rolname AS member_name \
     FROM pg_auth_members membership \
     JOIN pg_roles role ON role.oid = membership.roleid \
     JOIN pg_roles member ON member.oid = membership.member \
     ORDER BY role.rolname, member.rolname LIMIT 200"
}

fn table_privileges_sql(kind: DatabaseKind) -> &'static str {
    match kind {
        DatabaseKind::Postgres => "SELECT grantee, table_schema AS schema_name, table_name, privilege_type \
            FROM information_schema.role_table_grants \
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema') \
            ORDER BY grantee, table_schema, table_name, privilege_type LIMIT 200",
        DatabaseKind::Mysql => "SELECT GRANTEE AS grantee, TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, PRIVILEGE_TYPE AS privilege_type \
            FROM information_schema.TABLE_PRIVILEGES \
            WHERE TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys') \
            ORDER BY GRANTEE, TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE LIMIT 200",
    }
}

fn metrics_sql(kind: DatabaseKind) -> &'static str {
    match kind {
        DatabaseKind::Postgres => {
            "WITH activity AS ( \
                SELECT COUNT(*) FILTER (WHERE pid <> pg_backend_pid()) AS connections, \
                COUNT(*) FILTER (WHERE pid <> pg_backend_pid() AND state = 'active') AS active_queries \
                FROM pg_stat_activity \
             ), stats AS ( \
                SELECT xact_commit, xact_rollback, blks_hit, blks_read \
                FROM pg_stat_database WHERE datname = current_database() \
             ) \
             SELECT 'connections' AS metric_key, 'Connections' AS metric_label, connections::text AS metric_value, 'count' AS metric_unit, \
                'Other currently visible server sessions' AS metric_description FROM activity \
             UNION ALL SELECT 'activeQueries', 'Active queries', active_queries::text, 'count', \
                'Visible sessions currently executing a query' FROM activity \
             UNION ALL SELECT 'cacheHitPercent', 'Cache hit rate', \
                CASE WHEN COALESCE(blks_hit, 0) + COALESCE(blks_read, 0) > 0 \
                     THEN ROUND(100.0 * blks_hit / (blks_hit + blks_read), 2)::text END, '%', \
                'PostgreSQL shared-buffer hits for the current database' FROM stats \
             UNION ALL SELECT 'committedTransactions', 'Committed transactions', xact_commit::text, 'count', \
                'Current database cumulative counter since statistics reset' FROM stats \
             UNION ALL SELECT 'rolledBackTransactions', 'Rolled back transactions', xact_rollback::text, 'count', \
                'Current database cumulative counter since statistics reset' FROM stats \
             UNION ALL SELECT 'databaseSizeBytes', 'Database size', pg_database_size(current_database())::text, 'bytes', \
                'Allocated size of the current database'"
        }
        DatabaseKind::Mysql => {
            "SELECT 'connections' AS metric_key, 'Connections' AS metric_label, COUNT(*) + 0 AS metric_value, 'count' AS metric_unit, \
                'Visible server sessions' AS metric_description \
             FROM information_schema.PROCESSLIST \
             UNION ALL SELECT 'activeQueries', 'Active queries', COUNT(*) + 0, 'count', \
                'Visible sessions executing a non-idle command' \
             FROM information_schema.PROCESSLIST \
             WHERE COMMAND NOT IN ('Sleep', 'Daemon') \
             UNION ALL SELECT 'databaseSizeBytes', 'Database size', COALESCE(SUM(data_length + index_length), 0) + 0, 'bytes', \
                'Allocated data and index bytes for the current database' \
             FROM information_schema.TABLES WHERE table_schema = DATABASE()"
        }
    }
}

const POSTGRES_LOCK_WAITS_SQL: &str = "SELECT \
    waiting.pid::text AS waiting_session_id, \
    blocking.pid::text AS blocking_session_id, \
    waiting.usename AS waiting_user, \
    blocking.usename AS blocking_user, \
    waiting.datname AS database_name, \
    NULLIF(CONCAT_WS(':', waiting.wait_event_type, waiting.wait_event), '') AS wait, \
    EXTRACT(EPOCH FROM (clock_timestamp() - waiting.query_start))::bigint AS duration_seconds \
    FROM pg_stat_activity waiting \
    CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) AS blocking_pid(pid) \
    JOIN pg_stat_activity blocking ON blocking.pid = blocking_pid.pid \
    WHERE waiting.pid <> pg_backend_pid() \
    ORDER BY waiting.query_start NULLS LAST \
    LIMIT 200";

// MySQL 8.0 exposes current InnoDB waits from performance_schema. Join the
// transaction and process views only to obtain stable connection identifiers
// and non-sensitive display metadata; never select SQL text or lock payloads.
const MYSQL_8_LOCK_WAITS_SQL: &str = "SELECT \
    waiting.trx_mysql_thread_id AS waiting_session_id, \
    blocking.trx_mysql_thread_id AS blocking_session_id, \
    waiting_process.USER AS waiting_user, \
    blocking_process.USER AS blocking_user, \
    waiting_process.DB AS database_name, \
    'InnoDB row lock' AS wait, \
    TIMESTAMPDIFF(SECOND, waiting.trx_wait_started, NOW()) AS duration_seconds \
    FROM performance_schema.data_lock_waits lock_wait \
    JOIN information_schema.innodb_trx waiting \
      ON waiting.trx_id = lock_wait.REQUESTING_ENGINE_TRANSACTION_ID \
    JOIN information_schema.innodb_trx blocking \
      ON blocking.trx_id = lock_wait.BLOCKING_ENGINE_TRANSACTION_ID \
    LEFT JOIN information_schema.processlist waiting_process \
      ON waiting_process.ID = waiting.trx_mysql_thread_id \
    LEFT JOIN information_schema.processlist blocking_process \
      ON blocking_process.ID = blocking.trx_mysql_thread_id \
    ORDER BY waiting.trx_wait_started ASC \
    LIMIT 200";

// MariaDB and older MySQL versions expose the same bounded blocking graph
// through INFORMATION_SCHEMA. This is a read-only compatibility fallback for
// the fixed MySQL 8 query above, not a frontend-generated vendor SQL path.
const MYSQL_LEGACY_LOCK_WAITS_SQL: &str = "SELECT \
    waiting.trx_mysql_thread_id AS waiting_session_id, \
    blocking.trx_mysql_thread_id AS blocking_session_id, \
    waiting_process.USER AS waiting_user, \
    blocking_process.USER AS blocking_user, \
    waiting_process.DB AS database_name, \
    'InnoDB row lock' AS wait, \
    TIMESTAMPDIFF(SECOND, waiting.trx_wait_started, NOW()) AS duration_seconds \
    FROM information_schema.innodb_lock_waits lock_wait \
    JOIN information_schema.innodb_trx waiting \
      ON waiting.trx_id = lock_wait.requesting_trx_id \
    JOIN information_schema.innodb_trx blocking \
      ON blocking.trx_id = lock_wait.blocking_trx_id \
    LEFT JOIN information_schema.processlist waiting_process \
      ON waiting_process.ID = waiting.trx_mysql_thread_id \
    LEFT JOIN information_schema.processlist blocking_process \
      ON blocking_process.ID = blocking.trx_mysql_thread_id \
    ORDER BY waiting.trx_wait_started ASC \
    LIMIT 200";

async fn query_database_admin_lock_waits(
    manager: &ConnectionManager,
    connection_id: &str,
    sql: &str,
) -> Result<Vec<DatabaseAdminLockWait>, String> {
    let result = primary_result(
        manager
            .query(connection_id, sql, None, None, None)
            .await
            .map_err(|error| error.to_string())?,
    )?;
    Ok(result
        .rows
        .iter()
        .take(ADMIN_RESULT_LIMIT)
        .filter_map(|row| {
            Some(DatabaseAdminLockWait {
                waiting_session_id: value_string(result_row(&result, row, "waiting_session_id"))?,
                blocking_session_id: value_string(result_row(&result, row, "blocking_session_id"))?,
                waiting_user: value_string(result_row(&result, row, "waiting_user")),
                blocking_user: value_string(result_row(&result, row, "blocking_user")),
                database: value_string(result_row(&result, row, "database_name")),
                wait: value_string(result_row(&result, row, "wait")),
                duration_seconds: value_u64(result_row(&result, row, "duration_seconds")),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn list_database_admin_lock_waits(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
) -> Result<Response<Vec<DatabaseAdminLockWait>>, String> {
    let result: Result<Vec<DatabaseAdminLockWait>, String> = async {
        let (kind, _) = confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        match kind {
            DatabaseKind::Postgres => {
                query_database_admin_lock_waits(&manager, &connection_id, POSTGRES_LOCK_WAITS_SQL).await
            }
            DatabaseKind::Mysql => {
                match query_database_admin_lock_waits(&manager, &connection_id, MYSQL_8_LOCK_WAITS_SQL).await {
                    Ok(waits) => Ok(waits),
                    Err(modern_error) => query_database_admin_lock_waits(
                        &manager,
                        &connection_id,
                        MYSQL_LEGACY_LOCK_WAITS_SQL,
                    )
                    .await
                    .map_err(|legacy_error| format!(
                        "MySQL/MariaDB lock-wait metadata is unavailable (modern view: {modern_error}; legacy view: {legacy_error})"
                    )),
                }
            }
        }
    }
    .await;
    match result {
        Ok(waits) => Ok(Response::ok(waits)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_LOCK_WAITS_ERROR",
            &error,
        )),
    }
}

fn metric_from_row(result: &QueryResult, row: &[Value]) -> Option<DatabaseAdminMetric> {
    let key = value_string(result_row(result, row, "metric_key"))?;
    let label = value_string(result_row(result, row, "metric_label"))?;
    let unit = value_string(result_row(result, row, "metric_unit"))?;
    let value = value_string(result_row(result, row, "metric_value"));
    Some(DatabaseAdminMetric {
        key,
        label,
        value: value.clone(),
        unit,
        description: value_string(result_row(result, row, "metric_description")),
        available: value.is_some(),
    })
}

#[tauri::command]
pub async fn list_database_admin_metrics(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
) -> Result<Response<Vec<DatabaseAdminMetric>>, String> {
    let result: Result<Vec<DatabaseAdminMetric>, String> = async {
        let (kind, _) = confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        let result = primary_result(
            manager
                .query(&connection_id, metrics_sql(kind), None, None, None)
                .await
                .map_err(|error| error.to_string())?,
        )?;
        Ok(result
            .rows
            .iter()
            .take(ADMIN_RESULT_LIMIT)
            .filter_map(|row| metric_from_row(&result, row))
            .collect())
    }
    .await;
    match result {
        Ok(metrics) => Ok(Response::ok(metrics)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_METRICS_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn list_database_admin_sessions(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
) -> Result<Response<Vec<DatabaseAdminSession>>, String> {
    let result: Result<Vec<DatabaseAdminSession>, String> = async {
        let (kind, _) = confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        let result = primary_result(
            manager
                .query(&connection_id, session_list_sql(kind), None, None, None)
                .await
                .map_err(|error| error.to_string())?,
        )?;
        Ok(result
            .rows
            .iter()
            .take(ADMIN_RESULT_LIMIT)
            .filter_map(|row| {
                let id = value_string(result_row(&result, row, "session_id"))?;
                Some(DatabaseAdminSession {
                    id,
                    user: value_string(result_row(&result, row, "user_name")),
                    host: value_string(result_row(&result, row, "host")),
                    database: value_string(result_row(&result, row, "database_name")),
                    state: value_string(result_row(&result, row, "state")),
                    statement: value_string(result_row(&result, row, "statement")),
                    wait: value_string(result_row(&result, row, "wait")),
                    duration_seconds: value_u64(result_row(&result, row, "duration_seconds")),
                })
            })
            .collect())
    }
    .await;
    match result {
        Ok(sessions) => Ok(Response::ok(sessions)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_SESSIONS_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn terminate_database_admin_session(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    session_id: String,
    confirmed: bool,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        let (kind, _) = confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        require_confirmed(confirmed)?;
        let session_id = validate_text(&session_id, "Session id", 32)?;
        let parsed_id: u64 = session_id
            .parse()
            .map_err(|_| "Session id must be a positive number".to_string())?;
        match kind {
            DatabaseKind::Postgres => {
                let result = primary_result(
                    manager
                        .query_parameterized(
                            &connection_id,
                            "SELECT pg_terminate_backend($1) AS terminated",
                            &[QueryParameter {
                                value: Value::from(parsed_id),
                                data_type: Some("bigint".to_string()),
                            }],
                        )
                        .await
                        .map_err(|error| error.to_string())?,
                )?;
                if !value_bool(
                    result
                        .rows
                        .first()
                        .and_then(|row| result_row(&result, row, "terminated")),
                )
                .unwrap_or(false)
                {
                    return Err("PostgreSQL refused to terminate this session".to_string());
                }
            }
            DatabaseKind::Mysql => {
                manager
                    .query(
                        &connection_id,
                        &format!("KILL {parsed_id}"),
                        None,
                        None,
                        None,
                    )
                    .await
                    .map_err(|error| error.to_string())?;
            }
        }
        Ok(format!("Session {parsed_id} was terminated"))
    }
    .await;
    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_TERMINATE_SESSION_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn list_database_admin_users(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
) -> Result<Response<Vec<DatabaseAdminUser>>, String> {
    let result: Result<Vec<DatabaseAdminUser>, String> = async {
        let (kind, _) = confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        let result = primary_result(
            manager
                .query(&connection_id, user_list_sql(kind), None, None, None)
                .await
                .map_err(|error| error.to_string())?,
        )?;
        Ok(result
            .rows
            .iter()
            .take(ADMIN_RESULT_LIMIT)
            .filter_map(|row| {
                let name = value_string(result_row(&result, row, "user_name"))?;
                Some(DatabaseAdminUser {
                    name,
                    host: value_string(result_row(&result, row, "host")),
                    can_login: value_bool(result_row(&result, row, "can_login")),
                    is_superuser: value_bool(result_row(&result, row, "is_superuser")),
                    authentication_plugin: value_string(result_row(
                        &result,
                        row,
                        "authentication_plugin",
                    )),
                })
            })
            .collect())
    }
    .await;
    match result {
        Ok(users) => Ok(Response::ok(users)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_USERS_ERROR",
            &error,
        )),
    }
}

fn role_memberships_from_result(result: &QueryResult) -> Vec<DatabaseAdminRoleMembership> {
    result
        .rows
        .iter()
        .take(ADMIN_RESULT_LIMIT)
        .filter_map(|row| {
            Some(DatabaseAdminRoleMembership {
                role: value_string(result_row(result, row, "role_name"))?,
                member: value_string(result_row(result, row, "member_name"))?,
            })
        })
        .collect()
}

async fn query_database_admin_role_memberships(
    manager: &ConnectionManager,
    connection_id: &str,
    sql: &str,
) -> Result<Vec<DatabaseAdminRoleMembership>, String> {
    let result = primary_result(
        manager
            .query(connection_id, sql, None, None, None)
            .await
            .map_err(|error| error.to_string())?,
    )?;
    Ok(role_memberships_from_result(&result))
}

#[tauri::command]
pub async fn list_database_admin_role_memberships(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
) -> Result<Response<Vec<DatabaseAdminRoleMembership>>, String> {
    let result: Result<Vec<DatabaseAdminRoleMembership>, String> = async {
        let (kind, _) = confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        match kind {
            DatabaseKind::Postgres => query_database_admin_role_memberships(
                &manager,
                &connection_id,
                postgres_role_memberships_sql(),
            )
            .await,
            DatabaseKind::Mysql => match query_database_admin_role_memberships(
                &manager,
                &connection_id,
                MYSQL_ROLE_MEMBERSHIPS_SQL,
            )
            .await
            {
                Ok(memberships) => Ok(memberships),
                Err(modern_error) => query_database_admin_role_memberships(
                    &manager,
                    &connection_id,
                    MARIADB_ROLE_MEMBERSHIPS_SQL,
                )
                .await
                .map_err(|legacy_error| format!(
                    "MySQL/MariaDB role metadata is unavailable (modern view: {modern_error}; legacy view: {legacy_error})"
                )),
            },
        }
    }
    .await;
    match result {
        Ok(memberships) => Ok(Response::ok(memberships)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_ROLE_MEMBERSHIPS_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn list_database_admin_table_privileges(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
) -> Result<Response<Vec<DatabaseAdminTablePrivilege>>, String> {
    let result: Result<Vec<DatabaseAdminTablePrivilege>, String> = async {
        let (kind, _) = confirmed_admin_kind(&manager, &connection_id, &driver).await?;
        let result = primary_result(
            manager
                .query(&connection_id, table_privileges_sql(kind), None, None, None)
                .await
                .map_err(|error| error.to_string())?,
        )?;
        Ok(result
            .rows
            .iter()
            .take(ADMIN_RESULT_LIMIT)
            .filter_map(|row| {
                Some(DatabaseAdminTablePrivilege {
                    grantee: value_string(result_row(&result, row, "grantee"))?,
                    schema: value_string(result_row(&result, row, "schema_name"))?,
                    table: value_string(result_row(&result, row, "table_name"))?,
                    privilege: value_string(result_row(&result, row, "privilege_type"))?,
                })
            })
            .collect())
    }
    .await;
    match result {
        Ok(privileges) => Ok(Response::ok(privileges)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_TABLE_PRIVILEGES_ERROR",
            &error,
        )),
    }
}

fn create_user_sql(
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

fn update_password_sql(
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

fn set_login_sql(
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

fn drop_user_sql(
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

async fn execute_admin_statement(
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
