use super::models::{
    DriverRuntimeEventKind, DriverRuntimeTelemetryRecord, MetaStore,
    DRIVER_RUNTIME_TELEMETRY_MAX_ROWS, DRIVER_RUNTIME_TELEMETRY_RETENTION_MS,
};
use anyhow::{anyhow, Result};
use sqlx::Row;

impl MetaStore {
    pub async fn record_driver_runtime_event(
        &self,
        driver: &str,
        package_version: &str,
        event: DriverRuntimeEventKind,
        occurred_at_millis: u64,
    ) -> Result<()> {
        if !crate::core::driver_package::is_safe_driver_package_token(driver)
            || !crate::core::driver_package::is_safe_driver_package_token(package_version)
        {
            anyhow::bail!("driver runtime telemetry identity is invalid");
        }
        let occurred_at = i64::try_from(occurred_at_millis)
            .map_err(|_| anyhow!("driver runtime telemetry timestamp is invalid"))?;
        let (launch, exit, attempt, success, failure, blocked) = match event {
            DriverRuntimeEventKind::Launched => (1_i64, 0, 0, 0, 0, 0),
            DriverRuntimeEventKind::Exited => (0, 1, 0, 0, 0, 0),
            DriverRuntimeEventKind::ReconnectAttempted => (0, 0, 1, 0, 0, 0),
            DriverRuntimeEventKind::ReconnectSucceeded => (0, 0, 0, 1, 0, 0),
            DriverRuntimeEventKind::ReconnectFailed => (0, 0, 0, 0, 1, 0),
            DriverRuntimeEventKind::ReconnectBudgetBlocked => (0, 0, 0, 0, 0, 1),
        };
        let started_at = (event == DriverRuntimeEventKind::Launched).then_some(occurred_at);
        let exited_at = (event == DriverRuntimeEventKind::Exited).then_some(occurred_at);
        let reconnect_at = matches!(
            event,
            DriverRuntimeEventKind::ReconnectAttempted
                | DriverRuntimeEventKind::ReconnectSucceeded
                | DriverRuntimeEventKind::ReconnectFailed
                | DriverRuntimeEventKind::ReconnectBudgetBlocked
        )
        .then_some(occurred_at);

        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            INSERT INTO driver_runtime_telemetry
                (driver_id, package_version, launch_count, observed_exit_count,
                 reconnect_attempt_count, reconnect_success_count,
                 reconnect_failure_count, reconnect_budget_block_count,
                 last_event_code, last_event_at, last_started_at,
                 last_exit_observed_at, last_reconnect_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(driver_id, package_version) DO UPDATE SET
                launch_count = launch_count + excluded.launch_count,
                observed_exit_count = observed_exit_count + excluded.observed_exit_count,
                reconnect_attempt_count = reconnect_attempt_count + excluded.reconnect_attempt_count,
                reconnect_success_count = reconnect_success_count + excluded.reconnect_success_count,
                reconnect_failure_count = reconnect_failure_count + excluded.reconnect_failure_count,
                reconnect_budget_block_count = reconnect_budget_block_count + excluded.reconnect_budget_block_count,
                last_event_code = CASE
                    WHEN excluded.last_event_at >= last_event_at THEN excluded.last_event_code
                    ELSE last_event_code
                END,
                last_event_at = MAX(last_event_at, excluded.last_event_at),
                last_started_at = CASE
                    WHEN excluded.last_started_at IS NULL THEN last_started_at
                    ELSE MAX(COALESCE(last_started_at, excluded.last_started_at), excluded.last_started_at)
                END,
                last_exit_observed_at = CASE
                    WHEN excluded.last_exit_observed_at IS NULL THEN last_exit_observed_at
                    ELSE MAX(COALESCE(last_exit_observed_at, excluded.last_exit_observed_at), excluded.last_exit_observed_at)
                END,
                last_reconnect_at = CASE
                    WHEN excluded.last_reconnect_at IS NULL THEN last_reconnect_at
                    ELSE MAX(COALESCE(last_reconnect_at, excluded.last_reconnect_at), excluded.last_reconnect_at)
                END
            "#,
        )
        .bind(driver)
        .bind(package_version)
        .bind(launch)
        .bind(exit)
        .bind(attempt)
        .bind(success)
        .bind(failure)
        .bind(blocked)
        .bind(event.as_str())
        .bind(occurred_at)
        .bind(started_at)
        .bind(exited_at)
        .bind(reconnect_at)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM driver_runtime_telemetry WHERE last_event_at < ?")
            .bind(occurred_at.saturating_sub(DRIVER_RUNTIME_TELEMETRY_RETENTION_MS))
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            r#"
            DELETE FROM driver_runtime_telemetry
            WHERE rowid IN (
                SELECT rowid FROM driver_runtime_telemetry
                ORDER BY last_event_at DESC, driver_id, package_version
                LIMIT -1 OFFSET ?
            )
            "#,
        )
        .bind(DRIVER_RUNTIME_TELEMETRY_MAX_ROWS)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn list_driver_runtime_telemetry(&self) -> Result<Vec<DriverRuntimeTelemetryRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT driver_id, package_version, launch_count, observed_exit_count,
                   reconnect_attempt_count, reconnect_success_count,
                   reconnect_failure_count, reconnect_budget_block_count,
                   last_event_code, last_event_at, last_started_at,
                   last_exit_observed_at, last_reconnect_at
            FROM driver_runtime_telemetry
            ORDER BY driver_id, package_version
            LIMIT ?
            "#,
        )
        .bind(DRIVER_RUNTIME_TELEMETRY_MAX_ROWS)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let nonnegative = |name: &str| -> Result<u64> {
                    u64::try_from(row.try_get::<i64, _>(name)?)
                        .map_err(|_| anyhow!("driver runtime telemetry counter is invalid"))
                };
                let optional_nonnegative = |name: &str| -> Result<Option<u64>> {
                    row.try_get::<Option<i64>, _>(name)?
                        .map(|value| {
                            u64::try_from(value).map_err(|_| {
                                anyhow!("driver runtime telemetry timestamp is invalid")
                            })
                        })
                        .transpose()
                };
                let last_event_code: String = row.try_get("last_event_code")?;
                if !DriverRuntimeEventKind::is_known_code(&last_event_code) {
                    anyhow::bail!("driver runtime telemetry event code is invalid");
                }
                Ok(DriverRuntimeTelemetryRecord {
                    driver: row.try_get("driver_id")?,
                    package_version: row.try_get("package_version")?,
                    launch_count: nonnegative("launch_count")?,
                    observed_exit_count: nonnegative("observed_exit_count")?,
                    reconnect_attempt_count: nonnegative("reconnect_attempt_count")?,
                    reconnect_success_count: nonnegative("reconnect_success_count")?,
                    reconnect_failure_count: nonnegative("reconnect_failure_count")?,
                    reconnect_budget_block_count: nonnegative("reconnect_budget_block_count")?,
                    last_event_code,
                    last_event_at_millis: nonnegative("last_event_at")?,
                    last_started_at_millis: optional_nonnegative("last_started_at")?,
                    last_exit_observed_at_millis: optional_nonnegative("last_exit_observed_at")?,
                    last_reconnect_at_millis: optional_nonnegative("last_reconnect_at")?,
                })
            })
            .collect()
    }
}
