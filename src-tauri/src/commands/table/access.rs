//! Access for table operations.

use super::compare_types::TableDataCompareEndpoint;
use super::policy::{ensure_relation_operation_allowed, schema_option, RelationOperation};
use super::transfer_types::TableDataTransferEndpoint;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ColumnInfo;
use crate::core::protocol::ParameterizedStatement;
use crate::core::protocol::QueryParameter;
use crate::core::protocol::QueryResult;

pub(super) async fn resolve_object_type(
    manager: &ConnectionManager,
    connection_id: &str,
    schema: &str,
    object_name: &str,
    object_type: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(object_type) = object_type
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok(Some(object_type));
    }

    let object_name = object_name.trim();
    if object_name.is_empty() {
        return Ok(None);
    }

    let tables = manager
        .get_tables(connection_id, schema)
        .await
        .map_err(|e| e.to_string())?;

    Ok(tables
        .into_iter()
        .find(|table| table.name == object_name)
        .and_then(|table| table.table_type))
}

pub(super) async fn ensure_resolved_relation_operation_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
    schema: &str,
    object_name: &str,
    operation: RelationOperation,
) -> Result<Option<String>, String> {
    let object_type =
        resolve_object_type(manager, connection_id, schema, object_name, None).await?;
    ensure_relation_operation_allowed(object_name, object_type.as_deref(), operation)?;
    Ok(object_type)
}

pub(super) async fn ensure_target_relation_operation_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    schema: &str,
    object_name: &str,
    operation: RelationOperation,
) -> Result<Option<String>, String> {
    if let Some(database) = database {
        let object_type = manager
            .get_database_tables(connection_id, database, schema)
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|table| table.name == object_name)
            .and_then(|table| table.table_type);
        ensure_relation_operation_allowed(object_name, object_type.as_deref(), operation)?;
        return Ok(object_type);
    }

    ensure_resolved_relation_operation_allowed(
        manager,
        connection_id,
        schema,
        object_name,
        operation,
    )
    .await
}

pub(super) async fn get_target_columns(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, anyhow::Error> {
    match database {
        Some(database) => {
            manager
                .get_database_columns(connection_id, database, schema, table)
                .await
        }
        None => manager.get_columns(connection_id, schema, table).await,
    }
}

pub(super) async fn query_target(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    sql: &str,
) -> Result<Vec<QueryResult>, anyhow::Error> {
    match database {
        Some(database) => manager.query_database(connection_id, database, sql).await,
        None => manager.query(connection_id, sql, None, None, None).await,
    }
}

pub(super) async fn query_data_compare_target_tracked(
    manager: &ConnectionManager,
    endpoint: &TableDataCompareEndpoint,
    query_id: &str,
    sql: &str,
) -> Result<Vec<QueryResult>, anyhow::Error> {
    match endpoint.database.as_deref() {
        Some(database) => {
            manager
                .query_database_with_context(
                    &endpoint.connection_id,
                    database,
                    sql,
                    schema_option(&endpoint.schema),
                    Some(query_id),
                )
                .await
        }
        None => {
            manager
                .query(
                    &endpoint.connection_id,
                    sql,
                    schema_option(&endpoint.schema).map(str::to_string),
                    None,
                    Some(query_id.to_string()),
                )
                .await
        }
    }
}

pub(super) async fn query_transfer_source_tracked(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
    transfer_id: &str,
    sql: &str,
) -> Result<Vec<QueryResult>, anyhow::Error> {
    match endpoint.database.as_deref() {
        Some(database) => {
            manager
                .query_database_with_context(
                    &endpoint.connection_id,
                    database,
                    sql,
                    schema_option(&endpoint.schema),
                    Some(transfer_id),
                )
                .await
        }
        None => {
            manager
                .query(
                    &endpoint.connection_id,
                    sql,
                    schema_option(&endpoint.schema).map(str::to_string),
                    None,
                    Some(transfer_id.to_string()),
                )
                .await
        }
    }
}

pub(super) async fn query_target_parameterized(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    sql: &str,
    params: &[QueryParameter],
) -> Result<Vec<QueryResult>, anyhow::Error> {
    match database {
        Some(database) => {
            manager
                .query_database_parameterized(connection_id, database, sql, params)
                .await
        }
        None => {
            manager
                .query_parameterized(connection_id, sql, params)
                .await
        }
    }
}

pub(super) async fn execute_target_parameterized_batch(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    statements: &[ParameterizedStatement],
) -> Result<Vec<u64>, anyhow::Error> {
    match database {
        Some(database) => {
            manager
                .execute_database_parameterized_batch(connection_id, database, statements)
                .await
        }
        None => {
            manager
                .execute_parameterized_batch(connection_id, statements)
                .await
        }
    }
}
