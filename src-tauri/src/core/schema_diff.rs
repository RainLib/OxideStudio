use crate::core::{
    dialect::DatabaseKind,
    protocol::{ColumnInfo, ConstraintInfo, IndexInfo},
};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, str::FromStr};

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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaChangeRisk {
    Safe,
    Review,
    Destructive,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDiffSummary {
    pub total: usize,
    pub safe: usize,
    pub review: usize,
    pub destructive: usize,
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
            }
            (None, Some(target_relation)) => {
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

    warnings.sort();
    warnings.dedup();
    let summary = summarize_changes(&changes);
    let transactional = kind == DatabaseKind::Postgres;
    let migration_sql = render_migration_sql(kind, source, target, &changes, &warnings);
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
                let sql = match replacement {
                    Ok(replacement) => vec![
                        kind.drop_index_query(Some(target_schema), &target.name, index_name),
                        replacement,
                    ],
                    Err(warning) => {
                        warnings.push(warning);
                        Vec::new()
                    }
                };
                changes.push(change(
                    SchemaChangeKind::IndexModify,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(index_name.to_string()),
                    format!("Recreate changed index {} on {}", index_name, source.name),
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
                let mut sql = vec![kind.drop_constraint_query(
                    Some(target_schema),
                    &target.name,
                    constraint_name,
                    &target_constraint.constraint_type,
                )];
                if let Some(add_sql) = add_sql {
                    sql.push(add_sql);
                } else {
                    warnings.push(format!(
                        "Constraint {}.{} has no executable replacement definition.",
                        source.name, constraint_name
                    ));
                }
                changes.push(change(
                    SchemaChangeKind::ConstraintModify,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(constraint_name.to_string()),
                    format!(
                        "Recreate changed constraint {} on {}",
                        constraint_name, source.name
                    ),
                    sql,
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
    if relation.constraints.iter().any(|constraint| {
        constraint
            .constraint_type
            .to_ascii_uppercase()
            .contains("FOREIGN")
    }) {
        warnings.push(format!(
            "Relation {} contains foreign keys; validate referenced relation creation order before execution.",
            relation.name
        ));
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
    for constraint in &relation.constraints {
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
    lines.push(String::new());
    if kind == DatabaseKind::Postgres && !changes.is_empty() {
        lines.push("BEGIN;".to_string());
        lines.push(String::new());
    }
    if changes.is_empty() {
        lines.push("-- No schema differences detected.".to_string());
    }
    for change in changes {
        lines.push(format!("-- {:?}: {}", change.risk, change.summary));
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
        source = finalize_schema_snapshot(source).unwrap();
        let mut target = snapshot("actual", vec![column("id", "int4", false)]);
        target.relations.clear();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert_eq!(plan.changes[0].kind, SchemaChangeKind::RelationCreate);
        assert_eq!(plan.changes[0].risk, SchemaChangeRisk::Review);
        assert!(plan.changes[0].manual_review);
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("creation order")));
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
}
