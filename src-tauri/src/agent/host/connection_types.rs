use crate::core::config::SavedConnection as ConfigSavedConnection;
use crate::core::dialect::DatabaseCapabilities;

#[derive(Clone)]
pub(super) struct ConnectedAgentTarget {
    pub(super) project_id: String,
    pub(super) config_digest: String,
}

pub(super) struct ResolvedAgentConnection {
    pub(super) id: String,
    pub(super) driver: String,
    pub(super) capabilities: DatabaseCapabilities,
    pub(super) sidecar_read_only_enforced: bool,
    pub(super) config: ConfigSavedConnection,
    pub(super) config_digest: String,
    pub(super) database: Option<String>,
    pub(super) namespace: String,
}
