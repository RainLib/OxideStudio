use crate::core::schema_diff::SchemaSnapshot;
use oxide_driver_protocol::SemanticSchemaSnapshot;
use sha2::Digest;
use sha2::Sha256;

pub(super) fn descriptor_value_fingerprint(value: Option<&str>) -> Option<String> {
    value.map(|value| format!("{:x}", Sha256::digest(value.as_bytes())))
}

pub(super) fn semantic_schema_snapshot(snapshot: &SchemaSnapshot) -> SemanticSchemaSnapshot {
    let relations = snapshot
        .relations
        .iter()
        .map(|relation| {
            serde_json::json!({
                "name": relation.name,
                "objectType": relation.object_type,
                "columns": relation.columns.iter().map(|column| serde_json::json!({
                    "name": column.name,
                    "dataType": column.data_type,
                    "nullable": column.is_nullable,
                    "primaryKey": column.is_primary_key,
                    "unique": column.is_unique,
                    "indexed": column.is_indexed,
                    "autoIncrement": column.is_auto_increment,
                    "generated": column.is_generated,
                    "hidden": column.is_hidden,
                    "hasDefault": column.default_value.is_some(),
                    "defaultFingerprint": descriptor_value_fingerprint(column.default_value.as_deref()),
                })).collect::<Vec<_>>(),
                "indexes": relation.indexes.iter().map(|index| serde_json::json!({
                    "name": index.name,
                    "columns": index.columns,
                    "unique": index.is_unique,
                    "primary": index.is_primary,
                    "indexType": index.index_type,
                    "hasOpaqueExpression": index.definition.is_some(),
                    "expressionFingerprint": descriptor_value_fingerprint(index.definition.as_deref()),
                })).collect::<Vec<_>>(),
                "constraints": relation.constraints.iter().map(|constraint| serde_json::json!({
                    "name": constraint.name,
                    "constraintType": constraint.constraint_type,
                    "columns": constraint.columns,
                    "referencedSchema": constraint.referenced_schema,
                    "referencedTable": constraint.referenced_table,
                    "referencedColumns": constraint.referenced_columns,
                    "hasOpaqueExpression": constraint.definition.is_some(),
                    "expressionFingerprint": descriptor_value_fingerprint(constraint.definition.as_deref()),
                })).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    let routines = snapshot
        .routines
        .iter()
        .map(|routine| {
            serde_json::json!({
                "name": routine.name,
                "routineType": routine.routine_type,
                "parameters": routine.parameters.iter().map(|parameter| serde_json::json!({
                    "name": parameter.name,
                    "dataType": parameter.data_type,
                    "optional": parameter.optional,
                })).collect::<Vec<_>>(),
                "returnType": routine.return_type,
            })
        })
        .collect::<Vec<_>>();
    let schema_objects = snapshot
        .schema_objects
        .iter()
        .map(|object| {
            serde_json::json!({
                "name": object.name,
                "objectType": object.object_type,
                "parentName": object.parent_name,
            })
        })
        .collect::<Vec<_>>();
    SemanticSchemaSnapshot {
        snapshot_version: 1,
        fingerprint: snapshot.fingerprint.clone(),
        database: snapshot.database_name.clone(),
        namespace: snapshot.schema_name.clone(),
        descriptor: serde_json::json!({
            "relations": relations,
            "routines": routines,
            "schemaObjects": schema_objects,
        }),
    }
}
