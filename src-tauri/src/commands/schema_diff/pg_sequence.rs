use super::capture_identity::sql_string_literal;
use crate::core::manager::ConnectionManager;
use crate::core::schema_diff::SchemaSequenceOwnerSnapshot;
use std::collections::HashMap;

/// Creates reviewable sequence DDL without copying mutable last-value state.
/// `pg_sequence` exposes only typed catalog values and identifiers are quoted
/// by PostgreSQL itself, so no user-provided SQL fragment is interpolated.
pub(super) fn postgres_sequence_definition_query(schema: &str) -> String {
    let schema = sql_string_literal(schema);
    format!(
        "SELECT relation.relname AS sequence_name, \
         format('CREATE SEQUENCE %I.%I AS %s INCREMENT BY %s MINVALUE %s MAXVALUE %s START WITH %s CACHE %s %s;', \
           namespace.nspname, relation.relname, pg_catalog.format_type(sequence.seqtypid, NULL), \
           sequence.seqincrement, sequence.seqmin, sequence.seqmax, sequence.seqstart, \
           sequence.seqcache, CASE WHEN sequence.seqcycle THEN 'CYCLE' ELSE 'NO CYCLE' END) AS definition \
         FROM pg_catalog.pg_class relation \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace \
         JOIN pg_catalog.pg_sequence sequence ON sequence.seqrelid = relation.oid \
         WHERE namespace.nspname = {schema} AND relation.relkind = 'S' \
         ORDER BY relation.relname;"
    )
}

pub(super) async fn capture_postgres_sequence_definitions(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    driver: &str,
    schema: &str,
) -> Result<HashMap<String, String>, String> {
    if !driver.trim().eq_ignore_ascii_case("postgres") {
        return Ok(HashMap::new());
    }
    let sql = postgres_sequence_definition_query(schema);
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
        let (Some(name), Some(definition)) = (
            row.first().and_then(serde_json::Value::as_str),
            row.get(1).and_then(serde_json::Value::as_str),
        ) else {
            continue;
        };
        let definition = definition.trim();
        if !name.trim().is_empty() && !definition.is_empty() {
            definitions.insert(name.to_string(), definition.to_string());
        }
    }
    Ok(definitions)
}

#[derive(Debug, Clone, Default)]
pub(super) struct PostgresSequenceState {
    pub(super) owner: Option<SchemaSequenceOwnerSnapshot>,
    pub(super) last_value: Option<String>,
    pub(super) is_called: Option<bool>,
}

pub(super) fn postgres_sequence_owner_query(schema: &str) -> String {
    let schema = sql_string_literal(schema);
    format!(
        "SELECT sequence.relname AS sequence_name, owner_table.relname AS owner_table, \
         owner_column.attname AS owner_column \
         FROM pg_catalog.pg_class sequence \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = sequence.relnamespace \
         LEFT JOIN pg_catalog.pg_depend ownership \
           ON ownership.classid = 'pg_catalog.pg_class'::regclass \
          AND ownership.objid = sequence.oid \
          AND ownership.refclassid = 'pg_catalog.pg_class'::regclass \
          AND ownership.deptype IN ('a', 'i') \
         LEFT JOIN pg_catalog.pg_class owner_table ON owner_table.oid = ownership.refobjid \
         LEFT JOIN pg_catalog.pg_attribute owner_column \
           ON owner_column.attrelid = owner_table.oid AND owner_column.attnum = ownership.refobjsubid \
         WHERE namespace.nspname = {schema} AND sequence.relkind = 'S' \
         ORDER BY sequence.relname;"
    )
}

pub(super) fn postgres_sequence_last_value_query(schema: &str) -> String {
    let schema = sql_string_literal(schema);
    format!(
        "SELECT sequence.relname AS sequence_name, \
         CASE WHEN pg_catalog.has_sequence_privilege(sequence.oid, 'SELECT') \
                    OR pg_catalog.has_sequence_privilege(sequence.oid, 'USAGE') \
              THEN COALESCE(pg_catalog.pg_sequence_last_value(sequence.oid), parameters.seqstart)::text \
              ELSE NULL END AS state_value, \
         CASE WHEN pg_catalog.has_sequence_privilege(sequence.oid, 'SELECT') \
                    OR pg_catalog.has_sequence_privilege(sequence.oid, 'USAGE') \
              THEN pg_catalog.pg_sequence_last_value(sequence.oid) IS NOT NULL \
              ELSE NULL END AS is_called \
         FROM pg_catalog.pg_class sequence \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = sequence.relnamespace \
         JOIN pg_catalog.pg_sequence parameters ON parameters.seqrelid = sequence.oid \
         WHERE namespace.nspname = {schema} AND sequence.relkind = 'S' \
         ORDER BY sequence.relname;"
    )
}

pub(super) fn optional_postgres_sequence_boolean(
    value: Option<&serde_json::Value>,
) -> Option<bool> {
    match value? {
        serde_json::Value::Bool(value) => Some(*value),
        serde_json::Value::String(value) => match value.trim().to_ascii_lowercase().as_str() {
            "true" | "t" | "yes" | "y" | "1" => Some(true),
            "false" | "f" | "no" | "n" | "0" => Some(false),
            _ => None,
        },
        serde_json::Value::Number(value) if value.as_i64() == Some(1) => Some(true),
        serde_json::Value::Number(value) if value.as_i64() == Some(0) => Some(false),
        _ => None,
    }
}

pub(super) async fn capture_postgres_sequence_state(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    driver: &str,
    schema: &str,
) -> Result<HashMap<String, PostgresSequenceState>, String> {
    if !driver.trim().eq_ignore_ascii_case("postgres") {
        return Ok(HashMap::new());
    }
    let owner_sql = postgres_sequence_owner_query(schema);
    let owner_results = match database {
        Some(database) => {
            manager
                .query_database(connection_id, database, &owner_sql)
                .await
        }
        None => {
            manager
                .query(
                    connection_id,
                    &owner_sql,
                    Some(schema.to_string()),
                    None,
                    None,
                )
                .await
        }
    }
    .map_err(|error| error.to_string())?;
    let mut state: HashMap<String, PostgresSequenceState> = HashMap::new();
    for row in owner_results.iter().flat_map(|result| result.rows.iter()) {
        let (Some(name), Some(table_name), Some(column_name)) = (
            row.first().and_then(serde_json::Value::as_str),
            row.get(1).and_then(serde_json::Value::as_str),
            row.get(2).and_then(serde_json::Value::as_str),
        ) else {
            continue;
        };
        if !name.trim().is_empty()
            && !table_name.trim().is_empty()
            && !column_name.trim().is_empty()
        {
            state.entry(name.to_string()).or_default().owner = Some(SchemaSequenceOwnerSnapshot {
                table_name: table_name.to_string(),
                column_name: column_name.to_string(),
            });
        }
    }
    // Restricted users sometimes cannot read last values even though ownership
    // metadata is visible. In that case callers keep the independently
    // captured structural sequence definition and surface a warning instead
    // of manufacturing a partial ownership/state migration.
    let value_sql = postgres_sequence_last_value_query(schema);
    let value_results = match database {
        Some(database) => {
            manager
                .query_database(connection_id, database, &value_sql)
                .await
        }
        None => {
            manager
                .query(
                    connection_id,
                    &value_sql,
                    Some(schema.to_string()),
                    None,
                    None,
                )
                .await
        }
    }
    .map_err(|error| error.to_string())?;
    for row in value_results.iter().flat_map(|result| result.rows.iter()) {
        let (Some(name), Some(last_value), Some(is_called)) = (
            row.first().and_then(serde_json::Value::as_str),
            row.get(1).and_then(serde_json::Value::as_str),
            optional_postgres_sequence_boolean(row.get(2)),
        ) else {
            continue;
        };
        if last_value.trim().parse::<i64>().is_ok() {
            let sequence = state.entry(name.to_string()).or_default();
            sequence.last_value = Some(last_value.trim().to_string());
            sequence.is_called = Some(is_called);
        }
    }
    Ok(state)
}

/// Captures direct default-expression -> sequence edges. This puts a new
/// sequence ahead of a newly-created table or added column; ownership/state is
/// captured separately and scheduled only after the owning relation exists.
pub(super) fn postgres_relation_sequence_dependency_query(schema: &str) -> String {
    let schema = sql_string_literal(schema);
    format!(
        "SELECT relation.relname AS relation_name, sequence.relname AS sequence_name \
         FROM pg_catalog.pg_attrdef default_expression \
         JOIN pg_catalog.pg_class relation ON relation.oid = default_expression.adrelid \
         JOIN pg_catalog.pg_namespace relation_namespace ON relation_namespace.oid = relation.relnamespace \
         JOIN pg_catalog.pg_depend dependency ON dependency.classid = 'pg_catalog.pg_attrdef'::regclass \
           AND dependency.objid = default_expression.oid AND dependency.deptype = 'n' \
         JOIN pg_catalog.pg_class sequence ON sequence.oid = dependency.refobjid \
         JOIN pg_catalog.pg_namespace sequence_namespace ON sequence_namespace.oid = sequence.relnamespace \
         WHERE relation_namespace.nspname = {schema} AND sequence_namespace.nspname = {schema} \
           AND relation.relkind IN ('r', 'p', 'f') AND sequence.relkind = 'S' \
         ORDER BY relation.relname, sequence.relname;"
    )
}

pub(super) async fn capture_postgres_relation_sequence_dependencies(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    driver: &str,
    schema: &str,
) -> Result<HashMap<String, Vec<String>>, String> {
    if !driver.trim().eq_ignore_ascii_case("postgres") {
        return Ok(HashMap::new());
    }
    let sql = postgres_relation_sequence_dependency_query(schema);
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
        let (Some(relation), Some(sequence)) = (
            row.first().and_then(serde_json::Value::as_str),
            row.get(1).and_then(serde_json::Value::as_str),
        ) else {
            continue;
        };
        if !relation.trim().is_empty() && !sequence.trim().is_empty() {
            dependencies
                .entry(relation.to_string())
                .or_default()
                .push(sequence.to_string());
        }
    }
    for relation_dependencies in dependencies.values_mut() {
        relation_dependencies.sort();
        relation_dependencies.dedup();
    }
    Ok(dependencies)
}
