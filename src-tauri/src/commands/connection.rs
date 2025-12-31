/// 连接管理相关 commands
use crate::core::{
    config::{AppConfig, ConfigManager, SavedConnection},
    driver::DatabaseDriver,
    manager::ConnectionManager,
    protocol::Response,
};
use crate::drivers::{mysql::MysqlDriver, postgres::PostgresDriver};
use tauri::State;

/// 连接数据库
#[tauri::command]
pub async fn connect_db(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    url: String,
) -> Result<Response<String>, String> {
    let result = async {
        println!("Connecting to database: driver={}, url={}", driver, url);

        // 创建 driver 实例并连接
        let db_driver: Box<dyn DatabaseDriver> = match driver.as_str() {
            "postgres" => {
                let mut pg_driver = PostgresDriver::new(&url);
                pg_driver
                    .connect()
                    .await
                    .map_err(|e| format!("Failed to connect to PostgreSQL: {}", e))?;
                Box::new(pg_driver)
            }
            "mysql" => {
                let mut mysql_driver = MysqlDriver::new(&url);
                mysql_driver
                    .connect()
                    .await
                    .map_err(|e| format!("Failed to connect to MySQL: {}", e))?;
                Box::new(mysql_driver)
            }
            _ => return Err(format!("Unsupported database driver: {}", driver)),
        };

        // 添加到连接管理器
        manager
            .add_connection(connection_id.clone(), db_driver)
            .await;

        // 测试连接
        manager
            .ping(&connection_id)
            .await
            .map_err(|e| format!("Connection test failed: {}", e))?;

        Ok(format!("Connected to {} successfully", driver))
    }
    .await;

    match result {
        Ok(msg) => Ok(Response::ok(msg)),
        Err(e) => Ok(Response::err("CONNECTION_ERROR", &e)),
    }
}

/// 保存连接配置
#[tauri::command]
pub fn save_connections(
    config_manager: State<'_, ConfigManager>,
    connections: Vec<SavedConnection>,
) -> Result<Response<String>, String> {
    let config = AppConfig { connections };
    config_manager.save(&config);
    Ok(Response::ok("Connections saved successfully".to_string()))
}

/// 加载连接配置
#[tauri::command]
pub fn load_connections(
    config_manager: State<'_, ConfigManager>,
) -> Result<Response<Vec<SavedConnection>>, String> {
    let config = config_manager.load();
    Ok(Response::ok(config.connections))
}
