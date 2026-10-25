use super::types::{
    SchemaChange, SchemaChangeKind, SchemaChangePhase, SchemaChangeRisk, SchemaObjectSnapshot,
    SchemaRelationSnapshot, SchemaRoutineSnapshot, SchemaSnapshot,
};
use crate::core::protocol::{ColumnInfo, ConstraintInfo, IndexInfo};
use anyhow::Result;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub(super) fn relation_map(
    relations: &[SchemaRelationSnapshot],
) -> BTreeMap<String, &SchemaRelationSnapshot> {
    relations
        .iter()
        .map(|relation| (relation.name.clone(), relation))
        .collect()
}

pub(super) fn snapshot_fingerprint(snapshot: &SchemaSnapshot) -> Result<String> {
    // Stored v1 snapshots did not include routines or descriptor-only schema
    // objects. Keep their established fingerprint shape when both are absent.
    let payload = if snapshot.routines.is_empty() && snapshot.schema_objects.is_empty() {
        serde_json::to_vec(&(
            snapshot.version,
            &snapshot.driver,
            &snapshot.database_name,
            &snapshot.schema_name,
            &snapshot.relations,
        ))?
    } else {
        serde_json::to_vec(&(
            snapshot.version,
            &snapshot.driver,
            &snapshot.database_name,
            &snapshot.schema_name,
            &snapshot.relations,
            &snapshot.routines,
            &snapshot.schema_objects,
        ))?
    };
    Ok(hex_digest(&payload))
}

pub(super) fn routine_sort_key(routine: &SchemaRoutineSnapshot) -> String {
    format!(
        "{}:{}:{}:{}",
        routine.routine_type.as_deref().unwrap_or_default(),
        routine.name,
        routine
            .parameters
            .iter()
            .map(|parameter| format!(
                "{}:{}:{}:{}",
                parameter.name,
                parameter.data_type,
                parameter.optional,
                parameter.mode.as_deref().unwrap_or_default()
            ))
            .collect::<Vec<_>>()
            .join(","),
        routine.return_type,
    )
}

pub(super) fn schema_object_sort_key(object: &SchemaObjectSnapshot) -> String {
    format!(
        "{}:{}:{}:{}",
        object.object_type,
        object.name,
        object.parent_name.as_deref().unwrap_or_default(),
        object.description.as_deref().unwrap_or_default(),
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn change(
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

pub(super) fn phase_for_kind(kind: SchemaChangeKind) -> SchemaChangePhase {
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
        SchemaChangeKind::RoutineCreate
        | SchemaChangeKind::RoutineDrop
        | SchemaChangeKind::RoutineModify
        | SchemaChangeKind::SchemaObjectCreate
        | SchemaChangeKind::SchemaObjectDrop
        | SchemaChangeKind::SchemaObjectModify => SchemaChangePhase::ManualReview,
    }
}

pub(super) fn stable_id(prefix: &str, value: &str) -> String {
    format!("{prefix}-{}", &hex_digest(value.as_bytes())[..16])
}

pub(super) fn hex_digest(value: &[u8]) -> String {
    let digest = Sha256::digest(value);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) fn block_change(change: &mut SchemaChange, reason: String, warnings: &mut Vec<String>) {
    warnings.push(format!("{}: {reason}", change.summary));
    change.blocked_reason = Some(reason);
    change.sql.clear();
    change.manual_review = true;
}

pub(super) fn relation_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
) -> Option<&'a SchemaRelationSnapshot> {
    snapshot
        .relations
        .iter()
        .find(|relation| relation.name == relation_name)
}

pub(super) fn column_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
    column_name: &str,
) -> Option<&'a ColumnInfo> {
    relation_by_name(snapshot, relation_name)?
        .columns
        .iter()
        .find(|column| column.name == column_name)
}

pub(super) fn constraint_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
    constraint_name: &str,
) -> Option<&'a ConstraintInfo> {
    relation_by_name(snapshot, relation_name)?
        .constraints
        .iter()
        .find(|constraint| constraint.name == constraint_name)
}

pub(super) fn index_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
    index_name: &str,
) -> Option<&'a IndexInfo> {
    relation_by_name(snapshot, relation_name)?
        .indexes
        .iter()
        .find(|index| index.name == index_name)
}

pub(super) const MATERIALIZED_VIEW_DEPENDENT_DROP_PREFIX: &str = "Temporarily drop dependent view ";

pub(super) const MATERIALIZED_VIEW_DEPENDENT_RECREATE_PREFIX: &str = "Recreate dependent view ";

pub(super) fn is_materialized_view_dependent_drop(change: &SchemaChange) -> bool {
    change.kind == SchemaChangeKind::RelationDrop
        && change
            .summary
            .starts_with(MATERIALIZED_VIEW_DEPENDENT_DROP_PREFIX)
}
