use super::ddl::{is_foreign_constraint, mapped_constraint_schema};
use super::plan_model::{column_by_name, constraint_by_name, stable_id};
use super::types::{
    SchemaChange, SchemaChangeKind, SchemaPreflightAssertion, SchemaPreflightCheck, SchemaSnapshot,
};
use crate::core::dialect::DatabaseKind;
use crate::core::protocol::ConstraintInfo;

pub(super) fn build_preflight_checks(
    kind: DatabaseKind,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    changes: &[SchemaChange],
) -> Vec<SchemaPreflightCheck> {
    let mut checks = Vec::new();
    let created_relations = changes
        .iter()
        .filter(|change| change.kind == SchemaChangeKind::RelationCreate)
        .map(|change| change.relation_name.as_str())
        .collect::<std::collections::HashSet<_>>();
    for change in changes {
        let relation = kind.qualified_table(Some(&target.schema_name), &change.relation_name);
        match change.kind {
            SchemaChangeKind::RelationDrop => checks.push(preflight_check(
                change,
                "Count rows before relation drop",
                format!("SELECT COUNT(*) AS affected_rows FROM {relation};"),
                "Review affected_rows and confirm that backups or rollback procedures exist.",
                SchemaPreflightAssertion::Advisory,
                Some("affected_rows"),
            )),
            SchemaChangeKind::ColumnDrop => {
                if let Some(column_name) = change.child_name.as_deref() {
                    let column = kind.quote_identifier(column_name);
                    checks.push(preflight_check(
                        change,
                        "Count populated values before column drop",
                        format!(
                            "SELECT COUNT(*) AS populated_rows FROM {relation} WHERE {column} IS NOT NULL;"
                        ),
                        "Review populated_rows; any value greater than zero represents data loss.",
                        SchemaPreflightAssertion::Advisory,
                        Some("populated_rows"),
                    ));
                }
            }
            SchemaChangeKind::ColumnAdd => {
                if let Some(column_name) = change.child_name.as_deref() {
                    if column_by_name(source, &change.relation_name, column_name)
                        .is_some_and(|column| !column.is_nullable && column.default_value.is_none())
                    {
                        checks.push(preflight_check(
                            change,
                            "Verify table is empty before adding required column",
                            format!("SELECT COUNT(*) AS blocking_rows FROM {relation};"),
                            "blocking_rows must be 0 unless a backfill/default strategy is added.",
                            SchemaPreflightAssertion::ZeroValue,
                            Some("blocking_rows"),
                        ));
                    }
                }
            }
            SchemaChangeKind::ColumnModify => {
                if let Some(column_name) = change.child_name.as_deref() {
                    let source_column = column_by_name(source, &change.relation_name, column_name);
                    let target_column = column_by_name(target, &change.relation_name, column_name);
                    if source_column
                        .zip(target_column)
                        .is_some_and(|(source, target)| !source.is_nullable && target.is_nullable)
                    {
                        let column = kind.quote_identifier(column_name);
                        checks.push(preflight_check(
                            change,
                            "Verify nullable values before SET NOT NULL",
                            format!(
                                "SELECT COUNT(*) AS blocking_rows FROM {relation} WHERE {column} IS NULL;"
                            ),
                            "blocking_rows must be 0.",
                            SchemaPreflightAssertion::ZeroValue,
                            Some("blocking_rows"),
                        ));
                    }
                }
            }
            SchemaChangeKind::ConstraintAdd => {
                if let Some(constraint_name) = change.child_name.as_deref() {
                    if let Some(constraint) =
                        constraint_by_name(source, &change.relation_name, constraint_name)
                    {
                        let normalized = constraint.constraint_type.to_ascii_uppercase();
                        if normalized.contains("UNIQUE") && !constraint.columns.is_empty() {
                            let columns = constraint
                                .columns
                                .iter()
                                .map(|column| kind.quote_identifier(column))
                                .collect::<Vec<_>>()
                                .join(", ");
                            let non_null = constraint
                                .columns
                                .iter()
                                .map(|column| {
                                    format!("{} IS NOT NULL", kind.quote_identifier(column))
                                })
                                .collect::<Vec<_>>()
                                .join(" AND ");
                            let nulls_not_distinct =
                                constraint.definition.as_deref().is_some_and(|definition| {
                                    definition
                                        .to_ascii_uppercase()
                                        .contains("NULLS NOT DISTINCT")
                                });
                            let where_clause = if nulls_not_distinct {
                                String::new()
                            } else {
                                format!(" WHERE {non_null}")
                            };
                            checks.push(preflight_check(
                                change,
                                "Find duplicate keys before UNIQUE constraint",
                                format!(
                                    "SELECT {columns}, COUNT(*) AS duplicate_count FROM {relation}{where_clause} GROUP BY {columns} HAVING COUNT(*) > 1 LIMIT 50;"
                                ),
                                "The query must return no rows.",
                                SchemaPreflightAssertion::EmptyRows,
                                None,
                            ));
                        } else if is_foreign_constraint(constraint) {
                            let depends_on_new_relation = created_relations
                                .contains(change.relation_name.as_str())
                                || constraint
                                    .referenced_table
                                    .as_deref()
                                    .is_some_and(|table| created_relations.contains(table));
                            if depends_on_new_relation {
                                continue;
                            }
                            if let Some(sql) = foreign_key_preflight_sql(
                                kind,
                                &source.schema_name,
                                &target.schema_name,
                                &change.relation_name,
                                constraint,
                            ) {
                                checks.push(preflight_check(
                                    change,
                                    "Find orphan rows before FOREIGN KEY",
                                    sql,
                                    "blocking_rows must be 0.",
                                    SchemaPreflightAssertion::ZeroValue,
                                    Some("blocking_rows"),
                                ));
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    checks
}

pub(super) fn foreign_key_preflight_sql(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    relation_name: &str,
    constraint: &ConstraintInfo,
) -> Option<String> {
    let referenced_table = constraint.referenced_table.as_deref()?;
    if constraint.columns.is_empty()
        || constraint.columns.len() != constraint.referenced_columns.len()
    {
        return None;
    }
    let local_relation = kind.qualified_table(Some(target_schema), relation_name);
    let referenced_relation = kind.qualified_table(
        mapped_constraint_schema(
            kind,
            constraint.referenced_schema.as_deref(),
            source_schema,
            target_schema,
        )
        .as_deref()
        .or(Some(target_schema)),
        referenced_table,
    );
    let local_not_null = constraint
        .columns
        .iter()
        .map(|column| format!("child.{} IS NOT NULL", kind.quote_identifier(column)))
        .collect::<Vec<_>>()
        .join(" AND ");
    let joins = constraint
        .columns
        .iter()
        .zip(&constraint.referenced_columns)
        .map(|(local, referenced)| {
            format!(
                "parent.{} = child.{}",
                kind.quote_identifier(referenced),
                kind.quote_identifier(local)
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ");
    Some(format!(
        "SELECT COUNT(*) AS blocking_rows FROM {local_relation} AS child WHERE {local_not_null} AND NOT EXISTS (SELECT 1 FROM {referenced_relation} AS parent WHERE {joins});"
    ))
}

pub(super) fn preflight_check(
    change: &SchemaChange,
    label: &str,
    sql: String,
    expectation: &str,
    assertion: SchemaPreflightAssertion,
    result_column: Option<&str>,
) -> SchemaPreflightCheck {
    SchemaPreflightCheck {
        id: stable_id("schema-preflight", &format!("{}:{label}", change.id)),
        change_id: change.id.clone(),
        label: label.to_string(),
        sql,
        expectation: expectation.to_string(),
        assertion,
        result_column: result_column.map(ToString::to_string),
    }
}
