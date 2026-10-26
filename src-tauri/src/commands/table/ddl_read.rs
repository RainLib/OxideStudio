//! Ddl read for table operations.
use super::limits::{MAX_POSTGRES_ROUTINE_SOURCE_CHARS, MAX_POSTGRES_ROUTINE_SOURCE_OVERLOADS};

use super::access::{get_target_columns, query_target, resolve_object_type};
use super::export_sql::sql_string_literal;
use super::policy::{
    ensure_host_table_ddl_allowed, object_type_is_materialized_view, object_type_is_view,
    schema_option,
};
use super::postgres_catalog::{
    generate_postgres_materialized_view_ddl, generate_postgres_table_ddl,
    generate_postgres_view_ddl, view_definition_query,
};
use super::sqlite_ddl::{is_sqlite_driver, sqlite_quote_identifier};
use super::values::value_to_string;
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::QueryParameter;
use crate::core::protocol::Response;
use percent_encoding::utf8_percent_encode;
use percent_encoding::NON_ALPHANUMERIC;
use serde_json::Value;
use std::str::FromStr;
use tauri::State;

#[tauri::command]
pub async fn get_view_definition(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    object_type: Option<String>,
) -> Result<Response<String>, String> {
    let error_context = serde_json::json!({
        "connectionId": connection_id,
        "driver": driver,
        "schema": schema,
        "view": view,
    });
    let result: Result<String, String> = async {
        let view_name = view.trim();
        if view_name.is_empty() {
            return Err("View name is required".to_string());
        }

        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, view_name, object_type).await?;
        if !object_type_is_view(object_type.as_deref()) {
            return Err(format!("{view_name} is not a view"));
        }

        // Native view definition SQL is vendor-specific. An external package
        // can now return its own reviewed renderer output through the
        // read-only object-source protocol; it must never inherit this Host
        // query merely because it shares a driver id with a built-in dialect.
        if manager
            .is_external_driver_connection(&connection_id)
            .await
            .map_err(|error| error.to_string())?
        {
            return manager
                .get_object_source(
                    &connection_id,
                    &schema,
                    view_name,
                    object_type.as_deref().unwrap_or("VIEW"),
                    None,
                )
                .await
                .map_err(|error| error.to_string())?
                .into_iter()
                .find(|source| !source.trim().is_empty())
                .ok_or_else(|| "External driver did not provide this view definition".to_string());
        }
        ensure_host_table_ddl_allowed(&manager, &connection_id, "view definition introspection")
            .await?;

        let sql = if is_sqlite_driver(&driver) {
            let catalog = if schema.trim().is_empty() {
                "sqlite_master".to_string()
            } else {
                format!("{}.sqlite_master", sqlite_quote_identifier(&schema))
            };
            format!(
                "SELECT sql AS definition FROM {catalog} WHERE type = 'view' AND name = {};",
                sql_string_literal(view_name),
            )
        } else {
            let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
            view_definition_query(kind, &schema, view_name)
        };
        let results = manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        let definition = results
            .first()
            .and_then(|result| result.rows.first())
            .and_then(|row| row.first())
            .and_then(value_to_string)
            .unwrap_or_default();

        if definition.trim().is_empty() {
            Err("View definition not found".to_string())
        } else {
            Ok(definition)
        }
    }
    .await;

    match result {
        Ok(definition) => Ok(Response::ok(definition)),
        Err(error) => Ok(Response::err_with_details(
            "GET_VIEW_DEFINITION_ERROR",
            &error,
            true,
            Some(error_context),
        )),
    }
}

/// Reads PostgreSQL routine source through the server's own definition
/// renderer. FunctionInfo does not yet carry an OID/identity-arguments token,
/// so overloads are deliberately returned as a bounded list instead of
/// guessing a single one. External packages use their own explicit
/// sidecar source-definition protocol and never inherit Host catalog SQL.
#[tauri::command]
pub async fn get_postgres_routine_definitions(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    routine: String,
) -> Result<Response<Vec<String>>, String> {
    let result: Result<Vec<String>, String> = async {
        if manager
            .is_external_driver_connection(&connection_id)
            .await
            .map_err(|error| error.to_string())?
        {
            let routine = routine.trim();
            if routine.is_empty() {
                return Err("Routine name is required".to_string());
            }
            let definitions = manager
                .get_object_source(&connection_id, &schema, routine, "FUNCTION", None)
                .await
                .map_err(|error| error.to_string())?
                .into_iter()
                .filter(|source| !source.trim().is_empty())
                .collect::<Vec<_>>();
            if definitions.is_empty() {
                return Err("External driver did not provide this routine definition".to_string());
            }
            return Ok(definitions);
        }
        ensure_host_table_ddl_allowed(&manager, &connection_id, "routine definition introspection")
            .await?;
        let routine = routine.trim();
        if routine.is_empty() {
            return Err("Routine name is required".to_string());
        }
        let sql = format!(
            "SELECT LEFT(pg_get_functiondef(p.oid), {MAX_POSTGRES_ROUTINE_SOURCE_CHARS}) AS definition \\
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace \\
             WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind IN ('f', 'p') \\
             ORDER BY pg_get_function_identity_arguments(p.oid) LIMIT {MAX_POSTGRES_ROUTINE_SOURCE_OVERLOADS}"
        );
        let results = manager
            .query_parameterized(
                &connection_id,
                &sql,
                &[
                    QueryParameter { value: Value::String(schema.trim().to_string()), data_type: Some("text".to_string()) },
                    QueryParameter { value: Value::String(routine.to_string()), data_type: Some("text".to_string()) },
                ],
            )
            .await
            .map_err(|error| error.to_string())?;
        let definitions: Vec<String> = results
            .first()
            .map(|result| result.rows.iter().filter_map(|row| row.first().and_then(value_to_string)).collect())
            .unwrap_or_default();
        if definitions.is_empty() {
            return Err("Routine definition not found or not visible to this role".to_string());
        }
        Ok(definitions)
    }.await;
    match result {
        Ok(definitions) => Ok(Response::ok(definitions)),
        Err(error) => Ok(Response::err(
            "GET_POSTGRES_ROUTINE_DEFINITION_ERROR",
            &error,
        )),
    }
}

pub(super) async fn get_elasticsearch_index_mapping(
    manager: &ConnectionManager,
    connection_id: &str,
    index: &str,
) -> Result<String, anyhow::Error> {
    let index = index.trim();
    if index.is_empty() {
        return Err(anyhow::anyhow!("Elasticsearch index name is required"));
    }
    let encoded_index = utf8_percent_encode(index, NON_ALPHANUMERIC).to_string();
    let results = manager
        .query(
            connection_id,
            &format!("GET /{encoded_index}/_mapping"),
            None,
            None,
            None,
        )
        .await?;
    let result = results
        .first()
        .ok_or_else(|| anyhow::anyhow!("Elasticsearch returned no mapping result"))?;
    let mapping_column = result
        .columns
        .iter()
        .position(|column| column.name == "result")
        .ok_or_else(|| anyhow::anyhow!("Elasticsearch mapping result is malformed"))?;
    let mapping = result
        .rows
        .first()
        .and_then(|row| row.get(mapping_column))
        .ok_or_else(|| anyhow::anyhow!("Elasticsearch mapping response is empty"))?;
    serde_json::to_string_pretty(mapping).map_err(Into::into)
}

#[tauri::command]
pub async fn refresh_materialized_view(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    object_type: Option<String>,
    concurrently: Option<bool>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        ensure_host_table_ddl_allowed(&manager, &connection_id, "materialized-view refresh")
            .await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let view_name = view.trim();
        if view_name.is_empty() {
            return Err("View name is required".to_string());
        }

        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, view_name, object_type).await?;
        if !object_type_is_materialized_view(object_type.as_deref()) {
            return Err(format!("{view_name} is not a materialized view"));
        }

        let sql = kind
            .refresh_materialized_view_query(
                schema_option(&schema),
                view_name,
                concurrently.unwrap_or(false),
            )
            .ok_or_else(|| "Materialized views are not supported by this driver".to_string())?;
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!("Materialized view {view_name} refreshed"))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("REFRESH_MATERIALIZED_VIEW_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn get_table_ddl(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    object_type: Option<String>,
    database: Option<String>,
) -> Result<Response<String>, String> {
    let error_context = serde_json::json!({
        "connectionId": connection_id,
        "driver": driver,
        "database": database,
        "schema": schema,
        "table": table,
    });
    let result: Result<String, String> = async {
        if matches!(
            driver.trim().to_ascii_lowercase().as_str(),
            "elasticsearch" | "elastic"
        ) {
            return get_elasticsearch_index_mapping(&manager, &connection_id, &table)
                .await
                .map_err(|error| error.to_string());
        }
        let table_name = table.trim();
        if table_name.is_empty() {
            return Err("Object name is required".to_string());
        }
        if let Some(definition) = manager
            .managed_table_definition(&connection_id, database.as_deref(), &schema, table_name)
            .await
            .map_err(|error| error.to_string())?
        {
            return Ok(definition);
        }
        if manager
            .is_external_driver_connection(&connection_id)
            .await
            .map_err(|error| error.to_string())?
        {
            let requested_type = object_type.as_deref().unwrap_or("TABLE");
            let source = manager
                .get_object_source(&connection_id, &schema, table_name, requested_type, None)
                .await
                .map_err(|error| error.to_string())?
                .into_iter()
                .find(|source| !source.trim().is_empty())
                .ok_or_else(|| {
                    "External driver did not provide this object definition".to_string()
                })?;
            return if object_type_is_materialized_view(object_type.as_deref()) {
                Ok(generate_postgres_materialized_view_ddl(
                    DatabaseKind::Postgres,
                    &schema,
                    table_name,
                    &source,
                ))
            } else if object_type_is_view(object_type.as_deref()) {
                Ok(generate_postgres_view_ddl(
                    DatabaseKind::Postgres,
                    &schema,
                    table_name,
                    &source,
                ))
            } else {
                Ok(source)
            };
        }
        // This command falls back to Host-generated SHOW CREATE and
        // reconstruction queries. An external package can deliberately reuse
        // a built-in driver id while having different catalog or DDL grammar,
        // so do not mistake its metadata capability for a reviewed table
        // definition protocol.
        ensure_host_table_ddl_allowed(&manager, &connection_id, "definition introspection").await?;
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let database = database.as_deref();
        let object_type = if let Some(explicit_type) = object_type
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            Some(explicit_type)
        } else if let Some(database) = database {
            manager
                .get_database_tables(&connection_id, database, &schema)
                .await
                .map_err(|error| error.to_string())?
                .into_iter()
                .find(|candidate| candidate.name == table_name)
                .and_then(|candidate| candidate.table_type)
        } else {
            resolve_object_type(&manager, &connection_id, &schema, table_name, None).await?
        };
        let is_view = object_type_is_view(object_type.as_deref());
        let is_materialized_view = object_type_is_materialized_view(object_type.as_deref());

        if let Some(sql) =
            kind.show_create_relation_query(schema_option(&schema), table_name, is_view)
        {
            let results = query_target(&manager, &connection_id, database, &sql)
                .await
                .map_err(|e| e.to_string())?;
            let ddl = results
                .first()
                .and_then(|result| result.rows.first())
                .and_then(|row| row.get(1))
                .and_then(value_to_string)
                .unwrap_or_else(|| "-- DDL not found".to_string());
            return Ok(ddl);
        }

        if is_view {
            let sql = view_definition_query(kind, &schema, table_name);
            let results = query_target(&manager, &connection_id, database, &sql)
                .await
                .map_err(|e| e.to_string())?;
            let definition = results
                .first()
                .and_then(|result| result.rows.first())
                .and_then(|row| row.first())
                .and_then(value_to_string)
                .unwrap_or_default();
            if definition.trim().is_empty() {
                return Ok("-- DDL not found: view definition is empty".to_string());
            }

            if is_materialized_view {
                return Ok(generate_postgres_materialized_view_ddl(
                    kind,
                    &schema,
                    table_name,
                    &definition,
                ));
            }

            return Ok(generate_postgres_view_ddl(
                kind,
                &schema,
                table_name,
                &definition,
            ));
        }

        let columns = get_target_columns(&manager, &connection_id, database, &schema, table_name)
            .await
            .map_err(|e| e.to_string())?;
        let constraints = match database {
            Some(database) => {
                manager
                    .get_database_constraints(&connection_id, database, &schema, table_name)
                    .await
            }
            None => {
                manager
                    .get_constraints(&connection_id, &schema, table_name)
                    .await
            }
        }
        .unwrap_or_default();
        let indexes = match database {
            Some(database) => {
                manager
                    .get_database_indexes(&connection_id, database, &schema, table_name)
                    .await
            }
            None => {
                manager
                    .get_indexes(&connection_id, &schema, table_name)
                    .await
            }
        }
        .unwrap_or_default();

        if columns.is_empty() {
            return Ok("-- DDL not found: table has no column metadata".to_string());
        }

        Ok(generate_postgres_table_ddl(
            &schema,
            table_name,
            &columns,
            &constraints,
            &indexes,
        ))
    }
    .await;

    match result {
        Ok(ddl) => Ok(Response::ok(ddl)),
        Err(error) => Ok(Response::err_with_details(
            "GET_TABLE_DDL_ERROR",
            &error,
            true,
            Some(error_context),
        )),
    }
}
