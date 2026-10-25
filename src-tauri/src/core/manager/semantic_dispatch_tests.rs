use super::*;
use crate::drivers::sqlite::SqliteDriver;

struct ErrorDriver;
struct DelayedDisconnect {
    entered: Arc<Notify>,
    release: Arc<Notify>,
}
#[async_trait]
impl DatabaseDriver for DelayedDisconnect {
    async fn connect(&mut self) -> Result<()> {
        Ok(())
    }
    async fn disconnect(&self) -> Result<()> {
        self.entered.notify_one();
        self.release.notified().await;
        Ok(())
    }
    async fn ping(&self) -> Result<()> {
        Ok(())
    }
    async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
        Ok(vec![])
    }
}
#[tokio::test]
async fn replacement_is_not_idle_while_the_retired_driver_is_still_cleaning_up() {
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let manager = ConnectionManager::new();
    manager
        .add_connection(
            "id".into(),
            Box::new(DelayedDisconnect {
                entered: entered.clone(),
                release: release.clone(),
            }),
        )
        .await;
    let replace = {
        let manager = manager.clone();
        tokio::spawn(async move {
            manager
                .replace_connection("id".into(), Box::new(ErrorDriver))
                .await
        })
    };
    timeout(Duration::from_secs(3), entered.notified())
        .await
        .unwrap();
    let initializing = manager.semantic_state("id").unwrap();
    assert_eq!(initializing.active_operations, 1);
    release.notify_one();
    replace.await.unwrap().unwrap();
    let complete = manager.semantic_state("id").unwrap();
    assert_eq!(complete.active_operations, 0);
    assert!(complete.revision > initializing.revision);
}
#[async_trait]
impl DatabaseDriver for ErrorDriver {
    async fn connect(&mut self) -> Result<()> {
        Ok(())
    }
    async fn disconnect(&self) -> Result<()> {
        Ok(())
    }
    async fn ping(&self) -> Result<()> {
        Ok(())
    }
    async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
        Err(anyhow!("fixture returned an error after dispatch"))
    }
}

#[tokio::test]
async fn query_dispatch_matrix_advances_even_when_driver_returns_errors() {
    let manager = ConnectionManager::new();
    manager
        .add_connection("id".into(), Box::new(ErrorDriver))
        .await;
    macro_rules! observed {
        ($operation:expr) => {{
            let before = manager.semantic_state("id").unwrap();
            let _ = $operation.await;
            let after = manager.semantic_state("id").unwrap();
            assert!(after.revision > before.revision);
            assert_eq!(after.active_operations, 0);
        }};
    }
    observed!(manager.query("id", "EXECUTE opaque_procedure", None, None, None));
    observed!(manager.query(
        "id",
        "SET ROLE opaque; SELECT missing",
        Some("app".into()),
        None,
        None
    ));
    observed!(manager.query(
        "id",
        "EXECUTE AS USER='opaque'",
        None,
        Some("tx".into()),
        None
    ));
    observed!(manager.query_parameterized("id", "SELECT ?", &[]));
    observed!(manager.query_database("id", "other", "opaque SQL"));
    observed!(manager.query_database_with_context("id", "other", "opaque SQL", Some("app"), None));
    observed!(manager.query_database_parameterized("id", "other", "opaque SQL", &[]));
    observed!(manager.execute_parameterized("id", "opaque SQL", &[]));
    observed!(manager.execute_parameterized_batch("id", &[]));
    observed!(manager.execute_database_parameterized_batch("id", "other", &[]));
    observed!(manager.query_native_page("id", None, "opaque native query", 10, None));
    observed!(manager.fetch_native_query_page("id", None, "cursor", 10));
    observed!(manager.close_native_query_page("id", "cursor"));
    assert!(!manager.semantic_state("id").unwrap().uncertain);
}

#[tokio::test]
async fn metadata_introspection_does_not_create_an_invalidation_loop() {
    let manager = ConnectionManager::new();
    manager
        .add_connection("id".into(), Box::new(ErrorDriver))
        .await;
    let before = manager.semantic_state("id");
    let _ = manager.get_schemas("id").await;
    let _ = manager.get_tables("id", "app").await;
    let _ = manager.get_columns("id", "app", "ledger").await;
    let _ = manager.sql_lookup_context("id", None).await;
    let _ = manager.package_capabilities("id").await;
    assert_eq!(manager.semantic_state("id"), before);
}

#[tokio::test]
async fn aborting_one_of_two_queries_does_not_claim_the_engine_is_idle_or_restored() {
    let entered = Arc::new(AtomicUsize::new(0));
    let both = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let manager = ConnectionManager::new();
    manager
        .add_connection(
            "id".into(),
            Box::new(BlockingDriver::new(entered, both.clone(), release.clone())),
        )
        .await;
    let a = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.query("id", "first", None, None, None).await })
    };
    let b = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.query("id", "second", None, None, None).await })
    };
    timeout(Duration::from_secs(3), both.notified())
        .await
        .unwrap();
    assert_eq!(manager.semantic_state("id").unwrap().active_operations, 2);
    a.abort();
    let _ = a.await;
    let state = manager.semantic_state("id").unwrap();
    assert_eq!(state.active_operations, 1);
    assert!(state.uncertain);
    release.notify_waiters();
    b.await.unwrap().unwrap();
    let state = manager.semantic_state("id").unwrap();
    assert_eq!(state.active_operations, 0);
    assert!(state.uncertain);
}

#[tokio::test]
async fn old_driver_operation_cannot_revoke_same_id_replacement() {
    let entered = Arc::new(AtomicUsize::new(0));
    let both = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let manager = ConnectionManager::new();
    manager
        .add_connection(
            "id".into(),
            Box::new(BlockingDriver::new(entered.clone(), both, release)),
        )
        .await;
    let task = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.query("id", "opaque", None, None, None).await })
    };
    timeout(Duration::from_secs(3), async {
        while entered.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    manager
        .replace_connection("id".into(), Box::new(ErrorDriver))
        .await
        .unwrap();
    let replacement = manager.semantic_state("id");
    task.abort();
    let _ = task.await;
    assert_eq!(manager.semantic_state("id"), replacement);
    assert!(!replacement.unwrap().uncertain);
}

#[tokio::test]
async fn real_sqlite_partial_error_and_transaction_boundaries_are_observed() {
    let mut driver = SqliteDriver::new("sqlite::memory:");
    driver.connect().await.unwrap();
    let manager = ConnectionManager::new();
    manager
        .add_connection("sqlite".into(), Box::new(driver))
        .await;
    let before = manager.semantic_state("sqlite").unwrap();
    assert!(manager
        .query(
            "sqlite",
            "CREATE TABLE ledger(id INTEGER); SELECT * FROM missing_table",
            None,
            None,
            None
        )
        .await
        .is_err());
    assert!(manager
        .get_tables("sqlite", "main")
        .await
        .unwrap()
        .iter()
        .any(|table| table.name == "ledger"));
    let after = manager.semantic_state("sqlite").unwrap();
    assert!(after.revision > before.revision);
    assert_eq!(after.active_operations, 0);
    assert!(!after.uncertain);
    manager
        .begin_transaction("sqlite", "tx", None)
        .await
        .unwrap();
    assert_eq!(
        manager.semantic_state("sqlite").unwrap().open_transactions,
        1
    );
    manager
        .query(
            "sqlite",
            "INSERT INTO ledger VALUES(42)",
            None,
            Some("tx".into()),
            None,
        )
        .await
        .unwrap();
    manager.rollback_transaction("sqlite", "tx").await.unwrap();
    assert_eq!(
        manager.semantic_state("sqlite").unwrap().open_transactions,
        0
    );
    let result = manager
        .query(
            "sqlite",
            "SELECT COUNT(*) AS n FROM ledger",
            None,
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(result[0].rows[0][0], serde_json::json!(0));
    manager.disconnect_connection("sqlite").await.unwrap();
}
