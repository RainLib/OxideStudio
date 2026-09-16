//! Ddl constraint commands for table operations.

use super::access::ensure_resolved_relation_operation_allowed;
use super::ddl_constraints::{
    build_create_check_constraint_statement, build_create_foreign_key_statement,
    build_create_primary_key_statement, build_create_unique_constraint_statement,
    build_drop_table_constraint_statement,
};
use super::ddl_types::TableConstraintChangeResult;
use super::policy::{ensure_host_table_ddl_allowed, RelationOperation};
use super::row_sql::column_lookup;
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::Response;
use std::str::FromStr;
use tauri::State;

#[tauri::command]
pub async fn create_table_unique_constraint(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    columns: Vec<String>,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "unique-constraint creation")
            .await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = build_create_unique_constraint_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &columns,
            &existing_columns,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err(
            "CREATE_TABLE_UNIQUE_CONSTRAINT_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn create_table_primary_key(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    columns: Vec<String>,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "primary-key creation").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = build_create_primary_key_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &columns,
            &existing_columns,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_PRIMARY_KEY_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_table_check_constraint(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    expression: String,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "check-constraint creation")
            .await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let statement = build_create_check_constraint_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &expression,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_CHECK_CONSTRAINT_ERROR", &error)),
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_table_foreign_key(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    columns: Vec<String>,
    referenced_schema: Option<String>,
    referenced_table: String,
    referenced_columns: Vec<String>,
    on_delete: Option<String>,
    on_update: Option<String>,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "foreign-key creation").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let referenced_schema = referenced_schema
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(schema.as_str());
        let (existing_columns, existing_referenced_columns) = tokio::try_join!(
            async {
                manager
                    .get_columns(&connection_id, &schema, &table)
                    .await
                    .map(column_lookup)
                    .map_err(|e| e.to_string())
            },
            async {
                manager
                    .get_columns(&connection_id, referenced_schema, &referenced_table)
                    .await
                    .map(column_lookup)
                    .map_err(|e| e.to_string())
            }
        )?;
        let statement = build_create_foreign_key_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &columns,
            &existing_columns,
            referenced_schema,
            &referenced_table,
            &referenced_columns,
            &existing_referenced_columns,
            on_delete.as_deref(),
            on_update.as_deref(),
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_FOREIGN_KEY_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table_constraint(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "constraint deletion").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let constraint_name = constraint.trim();
        if constraint_name.is_empty() {
            return Err("Constraint name is required".to_string());
        }

        let constraints = manager
            .get_constraints(&connection_id, &schema, &table)
            .await
            .map_err(|e| e.to_string())?;
        let constraint_info = constraints
            .iter()
            .find(|item| item.name == constraint_name)
            .ok_or_else(|| format!("Unknown constraint: {constraint_name}"))?;
        let statement =
            build_drop_table_constraint_statement(kind, &schema, &table, constraint_info)?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint_name.to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("DROP_TABLE_CONSTRAINT_ERROR", &error)),
    }
}
