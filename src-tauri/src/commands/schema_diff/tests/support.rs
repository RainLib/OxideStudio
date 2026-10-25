use super::super::*;
use crate::core::protocol::{ColumnDef, ColumnInfo, ConstraintInfo, IndexInfo};

pub(super) fn semantic_fixture_snapshot() -> SchemaSnapshot {
    SchemaSnapshot {
        version: SCHEMA_SNAPSHOT_VERSION,
        id: "snapshot-1".to_string(),
        fingerprint: "snapshot-fingerprint".to_string(),
        project_id: "project-1".to_string(),
        connection_id: "connection-1".to_string(),
        connection_name: "Production".to_string(),
        driver: "warehouse".to_string(),
        database_name: Some("app".to_string()),
        schema_name: "public".to_string(),
        captured_at: 1,
        relations: vec![SchemaRelationSnapshot {
            name: "users".to_string(),
            object_type: Some("TABLE".to_string()),
            comment: None,
            definition: None,
            materialized_view_populated: None,
            dependencies: Vec::new(),
            external_dependencies: Vec::new(),
            sequence_dependencies: Vec::new(),
            columns: vec![ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: true,
                is_unique: true,
                is_indexed: true,
                is_auto_increment: false,
                identity_generation: None,
                default_value: Some("nextval('private_sequence')".to_string()),
                comment: Some("private comment".to_string()),
                is_generated: Some(false),
                is_hidden: Some(false),
                character_set: None,
                collation: None,
            }],
            indexes: vec![IndexInfo {
                name: "users_idx".to_string(),
                columns: vec!["id".to_string()],
                is_unique: true,
                is_primary: true,
                filter: None,
                index_type: Some("btree".to_string()),
                included_columns: None,
                definition: Some("CREATE INDEX private_source".to_string()),
                comment: Some("private index comment".to_string()),
                key_is_expression: Vec::new(),
            }],
            constraints: vec![ConstraintInfo {
                name: "users_check".to_string(),
                constraint_type: "CHECK".to_string(),
                columns: vec!["id".to_string()],
                referenced_schema: None,
                referenced_table: None,
                referenced_columns: Vec::new(),
                definition: Some("CHECK (id > 0)".to_string()),
                on_update: None,
                on_delete: None,
            }],
        }],
        routines: Vec::new(),
        schema_objects: Vec::new(),
        warnings: Vec::new(),
    }
}

pub(super) fn check(
    assertion: SchemaPreflightAssertion,
    column: Option<&str>,
) -> SchemaPreflightCheck {
    SchemaPreflightCheck {
        id: "check-1".to_string(),
        change_id: "change-1".to_string(),
        label: "Check live rows".to_string(),
        sql: "SELECT 0 AS blocking_rows".to_string(),
        expectation: "No blocking rows".to_string(),
        assertion,
        result_column: column.map(ToString::to_string),
    }
}

pub(super) fn numeric_result(value: serde_json::Value) -> QueryResult {
    QueryResult::rows(
        vec![ColumnDef {
            name: "blocking_rows".to_string(),
            data_type: "int8".to_string(),
        }],
        vec![vec![value]],
    )
}
