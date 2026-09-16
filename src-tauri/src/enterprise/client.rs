use crate::core::private_file::{create_private_file, replace_private_file};
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use oxide_enterprise_contracts::{certificate_fingerprint, ManagedProject};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, sync::Arc, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::{net::TcpListener, sync::Mutex, time::timeout};
use url::Url;
use zeroize::Zeroize;

use super::{
    callback::receive_callback,
    models::{
        AccessSessionResponse, EncryptedEnterpriseCache, EnterpriseAccountState,
        EnterpriseAccountStatus, EnterpriseCacheEnvelope, EnterpriseClient, EnterprisePublicConfig,
        EnterpriseSession, ManagedAccessSession, ManagedAccessSessionRequest,
        ManagedDeviceEnrollment, MeResponse, OidcDiscovery, TokenResponse,
    },
    session::{delete_refresh_token, load_refresh_token, save_refresh_token},
    support::{
        now_seconds, user_facing_enterprise_error, ENTERPRISE_CACHE_AAD,
        ENTERPRISE_CACHE_RETENTION_SECONDS, LOGIN_TIMEOUT,
    },
};

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
        let refresh_result = delete_refresh_token(self.enterprise_directory()?).await;
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
        let device_certificate_fingerprint =
            self.gateway_client_certificate_fingerprint(&config)?;
        let response = self
            .http
            .post(format!("{}/v1/access-sessions", config.control_plane_url))
            .bearer_auth(&access_token)
            .json(&serde_json::json!({
                "deviceId": device_id,
                "deviceCertificateFingerprint": device_certificate_fingerprint,
                "organizationId": input.organization_id,
                "projectId": input.project_id,
                "dataSourceId": input.data_source_id,
                "action": input.action,
                "resourcePath": input.resource_path,
                "requestId": request_id,
                "source": "desktop",
                "desktopVersion": self.app.package_info().version.to_string(),
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

    fn gateway_client_certificate_fingerprint(
        &self,
        config: &EnterprisePublicConfig,
    ) -> Result<String> {
        let path = config
            .gateway_client_certificate_path
            .as_ref()
            .context("This organization requires a managed Gateway device certificate. Ask your administrator to enroll this device.")?;
        let certificate = fs::read(path).with_context(|| {
            format!("failed to read managed Gateway device certificate at {path}")
        })?;
        let der = if certificate.starts_with(b"-----BEGIN") {
            let mut reader = std::io::BufReader::new(certificate.as_slice());
            let certificates = rustls_pemfile::certs(&mut reader)
                .collect::<Result<Vec<_>, _>>()
                .context("managed Gateway device certificate PEM is invalid")?;
            let certificate = certificates
                .first()
                .context("managed Gateway device certificate contains no leaf certificate")?;
            certificate.as_ref().to_vec()
        } else {
            certificate
        };
        Ok(certificate_fingerprint(&der))
    }

    pub fn managed_device_enrollment(&self) -> Result<Option<ManagedDeviceEnrollment>> {
        let Some(config) = self.load_config()? else {
            return Ok(None);
        };
        if config.gateway_client_certificate_path.is_none() {
            return Ok(None);
        }
        Ok(Some(ManagedDeviceEnrollment {
            device_id: self.load_or_create_device_id()?,
            certificate_fingerprint: self.gateway_client_certificate_fingerprint(&config)?,
        }))
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
        let Some(mut refresh_token) = load_refresh_token(self.enterprise_directory()?).await?
        else {
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
            let _ = delete_refresh_token(self.enterprise_directory()?).await;
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
            save_refresh_token(self.enterprise_directory()?, refresh_token).await?;
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

    pub(super) fn enterprise_directory(&self) -> Result<PathBuf> {
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

    pub(super) fn delete_cache(&self) -> Result<()> {
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
