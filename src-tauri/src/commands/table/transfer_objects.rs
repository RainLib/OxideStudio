//! Transfer objects for table operations.

use super::reports::current_table_timestamp_millis;
use super::transfer_batch_plan::empty_transfer_context_snapshot;
use super::transfer_types::{
    TableDataTransferBatchPlanRequest, TableDataTransferObjectAction, TableDataTransferObjectKind,
    TableDataTransferObjectPreflight, TableDataTransferObjectResult,
    TableDataTransferObjectSelection,
};
use crate::commands::schema_diff::capture_schema_snapshot_inner;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ParameterizedStatement;
use crate::core::schema_diff::compare_schema_snapshots;
use crate::core::schema_diff::finalize_schema_snapshot;
use crate::core::schema_diff::SchemaChange;
use crate::core::schema_diff::SchemaChangeKind;
use crate::core::schema_diff::SchemaDiffPlan;
use crate::core::schema_diff::SchemaObjectSnapshot;
use crate::core::schema_diff::SchemaRelationSnapshot;
use crate::core::schema_diff::SchemaRoutineSnapshot;
use crate::core::schema_diff::SchemaSnapshot;
use sha2::Digest;
use sha2::Sha256;
use std::collections::BTreeSet;
use std::collections::HashSet;

pub(super) const MAX_TABLE_DATA_TRANSFER_BATCH_TABLES: usize = 100;

pub(super) const MAX_TABLE_DATA_TRANSFER_BATCH_OBJECTS: usize = 200;

#[derive(Debug, Clone)]
pub(super) struct ResolvedTableDataTransferObjectPlan {
    pub(super) preflights: Vec<TableDataTransferObjectPreflight>,
    pub(super) statements: Vec<ParameterizedStatement>,
    pub(super) results: Vec<TableDataTransferObjectResult>,
}

pub(super) fn table_data_transfer_object_kind_label(
    kind: TableDataTransferObjectKind,
) -> &'static str {
    match kind {
        TableDataTransferObjectKind::View => "VIEW",
        TableDataTransferObjectKind::MaterializedView => "MATERIALIZED_VIEW",
        TableDataTransferObjectKind::Function => "FUNCTION",
        TableDataTransferObjectKind::Procedure => "PROCEDURE",
        TableDataTransferObjectKind::Trigger => "TRIGGER",
        TableDataTransferObjectKind::Sequence => "SEQUENCE",
        TableDataTransferObjectKind::Event => "EVENT",
    }
}

pub(super) fn normalized_table_data_transfer_objects(
    objects: &[TableDataTransferObjectSelection],
) -> Result<Vec<TableDataTransferObjectSelection>, String> {
    if objects.len() > MAX_TABLE_DATA_TRANSFER_BATCH_OBJECTS {
        return Err(format!(
            "Select at most {MAX_TABLE_DATA_TRANSFER_BATCH_OBJECTS} schema objects for one transfer plan."
        ));
    }
    let mut normalized = Vec::with_capacity(objects.len());
    let mut seen = HashSet::new();
    for object in objects {
        let name = object.name.trim();
        if name.is_empty() || name.len() > 256 || name.chars().any(char::is_control) {
            return Err("Schema object names must be non-empty bounded identifiers.".to_string());
        }
        let parent_name = object
            .parent_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        if parent_name
            .as_deref()
            .is_some_and(|value| value.len() > 256 || value.chars().any(char::is_control))
        {
            return Err("Schema object parent names must be bounded identifiers.".to_string());
        }
        let key = format!(
            "{}:{}:{}",
            table_data_transfer_object_kind_label(object.object_type),
            parent_name
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase(),
            name.to_ascii_lowercase(),
        );
        if !seen.insert(key) {
            return Err(format!(
                "Schema object selection contains duplicate {} {}.",
                table_data_transfer_object_kind_label(object.object_type),
                name
            ));
        }
        normalized.push(TableDataTransferObjectSelection {
            object_type: object.object_type,
            name: name.to_string(),
            parent_name,
        });
    }
    normalized.sort_by(|left, right| {
        (
            table_data_transfer_object_kind_label(left.object_type),
            left.parent_name.as_deref().unwrap_or_default(),
            left.name.as_str(),
        )
            .cmp(&(
                table_data_transfer_object_kind_label(right.object_type),
                right.parent_name.as_deref().unwrap_or_default(),
                right.name.as_str(),
            ))
    });
    Ok(normalized)
}

pub(super) fn relation_matches_transfer_object(
    relation: &SchemaRelationSnapshot,
    selection: &TableDataTransferObjectSelection,
) -> bool {
    if !relation.name.eq_ignore_ascii_case(&selection.name) {
        return false;
    }
    let object_type = relation
        .object_type
        .as_deref()
        .unwrap_or_default()
        .to_ascii_uppercase();
    match selection.object_type {
        TableDataTransferObjectKind::View => {
            object_type.contains("VIEW") && !object_type.contains("MATERIALIZED")
        }
        TableDataTransferObjectKind::MaterializedView => {
            object_type.contains("MATERIALIZED") && object_type.contains("VIEW")
        }
        _ => false,
    }
}

pub(super) fn routine_matches_transfer_object(
    routine: &SchemaRoutineSnapshot,
    selection: &TableDataTransferObjectSelection,
) -> bool {
    if !routine.name.eq_ignore_ascii_case(&selection.name) {
        return false;
    }
    let routine_type = routine.routine_type.as_deref().unwrap_or("function").trim();
    match selection.object_type {
        TableDataTransferObjectKind::Function => routine_type.eq_ignore_ascii_case("function"),
        TableDataTransferObjectKind::Procedure => routine_type.eq_ignore_ascii_case("procedure"),
        _ => false,
    }
}

pub(super) fn schema_object_matches_transfer_object(
    object: &SchemaObjectSnapshot,
    selection: &TableDataTransferObjectSelection,
) -> bool {
    object.name.eq_ignore_ascii_case(&selection.name)
        && object
            .object_type
            .eq_ignore_ascii_case(table_data_transfer_object_kind_label(selection.object_type))
        && selection.parent_name.as_deref().is_none_or(|parent| {
            object
                .parent_name
                .as_deref()
                .is_some_and(|candidate| candidate.eq_ignore_ascii_case(parent))
        })
}

pub(super) fn transfer_object_exists_in_snapshot(
    snapshot: &SchemaSnapshot,
    selection: &TableDataTransferObjectSelection,
) -> bool {
    snapshot
        .relations
        .iter()
        .any(|relation| relation_matches_transfer_object(relation, selection))
        || snapshot
            .routines
            .iter()
            .any(|routine| routine_matches_transfer_object(routine, selection))
        || snapshot
            .schema_objects
            .iter()
            .any(|object| schema_object_matches_transfer_object(object, selection))
}

pub(super) fn transfer_object_change_matches(
    selection: &TableDataTransferObjectSelection,
    change: &SchemaChange,
) -> bool {
    if !change.relation_name.eq_ignore_ascii_case(&selection.name) {
        return false;
    }
    match selection.object_type {
        TableDataTransferObjectKind::View | TableDataTransferObjectKind::MaterializedView => {
            if change.kind == SchemaChangeKind::RelationCreate {
                change.object_type.as_deref().is_some_and(|object_type| {
                    let relation = SchemaRelationSnapshot {
                        name: selection.name.clone(),
                        object_type: Some(object_type.to_string()),
                        comment: None,
                        definition: None,
                        materialized_view_populated: None,
                        dependencies: Vec::new(),
                        external_dependencies: Vec::new(),
                        sequence_dependencies: Vec::new(),
                        columns: Vec::new(),
                        indexes: Vec::new(),
                        constraints: Vec::new(),
                    };
                    relation_matches_transfer_object(&relation, selection)
                })
            } else {
                matches!(
                    change.kind,
                    SchemaChangeKind::ColumnAdd
                        | SchemaChangeKind::IndexAdd
                        | SchemaChangeKind::ConstraintAdd
                )
            }
        }
        TableDataTransferObjectKind::Function | TableDataTransferObjectKind::Procedure => {
            change.kind == SchemaChangeKind::RoutineCreate
                && change.object_type.as_deref().is_some_and(|object_type| {
                    match selection.object_type {
                        TableDataTransferObjectKind::Function => {
                            object_type.eq_ignore_ascii_case("function")
                        }
                        TableDataTransferObjectKind::Procedure => {
                            object_type.eq_ignore_ascii_case("procedure")
                        }
                        _ => false,
                    }
                })
        }
        _ => {
            matches!(
                change.kind,
                SchemaChangeKind::SchemaObjectCreate | SchemaChangeKind::SchemaObjectModify
            ) && change.object_type.as_deref().is_some_and(|object_type| {
                object_type.eq_ignore_ascii_case(table_data_transfer_object_kind_label(
                    selection.object_type,
                ))
            }) && (selection.parent_name.is_none()
                || change.child_name == selection.parent_name
                || change.child_name.as_deref() == Some("ownership/state"))
        }
    }
}

pub(super) fn empty_transfer_snapshot_like(
    snapshot: &SchemaSnapshot,
) -> Result<SchemaSnapshot, String> {
    let mut snapshot = snapshot.clone();
    snapshot.id.clear();
    snapshot.fingerprint.clear();
    snapshot.relations.clear();
    snapshot.routines.clear();
    snapshot.schema_objects.clear();
    snapshot.warnings.clear();
    finalize_schema_snapshot(snapshot).map_err(|error| error.to_string())
}

pub(super) fn transfer_object_plan_digest(
    selection: &TableDataTransferObjectSelection,
    statements: &[String],
    depends_on: &[String],
) -> Result<String, String> {
    let payload = serde_json::to_vec(&(selection, statements, depends_on))
        .map_err(|error| format!("Could not bind schema object plan: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(payload)))
}

pub(super) fn snapshot_has_relation(snapshot: &SchemaSnapshot, name: &str) -> bool {
    snapshot
        .relations
        .iter()
        .any(|relation| relation.name.eq_ignore_ascii_case(name))
}

pub(super) fn snapshot_has_routine(snapshot: &SchemaSnapshot, name: &str) -> bool {
    snapshot
        .routines
        .iter()
        .any(|routine| routine.name.eq_ignore_ascii_case(name))
}

pub(super) fn snapshot_has_sequence(snapshot: &SchemaSnapshot, name: &str) -> bool {
    snapshot.schema_objects.iter().any(|object| {
        object.object_type.eq_ignore_ascii_case("sequence")
            && object.name.eq_ignore_ascii_case(name)
    })
}

pub(super) fn selected_transfer_object(
    selections: &[TableDataTransferObjectSelection],
    kind: TableDataTransferObjectKind,
    name: &str,
) -> bool {
    selections
        .iter()
        .any(|selection| selection.object_type == kind && selection.name.eq_ignore_ascii_case(name))
}

pub(super) fn transfer_object_dependency_review(
    relations: &[SchemaRelationSnapshot],
    schema_objects: &[SchemaObjectSnapshot],
    target: &SchemaSnapshot,
    selections: &[TableDataTransferObjectSelection],
) -> (Vec<String>, Vec<String>) {
    let mut dependencies = BTreeSet::new();
    let mut blockers = Vec::new();
    for relation in relations {
        for dependency in &relation.dependencies {
            dependencies.insert(format!("RELATION:{dependency}"));
            if !snapshot_has_relation(target, dependency)
                && !selected_transfer_object(
                    selections,
                    TableDataTransferObjectKind::View,
                    dependency,
                )
                && !selected_transfer_object(
                    selections,
                    TableDataTransferObjectKind::MaterializedView,
                    dependency,
                )
            {
                blockers.push(format!(
                    "Required relation {dependency} is not present on the target or selected for transfer."
                ));
            }
        }
        for dependency in &relation.sequence_dependencies {
            dependencies.insert(format!("SEQUENCE:{dependency}"));
            if !snapshot_has_sequence(target, dependency)
                && !selected_transfer_object(
                    selections,
                    TableDataTransferObjectKind::Sequence,
                    dependency,
                )
            {
                blockers.push(format!(
                    "Required sequence {dependency} is not present on the target or selected for transfer."
                ));
            }
        }
        if !relation.external_dependencies.is_empty() {
            dependencies.extend(
                relation
                    .external_dependencies
                    .iter()
                    .map(|dependency| format!("EXTERNAL:{dependency}")),
            );
            blockers.push(format!(
                "External dependencies cannot be proven inside this schema-scoped transfer: {}.",
                relation.external_dependencies.join(", ")
            ));
        }
    }
    for object in schema_objects {
        if let Some(parent) = object.parent_name.as_deref() {
            dependencies.insert(format!("RELATION:{parent}"));
            if !snapshot_has_relation(target, parent) {
                blockers.push(format!(
                    "Parent relation {parent} is not present on the target."
                ));
            }
        }
        for routine in &object.dependencies {
            dependencies.insert(format!("ROUTINE:{routine}"));
            if !snapshot_has_routine(target, routine)
                && !selected_transfer_object(
                    selections,
                    TableDataTransferObjectKind::Function,
                    routine,
                )
                && !selected_transfer_object(
                    selections,
                    TableDataTransferObjectKind::Procedure,
                    routine,
                )
            {
                blockers.push(format!(
                    "Trigger routine {routine} is not present on the target or selected for transfer."
                ));
            }
        }
        if let Some(owner) = object.sequence_owner.as_ref() {
            dependencies.insert(format!("RELATION:{}", owner.table_name));
            if !snapshot_has_relation(target, &owner.table_name) {
                blockers.push(format!(
                    "Sequence owner relation {} is not present on the target.",
                    owner.table_name
                ));
            }
        }
    }
    blockers.sort();
    blockers.dedup();
    (dependencies.into_iter().collect(), blockers)
}

pub(super) fn snapshot_fragment(
    snapshot: &SchemaSnapshot,
    relations: Vec<SchemaRelationSnapshot>,
    routines: Vec<SchemaRoutineSnapshot>,
    schema_objects: Vec<SchemaObjectSnapshot>,
) -> Result<SchemaSnapshot, String> {
    let mut fragment = snapshot.clone();
    fragment.id.clear();
    fragment.fingerprint.clear();
    fragment.relations = relations;
    fragment.routines = routines;
    fragment.schema_objects = schema_objects;
    // Full-snapshot coverage warnings are still useful during review, but
    // they would make otherwise identical selection plans noisy and unstable.
    fragment.warnings.clear();
    finalize_schema_snapshot(fragment).map_err(|error| error.to_string())
}

pub(super) fn blocked_transfer_object_preflight(
    selection: &TableDataTransferObjectSelection,
    warnings: Vec<String>,
) -> TableDataTransferObjectPreflight {
    TableDataTransferObjectPreflight {
        object_type: selection.object_type,
        name: selection.name.clone(),
        parent_name: selection.parent_name.clone(),
        action: TableDataTransferObjectAction::Blocked,
        can_execute: false,
        statements: Vec::new(),
        plan_digest: None,
        depends_on: Vec::new(),
        warnings,
    }
}

pub(super) fn build_table_data_transfer_object_plan(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    selections: &[TableDataTransferObjectSelection],
) -> Result<ResolvedTableDataTransferObjectPlan, String> {
    if selections.is_empty() {
        return Ok(ResolvedTableDataTransferObjectPlan {
            preflights: Vec::new(),
            statements: Vec::new(),
            results: Vec::new(),
        });
    }
    if !source.driver.eq_ignore_ascii_case("postgres")
        || !target.driver.eq_ignore_ascii_case("postgres")
    {
        let preflights = selections
            .iter()
            .map(|selection| {
                blocked_transfer_object_preflight(
                    selection,
                    vec![
                        "Automatic schema-object transfer currently requires native PostgreSQL catalog DDL on both endpoints. Other drivers remain review-only until their exact DDL and transaction policy is verified."
                            .to_string(),
                    ],
                )
            })
            .collect();
        return Ok(ResolvedTableDataTransferObjectPlan {
            preflights,
            statements: Vec::new(),
            results: Vec::new(),
        });
    }

    let mut selected_relations = Vec::new();
    let mut selected_routines = Vec::new();
    let mut selected_schema_objects = Vec::new();
    let mut pending = Vec::<(TableDataTransferObjectSelection, Vec<String>)>::new();
    let mut preflights = Vec::with_capacity(selections.len());
    let mut results = Vec::with_capacity(selections.len());

    for selection in selections {
        let relations = source
            .relations
            .iter()
            .filter(|relation| relation_matches_transfer_object(relation, selection))
            .cloned()
            .collect::<Vec<_>>();
        let routines = source
            .routines
            .iter()
            .filter(|routine| routine_matches_transfer_object(routine, selection))
            .cloned()
            .collect::<Vec<_>>();
        let schema_objects = source
            .schema_objects
            .iter()
            .filter(|object| schema_object_matches_transfer_object(object, selection))
            .cloned()
            .collect::<Vec<_>>();
        let match_count = relations.len() + routines.len() + schema_objects.len();
        if match_count == 0 {
            preflights.push(blocked_transfer_object_preflight(
                selection,
                vec![format!(
                    "The selected {} {} was not found in the fresh source catalog.",
                    table_data_transfer_object_kind_label(selection.object_type),
                    selection.name
                )],
            ));
            continue;
        }
        if routines.is_empty() && match_count > 1 {
            preflights.push(blocked_transfer_object_preflight(
                selection,
                vec![format!(
                    "The selected object identity is ambiguous. Include its parent relation: {} {}.",
                    table_data_transfer_object_kind_label(selection.object_type),
                    selection.name
                )],
            ));
            continue;
        }
        if transfer_object_exists_in_snapshot(target, selection) {
            preflights.push(TableDataTransferObjectPreflight {
                object_type: selection.object_type,
                name: selection.name.clone(),
                parent_name: selection.parent_name.clone(),
                action: TableDataTransferObjectAction::SkipExisting,
                can_execute: true,
                statements: Vec::new(),
                plan_digest: None,
                depends_on: Vec::new(),
                warnings: vec![
                    "An object with this catalog identity already exists on the target and will not be replaced."
                        .to_string(),
                ],
            });
            results.push(TableDataTransferObjectResult {
                object_type: selection.object_type,
                name: selection.name.clone(),
                parent_name: selection.parent_name.clone(),
                action: TableDataTransferObjectAction::SkipExisting,
                report_id: None,
            });
            continue;
        }
        let (depends_on, blockers) =
            transfer_object_dependency_review(&relations, &schema_objects, target, selections);
        if !blockers.is_empty() {
            let mut preflight = blocked_transfer_object_preflight(selection, blockers);
            preflight.depends_on = depends_on;
            preflights.push(preflight);
            continue;
        }
        selected_relations.extend(relations);
        selected_routines.extend(routines);
        selected_schema_objects.extend(schema_objects);
        pending.push((selection.clone(), depends_on));
    }

    if pending.is_empty() {
        return Ok(ResolvedTableDataTransferObjectPlan {
            preflights,
            statements: Vec::new(),
            results,
        });
    }
    let source_fragment = snapshot_fragment(
        source,
        selected_relations,
        selected_routines,
        selected_schema_objects,
    )?;
    let target_fragment = empty_transfer_snapshot_like(target)?;
    let schema_plan = compare_schema_snapshots(
        &source_fragment,
        &target_fragment,
        current_table_timestamp_millis(),
    )
    .map_err(|error| format!("Could not build selected schema-object plan: {error}"))?;
    append_transfer_object_plan(&schema_plan, pending, &mut preflights, &mut results)?;
    let statements = preflights
        .iter()
        .filter(|preflight| preflight.action == TableDataTransferObjectAction::Create)
        .flat_map(|preflight| preflight.statements.iter())
        .map(|sql| ParameterizedStatement {
            sql: sql.clone(),
            params: Vec::new(),
        })
        .collect();
    Ok(ResolvedTableDataTransferObjectPlan {
        preflights,
        statements,
        results,
    })
}

pub(super) fn append_transfer_object_plan(
    schema_plan: &SchemaDiffPlan,
    pending: Vec<(TableDataTransferObjectSelection, Vec<String>)>,
    preflights: &mut Vec<TableDataTransferObjectPreflight>,
    results: &mut Vec<TableDataTransferObjectResult>,
) -> Result<(), String> {
    for (selection, depends_on) in pending {
        let changes = schema_plan
            .changes
            .iter()
            .filter(|change| transfer_object_change_matches(&selection, change))
            .collect::<Vec<_>>();
        let statements = changes
            .iter()
            .flat_map(|change| change.sql.iter().cloned())
            .filter(|sql| !sql.trim().is_empty())
            .collect::<Vec<_>>();
        let blockers = changes
            .iter()
            .filter_map(|change| {
                change.blocked_reason.clone().or_else(|| {
                    change
                        .sql
                        .is_empty()
                        .then(|| format!("{} has no reviewed executable DDL.", change.summary))
                })
            })
            .collect::<Vec<_>>();
        if changes.is_empty() || statements.is_empty() || !blockers.is_empty() {
            let mut warnings = blockers;
            if changes.is_empty() {
                warnings.push(
                    "The selected object produced no catalog-backed creation change.".to_string(),
                );
            }
            let mut preflight = blocked_transfer_object_preflight(&selection, warnings);
            preflight.depends_on = depends_on;
            preflights.push(preflight);
            continue;
        }
        let plan_digest = transfer_object_plan_digest(&selection, &statements, &depends_on)?;
        preflights.push(TableDataTransferObjectPreflight {
            object_type: selection.object_type,
            name: selection.name.clone(),
            parent_name: selection.parent_name.clone(),
            action: TableDataTransferObjectAction::Create,
            can_execute: true,
            statements,
            plan_digest: Some(plan_digest),
            depends_on,
            warnings: changes
                .iter()
                .map(|change| change.summary.clone())
                .collect(),
        });
        results.push(TableDataTransferObjectResult {
            object_type: selection.object_type,
            name: selection.name,
            parent_name: selection.parent_name,
            action: TableDataTransferObjectAction::Create,
            report_id: None,
        });
    }
    preflights.sort_by(|left, right| {
        let left_order = schema_plan.changes.iter().position(|change| {
            transfer_object_change_matches(
                &TableDataTransferObjectSelection {
                    object_type: left.object_type,
                    name: left.name.clone(),
                    parent_name: left.parent_name.clone(),
                },
                change,
            )
        });
        let right_order = schema_plan.changes.iter().position(|change| {
            transfer_object_change_matches(
                &TableDataTransferObjectSelection {
                    object_type: right.object_type,
                    name: right.name.clone(),
                    parent_name: right.parent_name.clone(),
                },
                change,
            )
        });
        (left_order.unwrap_or(usize::MAX), &left.name)
            .cmp(&(right_order.unwrap_or(usize::MAX), &right.name))
    });
    Ok(())
}

pub(super) async fn resolve_table_data_transfer_object_plan(
    manager: &ConnectionManager,
    request: &TableDataTransferBatchPlanRequest,
    objects: &[TableDataTransferObjectSelection],
) -> Result<ResolvedTableDataTransferObjectPlan, String> {
    if objects.is_empty() {
        return build_table_data_transfer_object_plan(
            &empty_transfer_context_snapshot(
                &request.source_connection_id,
                &request.source_driver,
                request.source_database.clone(),
                &request.source_schema,
            )?,
            &empty_transfer_context_snapshot(
                &request.target_connection_id,
                &request.target_driver,
                request.target_database.clone(),
                &request.target_schema,
            )?,
            objects,
        );
    }
    let source_capture = || {
        capture_schema_snapshot_inner(
            manager,
            "table-transfer-preview".to_string(),
            request.source_connection_id.clone(),
            request.source_connection_id.clone(),
            request.source_driver.clone(),
            request.source_database.clone(),
            request.source_schema.clone(),
            false,
        )
    };
    let same_namespace = request.source_connection_id == request.target_connection_id
        && request.source_database == request.target_database
        && request.source_schema == request.target_schema;
    let (source, target) = if same_namespace {
        let snapshot = source_capture().await?;
        (snapshot.clone(), snapshot)
    } else {
        let target_capture = capture_schema_snapshot_inner(
            manager,
            "table-transfer-preview".to_string(),
            request.target_connection_id.clone(),
            request.target_connection_id.clone(),
            request.target_driver.clone(),
            request.target_database.clone(),
            request.target_schema.clone(),
            false,
        );
        tokio::try_join!(source_capture(), target_capture)?
    };
    build_table_data_transfer_object_plan(&source, &target, objects)
}
