/// OxideStudio - Tauri Application Entry Point
/// 重构后的精简版本,使用模块化的 commands
pub mod commands;
pub mod core;
pub mod drivers;
pub mod lsp;

use commands::query::ParserState;
use core::cache::CacheManager;
use core::config::ConfigManager;
use core::manager::ConnectionManager;
use core::parser::SqlParser;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = ConnectionManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(manager)
        .setup(|app| {
            // Initialize config manager
            let config_manager = ConfigManager::new(app.handle());
            app.manage(config_manager);

            // Initialize cache manager (legacy JSON cache)
            let cache_manager = CacheManager::new(app.handle());
            app.manage(cache_manager);

            // Initialize MetaStore (SQLite based)
            use tauri::async_runtime::block_on;
            let meta_store = block_on(core::store::MetaStore::new(app.handle()))
                .expect("failed to initialize metadata store");
            app.manage(meta_store);

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

            // Register global shortcuts
            use tauri_plugin_global_shortcut::ShortcutState;

            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(
                "CommandOrControl+Shift+N",
                move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        // Create new window
                        let handle_clone = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            use std::time::{SystemTime, UNIX_EPOCH};
                            let timestamp = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap()
                                .as_millis();
                            let window_label = format!("window_{}", timestamp);

                            // Build window with platform-specific configuration
                            let mut builder = tauri::WebviewWindowBuilder::new(
                                &handle_clone,
                                window_label,
                                tauri::WebviewUrl::App("index.html".into()),
                            )
                            .title("OxideStudio")
                            .inner_size(1400.0, 900.0)
                            .min_inner_size(1200.0, 800.0)
                            .focused(true);

                            // Apply platform-specific settings before building
                            #[cfg(target_os = "windows")]
                            {
                                builder = builder.decorations(false);
                            }

                            if let Ok(_window) = builder.build() {
                                #[cfg(target_os = "macos")]
                                {
                                    use tauri::TitleBarStyle;
                                    let _ = _window.set_title_bar_style(TitleBarStyle::Overlay);
                                }
                            }
                        });
                    }
                },
            )?;

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
            // Store commands (SQLite MetaStore)
            commands::store::save_connection,
            commands::store::get_connections,
            commands::store::delete_connection,
            commands::store::save_resources,
            commands::store::get_resources,
            commands::store::search_resources,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
