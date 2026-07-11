use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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
