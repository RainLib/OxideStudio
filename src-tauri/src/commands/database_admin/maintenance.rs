//! Reviewed table-maintenance workflow.
//!
//! The renderer selects from a closed operation enum and receives a plan that
//! binds the live driver identity, negotiated server version and exact target.
//! Execution recomputes that plan before issuing one host-generated statement.

use super::{
    confirmed_admin_kind, database_admin_error_response, mysql_identifier, postgres_identifier,
    validate_text,
};
use crate::core::{
    dialect::DatabaseKind,
    manager::ConnectionManager,
    protocol::{Response, TableInfo},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseMaintenanceOperation {
    Analyze,
    Vacuum,
    VacuumAnalyze,
    VacuumFull,
    VacuumFullAnalyze,
    Optimize,
}

impl DatabaseMaintenanceOperation {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Analyze => "analyze",
            Self::Vacuum => "vacuum",
            Self::VacuumAnalyze => "vacuumAnalyze",
            Self::VacuumFull => "vacuumFull",
            Self::VacuumFullAnalyze => "vacuumFullAnalyze",
            Self::Optimize => "optimize",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseMaintenanceRequest {
    pub database: Option<String>,
    pub schema: String,
    pub table: String,
    pub operation: DatabaseMaintenanceOperation,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteDatabaseMaintenanceRequest {
    pub maintenance: DatabaseMaintenanceRequest,
    pub confirmation_token: String,
    pub confirmation_text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseMaintenancePlan {
    pub operation: DatabaseMaintenanceOperation,
    pub target: String,
    pub summary: String,
    pub lock_impact: String,
    pub risk: String,
    pub requires_maintenance_window: bool,
    pub sql_preview: String,
    pub confirmation_text: String,
    pub confirmation_token: String,
    pub connected_driver: String,
    pub server_version: Option<String>,
}

fn qualified_identifier(kind: DatabaseKind, schema: &str, table: &str) -> String {
    match kind {
        DatabaseKind::Postgres => format!(
            "{}.{}",
            postgres_identifier(schema),
            postgres_identifier(table)
        ),
        DatabaseKind::Mysql => format!("{}.{}", mysql_identifier(schema), mysql_identifier(table)),
    }
}

fn maintenance_sql(
    kind: DatabaseKind,
    operation: DatabaseMaintenanceOperation,
    qualified_table: &str,
) -> Result<String, String> {
    match (kind, operation) {
        (DatabaseKind::Postgres, DatabaseMaintenanceOperation::Analyze) => {
            Ok(format!("ANALYZE {qualified_table};"))
        }
        (DatabaseKind::Postgres, DatabaseMaintenanceOperation::Vacuum) => {
            Ok(format!("VACUUM {qualified_table};"))
        }
        (DatabaseKind::Postgres, DatabaseMaintenanceOperation::VacuumAnalyze) => {
            Ok(format!("VACUUM ANALYZE {qualified_table};"))
        }
        (DatabaseKind::Postgres, DatabaseMaintenanceOperation::VacuumFull) => {
            Ok(format!("VACUUM FULL {qualified_table};"))
        }
        (DatabaseKind::Postgres, DatabaseMaintenanceOperation::VacuumFullAnalyze) => {
            Ok(format!("VACUUM FULL ANALYZE {qualified_table};"))
        }
        (DatabaseKind::Mysql, DatabaseMaintenanceOperation::Analyze) => {
            Ok(format!("ANALYZE TABLE {qualified_table};"))
        }
        (DatabaseKind::Mysql, DatabaseMaintenanceOperation::Optimize) => {
            Ok(format!("OPTIMIZE TABLE {qualified_table};"))
        }
        (DatabaseKind::Postgres, DatabaseMaintenanceOperation::Optimize) => {
            Err("OPTIMIZE is not supported for PostgreSQL maintenance".to_string())
        }
        (DatabaseKind::Mysql, _) => Err(
            "VACUUM is not supported for MySQL/MariaDB maintenance; use ANALYZE or OPTIMIZE"
                .to_string(),
        ),
    }
}

fn maintenance_effect(
    kind: DatabaseKind,
    operation: DatabaseMaintenanceOperation,
) -> (&'static str, &'static str, &'static str, bool) {
    match (kind, operation) {
        (DatabaseKind::Postgres, DatabaseMaintenanceOperation::Analyze) => (
            "Refresh planner statistics",
            "Allows normal reads and writes, but conflicts with some schema maintenance operations.",
            "low",
            false,
        ),
        (DatabaseKind::Postgres, DatabaseMaintenanceOperation::Vacuum) => (
            "Reclaim reusable storage and clean dead tuples",
            "Allows normal reads and writes; adds table and disk I/O for the duration.",
            "medium",
            false,
        ),
        (DatabaseKind::Postgres, DatabaseMaintenanceOperation::VacuumAnalyze) => (
            "Clean dead tuples and refresh planner statistics",
            "Allows normal reads and writes; adds table and disk I/O for the duration.",
            "medium",
            false,
        ),
        (
            DatabaseKind::Postgres,
            DatabaseMaintenanceOperation::VacuumFull
            | DatabaseMaintenanceOperation::VacuumFullAnalyze,
        ) => (
            "Rewrite the table to return disk space to the operating system",
            "Takes an ACCESS EXCLUSIVE lock and blocks reads and writes while the table is rewritten.",
            "high",
            true,
        ),
        (DatabaseKind::Mysql, DatabaseMaintenanceOperation::Analyze) => (
            "Refresh optimizer statistics",
            "The engine may briefly lock table metadata; online behavior depends on server version and engine.",
            "medium",
            false,
        ),
        (DatabaseKind::Mysql, DatabaseMaintenanceOperation::Optimize) => (
            "Reorganize table storage and refresh statistics",
            "The engine may rebuild or copy the table and block writes; plan a maintenance window.",
            "high",
            true,
        ),
        _ => (
            "Unsupported maintenance operation",
            "The selected driver cannot execute this operation.",
            "high",
            true,
        ),
    }
}

fn is_base_table(table: &TableInfo) -> bool {
    !table
        .table_type
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .contains("view")
}

async fn resolve_target_table(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    schema: &str,
    table: &str,
) -> Result<TableInfo, String> {
    let tables = match database {
        Some(database) => {
            manager
                .get_database_tables(connection_id, database, schema)
                .await
        }
        None => manager.get_tables(connection_id, schema).await,
    }
    .map_err(|error| error.to_string())?;
    let target = tables
        .into_iter()
        .find(|candidate| candidate.name == table)
        .ok_or_else(|| "Maintenance target table is no longer available".to_string())?;
    if !is_base_table(&target) {
        return Err("Maintenance target must be a base table, not a view".to_string());
    }
    Ok(target)
}

fn maintenance_confirmation_text(operation: DatabaseMaintenanceOperation, target: &str) -> String {
    let action = match operation {
        DatabaseMaintenanceOperation::Analyze => "ANALYZE",
        DatabaseMaintenanceOperation::Vacuum => "VACUUM",
        DatabaseMaintenanceOperation::VacuumAnalyze => "VACUUM ANALYZE",
        DatabaseMaintenanceOperation::VacuumFull => "VACUUM FULL",
        DatabaseMaintenanceOperation::VacuumFullAnalyze => "VACUUM FULL ANALYZE",
        DatabaseMaintenanceOperation::Optimize => "OPTIMIZE",
    };
    format!("{action} {target}")
}

fn maintenance_token(
    connection_id: &str,
    connected_driver: &str,
    server_version: Option<&str>,
    request: &DatabaseMaintenanceRequest,
    sql: &str,
) -> String {
    let mut digest = Sha256::new();
    for field in [
        "oxide-database-maintenance/v1",
        connection_id,
        connected_driver,
        server_version.unwrap_or("unknown"),
        request.database.as_deref().unwrap_or(""),
        request.schema.as_str(),
        request.table.as_str(),
        request.operation.as_str(),
        sql,
    ] {
        digest.update(field.as_bytes());
        digest.update([0]);
    }
    format!("sha256:{:x}", digest.finalize())
}

async fn build_maintenance_plan(
    manager: &ConnectionManager,
    connection_id: &str,
    requested_driver: &str,
    request: &DatabaseMaintenanceRequest,
) -> Result<DatabaseMaintenancePlan, String> {
    let schema = validate_text(&request.schema, "Schema", 255)?;
    let table = validate_text(&request.table, "Table", 255)?;
    let database = request
        .database
        .as_deref()
        .map(|value| validate_text(value, "Database", 255))
        .transpose()?;
    let (kind, connected_driver) =
        confirmed_admin_kind(manager, connection_id, requested_driver).await?;
    if database.is_some() && kind != DatabaseKind::Postgres {
        return Err(
            "Remote database maintenance is supported only for PostgreSQL connections".to_string(),
        );
    }
    resolve_target_table(manager, connection_id, database, schema, table).await?;

    let qualified_table = qualified_identifier(kind, schema, table);
    let sql = maintenance_sql(kind, request.operation, &qualified_table)?;
    let target = [database, Some(schema), Some(table)]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(".");
    let (summary, lock_impact, risk, requires_maintenance_window) =
        maintenance_effect(kind, request.operation);
    let confirmation_text = maintenance_confirmation_text(request.operation, &target);
    let server_version = manager
        .server_version(connection_id)
        .await
        .map_err(|error| error.to_string())?;
    let confirmation_token = maintenance_token(
        connection_id,
        &connected_driver,
        server_version.as_deref(),
        request,
        &sql,
    );

    Ok(DatabaseMaintenancePlan {
        operation: request.operation,
        target,
        summary: summary.to_string(),
        lock_impact: lock_impact.to_string(),
        risk: risk.to_string(),
        requires_maintenance_window,
        sql_preview: sql,
        confirmation_text,
        confirmation_token,
        connected_driver,
        server_version,
    })
}

#[tauri::command]
pub async fn preview_database_maintenance(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: DatabaseMaintenanceRequest,
) -> Result<Response<DatabaseMaintenancePlan>, String> {
    match build_maintenance_plan(&manager, &connection_id, &driver, &request).await {
        Ok(plan) => Ok(Response::ok(plan)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_MAINTENANCE_PREVIEW_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn execute_database_maintenance(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: ExecuteDatabaseMaintenanceRequest,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        let plan =
            build_maintenance_plan(&manager, &connection_id, &driver, &request.maintenance).await?;
        if request.confirmation_token.trim() != plan.confirmation_token {
            return Err(
                "Maintenance plan changed or the confirmation token is invalid; preview again"
                    .to_string(),
            );
        }
        if request.confirmation_text.trim() != plan.confirmation_text {
            return Err(
                "Maintenance confirmation text does not match the reviewed target".to_string(),
            );
        }

        match request.maintenance.database.as_deref() {
            Some(database) => {
                manager
                    .query_database(&connection_id, database, &plan.sql_preview)
                    .await
            }
            None => {
                manager
                    .query(&connection_id, &plan.sql_preview, None, None, None)
                    .await
            }
        }
        .map_err(|error| error.to_string())?;
        Ok(format!("Maintenance completed for {}", plan.target))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(database_admin_error_response(
            "DATABASE_ADMIN_MAINTENANCE_EXECUTE_ERROR",
            &error,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_only_the_reviewed_vendor_maintenance_vocabulary() {
        let postgres = qualified_identifier(DatabaseKind::Postgres, "app data", "events");
        assert_eq!(
            maintenance_sql(
                DatabaseKind::Postgres,
                DatabaseMaintenanceOperation::VacuumFullAnalyze,
                &postgres,
            )
            .unwrap(),
            "VACUUM FULL ANALYZE \"app data\".\"events\";"
        );
        let mysql = qualified_identifier(DatabaseKind::Mysql, "app`data", "events");
        assert_eq!(
            maintenance_sql(
                DatabaseKind::Mysql,
                DatabaseMaintenanceOperation::Optimize,
                &mysql,
            )
            .unwrap(),
            "OPTIMIZE TABLE `app``data`.`events`;"
        );
        assert!(maintenance_sql(
            DatabaseKind::Mysql,
            DatabaseMaintenanceOperation::Vacuum,
            &mysql,
        )
        .is_err());
    }

    #[test]
    fn full_vacuum_and_optimize_require_a_maintenance_window() {
        assert_eq!(
            maintenance_effect(
                DatabaseKind::Postgres,
                DatabaseMaintenanceOperation::VacuumFull,
            ),
            (
                "Rewrite the table to return disk space to the operating system",
                "Takes an ACCESS EXCLUSIVE lock and blocks reads and writes while the table is rewritten.",
                "high",
                true,
            )
        );
        assert!(maintenance_effect(DatabaseKind::Mysql, DatabaseMaintenanceOperation::Optimize,).3);
    }

    #[test]
    fn confirmation_token_binds_connection_server_target_and_operation() {
        let request = DatabaseMaintenanceRequest {
            database: Some("warehouse".to_string()),
            schema: "public".to_string(),
            table: "events".to_string(),
            operation: DatabaseMaintenanceOperation::Vacuum,
        };
        let first = maintenance_token(
            "connection-1",
            "postgres",
            Some("16.4"),
            &request,
            "VACUUM \"public\".\"events\";",
        );
        let changed_server = maintenance_token(
            "connection-1",
            "postgres",
            Some("17.0"),
            &request,
            "VACUUM \"public\".\"events\";",
        );
        let mut changed_operation = request.clone();
        changed_operation.operation = DatabaseMaintenanceOperation::VacuumFull;
        let changed_operation = maintenance_token(
            "connection-1",
            "postgres",
            Some("16.4"),
            &changed_operation,
            "VACUUM FULL \"public\".\"events\";",
        );

        assert!(first.starts_with("sha256:"));
        assert_ne!(first, changed_server);
        assert_ne!(first, changed_operation);
    }

    #[test]
    fn views_cannot_enter_the_table_maintenance_executor() {
        assert!(is_base_table(&TableInfo {
            name: "events".to_string(),
            schema: Some("public".to_string()),
            table_type: Some("BASE TABLE".to_string()),
            comment: None,
        }));
        assert!(!is_base_table(&TableInfo {
            name: "events_view".to_string(),
            schema: Some("public".to_string()),
            table_type: Some("VIEW".to_string()),
            comment: None,
        }));
    }
}
