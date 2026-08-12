/// Schema 元数据相关 commands
use crate::core::{
    manager::ConnectionManager,
    protocol::{
        CollectionInfo, CollectionPage, ColumnInfo, ConstraintInfo, DatabaseInfo,
        ForeignKeyReferenceInfo, FunctionInfo, IndexInfo, Response, SchemaObjectInfo, TableInfo,
    },
};
use tauri::State;

fn schema_result<T>(
    result: Result<T, impl std::fmt::Display>,
    code: &str,
    context: serde_json::Value,
) -> Response<T> {
    match result {
        Ok(data) => Response::ok(data),
        Err(error) => Response::err_with_details(code, &error.to_string(), true, Some(context)),
    }
}

/// Get databases visible from the connected server.
#[tauri::command]
pub async fn get_databases(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Response<Vec<String>>, String> {
    let result = manager.get_databases(&connection_id).await;
    Ok(schema_result(
        result,
        "DATABASE_LIST_FAILED",
        serde_json::json!({ "connectionId": connection_id }),
    ))
}

/// 获取所有 schemas
#[tauri::command]
pub async fn get_schemas(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Response<Vec<String>>, String> {
    println!("Getting schemas for connection: {}", connection_id);

    let result = manager.get_schemas(&connection_id).await;
    Ok(schema_result(
        result,
        "SCHEMA_LIST_FAILED",
        serde_json::json!({ "connectionId": connection_id }),
    ))
}

/// Get schemas from one explicitly selected database without changing the
/// active query connection.
#[tauri::command]
pub async fn get_database_schemas(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
) -> Result<Response<Vec<String>>, String> {
    let result = manager
        .get_database_schemas(&connection_id, &database)
        .await;
    Ok(schema_result(
        result,
        "DATABASE_SCHEMA_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "database": database,
        }),
    ))
}

/// 获取指定 schema 下的所有表
#[tauri::command]
pub async fn get_tables(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<Vec<TableInfo>>, String> {
    println!("Getting tables for schema: {}", schema);

    let result = manager.get_tables(&connection_id, &schema).await;
    Ok(schema_result(
        result,
        "TABLE_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "schema": schema,
        }),
    ))
}

/// 获取指定 namespace 下的 collections/indexes
#[tauri::command]
pub async fn get_collections(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    namespace: String,
) -> Result<Response<Vec<CollectionInfo>>, String> {
    let result = manager.get_collections(&connection_id, &namespace).await;
    Ok(schema_result(
        result,
        "COLLECTION_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "namespace": namespace,
        }),
    ))
}

#[tauri::command]
pub async fn get_collections_page(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    namespace: String,
    cursor: Option<String>,
    limit: usize,
    filter: Option<String>,
) -> Result<Response<CollectionPage>, String> {
    let result = manager
        .get_collections_page(
            &connection_id,
            &namespace,
            cursor.as_deref(),
            limit.clamp(1, 1_000),
            filter.as_deref(),
        )
        .await;
    Ok(schema_result(
        result,
        "COLLECTION_PAGE_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "namespace": namespace,
            "cursor": cursor,
            "limit": limit.clamp(1, 1_000),
        }),
    ))
}

/// Lists descriptor-only objects such as PostgreSQL sequences and triggers.
/// This is not a generic DDL/source endpoint and exposes no write action.
#[tauri::command]
pub async fn get_schema_objects(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<Vec<SchemaObjectInfo>>, String> {
    let result = manager.get_schema_objects(&connection_id, &schema).await;
    Ok(schema_result(
        result,
        "SCHEMA_OBJECT_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "schema": schema,
        }),
    ))
}

/// Get the richest safe catalog metadata exposed by the active driver.
/// Optional fields remain empty when a product or account cannot provide them.
#[tauri::command]
pub async fn get_database_metadata(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Response<Vec<DatabaseInfo>>, String> {
    let result = manager.get_database_metadata(&connection_id).await;
    Ok(schema_result(
        result,
        "DATABASE_METADATA_FAILED",
        serde_json::json!({ "connectionId": connection_id }),
    ))
}

/// Lists children of a descriptor object that the driver explicitly marked as
/// expandable. The result remains read-only metadata, never a table target.
#[tauri::command]
pub async fn get_schema_object_members(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    object_name: String,
    object_type: String,
) -> Result<Response<Vec<SchemaObjectInfo>>, String> {
    let result = manager
        .get_schema_object_members(&connection_id, &schema, &object_name, &object_type)
        .await;
    Ok(schema_result(
        result,
        "SCHEMA_OBJECT_MEMBER_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "schema": schema,
            "objectName": object_name,
            "objectType": object_type,
        }),
    ))
}

/// Get read-only descriptors for non-relation objects in one explicitly
/// selected database. This metadata path never changes the query connection's
/// active database.
#[tauri::command]
pub async fn get_database_schema_objects(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
) -> Result<Response<Vec<SchemaObjectInfo>>, String> {
    let result = manager
        .get_database_schema_objects(&connection_id, &database, &schema)
        .await;
    Ok(schema_result(
        result,
        "DATABASE_SCHEMA_OBJECT_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "database": database,
            "schema": schema,
        }),
    ))
}

/// Database-scoped descriptor members without changing the active database.
#[tauri::command]
pub async fn get_database_schema_object_members(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
    object_name: String,
    object_type: String,
) -> Result<Response<Vec<SchemaObjectInfo>>, String> {
    let result = manager
        .get_database_schema_object_members(
            &connection_id,
            &database,
            &schema,
            &object_name,
            &object_type,
        )
        .await;
    Ok(schema_result(
        result,
        "DATABASE_SCHEMA_OBJECT_MEMBER_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "database": database,
            "schema": schema,
            "objectName": object_name,
            "objectType": object_type,
        }),
    ))
}

/// Get tables from a schema in one explicitly selected database.
#[tauri::command]
pub async fn get_database_tables(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
) -> Result<Response<Vec<TableInfo>>, String> {
    let result = manager
        .get_database_tables(&connection_id, &database, &schema)
        .await;
    Ok(schema_result(
        result,
        "DATABASE_TABLE_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "database": database,
            "schema": schema,
        }),
    ))
}

/// 获取表的列信息
#[tauri::command]
pub async fn get_columns(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<ColumnInfo>>, String> {
    let result = manager.get_columns(&connection_id, &schema, &table).await;
    Ok(schema_result(
        result,
        "COLUMN_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "schema": schema,
            "table": table,
        }),
    ))
}

/// Get column names whose values are generated by the database.
#[tauri::command]
pub async fn get_generated_columns(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<String>>, String> {
    let result = manager
        .get_generated_columns(&connection_id, &schema, &table)
        .await;
    Ok(schema_result(
        result,
        "GENERATED_COLUMN_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "schema": schema,
            "table": table,
        }),
    ))
}

/// Get table columns from one explicitly selected database.
#[tauri::command]
pub async fn get_database_columns(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<ColumnInfo>>, String> {
    let result = manager
        .get_database_columns(&connection_id, &database, &schema, &table)
        .await;
    Ok(schema_result(
        result,
        "DATABASE_COLUMN_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "database": database,
            "schema": schema,
            "table": table,
        }),
    ))
}

/// Get generated columns from one explicitly selected database.
#[tauri::command]
pub async fn get_database_generated_columns(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<String>>, String> {
    let result = manager
        .get_database_generated_columns(&connection_id, &database, &schema, &table)
        .await;
    Ok(schema_result(
        result,
        "DATABASE_GENERATED_COLUMN_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "database": database,
            "schema": schema,
            "table": table,
        }),
    ))
}

/// 获取表的索引信息
#[tauri::command]
pub async fn get_indexes(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<IndexInfo>>, String> {
    let result = manager.get_indexes(&connection_id, &schema, &table).await;
    Ok(schema_result(
        result,
        "INDEX_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "schema": schema,
            "table": table,
        }),
    ))
}

/// Get table indexes from one explicitly selected database.
#[tauri::command]
pub async fn get_database_indexes(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<IndexInfo>>, String> {
    let result = manager
        .get_database_indexes(&connection_id, &database, &schema, &table)
        .await;
    Ok(schema_result(
        result,
        "DATABASE_INDEX_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "database": database,
            "schema": schema,
            "table": table,
        }),
    ))
}

/// 获取表的约束和外键信息
#[tauri::command]
pub async fn get_constraints(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<ConstraintInfo>>, String> {
    let result = manager
        .get_constraints(&connection_id, &schema, &table)
        .await;
    Ok(schema_result(
        result,
        "CONSTRAINT_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "schema": schema,
            "table": table,
        }),
    ))
}

/// Get table constraints from one explicitly selected database.
#[tauri::command]
pub async fn get_database_constraints(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<ConstraintInfo>>, String> {
    let result = manager
        .get_database_constraints(&connection_id, &database, &schema, &table)
        .await;
    Ok(schema_result(
        result,
        "DATABASE_CONSTRAINT_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "database": database,
            "schema": schema,
            "table": table,
        }),
    ))
}

/// Find foreign keys in other relations that reference the selected table.
#[tauri::command]
pub async fn get_referencing_foreign_keys(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<ForeignKeyReferenceInfo>>, String> {
    let result = manager
        .get_referencing_foreign_keys(&connection_id, &schema, &table)
        .await;
    Ok(schema_result(
        result,
        "REFERENCING_FOREIGN_KEY_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "schema": schema,
            "table": table,
        }),
    ))
}

/// Database-scoped reverse foreign-key lookup for PostgreSQL explorer tabs.
#[tauri::command]
pub async fn get_database_referencing_foreign_keys(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<ForeignKeyReferenceInfo>>, String> {
    let result = manager
        .get_database_referencing_foreign_keys(&connection_id, &database, &schema, &table)
        .await;
    Ok(schema_result(
        result,
        "DATABASE_REFERENCING_FOREIGN_KEY_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "database": database,
            "schema": schema,
            "table": table,
        }),
    ))
}

/// 获取 schema 下的函数和存储过程信息
#[tauri::command]
pub async fn get_functions(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<Vec<FunctionInfo>>, String> {
    let result = manager.get_functions(&connection_id, &schema).await;
    Ok(schema_result(
        result,
        "FUNCTION_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "schema": schema,
        }),
    ))
}

/// Get routines from a schema in one explicitly selected database.
#[tauri::command]
pub async fn get_database_functions(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    schema: String,
) -> Result<Response<Vec<FunctionInfo>>, String> {
    let result = manager
        .get_database_functions(&connection_id, &database, &schema)
        .await;
    Ok(schema_result(
        result,
        "DATABASE_FUNCTION_LIST_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "database": database,
            "schema": schema,
        }),
    ))
}

/// 设置当前活动 schema
#[tauri::command]
pub async fn set_current_schema(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<String>, String> {
    let result = manager
        .set_current_schema(&connection_id, &schema)
        .await
        .map(|_| format!("Schema set to: {schema}"));
    Ok(schema_result(
        result,
        "SET_CURRENT_SCHEMA_FAILED",
        serde_json::json!({
            "connectionId": connection_id,
            "schema": schema,
        }),
    ))
}
