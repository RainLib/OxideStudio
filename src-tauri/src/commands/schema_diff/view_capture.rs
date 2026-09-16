use super::capture_identity::{schema_object_definition_key, sql_string_literal};
use crate::core::dialect::canonical_driver_name;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::QueryResult;
use std::collections::HashMap;

pub(super) fn object_type_is_view(object_type: Option<&str>) -> bool {
    object_type.is_some_and(|value| value.to_ascii_uppercase().contains("VIEW"))
}

/// PostgreSQL/MySQL return a SELECT body so the planner owns target-side view
/// identity. SQLite instead retains its exact sqlite_schema CREATE VIEW source
/// and rewrites only the frozen target identity. PostgreSQL additionally
/// returns `relispopulated` for materialized views so their initial refresh
/// behavior is not silently changed.
pub(super) fn native_view_definition_query(
    driver: &str,
    schema: &str,
    view: &str,
) -> Option<String> {
    match driver.trim().to_ascii_lowercase().as_str() {
        "postgres" => {
            let schema = sql_string_literal(schema);
            let view = sql_string_literal(view);
            Some(format!(
                "SELECT pg_catalog.pg_get_viewdef(class.oid, true) AS definition, \
                    CASE WHEN class.relkind = 'm' THEN class.relispopulated::text ELSE NULL END \
                        AS materialized_view_populated \
             FROM pg_catalog.pg_class class \
             JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace \
             WHERE namespace.nspname = {schema} AND class.relname = {view} \
             AND class.relkind IN ('v', 'm');"
            ))
        }
        "mysql" => {
            let schema = sql_string_literal(schema);
            let view = sql_string_literal(view);
            Some(format!(
                "SELECT VIEW_DEFINITION AS definition FROM information_schema.VIEWS \
             WHERE TABLE_SCHEMA = {schema} AND TABLE_NAME = {view};"
            ))
        }
        "sqlite" => {
            let schema = format!("\"{}\"", schema.replace('"', "\"\""));
            let view = sql_string_literal(view);
            Some(format!(
                "SELECT sql AS definition FROM {schema}.sqlite_schema \
                 WHERE type = 'view' AND name = {view} AND sql IS NOT NULL LIMIT 1;"
            ))
        }
        _ => None,
    }
}

pub(super) fn query_native_view_definition(
    results: &[QueryResult],
) -> Option<(String, Option<bool>)> {
    results
        .first()?
        .rows
        .first()?
        .first()?
        .as_str()
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .map(|definition| {
            let materialized_view_populated = results
                .first()
                .and_then(|result| result.rows.first())
                .and_then(|row| row.get(1))
                .and_then(|value| value.as_str())
                .and_then(|value| match value.trim().to_ascii_lowercase().as_str() {
                    "true" | "t" | "1" => Some(true),
                    "false" | "f" | "0" => Some(false),
                    _ => None,
                });
            (definition, materialized_view_populated)
        })
}

pub(super) async fn capture_native_view_definition(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    driver: &str,
    schema: &str,
    view: &str,
) -> Result<Option<(String, Option<bool>)>, String> {
    let Some(sql) = native_view_definition_query(driver, schema, view) else {
        return Ok(None);
    };
    let results = match database {
        Some(database) => manager.query_database(connection_id, database, &sql).await,
        None => {
            manager
                .query(connection_id, &sql, Some(schema.to_string()), None, None)
                .await
        }
    }
    .map_err(|error| error.to_string())?;
    Ok(query_native_view_definition(&results))
}

pub(super) fn sqlite_table_definition_query(
    driver: &str,
    schema: &str,
    table: &str,
) -> Option<String> {
    (canonical_driver_name(driver) == Some("sqlite")).then(|| {
        let schema = format!("\"{}\"", schema.replace('"', "\"\""));
        let table = sql_string_literal(table);
        format!(
            "SELECT sql AS definition FROM {schema}.sqlite_schema \
             WHERE type = 'table' AND name = {table} AND sql IS NOT NULL LIMIT 1;"
        )
    })
}

pub(super) async fn capture_sqlite_table_definition(
    manager: &ConnectionManager,
    connection_id: &str,
    driver: &str,
    schema: &str,
    table: &str,
) -> Result<Option<String>, String> {
    let Some(sql) = sqlite_table_definition_query(driver, schema, table) else {
        return Ok(None);
    };
    let results = manager
        .query(connection_id, &sql, Some(schema.to_string()), None, None)
        .await
        .map_err(|error| error.to_string())?;
    Ok(results
        .first()
        .and_then(|result| result.rows.first())
        .and_then(|row| row.first())
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|definition| !definition.is_empty())
        .map(str::to_string))
}

pub(super) fn sqlite_trigger_definition_query(driver: &str, schema: &str) -> Option<String> {
    (canonical_driver_name(driver) == Some("sqlite")).then(|| {
        let schema = format!("\"{}\"", schema.replace('"', "\"\""));
        format!(
            "SELECT name, tbl_name, sql AS definition FROM {schema}.sqlite_schema \
             WHERE type = 'trigger' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL \
             ORDER BY tbl_name, name;"
        )
    })
}

pub(super) async fn capture_sqlite_trigger_definitions(
    manager: &ConnectionManager,
    connection_id: &str,
    driver: &str,
    schema: &str,
) -> Result<HashMap<String, String>, String> {
    let Some(sql) = sqlite_trigger_definition_query(driver, schema) else {
        return Ok(HashMap::new());
    };
    let results = manager
        .query(connection_id, &sql, Some(schema.to_string()), None, None)
        .await
        .map_err(|error| error.to_string())?;
    let mut definitions = HashMap::new();
    for row in results.iter().flat_map(|result| result.rows.iter()) {
        let (Some(name), Some(parent_name), Some(definition)) = (
            row.first().and_then(serde_json::Value::as_str),
            row.get(1).and_then(serde_json::Value::as_str),
            row.get(2).and_then(serde_json::Value::as_str),
        ) else {
            continue;
        };
        if !name.trim().is_empty()
            && !parent_name.trim().is_empty()
            && !definition.trim().is_empty()
        {
            definitions.insert(
                schema_object_definition_key(Some(parent_name), name),
                definition.trim().to_string(),
            );
        }
    }
    Ok(definitions)
}
