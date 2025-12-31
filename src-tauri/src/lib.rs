/// OxideStudio - Tauri Application Entry Point
/// 重构后的精简版本,使用模块化的 commands
pub mod commands;
pub mod core;
pub mod drivers;

use commands::query::ParserState;
use core::cache::CacheManager;
use core::config::ConfigManager;
use core::manager::ConnectionManager;
use core::parser::SqlParser;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = ConnectionManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(manager)
        .setup(|app| {
            // Initialize config manager
            let config_manager = ConfigManager::new(app.handle());
            app.manage(config_manager);

            // Initialize cache manager
            let cache_manager = CacheManager::new(app.handle());
            app.manage(cache_manager);

            // Initialize SQL Parser state
            app.manage(ParserState(Mutex::new(SqlParser::new())));

            // Platform-specific window configuration
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    use tauri::TitleBarStyle;
                    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
                }

                #[cfg(target_os = "windows")]
                {
                    let _ = window.set_decorations(false);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Connection commands
            commands::connection::connect_db,
            commands::connection::save_connections,
            commands::connection::load_connections,
            // Query commands
            commands::query::execute_query,
            commands::query::get_sql_completion,
            // Schema commands
            commands::schema::get_schemas,
            commands::schema::get_tables,
            commands::schema::get_columns,
            commands::schema::set_current_schema,
            // Cache commands
            commands::cache::get_cached_schemas,
            commands::cache::refresh_schemas,
            commands::cache::get_cached_tables,
            commands::cache::refresh_tables,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
