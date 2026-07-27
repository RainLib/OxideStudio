/// OxideStudio - Tauri Application Entry Point
/// 重构后的精简版本,使用模块化的 commands
pub mod agent;
pub mod commands;
pub mod core;
pub mod drivers;
pub mod enterprise;
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(manager)
        .manage(lsp_state)
        .setup(|app| {
            #[cfg(desktop)]
            {
                let mut updater = tauri_plugin_updater::Builder::new();
                if let Some(public_key) =
                    option_env!("OXIDE_UPDATER_PUBLIC_KEY").filter(|value| !value.trim().is_empty())
                {
                    updater = updater.pubkey(public_key);
                }
                app.handle().plugin(updater.build())?;
            }

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
            let migration_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let meta_store = migration_handle.state::<core::store::MetaStore>();
                let config_manager = migration_handle.state::<ConfigManager>();
                match commands::connection::migrate_legacy_connections(&meta_store, &config_manager)
                    .await
                {
                    Ok(count) if count > 0 => {
                        tracing::info!(
                            connection_count = count,
                            "migrated legacy local connection credentials"
                        );
                    }
                    Ok(_) => {}
                    Err(error) => {
                        tracing::warn!(
                            error = %error,
                            "legacy connection credential migration was deferred"
                        );
                    }
                }
            });

            // Initialize SQL Parser state
            app.manage(ParserState(Mutex::new(SqlParser::new())));
            app.manage(QueryCancellationState::default());
            app.manage(commands::ai::AiCancellationState::default());
            app.manage(enterprise::EnterpriseClient::new(app.handle()));
            // AgentHostManager is side-effect free here. The sidecar and
            // encrypted local store are initialized lazily by the first agent command.
            app.manage(agent::AgentHostManager::new(app.handle()));

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
            commands::ai::ai_inline_completion,
            commands::ai::cancel_ai_request,
            commands::ai::ai_test_provider,
            commands::ai::ai_set_provider_secret,
            commands::ai::ai_has_provider_secret,
            // DeepAgents host commands
            commands::agent::agent_start_turn,
            commands::agent::agent_resume_turn,
            commands::agent::agent_cancel_turn,
            commands::agent::agent_answer_clarification,
            commands::agent::agent_approve_action,
            commands::agent::agent_get_status,
            commands::agent::agent_get_context_metrics,
            commands::agent::agent_save_conversation_snapshot,
            commands::agent::agent_load_conversation_snapshot,
            commands::agent::agent_import_text_attachment,
            commands::agent::agent_read_artifact,
            commands::agent::agent_search_artifact,
            commands::agent::agent_export_artifact,
            commands::agent::agent_clear_project_state,
            // Optional enterprise account and managed-project commands. These
            // initialize lazily and never block anonymous/local startup.
            enterprise::enterprise_get_account_status,
            enterprise::enterprise_get_public_config,
            enterprise::enterprise_configure_account,
            enterprise::enterprise_sign_in,
            enterprise::enterprise_sync_projects,
            enterprise::enterprise_sign_out,
            enterprise::enterprise_connect_managed_source,
            // Query commands
            commands::query::execute_query,
            commands::query::resolve_sql_statement_at_cursor,
            commands::query::validate_sql_syntax,
            commands::query::import_sql_script,
            commands::query::import_elasticsearch_console_file,
            commands::query::export_elasticsearch_console_file,
            commands::query::execute_read_only_query,
            commands::query::explain_query,
            commands::query::cancel_query,
            commands::query::get_sql_completion,
            // Schema commands
            commands::database::get_database_capabilities,
            commands::database::list_database_capabilities,
            commands::database::create_database,
            commands::database::drop_database,
            commands::database::rename_database,
            commands::schema::get_databases,
            commands::schema::get_schemas,
            commands::schema::get_database_schemas,
            commands::schema::get_tables,
            commands::schema::get_database_tables,
            commands::schema::get_collections,
            commands::schema::get_collections_page,
            commands::schema::get_columns,
            commands::schema::get_database_columns,
            commands::schema::get_indexes,
            commands::schema::get_database_indexes,
            commands::schema::get_constraints,
            commands::schema::get_database_constraints,
            commands::schema::get_referencing_foreign_keys,
            commands::schema::get_database_referencing_foreign_keys,
            commands::schema::get_functions,
            commands::schema::get_database_functions,
            commands::schema::set_current_schema,
            commands::schema_diff::capture_schema_snapshot,
            commands::schema_diff::compare_schema_snapshots,
            commands::schema_diff::execute_schema_migration,
            commands::schema_diff::list_schema_migration_journal,
            // Table commands
            commands::table::preview_table_page,
            commands::table::export_table_data,
            commands::table::import_table_data,
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
            commands::store::get_project,
            commands::store::delete_project,
            commands::store::save_connection,
            commands::store::get_connections,
            commands::store::delete_connection,
            commands::store::save_resources,
            commands::store::replace_resources,
            commands::store::delete_resources,
            commands::store::get_resources,
            commands::store::search_resources,
            commands::store::save_query_history_entries,
            commands::store::get_query_history,
            commands::store::delete_query_history_entry,
            commands::store::clear_query_history,
            commands::store::save_assistant_task,
            commands::store::get_assistant_tasks,
            commands::store::clear_finished_assistant_tasks,
            // Project file commands
            commands::project_files::set_project_root,
            commands::project_files::list_project_entries,
            commands::project_files::get_project_completion_context,
            commands::project_files::get_project_git_changes,
            commands::project_files::get_project_git_file_diff,
            commands::project_files::read_project_file,
            commands::project_files::read_project_file_preview,
            commands::project_files::create_project_file,
            commands::project_files::create_project_directory,
            commands::project_files::write_project_file,
            commands::project_files::rename_project_entry,
            commands::project_files::delete_project_entry,
            // App settings commands
            commands::settings::get_app_settings,
            commands::settings::get_app_settings_path,
            commands::settings::save_app_settings,
            commands::settings::reset_app_settings,
            // LSP commands
            commands::lsp::lsp_initialize,
            commands::lsp::lsp_shutdown,
            commands::lsp::lsp_is_running,
            commands::lsp::lsp_get_completions,
            commands::lsp::lsp_hover,
            commands::lsp::lsp_goto_definition,
            commands::lsp::lsp_references,
            commands::lsp::lsp_inline_completion_context,
            commands::lsp::lsp_validate_inline_completion,
            commands::lsp::lsp_formatting,
            commands::lsp::lsp_request,
            commands::lsp::lsp_did_change_configuration,
            commands::lsp::lsp_did_open,
            commands::lsp::lsp_did_change,
            commands::lsp::lsp_did_close,
            // LSP binary management
            lsp::check_lsp_binary,
            // Window commands
            commands::window::create_new_window,
            commands::window::close_current_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
