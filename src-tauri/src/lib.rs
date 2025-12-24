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
        _ => return Ok(Response::err("DRIVER_NOT_SUPPORTED", "Driver not supported")),
    };

    let mut db_driver = db_driver;
    if let Err(e) = db_driver.connect().await {
         return Ok(Response::err("CONNECTION_FAILED", &e.to_string()));
    }

    manager.add_connection(connection_id.clone(), db_driver).await;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = ConnectionManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(manager) // Manage the connection manager state
        .setup(|app| {
            let config_manager = ConfigManager::new(app.handle());
            app.manage(config_manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            connect_db,
            execute_query,
            save_connections,
            load_connections
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
