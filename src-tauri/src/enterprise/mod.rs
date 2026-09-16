//! Enterprise facade: models, account lifecycle, callback handling, credential storage, and IPC handlers each have one owner.

pub mod callback;
pub mod client;
pub mod commands;
mod gateway_driver;
mod models;
mod session;
mod support;

pub use gateway_driver::ManagedGatewayDriver;
pub use models::*;

pub use commands::{
    enterprise_configure_account, enterprise_connect_managed_source, enterprise_get_account_status,
    enterprise_get_managed_device_enrollment, enterprise_get_public_config, enterprise_sign_in,
    enterprise_sign_out, enterprise_sync_projects,
};

#[cfg(test)]
mod tests;
