use sqlx::PgPool;
use uuid::Uuid;

/// The plaintext enrollment token is deliberately returned only at creation
/// time. The database receives its SHA-256 digest, never the token itself.
#[derive(Debug)]
pub struct GatewayRegistration {
    pub id: Uuid,
    pub enrollment_token: String,
    pub enrollment_expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug)]
pub struct GatewayCertificateRotation {
    pub enrollment_token: String,
    pub enrollment_expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug)]
pub struct GatewayRevocationSnapshot {
    pub revoked_device_certificate_fingerprints: Vec<String>,
    pub revoked_access_nonces: Vec<Uuid>,
}

#[derive(Clone)]
pub struct ControlPlaneStore {
    pub(super) pool: PgPool,
}

impl ControlPlaneStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}
