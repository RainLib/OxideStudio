use crate::config::{certificate_fingerprint, GatewayConfig};
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::Signer;
use oxide_enterprise_contracts::gateway_revocation_snapshot_signing_message;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::RwLock,
    time::{Duration, Instant},
};
use tonic::Status;
use uuid::Uuid;

pub const REVOCATION_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
pub const MAX_REVOCATION_SNAPSHOT_AGE: Duration = Duration::from_secs(20);

#[derive(Debug)]
pub struct RevocationState {
    snapshot: RwLock<Option<RevocationSnapshot>>,
    maximum_age: Duration,
}

#[derive(Debug)]
struct RevocationSnapshot {
    fetched_at: Instant,
    revoked_certificate_fingerprints: HashSet<String>,
    revoked_access_nonces: HashSet<Uuid>,
}

impl RevocationState {
    pub fn new(maximum_age: Duration) -> Self {
        Self {
            snapshot: RwLock::new(None),
            maximum_age,
        }
    }

    pub fn replace(
        &self,
        revoked_certificate_fingerprints: impl IntoIterator<Item = String>,
        revoked_access_nonces: impl IntoIterator<Item = Uuid>,
    ) {
        let snapshot = RevocationSnapshot {
            fetched_at: Instant::now(),
            revoked_certificate_fingerprints: revoked_certificate_fingerprints
                .into_iter()
                .collect(),
            revoked_access_nonces: revoked_access_nonces.into_iter().collect(),
        };
        if let Ok(mut current) = self.snapshot.write() {
            *current = Some(snapshot);
        }
    }

    pub fn authorize_ticket_nonce(&self, nonce: Uuid) -> Result<(), Status> {
        let snapshot = self
            .snapshot
            .read()
            .map_err(|_| Status::unavailable("Gateway revocation state is unavailable"))?;
        let snapshot = snapshot.as_ref().ok_or_else(|| {
            Status::unavailable("Gateway revocation state has not been initialized")
        })?;
        if snapshot.fetched_at.elapsed() > self.maximum_age {
            return Err(Status::unavailable(
                "Gateway revocation state is stale; retry after the Gateway reconnects to the control plane",
            ));
        }
        if snapshot.revoked_access_nonces.contains(&nonce) {
            return Err(Status::permission_denied(
                "this managed access ticket has been revoked",
            ));
        }
        Ok(())
    }

    /// The data plane fails closed when the control-plane revocation feed is
    /// missing or stale. A refreshed empty snapshot is valid and means no
    /// device certificate has been revoked for this Gateway's organization.
    pub fn authorize_device_certificate(
        &self,
        certificate_fingerprint: &str,
    ) -> Result<(), Status> {
        let snapshot = self
            .snapshot
            .read()
            .map_err(|_| Status::unavailable("Gateway revocation state is unavailable"))?;
        let snapshot = snapshot.as_ref().ok_or_else(|| {
            Status::unavailable("Gateway revocation state has not been initialized")
        })?;
        if snapshot.fetched_at.elapsed() > self.maximum_age {
            return Err(Status::unavailable(
                "Gateway revocation state is stale; retry after the Gateway reconnects to the control plane",
            ));
        }
        if snapshot
            .revoked_certificate_fingerprints
            .contains(certificate_fingerprint)
        {
            return Err(Status::permission_denied(
                "this managed device certificate has been revoked",
            ));
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct RevocationClient {
    gateway_id: uuid::Uuid,
    public_endpoint: String,
    certificate_fingerprint: String,
    signing_key: ed25519_dalek::SigningKey,
    client: Client,
    control_plane_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RevocationSnapshotRequest<'a> {
    gateway_id: uuid::Uuid,
    direct_endpoint: &'a str,
    certificate_fingerprint: &'a str,
    request_signature: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevocationSnapshotResponse {
    revoked_device_certificate_fingerprints: Vec<String>,
    revoked_access_nonces: Vec<Uuid>,
}

impl RevocationClient {
    pub fn from_config(config: &GatewayConfig) -> Result<Self> {
        let fingerprint = certificate_fingerprint(&config.tls_certificate)?;
        let mut client = Client::builder();
        if let Some(certificate) = &config.control_plane_ca_certificate {
            client = client.add_root_certificate(
                reqwest::Certificate::from_pem(certificate)
                    .context("OXIDE_CONTROL_PLANE_CA_CERTIFICATE is not a PEM certificate")?,
            );
        }
        Ok(Self {
            gateway_id: config.id,
            public_endpoint: config.public_endpoint.clone(),
            certificate_fingerprint: fingerprint,
            signing_key: config.enrollment_signing_key.clone(),
            client: client
                .build()
                .context("failed to configure revocation snapshot client")?,
            control_plane_url: config.control_plane_url.clone(),
        })
    }

    pub async fn refresh(&self, state: &RevocationState) -> Result<()> {
        let signature = STANDARD.encode(
            self.signing_key
                .sign(&gateway_revocation_snapshot_signing_message(
                    self.gateway_id,
                    &self.public_endpoint,
                    &self.certificate_fingerprint,
                ))
                .to_bytes(),
        );
        let response = self
            .client
            .post(format!(
                "{}/v1/gateway-revocations/snapshot",
                self.control_plane_url
            ))
            .json(&RevocationSnapshotRequest {
                gateway_id: self.gateway_id,
                direct_endpoint: &self.public_endpoint,
                certificate_fingerprint: &self.certificate_fingerprint,
                request_signature: &signature,
            })
            .send()
            .await
            .context("Gateway revocation snapshot request failed")?;
        if !response.status().is_success() {
            anyhow::bail!(
                "Gateway revocation snapshot was rejected ({})",
                response.status()
            );
        }
        let snapshot = response
            .json::<RevocationSnapshotResponse>()
            .await
            .context("Gateway revocation snapshot response is invalid")?;
        state.replace(
            snapshot.revoked_device_certificate_fingerprints,
            snapshot.revoked_access_nonces,
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uninitialized_or_stale_revocation_state_fails_closed() {
        let state = RevocationState::new(Duration::ZERO);
        assert!(state.authorize_device_certificate("active").is_err());
        state.replace(Vec::<String>::new(), Vec::<Uuid>::new());
        assert!(state.authorize_device_certificate("active").is_err());
    }

    #[test]
    fn a_revoked_certificate_is_denied_from_a_fresh_snapshot() {
        let state = RevocationState::new(Duration::from_secs(60));
        state.replace(["revoked".to_string()], Vec::<Uuid>::new());
        assert!(state.authorize_device_certificate("active").is_ok());
        assert_eq!(
            state
                .authorize_device_certificate("revoked")
                .unwrap_err()
                .code(),
            tonic::Code::PermissionDenied
        );
    }

    #[test]
    fn a_revoked_ticket_nonce_is_denied_from_a_fresh_snapshot() {
        let state = RevocationState::new(Duration::from_secs(60));
        let nonce = Uuid::new_v4();
        state.replace(Vec::<String>::new(), [nonce]);
        assert_eq!(
            state.authorize_ticket_nonce(nonce).unwrap_err().code(),
            tonic::Code::PermissionDenied
        );
    }
}
