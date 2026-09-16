use super::models::{CachedDriver, DataPlaneService};
use crate::config::{
    allows_insecure_transport, database_target_binding, validate_connection_transport,
    DataSourceConfig,
};
use oxide_studio_lib::{core::driver::DatabaseDriver, drivers::connect_driver};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tonic::Status;
use uuid::Uuid;
impl DataPlaneService {
    pub(super) async fn driver(&self, source_id: Uuid) -> Result<Arc<dyn DatabaseDriver>, Status> {
        let cached = self.drivers.lock().await.get(&source_id).cloned();
        if let Some(cached) = cached {
            if cached
                .expires_at
                .is_none_or(|expires_at| expires_at > Instant::now())
            {
                return Ok(cached.driver);
            }
            self.drivers.lock().await.remove(&source_id);
            if let Err(error) = cached.driver.disconnect().await {
                tracing::warn!(
                    data_source_id = %source_id,
                    error = %error,
                    "expired managed database session could not be closed cleanly"
                );
            }
        }
        let source = self
            .sources
            .get(&source_id)
            .ok_or_else(|| Status::not_found("managed data source is not configured"))?;
        let secret = self
            .secrets
            .resolve(&source.secret_ref, source.connection_template.as_deref())
            .await
            .map_err(|error| {
                tracing::warn!(
                    data_source_id = %source_id,
                    error = %error,
                    "gateway could not resolve data source secret"
                );
                Status::unavailable("managed data source credential is unavailable")
            })?;
        let expires_at = secret.lease_duration().map(|duration| {
            let safety_window = if duration > Duration::from_secs(30) {
                Duration::from_secs(15)
            } else {
                duration / 2
            };
            Instant::now() + duration.saturating_sub(safety_window)
        });
        validate_connection_transport(
            &source.driver,
            secret.connection_url(),
            allows_insecure_transport(source, self.allow_insecure_database_transport),
        )
        .map_err(|error| {
            tracing::warn!(
                data_source_id = %source_id,
                driver = %source.driver,
                error = %error,
                "gateway rejected a database connection without verified transport"
            );
            Status::failed_precondition(
                "managed data source requires a verified database TLS connection",
            )
        })?;
        if database_target_binding(&source.driver, secret.connection_url())
            .map_err(|_| Status::failed_precondition("managed data source target is invalid"))?
            != source.target_binding
        {
            tracing::warn!(data_source_id = %source_id, "gateway rejected a resolved data source target binding mismatch");
            return Err(Status::failed_precondition(
                "managed data source target binding does not match its registered source",
            ));
        }
        let driver = connect_driver(&source.driver, secret.connection_url())
            .await
            .map_err(|error| {
                tracing::warn!(
                    data_source_id = %source_id,
                    driver = %source.driver,
                    error = %oxide_studio_lib::core::redaction::redact_connection_url(&error.to_string()),
                    "gateway connection failed"
                );
                Status::unavailable("managed data source connection failed")
            })?;
        let driver: Arc<dyn DatabaseDriver> = Arc::from(driver);
        self.drivers.lock().await.insert(
            source_id,
            CachedDriver {
                driver: driver.clone(),
                expires_at,
            },
        );
        Ok(driver)
    }

    pub(super) fn require_source(&self, source_id: Uuid) -> Result<&DataSourceConfig, Status> {
        self.sources
            .get(&source_id)
            .ok_or_else(|| Status::not_found("managed data source is not configured"))
    }
}
