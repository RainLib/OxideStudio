use super::metadata_children::{compare_metadata_children, metadata_only_change};
use super::objects::compare_schema_objects;
use super::plan_model::{relation_map, stable_id};
use super::render::summarize_changes;
use super::routines::compare_routines;
use super::types::{
    SchemaChangeKind, SchemaDiffExecutionOwner, SchemaDiffPlan, SchemaNameMapping, SchemaSnapshot,
};
use anyhow::Result;

pub(super) fn compare_metadata_snapshots(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    generated_at: i64,
    driver: &str,
) -> Result<SchemaDiffPlan> {
    let source_objects = relation_map(&source.relations);
    let target_objects = relation_map(&target.relations);
    let mut object_names = source_objects
        .keys()
        .chain(target_objects.keys())
        .cloned()
        .collect::<Vec<_>>();
    object_names.sort();
    object_names.dedup();
    let mut changes = Vec::new();

    for object_name in object_names {
        match (
            source_objects.get(&object_name),
            target_objects.get(&object_name),
        ) {
            (Some(source_object), None) => changes.push(metadata_only_change(
                SchemaChangeKind::RelationCreate,
                &target.schema_name,
                &object_name,
                source_object.object_type.clone(),
                None,
                format!("Object {object_name} exists in the snapshot but not in live metadata"),
            )),
            (None, Some(target_object)) => changes.push(metadata_only_change(
                SchemaChangeKind::RelationDrop,
                &target.schema_name,
                &object_name,
                target_object.object_type.clone(),
                None,
                format!("Live object {object_name} is absent from the snapshot"),
            )),
            (Some(source_object), Some(target_object)) => {
                compare_metadata_children(
                    &target.schema_name,
                    source_object,
                    target_object,
                    &mut changes,
                );
            }
            (None, None) => unreachable!(),
        }
    }
    let mut routine_warnings = Vec::new();
    compare_routines(
        None,
        SchemaNameMapping {
            source: &source.schema_name,
            target: &target.schema_name,
        },
        &source.routines,
        &target.routines,
        &target.schema_name,
        &mut changes,
        &mut routine_warnings,
    );
    compare_schema_objects(
        None,
        SchemaNameMapping {
            source: &source.schema_name,
            target: &target.schema_name,
        },
        &source.schema_objects,
        &target.schema_objects,
        &target.schema_name,
        &mut changes,
        &mut routine_warnings,
    );

    for (order, change) in changes.iter_mut().enumerate() {
        change.order = order;
    }
    let summary = summarize_changes(&changes);
    let id = stable_id(
        "metadata-diff",
        &format!(
            "metadata-diff:{}:{}:{}",
            source.fingerprint, target.fingerprint, target.schema_name
        ),
    );

    Ok(SchemaDiffPlan {
        id,
        source_snapshot_id: source.id.clone(),
        target_snapshot_id: target.id.clone(),
        driver: driver.to_string(),
        target_connection_id: target.connection_id.clone(),
        target_database_name: target.database_name.clone(),
        target_schema_name: target.schema_name.clone(),
        generated_at,
        transactional: false,
        execution_owner: SchemaDiffExecutionOwner::ReviewOnly,
        requires_review_approval: true,
        requires_destructive_approval: false,
        summary,
        changes,
        migration_sql: "-- Metadata-only comparison; no migration commands were generated.\n"
            .to_string(),
        preflight_checks: Vec::new(),
        preflight_sql: String::new(),
        conversion_issues: Vec::new(),
        warnings: {
            let mut warnings = vec![
                "This driver requires review-specific schema handling; automatic restore is disabled."
                    .to_string(),
            ];
            warnings.extend(routine_warnings);
            warnings.sort();
            warnings.dedup();
            warnings
        },
    })
}
