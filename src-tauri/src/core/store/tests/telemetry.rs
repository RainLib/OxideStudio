use super::super::*;

#[tokio::test]
async fn driver_runtime_telemetry_persists_only_package_events_and_counters() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let store = MetaStore::for_test(pool);
    store.init().await.unwrap();
    store
        .record_driver_runtime_event("oracle", "23.3.0", DriverRuntimeEventKind::Launched, 100)
        .await
        .unwrap();
    store
        .record_driver_runtime_event("oracle", "23.3.0", DriverRuntimeEventKind::Exited, 200)
        .await
        .unwrap();
    store
        .record_driver_runtime_event(
            "oracle",
            "23.3.0",
            DriverRuntimeEventKind::ReconnectAttempted,
            300,
        )
        .await
        .unwrap();
    store
        .record_driver_runtime_event(
            "oracle",
            "23.3.0",
            DriverRuntimeEventKind::ReconnectFailed,
            350,
        )
        .await
        .unwrap();

    let records = store.list_driver_runtime_telemetry().await.unwrap();
    assert_eq!(records.len(), 1);
    let record = &records[0];
    assert_eq!(record.driver, "oracle");
    assert_eq!(record.package_version, "23.3.0");
    assert_eq!(record.launch_count, 1);
    assert_eq!(record.observed_exit_count, 1);
    assert_eq!(record.reconnect_attempt_count, 1);
    assert_eq!(record.reconnect_failure_count, 1);
    assert_eq!(record.last_event_code, "reconnect-failed");
    assert_eq!(record.last_started_at_millis, Some(100));
    assert_eq!(record.last_exit_observed_at_millis, Some(200));
    assert_eq!(record.last_reconnect_at_millis, Some(350));
    assert!(store
        .record_driver_runtime_event(
            "oracle/private-connection",
            "23.3.0",
            DriverRuntimeEventKind::Exited,
            400,
        )
        .await
        .is_err());

    let columns: Vec<String> = sqlx::query("PRAGMA table_info(driver_runtime_telemetry)")
        .fetch_all(&store.pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.get("name"))
        .collect();
    for forbidden in ["connection", "url", "stderr", "sql", "message"] {
        assert!(!columns.iter().any(|column| column.contains(forbidden)));
    }
}
