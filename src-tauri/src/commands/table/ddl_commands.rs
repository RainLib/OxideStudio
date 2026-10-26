//! Ddl commands for table operations.

use super::access::{
    ensure_resolved_relation_operation_allowed, execute_table_column_statements,
    resolve_object_type,
};
use super::ddl_columns::{
    build_add_table_column_statements, build_alter_table_column_statements,
    build_create_materialized_view_statement, build_create_table_statements,
    build_create_view_statement, build_drop_table_column_statement,
    build_rename_table_column_statement, build_sqlite_create_view_statement,
};
use super::ddl_types::{
    AlterTableColumn, CreateMaterializedViewResult, CreateTableColumn, CreateTableResult,
    CreateViewResult, TableColumnChangeResult,
};
use super::policy::{
    ensure_host_table_ddl_allowed, object_label_from_type, object_type_is_foreign_table,
    object_type_is_materialized_view, object_type_is_view, schema_option, RelationOperation,
};
use super::row_sql::column_lookup;
use super::sqlite_ddl::{is_sqlite_driver, sqlite_qualified_relation, sqlite_quote_identifier};
use super::sqlite_ddl_builders::{
    build_sqlite_add_column_statements, build_sqlite_create_table_statements,
    build_sqlite_drop_column_statement, build_sqlite_rename_column_statement,
};
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::Response;
use std::str::FromStr;
use tauri::State;

#[tauri::command]
pub async fn preview_create_table(
    driver: String,
    schema: String,
    table: String,
    columns: Vec<CreateTableColumn>,
) -> Result<Response<Vec<String>>, String> {
    let result = if is_sqlite_driver(&driver) {
        build_sqlite_create_table_statements(&schema, &table, &columns)
    } else {
        DatabaseKind::from_str(&driver)
            .map_err(|error| error.to_string())
            .and_then(|kind| build_create_table_statements(kind, &schema, &table, &columns))
    };
    Ok(match result {
        Ok(statements) => Response::ok(statements),
        Err(error) => Response::err("PREVIEW_CREATE_TABLE_ERROR", &error),
    })
}

#[tauri::command]
pub async fn create_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    columns: Vec<CreateTableColumn>,
) -> Result<Response<CreateTableResult>, String> {
    let result: Result<CreateTableResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "creation").await?;
        let statements = if is_sqlite_driver(&driver) {
            build_sqlite_create_table_statements(&schema, &table, &columns)?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_create_table_statements(kind, &schema, &table, &columns)?
        };

        for statement in &statements {
            manager
                .query(&connection_id, statement, None, None, None)
                .await
                .map_err(|e| e.to_string())?;
        }

        Ok(CreateTableResult {
            table: table.trim().to_string(),
            statements,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_view(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    select_sql: String,
    replace: Option<bool>,
) -> Result<Response<CreateViewResult>, String> {
    let result: Result<CreateViewResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "view creation").await?;
        let statement = if is_sqlite_driver(&driver) {
            build_sqlite_create_view_statement(
                &schema,
                &view,
                &select_sql,
                replace.unwrap_or(false),
            )?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_create_view_statement(
                kind,
                &schema,
                &view,
                &select_sql,
                replace.unwrap_or(false),
            )?
        };

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(CreateViewResult {
            view: view.trim().to_string(),
            statement,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_VIEW_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_materialized_view(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    select_sql: String,
    with_data: Option<bool>,
) -> Result<Response<CreateMaterializedViewResult>, String> {
    let result: Result<CreateMaterializedViewResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "materialized-view creation")
            .await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let statement = build_create_materialized_view_statement(
            kind,
            &schema,
            &view,
            &select_sql,
            with_data.unwrap_or(true),
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(CreateMaterializedViewResult {
            view: view.trim().to_string(),
            statement,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_MATERIALIZED_VIEW_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn add_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    column: CreateTableColumn,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "column creation").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let statements = if is_sqlite_driver(&driver) {
            build_sqlite_add_column_statements(&schema, &table, &column)?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_add_table_column_statements(kind, &schema, &table, &column)?
        };

        execute_table_column_statements(&manager, &connection_id, &statements).await?;

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: column.name.trim().to_string(),
            statements,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("ADD_TABLE_COLUMN_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    column: String,
    cascade: Option<bool>,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "column deletion").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let cascade = cascade.unwrap_or(false);
        if is_sqlite_driver(&driver) && cascade {
            return Err("SQLite does not support CASCADE when dropping a column".to_string());
        }
        let statement = if is_sqlite_driver(&driver) {
            build_sqlite_drop_column_statement(&schema, &table, &column)?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_drop_table_column_statement(kind, &schema, &table, &column, cascade)?
        };

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: column.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("DROP_TABLE_COLUMN_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn rename_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    old_name: String,
    new_name: String,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "column rename").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = if is_sqlite_driver(&driver) {
            build_sqlite_rename_column_statement(
                &schema,
                &table,
                &old_name,
                &new_name,
                &existing_columns,
            )?
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            build_rename_table_column_statement(
                kind,
                &schema,
                &table,
                &old_name,
                &new_name,
                &existing_columns,
            )?
        };

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: new_name.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("RENAME_TABLE_COLUMN_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn alter_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    changes: AlterTableColumn,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "column alteration").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statements = build_alter_table_column_statements(
            kind,
            &schema,
            &table,
            &changes,
            &existing_columns,
        )?;

        execute_table_column_statements(&manager, &connection_id, &statements).await?;

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: changes.name.trim().to_string(),
            statements,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("ALTER_TABLE_COLUMN_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn truncate_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "truncation").await?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::Truncate,
        )
        .await?;
        let sql = if is_sqlite_driver(&driver) {
            format!(
                "DELETE FROM {};",
                sqlite_qualified_relation(&schema, &table)?
            )
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            kind.truncate_table_query(schema_option(&schema), &table)
        };
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!("Table {} truncated", table))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("TRUNCATE_TABLE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    cascade: Option<bool>,
    object_type: Option<String>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "deletion").await?;
        let table_name = table.trim();
        if table_name.is_empty() {
            return Err("Table name is required".to_string());
        }

        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, table_name, object_type).await?;
        let is_view = object_type_is_view(object_type.as_deref());
        let is_materialized_view = object_type_is_materialized_view(object_type.as_deref());
        let is_foreign_table = object_type_is_foreign_table(object_type.as_deref());
        let sql = if is_sqlite_driver(&driver) {
            if cascade.unwrap_or(false) {
                return Err("SQLite does not support CASCADE when dropping a relation".to_string());
            }
            if is_materialized_view || is_foreign_table {
                return Err("SQLite does not support this relation type".to_string());
            }
            let relation_kind = if is_view { "VIEW" } else { "TABLE" };
            format!(
                "DROP {relation_kind} {};",
                sqlite_qualified_relation(&schema, table_name)?,
            )
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            kind.drop_relation_query_with_kind(
                schema_option(&schema),
                table_name,
                is_view,
                is_materialized_view,
                is_foreign_table,
                cascade.unwrap_or(false),
            )
        };
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        let label = object_label_from_type(object_type.as_deref());
        Ok(format!("{label} {table_name} dropped"))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("DROP_TABLE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn rename_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    old_name: String,
    new_name: String,
    object_type: Option<String>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "rename").await?;
        let old_name = old_name.trim();
        let new_name = new_name.trim();
        if old_name.is_empty() || new_name.is_empty() {
            return Err("Object names are required".to_string());
        }

        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, old_name, object_type).await?;
        let is_view = object_type_is_view(object_type.as_deref());
        let is_materialized_view = object_type_is_materialized_view(object_type.as_deref());
        let is_foreign_table = object_type_is_foreign_table(object_type.as_deref());
        let sql = if is_sqlite_driver(&driver) {
            if is_view || is_materialized_view || is_foreign_table {
                return Err("SQLite only supports renaming tables through this action".to_string());
            }
            format!(
                "ALTER TABLE {} RENAME TO {};",
                sqlite_qualified_relation(&schema, old_name)?,
                sqlite_quote_identifier(new_name),
            )
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            kind.rename_relation_query_with_kind(
                schema_option(&schema),
                old_name,
                new_name,
                is_view,
                is_materialized_view,
                is_foreign_table,
            )
        };
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        let label = object_label_from_type(object_type.as_deref());
        Ok(format!("{label} {old_name} renamed to {new_name}"))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("RENAME_TABLE_ERROR", &error)),
    }
}
