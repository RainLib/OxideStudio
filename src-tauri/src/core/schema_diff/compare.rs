use super::conversion::annotate_cross_driver_review;
use super::ddl::{add_constraint_sql, create_relation_sql, is_foreign_constraint};
use super::metadata::compare_metadata_snapshots;
use super::objects::compare_schema_objects;
use super::plan_model::{change, relation_map, stable_id};
use super::plan_order::finalize_change_plan;
use super::relations::{add_postgres_materialized_view_dependent_rebuilds, compare_relation};
use super::render::{
    relation_flags, render_migration_sql, render_preflight_sql, summarize_changes,
};
use super::routines::compare_routines;
use super::sqlite::compare_sqlite_schema_snapshots;
use super::types::{
    SchemaChangeKind, SchemaChangeRisk, SchemaDiffExecutionOwner, SchemaDiffPlan,
    SchemaNameMapping, SchemaSnapshot, SCHEMA_SNAPSHOT_VERSION,
};
use crate::core::dialect::{database_spec_for_driver, DatabaseKind};
use anyhow::{anyhow, Result};
use std::str::FromStr;

pub fn compare_schema_snapshots(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    generated_at: i64,
) -> Result<SchemaDiffPlan> {
    if source.version != SCHEMA_SNAPSHOT_VERSION || target.version != SCHEMA_SNAPSHOT_VERSION {
        return Err(anyhow!(
            "Unsupported schema snapshot version; expected {}",
            SCHEMA_SNAPSHOT_VERSION
        ));
    }
    let source_spec = database_spec_for_driver(&source.driver);
    let target_spec = database_spec_for_driver(&target.driver);
    let maps_schemas = source.schema_name != target.schema_name;

    // A signed external package can provide a full metadata contract without
    // being compiled into the host's DDL planner. Keep those snapshots useful
    // for review, diagrams and drift detection, while deliberately refusing to
    // synthesize generic migration SQL for an unknown dialect.
    let (Some(source_spec), Some(target_spec)) = (source_spec, target_spec) else {
        if maps_schemas {
            return Err(anyhow!(
                "Cross-schema comparison requires a native PostgreSQL schema mapping: {} -> {}",
                source.schema_name,
                target.schema_name
            ));
        }
        if source.driver != target.driver {
            let mut plan =
                compare_metadata_snapshots(source, target, generated_at, &target.driver)?;
            annotate_cross_driver_review(&mut plan, source, target);
            return Ok(plan);
        }
        return compare_metadata_snapshots(source, target, generated_at, &target.driver);
    };
    if source_spec.driver != target_spec.driver {
        let mut plan =
            compare_metadata_snapshots(source, target, generated_at, target_spec.driver)?;
        annotate_cross_driver_review(&mut plan, source, target);
        return Ok(plan);
    }
    if maps_schemas && target_spec.driver != "postgres" {
        return Err(anyhow!(
            "Cross-schema comparison is currently supported only for native PostgreSQL snapshots: {} -> {}",
            source.schema_name,
            target.schema_name
        ));
    }
    if !target_spec.supports_table_browsing {
        return compare_metadata_snapshots(source, target, generated_at, target_spec.driver);
    }
    // SQLite alters that touch a table definition have to rebuild the table.
    // The dedicated planner emits only a closed replacement-table workflow;
    // the command layer delegates execution to the SQLite driver so backup,
    // foreign-key checks, transaction control, and pragma restoration stay on
    // one physical connection.
    if target_spec.driver == "sqlite" {
        return compare_sqlite_schema_snapshots(source, target, generated_at);
    }
    let kind = DatabaseKind::from_str(target_spec.driver)?;
    let target_schema = target.schema_name.as_str();
    let source_relations = relation_map(&source.relations);
    let target_relations = relation_map(&target.relations);
    let mut relation_names = source_relations
        .keys()
        .chain(target_relations.keys())
        .cloned()
        .collect::<Vec<_>>();
    relation_names.sort();
    relation_names.dedup();
    let mut changes = Vec::new();
    let mut warnings = source
        .warnings
        .iter()
        .chain(target.warnings.iter())
        .cloned()
        .collect::<Vec<_>>();
    if maps_schemas {
        warnings.push(format!(
            "PostgreSQL schema mapping {} -> {} is review-gated. Catalog-backed identifiers are rewritten only in verified SQL positions; inspect all generated DDL before execution.",
            source.schema_name, target.schema_name
        ));
    }

    for relation_name in relation_names {
        match (
            source_relations.get(&relation_name),
            target_relations.get(&relation_name),
        ) {
            (Some(source_relation), None) => {
                let (sql, manual_review, relation_warnings) =
                    create_relation_sql(kind, &source.schema_name, target_schema, source_relation);
                warnings.extend(relation_warnings);
                changes.push(change(
                    SchemaChangeKind::RelationCreate,
                    if manual_review {
                        SchemaChangeRisk::Review
                    } else {
                        SchemaChangeRisk::Safe
                    },
                    target_schema,
                    &relation_name,
                    source_relation.object_type.clone(),
                    None,
                    format!("Create relation {relation_name}"),
                    sql,
                    true,
                    manual_review,
                ));
                for constraint in source_relation
                    .constraints
                    .iter()
                    .filter(|constraint| is_foreign_constraint(constraint))
                {
                    let sql = add_constraint_sql(
                        kind,
                        &source.schema_name,
                        target_schema,
                        &relation_name,
                        constraint,
                    );
                    if sql.is_none() {
                        warnings.push(format!(
                            "Foreign key {}.{} requires an exact source definition including referential actions.",
                            relation_name, constraint.name
                        ));
                    }
                    changes.push(change(
                        SchemaChangeKind::ConstraintAdd,
                        SchemaChangeRisk::Review,
                        target_schema,
                        &relation_name,
                        source_relation.object_type.clone(),
                        Some(constraint.name.clone()),
                        format!("Add foreign key {} on {}", constraint.name, relation_name),
                        sql.into_iter().collect(),
                        true,
                        true,
                    ));
                }
            }
            (None, Some(target_relation)) => {
                for constraint in target_relation
                    .constraints
                    .iter()
                    .filter(|constraint| is_foreign_constraint(constraint))
                {
                    changes.push(change(
                        SchemaChangeKind::ConstraintDrop,
                        SchemaChangeRisk::Review,
                        target_schema,
                        &relation_name,
                        target_relation.object_type.clone(),
                        Some(constraint.name.clone()),
                        format!(
                            "Drop foreign key {} before removing {}",
                            constraint.name, relation_name
                        ),
                        vec![kind.drop_constraint_query(
                            Some(target_schema),
                            &relation_name,
                            &constraint.name,
                            &constraint.constraint_type,
                        )],
                        true,
                        true,
                    ));
                }
                let object_flags = relation_flags(target_relation.object_type.as_deref());
                changes.push(change(
                    SchemaChangeKind::RelationDrop,
                    SchemaChangeRisk::Destructive,
                    target_schema,
                    &relation_name,
                    target_relation.object_type.clone(),
                    None,
                    format!("Drop target-only relation {relation_name}"),
                    vec![kind.drop_relation_query_with_kind(
                        Some(target_schema),
                        &relation_name,
                        object_flags.is_view,
                        object_flags.is_materialized_view,
                        object_flags.is_foreign_table,
                        false,
                    )],
                    false,
                    true,
                ));
            }
            (Some(source_relation), Some(target_relation)) => {
                compare_relation(
                    kind,
                    &source.schema_name,
                    target_schema,
                    source_relation,
                    target_relation,
                    &mut changes,
                    &mut warnings,
                );
            }
            (None, None) => unreachable!(),
        }
    }
    add_postgres_materialized_view_dependent_rebuilds(
        kind,
        source,
        target,
        target_schema,
        &mut changes,
        &mut warnings,
    );
    compare_routines(
        Some(kind),
        SchemaNameMapping {
            source: &source.schema_name,
            target: target_schema,
        },
        &source.routines,
        &target.routines,
        target_schema,
        &mut changes,
        &mut warnings,
    );
    compare_schema_objects(
        Some(kind),
        SchemaNameMapping {
            source: &source.schema_name,
            target: target_schema,
        },
        &source.schema_objects,
        &target.schema_objects,
        target_schema,
        &mut changes,
        &mut warnings,
    );

    let (changes, preflight_checks) =
        finalize_change_plan(kind, source, target, changes, &mut warnings);
    warnings.sort();
    warnings.dedup();
    let summary = summarize_changes(&changes);
    let transactional = kind == DatabaseKind::Postgres;
    let migration_sql = render_migration_sql(kind, source, target, &changes, &warnings);
    let preflight_sql = render_preflight_sql(source, target, &preflight_checks);
    let id = stable_id(
        "schema-diff",
        &format!(
            "schema-diff:{}:{}:{}",
            source.fingerprint, target.fingerprint, target.schema_name
        ),
    );

    Ok(SchemaDiffPlan {
        id,
        source_snapshot_id: source.id.clone(),
        target_snapshot_id: target.id.clone(),
        driver: kind.as_str().to_string(),
        target_connection_id: target.connection_id.clone(),
        target_database_name: target.database_name.clone(),
        target_schema_name: target.schema_name.clone(),
        generated_at,
        transactional,
        execution_owner: SchemaDiffExecutionOwner::HostSql,
        requires_review_approval: changes
            .iter()
            .any(|change| change.manual_review || change.risk == SchemaChangeRisk::Review),
        requires_destructive_approval: changes
            .iter()
            .any(|change| change.risk == SchemaChangeRisk::Destructive || !change.reversible),
        summary,
        changes,
        migration_sql,
        preflight_checks,
        preflight_sql,
        conversion_issues: Vec::new(),
        warnings,
    })
}
