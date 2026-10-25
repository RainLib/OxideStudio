use super::*;

#[tokio::test]
async fn observed_initialization_is_busy_until_cleanup_completes() {
    let tracker = ConnectionSemanticTracker::default();
    let (session, initialization) = tracker.open_observed("id");
    let state = tracker.snapshot("id").unwrap();
    assert_eq!(state.session, session);
    assert_eq!(state.active_operations, 1);
    initialization.run(async {}).await;
    assert_eq!(tracker.snapshot("id").unwrap().active_operations, 0);
}
#[test]
fn cancelled_initialization_does_not_claim_a_ready_driver() {
    let tracker = ConnectionSemanticTracker::default();
    let (_, initialization) = tracker.open_observed("id");
    drop(initialization);
    assert!(tracker.snapshot("id").unwrap().uncertain);
}

#[tokio::test]
async fn successful_transaction_stays_open_until_commit_or_rollback() {
    let tracker = ConnectionSemanticTracker::default();
    let session = tracker.open("id");
    tracker
        .begin("id", &session)
        .unwrap()
        .run_transaction("tx", true, async { Ok(()) })
        .await
        .unwrap();
    let open = tracker.snapshot("id").unwrap();
    assert_eq!(open.open_transactions, 1);
    assert_eq!(open.active_operations, 0);
    tracker.begin("id", &session).unwrap().run(async {}).await;
    assert_eq!(tracker.snapshot("id").unwrap().open_transactions, 1);
    tracker
        .begin("id", &session)
        .unwrap()
        .run_transaction("tx", false, async { Ok(()) })
        .await
        .unwrap();
    assert_eq!(tracker.snapshot("id").unwrap().open_transactions, 0);
}
#[tokio::test]
async fn failed_transaction_completion_stays_uncertain_and_does_not_claim_it_closed() {
    let tracker = ConnectionSemanticTracker::default();
    let session = tracker.open("id");
    tracker
        .begin("id", &session)
        .unwrap()
        .run_transaction("tx", true, async { Ok(()) })
        .await
        .unwrap();
    let failed: Result<()> = tracker
        .begin("id", &session)
        .unwrap()
        .run_transaction("tx", false, async {
            Err(anyhow!("commit outcome unknown"))
        })
        .await;
    assert!(failed.is_err());
    let current = tracker.snapshot("id").unwrap();
    assert_eq!(current.open_transactions, 1);
    assert!(current.uncertain);
}

#[tokio::test]
async fn returned_errors_finish_and_advance_the_context() {
    let tracker = ConnectionSemanticTracker::default();
    let session = tracker.open("id");
    let before = tracker.snapshot("id").unwrap();
    let operation = tracker.begin("id", &session).unwrap();
    assert_eq!(tracker.snapshot("id").unwrap().active_operations, 1);
    let result: Result<()> = operation
        .run(async { Err(anyhow!("private SQL error")) })
        .await;
    assert!(result.is_err());
    let after = tracker.snapshot("id").unwrap();
    assert!(after.revision > before.revision);
    assert_eq!(after.active_operations, 0);
    assert!(!after.uncertain);
}
#[tokio::test]
async fn overlapping_operations_do_not_publish_a_premature_idle_state() {
    let tracker = ConnectionSemanticTracker::default();
    let session = tracker.open("id");
    let a = tracker.begin("id", &session).unwrap();
    let b = tracker.begin("id", &session).unwrap();
    assert_eq!(tracker.snapshot("id").unwrap().active_operations, 2);
    a.run(async {}).await;
    assert_eq!(tracker.snapshot("id").unwrap().active_operations, 1);
    b.run(async {}).await;
    assert_eq!(tracker.snapshot("id").unwrap().active_operations, 0);
}
#[test]
fn dropped_dispatch_is_uncertain_even_when_no_future_is_polled() {
    let tracker = ConnectionSemanticTracker::default();
    let session = tracker.open("id");
    drop(tracker.begin("id", &session).unwrap());
    let state = tracker.snapshot("id").unwrap();
    assert_eq!(state.active_operations, 0);
    assert!(state.uncertain);
}
#[tokio::test]
async fn another_success_cannot_clear_cancelled_operation_uncertainty() {
    let tracker = ConnectionSemanticTracker::default();
    let session = tracker.open("id");
    drop(tracker.begin("id", &session).unwrap());
    tracker.begin("id", &session).unwrap().run(async {}).await;
    assert!(tracker.snapshot("id").unwrap().uncertain);
}
#[test]
fn old_operation_drop_cannot_revoke_a_replacement_driver() {
    let tracker = ConnectionSemanticTracker::default();
    let old = tracker.open("id");
    let operation = tracker.begin("id", &old).unwrap();
    let replacement = tracker.open("id");
    assert_ne!(old, replacement);
    let current = tracker.snapshot("id").unwrap();
    drop(operation);
    assert_eq!(tracker.snapshot("id").unwrap(), current);
    assert!(tracker.begin("id", &old).is_err());
}
#[test]
fn closed_session_cannot_emit_a_late_healthy_event() {
    let tracker = ConnectionSemanticTracker::default();
    let session = tracker.open("id");
    let operation = tracker.begin("id", &session).unwrap();
    tracker.close("id", &session);
    let closed = tracker.snapshot("id").unwrap();
    drop(operation);
    assert!(!closed.connected);
    assert_eq!(tracker.snapshot("id").unwrap(), closed);
}
#[test]
fn missing_operation_never_creates_a_connected_session() {
    let tracker = ConnectionSemanticTracker::default();
    let mut receiver = tracker.subscribe();
    assert!(tracker.begin("missing", "invented").is_err());
    assert!(tracker.snapshot("missing").is_none());
    assert!(receiver.try_recv().is_err());
}
#[tokio::test]
async fn broadcast_and_snapshot_share_monotonic_order() {
    let tracker = ConnectionSemanticTracker::default();
    let mut receiver = tracker.subscribe();
    let session = tracker.open("id");
    let opened = receiver.recv().await.unwrap();
    let operation = tracker.begin("id", &session).unwrap();
    let started = receiver.recv().await.unwrap();
    assert!(started.revision > opened.revision);
    assert_eq!(Some(started.clone()), tracker.snapshot("id"));
    operation.run(async {}).await;
    let completed = receiver.recv().await.unwrap();
    assert!(completed.revision > started.revision);
    assert_eq!(Some(completed), tracker.snapshot("id"));
}
#[tokio::test]
async fn lag_can_recover_from_latest_snapshots() {
    let tracker = ConnectionSemanticTracker::default();
    let mut receiver = tracker.subscribe();
    let session = tracker.open("id");
    for _ in 0..300 {
        tracker.begin("id", &session).unwrap().run(async {}).await;
    }
    assert!(matches!(
        receiver.recv().await,
        Err(broadcast::error::RecvError::Lagged(_))
    ));
    let snapshots = tracker.snapshots();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].active_operations, 0);
    assert!(!snapshots[0].uncertain);
}
#[test]
fn closed_tombstones_are_bounded_without_evicting_active_connections() {
    let tracker = ConnectionSemanticTracker::default();
    tracker.open("active");
    for i in 0..300 {
        let id = format!("closed-{i}");
        let session = tracker.open(&id);
        tracker.close(&id, &session);
    }
    assert_eq!(tracker.snapshots().len(), CLOSED_LIMIT + 1);
    assert!(tracker.snapshot("active").unwrap().connected);
}
#[tokio::test]
async fn javascript_revision_limit_remains_blocked_instead_of_wrapping() {
    let tracker = ConnectionSemanticTracker::default();
    tracker.0.state.lock().unwrap().revision = MAX_REVISION - 1;
    let session = tracker.open("id");
    tracker.begin("id", &session).unwrap().run(async {}).await;
    let current = tracker.snapshot("id").unwrap();
    assert_eq!(current.revision, MAX_REVISION);
    assert!(current.uncertain);
}
#[tokio::test]
async fn event_payload_never_captures_operation_results_or_sql() {
    let tracker = ConnectionSemanticTracker::default();
    let session = tracker.open("opaque-id");
    let _: Result<()> = tracker
        .begin("opaque-id", &session)
        .unwrap()
        .run(async { Err(anyhow!("SET ROLE secret-role; password=secret")) })
        .await;
    let json = serde_json::to_value(tracker.snapshot("opaque-id").unwrap()).unwrap();
    assert_eq!(json.as_object().unwrap().len(), 7);
    assert_eq!(json["connectionId"], "opaque-id");
    assert!(!json.to_string().contains("secret"));
    assert!(!json.to_string().contains("ROLE"));
}
