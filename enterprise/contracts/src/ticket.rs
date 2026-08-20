use crate::{AccessAction, AuthorizationRequest, ENTERPRISE_CONTRACT_VERSION};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use uuid::Uuid;
use zeroize::Zeroize;

pub const DEFAULT_ACCESS_TICKET_TTL_SECONDS: i64 = 60;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessSessionClaims {
    pub version: u16,
    pub issuer: String,
    pub audience: Uuid,
    pub principal_id: Uuid,
    pub device_id: Uuid,
    /// SHA-256 fingerprint of the client mTLS leaf certificate. The Gateway
    /// extracts its peer certificate for every RPC and compares this value.
    pub device_certificate_fingerprint: String,
    pub organization_id: Uuid,
    pub project_id: Uuid,
    pub data_source_id: Uuid,
    pub actions: BTreeSet<AccessAction>,
    pub resource_path: Vec<String>,
    /// Effective permit scopes for the ticket action. Discovery may expose
    /// ancestors of these paths, but never unrelated siblings.
    #[serde(default)]
    pub allowed_resource_paths: Vec<Vec<String>>,
    /// Explicit exclusions below the granted resource path. Gateway metadata
    /// and SQL adapters must apply these before returning child resources.
    #[serde(default)]
    pub forbidden_resource_paths: Vec<Vec<String>>,
    pub policy_revision: String,
    pub nonce: Uuid,
    pub issued_at: i64,
    pub expires_at: i64,
    pub max_rows: u32,
    pub max_result_bytes: u64,
}

impl AccessSessionClaims {
    pub fn authorizes(
        &self,
        request: &AuthorizationRequest,
        expected_gateway: Uuid,
        now: i64,
    ) -> Result<(), TicketError> {
        if self.version != ENTERPRISE_CONTRACT_VERSION {
            return Err(TicketError::UnsupportedVersion(self.version));
        }
        if self.audience != expected_gateway {
            return Err(TicketError::AudienceMismatch);
        }
        if now < self.issued_at - 30 || now >= self.expires_at {
            return Err(TicketError::Expired);
        }
        if self.principal_id != request.principal_id
            || self.organization_id != request.organization_id
            || self.project_id != request.project_id
            || self.data_source_id != request.data_source_id
        {
            return Err(TicketError::ScopeMismatch);
        }
        let within_allowed_path = self.allowed_resource_paths.iter().any(|scope| {
            path_is_within(&request.resource_path, scope)
                || (request.action == AccessAction::ResourceDiscover
                    && path_is_within(scope, &request.resource_path))
        });
        if !self.actions.contains(&request.action)
            || !path_is_within(&request.resource_path, &self.resource_path)
            || !within_allowed_path
            || self
                .forbidden_resource_paths
                .iter()
                .any(|scope| path_is_within(&request.resource_path, scope))
        {
            return Err(TicketError::ActionNotGranted);
        }
        Ok(())
    }

    pub fn authorizes_device_certificate(
        &self,
        peer_certificate_fingerprint: &str,
    ) -> Result<(), TicketError> {
        if self.device_certificate_fingerprint != peer_certificate_fingerprint {
            return Err(TicketError::DeviceCertificateMismatch);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AccessSessionTicket(pub String);

pub struct TicketSigner {
    key: SigningKey,
}

impl TicketSigner {
    pub fn from_bytes(mut bytes: [u8; 32]) -> Self {
        let key = SigningKey::from_bytes(&bytes);
        bytes.zeroize();
        Self { key }
    }

    pub fn verifying_key(&self) -> VerifyingKey {
        self.key.verifying_key()
    }

    pub fn sign(&self, claims: &AccessSessionClaims) -> Result<AccessSessionTicket, TicketError> {
        let payload =
            serde_json::to_vec(claims).map_err(|error| TicketError::Encoding(error.to_string()))?;
        let signature = self.key.sign(&payload);
        Ok(AccessSessionTicket(format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(payload),
            URL_SAFE_NO_PAD.encode(signature.to_bytes())
        )))
    }
}

pub fn verify_ticket(
    ticket: &AccessSessionTicket,
    key: &VerifyingKey,
) -> Result<AccessSessionClaims, TicketError> {
    let (payload, signature) = ticket.0.split_once('.').ok_or(TicketError::Malformed)?;
    let payload = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| TicketError::Malformed)?;
    let signature = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| TicketError::Malformed)?;
    let signature_bytes: [u8; 64] = signature.try_into().map_err(|_| TicketError::Malformed)?;
    let signature = Signature::from_bytes(&signature_bytes);
    key.verify(&payload, &signature)
        .map_err(|_| TicketError::InvalidSignature)?;
    serde_json::from_slice(&payload).map_err(|error| TicketError::Encoding(error.to_string()))
}

fn path_is_within(resource: &[String], scope: &[String]) -> bool {
    scope.len() <= resource.len()
        && scope
            .iter()
            .zip(resource.iter())
            .all(|(expected, actual)| expected == actual)
}

#[derive(Debug, thiserror::Error)]
pub enum TicketError {
    #[error("access ticket is malformed")]
    Malformed,
    #[error("access ticket signature is invalid")]
    InvalidSignature,
    #[error("access ticket has expired or is not active")]
    Expired,
    #[error("access ticket audience does not match this gateway")]
    AudienceMismatch,
    #[error("access ticket scope does not match the request")]
    ScopeMismatch,
    #[error("access ticket is not bound to this device certificate")]
    DeviceCertificateMismatch,
    #[error("access ticket does not grant the requested action or resource")]
    ActionNotGranted,
    #[error("access ticket contract version {0} is unsupported")]
    UnsupportedVersion(u16),
    #[error("access ticket encoding failed: {0}")]
    Encoding(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::certificate_fingerprint;

    fn claims(now: i64) -> AccessSessionClaims {
        AccessSessionClaims {
            version: ENTERPRISE_CONTRACT_VERSION,
            issuer: "oxide-control-plane".into(),
            audience: Uuid::new_v4(),
            principal_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            device_certificate_fingerprint: certificate_fingerprint(b"device certificate"),
            organization_id: Uuid::new_v4(),
            project_id: Uuid::new_v4(),
            data_source_id: Uuid::new_v4(),
            actions: BTreeSet::from([AccessAction::QueryRead]),
            resource_path: vec!["warehouse".into(), "public".into()],
            allowed_resource_paths: vec![vec!["warehouse".into(), "public".into()]],
            forbidden_resource_paths: Vec::new(),
            policy_revision: "policy-8".into(),
            nonce: Uuid::new_v4(),
            issued_at: now,
            expires_at: now + DEFAULT_ACCESS_TICKET_TTL_SECONDS,
            max_rows: 200,
            max_result_bytes: 262_144,
        }
    }

    #[test]
    fn signed_tickets_are_verified_and_scoped() {
        let signer = TicketSigner::from_bytes([7; 32]);
        let now = 1_900_000_000;
        let claims = claims(now);
        let ticket = signer.sign(&claims).unwrap();
        let decoded = verify_ticket(&ticket, &signer.verifying_key()).unwrap();
        assert_eq!(decoded, claims);

        let request = AuthorizationRequest {
            principal_id: claims.principal_id,
            organization_id: claims.organization_id,
            project_id: claims.project_id,
            data_source_id: claims.data_source_id,
            resource_path: vec!["warehouse".into(), "public".into(), "orders".into()],
            action: AccessAction::QueryRead,
        };
        decoded
            .authorizes(&request, claims.audience, now + 1)
            .unwrap();
    }

    #[test]
    fn tampered_tickets_are_rejected() {
        let signer = TicketSigner::from_bytes([9; 32]);
        let mut ticket = signer.sign(&claims(1_900_000_000)).unwrap();
        ticket.0.replace_range(0..1, "A");
        assert!(matches!(
            verify_ticket(&ticket, &signer.verifying_key()),
            Err(TicketError::InvalidSignature | TicketError::Malformed)
        ));
    }

    #[test]
    fn tickets_are_bound_to_the_presented_device_certificate() {
        let claims = claims(1_900_000_000);
        assert!(claims
            .authorizes_device_certificate(&claims.device_certificate_fingerprint)
            .is_ok());
        assert!(matches!(
            claims.authorizes_device_certificate(&certificate_fingerprint(b"other device")),
            Err(TicketError::DeviceCertificateMismatch)
        ));
    }

    #[test]
    fn explicit_exclusions_override_parent_ticket_scope() {
        let now = 1_900_000_000;
        let mut claims = claims(now);
        claims.forbidden_resource_paths = vec![vec![
            "warehouse".into(),
            "public".into(),
            "private_orders".into(),
        ]];
        let denied = AuthorizationRequest {
            principal_id: claims.principal_id,
            organization_id: claims.organization_id,
            project_id: claims.project_id,
            data_source_id: claims.data_source_id,
            resource_path: vec!["warehouse".into(), "public".into(), "private_orders".into()],
            action: AccessAction::QueryRead,
        };
        assert!(matches!(
            claims.authorizes(&denied, claims.audience, now + 1),
            Err(TicketError::ActionNotGranted)
        ));
    }
}
