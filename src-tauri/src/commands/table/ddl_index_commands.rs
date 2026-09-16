//! Ddl index commands for table operations.

use super::access::ensure_resolved_relation_operation_allowed;
use super::ddl_constraints::{
    build_create_table_index_statement, build_drop_table_index_statement,
    build_rename_table_index_statement,
};
use super::ddl_types::TableIndexChangeResult;
use super::policy::{ensure_host_table_ddl_allowed, RelationOperation};
use super::row_sql::column_lookup;
use super::sqlite_ddl::is_sqlite_driver;
use super::sqlite_ddl_builders::{
    build_sqlite_create_index_statement, build_sqlite_drop_index_statement,
};
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::Response;
use std::str::FromStr;
use tauri::State;

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_table_index(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    index: String,
    columns: Vec<String>,
    unique: Option<bool>,
) -> Result<Response<TableIndexChangeResult>, String> {
    let result: Result<TableIndexChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "index creation").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::IndexChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = if is_sqlite_driver(&driver) {
            build_sqlite_create_index_statement(
                &schema,
                &table,
                &index,
                &columns,
                &existing_columns,
                unique.unwrap_or(false),
            )?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_create_table_index_statement(
                kind,
                &schema,
                &table,
                &index,
                &columns,
                &existing_columns,
                unique.unwrap_or(false),
            )?
        };

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableIndexChangeResult {
            table: table.trim().to_string(),
            index: index.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_INDEX_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table_index(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    index: String,
) -> Result<Response<TableIndexChangeResult>, String> {
    let result: Result<TableIndexChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "index deletion").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::IndexChange,
        )
        .await?;
        let statement = if is_sqlite_driver(&driver) {
            build_sqlite_drop_index_statement(&schema, &table, &index)?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_drop_table_index_statement(kind, &schema, &table, &index)?
        };

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableIndexChangeResult {
            table: table.trim().to_string(),
            index: index.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("DROP_TABLE_INDEX_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn rename_table_index(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    old_name: String,
    new_name: String,
) -> Result<Response<TableIndexChangeResult>, String> {
    let result: Result<TableIndexChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "index rename").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::IndexChange,
        )
        .await?;
        let indexes = manager
            .get_indexes(&connection_id, &schema, &table)
            .await
            .map_err(|e| e.to_string())?;
        let statement = build_rename_table_index_statement(
            kind, &schema, &table, &old_name, &new_name, &indexes,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableIndexChangeResult {
            table: table.trim().to_string(),
            index: new_name.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("RENAME_TABLE_INDEX_ERROR", &error)),
    }
}
