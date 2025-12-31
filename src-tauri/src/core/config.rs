use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AppConfig {
    pub connections: Vec<SavedConnection>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub url: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub database: Option<String>,
}

pub struct ConfigManager {
    config_path: PathBuf,
}

impl ConfigManager {
    pub fn new(app: &AppHandle) -> Self {
        let config_dir = app.path().app_config_dir().expect("failed to get config dir");
        fs::create_dir_all(&config_dir).ok();
        Self {
            config_path: config_dir.join("config.json"),
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
}
