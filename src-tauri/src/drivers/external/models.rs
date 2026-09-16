use crate::core::{
    driver_package::{DatabaseDriverPackageRegistry, InstalledDriverPackage},
    driver_sidecar::DatabaseDriverSidecar,
};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

pub(super) const CONNECTION_TIMEOUT: Duration = Duration::from_secs(10);
pub(super) const QUERY_TIMEOUT: Duration = Duration::from_secs(60);
pub(super) const METADATA_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const MIGRATION_PLAN_TIMEOUT: Duration = Duration::from_secs(60);
pub(super) const MIGRATION_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(60);
pub(super) const MIGRATION_APPLY_TIMEOUT: Duration = Duration::from_secs(10 * 60);
pub(super) const MIGRATION_VERIFY_TIMEOUT: Duration = Duration::from_secs(60);
pub(super) const MAX_MIGRATION_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_MIGRATION_TOKEN_BYTES: usize = 4 * 1024;
pub(super) const MAX_MIGRATION_FINGERPRINT_BYTES: usize = 256;
pub(super) const MAX_MIGRATION_PREVIEW_ITEMS: usize = 10_000;
pub(super) const MAX_MIGRATION_CHECK_ITEMS: usize = 10_000;
pub(super) const MAX_MIGRATION_CHANGE_COUNT: u32 = 100_000;
pub(super) const MAX_MIGRATION_WARNINGS: usize = 1_024;
pub(super) const MAX_MIGRATION_TEXT_BYTES: usize = 16 * 1024;
pub(super) const MAX_MIGRATION_DESCRIPTOR_ITEMS: usize = 200_000;

/// A single connection-scoped sidecar. The sidecar is intentionally not shared
/// between saved connections, so a driver only receives the one selected secret.
pub struct ExternalDriver {
    pub(super) package: InstalledDriverPackage,
    pub(super) registry: DatabaseDriverPackageRegistry,
    pub(super) connection_id: String,
    pub(super) url: String,
    pub(super) process: Mutex<Option<Arc<DatabaseDriverSidecar>>>,
    pub(super) server_version: Mutex<Option<String>>,
    pub(super) capabilities: Mutex<oxide_driver_protocol::DriverRuntimeCapabilities>,
    pub(super) agent_read_only: bool,
}

impl ExternalDriver {
    pub fn new(
        package: InstalledDriverPackage,
        registry: DatabaseDriverPackageRegistry,
        connection_id: String,
        url: String,
    ) -> Self {
        Self {
            package,
            registry,
            connection_id,
            url,
            process: Mutex::new(None),
            server_version: Mutex::new(None),
            capabilities: Mutex::new(Default::default()),
            agent_read_only: false,
        }
    }

    /// Creates an Agent-only sidecar connection. Every query carries the
    /// protocol read-only flag and startup rejects packages that do not
    /// enforce that flag inside their own execution boundary.
    pub fn new_agent_read_only(
        package: InstalledDriverPackage,
        registry: DatabaseDriverPackageRegistry,
        connection_id: String,
        url: String,
    ) -> Self {
        Self {
            agent_read_only: true,
            ..Self::new(package, registry, connection_id, url)
        }
    }

    pub fn package_identity(&self) -> (&str, &str) {
        (
            &self.package.manifest.driver_id,
            &self.package.manifest.package_version,
        )
    }
}
