//! Persistent installation barrier. A temporary protocol fence lets older
//! cooperative workers finish their copy and decline new claims without a
//! parse error that could turn an unclaimed queue entry into a failure.
use serde::{Deserialize, Serialize};

pub(super) const UPDATE_PAUSED: &str = "Backups are paused while the application update is prepared. Current work can finish; queued backups are kept";
pub(super) const UPDATE_RECOVERY: &str = "The update has not completed. Close the installer before resuming backups, or finish installing the new version";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum InstallationPhase {
    Preparing,
    Committed,
    Installed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InstallationBarrier {
    pub(super) id: String,
    pub(super) target_version: String,
    pub(super) requested_at: String,
    pub(super) phase: InstallationPhase,
    pub(super) previous_protocol: u16,
}

impl InstallationBarrier {
    pub(super) fn validate(&self, current_version: &str) -> Result<(), String> {
        let target = semver::Version::parse(&self.target_version)
            .map_err(|_| "Invalid application update version")?;
        let current = semver::Version::parse(current_version)
            .map_err(|_| "Invalid current application version")?;
        if uuid::Uuid::parse_str(&self.id).is_err()
            || self.target_version.len() > 80
            || target <= current
            || self.previous_protocol == 0
            || self.previous_protocol == u16::MAX
            || chrono::DateTime::parse_from_rfc3339(&self.requested_at).is_err()
        {
            return Err("Invalid application update barrier".to_string());
        }
        Ok(())
    }
}
