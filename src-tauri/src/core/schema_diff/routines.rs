use super::plan_model::change;
use super::postgres_refs::rewrite_postgres_schema_qualified_references;
use super::types::{
    SchemaChange, SchemaChangeKind, SchemaChangePhase, SchemaChangeRisk, SchemaNameMapping,
    SchemaRoutineSnapshot,
};
use crate::core::dialect::DatabaseKind;
use std::collections::BTreeMap;

pub(super) fn routine_map(
    routines: &[SchemaRoutineSnapshot],
) -> BTreeMap<String, &SchemaRoutineSnapshot> {
    routines
        .iter()
        .map(|routine| (routine_identity(routine), routine))
        .collect()
}

/// Use the executable signature as the identity so overloaded routines remain
/// distinct. Parameter names are intentionally excluded: a rename can be
/// reviewed as a modification, while a type/arity change becomes drop/create.
pub(super) fn routine_identity(routine: &SchemaRoutineSnapshot) -> String {
    format!(
        "{}:{}({})",
        routine
            .routine_type
            .as_deref()
            .unwrap_or("FUNCTION")
            .to_ascii_uppercase(),
        routine.name,
        routine
            .parameters
            .iter()
            .map(|parameter| parameter.data_type.to_ascii_lowercase())
            .collect::<Vec<_>>()
            .join(","),
    )
}

pub(super) fn routine_label(routine: &SchemaRoutineSnapshot) -> String {
    format!(
        "{}({})",
        routine.name,
        routine
            .parameters
            .iter()
            .map(|parameter| parameter.data_type.as_str())
            .collect::<Vec<_>>()
            .join(", "),
    )
}

pub(super) fn routine_object_type(routine: &SchemaRoutineSnapshot) -> Option<String> {
    Some(
        routine
            .routine_type
            .as_deref()
            .unwrap_or("FUNCTION")
            .to_ascii_uppercase(),
    )
}

pub(super) fn routine_review_change(
    kind: SchemaChangeKind,
    schema_name: &str,
    routine: &SchemaRoutineSnapshot,
    summary: String,
) -> SchemaChange {
    let mut change = change(
        kind,
        SchemaChangeRisk::Review,
        schema_name,
        &routine.name,
        routine_object_type(routine),
        Some(routine_label(routine)),
        summary,
        Vec::new(),
        false,
        true,
    );
    change.phase = SchemaChangePhase::ManualReview;
    change.blocked_reason = Some(
        "Routine bodies and executable DDL are intentionally excluded from schema snapshots; review and apply this change manually."
            .to_string(),
    );
    change
}

pub(super) fn routine_review_change_with_definition(
    kind: SchemaChangeKind,
    database_kind: Option<DatabaseKind>,
    source_schema: &str,
    target_schema: &str,
    schema_name: &str,
    routine: &SchemaRoutineSnapshot,
    summary: String,
) -> SchemaChange {
    let definition = routine
        .definition
        .as_deref()
        .map(str::trim)
        .filter(|definition| !definition.is_empty());
    // pg_get_functiondef produces CREATE OR REPLACE FUNCTION/PROCEDURE DDL.
    // Do not accept an arbitrary definition from a persisted snapshot: only
    // a native PostgreSQL plan may expose it, and it remains review-gated.
    let executable_definition = match (database_kind, definition) {
        (Some(DatabaseKind::Postgres), Some(definition))
            if definition
                .to_ascii_uppercase()
                .starts_with("CREATE OR REPLACE ") =>
        {
            Some(rewrite_postgres_schema_qualified_references(
                definition,
                source_schema,
                target_schema,
            ))
        }
        _ => None,
    };
    let mut change = change(
        kind,
        SchemaChangeRisk::Review,
        schema_name,
        &routine.name,
        routine_object_type(routine),
        Some(routine_label(routine)),
        summary,
        executable_definition.into_iter().collect(),
        false,
        true,
    );
    if change.sql.is_empty() {
        change.phase = SchemaChangePhase::ManualReview;
        change.blocked_reason = Some(
            "Routine source/DDL is unavailable or is not a reviewed native PostgreSQL create-or-replace definition."
                .to_string(),
        );
    }
    change
}

pub(super) fn compare_routines(
    database_kind: Option<DatabaseKind>,
    schema_mapping: SchemaNameMapping<'_>,
    source: &[SchemaRoutineSnapshot],
    target: &[SchemaRoutineSnapshot],
    schema_name: &str,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_routines = routine_map(source);
    let target_routines = routine_map(target);
    let mut identities = source_routines
        .keys()
        .chain(target_routines.keys())
        .cloned()
        .collect::<Vec<_>>();
    identities.sort();
    identities.dedup();

    let change_start = changes.len();
    for identity in identities {
        match (
            source_routines.get(&identity),
            target_routines.get(&identity),
        ) {
            (Some(source_routine), None) => changes.push(routine_review_change_with_definition(
                SchemaChangeKind::RoutineCreate,
                database_kind,
                schema_mapping.source,
                schema_mapping.target,
                schema_name,
                source_routine,
                format!(
                    "Review creation of routine {}",
                    routine_label(source_routine)
                ),
            )),
            (None, Some(target_routine)) => changes.push(routine_review_change(
                SchemaChangeKind::RoutineDrop,
                schema_name,
                target_routine,
                format!(
                    "Review removal of routine {}",
                    routine_label(target_routine)
                ),
            )),
            (Some(source_routine), Some(target_routine)) if source_routine != target_routine => {
                changes.push(routine_review_change_with_definition(
                    SchemaChangeKind::RoutineModify,
                    database_kind,
                    schema_mapping.source,
                    schema_mapping.target,
                    schema_name,
                    source_routine,
                    format!("Review changed routine {}", routine_label(source_routine)),
                ));
            }
            _ => {}
        }
    }
    if changes.len() > change_start {
        let catalog_backed = source.iter().any(|routine| {
            routine
                .definition
                .as_deref()
                .is_some_and(|definition| !definition.trim().is_empty())
        });
        warnings.push(if catalog_backed && database_kind == Some(DatabaseKind::Postgres) {
            "PostgreSQL catalog routine DDL is included only for create-or-replace review; routine removal remains blocked."
                .to_string()
        } else {
            "Routine signature drift is review-only: routine bodies and automatic routine DDL are intentionally unavailable."
                .to_string()
        });
    }
}
