use super::super::*;
use super::support::*;
use crate::core::dialect::DatabaseKind;

#[test]
fn external_packages_cannot_receive_host_generated_schema_migrations() {
    let mut capabilities = DatabaseKind::Postgres.capabilities();
    capabilities.display_name = "PostgreSQL JDBC package".to_string();

    assert!(ensure_host_schema_migration_capability(None).is_ok());
    assert_eq!(
        ensure_host_schema_migration_capability(Some(&capabilities)).unwrap_err(),
        "PostgreSQL JDBC package does not provide a verified semantic schema migration protocol"
    );
}

#[test]
fn semantic_sidecar_snapshot_hashes_opaque_expressions_without_source_text() {
    let snapshot = semantic_schema_snapshot(&semantic_fixture_snapshot());
    let encoded = serde_json::to_string(&snapshot).unwrap();

    assert!(!encoded.contains("nextval"));
    assert!(!encoded.contains("CREATE INDEX"));
    assert!(!encoded.contains("CHECK ("));
    assert!(!encoded.contains("private comment"));
    assert!(encoded.contains("defaultFingerprint"));
    assert!(encoded.contains("expressionFingerprint"));
}

#[test]
fn semantic_sidecar_snapshot_preserves_optional_column_character_attributes() {
    let mut source = semantic_fixture_snapshot();
    source.driver = "mysql".to_string();
    let column = &mut source.relations[0].columns[0];
    column.data_type = "varchar(80)".to_string();
    column.character_set = Some("utf8mb4".to_string());
    column.collation = Some("utf8mb4_bin".to_string());
    let descriptor = semantic_schema_snapshot(&source).descriptor;
    let column = &descriptor["relations"][0]["columns"][0];
    assert_eq!(column["characterSet"], "utf8mb4");
    assert_eq!(column["collation"], "utf8mb4_bin");

    let legacy = semantic_schema_snapshot(&semantic_fixture_snapshot()).descriptor;
    let column = &legacy["relations"][0]["columns"][0];
    assert!(column["characterSet"].is_null());
    assert!(column["collation"].is_null());
}

#[test]
fn external_plan_exposes_host_id_and_preview_but_never_sidecar_tokens() {
    let source = semantic_fixture_snapshot();
    let target = semantic_fixture_snapshot();
    let result = DriverMigrationPlanResult {
        plan_id: "sidecar-plan-id".to_string(),
        plan_token: "sidecar-secret-token".to_string(),
        target_fingerprint: target.fingerprint.clone(),
        mode: SchemaMigrationMode::Transactional,
        change_count: 1,
        blocked_change_count: 0,
        requires_review: true,
        requires_destructive: false,
        preview: vec![oxide_driver_protocol::SchemaMigrationPreviewChange {
            id: "sidecar-change-id".to_string(),
            kind: "alterColumn".to_string(),
            label: "users.id".to_string(),
            risk: "review".to_string(),
            reversible: true,
            summary: "Change the identifier representation".to_string(),
        }],
        warnings: Vec::new(),
    };

    let plan = external_driver_plan(&source, &target, "host-plan-id".to_string(), 1, &result);
    let encoded = serde_json::to_string(&plan).unwrap();

    assert_eq!(plan.id, "host-plan-id");
    assert_eq!(
        plan.execution_owner,
        SchemaDiffExecutionOwner::ExternalDriver
    );
    assert!(plan.migration_sql.is_empty());
    assert!(!encoded.contains("sidecar-secret-token"));
    assert!(!encoded.contains("sidecar-plan-id"));
    assert!(!encoded.contains("sidecar-change-id"));
}

#[test]
fn external_migration_sessions_are_process_local_bounded_and_single_use() {
    let state = ExternalSchemaMigrationSessionState::default();
    state
        .insert(ExternalSchemaMigrationSession {
            host_plan_id: "host-plan-id".to_string(),
            sidecar_plan_id: "sidecar-plan-id".to_string(),
            plan_token: "secret-token".to_string(),
            connection_id: "connection-1".to_string(),
            runtime_process_id: 42,
            source_fingerprint: "source".to_string(),
            target_fingerprint: "target".to_string(),
            mode: SchemaMigrationMode::Transactional,
            change_count: 1,
            blocked_change_count: 0,
            requires_review: false,
            requires_destructive: false,
            expires_at: Instant::now() + Duration::from_secs(60),
        })
        .unwrap();

    assert_eq!(
        state.get("host-plan-id").unwrap().plan_token,
        "secret-token"
    );
    assert_eq!(
        state.consume("host-plan-id").unwrap().sidecar_plan_id,
        "sidecar-plan-id"
    );
    assert!(state.get("host-plan-id").is_err());
    assert!(state.consume("host-plan-id").is_err());
}
