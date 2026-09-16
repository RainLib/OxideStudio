//! Managed CLI installation and authentication API.
//! Implementation modules preserve the provider protocols and session ownership.

mod authentication;
mod authentication_process;
mod authentication_protocol;
mod authentication_state;
mod authentication_verification;
mod codebuddy_authentication;
mod codex_authentication;
mod installation;
mod packages;
mod paths;

pub use authentication::{authentication_methods, begin_authentication};
pub use authentication_state::{authentication_status, cancel_authentication};
pub use installation::{begin_installation, install_provider, installation_status};

#[cfg(test)]
mod tests;
