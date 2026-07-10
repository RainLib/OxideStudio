/// OxideStudio - Tauri Application Entry Point
/// 重构后的精简版本,使用模块化的 commands
pub mod commands;
pub mod core;
pub mod drivers;
pub mod lsp;

use commands::query::{ParserState, QueryCancellationState};
use core::cache::CacheManager;
use core::config::ConfigManager;
use core::manager::ConnectionManager;
use core::parser::SqlParser;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = ConnectionManager::new();

    // Initialize LSP state
    let lsp_state = commands::lsp::LspState(Arc::new(tokio::sync::Mutex::new(
        std::collections::HashMap::new(),
    )));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(manager)
        .manage(lsp_state)
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
            app.manage(QueryCancellationState::default());

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
            commands::connection::test_db_connection,
            commands::connection::disconnect_db,
            commands::connection::save_connections,
            commands::connection::load_connections,
            // AI commands
            commands::ai::ai_chat_completion,
            commands::ai::ai_test_provider,
            // Query commands
            commands::query::execute_query,
            commands::query::cancel_query,
            commands::query::get_sql_completion,
            // Schema commands
            commands::database::get_database_capabilities,
            commands::database::list_database_capabilities,
            commands::database::create_database,
            commands::database::drop_database,
            commands::database::rename_database,
            commands::schema::get_schemas,
            commands::schema::get_tables,
            commands::schema::get_collections,
            commands::schema::get_columns,
            commands::schema::get_indexes,
            commands::schema::get_constraints,
            commands::schema::get_functions,
            commands::schema::set_current_schema,
            // Table commands
            commands::table::preview_table_page,
            commands::table::export_table_data,
            commands::table::mutate_table_rows,
            commands::table::create_table,
            commands::table::create_view,
            commands::table::create_materialized_view,
            commands::table::add_table_column,
            commands::table::drop_table_column,
            commands::table::rename_table_column,
            commands::table::alter_table_column,
            commands::table::create_table_index,
            commands::table::drop_table_index,
            commands::table::rename_table_index,
            commands::table::create_table_unique_constraint,
            commands::table::create_table_primary_key,
            commands::table::create_table_check_constraint,
            commands::table::create_table_foreign_key,
            commands::table::drop_table_constraint,
            commands::table::truncate_table,
            commands::table::drop_table,
            commands::table::rename_table,
            commands::table::get_view_definition,
            commands::table::refresh_materialized_view,
            commands::table::get_table_ddl,
            // Transaction commands
            commands::transaction::begin_transaction,
            commands::transaction::commit_transaction,
            commands::transaction::rollback_transaction,
            // Cache commands
            commands::cache::get_cached_schemas,
            commands::cache::refresh_schemas,
            commands::cache::get_cached_tables,
            commands::cache::refresh_tables,
            // Store commands (SQLite MetaStore)
            commands::store::save_project,
            commands::store::get_projects,
            commands::store::save_connection,
            commands::store::get_connections,
            commands::store::delete_connection,
            commands::store::save_resources,
            commands::store::replace_resources,
            commands::store::delete_resources,
            commands::store::get_resources,
            commands::store::search_resources,
            // LSP commands
            commands::lsp::lsp_initialize,
            commands::lsp::lsp_shutdown,
            commands::lsp::lsp_is_running,
            commands::lsp::lsp_get_completions,
            commands::lsp::lsp_hover,
            commands::lsp::lsp_goto_definition,
            commands::lsp::lsp_references,
            commands::lsp::lsp_formatting,
            commands::lsp::lsp_did_change_configuration,
            commands::lsp::lsp_did_open,
            commands::lsp::lsp_did_change,
            commands::lsp::lsp_did_close,
            // LSP binary management
            lsp::check_lsp_binary,
            // Window commands
            commands::window::create_new_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
