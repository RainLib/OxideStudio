use crate::config::AuditWebhookConfig;
use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;
use sqlx::{PgPool, Row};
use std::time::Duration;
use tokio::time;
use uuid::Uuid;

const OUTBOX_BATCH_SIZE: i64 = 50;
const OUTBOX_LEASE_SECONDS: i64 = 30;
const OUTBOX_POLL_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug)]
struct OutboxEvent {
    audit_event_id: Uuid,
    payload: Value,
    attempts: i32,
}

pub fn spawn(pool: PgPool, sink: AuditWebhookConfig) {
    tokio::spawn(async move {
        let client = match Client::builder().build() {
            Ok(client) => client,
            Err(error) => {
                tracing::error!(error = %error, "audit outbox delivery client could not start");
                return;
            }
        };
        loop {
            if let Err(error) = dispatch_available(&pool, &client, &sink).await {
                tracing::warn!(error = %error, "audit outbox dispatch pass failed");
            }
            time::sleep(OUTBOX_POLL_INTERVAL).await;
        }
    });
}

async fn dispatch_available(
    pool: &PgPool,
    client: &Client,
    sink: &AuditWebhookConfig,
) -> Result<()> {
    for event in claim_available(pool).await? {
        let result = client
            .post(sink.endpoint.clone())
            .bearer_auth(&sink.bearer_token)
            .header("x-oxide-audit-event-id", event.audit_event_id.to_string())
            .json(&serde_json::json!({
                "schema": "oxide.audit.v1",
                "event": event.payload,
            }))
            .send()
            .await;
        match result {
            Ok(response) if response.status().is_success() => {
                mark_delivered(pool, event.audit_event_id).await?;
            }
            Ok(response) => {
                mark_retry(pool, event.audit_event_id, event.attempts).await?;
                tracing::warn!(
                    audit_event_id = %event.audit_event_id,
                    status = %response.status(),
                    "audit outbox endpoint rejected an event"
                );
            }
            Err(error) => {
                mark_retry(pool, event.audit_event_id, event.attempts).await?;
                tracing::warn!(
                    audit_event_id = %event.audit_event_id,
                    error = %error,
                    "audit outbox delivery request failed"
                );
            }
        }
    }
    Ok(())
}

async fn claim_available(pool: &PgPool) -> Result<Vec<OutboxEvent>> {
    let rows = sqlx::query(
        "WITH candidate AS (
           SELECT audit_event_id
           FROM audit_outbox
           WHERE delivered_at IS NULL
             AND next_attempt_at <= now()
             AND (lease_expires_at IS NULL OR lease_expires_at <= now())
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE audit_outbox outbox
         SET attempts = outbox.attempts + 1,
             last_attempt_at = now(),
             lease_expires_at = now() + make_interval(secs => $2::double precision)
         FROM candidate
         WHERE outbox.audit_event_id = candidate.audit_event_id
         RETURNING outbox.audit_event_id, outbox.payload, outbox.attempts",
    )
    .bind(OUTBOX_BATCH_SIZE)
    .bind(OUTBOX_LEASE_SECONDS)
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(OutboxEvent {
                audit_event_id: row.try_get("audit_event_id")?,
                payload: row.try_get("payload")?,
                attempts: row.try_get("attempts")?,
            })
        })
        .collect()
}

async fn mark_delivered(pool: &PgPool, audit_event_id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE audit_outbox
         SET delivered_at = now(), lease_expires_at = NULL, last_error = NULL
         WHERE audit_event_id = $1 AND delivered_at IS NULL",
    )
    .bind(audit_event_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_retry(pool: &PgPool, audit_event_id: Uuid, attempts: i32) -> Result<()> {
    let retry_at =
        chrono::Utc::now() + chrono::Duration::seconds(retry_delay(attempts).as_secs() as i64);
    sqlx::query(
        "UPDATE audit_outbox
         SET lease_expires_at = NULL, next_attempt_at = $2, last_error = 'delivery failed'
         WHERE audit_event_id = $1 AND delivered_at IS NULL",
    )
    .bind(audit_event_id)
    .bind(retry_at)
    .execute(pool)
    .await
    .context("failed to schedule audit outbox retry")?;
    Ok(())
}

fn retry_delay(attempts: i32) -> Duration {
    Duration::from_secs(2_i64.pow(attempts.clamp(1, 8) as u32) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_backoff_is_bounded() {
        assert_eq!(retry_delay(1), Duration::from_secs(2));
        assert_eq!(retry_delay(8), Duration::from_secs(256));
        assert_eq!(retry_delay(100), Duration::from_secs(256));
    }
}
