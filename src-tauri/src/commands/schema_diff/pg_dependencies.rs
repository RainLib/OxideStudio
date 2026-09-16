use super::capture_identity::{schema_object_definition_key, sql_string_literal};
use super::pg_routine::{
    postgres_trigger_definition_query, postgres_view_dependency_query, PostgresViewDependencies,
};
use crate::core::manager::ConnectionManager;
use std::collections::HashMap;

pub(super) async fn capture_postgres_trigger_definitions(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    driver: &str,
    schema: &str,
) -> Result<HashMap<String, String>, String> {
    if !driver.trim().eq_ignore_ascii_case("postgres") {
        return Ok(HashMap::new());
    }
    let sql = postgres_trigger_definition_query(schema);
    let results = match database {
        Some(database) => manager.query_database(connection_id, database, &sql).await,
        None => {
            manager
                .query(connection_id, &sql, Some(schema.to_string()), None, None)
                .await
        }
    }
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
        let definition = definition.trim();
        if !name.trim().is_empty() && !parent_name.trim().is_empty() && !definition.is_empty() {
            definitions.insert(
                schema_object_definition_key(Some(parent_name), name),
                definition.to_string(),
            );
        }
    }
    Ok(definitions)
}

pub(super) fn postgres_trigger_routine_dependency_query(schema: &str) -> String {
    let schema = sql_string_literal(schema);
    format!(
        "SELECT trigger.tgname AS trigger_name, relation.relname AS parent_name, routine.proname AS routine_name \
         FROM pg_catalog.pg_trigger trigger \
         JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace \
         JOIN pg_catalog.pg_proc routine ON routine.oid = trigger.tgfoid \
         WHERE namespace.nspname = {schema} AND NOT trigger.tgisinternal \
         ORDER BY relation.relname, trigger.tgname, routine.proname;"
    )
}

pub(super) async fn capture_postgres_trigger_routine_dependencies(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    driver: &str,
    schema: &str,
) -> Result<HashMap<String, Vec<String>>, String> {
    if !driver.trim().eq_ignore_ascii_case("postgres") {
        return Ok(HashMap::new());
    }
    let sql = postgres_trigger_routine_dependency_query(schema);
    let results = match database {
        Some(database) => manager.query_database(connection_id, database, &sql).await,
        None => {
            manager
                .query(connection_id, &sql, Some(schema.to_string()), None, None)
                .await
        }
    }
    .map_err(|error| error.to_string())?;
    let mut dependencies = HashMap::<String, Vec<String>>::new();
    for row in results.iter().flat_map(|result| result.rows.iter()) {
        let (Some(name), Some(parent_name), Some(routine)) = (
            row.first().and_then(serde_json::Value::as_str),
            row.get(1).and_then(serde_json::Value::as_str),
            row.get(2).and_then(serde_json::Value::as_str),
        ) else {
            continue;
        };
        if !name.trim().is_empty() && !parent_name.trim().is_empty() && !routine.trim().is_empty() {
            dependencies
                .entry(schema_object_definition_key(Some(parent_name), name))
                .or_default()
                .push(routine.to_string());
        }
    }
    for trigger_dependencies in dependencies.values_mut() {
        trigger_dependencies.sort();
        trigger_dependencies.dedup();
    }
    Ok(dependencies)
}

pub(super) async fn capture_postgres_view_dependencies(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    driver: &str,
    schema: &str,
) -> Result<HashMap<String, PostgresViewDependencies>, String> {
    if !driver.trim().eq_ignore_ascii_case("postgres") {
        return Ok(HashMap::new());
    }
    let sql = postgres_view_dependency_query(schema);
    let results = match database {
        Some(database) => manager.query_database(connection_id, database, &sql).await,
        None => {
            manager
                .query(connection_id, &sql, Some(schema.to_string()), None, None)
                .await
        }
    }
    .map_err(|error| error.to_string())?;
    let mut dependencies = HashMap::<String, PostgresViewDependencies>::new();
    for row in results.iter().flat_map(|result| result.rows.iter()) {
        let Some(view) = row.first().and_then(serde_json::Value::as_str) else {
            continue;
        };
        let Some(dependency) = row.get(1).and_then(serde_json::Value::as_str) else {
            continue;
        };
        let Some(dependency_schema) = row.get(2).and_then(serde_json::Value::as_str) else {
            continue;
        };
        if !view.trim().is_empty()
            && !dependency.trim().is_empty()
            && !view.eq_ignore_ascii_case(dependency)
        {
            let entry = dependencies.entry(view.to_string()).or_default();
            if dependency_schema.eq_ignore_ascii_case(schema) {
                entry.same_schema.push(dependency.to_string());
            } else {
                entry
                    .external
                    .push(format!("{dependency_schema}.{dependency}"));
            }
        }
    }
    for relation_dependencies in dependencies.values_mut() {
        relation_dependencies.same_schema.sort();
        relation_dependencies.same_schema.dedup();
        relation_dependencies.external.sort();
        relation_dependencies.external.dedup();
    }
    Ok(dependencies)
}
