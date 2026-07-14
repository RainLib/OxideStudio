use crate::core::{
    dialect::DatabaseKind,
    protocol::{ColumnInfo, ConstraintInfo, IndexInfo},
};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    str::FromStr,
};

pub const SCHEMA_SNAPSHOT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRelationSnapshot {
    pub name: String,
    pub object_type: Option<String>,
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub constraints: Vec<ConstraintInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaSnapshot {
    pub version: u32,
    pub id: String,
    pub fingerprint: String,
    pub project_id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub driver: String,
    pub database_name: Option<String>,
    pub schema_name: String,
    pub captured_at: i64,
    pub relations: Vec<SchemaRelationSnapshot>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum SchemaChangeRisk {
    Safe,
    Review,
    Destructive,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum SchemaChangeKind {
    RelationCreate,
    RelationDrop,
    RelationModify,
    ColumnAdd,
    ColumnDrop,
    ColumnModify,
    IndexAdd,
    IndexDrop,
    IndexModify,
    ConstraintAdd,
    ConstraintDrop,
    ConstraintModify,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum SchemaChangePhase {
    DropDependencies,
    DropRelations,
    CreateRelations,
    AlterRelations,
    CreateDependencies,
    ManualReview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaChange {
    pub id: String,
    pub kind: SchemaChangeKind,
    pub risk: SchemaChangeRisk,
    pub schema_name: String,
    pub relation_name: String,
    pub object_type: Option<String>,
    pub child_name: Option<String>,
    pub summary: String,
    pub sql: Vec<String>,
    pub reversible: bool,
    pub manual_review: bool,
    pub phase: SchemaChangePhase,
    pub order: usize,
    #[serde(default)]
    pub depends_on: Vec<String>,
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaPreflightCheck {
    pub id: String,
    pub change_id: String,
    pub label: String,
    pub sql: String,
    pub expectation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDiffSummary {
    pub total: usize,
    pub safe: usize,
    pub review: usize,
    pub destructive: usize,
    pub blocked: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDiffPlan {
    pub id: String,
    pub source_snapshot_id: String,
    pub target_snapshot_id: String,
    pub driver: String,
    pub target_connection_id: String,
    pub target_database_name: Option<String>,
    pub target_schema_name: String,
    pub generated_at: i64,
    pub transactional: bool,
    pub summary: SchemaDiffSummary,
    pub changes: Vec<SchemaChange>,
    pub migration_sql: String,
    pub preflight_checks: Vec<SchemaPreflightCheck>,
    pub preflight_sql: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}

pub fn finalize_schema_snapshot(mut snapshot: SchemaSnapshot) -> Result<SchemaSnapshot> {
    snapshot.version = SCHEMA_SNAPSHOT_VERSION;
    snapshot
        .relations
        .sort_by(|left, right| left.name.cmp(&right.name));
    for relation in &mut snapshot.relations {
        relation
            .indexes
            .sort_by(|left, right| left.name.cmp(&right.name));
        relation
            .constraints
            .sort_by(|left, right| left.name.cmp(&right.name));
    }
    snapshot.warnings.sort();
    snapshot.warnings.dedup();
    snapshot.fingerprint = snapshot_fingerprint(&snapshot)?;
    if snapshot.id.trim().is_empty() {
        snapshot.id = format!(
            "schema-snapshot-{}-{}",
            snapshot.captured_at,
            &snapshot.fingerprint[..12]
        );
    }
    Ok(snapshot)
}

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
    let source_kind = DatabaseKind::from_str(&source.driver)?;
    let target_kind = DatabaseKind::from_str(&target.driver)?;
    if source_kind != target_kind {
        return Err(anyhow!(
            "Cross-driver schema migration is unsupported: {} -> {}",
            target.driver,
            source.driver
        ));
    }
    if source.schema_name != target.schema_name {
        return Err(anyhow!(
            "Cross-schema comparison requires an explicit schema mapping: {} -> {}",
            source.schema_name,
            target.schema_name
        ));
    }

    let kind = target_kind;
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
                    let sql = add_constraint_sql(kind, target_schema, &relation_name, constraint);
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
        summary,
        changes,
        migration_sql,
        preflight_checks,
        preflight_sql,
        warnings,
    })
}

fn compare_relation(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_flags = relation_flags(source.object_type.as_deref());
    let target_flags = relation_flags(target.object_type.as_deref());
    if source.object_type != target.object_type
        || source_flags.is_view
        || target_flags.is_view
        || source_flags.is_foreign_table
        || target_flags.is_foreign_table
    {
        if source != target {
            warnings.push(format!(
                "Relation {} requires manual review because view/foreign-table definitions are not captured yet.",
                source.name
            ));
            changes.push(change(
                SchemaChangeKind::RelationModify,
                SchemaChangeRisk::Review,
                target_schema,
                &source.name,
                source.object_type.clone(),
                None,
                format!("Review relation definition for {}", source.name),
                Vec::new(),
                false,
                true,
            ));
        }
        return;
    }

    compare_columns(kind, target_schema, source, target, changes, warnings);
    compare_constraints(kind, target_schema, source, target, changes, warnings);
    compare_indexes(
        kind,
        source_schema,
        target_schema,
        source,
        target,
        changes,
        warnings,
    );
}

fn compare_columns(
    kind: DatabaseKind,
    target_schema: &str,
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_columns = source
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();
    let target_columns = target
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();
    let mut names = source_columns
        .keys()
        .chain(target_columns.keys())
        .copied()
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();

    for column_name in names {
        match (
            source_columns.get(column_name),
            target_columns.get(column_name),
        ) {
            (Some(source_column), None) => {
                let (definition, definition_warnings) = column_definition(kind, source_column);
                warnings.extend(definition_warnings);
                let risk = if source_column.is_nullable || source_column.default_value.is_some() {
                    SchemaChangeRisk::Safe
                } else {
                    SchemaChangeRisk::Review
                };
                changes.push(change(
                    SchemaChangeKind::ColumnAdd,
                    risk,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(column_name.to_string()),
                    format!("Add column {}.{}", source.name, column_name),
                    vec![format!(
                        "ALTER TABLE {} ADD COLUMN {};",
                        kind.qualified_table(Some(target_schema), &source.name),
                        definition
                    )],
                    true,
                    risk == SchemaChangeRisk::Review,
                ));
            }
            (None, Some(_)) => changes.push(change(
                SchemaChangeKind::ColumnDrop,
                SchemaChangeRisk::Destructive,
                target_schema,
                &source.name,
                target.object_type.clone(),
                Some(column_name.to_string()),
                format!("Drop target-only column {}.{}", target.name, column_name),
                vec![kind.drop_column_query(Some(target_schema), &target.name, column_name, false)],
                false,
                true,
            )),
            (Some(source_column), Some(target_column))
                if column_structure_changed(source_column, target_column) =>
            {
                let (sql, manual_review, alter_warnings) = alter_column_sql(
                    kind,
                    target_schema,
                    &source.name,
                    source_column,
                    target_column,
                );
                warnings.extend(alter_warnings);
                let destructive = source_column.data_type != target_column.data_type
                    || (!source_column.is_nullable && target_column.is_nullable);
                changes.push(change(
                    SchemaChangeKind::ColumnModify,
                    if destructive {
                        SchemaChangeRisk::Destructive
                    } else if manual_review {
                        SchemaChangeRisk::Review
                    } else {
                        SchemaChangeRisk::Safe
                    },
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(column_name.to_string()),
                    format!("Modify column {}.{}", source.name, column_name),
                    sql,
                    false,
                    manual_review || destructive,
                ));
            }
            _ => {}
        }
    }
}

fn compare_indexes(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_constraints = source
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<std::collections::HashSet<_>>();
    let target_constraints = target
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<std::collections::HashSet<_>>();
    let source_indexes = source
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !source_constraints.contains(index.name.as_str()))
        .map(|index| (index.name.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let target_indexes = target
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !target_constraints.contains(index.name.as_str()))
        .map(|index| (index.name.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let mut names = source_indexes
        .keys()
        .chain(target_indexes.keys())
        .copied()
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();

    for index_name in names {
        match (
            source_indexes.get(index_name),
            target_indexes.get(index_name),
        ) {
            (Some(source_index), None) => {
                let sql = create_index_sql(
                    kind,
                    source_schema,
                    target_schema,
                    &source.name,
                    source_index,
                );
                let (sql, manual_review) = match sql {
                    Ok(sql) => (vec![sql], false),
                    Err(warning) => {
                        warnings.push(warning);
                        (Vec::new(), true)
                    }
                };
                changes.push(change(
                    SchemaChangeKind::IndexAdd,
                    if manual_review {
                        SchemaChangeRisk::Review
                    } else {
                        SchemaChangeRisk::Safe
                    },
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(index_name.to_string()),
                    format!("Create index {} on {}", index_name, source.name),
                    sql,
                    true,
                    manual_review,
                ));
            }
            (None, Some(_)) => changes.push(change(
                SchemaChangeKind::IndexDrop,
                SchemaChangeRisk::Review,
                target_schema,
                &target.name,
                target.object_type.clone(),
                Some(index_name.to_string()),
                format!("Drop target-only index {} on {}", index_name, target.name),
                vec![kind.drop_index_query(Some(target_schema), &target.name, index_name)],
                true,
                true,
            )),
            (Some(source_index), Some(target_index)) if source_index != target_index => {
                let replacement = create_index_sql(
                    kind,
                    source_schema,
                    target_schema,
                    &source.name,
                    source_index,
                );
                let can_rebuild = replacement.is_ok();
                changes.push(change(
                    SchemaChangeKind::IndexDrop,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &target.name,
                    target.object_type.clone(),
                    Some(index_name.to_string()),
                    format!("Drop changed index {} on {}", index_name, target.name),
                    if can_rebuild {
                        vec![kind.drop_index_query(Some(target_schema), &target.name, index_name)]
                    } else {
                        Vec::new()
                    },
                    true,
                    true,
                ));
                let sql = match replacement {
                    Ok(replacement) => vec![replacement],
                    Err(warning) => {
                        warnings.push(warning);
                        Vec::new()
                    }
                };
                changes.push(change(
                    SchemaChangeKind::IndexAdd,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(index_name.to_string()),
                    format!("Create replacement index {} on {}", index_name, source.name),
                    sql,
                    true,
                    true,
                ));
            }
            _ => {}
        }
    }
}

fn compare_constraints(
    kind: DatabaseKind,
    target_schema: &str,
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_constraints = source
        .constraints
        .iter()
        .map(|constraint| (constraint.name.as_str(), constraint))
        .collect::<BTreeMap<_, _>>();
    let target_constraints = target
        .constraints
        .iter()
        .map(|constraint| (constraint.name.as_str(), constraint))
        .collect::<BTreeMap<_, _>>();
    let mut names = source_constraints
        .keys()
        .chain(target_constraints.keys())
        .copied()
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();

    for constraint_name in names {
        match (
            source_constraints.get(constraint_name),
            target_constraints.get(constraint_name),
        ) {
            (Some(source_constraint), None) => {
                let sql = add_constraint_sql(kind, target_schema, &source.name, source_constraint);
                let manual_review = sql.is_none();
                if manual_review {
                    warnings.push(format!(
                        "Constraint {}.{} has no executable definition.",
                        source.name, constraint_name
                    ));
                }
                changes.push(change(
                    SchemaChangeKind::ConstraintAdd,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(constraint_name.to_string()),
                    format!("Add constraint {} on {}", constraint_name, source.name),
                    sql.into_iter().collect(),
                    true,
                    true,
                ));
            }
            (None, Some(target_constraint)) => changes.push(change(
                SchemaChangeKind::ConstraintDrop,
                SchemaChangeRisk::Review,
                target_schema,
                &target.name,
                target.object_type.clone(),
                Some(constraint_name.to_string()),
                format!(
                    "Drop target-only constraint {} on {}",
                    constraint_name, target.name
                ),
                vec![kind.drop_constraint_query(
                    Some(target_schema),
                    &target.name,
                    constraint_name,
                    &target_constraint.constraint_type,
                )],
                true,
                true,
            )),
            (Some(source_constraint), Some(target_constraint))
                if source_constraint != target_constraint =>
            {
                let add_sql =
                    add_constraint_sql(kind, target_schema, &source.name, source_constraint);
                if add_sql.is_none() {
                    warnings.push(format!(
                        "Constraint {}.{} has no executable replacement definition.",
                        source.name, constraint_name
                    ));
                }
                changes.push(change(
                    SchemaChangeKind::ConstraintDrop,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &target.name,
                    target.object_type.clone(),
                    Some(constraint_name.to_string()),
                    format!(
                        "Drop changed constraint {} on {}",
                        constraint_name, target.name
                    ),
                    add_sql.as_ref().map_or_else(Vec::new, |_| {
                        vec![kind.drop_constraint_query(
                            Some(target_schema),
                            &target.name,
                            constraint_name,
                            &target_constraint.constraint_type,
                        )]
                    }),
                    true,
                    true,
                ));
                changes.push(change(
                    SchemaChangeKind::ConstraintAdd,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(constraint_name.to_string()),
                    format!(
                        "Create replacement constraint {} on {}",
                        constraint_name, source.name
                    ),
                    add_sql.into_iter().collect(),
                    true,
                    true,
                ));
            }
            _ => {}
        }
    }
}

fn create_relation_sql(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    relation: &SchemaRelationSnapshot,
) -> (Vec<String>, bool, Vec<String>) {
    let flags = relation_flags(relation.object_type.as_deref());
    if flags.is_view || flags.is_foreign_table {
        return (
            Vec::new(),
            true,
            vec![format!(
                "Relation {} requires its source definition before it can be created.",
                relation.name
            )],
        );
    }

    let mut warnings = Vec::new();
    if relation.columns.is_empty() {
        return (
            Vec::new(),
            true,
            vec![format!(
                "Relation {} has no captured columns, so CREATE TABLE SQL was not generated.",
                relation.name
            )],
        );
    }
    let mut definitions = relation
        .columns
        .iter()
        .map(|column| {
            let (definition, column_warnings) = column_definition(kind, column);
            warnings.extend(column_warnings);
            format!("  {definition}")
        })
        .collect::<Vec<_>>();
    let has_primary_constraint = relation.constraints.iter().any(|constraint| {
        constraint
            .constraint_type
            .to_ascii_uppercase()
            .contains("PRIMARY")
    });
    for constraint in relation
        .constraints
        .iter()
        .filter(|constraint| !is_foreign_constraint(constraint))
    {
        if let Some(clause) = inline_constraint_clause(kind, constraint) {
            definitions.push(format!("  {clause}"));
        } else {
            warnings.push(format!(
                "Constraint {}.{} needs manual review.",
                relation.name, constraint.name
            ));
        }
    }
    if !has_primary_constraint {
        let primary_columns = relation
            .columns
            .iter()
            .filter(|column| column.is_primary_key)
            .map(|column| kind.quote_identifier(&column.name))
            .collect::<Vec<_>>();
        if !primary_columns.is_empty() {
            definitions.push(format!("  PRIMARY KEY ({})", primary_columns.join(", ")));
        }
    }

    let mut sql = vec![format!(
        "CREATE TABLE {} (\n{}\n);",
        kind.qualified_table(Some(target_schema), &relation.name),
        definitions.join(",\n")
    )];
    if kind == DatabaseKind::Postgres {
        for column in relation.columns.iter().filter(|column| {
            column
                .comment
                .as_deref()
                .is_some_and(|value| !value.is_empty())
        }) {
            sql.push(format!(
                "COMMENT ON COLUMN {}.{} IS {};",
                kind.qualified_table(Some(target_schema), &relation.name),
                kind.quote_identifier(&column.name),
                sql_string_literal(column.comment.as_deref().unwrap_or_default())
            ));
        }
    }
    let constraint_names = relation
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<std::collections::HashSet<_>>();
    for index in relation
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !constraint_names.contains(index.name.as_str()))
    {
        match create_index_sql(kind, source_schema, target_schema, &relation.name, index) {
            Ok(index_sql) => sql.push(index_sql),
            Err(warning) => warnings.push(warning),
        }
    }
    let manual_review = !warnings.is_empty();
    (sql, manual_review, warnings)
}

fn create_index_sql(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    relation_name: &str,
    index: &IndexInfo,
) -> std::result::Result<String, String> {
    if kind == DatabaseKind::Postgres {
        if source_schema != target_schema {
            return Err(format!(
                "Index {}.{} requires schema-aware definition mapping from {} to {}.",
                relation_name, index.name, source_schema, target_schema
            ));
        }
        if let Some(definition) = index
            .definition
            .as_deref()
            .map(str::trim)
            .filter(|definition| !definition.is_empty())
        {
            return Ok(format!("{};", definition.trim_end_matches(';')));
        }
    }

    let index_type = index
        .index_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let supported_type = match (kind, index_type) {
        (DatabaseKind::Postgres, None) => true,
        (DatabaseKind::Postgres, Some(value)) => value.eq_ignore_ascii_case("BTREE"),
        (DatabaseKind::Mysql, None) => true,
        (DatabaseKind::Mysql, Some(value)) => value.eq_ignore_ascii_case("BTREE"),
    };
    if !supported_type || index.columns.is_empty() {
        return Err(format!(
            "Index {}.{} uses an expression or unsupported index type and requires its exact source definition.",
            relation_name, index.name
        ));
    }

    Ok(kind.create_index_query(
        Some(target_schema),
        relation_name,
        &index.name,
        &index.columns,
        index.is_unique,
    ))
}

fn column_definition(kind: DatabaseKind, column: &ColumnInfo) -> (String, Vec<String>) {
    let mut definition = format!(
        "{} {}",
        kind.quote_identifier(&column.name),
        column.data_type.trim()
    );
    let mut warnings = Vec::new();
    if column.is_auto_increment {
        match kind.auto_increment_clause_for_type(&column.data_type) {
            Ok(Some(clause)) => definition.push_str(clause),
            Ok(None) => {}
            Err(error) => warnings.push(format!("{}: {error}", column.name)),
        }
    }
    if let Some(default_value) = column.default_value.as_deref() {
        definition.push_str(" DEFAULT ");
        definition.push_str(&kind.metadata_default_sql(&column.data_type, default_value));
    }
    if !column.is_nullable {
        definition.push_str(" NOT NULL");
    }
    if kind == DatabaseKind::Mysql {
        if let Some(comment) = column.comment.as_deref().filter(|value| !value.is_empty()) {
            definition.push_str(" COMMENT ");
            definition.push_str(&sql_string_literal(comment));
        }
    }
    (definition, warnings)
}

fn alter_column_sql(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    source: &ColumnInfo,
    target: &ColumnInfo,
) -> (Vec<String>, bool, Vec<String>) {
    let relation = kind.qualified_table(Some(schema), table);
    let column = kind.quote_identifier(&source.name);
    let mut sql = Vec::new();
    let mut warnings = Vec::new();
    let mut manual_review = false;

    if kind == DatabaseKind::Mysql {
        let (definition, definition_warnings) = column_definition(kind, source);
        warnings.extend(definition_warnings);
        sql.push(format!(
            "ALTER TABLE {relation} MODIFY COLUMN {definition};"
        ));
        return (sql, !warnings.is_empty(), warnings);
    }

    if source.data_type != target.data_type {
        sql.push(format!(
            "ALTER TABLE {relation} ALTER COLUMN {column} TYPE {} USING {column}::{};",
            source.data_type.trim(),
            source.data_type.trim()
        ));
        manual_review = true;
    }
    if source.default_value != target.default_value {
        match source.default_value.as_deref() {
            Some(default_value) => sql.push(format!(
                "ALTER TABLE {relation} ALTER COLUMN {column} SET DEFAULT {};",
                kind.metadata_default_sql(&source.data_type, default_value)
            )),
            None => sql.push(format!(
                "ALTER TABLE {relation} ALTER COLUMN {column} DROP DEFAULT;"
            )),
        }
    }
    if source.is_nullable != target.is_nullable {
        sql.push(format!(
            "ALTER TABLE {relation} ALTER COLUMN {column} {};",
            if source.is_nullable {
                "DROP NOT NULL"
            } else {
                "SET NOT NULL"
            }
        ));
        if !source.is_nullable {
            manual_review = true;
        }
    }
    if source.is_auto_increment != target.is_auto_increment {
        manual_review = true;
        warnings.push(format!(
            "Identity change for {table}.{} requires manual PostgreSQL sequence/identity review.",
            source.name
        ));
    }
    if source.comment != target.comment {
        let comment = source
            .comment
            .as_deref()
            .map(sql_string_literal)
            .unwrap_or_else(|| "NULL".to_string());
        sql.push(format!(
            "COMMENT ON COLUMN {relation}.{column} IS {comment};"
        ));
    }
    (sql, manual_review, warnings)
}

fn add_constraint_sql(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &ConstraintInfo,
) -> Option<String> {
    if let Some(definition) = constraint_definition_sql(kind, constraint) {
        return Some(format!(
            "ALTER TABLE {} ADD CONSTRAINT {} {};",
            kind.qualified_table(Some(schema), table),
            kind.quote_identifier(&constraint.name),
            definition
        ));
    }
    let normalized = constraint.constraint_type.to_ascii_uppercase();
    if normalized.contains("PRIMARY") {
        return Some(kind.add_primary_key_constraint_query(
            Some(schema),
            table,
            &constraint.name,
            &constraint.columns,
        ));
    }
    if normalized.contains("UNIQUE") {
        return Some(kind.add_unique_constraint_query(
            Some(schema),
            table,
            &constraint.name,
            &constraint.columns,
        ));
    }
    if normalized.contains("FOREIGN") {
        if kind == DatabaseKind::Mysql {
            return None;
        }
        return constraint
            .referenced_table
            .as_deref()
            .map(|referenced_table| {
                kind.add_foreign_key_constraint_query(
                    Some(schema),
                    table,
                    &constraint.name,
                    &constraint.columns,
                    constraint.referenced_schema.as_deref().or(Some(schema)),
                    referenced_table,
                    &constraint.referenced_columns,
                    None,
                    None,
                )
            });
    }
    None
}

fn inline_constraint_clause(kind: DatabaseKind, constraint: &ConstraintInfo) -> Option<String> {
    if let Some(definition) = constraint_definition_sql(kind, constraint) {
        return Some(format!(
            "CONSTRAINT {} {}",
            kind.quote_identifier(&constraint.name),
            definition
        ));
    }
    let normalized = constraint.constraint_type.to_ascii_uppercase();
    let columns = constraint
        .columns
        .iter()
        .map(|column| kind.quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    if normalized.contains("PRIMARY") {
        return Some(format!(
            "CONSTRAINT {} PRIMARY KEY ({columns})",
            kind.quote_identifier(&constraint.name)
        ));
    }
    if normalized.contains("UNIQUE") {
        return Some(format!(
            "CONSTRAINT {} UNIQUE ({columns})",
            kind.quote_identifier(&constraint.name)
        ));
    }
    if normalized.contains("FOREIGN") {
        if kind == DatabaseKind::Mysql {
            return None;
        }
        let referenced_table = constraint.referenced_table.as_deref()?;
        let referenced_columns = constraint
            .referenced_columns
            .iter()
            .map(|column| kind.quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        return Some(format!(
            "CONSTRAINT {} FOREIGN KEY ({columns}) REFERENCES {} ({referenced_columns})",
            kind.quote_identifier(&constraint.name),
            kind.qualified_table(constraint.referenced_schema.as_deref(), referenced_table)
        ));
    }
    None
}

fn constraint_definition_sql(kind: DatabaseKind, constraint: &ConstraintInfo) -> Option<String> {
    let definition = constraint
        .definition
        .as_deref()
        .map(str::trim)
        .filter(|definition| !definition.is_empty())?
        .trim_end_matches(';');
    let normalized_type = constraint.constraint_type.to_ascii_uppercase();
    if kind == DatabaseKind::Mysql
        && normalized_type.contains("CHECK")
        && !definition.to_ascii_uppercase().starts_with("CHECK")
    {
        return Some(format!("CHECK ({definition})"));
    }
    Some(definition.to_string())
}

fn is_foreign_constraint(constraint: &ConstraintInfo) -> bool {
    constraint
        .constraint_type
        .to_ascii_uppercase()
        .contains("FOREIGN")
}

fn column_structure_changed(source: &ColumnInfo, target: &ColumnInfo) -> bool {
    source.data_type != target.data_type
        || source.is_nullable != target.is_nullable
        || source.is_auto_increment != target.is_auto_increment
        || source.default_value != target.default_value
        || source.comment != target.comment
}

fn relation_map(relations: &[SchemaRelationSnapshot]) -> BTreeMap<String, &SchemaRelationSnapshot> {
    relations
        .iter()
        .map(|relation| (relation.name.clone(), relation))
        .collect()
}

fn snapshot_fingerprint(snapshot: &SchemaSnapshot) -> Result<String> {
    let payload = serde_json::to_vec(&(
        snapshot.version,
        &snapshot.driver,
        &snapshot.database_name,
        &snapshot.schema_name,
        &snapshot.relations,
    ))?;
    Ok(hex_digest(&payload))
}

#[allow(clippy::too_many_arguments)]
fn change(
    kind: SchemaChangeKind,
    risk: SchemaChangeRisk,
    schema_name: &str,
    relation_name: &str,
    object_type: Option<String>,
    child_name: Option<String>,
    summary: String,
    sql: Vec<String>,
    reversible: bool,
    manual_review: bool,
) -> SchemaChange {
    let id = stable_id(
        "schema-change",
        &format!(
            "{kind:?}:{schema_name}:{relation_name}:{}:{summary}",
            child_name.as_deref().unwrap_or("")
        ),
    );
    SchemaChange {
        id,
        kind,
        risk,
        schema_name: schema_name.to_string(),
        relation_name: relation_name.to_string(),
        object_type,
        child_name,
        summary,
        sql,
        reversible,
        manual_review,
        phase: phase_for_kind(kind),
        order: 0,
        depends_on: Vec::new(),
        blocked_reason: None,
    }
}

fn phase_for_kind(kind: SchemaChangeKind) -> SchemaChangePhase {
    match kind {
        SchemaChangeKind::ConstraintDrop | SchemaChangeKind::IndexDrop => {
            SchemaChangePhase::DropDependencies
        }
        SchemaChangeKind::RelationDrop => SchemaChangePhase::DropRelations,
        SchemaChangeKind::RelationCreate => SchemaChangePhase::CreateRelations,
        SchemaChangeKind::ColumnAdd
        | SchemaChangeKind::ColumnDrop
        | SchemaChangeKind::ColumnModify
        | SchemaChangeKind::RelationModify
        | SchemaChangeKind::ConstraintModify
        | SchemaChangeKind::IndexModify => SchemaChangePhase::AlterRelations,
        SchemaChangeKind::ConstraintAdd | SchemaChangeKind::IndexAdd => {
            SchemaChangePhase::CreateDependencies
        }
    }
}

fn finalize_change_plan(
    kind: DatabaseKind,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    mut changes: Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) -> (Vec<SchemaChange>, Vec<SchemaPreflightCheck>) {
    for change in &mut changes {
        if change.sql.is_empty() {
            change.blocked_reason =
                Some("No complete executable definition is available for this change.".to_string());
        }
    }

    let relation_creates = change_id_map(&changes, SchemaChangeKind::RelationCreate);
    let constraint_drops = child_change_id_map(&changes, SchemaChangeKind::ConstraintDrop);
    let index_drops = child_change_id_map(&changes, SchemaChangeKind::IndexDrop);
    let column_adds = child_change_id_map(&changes, SchemaChangeKind::ColumnAdd);

    for change in &mut changes {
        let mut dependencies = Vec::new();
        match change.kind {
            SchemaChangeKind::RelationDrop => {
                let mut unresolved = Vec::new();
                for relation in &target.relations {
                    for constraint in relation
                        .constraints
                        .iter()
                        .filter(|constraint| is_foreign_constraint(constraint))
                    {
                        let references_target = constraint.referenced_table.as_deref()
                            == Some(change.relation_name.as_str())
                            && constraint
                                .referenced_schema
                                .as_deref()
                                .is_none_or(|schema| schema == target.schema_name);
                        let belongs_to_target = relation.name == change.relation_name;
                        if references_target || belongs_to_target {
                            let dependency =
                                constraint_drops.get(&child_key(&relation.name, &constraint.name));
                            if dependency.is_none() {
                                unresolved.push(format!("{}.{}", relation.name, constraint.name));
                            }
                            add_dependency(&mut dependencies, dependency);
                        }
                    }
                }
                if !unresolved.is_empty() {
                    block_change(
                        change,
                        format!(
                            "Foreign keys must be removed before this relation: {}.",
                            unresolved.join(", ")
                        ),
                        warnings,
                    );
                }
            }
            SchemaChangeKind::ColumnDrop => {
                if let Some(column_name) = change.child_name.as_deref() {
                    if let Some(relation) = relation_by_name(target, &change.relation_name) {
                        let mut unresolved = Vec::new();
                        for constraint in relation.constraints.iter().filter(|constraint| {
                            constraint
                                .columns
                                .iter()
                                .any(|column| column == column_name)
                        }) {
                            let dependency =
                                constraint_drops.get(&child_key(&relation.name, &constraint.name));
                            if dependency.is_none() {
                                unresolved.push(constraint.name.clone());
                            }
                            add_dependency(&mut dependencies, dependency);
                        }
                        let constraint_names = relation
                            .constraints
                            .iter()
                            .map(|constraint| constraint.name.as_str())
                            .collect::<std::collections::HashSet<_>>();
                        for index in relation.indexes.iter().filter(|index| {
                            !index.is_primary
                                && !constraint_names.contains(index.name.as_str())
                                && index.columns.iter().any(|column| column == column_name)
                        }) {
                            let dependency =
                                index_drops.get(&child_key(&relation.name, &index.name));
                            if dependency.is_none() {
                                unresolved.push(index.name.clone());
                            }
                            add_dependency(&mut dependencies, dependency);
                        }
                        if !unresolved.is_empty() {
                            block_change(
                                change,
                                format!(
                                    "Dependent objects must be removed before this column: {}.",
                                    unresolved.join(", ")
                                ),
                                warnings,
                            );
                        }
                    }
                }
            }
            SchemaChangeKind::ColumnModify => {
                if let Some(column_name) = change.child_name.as_deref() {
                    let source_column = column_by_name(source, &change.relation_name, column_name);
                    let target_column = column_by_name(target, &change.relation_name, column_name);
                    if source_column
                        .zip(target_column)
                        .is_some_and(|(source, target)| source.data_type != target.data_type)
                    {
                        let mut unsupported_dependencies = Vec::new();
                        if let Some(relation) = relation_by_name(target, &change.relation_name) {
                            for constraint in relation.constraints.iter().filter(|constraint| {
                                constraint
                                    .columns
                                    .iter()
                                    .any(|column| column == column_name)
                            }) {
                                let dependency = constraint_drops
                                    .get(&child_key(&relation.name, &constraint.name));
                                if dependency.is_none() {
                                    unsupported_dependencies.push(constraint.name.clone());
                                }
                                add_dependency(&mut dependencies, dependency);
                            }
                            let constraint_names = relation
                                .constraints
                                .iter()
                                .map(|constraint| constraint.name.as_str())
                                .collect::<std::collections::HashSet<_>>();
                            for index in relation.indexes.iter().filter(|index| {
                                !index.is_primary
                                    && !constraint_names.contains(index.name.as_str())
                                    && index.columns.iter().any(|column| column == column_name)
                            }) {
                                let dependency =
                                    index_drops.get(&child_key(&relation.name, &index.name));
                                if dependency.is_none() {
                                    unsupported_dependencies.push(index.name.clone());
                                }
                                add_dependency(&mut dependencies, dependency);
                            }
                        }
                        if !unsupported_dependencies.is_empty() {
                            let reason = format!(
                                "Type change depends on unchanged objects that require an explicit rebuild: {}.",
                                unsupported_dependencies.join(", ")
                            );
                            warnings.push(format!(
                                "{}.{}: {reason}",
                                change.relation_name, column_name
                            ));
                            change.blocked_reason = Some(reason);
                            change.sql.clear();
                            change.manual_review = true;
                        }
                    }
                }
            }
            SchemaChangeKind::ConstraintAdd => {
                add_dependency(
                    &mut dependencies,
                    relation_creates.get(&change.relation_name),
                );
                if let Some(child_name) = change.child_name.as_deref() {
                    add_dependency(
                        &mut dependencies,
                        constraint_drops.get(&child_key(&change.relation_name, child_name)),
                    );
                    if let Some(constraint) =
                        constraint_by_name(source, &change.relation_name, child_name)
                    {
                        if let Some(referenced_table) = constraint.referenced_table.as_deref() {
                            if constraint
                                .referenced_schema
                                .as_deref()
                                .is_none_or(|schema| schema == source.schema_name)
                            {
                                add_dependency(
                                    &mut dependencies,
                                    relation_creates.get(referenced_table),
                                );
                            }
                        }
                        for column in &constraint.columns {
                            add_dependency(
                                &mut dependencies,
                                column_adds.get(&child_key(&change.relation_name, column)),
                            );
                        }
                    }
                }
            }
            SchemaChangeKind::IndexAdd => {
                add_dependency(
                    &mut dependencies,
                    relation_creates.get(&change.relation_name),
                );
                if let Some(child_name) = change.child_name.as_deref() {
                    add_dependency(
                        &mut dependencies,
                        index_drops.get(&child_key(&change.relation_name, child_name)),
                    );
                    if let Some(index) = index_by_name(source, &change.relation_name, child_name) {
                        for column in &index.columns {
                            add_dependency(
                                &mut dependencies,
                                column_adds.get(&child_key(&change.relation_name, column)),
                            );
                        }
                    }
                }
            }
            _ => {}
        }
        dependencies.sort();
        dependencies.dedup();
        change.depends_on = dependencies;
    }

    propagate_blocked_dependencies(&mut changes, warnings);
    let mut changes = topologically_order_changes(changes, warnings);
    for (index, change) in changes.iter_mut().enumerate() {
        change.order = index + 1;
        if change.blocked_reason.is_some() {
            change.phase = SchemaChangePhase::ManualReview;
        }
    }
    let preflight_checks = build_preflight_checks(kind, source, target, &changes);
    (changes, preflight_checks)
}

fn change_id_map(changes: &[SchemaChange], kind: SchemaChangeKind) -> BTreeMap<String, String> {
    changes
        .iter()
        .filter(|change| change.kind == kind)
        .map(|change| (change.relation_name.clone(), change.id.clone()))
        .collect()
}

fn child_change_id_map(
    changes: &[SchemaChange],
    kind: SchemaChangeKind,
) -> BTreeMap<String, String> {
    changes
        .iter()
        .filter(|change| change.kind == kind)
        .filter_map(|change| {
            change.child_name.as_deref().map(|child_name| {
                (
                    child_key(&change.relation_name, child_name),
                    change.id.clone(),
                )
            })
        })
        .collect()
}

fn child_key(relation_name: &str, child_name: &str) -> String {
    format!("{relation_name}\0{child_name}")
}

fn add_dependency(dependencies: &mut Vec<String>, dependency: Option<&String>) {
    if let Some(dependency) = dependency {
        dependencies.push(dependency.clone());
    }
}

fn block_change(change: &mut SchemaChange, reason: String, warnings: &mut Vec<String>) {
    warnings.push(format!("{}: {reason}", change.summary));
    change.blocked_reason = Some(reason);
    change.sql.clear();
    change.manual_review = true;
}

fn relation_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
) -> Option<&'a SchemaRelationSnapshot> {
    snapshot
        .relations
        .iter()
        .find(|relation| relation.name == relation_name)
}

fn column_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
    column_name: &str,
) -> Option<&'a ColumnInfo> {
    relation_by_name(snapshot, relation_name)?
        .columns
        .iter()
        .find(|column| column.name == column_name)
}

fn constraint_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
    constraint_name: &str,
) -> Option<&'a ConstraintInfo> {
    relation_by_name(snapshot, relation_name)?
        .constraints
        .iter()
        .find(|constraint| constraint.name == constraint_name)
}

fn index_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
    index_name: &str,
) -> Option<&'a IndexInfo> {
    relation_by_name(snapshot, relation_name)?
        .indexes
        .iter()
        .find(|index| index.name == index_name)
}

fn propagate_blocked_dependencies(changes: &mut [SchemaChange], warnings: &mut Vec<String>) {
    loop {
        let blocked_ids = changes
            .iter()
            .filter(|change| change.blocked_reason.is_some())
            .map(|change| change.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        let mut next_blocked = Vec::new();
        for (index, change) in changes.iter().enumerate() {
            if change.blocked_reason.is_none()
                && change
                    .depends_on
                    .iter()
                    .any(|dependency| blocked_ids.contains(dependency.as_str()))
            {
                next_blocked.push(index);
            }
        }
        if next_blocked.is_empty() {
            break;
        }
        for index in next_blocked {
            let change = &mut changes[index];
            let reason =
                "A required predecessor is blocked and must be resolved first.".to_string();
            warnings.push(format!("{}: {reason}", change.summary));
            change.blocked_reason = Some(reason);
            change.sql.clear();
            change.manual_review = true;
        }
    }
}

fn topologically_order_changes(
    changes: Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) -> Vec<SchemaChange> {
    let mut changes_by_id = changes
        .into_iter()
        .map(|change| (change.id.clone(), change))
        .collect::<BTreeMap<_, _>>();
    let known_ids = changes_by_id
        .keys()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let mut indegrees = BTreeMap::<String, usize>::new();
    let mut dependents = BTreeMap::<String, Vec<String>>::new();
    for change in changes_by_id.values() {
        let dependencies = change
            .depends_on
            .iter()
            .filter(|dependency| known_ids.contains(*dependency))
            .collect::<Vec<_>>();
        indegrees.insert(change.id.clone(), dependencies.len());
        for dependency in dependencies {
            dependents
                .entry(dependency.clone())
                .or_default()
                .push(change.id.clone());
        }
    }

    let mut ready = changes_by_id
        .values()
        .filter(|change| indegrees.get(&change.id).copied().unwrap_or(0) == 0)
        .map(owned_change_sort_key)
        .collect::<BTreeSet<_>>();
    let mut ordered = Vec::with_capacity(changes_by_id.len());
    while let Some(key) = ready.pop_first() {
        let id = key.4;
        let Some(change) = changes_by_id.remove(&id) else {
            continue;
        };
        if let Some(children) = dependents.get(&id) {
            for child_id in children {
                let Some(indegree) = indegrees.get_mut(child_id) else {
                    continue;
                };
                *indegree = indegree.saturating_sub(1);
                if *indegree == 0 {
                    if let Some(child) = changes_by_id.get(child_id) {
                        ready.insert(owned_change_sort_key(child));
                    }
                }
            }
        }
        ordered.push(change);
    }

    if !changes_by_id.is_empty() {
        warnings.push(
            "Migration dependency cycle detected; remaining changes require manual ordering."
                .to_string(),
        );
        let mut remaining = changes_by_id.into_values().collect::<Vec<_>>();
        remaining.sort_by_key(owned_change_sort_key);
        for mut change in remaining {
            change.blocked_reason = Some(
                "Dependency cycle requires manual ordering before SQL can be generated."
                    .to_string(),
            );
            change.sql.clear();
            change.manual_review = true;
            ordered.push(change);
        }
    }
    ordered
}

fn owned_change_sort_key(
    change: &SchemaChange,
) -> (SchemaChangePhase, String, String, SchemaChangeKind, String) {
    (
        change.phase,
        change.relation_name.clone(),
        change.child_name.clone().unwrap_or_default(),
        change.kind,
        change.id.clone(),
    )
}

fn build_preflight_checks(
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
                                &target.schema_name,
                                &change.relation_name,
                                constraint,
                            ) {
                                checks.push(preflight_check(
                                    change,
                                    "Find orphan rows before FOREIGN KEY",
                                    sql,
                                    "blocking_rows must be 0.",
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

fn foreign_key_preflight_sql(
    kind: DatabaseKind,
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
        constraint
            .referenced_schema
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

fn preflight_check(
    change: &SchemaChange,
    label: &str,
    sql: String,
    expectation: &str,
) -> SchemaPreflightCheck {
    SchemaPreflightCheck {
        id: stable_id("schema-preflight", &format!("{}:{label}", change.id)),
        change_id: change.id.clone(),
        label: label.to_string(),
        sql,
        expectation: expectation.to_string(),
    }
}

fn summarize_changes(changes: &[SchemaChange]) -> SchemaDiffSummary {
    SchemaDiffSummary {
        total: changes.len(),
        safe: changes
            .iter()
            .filter(|change| change.risk == SchemaChangeRisk::Safe)
            .count(),
        review: changes
            .iter()
            .filter(|change| change.risk == SchemaChangeRisk::Review)
            .count(),
        destructive: changes
            .iter()
            .filter(|change| change.risk == SchemaChangeRisk::Destructive)
            .count(),
        blocked: changes
            .iter()
            .filter(|change| change.blocked_reason.is_some())
            .count(),
    }
}

fn render_migration_sql(
    kind: DatabaseKind,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    changes: &[SchemaChange],
    warnings: &[String],
) -> String {
    let mut lines = vec![
        "-- OxideStudio schema migration preview".to_string(),
        format!(
            "-- Desired source: {} / {}",
            source.connection_name, source.schema_name
        ),
        format!(
            "-- Actual target: {} / {}",
            target.connection_name, target.schema_name
        ),
        "-- Generated only for review; nothing has been executed.".to_string(),
    ];
    if kind == DatabaseKind::Mysql {
        lines.push(
            "-- MySQL DDL may auto-commit; review every statement before running.".to_string(),
        );
    }
    for warning in warnings {
        lines.push(format!("-- WARNING: {warning}"));
    }
    let blocked_count = changes
        .iter()
        .filter(|change| change.blocked_reason.is_some())
        .count();
    if blocked_count > 0 {
        lines.push(format!(
            "-- PLAN BLOCKED: {blocked_count} change(s) require resolution; do not execute this script as a migration."
        ));
    }
    lines.push(String::new());
    if kind == DatabaseKind::Postgres && !changes.is_empty() {
        lines.push("BEGIN;".to_string());
        lines.push(String::new());
    }
    if changes.is_empty() {
        lines.push("-- No schema differences detected.".to_string());
    }
    for change in changes {
        lines.push(format!(
            "-- Step {} · {:?} · {:?}: {}",
            change.order, change.phase, change.risk, change.summary
        ));
        if !change.depends_on.is_empty() {
            lines.push(format!("-- Depends on: {}", change.depends_on.join(", ")));
        }
        if let Some(reason) = change.blocked_reason.as_deref() {
            lines.push(format!("-- BLOCKED: {reason}"));
        }
        if change.sql.is_empty() {
            lines.push("-- MANUAL REVIEW REQUIRED: no safe SQL was generated.".to_string());
        } else {
            lines.extend(change.sql.iter().cloned());
        }
        lines.push(String::new());
    }
    if kind == DatabaseKind::Postgres && !changes.is_empty() {
        lines.push("-- Replace ROLLBACK with COMMIT only after review and validation.".to_string());
        lines.push("ROLLBACK;".to_string());
    }
    lines.join("\n")
}

fn render_preflight_sql(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    checks: &[SchemaPreflightCheck],
) -> String {
    let mut lines = vec![
        "-- OxideStudio schema migration preflight".to_string(),
        format!(
            "-- Desired source: {} / {}",
            source.connection_name, source.schema_name
        ),
        format!(
            "-- Actual target: {} / {}",
            target.connection_name, target.schema_name
        ),
        "-- Read-only checks only; inspect every expectation before migration execution."
            .to_string(),
        String::new(),
    ];
    if checks.is_empty() {
        lines.push("-- No generated preflight checks for this plan.".to_string());
    }
    for (index, check) in checks.iter().enumerate() {
        lines.push(format!("-- Check {}: {}", index + 1, check.label));
        lines.push(format!("-- Expectation: {}", check.expectation));
        lines.push(check.sql.clone());
        lines.push(String::new());
    }
    lines.join("\n")
}

#[derive(Default)]
struct RelationFlags {
    is_view: bool,
    is_materialized_view: bool,
    is_foreign_table: bool,
}

fn relation_flags(object_type: Option<&str>) -> RelationFlags {
    let normalized = object_type.unwrap_or("").trim().to_ascii_uppercase();
    RelationFlags {
        is_view: normalized.contains("VIEW"),
        is_materialized_view: normalized.contains("MATERIALIZED"),
        is_foreign_table: normalized.contains("FOREIGN"),
    }
}

fn stable_id(prefix: &str, value: &str) -> String {
    format!("{prefix}-{}", &hex_digest(value.as_bytes())[..16])
}

fn hex_digest(value: &[u8]) -> String {
    let digest = Sha256::digest(value);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column(name: &str, data_type: &str, nullable: bool) -> ColumnInfo {
        ColumnInfo {
            name: name.to_string(),
            data_type: data_type.to_string(),
            is_nullable: nullable,
            is_primary_key: name == "id",
            is_unique: name == "id",
            is_indexed: name == "id",
            is_auto_increment: name == "id",
            default_value: None,
            comment: None,
        }
    }

    fn snapshot(id: &str, columns: Vec<ColumnInfo>) -> SchemaSnapshot {
        finalize_schema_snapshot(SchemaSnapshot {
            version: SCHEMA_SNAPSHOT_VERSION,
            id: id.to_string(),
            fingerprint: String::new(),
            project_id: "project-1".to_string(),
            connection_id: "connection-1".to_string(),
            connection_name: "Local".to_string(),
            driver: "postgres".to_string(),
            database_name: Some("app".to_string()),
            schema_name: "public".to_string(),
            captured_at: 1,
            relations: vec![SchemaRelationSnapshot {
                name: "users".to_string(),
                object_type: Some("BASE TABLE".to_string()),
                columns,
                indexes: Vec::new(),
                constraints: Vec::new(),
            }],
            warnings: Vec::new(),
        })
        .unwrap()
    }

    fn constraint(name: &str, constraint_type: &str, columns: &[&str]) -> ConstraintInfo {
        ConstraintInfo {
            name: name.to_string(),
            constraint_type: constraint_type.to_string(),
            columns: columns.iter().map(|value| (*value).to_string()).collect(),
            referenced_schema: None,
            referenced_table: None,
            referenced_columns: Vec::new(),
            definition: None,
        }
    }

    fn index(name: &str, columns: &[&str], index_type: &str) -> IndexInfo {
        IndexInfo {
            name: name.to_string(),
            columns: columns.iter().map(|value| (*value).to_string()).collect(),
            is_unique: false,
            is_primary: false,
            index_type: Some(index_type.to_string()),
            definition: None,
        }
    }

    #[test]
    fn fingerprint_is_stable_after_relation_sorting() {
        let mut first = snapshot("first", vec![column("id", "int4", false)]);
        first.relations.push(SchemaRelationSnapshot {
            name: "accounts".to_string(),
            object_type: Some("BASE TABLE".to_string()),
            columns: vec![column("id", "int4", false)],
            indexes: Vec::new(),
            constraints: Vec::new(),
        });
        let first = finalize_schema_snapshot(first).unwrap();
        let mut second = first.clone();
        second.id = "second".to_string();
        second.relations.reverse();
        let second = finalize_schema_snapshot(second).unwrap();
        assert_eq!(first.fingerprint, second.fingerprint);
    }

    #[test]
    fn adds_missing_nullable_column_with_safe_preview() {
        let source = snapshot(
            "desired",
            vec![
                column("id", "int4", false),
                column("nickname", "text", true),
            ],
        );
        let target = snapshot("actual", vec![column("id", "int4", false)]);
        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        assert_eq!(plan.summary.safe, 1);
        assert_eq!(plan.summary.destructive, 0);
        assert_eq!(plan.changes[0].kind, SchemaChangeKind::ColumnAdd);
        assert!(plan
            .migration_sql
            .contains("ALTER TABLE \"public\".\"users\" ADD COLUMN \"nickname\" text;"));
        assert!(plan.migration_sql.ends_with("ROLLBACK;"));
    }

    #[test]
    fn marks_target_only_column_as_destructive() {
        let source = snapshot("desired", vec![column("id", "int4", false)]);
        let target = snapshot(
            "actual",
            vec![column("id", "int4", false), column("legacy", "text", true)],
        );
        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        assert_eq!(plan.summary.destructive, 1);
        assert!(!plan.changes[0].reversible);
        assert!(plan.migration_sql.contains("DROP COLUMN \"legacy\""));
    }

    #[test]
    fn type_changes_require_manual_review() {
        let source = snapshot("desired", vec![column("id", "bigint", false)]);
        let target = snapshot("actual", vec![column("id", "int4", false)]);
        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        assert_eq!(plan.changes[0].risk, SchemaChangeRisk::Destructive);
        assert!(plan.changes[0].manual_review);
        assert!(plan
            .migration_sql
            .contains("TYPE bigint USING \"id\"::bigint"));
    }

    #[test]
    fn rejects_cross_driver_migration() {
        let source = snapshot("desired", vec![column("id", "bigint", false)]);
        let mut target = snapshot("actual", vec![column("id", "bigint", false)]);
        target.driver = "mysql".to_string();
        let error = compare_schema_snapshots(&source, &target, 2).unwrap_err();
        assert!(error.to_string().contains("Cross-driver"));
    }

    #[test]
    fn mysql_preview_warns_about_auto_commit_and_uses_mysql_alter_syntax() {
        let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
        let mut target = snapshot("actual", vec![column("id", "int", false)]);
        source.driver = "mysql".to_string();
        target.driver = "mysql".to_string();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert!(!plan.transactional);
        assert!(plan.id.starts_with("schema-diff-"));
        assert!(plan.migration_sql.contains("MySQL DDL may auto-commit"));
        assert!(plan
            .migration_sql
            .contains("ALTER TABLE `public`.`users` MODIFY COLUMN `id` bigint"));
        assert!(!plan.migration_sql.contains("ROLLBACK;"));
    }

    #[test]
    fn created_relation_with_foreign_key_requires_dependency_review() {
        let mut source = snapshot("desired", vec![column("id", "int4", false)]);
        source.relations[0].constraints = vec![ConstraintInfo {
            referenced_schema: Some("public".to_string()),
            referenced_table: Some("accounts".to_string()),
            referenced_columns: vec!["id".to_string()],
            ..constraint("users_account_fk", "FOREIGN KEY", &["id"])
        }];
        source.relations.push(SchemaRelationSnapshot {
            name: "accounts".to_string(),
            object_type: Some("BASE TABLE".to_string()),
            columns: vec![column("id", "int4", false)],
            indexes: Vec::new(),
            constraints: Vec::new(),
        });
        source = finalize_schema_snapshot(source).unwrap();
        let mut target = snapshot("actual", vec![column("id", "int4", false)]);
        target.relations.clear();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        let relation_creates = plan
            .changes
            .iter()
            .filter(|change| change.kind == SchemaChangeKind::RelationCreate)
            .collect::<Vec<_>>();
        let foreign_key = plan
            .changes
            .iter()
            .find(|change| change.child_name.as_deref() == Some("users_account_fk"))
            .unwrap();
        assert_eq!(relation_creates.len(), 2);
        assert_eq!(foreign_key.kind, SchemaChangeKind::ConstraintAdd);
        assert_eq!(foreign_key.risk, SchemaChangeRisk::Review);
        assert!(foreign_key.manual_review);
        assert_eq!(foreign_key.depends_on.len(), 2);
        assert!(relation_creates
            .iter()
            .all(|create| create.order < foreign_key.order));
        assert!(plan.migration_sql.contains("FOREIGN KEY"));
    }

    #[test]
    fn changed_view_or_foreign_table_is_a_manual_artifact_without_generated_sql() {
        for object_type in ["VIEW", "FOREIGN TABLE"] {
            let mut source = snapshot("desired", vec![column("id", "int4", false)]);
            let mut target = snapshot("actual", vec![column("id", "int4", false)]);
            source.relations[0].object_type = Some(object_type.to_string());
            target.relations[0].object_type = Some(object_type.to_string());
            target.relations[0]
                .columns
                .push(column("legacy", "text", true));
            source = finalize_schema_snapshot(source).unwrap();
            target = finalize_schema_snapshot(target).unwrap();

            let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

            assert_eq!(plan.changes[0].kind, SchemaChangeKind::RelationModify);
            assert!(plan.changes[0].sql.is_empty());
            assert!(plan.changes[0].manual_review);
            assert!(plan.migration_sql.contains("MANUAL REVIEW REQUIRED"));
        }
    }

    #[test]
    fn relation_without_captured_columns_does_not_emit_invalid_create_sql() {
        let mut source = snapshot("desired", Vec::new());
        let mut target = snapshot("actual", Vec::new());
        target.relations.clear();
        source = finalize_schema_snapshot(source).unwrap();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert!(plan.changes[0].sql.is_empty());
        assert_eq!(plan.changes[0].risk, SchemaChangeRisk::Review);
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("no captured columns")));
    }

    #[test]
    fn postgres_expression_index_preserves_exact_database_definition() {
        let mut source = snapshot(
            "desired",
            vec![column("id", "int4", false), column("email", "text", true)],
        );
        source.relations[0].indexes = vec![IndexInfo {
            definition: Some(
                "CREATE INDEX users_email_lower_idx ON public.users USING btree (lower(email)) WHERE (email IS NOT NULL)"
                    .to_string(),
            ),
            ..index("users_email_lower_idx", &[], "btree")
        }];
        source = finalize_schema_snapshot(source).unwrap();
        let target = snapshot(
            "actual",
            vec![column("id", "int4", false), column("email", "text", true)],
        );

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert_eq!(plan.changes[0].risk, SchemaChangeRisk::Safe);
        assert_eq!(plan.changes[0].sql.len(), 1);
        assert!(plan.migration_sql.contains("lower(email)"));
        assert!(plan.migration_sql.contains("WHERE (email IS NOT NULL);"));
    }

    #[test]
    fn unknown_mysql_index_definition_never_emits_partial_rebuild_sql() {
        let mut mysql_source = snapshot(
            "desired",
            vec![column("id", "int4", false), column("body", "text", true)],
        );
        let mut mysql_target = snapshot(
            "actual",
            vec![column("id", "int4", false), column("body", "text", true)],
        );
        mysql_source.driver = "mysql".to_string();
        mysql_source.relations[0].indexes =
            vec![index("users_body_fulltext", &["body"], "FULLTEXT")];
        mysql_source = finalize_schema_snapshot(mysql_source).unwrap();
        mysql_target.driver = "mysql".to_string();
        mysql_target = finalize_schema_snapshot(mysql_target).unwrap();

        let mysql_plan = compare_schema_snapshots(&mysql_source, &mysql_target, 2).unwrap();
        assert_eq!(mysql_plan.changes[0].risk, SchemaChangeRisk::Review);
        assert!(mysql_plan.changes[0].sql.is_empty());
    }

    #[test]
    fn rejects_cross_schema_comparison_without_explicit_mapping() {
        let mut source = snapshot("desired", vec![column("id", "int4", false)]);
        source.schema_name = "template".to_string();
        source = finalize_schema_snapshot(source).unwrap();
        let target = snapshot("actual", vec![column("id", "int4", false)]);

        let error = compare_schema_snapshots(&source, &target, 2).unwrap_err();

        assert!(error.to_string().contains("explicit schema mapping"));
    }

    #[test]
    fn mysql_check_is_normalized_but_foreign_key_rules_are_not_guessed() {
        let mut source = snapshot(
            "desired",
            vec![column("id", "int", false), column("age", "int", true)],
        );
        source.driver = "mysql".to_string();
        source.relations[0].constraints = vec![
            ConstraintInfo {
                definition: Some("age >= 0".to_string()),
                ..constraint("users_age_check", "CHECK", &[])
            },
            ConstraintInfo {
                referenced_schema: Some("public".to_string()),
                referenced_table: Some("accounts".to_string()),
                referenced_columns: vec!["id".to_string()],
                ..constraint("users_account_fk", "FOREIGN KEY", &["id"])
            },
        ];
        source = finalize_schema_snapshot(source).unwrap();
        let mut target = snapshot(
            "actual",
            vec![column("id", "int", false), column("age", "int", true)],
        );
        target.driver = "mysql".to_string();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        let check = plan
            .changes
            .iter()
            .find(|change| change.child_name.as_deref() == Some("users_age_check"))
            .unwrap();
        assert!(check.sql[0].contains("CHECK (age >= 0)"));
        let foreign_key = plan
            .changes
            .iter()
            .find(|change| change.child_name.as_deref() == Some("users_account_fk"))
            .unwrap();
        assert!(foreign_key.sql.is_empty());
        assert!(foreign_key.manual_review);
    }

    #[test]
    fn target_only_relations_drop_foreign_keys_before_both_sides() {
        let mut source = snapshot("desired", vec![column("id", "int4", false)]);
        source.relations.clear();
        source = finalize_schema_snapshot(source).unwrap();

        let mut target = snapshot("actual", vec![column("id", "int4", false)]);
        target.relations[0].constraints = vec![ConstraintInfo {
            referenced_schema: Some("public".to_string()),
            referenced_table: Some("accounts".to_string()),
            referenced_columns: vec!["id".to_string()],
            ..constraint("users_account_fk", "FOREIGN KEY", &["id"])
        }];
        target.relations.push(SchemaRelationSnapshot {
            name: "accounts".to_string(),
            object_type: Some("BASE TABLE".to_string()),
            columns: vec![column("id", "int4", false)],
            indexes: Vec::new(),
            constraints: Vec::new(),
        });
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        let foreign_key_drop = plan
            .changes
            .iter()
            .find(|change| change.child_name.as_deref() == Some("users_account_fk"))
            .unwrap();
        let relation_drops = plan
            .changes
            .iter()
            .filter(|change| change.kind == SchemaChangeKind::RelationDrop)
            .collect::<Vec<_>>();
        assert_eq!(foreign_key_drop.phase, SchemaChangePhase::DropDependencies);
        assert_eq!(relation_drops.len(), 2);
        assert!(relation_drops.iter().all(|drop| {
            drop.depends_on.contains(&foreign_key_drop.id) && foreign_key_drop.order < drop.order
        }));
        assert_eq!(plan.preflight_checks.len(), 2);
    }

    #[test]
    fn preflight_covers_required_columns_not_null_and_unique_constraints() {
        let mut source = snapshot(
            "desired",
            vec![
                column("id", "int4", false),
                column("email", "text", false),
                column("tenant_id", "int4", false),
            ],
        );
        source.relations[0].constraints = vec![constraint("users_email_key", "UNIQUE", &["email"])];
        source = finalize_schema_snapshot(source).unwrap();
        let target = snapshot(
            "actual",
            vec![column("id", "int4", false), column("email", "text", true)],
        );

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert_eq!(plan.preflight_checks.len(), 3);
        assert!(plan.preflight_sql.contains("blocking_rows"));
        assert!(plan.preflight_sql.contains("IS NULL"));
        assert!(plan.preflight_sql.contains("duplicate_count"));
        assert!(plan.preflight_sql.contains("HAVING COUNT(*) > 1"));
    }

    #[test]
    fn type_change_with_unchanged_dependency_is_blocked_instead_of_half_generated() {
        let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
        source.relations[0].indexes = vec![index("users_id_idx", &["id"], "btree")];
        source = finalize_schema_snapshot(source).unwrap();
        let mut target = snapshot("actual", vec![column("id", "int4", false)]);
        target.relations[0].indexes = vec![index("users_id_idx", &["id"], "btree")];
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        let type_change = plan
            .changes
            .iter()
            .find(|change| change.kind == SchemaChangeKind::ColumnModify)
            .unwrap();
        assert!(type_change.blocked_reason.is_some());
        assert!(type_change.sql.is_empty());
        assert_eq!(type_change.phase, SchemaChangePhase::ManualReview);
        assert_eq!(plan.summary.blocked, 1);
        assert!(plan.migration_sql.contains("PLAN BLOCKED"));
        assert!(!plan.migration_sql.contains("ALTER COLUMN \"id\" TYPE"));
    }

    #[test]
    fn dependency_cycle_is_blocked_without_emitting_partial_sql() {
        let mut first = change(
            SchemaChangeKind::ColumnAdd,
            SchemaChangeRisk::Safe,
            "public",
            "users",
            Some("BASE TABLE".to_string()),
            Some("first".to_string()),
            "Add first".to_string(),
            vec!["ALTER TABLE users ADD first int;".to_string()],
            true,
            false,
        );
        let mut second = change(
            SchemaChangeKind::ColumnAdd,
            SchemaChangeRisk::Safe,
            "public",
            "users",
            Some("BASE TABLE".to_string()),
            Some("second".to_string()),
            "Add second".to_string(),
            vec!["ALTER TABLE users ADD second int;".to_string()],
            true,
            false,
        );
        first.depends_on = vec![second.id.clone()];
        second.depends_on = vec![first.id.clone()];
        let mut warnings = Vec::new();

        let ordered = topologically_order_changes(vec![first, second], &mut warnings);

        assert!(ordered.iter().all(|change| change.sql.is_empty()));
        assert!(ordered.iter().all(|change| change.blocked_reason.is_some()));
        assert!(warnings.iter().any(|warning| warning.contains("cycle")));
    }
}
