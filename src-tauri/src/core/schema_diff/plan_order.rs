use super::ddl::is_foreign_constraint;
use super::plan_model::{
    block_change, column_by_name, constraint_by_name, index_by_name,
    is_materialized_view_dependent_drop, relation_by_name,
};
use super::preflight::build_preflight_checks;
use super::render::relation_flags;
use super::types::{
    SchemaChange, SchemaChangeKind, SchemaChangePhase, SchemaPreflightCheck, SchemaSnapshot,
};
use crate::core::dialect::DatabaseKind;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn finalize_change_plan(
    kind: DatabaseKind,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    mut changes: Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) -> (Vec<SchemaChange>, Vec<SchemaPreflightCheck>) {
    for change in &mut changes {
        if change.sql.is_empty() && change.blocked_reason.is_none() {
            change.blocked_reason =
                Some("No complete executable definition is available for this change.".to_string());
        }
    }

    let relation_creates = change_id_map(&changes, SchemaChangeKind::RelationCreate);
    let sequence_creates = changes
        .iter()
        .filter(|change| {
            change.kind == SchemaChangeKind::SchemaObjectCreate
                && change
                    .object_type
                    .as_deref()
                    .is_some_and(|object_type| object_type.eq_ignore_ascii_case("sequence"))
                && !change.sql.is_empty()
        })
        .map(|change| (change.relation_name.clone(), change.id.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut routine_create_candidates = BTreeMap::<String, Vec<String>>::new();
    for change in changes
        .iter()
        .filter(|change| change.kind == SchemaChangeKind::RoutineCreate)
    {
        routine_create_candidates
            .entry(change.relation_name.clone())
            .or_default()
            .push(change.id.clone());
    }
    let routine_creates = routine_create_candidates
        .into_iter()
        .filter_map(|(name, ids)| (ids.len() == 1).then(|| (name, ids[0].clone())))
        .collect::<BTreeMap<_, _>>();
    let constraint_drops = child_change_id_map(&changes, SchemaChangeKind::ConstraintDrop);
    let index_drops = child_change_id_map(&changes, SchemaChangeKind::IndexDrop);
    let column_adds = child_change_id_map(&changes, SchemaChangeKind::ColumnAdd);
    let relation_definition_changes = changes
        .iter()
        .filter(|change| {
            change.kind == SchemaChangeKind::RelationCreate
                || (change.kind == SchemaChangeKind::RelationModify
                    && relation_flags(change.object_type.as_deref()).is_view)
        })
        .map(|change| (change.relation_name.clone(), change.id.clone()))
        .collect::<BTreeMap<_, _>>();
    let materialized_view_dependent_drops = changes
        .iter()
        .filter(|change| is_materialized_view_dependent_drop(change))
        .map(|change| (change.relation_name.clone(), change.id.clone()))
        .collect::<BTreeMap<_, _>>();

    for change in &mut changes {
        let mut dependencies = Vec::new();
        match change.kind {
            SchemaChangeKind::RelationCreate | SchemaChangeKind::ColumnAdd => {
                if let Some(relation) = relation_by_name(source, &change.relation_name) {
                    for sequence in &relation.sequence_dependencies {
                        add_dependency(&mut dependencies, sequence_creates.get(sequence));
                    }
                }
            }
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
                if is_materialized_view_dependent_drop(change) {
                    for dependent in target.relations.iter().filter(|relation| {
                        let flags = relation_flags(relation.object_type.as_deref());
                        flags.is_view
                            && !flags.is_materialized_view
                            && relation
                                .dependencies
                                .iter()
                                .any(|dependency| dependency == &change.relation_name)
                    }) {
                        add_dependency(
                            &mut dependencies,
                            materialized_view_dependent_drops.get(&dependent.name),
                        );
                    }
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
                if let Some(relation) = relation_by_name(source, &change.relation_name) {
                    for sequence in &relation.sequence_dependencies {
                        add_dependency(&mut dependencies, sequence_creates.get(sequence));
                    }
                }
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
            SchemaChangeKind::RelationModify => {
                if relation_by_name(source, &change.relation_name).is_some_and(|relation| {
                    relation_flags(relation.object_type.as_deref()).is_materialized_view
                }) {
                    for dependent in target.relations.iter().filter(|relation| {
                        let flags = relation_flags(relation.object_type.as_deref());
                        flags.is_view
                            && !flags.is_materialized_view
                            && relation
                                .dependencies
                                .iter()
                                .any(|dependency| dependency == &change.relation_name)
                    }) {
                        if let Some(dependency) =
                            materialized_view_dependent_drops.get(&dependent.name)
                        {
                            dependencies.push(dependency.clone());
                        }
                    }
                }
            }
            _ => {}
        }
        if change.kind == SchemaChangeKind::SchemaObjectCreate
            && change
                .object_type
                .as_deref()
                .is_some_and(|object_type| object_type.eq_ignore_ascii_case("trigger"))
        {
            if let Some(object) = source.schema_objects.iter().find(|object| {
                object.name == change.relation_name
                    && object.object_type.eq_ignore_ascii_case("trigger")
                    && object.parent_name == change.child_name
            }) {
                for routine in &object.dependencies {
                    add_dependency(&mut dependencies, routine_creates.get(routine));
                }
            }
        }
        if change.kind == SchemaChangeKind::SchemaObjectModify
            && change
                .object_type
                .as_deref()
                .is_some_and(|object_type| object_type.eq_ignore_ascii_case("sequence"))
            && change.child_name.as_deref() == Some("ownership/state")
        {
            add_dependency(
                &mut dependencies,
                sequence_creates.get(&change.relation_name),
            );
            if let Some(owner_table) = source
                .schema_objects
                .iter()
                .find(|object| {
                    object.name == change.relation_name
                        && object.object_type.eq_ignore_ascii_case("sequence")
                })
                .and_then(|object| object.sequence_owner.as_ref())
                .map(|owner| owner.table_name.as_str())
            {
                add_dependency(&mut dependencies, relation_creates.get(owner_table));
            }
        }
        let is_view_definition_change = change.kind == SchemaChangeKind::RelationCreate
            || (change.kind == SchemaChangeKind::RelationModify
                && relation_flags(change.object_type.as_deref()).is_view);
        if is_view_definition_change {
            if let Some(relation) = relation_by_name(source, &change.relation_name) {
                if relation_flags(relation.object_type.as_deref()).is_view {
                    for prerequisite in &relation.dependencies {
                        if let Some(dependency) = relation_definition_changes.get(prerequisite) {
                            if dependency != &change.id {
                                dependencies.push(dependency.clone());
                            }
                        }
                    }
                }
            }
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

pub(super) fn change_id_map(
    changes: &[SchemaChange],
    kind: SchemaChangeKind,
) -> BTreeMap<String, String> {
    changes
        .iter()
        .filter(|change| change.kind == kind)
        .map(|change| (change.relation_name.clone(), change.id.clone()))
        .collect()
}

pub(super) fn child_change_id_map(
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

pub(super) fn child_key(relation_name: &str, child_name: &str) -> String {
    format!("{relation_name}\0{child_name}")
}

pub(super) fn add_dependency(dependencies: &mut Vec<String>, dependency: Option<&String>) {
    if let Some(dependency) = dependency {
        dependencies.push(dependency.clone());
    }
}

pub(super) fn propagate_blocked_dependencies(
    changes: &mut [SchemaChange],
    warnings: &mut Vec<String>,
) {
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

pub(super) fn topologically_order_changes(
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
        let id = key.5;
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

pub(super) fn owned_change_sort_key(
    change: &SchemaChange,
) -> (
    SchemaChangePhase,
    u8,
    String,
    String,
    SchemaChangeKind,
    String,
) {
    (
        change.phase,
        manual_review_object_rank(change),
        change.relation_name.clone(),
        change.child_name.clone().unwrap_or_default(),
        change.kind,
        change.id.clone(),
    )
}

/// Keep catalog-backed schema-object creation in the same conservative order
/// used by DBX transfer: routines are available before triggers are created.
/// Exact dependencies still need catalog evidence; this rank only resolves
/// otherwise-independent review-gated changes deterministically.
pub(super) fn manual_review_object_rank(change: &SchemaChange) -> u8 {
    match change.kind {
        SchemaChangeKind::RoutineCreate | SchemaChangeKind::RoutineModify => 0,
        SchemaChangeKind::SchemaObjectCreate | SchemaChangeKind::SchemaObjectModify
            if change
                .object_type
                .as_deref()
                .is_some_and(|object_type| object_type.eq_ignore_ascii_case("trigger")) =>
        {
            1
        }
        _ => 2,
    }
}
