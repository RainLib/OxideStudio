use crate::{config::DataSourceConfig, revocation::RevocationState, secret::SecretProvider};
use ed25519_dalek::VerifyingKey;
use oxide_studio_lib::core::driver::DatabaseDriver;
use std::{collections::HashMap, sync::Arc, time::Instant};
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct DataPlaneService {
    pub(super) gateway_id: Uuid,
    pub(super) verifying_key: VerifyingKey,
    pub(super) sources: HashMap<Uuid, DataSourceConfig>,
    pub(super) secrets: Arc<dyn SecretProvider>,
    pub(super) revocations: Arc<RevocationState>,
    pub(super) allow_insecure_database_transport: bool,
    pub(super) drivers: Mutex<HashMap<Uuid, CachedDriver>>,
}
#[derive(Clone)]
pub(super) struct CachedDriver {
    pub(super) driver: Arc<dyn DatabaseDriver>,
    pub(super) expires_at: Option<Instant>,
}
impl DataPlaneService {
    pub fn new(
        gateway_id: Uuid,
        verifying_key: VerifyingKey,
        sources: HashMap<Uuid, DataSourceConfig>,
        secrets: Arc<dyn SecretProvider>,
        revocations: Arc<RevocationState>,
        allow_insecure_database_transport: bool,
    ) -> Self {
        Self {
            gateway_id,
            verifying_key,
            sources,
            secrets,
            revocations,
            allow_insecure_database_transport,
            drivers: Mutex::new(HashMap::new()),
        }
    }
}
