use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub struct CacheManager {
    cache_dir: PathBuf,
}

impl CacheManager {
    pub fn new(app: &AppHandle) -> Self {
        let app_dir = app
            .path()
            .app_config_dir()
            .expect("failed to get config dir");
        let cache_dir = app_dir.join("cache");
        fs::create_dir_all(&cache_dir).ok();
        Self { cache_dir }
    }

    fn get_path(&self, key: &str) -> PathBuf {
        // Sanitize key to be safe filename? For now assume connectionId is safe (uuid)
        // We might need subdirectories for tables: cache/connection_id/schemas.json, cache/connection_id/tables_schema.json
        // Or flat: connection_id_schemas.json
        self.cache_dir.join(format!("{}.json", key))
    }

    pub fn save<T: Serialize>(&self, key: &str, data: &T) {
        let path = self.get_path(key);
        if let Ok(content) = serde_json::to_string(data) {
            fs::write(path, content).ok();
        }
    }

    pub fn load<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let path = self.get_path(key);
        if let Ok(content) = fs::read_to_string(path) {
            serde_json::from_str(&content).ok()
        } else {
            None
        }
    }
}
