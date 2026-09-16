use super::capture_identity::sql_string_literal;
use crate::core::manager::ConnectionManager;

pub(super) fn postgres_view_dependency_query(schema: &str) -> String {
    let schema = sql_string_literal(schema);
    format!(
        "SELECT dependent.relname AS view_name, referenced.relname AS depends_on, \
                referenced_namespace.nspname AS depends_on_schema \
         FROM pg_catalog.pg_rewrite rewrite \
         JOIN pg_catalog.pg_class dependent ON dependent.oid = rewrite.ev_class \
         JOIN pg_catalog.pg_namespace dependent_namespace ON dependent_namespace.oid = dependent.relnamespace \
         JOIN pg_catalog.pg_depend dependency ON dependency.objid = rewrite.oid \
         JOIN pg_catalog.pg_class referenced ON referenced.oid = dependency.refobjid \
         JOIN pg_catalog.pg_namespace referenced_namespace ON referenced_namespace.oid = referenced.relnamespace \
         WHERE dependent_namespace.nspname = {schema} \
           AND dependent.relkind IN ('v', 'm') \
           AND referenced.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') \
           AND dependent.oid <> referenced.oid \
           AND dependency.deptype = 'n' \
         ORDER BY dependent.relname, referenced.relname;"
    )
}

#[derive(Debug, Clone, Default)]
pub(super) struct PostgresViewDependencies {
    pub(super) same_schema: Vec<String>,
    pub(super) external: Vec<String>,
}

#[derive(Debug, Clone)]
pub(super) struct PostgresRoutineDefinition {
    pub(super) name: String,
    pub(super) routine_type: String,
    pub(super) definition: String,
}

/// `pg_get_functiondef` is the native, fully-qualified create-or-replace
/// definition for a function or procedure. The ordering intentionally mirrors
/// the PostgreSQL driver's routine discovery query, so overloads can be paired
/// without guessing from rendered parameter text.
pub(super) fn postgres_routine_definition_query(schema: &str) -> String {
    let schema = sql_string_literal(schema);
    format!(
        "SELECT procedure.proname AS routine_name, \
         CASE WHEN procedure.prokind = 'p' THEN 'procedure' ELSE 'function' END AS routine_type, \
         pg_catalog.pg_get_functiondef(procedure.oid) AS definition \
         FROM pg_catalog.pg_proc procedure \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace \
         WHERE namespace.nspname = {schema} AND procedure.prokind IN ('f', 'p') \
         ORDER BY procedure.proname, pg_catalog.pg_get_function_identity_arguments(procedure.oid);"
    )
}

pub(super) async fn capture_postgres_routine_definitions(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    driver: &str,
    schema: &str,
) -> Result<Vec<PostgresRoutineDefinition>, String> {
    if !driver.trim().eq_ignore_ascii_case("postgres") {
        return Ok(Vec::new());
    }
    let sql = postgres_routine_definition_query(schema);
    let results = match database {
        Some(database) => manager.query_database(connection_id, database, &sql).await,
        None => {
            manager
                .query(connection_id, &sql, Some(schema.to_string()), None, None)
                .await
        }
    }
    .map_err(|error| error.to_string())?;
    Ok(results
        .iter()
        .flat_map(|result| result.rows.iter())
        .filter_map(|row| {
            Some(PostgresRoutineDefinition {
                name: row.first()?.as_str()?.to_string(),
                routine_type: row.get(1)?.as_str()?.to_ascii_lowercase(),
                definition: row.get(2)?.as_str()?.trim().to_string(),
            })
        })
        .filter(|definition| !definition.definition.is_empty())
        .collect())
}

pub(super) fn postgres_trigger_definition_query(schema: &str) -> String {
    let schema = sql_string_literal(schema);
    format!(
        "SELECT trigger.tgname AS trigger_name, relation.relname AS parent_name, \
         pg_catalog.pg_get_triggerdef(trigger.oid, true) AS definition \
         FROM pg_catalog.pg_trigger trigger \
         JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace \
         WHERE namespace.nspname = {schema} AND NOT trigger.tgisinternal \
         ORDER BY relation.relname, trigger.tgname;"
    )
}
