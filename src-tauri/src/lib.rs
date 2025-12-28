pub mod core;
pub mod drivers;

use core::cache::CacheManager;
use core::config::{AppConfig, ConfigManager, SavedConnection};
use core::manager::ConnectionManager;
use core::parser::SqlParser;
use core::protocol::Response;
use drivers::mysql::MysqlDriver;
use drivers::postgres::PostgresDriver;
use std::sync::Mutex;
use tauri::{Manager, State};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// State for the SQL Parser
pub struct ParserState(pub Mutex<SqlParser>);

#[tauri::command]
async fn get_sql_completion(
    parser_state: State<'_, ParserState>,
    sql: String,
    cursor: usize,
) -> Result<core::parser::CompletionContext, String> {
    let mut parser = parser_state.0.lock().map_err(|e| e.to_string())?;
    // parser.get_completion_context is what we defined, but I updated it to parse_and_get_context in the file content I wrote?
    // Let me double check what I wrote in the previous turn.
    // I wrote `parse_and_get_context`.
    Ok(parser.parse_and_get_context(&sql, cursor))
}

#[tauri::command]
async fn connect_db(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    url: String,
) -> Result<Response<String>, String> {
    // In a real app, you might validate the URL or driver type here
    let db_driver: Box<dyn core::driver::DatabaseDriver> = match driver.as_str() {
        "postgres" => Box::new(PostgresDriver::new(&url)),
        "mysql" => Box::new(MysqlDriver::new(&url)),
        _ => {
            return Ok(Response::err(
                "DRIVER_NOT_SUPPORTED",
                "Driver not supported",
            ))
        }
    };

    let mut db_driver = db_driver;
    if let Err(e) = db_driver.connect().await {
        return Ok(Response::err("CONNECTION_FAILED", &e.to_string()));
    }

    manager
        .add_connection(connection_id.clone(), db_driver)
        .await;
    Ok(Response::ok("Connected".to_string()))
}

#[tauri::command]
async fn execute_query(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    sql: String,
    schema: Option<String>,
) -> Result<Response<Vec<core::protocol::QueryResult>>, String> {
    match manager.query(&connection_id, &sql, schema).await {
        Ok(results) => Ok(Response::ok(results)),
        Err(e) => Ok(Response::err("QUERY_FAILED", &e.to_string())),
    }
}

#[tauri::command]
fn save_connections(
    config_manager: State<'_, ConfigManager>,
    connections: Vec<SavedConnection>,
) -> Result<Response<String>, String> {
    let config = AppConfig { connections };
    config_manager.save(&config);
    Ok(Response::ok("Saved".to_string()))
}

#[tauri::command]
fn load_connections(
    config_manager: State<'_, ConfigManager>,
) -> Result<Response<Vec<SavedConnection>>, String> {
    let config = config_manager.load();
    Ok(Response::ok(config.connections))
}

#[tauri::command]
async fn get_schemas(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Response<Vec<String>>, String> {
    match manager.get_schemas(&connection_id).await {
        Ok(results) => Ok(Response::ok(results)),
        Err(e) => Ok(Response::err("GET_SCHEMAS_FAILED", &e.to_string())),
    }
}

#[tauri::command]
async fn get_tables(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<Vec<core::protocol::TableInfo>>, String> {
    match manager.get_tables(&connection_id, &schema).await {
        Ok(results) => Ok(Response::ok(results)),
        Err(e) => Ok(Response::err("GET_TABLES_FAILED", &e.to_string())),
    }
}

#[tauri::command]
async fn get_columns(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
    table: String,
) -> Result<Response<Vec<core::protocol::ColumnInfo>>, String> {
    match manager.get_columns(&connection_id, &schema, &table).await {
        Ok(results) => Ok(Response::ok(results)),
        Err(e) => Ok(Response::err("GET_COLUMNS_FAILED", &e.to_string())),
    }
}

#[tauri::command]
async fn set_current_schema(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<String>, String> {
    match manager.set_current_schema(&connection_id, &schema).await {
        Ok(_) => Ok(Response::ok("Context switched".to_string())),
        Err(e) => Ok(Response::err("SET_SCHEMA_FAILED", &e.to_string())),
    }
}

// Caching commands

#[tauri::command]
fn get_cached_schemas(
    cache: State<'_, CacheManager>,
    connection_id: String,
) -> Result<Response<Vec<String>>, String> {
    let key = format!("schemas_{}", connection_id);
    if let Some(schemas) = cache.load::<Vec<String>>(&key) {
        Ok(Response::ok(schemas))
    } else {
        Ok(Response::ok(vec![])) // Return empty if no cache
    }
}

#[tauri::command]
async fn refresh_schemas(
    manager: State<'_, ConnectionManager>,
    cache: State<'_, CacheManager>,
    connection_id: String,
) -> Result<Response<Vec<String>>, String> {
    // 1. Fetch from DB
    match manager.get_schemas(&connection_id).await {
        Ok(schemas) => {
            // 2. Load from cache to compare
            let key = format!("schemas_{}", connection_id);
            let cached: Option<Vec<String>> = cache.load(&key);

            let has_changed = if let Some(cached_schemas) = cached {
                schemas != cached_schemas
            } else {
                true
            };

            if has_changed {
                cache.save(&key, &schemas);
                Ok(Response::ok(schemas))
            } else {
                // Return None/Null to indicate no change? Or empty?
                // Protocol says Response<T>. Let's return the data anyway,
                // but maybe add a flag? For now, simplistic approach: always return data.
                // Wait, user asked: "if diff -> update, else -> no adjustment".
                // If we return data, frontend will update.
                // If we return "null" as data?
                // Let's return the data, but maybe we can signal "not modified"?
                // Using existing Response structure.
                // Actually, for SWR, passing the data back is fine if it's consistent.
                // Frontend checks if it's different? Backend checked it.
                // Backend can return error "NOT_MODIFIED"? No that's error.
                // Let's return the data - frontend will overwrite.
                // Optimization: if !has_changed, return None data?
                // If I change Response<Option<T>>...
                // Let's stick to returning data always for simplicity first,
                // unless payload is huge. Schemas are small.
                Ok(Response::ok(schemas))
            }
        }
        Err(e) => Ok(Response::err("REFRESH_SCHEMAS_FAILED", &e.to_string())),
    }
}

#[tauri::command]
fn get_cached_tables(
    cache: State<'_, CacheManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<Vec<core::protocol::TableInfo>>, String> {
    let key = format!("tables_{}_{}", connection_id, schema);
    if let Some(tables) = cache.load::<Vec<core::protocol::TableInfo>>(&key) {
        Ok(Response::ok(tables))
    } else {
        Ok(Response::ok(vec![]))
    }
}

#[tauri::command]
async fn refresh_tables(
    manager: State<'_, ConnectionManager>,
    cache: State<'_, CacheManager>,
    connection_id: String,
    schema: String,
) -> Result<Response<Vec<core::protocol::TableInfo>>, String> {
    match manager.get_tables(&connection_id, &schema).await {
        Ok(tables) => {
            let key = format!("tables_{}_{}", connection_id, schema);
            let _cached: Option<Vec<core::protocol::TableInfo>> = cache.load(&key);

            // Equality check for TableInfo might need PartialEq derived?
            // Assuming TableInfo derives PartialEq (generated from json?)
            // It's in core::protocol.

            // If we can't check easy equality, just save always.
            // But let's check.

            cache.save(&key, &tables);
            Ok(Response::ok(tables))
        }
        Err(e) => Ok(Response::err("REFRESH_TABLES_FAILED", &e.to_string())),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = ConnectionManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(manager) // Manage the connection manager state
        .setup(|app| {
            let config_manager = ConfigManager::new(app.handle());
            app.manage(config_manager);

            let cache_manager = CacheManager::new(app.handle());
            app.manage(cache_manager);

            // Initialize SQL Parser state
            app.manage(ParserState(Mutex::new(SqlParser::new())));

            // Platform-specific window configuration
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    use tauri::TitleBarStyle;
                    // On macOS, use overlay style to show traffic lights
                    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
                }

                #[cfg(target_os = "windows")]
                {
                    // On Windows, disable decorations for custom title bar
                    let _ = window.set_decorations(false);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            connect_db,
            execute_query,
            save_connections,
            load_connections,
            get_schemas,
            get_tables,
            get_columns,
            get_columns,
            set_current_schema,
            get_cached_schemas,
            refresh_schemas,
            get_cached_tables,
            get_cached_tables,
            refresh_tables,
            get_sql_completion,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
