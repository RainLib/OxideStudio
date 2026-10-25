use super::*;
use anyhow::ensure;
use std::time::Duration;
use tokio::time::{sleep, timeout, Instant};

#[tokio::test]
async fn postgres_live_cancellation_and_pool_recovery() -> Result<()> {
    if !live_tests_enabled() {
        eprintln!("skipping live PostgreSQL cancellation; set OXIDE_LIVE_DB_TESTS=1");
        return Ok(());
    }
    let url = env::var("TEST_POSTGRES_URL").context("TEST_POSTGRES_URL must be set")?;
    cancellation_flow(DatabaseKind::Postgres, &url).await
}

#[tokio::test]
async fn mysql_live_cancellation_and_pool_recovery() -> Result<()> {
    if !live_tests_enabled() {
        eprintln!("skipping live MySQL cancellation; set OXIDE_LIVE_DB_TESTS=1");
        return Ok(());
    }
    let url = env::var("TEST_MYSQL_URL").context("TEST_MYSQL_URL must be set")?;
    cancellation_flow(DatabaseKind::Mysql, &url).await
}

async fn cancellation_flow(kind: DatabaseKind, url: &str) -> Result<()> {
    let connection_id = format!("live-{}-cancel", kind.as_str());
    let manager = manager_with_connection(kind, url, &connection_id).await?;
    let query_id = unique_name("oxide_live_cancel");
    let mysql_table = (kind == DatabaseKind::Mysql).then(|| mysql_ident(&query_id));
    if let Some(table) = &mysql_table {
        manager
            .query(
                &connection_id,
                &format!(
                    "CREATE TABLE {table} (id INTEGER PRIMARY KEY); INSERT INTO {table} VALUES (1)"
                ),
                None,
                None,
                None,
            )
            .await?;
    }
    let (sql, active_sql) = match kind {
        DatabaseKind::Postgres => (
            format!("SELECT pg_sleep(30), '{query_id}' AS fixture_marker"),
            format!(
                "SELECT COUNT(*) FROM pg_catalog.pg_stat_activity \
                 WHERE pid <> pg_backend_pid() AND state = 'active' \
                 AND query LIKE '%{query_id}%'"
            ),
        ),
        DatabaseKind::Mysql => (
            // A standalone SLEEP can return 1 on interruption without an error.
            // Use the real-table form documented by MySQL to exercise error 1317.
            // https://dev.mysql.com/doc/refman/8.4/en/miscellaneous-functions.html#function_sleep
            format!(
                "SELECT id, '{query_id}' AS fixture_marker FROM {} WHERE SLEEP(30) = 0",
                mysql_table.as_ref().expect("MySQL fixture table")
            ),
            format!(
                "SELECT COUNT(*) FROM information_schema.PROCESSLIST \
                 WHERE ID <> CONNECTION_ID() AND INFO LIKE '%{query_id}%'"
            ),
        ),
    };
    let execution_manager = manager.clone();
    let execution_id = connection_id.clone();
    let execution_query_id = query_id.clone();
    let mut query = tokio::spawn(async move {
        execution_manager
            .query(&execution_id, &sql, None, None, Some(execution_query_id))
            .await
    });
    let result: Result<()> = async {
        // Observe the actual sleeping backend. A local timer alone cannot
        // prove that cancellation reached a query already running on the server.
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let active = timeout(
                Duration::from_secs(3),
                manager.query(&connection_id, &active_sql, None, None, None),
            )
            .await??;
            if scalar_i64(&active)? == 1 {
                break;
            }
            ensure!(
                Instant::now() < deadline,
                "Sleeping fixture query was not observed"
            );
            ensure!(
                !query.is_finished(),
                "Sleeping fixture query exited prematurely"
            );
            sleep(Duration::from_millis(50)).await;
        }
        ensure!(
            timeout(
                Duration::from_secs(5),
                manager.cancel_query(&connection_id, &query_id),
            )
            .await??,
            "The driver did not accept cancellation of the active backend"
        );
        let response = timeout(Duration::from_secs(5), &mut query).await??;
        ensure!(
            response.is_err(),
            "The cancelled statement must report an error"
        );
        ensure!(
            !manager.cancel_query(&connection_id, &query_id).await?,
            "A finished query must not retain its cancellation handle"
        );
        manager.ping(&connection_id).await?;
        let healthy = manager
            .query(&connection_id, "SELECT 42 AS answer", None, None, None)
            .await?;
        ensure!(
            scalar_i64(&healthy)? == 42,
            "The pool did not recover after cancellation"
        );
        Ok(())
    }
    .await;
    if !query.is_finished() {
        let _ = timeout(
            Duration::from_secs(5),
            manager.cancel_query(&connection_id, &query_id),
        )
        .await;
        query.abort();
        let _ = query.await;
    }
    let cleanup = if let Some(table) = mysql_table {
        timeout(
            Duration::from_secs(10),
            manager.query(
                &connection_id,
                &format!("DROP TABLE IF EXISTS {table}"),
                None,
                None,
                None,
            ),
        )
        .await
        .map_err(anyhow::Error::from)
        .and_then(|result| result.map(|_| ()))
    } else {
        Ok(())
    };
    let disconnected = timeout(
        Duration::from_secs(10),
        manager.disconnect_connection(&connection_id),
    )
    .await?;
    result?;
    cleanup?;
    disconnected
}
