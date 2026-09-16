use super::plan_model::{routine_sort_key, schema_object_sort_key, snapshot_fingerprint};
use super::types::{SchemaSequenceOwnerSnapshot, SchemaSnapshot, SCHEMA_SNAPSHOT_VERSION};
use anyhow::Result;

pub fn finalize_schema_snapshot(mut snapshot: SchemaSnapshot) -> Result<SchemaSnapshot> {
    snapshot.version = SCHEMA_SNAPSHOT_VERSION;
    snapshot
        .relations
        .sort_by(|left, right| left.name.cmp(&right.name));
    for relation in &mut snapshot.relations {
        relation.dependencies.sort();
        relation.dependencies.dedup();
        relation.external_dependencies.sort();
        relation.external_dependencies.dedup();
        relation.sequence_dependencies.sort();
        relation.sequence_dependencies.dedup();
        relation
            .indexes
            .sort_by(|left, right| left.name.cmp(&right.name));
        relation
            .constraints
            .sort_by(|left, right| left.name.cmp(&right.name));
    }
    snapshot.routines.sort_by_key(routine_sort_key);
    snapshot.schema_objects.sort_by_key(schema_object_sort_key);
    for object in &mut snapshot.schema_objects {
        object.dependencies.sort();
        object.dependencies.dedup();
        object.sequence_owner = object.sequence_owner.take().and_then(|owner| {
            let table_name = owner.table_name.trim();
            let column_name = owner.column_name.trim();
            (!table_name.is_empty() && !column_name.is_empty()).then(|| {
                SchemaSequenceOwnerSnapshot {
                    table_name: table_name.to_string(),
                    column_name: column_name.to_string(),
                }
            })
        });
        object.sequence_last_value = object
            .sequence_last_value
            .as_deref()
            .map(str::trim)
            .filter(|value| value.parse::<i64>().is_ok())
            .map(ToString::to_string);
        if object.sequence_last_value.is_none() {
            object.sequence_is_called = None;
        }
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
