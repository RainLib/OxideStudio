use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelConfig {
    #[serde(default)]
    pub enabled: bool,
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    pub username: String,
    #[serde(default = "default_ssh_auth_method")]
    pub auth_method: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    #[serde(default = "default_strict_host_key_checking")]
    pub strict_host_key_checking: bool,
    /// Ordered SSH hops after this primary hop. The primary fields above stay
    /// in place for backward-compatible single-hop connections; each entry
    /// is authenticated through the preceding hop with a direct-tcpip
    /// channel.
    #[serde(default)]
    pub jump_hosts: Vec<SshJumpHostConfig>,
    /// Present only for file-hosted SQLite. Keeping it nested prevents TCP
    /// tunnel connections from accidentally inheriting worker deployment
    /// authority merely because SSH is enabled.
    #[serde(default)]
    pub remote_sqlite: Option<RemoteSqliteSshConfig>,
}

/// Credentials and host-key policy for one non-primary SSH hop. It cannot
/// carry Remote SQLite deployment options: file access always occurs at the
/// final hop.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SshJumpHostConfig {
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    pub username: String,
    #[serde(default = "default_ssh_auth_method")]
    pub auth_method: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    #[serde(default = "default_strict_host_key_checking")]
    pub strict_host_key_checking: bool,
}

impl std::fmt::Debug for SshJumpHostConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SshJumpHostConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("auth_method", &self.auth_method)
            .field("password", &self.password.as_ref().map(|_| "****"))
            .field("private_key_path", &self.private_key_path)
            .field(
                "private_key_passphrase",
                &self.private_key_passphrase.as_ref().map(|_| "****"),
            )
            .field("strict_host_key_checking", &self.strict_host_key_checking)
            .finish()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSqliteSshConfig {
    #[serde(default)]
    pub placement: SqliteWorkerPlacement,
    #[serde(default)]
    pub worker_path: Option<String>,
    /// Explicit user consent to upload the exact signed worker selected by the
    /// Host. Preplaced mode never consumes this flag.
    #[serde(default)]
    pub allow_worker_upload: bool,
    /// SHA-256 of the exact signed worker the user prepared for this SSH
    /// target. A newly released worker must be prepared and approved again;
    /// the general upload switch alone is deliberately insufficient.
    #[serde(default)]
    pub approved_worker_digest: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SqliteWorkerPlacement {
    #[default]
    Session,
    Persist,
    Preplaced,
}

impl std::fmt::Debug for SshTunnelConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SshTunnelConfig")
            .field("enabled", &self.enabled)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("auth_method", &self.auth_method)
            .field("password", &self.password.as_ref().map(|_| "****"))
            .field("private_key_path", &self.private_key_path)
            .field(
                "private_key_passphrase",
                &self.private_key_passphrase.as_ref().map(|_| "****"),
            )
            .field("strict_host_key_checking", &self.strict_host_key_checking)
            .field("jump_hosts", &self.jump_hosts)
            .field("remote_sqlite", &self.remote_sqlite)
            .finish()
    }
}

fn default_ssh_port() -> u16 {
    22
}

fn default_ssh_auth_method() -> String {
    "password".to_string()
}

fn default_strict_host_key_checking() -> bool {
    true
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AppConfig {
    pub connections: Vec<SavedConnection>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub id: String,
    #[serde(default = "default_project_id")]
    pub project_id: String,
    pub name: String,
    pub driver: String,
    #[serde(default)]
    pub driver_package_version: Option<String>,
    pub url: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub database: Option<String>,
    pub connection_url: Option<String>,
    pub ssl_mode: Option<String>,
    #[serde(default)]
    pub index_grouping_pattern: Option<String>,
    pub ssh_tunnel: Option<SshTunnelConfig>,
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub note: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub environment: ConnectionEnvironment,
    #[serde(default)]
    pub production_databases: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionEnvironment {
    #[default]
    Unclassified,
    Development,
    Staging,
    Production,
}

fn default_project_id() -> String {
    "sqls".to_string()
}

pub struct ConfigManager {
    config_path: PathBuf,
    settings_path: PathBuf,
}

impl ConfigManager {
    pub fn new(app: &AppHandle) -> Self {
        let config_dir = app
            .path()
            .app_config_dir()
            .expect("failed to get config dir");
        fs::create_dir_all(&config_dir).ok();
        Self {
            config_path: config_dir.join("config.json"),
            settings_path: config_dir.join("settings.json"),
        }
    }

    pub fn load(&self) -> AppConfig {
        if let Ok(content) = fs::read_to_string(&self.config_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            AppConfig::default()
        }
    }

    pub fn save(&self, config: &AppConfig) {
        if let Ok(content) = serde_json::to_string_pretty(config) {
            fs::write(&self.config_path, content).ok();
        }
    }

    pub fn load_settings(&self) -> Result<Value, String> {
        if !self.settings_path.exists() {
            return Ok(Value::Object(Default::default()));
        }

        let content = fs::read_to_string(&self.settings_path)
            .map_err(|error| format!("Failed to read settings.json: {error}"))?;
        serde_json::from_str(&content).map_err(|error| format!("Invalid settings.json: {error}"))
    }

    pub fn save_settings(&self, settings: &Value) -> Result<(), String> {
        let content = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
        fs::write(&self.settings_path, content).map_err(|error| error.to_string())
    }

    pub fn reset_settings(&self) -> Result<(), String> {
        if self.settings_path.exists() {
            fs::remove_file(&self.settings_path).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub fn settings_path(&self) -> String {
        self.settings_path.to_string_lossy().into_owned()
    }

    /// Resolve the independently updateable driver registry before it is
    /// constructed. A migrated store becomes active only on the next launch;
    /// this prevents the running process from changing the filesystem root of
    /// packages that may still own live sidecars.
    pub fn driver_package_store_path(&self, default_root: PathBuf) -> PathBuf {
        let Ok(settings) = self.load_settings() else {
            return default_root;
        };
        let Some(value) = settings
            .get("drivers")
            .and_then(Value::as_object)
            .and_then(|drivers| drivers.get("storePath"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return default_root;
        };
        let candidate = PathBuf::from(value);
        if !candidate.is_absolute() || candidate.parent().is_none() {
            return default_root;
        }
        candidate
    }

    pub fn set_driver_package_store_path(&self, path: &std::path::Path) -> Result<(), String> {
        if !path.is_absolute() {
            return Err("Driver store path must be absolute".to_string());
        }
        let mut settings = self.load_settings()?;
        let root = settings
            .as_object_mut()
            .ok_or_else(|| "settings.json must contain an object".to_string())?;
        let drivers = root
            .entry("drivers")
            .or_insert_with(|| Value::Object(Default::default()))
            .as_object_mut()
            .ok_or_else(|| "settings.drivers must contain an object".to_string())?;
        drivers.insert(
            "storePath".to_string(),
            Value::String(path.to_string_lossy().into_owned()),
        );
        self.save_settings(&settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_saved_connection_without_ssh_tunnel_remains_compatible() {
        let connection: SavedConnection = serde_json::from_value(serde_json::json!({
            "id": "legacy",
            "name": "Postgres",
            "driver": "postgres",
            "url": "postgres://localhost/app"
        }))
        .unwrap();

        assert_eq!(connection.project_id, "sqls");
        assert!(connection.ssh_tunnel.is_none());
        assert!(connection.note.is_none());
        assert_eq!(connection.environment, ConnectionEnvironment::Unclassified);
        assert!(connection.production_databases.is_empty());
    }

    #[test]
    fn ssh_tunnel_defaults_to_strict_host_key_checking() {
        let config: SshTunnelConfig = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "host": "bastion.example.com",
            "username": "deploy",
            "password": "secret"
        }))
        .unwrap();

        assert_eq!(config.port, 22);
        assert_eq!(config.auth_method, "password");
        assert!(config.strict_host_key_checking);
        assert!(config.jump_hosts.is_empty());
        assert!(config.remote_sqlite.is_none());
    }

    #[test]
    fn ssh_jump_hosts_round_trip_without_worker_permissions() {
        let config: SshTunnelConfig = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "host": "bastion-a.example.com",
            "username": "first",
            "password": "first-secret",
            "jumpHosts": [{
                "host": "bastion-b.example.com",
                "port": 2200,
                "username": "second",
                "authMethod": "privateKey",
                "privateKeyPath": "~/.ssh/id_ed25519",
                "privateKeyPassphrase": "second-secret"
            }]
        }))
        .unwrap();

        assert_eq!(config.jump_hosts.len(), 1);
        let hop = &config.jump_hosts[0];
        assert_eq!(hop.host, "bastion-b.example.com");
        assert_eq!(hop.port, 2200);
        assert_eq!(hop.auth_method, "privateKey");
        assert!(hop.strict_host_key_checking);
        let serialized = serde_json::to_value(&config).unwrap();
        assert!(serialized["jumpHosts"][0].get("remoteSqlite").is_none());
    }

    #[test]
    fn remote_sqlite_worker_settings_round_trip_with_safe_defaults() {
        let config: SshTunnelConfig = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "host": "files.example.com",
            "username": "deploy",
            "password": "secret",
            "remoteSqlite": {}
        }))
        .unwrap();
        let remote = config.remote_sqlite.unwrap();
        assert_eq!(remote.placement, SqliteWorkerPlacement::Session);
        assert!(!remote.allow_worker_upload);
        assert!(remote.worker_path.is_none());
        assert!(remote.approved_worker_digest.is_none());

        let config: SshTunnelConfig = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "host": "files.example.com",
            "username": "deploy",
            "password": "secret",
            "remoteSqlite": {
                "placement": "preplaced",
                "workerPath": "/opt/oxide/oxide-sqlite-worker",
                "allowWorkerUpload": true,
                "approvedWorkerDigest": "a3f7c81e1f30eb317d5f504863df25b819f5beec5660bd2ef6cb54b663601b70"
            }
        }))
        .unwrap();
        let remote = config.remote_sqlite.unwrap();
        assert_eq!(remote.placement, SqliteWorkerPlacement::Preplaced);
        assert_eq!(
            remote.worker_path.as_deref(),
            Some("/opt/oxide/oxide-sqlite-worker")
        );
        assert_eq!(
            remote.approved_worker_digest.as_deref(),
            Some("a3f7c81e1f30eb317d5f504863df25b819f5beec5660bd2ef6cb54b663601b70")
        );

        // Older broad-consent configurations must downgrade safely. They can
        // still prepare the worker, but a new exact digest is required before
        // any future remote upload is attempted.
        let legacy: SshTunnelConfig = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "host": "files.example.com",
            "username": "deploy",
            "password": "secret",
            "remoteSqlite": { "allowWorkerUpload": true }
        }))
        .unwrap();
        let legacy_remote = legacy.remote_sqlite.unwrap();
        assert!(legacy_remote.allow_worker_upload);
        assert!(legacy_remote.approved_worker_digest.is_none());
    }

    #[test]
    fn configured_driver_store_requires_an_absolute_path() {
        let directory = tempfile::tempdir().unwrap();
        let manager = ConfigManager {
            config_path: directory.path().join("config.json"),
            settings_path: directory.path().join("settings.json"),
        };
        let fallback = directory.path().join("fallback");
        manager
            .save_settings(&serde_json::json!({
                "drivers": { "storePath": "relative/drivers" }
            }))
            .unwrap();
        assert_eq!(
            manager.driver_package_store_path(fallback.clone()),
            fallback
        );

        let configured = directory.path().join("driver-store");
        manager.set_driver_package_store_path(&configured).unwrap();
        assert_eq!(manager.driver_package_store_path(fallback), configured);
    }
}
