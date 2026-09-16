use super::super::*;
use super::support::*;
use crate::core::protocol::ColumnDef;

#[test]
fn external_preflight_journal_does_not_copy_raw_observed_text() {
    let result = oxide_driver_protocol::SchemaMigrationPreflightResult {
        plan_id: "sidecar-plan".to_string(),
        preflight_token: "preflight-token".to_string(),
        target_fingerprint: "target".to_string(),
        ready: false,
        checks: vec![oxide_driver_protocol::SchemaMigrationPreflightCheckResult {
            id: "check-1".to_string(),
            label: "Check target".to_string(),
            status: "blocked".to_string(),
            blocks_execution: true,
            observed: "private@example.com".to_string(),
        }],
    };

    let journal = external_preflight_results(&result);

    assert_eq!(journal.len(), 1);
    assert!(journal[0].blocks_execution);
    assert!(!journal[0].observed.contains("private@example.com"));
}

#[test]
fn zero_value_preflight_passes_zero_and_blocks_non_zero() {
    let check = check(SchemaPreflightAssertion::ZeroValue, Some("blocking_rows"));

    let passed = evaluate_preflight_result(&check, &[numeric_result(0.into())]);
    let blocked = evaluate_preflight_result(&check, &[numeric_result("3".into())]);

    assert_eq!(passed.status, SchemaMigrationPreflightStatus::Passed);
    assert!(!passed.blocks_execution);
    assert_eq!(blocked.status, SchemaMigrationPreflightStatus::Blocked);
    assert!(blocked.blocks_execution);
    assert_eq!(blocked.observed, "blocking_rows = 3");
}

#[test]
fn empty_rows_preflight_never_persists_returned_values() {
    let check = check(SchemaPreflightAssertion::EmptyRows, None);
    let result = QueryResult::rows(
        vec![ColumnDef {
            name: "email".to_string(),
            data_type: "text".to_string(),
        }],
        vec![vec!["private@example.com".into()]],
    );

    let evaluated = evaluate_preflight_result(&check, &[result]);

    assert_eq!(evaluated.status, SchemaMigrationPreflightStatus::Blocked);
    assert!(evaluated.blocks_execution);
    assert_eq!(evaluated.observed, "1 blocking row(s) returned");
    assert!(!evaluated.observed.contains("private@example.com"));
}

#[test]
fn unexpected_preflight_shape_fails_closed() {
    let check = check(SchemaPreflightAssertion::ZeroValue, Some("blocking_rows"));
    let result = QueryResult::rows(Vec::new(), vec![Vec::new()]);

    let evaluated = evaluate_preflight_result(&check, &[result]);

    assert_eq!(evaluated.status, SchemaMigrationPreflightStatus::Error);
    assert!(evaluated.blocks_execution);
    assert!(evaluated.error.is_some());
}
