//! Transfer identity for table operations.

use super::access::query_target;
use super::export_sql::sql_string_literal;
use super::policy::schema_option;
use super::transfer_types::{TableDataTransferEndpoint, TableDataTransferIdentityReseedPlan};
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ColumnInfo;
use crate::core::protocol::ParameterizedStatement;
use crate::core::protocol::QueryResult;
use serde_json::Value;

pub(super) fn postgres_identity_reseed_columns(
    target_kind: DatabaseKind,
    target_columns: &[ColumnInfo],
    enabled: bool,
) -> Result<Vec<String>, String> {
    if !enabled {
        return Ok(Vec::new());
    }
    if target_kind != DatabaseKind::Postgres {
        return Err(
            "Identity reseed is currently available only for a PostgreSQL target.".to_string(),
        );
    }
    Ok(target_columns
        .iter()
        .filter(|column| {
            column.is_auto_increment
                || column
                    .default_value
                    .as_deref()
                    .is_some_and(|value| value.to_ascii_lowercase().contains("nextval("))
        })
        .map(|column| column.name.clone())
        .collect())
}

pub(super) fn postgres_identity_reseed_plan_query(
    endpoint: &TableDataTransferEndpoint,
    column: &str,
) -> String {
    let relation =
        DatabaseKind::Postgres.qualified_table(schema_option(&endpoint.schema), &endpoint.table);
    let relation_literal = sql_string_literal(&relation);
    let column_literal = sql_string_literal(column);
    let quoted_column = DatabaseKind::Postgres.quote_identifier(column);
    format!(
        "WITH selected AS (\
             SELECT pg_catalog.pg_get_serial_sequence({relation_literal}, {column_literal}) AS qualified_name\
         ), sequence_relation AS (\
             SELECT sequence_class.oid, sequence_namespace.nspname AS sequence_schema, \
                    sequence_class.relname AS sequence_name \
             FROM selected \
             JOIN pg_catalog.pg_class sequence_class \
               ON sequence_class.oid = selected.qualified_name::pg_catalog.regclass \
             JOIN pg_catalog.pg_namespace sequence_namespace \
               ON sequence_namespace.oid = sequence_class.relnamespace \
             WHERE sequence_class.relkind = 'S'\
         ) \
         SELECT sequence_relation.sequence_schema, sequence_relation.sequence_name, \
                owner.owner_schema, owner.owner_table, owner.owner_column, \
                pg_catalog.pg_sequence_last_value(sequence_relation.oid::pg_catalog.regclass)::text, \
                (SELECT MAX({quoted_column})::text FROM {relation}) \
         FROM sequence_relation \
         LEFT JOIN LATERAL (\
             SELECT owner_namespace.nspname AS owner_schema, \
                    owner_class.relname AS owner_table, \
                    owner_attribute.attname AS owner_column \
             FROM pg_catalog.pg_depend dependency \
             JOIN pg_catalog.pg_class owner_class ON owner_class.oid = dependency.refobjid \
             JOIN pg_catalog.pg_namespace owner_namespace ON owner_namespace.oid = owner_class.relnamespace \
             JOIN pg_catalog.pg_attribute owner_attribute \
               ON owner_attribute.attrelid = owner_class.oid \
              AND owner_attribute.attnum = dependency.refobjsubid \
             WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass \
               AND dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass \
               AND dependency.objid = sequence_relation.oid \
               AND dependency.deptype IN ('a', 'i') \
             ORDER BY dependency.deptype \
             LIMIT 1\
         ) owner ON TRUE"
    )
}

pub(super) fn required_postgres_identity_state_cell(
    row: &[Value],
    index: usize,
    label: &str,
) -> Result<String, String> {
    let value = row
        .get(index)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("PostgreSQL identity preview did not return {label}."))?;
    if value.len() > 256 || value.chars().any(char::is_control) {
        return Err(format!(
            "PostgreSQL identity preview returned an invalid {label}."
        ));
    }
    Ok(value.to_string())
}

pub(super) fn optional_postgres_identity_numeric_state(
    row: &[Value],
    index: usize,
    label: &str,
) -> Result<Option<String>, String> {
    let Some(value) = row
        .get(index)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    value
        .parse::<i64>()
        .map_err(|_| format!("PostgreSQL identity preview returned an invalid {label}."))?;
    Ok(Some(value.to_string()))
}

pub(super) fn postgres_identity_reseed_plan_from_results(
    endpoint: &TableDataTransferEndpoint,
    column: &str,
    results: &[QueryResult],
) -> Result<TableDataTransferIdentityReseedPlan, String> {
    let row = results
        .first()
        .and_then(|result| result.rows.first())
        .ok_or_else(|| {
            format!(
                "PostgreSQL target column {}.{} has no attached serial/identity sequence.",
                endpoint.table, column
            )
        })?;
    let sequence_schema = required_postgres_identity_state_cell(row, 0, "sequence schema")?;
    let sequence_name = required_postgres_identity_state_cell(row, 1, "sequence name")?;
    let owner_schema = required_postgres_identity_state_cell(row, 2, "owner schema")?;
    let owner_table = required_postgres_identity_state_cell(row, 3, "owner table")?;
    let owner_column = required_postgres_identity_state_cell(row, 4, "owner column")?;
    if (!endpoint.schema.trim().is_empty() && owner_schema != endpoint.schema)
        || owner_table != endpoint.table
        || owner_column != column
    {
        return Err(format!(
            "PostgreSQL sequence {}.{} is not owned by the reviewed target column {}.{}.",
            sequence_schema, sequence_name, endpoint.table, column
        ));
    }
    Ok(TableDataTransferIdentityReseedPlan {
        column: column.to_string(),
        sequence_schema,
        sequence_name,
        owner_schema,
        owner_table,
        owner_column,
        current_value: optional_postgres_identity_numeric_state(row, 5, "sequence value")?,
        target_max_value: optional_postgres_identity_numeric_state(row, 6, "table maximum")?,
    })
}

pub(super) async fn resolve_postgres_identity_reseed_plans(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
    columns: &[String],
) -> Result<Vec<TableDataTransferIdentityReseedPlan>, String> {
    let mut plans = Vec::with_capacity(columns.len());
    for column in columns {
        let sql = postgres_identity_reseed_plan_query(endpoint, column);
        let results = query_target(
            manager,
            &endpoint.connection_id,
            endpoint.database.as_deref(),
            &sql,
        )
        .await
        .map_err(|error| {
            format!(
                "Could not inspect PostgreSQL generator ownership for {}.{}: {error}",
                endpoint.table, column
            )
        })?;
        plans.push(postgres_identity_reseed_plan_from_results(
            endpoint, column, &results,
        )?);
    }
    plans.sort_by(|left, right| left.column.cmp(&right.column));
    Ok(plans)
}

pub(super) fn postgres_identity_reseed_statements(
    endpoint: &TableDataTransferEndpoint,
    plans: &[TableDataTransferIdentityReseedPlan],
) -> Vec<ParameterizedStatement> {
    let relation =
        DatabaseKind::Postgres.qualified_table(schema_option(&endpoint.schema), &endpoint.table);
    plans
        .iter()
        .map(|plan| {
            let quoted_column = DatabaseKind::Postgres.quote_identifier(&plan.column);
            let sequence = DatabaseKind::Postgres
                .qualified_table(Some(&plan.sequence_schema), &plan.sequence_name);
            ParameterizedStatement {
                sql: format!(
                    "SELECT pg_catalog.setval({}::pg_catalog.regclass, GREATEST(COALESCE(MAX({quoted_column}), 0), 1), MAX({quoted_column}) IS NOT NULL) FROM {relation}",
                    sql_string_literal(&sequence),
                ),
                params: Vec::new(),
            }
        })
        .collect()
}
