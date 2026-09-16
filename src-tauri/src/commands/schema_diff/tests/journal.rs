use super::super::*;

#[test]
fn active_migration_journal_is_not_treated_as_an_interrupted_process() {
    let id = "schema-migration-active-test";
    let guard = ActiveMigrationJournal::register(id);
    assert!(migration_is_active(id));
    drop(guard);
    assert!(!migration_is_active(id));
}

#[test]
fn stale_running_journal_requires_a_fresh_snapshot_instead_of_resume() {
    let mut journal = SchemaMigrationJournalEntry {
        id: "schema-migration-stale-test".to_string(),
        project_id: "project-1".to_string(),
        connection_id: "connection-1".to_string(),
        connection_name: "Production".to_string(),
        database_name: Some("app".to_string()),
        schema_name: "public".to_string(),
        plan_id: "plan-1".to_string(),
        source_fingerprint: "source".to_string(),
        target_fingerprint_before: "target".to_string(),
        status: SchemaMigrationStatus::Running,
        started_at: 1,
        finished_at: None,
        statement_count: 2,
        committed_statements: 1,
        preflight_results: Vec::new(),
        rollback: SchemaRollbackArtifact {
            available: false,
            reason: None,
            plan_id: None,
            change_count: 0,
            requires_manual_review: true,
            sql: None,
            backup_path: None,
            backup_byte_len: None,
            backup_integrity_check: None,
        },
        verification: None,
        error: None,
        warnings: Vec::new(),
    };

    assert!(interrupt_stale_migration_journal(&mut journal));
    assert_eq!(journal.status, SchemaMigrationStatus::Interrupted);
    assert_eq!(journal.committed_statements, 1);
    assert!(journal.finished_at.is_some());
    assert!(journal
        .error
        .as_deref()
        .is_some_and(|error| error.contains("fresh snapshot")));
    assert!(!interrupt_stale_migration_journal(&mut journal));
}

#[test]
fn confirmation_phrase_binds_connection_database_and_schema() {
    let snapshot = SchemaSnapshot {
        version: SCHEMA_SNAPSHOT_VERSION,
        id: "snapshot-1".to_string(),
        fingerprint: "fingerprint".to_string(),
        project_id: "project-1".to_string(),
        connection_id: "connection-1".to_string(),
        connection_name: "Production".to_string(),
        driver: "postgres".to_string(),
        database_name: Some("app".to_string()),
        schema_name: "public".to_string(),
        captured_at: 1,
        relations: Vec::new(),
        routines: Vec::new(),
        schema_objects: Vec::new(),
        warnings: Vec::new(),
    };

    assert_eq!(
        migration_confirmation_target(&snapshot),
        "Production / app / public"
    );
}

#[test]
fn project_ddl_baseline_cannot_enter_migration_execution() {
    let snapshot = SchemaSnapshot {
        version: SCHEMA_SNAPSHOT_VERSION,
        id: "project-ddl-1".to_string(),
        fingerprint: "offline-1234".to_string(),
        project_id: "project-1".to_string(),
        connection_id: "connection-1".to_string(),
        connection_name: "Production".to_string(),
        driver: "postgres".to_string(),
        database_name: Some("app".to_string()),
        schema_name: "public".to_string(),
        captured_at: 1,
        relations: Vec::new(),
        routines: Vec::new(),
        schema_objects: Vec::new(),
        warnings: vec![OFFLINE_PROJECT_DDL_REVIEW_WARNING.to_string()],
    };

    let error = ensure_snapshot_is_executable_source(snapshot).unwrap_err();

    assert!(error.contains("review-only"));
}

#[test]
fn every_offline_baseline_marker_is_rejected_by_the_backend() {
    for warning in OFFLINE_REVIEW_WARNINGS {
        let snapshot = SchemaSnapshot {
            version: SCHEMA_SNAPSHOT_VERSION,
            id: format!("offline-{warning}"),
            fingerprint: "offline-1234".to_string(),
            project_id: "project-1".to_string(),
            connection_id: "connection-1".to_string(),
            connection_name: "Production".to_string(),
            driver: "postgres".to_string(),
            database_name: Some("app".to_string()),
            schema_name: "public".to_string(),
            captured_at: 1,
            relations: Vec::new(),
            routines: Vec::new(),
            schema_objects: Vec::new(),
            warnings: vec![warning.to_string()],
        };

        assert!(ensure_snapshot_is_executable_source(snapshot)
            .unwrap_err()
            .contains("review-only"));
    }
}
