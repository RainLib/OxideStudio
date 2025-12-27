pub mod core;
pub mod drivers;

use core::config::{AppConfig, ConfigManager, SavedConnection};
use core::manager::ConnectionManager;
use core::protocol::Response;
use drivers::mysql::MysqlDriver;
use drivers::postgres::PostgresDriver;
use tauri::{Manager, State};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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
) -> Result<Response<Vec<core::protocol::QueryResult>>, String> {
    match manager.query(&connection_id, &sql).await {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = ConnectionManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(manager) // Manage the connection manager state
        .setup(|app| {
            let config_manager = ConfigManager::new(app.handle());
            app.manage(config_manager);

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
            set_current_schema
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
