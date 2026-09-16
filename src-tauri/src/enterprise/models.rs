use anyhow::{anyhow, Result};
use oxide_enterprise_contracts::{AccessAction, ManagedProject, OrganizationMembership, User};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;
use zeroize::Zeroize;

use super::support::{normalize_optional_path, normalized_https_url};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnterprisePublicConfig {
    pub control_plane_url: String,
    pub oidc_issuer: String,
    pub oidc_client_id: String,
    #[serde(default)]
    pub gateway_ca_certificate_path: Option<String>,
    #[serde(default)]
    pub gateway_client_certificate_path: Option<String>,
    #[serde(default)]
    pub gateway_client_private_key_path: Option<String>,
}

impl EnterprisePublicConfig {
    pub(super) fn normalized(mut self) -> Result<Self> {
        self.control_plane_url = normalized_https_url(&self.control_plane_url, "control plane")?;
        self.oidc_issuer = normalized_https_url(&self.oidc_issuer, "OIDC issuer")?;
        self.oidc_client_id = self.oidc_client_id.trim().to_string();
        if self.oidc_client_id.is_empty() || self.oidc_client_id.len() > 256 {
            return Err(anyhow!(
                "OIDC client id must contain between 1 and 256 characters"
            ));
        }
        normalize_optional_path(&mut self.gateway_ca_certificate_path);
        normalize_optional_path(&mut self.gateway_client_certificate_path);
        normalize_optional_path(&mut self.gateway_client_private_key_path);
        let configured_tls_paths = [
            self.gateway_ca_certificate_path.is_some(),
            self.gateway_client_certificate_path.is_some(),
            self.gateway_client_private_key_path.is_some(),
        ];
        if configured_tls_paths.iter().any(|configured| *configured)
            && !configured_tls_paths.iter().all(|configured| *configured)
        {
            return Err(anyhow!(
                "Gateway CA, client certificate, and client private key paths must be configured together"
            ));
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnterpriseAccountStatus {
    pub configured: bool,
    pub state: EnterpriseAccountState,
    pub user: Option<User>,
    pub memberships: Vec<OrganizationMembership>,
    pub managed_projects: Vec<ManagedProject>,
    pub sync_error: Option<String>,
}

impl EnterpriseAccountStatus {
    pub(super) fn anonymous(configured: bool, sync_error: Option<String>) -> Self {
        Self {
            configured,
            state: EnterpriseAccountState::Anonymous,
            user: None,
            memberships: Vec::new(),
            managed_projects: Vec::new(),
            sync_error,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EnterpriseAccountState {
    Anonymous,
    Authenticated,
}

#[derive(Debug, Deserialize)]
pub(super) struct OidcDiscovery {
    pub(super) authorization_endpoint: String,
    pub(super) token_endpoint: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct TokenResponse {
    pub(super) access_token: String,
    pub(super) refresh_token: Option<String>,
    pub(super) expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AccessSessionResponse {
    pub(super) ticket: String,
    pub(super) expires_at: i64,
    pub(super) policy_revision: String,
    pub(super) gateway_endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MeResponse {
    pub(super) user: User,
    pub(super) memberships: Vec<OrganizationMembership>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedAccessSessionRequest {
    pub organization_id: uuid::Uuid,
    pub project_id: uuid::Uuid,
    pub data_source_id: uuid::Uuid,
    pub action: AccessAction,
    #[serde(default)]
    pub resource_path: Vec<String>,
    pub max_rows: Option<u32>,
    pub max_result_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAccessSession {
    pub principal_id: uuid::Uuid,
    pub ticket: String,
    pub expires_at: i64,
    pub policy_revision: String,
    pub gateway_endpoint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedDeviceEnrollment {
    pub device_id: uuid::Uuid,
    pub certificate_fingerprint: String,
}

pub(super) struct EnterpriseSession {
    pub(super) access_token: String,
    pub(super) expires_at: i64,
    pub(super) status: EnterpriseAccountStatus,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EnterpriseCacheEnvelope {
    pub(super) saved_at: i64,
    pub(super) status: EnterpriseAccountStatus,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EncryptedEnterpriseCache {
    pub(super) nonce: Vec<u8>,
    pub(super) ciphertext: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EncryptedEnterpriseSession {
    pub(super) nonce: Vec<u8>,
    pub(super) ciphertext: Vec<u8>,
}

impl Drop for EnterpriseSession {
    fn drop(&mut self) {
        self.access_token.zeroize();
    }
}

#[derive(Clone)]
pub struct EnterpriseClient {
    pub(super) app: AppHandle,
    pub(super) http: reqwest::Client,
    pub(super) session: Arc<Mutex<Option<EnterpriseSession>>>,
    pub(super) operation: Arc<Mutex<()>>,
}
