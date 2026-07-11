use crate::core::config::ConfigManager;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn get_app_settings(config: State<'_, ConfigManager>) -> Result<Value, String> {
    config.load_settings()
}

#[tauri::command]
pub async fn get_app_settings_path(config: State<'_, ConfigManager>) -> Result<String, String> {
    Ok(config.settings_path())
}

#[tauri::command]
pub async fn save_app_settings(
    config: State<'_, ConfigManager>,
    settings: Value,
) -> Result<(), String> {
    config.save_settings(&settings)
}

#[tauri::command]
pub async fn reset_app_settings(config: State<'_, ConfigManager>) -> Result<(), String> {
    config.reset_settings()
}
