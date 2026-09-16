use super::plan_model::change;
use super::types::{
    SchemaChange, SchemaChangeKind, SchemaChangePhase, SchemaChangeRisk, SchemaRelationSnapshot,
};
use std::collections::BTreeMap;

pub(super) fn compare_metadata_children(
    schema_name: &str,
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
    changes: &mut Vec<SchemaChange>,
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
    let mut column_names = source_columns
        .keys()
        .chain(target_columns.keys())
        .copied()
        .collect::<Vec<_>>();
    column_names.sort();
    column_names.dedup();
    for column_name in column_names {
        let (kind, summary) = match (
            source_columns.get(column_name),
            target_columns.get(column_name),
        ) {
            (Some(_), None) => (
                SchemaChangeKind::ColumnAdd,
                format!("Field {column_name} is missing from live metadata"),
            ),
            (None, Some(_)) => (
                SchemaChangeKind::ColumnDrop,
                format!("Live field {column_name} is absent from the snapshot"),
            ),
            (Some(source_column), Some(target_column)) if source_column != target_column => (
                SchemaChangeKind::ColumnModify,
                format!("Field {column_name} metadata changed"),
            ),
            _ => continue,
        };
        changes.push(metadata_only_change(
            kind,
            schema_name,
            &source.name,
            source.object_type.clone(),
            Some(column_name.to_string()),
            summary,
        ));
    }

    // A number of engines expose the backing index for a primary/unique
    // constraint in both metadata collections. Mirror the native planner's
    // view so a read-only diff explains the logical constraint once instead
    // of reporting a duplicate index change as well.
    let source_constraint_names = source
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<std::collections::HashSet<_>>();
    let target_constraint_names = target
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<std::collections::HashSet<_>>();
    let source_indexes = source
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !source_constraint_names.contains(index.name.as_str()))
        .map(|index| (index.name.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let target_indexes = target
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !target_constraint_names.contains(index.name.as_str()))
        .map(|index| (index.name.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let mut index_names = source_indexes
        .keys()
        .chain(target_indexes.keys())
        .copied()
        .collect::<Vec<_>>();
    index_names.sort();
    index_names.dedup();
    for index_name in index_names {
        let (kind, summary) = match (
            source_indexes.get(index_name),
            target_indexes.get(index_name),
        ) {
            (Some(_), None) => (
                SchemaChangeKind::IndexAdd,
                format!("Index {index_name} is missing from live metadata"),
            ),
            (None, Some(_)) => (
                SchemaChangeKind::IndexDrop,
                format!("Live index {index_name} is absent from the snapshot"),
            ),
            (Some(source_index), Some(target_index)) if source_index != target_index => (
                SchemaChangeKind::IndexModify,
                format!("Index {index_name} metadata changed"),
            ),
            _ => continue,
        };
        changes.push(metadata_only_change(
            kind,
            schema_name,
            &source.name,
            source.object_type.clone(),
            Some(index_name.to_string()),
            summary,
        ));
    }

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
    let mut constraint_names = source_constraints
        .keys()
        .chain(target_constraints.keys())
        .copied()
        .collect::<Vec<_>>();
    constraint_names.sort();
    constraint_names.dedup();
    for constraint_name in constraint_names {
        let (kind, summary) = match (
            source_constraints.get(constraint_name),
            target_constraints.get(constraint_name),
        ) {
            (Some(_), None) => (
                SchemaChangeKind::ConstraintAdd,
                format!("Constraint {constraint_name} is missing from live metadata"),
            ),
            (None, Some(_)) => (
                SchemaChangeKind::ConstraintDrop,
                format!("Live constraint {constraint_name} is absent from the snapshot"),
            ),
            (Some(source_constraint), Some(target_constraint))
                if source_constraint != target_constraint =>
            {
                (
                    SchemaChangeKind::ConstraintModify,
                    format!("Constraint {constraint_name} metadata changed"),
                )
            }
            _ => continue,
        };
        changes.push(metadata_only_change(
            kind,
            schema_name,
            &source.name,
            source.object_type.clone(),
            Some(constraint_name.to_string()),
            summary,
        ));
    }
}

pub(super) fn metadata_only_change(
    kind: SchemaChangeKind,
    schema_name: &str,
    relation_name: &str,
    object_type: Option<String>,
    child_name: Option<String>,
    summary: String,
) -> SchemaChange {
    let mut change = change(
        kind,
        SchemaChangeRisk::Review,
        schema_name,
        relation_name,
        object_type,
        child_name,
        summary,
        Vec::new(),
        false,
        true,
    );
    change.phase = SchemaChangePhase::ManualReview;
    change.blocked_reason =
        Some("Automatic migration is unavailable for this metadata-only comparison.".to_string());
    change
}
