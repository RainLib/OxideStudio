pub use super::models::{
    EnterpriseAccountStatus, EnterpriseClient, EnterprisePublicConfig, ManagedDeviceEnrollment,
};
use super::{
    gateway_driver::ManagedGatewayDriver, session::delete_refresh_token,
    support::user_facing_enterprise_error,
};
use anyhow::Result;

#[tauri::command]
pub async fn enterprise_get_account_status(
    client: tauri::State<'_, EnterpriseClient>,
) -> Result<EnterpriseAccountStatus, String> {
    Ok(client.status().await)
}

#[tauri::command]
pub fn enterprise_get_public_config(
    client: tauri::State<'_, EnterpriseClient>,
) -> Result<Option<EnterprisePublicConfig>, String> {
    client.load_config().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn enterprise_get_managed_device_enrollment(
    client: tauri::State<'_, EnterpriseClient>,
) -> Result<Option<ManagedDeviceEnrollment>, String> {
    client
        .managed_device_enrollment()
        .map_err(|error| user_facing_enterprise_error(&error))
}

#[tauri::command]
pub async fn enterprise_configure_account(
    client: tauri::State<'_, EnterpriseClient>,
    config: EnterprisePublicConfig,
) -> Result<EnterpriseAccountStatus, String> {
    client
        .save_config(config)
        .map_err(|error| error.to_string())?;
    client.session.lock().await.take();
    let refresh_result = delete_refresh_token(
        client
            .enterprise_directory()
            .map_err(|error| user_facing_enterprise_error(&error))?,
    )
    .await;
    let cache_result = client.delete_cache();
    refresh_result.map_err(|error| user_facing_enterprise_error(&error))?;
    cache_result.map_err(|error| user_facing_enterprise_error(&error))?;
    Ok(EnterpriseAccountStatus::anonymous(true, None))
}

#[tauri::command]
pub async fn enterprise_sign_in(
    client: tauri::State<'_, EnterpriseClient>,
) -> Result<EnterpriseAccountStatus, String> {
    client
        .sign_in()
        .await
        .map_err(|error| user_facing_enterprise_error(&error))
}

#[tauri::command]
pub async fn enterprise_sync_projects(
    client: tauri::State<'_, EnterpriseClient>,
) -> Result<EnterpriseAccountStatus, String> {
    client
        .sync()
        .await
        .map_err(|error| user_facing_enterprise_error(&error))
}

#[tauri::command]
pub async fn enterprise_sign_out(
    client: tauri::State<'_, EnterpriseClient>,
) -> Result<EnterpriseAccountStatus, String> {
    client
        .sign_out()
        .await
        .map_err(|error| user_facing_enterprise_error(&error))
}

#[tauri::command]
pub async fn enterprise_connect_managed_source(
    manager: tauri::State<'_, crate::core::manager::ConnectionManager>,
    client: tauri::State<'_, EnterpriseClient>,
    connection_id: String,
    descriptor: oxide_enterprise_contracts::ManagedDataSourceDescriptor,
) -> Result<String, String> {
    let driver_id = descriptor.driver.clone();
    let mut driver = ManagedGatewayDriver::new(client.inner().clone(), descriptor)
        .map_err(|error| user_facing_enterprise_error(&error))?;
    use crate::core::driver::DatabaseDriver;
    driver
        .connect()
        .await
        .map_err(|error| user_facing_enterprise_error(&error))?;
    manager
        .replace_connection_with_tunnel_and_driver_id(
            connection_id,
            Box::new(driver),
            None,
            Some(driver_id),
        )
        .await
        .map_err(|error| user_facing_enterprise_error(&error))?;
    Ok("Managed Gateway session ready".into())
}
