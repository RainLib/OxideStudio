use super::super::*;

pub(super) fn column(name: &str, data_type: &str, nullable: bool) -> ColumnInfo {
    ColumnInfo {
        name: name.to_string(),
        data_type: data_type.to_string(),
        is_nullable: nullable,
        is_primary_key: name == "id",
        is_unique: name == "id",
        is_indexed: name == "id",
        is_auto_increment: name == "id",
        identity_generation: None,
        default_value: None,
        comment: None,
        is_generated: Some(false),
        is_hidden: Some(false),
    }
}

pub(super) fn snapshot(id: &str, columns: Vec<ColumnInfo>) -> SchemaSnapshot {
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
            comment: None,
            definition: None,
            materialized_view_populated: None,
            dependencies: Vec::new(),
            external_dependencies: Vec::new(),
            sequence_dependencies: Vec::new(),
            columns,
            indexes: Vec::new(),
            constraints: Vec::new(),
        }],
        routines: Vec::new(),
        schema_objects: Vec::new(),
        warnings: Vec::new(),
    })
    .unwrap()
}

pub(super) fn routine(name: &str, return_type: &str) -> SchemaRoutineSnapshot {
    SchemaRoutineSnapshot {
        name: name.to_string(),
        routine_type: Some("FUNCTION".to_string()),
        parameters: vec![FunctionParameterInfo {
            name: "input".to_string(),
            data_type: "text".to_string(),
            optional: false,
        }],
        return_type: return_type.to_string(),
        description: None,
        definition: None,
    }
}

pub(super) fn constraint(name: &str, constraint_type: &str, columns: &[&str]) -> ConstraintInfo {
    ConstraintInfo {
        name: name.to_string(),
        constraint_type: constraint_type.to_string(),
        columns: columns.iter().map(|value| (*value).to_string()).collect(),
        referenced_schema: None,
        referenced_table: None,
        referenced_columns: Vec::new(),
        definition: None,
        on_update: None,
        on_delete: None,
    }
}

pub(super) fn index(name: &str, columns: &[&str], index_type: &str) -> IndexInfo {
    IndexInfo {
        name: name.to_string(),
        columns: columns.iter().map(|value| (*value).to_string()).collect(),
        is_unique: false,
        is_primary: false,
        filter: None,
        index_type: Some(index_type.to_string()),
        included_columns: None,
        definition: None,
        comment: None,
        key_is_expression: Vec::new(),
    }
}
