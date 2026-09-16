//! Postgres catalog for table operations.

use super::export_sql::sql_string_literal;
use super::limits::{MAX_POSTGRES_BACKUP_ROUTINES, MAX_POSTGRES_ROUTINE_SOURCE_CHARS};
use super::policy::schema_option;
use super::values::{value_to_export_string, value_to_string};
use crate::core::dialect::DatabaseKind;
use crate::core::protocol::ColumnInfo;
use crate::core::protocol::ConstraintInfo;
use crate::core::protocol::IndexInfo;
use crate::core::protocol::QueryResult;
use crate::core::protocol::TableInfo;
use serde_json::Value;
use std::collections::BTreeMap;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PostgresExportSequence {
    pub(super) name: String,
    pub(super) data_type: String,
    pub(super) start_value: String,
    pub(super) min_value: String,
    pub(super) max_value: String,
    pub(super) increment_by: String,
    pub(super) cycle: bool,
    pub(super) cache_size: String,
    pub(super) last_value: Option<String>,
    pub(super) is_called: Option<bool>,
    pub(super) owner_table: Option<String>,
    pub(super) owner_column: Option<String>,
}

pub(super) fn postgres_sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub(super) fn postgres_sequence_integer(
    value: Option<&Value>,
    field: &str,
    name: &str,
) -> Result<String, String> {
    let value = value
        .filter(|value| !value.is_null())
        .map(value_to_export_string)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("PostgreSQL sequence {name} has no {field}"))?;
    value
        .parse::<i128>()
        .map_err(|_| format!("PostgreSQL sequence {name} has an invalid {field}"))?;
    Ok(value)
}

pub(super) fn postgres_sequence_from_row(row: &[Value]) -> Result<PostgresExportSequence, String> {
    let name = row
        .first()
        .and_then(value_to_string)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "PostgreSQL sequence metadata has no sequence name".to_string())?;
    let data_type = row
        .get(1)
        .and_then(value_to_string)
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| matches!(value.as_str(), "smallint" | "integer" | "bigint"))
        .ok_or_else(|| format!("PostgreSQL sequence {name} has an unsupported data type"))?;
    let cycle = row
        .get(6)
        .and_then(value_to_string)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "true" | "t" | "yes" | "y" | "1"
            )
        })
        .ok_or_else(|| format!("PostgreSQL sequence {name} has no cycle setting"))?;
    let last_value = row
        .get(8)
        .filter(|value| !value.is_null())
        .map(|value| postgres_sequence_integer(Some(value), "last value", &name))
        .transpose()?;
    let is_called = row.get(9).and_then(|value| match value {
        Value::Bool(value) => Some(*value),
        Value::String(value) => match value.trim().to_ascii_lowercase().as_str() {
            "true" | "t" | "yes" | "y" | "1" => Some(true),
            "false" | "f" | "no" | "n" | "0" => Some(false),
            _ => None,
        },
        Value::Number(value) if value.as_i64() == Some(1) => Some(true),
        Value::Number(value) if value.as_i64() == Some(0) => Some(false),
        _ => None,
    });
    Ok(PostgresExportSequence {
        name: name.clone(),
        data_type,
        start_value: postgres_sequence_integer(row.get(2), "start value", &name)?,
        min_value: postgres_sequence_integer(row.get(3), "minimum value", &name)?,
        max_value: postgres_sequence_integer(row.get(4), "maximum value", &name)?,
        increment_by: postgres_sequence_integer(row.get(5), "increment", &name)?,
        cycle,
        cache_size: postgres_sequence_integer(row.get(7), "cache size", &name)?,
        last_value,
        is_called,
        owner_table: row
            .get(10)
            .and_then(value_to_string)
            .filter(|value| !value.trim().is_empty()),
        owner_column: row
            .get(11)
            .and_then(value_to_string)
            .filter(|value| !value.trim().is_empty()),
    })
}

pub(super) fn postgres_sequence_ddl(schema: &str, sequence: &PostgresExportSequence) -> String {
    format!(
        "CREATE SEQUENCE {} AS {} START WITH {} INCREMENT BY {} MINVALUE {} MAXVALUE {} CACHE {} {};",
        DatabaseKind::Postgres.qualified_table(Some(schema), &sequence.name),
        sequence.data_type,
        sequence.start_value,
        sequence.increment_by,
        sequence.min_value,
        sequence.max_value,
        sequence.cache_size,
        if sequence.cycle { "CYCLE" } else { "NO CYCLE" },
    )
}

pub(super) fn postgres_sequence_setval_sql(
    schema: &str,
    sequence: &PostgresExportSequence,
) -> Option<String> {
    sequence.last_value.as_ref().map(|last_value| {
        let qualified = DatabaseKind::Postgres.qualified_table(Some(schema), &sequence.name);
        format!(
            "SELECT pg_catalog.setval({}::regclass, {}, {});",
            postgres_sql_string_literal(&qualified),
            last_value,
            sequence.is_called.unwrap_or(true),
        )
    })
}

pub(super) fn postgres_sequence_owner_sql(
    schema: &str,
    sequence: &PostgresExportSequence,
) -> Option<String> {
    let table = sequence.owner_table.as_deref()?;
    let column = sequence.owner_column.as_deref()?;
    Some(format!(
        "ALTER SEQUENCE {} OWNED BY {}.{};",
        DatabaseKind::Postgres.qualified_table(Some(schema), &sequence.name),
        DatabaseKind::Postgres.qualified_table(Some(schema), table),
        DatabaseKind::Postgres.quote_identifier(column),
    ))
}

pub(super) fn postgres_sequence_metadata_query(schema: &str) -> String {
    format!(
        "SELECT sequence_class.relname, sequences.data_type, sequences.start_value, sequences.min_value, sequences.max_value, sequences.increment_by, sequences.cycle, sequences.cache_size, \
         CASE WHEN pg_catalog.has_sequence_privilege(sequence_class.oid, 'SELECT') OR pg_catalog.has_sequence_privilege(sequence_class.oid, 'USAGE') THEN COALESCE(sequences.last_value, sequences.start_value) ELSE NULL END, \
         CASE WHEN pg_catalog.has_sequence_privilege(sequence_class.oid, 'SELECT') OR pg_catalog.has_sequence_privilege(sequence_class.oid, 'USAGE') THEN sequences.last_value IS NOT NULL ELSE NULL END, \
         owner_table.relname, owner_column.attname \
         FROM pg_catalog.pg_sequences sequences \
         JOIN pg_catalog.pg_class sequence_class ON sequence_class.relname = sequences.sequencename \
         JOIN pg_catalog.pg_namespace sequence_namespace ON sequence_namespace.oid = sequence_class.relnamespace AND sequence_namespace.nspname = sequences.schemaname \
         LEFT JOIN pg_catalog.pg_depend ownership ON ownership.classid = 'pg_class'::regclass AND ownership.objid = sequence_class.oid AND ownership.refclassid = 'pg_class'::regclass AND ownership.deptype IN ('a', 'i') \
         LEFT JOIN pg_catalog.pg_class owner_table ON owner_table.oid = ownership.refobjid \
         LEFT JOIN pg_catalog.pg_attribute owner_column ON owner_column.attrelid = owner_table.oid AND owner_column.attnum = ownership.refobjsubid \
         WHERE sequences.schemaname = {} ORDER BY sequence_class.relname",
        postgres_sql_string_literal(schema),
    )
}

pub(super) fn postgres_view_definition_query(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
) -> String {
    let qualified = kind.qualified_table(schema_option(schema), view);
    format!(
        "SELECT pg_get_viewdef(to_regclass({}), true) AS definition;",
        sql_string_literal(&qualified)
    )
}

pub(super) fn postgres_materialized_view_populated_query(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
) -> String {
    let qualified = kind.qualified_table(schema_option(schema), view);
    format!(
        "SELECT relispopulated FROM pg_catalog.pg_class WHERE oid = to_regclass({}) AND relkind = 'm';",
        sql_string_literal(&qualified)
    )
}

pub(super) fn view_definition_query(kind: DatabaseKind, schema: &str, view: &str) -> String {
    match kind {
        DatabaseKind::Postgres => postgres_view_definition_query(kind, schema, view),
        DatabaseKind::Mysql => format!(
            "SELECT VIEW_DEFINITION AS definition FROM information_schema.VIEWS WHERE TABLE_SCHEMA = {} AND TABLE_NAME = {};",
            sql_string_literal(schema),
            sql_string_literal(view)
        ),
    }
}

pub(super) fn generate_postgres_view_ddl(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
    definition: &str,
) -> String {
    format!(
        "CREATE OR REPLACE VIEW {} AS\n{};",
        kind.qualified_table(schema_option(schema), view),
        definition.trim().trim_end_matches(';')
    )
}

pub(super) fn generate_postgres_materialized_view_ddl(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
    definition: &str,
) -> String {
    generate_postgres_materialized_view_ddl_with_data(kind, schema, view, definition, true)
}

pub(super) fn generate_postgres_materialized_view_ddl_with_data(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
    definition: &str,
    with_data: bool,
) -> String {
    format!(
        "CREATE MATERIALIZED VIEW {} AS\n{} WITH {};",
        kind.qualified_table(schema_option(schema), view),
        definition.trim().trim_end_matches(';'),
        if with_data { "DATA" } else { "NO DATA" },
    )
}

/// Return direct relation dependencies that affect the replay order of views
/// in one PostgreSQL schema. `pg_rewrite` is the catalog object that owns a
/// view definition, so its normal dependencies describe both regular and
/// materialized view references without parsing database-owned SQL text.
pub(super) fn postgres_view_dependency_query(schema: &str) -> String {
    format!(
        "SELECT dependent.relname AS view_name, referenced.relname AS depends_on \
         FROM pg_catalog.pg_rewrite rewrite \
         JOIN pg_catalog.pg_class dependent ON dependent.oid = rewrite.ev_class \
         JOIN pg_catalog.pg_namespace dependent_namespace ON dependent_namespace.oid = dependent.relnamespace \
         JOIN pg_catalog.pg_depend dependency ON dependency.objid = rewrite.oid \
         JOIN pg_catalog.pg_class referenced ON referenced.oid = dependency.refobjid \
         JOIN pg_catalog.pg_namespace referenced_namespace ON referenced_namespace.oid = referenced.relnamespace \
         WHERE dependent_namespace.nspname = {schema} \
           AND referenced_namespace.nspname = {schema} \
           AND dependent.relkind IN ('v', 'm') \
           AND referenced.relkind IN ('v', 'm') \
           AND dependent.oid <> referenced.oid \
           AND dependency.deptype = 'n' \
         ORDER BY dependent.relname, referenced.relname;",
        schema = postgres_sql_string_literal(schema),
    )
}

/// A view can reference another view, but PostgreSQL requires that dependency
/// to exist when replaying `CREATE VIEW`. Keep the catalog ordering local to
/// the selected schema and reject an unexpected cycle rather than emitting a
/// dump that is known to fail during restore.
pub(super) fn order_postgres_views(
    views: Vec<TableInfo>,
    dependencies: &[(String, String)],
) -> Result<Vec<TableInfo>, String> {
    let views_by_name = views
        .into_iter()
        .map(|view| (view.name.clone(), view))
        .collect::<BTreeMap<_, _>>();
    let mut remaining = views_by_name.keys().cloned().collect::<BTreeSet<_>>();
    let mut requirements = BTreeMap::<String, BTreeSet<String>>::new();
    for (view, dependency) in dependencies {
        if views_by_name.contains_key(view) && views_by_name.contains_key(dependency) {
            requirements
                .entry(view.clone())
                .or_default()
                .insert(dependency.clone());
        }
    }

    let mut ordered = Vec::with_capacity(views_by_name.len());
    while !remaining.is_empty() {
        let next = remaining
            .iter()
            .find(|view| {
                requirements
                    .get(*view)
                    .is_none_or(|dependencies| dependencies.is_disjoint(&remaining))
            })
            .cloned();
        let Some(next) = next else {
            let unresolved = remaining.into_iter().collect::<Vec<_>>().join(", ");
            return Err(format!(
                "PostgreSQL view dependency cycle prevents a safe schema backup: {unresolved}"
            ));
        };
        remaining.remove(&next);
        if let Some(view) = views_by_name.get(&next) {
            ordered.push(view.clone());
        }
    }
    Ok(ordered)
}

pub(super) fn postgres_backup_routine_definitions_query(schema: &str) -> String {
    format!(
        "SELECT p.proname AS routine_name, pg_get_function_identity_arguments(p.oid) AS identity_arguments, \
         LEFT(pg_get_functiondef(p.oid), {source_limit}) AS definition \
         FROM pg_catalog.pg_proc p \
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
         WHERE n.nspname = {schema} AND p.prokind IN ('f', 'p') \
         ORDER BY p.proname, pg_get_function_identity_arguments(p.oid) \
         LIMIT {routine_limit};",
        schema = postgres_sql_string_literal(schema),
        source_limit = MAX_POSTGRES_ROUTINE_SOURCE_CHARS + 1,
        routine_limit = MAX_POSTGRES_BACKUP_ROUTINES + 1,
    )
}

pub(super) fn postgres_backup_routine_definitions(
    results: &[QueryResult],
) -> Result<Vec<String>, String> {
    let rows = results
        .iter()
        .flat_map(|result| result.rows.iter())
        .collect::<Vec<_>>();
    if rows.len() > MAX_POSTGRES_BACKUP_ROUTINES {
        return Err(format!(
            "PostgreSQL schema contains more than {MAX_POSTGRES_BACKUP_ROUTINES} routines; refusing a partial backup"
        ));
    }
    rows.into_iter()
        .map(|row| {
            let name = row.first().and_then(value_to_string).unwrap_or_default();
            let definition = row
                .get(2)
                .and_then(value_to_string)
                .filter(|definition| !definition.trim().is_empty())
                .ok_or_else(|| {
                    format!("PostgreSQL routine {name} has no definition available for backup")
                })?;
            if definition.chars().count() > MAX_POSTGRES_ROUTINE_SOURCE_CHARS {
                return Err(format!(
                    "PostgreSQL routine {name} exceeds the {MAX_POSTGRES_ROUTINE_SOURCE_CHARS}-character backup limit"
                ));
            }
            Ok(definition.trim().to_string())
        })
        .collect()
}

pub(super) fn postgres_extension_query(schema: &str) -> String {
    format!(
        "SELECT extension.extname, namespace.nspname \
         FROM pg_catalog.pg_extension extension \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = extension.extnamespace \
         WHERE namespace.nspname = {} ORDER BY extension.extname;",
        postgres_sql_string_literal(schema),
    )
}

pub(super) fn postgres_extension_ddls(results: &[QueryResult]) -> Result<Vec<String>, String> {
    results
        .iter()
        .flat_map(|result| result.rows.iter())
        .map(|row| {
            let name = row
                .first()
                .and_then(value_to_string)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "PostgreSQL extension metadata has no extension name".to_string())?;
            let schema = row
                .get(1)
                .and_then(value_to_string)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| format!("PostgreSQL extension {name} has no schema"))?;
            Ok(format!(
                "CREATE EXTENSION IF NOT EXISTS {} WITH SCHEMA {};",
                DatabaseKind::Postgres.quote_identifier(&name),
                DatabaseKind::Postgres.quote_identifier(&schema),
            ))
        })
        .collect()
}

pub(super) fn postgres_trigger_definitions_query(schema: &str) -> String {
    format!(
        "SELECT class.relname, pg_get_triggerdef(trigger.oid, true) \
         FROM pg_catalog.pg_trigger trigger \
         JOIN pg_catalog.pg_class class ON class.oid = trigger.tgrelid \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace \
         WHERE namespace.nspname = {} AND NOT trigger.tgisinternal \
         ORDER BY class.relname, trigger.tgname;",
        postgres_sql_string_literal(schema),
    )
}

pub(super) fn postgres_trigger_definitions(results: &[QueryResult]) -> Result<Vec<String>, String> {
    results
        .iter()
        .flat_map(|result| result.rows.iter())
        .map(|row| {
            let table = row.first().and_then(value_to_string).unwrap_or_default();
            row.get(1)
                .and_then(value_to_string)
                .filter(|definition| !definition.trim().is_empty())
                .map(|definition| format!("{};", definition.trim().trim_end_matches(';')))
                .ok_or_else(|| {
                    format!("PostgreSQL trigger on {table} has no definition available for backup")
                })
        })
        .collect()
}

pub(super) fn postgres_enum_definitions_query(schema: &str) -> String {
    format!(
        "SELECT type.typname, enum.enumlabel \
         FROM pg_catalog.pg_type type \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace \
         JOIN pg_catalog.pg_enum enum ON enum.enumtypid = type.oid \
         WHERE namespace.nspname = {} AND type.typtype = 'e' \
         ORDER BY type.typname, enum.enumsortorder;",
        postgres_sql_string_literal(schema),
    )
}

pub(super) fn postgres_enum_ddls(
    schema: &str,
    results: &[QueryResult],
) -> Result<Vec<String>, String> {
    let mut labels = BTreeMap::<String, Vec<String>>::new();
    for row in results.iter().flat_map(|result| result.rows.iter()) {
        let name = row
            .first()
            .and_then(value_to_string)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "PostgreSQL enum metadata has no type name".to_string())?;
        let label = row
            .get(1)
            .and_then(value_to_string)
            .ok_or_else(|| format!("PostgreSQL enum {name} has no label"))?;
        labels.entry(name).or_default().push(label);
    }
    Ok(labels
        .into_iter()
        .map(|(name, labels)| {
            format!(
                "CREATE TYPE {} AS ENUM ({});",
                DatabaseKind::Postgres.qualified_table(Some(schema), &name),
                labels
                    .into_iter()
                    .map(|label| postgres_sql_string_literal(&label))
                    .collect::<Vec<_>>()
                    .join(", "),
            )
        })
        .collect())
}

pub(super) fn postgres_domain_definitions_query(schema: &str) -> String {
    format!(
        "SELECT type.typname, pg_catalog.format_type(type.typbasetype, type.typtypmod), type.typnotnull, pg_catalog.pg_get_expr(type.typdefaultbin, 0), constraint.conname, pg_catalog.pg_get_constraintdef(constraint.oid, true) \
         FROM pg_catalog.pg_type type \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace \
         LEFT JOIN pg_catalog.pg_constraint constraint ON constraint.contypid = type.oid \
         WHERE namespace.nspname = {} AND type.typtype = 'd' \
         ORDER BY type.typname, constraint.conname;",
        postgres_sql_string_literal(schema),
    )
}

pub(super) fn postgres_domain_ddls(
    schema: &str,
    results: &[QueryResult],
) -> Result<Vec<String>, String> {
    let mut domains =
        BTreeMap::<String, (String, bool, Option<String>, Vec<(String, String)>)>::new();
    for row in results.iter().flat_map(|result| result.rows.iter()) {
        let name = row
            .first()
            .and_then(value_to_string)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "PostgreSQL domain metadata has no type name".to_string())?;
        let base_type = row
            .get(1)
            .and_then(value_to_string)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("PostgreSQL domain {name} has no base type"))?;
        let not_null = row.get(2).and_then(value_to_string).is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "true" | "t" | "1"
            )
        });
        let default = row
            .get(3)
            .and_then(value_to_string)
            .filter(|value| !value.trim().is_empty());
        let entry = domains
            .entry(name)
            .or_insert((base_type, not_null, default, Vec::new()));
        if let (Some(constraint_name), Some(definition)) = (
            row.get(4).and_then(value_to_string),
            row.get(5).and_then(value_to_string),
        ) {
            entry.3.push((constraint_name, definition));
        }
    }
    Ok(domains
        .into_iter()
        .map(|(name, (base_type, not_null, default, constraints))| {
            let mut clauses = vec![format!(
                "CREATE DOMAIN {} AS {}",
                DatabaseKind::Postgres.qualified_table(Some(schema), &name),
                base_type
            )];
            if let Some(default) = default {
                clauses.push(format!("DEFAULT {default}"));
            }
            if not_null {
                clauses.push("NOT NULL".to_string());
            }
            clauses.extend(constraints.into_iter().map(|(name, definition)| {
                format!(
                    "CONSTRAINT {} {}",
                    DatabaseKind::Postgres.quote_identifier(&name),
                    definition
                )
            }));
            format!("{};", clauses.join(" "))
        })
        .collect())
}

pub(super) fn postgres_composite_type_query(schema: &str) -> String {
    format!(
        "SELECT type.typname, attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) \
         FROM pg_catalog.pg_type type \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace \
         JOIN pg_catalog.pg_class class ON class.oid = type.typrelid AND class.relkind = 'c' \
         JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = class.oid \
         WHERE namespace.nspname = {} AND type.typtype = 'c' AND attribute.attnum > 0 AND NOT attribute.attisdropped \
         ORDER BY type.typname, attribute.attnum;",
        postgres_sql_string_literal(schema),
    )
}

pub(super) fn postgres_composite_type_ddls(
    schema: &str,
    results: &[QueryResult],
) -> Result<Vec<String>, String> {
    let mut fields = BTreeMap::<String, Vec<(String, String)>>::new();
    for row in results.iter().flat_map(|result| result.rows.iter()) {
        let name = row
            .first()
            .and_then(value_to_string)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "PostgreSQL composite type metadata has no name".to_string())?;
        let field = row
            .get(1)
            .and_then(value_to_string)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("PostgreSQL composite type {name} has an unnamed attribute"))?;
        let field_type = row
            .get(2)
            .and_then(value_to_string)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("PostgreSQL composite type {name}.{field} has no type"))?;
        fields.entry(name).or_default().push((field, field_type));
    }
    Ok(fields
        .into_iter()
        .map(|(name, fields)| {
            format!(
                "CREATE TYPE {} AS ({});",
                DatabaseKind::Postgres.qualified_table(Some(schema), &name),
                fields
                    .into_iter()
                    .map(|(field, field_type)| format!(
                        "{} {}",
                        DatabaseKind::Postgres.quote_identifier(&field),
                        field_type
                    ))
                    .collect::<Vec<_>>()
                    .join(", "),
            )
        })
        .collect())
}

/// Read only user-defined range types.  PostgreSQL's built-in ranges live in
/// `pg_catalog`; their definitions must come from the target server rather
/// than being recreated in a schema backup.
pub(super) fn postgres_range_type_query(schema: &str) -> String {
    format!(
        "SELECT type.typname, pg_catalog.format_type(range.rngsubtype, NULL), opclass_namespace.nspname, opclass.opcname, collation_namespace.nspname, collation.collname, canonical_namespace.nspname, canonical.proname, diff_namespace.nspname, diff.proname \
         FROM pg_catalog.pg_type type \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace \
         JOIN pg_catalog.pg_range range ON range.rngtypid = type.oid \
         JOIN pg_catalog.pg_opclass opclass ON opclass.oid = range.rngsubopc \
         JOIN pg_catalog.pg_namespace opclass_namespace ON opclass_namespace.oid = opclass.opcnamespace \
         LEFT JOIN pg_catalog.pg_collation collation ON collation.oid = range.rngcollation \
         LEFT JOIN pg_catalog.pg_namespace collation_namespace ON collation_namespace.oid = collation.collnamespace \
         LEFT JOIN pg_catalog.pg_proc canonical ON canonical.oid = range.rngcanonical \
         LEFT JOIN pg_catalog.pg_namespace canonical_namespace ON canonical_namespace.oid = canonical.pronamespace \
         LEFT JOIN pg_catalog.pg_proc diff ON diff.oid = range.rngsubdiff \
         LEFT JOIN pg_catalog.pg_namespace diff_namespace ON diff_namespace.oid = diff.pronamespace \
         WHERE namespace.nspname = {} AND type.typtype = 'r' \
         ORDER BY type.typname;",
        postgres_sql_string_literal(schema),
    )
}

/// `typtype = 'm'` is safe to query on PostgreSQL versions that predate
/// multiranges: it simply matches no rows there.  Keeping this independent of
/// `pg_range.rngmultitypid` avoids an unsupported catalog-column reference on
/// PostgreSQL 13 and earlier.
pub(super) fn postgres_multirange_type_query(schema: &str) -> String {
    format!(
        "SELECT type.typname FROM pg_catalog.pg_type type \
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace \
         WHERE namespace.nspname = {} AND type.typtype = 'm' ORDER BY type.typname;",
        postgres_sql_string_literal(schema),
    )
}

pub(super) fn postgres_multirange_type_names(
    results: &[QueryResult],
) -> Result<Vec<String>, String> {
    results
        .iter()
        .flat_map(|result| result.rows.iter())
        .map(|row| {
            row.first()
                .and_then(value_to_string)
                .filter(|name| !name.trim().is_empty())
                .ok_or_else(|| "PostgreSQL multirange metadata has no type name".to_string())
        })
        .collect()
}

pub(super) fn postgres_qualified_catalog_name(schema: &str, name: &str) -> String {
    format!(
        "{}.{}",
        DatabaseKind::Postgres.quote_identifier(schema),
        DatabaseKind::Postgres.quote_identifier(name),
    )
}

pub(super) fn postgres_range_type_ddls(
    schema: &str,
    results: &[QueryResult],
) -> Result<Vec<String>, String> {
    results
        .iter()
        .flat_map(|result| result.rows.iter())
        .map(|row| {
            let name = row.first().and_then(value_to_string).filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "PostgreSQL range metadata has no type name".to_string())?;
            let subtype = row.get(1).and_then(value_to_string).filter(|value| !value.trim().is_empty())
                .ok_or_else(|| format!("PostgreSQL range type {name} has no subtype"))?;
            let opclass_schema = row.get(2).and_then(value_to_string).filter(|value| !value.trim().is_empty())
                .ok_or_else(|| format!("PostgreSQL range type {name} has no subtype opclass schema"))?;
            let opclass = row.get(3).and_then(value_to_string).filter(|value| !value.trim().is_empty())
                .ok_or_else(|| format!("PostgreSQL range type {name} has no subtype opclass"))?;
            let mut options = vec![format!("SUBTYPE = {subtype}")];
            options.push(format!(
                "SUBTYPE_OPCLASS = {}",
                postgres_qualified_catalog_name(&opclass_schema, &opclass),
            ));
            if let (Some(collation_schema), Some(collation)) = (
                row.get(4).and_then(value_to_string).filter(|value| !value.trim().is_empty()),
                row.get(5).and_then(value_to_string).filter(|value| !value.trim().is_empty()),
            ) {
                options.push(format!(
                    "COLLATION = {}",
                    postgres_qualified_catalog_name(&collation_schema, &collation),
                ));
            }
            for (option, schema_index, name_index) in [
                ("CANONICAL", 6, 7),
                ("SUBTYPE_DIFF", 8, 9),
            ] {
                if let (Some(function_schema), Some(function_name)) = (
                    row.get(schema_index).and_then(value_to_string).filter(|value| !value.trim().is_empty()),
                    row.get(name_index).and_then(value_to_string).filter(|value| !value.trim().is_empty()),
                ) {
                    // User-defined support functions would have to precede the
                    // type but routines are intentionally restored after
                    // relations. Refuse that unsafe ordering rather than
                    // publish a dump which can only fail during replay.
                    if function_schema != "pg_catalog" {
                        return Err(format!(
                            "PostgreSQL range type {name} uses non-catalog {option} function {function_schema}.{function_name}; its restore order is not yet supported"
                        ));
                    }
                    options.push(format!(
                        "{option} = {}",
                        postgres_qualified_catalog_name(&function_schema, &function_name),
                    ));
                }
            }
            Ok(format!(
                "CREATE TYPE {} AS RANGE ({});",
                DatabaseKind::Postgres.qualified_table(Some(schema), &name),
                options.join(", "),
            ))
        })
        .collect()
}

pub(super) fn postgres_column_definition(kind: DatabaseKind, column: &ColumnInfo) -> String {
    let mut definition = format!(
        "  {} {}",
        kind.quote_identifier(&column.name),
        column.data_type
    );

    if let Some(default_value) = &column.default_value {
        if !default_value.trim().is_empty() {
            definition.push_str(" DEFAULT ");
            definition.push_str(default_value);
        }
    }

    if !column.is_nullable {
        definition.push_str(" NOT NULL");
    }

    definition
}

pub(super) fn postgres_constraint_definition(
    kind: DatabaseKind,
    constraint: &ConstraintInfo,
) -> Option<String> {
    let definition = constraint.definition.as_deref()?.trim();
    if definition.is_empty() {
        return None;
    }

    Some(format!(
        "  CONSTRAINT {} {}",
        kind.quote_identifier(&constraint.name),
        definition
    ))
}

pub(super) fn is_postgres_foreign_key_constraint(constraint: &ConstraintInfo) -> bool {
    constraint
        .constraint_type
        .trim()
        .eq_ignore_ascii_case("FOREIGN KEY")
        || constraint.definition.as_deref().is_some_and(|definition| {
            definition
                .trim_start()
                .to_ascii_uppercase()
                .starts_with("FOREIGN KEY")
        })
}

pub(super) fn generate_postgres_table_ddl(
    schema: &str,
    table: &str,
    columns: &[ColumnInfo],
    constraints: &[ConstraintInfo],
    indexes: &[IndexInfo],
) -> String {
    let kind = DatabaseKind::Postgres;
    let mut lines: Vec<String> = columns
        .iter()
        .map(|column| postgres_column_definition(kind, column))
        .collect();

    let constraint_names: std::collections::HashSet<&str> = constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect();

    for constraint in constraints {
        if let Some(definition) = postgres_constraint_definition(kind, constraint) {
            lines.push(definition);
        }
    }

    if !constraints
        .iter()
        .any(|constraint| constraint.constraint_type == "PRIMARY KEY")
    {
        let primary_keys: Vec<String> = columns
            .iter()
            .filter(|column| column.is_primary_key)
            .map(|column| kind.quote_identifier(&column.name))
            .collect();

        if !primary_keys.is_empty() {
            lines.push(format!("  PRIMARY KEY ({})", primary_keys.join(", ")));
        }
    }

    let mut ddl = format!(
        "CREATE TABLE {} (\n{}\n);",
        kind.qualified_table(Some(schema), table),
        lines.join(",\n")
    );

    let extra_indexes: Vec<String> = indexes
        .iter()
        .filter(|index| !index.is_primary && !constraint_names.contains(index.name.as_str()))
        .filter_map(|index| index.definition.as_deref())
        .map(str::trim)
        .filter(|definition| !definition.is_empty())
        .map(ToString::to_string)
        .collect();

    if !extra_indexes.is_empty() {
        ddl.push_str("\n\n");
        ddl.push_str(&extra_indexes.join(";\n"));
        ddl.push(';');
    }

    ddl
}

/// PostgreSQL exposes a complete replayable `CREATE INDEX` statement for an
/// index through `pg_get_indexdef`.  Unlike table indexes, materialized-view
/// indexes do not have a table-DDL builder to carry them along, so keep the
/// strict all-or-nothing backup contract here: a missing definition must fail
/// the export instead of silently publishing an incomplete schema backup.
pub(super) fn postgres_backup_index_definitions(
    relation: &str,
    indexes: &[IndexInfo],
) -> Result<Vec<String>, String> {
    indexes
        .iter()
        .map(|index| {
            index
                .definition
                .as_deref()
                .map(str::trim)
                .filter(|definition| !definition.is_empty())
                .map(|definition| definition.trim_end_matches(';').to_string())
                .ok_or_else(|| {
                    format!(
                        "PostgreSQL index {} on materialized view {relation} has no definition available for backup",
                        index.name
                    )
                })
        })
        .collect()
}
