use crate::core::{
    dialect::DatabaseKind,
    manager::ConnectionManager,
    protocol::{QueryParameter, QueryResult, Response},
};
use serde_json::Value;
use tauri::State;

use super::identity::confirmed_admin_kind;
use super::models::ADMIN_RESULT_LIMIT;
pub use super::models::{
    DatabaseAdminLockWait, DatabaseAdminMetric, DatabaseAdminRoleMembership, DatabaseAdminSession,
    DatabaseAdminTablePrivilege, DatabaseAdminUser,
};
use super::support::{
    database_admin_error_response, primary_result, require_confirmed, result_row, validate_text,
    value_bool, value_string, value_u64,
};

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

pub(super) fn user_list_sql(kind: DatabaseKind) -> &'static str {
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

pub(super) fn postgres_role_memberships_sql() -> &'static str {
    "SELECT role.rolname AS role_name, member.rolname AS member_name \
     FROM pg_auth_members membership \
     JOIN pg_roles role ON role.oid = membership.roleid \
     JOIN pg_roles member ON member.oid = membership.member \
     ORDER BY role.rolname, member.rolname LIMIT 200"
}

pub(super) fn table_privileges_sql(kind: DatabaseKind) -> &'static str {
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

pub(super) fn metrics_sql(kind: DatabaseKind) -> &'static str {
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

pub(super) async fn query_database_admin_lock_waits(
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

pub(super) fn metric_from_row(result: &QueryResult, row: &[Value]) -> Option<DatabaseAdminMetric> {
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

pub(super) fn role_memberships_from_result(
    result: &QueryResult,
) -> Vec<DatabaseAdminRoleMembership> {
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

pub(super) async fn query_database_admin_role_memberships(
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
