use super::*;
use crate::core::{dialect::DatabaseKind, statement::StatementScanDialect};
use oxide_driver_protocol::{
    DriverQueryPage, DriverQueryResult, SchemaMigrationMode, SchemaMigrationPlanRequest,
    SchemaMigrationPlanResult, SchemaMigrationPreflightRequest, SchemaMigrationPreflightResult,
    SemanticSchemaSnapshot,
};

fn migration_request() -> SchemaMigrationPlanRequest {
    SchemaMigrationPlanRequest {
        source: SemanticSchemaSnapshot {
            snapshot_version: 1,
            fingerprint: "source-fingerprint".to_string(),
            database: Some("app".to_string()),
            namespace: "public".to_string(),
            descriptor: serde_json::json!({
                "relations": [{
                    "name": "users",
                    "columns": [{ "name": "id", "type": "integer" }]
                }]
            }),
        },
        target: SemanticSchemaSnapshot {
            snapshot_version: 1,
            fingerprint: "target-fingerprint".to_string(),
            database: Some("app".to_string()),
            namespace: "public".to_string(),
            descriptor: serde_json::json!({ "relations": [] }),
        },
    }
}

fn migration_plan_result() -> SchemaMigrationPlanResult {
    SchemaMigrationPlanResult {
        plan_id: "plan-1".to_string(),
        plan_token: "opaque-plan-token".to_string(),
        target_fingerprint: "target-fingerprint".to_string(),
        mode: SchemaMigrationMode::Transactional,
        change_count: 1,
        blocked_change_count: 0,
        requires_review: false,
        requires_destructive: false,
        preview: vec![oxide_driver_protocol::SchemaMigrationPreviewChange {
            id: "change-1".to_string(),
            kind: "createTable".to_string(),
            label: "Create users".to_string(),
            risk: "safe".to_string(),
            reversible: true,
            summary: "Creates the users relation".to_string(),
        }],
        warnings: Vec::new(),
    }
}

#[test]
fn external_sql_packages_use_their_declared_lsp_dialect_for_statement_scanning() {
    assert_eq!(
        external_statement_scan_dialect("duckdb", Some("duckdb")),
        Some(StatementScanDialect::Postgres)
    );
    assert_eq!(
        external_statement_scan_dialect("warehouse", Some("sql")),
        Some(StatementScanDialect::Postgres)
    );
    assert_eq!(
        external_statement_scan_dialect("mysql", Some("mysql")),
        Some(StatementScanDialect::Mysql)
    );
    assert_eq!(
        external_statement_scan_dialect("clickhouse", Some("clickhouse")),
        Some(StatementScanDialect::Mysql)
    );
    assert_eq!(
        external_statement_scan_dialect("sqlserver", Some("sql")),
        Some(StatementScanDialect::SqlServer)
    );
    assert_eq!(
        external_statement_scan_dialect("mongodb", Some("mongodb")),
        None
    );
}

#[test]
fn native_query_pages_require_consistent_opaque_cursor_state() {
    let result = DriverQueryResult {
        columns: Vec::new(),
        rows: vec![vec![serde_json::json!(1)]],
        truncated: false,
        row_limit: Some(1),
        rows_affected: None,
        statement_type: Some("SELECT".to_string()),
        message: None,
    };
    let page = native_query_page_from_sidecar(DriverQueryPage {
        result: result.clone(),
        session_id: Some("opaque-cursor".to_string()),
        has_more: true,
    })
    .unwrap();
    assert_eq!(page.next_cursor.as_deref(), Some("opaque-cursor"));

    let final_page = native_query_page_from_sidecar(DriverQueryPage {
        result,
        session_id: None,
        has_more: false,
    })
    .unwrap();
    assert!(final_page.next_cursor.is_none());

    let inconsistent = native_query_page_from_sidecar(DriverQueryPage {
        result: DriverQueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            truncated: false,
            row_limit: None,
            rows_affected: None,
            statement_type: None,
            message: None,
        },
        session_id: Some("unexpected".to_string()),
        has_more: false,
    });
    assert!(inconsistent.is_err());
}

#[test]
fn clickhouse_statement_scanner_keeps_backtick_sql_blocks_separate() {
    let sql = "SELECT `first` FROM `events`;\n\nSELECT `second` FROM `events`";
    let dialect = external_statement_scan_dialect("clickhouse", Some("clickhouse"))
        .expect("ClickHouse must expose a statement scanner");
    let selected =
        crate::core::statement::split_sql_statement_spans_with_soft_boundaries(sql, dialect);

    assert_eq!(selected.len(), 2);
    assert_eq!(selected[1].text.trim(), "SELECT `second` FROM `events`");
}

#[test]
fn database_creation_requires_both_signed_and_runtime_declarations() {
    let mut runtime = oxide_driver_protocol::DriverRuntimeCapabilities {
        database_creation: true,
        ..Default::default()
    };
    assert!(!allows_database_creation(None, &runtime));

    let mut capabilities = DatabaseKind::Postgres.capabilities();
    assert!(allows_database_creation(Some(&capabilities), &runtime));

    runtime.database_creation = false;
    assert!(!allows_database_creation(Some(&capabilities), &runtime));

    capabilities.supports_create_database = false;
    runtime.database_creation = true;
    assert!(!allows_database_creation(Some(&capabilities), &runtime));
}

#[test]
fn database_scoped_queries_require_both_signed_and_runtime_declarations() {
    let mut runtime = oxide_driver_protocol::DriverRuntimeCapabilities {
        database_scoped_queries: true,
        ..Default::default()
    };
    assert!(!allows_database_scoped_queries(None, &runtime));

    let mut capabilities = DatabaseKind::Postgres.capabilities();
    assert!(allows_database_scoped_queries(
        Some(&capabilities),
        &runtime
    ));

    runtime.database_scoped_queries = false;
    assert!(!allows_database_scoped_queries(
        Some(&capabilities),
        &runtime
    ));

    capabilities.supports_database_catalogs = false;
    runtime.database_scoped_queries = true;
    assert!(!allows_database_scoped_queries(
        Some(&capabilities),
        &runtime
    ));
}

#[test]
fn semantic_migration_snapshots_reject_host_sql_and_ddl() {
    let mut request = migration_request();
    validate_semantic_snapshot(&request.source, "Source schema")
        .expect("descriptor-only snapshot should pass");

    request.source.descriptor = serde_json::json!({
        "relations": [],
        "source_sql": "DROP TABLE users"
    });
    let error = validate_semantic_snapshot(&request.source, "Source schema")
        .expect_err("Host SQL must never cross the sidecar migration boundary");
    assert!(error
        .to_string()
        .contains("must not contain Host SQL or DDL"));
}

#[test]
fn semantic_migration_plan_is_bound_to_target_and_signed_mode() {
    let request = migration_request();
    let result = migration_plan_result();
    validate_schema_migration_plan_result(&request, SchemaMigrationMode::Transactional, &result)
        .expect("matching plan should pass");

    let mut wrong_target = result.clone();
    wrong_target.target_fingerprint = "another-target".to_string();
    assert!(validate_schema_migration_plan_result(
        &request,
        SchemaMigrationMode::Transactional,
        &wrong_target,
    )
    .is_err());

    assert!(validate_schema_migration_plan_result(
        &request,
        SchemaMigrationMode::NonTransactional,
        &result,
    )
    .is_err());
}

#[test]
fn semantic_migration_plan_rejects_duplicate_preview_ids_and_oversized_warnings() {
    let request = migration_request();
    let mut duplicate = migration_plan_result();
    duplicate.change_count = 2;
    duplicate.preview.push(duplicate.preview[0].clone());
    assert!(validate_schema_migration_plan_result(
        &request,
        SchemaMigrationMode::Transactional,
        &duplicate,
    )
    .is_err());

    let mut oversized_warning = migration_plan_result();
    oversized_warning.warnings = vec!["x".repeat(MAX_MIGRATION_TEXT_BYTES + 1)];
    assert!(validate_schema_migration_plan_result(
        &request,
        SchemaMigrationMode::Transactional,
        &oversized_warning,
    )
    .is_err());

    let mut missing_approval = migration_plan_result();
    missing_approval.preview[0].risk = "destructive".to_string();
    missing_approval.preview[0].reversible = false;
    assert!(validate_schema_migration_plan_result(
        &request,
        SchemaMigrationMode::Transactional,
        &missing_approval,
    )
    .is_err());
}

#[test]
fn semantic_migration_preflight_is_bound_to_requested_target() {
    let request = SchemaMigrationPreflightRequest {
        plan_token: "opaque-plan-token".to_string(),
        target_fingerprint: "target-fingerprint".to_string(),
    };
    let mut result = SchemaMigrationPreflightResult {
        plan_id: "plan-1".to_string(),
        preflight_token: "opaque-preflight-token".to_string(),
        target_fingerprint: request.target_fingerprint.clone(),
        ready: true,
        checks: Vec::new(),
    };
    validate_schema_migration_preflight_result(&request, &result)
        .expect("matching preflight should pass");

    result.target_fingerprint = "stale-target".to_string();
    assert!(validate_schema_migration_preflight_result(&request, &result).is_err());
}
