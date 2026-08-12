use crate::core::private_file::{create_private_file, replace_private_file};
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use oxide_enterprise_contracts::{AccessAction, ManagedProject, OrganizationMembership, User};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::Mutex,
    time::timeout,
};
use url::Url;
use zeroize::Zeroize;

mod gateway_driver;
pub use gateway_driver::ManagedGatewayDriver;

const ENTERPRISE_REFRESH_SERVICE: &str = "com.houshuai.oxide-studio.enterprise";
const ENTERPRISE_REFRESH_ACCOUNT: &str = "active-session";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_CALLBACK_BYTES: usize = 16 * 1024;
const ENTERPRISE_CACHE_RETENTION_SECONDS: i64 = 7 * 24 * 60 * 60;
const ENTERPRISE_CACHE_AAD: &[u8] = b"oxide-enterprise-cache-v1";

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
    fn normalized(mut self) -> Result<Self> {
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
    fn anonymous(configured: bool, sync_error: Option<String>) -> Self {
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
struct OidcDiscovery {
    authorization_endpoint: String,
    token_endpoint: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessSessionResponse {
    ticket: String,
    expires_at: i64,
    policy_revision: String,
    gateway_endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeResponse {
    user: User,
    memberships: Vec<OrganizationMembership>,
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

struct EnterpriseSession {
    access_token: String,
    expires_at: i64,
    status: EnterpriseAccountStatus,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnterpriseCacheEnvelope {
    saved_at: i64,
    status: EnterpriseAccountStatus,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedEnterpriseCache {
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

impl Drop for EnterpriseSession {
    fn drop(&mut self) {
        self.access_token.zeroize();
    }
}

#[derive(Clone)]
pub struct EnterpriseClient {
    app: AppHandle,
    http: reqwest::Client,
    session: Arc<Mutex<Option<EnterpriseSession>>>,
    operation: Arc<Mutex<()>>,
}

impl EnterpriseClient {
    pub fn new(app: &AppHandle) -> Self {
        Self {
            app: app.clone(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()
                .expect("enterprise HTTP client configuration is valid"),
            session: Arc::new(Mutex::new(None)),
            operation: Arc::new(Mutex::new(())),
        }
    }

    pub fn load_config(&self) -> Result<Option<EnterprisePublicConfig>> {
        let path = self.config_path()?;
        match fs::read(&path) {
            Ok(bytes) => {
                let config: EnterprisePublicConfig = serde_json::from_slice(&bytes)
                    .context("enterprise account config is invalid")?;
                Ok(Some(config.normalized()?))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).context("failed to read enterprise account config"),
        }
    }

    pub fn save_config(&self, config: EnterprisePublicConfig) -> Result<()> {
        let config = config.normalized()?;
        let payload = serde_json::to_vec_pretty(&config)?;
        replace_private_file(&self.config_path()?, &payload, "enterprise-config")
    }

    pub async fn status(&self) -> EnterpriseAccountStatus {
        if let Some(status) = self.current_status().await {
            return status;
        }
        let configured = self.load_config().ok().flatten().is_some();
        if !configured {
            return EnterpriseAccountStatus::anonymous(false, None);
        }
        let _operation = self.operation.lock().await;
        match self.restore_unlocked().await {
            Ok(Some(status)) => status,
            Ok(None) => EnterpriseAccountStatus::anonymous(true, None),
            Err(error) => {
                let message = user_facing_enterprise_error(&error);
                self.load_cache()
                    .ok()
                    .flatten()
                    .map(|mut cached| {
                        cached.sync_error = Some(format!(
                            "{message} Showing the last encrypted organization snapshot."
                        ));
                        cached
                    })
                    .unwrap_or_else(|| EnterpriseAccountStatus::anonymous(true, Some(message)))
            }
        }
    }

    pub async fn sign_in(&self) -> Result<EnterpriseAccountStatus> {
        let _operation = self.operation.lock().await;
        let config = self
            .load_config()?
            .context("Configure the enterprise control plane before signing in")?;
        let discovery = self.discovery(&config).await?;
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .context("failed to open the local sign-in callback")?;
        let callback_address = listener.local_addr()?;
        let redirect_uri = format!("http://127.0.0.1:{}/callback", callback_address.port());

        let mut verifier_bytes = [0_u8; 32];
        rand::thread_rng().fill_bytes(&mut verifier_bytes);
        let mut verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
        verifier_bytes.zeroize();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut state_bytes = [0_u8; 32];
        rand::thread_rng().fill_bytes(&mut state_bytes);
        let state = URL_SAFE_NO_PAD.encode(state_bytes);
        state_bytes.zeroize();

        let mut authorization_url = Url::parse(&discovery.authorization_endpoint)
            .context("OIDC authorization endpoint is invalid")?;
        authorization_url
            .query_pairs_mut()
            .append_pair("client_id", &config.oidc_client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", "openid profile email offline_access")
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256");
        self.app
            .opener()
            .open_url(authorization_url.as_str(), None::<String>)
            .context("failed to open the system browser")?;

        let (code, returned_state) = timeout(LOGIN_TIMEOUT, receive_callback(listener))
            .await
            .map_err(|_| anyhow!("sign-in timed out before the identity provider returned"))??;
        if returned_state != state {
            return Err(anyhow!("sign-in callback state did not match"));
        }
        let token = self
            .http
            .post(&discovery.token_endpoint)
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", config.oidc_client_id.as_str()),
                ("code", code.as_str()),
                ("redirect_uri", redirect_uri.as_str()),
                ("code_verifier", verifier.as_str()),
            ])
            .send()
            .await
            .context("failed to exchange the authorization code")?
            .error_for_status()
            .context("the identity provider rejected the authorization code")?
            .json::<TokenResponse>()
            .await
            .context("the identity provider returned an invalid token response")?;
        verifier.zeroize();
        self.install_session(&config, token).await
    }

    pub async fn sync(&self) -> Result<EnterpriseAccountStatus> {
        let _operation = self.operation.lock().await;
        let config = self
            .load_config()?
            .context("enterprise account is not configured")?;
        let access_token = {
            let guard = self.session.lock().await;
            guard
                .as_ref()
                .filter(|session| session.expires_at > now_seconds() + 15)
                .map(|session| session.access_token.clone())
        };
        if let Some(mut access_token) = access_token {
            let result = self.fetch_status(&config, &access_token).await;
            access_token.zeroize();
            let status = result?;
            if let Some(session) = self.session.lock().await.as_mut() {
                session.status = status.clone();
            }
            return Ok(status);
        }
        self.restore_unlocked()
            .await?
            .context("Sign in to synchronize managed projects")
    }

    pub async fn sign_out(&self) -> Result<EnterpriseAccountStatus> {
        let _operation = self.operation.lock().await;
        self.session.lock().await.take();
        let refresh_result = delete_refresh_token().await;
        let cache_result = self.delete_cache();
        refresh_result?;
        cache_result?;
        Ok(EnterpriseAccountStatus::anonymous(
            self.load_config()?.is_some(),
            None,
        ))
    }

    pub async fn create_access_session(
        &self,
        input: ManagedAccessSessionRequest,
    ) -> Result<ManagedAccessSession> {
        if input.resource_path.len() > 16
            || input
                .resource_path
                .iter()
                .any(|segment| segment.is_empty() || segment.len() > 256)
        {
            return Err(anyhow!("Managed resource scope is invalid"));
        }
        let _operation = self.operation.lock().await;
        let config = self
            .load_config()?
            .context("enterprise account is not configured")?;
        let mut access_token = match self.current_access_token().await {
            Some(token) => token,
            None => {
                self.restore_unlocked()
                    .await?
                    .context("Sign in before accessing a managed data source")?;
                self.current_access_token()
                    .await
                    .context("enterprise session is unavailable")?
            }
        };
        let request_id = uuid::Uuid::new_v4();
        let device_id = self.load_or_create_device_id()?;
        let response = self
            .http
            .post(format!("{}/v1/access-sessions", config.control_plane_url))
            .bearer_auth(&access_token)
            .json(&serde_json::json!({
                "deviceId": device_id,
                "organizationId": input.organization_id,
                "projectId": input.project_id,
                "dataSourceId": input.data_source_id,
                "action": input.action,
                "resourcePath": input.resource_path,
                "requestId": request_id,
                "source": "desktop",
                "maxRows": input.max_rows,
                "maxResultBytes": input.max_result_bytes,
            }))
            .send()
            .await;
        access_token.zeroize();
        let response = response
            .context("failed to request a managed access session")?
            .error_for_status()
            .context("managed access was denied")?
            .json::<AccessSessionResponse>()
            .await
            .context("managed access response is invalid")?;
        let principal_id = self
            .session
            .lock()
            .await
            .as_ref()
            .and_then(|session| session.status.user.as_ref())
            .map(|user| user.id)
            .context("enterprise identity is unavailable")?;
        Ok(ManagedAccessSession {
            principal_id,
            ticket: response.ticket,
            expires_at: response.expires_at,
            policy_revision: response.policy_revision,
            gateway_endpoint: response.gateway_endpoint,
        })
    }

    pub fn gateway_tls_paths(&self) -> Result<(PathBuf, PathBuf, PathBuf)> {
        let config = self
            .load_config()?
            .context("enterprise account is not configured")?;
        match (
            config.gateway_ca_certificate_path,
            config.gateway_client_certificate_path,
            config.gateway_client_private_key_path,
        ) {
            (Some(ca), Some(certificate), Some(private_key)) => Ok((
                PathBuf::from(ca),
                PathBuf::from(certificate),
                PathBuf::from(private_key),
            )),
            _ => Err(anyhow!(
                "This organization requires a managed Gateway device certificate. Ask your administrator to enroll this device."
            )),
        }
    }

    async fn current_status(&self) -> Option<EnterpriseAccountStatus> {
        let guard = self.session.lock().await;
        guard
            .as_ref()
            .filter(|session| session.expires_at > now_seconds() + 15)
            .map(|session| session.status.clone())
    }

    async fn current_access_token(&self) -> Option<String> {
        let guard = self.session.lock().await;
        guard
            .as_ref()
            .filter(|session| session.expires_at > now_seconds() + 15)
            .map(|session| session.access_token.clone())
    }

    async fn restore_unlocked(&self) -> Result<Option<EnterpriseAccountStatus>> {
        if let Some(status) = self.current_status().await {
            return Ok(Some(status));
        }
        let Some(config) = self.load_config()? else {
            return Ok(None);
        };
        let Some(mut refresh_token) = load_refresh_token().await? else {
            return Ok(None);
        };
        let discovery = self.discovery(&config).await?;
        let response = self
            .http
            .post(&discovery.token_endpoint)
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", config.oidc_client_id.as_str()),
                ("refresh_token", refresh_token.as_str()),
            ])
            .send()
            .await
            .context("failed to refresh the enterprise session")?;
        refresh_token.zeroize();
        if response.status() == reqwest::StatusCode::BAD_REQUEST
            || response.status() == reqwest::StatusCode::UNAUTHORIZED
        {
            let _ = delete_refresh_token().await;
            return Ok(None);
        }
        let token = response
            .error_for_status()
            .context("the identity provider rejected the enterprise session")?
            .json::<TokenResponse>()
            .await
            .context("the identity provider returned an invalid refresh response")?;
        Ok(Some(self.install_session(&config, token).await?))
    }

    async fn install_session(
        &self,
        config: &EnterprisePublicConfig,
        mut token: TokenResponse,
    ) -> Result<EnterpriseAccountStatus> {
        if let Some(refresh_token) = token.refresh_token.as_deref() {
            save_refresh_token(refresh_token).await?;
        }
        let status = self.fetch_status(config, &token.access_token).await?;
        let expires_at = now_seconds() + token.expires_in.unwrap_or(300).clamp(30, 3_600) as i64;
        let access_token = std::mem::take(&mut token.access_token);
        *self.session.lock().await = Some(EnterpriseSession {
            access_token,
            expires_at,
            status: status.clone(),
        });
        Ok(status)
    }

    async fn fetch_status(
        &self,
        config: &EnterprisePublicConfig,
        access_token: &str,
    ) -> Result<EnterpriseAccountStatus> {
        let me = self
            .http
            .get(format!("{}/v1/me", config.control_plane_url))
            .bearer_auth(access_token)
            .send()
            .await
            .context("failed to reach the enterprise control plane")?
            .error_for_status()
            .context("the enterprise control plane rejected the session")?
            .json::<MeResponse>()
            .await
            .context("the enterprise profile response is invalid")?;
        let projects = self
            .http
            .get(format!("{}/v1/managed-projects", config.control_plane_url))
            .bearer_auth(access_token)
            .send()
            .await
            .context("failed to synchronize managed projects")?
            .error_for_status()
            .context("managed project synchronization was rejected")?
            .json::<Vec<ManagedProject>>()
            .await
            .context("the managed project response is invalid")?;
        for project in &projects {
            project.validate()?;
        }
        let status = EnterpriseAccountStatus {
            configured: true,
            state: EnterpriseAccountState::Authenticated,
            user: Some(me.user),
            memberships: me.memberships,
            managed_projects: projects,
            sync_error: None,
        };
        if let Err(error) = self.save_cache(&status) {
            tracing::warn!(
                error = %error,
                "managed project cache could not be updated"
            );
        }
        Ok(status)
    }

    async fn discovery(&self, config: &EnterprisePublicConfig) -> Result<OidcDiscovery> {
        self.http
            .get(format!(
                "{}/.well-known/openid-configuration",
                config.oidc_issuer
            ))
            .send()
            .await
            .context("failed to discover the enterprise identity provider")?
            .error_for_status()
            .context("the enterprise identity provider discovery request failed")?
            .json()
            .await
            .context("the enterprise identity provider discovery response is invalid")
    }

    fn config_path(&self) -> Result<PathBuf> {
        Ok(self
            .app
            .path()
            .app_config_dir()
            .context("failed to resolve the application config directory")?
            .join("enterprise")
            .join("account.json"))
    }

    fn load_or_create_device_id(&self) -> Result<uuid::Uuid> {
        let path = self
            .config_path()?
            .parent()
            .context("enterprise config directory is invalid")?
            .join("device-id");
        match fs::read_to_string(&path) {
            Ok(value) => value
                .trim()
                .parse()
                .context("enterprise device id is invalid"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let device_id = uuid::Uuid::new_v4();
                replace_private_file(
                    &path,
                    device_id.to_string().as_bytes(),
                    "enterprise-device-id",
                )?;
                Ok(device_id)
            }
            Err(error) => Err(error).context("failed to read enterprise device id"),
        }
    }

    fn enterprise_directory(&self) -> Result<PathBuf> {
        self.config_path()?
            .parent()
            .map(PathBuf::from)
            .context("enterprise config directory is invalid")
    }

    fn save_cache(&self, status: &EnterpriseAccountStatus) -> Result<()> {
        let mut plaintext = serde_json::to_vec(&EnterpriseCacheEnvelope {
            saved_at: now_seconds(),
            status: status.clone(),
        })?;
        let mut key = self.load_or_create_cache_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key).context("enterprise cache key is invalid")?;
        let mut nonce_bytes = [0_u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from(nonce_bytes);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: &plaintext,
                    aad: ENTERPRISE_CACHE_AAD,
                },
            )
            .map_err(|_| anyhow!("failed to encrypt enterprise cache"))?;
        plaintext.zeroize();
        key.zeroize();
        replace_private_file(
            &self.enterprise_directory()?.join("managed-cache.json.enc"),
            &serde_json::to_vec(&EncryptedEnterpriseCache {
                nonce: nonce_bytes.to_vec(),
                ciphertext,
            })?,
            "enterprise-cache",
        )
    }

    fn load_cache(&self) -> Result<Option<EnterpriseAccountStatus>> {
        let bytes = match fs::read(self.enterprise_directory()?.join("managed-cache.json.enc")) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error).context("failed to read enterprise cache"),
        };
        let encrypted: EncryptedEnterpriseCache =
            serde_json::from_slice(&bytes).context("enterprise cache is invalid")?;
        let nonce_bytes: [u8; 12] = encrypted
            .nonce
            .try_into()
            .map_err(|_| anyhow!("enterprise cache nonce is invalid"))?;
        let mut key = match self.read_cache_key()? {
            Some(key) => key,
            None => return Ok(None),
        };
        let cipher = Aes256Gcm::new_from_slice(&key).context("enterprise cache key is invalid")?;
        let nonce = Nonce::from(nonce_bytes);
        let mut plaintext = cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: &encrypted.ciphertext,
                    aad: ENTERPRISE_CACHE_AAD,
                },
            )
            .map_err(|_| anyhow!("enterprise cache authentication failed"))?;
        key.zeroize();
        let envelope: EnterpriseCacheEnvelope =
            serde_json::from_slice(&plaintext).context("enterprise cache payload is invalid")?;
        plaintext.zeroize();
        if now_seconds() - envelope.saved_at > ENTERPRISE_CACHE_RETENTION_SECONDS {
            self.delete_cache()?;
            return Ok(None);
        }
        Ok(Some(envelope.status))
    }

    fn load_or_create_cache_key(&self) -> Result<[u8; 32]> {
        if let Some(key) = self.read_cache_key()? {
            return Ok(key);
        }
        let path = self.enterprise_directory()?.join("managed-cache.key");
        let mut key = [0_u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        if create_private_file(&path, &key)? {
            return Ok(key);
        }
        key.zeroize();
        self.read_cache_key()?
            .context("enterprise cache key was not created")
    }

    fn read_cache_key(&self) -> Result<Option<[u8; 32]>> {
        let path = self.enterprise_directory()?.join("managed-cache.key");
        let mut bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error).context("failed to read enterprise cache key"),
        };
        if bytes.len() != 32 {
            bytes.zeroize();
            return Err(anyhow!("enterprise cache key is invalid"));
        }
        let mut key = [0_u8; 32];
        key.copy_from_slice(&bytes);
        bytes.zeroize();
        Ok(Some(key))
    }

    fn delete_cache(&self) -> Result<()> {
        for path in [
            self.enterprise_directory()?.join("managed-cache.json.enc"),
            self.enterprise_directory()?.join("managed-cache.key"),
        ] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error).context("failed to remove enterprise cache"),
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn enterprise_get_account_status(
    client: tauri::State<'_, EnterpriseClient>,
) -> Result<EnterpriseAccountStatus, String> {
    Ok(client.status().await)
}

#[tauri::command]
pub fn enterprise_get_public_config(
    client: tauri::State<'_, EnterpriseClient>,
) -> Result<Option<EnterprisePublicConfig>, String> {
    client.load_config().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn enterprise_configure_account(
    client: tauri::State<'_, EnterpriseClient>,
    config: EnterprisePublicConfig,
) -> Result<EnterpriseAccountStatus, String> {
    client
        .save_config(config)
        .map_err(|error| error.to_string())?;
    client.session.lock().await.take();
    let refresh_result = delete_refresh_token().await;
    let cache_result = client.delete_cache();
    refresh_result.map_err(|error| user_facing_enterprise_error(&error))?;
    cache_result.map_err(|error| user_facing_enterprise_error(&error))?;
    Ok(EnterpriseAccountStatus::anonymous(true, None))
}

#[tauri::command]
pub async fn enterprise_sign_in(
    client: tauri::State<'_, EnterpriseClient>,
) -> Result<EnterpriseAccountStatus, String> {
    client
        .sign_in()
        .await
        .map_err(|error| user_facing_enterprise_error(&error))
}

#[tauri::command]
pub async fn enterprise_sync_projects(
    client: tauri::State<'_, EnterpriseClient>,
) -> Result<EnterpriseAccountStatus, String> {
    client
        .sync()
        .await
        .map_err(|error| user_facing_enterprise_error(&error))
}

#[tauri::command]
pub async fn enterprise_sign_out(
    client: tauri::State<'_, EnterpriseClient>,
) -> Result<EnterpriseAccountStatus, String> {
    client
        .sign_out()
        .await
        .map_err(|error| user_facing_enterprise_error(&error))
}

#[tauri::command]
pub async fn enterprise_connect_managed_source(
    manager: tauri::State<'_, crate::core::manager::ConnectionManager>,
    client: tauri::State<'_, EnterpriseClient>,
    connection_id: String,
    descriptor: oxide_enterprise_contracts::ManagedDataSourceDescriptor,
) -> Result<String, String> {
    let driver_id = descriptor.driver.clone();
    let mut driver = ManagedGatewayDriver::new(client.inner().clone(), descriptor)
        .map_err(|error| user_facing_enterprise_error(&error))?;
    use crate::core::driver::DatabaseDriver;
    driver
        .connect()
        .await
        .map_err(|error| user_facing_enterprise_error(&error))?;
    manager
        .replace_connection_with_tunnel_and_driver_id(
            connection_id,
            Box::new(driver),
            None,
            Some(driver_id),
        )
        .await
        .map_err(|error| user_facing_enterprise_error(&error))?;
    Ok("Managed Gateway session ready".into())
}

async fn receive_callback(listener: TcpListener) -> Result<(String, String)> {
    let (mut socket, _) = listener.accept().await?;
    let mut buffer = vec![0_u8; MAX_CALLBACK_BYTES];
    let read = socket
        .read(&mut buffer)
        .await
        .context("failed to read the sign-in callback")?;
    let request =
        std::str::from_utf8(&buffer[..read]).context("sign-in callback was not valid HTTP")?;
    let result = parse_callback_request(request);
    let (status, message) = if result.is_ok() {
        ("200 OK", "Sign-in complete. You can return to OxideStudio.")
    } else {
        (
            "400 Bad Request",
            "Sign-in could not be completed. Return to OxideStudio for details.",
        )
    };
    let body = format!(
        "<!doctype html><html><body style=\"font:14px system-ui;background:#15171a;color:#e7e9ed;padding:48px\"><h1 style=\"font-size:18px\">OxideStudio</h1><p>{message}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = socket.write_all(response.as_bytes()).await;
    result
}

fn parse_callback_request(request: &str) -> Result<(String, String)> {
    let request_target = request
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("GET "))
        .and_then(|line| line.split_once(' ').map(|(target, _)| target))
        .context("sign-in callback request line is invalid")?;
    let callback = Url::parse(&format!("http://127.0.0.1{request_target}"))
        .context("sign-in callback URL is invalid")?;
    if callback.path() != "/callback" {
        return Err(anyhow!("sign-in callback path is invalid"));
    }
    let parameters = callback
        .query_pairs()
        .into_owned()
        .collect::<std::collections::HashMap<_, _>>();
    if let Some(error) = parameters.get("error") {
        return Err(anyhow!("identity provider returned {error}"));
    }
    let code = parameters
        .get("code")
        .filter(|value| !value.is_empty())
        .cloned()
        .context("sign-in callback did not contain an authorization code")?;
    let state = parameters
        .get("state")
        .filter(|value| !value.is_empty())
        .cloned()
        .context("sign-in callback did not contain state")?;
    Ok((code, state))
}

async fn load_refresh_token() -> Result<Option<String>> {
    tokio::task::spawn_blocking(|| {
        let entry = keyring::Entry::new(ENTERPRISE_REFRESH_SERVICE, ENTERPRISE_REFRESH_ACCOUNT)
            .context("platform credential storage is unavailable")?;
        match entry.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(anyhow!(error)).context("failed to read the enterprise session"),
        }
    })
    .await
    .context("enterprise credential task failed")?
}

async fn save_refresh_token(token: &str) -> Result<()> {
    let token = token.to_string();
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(ENTERPRISE_REFRESH_SERVICE, ENTERPRISE_REFRESH_ACCOUNT)
            .context("platform credential storage is unavailable")?;
        entry
            .set_password(&token)
            .context("failed to protect the enterprise session")
    })
    .await
    .context("enterprise credential task failed")?
}

async fn delete_refresh_token() -> Result<()> {
    tokio::task::spawn_blocking(|| {
        let entry = keyring::Entry::new(ENTERPRISE_REFRESH_SERVICE, ENTERPRISE_REFRESH_ACCOUNT)
            .context("platform credential storage is unavailable")?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(anyhow!(error)).context("failed to remove the enterprise session"),
        }
    })
    .await
    .context("enterprise credential task failed")?
}

fn normalized_https_url(value: &str, label: &str) -> Result<String> {
    let mut url = Url::parse(value.trim()).with_context(|| format!("{label} URL is invalid"))?;
    let local_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if url.scheme() != "https" && !local_http {
        return Err(anyhow!("{label} must use HTTPS"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(anyhow!("{label} URL must not contain credentials"));
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn normalize_optional_path(value: &mut Option<String>) {
    *value = value
        .take()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

fn user_facing_enterprise_error(error: &anyhow::Error) -> String {
    let message = error.to_string();
    if message.contains("credential storage") {
        "Secure sign-in storage is unavailable on this device. Unlock the system credential store and try again.".into()
    } else if message.contains("identity provider") {
        format!("Enterprise sign-in could not be completed: {message}")
    } else if message.contains("control plane") || message.contains("synchronize") {
        "OxideStudio could not reach the enterprise service. Local projects remain available; check the network and try again.".into()
    } else {
        message
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_requires_code_and_state() {
        let request = "GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: localhost\r\n\r\n";
        assert_eq!(
            parse_callback_request(request).unwrap(),
            ("abc".into(), "xyz".into())
        );
        assert!(parse_callback_request("GET /callback?code=abc HTTP/1.1\r\n\r\n").is_err());
    }

    #[test]
    fn public_config_rejects_embedded_credentials_and_remote_http() {
        assert!(normalized_https_url("https://secret@example.test", "issuer").is_err());
        assert!(normalized_https_url("http://example.test", "issuer").is_err());
        assert!(normalized_https_url("http://127.0.0.1:8080", "issuer").is_ok());
    }
}
