use super::super::*;
use super::support::*;

fn mysql_snapshot(id: &str, columns: Vec<ColumnInfo>) -> SchemaSnapshot {
    let mut value = snapshot(id, columns);
    value.driver = "mysql".to_string();
    finalize_schema_snapshot(value).unwrap()
}

fn character_column(charset: &str, collation: &str) -> ColumnInfo {
    let mut value = column("name", "varchar(80)", true);
    value.character_set = Some(charset.to_string());
    value.collation = Some(collation.to_string());
    value
}

#[test]
fn mysql_add_column_keeps_character_semantics_instead_of_inheriting_target_defaults() {
    let source = mysql_snapshot("source", vec![character_column("utf8mb4", "utf8mb4_bin")]);
    let target = mysql_snapshot("target", Vec::new());
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(plan
        .migration_sql
        .contains("ADD COLUMN `name` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"));
    assert!(plan
        .changes
        .iter()
        .all(|change| change.blocked_reason.is_none()));
}

#[test]
fn mysql_create_table_restores_captured_column_character_semantics() {
    let source = mysql_snapshot("source", vec![character_column("latin1", "latin1_bin")]);
    let mut target = mysql_snapshot("target", Vec::new());
    target.relations.clear();
    let target = finalize_schema_snapshot(target).unwrap();
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(plan.migration_sql.contains("CREATE TABLE"));
    assert!(plan
        .migration_sql
        .contains("CHARACTER SET latin1 COLLATE latin1_bin"));
}

#[test]
fn mysql_collation_difference_is_detected_when_type_and_nullability_match() {
    let source = mysql_snapshot("source", vec![character_column("utf8mb4", "utf8mb4_bin")]);
    let target = mysql_snapshot(
        "target",
        vec![character_column("utf8mb4", "utf8mb4_unicode_ci")],
    );
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert_eq!(plan.changes.len(), 1);
    assert_eq!(plan.changes[0].kind, SchemaChangeKind::ColumnModify);
    assert!(plan.changes[0].manual_review);
    assert!(plan.migration_sql.contains("MODIFY COLUMN"));
    assert!(plan.migration_sql.contains("COLLATE utf8mb4_bin"));
}

#[test]
fn mysql_charset_conversion_requires_destructive_review() {
    let source = mysql_snapshot("source", vec![character_column("utf8mb4", "utf8mb4_bin")]);
    let target = mysql_snapshot("target", vec![character_column("latin1", "latin1_bin")]);
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert_eq!(plan.changes[0].risk, SchemaChangeRisk::Destructive);
    assert!(plan.requires_destructive_approval);
}

#[test]
fn legacy_source_does_not_reset_target_collation_when_modifying_other_attributes() {
    let mut legacy = column("name", "varchar(80)", true);
    legacy.default_value = Some("'anonymous'".to_string());
    let source = mysql_snapshot("source", vec![legacy]);
    let target = mysql_snapshot("target", vec![character_column("utf8mb4", "utf8mb4_bin")]);
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(plan
        .migration_sql
        .contains("CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"));
    assert!(plan.migration_sql.contains("DEFAULT 'anonymous'"));
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("Source character metadata")));
}

#[test]
fn legacy_missing_metadata_is_not_an_instruction_to_clear_current_attributes() {
    let source = mysql_snapshot("source", vec![column("name", "varchar(80)", true)]);
    let target = mysql_snapshot("target", vec![character_column("utf8mb4", "utf8mb4_bin")]);
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(plan.changes.is_empty());
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("not compared")));
}

#[test]
fn mysql_character_names_are_case_insensitive() {
    let source = mysql_snapshot("source", vec![character_column("UTF8MB4", "UTF8MB4_BIN")]);
    let target = mysql_snapshot("target", vec![character_column("utf8mb4", "utf8mb4_bin")]);
    assert!(compare_schema_snapshots(&source, &target, 2)
        .unwrap()
        .changes
        .is_empty());
}

#[test]
fn character_to_numeric_conversion_does_not_copy_inapplicable_target_collation() {
    let source = mysql_snapshot("source", vec![column("name", "int", true)]);
    let target = mysql_snapshot("target", vec![character_column("utf8mb4", "utf8mb4_bin")]);
    let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
    assert!(plan.migration_sql.contains("MODIFY COLUMN `name` int"));
    assert!(!plan.migration_sql.contains("CHARACTER SET"));
    assert!(plan.changes[0].blocked_reason.is_none());
}

#[test]
fn invalid_character_metadata_blocks_create_add_and_modify_without_partial_ddl() {
    for invalid in [
        character_column("utf8mb4; DROP TABLE users", "utf8mb4_bin"),
        character_column("utf8mb4", ""),
        ColumnInfo {
            collation: None,
            ..character_column("utf8mb4", "utf8mb4_bin")
        },
        ColumnInfo {
            data_type: "int".to_string(),
            ..character_column("utf8mb4", "utf8mb4_bin")
        },
    ] {
        let source = mysql_snapshot("source", vec![invalid]);
        let targets = [
            mysql_snapshot("target", Vec::new()),
            mysql_snapshot("target", vec![character_column("latin1", "latin1_bin")]),
        ];
        for target in targets {
            let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
            assert!(plan.changes.iter().all(|change| change.sql.is_empty()));
            assert!(plan
                .changes
                .iter()
                .all(|change| change.blocked_reason.is_some()));
            assert!(!plan.migration_sql.contains("DROP TABLE users"));
        }
        let mut target = mysql_snapshot("target", Vec::new());
        target.relations.clear();
        let target = finalize_schema_snapshot(target).unwrap();
        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        assert!(plan.changes.iter().all(|change| change.sql.is_empty()));
    }
}

#[test]
fn optional_character_metadata_preserves_legacy_snapshot_roundtrip_and_changes_fingerprints() {
    let legacy = mysql_snapshot("legacy", vec![column("name", "varchar(80)", true)]);
    let json = serde_json::to_value(&legacy).unwrap();
    assert!(json["relations"][0]["columns"][0]
        .get("character_set")
        .is_none());
    assert!(json["relations"][0]["columns"][0]
        .get("collation")
        .is_none());
    let decoded = serde_json::from_value::<SchemaSnapshot>(json).unwrap();
    assert_eq!(
        finalize_schema_snapshot(decoded).unwrap().fingerprint,
        legacy.fingerprint
    );

    let mut captured = legacy.clone();
    captured.relations[0].columns[0] = character_column("utf8mb4", "utf8mb4_bin");
    let captured = finalize_schema_snapshot(captured).unwrap();
    assert_ne!(captured.fingerprint, legacy.fingerprint);
    let mut changed = captured.clone();
    changed.relations[0].columns[0].collation = Some("utf8mb4_unicode_ci".to_string());
    assert_ne!(
        finalize_schema_snapshot(changed).unwrap().fingerprint,
        captured.fingerprint
    );
}
