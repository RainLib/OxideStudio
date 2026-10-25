use super::comments::table_comment_sql;
use super::ddl::{
    add_constraint_sql, alter_column_sql, column_definition, column_structure_changed,
    create_index_sql, external_view_dependency_warnings, index_structure_changed,
    mysql_character_clause, normalized_view_select_definition,
};
use super::metadata_children::metadata_only_change;
use super::plan_model::{
    block_change, change, relation_by_name, MATERIALIZED_VIEW_DEPENDENT_DROP_PREFIX,
    MATERIALIZED_VIEW_DEPENDENT_RECREATE_PREFIX,
};
use super::render::relation_flags;
use super::types::{
    SchemaChange, SchemaChangeKind, SchemaChangePhase, SchemaChangeRisk, SchemaRelationSnapshot,
    SchemaSnapshot,
};
use crate::core::dialect::DatabaseKind;
use crate::core::mysql_character::is_mysql_character_type;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn compare_relation(
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
        if source.object_type == target.object_type
            && source_flags.is_view
            && !source_flags.is_materialized_view
            && !target_flags.is_materialized_view
            && source.definition != target.definition
        {
            if let Some(definition) =
                normalized_view_select_definition(source.definition.as_deref())
            {
                warnings.extend(external_view_dependency_warnings(source));
                warnings.push(format!(
                    "View {} source changed. The generated replacement is review-required because dependent views can be affected.",
                    source.name
                ));
                changes.push(change(
                    SchemaChangeKind::RelationModify,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    None,
                    format!("Replace view definition for {}", source.name),
                    vec![kind.create_view_query(
                        Some(target_schema),
                        &source.name,
                        &definition,
                        true,
                    )],
                    false,
                    true,
                ));
                return;
            }
        }
        if source.object_type == target.object_type
            && source_flags.is_materialized_view
            && target_flags.is_materialized_view
            && kind == DatabaseKind::Postgres
            && (source.definition != target.definition
                || source.materialized_view_populated != target.materialized_view_populated)
        {
            if let Some(definition) =
                normalized_view_select_definition(source.definition.as_deref())
            {
                let with_data = source.materialized_view_populated.unwrap_or(false);
                let create_sql = kind.create_materialized_view_query(
                    Some(target_schema),
                    &source.name,
                    &definition,
                    with_data,
                );
                if let Some(create_sql) = create_sql {
                    warnings.extend(external_view_dependency_warnings(source));
                    warnings.push(format!(
                        "Materialized view {} changes are represented as a destructive, review-required DROP/CREATE without CASCADE; captured unchanged dependent views are rebuilt explicitly, while incomplete dependencies block this plan.",
                        source.name
                    ));
                    changes.push(change(
                        SchemaChangeKind::RelationModify,
                        SchemaChangeRisk::Destructive,
                        target_schema,
                        &source.name,
                        source.object_type.clone(),
                        None,
                        format!("Recreate materialized view {}", source.name),
                        vec![
                            kind.drop_relation_query_with_kind(
                                Some(target_schema),
                                &source.name,
                                true,
                                true,
                                false,
                                false,
                            ),
                            create_sql,
                        ],
                        false,
                        true,
                    ));
                    return;
                }
            }
        }
        if source != target {
            warnings.push(format!(
                "Relation {} requires manual review because its view or foreign-table definition is not available for a safe replacement.",
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

    compare_columns(
        kind,
        source_schema,
        target_schema,
        source,
        target,
        changes,
        warnings,
    );
    compare_constraints(
        kind,
        source_schema,
        target_schema,
        source,
        target,
        changes,
        warnings,
    );
    compare_indexes(
        kind,
        source_schema,
        target_schema,
        source,
        target,
        changes,
        warnings,
    );
    if source.comment != target.comment {
        changes.push(change(
            SchemaChangeKind::RelationModify,
            SchemaChangeRisk::Safe,
            target_schema,
            &source.name,
            source.object_type.clone(),
            None,
            format!("Update table comment for {}", source.name),
            vec![table_comment_sql(
                kind,
                target_schema,
                &source.name,
                source.comment.as_deref(),
            )],
            true,
            false,
        ));
    }
}

/// PostgreSQL refuses to drop a materialized view while ordinary views still
/// depend on it. When the dependent views are unchanged and their catalog
/// source is available, turn that server-side dependency into explicit,
/// review-gated DDL instead of relying on CASCADE. Any incomplete edge blocks
/// the materialized-view recreation rather than dropping objects blindly.
pub(super) fn add_postgres_materialized_view_dependent_rebuilds(
    kind: DatabaseKind,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    target_schema: &str,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    if kind != DatabaseKind::Postgres {
        return;
    }
    let materialized_changes = changes
        .iter()
        .filter(|change| {
            change.kind == SchemaChangeKind::RelationModify
                && !change.sql.is_empty()
                && relation_by_name(source, &change.relation_name).is_some_and(|relation| {
                    relation_flags(relation.object_type.as_deref()).is_materialized_view
                })
        })
        .map(|change| (change.id.clone(), change.relation_name.clone()))
        .collect::<Vec<_>>();

    for (change_id, materialized_name) in materialized_changes {
        let dependents = dependent_regular_views(target, &materialized_name);
        if dependents.is_empty() {
            continue;
        }

        let unsupported = dependents
            .iter()
            .filter_map(|name| {
                let source_view = relation_by_name(source, name);
                let target_view = relation_by_name(target, name);
                let supported =
                    source_view
                        .zip(target_view)
                        .is_some_and(|(source_view, target_view)| {
                            let flags = relation_flags(source_view.object_type.as_deref());
                            flags.is_view
                                && !flags.is_materialized_view
                                && source_view == target_view
                                && normalized_view_select_definition(
                                    source_view.definition.as_deref(),
                                )
                                .is_some()
                        });
                (!supported).then(|| name.clone())
            })
            .collect::<Vec<_>>();
        if !unsupported.is_empty() {
            if let Some(change) = changes.iter_mut().find(|change| change.id == change_id) {
                block_change(
                    change,
                    format!(
                        "Dependent PostgreSQL views require source-preserving recreation before materialized view {} can be dropped: {}.",
                        materialized_name,
                        unsupported.join(", ")
                    ),
                    warnings,
                );
            }
            continue;
        }

        warnings.push(format!(
            "Materialized view {} has dependent PostgreSQL view(s): {}. The reviewed plan drops and recreates them explicitly without CASCADE.",
            materialized_name,
            dependents.join(", ")
        ));
        for name in &dependents {
            let source_view = relation_by_name(source, name).expect("supported view exists");
            let mut drop = change(
                SchemaChangeKind::RelationDrop,
                SchemaChangeRisk::Destructive,
                target_schema,
                name,
                source_view.object_type.clone(),
                None,
                format!("{MATERIALIZED_VIEW_DEPENDENT_DROP_PREFIX}{name}"),
                vec![kind.drop_relation_query_with_kind(
                    Some(target_schema),
                    name,
                    true,
                    false,
                    false,
                    false,
                )],
                false,
                true,
            );
            drop.phase = SchemaChangePhase::DropDependencies;
            changes.push(drop);
        }
        for name in &dependents {
            let source_view = relation_by_name(source, name).expect("supported view exists");
            let definition = normalized_view_select_definition(source_view.definition.as_deref())
                .expect("supported view has source");
            let mut recreate = change(
                SchemaChangeKind::RelationCreate,
                SchemaChangeRisk::Review,
                target_schema,
                name,
                source_view.object_type.clone(),
                None,
                format!("{MATERIALIZED_VIEW_DEPENDENT_RECREATE_PREFIX}{name}"),
                vec![kind.create_view_query(Some(target_schema), name, &definition, false)],
                false,
                true,
            );
            recreate.phase = SchemaChangePhase::CreateDependencies;
            changes.push(recreate);
        }
    }
}

pub(super) fn dependent_regular_views(
    snapshot: &SchemaSnapshot,
    root_relation: &str,
) -> Vec<String> {
    let mut dependencies = BTreeSet::from([root_relation.to_string()]);
    let mut dependents = BTreeSet::new();
    loop {
        let next = snapshot
            .relations
            .iter()
            .filter(|relation| {
                let flags = relation_flags(relation.object_type.as_deref());
                flags.is_view
                    && !flags.is_materialized_view
                    && relation
                        .dependencies
                        .iter()
                        .any(|dependency| dependencies.contains(dependency))
                    && !dependents.contains(&relation.name)
            })
            .map(|relation| relation.name.clone())
            .collect::<Vec<_>>();
        if next.is_empty() {
            break;
        }
        for relation in next {
            dependencies.insert(relation.clone());
            dependents.insert(relation);
        }
    }
    dependents.into_iter().collect()
}

pub(super) fn compare_columns(
    kind: DatabaseKind,
    source_schema: &str,
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
        if kind == DatabaseKind::Mysql
            && source_columns
                .get(column_name)
                .zip(target_columns.get(column_name))
                .is_some_and(|(source, target)| {
                    source.character_set.is_none()
                        && source.collation.is_none()
                        && is_mysql_character_type(&source.data_type)
                        && (target.character_set.is_some() || target.collation.is_some())
                })
        {
            warnings.push(format!(
                "Source character metadata for {}.{column_name} is unavailable; it is not compared and existing target attributes are preserved for other changes.",
                source.name
            ));
        }
        match (
            source_columns.get(column_name),
            target_columns.get(column_name),
        ) {
            (Some(source_column), None) => {
                let (definition, definition_warnings) =
                    column_definition(kind, source_schema, target_schema, source_column);
                let definition_needs_review = !definition_warnings.is_empty();
                warnings.extend(definition_warnings);
                let ownership_unmodeled = source_column.is_generated != Some(false)
                    || source_column.is_hidden != Some(false);
                let incomplete_definition = ownership_unmodeled
                    || (kind == DatabaseKind::Mysql
                        && mysql_character_clause(source_column).is_err());
                if ownership_unmodeled {
                    warnings.push(format!(
                        "Column {}.{} cannot be generated until its generated/hidden definition is captured losslessly.",
                        source.name, column_name
                    ));
                }
                let risk = if incomplete_definition || definition_needs_review {
                    SchemaChangeRisk::Review
                } else if source_column.is_nullable || source_column.default_value.is_some() {
                    SchemaChangeRisk::Safe
                } else {
                    SchemaChangeRisk::Review
                };
                let sql = (!incomplete_definition)
                    .then(|| {
                        format!(
                            "ALTER TABLE {} ADD COLUMN {};",
                            kind.qualified_table(Some(target_schema), &source.name),
                            definition
                        )
                    })
                    .into_iter()
                    .collect();
                changes.push(change(
                    SchemaChangeKind::ColumnAdd,
                    risk,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(column_name.to_string()),
                    format!("Add column {}.{}", source.name, column_name),
                    sql,
                    !incomplete_definition,
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
                if column_structure_changed(kind, source_column, target_column) =>
            {
                let (sql, manual_review, alter_warnings) = alter_column_sql(
                    kind,
                    source_schema,
                    target_schema,
                    &source.name,
                    source_column,
                    target_column,
                );
                warnings.extend(alter_warnings);
                let destructive = source_column.data_type != target_column.data_type
                    || (!source_column.is_nullable && target_column.is_nullable)
                    || (kind == DatabaseKind::Mysql
                        && source_column
                            .character_set
                            .as_deref()
                            .zip(target_column.character_set.as_deref())
                            .is_some_and(|(source, target)| {
                                !source.trim().eq_ignore_ascii_case(target.trim())
                            }));
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

pub(super) fn compare_indexes(
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
                let comment_requires_review = source_index
                    .comment
                    .as_deref()
                    .is_some_and(|comment| !comment.trim().is_empty());
                let (sql, manual_review) = match sql {
                    Ok(_) if comment_requires_review => {
                        warnings.push(format!(
                            "Index {}.{} has a comment that requires a product-specific semantic migration.",
                            source.name, index_name
                        ));
                        (Vec::new(), true)
                    }
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
            (Some(source_index), Some(target_index))
                if index_structure_changed(source_index, target_index) =>
            {
                let replacement = create_index_sql(
                    kind,
                    source_schema,
                    target_schema,
                    &source.name,
                    source_index,
                );
                let comment_requires_review = source_index
                    .comment
                    .as_deref()
                    .is_some_and(|comment| !comment.trim().is_empty());
                let can_rebuild = replacement.is_ok() && !comment_requires_review;
                if comment_requires_review {
                    warnings.push(format!(
                        "Index {}.{} has a comment that requires a product-specific semantic migration.",
                        source.name, index_name
                    ));
                }
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
                    Ok(_) if comment_requires_review => Vec::new(),
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
            (Some(source_index), Some(target_index))
                if source_index.comment != target_index.comment =>
            {
                changes.push(metadata_only_change(
                    SchemaChangeKind::IndexModify,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(index_name.to_string()),
                    format!("Index {} comment changed", index_name),
                ));
            }
            _ => {}
        }
    }
}

pub(super) fn compare_constraints(
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
                let sql = add_constraint_sql(
                    kind,
                    source_schema,
                    target_schema,
                    &source.name,
                    source_constraint,
                );
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
                let add_sql = add_constraint_sql(
                    kind,
                    source_schema,
                    target_schema,
                    &source.name,
                    source_constraint,
                );
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
