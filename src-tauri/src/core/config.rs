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
    pub url: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub database: Option<String>,
    pub connection_url: Option<String>,
    pub ssl_mode: Option<String>,
    pub ssh_tunnel: Option<SshTunnelConfig>,
    pub tags: Option<Vec<String>>,
    pub icon: Option<String>,
    pub color: Option<String>,
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
    }
}
