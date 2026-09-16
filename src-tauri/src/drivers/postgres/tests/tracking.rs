use super::super::*;
use crate::core::driver::DatabaseDriver;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::ConnectOptions;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Mutex as StdMutex;
#[test]
fn postgres_index_metadata_avoids_include_catalog_fields_before_11() {
    assert!(!postgres_index_key_count_expression(90_300).contains("indnkeyatts"));
    assert!(!postgres_index_key_count_expression(100_000).contains("indnkeyatts"));
    assert_eq!(
        postgres_index_key_count_expression(110_000),
        "ix.indnkeyatts"
    );
}

#[test]
fn tracked_query_guard_removes_active_query_on_drop() {
    let active_queries = StdMutex::new(HashMap::from([("q1".to_string(), 42)]));

    {
        let _guard = PostgresTrackedQueryGuard {
            active_queries: &active_queries,
            query_id: Some("q1".to_string()),
        };
    }

    assert!(!active_queries
        .lock()
        .expect("active query map mutex poisoned")
        .contains_key("q1"));
}

#[test]
fn drain_active_query_backends_clears_tracked_queries() {
    let driver = PostgresDriver::new("postgres://user:pass@localhost/db");
    driver
        .active_queries
        .lock()
        .expect("active query map mutex poisoned")
        .extend([("q1".to_string(), 41), ("q2".to_string(), 42)]);

    let mut drained = driver.drain_active_query_backends();
    drained.sort_by(|left, right| left.0.cmp(&right.0));

    assert_eq!(
        drained,
        vec![("q1".to_string(), 41), ("q2".to_string(), 42)]
    );
    assert!(driver
        .active_queries
        .lock()
        .expect("active query map mutex poisoned")
        .is_empty());
}

#[test]
fn remove_active_query_backend_only_removes_matching_backend() {
    let driver = PostgresDriver::new("postgres://user:pass@localhost/db");
    driver
        .active_queries
        .lock()
        .expect("active query map mutex poisoned")
        .insert("q1".to_string(), 41);

    driver.remove_active_query_backend_if_matches("q1", 42);
    assert_eq!(driver.active_query_backend("q1"), Some(41));

    driver.remove_active_query_backend_if_matches("q1", 41);
    assert_eq!(driver.active_query_backend("q1"), None);
}

#[tokio::test]
async fn cancel_query_retains_tracking_when_postgres_pool_is_unavailable() {
    let driver = PostgresDriver::new("postgres://user:pass@localhost/db");
    driver
        .active_queries
        .lock()
        .expect("active query map mutex poisoned")
        .insert("q1".to_string(), 42);

    let error = driver
        .cancel_query("q1")
        .await
        .expect_err("missing pool should fail cancellation");

    assert!(error.to_string().contains("Not connected"));
    assert_eq!(driver.active_query_backend("q1"), Some(42));
}

#[test]
fn metadata_options_select_database_without_rewriting_connection_url() {
    let driver = PostgresDriver::new(
        "postgres://user:pass@db.internal:5432/source?sslmode=require&application_name=oxide",
    );

    let options = driver
        .metadata_connect_options("customer data")
        .expect("metadata options should preserve the base connection settings");

    assert_eq!(options.get_database(), Some("customer data"));
    assert_eq!(options.get_host(), "db.internal");
    assert_eq!(options.get_port(), 5432);
    assert!(driver.metadata_connect_options("").is_err());
    assert!(driver.metadata_connect_options("bad\0name").is_err());
}

#[tokio::test]
async fn disconnect_clears_and_closes_postgres_pool() {
    let driver = PostgresDriver::new("postgres://user:pass@localhost/db");
    let options = PgConnectOptions::from_str("postgres://user:pass@localhost/db")
        .expect("test connection options should parse")
        .disable_statement_logging()
        .statement_cache_capacity(0)
        .to_owned();
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy_with(options);
    let metadata_options = driver
        .metadata_connect_options("analytics")
        .expect("metadata connection options should parse");
    let metadata_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy_with(metadata_options);

    {
        let mut current_pool = driver.pool.lock().await;
        *current_pool = Some(pool.clone());
    }
    {
        let mut current_metadata_pool = driver.metadata_pool.lock().await;
        *current_metadata_pool = Some(PostgresMetadataPool {
            database: "analytics".to_string(),
            pool: metadata_pool.clone(),
        });
    }

    driver
        .disconnect()
        .await
        .expect("disconnect should close a lazy pool");

    assert!(driver.pool.lock().await.is_none());
    assert!(pool.is_closed());
    assert!(driver.metadata_pool.lock().await.is_none());
    assert!(metadata_pool.is_closed());
}
